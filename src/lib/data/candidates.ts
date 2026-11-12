import "server-only";
import { requireStaff } from "@/lib/auth";
import type { ApplicationStage, CandidateStatus } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guard against malformed ids, which Postgres rejects with an error. */
export function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

/** Stages that no longer count as an active application. */
const CLOSED_STAGES: ApplicationStage[] = ["placed", "parked", "rejected"];

export type CandidateFilter = {
  q?: string;
  status?: CandidateStatus;
  skill?: string;
  /** Only candidates marked as topper (2.13). */
  toppers?: boolean;
};

export async function listCandidates({ q, status, skill, toppers }: CandidateFilter) {
  await requireStaff();
  const supabase = await createClient();

  let query = supabase
    .from("candidates")
    .select(
      "id, full_name, current_title, years_experience, skills, status, location, is_topper, topper_reason, applications(stage)",
    )
    .order("full_name");

  if (status) query = query.eq("status", status);
  if (toppers) query = query.eq("is_topper", true);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load candidates: ${error.message}`);

  // Search and skill filter run here so they are case-insensitive (and partial
  // for search) on skills too, which PostgREST cannot do on a text[] column.
  const term = q?.trim().toLowerCase();
  const skillKey = skill?.trim().toLowerCase();
  const rows = data.filter(
    (c) =>
      (!skillKey || c.skills.some((s) => s.toLowerCase() === skillKey)) &&
      (!term ||
        c.full_name.toLowerCase().includes(term) ||
        (c.current_title ?? "").toLowerCase().includes(term) ||
        c.skills.some((s) => s.toLowerCase().includes(term))),
  );

  return rows.map(({ applications, ...candidate }) => ({
    ...candidate,
    activeApplications: applications.filter((a) => !CLOSED_STAGES.includes(a.stage)).length,
  }));
}

export type CandidateListItem = Awaited<ReturnType<typeof listCandidates>>[number];

/** Every distinct skill, for the skill filter. */
export async function listCandidateSkills() {
  await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase.from("candidates").select("skills");
  if (error) throw new Error(`Could not load skills: ${error.message}`);

  const unique = new Map<string, string>();
  for (const row of data) {
    for (const skill of row.skills) {
      const key = skill.toLowerCase();
      if (!unique.has(key)) unique.set(key, skill);
    }
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b, "nl"));
}

export async function getCandidate(id: string) {
  await requireStaff();
  if (!isUuid(id)) return null;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("candidates")
    .select("*, owner:profiles(id, full_name, email)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load candidate: ${error.message}`);
  return data;
}

export type CandidateDetail = NonNullable<Awaited<ReturnType<typeof getCandidate>>>;

/** Nordavo team members, for the owner picker. */
export async function listStaffOptions() {
  await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("role", ["admin", "member"])
    .order("full_name");

  if (error) throw new Error(`Could not load team members: ${error.message}`);
  return data.map((p) => ({ id: p.id, name: p.full_name || p.email || "Team member" }));
}

/** Lightweight list for pickers, e.g. adding a candidate to a pipeline. */
export async function listCandidateOptions() {
  await requireStaff();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("candidates")
    .select("id, full_name, current_title, years_experience, skills, status")
    .order("full_name")
    .limit(1000);

  if (error) throw new Error(`Could not load candidates: ${error.message}`);
  return data;
}

export type CandidateOption = Awaited<ReturnType<typeof listCandidateOptions>>[number];

/** Video intro copies uploaded to the portal (attachments of kind video), newest first. */
export async function listCandidateVideos(candidateId: string) {
  await requireStaff();
  if (!isUuid(candidateId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attachments")
    .select("id, file_name, created_at, uploader:profiles(full_name, email)")
    .eq("entity_type", "candidate")
    .eq("entity_id", candidateId)
    .eq("kind", "video")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load videos: ${error.message}`);
  return data.map((a) => ({
    id: a.id,
    fileName: a.file_name,
    createdAt: a.created_at,
    uploaderName: a.uploader?.full_name || a.uploader?.email || "Unknown",
  }));
}

/** The next planned interview of any of these applications, or null. */
export async function getNextInterview(applicationIds: string[]) {
  await requireStaff();
  if (applicationIds.length === 0) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("interviews")
    .select("id, kind, starts_at, application_id")
    .in("application_id", applicationIds)
    .gte("starts_at", new Date().toISOString())
    .in("status", ["scheduled", "rescheduled"])
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data;
}
