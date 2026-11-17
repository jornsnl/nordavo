import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { MeetingStatus } from "@/lib/sales/database";
import { amsterdamDate } from "@/lib/sales/status";

// Overview per caller (feedback Julius, section 2.10 and 2.11): called,
// reached, meetings and approved, and per month the approved meetings with
// the fees they earn. Counts come from Activities (caller_id, every outcome a
// caller logs) and the meetings register. The pure part is tested in
// tests/queue.test.ts.

type Db = SupabaseClient<Database>;

export type CallerStats = {
  called: number;
  reached: number;
  /** Outcome Call back / Reached: interested. */
  callbacks: number;
  interested: number;
  /** Booked meetings (not cancelled, not awaiting the booking), of which still planned, held (held, approved or rejected afterwards) and approved. */
  meetings: number;
  /** Booked and not held yet (status Planned). */
  planned: number;
  held: number;
  approved: number;
};
export type CallerMonth = { approved: number; fees: number };

/** Outcomes where the caller spoke to someone. */
export const reachedOutcomes = ["reached_interested", "meeting_planned", "reached_not_interested", "referred", "wrong_person"];

export const emptyStats: CallerStats = { called: 0, reached: 0, callbacks: 0, interested: 0, meetings: 0, planned: 0, held: 0, approved: 0 };

export function summarizeCallers(
  calls: { caller_id: string | null; outcome: string | null }[],
  meetings: { caller_id: string | null; status: MeetingStatus }[],
): Map<string, CallerStats> {
  const out = new Map<string, CallerStats>();
  const get = (id: string) => {
    let s = out.get(id);
    if (!s) {
      s = { ...emptyStats };
      out.set(id, s);
    }
    return s;
  };
  for (const c of calls) {
    if (!c.caller_id) continue;
    const s = get(c.caller_id);
    s.called += 1;
    if (c.outcome && reachedOutcomes.includes(c.outcome)) s.reached += 1;
    if (c.outcome === "call_back") s.callbacks += 1;
    if (c.outcome === "reached_interested") s.interested += 1;
  }
  for (const m of meetings) {
    // A meeting that waits for its Cal.com booking does not count (Julius): it counts once booked.
    if (!m.caller_id || m.status === "cancelled" || m.status === "awaiting_booking") continue;
    const s = get(m.caller_id);
    s.meetings += 1;
    if (m.status === "planned") s.planned += 1;
    if (m.status === "held" || m.status === "approved" || m.status === "rejected") s.held += 1;
    if (m.status === "approved") s.approved += 1;
  }
  return out;
}

/** Approved meetings and the fees they earn, per caller. */
export function monthFees(meetings: { caller_id: string | null; status: MeetingStatus; fee: number | string }[]): Map<string, CallerMonth> {
  const out = new Map<string, CallerMonth>();
  for (const m of meetings) {
    if (!m.caller_id || m.status !== "approved") continue;
    const s = out.get(m.caller_id) ?? { approved: 0, fees: 0 };
    s.approved += 1;
    s.fees = Math.round((s.fees + Number(m.fee || 0)) * 100) / 100;
    out.set(m.caller_id, s);
  }
  return out;
}

/** The UTC instant of a wall clock time in Amsterdam ("2026-11-12", "14:30"). */
export function amsterdamLocalToIso(date: string, time = "00:00"): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0);
  // Amsterdam is one or two hours ahead of UTC; read the offset at that moment.
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Amsterdam",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - ms;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first)).toISOString();
}

/** The UTC instant of midnight in Amsterdam on a YYYY-MM-DD date. */
export function amsterdamMidnight(date: string): string {
  return amsterdamLocalToIso(date, "00:00");
}

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function currentMonth(now: Date = new Date()): string {
  return amsterdamDate(now).slice(0, 7);
}

