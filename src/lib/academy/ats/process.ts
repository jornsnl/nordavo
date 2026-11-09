import "server-only";
import type { Json } from "@/lib/database.types";
import type { AcademyAtsEventRow } from "@/lib/academy/ats/database";
import { placementWelcomeMail, topCandidateMail } from "@/lib/academy/ats/mail";
import type { AcademyLocale } from "@/lib/academy/database";
import { academyInviteMail } from "@/lib/academy/mail";
import { normalizeEmail } from "@/lib/academy/people";
import { env } from "@/lib/env";
import type { JobDb } from "@/lib/gtm/jobs";
import { sendMail } from "@/lib/notify/mail";

// The app half of the ATS automation (docs/academy.md, ATS-koppeling). The
// database queues events in academy_ats_events and does what it can alone;
// this makes the accounts that are missing (invite links need the admin API,
// so SUPABASE_SECRET_KEY), runs the database part with them and sends the
// mails. Runs with the service role: right after a placement is recorded
// (createPlacement, after the response), from the ATS buttons and every hour
// from the job academy-ats-sync. Idempotent: each step is noted on the event
// and a done step is never repeated, so a retry only does what is left.

const MAX_ATTEMPTS = 5;

type Result = Record<string, Json | undefined>;
type Log = (message: string) => void;

export type ProcessSummary = { done: number; skipped: number; failed: number; seen: number };

function site() {
  return env.siteUrl().replace(/\/$/, "");
}

function confirmUrl(hashedToken: string, type: "invite" | "recovery") {
  return `${site()}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=${type}&next=/auth/password`;
}

type Account = { profileId: string; role: string; url: string; linkKind: "new" | "reset" | "login"; created: boolean };

/**
 * The account for an address: existing (sign-in link; a Work guest gets a
 * link to set a password) or new (invite link). New accounts start as
 * external; the database functions give them their role.
 */
export async function ensureAccount(db: JobDb, email: string, name: string | null): Promise<Account> {
  const address = normalizeEmail(email);
  const { data: existing } = await db.from("profiles").select("id, role").eq("email", address).maybeSingle();
  if (existing) {
    let url = `${site()}/login?next=/academy`;
    let linkKind: Account["linkKind"] = "login";
    if (existing.role === "external") {
      const recovery = await db.auth.admin.generateLink({ type: "recovery", email: address });
      if (!recovery.error && recovery.data.properties?.hashed_token) {
        url = confirmUrl(recovery.data.properties.hashed_token, "recovery");
        linkKind = "reset";
      }
    }
    return { profileId: existing.id, role: existing.role, url, linkKind, created: false };
  }
  const invite = await db.auth.admin.generateLink({
    type: "invite",
    email: address,
    options: { data: { full_name: name ?? undefined }, redirectTo: `${site()}/auth/confirm?next=/auth/password` },
  });
  if (invite.error || !invite.data.user || !invite.data.properties?.hashed_token) {
    throw new Error(`The account could not be made (${invite.error?.code ?? "no link"}).`);
  }
  return {
    profileId: invite.data.user.id,
    role: "external",
    url: confirmUrl(invite.data.properties.hashed_token, "invite"),
    linkKind: "new",
    created: true,
  };
}

function asObject(value: Json | null | undefined): Result {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Result) : {};
}

async function note(db: JobDb, eventId: string, result: Result, status?: "done" | "skipped" | "failed", error?: string) {
  const { error: noteError } = await db.rpc("academy_ats_event_note", {
    p_event_id: eventId,
    p_result: result as Json,
    p_status: status ?? null,
    p_error: error ?? null,
  });
  if (noteError) throw new Error(`Could not log the event: ${noteError.message}`);
}

async function developerCourseLink(db: JobDb): Promise<string> {
  const { data } = await db.rpc("academy_ats_developer_course");
  return data ? `${site()}/academy/courses/${data}` : `${site()}/academy`;
}

