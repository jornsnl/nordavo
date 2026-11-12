// Types of the triage, occupancy, campaigns, choice lists, own columns and
// telephony of the sales CRM (supabase/migrations/20261123400000 to
// 20261123450000), merged into Database in src/lib/database.types.ts. Pure
// types, safe everywhere.

import type { Json } from "@/lib/database.types";

/** Where a lead is: exactly one bucket or flow (20261123400000_sales_triage_occupancy.sql). */
export type SalesBucket =
  | "incoming"
  | "find_number"
  | "call"
  | "mail_campaign"
  | "linkedin_campaign"
  | "sequence"
  | "pipeline"
  | "parked"
  | "no_go"
  | "free";

/** The destinations a person can pick in triage. */
export type TriageDestination = "incoming" | "find_number" | "call" | "mail_campaign" | "linkedin_campaign" | "parked" | "no_go" | "free";

export type CampaignProvider = "instantly" | "seleqt" | "portal" | "other";
export type CampaignStatus = "draft" | "active" | "paused" | "finished";
export type CampaignMemberStatus = "queued" | "active" | "replied" | "finished" | "stopped" | "bounced" | "unsubscribed";
export type ChoiceListKey = "prio" | "category" | "lead_status" | "contact_status" | "call_outcome";

export type CampaignMemberRow = {
  id: string;
  campaign_id: string;
  company_id: string;
  contact_id: string | null;
  status: CampaignMemberStatus;
  added_at: string;
  ended_at: string | null;
  replied_at: string | null;
  reply_outcome: string | null;
  external_id: string | null;
  source: string;
  added_by: string | null;
  updated_at: string;
};

export type ChoiceOptionRow = {
  list_key: ChoiceListKey;
  value: string;
  label: string;
  description: string | null;
  position: number;
  hidden: boolean;
  builtin: boolean;
  tone: "neutral" | "brand" | "accent" | "success" | "warning" | "danger" | null;
  updated_by: string | null;
  updated_at: string;
};

export type OccupancyRow = {
  company_id: string;
  contact_id: string | null;
  kind: "campaign" | "sequence" | "caller" | "call_list";
  channel: string;
  provider: string;
  label: string;
  ref_id: string | null;
  since: string;
  until: string | null;
  replied_at: string | null;
  status: string;
  active: boolean;
};

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

export type SalesFlowTables = {
  campaign_members: Table<
    CampaignMemberRow,
    "campaign_id" | "company_id",
    [
      To<"campaign_members_campaign_id_fkey", "campaign_id", "campaigns">,
      To<"campaign_members_company_id_fkey", "company_id", "companies">,
      To<"campaign_members_contact_id_fkey", "contact_id", "contacts">,
    ]
  >;
  sales_choice_options: Table<ChoiceOptionRow, "list_key" | "value" | "label", []>;
};

export type SalesFlowViews = {
  sales_occupancy: { Row: OccupancyRow; Relationships: [] };
};

type Fn<Args, Returns> = { Args: Args; Returns: Returns };
type Actor = { p_actor?: string | null };

export type TriageResult = { moved: number; skipped: { id: string; name: string; reason: string }[] };
export type RegisterMembersResult = {
  added: number;
  updated: number;
  unknown: string[];
  refused: { company_id: string; reason: string }[];
};

export type SalesFlowFunctions = {
  sales_triage: Fn<
    { p_companies: string[]; p_destination: TriageDestination; p_options?: Json; p_source?: string } & Actor,
    TriageResult
  >;
  sales_register_campaign_members: Fn<
    { p_campaign: string; p_members: Json; p_force?: boolean; p_source?: string } & Actor,
    RegisterMembersResult
  >;
  sales_running_campaign: Fn<{ p_company: string; p_except?: string | null }, string | null>;
  sales_update_more: Fn<{ p_entity: "company"; p_ids: string[]; p_fields: Json; p_source?: string } & Actor, number>;
  sales_set_custom_field: Fn<
    { p_entity: "company" | "contact"; p_ids: string[]; p_key: string; p_value: Json | null; p_source?: string } & Actor,
    number
  >;
  sales_is_dev_data_title: Fn<{ p_title: string | null }, boolean>;
  sales_find_phone: Fn<{ p_phone: string }, { contact_id: string | null; company_id: string }[]>;
  sales_log_phone_call: Fn<
    {
      p_external_id: string;
      p_phone: string;
      p_direction: string;
      p_started_at: string | null;
      p_duration: number | null;
      p_recording_url: string | null;
      p_answered: boolean | null;
      p_agent_email?: string | null;
      p_notes?: string | null;
    },
    string | null
  >;
};
