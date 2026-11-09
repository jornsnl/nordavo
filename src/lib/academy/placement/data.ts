import "server-only";
import type {
  AcademyDocumentCategory,
  AcademyDocumentRow,
  AcademyHolidayRow,
  AcademyLeaveBalanceRow,
  AcademyLeaveRequestRow,
  AcademyMilestoneRow,
  AcademyMyPlacementRow,
  AcademyPlacementRole,
  AcademyPulseAnswerRow,
  AcademyPulseRow,
  AcademyReviewRow,
  AcademyRitualLogRow,
  AcademyRitualRow,
} from "@/lib/academy/database";
import type { AcademyPlacementViewRow } from "@/lib/academy/placement/database";
import { type AcademyUser, requireAcademyManager } from "@/lib/academy/auth";
import { addDaysIso, localDateIso } from "@/lib/academy/time";
import { createClient } from "@/lib/supabase/server";

// Placement page, rituals and pulse (Academy: plaatsingspagina, rituelen,
// pulse). Learner reads go through RLS and academy_placement_view() as the
// signed-in user: no money ever leaves the database for clients or
// developers. Manager reads (the Academy tab of /dashboard/placements/[id])
// start with requireAcademyManager().

export const PLACEMENT_DOCUMENT_CATEGORIES: AcademyDocumentCategory[] = [
  "contract_summary",
  "gdpr",
  "policy",
  "escalation_matrix",
  "decision_matrix",
  "blocker_agreement",
];

export type PlacementPerson = { profile_id: string; full_name: string | null; email: string | null; role: AcademyPlacementRole };

export type PlacementDocument = AcademyDocumentRow & { file_name: string | null; isNew: boolean };

export type PlacementPage = {
  placement: AcademyPlacementViewRow;
  people: PlacementPerson[];
  rituals: AcademyRitualRow[];
  logs: AcademyRitualLogRow[];
  milestones: AcademyMilestoneRow[];
  reviews: AcademyReviewRow[];
  leave: AcademyLeaveRequestRow[];
  balances: AcademyLeaveBalanceRow[];
  holidays: AcademyHolidayRow[];
  documents: PlacementDocument[];
  /** Open pulse of the signed-in user (null when none). */
  pulse: AcademyPulseRow | null;
  calendarToken: string | null;
  today: string;
};

type ProfileName = { full_name: string | null; email: string | null; client_id: string | null };

async function profileNames(supabase: Supabase, ids: string[]): Promise<Map<string, ProfileName>> {
  const map = new Map<string, ProfileName>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await supabase.from("profiles").select("id, full_name, email, client_id").in("id", unique.slice(i, i + 200));
    for (const p of data ?? []) map.set(p.id, { full_name: p.full_name, email: p.email, client_id: p.client_id });
  }
  return map;
}

async function loadPulses(supabase: Supabase, placementId: string): Promise<PulseRow[]> {
  const { data: pulses } = await supabase.from("academy_pulses").select("*").eq("placement_id", placementId).order("period_start");
  const ids = (pulses ?? []).map((p) => p.id);
  const { data: answers } = ids.length ? await supabase.from("academy_pulse_answers").select("*").in("pulse_id", ids) : { data: [] };
  return (pulses ?? []).map((p) => ({ ...p, answer: (answers ?? []).find((a) => a.pulse_id === p.id) ?? null }));
}

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`Could not load ${what}: ${error?.message ?? "unknown error"}`);
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function loadDocuments(supabase: Supabase, placementId: string): Promise<PlacementDocument[]> {
  const { data, error } = await supabase
    .from("academy_documents")
    .select("*")
    .or(`placement_id.eq.${placementId},and(scope.eq.global,category.in.(${PLACEMENT_DOCUMENT_CATEGORIES.join(",")}))`)
    .order("category")
    .order("title");
  if (error) fail("documents", error);
  const docs = data ?? [];
  const { data: versions } = docs.length
    ? await supabase.from("academy_document_versions").select("document_id, version, file_name").in("document_id", docs.map((d) => d.id))
    : { data: [] };
  const now = Date.now();
  return docs.map((d) => ({
    ...d,
    file_name: (versions ?? []).find((v) => v.document_id === d.id && v.version === d.current_version)?.file_name ?? null,
    isNew: Boolean(d.new_until && new Date(d.new_until).getTime() > now),
  }));
}

