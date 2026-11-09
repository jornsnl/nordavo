"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR } from "@/lib/action-state";
import type { AcademyDocumentCategory, AcademyLocale } from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";
import { requireAcademyManager } from "@/lib/academy/auth";
import {
  FILES_BUCKET,
  MEDIA_BUCKET,
  NEW_LABEL_DAYS,
  checkDocumentFile,
  checkImageFile,
  checkVideoFile,
  documentFilePath,
  imageFilePath,
  imageUrl,
  pathBelongsTo,
  subtitlePath,
  videoContentType,
  videoFilePath,
} from "@/lib/academy/media/files";
import { type VideoEditorData, documentDownloadLink, loadDocumentDetail, loadVideoEditor } from "@/lib/academy/media/server";
import { runTranscription } from "@/lib/academy/media/transcribe-run";
import { transcriptionProvider } from "@/lib/academy/media/transcription";
import { normalizeSubtitles, toVtt, transcriptCues } from "@/lib/academy/media/vtt";
import { type WorksheetField, normalizeFields } from "@/lib/academy/media/worksheet";
import { createClient } from "@/lib/supabase/server";

// Editor actions of the media area (/dashboard/academy): videos (upload,
// versions, subtitles, transcript), documents (versions, worksheet fields,
// module workbook), images for the explanation block. Managers only:
// requireAcademyManager here, academy_is_manager() in RLS and storage.

const guid = z.guid();
const language = z.enum(["nl", "en"]);

function log(where: string, error: { code?: string; message: string } | null | undefined) {
  if (error) console.error(`academy media ${where}`, error.code, error.message);
}

function refresh() {
  revalidatePath("/dashboard/academy", "layout");
  revalidatePath("/academy", "layout");
}

export type UploadReservation =
  | { ok: true; bucket: string; path: string; signedUrl: string; contentType: string; version: number; id: string }
  | { ok: false; error: string };

async function reserve(bucket: string, path: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
  log("signed upload", error);
  return data ? { path: data.path, signedUrl: data.signedUrl } : null;
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

/** The video block editor loads its video with this. */
export async function getVideoEditor(videoId: string): Promise<VideoEditorData | null> {
  await requireAcademyManager();
  if (!guid.safeParse(videoId).success) return null;
  return loadVideoEditor(await createClient(), videoId);
}

/** Point a video block at a video (or none). */
export async function setBlockVideo(blockId: string, videoId: string | null): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(blockId).success || (videoId !== null && !guid.safeParse(videoId).success)) return { error: "Video not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_lesson_blocks").update({ video_id: videoId }).eq("id", blockId).eq("type", "video");
  log("setBlockVideo", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true };
}

/**
 * Step 1 of an upload: a new video for the block (videoId null) or a new
 * version of an existing one. Returns a signed upload URL for
 * academy-media/academy/video/<id>/v<n>-<name>.
 */
export async function reserveVideoUpload(input: {
  blockId: string | null;
  videoId: string | null;
  fileName: string;
  size: number;
  type: string;
}): Promise<UploadReservation> {
  await requireAcademyManager();
  const parsed = z
    .object({ blockId: guid.nullable(), videoId: guid.nullable(), fileName: z.string().min(1).max(300), size: z.number().int().positive(), type: z.string().max(100) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "This file cannot be uploaded." };
  const check = checkVideoFile(parsed.data.fileName, parsed.data.size, parsed.data.type);
  if (!check.ok) return check;
  const supabase = await createClient();

  let videoId = parsed.data.videoId;
  if (!videoId) {
    const title = parsed.data.fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 300) || "Video";
    const { data, error } = await supabase.from("academy_videos").insert({ title }).select("id").single();
    log("create video", error);
    if (!data) return { ok: false, error: GENERIC_ERROR };
    videoId = data.id;
    if (parsed.data.blockId) {
      const { error: linkError } = await supabase.from("academy_lesson_blocks").update({ video_id: videoId }).eq("id", parsed.data.blockId).eq("type", "video");
      log("link video", linkError);
    }
  }
  const { data: last } = await supabase.from("academy_video_versions").select("version").eq("video_id", videoId).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const target = await reserve(MEDIA_BUCKET, videoFilePath(videoId, version, parsed.data.fileName));
  if (!target) return { ok: false, error: "Uploading does not work right now. Try again later." };
  return { ok: true, bucket: MEDIA_BUCKET, ...target, contentType: videoContentType(parsed.data.fileName, parsed.data.type), version, id: videoId };
}

