// Types of the Academy tables and functions
// (supabase/migrations/20261112000000_academy_foundation.sql and the three
// Academy migrations after it), merged into Database in
// src/lib/database.types.ts. Keep in sync with the SQL and docs/academy.md.

import type { Json } from "@/lib/database.types";

export type AcademyLocale = "nl" | "en";
export type AcademyRole = "client_admin" | "client_member" | "client_reader" | "developer" | "candidate";
export type AcademyPlacementRole = "client_admin" | "client_member" | "client_reader" | "developer";
export type AcademyAudience = "client" | "developer";
export type AcademyStatus = "draft" | "published";
export type AcademyScope = "all" | "default";
export type DigestFrequency = "daily" | "weekly" | "off";
export type AcademyGroupKind = "vacancy" | "month" | "campaign" | "other";
export type AcademyBlockType =
  | "explanation"
  | "video"
  | "document"
  | "worksheet"
  | "assignment"
  | "tasks"
  | "knowledge_check"
  | "notes"
  | "questionnaire";
/** academy_module_state(): null when not visible. */
export type AcademyModuleState =
  | "completed"
  | "open"
  | "locked_scope"
  | "locked_release"
  | "locked_requirement"
  | "locked_order";
export type AcademyDocumentKind = "download" | "worksheet";
export type AcademyDocumentScope = "global" | "placement";
export type AcademyDocumentCategory =
  | "workbook"
  | "template"
  | "checklist"
  | "contract_summary"
  | "gdpr"
  | "policy"
  | "escalation_matrix"
  | "decision_matrix"
  | "blocker_agreement"
  | "other";
export type AcademySubmissionStatus = "submitted" | "changes_requested" | "approved";
export type AcademyTranscriptStatus = "none" | "pending" | "ready" | "corrected" | "failed";
export type AcademyRitualCadence = "daily" | "weekly" | "monthly";
export type AcademyRitualAudience = "client" | "developer" | "both" | "nordavo";
export type AcademyLeaveKind = "vacation" | "sick" | "unpaid" | "other";
export type AcademyLeaveStatus = "requested" | "client_agreed" | "approved" | "rejected" | "cancelled";
export type AcademyMilestoneKind = "day_1" | "week_1" | "day_30" | "day_90" | "custom";

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

type Fn<Args, Returns> = { Args: Args; Returns: Returns };

