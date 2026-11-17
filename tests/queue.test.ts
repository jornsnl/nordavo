import { test } from "node:test";
import assert from "node:assert/strict";
import type { ContactRow } from "@/lib/sales/rows";
import { roundRobinByCompany } from "@/lib/sales/assign";
import {
  buildQueue,
  callBlockReason,
  preferEntries,
  suppressionIndex,
  type QueueEntry,
  type QueueInput,
  type QueueRules,
} from "@/lib/sales/queue";

const today = "2026-11-10";
const now = new Date("2026-11-10T10:00:00Z");

function contact(id: string, fields: Partial<ContactRow> = {}): ContactRow {
  return {
    id,
    company_id: `co-${id}`,
    company_name: `Company ${id}`,
    company_prio: 3,
    company_category: null,
    company_lead_status: "ready",
    company_pipeline_stage: null,
    company_city: null,
    company_sector: null,
    company_icp: "GO",
    first_name: id,
    last_name: null,
    full_name: id,
    title: null,
    tier: 1,
    role: "main",
    route: null,
    phone: "+31600000000",
    phone_type: "mobiel",
    email: `${id}@example.nl`,
    email_status: null,
    linkedin_url: null,
    status: "new",
    status_changed_at: "2026-11-01T00:00:00Z",
    attempts: 0,
    last_attempt_at: null,
    callback_at: null,
    referred_to: null,
    caller_note: null,
    assigned_caller_id: null,
    assigned_caller_name: null,
    assigned_until: null,
    claimed_by: null,
    claimed_at: null,
    is_primary: false,
    pinned_at: null,
    manual_position: null,
    last_contacted_at: null,
    created_at: "2026-11-01T00:00:00Z",
    ...fields,
  };
}

function rules(fields: Partial<QueueRules> = {}): QueueRules {
  return {
    today,
    now,
    actorId: "me",
    callerId: "caller-1",
    generalPhones: new Map(),
    suppression: suppressionIndex([]),
    ...fields,
  };
}

const noLists: Pick<QueueInput, "lists" | "sequenceSteps"> = { lists: [], sequenceSteps: [] };

test("callBlockReason applies every rule of the call queue", () => {
  const r = rules();
  assert.equal(callBlockReason(contact("a"), r), null);
  assert.equal(callBlockReason(contact("a", { status: "not_interested" }), r), "closed");
  assert.equal(callBlockReason(contact("a", { status: "not_reached" }), r), "closed");
  assert.equal(callBlockReason(contact("a", { company_lead_status: "no_go" }), r), "company_blocked");
  assert.equal(callBlockReason(contact("a", { company_lead_status: "do_not_contact" }), r), "company_blocked");
  assert.equal(callBlockReason(contact("a", { company_pipeline_stage: "interested" }), r), "in_pipeline");
  assert.equal(callBlockReason(contact("a", { company_pipeline_stage: "lost" }), r), null);
  assert.equal(callBlockReason(contact("a", { assigned_caller_id: "caller-2" }), r), "assigned_elsewhere");
  assert.equal(callBlockReason(contact("a", { assigned_caller_id: "caller-2", assigned_until: "2026-11-09" }), r), null);
  assert.equal(callBlockReason(contact("a", { assigned_caller_id: "caller-2", assigned_until: today }), r), "assigned_elsewhere");
  assert.equal(callBlockReason(contact("a", { assigned_caller_id: "caller-1" }), r), null);
  // The team never gets contacts that are with a caller.
  assert.equal(callBlockReason(contact("a", { assigned_caller_id: "caller-1" }), rules({ callerId: null })), "assigned_elsewhere");
});

test("callBlockReason: held contacts, call backs and today's attempts", () => {
  const r = rules();
  assert.equal(callBlockReason(contact("a", { claimed_by: "other", claimed_at: "2026-11-10T09:45:00Z" }), r), "claimed");
  assert.equal(callBlockReason(contact("a", { claimed_by: "other", claimed_at: "2026-11-10T09:20:00Z" }), r), null);
  assert.equal(callBlockReason(contact("a", { claimed_by: "me", claimed_at: "2026-11-10T09:59:00Z" }), r), null);
  assert.equal(callBlockReason(contact("a", { callback_at: "2026-11-11" }), r), "callback_later");
  assert.equal(callBlockReason(contact("a", { callback_at: today }), r), null);
  assert.equal(callBlockReason(contact("a", { last_attempt_at: "2026-11-10T08:00:00Z" }), r), "called_today");
  assert.equal(callBlockReason(contact("a", { last_attempt_at: "2026-11-10T08:00:00Z", callback_at: today }), r), null);
  // 23:30 UTC on the 9th is already the 10th in Amsterdam.
  assert.equal(callBlockReason(contact("a", { last_attempt_at: "2026-11-09T23:30:00Z" }), r), "called_today");
  assert.equal(callBlockReason(contact("a", { last_attempt_at: "2026-11-09T12:00:00Z" }), r), null);
  assert.equal(callBlockReason(contact("a"), rules({ exclude: new Set(["a"]) })), "excluded");
});

