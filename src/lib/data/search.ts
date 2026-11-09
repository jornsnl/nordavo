import "server-only";
import { requireStaff } from "@/lib/auth";
import { entityTypes } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

/** Record types you can search for and link a task to. */
export const searchableTypes = ["company", "client", "vacancy", "candidate", "placement"] as const;
export type SearchableType = (typeof searchableTypes)[number];

export type RecordHit = {
  /** "task" is a Work task, found by the command palette only. */
  type: SearchableType | "task";
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
};

export type SearchGroups = Record<SearchableType | "task", RecordHit[]>;

/** A resolved link to any record that tasks, notes or the activity log point at. */
export type RecordLink = { label: string; sublabel: string | null; href: string | null };

export function isSearchableType(value: unknown): value is SearchableType {
  return searchableTypes.includes(value as SearchableType);
}

/**
 * Turn free text into a safe ilike pattern. Characters that have a meaning
 * in PostgREST filter strings are dropped, wildcards are escaped.
 */
function searchPattern(raw: string) {
  const cleaned = raw
    .replace(/[,()"'*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (cleaned.length < 2) return null;
  return `%${cleaned.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function applicationHref(vacancyId: string) {
  return `/dashboard/vacancies/${vacancyId}/pipeline`;
}

async function searchType(type: SearchableType, pattern: string, limit: number): Promise<RecordHit[]> {
  const supabase = await createClient();

  if (type === "company") {
    const { data } = await supabase
      .from("companies")
      .select("id, name, domain")
      .or(`name.ilike.${pattern},domain.ilike.${pattern}`)
      .order("icp_score", { ascending: false, nullsFirst: false })
      .limit(limit);
    return (data ?? []).map((c) => ({
      type,
      id: c.id,
      label: c.name,
      sublabel: c.domain,
      href: entityTypes.company.href(c.id),
    }));
  }

  if (type === "client") {
    const { data } = await supabase
      .from("clients")
      .select("id, name, city")
      .ilike("name", pattern)
      .order("name")
      .limit(limit);
    return (data ?? []).map((c) => ({
      type,
      id: c.id,
      label: c.name,
      sublabel: c.city,
      href: entityTypes.client.href(c.id),
    }));
  }

  if (type === "vacancy") {
    const { data } = await supabase
      .from("vacancies")
      .select("id, title, client:clients(name)")
      .ilike("title", pattern)
      .order("opened_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((v) => ({
      type,
      id: v.id,
      label: v.title,
      sublabel: v.client?.name ?? null,
      href: entityTypes.vacancy.href(v.id),
    }));
  }

  if (type === "candidate") {
    const { data } = await supabase
      .from("candidates")
      .select("id, full_name, current_title")
      .or(`full_name.ilike.${pattern},current_title.ilike.${pattern}`)
      .order("full_name")
      .limit(limit);
    return (data ?? []).map((c) => ({
      type,
      id: c.id,
      label: c.full_name,
      sublabel: c.current_title,
      href: entityTypes.candidate.href(c.id),
    }));
  }

  // Placements are found through the name of the placed candidate.
  const { data: candidates } = await supabase
    .from("candidates")
    .select("id")
    .ilike("full_name", pattern)
    .limit(50);
  const ids = (candidates ?? []).map((c) => c.id);
  if (ids.length === 0) return [];

  const { data } = await supabase
    .from("placements")
    .select("id, start_date, candidate:candidates(full_name), client:clients(name)")
    .in("candidate_id", ids)
    .order("start_date", { ascending: false })
    .limit(limit);
  return (data ?? []).map((p) => ({
    type: "placement" as const,
    id: p.id,
    label: p.candidate?.full_name ?? "Placement",
    sublabel: p.client?.name ? `at ${p.client.name}` : null,
    href: entityTypes.placement.href(p.id),
  }));
}

/** Work tasks the user can open, by title, description or comment (work_search). */
async function searchWorkTasks(query: string, limit: number): Promise<RecordHit[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("work_search", { p_query: query.trim().slice(0, 80), p_limit: limit });
  return (data ?? []).map((t) => ({
    type: "task" as const,
    id: t.id,
    label: t.title,
    sublabel: t.due_at ? `Due ${t.due_at.slice(0, 10)}` : null,
    href: `/work/tasks/${t.id}`,
  }));
}

export const emptySearchGroups: SearchGroups = { company: [], client: [], vacancy: [], candidate: [], placement: [], task: [] };

/** Global search for the command palette: a few hits per record type, and Work tasks. */
export async function searchEverything(query: string, perGroup = 5): Promise<SearchGroups> {
  await requireStaff();
  const pattern = searchPattern(query);
  if (!pattern) return emptySearchGroups;

  const [[company, client, vacancy, candidate, placement], task] = await Promise.all([
    Promise.all(searchableTypes.map((type) => searchType(type, pattern, perGroup))),
    searchWorkTasks(query, perGroup),
  ]);
  return { company, client, vacancy, candidate, placement, task };
}

/** Search one record type, for the record picker on tasks. */
export async function searchRecordsOfType(type: SearchableType, query: string, limit = 8) {
  await requireStaff();
  const pattern = searchPattern(query);
  if (!pattern) return [];
  return searchType(type, pattern, limit);
}

export const recordKey = (type: string, id: string) => `${type}:${id}`;

/**
 * Resolve labels and links for a mixed list of records in a few queries.
 * Unknown or deleted records are simply missing from the map.
 * Also understands "task" (a Work task), which the activity log uses. Old
 * log rows point at the portal task before it moved to Work; those are found
 * through work_tasks.external_id.
 */
export async function resolveRecords(
  refs: { type: string; id: string }[],
): Promise<Map<string, RecordLink>> {
  await requireStaff();
  const supabase = await createClient();
  const result = new Map<string, RecordLink>();

  const idsOf = (type: string) => [...new Set(refs.filter((r) => r.type === type).map((r) => r.id))];
  const companyIds = idsOf("company");
  const clientIds = idsOf("client");
  const vacancyIds = idsOf("vacancy");
  const candidateIds = idsOf("candidate");
  const placementIds = idsOf("placement");
  const applicationIds = idsOf("application");
  const taskIds = idsOf("task");

  await Promise.all([
    companyIds.length > 0 &&
      supabase
        .from("companies")
        .select("id, name, domain")
        .in("id", companyIds)
        .then(({ data }) => {
          for (const c of data ?? []) {
            result.set(recordKey("company", c.id), {
              label: c.name,
              sublabel: c.domain,
              href: entityTypes.company.href(c.id),
            });
          }
        }),
    clientIds.length > 0 &&
      supabase
        .from("clients")
        .select("id, name, city")
        .in("id", clientIds)
        .then(({ data }) => {
          for (const c of data ?? []) {
            result.set(recordKey("client", c.id), {
              label: c.name,
              sublabel: c.city,
              href: entityTypes.client.href(c.id),
            });
          }
        }),
    vacancyIds.length > 0 &&
      supabase
        .from("vacancies")
        .select("id, title, client:clients(name)")
        .in("id", vacancyIds)
        .then(({ data }) => {
          for (const v of data ?? []) {
            result.set(recordKey("vacancy", v.id), {
              label: v.title,
              sublabel: v.client?.name ?? null,
              href: entityTypes.vacancy.href(v.id),
            });
          }
        }),
    candidateIds.length > 0 &&
      supabase
        .from("candidates")
        .select("id, full_name, current_title")
        .in("id", candidateIds)
        .then(({ data }) => {
          for (const c of data ?? []) {
            result.set(recordKey("candidate", c.id), {
              label: c.full_name,
              sublabel: c.current_title,
              href: entityTypes.candidate.href(c.id),
            });
          }
        }),
    placementIds.length > 0 &&
      supabase
        .from("placements")
        .select("id, candidate:candidates(full_name), client:clients(name)")
        .in("id", placementIds)
        .then(({ data }) => {
          for (const p of data ?? []) {
            result.set(recordKey("placement", p.id), {
              label: p.candidate?.full_name ?? "Placement",
              sublabel: p.client?.name ? `at ${p.client.name}` : null,
              href: entityTypes.placement.href(p.id),
            });
          }
        }),
    applicationIds.length > 0 &&
      supabase
        .from("applications")
        .select("id, vacancy_id, candidate:candidates(full_name), vacancy:vacancies(title)")
        .in("id", applicationIds)
        .then(({ data }) => {
          for (const a of data ?? []) {
            result.set(recordKey("application", a.id), {
              label: a.candidate?.full_name ?? "Application",
              sublabel: a.vacancy?.title ? `for ${a.vacancy.title}` : null,
              href: applicationHref(a.vacancy_id),
            });
          }
        }),
    taskIds.length > 0 &&
      supabase
        .from("work_tasks")
        .select("id, title")
        .in("id", taskIds)
        .then(({ data }) => {
          for (const t of data ?? []) {
            result.set(recordKey("task", t.id), { label: t.title, sublabel: null, href: `/work/tasks/${t.id}` });
          }
        }),
    taskIds.length > 0 &&
      supabase
        .from("work_tasks")
        .select("id, title, external_id")
        .eq("external_source", "portal_tasks")
        .in("external_id", taskIds)
        .then(({ data }) => {
          for (const t of data ?? []) {
            if (!t.external_id) continue;
            result.set(recordKey("task", t.external_id), { label: t.title, sublabel: null, href: `/work/tasks/${t.id}` });
          }
        }),
  ]);

  return result;
}
