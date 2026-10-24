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

const amount = z
  .string()
  .regex(/^\d{1,8}([.,]\d{1,2})?$/, "Vul een bedrag in euro in, bijvoorbeeld 4500.")
  .transform((value) => Number(value.replace(",", ".")));

const vacancySchema = z
  .object({
    owner_type: z.enum(["client", "company"], { error: "Kies een klant of een prospect." }),
    client_id: z.guid({ error: "Kies een klant." }).optional(),
    company_id: z.guid({ error: "Kies een bedrijf." }).optional(),
    title: z
      .string({ error: "Vul een functietitel in." })
      .min(1, "Vul een functietitel in.")
      .max(200, "Gebruik maximaal 200 tekens."),
    description: z.string().max(20000, "Dit profiel is te lang.").optional(),
    stack: z.string().max(1000, "Gebruik maximaal 1000 tekens.").optional(),
    seniority: z.enum(["medior", "senior", "lead"], { error: "Kies een senioriteit." }),
    status: z.enum(["open", "on_hold", "filled", "closed"], { error: "Kies een status." }),
    talent_stage: z.enum(["intake", "zoeken", "profielen_verstuurd", "gesprekken", "geplaatst", "gesloten"], {
      error: "Kies een fase.",
    }),
    source: z.enum(["klant_eigen", "samen_opgesteld", "gescrapet"], { error: "Kies een bron." }).optional(),
    onepage_deal_id: z
      .string()
      .max(100, "Gebruik maximaal 100 tekens.")
      .regex(/^[\w-]+$/, "Plak alleen de deal-id uit OnePageCRM, zonder spaties.")
      .optional(),
    monthly_budget: amount.optional(),
    budget_min: amount.optional(),
    budget_max: amount.optional(),
    hours: z.coerce
      .number({ error: "Vul een aantal uren in." })
      .int("Gebruik hele uren.")
      .min(1, "Minimaal 1 uur.")
      .max(60, "Maximaal 60 uur.")
      .optional(),
    timezone_overlap: z.string().max(300, "Gebruik maximaal 300 tekens.").optional(),
    client_contact_required: z.enum(["ja", "nee"]).optional(),
    must_haves: z.string().max(4000, "Dit is te lang.").optional(),
    nice_to_haves: z.string().max(4000, "Dit is te lang.").optional(),
    unclear: z.string().max(4000, "Dit is te lang.").optional(),
    desired_start_date: z.iso.date({ error: "Kies een geldige datum." }).optional(),
    owner_id: z.guid({ error: "Kies een teamlid." }).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.owner_type === "client" && !data.client_id) {
      ctx.addIssue({ code: "custom", path: ["client_id"], message: "Kies een klant." });
    }
    if (data.owner_type === "company" && !data.company_id) {
      ctx.addIssue({ code: "custom", path: ["company_id"], message: "Kies een bedrijf." });
    }
    if (data.budget_min !== undefined && data.budget_max !== undefined && data.budget_min > data.budget_max) {
      ctx.addIssue({ code: "custom", path: ["budget_max"], message: "Het maximum is lager dan het minimum." });
    }
  });

const CLOSED: VacancyStatus[] = ["filled", "closed"];

/** One item per line; commas stay inside an item ("Python, bij voorkeur 3.11"). */
function parseLines(value: string | undefined) {
  if (!value) return [];
  return value
    .split("\n")
    .map((line) => line.replace(/^[\s*\-\u2022]+/, "").trim())
    .filter(Boolean);
}

function toRow(data: z.infer<typeof vacancySchema>) {
  const isClient = data.owner_type === "client";
  return {
    client_id: isClient ? (data.client_id ?? null) : null,
    company_id: isClient ? null : (data.company_id ?? null),
    title: data.title,
    description: data.description ?? null,
    stack: parseList(data.stack),
    seniority: data.seniority,
    status: data.status,
    talent_stage: data.talent_stage,
    source: data.source ?? null,
    onepage_deal_id: data.onepage_deal_id ?? null,
    monthly_budget: data.monthly_budget ?? null,
    budget_min: data.budget_min ?? null,
    budget_max: data.budget_max ?? null,
    hours: data.hours ?? null,
    timezone_overlap: data.timezone_overlap ?? null,
    client_contact_required: data.client_contact_required ? data.client_contact_required === "ja" : null,
    must_haves: parseLines(data.must_haves),
    nice_to_haves: parseLines(data.nice_to_haves),
    unclear: parseLines(data.unclear),
    desired_start_date: data.desired_start_date ?? null,
    owner_id: data.owner_id ?? null,
  };
}

function revalidateOwners(row: { client_id: string | null; company_id: string | null }) {
  if (row.client_id) revalidatePath(`/dashboard/klanten/${row.client_id}`);
  if (row.company_id) revalidatePath(`/dashboard/leads/${row.company_id}`);
}

function foreignKeyError(): ActionState {
  return { error: "De gekozen klant of het gekozen bedrijf bestaat niet meer.", fieldErrors: {} };
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
    if (error.code === "23503") return foreignKeyError();
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/vacatures");
  revalidateOwners(row);
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
    .select("status, closed_at, client_id, company_id")
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
    if (error.code === "23503") return foreignKeyError();
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/vacatures");
  revalidatePath(`/dashboard/vacatures/${id}`);
  revalidateOwners(row);
  revalidateOwners(current);
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
    .select("client_id, company_id")
    .maybeSingle();
  if (error) return { error: GENERIC_ERROR };

  revalidatePath("/dashboard/vacatures");
  if (data) revalidateOwners(data);
  redirect("/dashboard/vacatures");
}