test("callBlockReason: suppression and phone numbers", () => {
  const suppression = suppressionIndex([
    { contact_id: "s1", company_id: null, email: null, scope: "alle_kanalen" },
    { contact_id: null, company_id: "co-s2", email: null, scope: "alleen_bellen" },
    { contact_id: null, company_id: null, email: "S3@Example.nl", scope: "alle_kanalen" },
    { contact_id: "s4", company_id: null, email: null, scope: "alleen_mail" },
  ]);
  const r = rules({ suppression });
  assert.equal(callBlockReason(contact("s1"), r), "suppressed");
  assert.equal(callBlockReason(contact("s2"), r), "suppressed");
  assert.equal(callBlockReason(contact("s3"), r), "suppressed");
  // Mail only suppression does not stop calls.
  assert.equal(callBlockReason(contact("s4"), r), null);

  assert.equal(callBlockReason(contact("a", { phone: null }), r), "no_phone");
  assert.equal(callBlockReason(contact("a", { phone: " " }), r), "no_phone");
  assert.equal(
    callBlockReason(contact("a", { phone: null }), rules({ generalPhones: new Map([["co-a", "+31501234567"]]) })),
    null,
  );
});

test("buildQueue: assigned first, then due sequence steps, then lists in their order, no duplicates", () => {
  const rows = [
    contact("l1", { company_prio: 2 }),
    contact("l2", { company_prio: 1 }),
    contact("m1"),
    contact("as", { assigned_caller_id: "caller-1", assigned_until: "2026-11-30" }),
    contact("old", { assigned_caller_id: "caller-1", assigned_until: "2026-11-01" }),
    contact("seq", { company_id: "co-seq" }),
    contact("blocked", { status: "do_not_contact" }),
  ];
  const listA = {
    id: "A",
    name: "A",
    config: { filters: [{ column: "full_name", op: "in" as const, value: ["l1", "l2", "seq", "blocked"] }], sort: [] },
  };
  const listB = { id: "B", name: "B", config: { filters: [{ column: "full_name", op: "in" as const, value: ["m1", "l1"] }], sort: [] } };
  const queue = buildQueue(
    {
      rows,
      assigned: true,
      lists: [listA, listB],
      sequenceSteps: [{ company_id: "co-seq", contact_id: null, due_date: "2026-11-09" }],
      sequenceScope: "callable",
    },
    rules(),
  );
  assert.deepEqual(
    queue.map((e) => [e.contactId, e.source, e.listId]),
    [
      ["as", "assigned", null],
      ["seq", "sequence", null],
      // List A sorted by the default order: prio first.
      ["l2", "list", "A"],
      ["l1", "list", "A"],
      ["m1", "list", "B"],
    ],
  );
});

test("buildQueue: sequence steps of a caller only for contacts they may call; the team gets all", () => {
  const rows = [contact("x", { company_id: "co-x", is_primary: true }), contact("y", { company_id: "co-x", tier: 2 })];
  const steps = [
    { company_id: "co-x", contact_id: null, due_date: today },
    { company_id: "co-x", contact_id: "y", due_date: "2026-11-12" },
  ];
  const caller = buildQueue({ rows, assigned: true, ...noLists, sequenceSteps: steps, sequenceScope: "callable" }, rules());
  assert.deepEqual(caller, []);

  const team = buildQueue(
    { rows, assigned: false, lists: [], sequenceSteps: steps, sequenceScope: "all" },
    rules({ callerId: null }),
  );
  // The step without a contact goes to the primary contact; the future step is not due.
  assert.deepEqual(
    team.map((e) => e.contactId),
    ["x"],
  );
});

test("buildQueue: the team never gets assigned contacts even when asked for them", () => {
  const rows = [contact("a", { assigned_caller_id: "caller-1" })];
  const queue = buildQueue({ rows, assigned: true, ...noLists, sequenceScope: "all" }, rules({ callerId: null }));
  assert.deepEqual(queue, []);
});

