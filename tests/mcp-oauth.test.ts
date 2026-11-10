import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  accessFromScope,
  authorizationResponseUrl,
  authorizationServerMetadata,
  checkAuthorizeRequest,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  isAllowedRedirectUri,
  parseClientRegistration,
  protectedResourceMetadata,
  redirectUriMatches,
  refreshAccessToken,
  revokeOAuthToken,
  verifyPkce,
} from "@/lib/mcp/oauth";
import { authenticateMcpToken } from "@/lib/mcp/tokens";

const SITE = "https://portal.nordavo.nl";
const USER = "00000000-0000-4000-8000-0000000000aa";
const CLIENT = {
  client_id: "nrdo_testclient",
  client_name: "Claude",
  client_uri: null,
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "http://localhost:33418/callback"],
};
const staffProfile = { id: USER, full_name: "Julius", email: "julius@nordavo.nl", role: "member", modules: null };

// ---------------------------------------------------------------------------
// A small in-memory stand-in for the Supabase admin client
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function memoryDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: ((row: Row) => boolean)[] = [];
    let mode: "select" | "update" | "insert" | "delete" = "select";
    let values: Row | Row[] | null = null;
    let returning = false;

    const run = () => {
      if (mode === "insert") {
        const list = (Array.isArray(values) ? values : [values]) as Row[];
        const inserted = list.map((v) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...v }));
        rows.push(...inserted);
        return { data: inserted, error: null };
      }
      const hit = rows.filter((row) => filters.every((f) => f(row)));
      if (mode === "update") {
        hit.forEach((row) => Object.assign(row, values));
        return { data: returning ? hit : null, error: null };
      }
      if (mode === "delete") {
        for (const row of hit) rows.splice(rows.indexOf(row), 1);
        return { data: null, error: null };
      }
      return { data: hit, error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => {
        if (mode !== "select") returning = true;
        return builder;
      },
      insert: (v: Row | Row[]) => ((mode = "insert"), (values = v), builder),
      update: (v: Row) => ((mode = "update"), (values = v), builder),
      delete: () => ((mode = "delete"), builder),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), builder),
      lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), builder),
      gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), builder),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), builder),
      maybeSingle: async () => {
        const { data } = run();
        return { data: (data as Row[] | null)?.[0] ?? null, error: null };
      },
      single: async () => {
        const { data } = run();
        return { data: (data as Row[] | null)?.[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: { from } as any, tables };
}

function pkcePair() {
  const verifier = "v".repeat(20) + crypto.randomUUID().replaceAll("-", "");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function authorizeInput(challenge: string, extra: Record<string, string> = {}) {
  return {
    response_type: "code",
    client_id: CLIENT.client_id,
    redirect_uri: CLIENT.redirect_uris[0],
    state: "xyz",
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("metadata points the MCP resource to this authorization server", () => {
  const resource = protectedResourceMetadata(`${SITE}/`);
  assert.equal(resource.resource, `${SITE}/api/mcp`);
  assert.deepEqual(resource.authorization_servers, [SITE]);
  const server = authorizationServerMetadata(SITE);
  assert.equal(server.issuer, SITE);
  assert.equal(server.authorization_endpoint, `${SITE}/oauth/authorize`);
  assert.equal(server.token_endpoint, `${SITE}/api/oauth/token`);
  assert.equal(server.registration_endpoint, `${SITE}/api/oauth/register`);
  assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);
});

test("verifyPkce checks S256 challenges", () => {
  const { verifier, challenge } = pkcePair();
  assert.ok(verifyPkce(verifier, challenge));
  assert.ok(!verifyPkce(`${verifier}x`, challenge));
  assert.ok(!verifyPkce("short", challenge));
});

test("redirect URIs: https, http on loopback and private-use schemes only", () => {
  assert.ok(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback"));
  assert.ok(isAllowedRedirectUri("http://localhost:1234/callback"));
  assert.ok(isAllowedRedirectUri("http://127.0.0.1/cb"));
  assert.ok(isAllowedRedirectUri("com.example.app:/callback"));
  assert.ok(!isAllowedRedirectUri("http://evil.example/cb"));
  assert.ok(!isAllowedRedirectUri("https://claude.ai/cb#frag"));
  assert.ok(!isAllowedRedirectUri("javascript:alert(1)"));
  assert.ok(!isAllowedRedirectUri("data:text/html,hi"));
  assert.ok(!isAllowedRedirectUri("not a url"));
});

test("redirectUriMatches is exact, except for the port of loopback URIs", () => {
  assert.ok(redirectUriMatches(CLIENT.redirect_uris, CLIENT.redirect_uris[0]));
  assert.ok(redirectUriMatches(CLIENT.redirect_uris, "http://localhost:51000/callback"));
  assert.ok(!redirectUriMatches(CLIENT.redirect_uris, "http://localhost:51000/other"));
  assert.ok(!redirectUriMatches(CLIENT.redirect_uris, "https://claude.ai/api/mcp/auth_callback/x"));
  assert.ok(!redirectUriMatches(CLIENT.redirect_uris, "https://evil.example/api/mcp/auth_callback"));
});

test("parseClientRegistration validates metadata", () => {
  const ok = parseClientRegistration({ client_name: " Claude ", redirect_uris: CLIENT.redirect_uris });
  assert.ok(ok.ok);
  assert.equal(ok.value.client_name, "Claude");
  assert.equal(parseClientRegistration({ redirect_uris: [] }).ok, false);
  assert.equal(parseClientRegistration({ redirect_uris: ["http://evil.example/cb"] }).ok, false);
  assert.equal(parseClientRegistration({ redirect_uris: ["https://a.b/c"], grant_types: ["client_credentials"] }).ok, false);
  assert.equal(parseClientRegistration(null).ok, false);
  const unnamed = parseClientRegistration({ redirect_uris: ["https://a.b/c"] });
  assert.ok(unnamed.ok && unnamed.value.client_name === "MCP client");
});

test("scope and response URL helpers", () => {
  assert.equal(accessFromScope("read write"), "write");
  assert.equal(accessFromScope("read"), "read");
  assert.equal(accessFromScope(null), "read");
  const url = new URL(authorizationResponseUrl("https://claude.ai/cb?x=1", { code: "c", state: "s", iss: SITE, error: null }));
  assert.equal(url.searchParams.get("x"), "1");
  assert.equal(url.searchParams.get("code"), "c");
  assert.equal(url.searchParams.get("state"), "s");
  assert.equal(url.searchParams.has("error"), false);
});

// ---------------------------------------------------------------------------
// The flow: authorize, code, token, MCP call, refresh, revoke
// ---------------------------------------------------------------------------

test("checkAuthorizeRequest: fatal without a trusted redirect, redirect errors otherwise", async () => {
  const { db } = memoryDb({ oauth_clients: [{ ...CLIENT }] });
  const { challenge } = pkcePair();

  assert.equal((await checkAuthorizeRequest({}, db, SITE)).kind, "fatal");
  assert.equal((await checkAuthorizeRequest(authorizeInput(challenge, { client_id: "nope" }), db, SITE)).kind, "fatal");
  assert.equal(
    (await checkAuthorizeRequest(authorizeInput(challenge, { redirect_uri: "https://evil.example/cb" }), db, SITE)).kind,
    "fatal",
  );

  const noPkce = await checkAuthorizeRequest(authorizeInput(""), db, SITE);
  assert.equal(noPkce.kind, "redirect");
  const plain = await checkAuthorizeRequest(authorizeInput(challenge, { code_challenge_method: "plain" }), db, SITE);
  assert.ok(plain.kind === "redirect" && plain.error === "invalid_request");
  const otherResource = await checkAuthorizeRequest(authorizeInput(challenge, { resource: "https://other.example/mcp" }), db, SITE);
  assert.ok(otherResource.kind === "redirect" && otherResource.error === "invalid_target");
  const badScope = await checkAuthorizeRequest(authorizeInput(challenge, { scope: "admin" }), db, SITE);
  assert.ok(badScope.kind === "redirect" && badScope.error === "invalid_scope");

  const ok = await checkAuthorizeRequest(authorizeInput(challenge, { scope: "read write", resource: `${SITE}/api/mcp` }), db, SITE);
  assert.ok(ok.kind === "ok");
  assert.equal(ok.access, "write");
  assert.equal(ok.params.state, "xyz");
});

test("full flow: code once, token works on the MCP server, refresh rotates, revoke ends it", async () => {
  const { db, tables } = memoryDb({ oauth_clients: [{ ...CLIENT }], profiles: [staffProfile] });
  const { verifier, challenge } = pkcePair();

  const check = await checkAuthorizeRequest(authorizeInput(challenge), db, SITE);
  assert.ok(check.kind === "ok");
  const code = await createAuthorizationCode(db, { params: check.params, userId: USER, access: "write" });
  assert.ok(code);
  assert.equal(tables.oauth_codes.length, 1);
  assert.notEqual(tables.oauth_codes[0].code_hash, code, "only the hash is stored");

  const form = { code, client_id: CLIENT.client_id, redirect_uri: CLIENT.redirect_uris[0], code_verifier: verifier, resource: "" };
  const wrongVerifier = await exchangeAuthorizationCode(db, { ...form, code_verifier: pkcePair().verifier }, SITE);
  assert.ok(!wrongVerifier.ok && wrongVerifier.error === "invalid_grant");

  // The failed attempt spent the code: a second try with the right verifier fails too.
  const spent = await exchangeAuthorizationCode(db, form, SITE);
  assert.ok(!spent.ok);

  const code2 = await createAuthorizationCode(db, { params: check.params, userId: USER, access: "write" });
  const tokens = await exchangeAuthorizationCode(db, { ...form, code: code2! }, SITE);
  assert.ok(tokens.ok);
  assert.match(tokens.body.access_token, /^nrda_/);
  assert.match(tokens.body.refresh_token, /^nrdr_/);
  assert.equal(tokens.body.scope, "read write");
  assert.equal(tokens.body.expires_in, 3600);

  const auth = await authenticateMcpToken(`Bearer ${tokens.body.access_token}`, db);
  assert.ok(auth.ok);
  assert.equal(auth.context.access, "write");
  assert.equal(auth.context.tokenName, "Claude");
  assert.equal(auth.context.userId, USER);

  const refreshed = await refreshAccessToken(db, { refresh_token: tokens.body.refresh_token, client_id: CLIENT.client_id });
  assert.ok(refreshed.ok);
  assert.notEqual(refreshed.body.access_token, tokens.body.access_token);
  const oldAccess = await authenticateMcpToken(`Bearer ${tokens.body.access_token}`, db);
  assert.ok(!oldAccess.ok && oldAccess.reason === "invalid");
  const reused = await refreshAccessToken(db, { refresh_token: tokens.body.refresh_token, client_id: CLIENT.client_id });
  assert.ok(!reused.ok);

  await revokeOAuthToken(db, refreshed.body.refresh_token);
  const revoked = await authenticateMcpToken(`Bearer ${refreshed.body.access_token}`, db);
  assert.ok(!revoked.ok && revoked.reason === "revoked");
});

test("tokens stop working when the access token expires or the owner leaves the team", async () => {
  const { db, tables } = memoryDb({ oauth_clients: [{ ...CLIENT }], profiles: [staffProfile] });
  const { verifier, challenge } = pkcePair();
  const check = await checkAuthorizeRequest(authorizeInput(challenge), db, SITE);
  assert.ok(check.kind === "ok");
  const code = await createAuthorizationCode(db, { params: check.params, userId: USER, access: "read" });
  const tokens = await exchangeAuthorizationCode(
    db,
    { code: code!, client_id: CLIENT.client_id, redirect_uri: "", code_verifier: verifier, resource: "" },
    SITE,
  );
  assert.ok(tokens.ok);
  assert.equal(tokens.body.scope, "read");

  const later = new Date(Date.now() + 2 * 3600 * 1000);
  const expired = await authenticateMcpToken(`Bearer ${tokens.body.access_token}`, db, later);
  assert.ok(!expired.ok && expired.reason === "expired");

  (tables.profiles[0] as Row).role = "client";
  const forbidden = await authenticateMcpToken(`Bearer ${tokens.body.access_token}`, db);
  assert.ok(!forbidden.ok && forbidden.reason === "forbidden");
  const noRefresh = await refreshAccessToken(db, { refresh_token: tokens.body.refresh_token, client_id: CLIENT.client_id });
  assert.ok(!noRefresh.ok);
});

test("an expired code is refused", async () => {
  const { db } = memoryDb({ oauth_clients: [{ ...CLIENT }], profiles: [staffProfile] });
  const { verifier, challenge } = pkcePair();
  const check = await checkAuthorizeRequest(authorizeInput(challenge), db, SITE);
  assert.ok(check.kind === "ok");
  const past = new Date(Date.now() - 11 * 60 * 1000);
  const code = await createAuthorizationCode(db, { params: check.params, userId: USER, access: "read" }, past);
  const result = await exchangeAuthorizationCode(
    db,
    { code: code!, client_id: CLIENT.client_id, redirect_uri: "", code_verifier: verifier, resource: "" },
    SITE,
  );
  assert.ok(!result.ok && result.error === "invalid_grant");
});
