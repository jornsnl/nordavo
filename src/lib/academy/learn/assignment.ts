// Assignment block (Academy: opdrachtblok): content, formats, the fixed
// rubric and file names. Pure, safe for client components, tested in
// tests/academy-learn.test.ts. Handing in and reviewing happen in SQL
// (academy_submit_assignment, academy_review_submission).

import type { Json } from "@/lib/database.types";

export const ASSIGNMENT_FORMATS = ["text", "file", "link"] as const;
export type AssignmentFormat = (typeof ASSIGNMENT_FORMATS)[number];

/** The fixed rubric. The AI proposes 1 to 5 per criterion; Nordavo decides. */
export const RUBRIC = [
  { key: "clarity", label: "Clarity", description: "Is it clear what, who, when and why? Could someone act on it without asking?" },
  { key: "proactivity", label: "Proactivity", description: "Does the person take initiative, anticipate questions and propose next steps?" },
  { key: "says_no", label: "Dares to say no", description: "Does the person name limits, risks or disagreement openly instead of agreeing to everything?" },
  { key: "english", label: "English", description: "Is the English clear, correct and professional enough for a Dutch team?" },
] as const;

export type RubricKey = (typeof RUBRIC)[number]["key"];
export type RubricScores = Partial<Record<RubricKey, number>>;

export const MAX_SUBMISSION_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_SUBMISSION_TEXT = 50_000;

function asObject(value: Json | null | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Json | undefined>) : {};
}

export function isAssignmentFormat(value: unknown): value is AssignmentFormat {
  return typeof value === "string" && (ASSIGNMENT_FORMATS as readonly string[]).includes(value);
}

/** The ways to hand in that the block allows (all three when not set). */
export function assignmentFormats(content: Json | null | undefined): AssignmentFormat[] {
  const raw = asObject(content).formats;
  const list = Array.isArray(raw) ? ASSIGNMENT_FORMATS.filter((f) => raw.includes(f)) : [];
  return list.length > 0 ? [...list] : [...ASSIGNMENT_FORMATS];
}

export function assignmentPrompt(content: Json | null | undefined): string {
  const prompt = asObject(content).prompt;
  return typeof prompt === "string" ? prompt : "";
}

/** Content as stored: the prompt (plain text, at most 10,000 characters) and the formats. */
export function sanitizeAssignmentContent(content: Json | null | undefined): { prompt: string; formats: AssignmentFormat[] } {
  return { prompt: assignmentPrompt(content).slice(0, 10_000), formats: assignmentFormats(content) };
}

/** Rubric scores limited to the four criteria, whole numbers 1 to 5 (as academy_clean_rubric). */
export function cleanRubric(raw: unknown): RubricScores {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: RubricScores = {};
  for (const { key } of RUBRIC) {
    const value = input[key];
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= 5) out[key] = n;
  }
  return out;
}

/**
 * The rubric as a score of 0 to 100: the share of the maximum (5 per
 * criterion) over the criteria that were scored. Null when none is.
 */
export function rubricTotal(scores: RubricScores): number | null {
  const values = RUBRIC.map((r) => scores[r.key]).filter((v): v is number => typeof v === "number");
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / (values.length * 5)) * 100);
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

/** A file name that is safe in a storage path. */
export function safeFileName(name: string): string {
  const clean = name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(-120);
  return clean || "file";
}

/** academy/submission/<profile_id>/<block_id>/<random>-<name> (storage policy: own folder). */
export function submissionPath(profileId: string, blockId: string, fileName: string, random: string): string {
  return `academy/submission/${profileId}/${blockId}/${random}-${safeFileName(fileName)}`;
}
