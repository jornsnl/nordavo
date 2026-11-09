import { z } from "zod";
import type { AcademyLocale } from "@/lib/academy/database";

// A draft lesson from a video transcript (Academy: AI-concept uit
// transcript): an explanation, tasks and a knowledge check of three
// questions, which Nordavo then edits. Pure, tested in
// tests/academy-ats.test.ts. The server action
// (src/app/dashboard/academy/lessons/[id]/draft-actions.ts) asks Claude with
// this schema and stores the result as draft blocks:
//
//   explanation      content { html } (sanitised like every explanation)
//   tasks            content {}, rows in academy_tasks (title, description,
//                    deadline_offset_days, required)
//   knowledge_check  content {}, rows in academy_check_questions (question,
//                    options, correct_index, explanation)
//
// transcriptDraft() makes the same three blocks without AI
// with the transcript as the explanation and no tasks or questions.

export const MAX_TRANSCRIPT_CHARS = 60_000;

export const lessonDraftSchema = z.object({
  explanation_html: z
    .string()
    .describe("The explanation of the lesson as simple HTML: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>. No scripts, styles or images."),
  tasks: z
    .array(
      z.object({
        title: z.string().describe("A concrete task the learner can tick off, at most 120 characters"),
        description: z.string().describe("One or two sentences on how to do it; empty when the title says it all"),
        deadline_offset_days: z
          .number()
          .int()
          .nullable()
          .describe("Days after the start date the task is due: 0 is day 1, 7 is week 2; null when there is no deadline"),
      }),
    )
    .describe("Two to five practical tasks that apply the lesson"),
  questions: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()).describe("Three or four answers, exactly one correct"),
        correct_index: z.number().int().describe("Index (from 0) of the correct answer in options"),
        explanation: z.string().describe("Why that answer is right, shown after answering"),
      }),
    )
    .describe("Exactly three multiple choice questions about the key points"),
});

export type LessonDraft = z.infer<typeof lessonDraftSchema>;

export type DraftTask = { title: string; description: string | null; deadline_offset_days: number | null };
export type DraftQuestion = { question: string; options: string[]; correct_index: number; explanation: string | null };
export type NormalizedDraft = { explanationHtml: string; tasks: DraftTask[]; questions: DraftQuestion[] };

export function draftSystemPrompt(locale: AcademyLocale): string {
  const language = locale === "nl" ? "Dutch (the client course, for Dutch managers)" : "English (the developer course, for Indian developers joining Dutch teams)";
  return [
    "You write lesson material for the Nordavo Academy. Nordavo places Indian developers in Dutch teams; the Academy teaches clients and developers to work together remotely.",
    "From the transcript of a lesson video, write a draft that Nordavo will edit:",
    "1. An explanation that summarises the video in clear sections with headings and lists. Keep the speaker's points and examples; do not invent facts, policies or numbers that are not in the transcript.",
    "2. Two to five practical tasks that apply the lesson in the learner's own situation, with a deadline relative to the start date only when the transcript suggests one.",
    "3. Exactly three multiple choice questions on the key points, each with three or four answers, one correct, and a short explanation.",
    `Write everything in ${language}. Plain, friendly and direct; no marketing language.`,
  ].join("\n");
}

export function draftInput({ lessonTitle, transcript }: { lessonTitle: string; transcript: string }): string {
  return `Lesson: ${lessonTitle}\n\nTranscript:\n${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}`;
}

function clean(text: string | null | undefined, max: number): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Within the limits of the tables: at most 10 tasks with a title, at most
 * three questions with two to six answers and a valid correct index,
 * deadlines between -365 and 3650 days.
 */
export function normalizeDraft(draft: LessonDraft): NormalizedDraft {
  const tasks = draft.tasks
    .map((t) => ({
      title: clean(t.title, 500),
      description: clean(t.description, 5000) || null,
      deadline_offset_days:
        typeof t.deadline_offset_days === "number" && Number.isFinite(t.deadline_offset_days)
          ? Math.min(3650, Math.max(-365, Math.round(t.deadline_offset_days)))
          : null,
    }))
    .filter((t) => t.title.length > 0)
    .slice(0, 10);
  const questions = draft.questions
    .map((q) => {
      const options = q.options.map((o) => clean(o, 500)).filter(Boolean).slice(0, 6);
      return {
        question: clean(q.question, 2000),
        options,
        correct_index: Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index < options.length ? q.correct_index : -1,
        explanation: clean(q.explanation, 5000) || null,
      };
    })
    .filter((q) => q.question.length > 0 && q.options.length >= 2 && q.correct_index >= 0)
    .slice(0, 3);
  return { explanationHtml: draft.explanation_html.slice(0, 150_000), tasks, questions };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Without AI: the transcript in paragraphs as the explanation to edit. */
export function transcriptDraft(transcript: string, locale: AcademyLocale): NormalizedDraft {
  const text = transcript.slice(0, MAX_TRANSCRIPT_CHARS).replace(/\r\n/g, "\n");
  // WebVTT or SRT: drop cue numbers, timings and the header.
  const lines = text
    .split("\n")
    .filter((line) => !/^WEBVTT/.test(line) && !/^\d+$/.test(line.trim()) && !/-->/.test(line));
  const paragraphs = lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const heading = locale === "nl" ? "Transcript (concept, nog te bewerken)" : "Transcript (draft, to be edited)";
  return {
    explanationHtml: `<h2>${heading}</h2>${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}`,
    tasks: [],
    questions: [],
  };
}

export const DRAFT_TITLES = {
  explanation: "Draft: explanation",
  tasks: "Draft: tasks",
  knowledge_check: "Draft: knowledge check",
} as const;
