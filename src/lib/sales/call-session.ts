import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/database.types";
import { contactStatuses } from "@/lib/labels";
import type { CallOutcome } from "@/lib/sales/database";
import { callOutcomes, labelOf } from "@/lib/sales/labels";
import { loadQueue, type QueueEntry, type QueueScope } from "@/lib/sales/queue";
import { companyColumns, contactColumns, type ContactRow } from "@/lib/sales/rows";
import { pickable } from "@/lib/sales/choices";
import { loadChoiceLists } from "@/lib/sales/flow-data";
import { dialHref } from "@/lib/sales/telephony";

// The call screen (feedback Julius, section 2.9): the next contact of a
// queue, held while it is open, and one outcome per call. Shared by the team
// (/dashboard/calls, session client) and external callers (/caller/call,
// secret key client with p_actor, after requireCaller()).

type Db = SupabaseClient<Database>;

export type CallActor = {
  /** The session client for the team; the secret key client for external callers. */
  db: Db;
  /** Profile id of the person calling. */
  actorId: string;
  /** Caller row of an external caller, null for the team. */
  callerId: string | null;
  /** Passed as p_actor: only with the secret key client. */
  pActor: string | undefined;
  /** Cal.com link for "Meeting planned", or null when none is set. */
  bookingBase: string | null;
};

export type CallTimelineItem = {
  id: string;
  date: string;
  type: string;
  channel: string;
  outcome: string | null;
  /** Short text: the outcome label, or "Status: New to Reached" for a change. */
  summary: string;
  notes: string | null;
  who: string | null;
  contactName: string | null;
};

export type CallCard = {
  contact: {
    id: string;
    name: string;
    title: string | null;
    role: string;
    route: string | null;
    phone: string | null;
    email: string | null;
    linkedinUrl: string | null;
    status: string;
    attempts: number;
    lastAttemptAt: string | null;
    callbackAt: string | null;
    callerNote: string | null;
    referredTo: string | null;
  };
  company: {
    id: string;
    name: string;
    prio: number | null;
    city: string | null;
    sector: string | null;
    website: string | null;
    description: string | null;
    openingLine: string | null;
    redFlags: string[];
    generalPhone: string | null;
  };
  /** Contact mobile, else the general number of the company; href follows the caller's dial template (tel: or their phone system). */
  dial: { number: string; kind: "contact" | "general"; href: string } | null;
  /** The outcome buttons with the labels, order and hidden flags of Settings, Sales lists. */
  outcomes: { value: CallOutcome; label: string; description: string | null }[];
  vacancies: {
    id: string;
    title: string | null;
    roleGroup: string | null;
    daysOpen: number | null;
    url: string | null;
    /** Posted date (YYYY-MM-DD) when known; the days open count from here, else from firstSeenAt. */
    postedAt?: string | null;
    firstSeenAt?: string;
    description?: string | null;
  }[];
  others: { id: string; name: string; title: string | null; phone: string | null; status: string }[];
  timeline: CallTimelineItem[];
  queue: { position: number; total: number; source: QueueEntry["source"]; listName: string | null };
  booking: { base: string; name: string | null; email: string | null; callerId: string | null } | null;
};

export type CallStep = {
  card: CallCard | null;
  /** Contacts left in the queue after this one. */
  remaining: number;
  error?: string;
  /** What the last outcome did, for the confirmation line. */
  logged?: { outcome: string; attempts: number };
};

/** The number of contacts the call screen tries to hold before it gives up for now. */
const MAX_CLAIM_TRIES = 25;

function personName(first: string | null, last: string | null) {
  return [first, last].filter(Boolean).join(" ").trim();
}

// Field labels and option labels for change rows in the timeline.
const fieldInfo = new Map<string, { label: string; options?: { value: string; label: string }[] }>();
for (const col of [...companyColumns, ...contactColumns]) {
  if (col.field && !fieldInfo.has(col.field)) fieldInfo.set(col.field, { label: col.label, options: col.options });
}
fieldInfo.set("status", { label: "Contact status", options: contactStatuses.map((o) => ({ value: o.value, label: o.label })) });
fieldInfo.set("assigned_caller_id", { label: "Caller" });
fieldInfo.set("company_id", { label: "Company" });