/** Everything the placement page shows, for a member (or a manager, as preview). Null when not visible. */
export async function getPlacementPage(user: AcademyUser, placementId: string): Promise<PlacementPage | null> {
  const supabase = await createClient();
  const { data: view } = await supabase.rpc("academy_placement_view", { p_placement_id: placementId });
  const placement = (view ?? [])[0];
  if (!placement) return null;
  const today = localDateIso(new Date(), user.timeZone);
  const since = addDaysIso(today, -7 * 12);

  const [people, rituals, logs, milestones, reviews, leave, balances, holidays, documents, pulse, token] = await Promise.all([
    supabase.rpc("academy_placement_people", { p_placement_id: placementId }),
    supabase.from("academy_rituals").select("*").eq("placement_id", placementId).eq("active", true).order("position"),
    supabase.from("academy_ritual_logs").select("*").eq("placement_id", placementId).gte("period_date", since),
    supabase.from("academy_milestones").select("*").eq("placement_id", placementId).order("due_date").order("position"),
    supabase.from("academy_reviews").select("*").eq("placement_id", placementId),
    supabase.from("academy_leave_requests").select("*").eq("placement_id", placementId).order("start_date", { ascending: false }),
    supabase.from("academy_leave_balances").select("*").eq("placement_id", placementId),
    supabase.from("academy_holidays").select("*").gte("date", today).lte("date", addDaysIso(today, 120)).order("date"),
    loadDocuments(supabase, placementId),
    supabase
      .from("academy_pulses")
      .select("*")
      .eq("placement_id", placementId)
      .eq("profile_id", user.id)
      .is("answered_at", null)
      .gte("period_start", addDaysIso(today, -27))
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc("academy_calendar_token", { p_placement_id: placementId }),
  ]);
  if (rituals.error) fail("rituals", rituals.error);
  return {
    placement,
    people: (people.data ?? []) as PlacementPerson[],
    rituals: rituals.data ?? [],
    logs: logs.data ?? [],
    milestones: milestones.data ?? [],
    reviews: reviews.data ?? [],
    leave: leave.data ?? [],
    balances: balances.data ?? [],
    holidays: holidays.data ?? [],
    documents,
    pulse: pulse.data ?? null,
    calendarToken: (token.data as string | null) ?? null,
    today,
  };
}

// ---------------------------------------------------------------------------
// Start page sections
// ---------------------------------------------------------------------------

export type RitualsOverview = {
  placementId: string;
  role: AcademyPlacementRole;
  title: string;
  rituals: AcademyRitualRow[];
  logs: AcademyRitualLogRow[];
};

/** Rituals and this month's ticks of the user's placements. */
export async function listMyRituals(user: AcademyUser, placements: AcademyMyPlacementRow[]): Promise<RitualsOverview[]> {
  const active = placements.filter((p) => p.status !== "ended");
  if (active.length === 0) return [];
  const supabase = await createClient();
  const ids = active.map((p) => p.id);
  const since = addDaysIso(localDateIso(new Date(), user.timeZone), -40);
  const [rituals, logs] = await Promise.all([
    supabase.from("academy_rituals").select("*").in("placement_id", ids).eq("active", true).order("position"),
    supabase.from("academy_ritual_logs").select("*").in("placement_id", ids).gte("period_date", since),
  ]);
  return active.map((p) => ({
    placementId: p.id,
    role: p.my_role,
    title: (p.my_role === "developer" ? p.client_name : p.developer_name) ?? "",
    rituals: (rituals.data ?? []).filter((r) => r.placement_id === p.id),
    logs: (logs.data ?? []).filter((l) => l.placement_id === p.id),
  }));
}

export type UpcomingItem = {
  kind: "review" | "holiday" | "leave";
  date: string;
  endDate?: string;
  /** Milestone kind, holiday name or developer name. */
  label: string;
  milestoneKind?: AcademyMilestoneRow["kind"];
  country?: "NL" | "IN";
  status?: AcademyLeaveRequestRow["status"];
  placementId?: string;
  confirmed?: boolean;
  dayOff?: boolean;
};

