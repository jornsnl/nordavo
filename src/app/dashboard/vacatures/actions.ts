"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import {
  fieldErrorsFrom,
  formValues,
  GENERIC_ERROR,
  parseList,
  type ActionState,
} from "@/lib/action-state";
import type { VacancyStatus } from "@/lib/database.types";
import { todayIso } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.guid();

const vacancySchema = z.object({
  client_id: z.guid({ error: "Kies een klant." }),
  title: z
    .string({ error: "Vul een functietitel in." })
    .min(1, "Vul een functietitel in.")
    .max(200, "Gebruik maximaal 200 tekens."),
  description: z.string().max(20000, "Dit profiel is te lang.").optional(),
  stack: z.string().max(1000, "Gebruik maximaal 1000 tekens.").optional(),
  seniority: z.enum(["medior", "senior", "lead"], { error: "Kies een senioriteit." }),
  status: z.enum(["open", "on_hold", "filled", "closed"], { error: "Kies een status." }),
  monthly_budget: z
    .string()
    .regex(/^\d{1,8}([.,]\d{1,2})?$/, "Vul een bedrag in euro in, bijvoorbeeld 4500.")
    .transform((value) => Number(value.replace(",", ".")))
    .optional(),
  desired_start_date: z.iso.date({ error: "Kies een geldige datum." }).optional(),
  owner_id: z.guid({ error: "Kies een teamlid." }).optional(),
});

const CLOSED: VacancyStatus[] = ["filled", "closed"];

function toRow(data: z.infer<typeof vacancySchema>) {
  return {
    client_id: data.client_id,
    title: data.title,
    description: data.description ?? null,
    stack: parseList(data.stack),
    seniority: data.seniority,
    status: data.status,
    monthly_budget: data.monthly_budget ?? null,
    desired_start_date: data.desired_start_date ?? null,
    owner_id: data.owner_id ?? null,
  };
}

function invalid(error: z.ZodError): ActionState {
  return { error: "Controleer de gemarkeerde velden.", fieldErrors: fieldErrorsFrom(error) };
}

export async function createVacancyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const parsed = vacancySchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  const row = toRow(parsed.data);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vacancies")
    .insert({ ...row, closed_at: CLOSED.includes(row.status) ? todayIso() : null })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23503") return { fieldErrors: { client_id: "Deze klant bestaat niet meer." } };
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/vacatures");
  revalidatePath(`/dashboard/klanten/${row.client_id}`);
  redirect(`/dashboard/vacatures/${data.id}`);
}

export async function updateVacancyAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!idSchema.safeParse(id).success) return { error: GENERIC_ERROR };
  const parsed = vacancySchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("vacancies")
    .select("status, closed_at, client_id")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { error: GENERIC_ERROR };
  if (!current) return { error: "Deze vacature bestaat niet meer." };

  const row = toRow(parsed.data);
  // Closing sets closed_at to today, reopening clears it. Keep the original date otherwise.
  const closedAt = CLOSED.includes(row.status)
    ? CLOSED.includes(current.status) && current.closed_at
      ? current.closed_at
      : todayIso()
    : null;

  const { error } = await supabase
    .from("vacancies")
    .update({ ...row, closed_at: closedAt })
    .eq("id", id);
  if (error) {
    if (error.code === "23503") return { fieldErrors: { client_id: "Deze klant bestaat niet meer." } };
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/vacatures");
  revalidatePath(`/dashboard/vacatures/${id}`);
  revalidatePath(`/dashboard/klanten/${row.client_id}`);
  if (current.client_id !== row.client_id) revalidatePath(`/dashboard/klanten/${current.client_id}`);
  redirect(`/dashboard/vacatures/${id}`);
}

export async function deleteVacancyAction(
  id: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  void _formData;
  await requireStaff();
  if (!idSchema.safeParse(id).success) return { error: GENERIC_ERROR };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vacancies")
    .delete()
    .eq("id", id)
    .select("client_id")
    .maybeSingle();
  if (error) return { error: GENERIC_ERROR };

  revalidatePath("/dashboard/vacatures");
  if (data) revalidatePath(`/dashboard/klanten/${data.client_id}`);
  redirect("/dashboard/vacatures");
}
