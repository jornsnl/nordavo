import { test } from "node:test";
import assert from "node:assert/strict";
import { isSignInLinkType, mayUseSignInLink, signInLinkUrl } from "@/lib/security/sign-in-link";

test("sign-in links are for Work guests only, never staff or clients", () => {
  assert.equal(mayUseSignInLink("external"), true);
  assert.equal(mayUseSignInLink("admin"), false);
  assert.equal(mayUseSignInLink("member"), false);
  assert.equal(mayUseSignInLink("client"), false);
});

test("only magic link types count as a sign-in link at /auth/confirm", () => {
  assert.ok(isSignInLinkType("email"));
  assert.ok(isSignInLinkType("magiclink"));
  for (const other of ["invite", "recovery", "signup", "email_change", null]) assert.ok(!isSignInLinkType(other));
});

test("signInLinkUrl lands on /auth/confirm and keeps next", () => {
  assert.equal(
    signInLinkUrl("https://portal.nordavo.nl/", "abc+/=", "/work/invite/tok"),
    "https://portal.nordavo.nl/auth/confirm?token_hash=abc%2B%2F%3D&type=email&next=%2Fwork%2Finvite%2Ftok",
  );
});
