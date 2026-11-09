import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { applyView, type ViewConfig } from "@/lib/sales/grid";
import { loadContactRows, loadViews } from "@/lib/sales/data";
import { accessorsFor, closedContactStatuses, contactColumns, defaultContactSort, type ContactRow } from "@/lib/sales/rows";
import { amsterdamDate } from "@/lib/sales/status";

// The call queue (feedback Julius, section 2.9 and 2.10).
//
// An external caller works through, in this order:
//   1. contacts assigned to them directly (assigned_until empty or today or later),
//   2. call steps of sequences that are due (only contacts they may call),
//   3. the call lists opened for them, in their order (call_list_callers.position);
//      within a list the order of the saved view, exactly as the table shows it.
// The team calls one call list at a time, or the sequence calls due today.
//
// The pure part (callBlockReason, buildQueue) has no database access and is
// tested in tests/queue.test.ts; the loaders below feed it.

type Db = SupabaseClient<Database>;

/** A contact on the call screen is held for 30 minutes (sales_claim_contact). */
export const CLAIM_MINUTES = 30;

export type QueueSource = "assigned" | "sequence" | "list";

export type QueueEntry = {
  contactId: string;
  companyId: string;
  source: QueueSource;
  /** The call list it came from, for source "list". */
  listId: string | null;
};

export type QueueList = { id: string; name: string; config: ViewConfig };

export type DueCallStep = { company_id: string; contact_id: string | null; due_date: string };

export type SuppressionEntry = {
  contact_id: string | null;
  company_id: string | null;
  email: string | null;
  scope: string;
};

export type SuppressionIndex = { contactIds: Set<string>; companyIds: Set<string>; emails: Set<string> };

/** Suppressions that block calling: all channels or calls only (public.is_suppressed with 'bellen'). */
export function suppressionIndex(rows: SuppressionEntry[]): SuppressionIndex {
  const index: SuppressionIndex = { contactIds: new Set(), companyIds: new Set(), emails: new Set() };
  for (const s of rows) {
    if (s.scope !== "alle_kanalen" && s.scope !== "alleen_bellen") continue;
    if (s.contact_id) index.contactIds.add(s.contact_id);
    if (s.company_id) index.companyIds.add(s.company_id);
    if (s.email) index.emails.add(s.email.trim().toLowerCase());
  }
  return index;
}

export type QueueRules = {
  /** YYYY-MM-DD in Amsterdam. */
  today: string;
  now: Date;
  /** The profile that calls (holds contacts on the call screen). */
  actorId: string;
  /** The caller row of an external caller; null for the team. */
  callerId: string | null;
  /** Company id to its general number, for contacts without a number of their own. */
  generalPhones: Map<string, string | null>;
  suppression: SuppressionIndex;
  /** Contacts already handled or skipped in this calling session. */
  exclude?: Set<string>;
};

export type BlockReason =
  | "closed"
  | "assigned_elsewhere"
  | "claimed"
  | "callback_later"
  | "called_today"
  | "company_blocked"
  | "in_pipeline"
  | "suppressed"
  | "no_phone"
  | "excluded";

/** Whether the contact is assigned to a caller right now (today counts). */
export function isAssignedNow(row: Pick<ContactRow, "assigned_caller_id" | "assigned_until">, today: string): boolean {
  return Boolean(row.assigned_caller_id) && (row.assigned_until == null || row.assigned_until >= today);
}

/** Why a contact may not be called now, or null when it may. */
export function callBlockReason(row: ContactRow, rules: QueueRules): BlockReason | null {
  if (rules.exclude?.has(row.id)) return "excluded";
  if (closedContactStatuses.includes(row.status)) return "closed";
  if (row.company_lead_status === "no_go" || row.company_lead_status === "do_not_contact") return "company_blocked";
  if (row.company_pipeline_stage != null && row.company_pipeline_stage !== "lost") return "in_pipeline";
  if (isAssignedNow(row, rules.today) && row.assigned_caller_id !== rules.callerId) return "assigned_elsewhere";
  if (
    row.claimed_by &&
    row.claimed_by !== rules.actorId &&
    row.claimed_at &&
    rules.now.getTime() - new Date(row.claimed_at).getTime() < CLAIM_MINUTES * 60_000
  ) {
    return "claimed";
  }
  if (row.callback_at && row.callback_at > rules.today) return "callback_later";
  // Tried today already: the next attempt is another day, unless a call back is set for today.
  if (row.last_attempt_at && amsterdamDate(row.last_attempt_at) === rules.today && row.callback_at !== rules.today) {
    return "called_today";
  }
  const email = row.email?.trim().toLowerCase();
  if (
    rules.suppression.contactIds.has(row.id) ||
    rules.suppression.companyIds.has(row.company_id) ||
    (email && rules.suppression.emails.has(email))
  ) {
    return "suppressed";
  }
  if (!row.phone?.trim() && !rules.generalPhones.get(row.company_id)?.trim()) return "no_phone";
  return null;
}

