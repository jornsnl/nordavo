import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { contactStatuses } from "@/lib/labels";
import type { CallOutcome } from "@/lib/sales/database";
import { callOutcomes, labelOf } from "@/lib/sales/labels";
import { composeNote, nextSteps, outcomeProblem, outcomeScope, wrongPersonReasons } from "@/lib/sales/call-outcome";
import { loadQueue, preferEntries, type QueueEntry, type QueuePreference, type QueueScope } from "@/lib/sales/queue";
import { amsterdamDate } from "@/lib/sales/status";
import type { ContactRow } from "@/lib/sales/rows";
import { pickable } from "@/lib/sales/choices";
import { loadChoiceLists } from "@/lib/sales/flow-data";
import { dialHref } from "@/lib/sales/telephony";
import { callNumbers, cleanDescription, currentOpeningLine, parseRedFlags, prioLine, type RedFlagBrief } from "@/lib/sales/call-brief";
import { loadCheatsheet } from "@/lib/sales/cheatsheet-data";
import type { CheatsheetSection } from "@/lib/sales/cheatsheet";
import { buildSignals, vacancyKinds, type CallSignal } from "@/lib/sales/signals";
import { buildContactTimeline, contactMomentTypes, lastContact, type CallTimelineItem } from "@/lib/sales/timeline";
import { daysOnline, onlineSince } from "@/lib/sales/vacancies";

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

export type { CallTimelineItem };

export type CallContactPerson = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  phone: string | null;
  /** The mobile number was marked as wrong by a caller; the call screen dials the general number instead. */
  phoneWrong: boolean;
  email: string | null;
};

export type CallCard = {
  contact: CallContactPerson & {
    role: string;
    route: string | null;
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
    /** What the prio means (Settings, Sales lists) and one line why this company has it; red flags count against it. */
    prioInfo: { label: string; meaning: string | null; line: string } | null;
    city: string | null;
    sector: string | null;
    employees: number | null;
    website: string | null;
    /** What the company does: the description without source and call list lines, else what the flags say. */
    description: string | null;
    /** The opening line as it is true today (days open counted again), see currentOpeningLine. */
    openingLine: string | null;
    /** The line is about a vacancy that is no longer open. */
    openingLineOutdated: boolean;
    /** Real red flags, as whole sentences. */
    redFlags: string[];
    /** Objections with the answer to give, and questions for the conversation (they used to hide among the red flags). */
    objections: RedFlagBrief["objections"];
    questions: string[];
    facts: string[];
    generalPhone: string | null;
  };
  /** The number to call: the mobile of the contact, else (or when it was marked wrong) the general number; href follows the caller's dial template (tel: or their phone system). */
  dial: { number: string; kind: "contact" | "general"; href: string } | null;
  /** The general number as a fallback, when the main number is the mobile of the contact. */
  generalDial: { number: string; href: string } | null;
  /** The dial template of the person calling, so the browser builds the link for a changed number. */
  dialTemplate: string | null;
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
  /** Signals with kind, date and source, strongest first. */
  signals: CallSignal[];
  others: (CallContactPerson & { status: string; generalPhone: string | null })[];
  /** Calls, mails, LinkedIn and meetings, newest first. */
  timeline: CallTimelineItem[];
  /** The latest of them: when and by whom. */
  lastContact: CallTimelineItem | null;
  /** Sections of the foldable cheat sheet (Settings, Sales lists). */
  cheatsheet: CheatsheetSection[];
  queue: { position: number; total: number; source: QueueEntry["source"]; listName: string | null };
  booking: { base: string; name: string | null; email: string | null; callerId: string | null } | null;
};

/** What the follow-up windows offer: the rejection reasons and, for the team, who can own a next step. */
export type CallOptions = {
  reasons: { value: string; label: string; description: string | null }[];
  owners: { id: string; name: string }[];
  /** The profile of the person calling (the default owner); null for external callers. */
  me: string | null;
};

