"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR } from "@/lib/action-state";
import type { AcademyCheckQuestionRow, AcademyTaskRow } from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";
import { requireAcademyManager } from "@/lib/academy/auth";
import { cleanRubric } from "@/lib/academy/learn/assignment";
import { proposeAssessment } from "@/lib/academy/learn/ai";
import { cleanCheckQuestion } from "@/lib/academy/learn/check";
import { cleanTaskInput } from "@/lib/academy/learn/tasks";
import { createClient } from "@/lib/supabase/server";

// Nordavo's side of the assignment, tasks and knowledge check blocks: task
// and question rows of a block (from the lesson editor), the review of
// assignments and the AI proposal. Managers only (requireAcademyManager,
// and RLS through academy_is_manager()).

const guid = z.guid();

function log(where: string, error: { code?: string; message: string } | null) {
  if (error) console.error(`academy ${where}`, error.code, error.message);
}

function refresh() {
  revalidatePath("/dashboard/academy", "layout");
  revalidatePath("/academy", "layout");
}

async function blockOfType(supabase: Awaited<ReturnType<typeof createClient>>, blockId: string, type: "tasks" | "knowledge_check") {
  const { data } = await supabase.from("academy_lesson_blocks").select("id, type").eq("id", blockId).maybeSingle();
  return data?.type === type;
}

// ---------------------------------------------------------------------------
// Tasks of a tasks block
// ---------------------------------------------------------------------------

export async function listBlockTasks(blockId: string): Promise<AcademyTaskRow[]> {
  await requireAcademyManager();
  if (!guid.safeParse(blockId).success) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("academy_tasks").select("*").eq("block_id", blockId).order("position").order("id");
  log("listBlockTasks", error);
  return data ?? [];
}

export async function saveTask(input: {
  blockId: string;
  id: string | null;
  title: string;
  description: string | null;
  deadlineOffsetDays: number | null;
  shared: boolean;
  placementOnly: boolean;
  required: boolean;
}): Promise<ActionState & { task?: AcademyTaskRow }> {
  await requireAcademyManager();
  if (!guid.safeParse(input.blockId).success || (input.id && !guid.safeParse(input.id).success)) return { error: "Task not found." };
  let clean;
  try {
    clean = cleanTaskInput({
      title: input.title,
      description: input.description,
      deadline_offset_days: input.deadlineOffsetDays,
      shared: input.shared,
      placement_only: input.placementOnly,
      required: input.required,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : GENERIC_ERROR };
  }
  const supabase = await createClient();
  if (!(await blockOfType(supabase, input.blockId, "tasks"))) return { error: "Block not found." };
  let result;
  if (input.id) {
    result = await supabase.from("academy_tasks").update(clean).eq("id", input.id).eq("block_id", input.blockId).select("*").single();
  } else {
    const { data: last } = await supabase
      .from("academy_tasks")
      .select("position")
      .eq("block_id", input.blockId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    result = await supabase
      .from("academy_tasks")
      .insert({ ...clean, block_id: input.blockId, position: (last?.position ?? 0) + 1 })
      .select("*")
      .single();
  }
  log("saveTask", result.error);
  if (result.error || !result.data) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: "Task saved.", task: result.data };
}

export async function deleteTask(taskId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(taskId).success) return { error: "Task not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_tasks").delete().eq("id", taskId);
  log("deleteTask", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: "Task deleted." };
}

/** New order of the tasks of a block (ids in order). */
export async function reorderTasks(blockId: string, ids: string[]): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(blockId).success || !ids.every((id) => guid.safeParse(id).success)) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const results = await Promise.all(
    ids.map((id, index) => supabase.from("academy_tasks").update({ position: index + 1 }).eq("id", id).eq("block_id", blockId)),
  );
  const failed = results.find((r) => r.error);
  log("reorderTasks", failed?.error ?? null);
  if (failed) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Questions of a knowledge check
// ---------------------------------------------------------------------------

