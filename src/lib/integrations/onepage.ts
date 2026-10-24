import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  ActivityChannel,
  ActivityOutcome,
  ContactStatus,
  Database,
  TablesInsert,
} from "@/lib/database.types";

/**
 * OnePageCRM: Julius' workspace. Only qualified contacts go in (hard rule 8),
 * and every contact always has a next action with a date.
 *
 * REST API v3, base https://app.onepagecrm.com/api/v3/, HTTP basic auth with
 * ONEPAGE_USER_ID as user and ONEPAGE_API_KEY as password. Every response is
 * wrapped as { status: 0, message: "OK", timestamp, data: {...} }.
 *
 * Endpoints used:
 *   GET  contacts.json?email=<email>           find a contact by email
 *   GET  contacts/{id}.json                    one contact (+ next_action)
 *   POST contacts.json                         create a contact; the company is
 *                                              created implicitly from company_name
 *   PUT  contacts/{id}.json?partial=true       update only the fields we send
 *   POST actions.json                          create a next action (status "date")
 *   PUT  actions/{id}.json?partial=true        change the open next action
 *   GET  deals.json?contact_id=<id>            deals of a contact
 *   GET  deals/{id}.json                       one deal (for its contact_id)
 *   POST deals.json                            create a deal
 *   PUT  deals/{id}.json?partial=true          move a deal to another stage
 *   POST notes.json                            note on a contact, linked to a deal
 *   GET  deals.json?modified_since=<unix>      changed deals for the daily pull
 *   GET  actions.json?modified_since=<unix>    changed (completed) actions
 *
 * Assumptions to check with real credentials:
 *   - The `email` filter on GET contacts.json exists; we still compare the
 *     returned emails ourselves, so a broader search does no harm.
 *   - `modified_since` takes a unix timestamp in seconds on deals and actions.
 *   - Deal stages are percentages (10, 20, ...) in the account's pipeline. The
 *     mapping from our stages lives in DEFAULT_DEAL_STAGES and can be
 *     overridden with ONEPAGE_DEAL_STAGES (JSON, e.g. {"afspraak_gepland":40})
 *     and ONEPAGE_PIPELINE_ID when the account uses a custom pipeline.
 *   - A completed action has done=true (or status "done") and done_at.
 *   - GET contacts/{id}.json returns the open next action as data.next_action.
 */

const BASE_URL = "https://app.onepagecrm.com/api/v3/";

type Db = SupabaseClient<Database>;

export function hasOnePage() {
  return Boolean(process.env.ONEPAGE_USER_ID && process.env.ONEPAGE_API_KEY);
}

export function requireOnePage() {
  if (!hasOnePage()) {
    throw new Error("OnePageCRM is niet gekoppeld: ONEPAGE_USER_ID en ONEPAGE_API_KEY ontbreken.");
  }
}

// ---------------------------------------------------------------------------
// Pipeline stages (briefing section 7)
// ---------------------------------------------------------------------------

export const dealStageKeys = [
  "gekwalificeerd",
  "benaderd",
  "gesprek_gehad",
  "afspraak_gepland",
  "intake_gedaan",
  "profielen_verstuurd",
  "gesprekken",
] as const;
export type DealStageKey = (typeof dealStageKeys)[number];

export const dealStageLabels: Record<DealStageKey, string> = {
  gekwalificeerd: "Gekwalificeerd",
  benaderd: "Benaderd",
  gesprek_gehad: "Gesprek gehad",
  afspraak_gepland: "Afspraak gepland",
  intake_gedaan: "Intake gedaan",
  profielen_verstuurd: "Profielen verstuurd",
  gesprekken: "Gesprekken met kandidaten",
};

/** Stage percentages in the OnePageCRM pipeline. Gewonnen/verloren is the deal status. */
export const DEFAULT_DEAL_STAGES: Record<DealStageKey, number> = {
  gekwalificeerd: 10,
  benaderd: 20,
  gesprek_gehad: 30,
  afspraak_gepland: 40,
  intake_gedaan: 50,
  profielen_verstuurd: 70,
  gesprekken: 90,
};

