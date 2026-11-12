// Recruitment agenda (feedback Julius, round 3): one calendar with every
// date the portal already knows about vacancies, placements, candidates and
// interviews, plus the public holidays (Netherlands and Karnataka) that touch
// a running placement. Nothing is entered twice: every item comes from a
// field on its record and links back to it.
//
// Pure (no server-only): the page, the data loader and the tests share it.
// Dates are YYYY-MM-DD; times of interviews are shown in Europe/Amsterdam.

import { dutchHolidays, indiaFixedHolidays } from "@/lib/academy/placement/holidays";
import { daysOpenWithoutHolds, daysUntil, deadlineLevel, flowDeadline, type HoldPeriod } from "@/lib/recruitment/vacancy-time";

export type AgendaView = "day" | "week" | "month" | "list" | "roles";
export type AgendaScope = "mine" | "team";

export const agendaViews: { value: AgendaView; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "list", label: "List" },
  { value: "roles", label: "All roles" },
];

export type AgendaGroup = "vacancies" | "placements" | "candidates" | "interviews" | "holidays";

export type AgendaKind =
  | "vacancy_opened"
  | "intake"
  | "profiles_sent"
  | "first_interview"
  | "fill_deadline"
  | "desired_start"
  | "vacancy_start"
  | "placement_start"
  | "last_day"
  | "placement_end"
  | "guarantee_end"
  | "probation_end"
  | "checkin"
  | "availability"
  | "interview"
  | "client_interview"
  | "holiday";

export const agendaKinds: Record<AgendaKind, { label: string; group: AgendaGroup }> = {
  vacancy_opened: { label: "Open since", group: "vacancies" },
  intake: { label: "Intake", group: "vacancies" },
  profiles_sent: { label: "Profiles sent", group: "vacancies" },
  first_interview: { label: "First interview", group: "vacancies" },
  fill_deadline: { label: "Present top 3 to 5", group: "vacancies" },
  desired_start: { label: "Desired start", group: "vacancies" },
  vacancy_start: { label: "Start", group: "vacancies" },
  placement_start: { label: "Starts at client", group: "placements" },
  last_day: { label: "Last working day", group: "placements" },
  placement_end: { label: "Placement ends", group: "placements" },
  guarantee_end: { label: "Guarantee ends", group: "placements" },
  probation_end: { label: "Probation ends", group: "placements" },
  checkin: { label: "Check-in", group: "placements" },
  availability: { label: "Available", group: "candidates" },
  interview: { label: "Interview", group: "interviews" },
  client_interview: { label: "Client interview", group: "interviews" },
  holiday: { label: "Public holiday", group: "holidays" },
};

export const agendaGroups: { value: AgendaGroup; label: string }[] = [
  { value: "vacancies", label: "Vacancies" },
  { value: "placements", label: "Placements" },
  { value: "candidates", label: "Candidates" },
  { value: "interviews", label: "Interviews" },
  { value: "holidays", label: "Holidays" },
];

export type AgendaTone = "neutral" | "brand" | "accent" | "success" | "warning" | "danger";

