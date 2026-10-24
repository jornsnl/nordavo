import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import type {
  CallListCandidate,
  Database,
  Json,
  ListExportType,
  MailListCandidate,
  Segment,
  SignalType,
  SuppressionScope,
} from "@/lib/database.types";
import { askJson, ClaudeRefusalError, hasClaude } from "@/lib/ai/claude";
import { checkOpeningLine, OPENING_LINE_SYSTEM, openingLineInput, openingLineSchema } from "@/lib/ai/prompts/opening-line";
import { createSheet, webPartnersShareWith } from "@/lib/integrations/google-sheets";
import { addLeadToCampaign, findOrCreateCampaign, hasInstantly } from "@/lib/integrations/instantly";
import { optionFor, segments, signalTypes } from "@/lib/labels";
import { isExcludedFromCalling } from "./normalize";

/**
 * Lists are saved filters, not loose files (hard rule 6). Each list type is
 * defined here once and used by the jobs (S5, S6, S7) and the Lijsten page.
 *
 * Hard rule 4: call and mail lists read from the views call_list_candidates
 * and mail_list_candidates, which already apply is_contactable (suppression
 * plus the 30-day rule). Right before anything is written the selected ids are
 * checked against the view again, because time passes between preview and
 * export (and between contacts within one run).
 * Hard rule 5: the call list view excludes eenmanszaak and vof; the code
 * checks the company's legal form again with isExcludedFromCalling.
 *
 * Approach logging (the 30-day rule starts counting here):
 *   - Call list: every contact on an exported call list gets an activity
 *     "verstuurd" on channel bellen with the list id in the notes. Handing a
 *     number to Web Partners is the moment of approach we control; the actual
 *     call outcome comes in later through S8 (Web Partners sheet). Without
 *     this, the same contact could be mailed while Web Partners is calling.
 *   - Mail: "verstuurd" on channel mail only after Instantly accepted the lead.
 *   - Max enrichment is not an approach: no activity, no status change.
 */

type Db = SupabaseClient<Database>;

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 1000;
export const PREVIEW_ROWS = 25;

export type ListDefinition = {
  type: ListExportType;
  label: string;
  description: string;
  channel: "bellen" | "mail" | null;
};

