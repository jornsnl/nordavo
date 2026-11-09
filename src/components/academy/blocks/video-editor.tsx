"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Captions, FileVideo, LoaderCircle, RefreshCw, Sparkles, Trash2, Unlink } from "lucide-react";
import {
  deleteSubtitles,
  deleteVideo,
  deleteVideoVersion,
  getMediaOptions,
  getSubtitles,
  getVideoEditor,
  renameVideo,
  reserveVideoUpload,
  saveSubtitles,
  saveTranscript,
  setBlockVideo,
  setCurrentVideoVersion,
  startTranscription,
  subtitlesFromTranscript,
  completeVideoUpload,
} from "@/app/dashboard/academy/media-actions";
import type { AcademyLocale } from "@/lib/academy/database";
import type { ActionState } from "@/lib/action-state";
import { formatBytes } from "@/lib/academy/media/files";
import type { VideoEditorData } from "@/lib/academy/media/server";
import { videoShowsTranscript } from "@/lib/academy/media/state";
import { formatClock, transcriptCues } from "@/lib/academy/media/vtt";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { UploadButton, UploadProgress } from "@/components/academy/media/upload-button";
import { readVideoDuration, uploadFile } from "@/components/academy/media/upload";
import type { BlockEditorProps } from "./types";

const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov";
const TEXT_ACCEPT = ".vtt,.srt,.txt,text/vtt,text/plain";

const transcriptLabels: Record<string, { label: string; tone: "neutral" | "warning" | "success" | "danger" | "brand" }> = {
  none: { label: "No transcript", tone: "neutral" },
  pending: { label: "Transcribing…", tone: "warning" },
  ready: { label: "Automatic transcript", tone: "brand" },
  corrected: { label: "Corrected", tone: "success" },
  failed: { label: "Transcription failed", tone: "danger" },
};

/**
 * Video block editor: upload (resumable for large files), replace with a new
 * version (everyone keeps their progress), subtitles NL and EN (upload, edit,
 * from the transcript), the transcript (automatic when a provider key is set,
 * then corrected here; or typed or uploaded), reuse an existing video, delete.
 */
