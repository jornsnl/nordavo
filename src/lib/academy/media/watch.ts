// Watch measurement of the video player. Only what is really played
// counts: the player adds a range for each step of continuous playback and
// nothing for a seek, so jumping to the end does not complete a video.
// academy_record_watch() merges the same ranges again on the server and
// computes the percent from them. Pure, tested in tests/academy-media.test.ts.

export type Range = [number, number];

/** Merge overlapping ranges (gaps of `gap` seconds or less are closed), clipped to 0..duration. */
export function mergeRanges(ranges: Range[], { gap = 1, duration }: { gap?: number; duration?: number | null } = {}): Range[] {
  const clean = ranges
    .map(([s, e]): Range => [Math.max(0, s), duration && duration > 0 ? Math.min(duration, e) : e])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Range[] = [];
  for (const [s, e] of clean) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + gap) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out.map(([s, e]) => [round2(s), round2(e)]);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Seconds covered by (merged) ranges. */
export function coveredSeconds(ranges: Range[]): number {
  return mergeRanges(ranges).reduce((sum, [s, e]) => sum + (e - s), 0);
}

/** Share watched, 0 to 100 (100 when at most 1.5 seconds are missing), like the SQL. */
export function watchedPercent(ranges: Range[], duration: number | null | undefined): number {
  if (!duration || duration <= 0) return 0;
  const covered = coveredSeconds(mergeRanges(ranges, { duration }));
  if (duration - covered <= 1.5) return 100;
  return Math.min(100, Math.floor((covered / duration) * 100));
}

/**
 * One step of playback, from the previous time update to this one: a range
 * when it is continuous playback, null for a seek or a pause. A step counts
 * when the media time moved forward by no more than the wall clock allows at
 * this speed (plus slack for the coarse timeupdate events).
 */
export function playedStep(previousTime: number, currentTime: number, playbackRate: number, wallMs: number): Range | null {
  const delta = currentTime - previousTime;
  if (!(delta > 0)) return null;
  const allowed = Math.max(1.5, (Math.max(0.25, playbackRate) * Math.max(0, wallMs)) / 1000 + 0.75);
  return delta <= allowed ? [previousTime, currentTime] : null;
}

/** Where to continue: the saved position, unless the video was (nearly) finished. */
export function resumePosition(position: number | null | undefined, duration: number | null | undefined): number {
  const p = typeof position === "number" && Number.isFinite(position) ? Math.max(0, position) : 0;
  if (!duration || duration <= 0) return p;
  if (p >= duration - 5 || p / duration >= 0.98) return 0;
  return Math.min(p, duration);
}

export const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export function isPlaybackRate(value: unknown): value is PlaybackRate {
  return typeof value === "number" && (PLAYBACK_RATES as readonly number[]).includes(value);
}

/** Ranges as the RPC takes them (at most `limit`, longest kept). */
export function rangesPayload(ranges: Range[], limit = 500): Range[] {
  const merged = mergeRanges(ranges);
  if (merged.length <= limit) return merged;
  return [...merged]
    .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
    .slice(0, limit)
    .sort((a, b) => a[0] - b[0]);
}
