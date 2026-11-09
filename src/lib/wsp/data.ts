import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { WspAssessmentRow, WspMode, WspSettingsRow } from "./database";
import { parseQuestionnaire, parseReport, type QuestionnaireData, type ReportData } from "./report";

// Reads of the Working Style Profile, always with the signed-in user's
// session (or none, for the personal link): the database decides what each
// role sees (RLS and the wsp_* functions). Never used by lists, boards,
// search or the talent pool.

/** The personal link, or the own account by assessment id. */
export type WspAccess = { token: string } | { assessmentId: string };

function args(access: WspAccess) {
  return "token" in access ? { p_token: access.token, p_assessment: null } : { p_token: null, p_assessment: access.assessmentId };
}

export const TOKEN_RE = /^[0-9a-f]{64}$/;

export const isWspEnabled = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("wsp_enabled");
  return data === true;
});

export async function loadQuestionnaire(access: WspAccess): Promise<QuestionnaireData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wsp_questionnaire", args(access));
  if (error) return null;
  return parseQuestionnaire(data);
}

/** The report for the signed-in role (or the personal link). Views by a client are logged by the database. */
export async function loadReport(access: WspAccess, exportPdf = false): Promise<ReportData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wsp_report", {
    p_assessment: "assessmentId" in access ? access.assessmentId : null,
    p_token: "token" in access ? access.token : null,
    p_export: exportPdf,
  });
  if (error) return null;
  return parseReport(data);
}

// ---------------------------------------------------------------------------
// The person (own account): /academy/working-style
// ---------------------------------------------------------------------------

export type MyAssessment = Pick<WspAssessmentRow, "id" | "status" | "person_type" | "invited_at" | "expires_at" | "completed_at" | "intro_accepted_at"> & {
  report: ReportData | null;
};

export async function listMyAssessments(): Promise<MyAssessment[]> {
  const supabase = await createClient();
  const { data: person } = await supabase.rpc("wsp_my_person_id");
  if (!person) return [];
  const { data } = await supabase
    .from("wsp_assessments")
    .select("id, status, person_type, invited_at, expires_at, completed_at, intro_accepted_at")
    .eq("person_id", person)
    .neq("status", "deleted")
    .order("created_at", { ascending: false });
  const rows = data ?? [];
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      report: row.status === "completed" ? await loadReport({ assessmentId: row.id }) : null,
    })),
  );
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export async function isWspStaff(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("wsp_is_staff");
  return data === true;
}

export async function getWspSettings(): Promise<WspSettingsRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("wsp_settings").select("*").maybeSingle();
  return data ?? null;
}

export type StaffAssessmentSummary = Pick<
  WspAssessmentRow,
  "id" | "status" | "person_type" | "invite_reason" | "invited_by" | "invited_at" | "expires_at" | "reminder_sent_at" | "started_at" | "completed_at" | "delete_after"
> & {
  links: { vacancyId: string | null; vacancyTitle: string | null; clientId: string | null; clientName: string | null }[];
  flagCount: number;
  expired: boolean;
};

export type CandidateWsp = {
  enabled: boolean;
  mode: WspMode;
  talentPoolConsentAt: string | null;
  assessments: StaffAssessmentSummary[];
  vacancies: { id: string; title: string; clientId: string | null; clientName: string | null }[];
  clients: { id: string; name: string }[];
};