/**
 * Step 2: the file is in storage. Adds the version and makes it current.
 * Watch progress is per video, so nobody loses it; the position is clamped
 * to the new length when they watch again. Starts the transcript when a
 * provider is configured.
 */
export async function completeVideoUpload(input: {
  videoId: string;
  version: number;
  path: string;
  fileName: string;
  size: number;
  mimeType: string;
  durationSeconds: number | null;
}): Promise<ActionState & { transcribing?: boolean }> {
  await requireAcademyManager();
  const parsed = z
    .object({
      videoId: guid,
      version: z.number().int().min(1),
      path: z.string().min(1).max(1000),
      fileName: z.string().min(1).max(300),
      size: z.number().int().positive(),
      mimeType: z.string().max(100),
      durationSeconds: z.number().positive().max(100_000).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };
  const d = parsed.data;
  if (!pathBelongsTo(d.path, `academy/video/${d.videoId}/v${d.version}-`)) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: version, error } = await supabase
    .from("academy_video_versions")
    .insert({
      video_id: d.videoId,
      version: d.version,
      storage_path: d.path,
      file_name: d.fileName,
      mime_type: d.mimeType || null,
      size_bytes: d.size,
      duration_seconds: d.durationSeconds,
    })
    .select("id")
    .single();
  log("completeVideoUpload", error);
  if (!version) return { error: error?.code === "23505" ? "Someone uploaded a version at the same time. Reload the page." : GENERIC_ERROR };
  const { error: currentError } = await supabase.from("academy_videos").update({ current_version_id: version.id }).eq("id", d.videoId);
  log("current version", currentError);

  const provider = transcriptionProvider();
  const transcribing = Boolean(provider && (!provider.maxBytes || d.size <= provider.maxBytes));
  if (transcribing) {
    await supabase.from("academy_video_versions").update({ transcript_status: "pending" }).eq("id", version.id);
    after(async () => {
      await runTranscription(await createClient(), version.id);
    });
  }
  refresh();
  return { ok: true, message: d.version > 1 ? `Version ${d.version} is live. Everyone keeps their progress.` : "The video is uploaded.", transcribing };
}

export async function renameVideo(videoId: string, title: string): Promise<ActionState> {
  await requireAcademyManager();
  const clean = title.trim().slice(0, 300);
  if (!guid.safeParse(videoId).success || !clean) return { error: "Enter a title." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_videos").update({ title: clean }).eq("id", videoId);
  log("renameVideo", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: "Saved." };
}

/** Make an earlier version current again (for example after a wrong upload). */
export async function setCurrentVideoVersion(videoId: string, versionId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(videoId).success || !guid.safeParse(versionId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: version } = await supabase.from("academy_video_versions").select("id").eq("id", versionId).eq("video_id", videoId).maybeSingle();
  if (!version) return { error: "Version not found." };
  const { error } = await supabase.from("academy_videos").update({ current_version_id: versionId }).eq("id", videoId);
  log("setCurrentVideoVersion", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: "This version is live again." };
}

async function removeFiles(bucket: string, paths: (string | null | undefined)[]) {
  const list = paths.filter((p): p is string => Boolean(p));
  if (list.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase.storage.from(bucket).remove(list);
  log("remove files", error);
}

/** Delete an old version with its files (not the live one). */
export async function deleteVideoVersion(versionId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(versionId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: version } = await supabase.from("academy_video_versions").select("*").eq("id", versionId).maybeSingle();
  if (!version) return { error: "Version not found." };
  const { data: video } = await supabase.from("academy_videos").select("current_version_id").eq("id", version.video_id).maybeSingle();
  if (video?.current_version_id === versionId) return { error: "This is the live version. Upload or pick another version first." };
  const { error } = await supabase.from("academy_video_versions").delete().eq("id", versionId);
  log("deleteVideoVersion", error);
  if (error) return { error: GENERIC_ERROR };
  await removeFiles(MEDIA_BUCKET, [version.storage_path, version.subtitles_nl_path, version.subtitles_en_path]);
  refresh();
  return { ok: true, message: `Version ${version.version} is deleted.` };
}

/** Delete a video everywhere: its versions, files and everyone's watch progress on it. */
export async function deleteVideo(videoId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(videoId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: versions } = await supabase.from("academy_video_versions").select("storage_path, subtitles_nl_path, subtitles_en_path").eq("video_id", videoId);
  const { error } = await supabase.from("academy_videos").delete().eq("id", videoId);
  log("deleteVideo", error);
  if (error) return { error: GENERIC_ERROR };
  await removeFiles(
    MEDIA_BUCKET,
    (versions ?? []).flatMap((v) => [v.storage_path, v.subtitles_nl_path, v.subtitles_en_path]),
  );
  refresh();
  return { ok: true, message: "The video is deleted." };
}

async function versionRow(versionId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("academy_video_versions").select("*").eq("id", versionId).maybeSingle();
  return { supabase, version: data };
}

/** The subtitles of a version as text, for editing. */
export async function getSubtitles(versionId: string, lang: AcademyLocale): Promise<{ text: string } | { error: string }> {
  await requireAcademyManager();
  if (!guid.safeParse(versionId).success || !language.safeParse(lang).success) return { error: GENERIC_ERROR };
  const { supabase, version } = await versionRow(versionId);
  const path = lang === "nl" ? version?.subtitles_nl_path : version?.subtitles_en_path;
  if (!path) return { text: "" };
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).download(path);
  log("getSubtitles", error);
  if (!data) return { error: "The subtitles could not be loaded." };
  return { text: await data.text() };
}

async function storeSubtitles(versionId: string, lang: AcademyLocale, vtt: string): Promise<ActionState> {
  const { supabase, version } = await versionRow(versionId);
  if (!version) return { error: "Version not found." };
  const path = subtitlePath(version.video_id, version.version, lang);
  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, new Blob([vtt], { type: "text/vtt" }), { upsert: true, contentType: "text/vtt" });
  log("store subtitles", uploadError);
  if (uploadError) return { error: "The subtitles could not be saved. Try again." };
  const { error } = await supabase
    .from("academy_video_versions")
    .update(lang === "nl" ? { subtitles_nl_path: path } : { subtitles_en_path: path })
    .eq("id", versionId);
  log("subtitle path", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true };
}

