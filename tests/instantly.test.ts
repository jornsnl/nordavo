import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityOutcomeFor,
  addLeadToCampaign,
  fetchLeadEvents,
  fetchReplies,
  leadBody,
  listCampaigns,
  mapLeadEvent,
  mapReplyEmail,
  replySentiment,
} from "@/lib/integrations/instantly";

const realFetch = globalThis.fetch;

function withKey<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env.INSTANTLY_API_KEY;
  process.env.INSTANTLY_API_KEY = "test-key";
  return fn().finally(() => {
    globalThis.fetch = realFetch;
    if (before === undefined) delete process.env.INSTANTLY_API_KEY;
    else process.env.INSTANTLY_API_KEY = before;
  });
}

test("leadBody maps our fields and drops empty values", () => {
  const body = leadBody("camp-1", {
    email: "jan@acme.nl",
    first_name: "Jan",
    last_name: null,
    company_name: "Acme",
    website: "https://acme.nl",
    personalization: "Ik zag dat jullie een senior backend developer zoeken.",
    custom_variables: { signaal: "Vacature", signaal_titel: null, segment: "" },
  });
  assert.deepEqual(body, {
    campaign: "camp-1",
    email: "jan@acme.nl",
    skip_if_in_campaign: true,
    first_name: "Jan",
    company_name: "Acme",
    website: "https://acme.nl",
    personalization: "Ik zag dat jullie een senior backend developer zoeken.",
    custom_variables: { signaal: "Vacature" },
  });
});

test("replySentiment uses the interest status first, then the AI value", () => {
  assert.equal(replySentiment({ lt_interest_status: 1 }), "positief");
  assert.equal(replySentiment({ lt_interest_status: -1 }), "negatief");
  assert.equal(replySentiment({ lt_interest_status: 0 }), "neutraal");
  assert.equal(replySentiment({ i_status: 1 }), "positief");
  assert.equal(replySentiment({ ai_interest_value: 0.9 }), "positief");
  assert.equal(replySentiment({ ai_interest_value: 0.1 }), "negatief");
  assert.equal(replySentiment({ ai_interest_value: 0.5 }), "neutraal");
  assert.equal(replySentiment({}), "neutraal");
});

test("mapReplyEmail maps a received email and skips auto replies", () => {
  const event = mapReplyEmail({
    id: "em_123",
    timestamp_created: "2026-10-20T08:00:00.000Z",
    timestamp_email: "2026-10-20T07:59:00.000Z",
    from_address_email: "Jan@Acme.nl",
    lead: "jan@acme.nl",
    campaign_id: "camp-1",
    subject: "Re: developers",
    lt_interest_status: 1,
    body: { text: "Graag!" },
  });
  assert.deepEqual(event, {
    id: "em_123",
    type: "reply",
    email: "jan@acme.nl",
    campaignId: "camp-1",
    timestamp: "2026-10-20T07:59:00.000Z",
    sentiment: "positief",
    subject: "Re: developers",
  });
  assert.equal(mapReplyEmail({ id: "em_2", from_address_email: "a@b.nl", is_auto_reply: true }), null);
  assert.equal(mapReplyEmail({ id: "em_3" }), null);
});

test("mapReplyEmail fails loudly on a changed response", () => {
  assert.throws(() => mapReplyEmail({ email: "no id" }));
});

test("mapLeadEvent gives a stable id per type and lead", () => {
  const raw = { id: "lead_9", email: "Piet@Beta.nl ", campaign: "camp-2", status: -1, timestamp_updated: "2026-10-21T10:00:00Z" };
  assert.deepEqual(mapLeadEvent(raw, "bounce"), {
    id: "bounce:lead_9",
    type: "bounce",
    email: "piet@beta.nl",
    campaignId: "camp-2",
    timestamp: "2026-10-21T10:00:00Z",
  });
  assert.equal(mapLeadEvent(raw, "unsubscribe")?.id, "unsubscribe:lead_9");
  assert.equal(mapLeadEvent({ id: "lead_10" }, "bounce"), null);
});

test("activityOutcomeFor maps events to our outcomes", () => {
  assert.equal(activityOutcomeFor({ type: "bounce" }), "bounce");
  assert.equal(activityOutcomeFor({ type: "unsubscribe" }), "afgemeld");
  assert.equal(activityOutcomeFor({ type: "reply", sentiment: "positief" }), "reply_positief");
  assert.equal(activityOutcomeFor({ type: "reply" }), "reply_neutraal");
});

test("fetchReplies follows the cursor and sends the bearer token", () =>
  withKey(async () => {
    const calls: { url: string; auth: string | null }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      const page = url.includes("starting_after=c1")
        ? { items: [{ id: "em_2", lead: "b@b.nl", timestamp_created: "2026-10-22T00:00:00Z" }], next_starting_after: null }
        : { items: [{ id: "em_1", lead: "a@a.nl", timestamp_created: "2026-10-21T00:00:00Z" }], next_starting_after: "c1" };
      return new Response(JSON.stringify(page), { status: 200 });
    };
    const events = await fetchReplies("2026-10-20T00:00:00.000Z");
    assert.deepEqual(events.map((e) => e.id), ["em_1", "em_2"]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].auth, "Bearer test-key");
    assert.match(calls[0].url, /\/api\/v2\/emails\?/);
    assert.match(calls[0].url, /email_type=received/);
    assert.match(calls[0].url, /min_timestamp_created=2026-10-20/);
  }));

test("fetchLeadEvents filters on the since moment", () =>
  withKey(async () => {
    let body: unknown;
    globalThis.fetch = async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          items: [
            { id: "l1", email: "old@a.nl", timestamp_updated: "2026-09-01T00:00:00Z" },
            { id: "l2", email: "new@a.nl", timestamp_updated: "2026-10-22T00:00:00Z" },
          ],
        }),
      );
    };
    const events = await fetchLeadEvents("unsubscribe", "2026-10-01T00:00:00Z");
    assert.deepEqual(events.map((e) => e.email), ["new@a.nl"]);
    assert.deepEqual(body, { filter: "FILTER_VAL_UNSUBSCRIBED", limit: 100 });
  }));

test("client errors include status and path but never the key", () =>
  withKey(async () => {
    globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
    await assert.rejects(
      () => addLeadToCampaign("camp-1", { email: "a@a.nl" }),
      (error: Error) => /Instantly 401 bij \/leads/.test(error.message) && !error.message.includes("test-key"),
    );
  }));

test("listCampaigns validates the response shape", () =>
  withKey(async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }));
    await assert.rejects(() => listCampaigns());
  }));

test("calls without a key fail with a clear Dutch message", async () => {
  const before = process.env.INSTANTLY_API_KEY;
  delete process.env.INSTANTLY_API_KEY;
  await assert.rejects(() => listCampaigns(), /INSTANTLY_API_KEY ontbreekt/);
  if (before !== undefined) process.env.INSTANTLY_API_KEY = before;
});
