import { test } from "node:test";
import assert from "node:assert/strict";
import { compactCvText, storableCvText } from "../src/lib/screening/cv-text";
import { allowedMediaType, driveFileId, fetchableLink, fileNameFrom } from "../src/lib/content/link-media";
import { quickAddProjects } from "../src/lib/work/quick-add";

// Feedback Julius, 11 November 2026: CVs, Content media from a link, the Work inbox.

test("CV text: whitespace and page numbers go, the content stays", () => {
  const raw = "Priya   Sharma\t\n\n\n\nSenior  PHP developer\r\n Page 1 of 2 \n- 2 -\n\nLaravel,  Vue\n3/3\n";
  assert.equal(compactCvText(raw), "Priya Sharma\n\nSenior PHP developer\n\nLaravel, Vue");
  assert.equal(storableCvText("   \n \u0000 "), null);
  assert.equal(storableCvText("Experience\n\nResponsibilities:\nA\n\nResponsibilities:\nB"), "Experience\n\nResponsibilities:\nA\n\nResponsibilities:\nB");
});

test("media from a link: Drive ids, safe links, types and names", () => {
  assert.equal(driveFileId("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing"), "1AbCdEfGhIjKlMnOp");
  assert.equal(driveFileId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp"), "1AbCdEfGhIjKlMnOp");
  assert.equal(driveFileId("https://example.com/file/d/1AbCdEfGhIjKlMnOp"), null);
  assert.equal(fetchableLink("https://images.example.com/a.jpg").ok, true);
  for (const bad of ["http://example.com/a.jpg", "https://localhost/a.jpg", "https://127.0.0.1/a.jpg", "https://[::1]/a.jpg", "https://intranet/a.jpg", "https://db.internal/a.jpg", "https://u:p@example.com/a.jpg", "nope"]) {
    assert.equal(fetchableLink(bad).ok, false, bad);
  }
  assert.ok(allowedMediaType("image/jpeg; charset=binary"));
  assert.ok(allowedMediaType("application/pdf"));
  assert.ok(!allowedMediaType("text/html"));
  assert.equal(fileNameFrom("https://x.com/shoot/IMG_0042.JPG?w=1", null, "image/jpeg"), "IMG_0042.JPG");
  assert.equal(fileNameFrom("https://x.com/download", 'attachment; filename="Day 1.png"', "image/png"), "Day 1.png");
  assert.equal(fileNameFrom("https://x.com/", null, "image/png"), "file.png");
});

test("quick add: the inbox first and named Inbox, the workspace in the name with several", () => {
  const workspaces = [
    { id: "w1", name: "Nordavo", slug: "nordavo", kind: "shared" as const },
    { id: "w2", name: "Inbox", slug: "inbox-1", kind: "inbox" as const },
    { id: "w3", name: "Home", slug: "home", kind: "private" as const },
  ];
  const projects = [
    { id: "p1", name: "Hiring", workspaceId: "w1", archived: false },
    { id: "p2", name: "Inbox", workspaceId: "w2", archived: false },
    { id: "p3", name: "Tasks", workspaceId: "w3", archived: false },
    { id: "p4", name: "Old", workspaceId: "w1", archived: true },
  ];
  const list = quickAddProjects(projects, workspaces, "p2");
  assert.deepEqual(
    list.map((p) => p.name),
    ["Inbox", "Nordavo › Hiring", "Home › Tasks"],
  );
  assert.deepEqual(quickAddProjects(projects.slice(0, 2), workspaces.slice(0, 2), "p2").map((p) => p.name), ["Inbox", "Hiring"]);
});
