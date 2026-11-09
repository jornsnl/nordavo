import "server-only";
import { z } from "zod";
import { addWorkingDays, amsterdamDate } from "@/lib/sales/status";

/**
 * OnePageCRM. The Pipeline page under Sales replaced it as the place where
 * deals live (feedback Julius, section 2.8), so contacts are no longer pushed
 * or pulled (the S9 jobs are gone). What is left: notes and next actions on a
 * deal that a vacancy still links to (onepage_deal_id), for the transition.
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

export function hasOnePage() {
  return Boolean(process.env.ONEPAGE_USER_ID && process.env.ONEPAGE_API_KEY);
}

export function requireOnePage() {
  if (!hasOnePage()) {
    throw new Error("OnePageCRM is not connected: ONEPAGE_USER_ID and ONEPAGE_API_KEY are missing.");
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
  gekwalificeerd: "Qualified",
  benaderd: "Contacted",
  gesprek_gehad: "Call held",
  afspraak_gepland: "Meeting booked",
  intake_gedaan: "Intake done",
  profielen_verstuurd: "Profiles sent",
  gesprekken: "Interviews with candidates",
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
    throw new Error("ONEPAGE_DEAL_STAGES is not valid JSON.");
  }
  const result = z.record(z.string(), z.number()).safeParse(parsed);
  if (!result.success) throw new Error("ONEPAGE_DEAL_STAGES must be an object of numbers.");
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
// Dates
// ---------------------------------------------------------------------------

export function defaultNextAction(reason: string, today = amsterdamDate()) {
  return { text: `Follow up: ${reason}`, date: addWorkingDays(today, 2) };
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
    throw new OnePageError(`OnePageCRM ${method} ${path} returned ${response.status}: ${detail}`);
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) throw new OnePageError(`OnePageCRM ${method} ${path}: unexpected response.`);
  if (envelope.data.status !== undefined && envelope.data.status !== 0) {
    throw new OnePageError(`OnePageCRM ${method} ${path}: ${envelope.data.message ?? "error"}`);
  }
  return envelope.data.data;
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new OnePageError(`OnePageCRM: ${what} has an unexpected shape (${result.error.issues[0]?.message ?? "unknown"}).`);
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
  const last = contact.last_name?.trim() || (first ? "" : "Unknown");
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

/** Add a note to a deal, for example "Anonymous profile sent: <link>". */
export async function addDealNote(dealId: string, text: string): Promise<void> {
  const deal = await getDeal(dealId);
  if (!deal.contact_id) throw new Error(`OnePageCRM deal ${dealId} has no contact.`);
  await request("POST", "notes.json", { body: { contact_id: deal.contact_id, text, linked_deal_id: dealId } });
}
