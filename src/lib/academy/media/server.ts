import "server-only";
import type { AcademyDocumentRow, AcademyDocumentVersionRow, AcademyLessonBlockRow, AcademyVideoRow, AcademyVideoVersionRow } from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";
import { requireAcademyManager } from "@/lib/academy/auth";
import type { BlockStateLoader } from "@/lib/academy/blocks/server";
import { FILES_BUCKET, MEDIA_BUCKET, isNewDocument } from "@/lib/academy/media/files";
import type { DocumentState, VideoState, WorksheetState } from "@/lib/academy/media/state";
import { videoShowsTranscript } from "@/lib/academy/media/state";
import { transcriptionInfo } from "@/lib/academy/media/transcription";
import { normalizeFields } from "@/lib/academy/media/worksheet";
import { createClient } from "@/lib/supabase/server";

// Server half of the media area: block state loaders (registered in
// src/lib/academy/blocks/server.ts) and the data of the editor pages.

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** How long a playback link works; the player asks again on a reload. */
const PLAYBACK_SECONDS = 6 * 3600;

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Block state loaders (learner, and manager preview)
// ---------------------------------------------------------------------------

export const videoStateLoader: BlockStateLoader = async (blocks, ctx) => {
  const ids = [...new Set(blocks.map((b) => b.video_id).filter((v): v is string => Boolean(v)))];
  const states: Record<string, Json> = {};
  if (ids.length === 0) {
    for (const b of blocks) states[b.id] = { video: null, version: null, progress: null, showTranscript: true } satisfies VideoState;
    return states;
  }
  const [{ data: videos }, { data: progress }] = await Promise.all([
    ctx.supabase.from("academy_videos").select("id, title, current_version_id").in("id", ids),
    ctx.preview
      ? Promise.resolve({ data: [] as { video_id: string; position_seconds: number; percent: number; version_id: string | null; completed_at: string | null }[] })
      : ctx.supabase.from("academy_watch_progress").select("video_id, position_seconds, percent, version_id, completed_at").eq("profile_id", ctx.userId).in("video_id", ids),
  ]);
  const versionIds = (videos ?? []).map((v) => v.current_version_id).filter((v): v is string => Boolean(v));
  const { data: versions } = versionIds.length
    ? await ctx.supabase.from("academy_video_versions").select("*").in("id", versionIds)
    : { data: [] as AcademyVideoVersionRow[] };
  const versionById = new Map((versions ?? []).map((v) => [v.id, v]));
  const urls = new Map<string, string | null>();
  await Promise.all(
    (versions ?? []).map(async (v) => {
      const { data } = await ctx.supabase.storage.from(MEDIA_BUCKET).createSignedUrl(v.storage_path, PLAYBACK_SECONDS);
      urls.set(v.id, data?.signedUrl ?? null);
    }),
  );
  for (const block of blocks) {
    const video = (videos ?? []).find((v) => v.id === block.video_id);
    const version = video?.current_version_id ? versionById.get(video.current_version_id) : undefined;
    const own = (progress ?? []).find((p) => p.video_id === block.video_id);
    states[block.id] = {
      video: video ? { id: video.id, title: video.title } : null,
      version: version
        ? {
            id: version.id,
            number: version.version,
            durationSeconds: version.duration_seconds === null ? null : Number(version.duration_seconds),
            url: urls.get(version.id) ?? null,
            mimeType: version.mime_type,
            subtitles: { nl: Boolean(version.subtitles_nl_path), en: Boolean(version.subtitles_en_path) },
            transcript: version.transcript && version.transcript_status !== "pending" ? version.transcript : null,
          }
        : null,
      progress: own
        ? { positionSeconds: Number(own.position_seconds), percent: own.percent, versionId: own.version_id, completed: Boolean(own.completed_at) }
        : null,
      showTranscript: videoShowsTranscript(block.content),
    } satisfies VideoState;
  }
  return states;
};