export type AgendaItem = {
  id: string;
  kind: AgendaKind;
  date: string;
  /** HH:MM in Europe/Amsterdam, for interviews. */
  time?: string;
  title: string;
  subtitle?: string;
  href: string | null;
  /** Team members this item belongs to, for "My agenda". */
  ownerIds: string[];
  tone: AgendaTone;
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function parseIso(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function isIsoDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = parseIso(value);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
}

export function addDays(iso: string, days: number): string {
  return new Date(parseIso(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  return Math.round((parseIso(to) - parseIso(from)) / DAY_MS);
}

/** ISO weekday, 1 (Monday) to 7 (Sunday). */
export function weekday(iso: string): number {
  const d = new Date(parseIso(iso)).getUTCDay();
  return d === 0 ? 7 : d;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, 1 - weekday(iso));
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function addMonths(iso: string, months: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 10);
}

/** Days in the list view. */
export const LIST_DAYS = 31;

/** The days a view shows around a date: [from, to] inclusive. Month: whole weeks, Monday first. */
export function viewRange(view: AgendaView, anchor: string): { from: string; to: string } {
  switch (view) {
    case "day":
      return { from: anchor, to: anchor };
    case "week": {
      const from = startOfWeek(anchor);
      return { from, to: addDays(from, 6) };
    }
    case "month": {
      const first = startOfMonth(anchor);
      const last = addDays(addMonths(first, 1), -1);
      return { from: startOfWeek(first), to: addDays(startOfWeek(last), 6) };
    }
    case "list":
    case "roles":
      return { from: anchor, to: addDays(anchor, LIST_DAYS - 1) };
  }
}

/** The anchor one step back or forward in a view. */
export function shiftAnchor(view: AgendaView, anchor: string, direction: -1 | 1): string {
  switch (view) {
    case "day":
      return addDays(anchor, direction);
    case "week":
      return addDays(anchor, 7 * direction);
    case "month":
      return addMonths(startOfMonth(anchor), direction);
    case "list":
    case "roles":
      return addDays(anchor, LIST_DAYS * direction);
  }
}

/** Weeks of a month view, each 7 days from Monday. */
export function monthWeeks(anchor: string): string[][] {
  const { from, to } = viewRange("month", anchor);
  const weeks: string[][] = [];
  for (let day = from; day <= to; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return weeks;
}

const amsterdam = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A timestamp as date and time in Amsterdam. */
export function amsterdamDateTime(value: string): { date: string; time: string } | null {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  const parts = Object.fromEntries(amsterdam.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** The day of a date or timestamp column: a plain date as it is, a timestamp in Amsterdam. */
export function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const text: string = value;
  if (isIsoDate(text)) return text;
  const head = text.slice(0, 10);
  return amsterdamDateTime(text)?.date ?? (isIsoDate(head) ? head : null);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  mrt: 3, mei: 5, okt: 10,
};

/**
 * A date in the free text availability of a candidate ("from 2026-12-01",
 * "1-12-2026", "1 December 2026"), or null. Day before month, as in NL and India.
 */
export function availabilityDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso && isIsoDate(iso[0])) return iso[0];
  const dmy = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/.exec(text);
  if (dmy) {
    const value = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    if (isIsoDate(value)) return value;
  }
  const named = /\b(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})\b/i.exec(text);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (month) {
      const value = `${named[3]}-${String(month).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
      if (isIsoDate(value)) return value;
    }
  }
  return null;
}

/** "3 months", "1 year, 2 months", "12 days" between two dates. */
export function durationLabel(start: string, end: string): string {
  const days = diffDays(start, end);
  if (days < 0) return "Not started";
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  let months = (ye - ys) * 12 + (me - ms);
  if (de < ds) months -= 1;
  if (months < 1) return days === 1 ? "1 day" : `${days} days`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const m = rest === 1 ? "1 month" : `${rest} months`;
  if (years === 0) return m;
  const y = years === 1 ? "1 year" : `${years} years`;
  return rest === 0 ? y : `${y}, ${m}`;
}

// ---------------------------------------------------------------------------
// Records to items
// ---------------------------------------------------------------------------

export type AgendaVacancy = {
  id: string;
  title: string;
  client: string | null;
  status: string;
  is_talent_pool: boolean;
  owner_id: string | null;
  opened_at: string;
  closed_at: string | null;
  intake_at: string | null;
  profiles_sent_at: string | null;
  first_interview_at: string | null;
  desired_start_date: string | null;
  start_at: string | null;
  presentation_deadline: string | null;
  presented: number;
  holds: HoldPeriod[];
};

export type AgendaPlacement = {
  id: string;
  candidate: string;
  candidate_id: string | null;
  client: string;
  vacancy: string | null;
  status: "active" | "notice" | "ended";
  start_date: string;
  end_date: string | null;
  guarantee_until: string | null;
  probation_end_date: string | null;
  next_checkin_at: string | null;
  ownerIds: string[];
};

export type AgendaInterview = {
  id: string;
  kind: "interview" | "english_interview" | "client_interview";
  status: string;
  starts_at: string | null;
  candidate: string;
  candidate_id: string | null;
  vacancy: string | null;
  vacancy_id: string | null;
  application_id: string;
  ownerIds: string[];
};

export type AgendaCandidate = {
  id: string;
  full_name: string;
  availability: string | null;
  status: string;
  owner_id: string | null;
};

export type AgendaHoliday = { country: "NL" | "IN"; region: string | null; date: string; name: string; day_off: boolean };

const vacancyHref = (id: string) => `/dashboard/vacancies/${id}`;
const placementHref = (id: string) => `/dashboard/placements/${id}`;
const candidateHref = (id: string) => `/dashboard/candidates/${id}`;

/** Days open colour, as on the vacancies list: green under 14, amber 14 to 21, red after. */
export function daysOpenTone(days: number, status: string, talentPool = false): AgendaTone {
  if (talentPool || status !== "open") return "neutral";
  if (days > 21) return "danger";
  if (days >= 14) return "warning";
  return "success";
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function vacancyItems(v: AgendaVacancy, now: Date = new Date()): AgendaItem[] {
  const items: AgendaItem[] = [];
  const owners = v.owner_id ? [v.owner_id] : [];
  const who = [v.title, v.client].filter(Boolean).join(" at ");
  const add = (kind: AgendaKind, value: string | null, extra: Partial<AgendaItem> = {}) => {
    const date = dayOf(value);
    if (!date) return;
    items.push({ id: `${kind}-${v.id}`, kind, date, title: who, href: vacancyHref(v.id), ownerIds: owners, tone: "brand", ...extra });
  };

  const running = v.status === "open" || v.status === "on_hold";
  if (running) {
    const daysOpen = daysOpenWithoutHolds(v, v.holds, now);
    add("vacancy_opened", v.opened_at, {
      subtitle: v.is_talent_pool ? "Talent pool, no clock" : `Open ${plural(daysOpen, "day")}`,
      tone: daysOpenTone(daysOpen, v.status, v.is_talent_pool),
    });
    add("intake", v.intake_at);
    add("profiles_sent", v.profiles_sent_at);
    add("first_interview", v.first_interview_at);
    const deadline = v.status === "open" ? flowDeadline(v, v.holds, now) : null;
    if (deadline) {
      const level = deadlineLevel(deadline.date, v.presented, now);
      const left = daysUntil(deadline.date, now);
      const when = left === 0 ? "today" : left > 0 ? `${plural(left, "day")} left` : `${plural(-left, "day")} late`;
      add("fill_deadline", deadline.date, {
        subtitle: `${v.presented} of 3 presented, ${level === "done" ? "done" : when}, open ${plural(daysOpen, "day")}${deadline.source === "three_weeks" ? " (3 weeks after opening)" : ""}`,
        tone: level === "done" ? "success" : level === "late" ? "danger" : level === "soon" ? "warning" : "brand",
      });
    }
  }
  if (running || v.status === "filled") {
    add("desired_start", v.desired_start_date, { tone: "accent" });
    add("vacancy_start", v.start_at, { tone: "accent" });
  }
  return items;
}

export function placementItems(p: AgendaPlacement, today: string): AgendaItem[] {
  const items: AgendaItem[] = [];
  const who = `${p.candidate} at ${p.client}`;
  const add = (kind: AgendaKind, value: string | null, extra: Partial<AgendaItem> = {}) => {
    const date = dayOf(value);
    if (!date) return;
    items.push({ id: `${kind}-${p.id}`, kind, date, title: who, href: placementHref(p.id), ownerIds: p.ownerIds, tone: "brand", ...extra });
  };
  const end = p.end_date ?? today;
  add("placement_start", p.start_date, {
    subtitle: [p.vacancy, p.start_date <= today ? `running ${durationLabel(p.start_date, end < today ? end : today)}` : null].filter(Boolean).join(", ") || undefined,
    tone: "success",
  });
  if (p.end_date) {
    add(p.status === "notice" ? "last_day" : "placement_end", p.end_date, {
      subtitle: `After ${durationLabel(p.start_date, p.end_date)}`,
      tone: p.status === "notice" ? "warning" : "neutral",
    });
  }
  if (p.status !== "ended") {
    add("guarantee_end", p.guarantee_until, { tone: "accent" });
    add("probation_end", p.probation_end_date, { tone: "accent" });
    add("checkin", p.next_checkin_at, { tone: p.next_checkin_at && p.next_checkin_at < today ? "danger" : "brand" });
  }
  return items;
}

export function interviewItem(i: AgendaInterview): AgendaItem | null {
  if (!i.starts_at || i.status === "cancelled") return null;
  const at = amsterdamDateTime(i.starts_at);
  if (!at) return null;
  const kind: AgendaKind = i.kind === "client_interview" ? "client_interview" : "interview";
  return {
    id: `interview-${i.id}`,
    kind,
    date: at.date,
    time: at.time,
    title: [i.candidate, i.vacancy].filter(Boolean).join(" for "),
    subtitle: i.kind === "english_interview" ? "English interview" : i.status === "done" ? "Done" : undefined,
    href: i.vacancy_id ? `/dashboard/vacancies/${i.vacancy_id}/pipeline?application=${i.application_id}` : i.candidate_id ? candidateHref(i.candidate_id) : null,
    ownerIds: i.ownerIds,
    tone: kind === "client_interview" ? "accent" : "brand",
  };
}

export function candidateItem(c: AgendaCandidate): AgendaItem | null {
  if (c.status === "placed" || c.status === "unavailable") return null;
  const date = availabilityDate(c.availability);
  if (!date) return null;
  return {
    id: `availability-${c.id}`,
    kind: "availability",
    date,
    title: c.full_name,
    subtitle: c.availability ?? undefined,
    href: candidateHref(c.id),
    ownerIds: c.owner_id ? [c.owner_id] : [],
    tone: "success",
  };
}

/** Whether a placement runs on a day (started, and not ended before it). */
export function runsOn(p: Pick<AgendaPlacement, "start_date" | "end_date" | "status">, day: string): boolean {
  if (p.start_date > day) return false;
  if (p.end_date && p.end_date < day) return false;
  return p.status !== "ended" || Boolean(p.end_date);
}

/**
 * Public holidays that touch a running placement: a Dutch holiday (the
 * client is closed) or a Karnataka holiday (the developer in Bangalore is
 * off). Only days off; one item per holiday, with the placements it touches.
 */
export function holidayItems(holidays: AgendaHoliday[], placements: AgendaPlacement[]): AgendaItem[] {
  const items: AgendaItem[] = [];
  const seen = new Set<string>();
  for (const h of holidays) {
    if (!h.day_off) continue;
    const key = `${h.country}-${h.date}-${h.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const touched = placements.filter((p) => runsOn(p, h.date));
    if (touched.length === 0) continue;
    const where = h.country === "NL" ? "Netherlands" : "Karnataka";
    const who = h.country === "NL" ? "client closed" : "developer off";
    const names = touched.slice(0, 3).map((p) => p.candidate).join(", ") + (touched.length > 3 ? ` and ${touched.length - 3} more` : "");
    items.push({
      id: `holiday-${key}`,
      kind: "holiday",
      date: h.date,
      title: `${h.name} (${where})`,
      subtitle: `${who}: ${names}`,
      href: touched.length === 1 ? placementHref(touched[0].id) : null,
      ownerIds: [...new Set(touched.flatMap((p) => p.ownerIds))],
      tone: "warning",
    });
  }
  return items;
}

/** The computed holidays (NL and the fixed Karnataka days) of the years in a range, when the table has none. */
export function computedHolidays(from: string, to: string): AgendaHoliday[] {
  const out: AgendaHoliday[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const h of [...dutchHolidays(y), ...indiaFixedHolidays(y)]) {
      if (h.date >= from && h.date <= to) out.push({ country: h.country, region: h.region, date: h.date, name: h.nameEn, day_off: h.dayOff });
    }
  }
  return out;
}

export type AgendaInput = {
  vacancies: AgendaVacancy[];
  placements: AgendaPlacement[];
  interviews: AgendaInterview[];
  candidates: AgendaCandidate[];
  holidays: AgendaHoliday[];
};

const kindOrder = Object.keys(agendaKinds) as AgendaKind[];

/** Every item, sorted by date, time and kind. */
export function buildAgenda(input: AgendaInput, today: string, now: Date = new Date()): AgendaItem[] {
  const items = [
    ...input.vacancies.flatMap((v) => vacancyItems(v, now)),
    ...input.placements.flatMap((p) => placementItems(p, today)),
    ...input.interviews.map(interviewItem).filter((i): i is AgendaItem => Boolean(i)),
    ...input.candidates.map(candidateItem).filter((i): i is AgendaItem => Boolean(i)),
    ...holidayItems(input.holidays, input.placements),
  ];
  return items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? "").localeCompare(b.time ?? "") ||
      kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) ||
      a.title.localeCompare(b.title),
  );
}

