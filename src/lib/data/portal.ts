import "server-only";
import { cache } from "react";
import { requireClient } from "@/lib/auth";
import type {
  ApplicationStage,
  ClientDecision,
  PlacementStatus,
  Seniority,
  VacancyStatus,
} from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Data access for the client portal (/portaal).
 *
 * Every function calls requireClient() and filters by the client id itself,
 * on top of RLS. Candidate contact details, owners and internal fields
 * (assessment_notes, rejection_reason, notes) are never selected.
 */

/** Stages a client can see; matches the RLS policy on applications. */
export const VISIBLE_STAGES = ["presented", "final_interview", "placed"] as const satisfies readonly ApplicationStage[];

/** Stages in which the client can still give or change a decision. */
export const REVIEWABLE_STAGES = ["presented", "final_interview"] as const satisfies readonly ApplicationStage[];

export type VisibleStage = (typeof VISIBLE_STAGES)[number];

export function isReviewable(stage: ApplicationStage) {
  return (REVIEWABLE_STAGES as readonly ApplicationStage[]).includes(stage);
}

/** cv_path is read only to derive hasCv; the path itself never leaves the server. */
const CANDIDATE_COLUMNS =
  "id, full_name, current_title, location, years_experience, skills, video_url, summary, cv_path";

export type PortalCompany = { id: string; name: string; city: string | null };

export type PortalVacancySummary = {
  id: string;
  title: string;
  status: VacancyStatus;
  seniority: Seniority;
  stack: string[];
  openedAt: string;
  closedAt: string | null;
  presentedCount: number;
  pendingCount: number;
};

export type PendingReview = {
  applicationId: string;
  presentedAt: string | null;
  stage: ApplicationStage;
  candidateName: string;
  candidateTitle: string | null;
  vacancyId: string;
  vacancyTitle: string;
};

export type PortalCandidate = {
  applicationId: string;
  stage: ApplicationStage;
  technicalScore: number | null;
  englishScore: number | null;
  presentedAt: string | null;
  decision: ClientDecision;
  feedback: string | null;
  decidedAt: string | null;
  candidate: {
    id: string;
    fullName: string;
    currentTitle: string | null;
    location: string;
    yearsExperience: number | null;
    skills: string[];
    videoUrl: string | null;
    summary: string | null;
    hasCv: boolean;
  };
};

export type PortalVacancyDetail = {
  id: string;
  title: string;
  description: string | null;
  stack: string[];
  seniority: Seniority;
  status: VacancyStatus;
  openedAt: string;
  closedAt: string | null;
  desiredStartDate: string | null;
  candidates: PortalCandidate[];
};

export type PortalPlacement = {
  id: string;
  startDate: string;
  endDate: string | null;
  status: PlacementStatus;
  noticeGivenAt: string | null;
  guaranteeUntil: string | null;
  monthlyRate: number | null;
  candidateName: string | null;
  candidateTitle: string | null;
  vacancyTitle: string | null;
};

/** Only http(s) links are rendered, so a stored value can never run script. */
function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export const getPortalCompany = cache(async (): Promise<PortalCompany | null> => {
  const { clientId } = await requireClient();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, city")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
});

