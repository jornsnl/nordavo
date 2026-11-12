"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, LoaderCircle, Play, Trash2, Upload, Video } from "lucide-react";
import { deleteAttachment } from "@/components/entity/actions";
import { createVideoUploadTarget, getCandidateVideoUrl, saveCandidateVideo } from "@/app/dashboard/candidates/video-actions";
import { isVideoFile, MAX_VIDEO_BYTES, type VideoEmbed } from "@/lib/recruitment/candidate-fields";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { FormMessage } from "@/components/ui/field";

export type VideoFile = { id: string; fileName: string; createdAt: string; uploaderName: string };

const PROVIDERS: Record<VideoEmbed["provider"], string> = {
  youtube: "YouTube",
  loom: "Loom",
  vimeo: "Vimeo",
  google_drive: "Google Drive",
};

/**
 * The video intro on the candidate page: the linked video plays here
 * (Loom, YouTube, Vimeo, Google Drive), and a copy can be uploaded to the
 * portal so it stays available when the link stops working.
 */
export function VideoIntro({
  candidateId,
  videoUrl,
  embed,
  files,
}: {
  candidateId: string;
  videoUrl: string | null;
  embed: VideoEmbed | null;
  files: VideoFile[];
}) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [pending, startTransition] = useTransition();

  async function upload(file: File) {
    setError(undefined);
    setMessage(undefined);
    if (!isVideoFile(file.name, file.type)) return setError("Upload a video file: MP4, MOV, WEBM or M4V.");
    if (file.size > MAX_VIDEO_BYTES) return setError(`${file.name} is too large. The maximum is ${MAX_VIDEO_BYTES / 1024 / 1024} MB.`);
    setBusy(true);
    setProgress(`Uploading ${file.name}`);
    try {
      const target = await createVideoUploadTarget({ candidateId, fileName: file.name, size: file.size, mimeType: file.type });
      if (!target.ok) return setError(target.error);
      const { error: uploadError } = await createClient()
        .storage.from("attachments")
        .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type || undefined });
      if (uploadError) return setError("Upload failed. Try again.");
      const result = await saveCandidateVideo({ candidateId, path: target.path, fileName: file.name, size: file.size, mimeType: file.type });
      if (result.error) return setError(result.error);
      setMessage(result.message);
      router.refresh();
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
      setProgress(undefined);
      if (input.current) input.current.value = "";
    }
  }

  function play(fileId: string) {
    startTransition(async () => {
      const result = await getCandidateVideoUrl(fileId);
      if ("error" in result) setError(result.error);
      else setPlaying({ id: fileId, url: result.url });
    });
  }

  function remove(fileId: string) {
    startTransition(async () => {
      const result = await deleteAttachment(fileId);
      if (result.error) setError(result.error);
      else {
        if (playing?.id === fileId) setPlaying(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {embed ? (
        <div className="aspect-video overflow-hidden rounded-xl border border-border bg-black">
          <iframe
            src={embed.embedUrl}
            title={`Video intro on ${PROVIDERS[embed.provider]}`}
            className="size-full"
            allow="fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
        </div>
      ) : null}
      {videoUrl ? (
        <a
          href={videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline pointer-coarse:min-h-10"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          {embed ? `Open on ${PROVIDERS[embed.provider]}` : "Watch the video intro (opens the link)"}
        </a>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Video className="size-4 shrink-0" aria-hidden="true" />
          No video link yet. Add it under Edit, or upload a copy below.
        </p>
      )}

      {playing && (
        <video src={playing.url} controls autoPlay className="aspect-video w-full rounded-xl border border-border bg-black">
          <track kind="captions" />
        </video>
      )}

      {files.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-white">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Video className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{f.fileName}</span>
                <span className="block text-xs text-muted">
                  Copy in the portal, {f.uploaderName}, {formatDate(f.createdAt)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => play(f.id)}
                disabled={pending}
                aria-label={`Play ${f.fileName}`}
                className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <Play className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => remove(f.id)}
                disabled={pending}
                aria-label={`Delete ${f.fileName}`}
                className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label
        htmlFor={inputId}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-brand-200 bg-surface/60 px-4 py-3 text-sm font-medium text-brand-900 transition hover:border-brand-500 hover:bg-brand-50 has-focus-visible:outline-2 has-focus-visible:outline-brand-500 ${
          busy ? "pointer-events-none opacity-70" : ""
        }`}
      >
        {busy ? <LoaderCircle className="size-4 animate-spin text-brand-600" aria-hidden="true" /> : <Upload className="size-4 text-brand-600" aria-hidden="true" />}
        {busy ? (progress ?? "Uploading") : "Upload a copy of the video"}
        <input
          ref={input}
          id={inputId}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      <p className="text-xs text-muted">
        Private: only the Nordavo team can play it. Up to {MAX_VIDEO_BYTES / 1024 / 1024} MB. Download the video from Loom or Drive and upload it here
        so it stays available.
      </p>
      <div aria-live="polite">
        <FormMessage error={error} success={message} />
      </div>
    </div>
  );
}
