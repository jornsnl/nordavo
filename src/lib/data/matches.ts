import "server-only";
import { requireStaff } from "@/lib/auth";
import type { ApplicationStage, Match } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/data/clients";
import { mapPortalCandidate, type PoolCandidate } from "@/lib/talent/pool";
import { readProfileContent, type StoredProfileContent } from "@/lib/talent/profile";

/**
 * Matches for a vacancy (the T2 shortlist) with the portal candidate and,
 * when the candidate is already in the vacancy's pipeline, that application.
 */

export type MatchProfile = {
  id: string;
  content: StoredProfileContent | null;
  fileUrl: string | null;
  consentConfirmed: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type MatchWithCandidate = Match & {
  approverName: string | null;
  /** The portal candidate; null only if it could not be read. */
  candidate: PoolCandidate | null;
  /** The candidate's application on this vacancy, if they are in the pipeline. */
  application: { id: string; stage: ApplicationStage } | null;
  /** Latest anonymous profile, if any. */
  profile: MatchProfile | null;
  profileCount: number;
};

export async function listVacancyMatches(vacancyId: string): Promise<MatchWithCandidate[]> {
  await requireStaff();
  if (!isUuid(vacancyId)) return [];
  const supabase = await createClient();
  const [{ data, error }, { data: applications, error: applicationsError }] = await Promise.all([
    supabase
      .from("matches")
      .select(
        "*, approver:profiles!matches_approved_by_fkey(full_name, email), candidate:candidates(id, full_name, email, phone, location, current_title, years_experience, skills, cv_path, summary, status, seniority, employers, project_types, sectors, cv_text, english_level, availability, profile_consent), anonymous_profiles(id, content, file_url, consent_confirmed, approved_at, approved_by, sent_at, created_at)",
      )
      .eq("vacancy_id", vacancyId)
      .order("score", { ascending: false, nullsFirst: false }),
    supabase.from("applications").select("id, candidate_id, stage").eq("vacancy_id", vacancyId),
  ]);
  if (error) throw new Error(`Could not load matches: ${error.message}`);
  if (applicationsError) throw new Error(`Could not load the pipeline: ${applicationsError.message}`);

  const byCandidate = new Map((applications ?? []).map((a) => [a.candidate_id, { id: a.id, stage: a.stage }]));

  return data.map((m) => {
    const { approver, anonymous_profiles: profiles, candidate, ...match } = m;
    const latest = [...profiles].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return {
      ...match,
      approverName: approver ? approver.full_name || approver.email : null,
      candidate: candidate ? mapPortalCandidate(candidate) : null,
      application: byCandidate.get(m.candidate_id) ?? null,
      profileCount: profiles.length,
      profile: latest
        ? {
            id: latest.id,
            content: readProfileContent(latest.content),
            fileUrl: latest.file_url,
            consentConfirmed: latest.consent_confirmed,
            approvedAt: latest.approved_at,
            approvedBy: latest.approved_by,
            sentAt: latest.sent_at,
            createdAt: latest.created_at,
          }
        : null,
    };
  });
}

/** The storage path of a profile PDF, for the download route. */
export async function getProfileFile(profileId: string, vacancyId: string) {
  await requireStaff();
  if (!isUuid(profileId) || !isUuid(vacancyId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("anonymous_profiles")
    .select("file_url, content, match:matches!inner(vacancy_id)")
    .eq("id", profileId)
    .eq("match.vacancy_id", vacancyId)
    .maybeSingle();
  if (error || !data?.file_url) return null;
  return { path: data.file_url, code: readProfileContent(data.content)?.code ?? null };
}

/** The vacancies a candidate was matched to (T2), best score first. */
export async function listCandidateMatches(candidateId: string) {
  await requireStaff();
  if (!isUuid(candidateId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("matches")
    .select("id, score, status, created_at, vacancy:vacancies(id, title)")
    .eq("candidate_id", candidateId)
    .order("score", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`Could not load matches: ${error.message}`);
  return data;
}

/** When Match was pressed and Claude (task claude-match) has not saved matches yet; null otherwise. */
export async function getMatchRequestedAt(vacancyId: string): Promise<string | null> {
  await requireStaff();
  if (!isUuid(vacancyId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("vacancies").select("match_requested_at").eq("id", vacancyId).maybeSingle();
  return data?.match_requested_at ?? null;
}
