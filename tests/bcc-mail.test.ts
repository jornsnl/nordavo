import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  bccActivityNotes,
  bccExternalId,
  cleanAddress,
  dedupeKey,
  externalRecipients,
  findBccTokens,
  groupByCompany,
  isOnDomain,
  normalizeMessageId,
  parseAddressList,
  parseDomainList,
  parseInboundMail,
  parseMailDate,
  senderMatches,
  verifyInboundSecret,
  verifySvixSignature,
} from "../src/lib/mail/bcc";

const DOMAIN = "log.nordavo.nl";
const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2";
const BCC = `${TOKEN}@${DOMAIN}`;

const postmark = {
  FromName: "Julius van Bragt",
  From: "Julius@Nordavo.nl",
  FromFull: { Email: "Julius@Nordavo.nl", Name: "Julius van Bragt", MailboxHash: "" },
  To: '"Jansen, Piet" <Piet@Acme.nl>, sanne@globex.com',
  ToFull: [
    { Email: "Piet@Acme.nl", Name: "Jansen, Piet", MailboxHash: "" },
    { Email: "sanne@globex.com", Name: "Sanne", MailboxHash: "" },
  ],
  Cc: "floris@nordavo.nl, kees@acme.nl",
  CcFull: [
    { Email: "floris@nordavo.nl", Name: "Floris" },
    { Email: "kees@acme.nl", Name: "Kees" },
  ],
  Bcc: "",
  BccFull: [],
  OriginalRecipient: BCC,
  Subject: "Voorstel developers",
  MessageID: "73e6d360-66eb-11e1-8e72-a8904824019b",
  Date: "Thu, 12 Nov 2026 10:15:00 +0100",
  Headers: [
    { Name: "Message-ID", Value: "<CAF=abc123@mail.gmail.com>" },
    { Name: "X-Spam-Status", Value: "No" },
  ],
  Attachments: [{ Name: "Voorstel.pdf", Content: "JVBERi0=", ContentType: "application/pdf", ContentLength: 6 }],
  TextBody: "Hoi Piet",
};

test("bcc: addresses from headers, arrays and objects", () => {
  assert.equal(cleanAddress("Piet <Piet@Acme.NL>"), "piet@acme.nl");
  assert.equal(cleanAddress("mailto:a@b.nl"), "a@b.nl");
  assert.equal(cleanAddress("no address"), null);
  assert.deepEqual(parseAddressList('"Jansen, Piet" <piet@acme.nl>; b@c.nl, b@c.nl'), ["piet@acme.nl", "b@c.nl"]);
  assert.deepEqual(parseAddressList([{ email: "A@x.nl" }, { address: "b@y.nl", name: "B" }, "c@z.nl"]), ["a@x.nl", "b@y.nl", "c@z.nl"]);
  assert.deepEqual(parseAddressList({ value: [{ address: "m@p.nl" }] }), ["m@p.nl"]);
  assert.deepEqual(parseAddressList(null), []);
});

test("bcc: domains", () => {
  assert.equal(isOnDomain("a@nordavo.nl", ["nordavo.nl"]), true);
  assert.equal(isOnDomain("a@mail.nordavo.nl", ["nordavo.nl"]), true);
  assert.equal(isOnDomain("a@notnordavo.nl", ["nordavo.nl"]), false);
  assert.deepEqual(parseDomainList(" nordavo.nl, @nordavo.com "), ["nordavo.nl", "nordavo.com"]);
  assert.deepEqual(parseDomainList("", ["x.nl"]), ["x.nl"]);
});

test("bcc: Message-ID and date", () => {
  assert.equal(normalizeMessageId(" <abc@x> "), "abc@x");
  assert.equal(normalizeMessageId(""), null);
  assert.equal(parseMailDate("Thu, 12 Nov 2026 10:15:00 +0100"), "2026-11-12T09:15:00.000Z");
  assert.equal(parseMailDate("Thu, 12 Nov 2026 10:15:00 +0000 (UTC)"), "2026-11-12T10:15:00.000Z");
  assert.equal(parseMailDate("garbage"), null);
});

