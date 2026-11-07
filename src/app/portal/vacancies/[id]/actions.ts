"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const reviewSchema = z.object({
  applicationId: z.guid("Unknown candidate."),
  decision: z.enum(["approved", "rejected"], "Choose approve or reject."),
  feedback: z.string().max(2000, "Keep your feedback under 2,000 characters.").optional(),
});

/** Client approves or rejects a presented candidate, only through the RPC. */
export async function reviewApplication(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireClient();

  const parsed = reviewSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    const fieldErrors = fieldErrorsFrom(parsed.error);
    return { error: fieldErrors.decision ?? fieldErrors.applicationId ?? "Check your input.", fieldErrors };
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
      error: /Candidate not found|Kandidaat niet gevonden/.test(error.message)
        ? "You can no longer change your response to this candidate. Contact us if you want to change something."
        : GENERIC_ERROR,
    };
  }

  revalidatePath("/portal", "layout");
  return {
    ok: true,
    message:
      decision === "approved"
        ? "Thank you. We will contact you to schedule the final interviews."
        : "Thank you for your feedback. We take it into account in our selection.",
  };
}
