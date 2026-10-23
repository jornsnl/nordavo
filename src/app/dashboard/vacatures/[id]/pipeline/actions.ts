"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { isUuid } from "@/lib/data/candidates";
import type { ApplicationStage, TablesUpdate } from "@/lib/database.types";
import { applicationStages } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

const stageValues = applicationStages.map((s) => s.value) as [ApplicationStage, ...ApplicationStage[]];

const moveSchema = z.object({
  applicationId: z.string().refine(isUuid),
  stage: z.enum(stageValues),
  position: z.number(),
  rejectionReason: z.string().trim().max(2000).optional(),
});

function revalidateBoard(vacancyId: string, candidateId: string) {
  revalidatePath(`/dashboard/vacatures/${vacancyId}/pipeline`);
  revalidatePath(`/dashboard/vacatures/${vacancyId}`);
  revalidatePath(`/dashboard/kandidaten/${candidateId}`);
  revalidatePath("/dashboard/kandidaten");
}

/**
 * Move a card to a stage and position. The position is a fractional index,
 * the midpoint between its new neighbours, computed by the board.
 */
export async function moveApplication(
  applicationId: string,
  stage: ApplicationStage,
  position: number,
  rejectionReason?: string,
): Promise<ActionState> {
  await requireStaff();

  const parsed = moveSchema.safeParse({ applicationId, stage, position, rejectionReason });
  if (!parsed.success) return { error: "Deze verplaatsing klopt niet. Ververs de pagina." };

  const supabase = await createClient();
  const { data: current, error: loadError } = await supabase
    .from("applications")
    .select("stage, presented_at, vacancy_id, candidate_id")
    .eq("id", parsed.data.applicationId)
    .maybeSingle();

  if (loadError) return { error: GENERIC_ERROR };
  if (!current) return { error: "Deze kandidaat staat niet meer in de pipeline." };

  const update: TablesUpdate<"applications"> = {
    stage: parsed.data.stage,
    position: parsed.data.position,
  };
  if (parsed.data.stage === "presented" && !current.presented_at) {
    update.presented_at = new Date().toISOString();
  }
  if (parsed.data.stage === "rejected" && parsed.data.rejectionReason) {
    update.rejection_reason = parsed.data.rejectionReason;
  }

  const { error } = await supabase
    .from("applications")
    .update(update)
    .eq("id", parsed.data.applicationId);
  if (error) return { error: "Verplaatsen is niet gelukt. Probeer het opnieuw." };

  revalidateBoard(current.vacancy_id, current.candidate_id);
  return { ok: true };
}

const score = z.coerce
  .number({ error: "Vul een getal van 0 tot 100 in." })
  .int({ error: "Vul een heel getal in." })
  .min(0, { error: "Minimaal 0." })
  .max(100, { error: "Maximaal 100." })
  .optional();

const assessmentSchema = z.object({
  id: z.string({ error: "Sollicitatie niet gevonden." }).refine(isUuid, { error: "Sollicitatie niet gevonden." }),
  technical_score: score,
  english_score: score,
  assessment_notes: z.string().max(5000, { error: "Deze notities zijn te lang." }).optional(),
  rejection_reason: z.string().max(2000, { error: "Deze reden is te lang." }).optional(),
});

/** Scores and notes from the assessment, edited in the card modal. */
export async function updateApplication(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();

  const parsed = assessmentSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Controleer de gemarkeerde velden.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { id, ...input } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .update({
      technical_score: input.technical_score ?? null,
      english_score: input.english_score ?? null,
      assessment_notes: input.assessment_notes ?? null,
      rejection_reason: input.rejection_reason ?? null,
    })
    .eq("id", id)
    .select("vacancy_id, candidate_id")
    .maybeSingle();

  if (error) return { error: GENERIC_ERROR };
  if (!data) return { error: "Deze kandidaat staat niet meer in de pipeline." };

  revalidateBoard(data.vacancy_id, data.candidate_id);
  return { ok: true, message: "Opgeslagen." };
}

/** Take a candidate off the board of this vacancy. The candidate itself stays. */
export async function removeApplication(applicationId: string): Promise<ActionState> {
  await requireStaff();
  if (!isUuid(applicationId)) return { error: "Sollicitatie niet gevonden." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .delete()
    .eq("id", applicationId)
    .select("vacancy_id, candidate_id")
    .maybeSingle();

  if (error) return { error: GENERIC_ERROR };
  if (data) revalidateBoard(data.vacancy_id, data.candidate_id);
  return { ok: true, message: "Kandidaat uit de pipeline gehaald." };
}
