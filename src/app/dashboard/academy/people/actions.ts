"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import type { AcademyRole, AcademyScope } from "@/lib/academy/database";
import { requireAcademyManager } from "@/lib/academy/auth";
import { academyInviteMail } from "@/lib/academy/mail";
import { type BulkPerson, isAcademyRole, isClientRole, normalizeEmail, parseBulkPeople } from "@/lib/academy/people";
import { defaultLocaleFor, defaultTimeZoneFor } from "@/lib/academy/time";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/notify/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Adding people to the Academy (Academy: beheer-editor en mensen toevoegen).
// Only Nordavo adds people: managers only, and academy_add_person() checks it
// again. A new address gets an account and an invite link (generateLink, so
// SUPABASE_SECRET_KEY is needed); an existing account is enrolled and gets a
// sign-in link, also without the key. The mail goes through sendMail
// (RESEND_API_KEY), which logs instead of sending when mail is not set up.

const PATH = "/dashboard/academy/people";
const NO_SECRET_KEY = "New accounts can only be made once SUPABASE_SECRET_KEY is set on the server. People who already have an account can be added.";

type Enrolment = {
  role: AcademyRole;
  clientId: string | null;
  candidateId: string | null;
  courseId: string | null;
  scope: AcademyScope;
  openModuleIds: string[];
  startDate: string | null;
  locale: "nl" | "en" | null;
  sendMail: boolean;
};

type AddResult = { ok: true; email: string; mailed: boolean; existing: boolean } | { ok: false; email: string; error: string };

function confirmUrl(hashedToken: string, type: "invite" | "recovery") {
  return `${env.siteUrl().replace(/\/$/, "")}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=${type}&next=/auth/password`;
}

/** One person: account (or existing), Academy row, access, mail. */
async function addOne(person: BulkPerson, enrolment: Enrolment, invitedBy: string, courseTitle: string | null): Promise<AddResult> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const email = normalizeEmail(person.email);

  const { data: existing } = await supabase.from("profiles").select("id, role").eq("email", email).maybeSingle();
  let profileId = existing?.id ?? null;
  let url: string | null = null;
  let linkKind: "new" | "reset" | "login" = "login";

  if (!profileId) {
    if (!admin) return { ok: false, email, error: NO_SECRET_KEY };
    const invite = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { full_name: person.name }, redirectTo: `${env.siteUrl()}/auth/confirm?next=/auth/password` },
    });
    if (invite.error || !invite.data.user || !invite.data.properties?.hashed_token) {
      console.error("academy addOne invite", invite.error?.code, invite.error?.message);
      return { ok: false, email, error: "The account could not be made." };
    }
    profileId = invite.data.user.id;
    url = confirmUrl(invite.data.properties.hashed_token, "invite");
    linkKind = "new";
  } else if (existing?.role === "external" && admin) {
    // Work guests sign in by mailed link, which the Academy roles cannot: they set a password.
    const recovery = await admin.auth.admin.generateLink({ type: "recovery", email });
    if (!recovery.error && recovery.data.properties?.hashed_token) {
      url = confirmUrl(recovery.data.properties.hashed_token, "recovery");
      linkKind = "reset";
    }
  }
  if (!url) url = `${env.siteUrl().replace(/\/$/, "")}/login?next=/academy`;

  const { error } = await supabase.rpc("academy_add_person", {
    p_profile_id: profileId,
    p_academy_role: enrolment.role,
    p_locale: enrolment.locale ?? defaultLocaleFor(enrolment.role),
    p_start_date: person.startDate ?? enrolment.startDate,
    p_client_id: isClientRole(enrolment.role) ? enrolment.clientId : null,
    p_candidate_id: enrolment.candidateId,
    p_course_id: enrolment.courseId,
    p_scope: enrolment.scope,
    p_open_module_ids: enrolment.openModuleIds,
    p_time_zone: existing ? null : defaultTimeZoneFor(enrolment.role),
  });
  if (error) {
    console.error("academy addOne add_person", error.code, error.message);
    const known = /client user|developer or candidate|external caller|linked to a client|not part of this course/.test(error.message);
    return { ok: false, email, error: known ? error.message : GENERIC_ERROR };
  }

  // The role in the session token (the proxy routes on it); the database
  // trigger keeps it in sync too, this covers a session that is already open.
  if (admin && !(existing?.role === "admin" || existing?.role === "member")) {
    const role = isClientRole(enrolment.role) ? "client" : enrolment.role;
    const { error: metaError } = await admin.auth.admin.updateUserById(profileId, { app_metadata: { portal_role: role } });
    if (metaError) console.error("academy addOne app_metadata", metaError.code, metaError.message);
  }

  let mailed = false;
  if (enrolment.sendMail) {
    const mail = academyInviteMail({
      name: person.name,
      url,
      invitedBy,
      locale: enrolment.locale ?? defaultLocaleFor(enrolment.role),
      courseTitle,
      linkKind,
    });
    mailed = await sendMail({ category: "academy_invite", to: email, subject: mail.subject, html: mail.html, text: mail.text });
  }
  return { ok: true, email, mailed, existing: Boolean(existing) };
}

