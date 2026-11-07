"use server";

import { redirect } from "next/navigation";
import { type ActionState, fieldErrorsFrom } from "@/lib/action-state";
import { getCurrentUser, homePathFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  passwordErrorMessage,
  passwordSchema,
  passwordValues,
} from "@/components/settings/password-schema";

/** Sets the password for an invited user or after a recovery link. */
export async function setPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Redirects to /login when the invite or recovery session is missing.
  const user = await getCurrentUser();

  const parsed = passwordSchema.safeParse(passwordValues(formData));
  if (!parsed.success) {
    return { error: "Controleer je wachtwoord.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("setPassword", error.code, error.message);
    return { error: passwordErrorMessage(error.code) };
  }

  redirect(homePathFor(user));
}