export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Start (inclusive) and end (exclusive) of a month in Amsterdam, as UTC timestamps. */
export function monthRange(month: string): { from: string; to: string } {
  return { from: amsterdamMidnight(`${month}-01`), to: amsterdamMidnight(`${nextMonth(month)}-01`) };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** A meeting counts in the period it takes place (or was planned, when it has no time yet). */
export function meetingRangeFilter({ from, to }: { from: string; to: string }): string {
  return `and(scheduled_at.gte.${from},scheduled_at.lt.${to}),and(scheduled_at.is.null,created_at.gte.${from},created_at.lt.${to})`;
}

export function meetingMonthFilter(month: string): string {
  return meetingRangeFilter(monthRange(month));
}

// The overview of a caller is shown per week, month or in total.
export type Period = "week" | "month" | "total";

export function parsePeriod(value: unknown): Period {
  return value === "week" || value === "total" ? value : "month";
}

/** The Monday (YYYY-MM-DD) of the week a date falls in. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Start (inclusive) and end (exclusive) of the Amsterdam week (Monday to Sunday) holding a date. */
export function weekRange(date: string): { from: string; to: string } {
  const monday = weekStart(date);
  return { from: amsterdamMidnight(monday), to: amsterdamMidnight(addDays(monday, 7)) };
}

/** The time range of a period right now, or null for all time. */
export function periodRange(period: Period, now: Date = new Date()): { from: string; to: string } | null {
  if (period === "total") return null;
  return period === "week" ? weekRange(amsterdamDate(now)) : monthRange(currentMonth(now));
}

/** How far a caller is with the weekly goal for call attempts, in whole percent (not capped, 0 without a goal). */
export function goalProgress(called: number, goal: number): number {
  return goal > 0 ? Math.round((called / goal) * 100) : 0;
}

/** Contacts a caller must call back: the latest call back of each contact that is still waiting, overdue first. */
export type CallbackItem = {
  contactId: string;
  activityId: string;
  due: string;
  companyName: string | null;
  contactName: string | null;
  phone: string | null;
  overdue: boolean;
  today: boolean;
};

export function pendingCallbacks(
  calls: { id: string; contact_id: string | null; date: string; outcome: string | null; next_action_date: string | null }[],
  contacts: Map<string, { callback_at: string | null }>,
  today: string,
): { activityId: string; contactId: string; due: string }[] {
  const seen = new Set<string>();
  const out: { activityId: string; contactId: string; due: string }[] = [];
  const sorted = [...calls].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const c of sorted) {
    if (!c.contact_id || seen.has(c.contact_id)) continue;
    seen.add(c.contact_id);
    // Only the newest call of a contact counts: a later outcome ends the call back.
    if (c.outcome !== "call_back" || !c.next_action_date) continue;
    if (contacts.get(c.contact_id)?.callback_at !== c.next_action_date) continue;
    if (c.next_action_date > today) continue;
    out.push({ activityId: c.id, contactId: c.contact_id, due: c.next_action_date });
  }
  return out.sort((a, b) => (a.due < b.due ? -1 : 1));
}

async function pages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Stats per caller for a month (YYYY-MM) or all time (null). callerId limits
 * it to one caller (their own page, read with the secret key).
 */
export async function loadCallerStats(
  db: Db,
  { month, callerId, range: given }: { month: string | null; callerId?: string; range?: { from: string; to: string } | null },
) {
  const range = given !== undefined ? given : month ? monthRange(month) : null;
  const [calls, meetings] = await Promise.all([
    pages((from, to) => {
      let q = db
        .from("activities")
        .select("caller_id, outcome")
        .not("caller_id", "is", null)
        .eq("channel", "bellen")
        .eq("type", "contact")
        .range(from, to);
      if (callerId) q = q.eq("caller_id", callerId);
      if (range) q = q.gte("date", range.from).lt("date", range.to);
      return q;
    }),
    pages((from, to) => {
      let q = db.from("meetings").select("caller_id, status, fee").not("caller_id", "is", null).range(from, to);
      if (callerId) q = q.eq("caller_id", callerId);
      if (range) q = q.or(meetingRangeFilter(range));
      return q;
    }),
  ]);
  return { stats: summarizeCallers(calls, meetings), fees: monthFees(meetings) };
}

