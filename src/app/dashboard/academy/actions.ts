"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, GENERIC_ERROR, fieldErrorsFrom, formValues } from "@/lib/action-state";
import type { AcademyBlockType, AcademyStatus } from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";
import { requireAcademyManager } from "@/lib/academy/auth";
import { blockTypes, isBlockType, normalizeCompletion } from "@/lib/academy/blocks/types";
import { sanitizeBlockContent } from "@/lib/academy/blocks/server";
import { createClient } from "@/lib/supabase/server";

// The Academy editor (/dashboard/academy): courses, modules, lessons, blocks
// and course access. Managers only (requireAcademyManager, and RLS through
// academy_is_manager()).

const BASE = "/dashboard/academy";
const guid = z.guid();
const status = z.enum(["draft", "published"]);

function log(where: string, error: { code?: string; message: string } | null) {
  if (error) console.error(`academy ${where}`, error.code, error.message);
}

function refreshEditor() {
  revalidatePath(BASE, "layout");
  revalidatePath("/academy", "layout");
}

const checkbox = (formData: FormData, name: string) => formData.get(name) === "on" || formData.get(name) === "true";

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

const courseSchema = z.object({
  title: z.string({ error: "Enter a title" }).min(1, { error: "Enter a title" }).max(200, { error: "At most 200 characters" }),
  description: z.string().max(5000, { error: "At most 5,000 characters" }).optional(),
  language: z.enum(["nl", "en"], { error: "Choose a language" }),
  audience: z.enum(["client", "developer"], { error: "Choose who it is for" }),
});

export async function createCourse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  const parsed = courseSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { data: last } = await supabase.from("academy_courses").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase
    .from("academy_courses")
    .insert({ ...parsed.data, description: parsed.data.description ?? null, position: (last?.position ?? 0) + 1 })
    .select("id")
    .single();
  log("createCourse", error);
  if (error || !data) return { error: GENERIC_ERROR };
  refreshEditor();
  redirect(`${BASE}/courses/${data.id}`);
}

export async function updateCourse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  const id = formData.get("id");
  const parsed = courseSchema.safeParse(formValues(formData));
  if (!guid.safeParse(id).success) return { error: "Course not found." };
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_courses")
    .update({ ...parsed.data, description: parsed.data.description ?? null })
    .eq("id", id as string);
  log("updateCourse", error);
  if (error) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true, message: "Saved." };
}

export async function setCourseStatus(courseId: string, next: AcademyStatus): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(courseId).success || !status.safeParse(next).success) return { error: "Course not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_courses").update({ status: next }).eq("id", courseId);
  log("setCourseStatus", error);
  if (error) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true, message: next === "published" ? "Published: people with access see the course." : "Back to draft: only Nordavo sees the course." };
}

/** Only draft courses can be deleted; their lessons stay in the library. */
export async function deleteCourse(courseId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(courseId).success) return { error: "Course not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("academy_courses").delete().eq("id", courseId).eq("status", "draft").select("id");
  log("deleteCourse", error);
  if (error) return { error: GENERIC_ERROR };
  if (!data?.length) return { error: "Put the course back to draft first." };
  refreshEditor();
  redirect(BASE);
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export async function createModule(courseId: string, title: string): Promise<ActionState> {
  await requireAcademyManager();
  const clean = title.trim().slice(0, 200);
  if (!guid.safeParse(courseId).success || !clean) return { error: "Enter a title for the module." };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("academy_modules")
    .select("position")
    .eq("course_id", courseId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("academy_modules").insert({ course_id: courseId, title: clean, position: (last?.position ?? 0) + 1 });
  log("createModule", error);
  if (error) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true, message: "Module added as draft." };
}

const moduleSchema = z.object({
  id: z.guid({ error: "Module not found" }),
  title: z.string({ error: "Enter a title" }).min(1, { error: "Enter a title" }).max(200, { error: "At most 200 characters" }),
  description: z.string().max(5000, { error: "At most 5,000 characters" }).optional(),
  release_offset_days: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(v)))
    .pipe(z.number({ error: "Enter a number of days" }).int({ error: "Whole days" }).min(0, { error: "At least 0" }).max(3650, { error: "At most 3,650" }).nullable()),
});

