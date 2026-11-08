import "server-only";
import { requireStaff } from "@/lib/auth";
import type { ApplicationStage } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { toNumber } from "./compensation";
import type { ApplicationCompensationRow, FormInviteRow, RecruitmentFormRow } from "./database";
import type { ResponseRow } from "./responses";
import { allQuestions, readBlocks, type Block, type Question } from "./schema";

/** Staff reads for the form pages. RLS limits all of this to staff as well. */

export type ExchangeRate = { inrPerEur: number; rateDate: string };

export type VacancyBasics = { id: string; title: string; clientName: string | null; isTalentPool: boolean };

export async function getVacancyBasics(vacancyId: string): Promise<VacancyBasics | null> {
  await requireStaff();
  if (!/^[0-9a-f-]{36}$/i.test(vacancyId)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("vacancies")
    .select("id, title, is_talent_pool, client:clients(name)")
    .eq("id", vacancyId)
    .maybeSingle();
  return data ? { id: data.id, title: data.title, clientName: data.client?.name ?? null, isTalentPool: data.is_talent_pool } : null;
}

export type VacancyForm = {
  form: RecruitmentFormRow;
  blocks: Block[];
  /** The draft differs from the latest published version. */
  hasUnpublishedChanges: boolean;
};

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function getVacancyForm(vacancyId: string): Promise<VacancyForm | null> {
  await requireStaff();
  const supabase = await createClient();
  const { data: form, error } = await supabase.from("recruitment_forms").select("*").eq("vacancy_id", vacancyId).maybeSingle();
  if (error) throw new Error(`Could not load the form: ${error.message}`);
  if (!form) return null;

  let hasUnpublishedChanges = form.version === 0;
  if (form.version > 0) {
    const { data: version } = await supabase
      .from("recruitment_form_versions")
      .select("title, intro, role_type, blocks, header_image_path, logo_path")
      .eq("form_id", form.id)
      .eq("version", form.version)
      .maybeSingle();
    hasUnpublishedChanges =
      !version ||
      version.title !== form.title ||
      (version.intro ?? "") !== (form.intro ?? "") ||
      version.role_type !== form.role_type ||
      version.header_image_path !== form.header_image_path ||
      version.logo_path !== form.logo_path ||
      !sameJson(version.blocks, form.blocks);
  }
  return { form, blocks: readBlocks(form.blocks), hasUnpublishedChanges };
}

export type FormSummary = {
  status: "none" | "draft" | "published";
  hasUnpublishedChanges: boolean;
  sent: number;
  completed: number;
  responses: number;
  publicToken: string | null;
  headhuntedToken: string | null;
};

/** Counts for the card on the vacancy page. */
export async function getFormSummary(vacancyId: string): Promise<FormSummary> {
  const vf = await getVacancyForm(vacancyId);
  if (!vf) {
    return { status: "none", hasUnpublishedChanges: false, sent: 0, completed: 0, responses: 0, publicToken: null, headhuntedToken: null };
  }
  const supabase = await createClient();
  const [sent, completed, responses] = await Promise.all([
    supabase.from("applications").select("id", { count: "exact", head: true }).eq("vacancy_id", vacancyId).not("form_sent_at", "is", null),
    supabase.from("applications").select("id", { count: "exact", head: true }).eq("vacancy_id", vacancyId).not("form_completed_at", "is", null),
    supabase.from("form_responses").select("id", { count: "exact", head: true }).eq("vacancy_id", vacancyId),
  ]);
  return {
    status: vf.form.status,
    hasUnpublishedChanges: vf.hasUnpublishedChanges,
    sent: sent.count ?? 0,
    completed: completed.count ?? 0,
    responses: responses.count ?? 0,
    publicToken: vf.form.public_token,
    headhuntedToken: vf.form.headhunted_token,
  };
}

export type CopySource = { vacancyId: string; vacancyTitle: string; formTitle: string; questions: number };

/** Forms of other vacancies, to copy from. */
export async function listCopySources(exceptVacancyId: string): Promise<CopySource[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase
    .from("recruitment_forms")
    .select("vacancy_id, title, blocks, updated_at, vacancy:vacancies(title)")
    .neq("vacancy_id", exceptVacancyId)
    .order("updated_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((f) => ({
    vacancyId: f.vacancy_id,
    vacancyTitle: f.vacancy?.title ?? "Vacancy",
    formTitle: f.title,
    questions: allQuestions(readBlocks(f.blocks)).length,
  }));
}