/** Approved meetings and fees per month for one caller, newest month first (their own page). */
export async function loadCallerMonths(db: Db, callerId: string, months = 6) {
  const { data, error } = await db
    .from("meetings")
    .select("status, fee, scheduled_at, created_at")
    .eq("caller_id", callerId)
    .eq("status", "approved")
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  const byMonth = new Map<string, CallerMonth>();
  for (const m of data ?? []) {
    const month = amsterdamDate(m.scheduled_at ?? m.created_at).slice(0, 7);
    const s = byMonth.get(month) ?? { approved: 0, fees: 0 };
    s.approved += 1;
    s.fees = Math.round((s.fees + Number(m.fee || 0)) * 100) / 100;
    byMonth.set(month, s);
  }
  const out: { month: string; approved: number; fees: number }[] = [];
  let month = currentMonth();
  for (let i = 0; i < months; i++) {
    out.push({ month, ...(byMonth.get(month) ?? { approved: 0, fees: 0 }) });
    month = previousMonth(month);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Results per person who calls (feedback Julius, 1b12f557): external callers
// and team members, with every outcome. The phone system's own call rows
// (source telephony, docs/calls.md) are left out: the outcome on the call
// screen is the attempt, the telephony row only adds the recording.
// ---------------------------------------------------------------------------

export type CallResult = {
  /** "caller:<id>" or "team:<profile id>". */
  key: string;
  kind: "caller" | "team";
  id: string;
  called: number;
  reached: number;
  outcomes: Record<string, number>;
  meetings: number;
  approved: number;
};

export function summarizeCallResults(
  calls: { caller_id: string | null; created_by: string | null; outcome: string | null; source?: string | null }[],
  meetings: { caller_id: string | null; booked_by: string | null; status: MeetingStatus }[],
): Map<string, CallResult> {
  const out = new Map<string, CallResult>();
  const get = (kind: "caller" | "team", id: string) => {
    const key = `${kind}:${id}`;
    let r = out.get(key);
    if (!r) {
      r = { key, kind, id, called: 0, reached: 0, outcomes: {}, meetings: 0, approved: 0 };
      out.set(key, r);
    }
    return r;
  };
  for (const c of calls) {
    if (c.source === "telephony" || c.outcome === "verstuurd") continue;
    const who = c.caller_id ? get("caller", c.caller_id) : c.created_by ? get("team", c.created_by) : null;
    if (!who) continue;
    who.called += 1;
    if (c.outcome && reachedOutcomes.includes(c.outcome)) who.reached += 1;
    const o = c.outcome ?? "unknown";
    who.outcomes[o] = (who.outcomes[o] ?? 0) + 1;
  }
  for (const m of meetings) {
    if (m.status === "cancelled" || m.status === "awaiting_booking") continue;
    const who = m.caller_id ? get("caller", m.caller_id) : m.booked_by ? get("team", m.booked_by) : null;
    if (!who) continue;
    who.meetings += 1;
    if (m.status === "approved") who.approved += 1;
  }
  return out;
}

/** A share as a whole percentage, or null when there is nothing to divide by. */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** Calls and meetings of a month (YYYY-MM) or all time, per external caller and team member. */
export async function loadCallResults(db: Db, month: string | null) {
  const range = month ? monthRange(month) : null;
  const [calls, meetings] = await Promise.all([
    pages((from, to) => {
      let q = db
        .from("activities")
        .select("caller_id, created_by, outcome, source")
        .eq("channel", "bellen")
        .eq("type", "contact")
        .range(from, to);
      if (range) q = q.gte("date", range.from).lt("date", range.to);
      return q;
    }),
    pages((from, to) => {
      let q = db.from("meetings").select("caller_id, booked_by, status").range(from, to);
      if (month) q = q.or(meetingMonthFilter(month));
      return q;
    }),
  ]);
  return summarizeCallResults(calls, meetings);
}

export type RecentCall = {
  id: string;
  date: string;
  contactId: string | null;
  /** The day to call back, for the outcome Call back. */
  callbackOn: string | null;
  outcome: string | null;
  notes: string | null;
  companyId: string | null;
  companyName: string | null;
  contactName: string | null;
  callerId: string | null;
  createdBy: string | null;
  recordingUrl: string | null;
};

/** Who made a call: an external caller or a team member (profile id). */
export type CallWho = { kind: "caller" | "team"; id: string };

/** "caller:<id>" or "team:<id>" from the address bar, or null. */
export function parseWho(value: unknown): CallWho | null {
  if (typeof value !== "string") return null;
  const m = /^(caller|team):([0-9a-f-]{36})$/i.exec(value);
  return m ? { kind: m[1] as "caller" | "team", id: m[2] } : null;
}

export function whoKey(who: CallWho): string {
  return `${who.kind}:${who.id}`;
}

/** YYYY-MM-DD from the address bar, or undefined. */
export function parseDay(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

/** The day after a YYYY-MM-DD date. */
function dayAfter(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The latest calls, newest first, of everyone or filtered (feedback Julius, 1018684b) on
 * outcome, who called (an external caller or a team member) and period (days in Amsterdam
 * time, both ends included).
 */
export async function loadRecentCalls(
  db: Db,
  {
    callerId,
    who,
    outcome,
    from,
    to,
    range,
    limit = 50,
  }: {
    callerId?: string;
    who?: CallWho | null;
    outcome?: string;
    from?: string;
    to?: string;
    /** Half open range of instants, as the caller overview passes it. */
    range?: { from: string; to: string } | null;
    limit?: number;
  } = {},
): Promise<RecentCall[]> {
  let q = db
    .from("activities")
    .select("id, date, outcome, notes, company_id, contact_id, caller_id, created_by, recording_url, next_action_date")
    .eq("channel", "bellen")
    .eq("type", "contact")
    .order("date", { ascending: false })
    .limit(limit);
  if (callerId) q = q.eq("caller_id", callerId);
  if (who?.kind === "caller") q = q.eq("caller_id", who.id);
  if (who?.kind === "team") q = q.is("caller_id", null).eq("created_by", who.id);
  if (outcome) q = q.eq("outcome", outcome as never);
  if (from) q = q.gte("date", amsterdamMidnight(from));
  if (to) q = q.lt("date", amsterdamMidnight(dayAfter(to)));
  if (range) q = q.gte("date", range.from).lt("date", range.to);
  const { data, error } = await q;
  if (error) {
    console.error("loadRecentCalls", error.message);
    return [];
  }
  const rows = data ?? [];
  const companyIds = [...new Set(rows.map((r) => r.company_id).filter((v): v is string => Boolean(v)))];
  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((v): v is string => Boolean(v)))];
  const [companies, contacts] = await Promise.all([
    companyIds.length ? db.from("companies").select("id, name").in("id", companyIds) : Promise.resolve({ data: [] }),
    contactIds.length ? db.from("contacts").select("id, first_name, last_name").in("id", contactIds) : Promise.resolve({ data: [] }),
  ]);
  const companyName = new Map((companies.data ?? []).map((c) => [c.id, c.name]));
  const contactName = new Map(
    (contacts.data ?? []).map((c) => [c.id, [c.first_name, c.last_name].filter(Boolean).join(" ") || null]),
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    contactId: r.contact_id,
    callbackOn: r.outcome === "call_back" ? r.next_action_date : null,
    outcome: r.outcome,
    notes: r.notes,
    companyId: r.company_id,
    companyName: r.company_id ? (companyName.get(r.company_id) ?? null) : null,
    contactName: r.contact_id ? (contactName.get(r.contact_id) ?? null) : null,
    callerId: r.caller_id,
    createdBy: r.created_by,
    recordingUrl: r.recording_url ?? null,
  }));
}