/** The card on the candidate page (and the Academy person and placement pages). No scores here. */
export async function getCandidateWsp(candidateId: string): Promise<CandidateWsp | null> {
  if (!(await isWspStaff())) return null;
  const supabase = await createClient();
  const [{ data: enabled }, { data: candidate }, { data: rows }, { data: apps }, { data: clients }] = await Promise.all([
    supabase.rpc("wsp_enabled"),
    supabase.from("candidates").select("*").eq("id", candidateId).maybeSingle(),
    supabase
      .from("wsp_assessments")
      .select("id, status, person_type, invite_reason, invited_by, invited_at, expires_at, reminder_sent_at, started_at, completed_at, delete_after")
      .eq("person_id", candidateId)
      .order("created_at", { ascending: false }),
    supabase.from("applications").select("vacancy:vacancies(id, title, client_id, client:clients(name))").eq("candidate_id", candidateId),
    supabase.from("clients").select("id, name").order("name").limit(500),
  ]);
  if (!candidate) return null;
  const ids = (rows ?? []).map((r) => r.id);
  const [{ data: links }, { data: flags }] = ids.length
    ? await Promise.all([
        supabase.from("wsp_assessment_links").select("assessment_id, vacancy_id, client_id").in("assessment_id", ids),
        supabase.from("wsp_flags").select("assessment_id").in("assessment_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const vacancyIds = [...new Set((links ?? []).map((l) => l.vacancy_id).filter((v): v is string => Boolean(v)))];
  const clientIds = [...new Set((links ?? []).map((l) => l.client_id).filter((v): v is string => Boolean(v)))];
  const [{ data: linkVacancies }, { data: linkClients }] = await Promise.all([
    vacancyIds.length ? supabase.from("vacancies").select("id, title").in("id", vacancyIds) : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    clientIds.length ? supabase.from("clients").select("id, name").in("id", clientIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const title = new Map((linkVacancies ?? []).map((v) => [v.id, v.title]));
  const name = new Map((linkClients ?? []).map((c) => [c.id, c.name]));
  const raw = candidate as unknown as { wsp_mode?: WspMode; talent_pool_consent_at?: string | null };
  const now = Date.now();
  return {
    enabled: enabled === true,
    mode: raw.wsp_mode ?? "follow_vacancy",
    talentPoolConsentAt: raw.talent_pool_consent_at ?? null,
    assessments: (rows ?? []).map((row) => ({
      ...row,
      expired: row.status === "expired" || ((row.status === "invited" || row.status === "started") && new Date(row.expires_at).getTime() <= now),
      flagCount: (flags ?? []).filter((f) => f.assessment_id === row.id).length,
      links: (links ?? [])
        .filter((l) => l.assessment_id === row.id)
        .map((l) => ({
          vacancyId: l.vacancy_id,
          vacancyTitle: l.vacancy_id ? (title.get(l.vacancy_id) ?? null) : null,
          clientId: l.client_id,
          clientName: l.client_id ? (name.get(l.client_id) ?? null) : null,
        })),
    })),
    vacancies: (apps ?? [])
      .map((a) => a.vacancy)
      .filter((v): v is NonNullable<typeof v> => Boolean(v))
      .map((v) => ({ id: v.id, title: v.title, clientId: v.client_id, clientName: v.client?.name ?? null })),
    clients: clients ?? [],
  };
}

export type StaffAssessment = {
  assessment: WspAssessmentRow;
  /** The link has expired (status expired, or past expires_at while open). */
  expired: boolean;
  candidate: { id: string; full_name: string };
  report: ReportData | null;
  flags: { flag_type: string; details: unknown }[];
  answers: { position: number; code: string; statement: string; dimension: string; key: string | null; answer: number | null; page: number; pageMs: number | null }[];
  audit: { id: number; action: string; actor_role: string; actor: string | null; actorName: string | null; details: unknown; created_at: string }[];
  clients: { id: string; name: string }[];
};

/** The staff view of one assessment: report (client intro), flags, raw answers, consent per client, audit log. */
export async function getStaffAssessment(assessmentId: string): Promise<StaffAssessment | null> {
  if (!(await isWspStaff())) return null;
  const supabase = await createClient();
  const { data: assessment } = await supabase.from("wsp_assessments").select("*").eq("id", assessmentId).maybeSingle();
  if (!assessment || !assessment.person_id) return null;
  const [{ data: candidate }, report, { data: flags }, { data: answers }, { data: items }, { data: audit }, { data: clients }] = await Promise.all([
    supabase.from("candidates").select("id, full_name").eq("id", assessment.person_id).maybeSingle(),
    assessment.status === "completed" ? loadReport({ assessmentId }) : Promise.resolve(null),
    supabase.from("wsp_flags").select("flag_type, details").eq("assessment_id", assessmentId),
    supabase.from("wsp_answers").select("item_id, answer, page_number, page_duration_ms").eq("assessment_id", assessmentId),
    supabase.from("wsp_items").select("*").eq("instrument_version", assessment.instrument_version).order("position"),
    supabase.from("wsp_audit_log").select("*").eq("assessment_id", assessmentId).order("created_at", { ascending: false }).limit(100),
    supabase.from("clients").select("id, name").order("name").limit(500),
  ]);
  if (!candidate) return null;
  const actorIds = [...new Set((audit ?? []).map((a) => a.actor).filter((a): a is string => Boolean(a)))];
  const { data: actors } = actorIds.length ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds) : { data: [] };
  const actorName = new Map((actors ?? []).map((p) => [p.id, p.full_name || p.email]));
  const byItem = new Map((answers ?? []).map((a) => [a.item_id, a]));
  const open = assessment.status === "invited" || assessment.status === "started";
  return {
    assessment,
    expired: assessment.status === "expired" || (open && new Date(assessment.expires_at).getTime() <= Date.now()),
    candidate,
    report,
    flags: flags ?? [],
    answers: (items ?? []).map((item) => {
      const a = byItem.get(item.id);
      return {
        position: item.position,
        code: item.code,
        statement: item.statement,
        dimension: item.dimension,
        key: item.key,
        answer: a?.answer ?? null,
        page: Math.ceil(item.position / 10),
        pageMs: a?.page_duration_ms ?? null,
      };
    }),
    audit: (audit ?? []).map((a) => ({ ...a, actorName: a.actor ? (actorName.get(a.actor) ?? null) : null })),
    clients: clients ?? [],
  };
}

// ---------------------------------------------------------------------------
// Client portal
// ---------------------------------------------------------------------------

export async function listClientReports() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("wsp_client_reports");
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Vacancy
// ---------------------------------------------------------------------------

/** The vacancy setting (wsp_enabled); null when the system is off or the user is not staff. */
export async function getVacancyWsp(vacancyId: string): Promise<{ enabled: boolean } | null> {
  if (!(await isWspEnabled()) || !(await isWspStaff())) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("vacancies").select("*").eq("id", vacancyId).maybeSingle();
  if (!data) return null;
  return { enabled: (data as unknown as { wsp_enabled?: boolean }).wsp_enabled === true };
}
