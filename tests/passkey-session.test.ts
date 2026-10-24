import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createPasskeySessionValue, isPasskeySession } from "@/lib/security/passkey-session";

const SESSION_ID = "5f1d2c3b-8a9e-4f60-9b1c-2d3e4f5a6b7c";
const saved = {
  passkey: process.env.PASSKEY_SESSION_SECRET,
  supabase: process.env.SUPABASE_SECRET_KEY,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  process.env.PASSKEY_SESSION_SECRET = "test-secret";
  delete process.env.SUPABASE_SECRET_KEY;
});

afterEach(() => {
  restore("PASSKEY_SESSION_SECRET", saved.passkey);
  restore("SUPABASE_SECRET_KEY", saved.supabase);
});

test("a fresh cookie value proves a passkey sign-in for its own session", async () => {
  const value = await createPasskeySessionValue(SESSION_ID);
  assert.ok(value);
  assert.ok(value.startsWith(`${SESSION_ID}.`));
  assert.equal(await isPasskeySession(value, SESSION_ID), true);
});

test("the cookie does not carry over to another session", async () => {
  const value = await createPasskeySessionValue(SESSION_ID);
  assert.equal(await isPasskeySession(value ?? undefined, "00000000-0000-4000-8000-000000000000"), false);
  assert.equal(await isPasskeySession(value ?? undefined, undefined), false);
});

test("a tampered signature or session id is rejected", async () => {
  const value = (await createPasskeySessionValue(SESSION_ID)) ?? "";
  const signature = value.slice(value.lastIndexOf(".") + 1);
  const flipped = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;

  assert.equal(await isPasskeySession(`${SESSION_ID}.${flipped}`, SESSION_ID), false);
  assert.equal(await isPasskeySession(`${SESSION_ID}.${signature.slice(1)}`, SESSION_ID), false);
  assert.equal(await isPasskeySession(`${SESSION_ID}.`, SESSION_ID), false);
  assert.equal(await isPasskeySession(SESSION_ID, SESSION_ID), false);
  assert.equal(await isPasskeySession(undefined, SESSION_ID), false);

  const otherId = "00000000-0000-4000-8000-000000000000";
  assert.equal(await isPasskeySession(`${otherId}.${signature}`, otherId), false);
});

test("a value signed with another secret is rejected", async () => {
  const value = await createPasskeySessionValue(SESSION_ID);
  process.env.PASSKEY_SESSION_SECRET = "another-secret";
  assert.equal(await isPasskeySession(value ?? undefined, SESSION_ID), false);
});

test("falls back to SUPABASE_SECRET_KEY", async () => {
  delete process.env.PASSKEY_SESSION_SECRET;
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  const value = await createPasskeySessionValue(SESSION_ID);
  assert.ok(value);
  assert.equal(await isPasskeySession(value, SESSION_ID), true);
});

test("without a secret nothing is signed or accepted", async () => {
  const value = await createPasskeySessionValue(SESSION_ID);
  delete process.env.PASSKEY_SESSION_SECRET;
  delete process.env.SUPABASE_SECRET_KEY;

  assert.equal(await createPasskeySessionValue(SESSION_ID), null);
  assert.equal(await isPasskeySession(value ?? undefined, SESSION_ID), false);
});

test("an empty session id is never signed", async () => {
  assert.equal(await createPasskeySessionValue(""), null);
});