export async function listCheckQuestions(blockId: string): Promise<AcademyCheckQuestionRow[]> {
  await requireAcademyManager();
  if (!guid.safeParse(blockId).success) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("academy_check_questions").select("*").eq("block_id", blockId).order("position").order("id");
  log("listCheckQuestions", error);
  return data ?? [];
}

export async function saveCheckQuestion(input: {
  blockId: string;
  id: string | null;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
}): Promise<ActionState & { question?: AcademyCheckQuestionRow }> {
  await requireAcademyManager();
  if (!guid.safeParse(input.blockId).success || (input.id && !guid.safeParse(input.id).success)) return { error: "Question not found." };
  let clean;
  try {
    clean = cleanCheckQuestion({ question: input.question, options: input.options, correct_index: input.correctIndex, explanation: input.explanation });
  } catch (error) {
    return { error: error instanceof Error ? error.message : GENERIC_ERROR };
  }
  const supabase = await createClient();
  if (!(await blockOfType(supabase, input.blockId, "knowledge_check"))) return { error: "Block not found." };
  const row = { question: clean.question, options: clean.options as Json, correct_index: clean.correct_index, explanation: clean.explanation };
  let result;
  if (input.id) {
    result = await supabase.from("academy_check_questions").update(row).eq("id", input.id).eq("block_id", input.blockId).select("*").single();
  } else {
    const { data: last } = await supabase
      .from("academy_check_questions")
      .select("position")
      .eq("block_id", input.blockId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    result = await supabase
      .from("academy_check_questions")
      .insert({ ...row, block_id: input.blockId, position: (last?.position ?? 0) + 1 })
      .select("*")
      .single();
  }
  log("saveCheckQuestion", result.error);
  if (result.error || !result.data) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: "Question saved.", question: result.data };
}

export async function deleteCheckQuestion(questionId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(questionId).success) return { error: "Question not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_check_questions").delete().eq("id", questionId);
  log("deleteCheckQuestion", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: "Question deleted." };
}

export async function reorderCheckQuestions(blockId: string, ids: string[]): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(blockId).success || !ids.every((id) => guid.safeParse(id).success)) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const results = await Promise.all(
    ids.map((id, index) => supabase.from("academy_check_questions").update({ position: index + 1 }).eq("id", id).eq("block_id", blockId)),
  );
  const failed = results.find((r) => r.error);
  log("reorderCheckQuestions", failed?.error ?? null);
  if (failed) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reviewing assignments
// ---------------------------------------------------------------------------

const reviewSchema = z.object({
  submissionId: z.guid(),
  status: z.enum(["approved", "changes_requested"]),
  feedback: z.string().max(20_000),
  finalScore: z.number().int().min(0).max(100).nullable(),
  rubric: z.record(z.string(), z.number()),
});

/** Approve or ask for changes, with feedback, Nordavo's score and rubric. The learner is notified. */
export async function reviewSubmission(input: {
  submissionId: string;
  status: "approved" | "changes_requested";
  feedback: string;
  finalScore: number | null;
  rubric: Record<string, number>;
}): Promise<ActionState> {
  await requireAcademyManager();
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the score (0 to 100) and the feedback." };
  if (parsed.data.status === "changes_requested" && !parsed.data.feedback.trim()) return { error: "Write what should change." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("academy_review_submission", {
    p_submission_id: parsed.data.submissionId,
    p_status: parsed.data.status,
    p_feedback: parsed.data.feedback.trim() || null,
    p_final_score: parsed.data.finalScore,
    p_rubric_scores: cleanRubric(parsed.data.rubric) as Json,
  });
  log("reviewSubmission", error);
  if (error) return { error: error.code === "22023" ? error.message : GENERIC_ERROR };
  refresh();
  return { ok: true, message: parsed.data.status === "approved" ? "Approved. The learner was notified." : "Changes requested. The learner was notified." };
}

/** (Re)make the AI proposal for a submission. */
export async function requestAiProposal(submissionId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(submissionId).success) return { error: "Submission not found." };
  const supabase = await createClient();
  const result = await proposeAssessment(supabase, submissionId);
  refresh();
  return result.ok ? { ok: true, message: "AI proposal ready." } : { error: result.error ?? GENERIC_ERROR };
}