/** The call backs a caller still has to make, today and overdue, with a number to dial. */
export async function loadCallbacks(db: Db, callerId: string, today: string): Promise<CallbackItem[]> {
  const { data, error } = await db
    .from("activities")
    .select("id, date, outcome, contact_id, company_id, next_action_date")
    .eq("caller_id", callerId)
    .eq("channel", "bellen")
    .eq("type", "contact")
    .not("contact_id", "is", null)
    .order("date", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("loadCallbacks", error.message);
    return [];
  }
  const rows = data ?? [];
  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((v): v is string => Boolean(v)))];
  if (contactIds.length === 0) return [];
  const { data: contacts } = await db
    .from("contacts")
    .select("id, first_name, last_name, phone, callback_at, company:companies!contacts_company_id_fkey(name, phone)")
    .in("id", contactIds)
    .not("callback_at", "is", null);
  const byId = new Map((contacts ?? []).map((c) => [c.id, c]));
  const due = pendingCallbacks(rows, byId, today);
  return due.flatMap((d) => {
    const c = byId.get(d.contactId);
    if (!c) return [];
    const company = Array.isArray(c.company) ? c.company[0] : c.company;
    return [
      {
        contactId: d.contactId,
        activityId: d.activityId,
        due: d.due,
        companyName: company?.name ?? null,
        contactName: [c.first_name, c.last_name].filter(Boolean).join(" ") || null,
        phone: c.phone ?? company?.phone ?? null,
        overdue: d.due < today,
        today: d.due === today,
      },
    ];
  });
}

export type MyMeeting = {
  id: string;
  companyName: string | null;
  contactName: string | null;
  scheduledAt: string | null;
  createdAt: string;
  reason: string | null;
  fee: number;
  status: MeetingStatus;
  /** Said Meeting planned more than an hour ago and the Cal.com booking is still not in: the caller is warned. */
  late: boolean;
};

/** How long a meeting may wait for its booking before the caller is warned. */
const LATE_BOOKING_MS = 60 * 60_000;