/** Status placed: accounts, database part, welcome mails. */
async function processPlaced(db: JobDb, event: AcademyAtsEventRow, log: Log): Promise<"done" | "skipped"> {
  const done = asObject(event.result);
  const step: Result = {};
  if (!event.placement_id) return "skipped";
  const { data: placement } = await db
    .from("placements")
    .select("id, client_id, candidate_id, start_date, client:clients(name), candidate:candidates(full_name, email)")
    .eq("id", event.placement_id)
    .maybeSingle();
  if (!placement) {
    await note(db, event.id, { reason: "placement no longer exists" });
    return "skipped";
  }
  const { data: settings } = await db.from("academy_ats_settings").select("*").maybeSingle();
  const candidate = placement.candidate;
  const clientName = placement.client?.name ?? "the client";
  const developerName = candidate?.full_name ?? "Your developer";

  // Developer: the Academy account of the candidate, or a new one from the ATS address.
  const { data: member } = await db.from("academy_members").select("profile_id, locale").eq("candidate_id", placement.candidate_id).maybeSingle();
  let developer: Account | null = null;
  if (member) {
    const { data: profile } = await db.from("profiles").select("role").eq("id", member.profile_id).maybeSingle();
    developer = { profileId: member.profile_id, role: profile?.role ?? "candidate", url: `${site()}/login?next=/academy`, linkKind: "login", created: false };
  } else if (candidate?.email) {
    developer = await ensureAccount(db, candidate.email, candidate.full_name);
    if (developer.role === "client" || developer.role === "caller" || developer.role === "admin" || developer.role === "member") {
      step.developer_account = `skipped: the address belongs to a ${developer.role} account`;
      developer = null;
    } else {
      step.developer_account = developer.created ? "invited" : "existing account";
    }
  } else {
    step.developer_account = "skipped: the candidate has no e-mail address";
  }

  // Client contact: the primary contact of the client (or the first with an address).
  let client: Account | null = null;
  let contactName: string | null = null;
  if (settings?.invite_client_contact !== false) {
    const { data: contacts } = await db
      .from("client_contacts")
      .select("full_name, email, is_primary")
      .eq("client_id", placement.client_id)
      .not("email", "is", null)
      .order("is_primary", { ascending: false })
      .order("created_at")
      .limit(1);
    const contact = contacts?.[0];
    if (contact?.email) {
      contactName = contact.full_name;
      const account = await ensureAccount(db, contact.email, contact.full_name);
      if (account.role === "external" || account.role === "client") {
        client = account;
        step.client_account = account.created ? "invited" : "existing account";
      } else {
        step.client_account = `skipped: the contact's address belongs to a ${account.role} account`;
      }
    } else {
      step.client_account = "skipped: the client has no contact person with an e-mail address";
    }
  }

  const { data: database, error } = await db.rpc("academy_ats_apply_placement", {
    p_placement_id: placement.id,
    p_client_profile_id: client?.profileId ?? null,
    p_developer_profile_id: developer?.profileId ?? null,
  });
  if (error) throw new Error(`Database part failed: ${error.message}`);
  step.database = database;
  const db_ = asObject(database);

  if (settings?.welcome_mail !== false) {
    if (developer && db_.developer === "ok" && !done.welcome_developer && candidate?.email) {
      const mail = placementWelcomeMail({
        name: candidate.full_name,
        locale: (member?.locale as AcademyLocale | undefined) ?? "en",
        audience: "developer",
        clientName,
        developerName,
        startDate: placement.start_date,
        url: developer.url,
        linkKind: developer.linkKind,
      });
      const sent = await sendMail({ category: "academy_welcome", to: normalizeEmail(candidate.email), ...mail });
      step.welcome_developer = sent ? new Date().toISOString() : undefined;
      if (!sent) step.welcome_developer_note = "not sent (mail not configured)";
    }
    if (client && db_.client_contact === "ok" && !done.welcome_client) {
      const { data: profile } = await db.from("profiles").select("email").eq("id", client.profileId).maybeSingle();
      if (profile?.email) {
        const mail = placementWelcomeMail({
          name: contactName,
          locale: "nl",
          audience: "client",
          clientName,
          developerName,
          startDate: placement.start_date,
          url: client.url,
          linkKind: client.linkKind,
        });
        const sent = await sendMail({ category: "academy_welcome", to: profile.email, ...mail });
        step.welcome_client = sent ? new Date().toISOString() : undefined;
        if (!sent) step.welcome_client_note = "not sent (mail not configured)";
      }
    }
  }
  await note(db, event.id, step, "done");
  log(`placement ${placement.id}: done`);
  return "done";
}

