import "server-only";
import { requireStaff } from "@/lib/auth";
import type { Match } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { getPoolCandidates, hasAirtable, type PoolCandidate } from "@/lib/integrations/airtable";
import { isUuid } from "@/lib/data/clients";
import { readProfileContent, type StoredProfileContent } from "@/lib/talent/profile";

/**
 * Matches for a vacancy with the candidate details read live from Airtable
 * (hard rule 11): names and details are rendered for staff and never stored.
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
  /** Live from Airtable; null when it could not be read or no longer exists. */
  candidate: PoolCandidate | null;
  /** Latest anonymous profile, if any. */
  profile: MatchProfile | null;
  profileCount: number;
};

export type VacancyMatches = {
  matches: MatchWithCandidate[];
  /** Set when Airtable could not be read; matches are still listed. */
  airtableError: string | null;
};

export async function listVacancyMatches(vacancyId: string): Promise<VacancyMatches> {
  await requireStaff();
  if (!isUuid(vacancyId)) return { matches: [], airtableError: null };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("matches")
    .select(
      "*, approver:profiles!matches_approved_by_fkey(full_name, email), anonymous_profiles(id, content, file_url, consent_confirmed, approved_at, approved_by, sent_at, created_at)",
    )
    .eq("vacancy_id", vacancyId)
    .order("score", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`Matches laden mislukt: ${error.message}`);

  let candidates = new Map<string, PoolCandidate>();
  let airtableError: string | null = null;
  if (data.length > 0) {
    if (!hasAirtable()) {
      airtableError = "Airtable is niet gekoppeld, dus kandidaatgegevens kunnen niet live worden getoond.";
    } else {
      try {
        candidates = await getPoolCandidates(data.map((m) => m.airtable_candidate_id));
      } catch (e) {
        airtableError = e instanceof Error ? e.message : "Airtable kon niet worden gelezen.";
      }
    }
  }

  const matches = data.map((m) => {
    const { approver, anonymous_profiles: profiles, ...match } = m;
    const latest = [...profiles].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return {
      ...match,
      approverName: approver ? approver.full_name || approver.email : null,
      candidate: candidates.get(m.airtable_candidate_id) ?? null,
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

  return { matches, airtableError };
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
