import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { findEmail, mapProspeoStatus, parseFoundEmail, parseVerifyStatus, verifyEmail } from "@/lib/integrations/prospeo";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PROSPEO_API_KEY;
});

test("mapProspeoStatus", () => {
  assert.equal(mapProspeoStatus("VALID"), "valid");
  assert.equal(mapProspeoStatus("VERIFIED"), "valid");
  assert.equal(mapProspeoStatus("catch_all"), "catch_all");
  assert.equal(mapProspeoStatus("ACCEPT-ALL"), "catch_all");
  assert.equal(mapProspeoStatus("INVALID"), "invalid");
  assert.equal(mapProspeoStatus("UNVERIFIED"), "unknown");
  assert.equal(mapProspeoStatus(null), "unknown");
});

test("parseFoundEmail reads enrich-person and the older email-finder shape", () => {
  assert.deepEqual(
    parseFoundEmail({ error: false, person: { full_name: "Jan", email: { email: "Jan@Acme.nl", status: "VERIFIED" } } }),
    { email: "jan@acme.nl", status: "valid", rawStatus: "VERIFIED" },
  );
  assert.deepEqual(parseFoundEmail({ error: false, response: { email: "piet@acme.nl", email_status: "CATCH_ALL" } }), {
    email: "piet@acme.nl",
    status: "catch_all",
    rawStatus: "CATCH_ALL",
  });
  assert.equal(parseFoundEmail({ error: true, error_code: "NO_MATCH" }), null);
  assert.equal(parseFoundEmail({ error: false, person: { email: null } }), null);
});

test("parseVerifyStatus", () => {
  assert.equal(parseVerifyStatus({ error: false, response: { email_status: "VALID" } }), "valid");
  assert.equal(parseVerifyStatus({ error: false, response: {} }), "unknown");
});

test("findEmail sends the key in a header and treats NO_MATCH as not found", async () => {
  process.env.PROSPEO_API_KEY = "secret";
  let body: unknown = null;
  let key = "";
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    key = new Headers(init?.headers).get("x-key") ?? "";
    return new Response(JSON.stringify({ error: true, error_code: "NO_MATCH" }), { status: 400 });
  };
  const found = await findEmail({ firstName: "Jan", lastName: "de Vries", companyDomain: "acme.nl", linkedinUrl: "linkedin.com/in/jan" });
  assert.equal(found, null);
  assert.equal(key, "secret");
  assert.deepEqual(body, {
    only_verified_email: false,
    data: { first_name: "Jan", last_name: "de Vries", company_website: "acme.nl", linkedin_url: "https://www.linkedin.com/in/jan" },
  });
});

test("findEmail throws on other errors; verifyEmail maps the status", async () => {
  process.env.PROSPEO_API_KEY = "secret";
  globalThis.fetch = async () => new Response(JSON.stringify({ error: true, error_code: "INVALID_API_KEY" }), { status: 401 });
  await assert.rejects(findEmail({ linkedinUrl: "linkedin.com/in/jan" }), /HTTP 401/);
  await assert.rejects(findEmail({ firstName: "Jan" }), /Te weinig gegevens/);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: false, response: { email_status: "INVALID" } }), { status: 200 });
  assert.equal(await verifyEmail("x@acme.nl"), "invalid");
});