/** Reviews, holidays and leave of the coming weeks. */
export async function listUpcoming(user: AcademyUser, placements: AcademyMyPlacementRow[]): Promise<UpcomingItem[]> {
  const supabase = await createClient();
  const today = localDateIso(new Date(), user.timeZone);
  const until = addDaysIso(today, 42);
  const ids = placements.filter((p) => p.status !== "ended").map((p) => p.id);
  const [milestones, holidays, leave] = await Promise.all([
    ids.length
      ? supabase.from("academy_milestones").select("*").in("placement_id", ids).is("completed_at", null).gte("due_date", addDaysIso(today, -7)).lte("due_date", until)
      : Promise.resolve({ data: [] as AcademyMilestoneRow[] }),
    supabase.from("academy_holidays").select("*").gte("date", today).lte("date", until).order("date").limit(20),
    ids.length
      ? supabase
          .from("academy_leave_requests")
          .select("*")
          .in("placement_id", ids)
          .in("status", ["requested", "client_agreed", "approved"])
          .gte("end_date", today)
          .lte("start_date", until)
      : Promise.resolve({ data: [] as AcademyLeaveRequestRow[] }),
  ]);
  const names = new Map(placements.map((p) => [p.id, p.developer_name ?? ""]));
  const items: UpcomingItem[] = [
    ...(milestones.data ?? []).map((m) => ({
      kind: "review" as const,
      date: m.due_date as string,
      label: m.title,
      milestoneKind: m.kind,
      placementId: m.placement_id,
    })),
    ...(holidays.data ?? []).map((h) => ({
      kind: "holiday" as const,
      date: h.date,
      label: user.locale === "nl" ? h.name_nl : h.name_en,
      country: h.country,
      confirmed: h.confirmed,
      dayOff: h.day_off,
    })),
    ...(leave.data ?? []).map((l) => ({
      kind: "leave" as const,
      date: l.start_date,
      endDate: l.end_date,
      label: names.get(l.placement_id) ?? "",
      status: l.status,
      placementId: l.placement_id,
    })),
  ];
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

// ---------------------------------------------------------------------------
// Nordavo: the Academy tab of a placement
// ---------------------------------------------------------------------------

export type MemberOption = { profile_id: string; full_name: string | null; email: string | null; academy_role: string; candidate_id: string | null };

export type PulseRow = AcademyPulseRow & { answer: AcademyPulseAnswerRow | null };

export type PlacementAdmin = {
  placement: AcademyPlacementViewRow;
  people: PlacementPerson[];
  /** Client users of this client and Academy developers that can be added. */
  options: MemberOption[];
  /** The ATS candidate of the placement, when they are an Academy candidate or developer. */
  candidateMember: MemberOption | null;
  rituals: AcademyRitualRow[];
  logs: AcademyRitualLogRow[];
  milestones: AcademyMilestoneRow[];
  reviews: AcademyReviewRow[];
  leave: AcademyLeaveRequestRow[];
  balances: AcademyLeaveBalanceRow[];
  documents: PlacementDocument[];
  pulses: PulseRow[];
  calendarToken: string | null;
  team: { id: string; full_name: string | null }[];
  authors: Record<string, string>;
  candidateId: string;
  today: string;
};

export async function getPlacementAdmin(placementId: string): Promise<PlacementAdmin | null> {
  const user = await requireAcademyManager();
  const supabase = await createClient();
  const { data: view } = await supabase.rpc("academy_placement_view", { p_placement_id: placementId });
  const placement = (view ?? [])[0];
  if (!placement) return null;
  const today = localDateIso(new Date(), user.timeZone);

  const [people, raw, rituals, logs, milestones, reviews, leave, balances, documents, pulses, token, team] = await Promise.all([
    supabase.rpc("academy_placement_people", { p_placement_id: placementId }),
    supabase.from("placements").select("candidate_id").eq("id", placementId).single(),
    supabase.from("academy_rituals").select("*").eq("placement_id", placementId).order("position"),
    supabase.from("academy_ritual_logs").select("*").eq("placement_id", placementId).gte("period_date", addDaysIso(today, -7 * 12)),
    supabase.from("academy_milestones").select("*").eq("placement_id", placementId).order("due_date").order("position"),
    supabase.from("academy_reviews").select("*").eq("placement_id", placementId),
    supabase.from("academy_leave_requests").select("*").eq("placement_id", placementId).order("start_date", { ascending: false }),
    supabase.from("academy_leave_balances").select("*").eq("placement_id", placementId).order("year"),
    loadDocuments(supabase, placementId),
    loadPulses(supabase, placementId),
    supabase.rpc("academy_calendar_token", { p_placement_id: placementId }),
    supabase.from("profiles").select("id, full_name, role, modules").in("role", ["admin", "member"]).order("full_name"),
  ]);

  // Candidates for membership: client users of this client, Academy developers.
  const [{ data: members }, { data: clientUsers }] = await Promise.all([
    supabase.from("academy_members").select("profile_id, academy_role, candidate_id").in("academy_role", ["developer", "candidate", "client_admin", "client_member", "client_reader"]),
    supabase.from("profiles").select("id").eq("role", "client").eq("client_id", placement.client_id),
  ]);
  const clientIds = new Set((clientUsers ?? []).map((p) => p.id));
  const relevant = (members ?? []).filter(
    (m) => (m.academy_role.startsWith("client_") && clientIds.has(m.profile_id)) || !m.academy_role.startsWith("client_"),
  );
  const profiles = await profileNames(supabase, relevant.map((m) => m.profile_id));
  type MemberJoin = {
    profile_id: string;
    academy_role: string;
    candidate_id: string | null;
    profile: { full_name: string | null; email: string | null; client_id: string | null } | null;
  };
  const rows: MemberJoin[] = relevant
    .filter((m) => m.academy_role !== "candidate" || m.candidate_id === raw.data?.candidate_id)
    .map((m) => ({
      ...m,
      profile: profiles.get(m.profile_id) ?? null,
    }));
  const inPlacement = new Set(((people.data ?? []) as PlacementPerson[]).map((p) => p.profile_id));
  const toOption = (m: MemberJoin): MemberOption => ({
    profile_id: m.profile_id,
    full_name: m.profile?.full_name ?? null,
    email: m.profile?.email ?? null,
    academy_role: m.academy_role,
    candidate_id: m.candidate_id,
  });
  const options = rows
    .filter((m) => !inPlacement.has(m.profile_id))
    .filter((m) => (m.academy_role.startsWith("client_") ? m.profile?.client_id === placement.client_id : m.academy_role === "developer"))
    .map(toOption)
    .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
  const candidateId = raw.data?.candidate_id ?? "";
  const candidate = rows.find((m) => m.candidate_id === candidateId);

  const teamRows = (team.data ?? []).filter((p) => p.role === "admin" || (p.modules ?? []).includes("academy"));
  const authors: Record<string, string> = {};
  for (const p of (people.data ?? []) as PlacementPerson[]) authors[p.profile_id] = p.full_name ?? p.email ?? "";
  for (const p of team.data ?? []) authors[p.id] = p.full_name ?? "";

  return {
    placement,
    people: (people.data ?? []) as PlacementPerson[],
    options,
    candidateMember: candidate ? toOption(candidate) : null,
    rituals: rituals.data ?? [],
    logs: logs.data ?? [],
    milestones: milestones.data ?? [],
    reviews: reviews.data ?? [],
    leave: leave.data ?? [],
    balances: balances.data ?? [],
    documents,
    pulses,
    calendarToken: (token.data as string | null) ?? null,
    team: teamRows.map((p) => ({ id: p.id, full_name: p.full_name })),
    authors,
    candidateId,
    today,
  };
}

export type PulseSignal = {
  pulse_id: string;
  placement_id: string;
  profile_id: string;
  name: string | null;
  client_name: string | null;
  developer_name: string | null;
  score: number;
  previous_score: number | null;
  flag_reason: "low" | "drop" | null;
  friction: string | null;
  created_at: string;
};

/** Flagged pulse answers Nordavo has not followed up yet (dashboard highlight). */
export async function listPulseSignals(): Promise<PulseSignal[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data: answers, error } = await supabase
    .from("academy_pulse_answers")
    .select("pulse_id, score, previous_score, flag_reason, friction, created_at")
    .eq("flagged", true)
    .is("handled_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("listPulseSignals", error.message);
    return [];
  }
  if (!answers?.length) return [];
  const { data: pulses } = await supabase.from("academy_pulses").select("id, placement_id, profile_id").in("id", answers.map((a) => a.pulse_id));
  const pulseById = new Map((pulses ?? []).map((p) => [p.id, p]));
  const [names, placements] = await Promise.all([
    profileNames(supabase, (pulses ?? []).map((p) => p.profile_id)),
    supabase
      .from("placements")
      .select("id, client:clients(name), candidate:candidates(full_name)")
      .in("id", [...new Set((pulses ?? []).map((p) => p.placement_id))]),
  ]);
  type PlacementJoin = { id: string; client: { name: string } | null; candidate: { full_name: string } | null };
  const placementById = new Map(((placements.data ?? []) as unknown as PlacementJoin[]).map((p) => [p.id, p]));
  return answers.flatMap((a) => {
    const pulse = pulseById.get(a.pulse_id);
    if (!pulse) return [];
    const placement = placementById.get(pulse.placement_id);
    return [
      {
        pulse_id: a.pulse_id,
        placement_id: pulse.placement_id,
        profile_id: pulse.profile_id,
        name: names.get(pulse.profile_id)?.full_name ?? null,
        client_name: placement?.client?.name ?? null,
        developer_name: placement?.candidate?.full_name ?? null,
        score: a.score,
        previous_score: a.previous_score,
        flag_reason: a.flag_reason,
        friction: a.friction,
        created_at: a.created_at,
      },
    ];
  });
}

