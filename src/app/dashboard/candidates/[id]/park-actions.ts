"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { isUuid } from "@/lib/data/candidates";
import { isExitStage } from "@/lib/recruitment/pipeline";
import { createClient } from "@/lib/supabase/server";

const parkSchema = z.object({
  candidate_id: z.string().refine(isUuid, { error: "Candidate not found." }),
  park_reason: z.string().trim().max(2000, { error: "This reason is too long." }).optional(),
  park_until: z.iso.date({ error: "Choose a valid date." }).optional(),
  /** "on": also park every active application of this candidate. */
  park_applications: z.literal("on").optional(),
});

/**
 * Park a candidate (status Parked with a reason). Optionally parks their
 * active applications too, per vacancy through move_applications(), so each
 * board shows the card under Parked with the stage it left.
 */
export async function parkCandidate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = parkSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const { candidate_id, park_reason, park_until, park_applications } = parsed.data;

  const supabase = await createClient();
  let parkedApplications = 0;
  const vacancyIds = new Set<string>();

  if (park_applications) {
    const { data: applications, error } = await supabase
      .from("applications")
      .select("id, vacancy_id, stage")
      .eq("candidate_id", candidate_id);
    if (error) return { error: GENERIC_ERROR };

    const byVacancy = new Map<string, string[]>();
    for (const a of applications) {
      if (isExitStage(a.stage) || a.stage === "placed") continue;
      byVacancy.set(a.vacancy_id, [...(byVacancy.get(a.vacancy_id) ?? []), a.id]);
    }
    for (const [vacancyId, ids] of byVacancy) {
      const { data: moved, error: moveError } = await supabase.rpc("move_applications", {
        p_application_ids: ids,
        p_stage: "parked",
        p_reason: park_reason ?? null,
        p_park_until: park_until ?? null,
      });
      if (moveError) return { error: "Parking the applications failed. Please try again." };
      parkedApplications += moved ?? 0;
      vacancyIds.add(vacancyId);
    }
  }

  // Last, so the pipeline triggers do not set the status back.
  const { data, error } = await supabase
    .from("candidates")
    .update({ status: "parked", park_reason: park_reason ?? null })
    .eq("id", candidate_id)
    .select("id")
    .maybeSingle();
  if (error) return { error: GENERIC_ERROR };
  if (!data) return { error: "Candidate not found." };

  revalidatePath(`/dashboard/candidates/${candidate_id}`);
  revalidatePath("/dashboard/candidates");
  for (const id of vacancyIds) revalidatePath(`/dashboard/vacancies/${id}/pipeline`);
  return {
    ok: true,
    message:
      parkedApplications > 0
        ? `Candidate parked, with ${parkedApplications} ${parkedApplications === 1 ? "application" : "applications"}.`
        : "Candidate parked.",
  };
}

/**
 * Take the park off a candidate. The status follows the pipeline again:
 * in process with an active application, available otherwise. Parked
 * applications stay parked; resume them on their board.
 */
export async function unparkCandidate(candidateId: string): Promise<ActionState> {
  await requireStaff();
  if (!isUuid(candidateId)) return { error: "Candidate not found." };
  const supabase = await createClient();

  const { data: applications, error: loadError } = await supabase
    .from("applications")
    .select("stage")
    .eq("candidate_id", candidateId);
  if (loadError) return { error: GENERIC_ERROR };
  const status = applications.some((a) => a.stage === "placed")
    ? "placed"
    : applications.some((a) => !isExitStage(a.stage))
      ? "in_process"
      : "available";

  const { error } = await supabase.from("candidates").update({ status }).eq("id", candidateId).eq("status", "parked");
  if (error) return { error: GENERIC_ERROR };
  revalidatePath(`/dashboard/candidates/${candidateId}`);
  revalidatePath("/dashboard/candidates");
  return { ok: true, message: "Candidate is no longer parked." };
}