type Db = Awaited<ReturnType<typeof createClient>>;

export async function getCurrentRate(supabase?: Db): Promise<ExchangeRate | null> {
  const db = supabase ?? (await createClient());
  const { data } = await db
    .from("exchange_rates")
    .select("inr_per_eur, rate_date")
    .order("rate_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const rate = toNumber(data?.inr_per_eur);
  return data && rate ? { inrPerEur: rate, rateDate: data.rate_date } : null;
}

export async function listRates() {
  await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase
    .from("exchange_rates")
    .select("id, inr_per_eur, rate_date, note, created_at, author:profiles(full_name, email)")
    .order("rate_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  return data ?? [];
}

export type TrackingRow = {
  applicationId: string;
  candidateId: string;
  name: string;
  email: string | null;
  stage: ApplicationStage;
  origin: string;
  formSentAt: string | null;
  formCompletedAt: string | null;
  formRemindedAt: string | null;
  invite: Pick<FormInviteRow, "token" | "deadline" | "reminder_count" | "cc" | "sent_to"> | null;
};

/** Every application on the vacancy with its form status. */
export async function getFormTracking(vacancyId: string): Promise<TrackingRow[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select(
      "id, stage, origin, form_sent_at, form_completed_at, form_reminded_at, position, candidate:candidates(id, full_name, email), invite:form_invites(token, deadline, reminder_count, cc, sent_to)",
    )
    .eq("vacancy_id", vacancyId)
    .order("position")
    .limit(2000);
  if (error) throw new Error(`Could not load the applications: ${error.message}`);
  return data.map((a) => {
    const invite = Array.isArray(a.invite) ? (a.invite[0] ?? null) : a.invite;
    return {
      applicationId: a.id,
      candidateId: a.candidate?.id ?? "",
      name: a.candidate?.full_name ?? "Unknown",
      email: a.candidate?.email ?? null,
      stage: a.stage,
      origin: a.origin,
      formSentAt: a.form_sent_at,
      formCompletedAt: a.form_completed_at,
      formRemindedAt: a.form_reminded_at,
      invite: invite ?? null,
    };
  });
}

export type ResponsesData = {
  questions: (Question & { removed?: boolean })[];
  rows: ResponseRow[];
};

/**
 * Every response on the vacancy, with the questions of the latest version
 * first and questions that only exist in older versions after them, so old
 * answers stay visible after the form changed.
 */
export async function getResponses(vacancyId: string, formId: string): Promise<ResponsesData> {
  await requireStaff();
  const supabase = await createClient();
  const [{ data: versions }, { data: responses, error }] = await Promise.all([
    supabase.from("recruitment_form_versions").select("version, blocks").eq("form_id", formId).order("version", { ascending: false }),
    supabase
      .from("form_responses")
      .select("application_id, candidate_id, answers, via, form_version, submitted_at, application:applications(stage), candidate:candidates(full_name)")
      .eq("vacancy_id", vacancyId)
      .order("submitted_at", { ascending: false })
      .limit(2000),
  ]);
  if (error) throw new Error(`Could not load the responses: ${error.message}`);

  const questions: (Question & { removed?: boolean })[] = [];
  const seen = new Set<string>();
  (versions ?? []).forEach((v, index) => {
    for (const q of allQuestions(readBlocks(v.blocks))) {
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      questions.push(index === 0 ? q : { ...q, removed: true });
    }
  });

  const rows: ResponseRow[] = (responses ?? []).map((r) => ({
    id: r.application_id,
    candidateId: r.candidate_id,
    candidateName: r.candidate?.full_name ?? "Unknown",
    stage: r.application?.stage ?? "sourced",
    via: r.via,
    formVersion: r.form_version,
    submittedAt: r.submitted_at,
    answers: r.answers && typeof r.answers === "object" && !Array.isArray(r.answers) ? (r.answers as Record<string, unknown>) : {},
  }));
  return { questions, rows };
}

export type CompensationItem = {
  applicationId: string;
  vacancyId: string;
  vacancyTitle: string;
  roleType: "fulltime" | "freelance";
  currentCtc: number | null;
  expectedCtc: number | null;
  askedHourly: number | null;
  negotiatedCtc: number | null;
  negotiatedHourly: number | null;
  negotiatedRate: number | null;
  negotiatedRateDate: string | null;
  negotiatedAt: string | null;
  payslipRequestedAt: string | null;
  notes: string | null;
};

function toItem(row: ApplicationCompensationRow, vacancyTitle: string): CompensationItem {
  return {
    applicationId: row.application_id,
    vacancyId: row.vacancy_id,
    vacancyTitle,
    roleType: row.role_type,
    currentCtc: toNumber(row.current_ctc_inr_year),
    expectedCtc: toNumber(row.expected_ctc_inr_year),
    askedHourly: toNumber(row.asked_hourly_inr),
    negotiatedCtc: toNumber(row.negotiated_ctc_inr_year),
    negotiatedHourly: toNumber(row.negotiated_hourly_inr),
    negotiatedRate: toNumber(row.negotiated_inr_per_eur),
    negotiatedRateDate: row.negotiated_rate_date,
    negotiatedAt: row.negotiated_at,
    payslipRequestedAt: row.payslip_requested_at,
    notes: row.notes,
  };
}

export type Payslip = { id: string; fileName: string; createdAt: string };

export type CandidateCompensation = {
  items: CompensationItem[];
  /** Applications without a compensation row yet, so staff can start one. */
  missing: { applicationId: string; vacancyTitle: string; roleType: "fulltime" | "freelance" }[];
  payslips: Payslip[];
  rate: ExchangeRate | null;
};

export async function getCandidateCompensation(candidateId: string): Promise<CandidateCompensation> {
  await requireStaff();
  const supabase = await createClient();
  const [{ data: rows }, { data: applications }, { data: payslips }, rate] = await Promise.all([
    supabase.from("application_compensation").select("*").eq("candidate_id", candidateId),
    supabase.from("applications").select("id, vacancy:vacancies(id, title, form:recruitment_forms(role_type))").eq("candidate_id", candidateId),
    supabase
      .from("attachments")
      .select("id, file_name, created_at")
      .eq("entity_type", "candidate")
      .eq("entity_id", candidateId)
      .eq("kind", "payslip")
      .order("created_at", { ascending: false }),
    getCurrentRate(supabase),
  ]);
  const titles = new Map((applications ?? []).map((a) => [a.id, a.vacancy?.title ?? "Vacancy"]));
  const items = (rows ?? []).map((r) => toItem(r, titles.get(r.application_id) ?? "Vacancy"));
  const have = new Set(items.map((i) => i.applicationId));
  const missing = (applications ?? [])
    .filter((a) => !have.has(a.id))
    .map((a) => {
      const form = Array.isArray(a.vacancy?.form) ? a.vacancy?.form[0] : a.vacancy?.form;
      return { applicationId: a.id, vacancyTitle: a.vacancy?.title ?? "Vacancy", roleType: form?.role_type ?? "fulltime" };
    });
  return {
    items,
    missing,
    payslips: (payslips ?? []).map((p) => ({ id: p.id, fileName: p.file_name, createdAt: p.created_at })),
    rate,
  };
}