export function dealStageMap(raw = process.env.ONEPAGE_DEAL_STAGES): Record<DealStageKey, number> {
  if (!raw) return DEFAULT_DEAL_STAGES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ONEPAGE_DEAL_STAGES is geen geldige JSON.");
  }
  const result = z.record(z.string(), z.number()).safeParse(parsed);
  if (!result.success) throw new Error("ONEPAGE_DEAL_STAGES moet een object met getallen zijn.");
  const map = { ...DEFAULT_DEAL_STAGES };
  for (const key of dealStageKeys) {
    if (typeof result.data[key] === "number") map[key] = result.data[key];
  }
  return map;
}

/** OnePageCRM stage number back to our stage: the highest stage at or below it. */
export function stageKeyFor(stage: number | null | undefined, map = DEFAULT_DEAL_STAGES): DealStageKey | null {
  if (stage === null || stage === undefined) return null;
  let best: DealStageKey | null = null;
  for (const key of dealStageKeys) {
    if (map[key] <= stage && (best === null || map[key] >= map[best])) best = key;
  }
  return best ?? "gekwalificeerd";
}

// ---------------------------------------------------------------------------
// Contact status order, shared by S8 and S9: statuses only move forward.
// ---------------------------------------------------------------------------

const statusOrder: ContactStatus[] = [
  "nieuw",
  "gekwalificeerd",
  "verrijkt",
  "op_bellijst",
  "in_mailcampagne",
  "bereikt",
  "afspraak",
  "kans",
  "klant",
];

/**
 * Whether a contact in `current` may move to `target`. Uitgesloten never
 * changes, klant only changes by hand, verloren reopens on a new meeting or
 * deal, everything else only moves forward.
 */
export function shouldPromoteStatus(current: ContactStatus, target: ContactStatus): boolean {
  if (current === target || current === "uitgesloten" || current === "klant") return false;
  if (target === "verloren") return true;
  if (current === "verloren") return target === "afspraak" || target === "kans" || target === "klant";
  const from = statusOrder.indexOf(current);
  const to = statusOrder.indexOf(target);
  return to > from;
}

/** Move a contact forward in the funnel; never backwards. */
export async function promoteContactStatus(db: Db, contactId: string, target: ContactStatus): Promise<boolean> {
  const { data, error } = await db.from("contacts").select("status").eq("id", contactId).maybeSingle();
  if (error) throw error;
  if (!data || !shouldPromoteStatus(data.status, target)) return false;
  const { error: updateError } = await db.from("contacts").update({ status: target }).eq("id", contactId);
  if (updateError) throw updateError;
  return true;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** YYYY-MM-DD in Amsterdam. */
export function amsterdamDate(value: Date | string = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date(value));
}

/** Add working days (Monday to Friday) to a YYYY-MM-DD date. */
export function addWorkingDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  let left = days;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return date.toISOString().slice(0, 10);
}

