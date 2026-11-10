"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionState,
  GENERIC_ERROR,
  fieldErrorsFrom,
  formValues,
} from "@/lib/action-state";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { ALL_MODULES, isPortalModule } from "@/lib/modules";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  passwordErrorMessage,
  passwordSchema,
  passwordValues,
} from "@/components/settings/password-schema";

const profileSchema = z.object({
  full_name: z
    .string({ error: "Enter your name" })
    .min(2, { error: "Enter your name" })
    .max(120, { error: "At most 120 characters" }),
});

export async function updateOwnProfile(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireStaff();
  const parsed = profileSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check your name.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  // The column grant only allows users to update full_name on their own row.
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.full_name })
    .eq("id", user.id);

  if (error) {
    console.error("updateOwnProfile", error);
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Your name has been saved." };
}

export async function changePassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const parsed = passwordSchema.safeParse(passwordValues(formData));
  if (!parsed.success) {
    return { error: "Check your new password.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("changePassword", error.code, error.message);
    return { error: passwordErrorMessage(error.code) };
  }

  return { ok: true, message: "Your password has been changed." };
}

const roleSchema = z
  .object({
    user_id: z.guid({ error: "User not found" }),
    role: z.enum(["admin", "member", "client", "external"], { error: "Choose a role" }),
    client_id: z.guid({ error: "Choose a client" }).optional(),
  })
  .refine((v) => v.role !== "client" || v.client_id, {
    error: "Choose the client this account belongs to",
    path: ["client_id"],
  });

export async function updateUserRole(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = roleSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the role.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_profile", {
    p_user_id: parsed.data.user_id,
    p_role: parsed.data.role,
    p_client_id: parsed.data.role === "client" ? (parsed.data.client_id ?? null) : null,
  });

  if (error) {
    console.error("updateUserRole", error);
    // The function raises Dutch messages for the rules it enforces.
    return { error: error.message || GENERIC_ERROR };
  }

  revalidatePath("/dashboard/settings");
  return { ok: true, message: "Saved." };
}

const inviteSchema = z
  .object({
    email: z.email({ error: "Enter a valid email address" }),
    full_name: z
      .string({ error: "Enter a name" })
      .min(2, { error: "Enter a name" })
      .max(120, { error: "At most 120 characters" }),
    role: z.enum(["admin", "member", "client", "external"], { error: "Choose a role" }),
    client_id: z.guid({ error: "Choose a client" }).optional(),
  })
  .refine((v) => v.role !== "client" || v.client_id, {
    error: "Choose the client this account belongs to",
    path: ["client_id"],
  });

export async function inviteUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = inviteSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const admin = createAdminClient();
  if (!admin) {
    return {
      error:
        "Invites only work once SUPABASE_SECRET_KEY is set on the server. Until then, invite the user from the Supabase dashboard.",
    };
  }

  const { email, full_name, role, client_id } = parsed.data;
  // Members get the ticked modules (2.5); unticked boxes are not sent.
  const modules = formData.getAll("modules").filter(isPortalModule);
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email.toLowerCase(), {
    data: { full_name },
    redirectTo: `${env.siteUrl()}/auth/confirm?next=/auth/password`,
  });

  if (error || !data.user) {
    console.error("inviteUser", error?.code, error?.message);
    if (error?.code === "email_exists" || error?.status === 422) {
      return {
        error: "An account with this email address already exists.",
        fieldErrors: { email: "This email address already has an account" },
      };
    }
    return { error: "The invite was not sent. Please try again." };
  }

  // The profile row is created by a trigger; set role and company with the admin client.
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name,
      role,
      client_id: role === "client" ? (client_id ?? null) : null,
      modules: role === "member" ? modules : ALL_MODULES,
    })
    .eq("id", data.user.id);

  if (profileError) {
    console.error("inviteUser profile", profileError);
    revalidatePath("/dashboard/settings");
    return {
      error: `The invite was sent to ${email}, but the role was not saved. Change the role in the list below.`,
    };
  }

  revalidatePath("/dashboard/settings");
  return { ok: true, message: `Invite sent to ${email}.` };
}

const modulesSchema = z.object({ user_id: z.guid({ error: "User not found" }) });

/** Who sees what (2.5): the modules of one team member. Admins only. */
export async function updateUserModules(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = modulesSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "User not found." };
  const modules = formData.getAll("modules").filter(isPortalModule);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_profile_modules", {
    p_user_id: parsed.data.user_id,
    p_modules: modules,
  });
  if (error) {
    console.error("updateUserModules", error);
    return { error: error.message || GENERIC_ERROR };
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true, message: modules.length === 0 ? "Saved. This member now only sees tasks and the task tool." : "Saved." };
}

const bookingSchema = z.object({
  booking_url: z
    .url({ protocol: /^https$/, error: "Enter the full https link of your Cal.com event" })
    .max(500, { error: "At most 500 characters" })
    .optional(),
});

/** The Cal.com booking link of the signed-in interviewer (2.14). */
export async function updateBookingUrl(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireStaff();
  const parsed = bookingSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the booking link.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  // The column grant allows users to set booking_url on their own row only.
  const { error } = await supabase
    .from("profiles")
    .update({ booking_url: parsed.data.booking_url ?? null })
    .eq("id", user.id);
  if (error) {
    console.error("updateBookingUrl", error);
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/settings");
  return {
    ok: true,
    message: parsed.data.booking_url ? "Your booking link has been saved." : "Your booking link has been removed.",
  };
}

const setPasswordSchema = z.object({ user_id: z.guid({ error: "User not found" }) });

/**
 * Admin only: sets a new password for another user, for example to hand
 * out an account without an invite mail. The user can change it later in
 * their own settings. Other sessions of that user stay signed in.
 */
export async function setUserPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  const target = setPasswordSchema.safeParse(formValues(formData));
  if (!target.success) return { error: "User not found." };
  const parsed = passwordSchema.safeParse(passwordValues(formData));
  if (!parsed.success) {
    return { error: "Check the new password.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  if (target.data.user_id === me.id) {
    return { error: "Change your own password on the Settings page." };
  }

  const admin = createAdminClient();
  if (!admin) {
    return {
      error:
        "Setting a password only works once SUPABASE_SECRET_KEY is set on the server. Until then, use the Supabase dashboard.",
    };
  }

  const { error } = await admin.auth.admin.updateUserById(target.data.user_id, {
    password: parsed.data.password,
    // An invited user who never opened the mail can sign in right away.
    email_confirm: true,
  });
  if (error) {
    console.error("setUserPassword", error.code, error.message);
    if (error.code === "user_not_found") return { error: "User not found." };
    if (error.code === "weak_password") {
      return { error: "This password is too weak. Generate one or choose a longer password." };
    }
    return { error: GENERIC_ERROR };
  }

  revalidatePath(`/dashboard/settings/users/${target.data.user_id}`);
  return { ok: true, message: "The password has been set. Share it with the user through a safe channel." };
}
