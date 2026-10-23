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
    .string({ error: "Vul je naam in" })
    .min(2, { error: "Vul je naam in" })
    .max(120, { error: "Maximaal 120 tekens" }),
});

export async function updateOwnProfile(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireStaff();
  const parsed = profileSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Controleer je naam.", fieldErrors: fieldErrorsFrom(parsed.error) };
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
  return { ok: true, message: "Je naam is opgeslagen." };
}

export async function changePassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const parsed = passwordSchema.safeParse(passwordValues(formData));
  if (!parsed.success) {
    return { error: "Controleer je nieuwe wachtwoord.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("changePassword", error.code, error.message);
    return { error: passwordErrorMessage(error.code) };
  }

  return { ok: true, message: "Je wachtwoord is gewijzigd." };
}

const roleSchema = z
  .object({
    user_id: z.uuid({ error: "Gebruiker niet gevonden" }),
    role: z.enum(["admin", "member", "client"], { error: "Kies een rol" }),
    client_id: z.uuid({ error: "Kies een klant" }).optional(),
  })
  .refine((v) => v.role !== "client" || v.client_id, {
    error: "Kies de klant waar dit account bij hoort",
    path: ["client_id"],
  });

export async function updateUserRole(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = roleSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Controleer de rol.", fieldErrors: fieldErrorsFrom(parsed.error) };
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

  revalidatePath("/dashboard/instellingen");
  return { ok: true, message: "Opgeslagen." };
}

const inviteSchema = z
  .object({
    email: z.email({ error: "Vul een geldig e-mailadres in" }),
    full_name: z
      .string({ error: "Vul een naam in" })
      .min(2, { error: "Vul een naam in" })
      .max(120, { error: "Maximaal 120 tekens" }),
    role: z.enum(["admin", "member", "client"], { error: "Kies een rol" }),
    client_id: z.uuid({ error: "Kies een klant" }).optional(),
  })
  .refine((v) => v.role !== "client" || v.client_id, {
    error: "Kies de klant waar dit account bij hoort",
    path: ["client_id"],
  });

export async function inviteUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = inviteSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Controleer de gemarkeerde velden.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const admin = createAdminClient();
  if (!admin) {
    return {
      error:
        "Uitnodigen kan pas als SUPABASE_SECRET_KEY op de server is ingesteld. Nodig de gebruiker tot die tijd uit via het Supabase dashboard.",
    };
  }

  const { email, full_name, role, client_id } = parsed.data;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email.toLowerCase(), {
    data: { full_name },
    redirectTo: `${env.siteUrl()}/auth/confirm?next=/auth/wachtwoord`,
  });

  if (error || !data.user) {
    console.error("inviteUser", error?.code, error?.message);
    if (error?.code === "email_exists" || error?.status === 422) {
      return {
        error: "Er bestaat al een account met dit e-mailadres.",
        fieldErrors: { email: "Dit e-mailadres heeft al een account" },
      };
    }
    return { error: "De uitnodiging is niet verstuurd. Probeer het opnieuw." };
  }

  // The profile row is created by a trigger; set role and company with the admin client.
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name,
      role,
      client_id: role === "client" ? (client_id ?? null) : null,
    })
    .eq("id", data.user.id);

  if (profileError) {
    console.error("inviteUser profile", profileError);
    revalidatePath("/dashboard/instellingen");
    return {
      error: `De uitnodiging is verstuurd naar ${email}, maar de rol is niet opgeslagen. Pas de rol aan in de lijst hieronder.`,
    };
  }

  revalidatePath("/dashboard/instellingen");
  return { ok: true, message: `Uitnodiging verstuurd naar ${email}.` };
}
