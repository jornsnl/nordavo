"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { isUuid } from "@/lib/data/candidates";
import type { ApplicationStage, TablesUpdate } from "@/lib/database.types";
import { applicationStages } from "@/lib/labels";
import { PRESENTED_STAGES } from "@/components/pipeline/stages";
import { createClient } from "@/lib/supabase/server";
import { sendWspMailAfter } from "@/lib/wsp/after";

const stageValues = applicationStages.map((s) => s.value) as [ApplicationStage, ...ApplicationStage[]];

const moveSchema = z.object({
  applicationId: z.string().refine(isUuid),
  stage: z.enum(stageValues),
  position: z.number(),
  rejectionReason: z.string().trim().max(2000).optional(),
});

function revalidateBoard(vacancyId: string, candidateId: string) {
  revalidatePath(`/dashboard/vacancies/${vacancyId}/pipeline`);
  revalidatePath(`/dashboard/vacancies/${vacancyId}`);
  revalidatePath(`/dashboard/candidates/${candidateId}`);
  revalidatePath("/dashboard/candidates");
}

/**
 * Move a card to a stage and position. The position is a fractional index,
 * the midpoint between its new neighbours, computed by the board.
 */
export async function moveApplication(
  applicationId: string,
  stage: ApplicationStage,
  position: number,
  /** The reason for parking or rejecting. */
  rejectionReason?: string,
  /** Parking only: a date to look at the candidate again (YYYY-MM-DD). */
  parkUntil?: string,
): Promise<ActionState> {
  await requireStaff();

  const parsed = moveSchema.safeParse({ applicationId, stage, position, rejectionReason });
  if (parkUntil !== undefined && !z.iso.date().safeParse(parkUntil).success) {
    return { error: "Choose a valid date to look again." };
  }
  if (!parsed.success) return { error: "This move is not valid. Refresh the page." };

  const supabase = await createClient();
  const { data: current, error: loadError } = await supabase
    .from("applications")
    .select("stage, presented_at, vacancy_id, candidate_id")
    .eq("id", parsed.data.applicationId)
    .maybeSingle();

  if (loadError) return { error: GENERIC_ERROR };
  if (!current) return { error: "This candidate is no longer in the pipeline." };

  // Parking and rejecting go through move_applications(), which keeps the
  // reason, the look again date and the stage that was left together.
  if (parsed.data.stage === "parked" || parsed.data.stage === "rejected") {
    const { error } = await supabase.rpc("move_applications", {
      p_application_ids: [parsed.data.applicationId],
      p_stage: parsed.data.stage,
      p_reason: parsed.data.rejectionReason || null,
      p_park_until: parsed.data.stage === "parked" ? (parkUntil ?? null) : null,
    });
    if (error) return { error: "The move failed. Please try again." };
    revalidateBoard(current.vacancy_id, current.candidate_id);
    return { ok: true };
  }

  const update: TablesUpdate<"applications"> = {
    stage: parsed.data.stage,
    position: parsed.data.position,
  };
  if (PRESENTED_STAGES.includes(parsed.data.stage) && !current.presented_at) {
    update.presented_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("applications")
    .update(update)
    .eq("id", parsed.data.applicationId);
  if (error) return { error: "The move failed. Please try again." };

  sendWspMailAfter(); // a stage can be the Working Style Profile trigger
  revalidateBoard(current.vacancy_id, current.candidate_id);
  return { ok: true };
}

const notesSchema = z.object({
  id: z.string({ error: "Application not found." }).refine(isUuid, { error: "Application not found." }),
  assessment_notes: z.string().max(5000, { error: "These notes are too long." }).optional(),
  rejection_reason: z.string().max(2000, { error: "This reason is too long." }).optional(),
  park_reason: z.string().max(2000, { error: "This reason is too long." }).optional(),
});

/** General notes and the park or rejection reason, edited in the card modal. */
export async function updateApplication(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();

  const parsed = notesSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { id, ...input } = parsed.data;
  const update: TablesUpdate<"applications"> = { assessment_notes: input.assessment_notes ?? null };
  if (formData.has("rejection_reason")) update.rejection_reason = input.rejection_reason ?? null;
  if (formData.has("park_reason")) update.park_reason = input.park_reason ?? null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .update(update)
    .eq("id", id)
    .select("vacancy_id, candidate_id")
    .maybeSingle();

  if (error) return { error: GENERIC_ERROR };
  if (!data) return { error: "This candidate is no longer in the pipeline." };

  revalidateBoard(data.vacancy_id, data.candidate_id);
  return { ok: true, message: "Saved." };
}

/** Take a candidate off the board of this vacancy. The candidate itself stays. */
export async function removeApplication(applicationId: string): Promise<ActionState> {
  await requireStaff();
  if (!isUuid(applicationId)) return { error: "Application not found." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .delete()
    .eq("id", applicationId)
    .select("vacancy_id, candidate_id")
    .maybeSingle();

  if (error) return { error: GENERIC_ERROR };
  if (data) revalidateBoard(data.vacancy_id, data.candidate_id);
  return { ok: true, message: "Candidate removed from the pipeline." };
}

const reorderSchema = z.object({
  vacancyId: z.string().refine(isUuid),
  stage: z.enum(stageValues),
  orderedIds: z.array(z.string().refine(isUuid)).min(1).max(500),
});

/**
 * Renumber a whole column (1024, 2048, ...) when fractional positions have
 * run out of room between two neighbours.
 */
export async function reorderStage(
  vacancyId: string,
  stage: ApplicationStage,
  orderedIds: string[],
): Promise<ActionState> {
  await requireStaff();

  const parsed = reorderSchema.safeParse({ vacancyId, stage, orderedIds });
  if (!parsed.success) return { error: "This order is not valid. Refresh the page." };

  const supabase = await createClient();
  const results = await Promise.all(
    parsed.data.orderedIds.map((id, index) =>
      supabase
        .from("applications")
        .update({ position: (index + 1) * 1024 })
        .eq("id", id)
        .eq("vacancy_id", parsed.data.vacancyId)
        .eq("stage", parsed.data.stage),
    ),
  );
  if (results.some((r) => r.error)) return { error: "Saving the order failed." };

  revalidatePath(`/dashboard/vacancies/${parsed.data.vacancyId}/pipeline`);
  return { ok: true };
}
