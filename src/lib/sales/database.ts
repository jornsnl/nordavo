// Types of the sales CRM tables and functions
// (supabase/migrations/20261110010000_sales_crm.sql), merged into Database in
// src/lib/database.types.ts. Pure types, safe everywhere.

import type { Json } from "@/lib/database.types";

/** Lead status of a company (section 2.6). */
export type LeadStatus =
  | "new"
  | "review"
  | "ready"
  | "enrich"
  | "in_sequence"
  | "cooled_down"
  | "no_go"
  | "do_not_contact";

/** Pipeline stage of a company that showed interest (section 2.8). */
export type PipelineStage =
  | "interested"
  | "meeting_planned"
  | "meeting_held"
  | "intake_done"
  | "profiles_sent"
  | "candidate_interviews"
  | "won"
  | "lost";

export type CompanyCategory = "development" | "data_bi" | "both";
export type ContactRole = "main" | "extra" | "reserve";
export type ActivityType = "contact" | "change" | "note" | "view" | "meeting" | "reply" | "system";
export type ActivityDirection = "inbound" | "outbound";
export type ReviewStatus = "pending" | "accepted" | "rejected";

/** The buttons on the call screen, the same as the Excel (section 2.9). */
export type CallOutcome =
  | "no_answer"
  | "call_back"
  | "reached_interested"
  | "meeting_planned"
  | "reached_not_interested"
  | "referred"
  | "wrong_person"
  | "wrong_number";

export type CallerStatus = "active" | "paused" | "stopped";
export type MeetingStatus = "planned" | "held" | "approved" | "rejected" | "no_show" | "cancelled";
export type MeetingSource = "handmatig" | "calcom" | "claude" | "system";
export type SequenceStatus = "draft" | "active" | "archived";
export type SequenceChannel = "mail" | "linkedin" | "call";
export type EnrollmentStatus = "active" | "paused" | "finished" | "stopped";
export type SequenceTaskStatus = "open" | "done" | "skipped" | "cancelled";
export type SalesViewEntity = "companies" | "contacts" | "pipeline";
export type PartnerStatus = "active" | "inactive";

type Rel = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<Row, Required extends keyof Row, Relationships extends Rel[]> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: Relationships;
};

type To<Name extends string, Column extends string, Relation extends string> = {
  foreignKeyName: Name;
  columns: [Column];
  isOneToOne: false;
  referencedRelation: Relation;
  referencedColumns: ["id"];
};

