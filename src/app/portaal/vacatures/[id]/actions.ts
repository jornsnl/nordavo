"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const reviewSchema = z.object({
  applicationId: z.guid("Onbekende kandidaat."),
  decision: z.enum(["approved", "rejected"], "Kies akkoord of afwijzen."),
  feedback: z.string().max(2000, "Houd je feedback onder de 2000 tekens.").optional(),
});

/** Client approves or rejects a presented candidate, only through the RPC. */
export async function reviewApplication(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireClient();

  const parsed = reviewSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    const fieldErrors = fieldErrorsFrom(parsed.error);
    return { error: fieldErrors.decision ?? fieldErrors.applicationId ?? "Controleer je invoer.", fieldErrors };
  }

  const { applicationId, decision, feedback } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_review_application", {
    p_application_id: applicationId,
    p_decision: decision,
    p_feedback: feedback ?? "",
  });

  if (error) {
    return {
      error: error.message.includes("Kandidaat niet gevonden")
        ? "Je kunt je reactie op deze kandidaat niet meer aanpassen. Neem contact met ons op als je iets wilt wijzigen."
        : GENERIC_ERROR,
    };
  }

  revalidatePath("/portaal", "layout");
  return {
    ok: true,
    message:
      decision === "approved"
        ? "Dank je. We nemen contact met je op om de eindgesprekken te plannen."
        : "Dank je voor je feedback. Die nemen we mee in onze selectie.",
  };
}
