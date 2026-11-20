// Types of the tables and functions of the leadregels
// (supabase/migrations/20261126000000_leadregels.sql), merged into Database in
// src/lib/database.types.ts. Pure types, safe everywhere.

import type { Json } from "@/lib/database.types";

type Fn<Args, Returns> = { Args: Args; Returns: Returns };
type Actor = { p_actor?: string | null };

export type SignalPointRow = {
  type: string;
  label: string;
  description: string | null;
  points: number;
  active: boolean;
  derived: boolean;
  valid_days: number | null;
  position: number;
  updated_by: string | null;
  updated_at: string;
};

export type ScoreGroupRow = {
  key: "90_100" | "80_89" | "60_79" | "50_59" | "lt_50";
  label: string;
  min_score: number;
  max_score: number;
  approach: string | null;
  position: number;
  updated_by: string | null;
  updated_at: string;
};

/** One answer of sales_check_outreach(). */
export type OutreachCheck = {
  input: string;
  allowed: boolean;
  company_id: string | null;
  company: string | null;
  contact_id?: string | null;
  lead_status?: string | null;
  reasons: string[];
};

export type LeadregelsTables = {
  sales_signal_points: {
    Row: SignalPointRow;
    Insert: Partial<SignalPointRow> & Pick<SignalPointRow, "type" | "label" | "points">;
    Update: Partial<Pick<SignalPointRow, "points" | "active" | "label" | "description" | "valid_days" | "updated_by" | "updated_at">>;
    Relationships: [];
  };
  sales_score_groups: {
    Row: ScoreGroupRow;
    Insert: Partial<ScoreGroupRow> & Pick<ScoreGroupRow, "key" | "label" | "min_score" | "max_score">;
    Update: Partial<Pick<ScoreGroupRow, "approach" | "updated_by" | "updated_at">>;
    Relationships: [];
  };
};

export type LeadregelsFunctions = {
  sales_company_score: Fn<{ p_company: string }, Json>;
  sales_check_outreach: Fn<{ p_items: string[] } & Actor, OutreachCheck[]>;
  sales_apply_contact_order: Fn<{ p_company: string; p_source?: string } & Actor, string[] | null>;
  sales_default_contact_order: Fn<{ p_company: string }, string[]>;
  sales_daily_tick: Fn<Record<string, never>, Json>;
  sales_refresh_scores: Fn<{ p_ids?: string[] | null }, number>;
};
