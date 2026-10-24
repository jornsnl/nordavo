import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  buildCallSheetRows,
  CALL_SHEET_HEADER,
  callReason,
  campaignName,
  evaluateCampaign,
  exportCallList,
  filterSummary,
  filterToJson,
  groupBySignalType,
  isSuppressedFor,
  linkedinUrl,
  openingLineMatchesSignal,
  parseListFilter,
  safeCsvCell,
  toCsv,
} from "@/lib/gtm/lists";
import { checkOpeningLine, openingLineInput } from "@/lib/ai/prompts/opening-line";

test("parseListFilter reads valid values and ignores the rest", () => {
  assert.deepEqual(parseListFilter({ segment: "saas", signal: "lang_open", tier: "1", min_score: "60", limit: "50" }), {
    segment: "saas",
    signalType: "lang_open",
    tier: 1,
    minScore: 60,
    limit: 50,
  });
  assert.deepEqual(parseListFilter({ segment: "bakkerij", signal: "x", tier: "4", min_score: "abc", limit: "-1" }), { limit: 200 });
  assert.equal(parseListFilter({ limit: "99999" }).limit, 1000);
  assert.equal(parseListFilter({}, 100).limit, 100);
  assert.equal(parseListFilter({ signal_type: "funding" }).signalType, "funding");
  assert.equal(parseListFilter({ segment: ["productie", "saas"] }).segment, "productie");
});

test("filterToJson and filterSummary round-trip for the export history", () => {
  const json = filterToJson({ segment: "saas", signalType: "vacature", tier: 1, minScore: 70, limit: 100 }, { deliver: "sheet" });
  assert.deepEqual(json, { limit: 100, segment: "saas", signal_type: "vacature", tier: 1, min_score: 70, deliver: "sheet" });
  assert.equal(filterSummary(json), "SaaS, Vacature, tier 1, score 70+, max 100");
  assert.equal(filterSummary({}), "Geen filter");
  assert.equal(filterSummary(null), "Geen filter");
});

test("callReason prefers the opening line, then the signal", () => {
  assert.equal(callReason({ opening_line: " Jullie zoeken een data engineer. ", signal_type: "vacature", signal_title: "x" }), "Jullie zoeken een data engineer.");
  assert.equal(callReason({ opening_line: null, signal_type: "vacature", signal_title: "Senior PHP developer" }), "Heeft een vacature open: Senior PHP developer.");
  assert.equal(callReason({ opening_line: "", signal_type: "lang_open", signal_title: null }), "Heeft een vacature die al lang open staat.");
  assert.equal(callReason({ opening_line: null, signal_type: "funding", signal_title: "Serie A" }), "Heeft recent funding opgehaald.");
  assert.equal(callReason({ opening_line: null, signal_type: null, signal_title: null }), "Past bij ons ICP.");
});

test("buildCallSheetRows follows the header for Web Partners", () => {
  const rows = buildCallSheetRows([
    {
      company_name: "Acme",
      first_name: "Jan",
      last_name: "de Vries",
      title: "CTO",
      phone: "+31612345678",
      signal_type: "meerdere_rollen",
      signal_title: "Backend developer",
      opening_line: null,
      domain: "acme.nl",
      linkedin_url: "linkedin.com/in/jandevries",
    },
  ]);
  assert.equal(rows[0].length, CALL_SHEET_HEADER.length);
  assert.deepEqual(rows[0], [
    "Acme",
    "Jan de Vries",
    "CTO",
    "+31612345678",
    "Meerdere rollen: Backend developer",
    "Meerdere techrollen open, onder andere Backend developer.",
    "acme.nl",
    "https://www.linkedin.com/in/jandevries",
  ]);
});

test("linkedinUrl adds the scheme only when needed", () => {
  assert.equal(linkedinUrl("linkedin.com/in/x"), "https://www.linkedin.com/in/x");
  assert.equal(linkedinUrl("https://linkedin.com/company/acme"), "https://linkedin.com/company/acme");
  assert.equal(linkedinUrl(null), "");
});

