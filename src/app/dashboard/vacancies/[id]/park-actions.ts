"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { isUuid } from "@/lib/data/candidates";
import { createClient } from "@/lib/supabase/server";

const parkSchema = z.object({
  vacancy_id: z.string().refine(isUuid, { error: "Vacancy not found." }),
  park_reason: z.string().trim().max(2000, { error: "This reason is too long." }).optional(),
});

function revalidateVacancy(id: string) {
  revalidatePath(`/dashboard/vacancies/${id}`);
  revalidatePath(`/dashboard/vacancies/${id}/pipeline`);
  revalidatePath("/dashboard/vacancies");
  revalidatePath("/dashboard");
}

/** Park a vacancy: status on hold (shown as Parked) with a reason. The date is set by the database. */
export async function parkVacancy(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = parkSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vacancies")
    .update({ status: "on_hold", park_reason: parsed.data.park_reason ?? null })
    .eq("id", parsed.data.vacancy_id)
    .in("status", ["open", "on_hold"])
    .select("id")
    .maybeSingle();
  if (error) return { error: GENERIC_ERROR };
  if (!data) return { error: "Only open vacancies can be parked." };
  revalidateVacancy(data.id);
  return { ok: true, message: "Vacancy parked." };
}

/** Open a parked vacancy again. */
export async function unparkVacancy(vacancyId: string): Promise<ActionState> {
  await requireStaff();
  if (!isUuid(vacancyId)) return { error: "Vacancy not found." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vacancies")
    .update({ status: "open" })
    .eq("id", vacancyId)
    .eq("status", "on_hold")
    .select("id")
    .maybeSingle();
  if (error) return { error: GENERIC_ERROR };
  if (!data) return { error: "This vacancy is not parked." };
  revalidateVacancy(vacancyId);
  return { ok: true, message: "Vacancy is open again." };
}