export type PartnerRow = {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  notes: string | null;
  status: PartnerStatus;
  owner_id: string | null;
  last_contact_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CallerRow = {
  id: string;
  profile_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  party: string | null;
  fee_per_meeting: number;
  status: CallerStatus;
  invited_at: string | null;
  paused_at: string | null;
  stopped_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MeetingRow = {
  id: string;
  company_id: string;
  contact_id: string | null;
  caller_id: string | null;
  booked_by: string | null;
  reason: string | null;
  scheduled_at: string | null;
  status: MeetingStatus;
  fee: number;
  notes: string | null;
  decided_by: string | null;
  decided_at: string | null;
  source: MeetingSource;
  external_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SequenceRow = {
  id: string;
  name: string;
  description: string | null;
  status: SequenceStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SequenceStepRow = {
  id: string;
  sequence_id: string;
  position: number;
  day_offset: number;
  channel: SequenceChannel;
  subject: string | null;
  body: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  draft_source: "claude" | "handmatig" | null;
  draft_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SequenceEnrollmentRow = {
  id: string;
  sequence_id: string;
  company_id: string;
  contact_id: string | null;
  status: EnrollmentStatus;
  started_at: string;
  paused_at: string | null;
  pause_reason: string | null;
  started_by: string | null;
  source: "handmatig" | "claude" | "system";
  created_at: string;
  updated_at: string;
};

export type SequenceTaskRow = {
  id: string;
  enrollment_id: string;
  step_id: string;
  company_id: string;
  contact_id: string | null;
  channel: SequenceChannel;
  due_date: string;
  status: SequenceTaskStatus;
  done_at: string | null;
  external_id: string | null;
  created_at: string;
};

export type SalesViewRow = {
  id: string;
  entity: SalesViewEntity;
  name: string;
  config: Json;
  is_call_list: boolean;
  is_shared: boolean;
  position: number;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CallListCallerRow = {
  view_id: string;
  caller_id: string;
  position: number;
  open_until: string | null;
  opened_by: string | null;
  created_at: string;
};

export type SalesTables = {
  partners: Table<PartnerRow, "name", [To<"partners_owner_id_fkey", "owner_id", "profiles">]>;
  callers: Table<CallerRow, "name" | "email", [To<"callers_profile_id_fkey", "profile_id", "profiles">]>;
  meetings: Table<
    MeetingRow,
    "company_id",
    [
      To<"meetings_company_id_fkey", "company_id", "companies">,
      To<"meetings_contact_id_fkey", "contact_id", "contacts">,
      To<"meetings_caller_id_fkey", "caller_id", "callers">,
      To<"meetings_booked_by_fkey", "booked_by", "profiles">,
      To<"meetings_decided_by_fkey", "decided_by", "profiles">,
    ]
  >;
  sequences: Table<SequenceRow, "name", []>;
  sequence_steps: Table<SequenceStepRow, "sequence_id" | "channel", [To<"sequence_steps_sequence_id_fkey", "sequence_id", "sequences">]>;
  sequence_enrollments: Table<
    SequenceEnrollmentRow,
    "sequence_id" | "company_id",
    [
      To<"sequence_enrollments_sequence_id_fkey", "sequence_id", "sequences">,
      To<"sequence_enrollments_company_id_fkey", "company_id", "companies">,
      To<"sequence_enrollments_contact_id_fkey", "contact_id", "contacts">,
    ]
  >;
  sequence_tasks: Table<
    SequenceTaskRow,
    "enrollment_id" | "step_id" | "company_id" | "channel" | "due_date",
    [
      To<"sequence_tasks_enrollment_id_fkey", "enrollment_id", "sequence_enrollments">,
      To<"sequence_tasks_step_id_fkey", "step_id", "sequence_steps">,
      To<"sequence_tasks_company_id_fkey", "company_id", "companies">,
      To<"sequence_tasks_contact_id_fkey", "contact_id", "contacts">,
    ]
  >;
  sales_views: Table<SalesViewRow, "entity" | "name", []>;
  call_list_callers: Table<
    CallListCallerRow,
    "view_id" | "caller_id",
    [
      To<"call_list_callers_view_id_fkey", "view_id", "sales_views">,
      To<"call_list_callers_caller_id_fkey", "caller_id", "callers">,
    ]
  >;
};

type Fn<Args, Returns> = { Args: Args; Returns: Returns };
/** Optional p_actor: only the secret key (MCP, jobs, caller pages) may act for another user. */
type Actor = { p_actor?: string | null };

export type SalesFunctions = {
  current_caller_id: Fn<Record<string, never>, string | null>;
  caller_id_for: Fn<{ p_user: string }, string | null>;
  has_module_for: Fn<{ p_user: string; p_module: string }, boolean>;
  sales_update: Fn<
    { p_entity: "company" | "contact"; p_ids: string[]; p_fields: Json; p_source?: string } & Actor,
    number
  >;
  sales_log_activity: Fn<
    {
      p_company: string | null;
      p_contact: string | null;
      p_channel: string;
      p_type: ActivityType;
      p_outcome?: string | null;
      p_notes?: string | null;
      p_direction?: ActivityDirection | null;
      p_date?: string | null;
      p_source?: string;
      p_external_id?: string | null;
      p_partner?: string | null;
      p_review?: boolean;
      p_suggestion?: Json | null;
    } & Actor,
    string | null
  >;
  sales_decide_reply: Fn<{ p_activity: string; p_accept: boolean; p_apply?: Json } & Actor, undefined>;
  sales_save_meeting: Fn<
    {
      p_company: string | null;
      p_contact?: string | null;
      p_caller?: string | null;
      p_scheduled_at?: string | null;
      p_reason?: string | null;
      p_external_id?: string | null;
      p_source?: string;
    } & Actor,
    string
  >;
  sales_set_positions: Fn<
    { p_entity: "company" | "contact"; p_ids: string[]; p_positions: number[] } & Actor,
    number
  >;
  sales_claim_contact: Fn<{ p_contact: string } & Actor, boolean>;
  sales_release_contact: Fn<{ p_contact: string } & Actor, undefined>;
  sales_log_call: Fn<
    {
      p_contact: string;
      p_outcome: CallOutcome;
      p_callback_at?: string | null;
      p_referred_name?: string | null;
      p_referred_title?: string | null;
      p_referred_phone?: string | null;
      p_note?: string | null;
    } & Actor,
    { attempts: number; status: string; new_contact_id: string | null; meeting_id: string | null }
  >;
  sales_start_sequence: Fn<
    { p_sequence: string; p_company: string; p_contact?: string | null; p_start?: string | null; p_source?: string } & Actor,
    string
  >;
  /** Pause, resume or stop one enrollment (20261110040000_sales_sequences_claude.sql). */
  sales_set_enrollment: Fn<
    { p_enrollment: string; p_status: "active" | "paused" | "stopped"; p_reason?: string | null; p_source?: string } & Actor,
    EnrollmentStatus
  >;
  /** Pause a company after a reply: enrollments paused, open call steps cancelled. */
  sales_pause: Fn<
    { p_company: string; p_reason?: string | null; p_source?: string } & Actor,
    { enrollments_paused: number; call_steps_cancelled: number }
  >;
};