/** The contacts of a call list, in the order of the saved view. */
export function listContacts(rows: ContactRow[], config: ViewConfig): ContactRow[] {
  return applyView(rows, config, {
    accessors: accessorsFor(contactColumns),
    defaultSort: defaultContactSort,
    pinnedAt: (r) => r.pinned_at,
    manualPosition: (r) => r.manual_position,
  });
}

/**
 * The contact a sequence call step is for: its own contact, else the primary
 * contact of the company, else the first contact of the company by tier.
 */
function contactForStep(step: DueCallStep, byId: Map<string, ContactRow>, byCompany: Map<string, ContactRow[]>) {
  if (step.contact_id) return byId.get(step.contact_id) ?? null;
  const contacts = byCompany.get(step.company_id) ?? [];
  return (
    contacts.find((c) => c.is_primary) ??
    [...contacts].sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9))[0] ??
    null
  );
}

export type QueueInput = {
  rows: ContactRow[];
  /** Include contacts assigned to rules.callerId. */
  assigned: boolean;
  /** Call lists in the order they are worked through. */
  lists: QueueList[];
  /** Open sequence call steps that are due. */
  sequenceSteps: DueCallStep[];
  /**
   * "callable": only steps for contacts that are also assigned or on one of
   * the lists (an external caller); "all": every due step (the team).
   */
  sequenceScope: "callable" | "all";
};

/** The queue in calling order, without duplicates and without contacts that may not be called. */
export function buildQueue(input: QueueInput, rules: QueueRules): QueueEntry[] {
  const byId = new Map(input.rows.map((r) => [r.id, r]));
  const byCompany = new Map<string, ContactRow[]>();
  for (const r of input.rows) {
    const list = byCompany.get(r.company_id);
    if (list) list.push(r);
    else byCompany.set(r.company_id, [r]);
  }

  const assigned =
    input.assigned && rules.callerId
      ? input.rows.filter((r) => r.assigned_caller_id === rules.callerId && isAssignedNow(r, rules.today))
      : [];
  const lists = input.lists.map((list) => ({ list, rows: listContacts(input.rows, list.config) }));

  const reachable = new Set<string>([...assigned.map((r) => r.id), ...lists.flatMap((l) => l.rows.map((r) => r.id))]);
  const stepRows = [...input.sequenceSteps]
    .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0))
    .filter((s) => s.due_date <= rules.today)
    .map((s) => contactForStep(s, byId, byCompany))
    .filter((r): r is ContactRow => r !== null && (input.sequenceScope === "all" || reachable.has(r.id)));

  const out: QueueEntry[] = [];
  const seen = new Set<string>();
  const add = (row: ContactRow, source: QueueSource, listId: string | null) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    if (callBlockReason(row, rules) !== null) return;
    out.push({ contactId: row.id, companyId: row.company_id, source, listId });
  };

  for (const r of assigned) add(r, "assigned", null);
  for (const r of stepRows) add(r, "sequence", null);
  for (const { list, rows } of lists) for (const r of rows) add(r, "list", list.id);
  return out;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/** Which queue to build: an external caller's own, a call list, or the sequence calls due today. */
export type QueueScope = { kind: "caller"; callerId: string } | { kind: "list"; listId: string } | { kind: "sequence" };

async function loadRules(db: Db, actorId: string, callerId: string | null, exclude: string[]) {
  const [phones, suppressions] = await Promise.all([
    db.from("companies").select("id, general_phone").not("general_phone", "is", null).limit(20000),
    db.from("suppression").select("contact_id, company_id, email, scope").in("scope", ["alle_kanalen", "alleen_bellen"]).limit(20000),
  ]);
  if (phones.error) throw new Error(phones.error.message);
  if (suppressions.error) throw new Error(suppressions.error.message);
  const now = new Date();
  const rules: QueueRules = {
    today: amsterdamDate(now),
    now,
    actorId,
    callerId,
    generalPhones: new Map((phones.data ?? []).map((c) => [c.id, c.general_phone])),
    suppression: suppressionIndex(suppressions.data ?? []),
    exclude: new Set(exclude),
  };
  return rules;
}

