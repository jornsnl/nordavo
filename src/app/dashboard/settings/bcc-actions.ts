"use server";

import { revalidatePath } from "next/cache";
import { type ActionState, GENERIC_ERROR } from "@/lib/action-state";
import { hasModule, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Replace the BCC logging address of the signed in user (docs/mail.md). Mail
 * to the old address is ignored from now on (status unknown_address).
 */
export async function regenerateBccAddress(): Promise<ActionState> {
  const user = await requireStaff();
  if (!hasModule(user, "sales")) return { error: "BCC logging is part of the Sales module." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mail_bcc_token", { p_regenerate: true });
  if (error) {
    console.error("regenerateBccAddress", error);
    return { error: GENERIC_ERROR };
  }
  revalidatePath("/dashboard/settings");
  return { ok: true, message: "You have a new BCC address. The old one no longer works." };
}