test("CSV cells that look like formulas are neutralised, phone numbers are not", () => {
  assert.equal(safeCsvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(safeCsvCell("@cmd"), "'@cmd");
  assert.equal(safeCsvCell("-x"), "'-x");
  assert.equal(safeCsvCell("+31612345678"), "+31612345678");
  assert.equal(safeCsvCell("-5"), "-5");
  assert.equal(safeCsvCell(null), "");
  assert.equal(toCsv(["a", "b"], [["1, 2", null]]), 'a,b\r\n"1, 2",');
});

test("groupBySignalType keeps contacts without a signal apart", () => {
  const { groups, withoutSignal } = groupBySignalType([
    { id: 1, signal_type: "vacature" as const },
    { id: 2, signal_type: "funding" as const },
    { id: 3, signal_type: "vacature" as const },
    { id: 4, signal_type: null },
  ]);
  assert.deepEqual([...groups.keys()], ["vacature", "funding"]);
  assert.deepEqual(groups.get("vacature")?.map((r) => r.id), [1, 3]);
  assert.deepEqual(withoutSignal.map((r) => r.id), [4]);
});

test("openingLineMatchesSignal reuses the company line only for the same signal", () => {
  assert.equal(openingLineMatchesSignal("Ik zag jullie vacature voor een data engineer.", "vacature", null), true);
  assert.equal(openingLineMatchesSignal("Ik zag jullie vacature voor een data engineer.", "funding", "Serie A ronde"), false);
  assert.equal(openingLineMatchesSignal("De rol van Magento developer staat al even open.", "lang_open", "Magento developer"), true);
  assert.equal(openingLineMatchesSignal(null, "vacature", null), false);
});

test("evaluateCampaign applies the 150 mails rule", () => {
  assert.equal(evaluateCampaign(0, 0).verdict, "te_vroeg");
  assert.equal(evaluateCampaign(100, 10).label, "Nog 50 mails tot evaluatie");
  assert.equal(evaluateCampaign(150, 4).verdict, "herschrijven");
  assert.equal(evaluateCampaign(200, 8).verdict, "doorgaan");
  assert.equal(evaluateCampaign(200, 11).verdict, "opschalen");
  assert.equal(evaluateCampaign(200, 11).rate, 0.055);
});

test("isSuppressedFor mirrors is_suppressed per channel", () => {
  const target = { contactId: "c1", companyId: "co1", email: "Jan@Acme.nl" };
  assert.equal(isSuppressedFor(target, [{ contact_id: "c1", company_id: null, email: null, scope: "alle_kanalen" }], "bellen"), true);
  assert.equal(isSuppressedFor(target, [{ contact_id: null, company_id: "co1", email: null, scope: "alleen_mail" }], "bellen"), false);
  assert.equal(isSuppressedFor(target, [{ contact_id: null, company_id: "co1", email: null, scope: "alleen_bellen" }], "bellen"), true);
  assert.equal(isSuppressedFor(target, [{ contact_id: null, company_id: null, email: "jan@acme.nl", scope: "alle_kanalen" }], "mail"), true);
  assert.equal(isSuppressedFor(target, [{ contact_id: "c2", company_id: "co2", email: null, scope: "alle_kanalen" }], "mail"), false);
});

test("campaignName is stable per signal, segment and variant", () => {
  assert.equal(campaignName("lang_open", "saas", "v1"), "Nordavo · Lang open · SaaS · v1");
  assert.equal(campaignName("vacature", null, "v2"), "Nordavo · Vacature · Alle segmenten · v2");
});

test("checkOpeningLine blocks claims Nordavo cannot back", () => {
  assert.equal(checkOpeningLine("  Ik zag dat jullie een senior data engineer zoeken.  "), "Ik zag dat jullie een senior data engineer zoeken.");
  assert.equal(checkOpeningLine("Ons eigen team in Bangalore staat klaar."), null);
  assert.equal(checkOpeningLine("Wij zijn 50% goedkoper."), null);
  assert.equal(checkOpeningLine("Eerste zin. Tweede zin."), null);
  assert.equal(checkOpeningLine("Acme B.V. zoekt een developer."), "Acme B.V. zoekt een developer.");
  assert.equal(checkOpeningLine(""), null);
});

test("openingLineInput names exactly one signal", () => {
  const input = openingLineInput({
    companyName: "Acme",
    domain: "acme.nl",
    segment: "saas",
    firstName: "Jan",
    title: "CTO",
    signalType: "lang_open",
    signalTitle: "Senior Python developer",
  });
  assert.match(input, /Signaal \(gebruik alleen dit\): vacature die al langer dan 60 dagen open staat/);
  assert.match(input, /Titel van het signaal: Senior Python developer/);
});

// ---------------------------------------------------------------------------
// exportCallList against a small fake of the Supabase query builder
// ---------------------------------------------------------------------------

type Call = { table: string; ops: { op: string; args: unknown[] }[] };

function fakeDb(handler: (call: Call) => { data: unknown; error: null; count?: number }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "insert", "update", "upsert", "eq", "in", "not", "is", "gte", "order", "limit", "range", "single", "maybeSingle"]) {
        builder[op] = (...args: unknown[]) => {
          call.ops.push({ op, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        try {
          resolve(handler(call));
        } catch (error) {
          reject(error);
        }
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, calls };
}

const candidate = (id: string, companyId: string) => ({
  contact_id: id,
  company_id: companyId,
  company_name: `Bedrijf ${companyId}`,
  domain: `${companyId}.nl`,
  segment: "saas",
  icp_score: 80,
  opening_line: null,
  first_name: "Jan",
  last_name: id,
  title: "CTO",
  tier: 1,
  phone: "+31612345678",
  linkedin_url: null,
  signal_id: "s1",
  signal_title: "Backend developer",
  signal_type: "vacature",
});

test("exportCallList re-checks, guards the legal form and records everything", async () => {
  const { db, calls } = fakeDb((call) => {
    const selects = call.ops.find((o) => o.op === "select")?.args[0];
    if (call.table === "call_list_candidates" && selects === "*") {
      return { data: [candidate("c1", "a"), candidate("c2", "b"), candidate("c3", "c")], error: null, count: 3 };
    }
    if (call.table === "companies") {
      return { data: [{ id: "a", legal_form: "BV" }, { id: "b", legal_form: "V.O.F." }, { id: "c", legal_form: null }], error: null };
    }
    if (call.table === "call_list_candidates") {
      // c3 was approached in the meantime.
      return { data: [{ contact_id: "c1" }, { contact_id: "c2" }], error: null };
    }
    if (call.table === "list_exports") return { data: { id: "exp1" }, error: null };
    return { data: null, error: null };
  });

  const result = await exportCallList(db, { filter: { limit: 10, segment: "saas" }, deliver: "csv", createdBy: "u1" });
  assert.equal(result.count, 1);
  assert.equal(result.dropped, 1);
  assert.equal(result.exportId, "exp1");
  assert.match(result.csv ?? "", /^Bedrijf,Contact,Functie,Telefoon/);
  assert.match(result.csv ?? "", /Bedrijf a/);
  assert.doesNotMatch(result.csv ?? "", /Bedrijf b/);

  const exportInsert = calls.find((c) => c.table === "list_exports")?.ops.find((o) => o.op === "insert")?.args[0] as Record<string, unknown>;
  assert.equal(exportInsert.type, "bellijst");
  assert.deepEqual(exportInsert.record_ids, ["c1"]);
  assert.equal(exportInsert.record_count, 1);
  assert.deepEqual(exportInsert.filter_used, { limit: 10, segment: "saas", deliver: "csv" });
  assert.equal(exportInsert.created_by, "u1");

  const statusUpdate = calls.find((c) => c.table === "contacts")?.ops.find((o) => o.op === "update")?.args[0];
  assert.deepEqual(statusUpdate, { status: "op_bellijst" });

  const upsert = calls.find((c) => c.table === "activities")?.ops.find((o) => o.op === "upsert");
  const rows = upsert?.args[0] as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "verstuurd");
  assert.equal(rows[0].channel, "bellen");
  assert.equal(rows[0].external_id, "bellijst:exp1:c1");
  assert.deepEqual(upsert?.args[1], { onConflict: "external_id", ignoreDuplicates: true });
});

test("exportCallList writes nothing when nobody is left", async () => {
  const { db, calls } = fakeDb((call) => {
    if (call.table === "call_list_candidates") return { data: [], error: null, count: 0 };
    return { data: [], error: null };
  });
  const result = await exportCallList(db, { filter: { limit: 10 }, deliver: "csv" });
  assert.equal(result.count, 0);
  assert.equal(result.exportId, null);
  assert.equal(calls.some((c) => c.table === "list_exports" || c.table === "activities"), false);
});