function valueText(value: Json | null | undefined, options?: { value: string; label: string }[]): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (Array.isArray(value)) return value.length === 0 ? "empty" : value.map((v) => valueText(v as Json, options)).join(", ");
  if (typeof value === "string") {
    const hit = options?.find((o) => o.value === value);
    if (hit) return hit.label;
    if (/^[0-9a-f-]{36}$/i.test(value)) return "set";
    return value.length > 60 ? `${value.slice(0, 57)}...` : value;
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    const hit = options?.find((o) => o.value === String(value));
    return hit ? hit.label : String(value);
  }
  return "changed";
}

const outcomeLabels = new Map<string, string>([
  ["afspraak", "Meeting booked"],
  ["afspraak_goedgekeurd", "Meeting approved"],
  ["afspraak_afgekeurd", "Meeting rejected"],
  ["meeting_held", "Meeting held"],
  ["meeting_no_show", "No show"],
  ["meeting_cancelled", "Meeting cancelled"],
  ["geen_gehoor", "No answer"],
  ["bereikt", "Reached"],
  ["terugbellen", "Call back"],
  ["niet_geinteresseerd", "Not interested"],
  ["reply_positief", "Positive reply"],
  ["reply_neutraal", "Neutral reply"],
  ["reply_negatief", "Negative reply"],
  ["verstuurd", "Sent"],
  ["bounce", "Bounce"],
  ["afgemeld", "Unsubscribed"],
  ["gesprek_gehad", "Call held"],
  ["notitie", "Note"],
  ...callOutcomes.map((o) => [o.value, o.label] as [string, string]),
]);

const channelLabels: Record<string, string> = {
  bellen: "Call",
  mail: "Mail",
  linkedin: "LinkedIn",
  meeting: "Meeting",
  system: "System",
};

