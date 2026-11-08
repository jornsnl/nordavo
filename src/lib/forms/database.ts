// Types of the recruitment form tables
// (supabase/migrations/20261108020000_recruitment_forms.sql), merged into
// Database in src/lib/database.types.ts.

import type { Json } from "@/lib/database.types";

export type FormStatus = "draft" | "published";
export type FormRoleType = "fulltime" | "freelance";
export type FormVia = "general" | "headhunted" | "personal";

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

type To<Name extends string, Column extends string, Relation extends string, OneToOne extends boolean = false> = {
  foreignKeyName: Name;
  columns: [Column];
  isOneToOne: OneToOne;
  referencedRelation: Relation;
  referencedColumns: ["id"];
};

export type RecruitmentFormRow = {
  id: string;
  vacancy_id: string;
  title: string;
  intro: string | null;
  role_type: FormRoleType;
  status: FormStatus;
  blocks: Json;
  header_image_path: string | null;
  logo_path: string | null;
  version: number;
  published_at: string | null;
  public_token: string;
  headhunted_token: string;
  max_reminders: number;
  reminder_interval_days: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RecruitmentFormVersionRow = {
  form_id: string;
  version: number;
  title: string;
  intro: string | null;
  role_type: FormRoleType;
  blocks: Json;
  header_image_path: string | null;
  logo_path: string | null;
  published_by: string | null;
  published_at: string;
};

export type FormInviteRow = {
  id: string;
  form_id: string;
  application_id: string;
  token: string;
  sent_at: string | null;
  sent_to: string | null;
  cc: string | null;
  deadline: string | null;
  reminded_at: string | null;
  reminder_count: number;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type FormResponseRow = {
  id: string;
  form_id: string;
  form_version: number;
  vacancy_id: string;
  application_id: string;
  candidate_id: string;
  answers: Json;
  via: FormVia;
  submitted_at: string;
  created_at: string;
};

/** numeric columns arrive as numbers (or strings for very large values). */
export type ApplicationCompensationRow = {
  application_id: string;
  candidate_id: string;
  vacancy_id: string;
  role_type: FormRoleType;
  current_ctc_inr_year: number | null;
  expected_ctc_inr_year: number | null;
  asked_hourly_inr: number | null;
  negotiated_ctc_inr_year: number | null;
  negotiated_hourly_inr: number | null;
  negotiated_inr_per_eur: number | null;
  negotiated_rate_date: string | null;
  negotiated_at: string | null;
  negotiated_by: string | null;
  payslip_requested_at: string | null;
  notes: string | null;
  updated_at: string;
};

export type ExchangeRateRow = {
  id: number;
  inr_per_eur: number;
  rate_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type FormsTables = {
  recruitment_forms: Table<
    RecruitmentFormRow,
    "vacancy_id" | "title",
    [To<"recruitment_forms_vacancy_id_fkey", "vacancy_id", "vacancies", true>]
  >;
  recruitment_form_versions: Table<
    RecruitmentFormVersionRow,
    "form_id" | "version" | "title" | "role_type" | "blocks",
    [To<"recruitment_form_versions_form_id_fkey", "form_id", "recruitment_forms">]
  >;
  form_invites: Table<
    FormInviteRow,
    "form_id" | "application_id",
    [
      To<"form_invites_form_id_fkey", "form_id", "recruitment_forms">,
      To<"form_invites_application_id_fkey", "application_id", "applications", true>,
    ]
  >;
  form_responses: Table<
    FormResponseRow,
    "form_id" | "form_version" | "vacancy_id" | "application_id" | "candidate_id" | "via",
    [
      To<"form_responses_form_id_fkey", "form_id", "recruitment_forms">,
      To<"form_responses_application_id_fkey", "application_id", "applications", true>,
      To<"form_responses_candidate_id_fkey", "candidate_id", "candidates">,
    ]
  >;
  application_compensation: Table<
    ApplicationCompensationRow,
    "application_id" | "candidate_id" | "vacancy_id",
    [
      To<"application_compensation_application_id_fkey", "application_id", "applications", true>,
      To<"application_compensation_candidate_id_fkey", "candidate_id", "candidates">,
      To<"application_compensation_vacancy_id_fkey", "vacancy_id", "vacancies">,
    ]
  >;
  exchange_rates: Table<ExchangeRateRow, "inr_per_eur" | "rate_date", [To<"exchange_rates_created_by_fkey", "created_by", "profiles">]>;
};

type Fn<Args, Returns> = { Args: Args; Returns: Returns };

export type FormsFunctions = {
  publish_recruitment_form: Fn<{ p_form_id: string }, number>;
  /** Service role only. */
  submit_recruitment_form: Fn<{ p_token: string; p_payload: Json }, Json>;
  /** Service role only. */
  attach_form_cv: Fn<
    { p_response_id: string; p_question_id: string; p_path: string; p_file_name: string; p_mime_type: string; p_size: number },
    string
  >;
  /** Service role only. */
  forms_advance_application: Fn<{ p_application_id: string; p_from: string[]; p_to: string }, boolean>;
};