/** Items in [from, to], of the chosen groups, and for "mine" only those of this user (holidays only when they touch one). */
export function filterAgenda(
  items: AgendaItem[],
  options: { from: string; to: string; groups?: AgendaGroup[]; scope?: AgendaScope; userId?: string },
): AgendaItem[] {
  const groups = options.groups && options.groups.length > 0 ? new Set(options.groups) : null;
  return items.filter(
    (i) =>
      i.date >= options.from &&
      i.date <= options.to &&
      (!groups || groups.has(agendaKinds[i.kind].group)) &&
      (options.scope !== "mine" || !options.userId || i.ownerIds.includes(options.userId)),
  );
}

export function groupByDay(items: AgendaItem[]): Map<string, AgendaItem[]> {
  const days = new Map<string, AgendaItem[]>();
  for (const item of items) days.set(item.date, [...(days.get(item.date) ?? []), item]);
  return days;
}

/** Groups from a search param ("vacancies,interviews"); empty or unknown means all. */
export function parseGroups(raw: string | null | undefined): AgendaGroup[] {
  const valid = new Set(agendaGroups.map((g) => g.value));
  return [...new Set((raw ?? "").split(",").map((s) => s.trim()))].filter((s): s is AgendaGroup => valid.has(s as AgendaGroup));
}

