"use server";

import { after } from "next/server";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { requireAcademyUser } from "@/lib/academy/auth";
import { t } from "@/lib/academy/i18n";
import { MAX_SUBMISSION_FILE_BYTES, MAX_SUBMISSION_TEXT, isHttpUrl, submissionPath } from "@/lib/academy/learn/assignment";
import { proposeAssessment } from "@/lib/academy/learn/ai";
import { type CheckResult, parseCheckResult } from "@/lib/academy/learn/check";
import { hasClaude } from "@/lib/ai/claude";
import { ATTACHMENTS_BUCKET } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Learner actions of the assignment, tasks, knowledge check and
// questionnaire blocks. Every one re-checks the user; the database checks
// the rest (lesson open, own rows, consent) in the academy_* functions.

const guid = z.guid();

type Result = { ok: true } | { ok: false; error: string };

/**
 * Database errors meant for the learner (22023, written in English): known
 * ones in the learner's language, others as they are for English readers.
 */
function dbError(locale: "nl" | "en", error: { code?: string; message: string } | null): string {
  if (error?.code !== "22023") return t(locale, "error.generic");
  if (error.message.includes("a text, a file or a link")) return t(locale, "assignment.empty");
  if (error.message.includes("http://")) return t(locale, "assignment.badLink");
  return locale === "en" ? error.message : t(locale, "error.generic");
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/**
 * Hand in an assignment: text, a file (uploaded to
 * academy/submission/<profile_id>/...) and/or a link. While Nordavo has not
 * looked at it yet the learner may change it; keep_file keeps the current file.
 */
export async function submitAssignment(formData: FormData): Promise<Result> {
  const user = await requireAcademyUser();
  const blockId = formData.get("block_id");
  if (!guid.safeParse(blockId).success) return { ok: false, error: t(user.locale, "error.generic") };
  if (!user.member) return { ok: false, error: t(user.locale, "assignment.preview") };

  const body = typeof formData.get("body") === "string" ? (formData.get("body") as string).slice(0, MAX_SUBMISSION_TEXT) : "";
  const link = typeof formData.get("link_url") === "string" ? (formData.get("link_url") as string).trim() : "";
  if (link && !isHttpUrl(link)) return { ok: false, error: t(user.locale, "assignment.badLink") };

  const file = formData.get("file");
  const keepPath = typeof formData.get("keep_file_path") === "string" ? (formData.get("keep_file_path") as string) : "";
  const keepName = typeof formData.get("keep_file_name") === "string" ? (formData.get("keep_file_name") as string) : "";
  let filePath: string | null = keepPath.startsWith(`academy/submission/${user.id}/`) ? keepPath : null;
  let fileName: string | null = filePath ? keepName || "file" : null;
  let uploaded: string | null = null;

  const supabase = await createClient();
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_SUBMISSION_FILE_BYTES) return { ok: false, error: t(user.locale, "assignment.fileTooLarge") };
    const path = submissionPath(user.id, blockId as string, file.name, crypto.randomUUID().slice(0, 8));
    const { error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) {
      console.error("academy submitAssignment upload", error.message);
      return { ok: false, error: t(user.locale, "error.generic") };
    }
    uploaded = path;
    filePath = path;
    fileName = file.name.slice(0, 300) || "file";
  }
  if (!body.trim() && !link && !filePath) return { ok: false, error: t(user.locale, "assignment.empty") };

  const { data: submissionId, error } = await supabase.rpc("academy_submit_assignment", {
    p_block_id: blockId as string,
    p_body: body.trim() || null,
    p_file_path: filePath,
    p_file_name: fileName,
    p_link_url: link || null,
  });
  if (error || !submissionId) {
    console.error("academy submitAssignment", error?.code, error?.message);
    if (uploaded) await supabase.storage.from(ATTACHMENTS_BUCKET).remove([uploaded]);
    return { ok: false, error: dbError(user.locale, error) };
  }

  // The AI proposal for Nordavo, after the response (needs the service role
  // to write the staff-only assessment, and ANTHROPIC_API_KEY).
  const admin = hasClaude() ? createAdminClient() : null;
  if (admin) {
    after(async () => {
      await proposeAssessment(admin, submissionId);
    });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** Tick a task off or undo it: own task, or a shared task of own placement (placementId). */
export async function setTaskDone(input: { taskId: string; placementId: string | null; done: boolean }): Promise<Result> {
  const user = await requireAcademyUser();
  if (!guid.safeParse(input.taskId).success || (input.placementId && !guid.safeParse(input.placementId).success)) {
    return { ok: false, error: t(user.locale, "tasks.failed") };
  }
  if (!user.member) return { ok: false, error: t(user.locale, "tasks.preview") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("academy_set_task_done", {
    p_task_id: input.taskId,
    p_placement_id: input.placementId,
    p_done: input.done === true,
  });
  if (error) {
    console.error("academy setTaskDone", error.code, error.message);
    return { ok: false, error: t(user.locale, "tasks.failed") };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Knowledge check
// ---------------------------------------------------------------------------

const answersSchema = z.record(z.guid(), z.number().int().min(0).max(20));

/** Score an attempt in the database; returns the score and the explanations. */
export async function submitCheck(blockId: string, answers: Record<string, number>): Promise<{ ok: true; result: CheckResult } | { ok: false; error: string }> {
  const user = await requireAcademyUser();
  const parsed = answersSchema.safeParse(answers);
  if (!guid.safeParse(blockId).success || !parsed.success) return { ok: false, error: t(user.locale, "check.answerAll") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_submit_check", { p_block_id: blockId, p_answers: parsed.data as Json });
  const result = parseCheckResult(data);
  if (error || !result) {
    console.error("academy submitCheck", error?.code, error?.message);
    return { ok: false, error: error?.code === "22023" ? t(user.locale, "check.answerAll") : t(user.locale, "error.generic") };
  }
  return { ok: true, result };
}

// ---------------------------------------------------------------------------
// Questionnaire
// ---------------------------------------------------------------------------

/** Give or withdraw consent. Withdrawing deletes the answers. */
export async function setQuestionnaireConsent(blockId: string, give: boolean): Promise<Result> {
  const user = await requireAcademyUser();
  if (!guid.safeParse(blockId).success) return { ok: false, error: t(user.locale, "error.generic") };
  if (!user.member) return { ok: false, error: t(user.locale, "questionnaire.preview") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("academy_questionnaire_consent", { p_block_id: blockId, p_give: give === true });
  if (error) {
    console.error("academy setQuestionnaireConsent", error.code, error.message);
    return { ok: false, error: t(user.locale, "error.generic") };
  }
  return { ok: true };
}

const questionnaireAnswers = z.record(z.string().max(40), z.union([z.number().int().min(0).max(100), z.string().max(5000)]));

/** Save the answers (draft) or submit them; the database checks and scores. */
export async function saveQuestionnaire(blockId: string, answers: Record<string, number | string>, submit: boolean): Promise<Result> {
  const user = await requireAcademyUser();
  const parsed = questionnaireAnswers.safeParse(answers);
  if (!guid.safeParse(blockId).success || !parsed.success) return { ok: false, error: t(user.locale, "error.generic") };
  if (!user.member) return { ok: false, error: t(user.locale, "questionnaire.preview") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("academy_save_questionnaire", {
    p_block_id: blockId,
    p_answers: parsed.data as Json,
    p_submit: submit === true,
  });
  if (error) {
    console.error("academy saveQuestionnaire", error.code, error.message);
    return { ok: false, error: dbError(user.locale, error) };
  }
  return { ok: true };
}