export type CallStep = {
  card: CallCard | null;
  /** Contacts left in the queue after this one. */
  remaining: number;
  error?: string;
  /** What the last outcome did, for the confirmation line; activityId is what Undo takes. */
  logged?: { outcome: string; attempts: number; activityId: string | null };
  /** Contacts the screen should skip from now on in this session: the one called, and for company outcomes the whole company. */
  handled?: string[];
  options?: CallOptions;
  /** The step is the contact of an undone call, held again. */
  undone?: boolean;
};

/** The number of contacts the call screen tries to hold before it gives up for now. */
const MAX_CLAIM_TRIES = 25;

function personName(first: string | null, last: string | null) {
  return [first, last].filter(Boolean).join(" ").trim();
}

async function loadCard(actor: CallActor, entry: QueueEntry, index: number, total: number, rows: Map<string, ContactRow>, listNames: Map<string, string>): Promise<CallCard | null> {
  const { db } = actor;
  const row = rows.get(entry.contactId);
  const [company, signals, activities, profile, lists, cheatsheet, wrong] = await Promise.all([
    db
      .from("companies")
      .select("id, name, domain, website, prio, prio_reason, city, sector, employees, description, opening_line, red_flags, general_phone")
      .eq("id", entry.companyId)
      .maybeSingle(),
    db
      .from("signals")
      .select("id, type, title, source, role_group, posted_at, first_seen_at, source_url, last_seen_at, description, closed_at")
      .eq("company_id", entry.companyId)
      .is("closed_at", null)
      .order("last_seen_at", { ascending: false })
      .limit(40),
    // Only contact moments: calls, mails, LinkedIn and meetings (no field changes or views).
    db
      .from("activities")
      .select("id, date, type, channel, outcome, notes, created_by, caller_id, contact_id")
      .eq("company_id", entry.companyId)
      .in("type", [...contactMomentTypes])
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(60),
    db.from("profiles").select("dial_template").eq("id", actor.actorId).maybeSingle(),
    loadChoiceLists(db),
    loadCheatsheet(db),
    // Numbers marked as wrong; without the column (migration not applied) none is.
    db.from("contacts").select("id, phone_wrong_at").eq("company_id", entry.companyId).not("phone_wrong_at", "is", null),
  ]);
  if (!row || !company.data) return null;
  const c = company.data;
  const wrongPhone = new Set((wrong.error ? [] : (wrong.data ?? [])).map((w) => w.id));

  const people = new Set((activities.data ?? []).map((a) => a.created_by).filter((v): v is string => Boolean(v)));
  const callerIds = new Set((activities.data ?? []).map((a) => a.caller_id).filter((v): v is string => Boolean(v)));
  const [{ data: profiles }, { data: callerRows }] = await Promise.all([
    people.size > 0 ? db.from("profiles").select("id, full_name, email").in("id", [...people]) : Promise.resolve({ data: [] }),
    callerIds.size > 0 ? db.from("callers").select("id, name").in("id", [...callerIds]) : Promise.resolve({ data: [] }),
  ]);
  const who = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email?.split("@")[0] || "Someone"]));
  const callerNames = new Map((callerRows ?? []).map((r) => [r.id, r.name]));
  const contactNames = new Map<string, string>();
  for (const r of rows.values()) {
    if (r.company_id === entry.companyId) contactNames.set(r.id, r.full_name || personName(r.first_name, r.last_name) || "Unknown contact");
  }
  const timeline = buildContactTimeline(activities.data ?? [], who, contactNames, callerNames);

  const name = row.full_name || personName(row.first_name, row.last_name) || "Unknown contact";
  const template = profile.error ? null : (profile.data?.dial_template ?? null);
  const { dial, generalDial } = callNumbers({ phone: row.phone, phoneWrong: wrongPhone.has(row.id) }, c.general_phone, (n) => dialHref(n, template));
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
      firstName: r.first_name,
      lastName: r.last_name,
      title: r.title,
      phone: r.phone,
      phoneWrong: wrongPhone.has(r.id),
      email: r.email,
      status: labelOf(contactStatuses, r.status),
      generalPhone: c.general_phone?.trim() || null,
    }));

  // Vacancies: the signal rows that are a vacancy. Days open are counted from the posted date like the Vacancies block says.
  const openSignals = signals.data ?? [];
  const isVacancy = (type: string) => (vacancyKinds as readonly string[]).includes(type);
  const vacancies = openSignals
    .filter((s) => isVacancy(s.type))
    .map((s) => ({
      id: s.id,
      title: s.title,
      roleGroup: s.role_group,
      daysOpen: daysOnline(onlineSince({ posted_at: s.posted_at, first_seen_at: s.first_seen_at })),
      url: s.source_url && /^https?:\/\//i.test(s.source_url) ? s.source_url : null,
      postedAt: s.posted_at,
      firstSeenAt: s.first_seen_at,
      description: s.description,
    }));
  const summary = buildSignals(
    openSignals.map((s) => ({ ...s, type: String(s.type) })),
    pickable(lists.signal_type).map((o) => ({ value: o.value, label: o.label })),
  );

  const brief = parseRedFlags(c.red_flags);
  const opening = currentOpeningLine(c.opening_line, vacancies.map((v) => ({ title: v.title, days: v.daysOpen })));
  const prio = lists.prio.find((o) => o.value === String(c.prio));

  return {
    contact: {
      id: row.id,
      name,
      firstName: row.first_name,
      lastName: row.last_name,
      title: row.title,
      role: row.role,
      route: row.route,
      phone: row.phone,
      phoneWrong: wrongPhone.has(row.id),
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
      prioInfo:
        c.prio === null
          ? null
          : {
              label: prio?.label ?? `P${c.prio}`,
              meaning: prio?.description ?? null,
              line: prioLine({ reason: c.prio_reason, strongestSignal: summary.strongestText, redFlags: brief.redFlags }),
            },
      city: c.city,
      sector: c.sector,
      employees: c.employees,
      website: c.website ?? (c.domain && !c.domain.startsWith("nodomain:") ? `https://${c.domain}` : null),
      description: cleanDescription(c.description) ?? brief.whatTheyDo,
      openingLine: opening?.text ?? null,
      openingLineOutdated: opening?.outdated ?? false,
      redFlags: brief.redFlags,
      objections: brief.objections,
      questions: brief.questions,
      facts: brief.facts,
      generalPhone: c.general_phone,
    },
    dial,
    generalDial,
    dialTemplate: template,
    outcomes: outcomes.length > 0 ? outcomes : callOutcomes.map((o) => ({ value: o.value, label: o.label, description: null })),
    vacancies,
    signals: summary.signals,
    others,
    timeline,
    lastContact: lastContact(timeline),
    cheatsheet: cheatsheet.filter((s) => !s.hidden),
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

async function callOptions(actor: CallActor): Promise<CallOptions> {
  const lists = await loadChoiceLists(actor.db);
  const reasons = pickable(lists.reject_reason).map((o) => ({ value: o.value, label: o.label, description: o.description }));
  // External callers do not see who is on the team; the next step stays with Nordavo.
  if (actor.callerId) return { reasons, owners: [], me: null };
  const { data } = await actor.db.from("profiles").select("id, full_name, email, role, modules").in("role", ["admin", "member"]);
  const owners = (data ?? [])
    .filter((p) => p.role === "admin" || (p.modules ?? []).includes("sales"))
    .map((p) => ({ id: p.id, name: p.full_name || p.email?.split("@")[0] || "Team member" }))
    .sort((a, b) => Number(b.id === actor.actorId) - Number(a.id === actor.actorId) || a.name.localeCompare(b.name));
  return { reasons, owners, me: actor.actorId };
}

/**
 * Holds the next contact of the queue that nobody else has open, and returns its card.
 * prefer puts a contact, or the rest of a company, first (see preferEntries).
 */
export async function nextCall(actor: CallActor, scope: QueueScope, exclude: string[], prefer?: QueuePreference): Promise<CallStep> {
  const queue = await loadQueue(actor.db, scope, { actorId: actor.actorId, exclude });
  const entries = preferEntries(queue.entries, queue.rows, queue.rules, prefer);
  const listNames = new Map(queue.lists.map((l) => [l.id, l.name]));
  const total = entries.length;
  for (let i = 0; i < Math.min(total, MAX_CLAIM_TRIES); i++) {
    const entry = entries[i];
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
    if (card) return { card, remaining: total - i - 1, options: await callOptions(actor) };
    await releaseCall(actor, entry.contactId);
  }
  return { card: null, remaining: 0 };
}

const optionalText = (max: number) => z.string().trim().max(max).nullish();
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick a date" })
  .nullish();
const stepValues = nextSteps.map((s) => s.value) as [(typeof nextSteps)[number]["value"], ...(typeof nextSteps)[number]["value"][]];
const wrongValues = wrongPersonReasons.map((r) => r.value) as [
  (typeof wrongPersonReasons)[number]["value"],
  ...(typeof wrongPersonReasons)[number]["value"][],
];

export const callInputSchema = z
  .object({
    contactId: z.guid(),
    outcome: z.enum(callOutcomes.map((o) => o.value) as [CallOutcome, ...CallOutcome[]]),
    callbackAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick a date to call back" })
      .nullish(),
    callbackTime: optionalText(5),
    callbackWith: optionalText(200),
    referredName: optionalText(200),
    referredTitle: optionalText(200),
    referredPhone: optionalText(50),
    referredEmail: optionalText(200),
    // Values of the rejection reasons list (Settings, Sales lists).
    reasons: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(20).nullish(),
    reasonText: optionalText(2000),
    until: optionalDate,
    interest: optionalText(1000),
    nextStep: z.enum(stepValues).nullish(),
    nextStepAt: optionalDate,
    nextOwner: z.guid().nullish(),
    meetingReason: optionalText(1000),
    wrongReason: z.enum(wrongValues).nullish(),
    newPhone: optionalText(50),
    note: z.string().trim().max(5000).nullish(),
  })
  .superRefine((v, ctx) => {
    const problem = outcomeProblem(v, amsterdamDate());
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

export type CallInput = z.input<typeof callInputSchema>;

const sqlMessages = [
  "Open this contact on the call screen first",
  "Pick a date to call back",
  "Pick a time to call back",
  "Who were you referred to?",
  "Pick a reason or write one",
  "Pick a date to get back in touch",
  "Pick a date in the future",
  "Pick someone from the team as owner",
];

/** Logs one outcome (sales_log_call applies every call rule) and holds the next contact. */
export async function logCall(actor: CallActor, scope: QueueScope, input: CallInput, exclude: string[]): Promise<CallStep> {
  const parsed = callInputSchema.safeParse(input);
  if (!parsed.success) {
    return { card: null, remaining: 0, error: parsed.error.issues[0]?.message ?? "Check the outcome." };
  }
  const v = parsed.data;
  const o = v.outcome;
  // Labels of the chosen reasons, for the lost reason on the company (the list can be renamed).
  let reasonLabel: string | null = null;
  if (o === "reached_not_interested" && (v.reasons?.length ?? 0) > 0) {
    const lists = await loadChoiceLists(actor.db);
    reasonLabel = (v.reasons ?? []).map((r) => lists.reject_reason.find((x) => x.value === r)?.label ?? r).join(", ");
  }
  const withPerson = o === "referred" || o === "wrong_person";
  const { data, error } = await actor.db.rpc("sales_log_call", {
    p_contact: v.contactId,
    p_outcome: o,
    p_callback_at: o === "call_back" ? (v.callbackAt ?? null) : null,
    p_callback_time: o === "call_back" ? v.callbackTime?.trim() || null : null,
    p_callback_with: o === "call_back" ? v.callbackWith || null : null,
    p_referred_name: withPerson ? (v.referredName ?? null) : null,
    p_referred_title: withPerson ? v.referredTitle || null : null,
    p_referred_phone: withPerson ? v.referredPhone || null : null,
    p_referred_email: withPerson ? v.referredEmail || null : null,
    p_reasons: o === "reached_not_interested" ? (v.reasons ?? []) : null,
    p_reason_text: o === "reached_not_interested" ? v.reasonText || null : null,
    p_reason_label: reasonLabel,
    p_until: o === "reached_not_interested" ? (v.until ?? null) : null,
    p_next_step: o === "reached_interested" ? (nextSteps.find((s) => s.value === v.nextStep)?.label ?? null) : null,
    p_next_step_at: o === "reached_interested" ? (v.nextStepAt ?? null) : null,
    // External callers do not pick an owner: the next step stays with Nordavo.
    p_next_owner: o === "reached_interested" && !actor.callerId ? (v.nextOwner ?? null) : null,
    p_new_phone: o === "wrong_number" ? v.newPhone || null : null,
    p_note: composeNote(v, reasonLabel),
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

  // Person outcomes (no answer, wrong number, wrong person): the next contact of the same
  // company. Company outcomes (call back, interested, meeting planned, not interested): the
  // whole company is done for this session, so the next company follows. After Referred the
  // referred contact is next.
  const { data: contact } = await actor.db.from("contacts").select("company_id").eq("id", v.contactId).maybeSingle();
  const companyId = contact?.company_id ?? null;
  const handled = [v.contactId];
  if (outcomeScope[o] === "company" && companyId) {
    const { data: siblings } = await actor.db.from("contacts").select("id").eq("company_id", companyId);
    for (const s of siblings ?? []) if (!handled.includes(s.id)) handled.push(s.id);
  }
  const prefer: QueuePreference | undefined =
    o === "referred"
      ? { contactId: data?.new_contact_id ?? null, companyId }
      : outcomeScope[o] === "person"
        ? { companyId }
        : undefined;
  const next = await nextCall(actor, scope, [...exclude, ...handled], prefer);
  return {
    ...next,
    handled,
    logged: { outcome: labelOf(callOutcomes, o), attempts: data?.attempts ?? 0, activityId: data?.activity_id ?? null },
  };
}

const undoMessages: Record<string, string> = {
  "Too late to undo": "Too late to undo this call.",
  "Nothing to undo": "This call can no longer be undone.",
  "This contact was changed after the call": "Somebody else changed this contact after your call, so it cannot be undone.",
};

/**
 * Undo (feedback Julius, 66065265): sales_undo_call puts back everything the call
 * changed and holds the contact again, then the contact open now (the next one) is
 * let go. When the undo is refused the screen keeps the contact it has.
 */
export async function undoCall(actor: CallActor, scope: QueueScope, activityId: string, current: string | null): Promise<CallStep> {
  if (!z.guid().safeParse(activityId).success) return { card: null, remaining: 0, error: undoMessages["Nothing to undo"] };
  const { data, error } = await actor.db.rpc("sales_undo_call", { p_activity: activityId, p_actor: actor.pActor });
  if (error || !data) {
    if (error) console.error("undoCall", error.code, error.message);
    const known = Object.keys(undoMessages).find((m) => error?.message.includes(m));
    return { card: null, remaining: 0, error: known ? undoMessages[known] : "The undo did not work. Please try again." };
  }
  if (current && current !== data.contact_id) await releaseCall(actor, current);
  const queue = await loadQueue(actor.db, scope, { actorId: actor.actorId, exclude: [] });
  const row = queue.rows.get(data.contact_id);
  const failed = { card: null, remaining: 0, error: "The call was undone, but the contact could not be opened. Check again." };
  if (!row) return failed;
  const index = queue.entries.findIndex((e) => e.contactId === data.contact_id);
  const entry: QueueEntry =
    index >= 0 ? queue.entries[index] : { contactId: row.id, companyId: row.company_id, source: "list", listId: null };
  const listNames = new Map(queue.lists.map((l) => [l.id, l.name]));
  const card = await loadCard(actor, entry, Math.max(0, index), Math.max(queue.entries.length, 1), queue.rows, listNames);
  if (!card) return failed;
  return { card, remaining: Math.max(queue.entries.length - 1, 0), options: await callOptions(actor), undone: true };
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
