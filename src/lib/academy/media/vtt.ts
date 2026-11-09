// Subtitles (WebVTT) and transcripts of the video block. Pure, tested in
// tests/academy-media.test.ts.
//
// A transcript is stored as text on academy_video_versions.transcript, in
// one of two forms:
//   timed  cue blocks like WebVTT without the header, so it can be corrected
//          in a textarea and turned into subtitles:
//            00:00:01.000 --> 00:00:04.200
//            Welcome to the Academy.
//   plain  just text (typed in, or from a provider without timings).

export type Cue = { start: number; end: number; text: string };

const TIME = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/;
const ARROW = /^\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/;

/** "01:02:03.450", "02:03.450" or "00:02:03,450" (SRT) in seconds, or null. */
export function parseTimestamp(value: string): number | null {
  const match = TIME.exec(value.trim());
  if (!match) return null;
  const [, h, m, s, ms] = match;
  const minutes = Number(m);
  const seconds = Number(s);
  if (minutes > 59 && h !== undefined) return null;
  if (seconds > 59) return null;
  const fraction = ms ? Number(ms.padEnd(3, "0")) / 1000 : 0;
  return Number(h ?? 0) * 3600 + minutes * 60 + seconds + fraction;
}

/** Seconds as "HH:MM:SS.mmm". */
export function formatTimestamp(totalSeconds: number): string {
  const ms = Math.max(0, Math.round(totalSeconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(rest).padStart(3, "0")}`;
}

/** "1:05" or "1:02:05" for the transcript next to the player. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Cue text: line breaks kept, only <b>, <i> and <u> as markup. */
function cleanCueText(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/<(?!\/?(?:b|i|u)>)[^>]*>/gi, "")
    .replace(/-->/g, "→")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Cues from WebVTT, SRT or a timed transcript. Headers, NOTE, STYLE and
 * REGION blocks, cue ids and SRT numbers are skipped; cues without text or
 * with an end before the start are dropped. Sorted by start.
 */
export function parseCues(input: string): Cue[] {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l, i) => i > 0 || l.trim() !== "");
    if (lines.length === 0) continue;
    const head = lines[0].trim();
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(head)) continue;
    const arrowAt = lines.findIndex((l) => ARROW.test(l));
    if (arrowAt < 0 || arrowAt > 1) continue;
    const [, from, to] = ARROW.exec(lines[arrowAt])!;
    const start = parseTimestamp(from);
    const end = parseTimestamp(to);
    if (start === null || end === null || end <= start) continue;
    const cueText = cleanCueText(lines.slice(arrowAt + 1));
    if (!cueText) continue;
    cues.push({ start, end, text: cueText });
  }
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** A complete WebVTT file. */
export function toVtt(cues: Cue[]): string {
  const body = cues.map((c) => `${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text}`).join("\n\n");
  return `WEBVTT\n\n${body}${body ? "\n" : ""}`;
}

/** A timed transcript (cue blocks without the WEBVTT header). */
export function cuesToTranscript(cues: Cue[]): string {
  return cues.map((c) => `${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text}`).join("\n\n");
}

/** Cues when the transcript has timings (at least one cue), else null. */
export function transcriptCues(transcript: string | null | undefined): Cue[] | null {
  if (!transcript || !transcript.includes("-->")) return null;
  const cues = parseCues(transcript);
  return cues.length > 0 ? cues : null;
}

/** The transcript as reading text: the cue texts, or the plain text. */
export function transcriptText(transcript: string | null | undefined): string {
  const cues = transcriptCues(transcript);
  if (cues) return cues.map((c) => c.text.replace(/<[^>]+>/g, "")).join(" ");
  return (transcript ?? "").trim();
}

export const MAX_SUBTITLE_BYTES = 2_000_000;

export type SubtitleResult = { ok: true; vtt: string; cues: number } | { ok: false; error: string };

/** Uploaded or edited subtitles (WebVTT or SRT) as a clean WebVTT file. */
export function normalizeSubtitles(input: string): SubtitleResult {
  if (input.length > MAX_SUBTITLE_BYTES) return { ok: false, error: "The subtitle file is too large (at most 2 MB)." };
  const cues = parseCues(input);
  if (cues.length === 0) {
    return { ok: false, error: "No subtitles found. Use WebVTT (.vtt) or SRT (.srt) with lines like 00:00:01.000 --> 00:00:04.000." };
  }
  return { ok: true, vtt: toVtt(cues), cues: cues.length };
}
