// Types of the Working Style Profile tables and functions
// (supabase/migrations/20261116000000_wsp_core.sql, 20261116010000_wsp_flow.sql),
// merged into Database in src/lib/database.types.ts. Keep in sync with the
// SQL and docs/working-style-profile.md.

import type { Json } from "@/lib/database.types";

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

type Fn<Args, Returns> = { Args: Args; Returns: Returns };

export type WspStatus = "invited" | "started" | "completed" | "expired" | "deleted";
export type WspReason = "trigger_stage" | "manual" | "placement_start";
export type WspMode = "follow_vacancy" | "always" | "never";

export type WspSettingsRow = {
  id: boolean;
  enabled: boolean;
  trigger_stage_id: string;
  default_for_new_vacancies: boolean;
  auto_invite_developers_on_placement: boolean;
  invite_valid_days: number;
  reminder_after_days: number;
  reuse_months: number;
  permission_request_days: number;
  candidate_retention_days: number;
  talent_pool_retention_days: number;
  developer_retention_days: number;
  updated_by: string | null;
  updated_at: string;
};

export type WspItemRow = {
  id: string;
  instrument_version: string;
  position: number;
  code: string;
  statement: string;
  dimension: string;
  key: string | null;
  expected_answer: number | null;
};

export type WspAssessmentRow = {
  id: string;
  person_id: string | null;
  person_type: "candidate" | "developer";
  status: WspStatus;
  invite_token: string | null;
  invited_by: string | null;
  invite_reason: WspReason;
  invited_at: string;
  expires_at: string;
  reminder_sent_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  intro_accepted_at: string | null;
  instrument_version: string;
  delete_after: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WspLinkRow = {
  id: string;
  assessment_id: string;
  vacancy_id: string | null;
  client_id: string | null;
  linked_at: string;
  linked_by: string | null;
};

export type WspAnswerRow = {
  assessment_id: string;
  item_id: string;
  answer: number;
  answered_at: string;
  page_number: number;
  page_duration_ms: number;
};

export type WspResultRow = {
  assessment_id: string;
  dimension: string;
  mean_score: number;
  score_0_100: number;
  band: string;
};

export type WspFlagRow = { id: string; assessment_id: string; flag_type: string; details: Json; created_at: string };

export type WspShareRow = {
  id: string;
  assessment_id: string;
  client_id: string;
  consented_at: string;
  consented_by: string;
  consent_text_version: string;
  revoked_at: string | null;
  revoked_by: string | null;
};

export type WspPermissionRequestRow = {
  id: string;
  assessment_id: string;
  client_id: string;
  requested_by: string | null;
  requested_at: string;
};

export type WspAuditRow = {
  id: number;
  assessment_id: string | null;
  actor: string | null;
  actor_role: string;
  action: string;
  details: Json;
  created_at: string;
};

export type WspOutboxRow = {
  id: string;
  kind: "invite" | "reminder" | "permission_request" | "withdrawn" | "completed";
  assessment_id: string | null;
  client_id: string | null;
  payload: Json;
  status: "pending" | "sent" | "skipped" | "failed";
  attempts: number;
  last_error: string | null;
  created_at: string;
  handled_at: string | null;
};

export type WspTables = {
  wsp_settings: Table<WspSettingsRow, never>;
  wsp_items: Table<WspItemRow, "instrument_version" | "position" | "code" | "statement" | "dimension">;
  wsp_assessments: Table<WspAssessmentRow, "person_type" | "invite_reason" | "expires_at">;
  wsp_assessment_links: Table<WspLinkRow, "assessment_id">;
  wsp_answers: Table<WspAnswerRow, "assessment_id" | "item_id" | "answer" | "page_number">;
  wsp_results: Table<WspResultRow, "assessment_id" | "dimension" | "mean_score" | "score_0_100" | "band">;
  wsp_flags: Table<WspFlagRow, "assessment_id" | "flag_type">;
  wsp_shares: Table<WspShareRow, "assessment_id" | "client_id" | "consented_by">;
  wsp_permission_requests: Table<WspPermissionRequestRow, "assessment_id" | "client_id">;
  wsp_audit_log: Table<WspAuditRow, "actor_role" | "action">;
  wsp_outbox: Table<WspOutboxRow, "kind">;
};

export type WspFunctions = {
  wsp_enabled: Fn<Record<string, never>, boolean>;
  wsp_is_staff: Fn<Record<string, never>, boolean>;
  wsp_my_person_id: Fn<Record<string, never>, string | null>;
  wsp_update_settings: Fn<{ p_settings: Json }, WspSettingsRow>;
  wsp_set_vacancy: Fn<{ p_vacancy: string; p_enabled: boolean }, undefined>;
  wsp_set_person: Fn<{ p_person: string; p_mode?: WspMode | null; p_talent_pool_consent?: boolean | null }, undefined>;
  wsp_send: Fn<{ p_person: string; p_vacancy?: string | null; p_client?: string | null }, string>;
  wsp_resend: Fn<{ p_assessment: string }, string>;
  wsp_link: Fn<{ p_assessment: string; p_vacancy?: string | null; p_client?: string | null }, boolean>;
  wsp_request_permission: Fn<{ p_assessment: string; p_client: string }, string>;
  wsp_questionnaire: Fn<{ p_token?: string | null; p_assessment?: string | null }, Json>;
  wsp_accept_intro: Fn<{ p_token?: string | null; p_assessment?: string | null }, undefined>;
  wsp_save_answer: Fn<
    { p_token: string | null; p_assessment: string | null; p_item: string; p_answer: number; p_page: number; p_elapsed_ms?: number },
    undefined
  >;
  wsp_page_time: Fn<{ p_token: string | null; p_assessment: string | null; p_page: number; p_elapsed_ms: number }, undefined>;
  wsp_complete: Fn<{ p_token?: string | null; p_assessment?: string | null }, string>;
  wsp_report: Fn<{ p_assessment?: string | null; p_token?: string | null; p_export?: boolean }, Json>;
  wsp_client_reports: Fn<
    Record<string, never>,
    { assessment_id: string; full_name: string; role_label: string | null; completed_at: string; consented_at: string }[]
  >;
  wsp_delete_my_profile: Fn<{ p_token?: string | null; p_assessment?: string | null }, undefined>;
  wsp_staff_delete: Fn<{ p_assessment: string }, undefined>;
  wsp_run_daily: Fn<Record<string, never>, Json>;
};
