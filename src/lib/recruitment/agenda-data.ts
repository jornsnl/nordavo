import "server-only";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  addDays,
  computedHolidays,
  type AgendaCandidate,
  type AgendaHoliday,
  type AgendaInput,
  type AgendaInterview,
  type AgendaPlacement,
  type AgendaVacancy,
} from "@/lib/recruitment/agenda";

/**
 * Everything the agenda shows for [from, to], read with the user's own
 * session (RLS). Vacancies and placements come in full (their dates span
 * months and the role overview needs them all); interviews and holidays only
 * for the range.
 */
export async function loadAgenda(from: string, to: string): Promise<AgendaInput> {
  await requireModule("recruitment");
  const supabase = await createClient();

  const [vacanciesRes, holdsRes, presentedRes, placementsRes, interviewsRes, candidatesRes, holidaysRes] = await Promise.all([
    supabase
      .from("vacancies")
      .select(
        "id, title, status, is_talent_pool, owner_id, opened_at, closed_at, intake_at, profiles_sent_at, first_interview_at, desired_start_date, start_at, presentation_deadline, client:clients(name), company:companies(name)",
      )
      .limit(5000),
    supabase.from("vacancy_holds").select("vacancy_id, started_on, ended_on").limit(10000),
    supabase.from("applications").select("vacancy_id").not("presented_at", "is", null).limit(20000),
    supabase
      .from("placements")
      .select(
        "id, status, start_date, end_date, guarantee_until, probation_end_date, next_checkin_at, nordavo_contact_id, candidate:candidates(id, full_name, owner_id), client:clients(name), vacancy:vacancies(title, owner_id)",
      )
      .limit(5000),
    supabase
      .from("interviews")
      .select(
        "id, kind, status, starts_at, interviewer_id, application_id, application:applications(id, candidate:candidates(id, full_name, owner_id), vacancy:vacancies(id, title, owner_id))",
      )
      .gte("starts_at", `${addDays(from, -1)}T00:00:00Z`)
      .lte("starts_at", `${addDays(to, 1)}T23:59:59Z`)
      .limit(2000),
    supabase
      .from("candidates")
      .select("id, full_name, availability, status, owner_id")
      .not("availability", "is", null)
      .neq("availability", "")
      .limit(5000),
    supabase.from("academy_holidays").select("country, region, date, name_en, day_off").gte("date", from).lte("date", to),
  ]);

  // Columns or tables added by later migrations may be missing on an older database: the agenda then leaves them out.
  if (vacanciesRes.error) throw new Error(`Could not load vacancies: ${vacanciesRes.error.message}`);
  if (placementsRes.error) throw new Error(`Could not load placements: ${placementsRes.error.message}`);

  const holds = new Map<string, { started_on: string; ended_on: string | null }[]>();
  for (const h of holdsRes.error ? [] : (holdsRes.data ?? [])) {
    holds.set(h.vacancy_id, [...(holds.get(h.vacancy_id) ?? []), { started_on: h.started_on, ended_on: h.ended_on }]);
  }
  const presented = new Map<string, number>();
  for (const a of presentedRes.data ?? []) presented.set(a.vacancy_id, (presented.get(a.vacancy_id) ?? 0) + 1);

  const vacancies: AgendaVacancy[] = (vacanciesRes.data ?? []).map((v) => ({
    id: v.id,
    title: v.title,
    client: v.client?.name ?? v.company?.name ?? null,
    status: v.status,
    is_talent_pool: v.is_talent_pool,
    owner_id: v.owner_id,
    opened_at: v.opened_at,
    closed_at: v.closed_at,
    intake_at: v.intake_at,
    profiles_sent_at: v.profiles_sent_at,
    first_interview_at: v.first_interview_at,
    desired_start_date: v.desired_start_date,
    start_at: v.start_at,
    presentation_deadline: v.presentation_deadline ?? null,
    presented: presented.get(v.id) ?? 0,
    holds: holds.get(v.id) ?? [],
  }));

  const placements: AgendaPlacement[] = (placementsRes.data ?? []).map((p) => ({
    id: p.id,
    candidate: p.candidate?.full_name ?? "Unknown candidate",
    candidate_id: p.candidate?.id ?? null,
    client: p.client?.name ?? "Unknown client",
    vacancy: p.vacancy?.title ?? null,
    status: p.status,
    start_date: p.start_date,
    end_date: p.end_date,
    guarantee_until: p.guarantee_until,
    probation_end_date: p.probation_end_date,
    next_checkin_at: p.next_checkin_at,
    ownerIds: [p.nordavo_contact_id, p.candidate?.owner_id, p.vacancy?.owner_id].filter((x): x is string => Boolean(x)),
  }));

  const interviews: AgendaInterview[] = (interviewsRes.error ? [] : (interviewsRes.data ?? [])).map((i) => ({
    id: i.id,
    kind: i.kind,
    status: i.status,
    starts_at: i.starts_at,
    candidate: i.application?.candidate?.full_name ?? "Unknown candidate",
    candidate_id: i.application?.candidate?.id ?? null,
    vacancy: i.application?.vacancy?.title ?? null,
    vacancy_id: i.application?.vacancy?.id ?? null,
    application_id: i.application_id,
    ownerIds: [i.interviewer_id, i.application?.candidate?.owner_id, i.application?.vacancy?.owner_id].filter((x): x is string => Boolean(x)),
  }));

  const candidates: AgendaCandidate[] = candidatesRes.error ? [] : (candidatesRes.data ?? []);

  // The holiday table (Academy, checked by Nordavo) when it has the range; the computed days otherwise.
  const stored: AgendaHoliday[] = (holidaysRes.error ? [] : (holidaysRes.data ?? [])).map((h) => ({
    country: h.country === "IN" ? "IN" : "NL",
    region: h.region,
    date: h.date,
    name: h.name_en,
    day_off: h.day_off !== false,
  }));
  const holidays = stored.length > 0 ? stored : computedHolidays(from, to);

  return { vacancies, placements, interviews, candidates, holidays };
}
