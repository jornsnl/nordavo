import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { MEDIA_BUCKET } from "@/lib/academy/media/files";
import { transcriptionProvider } from "@/lib/academy/media/transcription";

type Db = SupabaseClient<Database>;

/**
 * Transcribe one video version with the configured provider and store the
 * result on the version (transcript, transcript_language, status ready or
 * failed with transcript_error). Used right after an upload or a click in
 * the editor (after(), as the manager) and by the academy-transcribe job
 * (service role) for versions still pending. Never throws.
 */
export async function runTranscription(db: Db, versionId: string): Promise<{ ok: boolean; error?: string }> {
  const provider = transcriptionProvider();
  if (!provider) return { ok: false, error: "No transcription provider is configured." };

  const { data: version } = await db.from("academy_video_versions").select("*").eq("id", versionId).maybeSingle();
  if (!version) return { ok: false, error: "Version not found." };

  const { data: block } = await db.from("academy_lesson_blocks").select("lesson_id").eq("video_id", version.video_id).limit(1).maybeSingle();
  const { data: lesson } = block ? await db.from("academy_lessons").select("language").eq("id", block.lesson_id).maybeSingle() : { data: null };

  const fail = async (error: string) => {
    await db.from("academy_video_versions").update({ transcript_status: "failed", transcript_error: error.slice(0, 2000) }).eq("id", versionId);
    console.error(`[academy] transcription of ${versionId} failed: ${error}`);
    return { ok: false, error };
  };

  if (provider.maxBytes && version.size_bytes && version.size_bytes > provider.maxBytes) {
    return fail(`The file is larger than ${Math.round(provider.maxBytes / 1024 / 1024)} MB, the limit of ${provider.label}. Upload a transcript or subtitles instead.`);
  }

  await db.from("academy_video_versions").update({ transcript_status: "pending", transcript_error: null }).eq("id", versionId);
  const { data: signed } = await db.storage.from(MEDIA_BUCKET).createSignedUrl(version.storage_path, 3 * 3600);
  if (!signed?.signedUrl) return fail("Could not make a link to the video file.");

  try {
    const result = await provider.transcribe({
      url: signed.signedUrl,
      fileName: version.file_name ?? "video.mp4",
      sizeBytes: version.size_bytes,
      mimeType: version.mime_type,
      language: version.transcript_language ?? lesson?.language ?? null,
    });
    if (!result.transcript) return fail(`${provider.label} returned no text.`);
    // Someone may have typed a transcript meanwhile: keep theirs.
    const { data: now } = await db.from("academy_video_versions").select("transcript_status").eq("id", versionId).maybeSingle();
    if (now?.transcript_status === "corrected") return { ok: true };
    const { error } = await db
      .from("academy_video_versions")
      .update({ transcript: result.transcript.slice(0, 500_000), transcript_status: "ready", transcript_language: result.language, transcript_error: null })
      .eq("id", versionId);
    if (error) return fail(error.message);
    return { ok: true };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
