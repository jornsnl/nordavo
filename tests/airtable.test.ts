import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  AIRTABLE_FIELDS,
  fieldConsent,
  fieldList,
  fieldNumber,
  fieldText,
  getPoolCandidate,
  getPoolCandidates,
  listPoolCandidates,
  mapAirtableCandidate,
  recordIdFormula,
} from "@/lib/integrations/airtable";

const F = AIRTABLE_FIELDS;

const record = {
  id: "recA1b2C3d4E5f6G7",
  createdTime: "2026-09-01T10:00:00.000Z",
  fields: {
    [F.name]: "Priya Raghavan",
    [F.email]: "priya.r@example.com",
    [F.phone]: "+91 98450 12345",
    [F.skills]: ["Python", "dbt", "Snowflake", "python"],
    [F.yearsExperience]: 6,
    [F.seniority]: "Senior",
    [F.currentTitle]: "Senior Data Engineer",
    [F.currentEmployer]: "Infosys Limited",
    [F.previousEmployers]: "Flipkart, Mu Sigma",
    [F.projectTypes]: "Data platforms\nETL pipelines",
    [F.englishLevel]: "C1",
    [F.availability]: "30 dagen opzegtermijn",
    [F.cvAttachment]: [{ id: "att1", url: "https://dl.airtable.com/x.pdf", filename: "cv.pdf" }],
    [F.consent]: true,
    "Onbekend veld": "wordt genegeerd",
  },
};

test("mapAirtableCandidate maps the configured columns", () => {
  const c = mapAirtableCandidate(record);
  assert.equal(c.id, "recA1b2C3d4E5f6G7");
  assert.equal(c.name, "Priya Raghavan");
  assert.deepEqual(c.nameParts, ["Priya", "Raghavan"]);
  assert.deepEqual(c.skills, ["Python", "dbt", "Snowflake"]);
  assert.equal(c.yearsExperience, 6);
  assert.deepEqual(c.employers, ["Infosys Limited", "Flipkart", "Mu Sigma"]);
  assert.deepEqual(c.projectTypes, ["Data platforms", "ETL pipelines"]);
  assert.equal(c.hasCvAttachment, true);
  assert.equal(c.cvText, null);
  assert.equal(c.consent, true);
});

test("mapAirtableCandidate tolerates missing fields and split names", () => {
  const c = mapAirtableCandidate({
    id: "recXyz123",
    fields: { [F.firstName]: "Arjun", [F.lastName]: "Mehta-Rao", [F.yearsExperience]: "4,5 jaar" },
  });
  assert.equal(c.name, "Arjun Mehta-Rao");
  assert.deepEqual(c.nameParts, ["Arjun", "Mehta", "Rao"]);
  assert.equal(c.yearsExperience, 4.5);
  assert.deepEqual(c.skills, []);
  assert.equal(c.consent, null, "a missing consent field is unknown, not refused");
  assert.equal(c.hasCvAttachment, false);
});

test("field helpers read selects, lookups and text", () => {
  assert.equal(fieldText({ state: "generated", value: "Samenvatting" }), "Samenvatting");
  assert.equal(fieldText(["A", "B"]), "A, B");
  assert.deepEqual(fieldList("React; Node.js, TypeScript"), ["React", "Node.js", "TypeScript"]);
  assert.equal(fieldNumber("ongeveer 7 jaar"), 7);
  assert.equal(fieldNumber(undefined), null);
  assert.equal(fieldConsent("Ja, akkoord"), true);
  assert.equal(fieldConsent("Nee"), false);
  assert.equal(fieldConsent(false), false);
  assert.equal(fieldConsent(""), null);
  assert.equal(fieldConsent("Misschien"), null);
});

test("recordIdFormula only accepts Airtable record ids", () => {
  assert.equal(recordIdFormula(["recAbc123", "rec' OR 1=1"]), "OR(RECORD_ID()='recAbc123')");
  assert.equal(recordIdFormula(["nope"]), null);
});

const realFetch = globalThis.fetch;
const env = { ...process.env };

beforeEach(() => {
  process.env.AIRTABLE_TOKEN = "pat_test";
  process.env.AIRTABLE_BASE_ID = "appBase123";
  process.env.AIRTABLE_CANDIDATES_TABLE = "Kandidaten";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...env };
});

test("listPoolCandidates follows offset pagination", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer pat_test");
    const page = url.includes("offset=") ? { records: [{ ...record, id: "recPage2" }] } : { records: [record], offset: "itrNext" };
    return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const candidates = await listPoolCandidates({ filterByFormula: "{Skills} != ''" });
  assert.deepEqual(candidates.map((c) => c.id), ["recA1b2C3d4E5f6G7", "recPage2"]);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].startsWith("https://api.airtable.com/v0/appBase123/Kandidaten?"));
  assert.ok(urls[0].includes("filterByFormula="));
  assert.ok(urls[1].includes("offset=itrNext"));
});

test("listPoolCandidates fails loudly on a changed response shape", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ items: [] }), { status: 200 })) as typeof fetch;
  await assert.rejects(listPoolCandidates(), /onverwacht antwoord/);
});

test("getPoolCandidate returns null for a deleted record and throws on auth errors", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404 })) as typeof fetch;
  assert.equal(await getPoolCandidate("recGone123"), null);

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { type: "AUTHENTICATION_REQUIRED" } }), { status: 401 })) as typeof fetch;
  await assert.rejects(getPoolCandidate("recAbc123"), /AIRTABLE_TOKEN/);
});

test("getPoolCandidates batches ids in one formula request", async () => {
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    assert.ok(decodeURIComponent(String(input)).includes("RECORD_ID()='recA1b2C3d4E5f6G7'"));
    return new Response(JSON.stringify({ records: [record] }), { status: 200 });
  }) as typeof fetch;
  const map = await getPoolCandidates(["recA1b2C3d4E5f6G7", "recA1b2C3d4E5f6G7", "recOther99"]);
  assert.equal(calls, 1);
  assert.equal(map.get("recA1b2C3d4E5f6G7")?.name, "Priya Raghavan");
});

test("missing Airtable configuration gives a clear Dutch error", async () => {
  delete process.env.AIRTABLE_TOKEN;
  await assert.rejects(listPoolCandidates(), /Airtable is niet gekoppeld/);
});
