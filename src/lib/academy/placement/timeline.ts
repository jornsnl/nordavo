// The timeline of a placement: day 1, week 1, 30 days and the review after
// 90 days, from the start date (academy_ensure_milestones() in SQL makes the
// rows). Each moment has a review form for the client contacts and the
// developer, and a report by Nordavo. Pure, tested in
// tests/academy-placement.test.ts.

import type { AcademyMilestoneKind } from "@/lib/academy/database";
import { addDaysIso } from "@/lib/academy/time";

/** Day offsets from the start date (0 is day 1). Same as the SQL. */
export const MILESTONES: { kind: Exclude<AcademyMilestoneKind, "custom">; offsetDays: number }[] = [
  { kind: "day_1", offsetDays: 0 },
  { kind: "week_1", offsetDays: 6 },
  { kind: "day_30", offsetDays: 29 },
  { kind: "day_90", offsetDays: 89 },
];

export function timelineFor(startDate: string): { kind: AcademyMilestoneKind; dueDate: string }[] {
  return MILESTONES.map((m) => ({ kind: m.kind, dueDate: addDaysIso(startDate, m.offsetDays) }));
}

export type MilestoneState = "done" | "due" | "overdue" | "upcoming";

/**
 * Done once Nordavo's report is out; due from its date until a week after,
 * overdue after that, upcoming before.
 */
export function milestoneState(m: { due_date: string | null; completed_at: string | null }, today: string): MilestoneState {
  if (m.completed_at) return "done";
  if (!m.due_date || m.due_date > today) return "upcoming";
  return addDaysIso(m.due_date, 7) < today ? "overdue" : "due";
}

/** May this person still fill in the form of this moment? From a week before. */
export function reviewOpen(m: { due_date: string | null; completed_at: string | null }, today: string): boolean {
  if (m.completed_at) return false;
  return !m.due_date || addDaysIso(m.due_date, -7) <= today;
}

/** The review form: one score and three open questions, same for every moment. */
export const REVIEW_QUESTIONS = [
  { key: "rating", type: "rating" },
  { key: "going_well", type: "text" },
  { key: "improve", type: "text" },
  { key: "support", type: "text" },
] as const;

export type ReviewAnswers = { rating?: number; going_well?: string; improve?: string; support?: string };

/** Clean answers from a form or the database. */
export function parseReviewAnswers(value: unknown): ReviewAnswers {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const out: ReviewAnswers = {};
  const rating = Number(source.rating);
  if (Number.isInteger(rating) && rating >= 1 && rating <= 5) out.rating = rating;
  for (const key of ["going_well", "improve", "support"] as const) {
    const text = source[key];
    if (typeof text === "string" && text.trim()) out[key] = text.trim().slice(0, 5000);
  }
  return out;
}
