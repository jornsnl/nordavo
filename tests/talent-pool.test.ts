import { test } from "node:test";
import assert from "node:assert/strict";
import { daysOpenSignal } from "@/components/vacancies/days-open";
import { leadTimeRows, type VacancyFact } from "@/lib/gtm/report";
import { leadTime } from "@/lib/talent/lead-time";
import {
  clockOnLink,
  countsInMetrics,
  isVacancyOwnerType,
  ownerColumns,
  ownerTypeOf,
} from "@/lib/talent/talent-pool";

const CLIENT = "00000000-0000-0000-0000-0000000000c1";
const COMPANY = "00000000-0000-0000-0000-0000000000d1";

test("ownerColumns keeps exactly one kind of owner", () => {
  assert.deepEqual(ownerColumns("talent_pool", { client_id: CLIENT, company_id: COMPANY }), {
    is_talent_pool: true,
    client_id: null,
    company_id: null,
  });
  assert.deepEqual(ownerColumns("client", { client_id: CLIENT, company_id: COMPANY }), {
    is_talent_pool: false,
    client_id: CLIENT,
    company_id: null,
  });
  assert.deepEqual(ownerColumns("company", { client_id: CLIENT, company_id: COMPANY }), {
    is_talent_pool: false,
    client_id: null,
    company_id: COMPANY,
  });
});

test("ownerTypeOf picks the form's starting choice", () => {
  assert.equal(ownerTypeOf({ is_talent_pool: true }), "talent_pool");
  assert.equal(ownerTypeOf({ company_id: COMPANY }), "company");
  assert.equal(ownerTypeOf({ client_id: CLIENT, company_id: COMPANY }), "client");
  assert.equal(ownerTypeOf({}), "client");
  assert.ok(isVacancyOwnerType("talent_pool"));
  assert.ok(!isVacancyOwnerType("pool"));
});

test("talent pool vacancies do not count in dashboard or report", () => {
  assert.equal(countsInMetrics({ is_talent_pool: true }), false);
  assert.equal(countsInMetrics({ is_talent_pool: false }), true);
  // Older rows without the field still count.
  assert.equal(countsInMetrics({}), true);
});

test("the clock starts when a talent pool vacancy is linked", () => {
  // 23:30 UTC on 6 November is already 7 November in Amsterdam.
  const now = new Date("2026-11-06T23:30:00Z");
  assert.deepEqual(clockOnLink({ is_talent_pool: true, intake_at: null }, false, now), {
    opened_at: "2026-11-07",
    intake_at: null,
  });
  assert.deepEqual(clockOnLink({ is_talent_pool: true, intake_at: "2026-09-01T10:00:00Z" }, false, now), {
    opened_at: "2026-11-07",
    intake_at: now.toISOString(),
  });
  // Staying in the pool, or editing a vacancy that was never in it: no change.
  assert.equal(clockOnLink({ is_talent_pool: true, intake_at: null }, true, now), null);
  assert.equal(clockOnLink({ is_talent_pool: false, intake_at: "2026-09-01T10:00:00Z" }, false, now), null);
});

test("talent pool vacancies have no three-week signal", () => {
  assert.equal(daysOpenSignal(40, "open"), "danger");
  assert.equal(daysOpenSignal(40, "open", true), "neutral");

  const now = new Date("2026-10-24T12:00:00Z");
  const old = { intake_at: "2026-09-01T12:00:00Z", profiles_sent_at: null, talent_stage: "zoeken" };
  assert.equal(leadTime(old, now).level, "danger");
  const pool = leadTime({ ...old, is_talent_pool: true }, now);
  assert.equal(pool.level, "talent_pool");
  assert.equal(pool.days, null);
});

test("leadTimeRows leaves talent pool vacancies out of the report", () => {
  const fact = (over: Partial<VacancyFact>): VacancyFact => ({
    id: "v",
    title: "Backend developer",
    talent_stage: "zoeken",
    opened_at: "2026-09-01T10:00:00Z",
    intake_at: null,
    profiles_sent_at: null,
    first_interview_at: null,
    start_at: null,
    company: "Acme",
    ...over,
  });
  const rows = leadTimeRows(
    [fact({ id: "client" }), fact({ id: "pool", company: null, is_talent_pool: true })],
    new Date("2026-10-24T10:00:00Z"),
  );
  assert.deepEqual(
    rows.map((r) => [r.vacancyId, r.level]),
    [["client", "over"]],
  );
});
