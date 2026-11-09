import "server-only";
import { getCurrentUser, hasModule, requireStaff } from "@/lib/auth";
import type {
  AcademyAtsEventRow,
  AcademyAtsSettingsRow,
  AcademyGroupSettingsRow,
  AcademyReminderRow,
  AcademyRetentionLogRow,
  AdminPeopleRow,
  AdminRollupRow,
  AtsPoolRow,
  AtsProgress,
  FunnelRow,
} from "@/lib/academy/ats/database";
import { type PoolFilters, POOL_PAGE_SIZE, poolArgs } from "@/lib/academy/ats/pool";
import { requireAcademyManager } from "@/lib/academy/auth";
import type { AcademyModuleState } from "@/lib/academy/database";
import { createClient } from "@/lib/supabase/server";

// Reads of the Academy and ATS link (docs/academy.md, ATS-koppeling). The
// ATS side (candidate card, talent pool) is for the recruitment team and
// Academy managers; the database functions check it again
// (academy_ats_can_read). Managing (enrol, open modules, settings,
// overviews) is for Academy managers.

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`Could not load ${what}: ${error?.message ?? "unknown error"}`);
}

export type PersonModule = {
  module_id: string;
  course_id: string;
  title: string;
  position: number;
  status: string;
  in_default_access: boolean;
  state: AcademyModuleState | null;
  completed_at: string | null;
  open_row: boolean;
  force: boolean;
};

export type PersonDetailJson = {
  member: {
    profile_id: string;
    academy_role: string;
    locale: string;
    start_date: string | null;
    candidate_id: string | null;
    invited_at: string | null;
    created_at: string;
    last_activity_at: string | null;
    email: string | null;
    full_name: string | null;
  };
  developer_course_id: string | null;
  courses: { course_id: string; title: string; status: string; scope: "all" | "default"; done: boolean }[];
  modules: PersonModule[];
  lessons: { lesson_id: string; title: string; percent: number; started_at: string; last_viewed_at: string | null; completed_at: string | null }[];
  checks: { block_id: string; title: string; lesson_title: string; attempts: number; best_percent: number; last_percent: number; last_at: string }[];
  assignments: {
    submission_id: string;
    block_id: string;
    title: string;
    lesson_id: string;
    lesson_title: string;
    attempt: number;
    status: "submitted" | "changes_requested" | "approved";
    submitted_at: string;
    feedback_at: string | null;
    final_score: number | null;
    link_url: string | null;
    file_name: string | null;
    ai_total: number | null;
    ai_status: string;
  }[];
  videos: { video_id: string; title: string; percent: number; completed_at: string | null; updated_at: string | null }[];
  certificates: { course_id: string; number: string; issued_at: string }[];
  groups: { group_id: string; name: string; kind: string }[];
};

export type CandidateAcademy = {
  summary: AtsProgress | null;
  person: PersonDetailJson | null;
  events: Pick<AcademyAtsEventRow, "id" | "kind" | "status" | "created_at" | "processed_at" | "error" | "result">[];
};

/** The Academy card on the candidate page. */
export async function getCandidateAcademy(candidateId: string) {
  const user = await requireStaff();
  const supabase = await createClient();
  const canManage = hasModule(user, "academy");
  const [{ data, error }, groups, settings, courseId] = await Promise.all([
    supabase.rpc("academy_ats_candidate_detail", { p_candidate_id: candidateId }),
    canManage ? supabase.from("academy_groups").select("id, name, kind").order("name") : Promise.resolve({ data: [] as { id: string; name: string; kind: string }[] }),
    supabase.from("academy_ats_settings").select("top_candidate_module_ids").maybeSingle(),
    supabase.rpc("academy_ats_developer_course"),
  ]);
  if (error) fail("the Academy results", error);
  const developerCourseId = (courseId.data as string | null) ?? null;
  const { data: modules } =
    canManage && developerCourseId
      ? await supabase.from("academy_modules").select("id, title, position, in_default_access").eq("course_id", developerCourseId).order("position")
      : { data: [] as { id: string; title: string; position: number; in_default_access: boolean }[] };
  const detail = (data ?? null) as CandidateAcademy | null;
  return {
    detail,
    canManage,
    groups: groups.data ?? [],
    topModuleIds: settings.data?.top_candidate_module_ids ?? [],
    developerCourseId,
    modules: modules ?? [],
  };
}

export type PoolPage = { rows: AtsPoolRow[]; total: number };

