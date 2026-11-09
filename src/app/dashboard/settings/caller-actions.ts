"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/notify/mail";
import { callerInviteMail } from "@/lib/sales/caller-mail";
import type { CallerStatus } from "@/lib/sales/database";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Callers in Settings (feedback Julius, section 2.10). Admins only: add a
// caller (an account with role caller and an invitation by mail), change the
// fee, pause, resume and stop. Pausing or stopping closes access at once:
// current_caller_id() checks the status on every call screen request, and the
// account is banned in Supabase Auth so it cannot sign in or refresh a session.

const SETTINGS_PATH = "/dashboard/settings/callers";
/** Long enough to be "until resumed". */
const BAN_DURATION = "876000h";

const fee = z
  .string({ error: "Enter the fee per approved meeting" })
  .transform((v) => (v.trim() === "" ? Number.NaN : Number(v.replace(",", ".").replace(/[€\s]/g, ""))))
  .pipe(z.number({ error: "Enter an amount" }).min(0, { error: "At least 0" }).max(10000, { error: "At most 10,000" }));

const callerFields = {
  name: z.string({ error: "Enter a name" }).min(2, { error: "Enter a name" }).max(200, { error: "At most 200 characters" }),
  phone: z.string().max(50, { error: "At most 50 characters" }).optional(),
  party: z.string().max(200, { error: "At most 200 characters" }).optional(),
  fee_per_meeting: fee,
};

const addSchema = z.object({
  ...callerFields,
  email: z.email({ error: "Enter a valid email address" }).max(320),
});

/** The landing link for a link made with auth.admin.generateLink(): verify, then set a password. */
function confirmUrl(hashedToken: string, type: "invite" | "recovery") {
  return `${env.siteUrl().replace(/\/$/, "")}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=${type}&next=/auth/password`;
}

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

/** A one-time link for this address: an invite for a new account, a password link for an existing one. */
async function inviteLink(admin: Admin, email: string, name: string) {
  const invite = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name: name }, redirectTo: `${env.siteUrl()}/auth/confirm?next=/auth/password` },
  });
  if (!invite.error && invite.data.user && invite.data.properties?.hashed_token) {
    return { userId: invite.data.user.id, url: confirmUrl(invite.data.properties.hashed_token, "invite"), existing: false };
  }
  const recovery = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (recovery.error || !recovery.data.user || !recovery.data.properties?.hashed_token) {
    console.error("caller inviteLink", invite.error?.code, invite.error?.message, recovery.error?.code, recovery.error?.message);
    return null;
  }
  return { userId: recovery.data.user.id, url: confirmUrl(recovery.data.properties.hashed_token, "recovery"), existing: true };
}

async function mailInvite(to: string, name: string, url: string, invitedBy: string, existing: boolean) {
  const mail = callerInviteMail({ name, url, invitedBy, existingAccount: existing });
  return sendMail({ category: "caller_invite", to, subject: mail.subject, html: mail.html, text: mail.text });
}

const NO_SECRET_KEY = "Callers can only be added once SUPABASE_SECRET_KEY is set on the server.";

export async function addCaller(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = addSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const admin = createAdminClient();
  if (!admin) return { error: NO_SECRET_KEY };

  const email = parsed.data.email.toLowerCase();
  const { name, phone, party, fee_per_meeting } = parsed.data;

  const { data: existingCaller } = await admin.from("callers").select("id").eq("email", email).maybeSingle();
  if (existingCaller) {
    return { error: "This address is already a caller.", fieldErrors: { email: "Already a caller" } };
  }
  // A team member or client account never becomes a caller: that would take away their own access.
  const { data: profile } = await admin.from("profiles").select("id, role").eq("email", email).maybeSingle();
  if (profile && profile.role !== "caller" && profile.role !== "external") {
    return {
      error: "This address belongs to a team member or client account. Use another address for calling.",
      fieldErrors: { email: "Belongs to another account" },
    };
  }

  const link = await inviteLink(admin, email, name);
  if (!link) return { error: "The account could not be created. Please try again." };

  const [{ error: profileError }, { error: metaError }] = await Promise.all([
    admin.from("profiles").update({ role: "caller", full_name: name, modules: [] }).eq("id", link.userId),
    admin.auth.admin.updateUserById(link.userId, { app_metadata: { portal_role: "caller" } }),
  ]);
  if (profileError) {
    console.error("addCaller profile", profileError);
    return { error: GENERIC_ERROR };
  }
  if (metaError) console.error("addCaller app_metadata", metaError.code, metaError.message);

  const { error: insertError } = await admin.from("callers").insert({
    profile_id: link.userId,
    name,
    email,
    phone: phone ?? null,
    party: party ?? null,
    fee_per_meeting,
    invited_at: new Date().toISOString(),
    created_by: user.id,
  });
  if (insertError) {
    console.error("addCaller insert", insertError);
    return { error: GENERIC_ERROR };
  }

  const sent = await mailInvite(email, name, link.url, user.name, link.existing);
  revalidatePath(SETTINGS_PATH);
  return sent
    ? { ok: true, message: `${name} is added and the invitation is on its way to ${email}.` }
    : { ok: true, message: `${name} is added, but the invitation mail was not sent. Check Email in Settings, then use Resend invite.` };
}