test("roundRobinByCompany keeps a company with one caller and spreads companies", () => {
  const plan = roundRobinByCompany(
    [
      { id: "a1", company_id: "A" },
      { id: "b1", company_id: "B" },
      { id: "a2", company_id: "A" },
      { id: "c1", company_id: "C" },
    ],
    ["x", "y"],
  );
  assert.deepEqual(plan.get("x"), ["a1", "a2", "c1"]);
  assert.deepEqual(plan.get("y"), ["b1"]);
  assert.equal(roundRobinByCompany([{ id: "a1", company_id: "A" }], []).size, 0);
});

test("callBlockReason: a parked company waits for its date, no go keeps it out", () => {
  const r = rules();
  const parked = (until: string | null) => contact("a", { company_pipeline_stage: "parked", company_parked_until: until });
  assert.equal(callBlockReason(parked("2026-11-20"), r), "in_pipeline");
  assert.equal(callBlockReason(parked(null), r), "in_pipeline");
  // On the day itself the company can be called again.
  assert.equal(callBlockReason(parked(today), r), null);
  assert.equal(callBlockReason(parked("2026-11-01"), r), null);
  // Lost on the call screen: bucket no go (20261123600000_call_outcome_flow.sql).
  assert.equal(callBlockReason(contact("a", { company_pipeline_stage: "lost", company_bucket: "no_go" }), r), "company_blocked");
  assert.equal(callBlockReason(contact("a", { company_pipeline_stage: "lost", company_bucket: "free" }), r), null);
});

function entry(contactId: string, companyId: string): QueueEntry {
  return { contactId, companyId, source: "list", listId: "l1" };
}

test("preferEntries: the rest of the company first after a person outcome, the referred contact first after Referred", () => {
  const r = rules();
  const a1 = contact("a1", { company_id: "A" });
  const a2 = contact("a2", { company_id: "A" });
  const b1 = contact("b1", { company_id: "B" });
  const rows = new Map([a1, a2, b1].map((c) => [c.id, c]));
  // List order: A1 (just called, excluded), B1, A2.
  const entries = [entry("b1", "B"), entry("a2", "A")];

  // Same company first, not the next company in the list.
  assert.deepEqual(
    preferEntries(entries, rows, r, { companyId: "A" }).map((e) => e.contactId),
    ["a2", "b1"],
  );
  // Nobody else at that company: the list order stays.
  assert.deepEqual(
    preferEntries(entries, rows, r, { companyId: "Z" }).map((e) => e.contactId),
    ["b1", "a2"],
  );
  // No preference (company outcome): untouched.
  assert.equal(preferEntries(entries, rows, r, undefined), entries);

  // A referral comes first even when it is not in the queue (not in the list view).
  const referred = contact("r1", { company_id: "A", status: "new" });
  const withReferred = new Map([...rows, [referred.id, referred]]);
  assert.deepEqual(
    preferEntries(entries, withReferred, r, { contactId: "r1", companyId: "A" }).map((e) => e.contactId),
    ["r1", "b1", "a2"],
  );
  // ...unless it may not be called: then the rest of the company follows.
  const noPhone = contact("r2", { company_id: "A", phone: null });
  const blocked = new Map([...rows, [noPhone.id, noPhone]]);
  assert.deepEqual(
    preferEntries(entries, blocked, r, { contactId: "r2", companyId: "A" }).map((e) => e.contactId),
    ["a2", "b1"],
  );
  // A referral that is in the queue moves to the front.
  assert.deepEqual(
    preferEntries(entries, rows, r, { contactId: "a2", companyId: "A" }).map((e) => e.contactId),
    ["a2", "b1"],
  );
});

test("callBlockReason: own contacts and flagged contacts are never called cold", () => {
  const r = rules();
  assert.equal(callBlockReason(contact("a", { company_own_contact: true }), r), "own_contact");
  assert.equal(callBlockReason(contact("a", { company_own_contact: false }), r), null);
  assert.equal(callBlockReason(contact("a", { no_call: true }), r), "contact_blocked");
  assert.equal(callBlockReason(contact("a", { contact_flag: "wrong_number" }), r), "contact_blocked");
  assert.equal(callBlockReason(contact("a", { contact_flag: "left_company" }), r), "contact_blocked");
  assert.equal(callBlockReason(contact("a", { contact_flag: null, no_call: false }), r), null);
});
