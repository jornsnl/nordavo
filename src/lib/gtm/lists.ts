import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import type { Database, Json, ListExportType, Segment, SignalType, SuppressionScope } from "@/lib/database.types";
import { optionFor, segments, signalTypes } from "@/lib/labels";

/**
 * Exports to files and the export history (list_exports). The Lists page,
 * the call list for Web Partners (S6) and the mail campaigns in Instantly
 * (S7) are gone: call lists are saved views of the Contacts table now, worked
 * on the call screen, and sequences replace the campaigns (docs/sales.md).
 * What stays is shared by the Max export on Contacts, Enrich
 * (src/lib/gtm/max.ts), the history of earlier exports and the syncs:
 * filters as stored in list_exports, CSV helpers and the suppression check.
 */

type Db = SupabaseClient<Database>;

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 1000;

export type ListDefinition = {
  type: ListExportType;
  label: string;
  description: string;
  channel: "bellen" | "mail" | null;
};

export const listDefinitions: Record<ListExportType, ListDefinition> = {
  bellijst: {
    type: "bellijst",
    label: "Call list",
    description: "Call list for Web Partners as a sheet or CSV, before the call screen. Only in the history now.",
    channel: "bellen",
  },
  mailcampagne: {
    type: "mailcampagne",
    label: "Mail campaign",
    description: "Mail campaign in Instantly, one per signal, before sequences. Only in the history now.",
    channel: "mail",
  },
  max_verrijking: {
    type: "max_verrijking",
    label: "Max enrichment",
    description: "Contacts in Enrich with LinkedIn and without a phone number, not suppressed. CSV for Max.",
    channel: null,
  },
};

export const listTypes = Object.keys(listDefinitions) as ListExportType[];

export function isListType(value: unknown): value is ListExportType {
  return typeof value === "string" && value in listDefinitions;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type ListFilter = {
  segment?: Segment;
  signalType?: SignalType;
  tier?: 1 | 2 | 3;
  minScore?: number;
  limit: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function first(params: RawParams, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params[key];
    const text = Array.isArray(value) ? value[0] : value;
    if (text !== undefined && text.trim() !== "") return text.trim();
  }
  return undefined;
}

/** Read a filter from job params or search params. Invalid values are ignored, the limit is capped. */
export function parseListFilter(params: RawParams, defaultLimit = DEFAULT_LIMIT): ListFilter {
  const filter: ListFilter = { limit: defaultLimit };
  const segment = first(params, "segment");
  if (segment && segments.some((s) => s.value === segment)) filter.segment = segment as Segment;
  const signal = first(params, "signal", "signal_type", "signalType");
  if (signal && signalTypes.some((s) => s.value === signal)) filter.signalType = signal as SignalType;
  const tier = Number(first(params, "tier"));
  if (tier === 1 || tier === 2 || tier === 3) filter.tier = tier;
  const minScore = Number(first(params, "min_score", "minScore"));
  if (Number.isFinite(minScore) && minScore > 0) filter.minScore = Math.min(100, Math.round(minScore));
  const limit = Number(first(params, "limit"));
  if (Number.isFinite(limit) && limit > 0) filter.limit = Math.min(MAX_LIMIT, Math.round(limit));
  return filter;
}

/** The filter as stored in list_exports.filter_used. */
export function filterToJson(filter: ListFilter, extra: Record<string, Json> = {}): Json {
  const json: Record<string, Json> = { limit: filter.limit };
  if (filter.segment) json.segment = filter.segment;
  if (filter.signalType) json.signal_type = filter.signalType;
  if (filter.tier) json.tier = filter.tier;
  if (filter.minScore) json.min_score = filter.minScore;
  return { ...json, ...extra };
}

/** "SaaS, Vacancy, tier 1, score 60+, max 200" for the export history. */
export function filterSummary(filterUsed: Json | null | undefined): string {
  if (!filterUsed || typeof filterUsed !== "object" || Array.isArray(filterUsed)) return "No filter";
  const f = filterUsed as Record<string, Json | undefined>;
  const parts: string[] = [];
  if (typeof f.segment === "string") parts.push(optionFor(segments, f.segment as Segment).label);
  if (typeof f.signal_type === "string") parts.push(optionFor(signalTypes, f.signal_type as SignalType).label);
  if (typeof f.tier === "number") parts.push(`tier ${f.tier}`);
  if (typeof f.min_score === "number") parts.push(`score ${f.min_score}+`);
  if (typeof f.limit === "number") parts.push(`max ${f.limit}`);
  return parts.length > 0 ? parts.join(", ") : "No filter";
}

// ---------------------------------------------------------------------------
// Pure helpers for rows and files
// ---------------------------------------------------------------------------

/** Stored LinkedIn URLs are normalised ("linkedin.com/in/x"); files get a full URL. */
export function linkedinUrl(value: string | null | undefined): string {
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://www.${value}`;
}

export function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim();
}

/** Cells that a spreadsheet would run as a formula get a leading quote. Phone numbers (+31) stay as they are. */
export function safeCsvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /^[=@\t\r]/.test(text) || /^-[^\d]/.test(text) ? `'${text}` : text;
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  return Papa.unparse({ fields: header, data: rows.map((row) => header.map((_, i) => safeCsvCell(row[i]))) }, { newline: "\r\n" });
}

export type SuppressionRow = { contact_id: string | null; company_id: string | null; email: string | null; scope: SuppressionScope };

/** Same logic as public.is_suppressed, for lists that do not come from a view (Max). */
export function isSuppressedFor(
  target: { contactId: string; companyId: string; email: string | null },
  rows: SuppressionRow[],
  channel: "bellen" | "mail",
): boolean {
  const email = target.email?.toLowerCase() ?? null;
  return rows.some(
    (s) =>
      (s.contact_id === target.contactId || s.company_id === target.companyId || (s.email !== null && email !== null && s.email.toLowerCase() === email)) &&
      (s.scope === "alle_kanalen" || (s.scope === "alleen_bellen" && channel === "bellen") || (s.scope === "alleen_mail" && channel === "mail")),
  );
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type MaxCandidate = {
  contact_id: string;
  company_id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  tier: number | null;
  linkedin_url: string;
  email: string | null;
  company_name: string;
  domain: string;
  website: string | null;
  company_linkedin: string | null;
  segment: Segment | null;
  icp_score: number | null;
  legal_form: string | null;
};

export async function loadSuppressions(db: Db): Promise<SuppressionRow[]> {
  const rows: SuppressionRow[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await db
      .from("suppression")
      .select("contact_id, company_id, email, scope")
      .order("created_at")
      .range(from, from + 999);
    if (error) throw new Error(`Could not load suppressions: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Writing: list_exports
// ---------------------------------------------------------------------------

export async function recordListExport(
  db: Db,
  input: {
    type: ListExportType;
    filter: ListFilter;
    extra?: Record<string, Json>;
    recordIds: string[];
    destination: string | null;
    campaignId?: string | null;
    createdBy?: string | null;
  },
): Promise<string> {
  const { data, error } = await db
    .from("list_exports")
    .insert({
      type: input.type,
      filter_used: filterToJson(input.filter, input.extra),
      record_ids: input.recordIds,
      record_count: input.recordIds.length,
      destination: input.destination,
      campaign_id: input.campaignId ?? null,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not record the export: ${error.message}`);
  return data.id;
}
