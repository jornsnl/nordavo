import "server-only";
import type { AcademyLessonBlockRow } from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";
import type { BlockStateLoader } from "@/lib/academy/blocks/server";
import { ATTACHMENTS_BUCKET } from "@/lib/storage";

// blockStateLoaders for the assignment, tasks, knowledge check and
// questionnaire blocks (registered in src/lib/academy/blocks/server.ts).
// Each reads as the signed-in learner, through RLS or the academy_*
// functions; a manager preview gets what is safe to show without progress.

export type AssignmentAttemptState = {
  id: string;
  attempt: number;
  body: string | null;
  filePath: string | null;
  fileName: string | null;
  fileUrl: string | null;
  linkUrl: string | null;
  status: "submitted" | "changes_requested" | "approved";
  feedback: string | null;
  feedbackAt: string | null;
  finalScore: number | null;
  submittedAt: string;
};

export type TaskState = {
  taskId: string;
  title: string;
  description: string | null;
  required: boolean;
  shared: boolean;
  placementOnly: boolean;
  deadlineOffsetDays: number | null;
  placementId: string | null;
  placementLabel: string | null;
  dueAt: string | null;
  doneAt: string | null;
  doneByName: string | null;
  canTick: boolean;
};

const SIGNED_URL_SECONDS = 60 * 60;

/** Signed URLs for storage paths in the attachments bucket (null when not allowed). */
export async function signPaths(
  supabase: Parameters<BlockStateLoader>[1]["supabase"],
  paths: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}

const ids = (blocks: AcademyLessonBlockRow[]) => blocks.map((b) => b.id);

/** Assignment: own attempts, newest first, with a signed link to the file. */
export const loadAssignmentStates: BlockStateLoader = async (blocks, ctx) => {
  if (ctx.preview) return {};
  const { data } = await ctx.supabase
    .from("academy_assignment_submissions")
    .select("*")
    .eq("profile_id", ctx.userId)
    .in("block_id", ids(blocks))
    .order("attempt", { ascending: false });
  const rows = data ?? [];
  const urls = await signPaths(ctx.supabase, rows.map((r) => r.file_path ?? ""));
  const states: Record<string, Json> = {};
  for (const block of blocks) {
    const attempts: AssignmentAttemptState[] = rows
      .filter((r) => r.block_id === block.id)
      .map((r) => ({
        id: r.id,
        attempt: r.attempt,
        body: r.body,
        filePath: r.file_path,
        fileName: r.file_name,
        fileUrl: r.file_path ? (urls[r.file_path] ?? null) : null,
        linkUrl: r.link_url,
        status: r.status,
        feedback: r.feedback,
        feedbackAt: r.feedback_at,
        finalScore: r.final_score,
        submittedAt: r.submitted_at,
      }));
    states[block.id] = { attempts } as unknown as Json;
  }
  return states;
};

/** Tasks: the instances for the learner (own and shared); in preview the task list itself. */
export const loadTaskStates: BlockStateLoader = async (blocks, ctx) => {
  const states: Record<string, Json> = {};
  if (ctx.preview) {
    const { data } = await ctx.supabase.from("academy_tasks").select("*").in("block_id", ids(blocks)).order("position").order("id");
    for (const block of blocks) {
      const tasks: TaskState[] = (data ?? [])
        .filter((t) => t.block_id === block.id)
        .map((t) => ({
          taskId: t.id,
          title: t.title,
          description: t.description,
          required: t.required,
          shared: t.shared,
          placementOnly: t.placement_only,
          deadlineOffsetDays: t.deadline_offset_days,
          placementId: null,
          placementLabel: null,
          dueAt: null,
          doneAt: null,
          doneByName: null,
          canTick: false,
        }));
      states[block.id] = { tasks } as unknown as Json;
    }
    return states;
  }
  const { data } = await ctx.supabase.rpc("academy_my_tasks", { p_block_id: null });
  const rows = (data ?? []).filter((r) => blocks.some((b) => b.id === r.block_id));
  for (const block of blocks) {
    const tasks: TaskState[] = rows
      .filter((r) => r.block_id === block.id)
      .sort((a, b) => a.task_position - b.task_position || (a.placement_label ?? "").localeCompare(b.placement_label ?? ""))
      .map((r) => ({
        taskId: r.task_id,
        title: r.title,
        description: r.description,
        required: r.required,
        shared: r.shared,
        placementOnly: r.placement_only,
        deadlineOffsetDays: r.deadline_offset_days,
        placementId: r.placement_id,
        placementLabel: r.placement_label,
        dueAt: r.due_at,
        doneAt: r.done_at,
        doneByName: r.done_by_name,
        canTick: r.can_tick,
      }));
    states[block.id] = { tasks } as unknown as Json;
  }
  return states;
};

/** Knowledge check: the questions without answers and the last own result. */
export const loadCheckStates: BlockStateLoader = async (blocks, ctx) => {
  const entries = await Promise.all(
    blocks.map(async (block) => {
      const [questions, result] = await Promise.all([
        ctx.supabase.rpc("academy_check_questions_for", { p_block_id: block.id }),
        ctx.preview ? Promise.resolve({ data: null }) : ctx.supabase.rpc("academy_check_results", { p_block_id: block.id }),
      ]);
      const list = (questions.data ?? []).map((q) => ({ id: q.question_id, question: q.question, options: q.options }));
      return [block.id, { questions: list, result: result.data ?? null } as unknown as Json] as const;
    }),
  );
  return Object.fromEntries(entries);
};

/** Questionnaire: own consent and own answers (never anyone else's). */
export const loadQuestionnaireStates: BlockStateLoader = async (blocks, ctx) => {
  if (ctx.preview) return {};
  const [consents, responses] = await Promise.all([
    ctx.supabase.from("academy_questionnaire_consents").select("*").eq("profile_id", ctx.userId).in("block_id", ids(blocks)),
    ctx.supabase.from("academy_questionnaire_responses").select("*").eq("profile_id", ctx.userId).in("block_id", ids(blocks)),
  ]);
  const states: Record<string, Json> = {};
  for (const block of blocks) {
    const consent = (consents.data ?? []).find((c) => c.block_id === block.id);
    const response = (responses.data ?? []).find((r) => r.block_id === block.id);
    states[block.id] = {
      consent: consent ? { consentedAt: consent.consented_at, withdrawnAt: consent.withdrawn_at } : null,
      response: response ? { answers: response.answers, result: response.result, submittedAt: response.submitted_at } : null,
    };
  }
  return states;
};
