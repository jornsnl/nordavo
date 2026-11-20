import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultNotNowDate, outcomeProblem, outcomeScope } from "@/lib/sales/call-outcome";
import { hiddenByDefaultLeadStatuses, leadStatuses, tierMeanings } from "@/lib/sales/labels";
import { companyColumns, defaultCompanySort } from "@/lib/sales/rows";
import { computeScore, formatScore, isEvergreen, parseScore, scoreGroup, signalState, type SignalPoint } from "@/lib/sales/score";

// Leadregels of 20 November 2026 (docs/leadregels.md). The database is
// tested in supabase/tests/leadregels.test.sql; this is the pure mirror.

const today = "2026-11-20";

const points: SignalPoint[] = [
  { type: "vacature", label: "Actieve dev of data vacature", description: null, points: 30, active: true, derived: true, valid_days: null, position: 10 },
  { type: "meerdere_rollen", label: "Meerdere vacatures tegelijk", description: null, points: 10, active: true, derived: true, valid_days: null, position: 20 },
  { type: "india_outsourced", label: "Team in India of eerder uitbesteed", description: null, points: 10, active: true, derived: false, valid_days: null, position: 30 },
  { type: "funding", label: "Funding", description: null, points: 10, active: false, derived: false, valid_days: 365, position: 40 },
  { type: "lang_open", label: "Vacature 60 dagen of langer open", description: null, points: 5, active: false, derived: true, valid_days: null, position: 70 },
  { type: "ontslagen", label: "Ontslagen of hiring freeze", description: null, points: -15, active: false, derived: false, valid_days: 365, position: 120 },
];

const vacancy = (title: string, posted: string, extra: Record<string, unknown> = {}) => ({
  type: "vacature",
  title,
  role_group: "Backend",
  posted_at: posted,
  first_seen_at: `${posted}T08:00:00Z`,
  closed_at: null,
  valid_until: null,
  ...extra,
});

test("score: segment base plus the active signals, each type once", () => {
  assert.equal(computeScore(null, [vacancy("Developer", "2026-11-01")], points, today), null, "no segment, no score");
  assert.equal(computeScore("A", [], points, today)?.total, 50);
  assert.equal(computeScore("B", [], points, today)?.total, 30);
  assert.equal(computeScore("A", [vacancy("Developer", "2026-11-01")], points, today)?.total, 80);
  const two = computeScore("A", [vacancy("Developer", "2026-11-01"), vacancy("Data Engineer", "2026-10-01")], points, today);
  assert.equal(two?.total, 90);
  assert.equal(formatScore(two), "A 50 + actieve dev of data vacature 30 + meerdere vacatures tegelijk 10 = 90");
  const india = { type: "india_outsourced", title: "Team in Bangalore", posted_at: today, first_seen_at: `${today}T08:00:00Z` };
  assert.equal(computeScore("A", [vacancy("Developer", "2026-11-01"), vacancy("Data Engineer", "2026-10-01"), india], points, today)?.total, 100);
  assert.equal(
    computeScore("A", [vacancy("Developer", "2026-11-01"), vacancy("Data Engineer", "2026-10-01"), india, vacancy("QA", "2026-11-10")], points, today)?.total,
    100,
    "never over 100",
  );
});

test("score: switched off types, evergreen and offline vacancies do not count; never under 0", () => {
  const funding = { type: "funding", title: "Serie A", posted_at: "2026-10-01", first_seen_at: "2026-10-01T08:00:00Z" };
  assert.equal(computeScore("B", [funding], points, today)?.total, 30, "funding is not active yet");
  assert.equal(computeScore("B", [vacancy("Java Developer", "2026-03-01")], points, today)?.total, 30, "open over 180 days is evergreen");
  assert.equal(computeScore("B", [vacancy("Open sollicitatie developer", "2026-11-15")], points, today)?.total, 30, "an open application is evergreen");
  assert.equal(computeScore("B", [vacancy("Developer", "2026-11-01", { closed_at: "2026-11-18T00:00:00Z" })], points, today)?.total, 30, "offline expires");
  assert.equal(computeScore("B", [vacancy("Accountmanager", "2026-11-01", { role_group: "Sales" })], points, today)?.total, 30, "not a dev or data role");
  const harsh = points.map((p) => (p.type === "ontslagen" ? { ...p, active: true, points: -100 } : p));
  const layoffs = { type: "ontslagen", title: "Reorganisatie", posted_at: today, first_seen_at: `${today}T08:00:00Z`, valid_until: "2027-11-20" };
  assert.equal(computeScore("B", [layoffs], harsh, today)?.total, 0);
});

