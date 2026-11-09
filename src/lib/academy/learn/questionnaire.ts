// Questionnaire block (Academy: persoonlijkheidstest als vragenlijst): the
// definition Nordavo makes in the editor, answer checks and the scoring per
// dimension. Pure, safe for client components, tested in
// tests/academy-learn.test.ts. The stored result is computed in SQL
// (academy_questionnaire_score, same rule as scoreQuestionnaire below); the
// actual personality test is still to be specified by Julius.

import type { Json } from "@/lib/database.types";

export const QUESTION_KINDS = ["scale", "choice", "open"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export type QuestionnaireQuestion = {
  id: string;
  kind: QuestionKind;
  text: string;
  /** Choice: the options. */
  options: string[];
  /** Choice: per option the score (1 to 5) for the dimension, or null. */
  optionScores: (number | null)[];
  /** The dimension the answer counts for (scale and choice), or null. */
  dimension: string | null;
  /** Scale: 5 counts as 1 (6 minus the answer). */
  reverse: boolean;
  required: boolean;
};

export type QuestionnaireDimension = { key: string; label: string };

export type QuestionnaireDefinition = {
  intro: string;
  consentText: string;
  /** Labels of the scale ends, e.g. "Disagree" and "Agree". */
  scaleLow: string;
  scaleHigh: string;
  /** Show the learner their own result after submitting (off by default). */
  showResult: boolean;
  dimensions: QuestionnaireDimension[];
  questions: QuestionnaireQuestion[];
};

export type QuestionnaireAnswers = Record<string, number | string>;

export const MAX_QUESTIONS = 200;
export const MAX_OPEN_ANSWER = 5000;

const DEFAULT_CONSENT =
  "I agree that Nordavo stores my answers to this questionnaire and uses them, with the result, to guide me. Only Nordavo sees them, never a client. I can withdraw this consent at any time; my answers are then deleted.";

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** A key for a dimension: lowercase letters, digits and underscores. */
export function dimensionKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * The definition from block content, cleaned: known kinds only, ids unique
 * (made from the position when missing), dimensions that exist, choice
 * questions with at least two options. Used to sanitize on save and to
 * render the editor and the viewer.
 */
export function parseQuestionnaire(content: Json | null | undefined): QuestionnaireDefinition {
  const c = obj(content);
  const dimensions: QuestionnaireDimension[] = [];
  for (const raw of Array.isArray(c.dimensions) ? c.dimensions : []) {
    const d = obj(raw);
    const label = str(d.label, 100);
    const key = dimensionKey(str(d.key, 40) || label);
    if (!key || dimensions.some((x) => x.key === key)) continue;
    dimensions.push({ key, label: label || key });
  }
  const keys = new Set(dimensions.map((d) => d.key));
  const questions: QuestionnaireQuestion[] = [];
  const ids = new Set<string>();
  (Array.isArray(c.questions) ? c.questions : []).slice(0, MAX_QUESTIONS).forEach((raw, index) => {
    const q = obj(raw);
    const kind = (QUESTION_KINDS as readonly string[]).includes(q.kind as string) ? (q.kind as QuestionKind) : "scale";
    const text = str(q.text, 1000);
    if (!text) return;
    let id = str(q.id, 40).replace(/[^\w-]/g, "") || `q${index + 1}`;
    while (ids.has(id)) id = `${id}_${index + 1}`;
    ids.add(id);
    const options = kind === "choice" ? (Array.isArray(q.options) ? q.options : []).map((o) => str(o, 300)).filter(Boolean).slice(0, 10) : [];
    if (kind === "choice" && options.length < 2) return;
    const scoresRaw = Array.isArray(q.option_scores) ? q.option_scores : [];
    const optionScores = options.map((_, i) => {
      const n = scoresRaw[i];
      return typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
    });
    const dimension = kind !== "open" && typeof q.dimension === "string" && keys.has(q.dimension) ? q.dimension : null;
    questions.push({
      id,
      kind,
      text,
      options,
      optionScores,
      dimension,
      reverse: kind === "scale" && q.reverse === true,
      required: kind === "open" ? q.required === true : q.required !== false,
    });
  });
  return {
    intro: str(c.intro, 5000),
    consentText: str(c.consent_text, 3000) || DEFAULT_CONSENT,
    scaleLow: str(c.scale_low, 60),
    scaleHigh: str(c.scale_high, 60),
    showResult: c.show_result === true,
    dimensions,
    questions,
  };
}

/** The definition as block content (the keys the SQL reads). */
export function questionnaireContent(def: QuestionnaireDefinition): { [key: string]: Json } {
  return {
    intro: def.intro,
    consent_text: def.consentText,
    scale_low: def.scaleLow,
    scale_high: def.scaleHigh,
    show_result: def.showResult,
    dimensions: def.dimensions.map((d) => ({ key: d.key, label: d.label })),
    questions: def.questions.map((q) => ({
      id: q.id,
      kind: q.kind,
      text: q.text,
      ...(q.kind === "choice" ? { options: q.options, option_scores: q.optionScores } : {}),
      ...(q.dimension ? { dimension: q.dimension } : {}),
      ...(q.reverse ? { reverse: true } : {}),
      required: q.required,
    })),
  };
}

/** Is this answer filled in (and valid for the question)? */
export function isAnswered(q: QuestionnaireQuestion, value: unknown): boolean {
  if (q.kind === "open") return typeof value === "string" && value.trim() !== "" && value.length <= MAX_OPEN_ANSWER;
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  return q.kind === "scale" ? value >= 1 && value <= 5 : value >= 0 && value < q.options.length;
}

/** The required questions that are not answered yet (ids). */
export function missingRequired(def: QuestionnaireDefinition, answers: QuestionnaireAnswers): string[] {
  return def.questions.filter((q) => q.required && !isAnswered(q, answers[q.id])).map((q) => q.id);
}

/** Answers limited to the questions of the definition, valid ones only. */
export function cleanAnswers(def: QuestionnaireDefinition, raw: unknown): QuestionnaireAnswers {
  const input = obj(raw);
  const out: QuestionnaireAnswers = {};
  for (const q of def.questions) {
    const value = input[q.id];
    if (isAnswered(q, value)) out[q.id] = q.kind === "open" ? (value as string) : (value as number);
  }
  return out;
}

export type DimensionScore = { key: string; label: string; score: number | null; answered: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Score per dimension: the average (2 decimals) of the scale answers
 * (reverse: 6 minus the answer) and the option scores of choice answers
 * that count for it. Same as academy_questionnaire_score in SQL.
 */
export function scoreQuestionnaire(def: QuestionnaireDefinition, answers: QuestionnaireAnswers): DimensionScore[] {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const q of def.questions) {
    if (!q.dimension) continue;
    const answer = answers[q.id];
    if (typeof answer !== "number") continue;
    let value: number | null = null;
    if (q.kind === "scale") value = q.reverse ? 6 - answer : answer;
    else if (q.kind === "choice") value = q.optionScores[answer] ?? null;
    if (value === null) continue;
    const cur = sums.get(q.dimension) ?? { sum: 0, n: 0 };
    sums.set(q.dimension, { sum: cur.sum + value, n: cur.n + 1 });
  }
  return def.dimensions.map((d) => {
    const s = sums.get(d.key);
    return { key: d.key, label: d.label, score: s && s.n > 0 ? round2(s.sum / s.n) : null, answered: s?.n ?? 0 };
  });
}

/** The stored result ({ dimensions: [...] }), typed. */
export function parseQuestionnaireResult(value: Json | null | undefined): DimensionScore[] {
  const dims = obj(value).dimensions;
  if (!Array.isArray(dims)) return [];
  return dims
    .map((d) => obj(d))
    .filter((d) => typeof d.key === "string")
    .map((d) => ({
      key: d.key as string,
      label: typeof d.label === "string" ? d.label : (d.key as string),
      score: typeof d.score === "number" ? d.score : typeof d.score === "string" && d.score !== "" ? Number(d.score) : null,
      answered: typeof d.answered === "number" ? d.answered : 0,
    }));
}
