// The state the media block viewers get (blockStateLoaders in
// src/lib/academy/blocks/server.ts loads it, the viewers read it). Pure
// types and readers, safe for client components.

import type { AcademyDocumentCategory } from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";
import { type WorksheetAnswers, type WorksheetField, normalizeAnswers, normalizeFields } from "@/lib/academy/media/worksheet";

export type VideoState = {
  video: { id: string; title: string } | null;
  version: {
    id: string;
    number: number;
    durationSeconds: number | null;
    /** Signed link, valid a few hours. Null when it could not be made. */
    url: string | null;
    mimeType: string | null;
    subtitles: { nl: boolean; en: boolean };
    transcript: string | null;
  } | null;
  progress: { positionSeconds: number; percent: number; versionId: string | null; completed: boolean } | null;
  /** The transcript is shown under the player (block content.transcript, default on). */
  showTranscript: boolean;
};

export type DocumentState = {
  document: {
    id: string;
    title: string;
    description: string | null;
    category: AcademyDocumentCategory;
    version: number;
    isNew: boolean;
    updatedAt: string | null;
    fileName: string | null;
    sizeBytes: number | null;
  } | null;
};

export type WorksheetState = {
  document: { id: string; title: string; description: string | null; fields: WorksheetField[] } | null;
  answers: WorksheetAnswers;
  submittedAt: string | null;
};

function obj(state: Json | null): Record<string, unknown> {
  return state && typeof state === "object" && !Array.isArray(state) ? (state as Record<string, unknown>) : {};
}

export function readVideoState(state: Json | null): VideoState {
  const s = obj(state);
  return {
    video: (s.video as VideoState["video"]) ?? null,
    version: (s.version as VideoState["version"]) ?? null,
    progress: (s.progress as VideoState["progress"]) ?? null,
    showTranscript: s.showTranscript !== false,
  };
}

export function readDocumentState(state: Json | null): DocumentState {
  return { document: (obj(state).document as DocumentState["document"]) ?? null };
}

export function readWorksheetState(state: Json | null): WorksheetState {
  const s = obj(state);
  const doc = s.document as { id: string; title: string; description: string | null; fields: unknown } | null | undefined;
  const fields = normalizeFields(doc?.fields ?? []);
  return {
    document: doc ? { id: doc.id, title: doc.title, description: doc.description ?? null, fields } : null,
    answers: normalizeAnswers(fields, s.answers),
    submittedAt: typeof s.submittedAt === "string" ? s.submittedAt : null,
  };
}

/** Video block content: whether learners see the transcript. */
export function videoShowsTranscript(content: Json | null | undefined): boolean {
  return !(content && typeof content === "object" && !Array.isArray(content) && (content as Record<string, unknown>).transcript === false);
}
