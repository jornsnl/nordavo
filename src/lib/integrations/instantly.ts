import "server-only";
import { z } from "zod";

/**
 * Instantly API v2 (cold mail), bearer auth with INSTANTLY_API_KEY.
 *
 * Endpoints used (base https://api.instantly.ai/api/v2):
 *   GET  /campaigns?limit=100&search=&starting_after=   list campaigns, cursor in next_starting_after
 *   POST /campaigns                                      create a campaign (name + campaign_schedule)
 *   POST /leads                                          add one lead to a campaign
 *   GET  /emails?email_type=received&min_timestamp_created=&limit=100&starting_after=
 *                                                        replies received (S8)
 *   POST /leads/list { filter, limit, starting_after }   bounced and unsubscribed leads (S8)
 *
 * Assumptions to check with real credentials:
 *   - New campaigns are created as drafts without a sequence. Julius writes
 *     the mail steps in Instantly once per campaign, using {{personalization}}
 *     for the opening line and {{signaal}} / {{signaal_titel}} if wanted, and
 *     activates it there. The schedule timezone "Europe/Amsterdam" must be in
 *     Instantly's timezone list.
 *   - POST /leads with skip_if_in_campaign=true does not create a second lead
 *     in the same campaign; a 2xx means the lead is in the campaign.
 *   - Reply sentiment: Instantly's lead interest status (lt_interest_status:
 *     1 interested, -1 not interested, -2 wrong person, 0 out of office) when
 *     present on the email, else ai_interest_value (0 to 1). Neither present
 *     means neutral. Auto replies are skipped.
 *   - Lead list filters FILTER_VAL_BOUNCED and FILTER_VAL_UNSUBSCRIBED; the
 *     list has no "since" parameter, so it is filtered on timestamp_updated
 *     here. Event ids are "<type>:<lead id>", stable across runs.
 */

const BASE_URL = "https://api.instantly.ai/api/v2";

export function hasInstantly() {
  return Boolean(process.env.INSTANTLY_API_KEY);
}

function apiKey() {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) throw new Error("INSTANTLY_API_KEY ontbreekt. Zet de API key van Instantly (v2) in de omgeving.");
  return key;
}

async function instantlyFetch(path: string, init: { method?: string; json?: unknown } = {}): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Instantly ${response.status} bij ${path.split("?")[0]}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

const campaignSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  status: z.number().optional().nullable(),
});
export type InstantlyCampaign = z.infer<typeof campaignSchema>;

const pageSchema = <T extends z.ZodType>(item: T) =>
  z.looseObject({
    items: z.array(item),
    next_starting_after: z.string().optional().nullable(),
  });

export async function listCampaigns(search?: string): Promise<InstantlyCampaign[]> {
  const all: InstantlyCampaign[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < 50; page += 1) {
    const params = new URLSearchParams({ limit: "100" });
    if (search) params.set("search", search);
    if (cursor) params.set("starting_after", cursor);
    const data = pageSchema(campaignSchema).parse(await instantlyFetch(`/campaigns?${params}`));
    all.push(...data.items);
    cursor = data.next_starting_after;
    if (!cursor || data.items.length === 0) break;
  }
  return all;
}