/** One page of the talent pool with Academy columns. */
export async function listAcademyPool(filters: PoolFilters): Promise<PoolPage> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_ats_pool", poolArgs(filters, POOL_PAGE_SIZE));
  if (error) fail("the talent pool", error);
  const rows = data ?? [];
  if (rows.length === 0 && filters.page > 1) return { rows, total: -1 };
  return { rows, total: rows[0]?.total_count ?? 0 };
}

/** Every candidate id that matches the filters (bulk actions on the whole list), at most 5000. */
export async function listAcademyPoolIds(filters: PoolFilters): Promise<string[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_ats_pool", { ...poolArgs(filters, 500), p_offset: 0, p_limit: 500 });
  if (error) fail("the talent pool", error);
  const total = data?.[0]?.total_count ?? 0;
  const ids = (data ?? []).map((r) => r.candidate_id);
  for (let offset = 500; offset < Math.min(total, 5000); offset += 500) {
    const page = await supabase.rpc("academy_ats_pool", { ...poolArgs(filters, 500), p_offset: offset, p_limit: 500 });
    if (page.error) fail("the talent pool", page.error);
    ids.push(...(page.data ?? []).map((r) => r.candidate_id));
  }
  return ids;
}

/** Academy columns for the candidate list (ids of the rows shown). */
export async function listAcademyColumns(candidateIds: string[]) {
  if (candidateIds.length === 0) return new Map<string, { enrolled: boolean; progress: number; inactive: boolean; certificate: boolean }>();
  const supabase = await createClient();
  const result = new Map<string, { enrolled: boolean; progress: number; inactive: boolean; certificate: boolean }>();
  // In chunks: the ids go in the request.
  for (let i = 0; i < candidateIds.length; i += 1000) {
    const { data } = await supabase.rpc("academy_ats_columns", { p_candidate_ids: candidateIds.slice(i, i + 1000) });
    for (const row of data ?? []) {
      result.set(row.candidate_id, { enrolled: row.enrolled, progress: row.progress_percent, inactive: row.inactive_14d, certificate: row.certificate });
    }
  }
  return result;
}

/** Filter options: open vacancies and groups (names only). */
export async function listPoolOptions() {
  const user = await requireStaff();
  const supabase = await createClient();
  const [vacancies, groups, courses] = await Promise.all([
    supabase.from("vacancies").select("id, title, status, client:clients(name)").order("opened_at", { ascending: false }).limit(300),
    hasModule(user, "academy") ? supabase.from("academy_groups").select("id, name, kind").order("name") : Promise.resolve({ data: [] }),
    hasModule(user, "academy")
      ? supabase.rpc("academy_ats_developer_course").then(async ({ data: courseId }) =>
          courseId
            ? supabase.from("academy_modules").select("id, title, position, in_default_access").eq("course_id", courseId).order("position")
            : { data: [] },
        )
      : Promise.resolve({ data: [] }),
  ]);
  return {
    vacancies: (vacancies.data ?? []).map((v) => ({ id: v.id, title: v.title, status: v.status, clientName: v.client?.name ?? null })),
    groups: (groups.data ?? []) as { id: string; name: string; kind: string }[],
    modules: (courses.data ?? []) as { id: string; title: string; position: number; in_default_access: boolean }[],
    canManage: hasModule(user, "academy"),
  };
}

// ---------------------------------------------------------------------------
// Academy managers
// ---------------------------------------------------------------------------

export async function getAtsSettings(): Promise<AcademyAtsSettingsRow> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data, error } = await supabase.from("academy_ats_settings").select("*").maybeSingle();
  if (error || !data) fail("the settings", error);
  return data;
}

export async function listAtsEvents({ status, limit = 50 }: { status?: string; limit?: number } = {}) {
  await requireAcademyManager();
  const supabase = await createClient();
  let query = supabase.from("academy_ats_events").select("*").order("created_at", { ascending: false }).limit(limit);
  if (status === "pending" || status === "done" || status === "skipped" || status === "failed") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) fail("the automation log", error);
  const candidateIds = [...new Set((data ?? []).map((e) => e.candidate_id).filter((id): id is string => Boolean(id)))];
  const { data: names } = candidateIds.length
    ? await supabase.rpc("academy_candidate_names", { p_candidate_ids: candidateIds })
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((names ?? []).map((n) => [n.id, n.full_name]));
  return (data ?? []).map((e) => ({ ...e, candidateName: e.candidate_id ? (nameById.get(e.candidate_id) ?? null) : null }));
}

