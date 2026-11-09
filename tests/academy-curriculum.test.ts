// The start curriculum content (supabase/migrations/20261114000000_academy_start_content.sql)
// matches what the editor would store: explanation HTML survives the
// sanitizer unchanged, video, notes and assignment content are already in
// their stored shape, worksheet fields are normalized, every check has three
// questions with one valid answer. Also the video recording brief helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeHtml } from "@/lib/academy/sanitize";
import { normalizeFields } from "@/lib/academy/media/worksheet";
import { videoBlockContent, videoRecordingNote } from "@/lib/academy/media/state";
import { sanitizeAssignmentContent } from "@/lib/academy/learn/assignment";
import { type BlockContent, explanationHtml, notesPrompt, notesScope } from "@/lib/academy/blocks/types";
import type { AcademyBlockType } from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";

// The same cleaning as contentSanitizers in src/lib/academy/blocks/server.ts
// (server-only, so not importable here) for the types the seed uses.
const contentSanitizers: Partial<Record<AcademyBlockType, (content: BlockContent) => BlockContent>> = {
  explanation: (content) => ({ html: sanitizeHtml(explanationHtml(content)) }),
  notes: (content) => ({ scope: notesScope(content), prompt: notesPrompt(content).slice(0, 1000) }),
  assignment: (content) => sanitizeAssignmentContent(content as Json),
  tasks: () => ({}),
  knowledge_check: () => ({}),
  video: (content) => videoBlockContent(content as Json),
  document: () => ({}),
  worksheet: () => ({}),
};

type SeedBlock = {
  type: AcademyBlockType;
  title: string;
  required: boolean;
  completion: Record<string, unknown>;
  content: BlockContent;
  document?: string;
  tasks?: { title: string; deadline_offset_days: number | null; shared: boolean; placement_only: boolean; required: boolean }[];
  questions?: { question: string; options: string[]; correct_index: number; explanation: string }[];
};
type SeedLesson = { key: string; module: string; position: number; title: string; language: "nl" | "en"; blocks: SeedBlock[] };
type Seed = { documents: Record<string, { title: string; kind: string; category: string; fields: unknown[] }>; lessons: SeedLesson[] };

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261114000000_academy_start_content.sql"), "utf8");
const seed: Seed = JSON.parse(sql.split("$seed$")[1]);

const MODULES = [
  ...Array.from({ length: 9 }, (_, i) => `client-${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `developer-${i + 1}`),
];

function words(html: string) {
  return html.replace(/<[^>]+>/g, " ").match(/[\p{L}\p{N}_]+/gu)?.length ?? 0;
}

test("every module of the start curriculum gets lessons", () => {
  for (const key of MODULES) {
    const count = seed.lessons.filter((l) => l.module === key).length;
    const min = key.startsWith("client") ? 2 : 3;
    assert.ok(count >= min && count <= 4, `${key}: ${count} lessons`);
  }
  assert.equal(new Set(seed.lessons.map((l) => l.key)).size, seed.lessons.length, "unique lesson keys");
  for (const l of seed.lessons) {
    assert.equal(l.language, l.module.startsWith("client") ? "nl" : "en", l.key);
  }
});

test("every lesson starts with a video waiting for a recording and an explanation", () => {
  for (const l of seed.lessons) {
    const [video, explanation] = l.blocks;
    assert.equal(video.type, "video", l.key);
    assert.deepEqual(video.completion, { min_percent: 90 });
    assert.ok(videoRecordingNote(video.content as never).length > 0, `${l.key}: recording brief`);
    assert.equal(explanation.type, "explanation", l.key);
    assert.equal(explanation.required, true);
  }
});

test("block content is stored in the shape the editor saves", () => {
  for (const l of seed.lessons) {
    for (const b of l.blocks) {
      const clean = contentSanitizers[b.type]?.(b.content) ?? b.content;
      assert.deepEqual(clean, b.content, `${l.key} ${b.type}`);
      if (b.type === "explanation") {
        const html = String(b.content.html);
        assert.equal(sanitizeHtml(html), html, `${l.key}: sanitized`);
        const n = words(html);
        assert.ok(n >= 290 && n <= 760, `${l.key}: ${n} words`);
        assert.match(html, /<h2>/, `${l.key}: has headings`);
      }
    }
  }
});

test("knowledge checks have exactly three questions with one valid answer", () => {
  const checks = seed.lessons.flatMap((l) => l.blocks.filter((b) => b.type === "knowledge_check"));
  assert.ok(checks.length >= 30);
  for (const c of checks) {
    assert.equal(c.questions?.length, 3);
    for (const q of c.questions ?? []) {
      assert.ok(q.options.length >= 2 && q.options.length <= 6);
      assert.ok(Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index < q.options.length);
      assert.equal(new Set(q.options).size, q.options.length, q.question);
      assert.ok(q.explanation.length > 0);
    }
  }
});

test("worksheets have normalized fields and every document is used", () => {
  const used = new Set(seed.lessons.flatMap((l) => l.blocks.map((b) => b.document).filter(Boolean)));
  assert.deepEqual([...used].sort(), Object.keys(seed.documents).sort());
  for (const [key, doc] of Object.entries(seed.documents)) {
    if (doc.kind === "worksheet") {
      assert.ok(doc.fields.length > 0, key);
      assert.deepEqual(normalizeFields(doc.fields), doc.fields, key);
    } else {
      assert.equal(doc.category, "policy");
      assert.equal(doc.fields.length, 0);
    }
  }
});

test("tasks: shared tasks are placement-only, deadlines are relative and not negative", () => {
  const tasks = seed.lessons.flatMap((l) => l.blocks.flatMap((b) => b.tasks ?? []));
  assert.ok(tasks.length > 0);
  for (const t of tasks) {
    if (t.shared) assert.equal(t.placement_only, true, t.title);
    assert.ok(t.deadline_offset_days === null || t.deadline_offset_days >= 0, t.title);
  }
  // Client module 1: the overlap window by day 1.
  const overlap = tasks.find((t) => /overlapvenster/.test(t.title) && /agenda/.test(t.title));
  assert.equal(overlap?.deadline_offset_days, 0);
});

test("no invented policy numbers: policies and contract terms are placeholders", () => {
  const policy = seed.lessons.find((l) => l.key === "developer-3.1");
  assert.ok(policy);
  assert.equal(policy.blocks.filter((b) => b.type === "document").length, 4);
  const html = String(policy.blocks[1].content.html);
  assert.match(html, /\[Nordavo to fill in:/);
  assert.doesNotMatch(html, /\b\d+\s+(days|INR|rupees|lakh)\b/i);
});

test("video recording brief: kept, trimmed, dropped when empty", () => {
  assert.deepEqual(videoBlockContent({ transcript: false, recording_note: "  Record this  ", other: 1 }), {
    transcript: false,
    recording_note: "Record this",
  });
  assert.deepEqual(videoBlockContent({ recording_note: "   " }), { transcript: true });
  assert.deepEqual(videoBlockContent(null), { transcript: true });
  assert.equal(videoRecordingNote({ recording_note: 5 }), "");
  assert.equal(videoRecordingNote({ recording_note: "x".repeat(3000) }).length, 2000);
});