export const documentStateLoader: BlockStateLoader = async (blocks, ctx) => {
  const ids = [...new Set(blocks.map((b) => b.document_id).filter((v): v is string => Boolean(v)))];
  const states: Record<string, Json> = {};
  const { data: documents } = ids.length ? await ctx.supabase.from("academy_documents").select("*").in("id", ids) : { data: [] as AcademyDocumentRow[] };
  const { data: versions } = ids.length
    ? await ctx.supabase.from("academy_document_versions").select("document_id, version, file_name, size_bytes, created_at").in("document_id", ids)
    : { data: [] as Pick<AcademyDocumentVersionRow, "document_id" | "version" | "file_name" | "size_bytes" | "created_at">[] };
  for (const block of blocks) {
    const d = (documents ?? []).find((x) => x.id === block.document_id);
    const current = d ? (versions ?? []).find((v) => v.document_id === d.id && v.version === d.current_version) : undefined;
    states[block.id] = {
      document: d
        ? {
            id: d.id,
            title: d.title,
            description: d.description,
            category: d.category,
            version: d.current_version,
            isNew: isNewDocument(d.new_until),
            updatedAt: current?.created_at ?? null,
            fileName: current?.file_name ?? null,
            sizeBytes: current?.size_bytes ?? null,
          }
        : null,
    } satisfies DocumentState;
  }
  return states;
};

export const worksheetStateLoader: BlockStateLoader = async (blocks, ctx) => {
  const ids = [...new Set(blocks.map((b) => b.document_id).filter((v): v is string => Boolean(v)))];
  const states: Record<string, Json> = {};
  const [{ data: documents }, { data: answers }] = await Promise.all([
    ids.length ? ctx.supabase.from("academy_documents").select("*").in("id", ids).eq("kind", "worksheet") : Promise.resolve({ data: [] as AcademyDocumentRow[] }),
    ids.length && !ctx.preview
      ? ctx.supabase.from("academy_worksheet_answers").select("document_id, answers, submitted_at").eq("profile_id", ctx.userId).in("document_id", ids)
      : Promise.resolve({ data: [] as { document_id: string; answers: Json; submitted_at: string | null }[] }),
  ]);
  for (const block of blocks) {
    const d = (documents ?? []).find((x) => x.id === block.document_id);
    const own = (answers ?? []).find((a) => a.document_id === block.document_id);
    states[block.id] = {
      document: d ? { id: d.id, title: d.title, description: d.description, fields: normalizeFields(d.worksheet_fields) } : null,
      answers: (own?.answers ?? {}) as WorksheetState["answers"],
      submittedAt: own?.submitted_at ?? null,
    } as unknown as Json;
  }
  return states;
};

// ---------------------------------------------------------------------------
// Editor data (managers)
// ---------------------------------------------------------------------------

export type VideoEditorData = {
  video: AcademyVideoRow;
  versions: (AcademyVideoVersionRow & { url: string | null })[];
  usedIn: { lessonId: string; lessonTitle: string }[];
  transcription: { provider: string | null; tooLarge: boolean; maxBytes: number | null };
};

export async function loadVideoEditor(supabase: Supabase, videoId: string): Promise<VideoEditorData | null> {
  const [{ data: video }, { data: versions }, { data: blocks }] = await Promise.all([
    supabase.from("academy_videos").select("*").eq("id", videoId).maybeSingle(),
    supabase.from("academy_video_versions").select("*").eq("video_id", videoId).order("version", { ascending: false }),
    supabase.from("academy_lesson_blocks").select("lesson_id").eq("video_id", videoId),
  ]);
  if (!video) return null;
  const lessonIds = [...new Set((blocks ?? []).map((b) => b.lesson_id))];
  const { data: lessons } = lessonIds.length ? await supabase.from("academy_lessons").select("id, title").in("id", lessonIds) : { data: [] };
  const current = (versions ?? []).find((v) => v.id === video.current_version_id);
  const withUrls = await Promise.all(
    (versions ?? []).map(async (v) => {
      if (v.id !== video.current_version_id) return { ...v, url: null };
      const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(v.storage_path, 3600);
      return { ...v, url: data?.signedUrl ?? null };
    }),
  );
  return {
    video,
    versions: withUrls,
    usedIn: (lessons ?? []).map((l) => ({ lessonId: l.id, lessonTitle: l.title })),
    transcription: transcriptionInfo(current?.size_bytes ?? null),
  };
}

