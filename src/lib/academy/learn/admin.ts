import "server-only";
import type {
  AcademyAssignmentAssessmentRow,
  AcademyAssignmentSubmissionRow,
  AcademyQuestionnaireConsentRow,
  AcademyQuestionnaireResponseRow,
} from "@/lib/academy/database";
import { requireAcademyManager } from "@/lib/academy/auth";
import type { OverdueTaskRow, PersonTaskRow } from "@/lib/academy/learn/database";
import { type RubricScores, assignmentPrompt, cleanRubric } from "@/lib/academy/learn/assignment";
import { canProposeAssessment } from "@/lib/academy/learn/ai";
import { signPaths } from "@/lib/academy/learn/states";
import { createClient } from "@/lib/supabase/server";

// Nordavo's side of the assignment, tasks, knowledge check and
// questionnaire blocks: the review queue, a review, overdue tasks and the
// learning results per person. Managers only (requireAcademyManager, RLS).

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ReviewFilter = "waiting" | "changes" | "approved" | "all";

export type ReviewQueueItem = {
  submission: AcademyAssignmentSubmissionRow;
  personName: string | null;
  personEmail: string | null;
  blockTitle: string;
  lessonTitle: string;
  aiStatus: AcademyAssignmentAssessmentRow["ai_status"];
  aiTotal: number | null;
};

async function namesFor(supabase: Supabase, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map<string, { full_name: string | null; email: string | null }>();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, { full_name: p.full_name, email: p.email }]));
}

async function blockTitles(supabase: Supabase, blockIds: string[]) {
  const unique = [...new Set(blockIds)];
  if (unique.length === 0) return new Map<string, { block: string; lesson: string; lessonId: string }>();
  const { data: blocks } = await supabase.from("academy_lesson_blocks").select("id, title, lesson_id").in("id", unique);
  const lessonIds = [...new Set((blocks ?? []).map((b) => b.lesson_id))];
  const { data: lessons } = lessonIds.length ? await supabase.from("academy_lessons").select("id, title").in("id", lessonIds) : { data: [] };
  const lessonTitle = new Map((lessons ?? []).map((l) => [l.id, l.title]));
  return new Map(
    (blocks ?? []).map((b) => [
      b.id,
      { block: b.title ?? lessonTitle.get(b.lesson_id) ?? "Assignment", lesson: lessonTitle.get(b.lesson_id) ?? "", lessonId: b.lesson_id },
    ]),
  );
}

/** The latest attempt per person per assignment (the one that matters for the queue). */
function latestOnly(rows: AcademyAssignmentSubmissionRow[]) {
  const latest = new Map<string, AcademyAssignmentSubmissionRow>();
  for (const row of rows) {
    const k = `${row.block_id}:${row.profile_id}`;
    const cur = latest.get(k);
    if (!cur || row.attempt > cur.attempt) latest.set(k, row);
  }
  return [...latest.values()];
}

export const REVIEW_PAGE = 300;

/**
 * The review queue. waiting: handed in and not reviewed yet (oldest first);
 * changes: Nordavo asked for changes and the learner has not handed in
 * again; approved and all: newest first.
 */
export async function listReviewQueue(filter: ReviewFilter): Promise<ReviewQueueItem[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  let query = supabase.from("academy_assignment_submissions").select("*").order("submitted_at", { ascending: filter === "waiting" }).limit(REVIEW_PAGE * 2);
  if (filter === "waiting") query = query.eq("status", "submitted");
  if (filter === "approved") query = query.eq("status", "approved");
  const { data, error } = await query;
  if (error) throw new Error(`Could not load the review queue: ${error.message}`);
  let rows = data ?? [];
  if (filter === "changes" || filter === "all") rows = latestOnly(rows);
  if (filter === "changes") rows = rows.filter((r) => r.status === "changes_requested");
  rows = rows.slice(0, REVIEW_PAGE);

  const [names, titles, assessments] = await Promise.all([
    namesFor(supabase, rows.map((r) => r.profile_id)),
    blockTitles(supabase, rows.map((r) => r.block_id)),
    rows.length
      ? supabase.from("academy_assignment_assessments").select("submission_id, ai_status, ai_total").in("submission_id", rows.map((r) => r.id))
      : Promise.resolve({ data: [] as { submission_id: string; ai_status: AcademyAssignmentAssessmentRow["ai_status"]; ai_total: number | null }[] }),
  ]);
  const ai = new Map((assessments.data ?? []).map((a) => [a.submission_id, a]));
  return rows.map((submission) => ({
    submission,
    personName: names.get(submission.profile_id)?.full_name ?? null,
    personEmail: names.get(submission.profile_id)?.email ?? null,
    blockTitle: titles.get(submission.block_id)?.block ?? "Assignment",
    lessonTitle: titles.get(submission.block_id)?.lesson ?? "",
    aiStatus: ai.get(submission.id)?.ai_status ?? "none",
    aiTotal: ai.get(submission.id)?.ai_total ?? null,
  }));
}