/** Enrolment from the ATS or a vacancy group: account, database part, invitation. */
async function processEnrol(db: JobDb, event: AcademyAtsEventRow, log: Log): Promise<"done" | "skipped"> {
  if (!event.candidate_id) return "skipped";
  const payload = asObject(event.payload);
  const openModuleIds = Array.isArray(payload.open_module_ids) ? (payload.open_module_ids.filter((m) => typeof m === "string") as string[]) : [];
  const sendInvite = payload.send_mail !== false;
  const { data: candidate } = await db.from("candidates").select("id, full_name, email").eq("id", event.candidate_id).maybeSingle();
  if (!candidate) {
    await note(db, event.id, { reason: "candidate no longer exists" }, "skipped");
    return "skipped";
  }
  const { data: member } = await db.from("academy_members").select("profile_id").eq("candidate_id", candidate.id).maybeSingle();
  let account: Account | null = null;
  if (member) {
    account = { profileId: member.profile_id, role: "candidate", url: `${site()}/login?next=/academy`, linkKind: "login", created: false };
  } else if (candidate.email) {
    account = await ensureAccount(db, candidate.email, candidate.full_name);
  } else {
    await note(db, event.id, { reason: "the candidate has no e-mail address" }, "skipped");
    return "skipped";
  }
  if (["client", "caller", "admin", "member"].includes(account.role)) {
    await note(db, event.id, { reason: `the address belongs to a ${account.role} account` }, "skipped");
    return "skipped";
  }
  const { data: database, error } = await db.rpc("academy_ats_enrol_core", {
    p_profile_id: account.profileId,
    p_candidate_id: candidate.id,
    p_group_id: event.group_id,
    p_open_module_ids: openModuleIds,
    p_scope: "default",
    p_actor: event.created_by,
  });
  if (error) throw new Error(error.message);
  const step: Result = { database, account: account.created ? "invited" : "existing account" };
  if (sendInvite && candidate.email && (account.created || !member)) {
    const { data: inviter } = event.created_by
      ? await db.from("profiles").select("full_name").eq("id", event.created_by).maybeSingle()
      : { data: null };
    const { data: course } = await db.from("academy_courses").select("title").eq("id", (asObject(database).course_id as string) ?? "").maybeSingle();
    const mail = academyInviteMail({
      name: candidate.full_name,
      url: account.url,
      invitedBy: inviter?.full_name ?? "Nordavo",
      locale: "en",
      courseTitle: course?.title ?? null,
      linkKind: account.linkKind,
    });
    const sent = await sendMail({ category: "academy_invite", to: normalizeEmail(candidate.email), ...mail });
    step.invite = sent ? new Date().toISOString() : "not sent (mail not configured)";
  }
  await note(db, event.id, step, "done");
  log(`enrolment of candidate ${candidate.id}: done`);
  return "done";
}

/** Marked as top candidate: the mail with the newly opened modules. */
async function processTop(db: JobDb, event: AcademyAtsEventRow, log: Log): Promise<"done" | "skipped"> {
  const result = asObject(event.result);
  const titles = Array.isArray(result.opened_modules) ? (result.opened_modules.filter((t) => typeof t === "string") as string[]) : [];
  if (!event.profile_id || titles.length === 0 || result.mail_sent) {
    await note(db, event.id, {}, "skipped");
    return "skipped";
  }
  const [{ data: profile }, { data: member }] = await Promise.all([
    db.from("profiles").select("full_name, email").eq("id", event.profile_id).maybeSingle(),
    db.from("academy_members").select("locale").eq("profile_id", event.profile_id).maybeSingle(),
  ]);
  if (!profile?.email) {
    await note(db, event.id, { reason: "no e-mail address" }, "skipped");
    return "skipped";
  }
  const mail = topCandidateMail({
    name: profile.full_name,
    locale: (member?.locale as AcademyLocale | undefined) ?? "en",
    moduleTitles: titles,
    url: await developerCourseLink(db),
  });
  const sent = await sendMail({ category: "academy_top_candidate", to: profile.email, ...mail });
  await note(db, event.id, { mail_sent: sent ? new Date().toISOString() : "not sent (mail not configured)" }, "done");
  log(`top candidate mail to ${event.profile_id}: ${sent ? "sent" : "not sent"}`);
  return "done";
}

/**
 * Work through pending events (and failed ones under the attempt limit),
 * oldest first. Optional: only these events, or the event of one placement.
 * One bad event never stops the rest; its error is noted on the event.
 */
export async function processAtsEvents(
  db: JobDb,
  { eventIds, placementId, limit = 100, log = () => {} }: { eventIds?: string[]; placementId?: string; limit?: number; log?: Log } = {},
): Promise<ProcessSummary> {
  let query = db
    .from("academy_ats_events")
    .select("*")
    .or(`status.eq.pending,and(status.eq.failed,attempts.lt.${MAX_ATTEMPTS})`)
    .order("created_at")
    .limit(Math.min(Math.max(limit, 1), 1000));
  if (eventIds?.length) query = query.in("id", eventIds);
  if (placementId) query = query.eq("placement_id", placementId);
  const { data: events, error } = await query;
  if (error) throw new Error(`Could not load the Academy events: ${error.message}`);

  const summary: ProcessSummary = { done: 0, skipped: 0, failed: 0, seen: events.length };
  for (const event of events) {
    try {
      const outcome =
        event.kind === "placed"
          ? await processPlaced(db, event, log)
          : event.kind === "top_candidate"
            ? await processTop(db, event, log)
            : await processEnrol(db, event, log);
      if (outcome === "skipped") {
        const { data: current } = await db.from("academy_ats_events").select("status").eq("id", event.id).maybeSingle();
        if (current?.status === "pending" || current?.status === "failed") await note(db, event.id, {}, "skipped");
      }
      summary[outcome] += 1;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      log(`event ${event.id} (${event.kind}) failed: ${message}`);
      await note(db, event.id, {}, "failed", message).catch(() => undefined);
      summary.failed += 1;
    }
  }
  return summary;
}
