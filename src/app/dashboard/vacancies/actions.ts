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
import { clockOnLink, ownerColumns } from "@/lib/talent/talent-pool";

const idSchema = z.guid();

const amount = z
  .string()
  .regex(/^\d{1,8}([.,]\d{1,2})?$/, "Enter an amount in euros, for example 4500.")
  .transform((value) => Number(value.replace(",", ".")));

const vacancySchema = z
  .object({
    owner_type: z.enum(["client", "company", "talent_pool"], {
      error: "Choose a client, a prospect or the talent pool.",
    }),
    client_id: z.guid({ error: "Choose a client." }).optional(),
    company_id: z.guid({ error: "Choose a company." }).optional(),
    title: z
      .string({ error: "Enter a job title." })
      .min(1, "Enter a job title.")
      .max(200, "Use at most 200 characters."),
    description: z.string().max(20000, "This profile is too long.").optional(),
    stack: z.string().max(1000, "Use at most 1000 characters.").optional(),
    seniority: z.enum(["medior", "senior", "lead"], { error: "Choose a seniority." }),
    status: z.enum(["open", "on_hold", "filled", "closed"], { error: "Choose a status." }),
    talent_stage: z.enum(["intake", "zoeken", "profielen_verstuurd", "gesprekken", "geplaatst", "gesloten"], {
      error: "Choose a stage.",
    }),
    source: z.enum(["klant_eigen", "samen_opgesteld", "gescrapet"], { error: "Choose a source." }).optional(),
    onepage_deal_id: z
      .string()
      .max(100, "Use at most 100 characters.")
      .regex(/^[\w-]+$/, "Paste only the deal id from OnePageCRM, without spaces.")
      .optional(),
    monthly_budget: amount.optional(),
    budget_min: amount.optional(),
    budget_max: amount.optional(),
    hours: z.coerce
      .number({ error: "Enter a number of hours." })
      .int("Use whole hours.")
      .min(1, "At least 1 hour.")
      .max(60, "At most 60 hours.")
      .optional(),
    timezone_overlap: z.string().max(300, "Use at most 300 characters.").optional(),
    client_contact_required: z.enum(["ja", "nee"]).optional(),
    must_haves: z.string().max(4000, "This is too long.").optional(),
    nice_to_haves: z.string().max(4000, "This is too long.").optional(),
    unclear: z.string().max(4000, "This is too long.").optional(),
    desired_start_date: z.iso.date({ error: "Choose a valid date." }).optional(),
    owner_id: z.guid({ error: "Choose a team member." }).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.owner_type === "client" && !data.client_id) {
      ctx.addIssue({ code: "custom", path: ["client_id"], message: "Choose a client." });
    }
    if (data.owner_type === "company" && !data.company_id) {
      ctx.addIssue({ code: "custom", path: ["company_id"], message: "Choose a company." });
    }
    if (data.budget_min !== undefined && data.budget_max !== undefined && data.budget_min > data.budget_max) {
      ctx.addIssue({ code: "custom", path: ["budget_max"], message: "The maximum is lower than the minimum." });
    }
  });

/** Linking a talent pool vacancy from its detail page: only the owner. */
const linkSchema = z
  .object({
    owner_type: z.enum(["client", "company"], { error: "Choose a client or a prospect." }),
    client_id: z.guid({ error: "Choose a client." }).optional(),
    company_id: z.guid({ error: "Choose a company." }).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.owner_type === "client" && !data.client_id) {
      ctx.addIssue({ code: "custom", path: ["client_id"], message: "Choose a client." });
    }
    if (data.owner_type === "company" && !data.company_id) {
      ctx.addIssue({ code: "custom", path: ["company_id"], message: "Choose a company." });
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
  return {
    ...ownerColumns(data.owner_type, data),
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
  if (row.client_id) revalidatePath(`/dashboard/clients/${row.client_id}`);
  if (row.company_id) revalidatePath(`/dashboard/leads/${row.company_id}`);
}

function foreignKeyError(): ActionState {
  return { error: "The chosen client or company no longer exists.", fieldErrors: {} };
}

function invalid(error: z.ZodError): ActionState {
  return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(error) };
}

const NOT_FOUND = "This vacancy no longer exists.";
const NO_WAY_BACK =
  "A vacancy linked to a client or prospect can't move back to the talent pool. Create a new talent pool vacancy instead.";

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

  revalidatePath("/dashboard/vacancies");
  revalidateOwners(row);
  redirect(`/dashboard/vacancies/${data.id}`);
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
    .select("status, closed_at, client_id, company_id, is_talent_pool, intake_at")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { error: GENERIC_ERROR };
  if (!current) return { error: NOT_FOUND };

  const row = toRow(parsed.data);
  if (row.is_talent_pool && !current.is_talent_pool) return { error: NO_WAY_BACK, fieldErrors: {} };
  // Linking a talent pool vacancy starts the three-week clock now (see clockOnLink).
  const clock = clockOnLink(current, row.is_talent_pool) ?? {};
  // Closing sets closed_at to today, reopening clears it. Keep the original date otherwise.
  const closedAt = CLOSED.includes(row.status)
    ? CLOSED.includes(current.status) && current.closed_at
      ? current.closed_at
      : todayIso()
    : null;

  const { error } = await supabase
    .from("vacancies")
    .update({ ...row, ...clock, closed_at: closedAt })
    .eq("id", id);
  if (error) {
    if (error.code === "23503") return foreignKeyError();
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/vacancies");
  revalidatePath(`/dashboard/vacancies/${id}`);
  revalidateOwners(row);
  revalidateOwners(current);
  redirect(`/dashboard/vacancies/${id}`);
}

/**
 * Links a talent pool vacancy to a client or prospect from its detail page,
 * which turns it into a normal vacancy. The three-week clock starts at the
 * moment of linking, not at creation: see clockOnLink for why.
 */
export async function linkTalentPoolVacancyAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  if (!idSchema.safeParse(id).success) return { error: GENERIC_ERROR };
  const parsed = linkSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("vacancies")
    .select("is_talent_pool, intake_at")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { error: GENERIC_ERROR };
  if (!current) return { error: NOT_FOUND };
  if (!current.is_talent_pool) return { error: "This vacancy is already linked to a client or prospect." };

  const owner = ownerColumns(parsed.data.owner_type, parsed.data);
  const { error } = await supabase
    .from("vacancies")
    .update({ ...owner, ...clockOnLink(current, false) })
    .eq("id", id)
    // Guards against a second link racing this one.
    .eq("is_talent_pool", true);
  if (error) {
    if (error.code === "23503") return foreignKeyError();
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/report");
  revalidatePath("/dashboard/vacancies");
  revalidatePath(`/dashboard/vacancies/${id}`);
  revalidateOwners(owner);
  return { ok: true, message: "Linked. The three-week clock starts today." };
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

  revalidatePath("/dashboard/vacancies");
  if (data) revalidateOwners(data);
  redirect("/dashboard/vacancies");
}