export type AcademyMemberRow = {
  profile_id: string;
  academy_role: AcademyRole;
  locale: AcademyLocale;
  start_date: string | null;
  candidate_id: string | null;
  digest_frequency: DigestFrequency;
  digest_sent_at: string | null;
  last_active_at: string | null;
  invited_at: string | null;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyGroupRow = {
  id: string;
  name: string;
  kind: AcademyGroupKind;
  vacancy_id: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyGroupMemberRow = {
  group_id: string;
  profile_id: string;
  added_by: string | null;
  created_at: string;
};

export type AcademyCourseRow = {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  language: AcademyLocale;
  audience: AcademyAudience;
  status: AcademyStatus;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyVideoRow = {
  id: string;
  title: string;
  current_version_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyVideoVersionRow = {
  id: string;
  video_id: string;
  version: number;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  subtitles_nl_path: string | null;
  subtitles_en_path: string | null;
  transcript: string | null;
  transcript_status: AcademyTranscriptStatus;
  /** nl or en: the language of the transcript (media migration). */
  transcript_language: AcademyLocale | null;
  /** Why automatic transcription failed (media migration). */
  transcript_error: string | null;
  created_by: string | null;
  created_at: string;
};

export type AcademyDocumentRow = {
  id: string;
  title: string;
  description: string | null;
  kind: AcademyDocumentKind;
  scope: AcademyDocumentScope;
  placement_id: string | null;
  category: AcademyDocumentCategory;
  worksheet_fields: Json;
  current_version: number;
  new_until: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyDocumentVersionRow = {
  id: string;
  document_id: string;
  version: number;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type AcademyModuleRow = {
  id: string;
  course_id: string;
  seed_key: string | null;
  title: string;
  description: string | null;
  position: number;
  status: AcademyStatus;
  requires_previous: boolean;
  release_offset_days: number | null;
  in_default_access: boolean;
  is_core: boolean;
  required_before_start: boolean;
  workbook_document_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyModuleRequirementRow = { module_id: string; required_module_id: string };

export type AcademyLessonRow = {
  id: string;
  title: string;
  summary: string | null;
  language: AcademyLocale;
  status: AcademyStatus;
  duration_minutes: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyModuleLessonRow = {
  module_id: string;
  lesson_id: string;
  position: number;
  created_at: string;
};

export type AcademyLessonBlockRow = {
  id: string;
  lesson_id: string;
  type: AcademyBlockType;
  position: number;
  title: string | null;
  content: Json;
  required: boolean;
  completion: Json;
  video_id: string | null;
  document_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyCourseAccessRow = {
  id: string;
  course_id: string;
  profile_id: string | null;
  group_id: string | null;
  scope: AcademyScope;
  granted_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyOpenModuleRow = {
  profile_id: string;
  module_id: string;
  force: boolean;
  granted_by: string | null;
  created_at: string;
};

export type AcademyPlacementMemberRow = {
  placement_id: string;
  profile_id: string;
  role: AcademyPlacementRole;
  added_by: string | null;
  created_at: string;
};

export type AcademyRitualRow = {
  id: string;
  course_id: string | null;
  placement_id: string | null;
  title: string;
  description: string | null;
  cadence: AcademyRitualCadence;
  weekday: number | null;
  audience: AcademyRitualAudience;
  active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

export type AcademyRitualLogRow = {
  id: string;
  ritual_id: string;
  placement_id: string;
  profile_id: string | null;
  period_date: string;
  done_at: string;
  note: string | null;
};

export type AcademyPulseRow = {
  id: string;
  placement_id: string;
  profile_id: string;
  period_start: string;
  sent_at: string | null;
  reminded_at: string | null;
  answered_at: string | null;
  created_at: string;
};

export type AcademyPulseAnswerRow = {
  pulse_id: string;
  score: number;
  going_well: string | null;
  friction: string | null;
  flagged: boolean;
  created_at: string;
};

export type AcademyLeaveRequestRow = {
  id: string;
  placement_id: string;
  profile_id: string;
  kind: AcademyLeaveKind;
  start_date: string;
  end_date: string;
  days: number | null;
  note: string | null;
  status: AcademyLeaveStatus;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyLeaveBalanceRow = {
  id: string;
  placement_id: string;
  profile_id: string;
  year: number;
  entitled_days: number;
  carried_over_days: number;
  adjustment_days: number;
  updated_at: string;
};

export type AcademyHolidayRow = {
  id: string;
  country: "NL" | "IN";
  region: string | null;
  year: number;
  date: string;
  name_nl: string;
  name_en: string;
  created_at: string;
};

export type AcademyMilestoneRow = {
  id: string;
  placement_id: string;
  kind: AcademyMilestoneKind;
  title: string;
  due_date: string | null;
  completed_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type AcademyReviewRow = {
  id: string;
  milestone_id: string | null;
  placement_id: string;
  author_id: string | null;
  answers: Json;
  report: string | null;
  status: "draft" | "submitted";
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyNotificationRow = {
  id: string;
  profile_id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  payload: Json;
  read_at: string | null;
  digested_at: string | null;
  created_at: string;
};

export type AcademyBlockProgressRow = {
  profile_id: string;
  block_id: string;
  viewed_at: string | null;
  state: Json;
  updated_at: string;
};

export type AcademyNoteRow = {
  id: string;
  profile_id: string;
  lesson_id: string | null;
  module_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
};

export type AcademyWatchProgressRow = {
  profile_id: string;
  video_id: string;
  version_id: string | null;
  position_seconds: number;
  percent: number;
  watched_seconds: number;
  completed_at: string | null;
  updated_at: string;
};

export type AcademyWorksheetAnswerRow = {
  id: string;
  document_id: string;
  profile_id: string;
  answers: Json;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyAssignmentSubmissionRow = {
  id: string;
  block_id: string;
  profile_id: string;
  attempt: number;
  body: string | null;
  file_path: string | null;
  file_name: string | null;
  link_url: string | null;
  status: AcademySubmissionStatus;
  feedback: string | null;
  feedback_by: string | null;
  feedback_at: string | null;
  final_score: number | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
};

export type AcademyAssignmentAssessmentRow = {
  submission_id: string;
  ai_scores: Json;
  ai_total: number | null;
  ai_summary: string | null;
  ai_status: "none" | "pending" | "ready" | "failed";
  ai_created_at: string | null;
  rubric_scores: Json;
  updated_at: string;
};

export type AcademyTaskRow = {
  id: string;
  block_id: string;
  title: string;
  description: string | null;
  position: number;
  deadline_offset_days: number | null;
  shared: boolean;
  placement_only: boolean;
  required: boolean;
  created_at: string;
  updated_at: string;
};

export type AcademyTaskStatusRow = {
  id: string;
  task_id: string;
  profile_id: string | null;
  placement_id: string | null;
  due_at: string | null;
  done_at: string | null;
  done_by: string | null;
  reminded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyCheckQuestionRow = {
  id: string;
  block_id: string;
  position: number;
  question: string;
  options: Json;
  correct_index: number;
  explanation: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyCheckAttemptRow = {
  id: string;
  block_id: string;
  profile_id: string;
  answers: Json;
  score: number;
  max_score: number;
  created_at: string;
};

export type AcademyQuestionnaireConsentRow = {
  profile_id: string;
  block_id: string;
  consented_at: string;
  withdrawn_at: string | null;
};

export type AcademyQuestionnaireResponseRow = {
  id: string;
  block_id: string;
  profile_id: string;
  answers: Json;
  result: Json;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademyLessonProgressRow = {
  profile_id: string;
  lesson_id: string;
  started_at: string;
  last_viewed_at: string | null;
  last_course_id: string | null;
  required_total: number;
  required_done: number;
  percent: number;
  completed_at: string | null;
  updated_at: string;
};

export type AcademyModuleCompletionRow = { profile_id: string; module_id: string; completed_at: string };

export type AcademyCertificateRow = {
  id: string;
  profile_id: string;
  course_id: string;
  number: string;
  full_name: string;
  storage_path: string | null;
  issued_at: string;
};

export type AcademyTables = {
  academy_members: Table<AcademyMemberRow, "profile_id" | "academy_role">;
  academy_groups: Table<AcademyGroupRow, "name">;
  academy_group_members: Table<AcademyGroupMemberRow, "group_id" | "profile_id">;
  academy_courses: Table<AcademyCourseRow, "title" | "language" | "audience">;
  academy_videos: Table<AcademyVideoRow, "title">;
  academy_video_versions: Table<AcademyVideoVersionRow, "video_id" | "version" | "storage_path">;
  academy_documents: Table<AcademyDocumentRow, "title">;
  academy_document_versions: Table<AcademyDocumentVersionRow, "document_id" | "version" | "storage_path" | "file_name">;
  academy_modules: Table<AcademyModuleRow, "course_id" | "title">;
  academy_module_requirements: Table<AcademyModuleRequirementRow, "module_id" | "required_module_id">;
  academy_lessons: Table<AcademyLessonRow, "title">;
  academy_module_lessons: Table<AcademyModuleLessonRow, "module_id" | "lesson_id">;
  academy_lesson_blocks: Table<AcademyLessonBlockRow, "lesson_id" | "type">;
  academy_course_access: Table<AcademyCourseAccessRow, "course_id">;
  academy_open_modules: Table<AcademyOpenModuleRow, "profile_id" | "module_id">;
  academy_placement_members: Table<AcademyPlacementMemberRow, "placement_id" | "profile_id" | "role">;
  academy_rituals: Table<AcademyRitualRow, "title" | "cadence">;
  academy_ritual_logs: Table<AcademyRitualLogRow, "ritual_id" | "placement_id" | "period_date">;
  academy_pulses: Table<AcademyPulseRow, "placement_id" | "profile_id" | "period_start">;
  academy_pulse_answers: Table<AcademyPulseAnswerRow, "pulse_id" | "score">;
  academy_leave_requests: Table<AcademyLeaveRequestRow, "placement_id" | "start_date" | "end_date">;
  academy_leave_balances: Table<AcademyLeaveBalanceRow, "placement_id" | "profile_id" | "year">;
  academy_holidays: Table<AcademyHolidayRow, "country" | "year" | "date" | "name_nl" | "name_en">;
  academy_milestones: Table<AcademyMilestoneRow, "placement_id" | "title">;
  academy_reviews: Table<AcademyReviewRow, "placement_id">;
  academy_notifications: Table<AcademyNotificationRow, "profile_id" | "kind" | "title">;
  academy_block_progress: Table<AcademyBlockProgressRow, "profile_id" | "block_id">;
  academy_notes: Table<AcademyNoteRow, "profile_id">;
  academy_watch_progress: Table<AcademyWatchProgressRow, "profile_id" | "video_id">;
  academy_worksheet_answers: Table<AcademyWorksheetAnswerRow, "document_id" | "profile_id">;
  academy_assignment_submissions: Table<AcademyAssignmentSubmissionRow, "block_id" | "profile_id">;
  academy_assignment_assessments: Table<AcademyAssignmentAssessmentRow, "submission_id">;
  academy_tasks: Table<AcademyTaskRow, "block_id" | "title">;
  academy_task_status: Table<AcademyTaskStatusRow, "task_id">;
  academy_check_questions: Table<AcademyCheckQuestionRow, "block_id" | "question">;
  academy_check_attempts: Table<AcademyCheckAttemptRow, "block_id" | "profile_id">;
  academy_questionnaire_consents: Table<AcademyQuestionnaireConsentRow, "profile_id" | "block_id">;
  academy_questionnaire_responses: Table<AcademyQuestionnaireResponseRow, "block_id" | "profile_id">;
  academy_lesson_progress: Table<AcademyLessonProgressRow, "profile_id" | "lesson_id">;
  academy_module_completions: Table<AcademyModuleCompletionRow, "profile_id" | "module_id">;
  academy_certificates: Table<AcademyCertificateRow, "profile_id" | "course_id" | "full_name">;
};

/** One row of academy_course_outline(): a module with one of its lessons (lesson columns null when it has none). */
export type AcademyOutlineRow = {
  module_id: string;
  module_title: string;
  module_description: string | null;
  module_position: number;
  module_status: AcademyStatus;
  module_state: AcademyModuleState;
  release_date: string | null;
  is_core: boolean;
  required_before_start: boolean;
  workbook_document_id: string | null;
  lesson_id: string | null;
  lesson_title: string | null;
  lesson_summary: string | null;
  lesson_status: AcademyStatus | null;
  lesson_position: number | null;
  duration_minutes: number | null;
  started_at: string | null;
  last_viewed_at: string | null;
  percent: number | null;
  completed_at: string | null;
};

export type AcademyMyCourseRow = {
  course_id: string;
  slug: string | null;
  title: string;
  description: string | null;
  language: AcademyLocale;
  audience: AcademyAudience;
  status: AcademyStatus;
  scope: AcademyScope | null;
  lessons_total: number;
  lessons_done: number;
  last_viewed_at: string | null;
  completed: boolean;
};

export type AcademyMyPlacementRow = {
  id: string;
  my_role: AcademyPlacementRole;
  status: "active" | "notice" | "ended";
  start_date: string;
  end_date: string | null;
  probation_end_date: string | null;
  hours_per_week: number | null;
  overlap_start: string | null;
  overlap_end: string | null;
  overlap_time_zone: string;
  client_id: string;
  client_name: string | null;
  developer_name: string | null;
  developer_title: string | null;
  vacancy_title: string | null;
  nordavo_contact_name: string | null;
  nordavo_contact_email: string | null;
  nordavo_contact_booking_url: string | null;
};

export type AcademyPeopleProgressRow = {
  profile_id: string;
  full_name: string | null;
  academy_role: AcademyRole;
  course_id: string;
  course_title: string;
  lessons_total: number;
  lessons_done: number;
  check_average_percent: number | null;
  assignments_approved: number;
  last_active_at: string | null;
  certificate_issued_at: string | null;
};

export type AcademyFunctions = {
  academy_is_manager: Fn<Record<string, never>, boolean>;
  academy_member_role: Fn<{ p_profile_id?: string }, AcademyRole | null>;
  academy_has_course: Fn<{ p_course_id: string; p_profile_id?: string }, boolean>;
  academy_can_open_lesson: Fn<{ p_lesson_id: string }, boolean>;
  academy_can_open_module: Fn<{ p_module_id: string }, boolean>;
  academy_can_view_progress: Fn<{ p_profile_id: string }, boolean>;
  academy_can_see_placement: Fn<{ p_placement_id: string }, boolean>;
  academy_placement_role: Fn<{ p_placement_id: string; p_profile_id?: string }, AcademyPlacementRole | null>;
  academy_touch: Fn<Record<string, never>, undefined>;
  /** Returns the academy_lesson_progress row as JSON (null in manager preview). */
  academy_open_lesson: Fn<{ p_lesson_id: string; p_course_id?: string | null }, Json>;
  academy_record_block_view: Fn<{ p_block_id: string }, undefined>;
  academy_record_watch: Fn<
    {
      p_video_id: string;
      p_version_id: string | null;
      p_position_seconds: number;
      p_percent: number;
      p_watched_seconds?: number;
      /** Played [start, end] ranges; the percent is computed from them (media migration). */
      p_ranges?: Json | null;
    },
    Json
  >;
  academy_course_outline: Fn<{ p_course_id: string }, AcademyOutlineRow[]>;
  academy_my_courses: Fn<Record<string, never>, AcademyMyCourseRow[]>;
  academy_lesson_blocks_state: Fn<{ p_lesson_id: string }, { block_id: string; done: boolean }[]>;
  academy_people_progress: Fn<Record<string, never>, AcademyPeopleProgressRow[]>;
  academy_my_placements: Fn<Record<string, never>, AcademyMyPlacementRow[]>;
  academy_placement_people: Fn<{ p_placement_id: string }, { profile_id: string; full_name: string | null; email: string | null; role: AcademyPlacementRole }[]>;
  academy_add_person: Fn<
    {
      p_profile_id: string;
      p_academy_role: AcademyRole;
      p_locale?: AcademyLocale | null;
      p_start_date?: string | null;
      p_client_id?: string | null;
      p_candidate_id?: string | null;
      p_course_id?: string | null;
      p_scope?: AcademyScope;
      p_open_module_ids?: string[];
      p_time_zone?: string | null;
    },
    undefined
  >;
  academy_task_open: Fn<{ p_task_id: string }, boolean>;
  academy_task_can_tick: Fn<{ p_task_id: string; p_profile_id: string | null; p_placement_id: string | null }, boolean>;
  academy_can_see_video: Fn<{ p_video_id: string }, boolean>;
  academy_can_see_document: Fn<{ p_document_id: string }, boolean>;
  academy_can_read_file: Fn<{ p_path: string }, boolean>;
  academy_client_options: Fn<Record<string, never>, { id: string; name: string }[]>;
  academy_candidate_options: Fn<{ p_search?: string | null }, { id: string; full_name: string; email: string | null; top_candidate: boolean }[]>;
  academy_duplicate_lesson: Fn<{ p_lesson_id: string; p_module_id?: string | null }, string>;
  academy_duplicate_module: Fn<{ p_module_id: string }, string>;
  /** Service role only. */
  academy_notify: Fn<
    { p_profile_id: string; p_kind: string; p_title: string; p_body?: string | null; p_link?: string | null; p_payload?: Json },
    string
  >;
  /** Service role only. */
  academy_refresh_lesson: Fn<{ p_lesson_id: string; p_profile_id: string }, Json>;
  /** Service role only. */
  academy_module_state: Fn<{ p_module_id: string; p_profile_id: string }, AcademyModuleState | null>;
  /** Service role only. */
  academy_course_done: Fn<{ p_course_id: string; p_profile_id: string }, boolean>;
};
