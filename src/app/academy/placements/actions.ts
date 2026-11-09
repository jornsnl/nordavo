"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import type { Json } from "@/lib/database.types";
import { requireAcademyUser } from "@/lib/academy/auth";
import { t } from "@/lib/academy/i18n";
import { workingDays } from "@/lib/academy/placement/leave";
import { parseReviewAnswers } from "@/lib/academy/placement/timeline";
import { daysBetweenIso } from "@/lib/academy/time";
import { createClient } from "@/lib/supabase/server";

// Learner actions of the placement page. Every one re-checks the user; the
// database decides the rest (who may tick which ritual, leave only for the
// developer, reviews only for client contacts and the developer, pulse only
// your own).

const guid = z.guid();
const dateIso = z.iso.date();

function refresh(placementId: string) {
  revalidatePath(`/academy/placements/${placementId}`);
  revalidatePath("/academy");
}

/** One click on a ritual: tick or untick it for its period. */
export async function tickRitual(input: { ritualId: string; placementId: string; periodDate: string; done: boolean }): Promise<{ ok: boolean }> {
  await requireAcademyUser();
  if (!guid.safeParse(input.ritualId).success || !guid.safeParse(input.placementId).success || !dateIso.safeParse(input.periodDate).success) {
    return { ok: false };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("academy_tick_ritual", {
    p_ritual_id: input.ritualId,
    p_period_date: input.periodDate,
    p_done: input.done,
  });
  if (error) {
    console.error("tickRitual", error.code, error.message);
    return { ok: false };
  }
  refresh(input.placementId);
  return { ok: true };
}

const leaveSchema = z
  .object({
    kind: z.enum(["vacation", "sick", "unpaid", "other"]),
    start_date: dateIso,
    end_date: dateIso,
    note: z.string().max(2000).optional(),
  })
  .refine((v) => v.end_date >= v.start_date);

/** The developer asks for leave. Working days skip weekends and Indian holidays. */
export async function requestLeave(placementId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAcademyUser();
  const fail = { error: t(user.locale, "leave.failed") };
  if (!guid.safeParse(placementId).success || !user.member) return fail;
  const parsed = leaveSchema.safeParse({
    kind: formData.get("kind"),
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  if (!parsed.success) return fail;
  const { kind, start_date, end_date, note } = parsed.data;
  if (daysBetweenIso(start_date, end_date) > 90) return fail;

  const supabase = await createClient();
  const { data: holidays } = await supabase
    .from("academy_holidays")
    .select("date")
    .eq("country", "IN")
    .eq("day_off", true)
    .gte("date", start_date)
    .lte("date", end_date);
  const days = workingDays(start_date, end_date, (holidays ?? []).map((h) => h.date));
  if (days === 0) return fail;

  const { error } = await supabase.from("academy_leave_requests").insert({
    placement_id: placementId,
    profile_id: user.id,
    kind,
    start_date,
    end_date,
    days,
    note: note ?? null,
  });
  if (error) {
    console.error("requestLeave", error.code, error.message);
    return fail;
  }
  refresh(placementId);
  return { ok: true, message: t(user.locale, "leave.sent") };
}

export async function cancelLeave(placementId: string, requestId: string): Promise<ActionState> {
  const user = await requireAcademyUser();
  if (!guid.safeParse(placementId).success || !guid.safeParse(requestId).success) return { error: t(user.locale, "error.generic") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_cancel_leave", { p_request_id: requestId });
  if (error || !data) return { error: t(user.locale, "error.generic") };
  refresh(placementId);
  return { ok: true };
}

/** The review form of a moment: save as draft or submit (final). */
export async function saveReview(
  input: { placementId: string; milestoneId: string; answers: Record<string, unknown>; submit: boolean },
): Promise<ActionState> {
  const user = await requireAcademyUser();
  const fail = { error: t(user.locale, "review.failed") };
  if (!guid.safeParse(input.placementId).success || !guid.safeParse(input.milestoneId).success || !user.member) return fail;
  const answers = parseReviewAnswers(input.answers);
  if (input.submit && !answers.rating) return { error: t(user.locale, "review.ratingRequired") };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("academy_reviews")
    .select("id, status")
    .eq("milestone_id", input.milestoneId)
    .eq("author_id", user.id)
    .eq("kind", "form")
    .maybeSingle();
  if (existing?.status === "submitted") return fail;
  const values = { answers: answers as Json, status: input.submit ? ("submitted" as const) : ("draft" as const) };
  const { error } = existing
    ? await supabase.from("academy_reviews").update(values).eq("id", existing.id)
    : await supabase
        .from("academy_reviews")
        .insert({ ...values, milestone_id: input.milestoneId, placement_id: input.placementId, author_id: user.id, kind: "form" });
  if (error) {
    console.error("saveReview", error.code, error.message);
    return fail;
  }
  refresh(input.placementId);
  return { ok: true, message: t(user.locale, input.submit ? "review.submitted" : "review.saved") };
}

const pulseSchema = z.object({
  score: z.coerce.number().int().min(1).max(10),
  going_well: z.string().max(5000).optional(),
  friction: z.string().max(5000).optional(),
});

/** Answer the own pulse. The database flags low or dropping scores and tells Nordavo. */
export async function answerPulse(placementId: string, pulseId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAcademyUser();
  if (!guid.safeParse(placementId).success || !guid.safeParse(pulseId).success) return { error: t(user.locale, "pulse.failed") };
  const parsed = pulseSchema.safeParse({
    score: formData.get("score"),
    going_well: String(formData.get("going_well") ?? "").trim() || undefined,
    friction: String(formData.get("friction") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: t(user.locale, "pulse.scoreRequired") };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_pulse_answers").insert({
    pulse_id: pulseId,
    score: parsed.data.score,
    going_well: parsed.data.going_well ?? null,
    friction: parsed.data.friction ?? null,
  });
  if (error) {
    console.error("answerPulse", error.code, error.message);
    return { error: t(user.locale, "pulse.failed") };
  }
  refresh(placementId);
  return { ok: true, message: t(user.locale, "pulse.thanks") };
}
