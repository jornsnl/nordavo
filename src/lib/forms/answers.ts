import { z } from "zod";
import type { CandidateSource } from "@/lib/database.types";
import { parseInrAmount } from "./compensation";
import { LIMITS, allQuestions, fieldName, targetOf, type Block, type Question } from "./schema";

/**
 * Validating a submitted form and mapping the answers onto the candidate.
 * Pure: takes the published blocks and the submitted FormData.
 */

export type AnswerValue = string | number | boolean | string[];
export type Answers = Record<string, AnswerValue>;

export const CV_MAX_BYTES = 10 * 1024 * 1024;
export const CV_EXTENSIONS = [".pdf", ".doc", ".docx"];
export const CV_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/** The hidden field bots fill in. */
export const HONEYPOT_FIELD = "company_website";

const emailSchema = z.email();
const PHONE_RE = /^\+?[\d\s().-]{7,25}$/;

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** "linkedin.com/in/x" -> "https://linkedin.com/in/x" */
export function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export type FileInput = { name: string; size: number; type: string };

export function checkCvFile(file: FileInput): string | null {
  const name = file.name.toLowerCase();
  if (!CV_EXTENSIONS.some((ext) => name.endsWith(ext))) return "Upload your CV as PDF, DOC or DOCX.";
  if (file.type && !CV_MIME_TYPES.includes(file.type)) return "Upload your CV as PDF, DOC or DOCX.";
  if (file.size <= 0) return "This file is empty.";
  if (file.size > CV_MAX_BYTES) return `Your CV can be at most ${CV_MAX_BYTES / 1024 / 1024} MB.`;
  return null;
}

type Reader = {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
};

export type ParsedSubmission =
  | { ok: true; answers: Answers; files: { question: Question; file: File }[] }
  | { ok: false; errors: Record<string, string> };

/** Validate every question; errors are keyed by question id. */
export function parseSubmission(blocks: Block[], data: Reader): ParsedSubmission {
  const answers: Answers = {};
  const errors: Record<string, string> = {};
  const files: { question: Question; file: File }[] = [];

  for (const q of allQuestions(blocks)) {
    const name = fieldName(q.id);

    if (q.type === "file") {
      const value = data.get(name);
      const file = value && typeof value !== "string" && value.size > 0 ? (value as File) : null;
      if (!file) {
        if (q.required) errors[q.id] = "Please upload a file.";
        continue;
      }
      const problem = checkCvFile(file);
      if (problem) errors[q.id] = problem;
      else files.push({ question: q, file });
      continue;
    }

    if (q.type === "multiple_choice") {
      const picked = data
        .getAll(name)
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean);
      const unique = [...new Set(picked)];
      if (unique.some((v) => !(q.options ?? []).includes(v))) {
        errors[q.id] = "Pick from the list.";
      } else if (unique.length === 0) {
        if (q.required) errors[q.id] = "Pick at least one.";
      } else {
        answers[q.id] = unique;
      }
      continue;
    }

    const raw = data.get(name);
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      if (q.required) errors[q.id] = q.type === "yes_no" ? "Please choose yes or no." : "This question is required.";
      continue;
    }

    const result = parseValue(q, text);
    if ("error" in result) errors[q.id] = result.error;
    else answers[q.id] = result.value;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, answers, files };
}

function parseValue(q: Question, text: string): { value: AnswerValue } | { error: string } {
  switch (q.type) {
    case "short_text":
      return text.length > LIMITS.shortText ? { error: `At most ${LIMITS.shortText} characters.` } : { value: text };
    case "long_text":
      return text.length > LIMITS.longText ? { error: `At most ${LIMITS.longText} characters.` } : { value: text };
    case "email": {
      const email = text.toLowerCase();
      return emailSchema.safeParse(email).success && email.length <= 320
        ? { value: email }
        : { error: "Enter a valid email address." };
    }
    case "phone": {
      const digits = text.replace(/\D/g, "");
      return PHONE_RE.test(text) && digits.length >= 7 && digits.length <= 15
        ? { value: text }
        : { error: "Enter a valid phone number." };
    }
    case "url": {
      const url = normalizeUrl(text);
      return url.length <= 1000 && isHttpUrl(url) ? { value: url } : { error: "Enter a valid link starting with https://" };
    }
    case "number": {
      const n = Number(text.replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) return { error: "Enter a number." };
      if (q.mapsTo === "years_experience" && n > 60) return { error: "Enter the number of years." };
      return { value: n };
    }
    case "single_choice":
      return (q.options ?? []).includes(text) ? { value: text } : { error: "Pick from the list." };
    case "yes_no":
      return text === "yes" ? { value: true } : text === "no" ? { value: false } : { error: "Please choose yes or no." };
    case "current_ctc":
    case "expected_ctc": {
      const amount = parseInrAmount(text);
      return amount !== null && amount > 0 && amount <= 1_000_000_000
        ? { value: amount }
        : { error: "Enter the amount in rupees per year, for example 1200000 or 12 LPA." };
    }
    case "hourly_rate": {
      const amount = parseInrAmount(text);
      return amount !== null && amount > 0 && amount <= 1_000_000
        ? { value: amount }
        : { error: "Enter your rate in rupees per hour, for example 800." };
    }
    default:
      return { error: "Unknown question." };
  }
}

