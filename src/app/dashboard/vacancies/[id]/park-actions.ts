"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { isUuid } from "@/lib/data/candidates";
import { todayIso } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const holdSchema = z
  .object({
    vacancy_id: z.string().refine(isUuid, { error: "Vacancy not found." }),
    park_reason: z
      .string({ error: "Give the reason the vacancy is on hold." })
      .trim()
      .min(3, { error: "Give the reason the vacancy is on hold." })
      .max(2000, { error: "This reason is too long." }),
    hold_start: z.iso.date({ error: "Choose a valid date." }).optional(),
    // Optional: park the company in the sales pipeline too, until this date.
    park_company_until: z.iso.date({ error: "Choose a valid date." }).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.hold_start && data.hold_start > todayIso()) {
      ctx.addIssue({ code: "custom", path: ["hold_start"], message: "The start date cannot be in the future." });
    }
    if (data.park_company_until && data.park_company_until <= todayIso()) {
      ctx.addIssue({ code: "custom", path: ["park_company_until"], message: "Choose a date after today." });
    }
  });

function revalidateVacancy(id: string) {
  revalidatePath(`/dashboard/vacancies/${id}`);
  revalidatePath(`/dashboard/vacancies/${id}/pipeline`);
  revalidatePath("/dashboard/vacancies");
  revalidatePath("/dashboard");
}

/**
 * Put a vacancy on hold: status on_hold with a required reason and a start
 * date. The database records the period in vacancy_holds; days open and
 * lead time stand still until it resumes.
 */
export async function parkVacancy(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = holdSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const { vacancy_id, park_reason, hold_start, park_company_until } = parsed.data;

  const supabase = await createClient();
  const parkedAt = !hold_start || hold_start === todayIso() ? new Date().toISOString() : `${hold_start}T12:00:00+01:00`;
  const { data, error } = await supabase
    .from("vacancies")
    .update({ status: "on_hold", park_reason, parked_at: parkedAt })
    .eq("id", vacancy_id)
    .eq("status", "open")
    .select("id, company_id, client_id")
    .maybeSingle();
  if (error) return { error: GENERIC_ERROR };
  if (!data) return { error: "Only open vacancies can be put on hold." };

  let warning: string | undefined;
  if (park_company_until) {
    // The sales pipeline stage Parked needs a date to get in touch again.
    let companyId = data.company_id;
    if (!companyId && data.client_id) {
      const { data: company } = await supabase.from("companies").select("id").eq("client_id", data.client_id).limit(1).maybeSingle();
      companyId = company?.id ?? null;
    }
    if (companyId) {
      const { error: parkError } = await supabase
        .from("companies")
        .update({ pipeline_stage: "parked", parked_until: park_company_until })
        .eq("id", companyId);
      if (parkError) warning = " The company could not be parked in the sales pipeline (Sales rights needed).";
      else revalidatePath(`/dashboard/leads/${companyId}`);
    } else {
      warning = " This vacancy has no company in the sales pipeline.";
    }
  }
  revalidateVacancy(data.id);
  return { ok: true, message: `Vacancy on hold. The clock stands still.${warning ?? ""}` };
}

/** Change the reason while on hold. */
export async function updateHoldReason(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = holdSchema.pick({ vacancy_id: true, park_reason: true }).safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vacancies")
    .update({ park_reason: parsed.data.park_reason })
    .eq("id", parsed.data.vacancy_id)
    .eq("status", "on_hold")
    .select("id")
    .maybeSingle();
  if (error) return { error: GENERIC_ERROR };
  if (!data) return { error: "This vacancy is not on hold." };
  revalidateVacancy(data.id);
  return { ok: true, message: "Reason saved." };
}

/** Resume a vacancy on hold: open again, the clock runs again and the date is recorded. */
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
  if (!data) return { error: "This vacancy is not on hold." };
  revalidateVacancy(vacancyId);
  return { ok: true, message: "Vacancy resumed. The clock runs again from today." };
}
