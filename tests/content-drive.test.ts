import { test } from "node:test";
import assert from "node:assert/strict";
import { driveErrorMessage, extractFolderId, folderPath, orientationOf, safeFileName, shouldImport, summaryText, takenOn } from "../src/lib/content/drive";
import { mediaKind, parseMediaFilters, parseMediaSuggestion } from "../src/lib/content/media-utils";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

test("drive: folder id from an id or a link", () => {
  assert.equal(extractFolderId(ID), ID);
  assert.equal(extractFolderId(` https://drive.google.com/drive/folders/${ID}?usp=sharing `), ID);
  assert.equal(extractFolderId(`https://drive.google.com/drive/u/0/folders/${ID}`), ID);
  assert.equal(extractFolderId(`https://drive.google.com/open?id=${ID}`), ID);
  assert.equal(extractFolderId(`https://evil.example.com/drive/folders/${ID}`), null);
  assert.equal(extractFolderId("short"), null);
  assert.equal(extractFolderId(""), null);
});

test("drive: what is imported, orientation, date and folder path", () => {
  assert.equal(shouldImport({ mimeType: "image/jpeg", size: "2048" }), true);
  assert.equal(shouldImport({ mimeType: "application/pdf", size: "2048" }), true);
  assert.equal(shouldImport({ mimeType: "video/mp4", size: String(101 * 1024 * 1024) }), false, "too large");
  assert.equal(shouldImport({ mimeType: "application/vnd.google-apps.document", size: "10" }), false);
  assert.equal(shouldImport({ mimeType: "image/png" }), false, "no size: Google formats");
  assert.equal(orientationOf(4000, 5000), "portrait");
  assert.equal(orientationOf(6000, 4000), "landscape");
  assert.equal(orientationOf(1000, 1020), "square");
  assert.equal(orientationOf(null, 10), null);
  assert.equal(takenOn({ imageMediaMetadata: { time: "2026:05:14 10:22:31" }, createdTime: "2026-06-01T08:00:00Z" }), "2026-05-14");
  assert.equal(takenOn({ createdTime: "2026-06-01T08:00:00Z" }), "2026-06-01");
  assert.equal(takenOn({}), null);
  assert.equal(folderPath("Photoshoot", "Day 1"), "Photoshoot/Day 1");
  assert.equal(folderPath("", "A/B"), "A-B");
  assert.equal(safeFileName("Julius kantoor (1).JPG"), "Julius-kantoor-1-.JPG");
  assert.equal(summaryText({ imported: 12, known: 340, skipped: 2, failed: 0 }), "12 new, 340 known, 2 skipped");
});

test("media: kinds, filters and Claude's suggestion", () => {
  assert.equal(mediaKind("image/webp"), "image");
  assert.equal(mediaKind("application/pdf"), "pdf");
  assert.equal(mediaKind(null), "other");
  assert.deepEqual(parseMediaFilters({ undescribed: "1", tag: ["india", "x"], person: " " }), {
    undescribed: true,
    unused: false,
    person: undefined,
    setting: undefined,
    tag: "india",
    folder: undefined,
    q: undefined,
  });
  assert.deepEqual(parseMediaSuggestion({ description: " Julius on stage ", tags: ["talk", 3], orientation: "wide", evil: 1 }), {
    description: "Julius on stage",
    tags: ["talk"],
  });
  assert.equal(parseMediaSuggestion({}), null);
  assert.equal(parseMediaSuggestion("x"), null);
});

test("drive: readable messages for Drive API errors", () => {
  const disabled = JSON.stringify({
    error: { code: 403, message: "Google Drive API has not been used in project 123 before or it is disabled.", errors: [{ reason: "accessNotConfigured" }] },
  });
  assert.match(driveErrorMessage(403, disabled), /Drive API is switched off/);
  assert.match(driveErrorMessage(401, JSON.stringify({ error: "invalid_grant", error_description: "Invalid JWT Signature." })), /refused the service account key/);
  assert.match(driveErrorMessage(500, "oops"), /answered 500: oops/);
});
