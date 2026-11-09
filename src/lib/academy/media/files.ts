import type { AcademyDocumentCategory } from "@/lib/academy/database";

// Storage paths and file checks for Academy media (docs/academy.md, Opslag).
// Pure, tested in tests/academy-media.test.ts.
//
//   bucket academy-media   academy/video/<video_id>/v<version>-<name>
//                          academy/video/<video_id>/v<version>-subtitles-<nl|en>.vtt
//   bucket attachments     academy/document/<document_id>/v<version>-<name>
//                          academy/image/<random>/<name>

export const MEDIA_BUCKET = "academy-media";
export const FILES_BUCKET = "attachments";

/** Bucket limit of academy-media (the Supabase project limit must be as high). */
export const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Above this, uploads go in resumable chunks (Supabase recommends this from 6 MB). */
export const RESUMABLE_FROM_BYTES = 6 * 1024 * 1024;
/** OpenAI transcription takes files up to 25 MB. */
export const OPENAI_TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

/** A file name safe for a storage key: ASCII letters, digits, dot, dash, underscore. */
export function safeFileName(name: string): string {
  const clean = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(-120);
  return clean || "file";
}

export function videoFilePath(videoId: string, version: number, fileName: string) {
  return `academy/video/${videoId}/v${version}-${safeFileName(fileName)}`;
}

export function subtitlePath(videoId: string, version: number, language: "nl" | "en") {
  return `academy/video/${videoId}/v${version}-subtitles-${language}.vtt`;
}

export function documentFilePath(documentId: string, version: number, fileName: string) {
  return `academy/document/${documentId}/v${version}-${safeFileName(fileName)}`;
}

export function imageFilePath(random: string, fileName: string) {
  return `academy/image/${random}/${safeFileName(fileName)}`;
}

/** The URL an explanation image is shown through (checks the viewer, then a signed link). */
export function imageUrl(path: string) {
  return `/academy/files/image/${path.replace(/^academy\/image\//, "")}`;
}

/** Whether a path is one of ours for this record (no tricks like ..). */
export function pathBelongsTo(path: string, prefix: string): boolean {
  return path.startsWith(prefix) && !path.includes("..") && !path.includes("//") && path.length <= 1000;
}

function extension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov"]);
const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "odt", "ods", "txt"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

export type FileCheck = { ok: true } | { ok: false; error: string };

export function checkVideoFile(name: string, size: number, type: string): FileCheck {
  if (!VIDEO_EXTENSIONS.has(extension(name)) && !/^video\/(mp4|webm|quicktime|x-m4v)$/.test(type)) {
    return { ok: false, error: "Upload an MP4, WebM or MOV video." };
  }
  if (size <= 0) return { ok: false, error: "This file is empty." };
  if (size > MAX_VIDEO_BYTES) return { ok: false, error: "The video is larger than 5 GB." };
  return { ok: true };
}

export function checkDocumentFile(name: string, size: number): FileCheck {
  if (!DOCUMENT_EXTENSIONS.has(extension(name))) {
    return { ok: false, error: "Upload a PDF, Word, Excel or PowerPoint file (or CSV, ODT, ODS, TXT)." };
  }
  if (size <= 0) return { ok: false, error: "This file is empty." };
  if (size > MAX_DOCUMENT_BYTES) return { ok: false, error: "The file is larger than 20 MB." };
  return { ok: true };
}

export function checkImageFile(name: string, size: number, type: string): FileCheck {
  if (!IMAGE_EXTENSIONS.has(extension(name)) || (type && !/^image\/(png|jpeg|gif|webp)$/.test(type))) {
    return { ok: false, error: "Upload a PNG, JPG, GIF or WebP image." };
  }
  if (size <= 0) return { ok: false, error: "This file is empty." };
  if (size > MAX_IMAGE_BYTES) return { ok: false, error: "The image is larger than 10 MB." };
  return { ok: true };
}

/** The content type a video is stored with (the bucket allows these). */
export function videoContentType(name: string, type: string): string {
  if (/^video\/(mp4|webm|quicktime|x-m4v)$/.test(type)) return type;
  const ext = extension(name);
  return ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime" : ext === "m4v" ? "video/x-m4v" : "video/mp4";
}

/** What kind of file, for the icon and label next to a download. */
export function documentFormat(name: string): "pdf" | "word" | "excel" | "powerpoint" | "other" {
  const ext = extension(name);
  if (ext === "pdf") return "pdf";
  if (ext === "doc" || ext === "docx" || ext === "odt") return "word";
  if (ext === "xls" || ext === "xlsx" || ext === "csv" || ext === "ods") return "excel";
  if (ext === "ppt" || ext === "pptx") return "powerpoint";
  return "other";
}

/** "3.4 MB" */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Whether a document carries the "new" label now. */
export function isNewDocument(newUntil: string | null | undefined, now: Date = new Date()): boolean {
  return Boolean(newUntil && new Date(newUntil).getTime() > now.getTime());
}

/** How long a new version is labelled "new". */
export const NEW_LABEL_DAYS = 14;

/** Document kinds in the (English) editor. */
export const CATEGORY_OPTIONS: { value: AcademyDocumentCategory; label: string }[] = [
  { value: "workbook", label: "Workbook" },
  { value: "template", label: "Template" },
  { value: "checklist", label: "Checklist" },
  { value: "policy", label: "Policy" },
  { value: "contract_summary", label: "Contract summary" },
  { value: "gdpr", label: "GDPR" },
  { value: "escalation_matrix", label: "Escalation matrix" },
  { value: "decision_matrix", label: "Decision matrix" },
  { value: "blocker_agreement", label: "Blocker agreement" },
  { value: "other", label: "Other" },
];