export async function listVideoOptions(): Promise<{ id: string; title: string; hasFile: boolean }[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data, error } = await supabase.from("academy_videos").select("id, title, current_version_id").order("title").limit(500);
  if (error) fail("videos", error);
  return (data ?? []).map((v) => ({ id: v.id, title: v.title, hasFile: Boolean(v.current_version_id) }));
}

export type DocumentUse = { blocks: { lessonId: string; lessonTitle: string; type: string }[]; modules: { moduleId: string; moduleTitle: string; courseId: string; courseTitle: string }[] };

export type DocumentListItem = AcademyDocumentRow & { uses: number; answers: number };

export async function listDocuments(): Promise<DocumentListItem[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const [{ data: documents, error }, { data: blocks }, { data: modules }, { data: answers }] = await Promise.all([
    supabase.from("academy_documents").select("*").eq("scope", "global").order("title"),
    supabase.from("academy_lesson_blocks").select("document_id").not("document_id", "is", null),
    supabase.from("academy_modules").select("workbook_document_id").not("workbook_document_id", "is", null),
    supabase.from("academy_worksheet_answers").select("document_id").not("submitted_at", "is", null),
  ]);
  if (error) fail("documents", error);
  const count = (list: { [k: string]: string | null }[] | null, key: string, id: string) => (list ?? []).filter((r) => r[key] === id).length;
  return (documents ?? []).map((d) => ({
    ...d,
    uses: count(blocks, "document_id", d.id) + count(modules, "workbook_document_id", d.id),
    answers: count(answers, "document_id", d.id),
  }));
}

export async function listDocumentOptions(kind: "download" | "worksheet"): Promise<{ id: string; title: string; version: number }[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data, error } = await supabase.from("academy_documents").select("id, title, current_version").eq("scope", "global").eq("kind", kind).order("title");
  if (error) fail("documents", error);
  return (data ?? []).map((d) => ({ id: d.id, title: d.title, version: d.current_version }));
}

export type DocumentDetail = {
  document: AcademyDocumentRow;
  versions: AcademyDocumentVersionRow[];
  use: DocumentUse;
  modules: { id: string; title: string; courseTitle: string; workbookDocumentId: string | null }[];
};

export async function loadDocumentDetail(supabase: Supabase, documentId: string): Promise<DocumentDetail | null> {
  const [{ data: document }, { data: versions }, { data: blocks }, { data: modules }, { data: courses }] = await Promise.all([
    supabase.from("academy_documents").select("*").eq("id", documentId).maybeSingle(),
    supabase.from("academy_document_versions").select("*").eq("document_id", documentId).order("version", { ascending: false }),
    supabase.from("academy_lesson_blocks").select("lesson_id, type").eq("document_id", documentId),
    supabase.from("academy_modules").select("id, title, course_id, position, workbook_document_id").order("position"),
    supabase.from("academy_courses").select("id, title, position").order("position"),
  ]);
  if (!document) return null;
  const lessonIds = [...new Set((blocks ?? []).map((b) => b.lesson_id))];
  const { data: lessons } = lessonIds.length ? await supabase.from("academy_lessons").select("id, title").in("id", lessonIds) : { data: [] };
  const courseTitle = new Map((courses ?? []).map((c) => [c.id, c.title]));
  const courseOrder = new Map((courses ?? []).map((c, i) => [c.id, i]));
  const sortedModules = [...(modules ?? [])].sort((a, b) => (courseOrder.get(a.course_id) ?? 0) - (courseOrder.get(b.course_id) ?? 0) || a.position - b.position);
  return {
    document,
    versions: versions ?? [],
    use: {
      blocks: (blocks ?? []).map((b) => ({ lessonId: b.lesson_id, lessonTitle: (lessons ?? []).find((l) => l.id === b.lesson_id)?.title ?? "", type: b.type })),
      modules: sortedModules
        .filter((m) => m.workbook_document_id === documentId)
        .map((m) => ({ moduleId: m.id, moduleTitle: m.title, courseId: m.course_id, courseTitle: courseTitle.get(m.course_id) ?? "" })),
    },
    modules: sortedModules.map((m) => ({ id: m.id, title: m.title, courseTitle: courseTitle.get(m.course_id) ?? "", workbookDocumentId: m.workbook_document_id })),
  };
}

