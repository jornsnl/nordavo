import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  addWorkingDays,
  buildContactPayload,
  createContact,
  dealStageMap,
  defaultNextAction,
  findContactByEmail,
  listRecentChanges,
  mapCompletedAction,
  mapDealChange,
  mergeContactPayload,
  pushContactToCrm,
  shouldPromoteStatus,
  stageForTrigger,
  stageKeyFor,
} from "@/lib/integrations/onepage";

process.env.ONEPAGE_USER_ID = "user123";
process.env.ONEPAGE_API_KEY = "key456";

const contact = {
  first_name: "Jan",
  last_name: "de Vries",
  title: "CTO",
  email: "jan@acme.nl",
  phone: "+31612345678",
  phone_type: "mobiel",
  linkedin_url: "linkedin.com/in/jandevries",
};
const company = { name: "Acme Software", domain: "acme.nl", website: null, segment: "saas", linkedin_url: null };

test("buildContactPayload maps our fields to OnePageCRM", () => {
  assert.deepEqual(buildContactPayload({ contact, company, signalType: "vacature", reason: "positieve reply" }), {
    first_name: "Jan",
    last_name: "de Vries",
    job_title: "CTO",
    company_name: "Acme Software",
    emails: [{ type: "work", value: "jan@acme.nl" }],
    phones: [{ type: "mobile", value: "+31612345678" }],
    urls: [
      { type: "website", value: "https://acme.nl" },
      { type: "linkedin", value: "https://www.linkedin.com/in/jandevries" },
    ],
    tags: ["nordavo-gtm", "saas", "vacature"],
    background: "positieve reply",
  });
});

test("buildContactPayload never sends an empty name", () => {
  const payload = buildContactPayload({ contact: { ...contact, first_name: null, last_name: null }, company });
  assert.equal(payload.last_name, "Onbekend");
});

test("mergeContactPayload only adds what is missing", () => {
  const payload = buildContactPayload({ contact, company, signalType: "vacature" });
  const patch = mergeContactPayload(
    {
      id: "c1",
      job_title: "Head of Engineering",
      company_name: "Acme",
      emails: [{ type: "work", value: "JAN@acme.nl" }],
      phones: [],
      urls: [{ type: "website", value: "https://acme.nl" }],
      tags: ["vip", "saas"],
    },
    payload,
  );
  assert.deepEqual(patch, {
    phones: [{ type: "mobile", value: "+31612345678" }],
    urls: [
      { type: "website", value: "https://acme.nl" },
      { type: "linkedin", value: "https://www.linkedin.com/in/jandevries" },
    ],
    tags: ["vip", "saas", "nordavo-gtm", "vacature"],
  });
});

test("working days skip the weekend", () => {
  assert.equal(addWorkingDays("2026-10-23", 2), "2026-10-27"); // Friday + 2 = Tuesday
  assert.equal(addWorkingDays("2026-10-26", 2), "2026-10-28");
  assert.deepEqual(defaultNextAction("positieve reply", "2026-10-24"), { text: "Opvolgen: positieve reply", date: "2026-10-27" });
});

test("stage mapping is configurable and maps back to the nearest lower stage", () => {
  assert.equal(stageKeyFor(40), "afspraak_gepland");
  assert.equal(stageKeyFor(45), "afspraak_gepland");
  assert.equal(stageKeyFor(5), "gekwalificeerd");
  assert.equal(stageKeyFor(null), null);
  const map = dealStageMap('{"afspraak_gepland": 35}');
  assert.equal(map.afspraak_gepland, 35);
  assert.equal(map.gesprekken, 90);
  assert.throws(() => dealStageMap("{nope"), /geen geldige JSON/);
  assert.equal(stageForTrigger("afspraak"), "afspraak_gepland");
  assert.equal(stageForTrigger("reply_positief"), "benaderd");
  assert.equal(stageForTrigger(null), "gekwalificeerd");
});

test("contact status only moves forward", () => {
  assert.equal(shouldPromoteStatus("bereikt", "afspraak"), true);
  assert.equal(shouldPromoteStatus("afspraak", "kans"), true);
  assert.equal(shouldPromoteStatus("kans", "afspraak"), false);
  assert.equal(shouldPromoteStatus("klant", "verloren"), false);
  assert.equal(shouldPromoteStatus("verloren", "afspraak"), true);
  assert.equal(shouldPromoteStatus("uitgesloten", "kans"), false);
  assert.equal(shouldPromoteStatus("kans", "verloren"), true);
});