/** Uploaded or edited subtitles (WebVTT or SRT), saved as clean WebVTT. */
export async function saveSubtitles(versionId: string, lang: AcademyLocale, text: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(versionId).success || !language.safeParse(lang).success || typeof text !== "string") return { error: GENERIC_ERROR };
  const result = normalizeSubtitles(text);
  if (!result.ok) return { error: result.error };
  const saved = await storeSubtitles(versionId, lang, result.vtt);
  return saved.ok ? { ok: true, message: `${result.cues} subtitles saved (${lang.toUpperCase()}).` } : saved;
}

/** Subtitles in a language from the timed transcript. */
export async function subtitlesFromTranscript(versionId: string, lang: AcademyLocale): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(versionId).success || !language.safeParse(lang).success) return { error: GENERIC_ERROR };
  const { version } = await versionRow(versionId);
  const cues = transcriptCues(version?.transcript);
  if (!cues) return { error: "The transcript has no timings. Upload a WebVTT file, or transcribe automatically, to make subtitles." };
  const saved = await storeSubtitles(versionId, lang, toVtt(cues));
  return saved.ok ? { ok: true, message: `Subtitles (${lang.toUpperCase()}) made from the transcript: ${cues.length} lines.` } : saved;
}

export async function deleteSubtitles(versionId: string, lang: AcademyLocale): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(versionId).success || !language.safeParse(lang).success) return { error: GENERIC_ERROR };
  const { supabase, version } = await versionRow(versionId);
  if (!version) return { error: "Version not found." };
  const path = lang === "nl" ? version.subtitles_nl_path : version.subtitles_en_path;
  const { error } = await supabase
    .from("academy_video_versions")
    .update(lang === "nl" ? { subtitles_nl_path: null } : { subtitles_en_path: null })
    .eq("id", versionId);
  log("deleteSubtitles", error);
  if (error) return { error: GENERIC_ERROR };
  await removeFiles(MEDIA_BUCKET, [path]);
  refresh();
  return { ok: true, message: "Subtitles removed." };
}

/** The transcript as corrected in the editor (plain text, or timed cue blocks). */
export async function saveTranscript(versionId: string, transcript: string, lang: AcademyLocale | null): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(versionId).success || typeof transcript !== "string" || (lang !== null && !language.safeParse(lang).success)) {
    return { error: GENERIC_ERROR };
  }
  const text = transcript.replace(/\r\n?/g, "\n").trim();
  if (text.length > 500_000) return { error: "The transcript is too long (at most 500,000 characters)." };
  // An uploaded WebVTT file becomes a timed transcript without its header.
  const clean = text.startsWith("WEBVTT") ? text.replace(/^WEBVTT[^\n]*\n+/, "") : text;
  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_video_versions")
    .update({ transcript: clean || null, transcript_status: clean ? "corrected" : "none", transcript_language: lang, transcript_error: null })
    .eq("id", versionId);
  log("saveTranscript", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: "Transcript saved." };
}

