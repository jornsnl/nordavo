import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePassword } from "@/lib/security/generate-password";

test("generatePassword has the asked length within 8 to 72", () => {
  assert.equal(generatePassword().length, 16);
  assert.equal(generatePassword(20).length, 20);
  assert.equal(generatePassword(3).length, 8);
  assert.equal(generatePassword(500).length, 72);
});

test("generatePassword mixes every character class and skips look-alikes", () => {
  for (let i = 0; i < 200; i++) {
    const pw = generatePassword(8);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[2-9]/);
    assert.match(pw, /[!@#$%&*?+=]/);
    assert.doesNotMatch(pw, /[0O1lI]/);
  }
});

test("generatePassword does not repeat itself", () => {
  const seen = new Set(Array.from({ length: 100 }, () => generatePassword()));
  assert.equal(seen.size, 100);
});