async function loadCard(actor: CallActor, entry: QueueEntry, index: number, total: number, rows: Map<string, ContactRow>, listNames: Map<string, string>): Promise<CallCard | null> {
  const { db } = actor;
  const row = rows.get(entry.contactId);
  const [company, signals, activities, profile, lists] = await Promise.all([
    db
      .from("companies")
      .select("id, name, domain, website, prio, city, sector, description, opening_line, red_flags, general_phone")
      .eq("id", entry.companyId)
      .maybeSingle(),
    db
      .from("signals")
      .select("id, title, role_group, posted_at, first_seen_at, source_url, last_seen_at, description, closed_at")
      .eq("company_id", entry.companyId)
      .is("closed_at", null)
      .order("last_seen_at", { ascending: false })
      .limit(10),
    db
      .from("activities")
      .select("id, date, type, channel, outcome, notes, field, old_value, new_value, created_by, contact_id")
      .eq("company_id", entry.companyId)
      .neq("type", "view")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(60),
    db.from("profiles").select("dial_template").eq("id", actor.actorId).maybeSingle(),
    loadChoiceLists(db),
  ]);
  if (!row || !company.data) return null;
  const c = company.data;

  const people = new Set((activities.data ?? []).map((a) => a.created_by).filter((v): v is string => Boolean(v)));
  const { data: profiles } =
    people.size > 0 ? await db.from("profiles").select("id, full_name, email").in("id", [...people]) : { data: [] };
  const who = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email?.split("@")[0] || "Someone"]));

  const contactName = (id: string | null) => {
    if (!id) return null;
    const r = rows.get(id);
    return r ? r.full_name || personName(r.first_name, r.last_name) || null : null;
  };

  const now = Date.now();
  const timeline: CallTimelineItem[] = (activities.data ?? []).map((a) => {
    let summary: string;
    if (a.type === "change" && a.field) {
      const info = fieldInfo.get(a.field);
      summary = `${info?.label ?? a.field.replace(/_/g, " ")}: ${valueText(a.old_value, info?.options)} to ${valueText(a.new_value, info?.options)}`;
    } else {
      const outcome = a.outcome ? (outcomeLabels.get(a.outcome) ?? a.outcome) : null;
      summary = [channelLabels[a.channel] ?? a.channel, outcome].filter(Boolean).join(": ");
    }
    return {
      id: a.id,
      date: a.date,
      type: a.type,
      channel: a.channel,
      outcome: a.outcome,
      summary,
      notes: a.notes,
      who: a.created_by ? (who.get(a.created_by) ?? null) : null,
      contactName: contactName(a.contact_id),
    };
  });

  const name = row.full_name || personName(row.first_name, row.last_name) || "Unknown contact";
  const template = profile.error ? null : (profile.data?.dial_template ?? null);
  const number = row.phone?.trim() || c.general_phone?.trim() || null;
  const dial = number
    ? { number, kind: row.phone?.trim() ? ("contact" as const) : ("general" as const), href: dialHref(number, template) }
    : null;
  const known = new Set<string>(callOutcomes.map((o) => o.value));
  const outcomes = pickable(lists.call_outcome)
    .filter((o) => known.has(o.value))
    .map((o) => ({ value: o.value as CallOutcome, label: o.label, description: o.description }));

  const others = [...rows.values()]
    .filter((r) => r.company_id === entry.companyId && r.id !== row.id)
    .sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9))
    .map((r) => ({
      id: r.id,
      name: r.full_name || personName(r.first_name, r.last_name) || "Unknown",
      title: r.title,
      phone: r.phone,
      status: labelOf(contactStatuses, r.status),
    }));

  return {
    contact: {
      id: row.id,
      name,
      title: row.title,
      role: row.role,
      route: row.route,
      phone: row.phone,
      email: row.email,
      linkedinUrl: row.linkedin_url,
      status: labelOf(contactStatuses, row.status),
      attempts: row.attempts,
      lastAttemptAt: row.last_attempt_at,
      callbackAt: row.callback_at,
      callerNote: row.caller_note,
      referredTo: row.referred_to,
    },
    company: {
      id: c.id,
      name: c.name,
      prio: c.prio,
      city: c.city,
      sector: c.sector,
      website: c.website ?? (c.domain && !c.domain.startsWith("nodomain:") ? `https://${c.domain}` : null),
      description: c.description,
      openingLine: c.opening_line,
      redFlags: c.red_flags ?? [],
      generalPhone: c.general_phone,
    },
    dial,
    outcomes: outcomes.length > 0 ? outcomes : callOutcomes.map((o) => ({ value: o.value, label: o.label, description: null })),
    vacancies: (signals.data ?? []).map((s) => {
      const since = s.posted_at ?? s.first_seen_at;
      return {
        id: s.id,
        title: s.title,
        roleGroup: s.role_group,
        daysOpen: since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 86_400_000)) : null,
        url: s.source_url && /^https?:\/\//i.test(s.source_url) ? s.source_url : null,
        postedAt: s.posted_at,
        firstSeenAt: s.first_seen_at,
        description: s.description,
      };
    }),
    others,
    timeline,
    queue: {
      position: index + 1,
      total,
      source: entry.source,
      listName: entry.listId ? (listNames.get(entry.listId) ?? null) : null,
    },
    booking: actor.bookingBase
      ? { base: actor.bookingBase, name, email: row.email, callerId: actor.callerId }
      : null,
  };
}

/** Holds the next contact of the queue that nobody else has open, and returns its card. */
export async function nextCall(actor: CallActor, scope: QueueScope, exclude: string[]): Promise<CallStep> {
  const queue = await loadQueue(actor.db, scope, { actorId: actor.actorId, exclude });
  const listNames = new Map(queue.lists.map((l) => [l.id, l.name]));
  const total = queue.entries.length;
  for (let i = 0; i < Math.min(total, MAX_CLAIM_TRIES); i++) {
    const entry = queue.entries[i];
    const { data: held, error } = await actor.db.rpc("sales_claim_contact", {
      p_contact: entry.contactId,
      p_actor: actor.pActor,
    });
    if (error) {
      console.error("nextCall claim", error.code, error.message);
      if (error.code === "42501") return { card: null, remaining: 0, error: "You no longer have access to calling." };
      continue;
    }
    // Opened by someone else in the meantime: skip to the next.
    if (!held) continue;
    const card = await loadCard(actor, entry, i, total, queue.rows, listNames);
    if (card) return { card, remaining: total - i - 1 };
    await releaseCall(actor, entry.contactId);
  }
  return { card: null, remaining: 0 };
}