export const listDefinitions: Record<ListExportType, ListDefinition> = {
  bellijst: {
    type: "bellijst",
    label: "Bellijst",
    description: "GO, mobiel nummer, geen eenmanszaak of vof, niet uitgesloten en 30 dagen niet benaderd.",
    channel: "bellen",
  },
  mailcampagne: {
    type: "mailcampagne",
    label: "Mailcampagne",
    description: "GO, geverifieerd mailadres, niet uitgesloten en 30 dagen niet benaderd. Eén campagne per signaal.",
    channel: "mail",
  },
  max_verrijking: {
    type: "max_verrijking",
    label: "Max verrijking",
    description: "GO contacten met LinkedIn en zonder telefoonnummer, niet uitgesloten. CSV voor Max.",
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

/** "SaaS, Vacature, tier 1, score 60+, max 200" for the export history. */
export function filterSummary(filterUsed: Json | null | undefined): string {
  if (!filterUsed || typeof filterUsed !== "object" || Array.isArray(filterUsed)) return "Geen filter";
  const f = filterUsed as Record<string, Json | undefined>;
  const parts: string[] = [];
  if (typeof f.segment === "string") parts.push(optionFor(segments, f.segment as Segment).label);
  if (typeof f.signal_type === "string") parts.push(optionFor(signalTypes, f.signal_type as SignalType).label);
  if (typeof f.tier === "number") parts.push(`tier ${f.tier}`);
  if (typeof f.min_score === "number") parts.push(`score ${f.min_score}+`);
  if (typeof f.limit === "number") parts.push(`max ${f.limit}`);
  return parts.length > 0 ? parts.join(", ") : "Geen filter";
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

/** A short reason to call: the company's opening line, else one built from the signal. */
export function callReason(c: { opening_line: string | null; signal_type: string | null; signal_title: string | null }): string {
  if (c.opening_line?.trim()) return c.opening_line.trim();
  const title = c.signal_title?.trim();
  switch (c.signal_type) {
    case "vacature":
      return title ? `Heeft een vacature open: ${title}.` : "Heeft een developer of data vacature open.";
    case "lang_open":
      return title ? `Vacature staat al lang open: ${title}.` : "Heeft een vacature die al lang open staat.";
    case "meerdere_rollen":
      return title ? `Meerdere techrollen open, onder andere ${title}.` : "Heeft meerdere techrollen open.";
    case "remote_extern":
      return title ? `Vacature noemt remote of een extern team: ${title}.` : "Staat open voor remote of een extern team.";
    case "freelance":
      return title ? `Zoekt een freelancer: ${title}.` : "Zoekt een freelance developer.";
    case "funding":
      return "Heeft recent funding opgehaald.";
    case "nieuwe_cto":
      return "Heeft een nieuwe CTO of Head of Engineering.";
    default:
      return title ? `Signaal: ${title}.` : "Past bij ons ICP.";
  }
}

export const CALL_SHEET_HEADER = ["Bedrijf", "Contact", "Functie", "Telefoon", "Signaal", "Reden om te bellen", "Domein", "LinkedIn"];

export function buildCallSheetRows(
  candidates: Pick<
    CallListCandidate,
    "company_name" | "first_name" | "last_name" | "title" | "phone" | "signal_type" | "signal_title" | "opening_line" | "domain" | "linkedin_url"
  >[],
): string[][] {
  return candidates.map((c) => [
    c.company_name,
    fullName(c.first_name, c.last_name),
    c.title ?? "",
    c.phone,
    [c.signal_type ? optionFor(signalTypes, c.signal_type).label : "", c.signal_title ?? ""].filter(Boolean).join(": "),
    callReason(c),
    c.domain,
    linkedinUrl(c.linkedin_url),
  ]);
}

/** Cells that a spreadsheet would run as a formula get a leading quote. Phone numbers (+31) stay as they are. */
export function safeCsvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /^[=@\t\r]/.test(text) || /^-[^\d]/.test(text) ? `'${text}` : text;
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  return Papa.unparse({ fields: header, data: rows.map((row) => header.map((_, i) => safeCsvCell(row[i]))) }, { newline: "\r\n" });
}

/** Contacts grouped per signal type; contacts without a signal are returned apart. */
export function groupBySignalType<T extends { signal_type: SignalType | null }>(rows: T[]): { groups: Map<SignalType, T[]>; withoutSignal: T[] } {
  const groups = new Map<SignalType, T[]>();
  const withoutSignal: T[] = [];
  for (const row of rows) {
    if (!row.signal_type) {
      withoutSignal.push(row);
      continue;
    }
    const list = groups.get(row.signal_type) ?? [];
    list.push(row);
    groups.set(row.signal_type, list);
  }
  return { groups, withoutSignal };
}

/**
 * Is the company's stored opening line (written by S2 from the vacancy text)
 * based on this signal? Yes for a plain vacancy signal, or when the line names
 * the signal's title. Otherwise S7 writes a new one for this signal.
 */
export function openingLineMatchesSignal(line: string | null, signalType: string | null, signalTitle: string | null): boolean {
  if (!line?.trim()) return false;
  if (signalType === "vacature") return true;
  const words = (signalTitle ?? "")
    .toLowerCase()
    .split(/[^a-z0-9à-ÿ+#.]+/)
    .filter((w) => w.length >= 4);
  const text = line.toLowerCase();
  return words.some((w) => text.includes(w));
}

export function campaignName(signalType: SignalType, segment: Segment | null, variant: string): string {
  return [
    "Nordavo",
    optionFor(signalTypes, signalType).label,
    segment ? optionFor(segments, segment).label : "Alle segmenten",
    variant,
  ].join(" · ");
}

export type CampaignVerdict = { rate: number | null; verdict: "te_vroeg" | "herschrijven" | "doorgaan" | "opschalen"; label: string };

export const EVALUATE_AFTER = 150;

/** Briefing rule: one signal per campaign, evaluate after 150 mails. Under 3% rewrite or stop, above 5% scale up. */
export function evaluateCampaign(sent: number, replies: number): CampaignVerdict {
  const rate = sent > 0 ? replies / sent : null;
  if (sent < EVALUATE_AFTER) return { rate, verdict: "te_vroeg", label: `Nog ${EVALUATE_AFTER - sent} mails tot evaluatie` };
  if ((rate ?? 0) < 0.03) return { rate, verdict: "herschrijven", label: "Herschrijven of stoppen" };
  if ((rate ?? 0) > 0.05) return { rate, verdict: "opschalen", label: "Opschalen" };
  return { rate, verdict: "doorgaan", label: "Doorgaan en blijven meten" };
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

export type CallCandidate = CallListCandidate & { legal_form: string | null };
export type MailCandidate = MailListCandidate;

async function legalForms(db: Db, companyIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  for (const ids of chunk([...new Set(companyIds)], 100)) {
    const { data, error } = await db.from("companies").select("id, legal_form").in("id", ids);
    if (error) throw new Error(`Rechtsvormen laden mislukt: ${error.message}`);
    for (const row of data) map.set(row.id, row.legal_form);
  }
  return map;
}

async function queryCallView(db: Db, filter: ListFilter, limit: number, contactIds?: string[]) {
  let query = db.from("call_list_candidates").select("*", { count: "exact" });
  if (contactIds) query = query.in("contact_id", contactIds);
  if (filter.segment) query = query.eq("segment", filter.segment);
  if (filter.signalType) query = query.eq("signal_type", filter.signalType);
  if (filter.tier) query = query.eq("tier", filter.tier);
  if (filter.minScore) query = query.gte("icp_score", filter.minScore);
  const { data, error, count } = await query
    .order("icp_score", { ascending: false, nullsFirst: false })
    .order("tier", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`Bellijst laden mislukt: ${error.message}`);
  return { rows: data, count: count ?? data.length };
}

async function queryMailView(db: Db, filter: ListFilter, limit: number, contactIds?: string[]) {
  let query = db.from("mail_list_candidates").select("*", { count: "exact" });
  if (contactIds) query = query.in("contact_id", contactIds);
  if (filter.segment) query = query.eq("segment", filter.segment);
  if (filter.signalType) query = query.eq("signal_type", filter.signalType);
  if (filter.tier) query = query.eq("tier", filter.tier);
  if (filter.minScore) query = query.gte("icp_score", filter.minScore);
  const { data, error, count } = await query
    .order("icp_score", { ascending: false, nullsFirst: false })
    .order("tier", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`Maillijst laden mislukt: ${error.message}`);
  return { rows: data, count: count ?? data.length };
}

/** Call list candidates, with the legal form checked again in code (rule 5). */
export async function fetchCallCandidates(db: Db, filter: ListFilter): Promise<CallCandidate[]> {
  const { rows } = await queryCallView(db, filter, filter.limit);
  const forms = await legalForms(db, rows.map((r) => r.company_id));
  return rows
    .map((r) => ({ ...r, legal_form: forms.get(r.company_id) ?? null }))
    .filter((r) => !isExcludedFromCalling(r.legal_form));
}

export async function fetchMailCandidates(db: Db, filter: ListFilter): Promise<MailCandidate[]> {
  const { rows } = await queryMailView(db, filter, filter.limit);
  return rows;
}

/** Ids from `contactIds` that are still in the view right now (rule 4 re-check). */
export async function recheckContactable(db: Db, list: "bellijst" | "mailcampagne", contactIds: string[]): Promise<Set<string>> {
  const ok = new Set<string>();
  const view = list === "bellijst" ? "call_list_candidates" : "mail_list_candidates";
  for (const ids of chunk(contactIds, 100)) {
    const { data, error } = await db.from(view).select("contact_id").in("contact_id", ids);
    if (error) throw new Error(`Controle op uitsluiting mislukt: ${error.message}`);
    for (const row of data) ok.add(row.contact_id);
  }
  return ok;
}

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
    if (error) throw new Error(`Uitsluitingen laden mislukt: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

/**
 * S5: GO contacts with a LinkedIn URL and no phone, not suppressed for calls.
 * Companies we may never call (eenmanszaak, vof) are left out too: their
 * numbers would only cost money at Max.
 */
export async function fetchMaxCandidates(db: Db, filter: ListFilter): Promise<MaxCandidate[]> {
  let query = db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, title, tier, linkedin_url, email, company:companies!inner(name, domain, website, linkedin_url, legal_form, segment, icp_score, icp_decision)",
    )
    .is("phone", null)
    .not("linkedin_url", "is", null)
    .not("status", "in", "(klant,verloren,uitgesloten,kans,afspraak)")
    .eq("company.icp_decision", "GO");
  if (filter.segment) query = query.eq("company.segment", filter.segment);
  if (filter.minScore) query = query.gte("company.icp_score", filter.minScore);
  if (filter.tier) query = query.eq("tier", filter.tier);
  const { data, error } = await query.order("tier", { ascending: true, nullsFirst: false }).limit(MAX_LIMIT);
  if (error) throw new Error(`Max lijst laden mislukt: ${error.message}`);

  const suppressions = await loadSuppressions(db);
  const rows: MaxCandidate[] = [];
  for (const c of data) {
    const company = Array.isArray(c.company) ? c.company[0] : c.company;
    if (!company || !c.linkedin_url) continue;
    if (isExcludedFromCalling(company.legal_form)) continue;
    if (isSuppressedFor({ contactId: c.id, companyId: c.company_id, email: c.email }, suppressions, "bellen")) continue;
    rows.push({
      contact_id: c.id,
      company_id: c.company_id,
      first_name: c.first_name,
      last_name: c.last_name,
      title: c.title,
      tier: c.tier,
      linkedin_url: c.linkedin_url,
      email: c.email,
      company_name: company.name,
      domain: company.domain,
      website: company.website,
      company_linkedin: company.linkedin_url,
      segment: company.segment,
      icp_score: company.icp_score,
      legal_form: company.legal_form,
    });
  }
  rows.sort((a, b) => (b.icp_score ?? -1) - (a.icp_score ?? -1) || (a.tier ?? 9) - (b.tier ?? 9));
  return rows.slice(0, filter.limit);
}

// ---------------------------------------------------------------------------
// Preview (UI)
// ---------------------------------------------------------------------------

export type PreviewRow = {
  contactId: string;
  companyId: string;
  name: string;
  title: string | null;
  tier: number | null;
  companyName: string;
  domain: string;
  segment: Segment | null;
  score: number | null;
  signalType: SignalType | null;
  signalTitle: string | null;
  /** Phone, email or LinkedIn, depending on the list. */
  reach: string;
};

export type ListPreview = { count: number; capped: boolean; rows: PreviewRow[] };

export async function previewList(db: Db, type: ListExportType, filter: ListFilter): Promise<ListPreview> {
  if (type === "max_verrijking") {
    const rows = await fetchMaxCandidates(db, { ...filter, limit: MAX_LIMIT });
    return {
      count: rows.length,
      capped: rows.length >= MAX_LIMIT,
      rows: rows.slice(0, PREVIEW_ROWS).map((r) => ({
        contactId: r.contact_id,
        companyId: r.company_id,
        name: fullName(r.first_name, r.last_name),
        title: r.title,
        tier: r.tier,
        companyName: r.company_name,
        domain: r.domain,
        segment: r.segment,
        score: r.icp_score,
        signalType: null,
        signalTitle: null,
        reach: linkedinUrl(r.linkedin_url),
      })),
    };
  }
  const { rows, count } =
    type === "bellijst" ? await queryCallView(db, filter, PREVIEW_ROWS) : await queryMailView(db, filter, PREVIEW_ROWS);
  return {
    count,
    capped: false,
    rows: rows.map((r) => ({
      contactId: r.contact_id,
      companyId: r.company_id,
      name: fullName(r.first_name, r.last_name),
      title: r.title,
      tier: r.tier,
      companyName: r.company_name,
      domain: r.domain,
      segment: r.segment,
      score: r.icp_score,
      signalType: r.signal_type,
      signalTitle: r.signal_title,
      reach: "phone" in r ? r.phone : r.email,
    })),
  };
}

/** Counts for the list cards. */
export async function listCounts(db: Db, filter: ListFilter): Promise<Record<ListExportType, { count: number; capped: boolean }>> {
  const [call, mail, max] = await Promise.all([
    queryCallView(db, filter, 1),
    queryMailView(db, filter, 1),
    fetchMaxCandidates(db, { ...filter, limit: MAX_LIMIT }),
  ]);
  return {
    bellijst: { count: call.count, capped: false },
    mailcampagne: { count: mail.count, capped: false },
    max_verrijking: { count: max.length, capped: max.length >= MAX_LIMIT },
  };
}

// ---------------------------------------------------------------------------
// Writing: list_exports, statuses and activities
// ---------------------------------------------------------------------------

type Log = (message: string) => void;

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
  if (error) throw new Error(`Export vastleggen mislukt: ${error.message}`);
  return data.id;
}

async function setContactStatus(db: Db, contactIds: string[], status: "op_bellijst" | "in_mailcampagne") {
  for (const ids of chunk(contactIds, 100)) {
    const { error } = await db
      .from("contacts")
      .update({ status })
      .in("id", ids)
      .not("status", "in", "(bereikt,afspraak,kans,klant,verloren,uitgesloten)");
    if (error) throw new Error(`Status bijwerken mislukt: ${error.message}`);
  }
}

export type CallListExport = {
  exportId: string | null;
  count: number;
  /** Dropped by the re-check right before writing. */
  dropped: number;
  destination: string | null;
  csv: string | null;
};

/**
 * S6: build the call list for Web Partners. With `deliver: "sheet"` a Google
 * Sheet is created and shared with WEBPARTNERS_SHARE_WITH; with "csv" the
 * file is returned for download. Nothing is written when delivery fails.
 */
export async function exportCallList(
  db: Db,
  { filter, deliver, createdBy = null, log = () => {} }: { filter: ListFilter; deliver: "sheet" | "csv"; createdBy?: string | null; log?: Log },
): Promise<CallListExport> {
  const candidates = await fetchCallCandidates(db, filter);
  log(`${candidates.length} kandidaten voor de bellijst.`);
  if (candidates.length === 0) return { exportId: null, count: 0, dropped: 0, destination: null, csv: null };

  const stillOk = await recheckContactable(db, "bellijst", candidates.map((c) => c.contact_id));
  const rows = candidates.filter((c) => stillOk.has(c.contact_id) && !isExcludedFromCalling(c.legal_form));
  const dropped = candidates.length - rows.length;
  if (dropped > 0) log(`${dropped} contacten vielen af bij de laatste controle.`);
  if (rows.length === 0) return { exportId: null, count: 0, dropped, destination: null, csv: null };

  const sheetRows = buildCallSheetRows(rows);
  const date = new Date().toISOString().slice(0, 10);
  let destination: string | null = null;
  let csv: string | null = null;
  if (deliver === "sheet") {
    const sheet = await createSheet({
      title: `Nordavo bellijst ${date}`,
      header: CALL_SHEET_HEADER,
      rows: sheetRows,
      shareWith: webPartnersShareWith(),
    });
    destination = sheet.url;
    log(`Google Sheet gemaakt: ${sheet.url}`);
  } else {
    csv = toCsv(CALL_SHEET_HEADER, sheetRows);
    destination = `csv:nordavo-bellijst-${date}.csv`;
  }

  const contactIds = rows.map((r) => r.contact_id);
  const exportId = await recordListExport(db, {
    type: "bellijst",
    filter,
    extra: { deliver },
    recordIds: contactIds,
    destination,
    createdBy,
  });

  await setContactStatus(db, contactIds, "op_bellijst");
  for (const batch of chunk(rows, 200)) {
    const { error } = await db.from("activities").upsert(
      batch.map((r) => ({
        contact_id: r.contact_id,
        company_id: r.company_id,
        channel: "bellen" as const,
        signal_id: r.signal_id,
        outcome: "verstuurd" as const,
        source: "webpartners" as const,
        notes: `Op bellijst voor Web Partners (export ${exportId}).`,
        external_id: `bellijst:${exportId}:${r.contact_id}`,
        created_by: createdBy,
      })),
      { onConflict: "external_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(`Activiteiten vastleggen mislukt: ${error.message}`);
  }

  return { exportId, count: rows.length, dropped, destination, csv };
}

// ---------------------------------------------------------------------------
// S7: mail campaigns in Instantly, one per signal type
// ---------------------------------------------------------------------------

export type MailCampaignSummary = {
  signalType: SignalType;
  campaignId: string;
  name: string;
  pushed: number;
  skipped: number;
  failed: number;
  exportId: string | null;
};

export type MailCampaignResult = {
  campaigns: MailCampaignSummary[];
  candidates: number;
  withoutSignal: number;
};

async function ensureCampaign(db: Db, signalType: SignalType, segment: Segment | null, variant: string) {
  const name = campaignName(signalType, segment, variant);
  let query = db
    .from("campaigns")
    .select("id, name, external_id")
    .eq("channel", "mail")
    .eq("signal_type", signalType)
    .eq("message_variant", variant);
  query = segment ? query.eq("segment", segment) : query.is("segment", null);
  const { data: existing, error } = await query.order("created_at").limit(1).maybeSingle();
  if (error) throw new Error(`Campagne zoeken mislukt: ${error.message}`);
  if (existing?.external_id) return { id: existing.id, name: existing.name, instantlyId: existing.external_id };

  const remote = await findOrCreateCampaign(existing?.name ?? name);
  if (existing) {
    const { error: updateError } = await db.from("campaigns").update({ external_id: remote.id }).eq("id", existing.id);
    if (updateError) throw new Error(`Campagne bijwerken mislukt: ${updateError.message}`);
    return { id: existing.id, name: existing.name, instantlyId: remote.id };
  }

  const { data: created, error: insertError } = await db
    .from("campaigns")
    .insert({
      name,
      channel: "mail",
      signal_type: signalType,
      segment,
      message_variant: variant,
      external_id: remote.id,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: byExternal } = await db.from("campaigns").select("id, name").eq("external_id", remote.id).single();
      if (byExternal) return { id: byExternal.id, name: byExternal.name, instantlyId: remote.id };
    }
    throw new Error(`Campagne aanmaken mislukt: ${insertError.message}`);
  }
  return { id: created.id, name, instantlyId: remote.id };
}

/**
 * The opening line for one contact: the company's own line when it is based
 * on this signal, else one written by Claude for exactly this signal. Lines
 * are cached per company and signal within a run. Null means: do not mail.
 */
async function resolveOpeningLine(c: MailCandidate, cache: Map<string, string | null>, log: Log): Promise<string | null> {
  if (openingLineMatchesSignal(c.opening_line, c.signal_type, c.signal_title)) {
    const own = checkOpeningLine(c.opening_line);
    if (own) return own;
  }
  const key = `${c.company_id}:${c.signal_id ?? c.signal_type}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  if (!hasClaude()) {
    cache.set(key, null);
    log(`Geen openingszin voor ${c.company_name}: ANTHROPIC_API_KEY ontbreekt.`);
    return null;
  }
  try {
    const out = await askJson({
      system: OPENING_LINE_SYSTEM,
      input: openingLineInput({
        companyName: c.company_name,
        domain: c.domain,
        segment: c.segment,
        firstName: c.first_name,
        title: c.title,
        signalType: c.signal_type,
        signalTitle: c.signal_title,
      }),
      schema: openingLineSchema,
      effort: "low",
      maxTokens: 2000,
    });
    const line = checkOpeningLine(out.opening_line);
    if (!line) log(`Openingszin voor ${c.company_name} afgekeurd door de controle.`);
    cache.set(key, line);
    return line;
  } catch (error) {
    if (error instanceof ClaudeRefusalError) {
      cache.set(key, null);
      log(`Claude weigerde een openingszin voor ${c.company_name}.`);
      return null;
    }
    throw error;
  }
}

export async function pushMailCampaigns(
  db: Db,
  {
    filter,
    variant = "v1",
    createdBy = null,
    log = () => {},
  }: { filter: ListFilter; variant?: string; createdBy?: string | null; log?: Log },
): Promise<MailCampaignResult> {
  if (!hasInstantly()) throw new Error("INSTANTLY_API_KEY ontbreekt. Zonder Instantly kan er geen mailcampagne gevuld worden.");

  const candidates = await fetchMailCandidates(db, filter);
  const { groups, withoutSignal } = groupBySignalType(candidates);
  log(`${candidates.length} kandidaten, ${groups.size} signaaltypes, ${withoutSignal.length} zonder signaal overgeslagen.`);

  const cache = new Map<string, string | null>();
  const campaigns: MailCampaignSummary[] = [];

  for (const [signalType, rows] of groups) {
    const campaign = await ensureCampaign(db, signalType, filter.segment ?? null, variant);
    const pushedIds: string[] = [];
    let skipped = 0;
    let failed = 0;

    for (const batch of chunk(rows, 50)) {
      // Rule 4: re-check right before writing.
      const stillOk = await recheckContactable(db, "mailcampagne", batch.map((r) => r.contact_id));
      for (const c of batch) {
        if (!stillOk.has(c.contact_id)) {
          skipped += 1;
          continue;
        }
        try {
          const line = await resolveOpeningLine(c, cache, log);
          if (!line) {
            skipped += 1;
            continue;
          }
          await addLeadToCampaign(campaign.instantlyId, {
            email: c.email,
            first_name: c.first_name,
            last_name: c.last_name,
            company_name: c.company_name,
            website: `https://${c.domain}`,
            personalization: line,
            custom_variables: {
              signaal: optionFor(signalTypes, signalType).label,
              signaal_titel: c.signal_title,
              segment: c.segment ? optionFor(segments, c.segment).label : null,
            },
          });
          const { error } = await db.from("activities").upsert(
            {
              contact_id: c.contact_id,
              company_id: c.company_id,
              channel: "mail",
              campaign_id: campaign.id,
              signal_id: c.signal_id,
              outcome: "verstuurd",
              source: "instantly",
              notes: `Toegevoegd aan Instantly campagne ${campaign.name}. Openingszin: ${line}`,
              external_id: `instantly:lead:${campaign.id}:${c.contact_id}`,
              created_by: createdBy,
            },
            { onConflict: "external_id", ignoreDuplicates: true },
          );
          if (error) throw new Error(`Activiteit vastleggen mislukt: ${error.message}`);
          pushedIds.push(c.contact_id);
        } catch (error) {
          failed += 1;
          log(`Fout bij ${c.email}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    let exportId: string | null = null;
    if (pushedIds.length > 0) {
      await setContactStatus(db, pushedIds, "in_mailcampagne");
      exportId = await recordListExport(db, {
        type: "mailcampagne",
        filter: { ...filter, signalType },
        extra: { campaign: campaign.name, variant },
        recordIds: pushedIds,
        destination: `https://app.instantly.ai/app/campaign/${campaign.instantlyId}/leads`,
        campaignId: campaign.id,
        createdBy,
      });
    }
    log(`${campaign.name}: ${pushedIds.length} toegevoegd, ${skipped} overgeslagen, ${failed} mislukt.`);
    campaigns.push({ signalType, campaignId: campaign.id, name: campaign.name, pushed: pushedIds.length, skipped, failed, exportId });
  }

  return { campaigns, candidates: candidates.length, withoutSignal: withoutSignal.length };
}