export type CandidateFields = {
  full_name?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  video_url?: string;
  current_company?: string;
  years_experience?: number;
  notice_period?: string;
  willing_to_relocate?: boolean;
  location?: string;
};

export type CompensationFields = {
  current_ctc_inr_year?: number;
  expected_ctc_inr_year?: number;
  asked_hourly_inr?: number;
};

export type MappedAnswers = {
  candidate: CandidateFields;
  compensation: CompensationFields;
  source: CandidateSource | null;
};

const SOURCE_WORDS: [RegExp, CandidateSource][] = [
  [/linked\s*in/i, "linkedin"],
  [/naukri/i, "naukri"],
  [/manatal/i, "manatal"],
  [/indeed/i, "indeed"],
  [/monster/i, "monster"],
  [/insta/i, "instagram"],
  [/refer|friend|colleague|word of mouth/i, "referral"],
  [/website|google|nordavo/i, "website"],
  [/head\s*hunt|recruiter (approached|contacted)/i, "headhunted"],
];

/** "Instagram (@nordavotalent)" -> "instagram"; unknown answers -> "other". */
export function sourceFromAnswer(answer: string | null | undefined): CandidateSource | null {
  if (!answer) return null;
  return SOURCE_WORDS.find(([re]) => re.test(answer))?.[1] ?? "other";
}

/** Map the answers onto candidate fields and compensation, by question target. */
export function mapAnswers(blocks: Block[], answers: Answers): MappedAnswers {
  const candidate: CandidateFields = {};
  const compensation: CompensationFields = {};
  let source: CandidateSource | null = null;

  for (const q of allQuestions(blocks)) {
    const value = answers[q.id];
    if (value === undefined) continue;
    const target = targetOf(q);
    switch (target) {
      case "full_name":
      case "current_company":
      case "notice_period":
      case "location":
        if (typeof value === "string") candidate[target] = value.slice(0, 200);
        break;
      case "email":
      case "phone":
        if (typeof value === "string") candidate[target] = value;
        break;
      case "linkedin_url":
      case "video_url":
        if (typeof value === "string") candidate[target] = value;
        break;
      case "years_experience":
        if (typeof value === "number") candidate.years_experience = Math.round(value);
        break;
      case "willing_to_relocate":
        if (typeof value === "boolean") candidate.willing_to_relocate = value;
        break;
      case "source":
        if (typeof value === "string") source = sourceFromAnswer(value);
        break;
      case "current_ctc":
        if (typeof value === "number") compensation.current_ctc_inr_year = value;
        break;
      case "expected_ctc":
        if (typeof value === "number") compensation.expected_ctc_inr_year = value;
        break;
      case "hourly_rate":
        if (typeof value === "number") compensation.asked_hourly_inr = value;
        break;
      default:
        break;
    }
  }

  // Forms without a name question: fall back on the first short text labelled "name".
  if (!candidate.full_name) {
    const nameQuestion = allQuestions(blocks).find((q) => q.type === "short_text" && /\bname\b/i.test(q.label));
    const value = nameQuestion ? answers[nameQuestion.id] : undefined;
    if (typeof value === "string") candidate.full_name = value.slice(0, 200);
  }

  return { candidate, compensation, source };
}

/** An answer as plain text, for tables and filters. */
export function answerText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    const file = value as { file_name?: string };
    return file.file_name ?? "File";
  }
  return String(value);
}