export type AtsEventItem = Awaited<ReturnType<typeof listAtsEvents>>[number];

export async function getRetentionOverview() {
  await requireAcademyManager();
  const supabase = await createClient();
  const [preview, log] = await Promise.all([
    supabase.rpc("academy_retention_preview"),
    supabase.from("academy_retention_log").select("*").order("created_at", { ascending: false }).limit(30),
  ]);
  return {
    due: preview.data?.[0]?.due ?? 0,
    oldest: preview.data?.[0]?.oldest ?? null,
    log: (log.data ?? []) as AcademyRetentionLogRow[],
  };
}

export async function listRecentReminders(limit = 30) {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data } = await supabase.from("academy_reminders").select("*").order("sent_at", { ascending: false }).limit(limit);
  const rows = (data ?? []) as AcademyReminderRow[];
  const ids = [...new Set(rows.map((r) => r.profile_id))];
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email || "Unknown"]));
  return rows.map((r) => ({ ...r, name: byId.get(r.profile_id) ?? "Unknown" }));
}

export async function listAdminPeople(filter: { clientId?: string; groupId?: string; role?: string; courseId?: string } = {}): Promise<AdminPeopleRow[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_admin_people", {
    p_client_id: filter.clientId ?? null,
    p_group_id: filter.groupId ?? null,
    p_role: filter.role ?? null,
    p_course_id: filter.courseId ?? null,
  });
  if (error) fail("the overview", error);
  return data ?? [];
}

export async function listAdminRollup(by: "client" | "group"): Promise<AdminRollupRow[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_admin_rollup", { p_by: by });
  if (error) fail("the overview", error);
  return data ?? [];
}

export async function getLessonFunnel(courseId: string, filter: { groupId?: string; clientId?: string } = {}): Promise<FunnelRow[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_lesson_funnel", {
    p_course_id: courseId,
    p_group_id: filter.groupId ?? null,
    p_client_id: filter.clientId ?? null,
  });
  if (error) fail("the funnel", error);
  return data ?? [];
}

export type GroupReport = {
  course_id: string | null;
  members: number;
  summary: {
    candidates: number;
    started: number;
    completed: number;
    inactive: number;
    certificates: number;
    avg_progress: number | null;
    avg_check: number | null;
    avg_final: number | null;
    avg_lead_time_days: number | null;
  };
  check_distribution: Record<string, number>;
  final_distribution: Record<string, number>;
  funnel: FunnelRow[];
};

export async function getGroupReport(groupId: string) {
  await requireAcademyManager();
  const supabase = await createClient();
  const [report, group, settings] = await Promise.all([
    supabase.rpc("academy_group_report", { p_group_id: groupId }),
    supabase.from("academy_groups").select("*").eq("id", groupId).maybeSingle(),
    supabase.from("academy_group_settings").select("*").eq("group_id", groupId).maybeSingle(),
  ]);
  if (report.error) fail("the group report", report.error);
  if (!group.data) return null;
  return {
    group: group.data,
    settings: (settings.data ?? null) as AcademyGroupSettingsRow | null,
    report: report.data as unknown as GroupReport,
  };
}

/** The person detail (progress per lesson, checks, assignments, videos) for the person page. */
export async function getPersonProgress(profileId: string): Promise<PersonDetailJson | null> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data } = await supabase.rpc("academy_person_detail", { p_profile_id: profileId });
  return (data ?? null) as PersonDetailJson | null;
}

/** The automation of one placement, for the placement page. */
export async function getPlacementAutomation(placementId: string) {
  const user = await getCurrentUser();
  if (!hasModule(user, "recruitment") && !hasModule(user, "academy")) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("academy_ats_events").select("*").eq("placement_id", placementId).maybeSingle();
  return { event: data ?? null, canManage: hasModule(user, "academy") };
}

/** Courses for the overview pickers. */
export async function listOverviewOptions() {
  await requireAcademyManager();
  const supabase = await createClient();
  const [courses, groups, clients, developerCourse] = await Promise.all([
    supabase.from("academy_courses").select("id, title, status").order("position"),
    supabase.from("academy_groups").select("id, name").order("name"),
    supabase.rpc("academy_client_options"),
    supabase.rpc("academy_ats_developer_course"),
  ]);
  return {
    courses: courses.data ?? [],
    groups: groups.data ?? [],
    clients: (clients.data ?? []) as { id: string; name: string }[],
    developerCourseId: (developerCourse.data as string | null) ?? null,
  };
}

