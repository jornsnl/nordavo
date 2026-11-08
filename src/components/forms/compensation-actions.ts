"use server";

import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom } from "@/lib/action-state";
import { requireStaff } from "@/lib/auth";
import { parseInrAmount } from "@/lib/forms/compensation";
import { getCurrentRate, type CompensationItem, type ExchangeRate, type Payslip } from "@/lib/forms/data";
import { ATTACHMENTS_BUCKET, buildStoragePath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { toNumber } from "@/lib/forms/compensation";

/** Compensation and payslips: staff only, never shown to clients (RLS too). */

export type ApplicationCompensation = {
  candidateId: string;
  item: CompensationItem;
  rate: ExchangeRate | null;
  payslips: Payslip[];
};

/** For the card modal in the pipeline. */
export async function loadApplicationCompensation(applicationId: string): Promise<ApplicationCompensation | null> {
  await requireStaff();
  if (!z.guid().safeParse(applicationId).success) return null;
  const supabase = await createClient();
  const { data: application } = await supabase
    .from("applications")
    .select("id, candidate_id, vacancy_id, vacancy:vacancies(title, form:recruitment_forms(role_type))")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application) return null;

  const [{ data: row }, { data: payslips }, rate] = await Promise.all([
    supabase.from("application_compensation").select("*").eq("application_id", applicationId).maybeSingle(),
    supabase
      .from("attachments")
      .select("id, file_name, created_at")
      .eq("entity_type", "candidate")
      .eq("entity_id", application.candidate_id)
      .eq("kind", "payslip")
      .order("created_at", { ascending: false }),
    getCurrentRate(supabase),
  ]);
  const form = Array.isArray(application.vacancy?.form) ? application.vacancy?.form[0] : application.vacancy?.form;

  return {
    candidateId: application.candidate_id,
    rate,
    payslips: (payslips ?? []).map((p) => ({ id: p.id, fileName: p.file_name, createdAt: p.created_at })),
    item: {
      applicationId,
      vacancyId: application.vacancy_id,
      vacancyTitle: application.vacancy?.title ?? "Vacancy",
      roleType: row?.role_type ?? form?.role_type ?? "fulltime",
      currentCtc: toNumber(row?.current_ctc_inr_year),
      expectedCtc: toNumber(row?.expected_ctc_inr_year),
      askedHourly: toNumber(row?.asked_hourly_inr),
      negotiatedCtc: toNumber(row?.negotiated_ctc_inr_year),
      negotiatedHourly: toNumber(row?.negotiated_hourly_inr),
      negotiatedRate: toNumber(row?.negotiated_inr_per_eur),
      negotiatedRateDate: row?.negotiated_rate_date ?? null,
      negotiatedAt: row?.negotiated_at ?? null,
      payslipRequestedAt: row?.payslip_requested_at ?? null,
      notes: row?.notes ?? null,
    },
  };
}

function amount(max: number, unit: string) {
  return z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v || !v.trim()) return null;
      const n = parseInrAmount(v);
      if (n === null || n < 0 || n > max) {
        ctx.addIssue({ code: "custom", message: `Enter an amount in rupees ${unit}.` });
        return z.NEVER;
      }
      return n;
    });
}

const schema = z.object({
  applicationId: z.guid(),
  roleType: z.enum(["fulltime", "freelance"]),
  current_ctc: amount(1_000_000_000, "per year"),
  expected_ctc: amount(1_000_000_000, "per year"),
  asked_hourly: amount(1_000_000, "per hour"),
  negotiated_ctc: amount(1_000_000_000, "per year"),
  negotiated_hourly: amount(1_000_000, "per hour"),
  payslip_requested_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  notes: z.string().max(2000).optional(),
});

/** Asked (corrections) and negotiated amounts; the trigger snapshots the rate. */
export async function saveCompensation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const value = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const parsed = schema.safeParse({
    applicationId: value("applicationId"),
    roleType: value("roleType"),
    current_ctc: value("current_ctc"),
    expected_ctc: value("expected_ctc"),
    asked_hourly: value("asked_hourly"),
    negotiated_ctc: value("negotiated_ctc"),
    negotiated_hourly: value("negotiated_hourly"),
    payslip_requested_at: value("payslip_requested_at"),
    notes: value("notes")?.trim() || undefined,
  });
  if (!parsed.success) return { error: "Check the amounts.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: application } = await supabase
    .from("applications")
    .select("candidate_id, vacancy_id")
    .eq("id", d.applicationId)
    .maybeSingle();
  if (!application) return { error: "This application no longer exists." };

  const { error } = await supabase.from("application_compensation").upsert(
    {
      application_id: d.applicationId,
      candidate_id: application.candidate_id,
      vacancy_id: application.vacancy_id,
      role_type: d.roleType,
      current_ctc_inr_year: d.current_ctc,
      expected_ctc_inr_year: d.expected_ctc,
      asked_hourly_inr: d.asked_hourly,
      negotiated_ctc_inr_year: d.negotiated_ctc,
      negotiated_hourly_inr: d.negotiated_hourly,
      payslip_requested_at: d.payslip_requested_at ?? null,
      notes: d.notes ?? null,
    },
    { onConflict: "application_id" },
  );
  if (error) return { error: GENERIC_ERROR };
  revalidatePath(`/dashboard/candidates/${application.candidate_id}`);
  return { ok: true, message: "Compensation saved." };
}

const PAYSLIP_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const PAYSLIP_MAX = 10 * 1024 * 1024;

/** Upload a payslip: attachment kind payslip, never visible to clients. */
export async function uploadPayslip(candidateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireStaff();
  if (!z.guid().safeParse(candidateId).success) return { error: GENERIC_ERROR };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the payslip first." };
  if (!PAYSLIP_TYPES.includes(file.type)) return { error: "Upload a PDF, PNG or JPG." };
  if (file.size > PAYSLIP_MAX) return { error: "The payslip can be at most 10 MB." };

  const supabase = await createClient();
  const path = buildStoragePath("candidate", candidateId, `payslip-${file.name}`);
  const upload = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) return { error: "The upload failed. Please try again." };
  const { error } = await supabase.from("attachments").insert({
    entity_type: "candidate",
    entity_id: candidateId,
    storage_path: path,
    file_name: file.name.slice(0, 255),
    mime_type: file.type,
    size_bytes: file.size,
    uploaded_by: user.id,
    kind: "payslip",
  });
  if (error) {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    return { error: GENERIC_ERROR };
  }
  revalidatePath(`/dashboard/candidates/${candidateId}`);
  refresh();
  return { ok: true, message: "Payslip stored." };
}

const rateSchema = z.object({
  inr_per_eur: z
    .string()
    .transform((v) => Number(v.replace(",", ".")))
    .pipe(z.number({ error: "Enter a number." }).positive("Enter a positive rate.").max(9999)),
  rate_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date of the rate."),
  note: z.string().max(500).optional(),
});

/** Admins set the INR per EUR rate; every change is a new row with its date. */
export async function addExchangeRate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireStaff();
  if (user.role !== "admin") return { error: "Only admins can change the exchange rate." };
  const parsed = rateSchema.safeParse({
    inr_per_eur: formData.get("inr_per_eur") ?? "",
    rate_date: formData.get("rate_date") ?? "",
    note: (formData.get("note") as string | null)?.trim() || undefined,
  });
  if (!parsed.success) return { error: "Check the rate.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("exchange_rates").insert({ ...parsed.data, created_by: user.id });
  if (error) return { error: GENERIC_ERROR };
  revalidatePath("/dashboard/exchange-rate");
  return { ok: true, message: "Exchange rate saved. New negotiated amounts use it from now on." };
}