export const getPortalVacancies = cache(async (): Promise<PortalVacancySummary[]> => {
  const { clientId } = await requireClient();
  const supabase = await createClient();

  const { data: vacancies, error } = await supabase
    .from("vacancies")
    .select("id, title, status, seniority, stack, opened_at, closed_at")
    .eq("client_id", clientId)
    .order("opened_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!vacancies.length) return [];

  const { data: applications, error: appError } = await supabase
    .from("applications")
    .select("vacancy_id, client_decision, stage")
    .in(
      "vacancy_id",
      vacancies.map((v) => v.id),
    )
    .in("stage", [...VISIBLE_STAGES]);
  if (appError) throw new Error(appError.message);

  return vacancies.map((v) => {
    const own = applications.filter((a) => a.vacancy_id === v.id);
    return {
      id: v.id,
      title: v.title,
      status: v.status,
      seniority: v.seniority,
      stack: v.stack,
      openedAt: v.opened_at,
      closedAt: v.closed_at,
      presentedCount: own.length,
      pendingCount: own.filter(
        (a) => a.client_decision === "pending" && isReviewable(a.stage),
      ).length,
    };
  });
});

export const getPendingReviews = cache(async (): Promise<PendingReview[]> => {
  const { clientId } = await requireClient();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    .select(
      "id, stage, presented_at, candidate:candidates(full_name, current_title), vacancy:vacancies!inner(id, title, client_id)",
    )
    .eq("vacancy.client_id", clientId)
    .eq("client_decision", "pending")
    .in("stage", [...REVIEWABLE_STAGES])
    .order("presented_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);

  return data
    .filter((row) => row.vacancy?.client_id === clientId)
    .map((row) => ({
      applicationId: row.id,
      presentedAt: row.presented_at,
      stage: row.stage,
      candidateName: row.candidate?.full_name ?? "Kandidaat",
      candidateTitle: row.candidate?.current_title ?? null,
      vacancyId: row.vacancy.id,
      vacancyTitle: row.vacancy.title,
    }));
});

export const getPortalVacancy = cache(async (id: string): Promise<PortalVacancyDetail | null> => {
  const { clientId } = await requireClient();
  if (!isUuid(id)) return null;
  const supabase = await createClient();

  const { data: vacancy, error } = await supabase
    .from("vacancies")
    .select("id, title, description, stack, seniority, status, opened_at, closed_at, desired_start_date")
    .eq("id", id)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!vacancy) return null;

  const { data: applications, error: appError } = await supabase
    .from("applications")
    .select(
      `id, stage, technical_score, english_score, presented_at, client_decision, client_feedback, client_decided_at, candidate:candidates(${CANDIDATE_COLUMNS})`,
    )
    .eq("vacancy_id", vacancy.id)
    .in("stage", [...VISIBLE_STAGES])
    .order("presented_at", { ascending: true, nullsFirst: false });
  if (appError) throw new Error(appError.message);

  const candidates: PortalCandidate[] = [];
  for (const a of applications) {
    const c = a.candidate;
    if (!c) continue;
    candidates.push({
      applicationId: a.id,
      stage: a.stage,
      technicalScore: a.technical_score,
      englishScore: a.english_score,
      presentedAt: a.presented_at,
      decision: a.client_decision,
      feedback: a.client_feedback,
      decidedAt: a.client_decided_at,
      candidate: {
        id: c.id,
        fullName: c.full_name,
        currentTitle: c.current_title,
        location: c.location,
        yearsExperience: c.years_experience,
        skills: c.skills,
        videoUrl: safeExternalUrl(c.video_url),
        summary: c.summary,
        hasCv: Boolean(c.cv_path),
      },
    });
  }

  return {
    id: vacancy.id,
    title: vacancy.title,
    description: vacancy.description,
    stack: vacancy.stack,
    seniority: vacancy.seniority,
    status: vacancy.status,
    openedAt: vacancy.opened_at,
    closedAt: vacancy.closed_at,
    desiredStartDate: vacancy.desired_start_date,
    candidates,
  };
});

/**
 * Storage path of the CV for one application, only when that application is
 * visible to this client. Used by the CV download route, never rendered.
 */
export async function getCvPathForApplication(applicationId: string): Promise<string | null> {
  const { clientId } = await requireClient();
  if (!isUuid(applicationId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("id, candidate:candidates(id, cv_path), vacancy:vacancies!inner(client_id)")
    .eq("id", applicationId)
    .eq("vacancy.client_id", clientId)
    .in("stage", [...VISIBLE_STAGES])
    .maybeSingle();
  if (error || !data || data.vacancy?.client_id !== clientId) return null;
  const path = data.candidate?.cv_path;
  // Storage RLS only lets clients read files under candidate/<candidate_id>/.
  if (!path || !path.startsWith(`candidate/${data.candidate?.id}/`)) return null;
  return path;
}

export const getPortalPlacements = cache(async (): Promise<PortalPlacement[]> => {
  const { clientId } = await requireClient();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("placements")
    .select(
      "id, start_date, end_date, status, notice_given_at, guarantee_until, monthly_rate, candidate:candidates(full_name, current_title), vacancy:vacancies(title)",
    )
    .eq("client_id", clientId)
    .order("start_date", { ascending: false });
  if (error) throw new Error(error.message);

  return data.map((p) => ({
    id: p.id,
    startDate: p.start_date,
    endDate: p.end_date,
    status: p.status,
    noticeGivenAt: p.notice_given_at,
    guaranteeUntil: p.guarantee_until,
    monthlyRate: p.monthly_rate,
    candidateName: p.candidate?.full_name ?? null,
    candidateTitle: p.candidate?.current_title ?? null,
    vacancyTitle: p.vacancy?.title ?? null,
  }));
});

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
