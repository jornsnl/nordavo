/**
 * Candidate and vacancy fields from feedback round 3. Pure functions, used
 * by the forms, pages and tests.
 */
import type { ApplicationStage, ClientDecision, Seniority } from "@/lib/database.types";

// ---------------------------------------------------------------------------
// Seniority: one list for vacancies and candidates
// ---------------------------------------------------------------------------

export const SENIORITY_VALUES = [
  "intern",
  "fresher",
  "junior",
  "medior",
  "senior",
  "lead",
  "manager",
  "senior_manager",
  "freelance",
] as const satisfies readonly Seniority[];

export const seniorityOptions: { value: Seniority; label: string }[] = [
  { value: "intern", label: "Intern" },
  { value: "fresher", label: "Fresher" },
  { value: "junior", label: "Junior" },
  { value: "medior", label: "Medior" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead" },
  { value: "manager", label: "Manager" },
  { value: "senior_manager", label: "Senior manager" },
  { value: "freelance", label: "Freelance" },
];

export function isSeniority(value: unknown): value is Seniority {
  return SENIORITY_VALUES.includes(value as Seniority);
}

// ---------------------------------------------------------------------------
// Notice period
// ---------------------------------------------------------------------------

export const NOTICE_VALUES = ["immediate", "15", "30", "45", "60", "90_plus"] as const;
export type NoticePeriod = (typeof NOTICE_VALUES)[number];

export const noticePeriodOptions: { value: NoticePeriod; label: string }[] = [
  { value: "immediate", label: "Immediately" },
  { value: "15", label: "15 days" },
  { value: "30", label: "30 days" },
  { value: "45", label: "45 days" },
  { value: "60", label: "60 days" },
  { value: "90_plus", label: "90 days or more" },
];

export function isNoticePeriod(value: unknown): value is NoticePeriod {
  return NOTICE_VALUES.includes(value as NoticePeriod);
}

/**
 * Free text to a notice period option, or null when it cannot be read.
 * Same rules as public.normalize_notice_period(): weeks count 7 days,
 * months 30, and the number rounds up to the next option.
 */
export function parseNoticePeriod(input: string | null | undefined): NoticePeriod | null {
  const text = (input ?? "").trim().toLowerCase();
  if (!text) return null;
  if (isNoticePeriod(text)) return text;
  if (/(immediate|asap|right away|no notice|available now)/.test(text)) return "immediate";
  const number = /(\d+(\.\d+)?)/.exec(text)?.[1];
  if (!number) return null;
  let days: number;
  if (/month/.test(text)) days = Number(number) * 30;
  else if (/week/.test(text)) days = Number(number) * 7;
  else if (/day/.test(text) || /^\d+(\.\d+)?\s*\+?$/.test(text)) days = Number(number);
  else return null;
  if (days <= 0) return "immediate";
  if (days <= 15) return "15";
  if (days <= 30) return "30";
  if (days <= 45) return "45";
  if (days <= 60) return "60";
  return "90_plus";
}

/** Label for a stored notice period; old free text is shown as it is. */
export function noticePeriodLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return noticePeriodOptions.find((o) => o.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// Video intro: where it plays
// ---------------------------------------------------------------------------

export type VideoEmbed = { provider: "youtube" | "loom" | "vimeo" | "google_drive"; embedUrl: string };

/**
 * An embeddable player URL for Loom, YouTube, Vimeo or Google Drive links,
 * or null for anything else (then the page links to it).
 */
export function videoEmbed(url: string | null | undefined): VideoEmbed | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const id = (value: string | null | undefined) => (value && /^[\w-]{6,64}$/.test(value) ? value : null);

  if (host === "youtu.be") {
    const v = id(u.pathname.split("/")[1]);
    return v ? { provider: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${v}` } : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    const v = id(u.searchParams.get("v")) ?? (["embed", "shorts", "live"].includes(parts[0] ?? "") ? id(parts[1]) : null);
    return v ? { provider: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${v}` } : null;
  }
  if (host === "loom.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    const v = ["share", "embed"].includes(parts[0] ?? "") ? id(parts[1]) : null;
    return v ? { provider: "loom", embedUrl: `https://www.loom.com/embed/${v}` } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const v = u.pathname.split("/").filter(Boolean).find((p) => /^\d{5,12}$/.test(p));
    return v ? { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${v}` } : null;
  }
  if (host === "drive.google.com") {
    const m = /\/file\/d\/([\w-]{10,100})/.exec(u.pathname);
    const v = m?.[1] ?? (u.pathname === "/open" ? u.searchParams.get("id") : null);
    return v && /^[\w-]{10,100}$/.test(v) ? { provider: "google_drive", embedUrl: `https://drive.google.com/file/d/${v}/preview` } : null;
  }
  return null;
}

export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v"];
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export function isVideoFile(fileName: string, mime?: string | null): boolean {
  const name = fileName.toLowerCase();
  if (mime && mime.startsWith("video/")) return true;
  return VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// ---------------------------------------------------------------------------
// Duplicates on name
// ---------------------------------------------------------------------------

/** Name as compared for duplicates: trimmed, lower case, single spaces. */
export function nameKey(name: string | null | undefined): string | null {
  const key = (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return key.length >= 2 ? key : null;
}

// ---------------------------------------------------------------------------
// Candidate page: the next step in the selection
// ---------------------------------------------------------------------------

const NEXT_STEPS: Record<ApplicationStage, string> = {
  sourced: "Run the techstack check or send the application form",
  techstack_check: "Check the techstack",
  fill_out: "Wait for the application form",
  video_review: "Review the video intro",
  technical_test: "Send or score the technical test",
  interview: "Hold the interview",
  matched: "Wait for the client's decision",
  client_interview: "Client interview, then collect the feedback",
  final_screening: "Final screening and background check",
  placed: "Placed: follow up in Placements",
  parked: "Parked: resume when the time is right",
  rejected: "Rejected for this vacancy",
};

/** The next step for an application, from its stage and the client's decision. */
export function nextStepFor(stage: ApplicationStage | null, clientDecision?: ClientDecision | null): string {
  if (!stage) return "Link the candidate to a vacancy";
  if (stage === "matched" && clientDecision === "approved") return "Plan the client interview";
  if (stage === "matched" && clientDecision === "rejected") return "Client said no: park or reject";
  return NEXT_STEPS[stage];
}

const EXIT: ApplicationStage[] = ["parked", "rejected"];

/**
 * The application the page header shows: the most advanced one still in
 * the flow, else the newest. Input in any order.
 */
export function mainApplication<T extends { stage: ApplicationStage; created_at: string }>(applications: T[], order: readonly ApplicationStage[]): T | null {
  if (applications.length === 0) return null;
  const rank = (s: ApplicationStage) => order.indexOf(s);
  const active = applications.filter((a) => !EXIT.includes(a.stage));
  const pool = active.length > 0 ? active : applications;
  return [...pool].sort((a, b) => rank(b.stage) - rank(a.stage) || b.created_at.localeCompare(a.created_at))[0];
}
