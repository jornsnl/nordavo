/**
 * Pure helpers for the recruitment pipeline (brief 2.1 to 2.4, 2.12, 2.13):
 * board filters and sorting, range selection, screening tools and the bulk
 * move request shared by the board and the MCP server. No server or
 * browser APIs here, so tests can import it directly.
 */
import { z } from "zod";
import type { ApplicationStage, CandidateOrigin, CandidateSource, ScreeningTool } from "@/lib/database.types";

/** Flow stages in board order; parked and rejected sit apart from them. */
export const FLOW_STAGES = [
  "sourced",
  "techstack_check",
  "fill_out",
  "video_review",
  "technical_test",
  "interview",
  "matched",
  "client_interview",
  "final_screening",
  "placed",
] as const satisfies readonly ApplicationStage[];

export const EXIT_STAGES = ["parked", "rejected"] as const satisfies readonly ApplicationStage[];

export function isExitStage(stage: ApplicationStage): stage is (typeof EXIT_STAGES)[number] {
  return stage === "parked" || stage === "rejected";
}

// ---------------------------------------------------------------------------
// Bulk moves
// ---------------------------------------------------------------------------

/** Where a bulk move sends cards: a stage, parked, rejected, or back where they left. */
export const moveTargets = [...FLOW_STAGES, ...EXIT_STAGES, "resume"] as const;
export type MoveTarget = (typeof moveTargets)[number];

export const MAX_BULK_MOVE = 1000;

export const bulkMoveSchema = z.object({
  applicationIds: z.array(z.guid()).min(1, "Select at least one candidate.").max(MAX_BULK_MOVE),
  stage: z.enum(moveTargets),
  reason: z.string().trim().max(2000, "This reason is too long.").optional(),
  parkUntil: z.iso.date().optional(),
});

export type BulkMoveInput = z.infer<typeof bulkMoveSchema>;