/** Start (or retry) the automatic transcript of a version. */
export async function startTranscription(versionId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(versionId).success) return { error: GENERIC_ERROR };
  const provider = transcriptionProvider();
  if (!provider) {
    return { error: "Automatic transcripts are off: set OPENAI_API_KEY or DEEPGRAM_API_KEY. Type or upload the transcript meanwhile." };
  }
  const { supabase, version } = await versionRow(versionId);
  if (!version) return { error: "Version not found." };
  if (provider.maxBytes && version.size_bytes && version.size_bytes > provider.maxBytes) {
    return { error: `This file is larger than ${Math.round(provider.maxBytes / 1024 / 1024)} MB, the limit of ${provider.label}. Upload a transcript or subtitles instead.` };
  }
  const { error } = await supabase.from("academy_video_versions").update({ transcript_status: "pending", transcript_error: null }).eq("id", versionId);
  log("startTranscription", error);
  if (error) return { error: GENERIC_ERROR };
  after(async () => {
    await runTranscription(await createClient(), versionId);
  });
  refresh();
  return { ok: true, message: `Transcribing with ${provider.label}. This takes a few minutes; reload to see it.` };
}

// ---------------------------------------------------------------------------
// Documents and worksheets
// ---------------------------------------------------------------------------

const CATEGORIES: AcademyDocumentCategory[] = [
  "workbook",
  "template",
  "checklist",
  "contract_summary",
  "gdpr",
  "policy",
  "escalation_matrix",
  "decision_matrix",
  "blocker_agreement",
  "other",
];

const documentSchema = z.object({
  title: z.string().trim().min(1, { error: "Enter a title" }).max(300, { error: "At most 300 characters" }),
  description: z.string().trim().max(5000, { error: "At most 5,000 characters" }).optional(),
  category: z.enum(CATEGORIES as [AcademyDocumentCategory, ...AcademyDocumentCategory[]]),
  kind: z.enum(["download", "worksheet"]),
});

/** A new global document (download or worksheet), optionally placed in a block right away. */
export async function createDocument(input: {
  title: string;
  description?: string;
  category: AcademyDocumentCategory;
  kind: "download" | "worksheet";
  blockId?: string | null;
}): Promise<ActionState & { id?: string }> {
  await requireAcademyManager();
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the fields." };
  if (input.blockId && !guid.safeParse(input.blockId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academy_documents")
    .insert({ ...parsed.data, description: parsed.data.description || null, scope: "global" })
    .select("id")
    .single();
  log("createDocument", error);
  if (!data) return { error: GENERIC_ERROR };
  if (input.blockId) {
    const { error: linkError } = await supabase.from("academy_lesson_blocks").update({ document_id: data.id }).eq("id", input.blockId).in("type", ["document", "worksheet"]);
    log("link document", linkError);
  }
  refresh();
  return { ok: true, id: data.id };
}

export async function updateDocument(input: { id: string; title: string; description?: string; category: AcademyDocumentCategory }): Promise<ActionState> {
  await requireAcademyManager();
  const parsed = documentSchema.omit({ kind: true }).safeParse(input);
  if (!guid.safeParse(input.id).success) return { error: "Document not found." };
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the fields." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_documents")
    .update({ title: parsed.data.title, description: parsed.data.description || null, category: parsed.data.category })
    .eq("id", input.id);
  log("updateDocument", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: "Saved. The change applies in every lesson that uses this document." };
}

/** Delete a document with its files and answers; blocks and workbooks lose it. */
export async function deleteDocument(documentId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(documentId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: versions } = await supabase.from("academy_document_versions").select("storage_path").eq("document_id", documentId);
  const { error } = await supabase.from("academy_documents").delete().eq("id", documentId);
  log("deleteDocument", error);
  if (error) return { error: GENERIC_ERROR };
  await removeFiles(FILES_BUCKET, (versions ?? []).map((v) => v.storage_path));
  refresh();
  return { ok: true, message: "The document is deleted." };
}

/** Point a document or worksheet block at a document (or none). */
export async function setBlockDocument(blockId: string, documentId: string | null): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(blockId).success || (documentId !== null && !guid.safeParse(documentId).success)) return { error: "Document not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_lesson_blocks").update({ document_id: documentId }).eq("id", blockId).in("type", ["document", "worksheet"]);
  log("setBlockDocument", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true };
}