export function VideoEditor({ block, content, onChange, disabled }: BlockEditorProps) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<{ videoId: string; value: VideoEditorData | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<ActionState>({});

  const load = useCallback(async () => {
    if (!block.videoId) return;
    const videoId = block.videoId;
    const value = await getVideoEditor(videoId);
    setLoaded({ videoId, value });
  }, [block.videoId]);

  useEffect(() => {
    let live = true;
    if (block.videoId) {
      const videoId = block.videoId;
      void getVideoEditor(videoId).then((value) => {
        if (live) setLoaded({ videoId, value });
      });
    }
    return () => {
      live = false;
    };
  }, [block.videoId]);

  const loading = Boolean(block.videoId) && loaded?.videoId !== block.videoId;
  const data = block.videoId && loaded?.videoId === block.videoId ? loaded.value : null;

  async function run(action: () => Promise<ActionState>, options: { confirm?: string; reload?: boolean } = {}) {
    if (options.confirm && !window.confirm(options.confirm)) return;
    setBusy(true);
    setMessage({});
    try {
      const result = await action();
      setMessage(result);
      if (!result.error) {
        router.refresh();
        if (options.reload !== false) await load();
      }
    } catch {
      setMessage({ error: "Something went wrong. Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    await run(async () => {
      const duration = await readVideoDuration(file);
      const target = await reserveVideoUpload({
        blockId: block.id,
        videoId: data?.video.id ?? null,
        fileName: file.name,
        size: file.size,
        type: file.type,
      });
      if (!target.ok) return { error: target.error };
      setProgress(0);
      try {
        await uploadFile({ bucket: target.bucket, path: target.path, signedUrl: target.signedUrl }, file, {
          contentType: target.contentType,
          onProgress: setProgress,
        });
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Upload failed." };
      } finally {
        setProgress(null);
      }
      const result = await completeVideoUpload({
        videoId: target.id,
        version: target.version,
        path: target.path,
        fileName: file.name,
        size: file.size,
        mimeType: target.contentType,
        durationSeconds: duration,
      });
      if (result.ok && result.transcribing) {
        return { ...result, message: `${result.message} The transcript is being made automatically; reload in a few minutes.` };
      }
      return result;
    });
  }

  const showTranscript = videoShowsTranscript(content);
  const current = data?.versions.find((v) => v.id === data.video.current_version_id) ?? null;
  const older = data?.versions.filter((v) => v.id !== data.video.current_version_id) ?? [];
  const locked = disabled || busy;

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Loading the video…
      </p>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-5">
          <p className="mb-3 text-sm text-muted">
            Upload your own recording (MP4, WebM or MOV, up to 5 GB). Large files are uploaded in parts and resume after a hiccup. Keep this page open
            until the upload is done.
          </p>
          <UploadButton label="Upload a video" accept={VIDEO_ACCEPT} disabled={locked} onFile={(f) => void upload(f)} variant="primary" />
        </div>
        <UploadProgress value={progress} label="Uploading" />
        <ReuseVideo disabled={locked} onPick={(id) => run(() => setBlockVideo(block.id, id), { reload: false })} />
        <FormMessage error={message.error} success={message.message} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <RenameVideo key={data.video.id} title={data.video.title} disabled={locked} onSave={(title) => run(() => renameVideo(data.video.id, title))} />

      {current ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
          {current.url ? (
            <video controls playsInline preload="metadata" src={current.url} className="aspect-video w-full rounded-xl bg-black" />
          ) : (
            <p className="flex aspect-video items-center justify-center rounded-xl bg-surface text-sm text-muted">Preview not available.</p>
          )}
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2 font-medium text-brand-900">
              <FileVideo className="size-4 text-brand-600" aria-hidden="true" />
              Version {current.version}
              <Badge tone="success">Live</Badge>
            </p>
            <p className="break-all text-muted">{current.file_name}</p>
            <p className="text-muted">
              {[current.duration_seconds ? formatClock(Number(current.duration_seconds)) : "length unknown", formatBytes(current.size_bytes)].filter(Boolean).join(" · ")}
            </p>
            <p className="text-xs text-muted">Uploaded {formatDateTime(current.created_at)}</p>
            <UploadButton label="Replace with a new version" accept={VIDEO_ACCEPT} disabled={locked} onFile={(f) => void upload(f)} />
            <p className="text-xs text-muted">Watch progress is kept per video, so nobody loses it. Subtitles and transcript belong to a version.</p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-4">
          <p className="mb-3 text-sm text-muted">This video has no file yet.</p>
          <UploadButton label="Upload the video" accept={VIDEO_ACCEPT} disabled={locked} onFile={(f) => void upload(f)} variant="primary" />
        </div>
      )}
      <UploadProgress value={progress} label="Uploading" />
      <FormMessage error={message.error} success={message.message} />

      {current && (
        <>
          <TranscriptSection key={`t-${current.id}-${current.transcript_status}`} version={current} data={data} disabled={locked} run={run} />
          <SubtitlesSection key={`s-${current.id}`} version={current} disabled={locked} run={run} />
        </>
      )}

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={showTranscript}
          disabled={disabled}
          onChange={(e) => onChange({ ...content, transcript: e.target.checked })}
          className="size-4 accent-brand-700"
        />
        Show the transcript under the video (saved with Save block)
      </label>

      {older.length > 0 && (
        <details className="rounded-xl border border-border px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-900">Earlier versions ({older.length})</summary>
          <ul className="mt-3 space-y-2 text-sm">
            {older.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Version {v.version}</span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {v.file_name} · {formatDateTime(v.created_at)}
                </span>
                <Button size="sm" variant="ghost" disabled={locked} onClick={() => run(() => setCurrentVideoVersion(data.video.id, v.id))}>
                  Make live
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={locked}
                  onClick={() => run(() => deleteVideoVersion(v.id), { confirm: `Delete version ${v.version} and its files?` })}
                >
                  <Trash2 aria-hidden="true" />
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {data.usedIn.length > 1 && (
        <p className="text-xs text-muted">Also used in: {data.usedIn.map((u) => u.lessonTitle).join(", ")}. A change applies everywhere.</p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => run(() => setBlockVideo(block.id, null), { reload: false })}>
          <Unlink aria-hidden="true" />
          Remove from this block
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={locked}
          onClick={() =>
            run(() => deleteVideo(data.video.id), {
              confirm: `Delete "${data.video.title}" everywhere${data.usedIn.length > 1 ? ` (${data.usedIn.length} lessons)` : ""}, with all versions and everyone's watch progress?`,
              reload: false,
            })
          }
        >
          <Trash2 aria-hidden="true" />
          Delete video
        </Button>
      </div>
    </div>
  );
}

function RenameVideo({ title, disabled, onSave }: { title: string; disabled?: boolean; onSave: (title: string) => void }) {
  const [value, setValue] = useState(title);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Video title (for Nordavo)" htmlFor="video-title" className="min-w-0 flex-1">
        <Input id="video-title" value={value} maxLength={300} disabled={disabled} onChange={(e) => setValue(e.target.value)} />
      </Field>
      {value.trim() !== title && value.trim() && (
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onSave(value)}>
          Save title
        </Button>
      )}
    </div>
  );
}

function ReuseVideo({ disabled, onPick }: { disabled?: boolean; onPick: (id: string) => void }) {
  const [options, setOptions] = useState<{ id: string; title: string; detail: string }[] | null>(null);
  const [picked, setPicked] = useState("");
  return (
    <details
      className="rounded-xl border border-border px-4 py-3"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && !options) void getMediaOptions("video").then(setOptions);
      }}
    >
      <summary className="cursor-pointer text-sm font-medium text-brand-900">Or use a video that is already in the Academy</summary>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label="Video" htmlFor="reuse-video" className="min-w-0 flex-1" hint="The same video in more lessons: progress counts everywhere.">
          <Select id="reuse-video" value={picked} onChange={(e) => setPicked(e.target.value)} disabled={disabled || !options}>
            <option value="">{options ? "Choose a video" : "Loading…"}</option>
            {(options ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
                {o.detail ? ` (${o.detail})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Button size="sm" disabled={disabled || !picked} onClick={() => onPick(picked)}>
          Use this video
        </Button>
      </div>
    </details>
  );
}

type Version = VideoEditorData["versions"][number];
type Run = (action: () => Promise<ActionState>, options?: { confirm?: string; reload?: boolean }) => Promise<void>;

function TranscriptSection({ version, data, disabled, run }: { version: Version; data: VideoEditorData; disabled?: boolean; run: Run }) {
  const [text, setText] = useState(version.transcript ?? "");
  const [lang, setLang] = useState<AcademyLocale | "">(version.transcript_language ?? "");
  const status = transcriptLabels[version.transcript_status] ?? transcriptLabels.none;
  const timed = Boolean(transcriptCues(text));
  const { provider, tooLarge, maxBytes } = data.transcription;
  const changed = text.trim() !== (version.transcript ?? "").trim() || (lang || null) !== version.transcript_language;

  return (
    <section className="space-y-3 rounded-xl border border-border px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-900">
          Transcript <Badge tone={status.tone}>{status.label}</Badge>
          {text.trim() && <Badge tone="neutral">{timed ? "with timings" : "plain text"}</Badge>}
        </h3>
        <div className="flex flex-wrap gap-2">
          {version.transcript_status === "pending" && (
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => run(async () => ({}))}>
              <RefreshCw aria-hidden="true" />
              Check again
            </Button>
          )}
          {provider && !tooLarge && version.transcript_status !== "pending" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={() =>
                run(() => startTranscription(version.id), {
                  confirm: version.transcript ? "Make a new automatic transcript? The current text is replaced when it is ready." : undefined,
                })
              }
            >
              <Sparkles aria-hidden="true" />
              {version.transcript ? "Transcribe again" : "Transcribe automatically"}
            </Button>
          )}
        </div>
      </div>
      {!provider && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Automatic transcripts are off: no OPENAI_API_KEY or DEEPGRAM_API_KEY is set. Type the transcript below, or upload a WebVTT or SRT file (with
          timings, subtitles can be made from it).
        </p>
      )}
      {provider && tooLarge && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This file is larger than {formatBytes(maxBytes)}, the limit of {provider}. Upload a transcript or subtitles, or set
          ACADEMY_TRANSCRIPTION_PROVIDER=deepgram with DEEPGRAM_API_KEY for long recordings.
        </p>
      )}
      {version.transcript_status === "failed" && version.transcript_error && (
        <p className="rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{version.transcript_error}</p>
      )}
      <Field
        label="Text"
        htmlFor={`transcript-${version.id}`}
        hint='Correct it here. Timed lines look like "00:00:01.000 --> 00:00:04.000" with the text on the next line; keep those lines to keep the timings.'
      >
        <Textarea
          id={`transcript-${version.id}`}
          rows={10}
          value={text}
          disabled={disabled || version.transcript_status === "pending"}
          onChange={(e) => setText(e.target.value)}
          className="font-mono text-xs"
        />
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Language" htmlFor={`transcript-lang-${version.id}`}>
          <Select id={`transcript-lang-${version.id}`} value={lang} disabled={disabled} onChange={(e) => setLang(e.target.value as AcademyLocale | "")} className="w-40">
            <option value="">Unknown</option>
            <option value="nl">Dutch</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <Button size="sm" disabled={disabled || !changed} onClick={() => run(() => saveTranscript(version.id, text, lang || null))}>
          Save transcript
        </Button>
        <UploadButton
          label="Upload a transcript"
          accept={TEXT_ACCEPT}
          disabled={disabled}
          onFile={(file) => void file.text().then((value) => setText(value.replace(/^WEBVTT[^\n]*\n+/, "")))}
        />
      </div>
    </section>
  );
}

function SubtitlesSection({ version, disabled, run }: { version: Version; disabled?: boolean; run: Run }) {
  const [editing, setEditing] = useState<{ lang: AcademyLocale; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const timed = Boolean(transcriptCues(version.transcript));

  async function edit(lang: AcademyLocale) {
    setLoadError(null);
    const result = await getSubtitles(version.id, lang);
    if ("error" in result) setLoadError(result.error);
    else setEditing({ lang, text: result.text || "WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n" });
  }

  return (
    <section className="space-y-3 rounded-xl border border-border px-4 py-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-900">
        <Captions className="size-4 text-brand-600" aria-hidden="true" /> Subtitles
      </h3>
      <ul className="space-y-3">
        {(["nl", "en"] as const).map((lang) => {
          const has = Boolean(lang === "nl" ? version.subtitles_nl_path : version.subtitles_en_path);
          return (
            <li key={lang} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 font-medium">{lang === "nl" ? "Dutch" : "English"}</span>
              <Badge tone={has ? "success" : "neutral"}>{has ? "Added" : "None"}</Badge>
              <UploadButton
                label={has ? "Replace file" : "Upload .vtt or .srt"}
                accept={TEXT_ACCEPT}
                disabled={disabled}
                onFile={(file) => void file.text().then((text) => run(() => saveSubtitles(version.id, lang, text)))}
              />
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void edit(lang)}>
                {has ? "Edit" : "Type them"}
              </Button>
              {timed && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    run(() => subtitlesFromTranscript(version.id, lang), {
                      confirm: has ? `Replace the ${lang.toUpperCase()} subtitles with the transcript?` : undefined,
                    })
                  }
                >
                  From the transcript
                </Button>
              )}
              {has && (
                <Button size="sm" variant="ghost" disabled={disabled} onClick={() => run(() => deleteSubtitles(version.id, lang), { confirm: "Remove these subtitles?" })}>
                  <Trash2 aria-hidden="true" />
                  Remove
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {!timed && <p className="text-xs text-muted">Subtitles can be made from the transcript once it has timings (automatic, or an uploaded WebVTT).</p>}
      {loadError && <p className="text-xs text-danger">{loadError}</p>}
      {editing && (
        <div className="space-y-2">
          <Field label={`Subtitles ${editing.lang.toUpperCase()} (WebVTT)`} htmlFor={`subs-${version.id}`}>
            <Textarea
              id={`subs-${version.id}`}
              rows={12}
              value={editing.text}
              disabled={disabled}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              className="font-mono text-xs"
            />
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  const result = await saveSubtitles(version.id, editing.lang, editing.text);
                  if (result.ok) setEditing(null);
                  return result;
                })
              }
            >
              Save subtitles
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