/** Mon to Fri, 09:00 to 17:00 Amsterdam time. Julius can change it in Instantly. */
export function defaultCampaignBody(name: string) {
  return {
    name,
    campaign_schedule: {
      schedules: [
        {
          name: "Werkdagen",
          timing: { from: "09:00", to: "17:00" },
          days: { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": false },
          timezone: "Europe/Amsterdam",
        },
      ],
    },
  };
}

export async function createCampaign(name: string): Promise<InstantlyCampaign> {
  return campaignSchema.parse(await instantlyFetch("/campaigns", { method: "POST", json: defaultCampaignBody(name) }));
}

/** The campaign with exactly this name, or a new draft campaign. */
export async function findOrCreateCampaign(name: string): Promise<InstantlyCampaign> {
  const existing = (await listCampaigns(name)).find((c) => c.name === name);
  return existing ?? createCampaign(name);
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export type InstantlyLeadInput = {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  website?: string | null;
  /** The opening line. */
  personalization?: string | null;
  custom_variables?: Record<string, string | number | null>;
};

/** Request body for POST /leads. Empty values are left out. Pure, unit tested. */
export function leadBody(campaignId: string, lead: InstantlyLeadInput) {
  const body: Record<string, unknown> = {
    campaign: campaignId,
    email: lead.email,
    skip_if_in_campaign: true,
  };
  for (const key of ["first_name", "last_name", "company_name", "website", "personalization"] as const) {
    const value = lead[key];
    if (value) body[key] = value;
  }
  const custom = Object.fromEntries(
    Object.entries(lead.custom_variables ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ""),
  );
  if (Object.keys(custom).length > 0) body.custom_variables = custom;
  return body;
}

const leadResponseSchema = z.looseObject({ id: z.string().optional(), email: z.string().optional() });

export async function addLeadToCampaign(campaignId: string, lead: InstantlyLeadInput): Promise<{ id: string | null }> {
  const data = leadResponseSchema.parse(await instantlyFetch("/leads", { method: "POST", json: leadBody(campaignId, lead) }));
  return { id: data.id ?? null };
}

// ---------------------------------------------------------------------------
// Events for S8
// ---------------------------------------------------------------------------

export type InstantlyEventType = "reply" | "bounce" | "unsubscribe";
export type ReplySentiment = "positief" | "neutraal" | "negatief";

export type InstantlyEvent = {
  /** Stable id: the email id for replies, "<type>:<lead id>" for lead events. */
  id: string;
  type: InstantlyEventType;
  email: string;
  campaignId: string | null;
  timestamp: string;
  sentiment?: ReplySentiment;
  subject?: string | null;
};

const emailSchema = z.looseObject({
  id: z.string().min(1),
  timestamp_created: z.string().optional().nullable(),
  timestamp_email: z.string().optional().nullable(),
  from_address_email: z.string().optional().nullable(),
  lead: z.string().optional().nullable(),
  campaign_id: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  is_auto_reply: z.union([z.boolean(), z.number()]).optional().nullable(),
  lt_interest_status: z.number().optional().nullable(),
  i_status: z.number().optional().nullable(),
  ai_interest_value: z.number().optional().nullable(),
});
export type InstantlyEmail = z.infer<typeof emailSchema>;

const leadSchema = z.looseObject({
  id: z.string().min(1),
  email: z.string().optional().nullable(),
  campaign: z.string().optional().nullable(),
  status: z.number().optional().nullable(),
  timestamp_updated: z.string().optional().nullable(),
  timestamp_created: z.string().optional().nullable(),
});
export type InstantlyLead = z.infer<typeof leadSchema>;

export function replySentiment(email: Pick<InstantlyEmail, "lt_interest_status" | "i_status" | "ai_interest_value">): ReplySentiment {
  const status = email.lt_interest_status ?? email.i_status;
  if (typeof status === "number") {
    if (status >= 1) return "positief";
    if (status < 0) return "negatief";
    return "neutraal";
  }
  if (typeof email.ai_interest_value === "number") {
    if (email.ai_interest_value >= 0.7) return "positief";
    if (email.ai_interest_value <= 0.3) return "negatief";
  }
  return "neutraal";
}

/** A received email as a reply event, or null for auto replies and mails without a sender. */
export function mapReplyEmail(raw: unknown): InstantlyEvent | null {
  const email = emailSchema.parse(raw);
  if (email.is_auto_reply === true || email.is_auto_reply === 1) return null;
  const address = (email.lead ?? email.from_address_email ?? "").trim().toLowerCase();
  if (!address.includes("@")) return null;
  return {
    id: email.id,
    type: "reply",
    email: address,
    campaignId: email.campaign_id ?? null,
    timestamp: email.timestamp_email ?? email.timestamp_created ?? new Date().toISOString(),
    sentiment: replySentiment(email),
    subject: email.subject ?? null,
  };
}

/** A bounced or unsubscribed lead as an event, or null without an email. */
export function mapLeadEvent(raw: unknown, type: "bounce" | "unsubscribe"): InstantlyEvent | null {
  const lead = leadSchema.parse(raw);
  const address = (lead.email ?? "").trim().toLowerCase();
  if (!address.includes("@")) return null;
  return {
    id: `${type}:${lead.id}`,
    type,
    email: address,
    campaignId: lead.campaign ?? null,
    timestamp: lead.timestamp_updated ?? lead.timestamp_created ?? new Date().toISOString(),
  };
}

export async function fetchReplies(since: string, maxPages = 50): Promise<InstantlyEvent[]> {
  const events: InstantlyEvent[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({ email_type: "received", min_timestamp_created: since, limit: "100" });
    if (cursor) params.set("starting_after", cursor);
    const data = pageSchema(z.unknown()).parse(await instantlyFetch(`/emails?${params}`));
    for (const item of data.items) {
      const event = mapReplyEmail(item);
      if (event) events.push(event);
    }
    cursor = data.next_starting_after;
    if (!cursor || data.items.length === 0) break;
  }
  return events;
}

const LEAD_FILTERS = { bounce: "FILTER_VAL_BOUNCED", unsubscribe: "FILTER_VAL_UNSUBSCRIBED" } as const;

export async function fetchLeadEvents(type: "bounce" | "unsubscribe", since: string, maxPages = 50): Promise<InstantlyEvent[]> {
  const sinceMs = new Date(since).getTime();
  const events: InstantlyEvent[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const body: Record<string, unknown> = { filter: LEAD_FILTERS[type], limit: 100 };
    if (cursor) body.starting_after = cursor;
    const data = pageSchema(z.unknown()).parse(await instantlyFetch("/leads/list", { method: "POST", json: body }));
    for (const item of data.items) {
      const event = mapLeadEvent(item, type);
      if (event && new Date(event.timestamp).getTime() >= sinceMs) events.push(event);
    }
    cursor = data.next_starting_after;
    if (!cursor || data.items.length === 0) break;
  }
  return events;
}

/** Replies, bounces and unsubscribes since a moment, oldest first. */
export async function fetchEvents(since: string, maxPages = 50): Promise<InstantlyEvent[]> {
  const [replies, bounces, unsubscribes] = [
    await fetchReplies(since, maxPages),
    await fetchLeadEvents("bounce", since, maxPages),
    await fetchLeadEvents("unsubscribe", since, maxPages),
  ];
  return [...replies, ...bounces, ...unsubscribes].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Our activity outcome for an Instantly event. */
export function activityOutcomeFor(
  event: Pick<InstantlyEvent, "type" | "sentiment">,
): "reply_positief" | "reply_neutraal" | "reply_negatief" | "bounce" | "afgemeld" {
  if (event.type === "bounce") return "bounce";
  if (event.type === "unsubscribe") return "afgemeld";
  return `reply_${event.sentiment ?? "neutraal"}`;
}
