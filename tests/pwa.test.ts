import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTALL_HINT_SNOOZE_MS, isIosDevice, shouldShowInstallHint } from "../src/lib/pwa/install-hint";
import { appleStartupImages } from "../src/lib/pwa/splash";
import { existsSync } from "node:fs";
import { join } from "node:path";

const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const now = 1_800_000_000_000;

test("iOS detection: iPhone, iPad as Mac with touch, not a real Mac or Android", () => {
  assert.equal(isIosDevice(iphone, 5), true);
  assert.equal(isIosDevice(ipad, 5), true);
  assert.equal(isIosDevice(ipad, 0), false);
  assert.equal(isIosDevice(android, 5), false);
});

test("install hint: only in the iOS browser, not installed, not snoozed", () => {
  const base = { userAgent: iphone, maxTouchPoints: 5, standalone: false, dismissedAt: null, now };
  assert.equal(shouldShowInstallHint(base), true);
  assert.equal(shouldShowInstallHint({ ...base, standalone: true }), false);
  assert.equal(shouldShowInstallHint({ ...base, userAgent: android }), false);
  assert.equal(shouldShowInstallHint({ ...base, dismissedAt: now - 1000 }), false);
  assert.equal(shouldShowInstallHint({ ...base, dismissedAt: now - INSTALL_HINT_SNOOZE_MS - 1 }), true);
  assert.equal(shouldShowInstallHint({ ...base, dismissedAt: Number.NaN }), true);
});

test("every iOS launch screen has its image and an exact media query", () => {
  assert.ok(appleStartupImages.length >= 10);
  for (const image of appleStartupImages) {
    assert.ok(existsSync(join(process.cwd(), "public", image.url)), `missing ${image.url}`);
    assert.match(image.media, /^\(device-width: \d+px\) and \(device-height: \d+px\) and \(-webkit-device-pixel-ratio: [23]\) and \(orientation: portrait\)$/);
  }
});