export function defaultNextAction(reason: string, today = amsterdamDate()) {
  return { text: `Opvolgen: ${reason}`, date: addWorkingDays(today, 2) };
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

const envelopeSchema = z.looseObject({
  status: z.number().optional(),
  message: z.string().optional(),
  data: z.unknown().optional(),
});

const labeledValue = z.looseObject({ type: z.string().nullish(), value: z.string() });

export const onePageContactSchema = z.looseObject({
  id: z.string(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  job_title: z.string().nullish(),
  company_name: z.string().nullish(),
  company_id: z.string().nullish(),
  emails: z.array(labeledValue).nullish(),
  phones: z.array(labeledValue).nullish(),
  urls: z.array(labeledValue).nullish(),
  tags: z.array(z.string()).nullish(),
});
export type OnePageContact = z.infer<typeof onePageContactSchema>;

const onePageActionSchema = z.looseObject({
  id: z.string(),
  contact_id: z.string().nullish(),
  text: z.string().nullish(),
  date: z.string().nullish(),
  status: z.string().nullish(),
  done: z.boolean().nullish(),
  done_at: z.string().nullish(),
  modified_at: z.string().nullish(),
});
export type OnePageAction = z.infer<typeof onePageActionSchema>;

export const onePageDealSchema = z.looseObject({
  id: z.string(),
  contact_id: z.string().nullish(),
  name: z.string().nullish(),
  stage: z.number().nullish(),
  status: z.string().nullish(),
  text: z.string().nullish(),
  close_date: z.string().nullish(),
  modified_at: z.string().nullish(),
  created_at: z.string().nullish(),
});
export type OnePageDeal = z.infer<typeof onePageDealSchema>;

class OnePageError extends Error {}

type Query = Record<string, string | number | undefined>;

async function request(method: "GET" | "POST" | "PUT", path: string, { query, body }: { query?: Query; body?: unknown } = {}) {
  requireOnePage();
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const auth = Buffer.from(`${process.env.ONEPAGE_USER_ID}:${process.env.ONEPAGE_API_KEY}`).toString("base64");
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // handled below
  }
  if (!response.ok) {
    const detail =
      json && typeof json === "object"
        ? String((json as Record<string, unknown>).error_message ?? (json as Record<string, unknown>).message ?? "")
        : text.slice(0, 200);
    throw new OnePageError(`OnePageCRM ${method} ${path} gaf ${response.status}: ${detail}`);
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) throw new OnePageError(`OnePageCRM ${method} ${path}: onverwacht antwoord.`);
  if (envelope.data.status !== undefined && envelope.data.status !== 0) {
    throw new OnePageError(`OnePageCRM ${method} ${path}: ${envelope.data.message ?? "fout"}`);
  }
  return envelope.data.data;
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new OnePageError(`OnePageCRM: ${what} heeft een onverwachte vorm (${result.error.issues[0]?.message ?? "onbekend"}).`);
  }
  return result.data;
}

/** List responses wrap each item: { contacts: [{ contact: {...} }] }. Also accepts bare items. */
export function unwrapList<T>(data: unknown, key: string, item: string, schema: z.ZodType<T>): { items: T[]; maxPage: number } {
  const shape = z.looseObject({
    [key]: z.array(z.unknown()).default([]),
    max_page: z.number().optional(),
  });
  const parsed = parseOrThrow(shape, data ?? {}, key);
  const rows = (parsed[key] as unknown[]).map((row) =>
    row && typeof row === "object" && item in row ? (row as Record<string, unknown>)[item] : row,
  );
  return { items: rows.map((row) => parseOrThrow(schema, row, item)), maxPage: (parsed.max_page as number | undefined) ?? 1 };
}

