import "server-only";
import { requireStaff } from "@/lib/auth";
import { daysBetween } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/data/candidates";
import { readScreeningTools } from "@/lib/recruitment/pipeline";

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

  if (error) throw new Error(`Could not load applications: ${error.message}`);
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

  if (error) throw new Error(`Could not load vacancies: ${error.message}`);
  return data.map((v) => ({
    id: v.id,
    title: v.title,
    status: v.status,
    clientName: v.client?.name ?? "Unknown client",
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
      .select("id, title, status, park_reason, parked_at, client:clients(id, name)")
      .eq("id", vacancyId)
      .maybeSingle(),
    supabase
      .from("applications")
      .select(
        `id, stage, position, technical_score, english_score, assessment_notes,
         presented_at, client_decision, client_feedback, client_decided_at,
         rejection_reason, created_at,
         origin, source, form_sent_at, form_completed_at, cv_score, cv_verdict, cv_scored_at,
         video_score, video_notes, interview_at, shortlisted_at,
         background_check_status, background_check_notes,
         exit_from_stage, park_reason, park_until, parked_at, rejected_at,
         candidate:candidates(id, full_name, current_title, years_experience, skills, is_topper, topper_reason, topper_at, video_url),
         assessment:application_assessments(*)`,
      )
      .eq("vacancy_id", vacancyId)
      .order("position")
      .order("created_at"),
  ]);

  if (vacancyResult.error) {
    throw new Error(`Could not load vacancy: ${vacancyResult.error.message}`);
  }
  if (applicationsResult.error) {
    throw new Error(`Could not load pipeline: ${applicationsResult.error.message}`);
  }
  if (!vacancyResult.data) return null;

  const now = new Date();
  const applications = applicationsResult.data.flatMap(({ candidate, created_at, assessment, ...rest }) =>
    candidate
      ? [
          {
            ...rest,
            created_at,
            candidate,
            assessment: assessment ? { ...assessment, screening_tools: readScreeningTools(assessment.screening_tools) } : null,
            testScore: assessment?.test_score ?? null,
            daysInPipeline: Math.max(0, daysBetween(created_at, now)),
          },
        ]
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

  if (error) throw new Error(`Could not load application: ${error.message}`);
  return data?.vacancy_id ?? null;
}
