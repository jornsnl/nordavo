import "server-only";
import { requireStaff } from "@/lib/auth";
import type { ApplicationStage } from "@/lib/database.types";
import { daysBetween } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/data/candidates";

/** Stages that count as "presented to the client" for the 3 candidates promise. */
export const PRESENTED_STAGES: ApplicationStage[] = ["presented", "final_interview", "placed"];

/** Every application of one candidate, across vacancies. */
export async function listCandidateApplications(candidateId: string) {
  await requireStaff();
  if (!isUuid(candidateId)) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    .select(
      `id, stage, technical_score, english_score, client_decision, presented_at, created_at,
       vacancy:vacancies(id, title, status, client:clients(id, name))`,
    )
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Sollicitaties laden mislukt: ${error.message}`);
  return data;
}

export type CandidateApplication = Awaited<ReturnType<typeof listCandidateApplications>>[number];

/** Open vacancies to link a candidate to. */
export async function listOpenVacancyOptions() {
  await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vacancies")
    .select("id, title, status, client:clients(name)")
    .in("status", ["open", "on_hold"])
    .order("opened_at", { ascending: false });

  if (error) throw new Error(`Vacatures laden mislukt: ${error.message}`);
  return data.map((v) => ({
    id: v.id,
    title: v.title,
    status: v.status,
    clientName: v.client?.name ?? "Onbekende klant",
  }));
}

export type VacancyOption = Awaited<ReturnType<typeof listOpenVacancyOptions>>[number];

/** Vacancy header plus every application on its board. */
export async function getPipeline(vacancyId: string) {
  await requireStaff();
  if (!isUuid(vacancyId)) return null;
  const supabase = await createClient();

  const [vacancyResult, applicationsResult] = await Promise.all([
    supabase
      .from("vacancies")
      .select("id, title, status, client:clients(id, name)")
      .eq("id", vacancyId)
      .maybeSingle(),
    supabase
      .from("applications")
      .select(
        `id, stage, position, technical_score, english_score, assessment_notes,
         presented_at, client_decision, client_feedback, client_decided_at,
         rejection_reason, created_at,
         candidate:candidates(id, full_name, current_title, years_experience, skills)`,
      )
      .eq("vacancy_id", vacancyId)
      .order("position")
      .order("created_at"),
  ]);

  if (vacancyResult.error) {
    throw new Error(`Vacature laden mislukt: ${vacancyResult.error.message}`);
  }
  if (applicationsResult.error) {
    throw new Error(`Pipeline laden mislukt: ${applicationsResult.error.message}`);
  }
  if (!vacancyResult.data) return null;

  const now = new Date();
  const applications = applicationsResult.data.flatMap(({ candidate, created_at, ...rest }) =>
    candidate
      ? [{ ...rest, created_at, candidate, daysInPipeline: Math.max(0, daysBetween(created_at, now)) }]
      : [],
  );

  return { vacancy: vacancyResult.data, applications };
}

export type PipelineData = NonNullable<Awaited<ReturnType<typeof getPipeline>>>;
export type PipelineApplication = PipelineData["applications"][number];

/** The vacancy an application belongs to, to deep link into its board. */
export async function getApplicationVacancyId(applicationId: string) {
  await requireStaff();
  if (!isUuid(applicationId)) return null;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    .select("vacancy_id")
    .eq("id", applicationId)
    .maybeSingle();

  if (error) throw new Error(`Sollicitatie laden mislukt: ${error.message}`);
  return data?.vacancy_id ?? null;
}
