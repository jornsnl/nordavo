"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formValues, GENERIC_ERROR, type ActionState } from "@/lib/action-state";
import { requireModule } from "@/lib/auth";
import { applyFromSuggestion, parseSuggestion } from "@/lib/sales/replies";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.guid();

function refresh() {
  revalidatePath("/dashboard/leads/replies");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/leads/[id]", "page");
}

function friendly(message: string) {
  if (message.includes("not waiting for review")) return "This reply was already handled.";
  if (message.includes("lost")) return "Give a reason when the company is lost.";
  return GENERIC_ERROR;
}

/** One click: apply Claude's suggestion as it is. */
export async function acceptReplyAction(activityId: string): Promise<ActionState> {
  await requireModule("sales");
  if (!idSchema.safeParse(activityId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: row, error: loadError } = await supabase
    .from("activities")
    .select("suggestion, review_status")
    .eq("id", activityId)
    .maybeSingle();
  if (loadError || !row) return { error: GENERIC_ERROR };
  if (row.review_status !== "pending") return { error: "This reply was already handled." };
  const { error } = await supabase.rpc("sales_decide_reply", {
    p_activity: activityId,
    p_accept: true,
    p_apply: applyFromSuggestion(parseSuggestion(row.suggestion)),
  });
  if (error) return { error: friendly(error.message) };
  refresh();
  return { ok: true, message: "Accepted." };
}

export async function rejectReplyAction(activityId: string): Promise<ActionState> {
  await requireModule("sales");
  if (!idSchema.safeParse(activityId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sales_decide_reply", { p_activity: activityId, p_accept: false, p_apply: {} });
  if (error) return { error: friendly(error.message) };
  refresh();
  return { ok: true, message: "Rejected. Nothing was changed on the company." };
}

const otherSchema = z
  .object({
    outcome: z.enum(["reply_positief", "reply_neutraal", "reply_negatief", "afgemeld"], { error: "Choose what the reply means." }),
    lead_status: z.enum(["new", "review", "ready", "enrich", "in_sequence", "cooled_down", "no_go", "do_not_contact"]).optional(),
    pipeline_stage: z
      .enum([
        "contact",
        "interested",
        "meeting_planned",
        "meeting_held",
        "vacancy_drafted",
        "agreed_paid",
        "profiles_sent",
        "candidate_interviews",
        "won",
        "lost",
      ])
      .optional(),
    lost_reason: z.string().max(2000, "Use at most 2000 characters.").optional(),
  })
  .refine((v) => v.pipeline_stage !== "lost" || Boolean(v.lost_reason), {
    message: "Give a reason when the company is lost.",
    path: ["lost_reason"],
  });

/** Accept the reply with another outcome, lead status or stage than Claude proposed. */
export async function acceptWithOutcomeAction(activityId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireModule("sales");
  if (!idSchema.safeParse(activityId).success) return { error: GENERIC_ERROR };
  const parsed = otherSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? GENERIC_ERROR, fieldErrors: first ? { [first.path.join(".")]: first.message } : undefined };
  }
  const apply = applyFromSuggestion(parsed.data);
  // An unsubscribe means the contact may not be approached again.
  if (parsed.data.outcome === "afgemeld") apply.contact_status = "do_not_contact";
  const supabase = await createClient();
  const { error } = await supabase.rpc("sales_decide_reply", { p_activity: activityId, p_accept: true, p_apply: apply });
  if (error) return { error: friendly(error.message) };
  refresh();
  return { ok: true, message: "Accepted with your outcome." };
}
