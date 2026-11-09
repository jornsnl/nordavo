// Knowledge check block (Academy: kennischeck): question input of the
// editor and the result the database returns. Pure, safe for client
// components, tested in tests/academy-learn.test.ts. Scoring is in SQL
// (academy_submit_check): the browser never gets the answers beforehand.

import type { Json } from "@/lib/database.types";

/** The spec asks for three multiple choice questions per check. */
export const CHECK_QUESTION_TARGET = 3;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

export type CheckQuestionInput = {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
};

/** A question from the editor, cleaned. Throws with a message for the editor. */
export function cleanCheckQuestion(raw: { question?: unknown; options?: unknown; correct_index?: unknown; explanation?: unknown }): CheckQuestionInput {
  const question = typeof raw.question === "string" ? raw.question.trim().slice(0, 2000) : "";
  if (!question) throw new Error("Write the question.");
  const list = Array.isArray(raw.options) ? raw.options : [];
  // Keep the position of the correct option while dropping empty ones.
  const correctRaw = typeof raw.correct_index === "number" ? raw.correct_index : Number(raw.correct_index);
  const options: string[] = [];
  let correct = -1;
  list.forEach((option, index) => {
    const text = typeof option === "string" ? option.trim().slice(0, 500) : "";
    if (!text) return;
    if (index === correctRaw) correct = options.length;
    options.push(text);
  });
  if (options.length < MIN_OPTIONS) throw new Error(`Give at least ${MIN_OPTIONS} options.`);
  if (options.length > MAX_OPTIONS) throw new Error(`At most ${MAX_OPTIONS} options.`);
  if (correct < 0) throw new Error("Mark the correct answer.");
  const explanation = typeof raw.explanation === "string" && raw.explanation.trim() ? raw.explanation.trim().slice(0, 5000) : null;
  return { question, options, correct_index: correct, explanation };
}

/** A hint for the editor when a check does not have three questions. */
export function checkCountWarning(count: number): string | null {
  if (count === 0) return "Add three questions. Without questions the learner cannot do the check.";
  if (count !== CHECK_QUESTION_TARGET) return `This check has ${count} question${count === 1 ? "" : "s"}; the Academy uses ${CHECK_QUESTION_TARGET} per check.`;
  return null;
}

export type CheckQuestionResult = {
  questionId: string;
  chosen: number | null;
  correctIndex: number;
  correct: boolean;
  explanation: string | null;
};

export type CheckResult = {
  score: number;
  maxScore: number;
  percent: number;
  attempts: number | null;
  bestPercent: number | null;
  createdAt: string | null;
  saved: boolean;
  results: CheckQuestionResult[];
};

function obj(value: Json | null | undefined): Record<string, Json | undefined> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Json | undefined>) : null;
}

const num = (v: Json | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The JSON of academy_submit_check() or academy_check_results(), typed. Null when there is none. */
export function parseCheckResult(value: Json | null | undefined): CheckResult | null {
  const o = obj(value);
  if (!o) return null;
  const results = Array.isArray(o.results) ? o.results : [];
  return {
    score: num(o.score) ?? 0,
    maxScore: num(o.max_score) ?? 0,
    percent: num(o.percent) ?? 0,
    attempts: num(o.attempts),
    bestPercent: num(o.best_percent),
    createdAt: typeof o.created_at === "string" ? o.created_at : null,
    saved: o.saved !== false,
    results: results
      .map((r) => obj(r))
      .filter((r): r is Record<string, Json | undefined> => r !== null && typeof r.question_id === "string")
      .map((r) => ({
        questionId: r.question_id as string,
        chosen: num(r.chosen),
        correctIndex: num(r.correct_index) ?? 0,
        correct: r.correct === true,
        explanation: typeof r.explanation === "string" ? r.explanation : null,
      })),
  };
}

/** Options as stored (a JSON array of strings). */
export function checkOptions(value: Json | null | undefined): string[] {
  return Array.isArray(value) ? value.map((o) => (typeof o === "string" ? o : String(o ?? ""))) : [];
}
