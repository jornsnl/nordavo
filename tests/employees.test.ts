import { test } from "node:test";
import assert from "node:assert/strict";
import { employeeBand, employeesBandLabel } from "@/lib/sales/employees";

test("employees show as a range", () => {
  assert.equal(employeesBandLabel(null), null);
  assert.equal(employeesBandLabel(undefined), null);
  assert.equal(employeesBandLabel(-1), null);
  assert.equal(employeesBandLabel(0), "1 tot 10");
  assert.equal(employeesBandLabel(1), "1 tot 10");
  assert.equal(employeesBandLabel(10), "1 tot 10");
  assert.equal(employeesBandLabel(11), "11 tot 50");
  assert.equal(employeesBandLabel(50), "11 tot 50");
  assert.equal(employeesBandLabel(51), "51 tot 200");
  assert.equal(employeesBandLabel(200), "51 tot 200");
  assert.equal(employeesBandLabel(201), "201 tot 500");
  assert.equal(employeesBandLabel(500), "201 tot 500");
  assert.equal(employeesBandLabel(501), "501 tot 1.000");
  assert.equal(employeesBandLabel(999), "501 tot 1.000");
  assert.equal(employeesBandLabel(1000), "1.000 en meer");
  assert.equal(employeesBandLabel(250000), "1.000 en meer");
  assert.equal(employeeBand(120)?.key, "51_200");
});