export async function getDocumentDetail(documentId: string): Promise<DocumentDetail | null> {
  await requireAcademyManager();
  return loadDocumentDetail(await createClient(), documentId);
}

export type WorksheetAnswerRow = {
  id: string;
  profileId: string;
  name: string;
  email: string;
  answers: Json;
  submittedAt: string | null;
  updatedAt: string;
};

async function names(supabase: Supabase, ids: string[]) {
  if (ids.length === 0) return new Map<string, { name: string; email: string }>();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
  return new Map((data ?? []).map((p) => [p.id, { name: p.full_name || p.email || "Unknown", email: p.email ?? "" }]));
}

/** Every answer to one worksheet (managers; RLS keeps everyone else to their own). */
export async function listWorksheetAnswers(documentId: string): Promise<WorksheetAnswerRow[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academy_worksheet_answers")
    .select("id, profile_id, answers, submitted_at, updated_at")
    .eq("document_id", documentId)
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (error) fail("answers", error);
  const who = await names(supabase, (data ?? []).map((a) => a.profile_id));
  return (data ?? []).map((a) => ({
    id: a.id,
    profileId: a.profile_id,
    name: who.get(a.profile_id)?.name ?? "Unknown",
    email: who.get(a.profile_id)?.email ?? "",
    answers: a.answers,
    submittedAt: a.submitted_at,
    updatedAt: a.updated_at,
  }));
}

/** One person's worksheets with their answers (people detail page). */
export async function listPersonWorksheets(profileId: string) {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academy_worksheet_answers")
    .select("id, document_id, answers, submitted_at, updated_at")
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false });
  if (error) fail("worksheets", error);
  const docIds = [...new Set((data ?? []).map((a) => a.document_id))];
  const { data: docs } = docIds.length ? await supabase.from("academy_documents").select("id, title, worksheet_fields").in("id", docIds) : { data: [] };
  return (data ?? []).map((a) => {
    const doc = (docs ?? []).find((d) => d.id === a.document_id);
    return { id: a.id, documentId: a.document_id, title: doc?.title ?? "Worksheet", fields: normalizeFields(doc?.worksheet_fields ?? []), answers: a.answers, submittedAt: a.submitted_at, updatedAt: a.updated_at };
  });
}

/** One person's certificates (people detail page). */
export async function listPersonCertificates(profileId: string) {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data, error } = await supabase.from("academy_certificates").select("id, course_id, number, full_name, issued_at").eq("profile_id", profileId).order("issued_at");
  if (error) fail("certificates", error);
  const ids = (data ?? []).map((c) => c.course_id);
  const { data: courses } = ids.length ? await supabase.from("academy_courses").select("id, title").in("id", ids) : { data: [] };
  return (data ?? []).map((c) => ({ ...c, courseTitle: (courses ?? []).find((x) => x.id === c.course_id)?.title ?? "Course" }));
}

/** A signed link that downloads a stored document version under its file name. */
export async function documentDownloadLink(supabase: Supabase, path: string, fileName: string, seconds = 60) {
  const { data } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(path, seconds, { download: fileName });
  return data?.signedUrl ?? null;
}

/** The lessons that hold the block (for revalidation and the language of a video). */
export async function lessonLanguageForVideo(supabase: Supabase, videoId: string): Promise<"nl" | "en" | null> {
  const { data: blocks } = await supabase.from("academy_lesson_blocks").select("lesson_id").eq("video_id", videoId).limit(1);
  const lessonId = blocks?.[0]?.lesson_id;
  if (!lessonId) return null;
  const { data: lesson } = await supabase.from("academy_lessons").select("language").eq("id", lessonId).maybeSingle();
  return lesson?.language ?? null;
}

export type { AcademyLessonBlockRow };