export async function countWaitingReviews(): Promise<number> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { count } = await supabase.from("academy_assignment_submissions").select("id", { count: "exact", head: true }).eq("status", "submitted");
  return count ?? 0;
}

export type ReviewAttempt = AcademyAssignmentSubmissionRow & { fileUrl: string | null; feedbackByName: string | null };

export type ReviewDetail = {
  submission: ReviewAttempt;
  /** Every attempt of this person on this assignment, newest first (includes the submission). */
  attempts: ReviewAttempt[];
  isLatest: boolean;
  personName: string | null;
  personEmail: string | null;
  blockTitle: string;
  lessonTitle: string;
  lessonId: string;
  prompt: string;
  ai: {
    status: AcademyAssignmentAssessmentRow["ai_status"];
    scores: RubricScores;
    total: number | null;
    summary: string | null;
    createdAt: string | null;
  };
  rubric: RubricScores;
  aiAvailable: boolean;
};

export async function getReview(submissionId: string): Promise<ReviewDetail | null> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data: submission } = await supabase.from("academy_assignment_submissions").select("*").eq("id", submissionId).maybeSingle();
  if (!submission) return null;
  const [{ data: attempts }, { data: block }, { data: assessment }] = await Promise.all([
    supabase
      .from("academy_assignment_submissions")
      .select("*")
      .eq("block_id", submission.block_id)
      .eq("profile_id", submission.profile_id)
      .order("attempt", { ascending: false }),
    supabase.from("academy_lesson_blocks").select("title, content, lesson_id").eq("id", submission.block_id).maybeSingle(),
    supabase.from("academy_assignment_assessments").select("*").eq("submission_id", submission.id).maybeSingle(),
  ]);
  const list = attempts ?? [submission];
  const [{ data: lesson }, names, urls] = await Promise.all([
    block ? supabase.from("academy_lessons").select("title").eq("id", block.lesson_id).maybeSingle() : Promise.resolve({ data: null }),
    namesFor(supabase, [submission.profile_id, ...list.map((a) => a.feedback_by ?? "")]),
    signPaths(supabase, list.map((a) => a.file_path ?? "")),
  ]);
  const withUrls: ReviewAttempt[] = list.map((a) => ({
    ...a,
    fileUrl: a.file_path ? (urls[a.file_path] ?? null) : null,
    feedbackByName: a.feedback_by ? (names.get(a.feedback_by)?.full_name ?? null) : null,
  }));
  return {
    submission: withUrls.find((a) => a.id === submission.id)!,
    attempts: withUrls,
    isLatest: list[0]?.id === submission.id,
    personName: names.get(submission.profile_id)?.full_name ?? null,
    personEmail: names.get(submission.profile_id)?.email ?? null,
    blockTitle: block?.title ?? lesson?.title ?? "Assignment",
    lessonTitle: lesson?.title ?? "",
    lessonId: block?.lesson_id ?? "",
    prompt: assignmentPrompt(block?.content),
    ai: {
      status: assessment?.ai_status ?? "none",
      scores: cleanRubric(assessment?.ai_scores),
      total: assessment?.ai_total ?? null,
      summary: assessment?.ai_summary ?? null,
      createdAt: assessment?.ai_created_at ?? null,
    },
    rubric: cleanRubric(assessment?.rubric_scores),
    aiAvailable: canProposeAssessment(),
  };
}

export async function listOverdueTasks(): Promise<OverdueTaskRow[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_overdue_tasks");
  if (error) throw new Error(`Could not load overdue tasks: ${error.message}`);
  return data ?? [];
}

export type PersonCheck = { blockId: string; title: string; lessonTitle: string; attempts: number; bestPercent: number; lastPercent: number; lastAt: string };

