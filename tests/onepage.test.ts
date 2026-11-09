import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildContactPayload,
  createContact,
  dealStageMap,
  defaultNextAction,
  findContactByEmail,
  mergeContactPayload,
  stageKeyFor,
} from "@/lib/integrations/onepage";
import { addWorkingDays, shouldPromoteStatus } from "@/lib/sales/status";

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
  assert.equal(payload.last_name, "Unknown");
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
  assert.deepEqual(defaultNextAction("positive reply", "2026-10-24"), { text: "Follow up: positive reply", date: "2026-10-27" });
});

test("stage mapping is configurable and maps back to the nearest lower stage", () => {
  assert.equal(stageKeyFor(40), "afspraak_gepland");
  assert.equal(stageKeyFor(45), "afspraak_gepland");
  assert.equal(stageKeyFor(5), "gekwalificeerd");
  assert.equal(stageKeyFor(null), null);
  const map = dealStageMap('{"afspraak_gepland": 35}');
  assert.equal(map.afspraak_gepland, 35);
  assert.equal(map.gesprekken, 90);
  assert.throws(() => dealStageMap("{nope"), /not valid JSON/);
});

test("contact status only moves forward", () => {
  assert.equal(shouldPromoteStatus("qualified", "in_outreach"), true);
  assert.equal(shouldPromoteStatus("in_outreach", "reached"), true);
  assert.equal(shouldPromoteStatus("reached", "in_outreach"), false);
  assert.equal(shouldPromoteStatus("do_not_contact", "reached"), false);
  assert.equal(shouldPromoteStatus("not_interested", "reached"), true);
  assert.equal(shouldPromoteStatus("not_reached", "in_outreach"), false);
  assert.equal(shouldPromoteStatus("reached", "not_interested"), true);
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
  await assert.rejects(() => createContact(payload), /unexpected shape/);
});

test("API errors carry the OnePageCRM message", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status: 400, error_name: "invalid_request", error_message: "Missing last_name" }), { status: 400 })) as typeof fetch;
  await assert.rejects(() => createContact(buildContactPayload({ contact, company })), /400: Missing last_name/);
});
