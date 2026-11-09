import assert from "node:assert/strict";
import test from "node:test";
import { isFullDocument, mailButton, renderMailLayout, testMail } from "@/lib/notify/layout";
import { inviteMail } from "@/lib/forms/mail-content";

test("the layout wraps a fragment in a full branded document", () => {
  const html = renderMailLayout({ body: "<p>Hello</p>", title: "Hi <you>", siteUrl: "https://portal.nordavo.nl" });
  assert.ok(isFullDocument(html));
  assert.ok(html.includes("<p>Hello</p>"));
  assert.ok(html.includes("#0a1a2f"), "navy header");
  assert.ok(html.includes("#f2a33a"), "saffron rule");
  assert.ok(html.includes("https://portal.nordavo.nl/email/logo-mark.png"));
  assert.ok(html.includes("Hi &lt;you&gt;"));
});

test("no logo image on a non https site, so inboxes never show a broken image", () => {
  const html = renderMailLayout({ body: "x", siteUrl: "http://localhost:3000" });
  assert.ok(!html.includes("logo-mark.png"));
});

test("fragments from templates are not full documents, so sendMail wraps them", () => {
  const mail = inviteMail({ candidateName: "Asha", vacancyTitle: "Dev", link: "https://x/apply/t", deadline: null });
  assert.equal(isFullDocument(mail.html), false);
  assert.ok(mailButton("https://x/?a=1&b=2", "Go").includes("https://x/?a=1&amp;b=2"));
});

test("the test mail names the sender and escapes it", () => {
  const mail = testMail({ sentBy: "<b>Jorn</b>", sentAt: new Date("2026-11-09T10:00:00Z"), siteUrl: "https://portal.nordavo.nl" });
  assert.ok(isFullDocument(mail.html));
  assert.ok(mail.html.includes("&lt;b&gt;Jorn&lt;/b&gt;"));
  assert.ok(mail.text.includes("https://portal.nordavo.nl/dashboard/settings"));
});
