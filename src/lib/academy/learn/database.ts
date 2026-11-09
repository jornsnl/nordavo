// Types of the functions in
// supabase/migrations/20261113100000_academy_learn_blocks.sql (assignment,
// tasks, knowledge check, questionnaire, ATS), merged into Database in
// src/lib/database.types.ts. Keep in sync with the SQL and docs/academy.md.

import type { AcademyRole } from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";

type Fn<Args, Returns> = { Args: Args; Returns: Returns };

/** One row of academy_my_tasks(): a task instance of the signed-in user. */
export type MyTaskRow = {
  task_id: string;
  block_id: string;
  lesson_id: string;
  lesson_title: string;
  /** Player URL of the lesson, or /academy. */
  link: string;
  title: string;
  description: string | null;
  task_position: number;
  deadline_offset_days: number | null;
  required: boolean;
  shared: boolean;
  placement_only: boolean;
  /** Set for a shared task: the placement it is ticked for. */
  placement_id: string | null;
  /** "Client · Developer" of that placement. */
  placement_label: string | null;
  due_at: string | null;
  done_at: string | null;
  done_by_name: string | null;
  can_tick: boolean;
};

/** One row of academy_placement_tasks(): for the placement page. */
export type PlacementTaskRow = {
  task_id: string;
  block_id: string;
  lesson_id: string;
  lesson_title: string;
  title: string;
  description: string | null;
  deadline_offset_days: number | null;
  required: boolean;
  shared: boolean;
  /** Null for a shared task; the person for a placement-only task. */
  profile_id: string | null;
  person_name: string | null;
  due_at: string | null;
  done_at: string | null;
  done_by_name: string | null;
  can_tick: boolean;
};

export type OverdueTaskRow = {
  task_id: string;
  title: string;
  lesson_id: string;
  lesson_title: string;
  required: boolean;
  shared: boolean;
  profile_id: string | null;
  person_name: string | null;
  person_email: string | null;
  academy_role: AcademyRole | null;
  placement_id: string | null;
  placement_label: string | null;
  due_at: string;
  days_overdue: number;
  reminded_at: string | null;
  reminder_count: number;
};

export type PersonTaskRow = {
  task_id: string;
  lesson_id: string;
  lesson_title: string;
  title: string;
  required: boolean;
  shared: boolean;
  placement_only: boolean;
  placement_id: string | null;
  due_at: string | null;
  done_at: string | null;
  reminder_count: number;
};

export type CheckQuestionForLearner = {
  question_id: string;
  question_position: number;
  question: string;
  /** ["option a", "option b", ...] */
  options: Json;
};

export type CandidateCheckScoreRow = {
  candidate_id: string;
  profile_id: string;
  block_id: string;
  check_title: string;
  lesson_title: string;
  attempts: number;
  best_percent: number;
  last_percent: number;
  last_attempt_at: string;
  /** The score of the first attempt: what the ATS ranks on (answers are shown after each attempt). */
  first_percent: number;
};

export type CandidateAssignmentRow = {
  candidate_id: string;
  profile_id: string;
  submission_id: string;
  block_id: string;
  assignment_title: string;
  lesson_title: string;
  attempt: number;
  status: "submitted" | "changes_requested" | "approved";
  submitted_at: string;
  ai_total: number | null;
  final_score: number | null;
  /** /dashboard/academy/reviews/<submission_id> */
  review_path: string;
};

export type CandidateQuestionnaireResultRow = {
  candidate_id: string;
  profile_id: string;
  block_id: string;
  title: string;
  consented_at: string;
  submitted_at: string;
  /** { dimensions: [{ key, label, score, answered }] } */
  result: Json;
};

export type CandidateLearnSummaryRow = {
  candidate_id: string;
  profile_id: string;
  checks_done: number;
  check_average_percent: number | null;
  assignments_submitted: number;
  assignments_approved: number;
  assignment_average_score: number | null;
  questionnaire_done: boolean;
};

export type LearnFunctions = {
  academy_deadline: Fn<{ p_start: string | null; p_offset: number | null; p_zone: string | null }, string | null>;
  academy_submit_assignment: Fn<
    { p_block_id: string; p_body?: string | null; p_file_path?: string | null; p_file_name?: string | null; p_link_url?: string | null },
    string
  >;
  academy_review_submission: Fn<
    { p_submission_id: string; p_status: "approved" | "changes_requested"; p_feedback?: string | null; p_final_score?: number | null; p_rubric_scores?: Json | null },
    undefined
  >;
  academy_my_tasks: Fn<{ p_block_id?: string | null }, MyTaskRow[]>;
  academy_set_task_done: Fn<{ p_task_id: string; p_placement_id?: string | null; p_done?: boolean }, string | null>;
  academy_placement_tasks: Fn<{ p_placement_id: string }, PlacementTaskRow[]>;
  academy_overdue_tasks: Fn<Record<string, never>, OverdueTaskRow[]>;
  academy_person_tasks: Fn<{ p_profile_id: string }, PersonTaskRow[]>;
  /** Service role only (job academy-task-reminders). */
  academy_remind_overdue_tasks: Fn<Record<string, never>, number>;
  academy_check_questions_for: Fn<{ p_block_id: string }, CheckQuestionForLearner[]>;
  academy_submit_check: Fn<{ p_block_id: string; p_answers: Json }, Json>;
  academy_check_results: Fn<{ p_block_id: string }, Json | null>;
  academy_questionnaire_consent: Fn<{ p_block_id: string; p_give: boolean }, undefined>;
  academy_save_questionnaire: Fn<{ p_block_id: string; p_answers: Json; p_submit?: boolean }, Json>;
  academy_candidate_check_scores: Fn<{ p_candidate_id?: string | null }, CandidateCheckScoreRow[]>;
  academy_candidate_assignments: Fn<{ p_candidate_id?: string | null }, CandidateAssignmentRow[]>;
  academy_candidate_questionnaire_results: Fn<{ p_candidate_id?: string | null }, CandidateQuestionnaireResultRow[]>;
  academy_candidate_learn_summary: Fn<{ p_candidate_ids?: string[] | null }, CandidateLearnSummaryRow[]>;
};
