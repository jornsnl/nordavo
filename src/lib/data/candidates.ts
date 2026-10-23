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
const CLOSED_STAGES: ApplicationStage[] = ["placed", "rejected"];

export type CandidateFilter = {
  q?: string;
  status?: CandidateStatus;
  skill?: string;
};

export async function listCandidates({ q, status, skill }: CandidateFilter) {
  await requireStaff();
  const supabase = await createClient();

  let query = supabase
    .from("candidates")
    .select(
      "id, full_name, current_title, years_experience, skills, status, location, applications(stage)",
    )
    .order("full_name");

  if (status) query = query.eq("status", status);
  if (skill) query = query.contains("skills", [skill]);

  const { data, error } = await query;
  if (error) throw new Error(`Kandidaten laden mislukt: ${error.message}`);

  // Search runs here so it is case-insensitive and partial on skills too,
  // which PostgREST cannot do on a text[] column.
  const term = q?.trim().toLowerCase();
  const rows = term
    ? data.filter(
        (c) =>
          c.full_name.toLowerCase().includes(term) ||
          (c.current_title ?? "").toLowerCase().includes(term) ||
          c.skills.some((s) => s.toLowerCase().includes(term)),
      )
    : data;

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
  if (error) throw new Error(`Skills laden mislukt: ${error.message}`);

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

  if (error) throw new Error(`Kandidaat laden mislukt: ${error.message}`);
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

  if (error) throw new Error(`Teamleden laden mislukt: ${error.message}`);
  return data.map((p) => ({ id: p.id, name: p.full_name || p.email || "Teamlid" }));
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

  if (error) throw new Error(`Kandidaten laden mislukt: ${error.message}`);
  return data;
}

export type CandidateOption = Awaited<ReturnType<typeof listCandidateOptions>>[number];
