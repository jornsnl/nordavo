// The lesson block types: what each one stores, its defaults and its
// completion rule (Academy: lesblokken-framework). Pure and shared by the
// editor, the player and the server. The UI half of the registry (editor and
// viewer components) is src/components/academy/blocks/registry.tsx; the SQL
// half is public.academy_block_done_<type>() in
// supabase/migrations/20261112020000_academy_learning.sql.
//
// Adding a block type (docs/academy.md, "Een bloktype toevoegen"):
//   1. add it to the check on academy_lesson_blocks.type and write
//      public.academy_block_done_<type>(block_id, profile_id);
//   2. add it to AcademyBlockType and to blockTypes below;
//   3. add the i18n keys block.<type> and req.<type>;
//   4. register an editor and a viewer in src/components/academy/blocks/registry.tsx.

import type { AcademyBlockType, AcademyLocale } from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";
import { t } from "@/lib/academy/i18n";

export type BlockContent = { [key: string]: Json | undefined };
export type BlockCompletion = { [key: string]: Json | undefined };

/** A field of the completion rule, edited per block in the lesson editor. */
export type CompletionField =
  | { key: string; label: string; kind: "percent"; defaultValue: number; min?: number; max?: number }
  | { key: string; label: string; kind: "select"; defaultValue: string; options: { value: string; label: string }[] };

export type BlockTypeMeta = {
  type: AcademyBlockType;
  /** Name in the (English) editor. */
  adminLabel: string;
  /** One line for the "add block" menu. */
  adminDescription: string;
  /** Which media the block points at (academy_lesson_blocks.video_id or document_id). */
  media: "video" | "document" | null;
  defaultContent: BlockContent;
  /** New blocks of this type are required for the green check. */
  defaultRequired: boolean;
  completionFields: CompletionField[];
  /** What the learner must do, in their language. */
  requirement: (completion: BlockCompletion, locale: AcademyLocale) => string;
  /** Shown in the editor menu but marked as reserved (personality test). */
  reserved?: boolean;
};

function numberOr(value: Json | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export const blockTypes: Record<AcademyBlockType, BlockTypeMeta> = {
  explanation: {
    type: "explanation",
    adminLabel: "Explanation",
    adminDescription: "Text with headings, lists, images and links.",
    media: null,
    defaultContent: { html: "" },
    defaultRequired: false,
    completionFields: [],
    requirement: (_c, locale) => t(locale, "req.explanation"),
  },
  video: {
    type: "video",
    adminLabel: "Video",
    adminDescription: "Own recording with subtitles, transcript and watch progress.",
    media: "video",
    defaultContent: {},
    defaultRequired: true,
    completionFields: [{ key: "min_percent", label: "Watched at least (%)", kind: "percent", defaultValue: 90, min: 1, max: 100 }],
    requirement: (c, locale) => t(locale, "req.video", { percent: numberOr(c.min_percent, 90) }),
  },
  document: {
    type: "document",
    adminLabel: "Document",
    adminDescription: "A download: workbook, template or checklist (PDF, Word, Excel).",
    media: "document",
    defaultContent: {},
    defaultRequired: false,
    completionFields: [],
    requirement: (_c, locale) => t(locale, "req.document"),
  },
  worksheet: {
    type: "worksheet",
    adminLabel: "Worksheet",
    adminDescription: "Fill in the portal, saved per person, visible to Nordavo.",
    media: "document",
    defaultContent: {},
    defaultRequired: true,
    completionFields: [],
    requirement: (_c, locale) => t(locale, "req.worksheet"),
  },
  assignment: {
    type: "assignment",
    adminLabel: "Assignment",
    adminDescription: "Hand in text, a file or a link; Nordavo reviews it.",
    media: null,
    defaultContent: { prompt: "" },
    defaultRequired: true,
    completionFields: [
      {
        key: "require",
        label: "Counts as done when",
        kind: "select",
        defaultValue: "submitted",
        options: [
          { value: "submitted", label: "Handed in" },
          { value: "approved", label: "Approved by Nordavo" },
        ],
      },
    ],
    requirement: (c, locale) => t(locale, c.require === "approved" ? "req.assignmentApproved" : "req.assignment"),
  },
  tasks: {
    type: "tasks",
    adminLabel: "Tasks",
    adminDescription: "Tasks to tick off, with relative deadlines, shared or only with a placement.",
    media: null,
    defaultContent: {},
    defaultRequired: true,
    completionFields: [],
    requirement: (_c, locale) => t(locale, "req.tasks"),
  },
  knowledge_check: {
    type: "knowledge_check",
    adminLabel: "Knowledge check",
    adminDescription: "Three multiple choice questions with an explanation after each answer.",
    media: null,
    defaultContent: {},
    defaultRequired: true,
    completionFields: [{ key: "min_percent", label: "Minimum score (%)", kind: "percent", defaultValue: 0, min: 0, max: 100 }],
    requirement: (c, locale) => {
      const percent = numberOr(c.min_percent, 0);
      return percent > 0 ? t(locale, "req.knowledgeCheckScore", { percent }) : t(locale, "req.knowledge_check");
    },
  },
  notes: {
    type: "notes",
    adminLabel: "Notes",
    adminDescription: "Own notes field per lesson or per module, saved automatically.",
    media: null,
    defaultContent: { scope: "lesson", prompt: "" },
    defaultRequired: false,
    completionFields: [],
    requirement: (_c, locale) => t(locale, "req.notes"),
  },
  questionnaire: {
    type: "questionnaire",
    adminLabel: "Questionnaire",
    adminDescription: "Reserved for the personality test: own consent and access rights.",
    media: null,
    defaultContent: {},
    defaultRequired: false,
    completionFields: [],
    requirement: (_c, locale) => t(locale, "req.questionnaire"),
    reserved: true,
  },
};

export const BLOCK_TYPES = Object.keys(blockTypes) as AcademyBlockType[];

export function isBlockType(value: unknown): value is AcademyBlockType {
  return typeof value === "string" && value in blockTypes;
}

function asObject(value: Json | null | undefined): BlockContent {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as BlockContent) : {};
}

/** Content as an object (stored JSON can be anything in theory). */
export function blockContent(value: Json | null | undefined): BlockContent {
  return asObject(value);
}

/**
 * The completion rule of a block, limited to the fields its type knows and
 * clamped to their range; unknown keys are dropped.
 */
export function normalizeCompletion(type: AcademyBlockType, raw: Json | null | undefined): BlockCompletion {
  const input = asObject(raw);
  const out: BlockCompletion = {};
  for (const field of blockTypes[type].completionFields) {
    const value = input[field.key];
    if (field.kind === "percent") {
      const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
      if (Number.isFinite(n)) {
        out[field.key] = Math.round(Math.min(field.max ?? 100, Math.max(field.min ?? 0, n)));
      }
    } else if (typeof value === "string" && field.options.some((o) => o.value === value)) {
      out[field.key] = value;
    }
  }
  return out;
}

/** Explanation: the stored HTML (sanitized on save and on render). */
export function explanationHtml(content: Json | null | undefined): string {
  const html = asObject(content).html;
  return typeof html === "string" ? html : "";
}

/** Notes: per lesson (default) or per module. */
export function notesScope(content: Json | null | undefined): "lesson" | "module" {
  return asObject(content).scope === "module" ? "module" : "lesson";
}

export function notesPrompt(content: Json | null | undefined): string {
  const prompt = asObject(content).prompt;
  return typeof prompt === "string" ? prompt : "";
}