const enrolmentSchema = z
  .object({
    academy_role: z.string().refine(isAcademyRole, { error: "Choose a role" }),
    client_id: z.guid({ error: "Choose a client" }).optional(),
    candidate_id: z.guid().optional(),
    course_id: z.guid({ error: "Choose a course" }).optional(),
    scope: z.enum(["all", "default"]).default("all"),
    start_date: z.iso.date({ error: "Enter a date" }).optional(),
    locale: z.enum(["nl", "en"]).optional(),
  })
  .refine((v) => !isClientRole(v.academy_role as AcademyRole) || v.client_id, {
    error: "Choose the client this person belongs to",
    path: ["client_id"],
  });

async function readEnrolment(formData: FormData) {
  const parsed = enrolmentSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: fieldErrorsFrom(parsed.error) } as const;
  const v = parsed.data;
  const enrolment: Enrolment = {
    role: v.academy_role as AcademyRole,
    clientId: v.client_id ?? null,
    candidateId: v.candidate_id ?? null,
    courseId: v.course_id ?? null,
    scope: v.scope,
    openModuleIds: formData.getAll("open_module_ids").filter((m): m is string => typeof m === "string" && z.guid().safeParse(m).success),
    startDate: v.start_date ?? null,
    locale: v.locale ?? null,
    sendMail: formData.get("send_mail") !== "off",
  };
  let courseTitle: string | null = null;
  if (enrolment.courseId) {
    const supabase = await createClient();
    const { data } = await supabase.from("academy_courses").select("title").eq("id", enrolment.courseId).maybeSingle();
    courseTitle = data?.title ?? null;
  }
  return { enrolment, courseTitle } as const;
}

const personSchema = z.object({
  full_name: z.string({ error: "Enter a name" }).min(2, { error: "Enter a name" }).max(120, { error: "At most 120 characters" }),
  email: z.email({ error: "Enter a valid email address" }).max(320),
});

export async function addPerson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAcademyManager();
  const person = personSchema.safeParse(formValues(formData));
  const read = await readEnrolment(formData);
  if (!person.success || "error" in read) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { ...(person.success ? {} : fieldErrorsFrom(person.error)), ...("error" in read ? read.error : {}) },
    };
  }
  const result = await addOne(
    { name: person.data.full_name, email: person.data.email, startDate: null },
    read.enrolment,
    user.name,
    read.courseTitle,
  );
  revalidatePath(PATH);
  if (!result.ok) return { error: result.error };
  const mail = !read.enrolment.sendMail ? "No mail was sent." : result.mailed ? `The invitation is on its way to ${result.email}.` : "The mail was not sent: check Email in Settings.";
  return { ok: true, message: `${person.data.full_name} is added${result.existing ? " (existing account)" : ""}. ${mail}` };
}

/** Many people at once: pasted lines or a CSV, same role, course and open modules. */
export async function addPeopleBulk(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAcademyManager();
  const read = await readEnrolment(formData);
  if ("error" in read) return { error: "Check the highlighted fields.", fieldErrors: read.error };
  const file = formData.get("file");
  const pasted = typeof formData.get("list") === "string" ? (formData.get("list") as string) : "";
  const fromFile = file instanceof File && file.size > 0 ? (file.size > 1_000_000 ? null : await file.text()) : "";
  if (fromFile === null) return { error: "The file is larger than 1 MB." };
  const parsed = parseBulkPeople([pasted, fromFile].filter(Boolean).join("\n"));
  if (parsed.people.length === 0) {
    return { error: parsed.errors[0]?.message ?? "Paste at least one name and e-mail address, or choose a CSV file." };
  }

  const results: AddResult[] = [];
  // One at a time: generateLink and mail per person, and the database checks each.
  for (const person of parsed.people) {
    results.push(await addOne(person, read.enrolment, user.name, read.courseTitle));
  }
  revalidatePath(PATH);
  const added = results.filter((r) => r.ok);
  const failed = results.filter((r): r is Extract<AddResult, { ok: false }> => !r.ok);
  const problems = [...parsed.errors.map((e) => e.message), ...failed.map((f) => `${f.email}: ${f.error}`)];
  const message = `${added.length} of ${parsed.people.length} added${read.enrolment.sendMail ? `, ${added.filter((r) => r.ok && r.mailed).length} invitations sent` : ""}.`;
  return problems.length > 0
    ? { ok: added.length > 0, error: `${message} Not added or skipped: ${problems.slice(0, 10).join(" ")}${problems.length > 10 ? ` and ${problems.length - 10} more.` : ""}` }
    : { ok: true, message };
}