/** The workbook of a module: one document that belongs to all its lessons. */
export async function setModuleWorkbook(moduleId: string, documentId: string | null): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(moduleId).success || (documentId !== null && !guid.safeParse(documentId).success)) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_modules").update({ workbook_document_id: documentId }).eq("id", moduleId);
  log("setModuleWorkbook", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: documentId ? "Set as the module workbook." : "Workbook removed from the module." };
}

/** Step 1 of a new document version: signed upload URL for attachments/academy/document/<id>/v<n>-<name>. */
export async function reserveDocumentUpload(input: { documentId: string; fileName: string; size: number }): Promise<UploadReservation> {
  await requireAcademyManager();
  const parsed = z.object({ documentId: guid, fileName: z.string().min(1).max(300), size: z.number().int().positive() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "This file cannot be uploaded." };
  const check = checkDocumentFile(parsed.data.fileName, parsed.data.size);
  if (!check.ok) return check;
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("academy_document_versions")
    .select("version")
    .eq("document_id", parsed.data.documentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const target = await reserve(FILES_BUCKET, documentFilePath(parsed.data.documentId, version, parsed.data.fileName));
  if (!target) return { ok: false, error: "Uploading does not work right now. Try again later." };
  return { ok: true, bucket: FILES_BUCKET, ...target, contentType: "", version, id: parsed.data.documentId };
}

/** Step 2: the file is stored; it becomes the current version, labelled "new" for two weeks when asked. */
export async function completeDocumentUpload(input: {
  documentId: string;
  version: number;
  path: string;
  fileName: string;
  size: number;
  mimeType: string;
  notes: string;
  markNew: boolean;
}): Promise<ActionState> {
  await requireAcademyManager();
  const parsed = z
    .object({
      documentId: guid,
      version: z.number().int().min(1),
      path: z.string().min(1).max(1000),
      fileName: z.string().min(1).max(300),
      size: z.number().int().positive(),
      mimeType: z.string().max(200),
      notes: z.string().max(2000),
      markNew: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };
  const d = parsed.data;
  if (!pathBelongsTo(d.path, `academy/document/${d.documentId}/v${d.version}-`)) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_document_versions").insert({
    document_id: d.documentId,
    version: d.version,
    storage_path: d.path,
    file_name: d.fileName,
    mime_type: d.mimeType || null,
    size_bytes: d.size,
    notes: d.notes.trim() || null,
  });
  log("completeDocumentUpload", error);
  if (error) return { error: error.code === "23505" ? "Someone uploaded a version at the same time. Reload the page." : GENERIC_ERROR };
  const { error: docError } = await supabase
    .from("academy_documents")
    .update({
      current_version: d.version,
      ...(d.markNew ? { new_until: new Date(Date.now() + NEW_LABEL_DAYS * 86_400_000).toISOString() } : {}),
    })
    .eq("id", d.documentId);
  log("current document version", docError);
  refresh();
  return { ok: true, message: `Version ${d.version} is live${d.markNew ? `, labelled "new" for ${NEW_LABEL_DAYS} days` : ""}.` };
}

/** Remove the "new" label now. */
export async function clearDocumentNew(documentId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(documentId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_documents").update({ new_until: null }).eq("id", documentId);
  log("clearDocumentNew", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: 'The "new" label is off.' };
}

/** Delete one version; the newest remaining one becomes current. */
export async function deleteDocumentVersion(versionId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(versionId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: version } = await supabase.from("academy_document_versions").select("*").eq("id", versionId).maybeSingle();
  if (!version) return { error: "Version not found." };
  const { error } = await supabase.from("academy_document_versions").delete().eq("id", versionId);
  log("deleteDocumentVersion", error);
  if (error) return { error: GENERIC_ERROR };
  const { data: newest } = await supabase
    .from("academy_document_versions")
    .select("version")
    .eq("document_id", version.document_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  await supabase.from("academy_documents").update({ current_version: newest?.version ?? 0 }).eq("id", version.document_id);
  await removeFiles(FILES_BUCKET, [version.storage_path]);
  refresh();
  return { ok: true, message: `Version ${version.version} is deleted.` };
}

/** A download link for a manager (any version). */
export async function documentVersionLink(versionId: string): Promise<{ url: string } | { error: string }> {
  await requireAcademyManager();
  if (!guid.safeParse(versionId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { data: version } = await supabase.from("academy_document_versions").select("storage_path, file_name").eq("id", versionId).maybeSingle();
  if (!version) return { error: "Version not found." };
  const url = await documentDownloadLink(supabase, version.storage_path, version.file_name);
  return url ? { url } : { error: "Downloading does not work right now." };
}

/** The fields of a worksheet. Answers keep their keys, so renaming a label keeps the answers. */
export async function saveWorksheetFields(documentId: string, fields: unknown): Promise<ActionState & { fields?: WorksheetField[] }> {
  await requireAcademyManager();
  if (!guid.safeParse(documentId).success) return { error: GENERIC_ERROR };
  const raw = Array.isArray(fields) ? fields : [];
  const missingOptions = raw.find(
    (f) => f && typeof f === "object" && (f as { type?: unknown }).type === "choice" && !((f as { options?: unknown[] }).options ?? []).some((o) => typeof o === "string" && o.trim()),
  );
  if (missingOptions) return { error: "A choice field needs at least one option." };
  if (raw.some((f) => !f || typeof f !== "object" || !String((f as { label?: unknown }).label ?? "").trim())) return { error: "Every field needs a label." };
  const clean = normalizeFields(raw);
  const supabase = await createClient();
  const { error } = await supabase.from("academy_documents").update({ worksheet_fields: clean as unknown as Json }).eq("id", documentId).eq("kind", "worksheet");
  log("saveWorksheetFields", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: "Fields saved. They apply in every lesson that uses this worksheet.", fields: clean };
}

/** Let a participant change a submitted worksheet again. */
export async function reopenWorksheet(answerId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(answerId).success) return { error: GENERIC_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_worksheet_answers").update({ submitted_at: null }).eq("id", answerId);
  log("reopenWorksheet", error);
  if (error) return { error: GENERIC_ERROR };
  refresh();
  return { ok: true, message: "Reopened: the person can change and submit the worksheet again. A finished lesson stays finished." };
}

/** What a document or worksheet block editor shows. */
export async function getDocumentEditor(documentId: string) {
  await requireAcademyManager();
  if (!guid.safeParse(documentId).success) return null;
  const detail = await loadDocumentDetail(await createClient(), documentId);
  if (!detail) return null;
  return { document: detail.document, versions: detail.versions, uses: detail.use.blocks.length + detail.use.modules.length };
}

/** Pick lists for the block editors. */
export async function getMediaOptions(kind: "video" | "download" | "worksheet"): Promise<{ id: string; title: string; detail: string }[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  if (kind === "video") {
    const { data } = await supabase.from("academy_videos").select("id, title, current_version_id").order("title").limit(500);
    return (data ?? []).map((v) => ({ id: v.id, title: v.title, detail: v.current_version_id ? "" : "no file yet" }));
  }
  const { data } = await supabase.from("academy_documents").select("id, title, current_version, worksheet_fields").eq("scope", "global").eq("kind", kind).order("title").limit(500);
  return (data ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    detail: kind === "worksheet" ? `${Array.isArray(d.worksheet_fields) ? d.worksheet_fields.length : 0} fields` : d.current_version ? `v${d.current_version}` : "no file yet",
  }));
}

// ---------------------------------------------------------------------------
// Images in the explanation block
// ---------------------------------------------------------------------------

/** A signed upload URL for an image; the editor inserts the returned src. */
export async function reserveImageUpload(input: { fileName: string; size: number; type: string }): Promise<(UploadReservation & { ok: true; src: string }) | { ok: false; error: string }> {
  await requireAcademyManager();
  const parsed = z.object({ fileName: z.string().min(1).max(300), size: z.number().int().positive(), type: z.string().max(100) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "This file cannot be uploaded." };
  const check = checkImageFile(parsed.data.fileName, parsed.data.size, parsed.data.type);
  if (!check.ok) return check;
  const path = imageFilePath(crypto.randomUUID(), parsed.data.fileName);
  const target = await reserve(FILES_BUCKET, path);
  if (!target) return { ok: false, error: "Uploading does not work right now. Try again later." };
  return { ok: true, bucket: FILES_BUCKET, ...target, contentType: parsed.data.type, version: 1, id: path, src: imageUrl(target.path) };
}
