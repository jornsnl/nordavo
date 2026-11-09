import { test } from "node:test";
import assert from "node:assert/strict";
import { academyInviteMail } from "@/lib/academy/mail";
import { isMailCategory } from "@/lib/notify/categories";

test("the invitation is in the person's language and escapes names", () => {
  const nl = academyInviteMail({
    name: "Sabine de Vries",
    url: "https://portal.nordavo.nl/auth/confirm?token_hash=abc&type=invite&next=/auth/password",
    invitedBy: "Julius <script>",
    locale: "nl",
    courseTitle: "Werken met je developer in India",
    linkKind: "new",
    siteUrl: "https://portal.nordavo.nl",
  });
  assert.equal(nl.subject, "Je bent uitgenodigd voor de Nordavo Academy");
  assert.match(nl.html, /Hoi Sabine,/);
  assert.match(nl.html, /Stel je wachtwoord in/);
  assert.match(nl.html, /Werken met je developer in India/);
  assert.ok(!nl.html.includes("<script>"));
  assert.match(nl.text, /Stel je wachtwoord in: https:\/\/portal\.nordavo\.nl\/auth\/confirm/);

  const en = academyInviteMail({
    name: "Asha",
    url: "https://portal.nordavo.nl/login?next=/academy",
    invitedBy: "Floris",
    locale: "en",
    courseTitle: null,
    linkKind: "login",
  });
  assert.equal(en.subject, "You are invited to the Nordavo Academy");
  assert.match(en.html, /Sign in/);
  assert.match(en.text, /existing password/);
  assert.ok(isMailCategory("academy_invite"));
});