test("bcc: reads the Postmark inbound format", () => {
  const mail = parseInboundMail(postmark);
  assert.ok(mail);
  assert.equal(mail.provider, "postmark");
  assert.equal(mail.from, "julius@nordavo.nl");
  assert.deepEqual(mail.to, ["piet@acme.nl", "sanne@globex.com"]);
  assert.deepEqual(mail.cc, ["floris@nordavo.nl", "kees@acme.nl"]);
  assert.deepEqual(mail.envelopeTo, [BCC]);
  assert.equal(mail.subject, "Voorstel developers");
  assert.equal(mail.date, "2026-11-12T09:15:00.000Z");
  // The real Message-ID header, not Postmark's own id.
  assert.equal(mail.messageId, "CAF=abc123@mail.gmail.com");
  assert.deepEqual(mail.attachments, ["Voorstel.pdf"]);
});

test("bcc: reads the Resend inbound format", () => {
  const mail = parseInboundMail({
    type: "email.received",
    created_at: "2026-11-12T09:16:00.000Z",
    data: {
      email_id: "4ef9a417",
      created_at: "2026-11-12T09:15:30.000Z",
      from: "Julius <julius@nordavo.nl>",
      to: ["piet@acme.nl"],
      cc: [],
      bcc: [BCC],
      subject: "Kennismaking",
      message_id: "<x1@nordavo.nl>",
      attachments: [{ id: "a1", filename: "cv.pdf", content_type: "application/pdf" }],
    },
  });
  assert.ok(mail);
  assert.equal(mail.provider, "resend");
  assert.equal(mail.from, "julius@nordavo.nl");
  assert.deepEqual(mail.bcc, [BCC]);
  assert.equal(mail.messageId, "x1@nordavo.nl");
  assert.equal(mail.date, "2026-11-12T09:15:30.000Z");
  assert.deepEqual(mail.attachments, ["cv.pdf"]);
});

test("bcc: reads a generic (Cloudflare Email Worker) JSON", () => {
  const mail = parseInboundMail({
    from: "julius@nordavo.nl",
    to: "piet@acme.nl",
    envelope: { from: "julius@nordavo.nl", to: BCC },
    subject: "Hoi",
    headers: { "message-id": "<cf@nordavo.nl>", date: "Thu, 12 Nov 2026 10:15:00 +0100" },
    attachments: ["offerte.xlsx"],
  });
  assert.ok(mail);
  assert.equal(mail.provider, "generic");
  assert.deepEqual(mail.envelopeTo, [BCC]);
  assert.equal(mail.messageId, "cf@nordavo.nl");
  assert.equal(mail.date, "2026-11-12T09:15:00.000Z");
  assert.deepEqual(mail.attachments, ["offerte.xlsx"]);
  assert.equal(parseInboundMail({ hello: "world" }), null);
  assert.equal(parseInboundMail("text"), null);
});

test("bcc: finds the token on the BCC domain only", () => {
  const mail = parseInboundMail(postmark)!;
  assert.deepEqual(findBccTokens(mail, DOMAIN), [{ token: TOKEN, address: BCC }]);
  assert.deepEqual(findBccTokens(mail, "other.nl"), []);
  const plus = { ...mail, envelopeTo: [`${TOKEN}+x@${DOMAIN}`], to: [`short@${DOMAIN}`] };
  assert.deepEqual(findBccTokens(plus, DOMAIN).map((t) => t.token), [TOKEN]);
});

test("bcc: only the owner of the address counts, case insensitive", () => {
  assert.equal(senderMatches("Julius@Nordavo.nl", "julius@nordavo.nl"), true);
  assert.equal(senderMatches("Julius <JULIUS@nordavo.nl>", "julius@nordavo.nl"), true);
  assert.equal(senderMatches("floris@nordavo.nl", "julius@nordavo.nl"), false);
  assert.equal(senderMatches(null, "julius@nordavo.nl"), false);
  assert.equal(senderMatches("julius@nordavo.nl", null), false);
});