/** The meetings of one caller, newest first, with the status the team gave them. */
export async function loadMyMeetings(db: Db, callerId: string, limit = 25): Promise<MyMeeting[]> {
  const { data, error } = await db
    .from("meetings")
    .select(
      "id, scheduled_at, created_at, reason, fee, status, company:companies!meetings_company_id_fkey(name), contact:contacts!meetings_contact_id_fkey(first_name, last_name)",
    )
    .eq("caller_id", callerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("loadMyMeetings", error.message);
    return [];
  }
  return (data ?? []).map((m) => {
    const company = Array.isArray(m.company) ? m.company[0] : m.company;
    const contact = Array.isArray(m.contact) ? m.contact[0] : m.contact;
    return {
      id: m.id,
      companyName: company?.name ?? null,
      contactName: contact ? ([contact.first_name, contact.last_name].filter(Boolean).join(" ") || null) : null,
      scheduledAt: m.scheduled_at,
      createdAt: m.created_at,
      reason: m.reason,
      fee: Number(m.fee ?? 0),
      status: m.status,
      late: m.status === "awaiting_booking" && Date.now() - new Date(m.created_at).getTime() > LATE_BOOKING_MS,
    };
  });
}

// ---------------------------------------------------------------------------
// Rejections per reason (feedback Julius, 1018684b): every Not interested on the
// call screen with its reasons (the list under Settings, Sales lists) and the
// caller's own words, per month and per person who called.
// ---------------------------------------------------------------------------

export type RejectionRecord = {
  id: string;
  created_at: string;
  company_id: string;
  caller_id: string | null;
  created_by: string | null;
  reasons: string[];
  reason_text: string | null;
  parked_until: string | null;
};

/** The reason key for a rejection that has only the open text. */
export const OWN_WORDS = "_own_words";

export type ReasonCount = {
  reason: string;
  total: number;
  /** Count per person, keyed "caller:<id>" or "team:<id>". */
  byWho: Map<string, number>;
};

export function rejectionWho(r: Pick<RejectionRecord, "caller_id" | "created_by">): string | null {
  return r.caller_id ? `caller:${r.caller_id}` : r.created_by ? `team:${r.created_by}` : null;
}

/**
 * Counts rejections per reason. A rejection with several reasons counts once under each
 * of them; one with only the open text counts under OWN_WORDS. Reasons come out in the
 * order of `order` (the list), the rest by count.
 */
export function summarizeRejections(
  rows: Pick<RejectionRecord, "caller_id" | "created_by" | "reasons" | "reason_text">[],
  order: string[] = [],
): ReasonCount[] {
  const out = new Map<string, ReasonCount>();
  for (const r of rows) {
    const keys = r.reasons.length > 0 ? [...new Set(r.reasons)] : [OWN_WORDS];
    const who = rejectionWho(r);
    for (const reason of keys) {
      let c = out.get(reason);
      if (!c) {
        c = { reason, total: 0, byWho: new Map() };
        out.set(reason, c);
      }
      c.total += 1;
      if (who) c.byWho.set(who, (c.byWho.get(who) ?? 0) + 1);
    }
  }
  const rank = (reason: string) => {
    if (reason === OWN_WORDS) return order.length + 1;
    const i = order.indexOf(reason);
    return i >= 0 ? i : order.length;
  };
  return [...out.values()].sort((a, b) => rank(a.reason) - rank(b.reason) || b.total - a.total || a.reason.localeCompare(b.reason));
}

/** The rejections of a month (YYYY-MM, null for all time), newest first. */
export async function loadRejections(db: Db, { month, who }: { month: string | null; who?: CallWho | null }): Promise<RejectionRecord[]> {
  const range = month ? monthRange(month) : null;
  try {
    return await pages((from, to) => {
      let q = db
        .from("call_rejections")
        .select("id, created_at, company_id, caller_id, created_by, reasons, reason_text, parked_until")
        .order("created_at", { ascending: false })
        .range(from, to);
      if (who?.kind === "caller") q = q.eq("caller_id", who.id);
      if (who?.kind === "team") q = q.is("caller_id", null).eq("created_by", who.id);
      if (range) q = q.gte("created_at", range.from).lt("created_at", range.to);
      return q;
    });
  } catch (e) {
    // Before the migration the table is not there; the block stays empty.
    console.error("loadRejections", e instanceof Error ? e.message : e);
    return [];
  }
}
