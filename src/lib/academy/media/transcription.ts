import "server-only";
import type { AcademyLocale } from "@/lib/academy/database";
import { OPENAI_TRANSCRIBE_MAX_BYTES } from "@/lib/academy/media/files";
import { type Cue, cuesToTranscript } from "@/lib/academy/media/vtt";

/**
 * Automatic transcripts for the video block, behind one interface so the
 * provider can change (docs/academy.md, Transcriptie). Chosen by
 * ACADEMY_TRANSCRIPTION_PROVIDER (openai or deepgram); without it the first
 * provider with a key is used:
 *
 *   openai    OPENAI_API_KEY (+ OPENAI_TRANSCRIPTION_MODEL, default whisper-1).
 *             Sends the file; at most 25 MB (OpenAI's limit), so for longer
 *             recordings use Deepgram or upload a transcript.
 *   deepgram  DEEPGRAM_API_KEY (+ DEEPGRAM_MODEL, default nova-2). Gets a
 *             signed link to the file, so any size works.
 *
 * Without a key nothing is called: the editor says so and Nordavo types or
 * uploads the transcript (WebVTT gives timings, so subtitles follow).
 */

export type TranscriptionInput = {
  /** Short-lived signed link to the video file. */
  url: string;
  fileName: string;
  sizeBytes: number | null;
  mimeType: string | null;
  /** The spoken language when known (the course language). */
  language: AcademyLocale | null;
};

export type TranscriptionResult = { transcript: string; language: AcademyLocale | null; timed: boolean };

export type TranscriptionProvider = {
  name: "openai" | "deepgram";
  label: string;
  /** Largest file the provider takes, or null for no limit. */
  maxBytes: number | null;
  transcribe: (input: TranscriptionInput) => Promise<TranscriptionResult>;
};

function toLocale(value: unknown): AcademyLocale | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase();
  if (v.startsWith("nl") || v === "dutch") return "nl";
  if (v.startsWith("en") || v === "english") return "en";
  return null;
}

function fromSegments(segments: { start: number; end: number; text: string }[], fallback: string): { transcript: string; timed: boolean } {
  const cues: Cue[] = segments
    .map((s) => ({ start: Number(s.start), end: Number(s.end), text: String(s.text ?? "").trim() }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && c.text);
  if (cues.length > 0) return { transcript: cuesToTranscript(cues), timed: true };
  return { transcript: fallback.trim(), timed: false };
}

const openai: TranscriptionProvider = {
  name: "openai",
  label: "OpenAI",
  maxBytes: OPENAI_TRANSCRIBE_MAX_BYTES,
  async transcribe(input) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is missing.");
    if (input.sizeBytes && input.sizeBytes > OPENAI_TRANSCRIBE_MAX_BYTES) {
      throw new Error("The file is larger than 25 MB, the limit of OpenAI. Upload a transcript or subtitles instead.");
    }
    const file = await fetch(input.url);
    if (!file.ok) throw new Error(`Could not read the video file (${file.status}).`);
    const blob = await file.blob();
    if (blob.size > OPENAI_TRANSCRIBE_MAX_BYTES) {
      throw new Error("The file is larger than 25 MB, the limit of OpenAI. Upload a transcript or subtitles instead.");
    }
    const form = new FormData();
    form.append("file", new File([blob], input.fileName || "video.mp4", { type: input.mimeType || "video/mp4" }));
    form.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    if (input.language) form.append("language", input.language);
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(`OpenAI answered ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const data = (await response.json()) as { text?: string; language?: string; segments?: { start: number; end: number; text: string }[] };
    const { transcript, timed } = fromSegments(data.segments ?? [], data.text ?? "");
    return { transcript, timed, language: toLocale(data.language) ?? input.language };
  },
};

const deepgram: TranscriptionProvider = {
  name: "deepgram",
  label: "Deepgram",
  maxBytes: null,
  async transcribe(input) {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) throw new Error("DEEPGRAM_API_KEY is missing.");
    const params = new URLSearchParams({ model: process.env.DEEPGRAM_MODEL || "nova-2", smart_format: "true", utterances: "true", punctuate: "true" });
    if (input.language) params.set("language", input.language);
    else params.set("detect_language", "true");
    const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: input.url }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(`Deepgram answered ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const data = (await response.json()) as {
      results?: {
        utterances?: { start: number; end: number; transcript: string }[];
        channels?: { detected_language?: string; alternatives?: { transcript?: string }[] }[];
      };
    };
    const channel = data.results?.channels?.[0];
    const { transcript, timed } = fromSegments(
      (data.results?.utterances ?? []).map((u) => ({ start: u.start, end: u.end, text: u.transcript })),
      channel?.alternatives?.[0]?.transcript ?? "",
    );
    return { transcript, timed, language: toLocale(channel?.detected_language) ?? input.language };
  },
};

const providers = { openai, deepgram } as const;

/** The configured provider, or null when no key is set. */
export function transcriptionProvider(): TranscriptionProvider | null {
  const wanted = process.env.ACADEMY_TRANSCRIPTION_PROVIDER?.trim().toLowerCase();
  if (wanted === "openai") return process.env.OPENAI_API_KEY ? openai : null;
  if (wanted === "deepgram") return process.env.DEEPGRAM_API_KEY ? deepgram : null;
  if (process.env.OPENAI_API_KEY) return providers.openai;
  if (process.env.DEEPGRAM_API_KEY) return providers.deepgram;
  return null;
}

/** For the editor: which provider runs, and whether a file of this size can go to it. */
export function transcriptionInfo(sizeBytes: number | null): { provider: string | null; tooLarge: boolean; maxBytes: number | null } {
  const provider = transcriptionProvider();
  if (!provider) return { provider: null, tooLarge: false, maxBytes: null };
  return { provider: provider.label, tooLarge: Boolean(provider.maxBytes && sizeBytes && sizeBytes > provider.maxBytes), maxBytes: provider.maxBytes };
}
