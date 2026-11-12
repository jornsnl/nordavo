"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { isDialTemplate } from "@/lib/sales/telephony";
import { createClient } from "@/lib/supabase/server";

/**
 * How the call buttons dial for the signed-in person (feedback Julius,
 * b6942cdc): empty is a tel: link (the phone or softphone of the device),
 * else a link of their own phone system with {number}. Team members and
 * external callers set their own; the column grant allows only their row.
 */
export async function updateDialTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!["admin", "member", "caller"].includes(user.role)) return { error: "Not available for this account." };
  const raw = String(formData.get("dial_template") ?? "").trim();
  if (raw && !isDialTemplate(raw)) {
    return {
      error: "Check the link.",
      fieldErrors: { dial_template: "Start with https:// (or tel:, sip:, callto:) and put {number} where the number goes." },
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ dial_template: raw || null }).eq("id", user.id);
  if (error) {
    console.error("updateDialTemplate", error.message);
    return { error: /dial_template/.test(error.message) ? "Apply the latest database migrations first." : "The setting could not be saved." };
  }
  revalidatePath("/dashboard/settings");
  revalidatePath("/caller");
  return { ok: true, message: raw ? "Calls now go through your phone system." : "Calls now open the phone app (tel: link)." };
}