const updateSchema = z.object({
  profile_id: z.guid({ error: "Person not found" }),
  locale: z.enum(["nl", "en"], { error: "Choose a language" }),
  start_date: z.iso.date({ error: "Enter a date" }).optional(),
  digest_frequency: z.enum(["daily", "weekly", "off"]),
});

/** Language, start date and mail summary of a person (the role changes by adding them again). */
export async function updatePerson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  const parsed = updateSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_members")
    .update({
      locale: parsed.data.locale,
      start_date: parsed.data.start_date ?? null,
      digest_frequency: parsed.data.digest_frequency,
    })
    .eq("profile_id", parsed.data.profile_id);
  if (error) {
    console.error("academy updatePerson", error.code, error.message);
    return { error: GENERIC_ERROR };
  }
  revalidatePath(PATH, "layout");
  return { ok: true, message: "Saved." };
}

/** A new invitation (or sign-in link) for someone already in the Academy. */
export async function resendInvite(profileId: string): Promise<ActionState> {
  const user = await requireAcademyManager();
  if (!z.guid().safeParse(profileId).success) return { error: "Person not found." };
  const supabase = await createClient();
  const [{ data: profile }, { data: member }] = await Promise.all([
    supabase.from("profiles").select("full_name, email").eq("id", profileId).maybeSingle(),
    supabase.from("academy_members").select("locale").eq("profile_id", profileId).maybeSingle(),
  ]);
  if (!profile?.email || !member) return { error: "Person not found." };
  const admin = createAdminClient();
  let url = `${env.siteUrl().replace(/\/$/, "")}/login?next=/academy`;
  let linkKind: "reset" | "login" = "login";
  if (admin) {
    const recovery = await admin.auth.admin.generateLink({ type: "recovery", email: profile.email });
    if (!recovery.error && recovery.data.properties?.hashed_token) {
      url = confirmUrl(recovery.data.properties.hashed_token, "recovery");
      linkKind = "reset";
    }
  }
  const mail = academyInviteMail({ name: profile.full_name ?? profile.email, url, invitedBy: user.name, locale: member.locale, courseTitle: null, linkKind });
  const sent = await sendMail({ category: "academy_invite", to: profile.email, subject: mail.subject, html: mail.html, text: mail.text });
  await supabase.from("academy_members").update({ invited_at: new Date().toISOString() }).eq("profile_id", profileId);
  revalidatePath(PATH, "layout");
  return sent ? { ok: true, message: `A new link is on its way to ${profile.email}.` } : { error: "The mail was not sent. Check Email in Settings." };
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

const groupSchema = z.object({
  name: z.string({ error: "Enter a name" }).min(1, { error: "Enter a name" }).max(200, { error: "At most 200 characters" }),
  kind: z.enum(["vacancy", "month", "campaign", "other"]),
  description: z.string().max(2000).optional(),
});

export async function createGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  const parsed = groupSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_groups").insert({ ...parsed.data, description: parsed.data.description ?? null });
  if (error) {
    console.error("academy createGroup", error.code, error.message);
    return { error: GENERIC_ERROR };
  }
  revalidatePath("/dashboard/academy", "layout");
  return { ok: true, message: "Group made." };
}

export async function deleteGroup(groupId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!z.guid().safeParse(groupId).success) return { error: "Group not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_groups").delete().eq("id", groupId);
  if (error) return { error: GENERIC_ERROR };
  revalidatePath("/dashboard/academy", "layout");
  return { ok: true };
}

export async function setGroupMembership(groupId: string, profileId: string, member: boolean): Promise<ActionState> {
  await requireAcademyManager();
  if (!z.guid().safeParse(groupId).success || !z.guid().safeParse(profileId).success) return { error: "Not found." };
  const supabase = await createClient();
  const { error } = member
    ? await supabase.from("academy_group_members").upsert({ group_id: groupId, profile_id: profileId }, { onConflict: "group_id,profile_id", ignoreDuplicates: true })
    : await supabase.from("academy_group_members").delete().eq("group_id", groupId).eq("profile_id", profileId);
  if (error) {
    console.error("academy setGroupMembership", error.code, error.message);
    return { error: GENERIC_ERROR };
  }
  revalidatePath("/dashboard/academy", "layout");
  return { ok: true };
}
