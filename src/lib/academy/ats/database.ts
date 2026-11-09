// Types of the Academy and ATS tables and functions
// (supabase/migrations/20261113300000_academy_ats_core.sql,
// 20261113310000_academy_ats_read.sql, 20261113320000_academy_ats_manage.sql),
// merged into Database in src/lib/database.types.ts. Keep in sync with the
// SQL and docs/academy.md (section ATS-koppeling).

import type { Json } from "@/lib/database.types";

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

type Fn<Args, Returns> = { Args: Args; Returns: Returns };

export type AtsEventKind = "placed" | "vacancy_linked" | "top_candidate" | "enrol";
export type AtsEventStatus = "pending" | "done" | "skipped" | "failed";
export type RetentionAction = "anonymise" | "delete";

export type AcademyAtsSettingsRow = {
  id: boolean;
  developer_course_id: string | null;
  client_course_id: string | null;
  top_candidate_module_ids: string[];
  top_candidate_mail: boolean;
  invite_client_contact: boolean;
  welcome_mail: boolean;
  reminder_enabled: boolean;
  reminder_after_days: number;
  reminder_repeat_days: number;
  reminder_max: number;
  retention_months: number;
  retention_action: RetentionAction;
  retention_enabled: boolean;
  updated_by: string | null;
  updated_at: string;
};

export type AcademyGroupSettingsRow = {
  group_id: string;
  auto_enrol: boolean;
  open_module_ids: string[];
  send_mail: boolean;
  updated_at: string;
};

export type AcademyAtsEventRow = {
  id: string;
  kind: AtsEventKind;
  dedupe_key: string | null;
  candidate_id: string | null;
  placement_id: string | null;
  vacancy_id: string | null;
  group_id: string | null;
  profile_id: string | null;
  payload: Json;
  status: AtsEventStatus;
  attempts: number;
  result: Json;
  error: string | null;
  created_by: string | null;
  created_at: string;
  processed_at: string | null;
  updated_at: string;
};