/** Module settings: title, release rule (order, required modules, days after start), scope and flags. */
export async function updateModule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  const parsed = moduleSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const { id, title, description, release_offset_days } = parsed.data;
  const required = formData
    .getAll("required_module_ids")
    .filter((v): v is string => typeof v === "string" && guid.safeParse(v).success && v !== id);
  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_modules")
    .update({
      title,
      description: description ?? null,
      release_offset_days,
      requires_previous: checkbox(formData, "requires_previous"),
      in_default_access: checkbox(formData, "in_default_access"),
      is_core: checkbox(formData, "is_core"),
      required_before_start: checkbox(formData, "required_before_start"),
    })
    .eq("id", id);
  log("updateModule", error);
  if (error) return { error: GENERIC_ERROR };

  const { error: delError } = await supabase.from("academy_module_requirements").delete().eq("module_id", id);
  log("updateModule requirements", delError);
  if (required.length > 0) {
    const { error: insError } = await supabase
      .from("academy_module_requirements")
      .insert(required.map((required_module_id) => ({ module_id: id, required_module_id })));
    log("updateModule requirements", insError);
    if (insError) return { error: GENERIC_ERROR };
  }
  refreshEditor();
  return { ok: true, message: "Saved." };
}

export async function setModuleStatus(moduleId: string, next: AcademyStatus): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(moduleId).success || !status.safeParse(next).success) return { error: "Module not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_modules").update({ status: next }).eq("id", moduleId);
  log("setModuleStatus", error);
  if (error) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true };
}

/** Only draft modules can be deleted; their lessons stay in the library. */
export async function deleteModule(moduleId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(moduleId).success) return { error: "Module not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("academy_modules").delete().eq("id", moduleId).eq("status", "draft").select("id");
  log("deleteModule", error);
  if (error) return { error: GENERIC_ERROR };
  if (!data?.length) return { error: "Put the module back to draft first." };
  refreshEditor();
  return { ok: true };
}

export async function duplicateModule(moduleId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(moduleId).success) return { error: "Module not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("academy_duplicate_module", { p_module_id: moduleId });
  log("duplicateModule", error);
  if (error) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true, message: "Copied as draft at the end of the course, with copies of its lessons." };
}

/** Positions 1..n in the given order (drag and drop). */
async function reorder(table: "academy_modules" | "academy_lesson_blocks", ids: string[], scope: { column: "course_id" | "lesson_id"; value: string }) {
  const supabase = await createClient();
  const results = await Promise.all(
    ids.map((id, index) =>
      table === "academy_modules"
        ? supabase.from("academy_modules").update({ position: index + 1 }).eq("id", id).eq("course_id", scope.value)
        : supabase.from("academy_lesson_blocks").update({ position: index + 1 }).eq("id", id).eq("lesson_id", scope.value),
    ),
  );
  const failed = results.find((r) => r.error);
  log(`reorder ${table}`, failed?.error ?? null);
  return !failed;
}

const idList = z.array(z.guid()).max(500);

export async function reorderModules(courseId: string, ids: string[]): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(courseId).success || !idList.safeParse(ids).success) return { error: "Modules not found." };
  if (!(await reorder("academy_modules", ids, { column: "course_id", value: courseId }))) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

async function nextLessonPosition(moduleId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("academy_module_lessons")
    .select("position")
    .eq("module_id", moduleId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.position ?? 0) + 1;
}

/** A new lesson at the end of a module, opened in the lesson editor. */
export async function createLesson(moduleId: string, title: string, language: "nl" | "en"): Promise<ActionState> {
  await requireAcademyManager();
  const clean = title.trim().slice(0, 300);
  if (!guid.safeParse(moduleId).success || !clean || !["nl", "en"].includes(language)) return { error: "Enter a title for the lesson." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("academy_lessons").insert({ title: clean, language }).select("id").single();
  log("createLesson", error);
  if (error || !data) return { error: GENERIC_ERROR };
  const { error: linkError } = await supabase
    .from("academy_module_lessons")
    .insert({ module_id: moduleId, lesson_id: data.id, position: await nextLessonPosition(moduleId) });
  log("createLesson link", linkError);
  if (linkError) return { error: GENERIC_ERROR };
  refreshEditor();
  redirect(`${BASE}/lessons/${data.id}`);
}

/** Reuse: link an existing lesson into a module (edits apply everywhere). */
export async function linkLesson(moduleId: string, lessonId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(moduleId).success || !guid.safeParse(lessonId).success) return { error: "Lesson not found." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_module_lessons")
    .insert({ module_id: moduleId, lesson_id: lessonId, position: await nextLessonPosition(moduleId) });
  log("linkLesson", error);
  if (error) return { error: error.code === "23505" ? "This lesson is already in the module." : GENERIC_ERROR };
  refreshEditor();
  return { ok: true, message: "Lesson added. It is the same lesson: edits show everywhere it is used." };
}

/** Take a lesson out of a module; the lesson and its progress stay. */
export async function unlinkLesson(moduleId: string, lessonId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(moduleId).success || !guid.safeParse(lessonId).success) return { error: "Lesson not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_module_lessons").delete().eq("module_id", moduleId).eq("lesson_id", lessonId);
  log("unlinkLesson", error);
  if (error) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true };
}

