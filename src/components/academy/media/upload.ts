"use client";

import { createClient } from "@/lib/supabase/client";
import { RESUMABLE_FROM_BYTES } from "@/lib/academy/media/files";

/**
 * Uploads for the Academy editor, with progress. The server action first
 * checks the manager, the file and the path and returns a signed upload URL
 * (createSignedUploadUrl, valid two hours). Then:
 *
 *   up to 6 MB      one PUT to the signed upload URL
 *   larger (video)  resumable upload (TUS, Supabase's /storage/v1/upload/resumable)
 *                   in 6 MB chunks with the manager's session, retried per
 *                   chunk; if the resumable endpoint is not available the
 *                   signed URL is used for the whole file
 *
 * Storage RLS checks the path again (academy managers only).
 */

export type UploadTarget = { bucket: string; path: string; signedUrl: string };
export type Progress = (fraction: number) => void;

const CHUNK = 6 * 1024 * 1024;

function putSigned(target: UploadTarget, file: File, contentType: string, onProgress?: Progress): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.signedUrl);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("x-upsert", "true");
    const apikey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (apikey) xhr.setRequestHeader("apikey", apikey);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.send(file);
  });
}

function b64(value: string) {
  return btoa(unescape(encodeURIComponent(value)));
}

async function resumable(target: UploadTarget, file: File, contentType: string, onProgress?: Progress): Promise<boolean> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const apikey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !apikey) return false;
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  const auth = { authorization: `Bearer ${token}`, apikey, "tus-resumable": "1.0.0" };

  const create = await fetch(`${base}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: {
      ...auth,
      "upload-length": String(file.size),
      "x-upsert": "true",
      "upload-metadata": [
        `bucketName ${b64(target.bucket)}`,
        `objectName ${b64(target.path)}`,
        `contentType ${b64(contentType)}`,
        `cacheControl ${b64("3600")}`,
      ].join(","),
    },
  }).catch(() => null);
  if (!create || create.status !== 201) return false;
  const location = create.headers.get("location");
  if (!location) return false;
  const url = location.startsWith("http") ? location : `${base}${location}`;

  let offset = 0;
  while (offset < file.size) {
    let sent = false;
    for (let attempt = 0; attempt < 4 && !sent; attempt += 1) {
      if (attempt > 0) {
        // Ask the server where it is, then continue from there.
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        const head = await fetch(url, { method: "HEAD", headers: auth }).catch(() => null);
        const at = Number(head?.headers.get("upload-offset"));
        if (Number.isFinite(at) && at >= 0) offset = at;
        if (offset >= file.size) break;
      }
      const chunk = file.slice(offset, offset + CHUNK);
      const response = await fetch(url, {
        method: "PATCH",
        headers: { ...auth, "upload-offset": String(offset), "content-type": "application/offset+octet-stream" },
        body: chunk,
      }).catch(() => null);
      if (response && response.status === 204) {
        offset = Number(response.headers.get("upload-offset")) || offset + chunk.size;
        sent = true;
      }
    }
    if (!sent && offset < file.size) throw new Error("Upload failed. Check your connection and try again.");
    onProgress?.(Math.min(1, offset / file.size));
  }
  return true;
}

/** Upload one file to the reserved target; throws with a message on failure. */
export async function uploadFile(target: UploadTarget, file: File, { contentType, onProgress }: { contentType?: string; onProgress?: Progress } = {}) {
  const type = contentType || file.type || "application/octet-stream";
  if (file.size > RESUMABLE_FROM_BYTES && (await resumable(target, file, type, onProgress))) return;
  await putSigned(target, file, type, onProgress);
}

/** The duration of a local video file in seconds (from its metadata), or null. */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration * 100) / 100 : null);
    video.onerror = () => done(null);
    setTimeout(() => done(null), 15_000);
    video.src = url;
  });
}