export type AcademyBlockDraftRow = {
  block_id: string;
  source: "ai" | "transcript";
  video_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type AcademyReminderRow = {
  id: string;
  profile_id: string;
  kind: "stuck";
  course_id: string | null;
  lesson_id: string | null;
  days_inactive: number | null;
  mailed: boolean;
  sent_at: string;
};

export type AcademyRetentionLogRow = {
  id: string;
  profile_id: string | null;
  candidate_id: string | null;
  action: RetentionAction | "dry_run" | "failed";
  last_activity_at: string | null;
  detail: Json;
  job_run_id: string | null;
  created_at: string;
};

export type AcademyAtsTables = {
  academy_ats_settings: Table<AcademyAtsSettingsRow, never>;
  academy_group_settings: Table<AcademyGroupSettingsRow, "group_id">;
  academy_ats_events: Table<AcademyAtsEventRow, "kind">;
  academy_block_drafts: Table<AcademyBlockDraftRow, "block_id">;
  academy_reminders: Table<AcademyReminderRow, "profile_id">;
  academy_retention_log: Table<AcademyRetentionLogRow, "action">;
};

/** One candidate in the developer course (academy_ats_progress, academy_ats_pool). */
export type AtsProgress = {
  candidate_id: string;
  profile_id: string | null;
  enrolled: boolean;
  academy_role: string | null;
  top_candidate: boolean;
  lessons_total: number;
  lessons_done: number;
  progress_percent: number;
  modules_total: number;
  modules_done: number;
  started_at: string | null;
  completed_at: string | null;
  lead_time_days: number | null;
  last_activity_at: string | null;
  inactive_14d: boolean;
  checks_done: number;
  check_avg_percent: number | null;
  assignments_submitted: number;
  assignments_waiting: number;
  ai_avg_score: number | null;
  final_avg_score: number | null;
  watch_avg_percent: number | null;
  certificate_issued_at: string | null;
};

export type AtsPoolRow = AtsProgress & {
  full_name: string;
  email: string | null;
  current_title: string | null;
  location: string;
  candidate_status: string;
  total_count: number;
};

export type AtsPoolArgs = {
  p_search?: string | null;
  p_enrolled?: boolean | null;
  p_state?: string | null;
  p_inactive?: boolean | null;
  p_certificate?: boolean | null;
  p_top?: boolean | null;
  p_min_progress?: number | null;
  p_min_check?: number | null;
  p_vacancy_id?: string | null;
  p_group_id?: string | null;
  p_sort?: string;
  p_desc?: boolean;
  p_limit?: number;
  p_offset?: number;
};

export type AdminPeopleRow = {
  profile_id: string;
  full_name: string | null;
  email: string | null;
  academy_role: string;
  client_id: string | null;
  client_name: string | null;
  candidate_id: string | null;
  lessons_total: number;
  lessons_done: number;
  progress_percent: number;
  watch_avg_percent: number | null;
  tasks_open: number;
  tasks_overdue: number;
  assignments_waiting: number;
  pulse_last: number | null;
  pulse_avg: number | null;
  pulse_flagged: boolean;
  last_activity_at: string | null;
  inactive_14d: boolean;
  completed_courses: number;
};

export type AdminRollupRow = {
  key_id: string;
  name: string;
  people: number;
  avg_progress: number | null;
  completed: number;
  inactive: number;
  tasks_open: number;
  tasks_overdue: number;
  assignments_waiting: number;
  pulse_avg: number | null;
  pulse_flagged: number;
};

export type FunnelRow = {
  step: number;
  module_id: string;
  module_title: string;
  lesson_id: string;
  lesson_title: string;
  cohort: number;
  reached: number;
  completed: number;
  stopped_here: number;
};

export type StuckCandidateRow = {
  profile_id: string;
  full_name: string | null;
  email: string;
  locale: "nl" | "en";
  time_zone: string;
  course_id: string;
  course_title: string;
  days_inactive: number;
  reminders_sent: number;
  next_lesson_id: string;
  next_lesson_title: string;
};

export type AcademyAtsFunctions = {
  academy_ats_developer_course: Fn<Record<string, never>, string | null>;
  academy_ats_client_course: Fn<Record<string, never>, string | null>;
  academy_ats_can_read: Fn<Record<string, never>, boolean>;
  academy_ats_enrol: Fn<{ p_profile_id: string; p_candidate_id: string; p_group_id?: string | null; p_open_module_ids?: string[] }, Json>;
  academy_ats_queue_enrol: Fn<{ p_candidate_ids: string[]; p_group_id?: string | null; p_open_module_ids?: string[]; p_send_mail?: boolean }, number>;
  academy_candidate_names: Fn<{ p_candidate_ids: string[] }, { id: string; full_name: string }[]>;
  academy_ats_rerun_placement: Fn<{ p_placement_id: string }, Json>;
  academy_ats_pool: Fn<AtsPoolArgs, AtsPoolRow[]>;
  academy_ats_columns: Fn<
    { p_candidate_ids: string[] },
    { candidate_id: string; enrolled: boolean; progress_percent: number; check_avg_percent: number | null; inactive_14d: boolean; certificate: boolean; top_candidate: boolean }[]
  >;
  academy_ats_candidate_detail: Fn<{ p_candidate_id: string }, Json>;
  academy_person_detail: Fn<{ p_profile_id: string }, Json>;
  academy_admin_people: Fn<{ p_client_id?: string | null; p_group_id?: string | null; p_role?: string | null; p_course_id?: string | null }, AdminPeopleRow[]>;
  academy_admin_rollup: Fn<{ p_by: "client" | "group" }, AdminRollupRow[]>;
  academy_lesson_funnel: Fn<{ p_course_id: string; p_group_id?: string | null; p_client_id?: string | null }, FunnelRow[]>;
  academy_group_report: Fn<{ p_group_id: string; p_course_id?: string | null }, Json>;
  academy_retention_preview: Fn<Record<string, never>, { due: number; oldest: string | null }[]>;
  /** Service role only (jobs and the app's processor). */
  academy_ats_apply_placement: Fn<{ p_placement_id: string; p_client_profile_id?: string | null; p_developer_profile_id?: string | null }, Json>;
  /** Service role only. */
  academy_ats_enrol_core: Fn<
    { p_profile_id: string; p_candidate_id: string; p_group_id?: string | null; p_open_module_ids?: string[]; p_scope?: string; p_actor?: string | null },
    Json
  >;
  /** Service role only. */
  academy_ats_event_note: Fn<{ p_event_id: string; p_result: Json; p_status?: AtsEventStatus | null; p_error?: string | null }, undefined>;
  /** Service role only. */
  academy_stuck_candidates: Fn<{ p_now?: string }, StuckCandidateRow[]>;
  /** Service role only. */
  academy_retention_candidates: Fn<{ p_months?: number | null; p_now?: string }, { profile_id: string; candidate_id: string | null; last_activity_at: string }[]>;
  /** Service role only. */
  academy_retention_anonymise: Fn<{ p_profile_id: string; p_job_run_id?: string | null }, Json>;
  /** Service role only. */
  academy_retention_note: Fn<
    { p_profile_id: string; p_candidate_id: string | null; p_action: string; p_last: string | null; p_detail?: Json; p_job_run_id?: string | null },
    undefined
  >;
};