test("bcc: recipients without Nordavo, the BCC domain and the sender", () => {
  const mail = parseInboundMail(postmark)!;
  const withBcc = { ...mail, to: [...mail.to, BCC, "julius@nordavo.nl"] };
  assert.deepEqual(externalRecipients(withBcc, ["nordavo.nl"], DOMAIN), ["piet@acme.nl", "sanne@globex.com", "kees@acme.nl"]);
});

test("bcc: one activity per company, on the first contact", () => {
  const groups = groupByCompany(
    ["piet@acme.nl", "sanne@globex.com", "kees@acme.nl", "unknown@else.nl"],
    [
      { id: "c-piet", company_id: "acme", email: "Piet@Acme.nl" },
      { id: "c-kees", company_id: "acme", email: "kees@acme.nl" },
      { id: "c-sanne", company_id: "globex", email: "sanne@globex.com" },
      { id: "c-piet-2", company_id: "other", email: "piet@acme.nl" },
    ],
  );
  assert.deepEqual(groups, [
    { companyId: "acme", contactId: "c-piet", contactIds: ["c-piet", "c-kees"], recipients: ["piet@acme.nl", "kees@acme.nl"] },
    { companyId: "globex", contactId: "c-sanne", contactIds: ["c-sanne"], recipients: ["sanne@globex.com"] },
  ]);
  assert.deepEqual(groupByCompany(["x@y.nl"], []), []);
});

test("bcc: duplicates are prevented by Message-ID", () => {
  const mail = parseInboundMail(postmark)!;
  assert.equal(dedupeKey(mail), "CAF=abc123@mail.gmail.com");
  const noId = { ...mail, messageId: null };
  assert.match(dedupeKey(noId), /^generated-[0-9a-f]{40}$/);
  assert.equal(dedupeKey(noId), dedupeKey({ ...noId }));
  assert.notEqual(dedupeKey(noId), dedupeKey({ ...noId, subject: "Other" }));
  assert.equal(bccExternalId("abc@x", "acme"), "bcc:abc@x:acme");
});

test("bcc: notes show subject, recipients and attachments", () => {
  const mail = parseInboundMail(postmark)!;
  const notes = bccActivityNotes(mail, { recipients: ["piet@acme.nl"] });
  assert.match(notes, /^Subject: Voorstel developers/);
  assert.match(notes, /To: piet@acme.nl, sanne@globex.com/);
  assert.match(notes, /Cc: floris@nordavo.nl, kees@acme.nl/);
  assert.match(notes, /Attachments: Voorstel.pdf/);
});

test("bcc: the shared secret in a header, Bearer, Basic auth or the URL", () => {
  const secret = "s3cret-value";
  assert.equal(verifyInboundSecret(secret, { header: secret }), true);
  assert.equal(verifyInboundSecret(secret, { authorization: `Bearer ${secret}` }), true);
  const basic = Buffer.from(`inbound:${secret}`).toString("base64");
  assert.equal(verifyInboundSecret(secret, { authorization: `Basic ${basic}` }), true);
  assert.equal(verifyInboundSecret(secret, { query: secret }), true);
  assert.equal(verifyInboundSecret(secret, { header: "wrong" }), false);
  assert.equal(verifyInboundSecret(secret, {}), false);
  assert.equal(verifyInboundSecret(undefined, { header: secret }), false);
});

test("bcc: Svix signature of Resend webhooks", () => {
  const key = Buffer.from("resend-test-key").toString("base64");
  const secret = `whsec_${key}`;
  const body = '{"type":"email.received"}';
  const now = 1_800_000_000_000;
  const timestamp = String(now / 1000);
  const sig = createHmac("sha256", Buffer.from(key, "base64")).update(`msg_1.${timestamp}.${body}`).digest("base64");
  assert.equal(verifySvixSignature(body, secret, { id: "msg_1", timestamp, signature: `v1,${sig}` }, now), true);
  assert.equal(verifySvixSignature(body, secret, { id: "msg_1", timestamp, signature: `v1,bad v1,${sig}` }, now), true);
  assert.equal(verifySvixSignature(`${body} `, secret, { id: "msg_1", timestamp, signature: `v1,${sig}` }, now), false);
  assert.equal(verifySvixSignature(body, secret, { id: "msg_1", timestamp, signature: `v1,${sig}` }, now + 600_000), false);
});