export function parseView(raw: string | null | undefined): AgendaView {
  return agendaViews.some((v) => v.value === raw) ? (raw as AgendaView) : "week";
}

// ---------------------------------------------------------------------------
// All roles: vacancies and placements with start, end and duration
// ---------------------------------------------------------------------------

export type RoleRow = {
  id: string;
  type: "vacancy" | "placement";
  title: string;
  client: string | null;
  status: string;
  start: string | null;
  end: string | null;
  duration: string | null;
  href: string;
  ownerIds: string[];
};

/**
 * One overview of every role. A vacancy runs from opening to closing (or
 * today), a placement from its start to its end (or today, ongoing).
 */
export function roleOverview(vacancies: AgendaVacancy[], placements: AgendaPlacement[], today: string): RoleRow[] {
  const rows: RoleRow[] = [
    ...vacancies.map((v): RoleRow => {
      const start = dayOf(v.opened_at);
      const end = dayOf(v.closed_at);
      return {
        id: v.id,
        type: "vacancy",
        title: v.title,
        client: v.client,
        status: v.status,
        start,
        end,
        duration: start ? `${durationLabel(start, end ?? today)}${end ? "" : " so far"}` : null,
        href: vacancyHref(v.id),
        ownerIds: v.owner_id ? [v.owner_id] : [],
      };
    }),
    ...placements.map((p): RoleRow => ({
      id: p.id,
      type: "placement",
      title: p.vacancy ? `${p.candidate}, ${p.vacancy}` : p.candidate,
      client: p.client,
      status: p.status,
      start: p.start_date,
      end: p.end_date,
      duration:
        p.start_date > today ? "Not started" : `${durationLabel(p.start_date, p.end_date && p.end_date < today ? p.end_date : today)}${p.end_date && p.end_date < today ? "" : " so far"}`,
      href: placementHref(p.id),
      ownerIds: p.ownerIds,
    })),
  ];
  return rows.sort((a, b) => (b.start ?? "").localeCompare(a.start ?? "") || a.title.localeCompare(b.title));
}