async function dueCallSteps(db: Db, today: string): Promise<DueCallStep[]> {
  const { data, error } = await db
    .from("sequence_tasks")
    .select("company_id, contact_id, due_date")
    .eq("channel", "call")
    .eq("status", "open")
    .lte("due_date", today)
    .order("due_date")
    .limit(5000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The call lists opened for a caller today, in their order. */
export async function openListsFor(db: Db, callerId: string, today = amsterdamDate()): Promise<(QueueList & { openUntil: string | null })[]> {
  const [{ data: links, error }, views] = await Promise.all([
    db.from("call_list_callers").select("view_id, position, open_until").eq("caller_id", callerId).order("position"),
    loadViews(db, "contacts", { callListsOnly: true }),
  ]);
  if (error) throw new Error(error.message);
  const byId = new Map(views.map((v) => [v.id, v]));
  return (links ?? [])
    .filter((l) => l.open_until == null || l.open_until >= today)
    .flatMap((l) => {
      const view = byId.get(l.view_id);
      return view ? [{ id: view.id, name: view.name, config: view.config, openUntil: l.open_until }] : [];
    });
}

export type LoadedQueue = { entries: QueueEntry[]; rows: Map<string, ContactRow>; lists: QueueList[] };

/**
 * Builds a queue. db is the session client for the team and the secret key
 * client for external callers (they have no table access of their own).
 */
export async function loadQueue(
  db: Db,
  scope: QueueScope,
  { actorId, exclude = [] }: { actorId: string; exclude?: string[] },
): Promise<LoadedQueue> {
  const callerId = scope.kind === "caller" ? scope.callerId : null;
  const rules = await loadRules(db, actorId, callerId, exclude);
  const [rows, lists, steps] = await Promise.all([
    loadContactRows(db),
    scope.kind === "caller"
      ? openListsFor(db, scope.callerId, rules.today)
      : scope.kind === "list"
        ? loadViews(db, "contacts", { callListsOnly: true }).then((views) =>
            views.filter((v) => v.id === scope.listId).map((v) => ({ id: v.id, name: v.name, config: v.config })),
          )
        : Promise.resolve([]),
    scope.kind === "list" ? Promise.resolve([]) : dueCallSteps(db, rules.today),
  ]);
  const entries = buildQueue(
    {
      rows,
      assigned: scope.kind === "caller",
      lists,
      sequenceSteps: steps,
      sequenceScope: scope.kind === "caller" ? "callable" : "all",
    },
    rules,
  );
  return { entries, rows: new Map(rows.map((r) => [r.id, r])), lists };
}

/**
 * For the Call lists page: per list the contacts in it and how many the team
 * could call now (the same rules as the call screen), plus the sequence calls
 * due today.
 */
export async function countCallLists(
  db: Db,
  lists: QueueList[],
  actorId: string,
): Promise<{ lists: Map<string, { total: number; callable: number }>; sequenceDue: number }> {
  const rules = await loadRules(db, actorId, null, []);
  const [rows, steps] = await Promise.all([loadContactRows(db), dueCallSteps(db, rules.today)]);
  const out = new Map<string, { total: number; callable: number }>();
  for (const list of lists) {
    const total = listContacts(rows, list.config).length;
    const callable = buildQueue({ rows, assigned: false, lists: [list], sequenceSteps: [], sequenceScope: "all" }, rules).length;
    out.set(list.id, { total, callable });
  }
  const sequenceDue = buildQueue({ rows, assigned: false, lists: [], sequenceSteps: steps, sequenceScope: "all" }, rules).length;
  return { lists: out, sequenceDue };
}

/** How many contacts an external caller has in their queue now, in total and per list. */
export async function callerQueueSummary(db: Db, callerId: string, actorId: string) {
  const queue = await loadQueue(db, { kind: "caller", callerId }, { actorId });
  const perList = new Map<string, number>();
  let assigned = 0;
  let sequence = 0;
  for (const e of queue.entries) {
    if (e.source === "list" && e.listId) perList.set(e.listId, (perList.get(e.listId) ?? 0) + 1);
    else if (e.source === "assigned") assigned += 1;
    else sequence += 1;
  }
  return { total: queue.entries.length, assigned, sequence, perList };
}