test("signalState: points, active, evergreen and valid until", () => {
  assert.deepEqual(signalState(vacancy("Developer", "2026-11-01"), points, today), {
    date: "2026-11-01",
    active: true,
    evergreen: false,
    counts: true,
    points: 30,
  });
  const expired = signalState({ type: "india_outsourced", title: "x", posted_at: "2025-01-01", first_seen_at: null, valid_until: "2026-01-01" }, points, today);
  assert.equal(expired.active, false);
  assert.equal(expired.counts, false);
  assert.equal(isEvergreen("Talent pool developers", "2026-11-19", today), true);
  assert.equal(isEvergreen("Developer", "2026-05-24", today), false, "exactly 180 days is not over 180");
  assert.equal(isEvergreen("Developer", "2026-05-23", today), true);
});

test("score groups and the stored breakdown", () => {
  assert.equal(scoreGroup(100), "90_100");
  assert.equal(scoreGroup(89), "80_89");
  assert.equal(scoreGroup(60), "60_79");
  assert.equal(scoreGroup(50), "50_59");
  assert.equal(scoreGroup(30), "lt_50");
  assert.equal(scoreGroup(null), null);
  const parsed = parseScore({ segment: "A", parts: [{ type: "segment", label: "A", points: 50 }, { type: "vacature", label: "Vacature", points: 30 }], total: 80 });
  assert.equal(formatScore(parsed), "A 50 + vacature 30 = 80");
  assert.equal(parseScore(null), null);
  assert.equal(parseScore({ segment: "saas" }), null);
});

test("Leads: score column sorted high to low, no prio, no go and do not contact hidden by default", () => {
  assert.deepEqual(defaultCompanySort[0], { column: "icp_score", dir: "desc" });
  assert.ok(companyColumns.find((c) => c.key === "icp_score")?.defaultVisible);
  assert.ok(companyColumns.find((c) => c.key === "no_go_reason")?.defaultVisible);
  assert.equal(companyColumns.some((c) => c.key === "prio"), false);
  assert.deepEqual(hiddenByDefaultLeadStatuses, ["no_go", "do_not_contact"]);
  const icp = companyColumns.find((c) => c.key === "icp_decision")!;
  assert.equal(icp.tooltip?.({ icp_decision: "NO_GO", icp_reason: "Detachering" } as never), "Detachering");
  assert.deepEqual(
    leadStatuses.map((s) => s.value),
    ["new", "enrich", "ready", "in_sequence", "cooled_down", "nee_geen_interesse", "nu_niet", "no_go", "do_not_contact"],
  );
  for (const s of leadStatuses) assert.ok(s.description, `${s.value} has a tooltip`);
  assert.match(tierMeanings[3], /HR/);
});

test("call outcomes: a no needs a note, not now has a date in the future", () => {
  for (const outcome of ["not_interested_person", "not_interested_company", "do_not_contact"] as const) {
    assert.ok(outcomeProblem({ outcome }, today), `${outcome} without note`);
    assert.equal(outcomeProblem({ outcome, note: "Gaat er niet over" }, today), null);
  }
  assert.equal(outcomeScope.not_interested_person, "person");
  assert.equal(outcomeScope.not_interested_company, "company");
  assert.ok(outcomeProblem({ outcome: "not_now", note: "Maart", until: "2026-11-01" }, today));
  assert.equal(outcomeProblem({ outcome: "not_now", note: "Maart", until: "2027-03-01" }, today), null);
  assert.equal(defaultNotNowDate("2026-11-20"), "2027-02-20");
  assert.equal(defaultNotNowDate("2026-11-30"), "2027-02-28");
});