function unwrapOne<T>(data: unknown, item: string, schema: z.ZodType<T>): T {
  const value = data && typeof data === "object" && item in data ? (data as Record<string, unknown>)[item] : data;
  return parseOrThrow(schema, value, item);
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function findContactByEmail(email: string): Promise<OnePageContact | null> {
  const wanted = email.trim().toLowerCase();
  const data = await request("GET", "contacts.json", { query: { email: wanted, per_page: 10 } });
  const { items } = unwrapList(data, "contacts", "contact", onePageContactSchema);
  return items.find((c) => (c.emails ?? []).some((e) => e.value.trim().toLowerCase() === wanted)) ?? null;
}

export async function getContact(id: string): Promise<{ contact: OnePageContact; nextAction: OnePageAction | null }> {
  const data = await request("GET", `contacts/${encodeURIComponent(id)}.json`);
  const contact = unwrapOne(data, "contact", onePageContactSchema);
  const rawAction = data && typeof data === "object" ? (data as Record<string, unknown>).next_action : null;
  const action = rawAction ? onePageActionSchema.safeParse(rawAction) : null;
  return { contact, nextAction: action?.success ? action.data : null };
}

export type OnePageContactPayload = {
  first_name: string;
  last_name: string;
  job_title?: string;
  company_name?: string;
  emails: { type: string; value: string }[];
  phones: { type: string; value: string }[];
  urls: { type: string; value: string }[];
  tags: string[];
  background?: string;
};

export async function createContact(payload: OnePageContactPayload): Promise<OnePageContact> {
  const data = await request("POST", "contacts.json", { body: payload });
  return unwrapOne(data, "contact", onePageContactSchema);
}

export async function updateContact(id: string, payload: Partial<OnePageContactPayload>): Promise<void> {
  await request("PUT", `contacts/${encodeURIComponent(id)}.json`, { query: { partial: "true" }, body: payload });
}

/** Our contact and company to the OnePageCRM contact body. Pure. */
export function buildContactPayload(input: {
  contact: {
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    phone_type: string | null;
    linkedin_url: string | null;
  };
  company: { name: string; domain: string; website: string | null; segment: string | null; linkedin_url: string | null };
  signalType?: string | null;
  reason?: string;
}): OnePageContactPayload {
  const { contact, company } = input;
  // OnePageCRM needs a last name or a company; fall back so a create never fails on it.
  const first = contact.first_name?.trim() || "";
  const last = contact.last_name?.trim() || (first ? "" : "Onbekend");
  const urls: { type: string; value: string }[] = [];
  urls.push({ type: "website", value: company.website?.trim() || `https://${company.domain}` });
  if (contact.linkedin_url) urls.push({ type: "linkedin", value: toUrl(contact.linkedin_url) });
  const tags = ["nordavo-gtm"];
  if (company.segment) tags.push(company.segment);
  if (input.signalType) tags.push(input.signalType);
  return {
    first_name: first,
    last_name: last,
    ...(contact.title ? { job_title: contact.title } : {}),
    company_name: company.name,
    emails: contact.email ? [{ type: "work", value: contact.email }] : [],
    phones: contact.phone ? [{ type: contact.phone_type === "mobiel" ? "mobile" : "work", value: contact.phone }] : [],
    urls,
    tags,
    ...(input.reason ? { background: input.reason } : {}),
  };
}

function toUrl(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://www.${value.replace(/^www\./, "")}`;
}

/**
 * For an existing contact: only add what is missing (emails, phones, URLs,
 * tags, job title). Never overwrites what Julius typed in the CRM. Pure.
 */
export function mergeContactPayload(existing: OnePageContact, payload: OnePageContactPayload): Partial<OnePageContactPayload> {
  const patch: Partial<OnePageContactPayload> = {};
  const union = (current: { type?: string | null; value: string }[] | null | undefined, extra: { type: string; value: string }[]) => {
    const list = (current ?? []).map((v) => ({ type: v.type ?? "other", value: v.value }));
    const seen = new Set(list.map((v) => v.value.trim().toLowerCase()));
    const added = extra.filter((v) => !seen.has(v.value.trim().toLowerCase()));
    return added.length ? [...list, ...added] : null;
  };
  const emails = union(existing.emails, payload.emails);
  if (emails) patch.emails = emails;
  const phones = union(existing.phones, payload.phones);
  if (phones) patch.phones = phones;
  const urls = union(existing.urls, payload.urls);
  if (urls) patch.urls = urls;
  const tags = existing.tags ?? [];
  const newTags = payload.tags.filter((t) => !tags.includes(t));
  if (newTags.length) patch.tags = [...tags, ...newTags];
  if (!existing.job_title && payload.job_title) patch.job_title = payload.job_title;
  if (!existing.company_name && payload.company_name) patch.company_name = payload.company_name;
  return patch;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function createNextAction(contactId: string, action: { text: string; date: string }): Promise<OnePageAction> {
  const data = await request("POST", "actions.json", {
    body: { contact_id: contactId, text: action.text, date: action.date, status: "date" },
  });
  return unwrapOne(data, "action", onePageActionSchema);
}

/** Set the next action on a OnePageCRM contact (YYYY-MM-DD). Replaces the open one, else creates one. */
export async function setNextAction(onepageContactId: string, action: { text: string; date: string }): Promise<void> {
  const { nextAction } = await getContact(onepageContactId);
  if (nextAction && !nextAction.done && nextAction.status !== "done") {
    await request("PUT", `actions/${encodeURIComponent(nextAction.id)}.json`, {
      query: { partial: "true" },
      body: { text: action.text, date: action.date, status: "date" },
    });
    return;
  }
  await createNextAction(onepageContactId, action);
}

// ---------------------------------------------------------------------------
// Deals and notes
// ---------------------------------------------------------------------------

export async function listDealsForContact(contactId: string): Promise<OnePageDeal[]> {
  const data = await request("GET", "deals.json", { query: { contact_id: contactId, per_page: 100 } });
  return unwrapList(data, "deals", "deal", onePageDealSchema).items;
}

export async function getDeal(dealId: string): Promise<OnePageDeal> {
  const data = await request("GET", `deals/${encodeURIComponent(dealId)}.json`);
  return unwrapOne(data, "deal", onePageDealSchema);
}

/**
 * One open deal per company. Reuses a pending deal of this contact (or of a
 * colleague at the same company that is already in the CRM) and only moves it
 * forward; otherwise creates one.
 */
export async function upsertCompanyDeal(input: {
  contactId: string;
  colleagueContactIds?: string[];
  companyName: string;
  stage: DealStageKey;
  text?: string;
}): Promise<{ dealId: string; created: boolean }> {
  const map = dealStageMap();
  const target = map[input.stage];
  for (const id of [input.contactId, ...(input.colleagueContactIds ?? [])]) {
    const deals = await listDealsForContact(id);
    const open = deals.find((d) => !d.status || d.status === "pending");
    if (open) {
      if ((open.stage ?? 0) < target) {
        await request("PUT", `deals/${encodeURIComponent(open.id)}.json`, { query: { partial: "true" }, body: { stage: target } });
      }
      return { dealId: open.id, created: false };
    }
  }
  const pipelineId = process.env.ONEPAGE_PIPELINE_ID;
  const data = await request("POST", "deals.json", {
    body: {
      contact_id: input.contactId,
      name: `${input.companyName}: developer via Nordavo`,
      stage: target,
      status: "pending",
      date: amsterdamDate(),
      ...(input.text ? { text: input.text } : {}),
      ...(pipelineId ? { pipeline_id: pipelineId } : {}),
    },
  });
  return { dealId: unwrapOne(data, "deal", onePageDealSchema).id, created: true };
}

/** Add a note to a deal, for example "Anoniem profiel verstuurd: <link>". */
export async function addDealNote(dealId: string, text: string): Promise<void> {
  const deal = await getDeal(dealId);
  if (!deal.contact_id) throw new Error(`OnePageCRM deal ${dealId} heeft geen contact.`);
  await request("POST", "notes.json", { body: { contact_id: deal.contact_id, text, linked_deal_id: dealId } });
}

// ---------------------------------------------------------------------------
// Changes for the daily pull
// ---------------------------------------------------------------------------

async function listModifiedSince<T>(path: string, key: string, item: string, schema: z.ZodType<T>, since: Date, maxPages: number) {
  const all: T[] = [];
  const modifiedSince = Math.floor(since.getTime() / 1000);
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await request("GET", path, { query: { modified_since: modifiedSince, per_page: 100, page } });
    const { items, maxPage } = unwrapList(data, key, item, schema);
    all.push(...items);
    if (page >= maxPage || items.length === 0) break;
  }
  return all;
}

export async function listRecentChanges(since: Date, { maxPages = 20 } = {}): Promise<{ deals: OnePageDeal[]; actions: OnePageAction[] }> {
  const [deals, actions] = await Promise.all([
    listModifiedSince("deals.json", "deals", "deal", onePageDealSchema, since, maxPages),
    listModifiedSince("actions.json", "actions", "action", onePageActionSchema, since, maxPages),
  ]);
  return { deals, actions: actions.filter(isCompletedAction) };
}

export function isCompletedAction(action: OnePageAction) {
  return action.done === true || action.status === "done";
}

export type CrmChange = {
  /** Stable per state, so the same stage is logged once per deal. */
  stateKey: string;
  externalId: string;
  onepageContactId: string;
  outcome: ActivityOutcome;
  notes: string;
  date: string;
  contactStatus: ContactStatus | null;
  companyWon: boolean;
};

/** A changed deal to the activity we log. Pure. */
export function mapDealChange(deal: OnePageDeal, map = DEFAULT_DEAL_STAGES): CrmChange | null {
  if (!deal.contact_id) return null;
  const date = deal.modified_at ?? deal.created_at ?? new Date().toISOString();
  const name = deal.name ? ` (${deal.name})` : "";
  const base = { onepageContactId: deal.contact_id, date };
  if (deal.status === "won") {
    return {
      ...base,
      stateKey: `onepage:deal:${deal.id}:won`,
      externalId: `onepage:deal:${deal.id}:won:${date}`,
      outcome: "gewonnen",
      notes: `Deal gewonnen${name}${deal.text ? `: ${deal.text}` : ""}`,
      contactStatus: "klant",
      companyWon: true,
    };
  }
  if (deal.status === "lost") {
    return {
      ...base,
      stateKey: `onepage:deal:${deal.id}:lost`,
      externalId: `onepage:deal:${deal.id}:lost:${date}`,
      outcome: "verloren",
      notes: `Deal verloren${name}${deal.text ? `: ${deal.text}` : ""}`,
      contactStatus: "verloren",
      companyWon: false,
    };
  }
  const stage = stageKeyFor(deal.stage, map);
  if (!stage) return null;
  const outcome: ActivityOutcome =
    stage === "gesprek_gehad" ? "gesprek_gehad" : stage === "afspraak_gepland" ? "afspraak" : "notitie";
  // Early stages are where we pushed it ourselves; nothing new to log.
  if (stage === "gekwalificeerd" || stage === "benaderd") return null;
  return {
    ...base,
    stateKey: `onepage:deal:${deal.id}:${stage}`,
    externalId: `onepage:deal:${deal.id}:${stage}:${date}`,
    outcome,
    notes: `Deal naar fase ${dealStageLabels[stage]}${name}`,
    contactStatus: "kans",
    companyWon: false,
  };
}

/** A completed action to an activity. Pure. */
export function mapCompletedAction(action: OnePageAction): CrmChange | null {
  if (!action.contact_id || !isCompletedAction(action)) return null;
  const date = action.done_at ?? action.modified_at ?? new Date().toISOString();
  const text = action.text?.trim() || "Actie";
  const isConversation = /gesprek|call|meeting|bellen|gebeld|intake|demo/i.test(text);
  return {
    stateKey: `onepage:action:${action.id}`,
    externalId: `onepage:action:${action.id}:${date}`,
    onepageContactId: action.contact_id,
    outcome: isConversation ? "gesprek_gehad" : "notitie",
    notes: `Actie afgerond in OnePageCRM: ${text}`,
    date,
    contactStatus: null,
    companyWon: false,
  };
}

// ---------------------------------------------------------------------------
// Push one contact (S9)
// ---------------------------------------------------------------------------

const triggerOutcomes: ActivityOutcome[] = ["afspraak", "afspraak_goedgekeurd", "reply_positief"];

/** The pipeline stage that fits the contact's latest trigger. Pure. */
export function stageForTrigger(outcome: ActivityOutcome | null | undefined): DealStageKey {
  if (outcome === "afspraak" || outcome === "afspraak_goedgekeurd") return "afspraak_gepland";
  if (outcome === "reply_positief") return "benaderd";
  return "gekwalificeerd";
}

/**
 * Create (or update) the contact and its company in OnePageCRM with a next
 * action, write onepage_id back to Supabase and log an activity.
 */
export async function pushContactToCrm(
  db: SupabaseClient<Database>,
  contactId: string,
  options: { reason: string; nextAction?: { text: string; date: string } },
): Promise<{ onepageId: string }> {
  requireOnePage();

  const { data: contact, error } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, title, email, phone, phone_type, linkedin_url, status, onepage_id, company:companies!inner(id, name, domain, website, segment, linkedin_url, icp_decision)",
    )
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw error;
  if (!contact) throw new Error("Contact niet gevonden.");
  const company = contact.company;

  // Hard rule 8: only qualified contacts, never raw scrape data.
  if (company.icp_decision !== "GO") {
    throw new Error(`Niet naar OnePageCRM: ${company.name} is niet gekwalificeerd (ICP besluit is geen GO).`);
  }
  if (contact.status === "nieuw" || contact.status === "uitgesloten") {
    throw new Error(`Niet naar OnePageCRM: dit contact heeft status ${contact.status} en is dus niet gekwalificeerd.`);
  }

  const [{ data: trigger }, { data: signal }, { data: colleagues }] = await Promise.all([
    db
      .from("activities")
      .select("channel, outcome")
      .eq("contact_id", contactId)
      .in("outcome", triggerOutcomes)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("signals")
      .select("type")
      .eq("company_id", company.id)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("contacts")
      .select("onepage_id")
      .eq("company_id", company.id)
      .neq("id", contactId)
      .not("onepage_id", "is", null),
  ]);

  const payload = buildContactPayload({ contact, company, signalType: signal?.type, reason: options.reason });

  // Idempotent: reuse our onepage_id, else an existing CRM contact with the same email.
  let onepageId = contact.onepage_id;
  let existing: OnePageContact | null = null;
  let hasOpenAction = false;
  if (onepageId) {
    const found = await getContact(onepageId);
    existing = found.contact;
    hasOpenAction = Boolean(found.nextAction && !isCompletedAction(found.nextAction));
  } else if (contact.email) {
    existing = await findContactByEmail(contact.email);
    if (existing) {
      onepageId = existing.id;
      const found = await getContact(existing.id);
      hasOpenAction = Boolean(found.nextAction && !isCompletedAction(found.nextAction));
    }
  }

  if (existing && onepageId) {
    const patch = mergeContactPayload(existing, payload);
    if (Object.keys(patch).length > 0) await updateContact(onepageId, patch);
  } else {
    onepageId = (await createContact(payload)).id;
  }

  // Every contact always has a next action. Keep Julius' own open action unless we are given one.
  if (options.nextAction) await setNextAction(onepageId, options.nextAction);
  else if (!hasOpenAction) await createNextAction(onepageId, defaultNextAction(options.reason));

  await upsertCompanyDeal({
    contactId: onepageId,
    colleagueContactIds: (colleagues ?? []).map((c) => c.onepage_id).filter((id): id is string => Boolean(id)),
    companyName: company.name,
    stage: stageForTrigger(trigger?.outcome),
    text: options.reason,
  });

  if (contact.onepage_id !== onepageId) {
    const { error: writeError } = await db.from("contacts").update({ onepage_id: onepageId }).eq("id", contactId);
    if (writeError) throw writeError;
  }
  await promoteContactStatus(db, contactId, "kans");

  const channel: ActivityChannel = trigger?.channel ?? "meeting";
  const row: TablesInsert<"activities"> = {
    contact_id: contactId,
    company_id: company.id,
    channel,
    outcome: "notitie",
    notes: `Naar OnePageCRM: ${options.reason}`,
    source: "onepage",
    // One log line per contact per day, however often the push runs.
    external_id: `onepage:push:${contactId}:${amsterdamDate()}`,
  };
  const { error: activityError } = await db.from("activities").upsert(row, { onConflict: "external_id", ignoreDuplicates: true });
  if (activityError) throw activityError;

  return { onepageId };
}