export async function resendCallerInvite(callerId: string): Promise<ActionState> {
  const user = await requireAdmin();
  if (!z.guid().safeParse(callerId).success) return { error: "Caller not found." };
  const admin = createAdminClient();
  if (!admin) return { error: NO_SECRET_KEY };
  const { data: caller } = await admin.from("callers").select("id, name, email, status").eq("id", callerId).maybeSingle();
  if (!caller) return { error: "Caller not found." };
  if (caller.status !== "active") return { error: "Resume the caller first." };

  const link = await inviteLink(admin, caller.email, caller.name);
  if (!link) return { error: "No new link could be made. Please try again." };
  const sent = await mailInvite(caller.email, caller.name, link.url, user.name, link.existing);
  await admin.from("callers").update({ invited_at: new Date().toISOString() }).eq("id", caller.id);
  revalidatePath(SETTINGS_PATH);
  return sent ? { ok: true, message: `A new invitation is on its way to ${caller.email}.` } : { error: "The mail was not sent. Check Email in Settings." };
}

const editSchema = z.object({ id: z.guid({ error: "Caller not found" }), ...callerFields });

export async function updateCaller(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = editSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const { id, name, phone, party, fee_per_meeting } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("callers")
    .update({ name, phone: phone ?? null, party: party ?? null, fee_per_meeting })
    .eq("id", id);
  if (error) {
    console.error("updateCaller", error);
    return { error: GENERIC_ERROR };
  }
  revalidatePath(SETTINGS_PATH);
  return { ok: true, message: "Saved. The new fee applies to meetings planned from now on." };
}

const statusMessages: Record<CallerStatus, string> = {
  active: "Resumed. The caller can sign in and call again.",
  paused: "Paused. The caller cannot open the call screen or sign in until you resume.",
  stopped: "Stopped. The caller has no access any more; their contacts and lists are free again.",
};

export async function setCallerStatus(callerId: string, status: CallerStatus): Promise<ActionState> {
  await requireAdmin();
  if (!z.guid().safeParse(callerId).success || !["active", "paused", "stopped"].includes(status)) {
    return { error: "Caller not found." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("callers").update({ status }).eq("id", callerId).select("profile_id").maybeSingle();
  if (error || !data) {
    console.error("setCallerStatus", error);
    return { error: GENERIC_ERROR };
  }

  // Sign the account out everywhere: a ban ends its refresh tokens and blocks new sign-ins.
  const admin = createAdminClient();
  let note = "";
  if (admin && data.profile_id) {
    const { error: banError } = await admin.auth.admin.updateUserById(data.profile_id, {
      ban_duration: status === "active" ? "none" : BAN_DURATION,
    });
    if (banError) {
      console.error("setCallerStatus ban", banError.code, banError.message);
      note = " The account could not be signed out in Supabase; the call screen is closed all the same.";
    }
  } else if (status !== "active") {
    note = " Without SUPABASE_SECRET_KEY open sessions are not signed out, but the call screen is closed all the same.";
  }
  revalidatePath(SETTINGS_PATH);
  return { ok: true, message: statusMessages[status] + note };
}
