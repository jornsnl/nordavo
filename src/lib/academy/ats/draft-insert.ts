import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DRAFT_TITLES, type NormalizedDraft } from "@/lib/academy/ats/draft";
import { blockTypes } from "@/lib/academy/blocks/types";
import { sanitizeHtml } from "@/lib/academy/sanitize";
import type { Database, Json } from "@/lib/database.types";

// The AI draft of a lesson lands as three draft blocks at the end of the
// lesson (academy_block_drafts: hidden from learners, not required). Shared
// by the lesson page (direct call) and the AI request queue (Claude via MCP).

type Db = SupabaseClient<Database>;

/** Insert the three draft blocks at the end of the lesson, with their tasks and questions. */
export async function insertLessonDraft(supabase: Db, lessonId: string, draft: NormalizedDraft, source: "ai" | "transcript", videoId: string | null): Promise<string | null> {
  const { data: last } = await supabase.from("academy_lesson_blocks").select("position").eq("lesson_id", lessonId).order("position", { ascending: false }).limit(1).maybeSingle();
  let position = (last?.position ?? 0) + 1;
  const created: string[] = [];
  const insertBlock = async (type: "explanation" | "tasks" | "knowledge_check", content: Json) => {
    const completion: Record<string, Json> = {};
    for (const field of blockTypes[type].completionFields) completion[field.key] = field.defaultValue;
    const { data, error } = await supabase
      .from("academy_lesson_blocks")
      // Not required while it is a draft, so it never holds up a green check.
      .insert({ lesson_id: lessonId, type, position: position++, title: DRAFT_TITLES[type], content, required: false, completion })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "block not made");
    created.push(data.id);
    const { error: draftError } = await supabase.from("academy_block_drafts").insert({ block_id: data.id, source, video_id: videoId });
    if (draftError) throw new Error(draftError.message);
    return data.id;
  };
  try {
    await insertBlock("explanation", { html: sanitizeHtml(draft.explanationHtml) });
    const tasksBlock = await insertBlock("tasks", {});
    if (draft.tasks.length > 0) {
      const { error } = await supabase.from("academy_tasks").insert(
        draft.tasks.map((t, i) => ({ block_id: tasksBlock, title: t.title, description: t.description, deadline_offset_days: t.deadline_offset_days, position: i + 1 })),
      );
      if (error) throw new Error(error.message);
    }
    const checkBlock = await insertBlock("knowledge_check", {});
    if (draft.questions.length > 0) {
      const { error } = await supabase.from("academy_check_questions").insert(
        draft.questions.map((q, i) => ({
          block_id: checkBlock,
          question: q.question,
          options: q.options as Json,
          correct_index: q.correct_index,
          explanation: q.explanation,
          position: i + 1,
        })),
      );
      if (error) throw new Error(error.message);
    }
    return null;
  } catch (error) {
    console.error("insertDraft", error);
    // Leave nothing half made.
    if (created.length > 0) await supabase.from("academy_lesson_blocks").delete().in("id", created);
    return "The draft could not be saved.";
  }
}

