"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR } from "@/lib/action-state";
import { ClaudeRefusalError, askJson, hasClaude } from "@/lib/ai/claude";
import { requireAcademyManager } from "@/lib/academy/auth";
import {
  DRAFT_TITLES,
  type NormalizedDraft,
  draftInput,
  draftSystemPrompt,
  lessonDraftSchema,
  normalizeDraft,
  transcriptDraft,
} from "@/lib/academy/ats/draft";
import { blockTypes } from "@/lib/academy/blocks/types";
import { sanitizeHtml } from "@/lib/academy/sanitize";
import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

// AI draft from a video transcript (Academy: beheeroverzichten, afhaakanalyse
// en AI-concept uit transcript). Claude writes an explanation, tasks and a
// knowledge check of three questions; they land as draft blocks at the end
// of the lesson (academy_block_drafts: hidden from learners, not required)
// for Nordavo to edit and accept. Without ANTHROPIC_API_KEY the transcript
// itself becomes the draft explanation, with empty tasks and check blocks.

const guid = z.guid();

function refresh(lessonId: string) {
  revalidatePath(`/dashboard/academy/lessons/${lessonId}`);
}

/** The transcript: of the chosen video in this lesson (current version), or pasted. */
async function loadTranscript(lessonId: string, videoId: string | null, pasted: string): Promise<{ transcript: string; videoId: string | null } | { error: string }> {
  if (pasted.trim().length >= 50) return { transcript: pasted.trim(), videoId: null };
  if (!videoId) return { error: "Choose a video with a transcript, or paste a transcript (at least a few sentences)." };
  const supabase = await createClient();
  const { data: block } = await supabase.from("academy_lesson_blocks").select("id").eq("lesson_id", lessonId).eq("video_id", videoId).limit(1).maybeSingle();
  if (!block) return { error: "This video is not in the lesson." };
  const { data: video } = await supabase.from("academy_videos").select("current_version_id").eq("id", videoId).maybeSingle();
  const { data: version } = video?.current_version_id
    ? await supabase.from("academy_video_versions").select("transcript").eq("id", video.current_version_id).maybeSingle()
    : { data: null };
  const transcript = version?.transcript?.trim() ?? "";
  if (transcript.length < 50) return { error: "This video has no transcript yet. Paste one, or wait until it is made." };
  return { transcript, videoId };
}

/** Insert the three draft blocks at the end of the lesson, with their tasks and questions. */
async function insertDraft(lessonId: string, draft: NormalizedDraft, source: "ai" | "transcript", videoId: string | null): Promise<string | null> {
  const supabase = await createClient();
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
    return GENERIC_ERROR;
  }
}

export async function generateLessonDraft(lessonId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(lessonId).success) return { error: "Lesson not found." };
  const video = formData.get("video_id");
  const pasted = formData.get("transcript");
  const loaded = await loadTranscript(
    lessonId,
    typeof video === "string" && guid.safeParse(video).success ? video : null,
    typeof pasted === "string" ? pasted : "",
  );
  if ("error" in loaded) return { error: loaded.error };

  const supabase = await createClient();
  const { data: lesson } = await supabase.from("academy_lessons").select("title, language").eq("id", lessonId).maybeSingle();
  if (!lesson) return { error: "Lesson not found." };

  let draft: NormalizedDraft;
  let source: "ai" | "transcript" = "ai";
  if (hasClaude()) {
    try {
      const result = await askJson({
        system: draftSystemPrompt(lesson.language),
        input: draftInput({ lessonTitle: lesson.title, transcript: loaded.transcript }),
        schema: lessonDraftSchema,
        effort: "medium",
        maxTokens: 16000,
      });
      draft = normalizeDraft(result);
    } catch (error) {
      console.error("generateLessonDraft", error);
      return { error: error instanceof ClaudeRefusalError ? "Claude declined this transcript." : "Claude could not make a draft. Try again." };
    }
  } else {
    draft = transcriptDraft(loaded.transcript, lesson.language);
    source = "transcript";
  }

  const failed = await insertDraft(lessonId, draft, source, loaded.videoId);
  refresh(lessonId);
  if (failed) return { error: failed };
  return {
    ok: true,
    message:
      source === "ai"
        ? `Draft made: explanation, ${draft.tasks.length} tasks and ${draft.questions.length} questions at the end of the lesson. Learners do not see it until you accept it.`
        : "ANTHROPIC_API_KEY is not set: the transcript is now a draft explanation at the end of the lesson, with empty task and check blocks to fill in.",
  };
}

/** Accept a draft block: visible to learners, required as its type normally is. */
export async function acceptDraftBlock(blockId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(blockId).success) return { error: "Block not found." };
  const supabase = await createClient();
  const { data: block } = await supabase.from("academy_lesson_blocks").select("lesson_id, type, title").eq("id", blockId).maybeSingle();
  if (!block) return { error: "Block not found." };
  const { error } = await supabase
    .from("academy_lesson_blocks")
    .update({
      required: blockTypes[block.type].defaultRequired,
      title: block.title && Object.values(DRAFT_TITLES).includes(block.title as (typeof DRAFT_TITLES)[keyof typeof DRAFT_TITLES]) ? null : block.title,
    })
    .eq("id", blockId);
  if (error) return { error: GENERIC_ERROR };
  const { error: draftError } = await supabase.from("academy_block_drafts").delete().eq("block_id", blockId);
  if (draftError) return { error: GENERIC_ERROR };
  refresh(block.lesson_id);
  return { ok: true, message: "Accepted: learners see this block now." };
}

/** Throw a draft block away (with its tasks or questions). */
export async function discardDraftBlock(blockId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(blockId).success) return { error: "Block not found." };
  const supabase = await createClient();
  const { data: draft } = await supabase.from("academy_block_drafts").select("block_id").eq("block_id", blockId).maybeSingle();
  if (!draft) return { error: "Only draft blocks can be thrown away here." };
  const { data: block } = await supabase.from("academy_lesson_blocks").select("lesson_id").eq("id", blockId).maybeSingle();
  const { error } = await supabase.from("academy_lesson_blocks").delete().eq("id", blockId);
  if (error) return { error: GENERIC_ERROR };
  if (block) refresh(block.lesson_id);
  return { ok: true };
}
