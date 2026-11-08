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
 * Data access for the client portal (/portal).
 *
 * Clients have no direct read access to vacancies, applications, candidates
 * or placements. Every read goes through a portal_* database function
 * (supabase/migrations/*_recruitment_integration.sql) that filters on the
 * signed in client and returns only the columns the portal shows, so
 * contact details and internal fields never reach a client, not even
 * through the API.
 */

/** Stages a client can see; matches the RLS policy on applications. */
export const VISIBLE_STAGES = ["matched", "client_interview", "final_screening", "placed"] as const satisfies readonly ApplicationStage[];

/** Stages in which the client can still give or change a decision. */
export const REVIEWABLE_STAGES = ["matched", "client_interview"] as const satisfies readonly ApplicationStage[];

export type VisibleStage = (typeof VISIBLE_STAGES)[number];

export function isReviewable(stage: ApplicationStage) {
  return (REVIEWABLE_STAGES as readonly ApplicationStage[]).includes(stage);
}

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
  await requireClient();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_company");
  if (error) throw new Error(error.message);
  return data[0] ?? null;
});

export const getPortalVacancies = cache(async (): Promise<PortalVacancySummary[]> => {
  await requireClient();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_vacancies");
  if (error) throw new Error(error.message);
  return data.map((v) => ({
    id: v.id,
    title: v.title,
    status: v.status,
    seniority: v.seniority,
    stack: v.stack,
    openedAt: v.opened_at,
    closedAt: v.closed_at,
    presentedCount: v.presented_count,
    pendingCount: v.pending_count,
  }));
});

export const getPendingReviews = cache(async (): Promise<PendingReview[]> => {
  await requireClient();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_candidates", { p_pending_only: true });
  if (error) throw new Error(error.message);
  return data.map((row) => ({
    applicationId: row.application_id,
    presentedAt: row.presented_at,
    stage: row.stage,
    candidateName: row.full_name || "Candidate",
    candidateTitle: row.current_title,
    vacancyId: row.vacancy_id,
    vacancyTitle: row.vacancy_title,
  }));
});

export const getPortalVacancy = cache(async (id: string): Promise<PortalVacancyDetail | null> => {
  await requireClient();
  if (!isUuid(id)) return null;
  const supabase = await createClient();

  const { data: rows, error } = await supabase.rpc("portal_vacancy", { p_vacancy_id: id });
  if (error) throw new Error(error.message);
  const vacancy = rows[0];
  if (!vacancy) return null;

  const { data: applications, error: appError } = await supabase.rpc("portal_candidates", { p_vacancy_id: vacancy.id });
  if (appError) throw new Error(appError.message);

  const candidates: PortalCandidate[] = applications.map((a) => ({
    applicationId: a.application_id,
    stage: a.stage,
    technicalScore: a.technical_score,
    englishScore: a.english_score,
    presentedAt: a.presented_at,
    decision: a.client_decision,
    feedback: a.client_feedback,
    decidedAt: a.client_decided_at,
    candidate: {
      id: a.candidate_id,
      fullName: a.full_name,
      currentTitle: a.current_title,
      location: a.location,
      yearsExperience: a.years_experience,
      skills: a.skills,
      videoUrl: safeExternalUrl(a.video_url),
      summary: a.summary,
      hasCv: a.has_cv,
    },
  }));

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
  await requireClient();
  if (!isUuid(applicationId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_cv_path", { p_application_id: applicationId });
  if (error || !data) return null;
  return data;
}

export const getPortalPlacements = cache(async (): Promise<PortalPlacement[]> => {
  await requireClient();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_placements");
  if (error) throw new Error(error.message);
  return data.map((p) => ({
    id: p.id,
    startDate: p.start_date,
    endDate: p.end_date,
    status: p.status,
    noticeGivenAt: p.notice_given_at,
    guaranteeUntil: p.guarantee_until,
    monthlyRate: p.monthly_rate,
    candidateName: p.candidate_name,
    candidateTitle: p.candidate_title,
    vacancyTitle: p.vacancy_title,
  }));
});

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
