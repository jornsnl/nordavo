// Types of the Leads and Contacts functions (migrations
// 20261123300000_leads_performance_signals.sql, 20261123310000_leads_links_roles.sql
// and 20261123320000_leads_duplicates_merge.sql), merged into Database in
// src/lib/database.types.ts. Pure types, safe everywhere.

import type { Json } from "@/lib/database.types";

type Fn<Args, Returns> = { Args: Args; Returns: Returns };
/** Optional p_actor: only the secret key (MCP, jobs) may act for another user. */
type Actor = { p_actor?: string | null };

/** One open vacancy (signal of type vacature, not closed) as sales_company_facts returns it. */
export type FactsVacancy = {
  id: string;
  title: string;
  url: string | null;
  source: string;
  /** YYYY-MM-DD: posted_at, else the day we first saw it. */
  onlineSince: string;
  postedAt: string | null;
};

export type CompanyFactsRow = {
  company_id: string;
  contacts_count: number;
  primary_contact: {
    id: string;
    name: string | null;
    title: string | null;
    phone: string | null;
    email: string | null;
    linkedinUrl: string | null;
  } | null;
  last_activity_at: string | null;
  last_activity: string | null;
  signals_count: number;
  open_vacancies: FactsVacancy[];
};

export type MergeResult = {
  kept: string;
  merged: string;
  filled_in: string[];
  contacts_moved?: number;
  references_moved: number;
  removed_as_duplicate: number;
};

export type LeadsFunctions = {
  sales_company_facts: Fn<Record<string, never>, CompanyFactsRow[]>;
  sales_similar_companies: Fn<
    { p_name: string; p_domain?: string | null; p_exclude?: string | null },
    { id: string; name: string; domain: string; lead_status: string; reason: string }[]
  >;
  sales_merge_companies: Fn<{ p_keep: string; p_merge: string; p_source?: string } & Actor, Json>;
  sales_merge_contacts: Fn<{ p_keep: string; p_merge: string; p_source?: string } & Actor, Json>;
  sales_set_contact_linkedin: Fn<
    { p_contact: string; p_linkedin_url?: string | null; p_member_urn?: string | null; p_source?: string } & Actor,
    Json
  >;
  sales_extract_lead_notes: Fn<{ p_text: string }, Json>;
  linkedin_clean_url: Fn<{ p_value: string }, string | null>;
};
