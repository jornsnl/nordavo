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

export type CallerStats = { called: number; reached: number; meetings: number; approved: number };
export type CallerMonth = { approved: number; fees: number };

/** Outcomes where the caller spoke to someone. */
export const reachedOutcomes = ["reached_interested", "meeting_planned", "reached_not_interested", "referred", "wrong_person"];

export const emptyStats: CallerStats = { called: 0, reached: 0, meetings: 0, approved: 0 };

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
  }
  for (const m of meetings) {
    if (!m.caller_id || m.status === "cancelled") continue;
    const s = get(m.caller_id);
    s.meetings += 1;
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

/** A meeting counts in the month it takes place (or was planned, when it has no time yet). */
export function meetingMonthFilter(month: string): string {
  const { from, to } = monthRange(month);
  return `and(scheduled_at.gte.${from},scheduled_at.lt.${to}),and(scheduled_at.is.null,created_at.gte.${from},created_at.lt.${to})`;
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
export async function loadCallerStats(db: Db, { month, callerId }: { month: string | null; callerId?: string }) {
  const range = month ? monthRange(month) : null;
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
      if (month) q = q.or(meetingMonthFilter(month));
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