/** Arguments for public.move_applications(), from a validated bulk move. */
export function moveArgs(input: BulkMoveInput) {
  return {
    p_application_ids: [...new Set(input.applicationIds)],
    p_stage: input.stage,
    p_reason: input.stage === "parked" || input.stage === "rejected" ? input.reason || null : null,
    p_park_until: input.stage === "parked" ? (input.parkUntil ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Board filters and sorting
// ---------------------------------------------------------------------------

export const boardSorts = [
  { value: "board", label: "Board order" },
  { value: "cv_score", label: "CV score" },
  { value: "video_score", label: "Video score" },
  { value: "test_score", label: "Test score" },
  { value: "days", label: "Longest in pipeline" },
] as const;
export type BoardSort = (typeof boardSorts)[number]["value"];

export type BoardFilter = {
  sort: BoardSort;
  origin: CandidateOrigin | "all";
  source: CandidateSource | "all";
  shortlistedOnly: boolean;
  toppersOnly: boolean;
  query: string;
};

export const defaultBoardFilter: BoardFilter = {
  sort: "board",
  origin: "all",
  source: "all",
  shortlistedOnly: false,
  toppersOnly: false,
  query: "",
};

/** True when the board shows another order or a subset: dragging is then off. */
export function isFiltered(filter: BoardFilter): boolean {
  return (
    filter.sort !== "board" ||
    filter.origin !== "all" ||
    filter.source !== "all" ||
    filter.shortlistedOnly ||
    filter.toppersOnly ||
    filter.query.trim() !== ""
  );
}

/** The fields of a card the filters and sorts look at. */
export type FilterableCard = {
  position: number;
  origin: CandidateOrigin;
  source: CandidateSource | null;
  cv_score: number | null;
  video_score: number | null;
  shortlisted_at: string | null;
  daysInPipeline: number;
  testScore: number | null;
  candidate: { full_name: string; is_topper: boolean; skills: string[]; current_title: string | null };
};

function matches<T extends FilterableCard>(card: T, filter: BoardFilter): boolean {
  if (filter.origin !== "all" && card.origin !== filter.origin) return false;
  if (filter.source !== "all" && card.source !== filter.source) return false;
  if (filter.shortlistedOnly && !card.shortlisted_at) return false;
  if (filter.toppersOnly && !card.candidate.is_topper) return false;
  const term = filter.query.trim().toLowerCase();
  if (term) {
    const { full_name, current_title, skills } = card.candidate;
    if (
      !full_name.toLowerCase().includes(term) &&
      !(current_title ?? "").toLowerCase().includes(term) &&
      !skills.some((s) => s.toLowerCase().includes(term))
    ) {
      return false;
    }
  }
  return true;
}

/** Highest first, empty scores last, then board order. */
function byScore<T extends FilterableCard>(score: (c: T) => number | null) {
  return (a: T, b: T) => {
    const x = score(a);
    const y = score(b);
    if (x === null && y === null) return a.position - b.position;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || a.position - b.position;
  };
}

/** One column after the board filters and sort. The input is not changed. */
export function applyBoardFilter<T extends FilterableCard>(cards: T[], filter: BoardFilter): T[] {
  const kept = cards.filter((c) => matches(c, filter));
  switch (filter.sort) {
    case "cv_score":
      return kept.sort(byScore((c) => c.cv_score));
    case "video_score":
      return kept.sort(byScore((c) => c.video_score));
    case "test_score":
      return kept.sort(byScore((c) => c.testScore));
    case "days":
      return kept.sort((a, b) => b.daysInPipeline - a.daysInPipeline || a.position - b.position);
    default:
      return kept.sort((a, b) => a.position - b.position);
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Shift click: select every card between the anchor (last clicked) and the
 * target, in the order shown, on top of the current selection. Without an
 * anchor that is still shown, only the target toggles.
 */
export function selectRange(
  ordered: string[],
  selected: ReadonlySet<string>,
  anchor: string | null,
  target: string,
): Set<string> {
  const next = new Set(selected);
  const from = anchor ? ordered.indexOf(anchor) : -1;
  const to = ordered.indexOf(target);
  if (from < 0 || to < 0) {
    if (next.has(target)) next.delete(target);
    else next.add(target);
    return next;
  }
  const [start, end] = from < to ? [from, to] : [to, from];
  for (const id of ordered.slice(start, end + 1)) next.add(id);
  return next;
}

/** Select all in a column, or clear it when everything there is selected already. */
export function toggleColumn(selected: ReadonlySet<string>, columnIds: string[]): Set<string> {
  const next = new Set(selected);
  const all = columnIds.length > 0 && columnIds.every((id) => next.has(id));
  for (const id of columnIds) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Form status (2.1, Fill out)
// ---------------------------------------------------------------------------

export type FormStatus = "not_sent" | "sent" | "completed";

export function formStatus(card: { form_sent_at: string | null; form_completed_at: string | null }): FormStatus {
  if (card.form_completed_at) return "completed";
  if (card.form_sent_at) return "sent";
  return "not_sent";
}

// ---------------------------------------------------------------------------
// Screening tools (2.12)
// ---------------------------------------------------------------------------

export const MAX_SCREENING_TOOLS = 30;

const screeningToolSchema = z.object({
  tool: z.string().trim().min(1, "Name the tool.").max(60, "Tool names are at most 60 characters."),
  years: z.coerce
    .number({ error: "Years must be a number." })
    .min(0, "Years cannot be negative.")
    .max(50, "At most 50 years."),
});

/**
 * Screening tools from the form (a JSON array of {tool, years}). Rows
 * without a tool name are dropped, names are deduplicated case-insensitively
 * (the last one wins), years are rounded to halves. Matches the database
 * check public.valid_screening_tools().
 */
export function parseScreeningTools(raw: unknown): { ok: true; tools: ScreeningTool[] } | { ok: false; error: string } {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") return { ok: true, tools: [] };
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: "The tool list could not be read." };
    }
  }
  if (!Array.isArray(value)) return { ok: false, error: "The tool list could not be read." };

  const byName = new Map<string, ScreeningTool>();
  for (const item of value) {
    if (!item || typeof item !== "object") return { ok: false, error: "The tool list could not be read." };
    const row = item as { tool?: unknown; years?: unknown };
    if (typeof row.tool !== "string" || row.tool.trim() === "") continue;
    if (row.years === "" || row.years === null || row.years === undefined) {
      return { ok: false, error: `Fill in the years for ${row.tool.trim()}.` };
    }
    const parsed = screeningToolSchema.safeParse(row);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the tools." };
    const years = Math.round(parsed.data.years * 2) / 2;
    byName.set(parsed.data.tool.toLowerCase(), { tool: parsed.data.tool, years });
  }
  const tools = [...byName.values()];
  if (tools.length > MAX_SCREENING_TOOLS) {
    return { ok: false, error: `At most ${MAX_SCREENING_TOOLS} tools.` };
  }
  return { ok: true, tools };
}

/** "Clay 2, n8n 2, Python 4" for cards and summaries. */
export function formatScreeningTools(tools: ScreeningTool[]): string {
  return tools.map((t) => `${t.tool} ${t.years}`).join(", ");
}

/** Screening tools as stored (jsonb), defensively typed. */
export function readScreeningTools(value: unknown): ScreeningTool[] {
  const parsed = parseScreeningTools(value);
  return parsed.ok ? parsed.tools : [];
}