export const callInputSchema = z
  .object({
    contactId: z.guid(),
    outcome: z.enum(callOutcomes.map((o) => o.value) as [CallOutcome, ...CallOutcome[]]),
    callbackAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick a date to call back" })
      .nullish(),
    referredName: z.string().trim().max(200).nullish(),
    referredTitle: z.string().trim().max(200).nullish(),
    referredPhone: z.string().trim().max(50).nullish(),
    note: z.string().trim().max(5000).nullish(),
  })
  .refine((v) => v.outcome !== "call_back" || Boolean(v.callbackAt), { error: "Pick a date to call back", path: ["callbackAt"] })
  .refine((v) => v.outcome !== "referred" || Boolean(v.referredName), {
    error: "Who were you referred to?",
    path: ["referredName"],
  });

export type CallInput = z.input<typeof callInputSchema>;

const sqlMessages = [
  "Open this contact on the call screen first",
  "Pick a date to call back",
  "Who were you referred to?",
];

/** Logs one outcome (sales_log_call applies every call rule) and holds the next contact. */
export async function logCall(actor: CallActor, scope: QueueScope, input: CallInput, exclude: string[]): Promise<CallStep> {
  const parsed = callInputSchema.safeParse(input);
  if (!parsed.success) {
    return { card: null, remaining: 0, error: parsed.error.issues[0]?.message ?? "Check the outcome." };
  }
  const v = parsed.data;
  const { data, error } = await actor.db.rpc("sales_log_call", {
    p_contact: v.contactId,
    p_outcome: v.outcome,
    p_callback_at: v.outcome === "call_back" ? (v.callbackAt ?? null) : null,
    p_referred_name: v.outcome === "referred" ? (v.referredName ?? null) : null,
    p_referred_title: v.outcome === "referred" ? v.referredTitle || null : null,
    p_referred_phone: v.outcome === "referred" ? v.referredPhone || null : null,
    p_note: v.note || null,
    p_actor: actor.pActor,
  });
  if (error) {
    console.error("logCall", error.code, error.message);
    const known = sqlMessages.find((m) => error.message.includes(m));
    return {
      card: null,
      remaining: 0,
      error: known
        ? known === sqlMessages[0]
          ? "This contact was released (open for more than 30 minutes or taken over). Open the next contact."
          : known
        : "The outcome was not saved. Please try again.",
    };
  }
  const next = await nextCall(actor, scope, [...exclude, v.contactId]);
  return {
    ...next,
    logged: { outcome: labelOf(callOutcomes, v.outcome), attempts: data?.attempts ?? 0 },
  };
}

/** Lets go of a contact without an outcome. */
export async function releaseCall(actor: CallActor, contactId: string): Promise<void> {
  if (!z.guid().safeParse(contactId).success) return;
  const { error } = await actor.db.rpc("sales_release_contact", { p_contact: contactId, p_actor: actor.pActor });
  if (error) console.error("releaseCall", error.code, error.message);
}

/** "Next contact": releases the current one and holds the next in queue order. */
export async function skipCall(actor: CallActor, scope: QueueScope, contactId: string | null, exclude: string[]): Promise<CallStep> {
  if (contactId) await releaseCall(actor, contactId);
  return nextCall(actor, scope, contactId ? [...exclude, contactId] : exclude);
}

/** A queue scope from the browser (the team picks a list or the sequence calls). */
export function teamScope(input: unknown): QueueScope | null {
  const parsed = z
    .union([z.object({ kind: z.literal("list"), listId: z.guid() }), z.object({ kind: z.literal("sequence") })])
    .safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** The ids the browser sends as already handled in this session: at most 500 valid ids. */
export function cleanExclude(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((v): v is string => typeof v === "string" && z.guid().safeParse(v).success).slice(-500);
}
