import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { filterOwnContactMembers, isColdDestination, splitOwnContacts } from "@/lib/sales/own-contact";

type Table = Record<string, unknown>[];

/** A tiny fake of the query builder: from(table).select().in(col, values).eq(col, value). */
function fakeDb(tables: Record<string, Table>) {
  const db = {
    from(name: string) {
      let rows = [...(tables[name] ?? [])];
      const builder: Record<string, unknown> = {
        select: () => builder,
        in: (col: string, values: unknown[]) => {
          rows = rows.filter((r) => values.includes(r[col]));
          return builder;
        },
        eq: (col: string, value: unknown) => {
          rows = rows.filter((r) => r[col] === value);
          return builder;
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return builder;
    },
  };
  return db as unknown as SupabaseClient<Database>;
}

const own = { id: "c-own", name: "Partner BV", own_contact: true, own_contact_reason: "Partner" };
const cold = { id: "c-cold", name: "Cold BV", own_contact: false, own_contact_reason: null };
const contacts = [
  { id: "k-own", company_id: "c-own", email: "a@partner.nl" },
  { id: "k-cold", company_id: "c-cold", email: "b@cold.nl" },
];

test("cold destinations are find number, call and the two campaigns", () => {
  for (const d of ["find_number", "call", "mail_campaign", "linkedin_campaign"]) assert.equal(isColdDestination(d), true);
  for (const d of ["incoming", "parked", "no_go", "free"]) assert.equal(isColdDestination(d), false);
});

test("splitOwnContacts skips own contacts and names the reason", async () => {
  const db = fakeDb({ companies: [own, cold] });
  const { allowed, skipped } = await splitOwnContacts(db, ["c-own", "c-cold", "c-cold"]);
  assert.deepEqual(allowed, ["c-cold"]);
  assert.deepEqual(skipped, [{ id: "c-own", name: "Partner BV", reason: "Own contact: Partner" }]);
});

test("filterOwnContactMembers blocks cold adds by company, contact and email, but not replies", async () => {
  const db = fakeDb({ companies: [own, cold], contacts });
  const members = [
    { company_id: "c-own" },
    { contact_id: "k-own", status: "active" },
    { email: "A@Partner.nl" },
    { contact_id: "k-own", status: "replied" },
    { contact_id: "k-cold" },
  ];
  const { allowed, skipped } = await filterOwnContactMembers(db, members);
  assert.equal(skipped.length, 3);
  assert.deepEqual(allowed, [{ contact_id: "k-own", status: "replied" }, { contact_id: "k-cold" }]);
});