test("mapDealChange turns won, lost and stage changes into activities", () => {
  const won = mapDealChange({ id: "d1", contact_id: "op1", status: "won", stage: 90, modified_at: "2026-10-23T10:00:00Z", name: "Acme" });
  assert.equal(won?.outcome, "gewonnen");
  assert.equal(won?.contactStatus, "klant");
  assert.equal(won?.companyWon, true);
  assert.equal(won?.externalId, "onepage:deal:d1:won:2026-10-23T10:00:00Z");

  const lost = mapDealChange({ id: "d1", contact_id: "op1", status: "lost", text: "Te duur", modified_at: "2026-10-23T10:00:00Z" });
  assert.equal(lost?.outcome, "verloren");
  assert.match(lost?.notes ?? "", /Te duur/);

  assert.equal(mapDealChange({ id: "d2", contact_id: "op1", status: "pending", stage: 30 })?.outcome, "gesprek_gehad");
  assert.equal(mapDealChange({ id: "d2", contact_id: "op1", status: "pending", stage: 40 })?.outcome, "afspraak");
  const intake = mapDealChange({ id: "d2", contact_id: "op1", status: "pending", stage: 50 });
  assert.equal(intake?.outcome, "notitie");
  assert.equal(intake?.stateKey, "onepage:deal:d2:intake_gedaan");
  assert.equal(mapDealChange({ id: "d2", contact_id: "op1", status: "pending", stage: 10 }), null);
  assert.equal(mapDealChange({ id: "d3", status: "won" }), null);
});

test("mapCompletedAction", () => {
  const call = mapCompletedAction({ id: "a1", contact_id: "op1", text: "Salesgesprek voeren", done: true, done_at: "2026-10-22T09:00:00Z" });
  assert.equal(call?.outcome, "gesprek_gehad");
  assert.equal(call?.externalId, "onepage:action:a1:2026-10-22T09:00:00Z");
  assert.equal(mapCompletedAction({ id: "a2", contact_id: "op1", text: "Offerte sturen", status: "done" })?.outcome, "notitie");
  assert.equal(mapCompletedAction({ id: "a3", contact_id: "op1", text: "Bellen", done: false }), null);
});

type Call = { url: string; method: string; auth: string | null; body: unknown };
function mockFetch(responses: unknown[]) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      auth: new Headers(init?.headers).get("authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const next = responses.shift();
    return new Response(JSON.stringify(next), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

test("findContactByEmail uses basic auth and compares emails itself", async () => {
  const calls = mockFetch([
    {
      status: 0,
      message: "OK",
      data: {
        contacts: [
          { contact: { id: "x1", emails: [{ type: "work", value: "other@acme.nl" }] } },
          { contact: { id: "x2", emails: [{ type: "work", value: "Jan@Acme.nl" }], extra: 1 } },
        ],
        total_count: 2,
        max_page: 1,
      },
    },
  ]);
  const found = await findContactByEmail("jan@acme.nl");
  assert.equal(found?.id, "x2");
  assert.equal(calls[0].auth, `Basic ${Buffer.from("user123:key456").toString("base64")}`);
  assert.match(calls[0].url, /^https:\/\/app\.onepagecrm\.com\/api\/v3\/contacts\.json\?email=jan%40acme\.nl/);
});

test("createContact posts the payload and fails loudly on an odd response", async () => {
  const calls = mockFetch([{ status: 0, data: { contact: { id: "new1" } } }, { status: 0, data: { contact: { nope: true } } }]);
  const payload = buildContactPayload({ contact, company });
  assert.equal((await createContact(payload)).id, "new1");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, payload);
  await assert.rejects(() => createContact(payload), /onverwachte vorm/);
});

test("API errors carry the OnePageCRM message", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status: 400, error_name: "invalid_request", error_message: "Missing last_name" }), { status: 400 })) as typeof fetch;
  await assert.rejects(() => createContact(buildContactPayload({ contact, company })), /400: Missing last_name/);
});

test("listRecentChanges pages and keeps only completed actions", async () => {
  const calls = mockFetch([
    { status: 0, data: { deals: [{ deal: { id: "d1", contact_id: "op1", stage: 40, status: "pending" } }], max_page: 1 } },
    {
      status: 0,
      data: {
        actions: [
          { action: { id: "a1", contact_id: "op1", text: "Bellen", done: true } },
          { action: { id: "a2", contact_id: "op1", text: "Later", done: false } },
        ],
        max_page: 1,
      },
    },
  ]);
  const { deals, actions } = await listRecentChanges(new Date("2026-10-20T00:00:00Z"));
  assert.equal(deals.length, 1);
  assert.deepEqual(actions.map((a) => a.id), ["a1"]);
  assert.match(calls[0].url, /modified_since=1792454400/);
});

/** Minimal stand-in for the Supabase query builder: every chain resolves to `result`. */
function fakeDb(result: unknown) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ["select", "eq", "in", "neq", "not", "order", "limit", "is"]) builder[m] = chain;
  builder.maybeSingle = async () => ({ data: result, error: null });
  return { from: () => builder } as unknown as SupabaseClient<Database>;
}

test("pushContactToCrm refuses contacts that are not qualified (rule 8)", async () => {
  const base = { id: "c1", company_id: "co1", ...contact, status: "verrijkt", onepage_id: null };
  await assert.rejects(
    () => pushContactToCrm(fakeDb({ ...base, company: { ...company, id: "co1", icp_decision: "REVIEW" } }), "c1", { reason: "test" }),
    /niet gekwalificeerd \(ICP besluit is geen GO\)/,
  );
  await assert.rejects(
    () => pushContactToCrm(fakeDb({ ...base, status: "nieuw", company: { ...company, id: "co1", icp_decision: "GO" } }), "c1", { reason: "test" }),
    /status nieuw/,
  );
});