export type PersonLearning = {
  checks: PersonCheck[];
  assignments: (ReviewQueueItem & { attempts: number })[];
  tasks: PersonTaskRow[];
  questionnaires: {
    blockId: string;
    title: string;
    consent: AcademyQuestionnaireConsentRow | null;
    response: AcademyQuestionnaireResponseRow | null;
    /** The questions of the block, to show the answers with their text. */
    content: unknown;
  }[];
};

/** Knowledge check scores, assignments, tasks and questionnaires of one person (people page). */
export async function getPersonLearning(profileId: string): Promise<PersonLearning> {
  await requireAcademyManager();
  const supabase = await createClient();
  const [attempts, submissions, tasks, consents, responses] = await Promise.all([
    supabase.from("academy_check_attempts").select("block_id, score, max_score, created_at").eq("profile_id", profileId).order("created_at"),
    supabase.from("academy_assignment_submissions").select("*").eq("profile_id", profileId),
    supabase.rpc("academy_person_tasks", { p_profile_id: profileId }),
    supabase.from("academy_questionnaire_consents").select("*").eq("profile_id", profileId),
    supabase.from("academy_questionnaire_responses").select("*").eq("profile_id", profileId),
  ]);

  const checkRows = attempts.data ?? [];
  const latestSubs = latestOnly(submissions.data ?? []);
  const qBlockIds = [...new Set([...(consents.data ?? []).map((c) => c.block_id), ...(responses.data ?? []).map((r) => r.block_id)])];
  const titles = await blockTitles(supabase, [...checkRows.map((a) => a.block_id), ...latestSubs.map((s) => s.block_id), ...qBlockIds]);
  const [assessments, qBlocks] = await Promise.all([
    latestSubs.length
      ? supabase.from("academy_assignment_assessments").select("submission_id, ai_status, ai_total").in("submission_id", latestSubs.map((s) => s.id))
      : Promise.resolve({ data: [] as { submission_id: string; ai_status: AcademyAssignmentAssessmentRow["ai_status"]; ai_total: number | null }[] }),
    qBlockIds.length ? supabase.from("academy_lesson_blocks").select("id, content").in("id", qBlockIds) : Promise.resolve({ data: [] as { id: string; content: unknown }[] }),
  ]);

  const byBlock = new Map<string, typeof checkRows>();
  for (const a of checkRows) byBlock.set(a.block_id, [...(byBlock.get(a.block_id) ?? []), a]);
  const pct = (a: { score: number; max_score: number }) => (a.max_score === 0 ? 100 : Math.round((a.score * 100) / a.max_score));
  const checks: PersonCheck[] = [...byBlock.entries()].map(([blockId, list]) => ({
    blockId,
    title: titles.get(blockId)?.block ?? "Knowledge check",
    lessonTitle: titles.get(blockId)?.lesson ?? "",
    attempts: list.length,
    bestPercent: Math.max(...list.map(pct)),
    lastPercent: pct(list[list.length - 1]),
    lastAt: list[list.length - 1].created_at,
  }));

  const ai = new Map((assessments.data ?? []).map((a) => [a.submission_id, a]));
  const attemptCount = new Map<string, number>();
  for (const s of submissions.data ?? []) attemptCount.set(s.block_id, (attemptCount.get(s.block_id) ?? 0) + 1);
  const assignments = latestSubs
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
    .map((submission) => ({
      submission,
      personName: null,
      personEmail: null,
      blockTitle: titles.get(submission.block_id)?.block ?? "Assignment",
      lessonTitle: titles.get(submission.block_id)?.lesson ?? "",
      aiStatus: ai.get(submission.id)?.ai_status ?? ("none" as const),
      aiTotal: ai.get(submission.id)?.ai_total ?? null,
      attempts: attemptCount.get(submission.block_id) ?? 1,
    }));

  const content = new Map((qBlocks.data ?? []).map((b) => [b.id, b.content]));
  const questionnaires = qBlockIds.map((blockId) => ({
    blockId,
    title: titles.get(blockId)?.block ?? "Questionnaire",
    consent: (consents.data ?? []).find((c) => c.block_id === blockId) ?? null,
    response: (responses.data ?? []).find((r) => r.block_id === blockId) ?? null,
    content: content.get(blockId) ?? null,
  }));

  return { checks, assignments, tasks: tasks.data ?? [], questionnaires };
}