export async function reorderLessons(moduleId: string, lessonIds: string[]): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(moduleId).success || !idList.safeParse(lessonIds).success) return { error: "Lessons not found." };
  const supabase = await createClient();
  const results = await Promise.all(
    lessonIds.map((lessonId, index) =>
      supabase.from("academy_module_lessons").update({ position: index + 1 }).eq("module_id", moduleId).eq("lesson_id", lessonId),
    ),
  );
  const failed = results.find((r) => r.error);
  log("reorderLessons", failed?.error ?? null);
  if (failed) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true };
}

/** Deep copy (blocks, tasks, check questions), next to the original when a module is given. */
export async function duplicateLesson(lessonId: string, moduleId: string | null): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(lessonId).success || (moduleId && !guid.safeParse(moduleId).success)) return { error: "Lesson not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_duplicate_lesson", { p_lesson_id: lessonId, p_module_id: moduleId });
  log("duplicateLesson", error);
  if (error || !data) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true, message: "Copied as draft.", link: { href: `${BASE}/lessons/${data}`, label: "Open the copy" } };
}

const lessonSchema = z.object({
  id: z.guid({ error: "Lesson not found" }),
  title: z.string({ error: "Enter a title" }).min(1, { error: "Enter a title" }).max(300, { error: "At most 300 characters" }),
  summary: z.string().max(2000, { error: "At most 2,000 characters" }).optional(),
  language: z.enum(["nl", "en"], { error: "Choose a language" }),
  duration_minutes: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(v)))
    .pipe(z.number({ error: "Enter minutes" }).int({ error: "Whole minutes" }).min(0).max(600, { error: "At most 600" }).nullable()),
});

export async function updateLesson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  const parsed = lessonSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_lessons")
    .update({ ...values, summary: values.summary ?? null })
    .eq("id", id);
  log("updateLesson", error);
  if (error) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true, message: "Saved." };
}

export async function setLessonStatus(lessonId: string, next: AcademyStatus): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(lessonId).success || !status.safeParse(next).success) return { error: "Lesson not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_lessons").update({ status: next }).eq("id", lessonId);
  log("setLessonStatus", error);
  if (error) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true, message: next === "published" ? "Published." : "Back to draft: learners no longer see this lesson." };
}

/** Only draft lessons can be deleted (progress on published lessons is kept). */
export async function deleteLesson(lessonId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(lessonId).success) return { error: "Lesson not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("academy_lessons").delete().eq("id", lessonId).eq("status", "draft").select("id");
  log("deleteLesson", error);
  if (error) return { error: GENERIC_ERROR };
  if (!data?.length) return { error: "Put the lesson back to draft first." };
  refreshEditor();
  redirect(`${BASE}/library`);
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export async function addBlock(lessonId: string, type: AcademyBlockType): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(lessonId).success || !isBlockType(type)) return { error: "Block type not found." };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("academy_lesson_blocks")
    .select("position")
    .eq("lesson_id", lessonId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const meta = blockTypes[type];
  const completion: Record<string, Json> = {};
  for (const field of meta.completionFields) completion[field.key] = field.defaultValue;
  const { error } = await supabase.from("academy_lesson_blocks").insert({
    lesson_id: lessonId,
    type,
    position: (last?.position ?? 0) + 1,
    content: meta.defaultContent as Json,
    required: meta.defaultRequired,
    completion,
  });
  log("addBlock", error);
  if (error) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true };
}

const blockSchema = z.object({
  id: z.guid(),
  title: z.string().max(300).nullable(),
  required: z.boolean(),
  completion: z.record(z.string(), z.unknown()),
  content: z.record(z.string(), z.unknown()),
});

