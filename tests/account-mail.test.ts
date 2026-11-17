import assert from "node:assert/strict";
import test from "node:test";
import { passwordResetMail, roleIntro, userInviteMail } from "@/lib/notify/account-mail";
import { PRODUCTION_SITE_URL, resolveSiteUrl } from "@/lib/site-url";

test("a missing or localhost site URL never reaches production mail", () => {
  assert.equal(resolveSiteUrl({ NODE_ENV: "production" }), PRODUCTION_SITE_URL);
  assert.equal(resolveSiteUrl({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }), PRODUCTION_SITE_URL);
  assert.equal(
    resolveSiteUrl({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "", VERCEL_PROJECT_PRODUCTION_URL: "portal.example.nl" }),
    "https://portal.example.nl",
  );
});

test("a configured address wins, without a trailing slash", () => {
  assert.equal(resolveSiteUrl({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://portal.nordavo.nl/" }), "https://portal.nordavo.nl");
  assert.equal(resolveSiteUrl({ NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }), "http://localhost:3000");
  assert.equal(resolveSiteUrl({ NODE_ENV: "development" }), "http://localhost:3000");
});

test("the invitation says who invites and what each role can do", () => {
  const client = userInviteMail({ name: "Anna de Vries", url: "https://portal.nordavo.nl/auth/confirm?x=1", invitedBy: "Julius", role: "client", company: "Acme BV" });
  assert.ok(client.subject.includes("Acme BV"));
  assert.ok(client.text.includes("Julius of Nordavo invites you to the client portal of Acme BV"));
  assert.ok(client.html.includes("https://portal.nordavo.nl/auth/confirm?x=1"));
  assert.ok(client.html.includes("Hi Anna"));

  assert.ok(roleIntro({ role: "admin", invitedBy: "Julius" }).includes("admin"));
  assert.ok(roleIntro({ role: "member", invitedBy: "Julius", modules: ["Sales", "Clients"] }).includes("Sales, Clients"));
  assert.ok(roleIntro({ role: "content", invitedBy: "Julius", contentRole: "reviewer" }).includes("reviewer"));
  assert.ok(roleIntro({ role: "external", invitedBy: "Julius" }).includes("Work"));
});

test("the password reset mail has the link and no localhost", () => {
  const mail = passwordResetMail({ name: "Sabine Tiellema", url: "https://portal.nordavo.nl/auth/confirm?token_hash=abc&type=recovery&next=/auth/password" });
  assert.ok(mail.text.includes("https://portal.nordavo.nl/auth/confirm"));
  assert.ok(mail.html.includes("Choose a new password"));
  assert.ok(!mail.html.includes("localhost"));
});
