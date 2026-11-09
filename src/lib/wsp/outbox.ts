import "server-only";
import { env } from "@/lib/env";
import type { JobDb } from "@/lib/gtm/jobs";
import { deliverMail } from "@/lib/notify/mail";
import type { MailCategory } from "@/lib/notify/categories";
import type { WspOutboxRow } from "./database";
import { completedMail, inviteMail, permissionMail, reminderMail, withdrawnMail, type Mail } from "./mail";

// Sends the mail the database queued in wsp_outbox (invitation, reminder,
// permission request, withdrawn, completed). Runs with the service role:
// right after an action (after()) and every hour from the job wsp-mail.
// Without RESEND_API_KEY a mail stays pending, so it goes out once mail is
// configured. A refused mail is tried five times. The payload is emptied
// once a row is handled.

const MAX_ATTEMPTS = 5;

function site() {
  return env.siteUrl().replace(/\/$/, "");
}

export type OutboxSummary = { sent: number; skipped: number; failed: number; waiting: number };

type Outcome = { status: "sent" | "skipped" | "failed" | "waiting"; error?: string };

async function handle(db: JobDb, row: WspOutboxRow): Promise<Outcome> {
  const siteUrl = site();
  const assessment = row.assessment_id
    ? (await db.from("wsp_assessments").select("*").eq("id", row.assessment_id).maybeSingle()).data
    : null;

  if (row.kind === "withdrawn") {
    if (!row.client_id) return { status: "skipped", error: "no client" };
    const { data: contacts } = await db
      .from("client_contacts")
      .select("email, is_primary")
      .eq("client_id", row.client_id)
      .not("email", "is", null)
      .order("is_primary", { ascending: false })
      .order("created_at")
      .limit(1);
    const to = contacts?.[0]?.email;
    if (!to) return { status: "skipped", error: "the client has no contact person with an e-mail address" };
    const payload = (row.payload ?? {}) as { full_name?: string };
    return send(withdrawnMail({ fullName: payload.full_name ?? "", siteUrl }), to, "wsp_withdrawn");
  }

  if (!assessment || !assessment.person_id || assessment.status === "deleted") return { status: "skipped", error: "profile deleted" };
  const { data: person } = await db.from("candidates").select("full_name, email, owner_id").eq("id", assessment.person_id).maybeSingle();
  if (!person) return { status: "skipped", error: "candidate not found" };
  const tokenUrl = assessment.invite_token ? `${siteUrl}/working-style/${assessment.invite_token}` : null;

  if (row.kind === "invite" || row.kind === "reminder") {
    if (!["invited", "started"].includes(assessment.status) || new Date(assessment.expires_at) <= new Date()) {
      return { status: "skipped", error: "no longer open" };
    }
    if (!person.email || !tokenUrl) return { status: "skipped", error: "the candidate has no e-mail address" };
    const mail =
      row.kind === "invite"
        ? inviteMail({ name: person.full_name, url: tokenUrl, expiresAt: assessment.expires_at, developer: assessment.person_type === "developer", siteUrl })
        : reminderMail({ name: person.full_name, url: tokenUrl, expiresAt: assessment.expires_at, siteUrl });
    return send(mail, person.email, row.kind === "invite" ? "wsp_invite" : "wsp_reminder");
  }

  if (row.kind === "permission_request") {
    if (!person.email) return { status: "skipped", error: "the candidate has no e-mail address" };
    const { data: member } = await db.from("academy_members").select("profile_id").eq("candidate_id", assessment.person_id).maybeSingle();
    const url = member ? `${siteUrl}/academy/working-style` : tokenUrl;
    if (!url) return { status: "skipped", error: "no link" };
    const { data: client } = row.client_id ? await db.from("clients").select("name").eq("id", row.client_id).maybeSingle() : { data: null };
    return send(permissionMail({ name: person.full_name, clientName: client?.name ?? "A client", url, siteUrl }), person.email, "wsp_permission");
  }

  // completed: to whoever invited, else the candidate owner, else REPORT_EMAIL_TO.
  const recipientId = assessment.invited_by ?? person.owner_id;
  let to: string | undefined;
  if (recipientId) {
    const { data: profile } = await db.from("profiles").select("email").eq("id", recipientId).maybeSingle();
    to = profile?.email ?? undefined;
  }
  const flags = Array.isArray((row.payload as { flags?: unknown })?.flags)
    ? ((row.payload as { flags: unknown[] }).flags.filter((f) => typeof f === "string") as string[])
    : [];
  const url = `${siteUrl}/dashboard/candidates/${assessment.person_id}/working-style/${assessment.id}`;
  return send(completedMail({ name: person.full_name, flags, url, siteUrl }), to, "wsp_completed");
}

/** Candidates and developers get mail from the recruitment sender (MAIL_FROM_RECRUITMENT, else MAIL_FROM). */
const PERSON_CATEGORIES: MailCategory[] = ["wsp_invite", "wsp_reminder", "wsp_permission"];

async function send(mail: Mail, to: string | undefined, category: MailCategory): Promise<Outcome> {
  const from = PERSON_CATEGORIES.includes(category) ? process.env.MAIL_FROM_RECRUITMENT || undefined : undefined;
  const result = await deliverMail({ ...mail, to, category, from });
  if (result.ok) return { status: "sent" };
  if (result.reason === "not_configured") return { status: "waiting", error: result.detail };
  return { status: "failed", error: result.detail };
}

/** Handle pending outbox rows (all, or those of the given assessments). Never throws. */
export async function processWspOutbox(db: JobDb, { assessmentIds, limit = 200, log }: { assessmentIds?: string[]; limit?: number; log?: (m: string) => void } = {}): Promise<OutboxSummary> {
  const summary: OutboxSummary = { sent: 0, skipped: 0, failed: 0, waiting: 0 };
  let query = db.from("wsp_outbox").select("*").in("status", ["pending", "failed"]).lt("attempts", MAX_ATTEMPTS).order("created_at").limit(limit);
  if (assessmentIds?.length) query = query.in("assessment_id", assessmentIds);
  const { data: rows, error } = await query;
  if (error) {
    console.error("wsp outbox", error.message);
    return summary;
  }
  for (const row of rows ?? []) {
    let outcome: Outcome;
    try {
      outcome = await handle(db, row);
    } catch (cause) {
      outcome = { status: "failed", error: cause instanceof Error ? cause.message : String(cause) };
    }
    summary[outcome.status] += 1;
    if (outcome.status === "waiting") continue;
    const done = outcome.status === "sent" || outcome.status === "skipped";
    await db
      .from("wsp_outbox")
      .update({
        status: outcome.status,
        attempts: row.attempts + 1,
        last_error: outcome.error ?? null,
        handled_at: new Date().toISOString(),
        ...(done ? { payload: {} } : {}),
      })
      .eq("id", row.id);
    log?.(`${row.kind} ${row.id}: ${outcome.status}${outcome.error ? ` (${outcome.error})` : ""}`);
  }
  return summary;
}