/** The block card's Save: title, required, completion rule and content (sanitized per type). */
export async function updateBlock(input: {
  id: string;
  title: string | null;
  required: boolean;
  completion: Record<string, unknown>;
  content: Record<string, unknown>;
}): Promise<ActionState> {
  await requireAcademyManager();
  const parsed = blockSchema.safeParse(input);
  if (!parsed.success) return { error: "This block could not be saved." };
  const supabase = await createClient();
  const { data: block } = await supabase.from("academy_lesson_blocks").select("type").eq("id", parsed.data.id).maybeSingle();
  if (!block) return { error: "Block not found." };
  let content;
  try {
    content = sanitizeBlockContent(block.type, parsed.data.content as Json);
  } catch (error) {
    return { error: error instanceof Error ? error.message : GENERIC_ERROR };
  }
  const { error } = await supabase
    .from("academy_lesson_blocks")
    .update({
      title: parsed.data.title?.trim() ? parsed.data.title.trim() : null,
      required: parsed.data.required,
      completion: normalizeCompletion(block.type, parsed.data.completion as Json),
      content: content as Json,
    })
    .eq("id", parsed.data.id);
  log("updateBlock", error);
  if (error) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true, message: "Saved." };
}

export async function deleteBlock(blockId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(blockId).success) return { error: "Block not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_lesson_blocks").delete().eq("id", blockId);
  log("deleteBlock", error);
  if (error) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true };
}

export async function reorderBlocks(lessonId: string, ids: string[]): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(lessonId).success || !idList.safeParse(ids).success) return { error: "Blocks not found." };
  if (!(await reorder("academy_lesson_blocks", ids, { column: "lesson_id", value: lessonId }))) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

const accessSchema = z
  .object({
    course_id: z.guid({ error: "Course not found" }),
    target: z.string({ error: "Choose a person or group" }).regex(/^(person|group):[0-9a-f-]{36}$/i, { error: "Choose a person or group" }),
    scope: z.enum(["all", "default"], { error: "Choose what is open" }),
  });

/** Course access for a person or a group (scope all, or default modules plus per-person open modules). */
export async function grantCourseAccess(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  const parsed = accessSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const [kind, targetId] = parsed.data.target.split(":");
  const supabase = await createClient();
  const { error } = await supabase.from("academy_course_access").insert({
    course_id: parsed.data.course_id,
    profile_id: kind === "person" ? targetId : null,
    group_id: kind === "group" ? targetId : null,
    scope: parsed.data.scope,
  });
  log("grantCourseAccess", error);
  if (error) return { error: error.code === "23505" ? "Already has access to this course." : GENERIC_ERROR };
  refreshEditor();
  return { ok: true, message: "Access given." };
}

export async function setAccessScope(accessId: string, scope: "all" | "default"): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(accessId).success || !["all", "default"].includes(scope)) return { error: "Access not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_course_access").update({ scope }).eq("id", accessId);
  log("setAccessScope", error);
  if (error) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true };
}

/** Access ends; progress is kept and counts again if access returns. */
export async function revokeCourseAccess(accessId: string): Promise<ActionState> {
  await requireAcademyManager();
  if (!guid.safeParse(accessId).success) return { error: "Access not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_course_access").delete().eq("id", accessId);
  log("revokeCourseAccess", error);
  if (error) return { error: GENERIC_ERROR };
  refreshEditor();
  return { ok: true };
}

/**
 * Per-person open modules of one course: the ticked modules are open on top
 * of the default modules; "force" opens a module right away (past order,
 * requirements and release).
 */
export async function setOpenModules(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAcademyManager();
  const profileId = formData.get("profile_id");
  const courseId = formData.get("course_id");
  if (!guid.safeParse(profileId).success || !guid.safeParse(courseId).success) return { error: "Person not found." };
  const open = formData.getAll("open").filter((v): v is string => typeof v === "string" && guid.safeParse(v).success);
  const force = new Set(formData.getAll("force").filter((v): v is string => typeof v === "string"));
  const supabase = await createClient();
  const { data: modules } = await supabase.from("academy_modules").select("id").eq("course_id", courseId as string);
  const courseModuleIds = (modules ?? []).map((m) => m.id);
  if (courseModuleIds.length > 0) {
    const { error } = await supabase.from("academy_open_modules").delete().eq("profile_id", profileId as string).in("module_id", courseModuleIds);
    log("setOpenModules delete", error);
    if (error) return { error: GENERIC_ERROR };
  }
  const rows = open
    .filter((id) => courseModuleIds.includes(id))
    .map((module_id) => ({ profile_id: profileId as string, module_id, force: force.has(module_id) }));
  if (rows.length > 0) {
    const { error } = await supabase.from("academy_open_modules").insert(rows);
    log("setOpenModules insert", error);
    if (error) return { error: GENERIC_ERROR };
  }
  refreshEditor();
  return { ok: true, message: "Saved. Completed progress always stays." };
}
