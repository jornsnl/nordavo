import "server-only";
import type { AcademyBlockType, AcademyLessonBlockRow } from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";
import { type BlockContent, blockContent, explanationHtml, notesPrompt, notesScope } from "@/lib/academy/blocks/types";
import { sanitizeHtml } from "@/lib/academy/sanitize";
import { sanitizeAssignmentContent } from "@/lib/academy/learn/assignment";
import { parseQuestionnaire, questionnaireContent } from "@/lib/academy/learn/questionnaire";
import { loadAssignmentStates, loadCheckStates, loadQuestionnaireStates, loadTaskStates } from "@/lib/academy/learn/states";
import type { createClient } from "@/lib/supabase/server";

// The server half of the block registry (docs/academy.md):
//
//   contentSanitizers  clean a block's content before it is saved from the
//                      lesson editor (src/app/dashboard/academy/actions.ts,
//                      updateBlock). Types without one keep their JSON as is,
//                      limited in size.
//   blockStateLoaders  load what the viewer of a block type needs for the
//                      signed-in learner (own note, watch position, signed
//                      file URL, task status ...). The lesson player calls
//                      loadBlockStates() and passes state[block.id] to the
//                      viewer as `state`.
//
// A block type builder adds one entry to each map; nothing else changes.

export type BlockStateContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  lessonId: string;
  /** The module the lesson is shown in (a lesson can be in more than one). */
  moduleId: string | null;
  /** Manager preview: load nothing personal. */
  preview: boolean;
};

export type BlockStateLoader = (blocks: AcademyLessonBlockRow[], ctx: BlockStateContext) => Promise<Record<string, Json>>;

const MAX_CONTENT_BYTES = 200_000;

export const contentSanitizers: Partial<Record<AcademyBlockType, (content: BlockContent) => BlockContent>> = {
  explanation: (content) => ({ html: sanitizeHtml(explanationHtml(content)) }),
  notes: (content) => ({ scope: notesScope(content), prompt: notesPrompt(content).slice(0, 1000) }),
  // Area learn (src/lib/academy/learn): tasks and check questions are own rows.
  assignment: (content) => sanitizeAssignmentContent(content as Json),
  tasks: () => ({}),
  knowledge_check: () => ({}),
  questionnaire: (content) => questionnaireContent(parseQuestionnaire(content as Json)),
};

/** The content to store for a block, cleaned for its type. Throws when too large. */
export function sanitizeBlockContent(type: AcademyBlockType, raw: Json | null | undefined): BlockContent {
  const content = blockContent(raw);
  const clean = contentSanitizers[type]?.(content) ?? content;
  if (JSON.stringify(clean).length > MAX_CONTENT_BYTES) {
    throw new Error("This block is too large to save.");
  }
  return clean;
}

export const blockStateLoaders: Partial<Record<AcademyBlockType, BlockStateLoader>> = {
  // Notes: the learner's own note on the lesson, or on the module.
  notes: async (blocks, ctx) => {
    if (ctx.preview) return {};
    const needsModule = blocks.some((b) => notesScope(b.content) === "module") && ctx.moduleId;
    const [lessonNote, moduleNote] = await Promise.all([
      ctx.supabase
        .from("academy_notes")
        .select("body, updated_at")
        .eq("profile_id", ctx.userId)
        .eq("lesson_id", ctx.lessonId)
        .maybeSingle(),
      needsModule
        ? ctx.supabase
            .from("academy_notes")
            .select("body, updated_at")
            .eq("profile_id", ctx.userId)
            .eq("module_id", ctx.moduleId as string)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const states: Record<string, Json> = {};
    for (const block of blocks) {
      const note = notesScope(block.content) === "module" ? moduleNote.data : lessonNote.data;
      states[block.id] = { body: note?.body ?? "", updatedAt: note?.updated_at ?? null };
    }
    return states;
  },
  // Area learn (src/lib/academy/learn/states.ts).
  assignment: loadAssignmentStates,
  tasks: loadTaskStates,
  knowledge_check: loadCheckStates,
  questionnaire: loadQuestionnaireStates,
};

/** State per block id for the viewers of one lesson. */
export async function loadBlockStates(blocks: AcademyLessonBlockRow[], ctx: BlockStateContext): Promise<Record<string, Json>> {
  const byType = new Map<AcademyBlockType, AcademyLessonBlockRow[]>();
  for (const block of blocks) {
    if (!blockStateLoaders[block.type]) continue;
    byType.set(block.type, [...(byType.get(block.type) ?? []), block]);
  }
  const parts = await Promise.all(
    [...byType.entries()].map(([type, list]) =>
      blockStateLoaders[type]!(list, ctx).catch((error) => {
        console.error(`academy block state ${type}`, error);
        return {} as Record<string, Json>;
      }),
    ),
  );
  return Object.assign({}, ...parts);
}
