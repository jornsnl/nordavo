"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Captions, ChevronDown, Gauge, RotateCcw, TriangleAlert } from "lucide-react";
import { recordWatch } from "@/app/academy/media-actions";
import { t } from "@/lib/academy/i18n";
import { readVideoState } from "@/lib/academy/media/state";
import { formatClock, transcriptCues } from "@/lib/academy/media/vtt";
import { PLAYBACK_RATES, type Range, isPlaybackRate, mergeRanges, playedStep, resumePosition, watchedPercent } from "@/lib/academy/media/watch";
import { ProgressBar } from "@/components/academy/ui";
import type { BlockViewerProps } from "./types";

const RATE_KEY = "academy.video.rate";
const FLUSH_MS = 15_000;

function storedRate(): number {
  try {
    const value = Number(window.localStorage.getItem(RATE_KEY));
    return isPlaybackRate(value) ? value : 1;
  } catch {
    return 1;
  }
}

/**
 * The video block for the learner: the current version with NL and EN
 * subtitles, speed 1x to 2x, continue where you left off, the transcript,
 * and watch measurement. Only continuous playback counts (playedStep): the
 * played ranges go to academy_record_watch() every 15 seconds, on pause, at
 * the end and when the page is left; the server computes the percent.
 */
export function VideoViewer({ block, done, state, locale, preview }: BlockViewerProps) {
  const router = useRouter();
  const tr = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) => t(locale, key, vars);
  const { version, progress, showTranscript } = readVideoState(state);
  const minPercent = typeof block.completion.min_percent === "number" ? block.completion.min_percent : 90;

  const videoRef = useRef<HTMLVideoElement>(null);
  // The element stays readable after unmount (React clears videoRef first), for the last flush.
  const lastElement = useRef<HTMLVideoElement | null>(null);
  const [rate, setRate] = useState(1);
  const [percent, setPercent] = useState(progress?.percent ?? 0);
  const [failed, setFailed] = useState(false);
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [now, setNow] = useState(0);

  // Measurement, kept out of React state (updated many times a second).
  const ranges = useRef<Range[]>([]);
  const unsentSeconds = useRef(0);
  const last = useRef<{ time: number; wall: number } | null>(null);
  const dirty = useRef(false);
  const doneRef = useRef(done);
  useEffect(() => {
    doneRef.current = done;
  }, [done]);

  const versionId = version?.id ?? null;
  const videoId = block.videoId;

  const flush = useCallback(async () => {
    const el = videoRef.current ?? lastElement.current;
    if (preview || !el || !videoId || !dirty.current) return;
    dirty.current = false;
    const watched = unsentSeconds.current;
    unsentSeconds.current = 0;
    const duration = Number.isFinite(el.duration) ? el.duration : (version?.durationSeconds ?? null);
    const result = await recordWatch({
      videoId,
      versionId,
      positionSeconds: Math.max(0, el.currentTime || 0),
      percent: watchedPercent(ranges.current, duration),
      watchedSeconds: Math.min(3600, watched),
      ranges: mergeRanges(ranges.current, { duration }),
    });
    if (!result.ok) {
      unsentSeconds.current += watched;
      dirty.current = true;
      return;
    }
    setPercent((p) => Math.max(p, result.percent));
    if (!doneRef.current && (result.percent >= minPercent || result.completed)) {
      doneRef.current = true;
      router.refresh();
    }
  }, [preview, videoId, versionId, version?.durationSeconds, minPercent, router]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);

  // Send what is left when the tab is hidden or the page is left.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    const timer = window.setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) void flush();
    }, FLUSH_MS);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      window.clearInterval(timer);
      void flush();
    };
  }, [flush]);

  function pickRate(value: number) {
    setRate(value);
    try {
      window.localStorage.setItem(RATE_KEY, String(value));
    } catch {
      // private mode: the speed is not remembered
    }
  }

  function onLoadedMetadata() {
    const el = videoRef.current;
    if (!el) return;
    lastElement.current = el;
    // The speed the person picked last time (kept in this browser).
    const remembered = storedRate();
    el.playbackRate = remembered;
    if (remembered !== rate) setRate(remembered);
    const at = resumePosition(progress?.positionSeconds, Number.isFinite(el.duration) ? el.duration : version?.durationSeconds);
    if (at > 1) {
      el.currentTime = at;
      setResumeAt(at);
    }
  }

  function onTimeUpdate() {
    const el = videoRef.current;
    if (!el) return;
    setNow(el.currentTime);
    if (el.paused || el.seeking) return;
    const wall = performance.now();
    if (last.current) {
      const step = playedStep(last.current.time, el.currentTime, el.playbackRate, wall - last.current.wall);
      if (step) {
        ranges.current = mergeRanges([...ranges.current, step], { gap: 0.5 });
        unsentSeconds.current += step[1] - step[0];
        dirty.current = true;
      }
    }
    last.current = { time: el.currentTime, wall };
  }

  function restartMeasure() {
    const el = videoRef.current;
    last.current = el ? { time: el.currentTime, wall: performance.now() } : null;
  }

  function seek(seconds: number) {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = seconds;
    void el.play().catch(() => undefined);
  }

  const cues = useMemo(() => transcriptCues(version?.transcript), [version?.transcript]);

  if (!version) {
    return <p className="rounded-xl bg-academy-blue-50 px-4 py-3 text-sm text-academy-blue-800">{tr("video.missing")}</p>;
  }

  const activeCue = cues?.findIndex((c) => now >= c.start && now < c.end) ?? -1;

  return (
    <div className="space-y-3">
      {progress?.versionId && progress.versionId !== version.id && <p className="text-xs text-muted">{tr("video.updated")}</p>}
      <div className="overflow-hidden rounded-xl bg-black">
        {failed || !version.url ? (
          <p className="flex aspect-video items-center justify-center gap-2 px-4 text-center text-sm text-white">
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
            {tr("video.unavailable")}
          </p>
        ) : (
          <video
            ref={videoRef}
            controls
            playsInline
            preload="metadata"
            className="aspect-video w-full bg-black"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onPlay={restartMeasure}
            onSeeking={() => {
              last.current = null;
            }}
            onSeeked={restartMeasure}
            onRateChange={() => {
              const el = videoRef.current;
              if (el && isPlaybackRate(el.playbackRate) && el.playbackRate !== rate) pickRate(el.playbackRate);
              restartMeasure();
            }}
            onPause={() => {
              last.current = null;
              void flush();
            }}
            onEnded={() => {
              last.current = null;
              void flush();
            }}
            onError={() => setFailed(true)}
          >
            <source src={version.url} type={version.mimeType ?? undefined} />
            {version.subtitles.nl && (
              <track kind="subtitles" srcLang="nl" label="Nederlands" src={`/academy/files/subtitles/${version.id}/nl`} default={locale === "nl"} />
            )}
            {version.subtitles.en && (
              <track kind="subtitles" srcLang="en" label="English" src={`/academy/files/subtitles/${version.id}/en`} default={locale === "en"} />
            )}
          </video>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={tr("video.speed")} className="flex items-center gap-1">
          <Gauge className="mr-1 size-4 text-academy-blue-600" aria-hidden="true" />
          {PLAYBACK_RATES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={rate === value}
              onClick={() => pickRate(value)}
              className={`min-w-11 rounded-lg px-2 py-1.5 text-sm font-semibold transition pointer-coarse:min-h-11 ${
                rate === value ? "bg-academy-orange-600 text-white" : "text-academy-blue-800 hover:bg-academy-blue-100"
              }`}
            >
              {value}x
            </button>
          ))}
        </div>
        {(version.subtitles.nl || version.subtitles.en) && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Captions className="size-4" aria-hidden="true" />
            {tr("video.subtitles")}: {[version.subtitles.nl && "NL", version.subtitles.en && "EN"].filter(Boolean).join(", ")}
          </span>
        )}
      </div>

      {!preview && (
        <div className="space-y-1">
          <ProgressBar percent={percent} label={tr("video.watched", { percent })} size="sm" />
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-live="polite">
            <span>{tr("video.watched", { percent })}</span>
            {resumeAt !== null && (
              <>
                <span>{tr("video.resume", { time: formatClock(resumeAt) })}</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-medium text-academy-orange-700 hover:underline"
                  onClick={() => {
                    setResumeAt(null);
                    seek(0);
                  }}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  {tr("video.restart")}
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {showTranscript && version.transcript && (
        <div className="rounded-xl border border-academy-blue-200">
          <button
            type="button"
            aria-expanded={transcriptOpen}
            onClick={() => setTranscriptOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-semibold text-academy-blue-900 pointer-coarse:min-h-11"
          >
            {transcriptOpen ? tr("video.hideTranscript") : tr("video.showTranscript")}
            <ChevronDown className={`size-4 transition ${transcriptOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {transcriptOpen && (
            <div className="max-h-80 overflow-y-auto border-t border-academy-blue-100 px-4 py-3 text-sm leading-relaxed">
              {cues ? (
                <ol className="space-y-1">
                  {cues.map((cue, i) => (
                    <li key={`${cue.start}-${i}`}>
                      <button
                        type="button"
                        onClick={() => seek(cue.start)}
                        aria-label={tr("video.jumpTo", { time: formatClock(cue.start) })}
                        className={`flex w-full gap-3 rounded-lg px-2 py-1 text-left transition hover:bg-academy-blue-50 ${
                          i === activeCue ? "bg-academy-orange-50" : ""
                        }`}
                      >
                        <span className="shrink-0 font-mono text-xs leading-6 text-academy-blue-600">{formatClock(cue.start)}</span>
                        <span className="whitespace-pre-line">{cue.text.replace(/<[^>]+>/g, "")}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="space-y-2 whitespace-pre-line">{version.transcript}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