export type AcademyPlacementListItem = {
  id: string;
  status: string;
  start_date: string;
  client_name: string | null;
  developer_name: string | null;
  members: number;
  latestScores: number[];
  openLeave: number;
  signals: number;
};

/** Placements that are not over, with Academy signals (Nordavo overview). */
export async function listAcademyPlacements(): Promise<AcademyPlacementListItem[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data: placements, error } = await supabase
    .from("placements")
    .select("id, status, start_date, client:clients(name), candidate:candidates(full_name)")
    .neq("status", "ended")
    .order("start_date", { ascending: false })
    .limit(200);
  if (error) fail("placements", error);
  const ids = (placements ?? []).map((p) => p.id);
  if (ids.length === 0) return [];
  const [members, pulses, leave] = await Promise.all([
    supabase.from("academy_placement_members").select("placement_id").in("placement_id", ids),
    supabase.from("academy_pulses").select("id, placement_id, profile_id, period_start").in("placement_id", ids),
    supabase.from("academy_leave_requests").select("placement_id").in("placement_id", ids).in("status", ["requested", "client_agreed"]),
  ]);
  const pulseIds = (pulses.data ?? []).map((p) => p.id);
  const answers: { pulse_id: string; score: number; flagged: boolean; handled_at: string | null }[] = [];
  for (let i = 0; i < pulseIds.length; i += 200) {
    const { data } = await supabase.from("academy_pulse_answers").select("pulse_id, score, flagged, handled_at").in("pulse_id", pulseIds.slice(i, i + 200));
    answers.push(...(data ?? []));
  }
  const answerById = new Map(answers.map((a) => [a.pulse_id, a]));
  const pulseRows = (pulses.data ?? []).map((p) => ({ ...p, answer: answerById.get(p.id) ?? null }));
  type PlacementJoin = { id: string; status: string; start_date: string; client: { name: string } | null; candidate: { full_name: string } | null };
  return ((placements ?? []) as unknown as PlacementJoin[]).map((p) => {
    const own = pulseRows.filter((r) => r.placement_id === p.id && r.answer);
    const latest = new Map<string, { period: string; score: number }>();
    for (const r of own) {
      const current = latest.get(r.profile_id);
      if (!current || current.period < r.period_start) latest.set(r.profile_id, { period: r.period_start, score: r.answer!.score });
    }
    return {
      id: p.id,
      status: p.status,
      start_date: p.start_date,
      client_name: p.client?.name ?? null,
      developer_name: p.candidate?.full_name ?? null,
      members: (members.data ?? []).filter((m) => m.placement_id === p.id).length,
      latestScores: [...latest.values()].map((v) => v.score),
      openLeave: (leave.data ?? []).filter((l) => l.placement_id === p.id).length,
      signals: own.filter((r) => r.answer!.flagged && !r.answer!.handled_at).length,
    };
  });
}

/** Course rituals (templates) by course. */
export async function listRitualTemplates() {
  await requireAcademyManager();
  const supabase = await createClient();
  const [courses, rituals, copies] = await Promise.all([
    supabase.from("academy_courses").select("id, title, audience").order("position").order("title"),
    supabase.from("academy_rituals").select("*").is("placement_id", null).order("position"),
    supabase.from("academy_rituals").select("template_id, customized").not("template_id", "is", null),
  ]);
  if (rituals.error) fail("rituals", rituals.error);
  return {
    courses: courses.data ?? [],
    rituals: rituals.data ?? [],
    copies: (copies.data ?? []) as { template_id: string; customized: boolean }[],
  };
}

export async function listHolidays(year: number): Promise<AcademyHolidayRow[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data, error } = await supabase.from("academy_holidays").select("*").eq("year", year).order("date").order("country");
  if (error) fail("holidays", error);
  return data ?? [];
}
