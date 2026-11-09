// Leave of the developer (replaces Wisemonk): the developer asks, Nordavo
// checks with the client and decides; all three sides see the status.
// Pure, tested in tests/academy-placement.test.ts.

import type { AcademyLeaveKind, AcademyLeaveStatus } from "@/lib/academy/database";
import { addDaysIso } from "@/lib/academy/time";
import { isoWeekday } from "./holidays";

export const LEAVE_STATUSES: AcademyLeaveStatus[] = ["requested", "client_agreed", "approved", "rejected", "cancelled"];
export const LEAVE_KINDS: AcademyLeaveKind[] = ["vacation", "sick", "unpaid", "other"];

/** Statuses that are still open (the developer may cancel, Nordavo decides). */
export const OPEN_LEAVE: AcademyLeaveStatus[] = ["requested", "client_agreed"];

/** Working days in a period: Monday to Friday, without holidays that are a day off. */
export function workingDays(start: string, end: string, holidays: Iterable<string> = []): number {
  if (end < start) return 0;
  const off = new Set(holidays);
  let count = 0;
  for (let day = start; day <= end; day = addDaysIso(day, 1)) {
    if (isoWeekday(day) <= 5 && !off.has(day)) count++;
  }
  return count;
}

export type LeaveBalanceLike = { entitled_days: number; carried_over_days: number; adjustment_days: number } | null;
export type LeaveRequestLike = { kind: AcademyLeaveKind; status: AcademyLeaveStatus; start_date: string; days: number | null };

export type LeaveSummary = {
  year: number;
  /** Entitled plus carried over. */
  total: number;
  /** Approved vacation days in the year plus days taken outside the portal. */
  used: number;
  /** Requested or discussed with the client, not decided yet. */
  pending: number;
  remaining: number;
  hasBalance: boolean;
};

/** The balance of one year. A request counts in the year it starts. Only vacation uses the balance. */
export function leaveSummary(balance: LeaveBalanceLike, requests: LeaveRequestLike[], year: number): LeaveSummary {
  const inYear = requests.filter((r) => r.kind === "vacation" && Number(r.start_date.slice(0, 4)) === year);
  const sum = (status: AcademyLeaveStatus[]) =>
    inYear.filter((r) => status.includes(r.status)).reduce((total, r) => total + Number(r.days ?? 0), 0);
  const total = Number(balance?.entitled_days ?? 0) + Number(balance?.carried_over_days ?? 0);
  const used = sum(["approved"]) + Number(balance?.adjustment_days ?? 0);
  const pending = sum(OPEN_LEAVE);
  return { year, total, used, pending, remaining: round1(total - used), hasBalance: balance !== null };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
