"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { requireAcademyUser } from "@/lib/academy/auth";
import { isAcademyLocale, t } from "@/lib/academy/i18n";
import { isAcademyTimeZone } from "@/lib/academy/time";
import { createClient } from "@/lib/supabase/server";

// Learner actions of the Academy. Every one re-checks the user; the database
// checks the rest (the lesson must be open, own rows only).

const id = z.guid();

/** The player opened a lesson: records where the person is and refreshes its progress. */
export async function recordLessonOpen(lessonId: string, courseId: string | null): Promise<{ completed: boolean }> {
  const user = await requireAcademyUser();
  if (!id.safeParse(lessonId).success || (courseId && !id.safeParse(courseId).success)) return { completed: false };
  if (!user.member) return { completed: false }; // manager preview
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_open_lesson", { p_lesson_id: lessonId, p_course_id: courseId });
  if (error) {
    console.error("recordLessonOpen", error.code, error.message);
    return { completed: false };
  }
  const row = data as { completed_at?: string | null } | null;
  return { completed: Boolean(row?.completed_at) };
}

/** A block was read or opened (explanation, document). */
export async function recordBlockView(blockId: string): Promise<{ ok: boolean }> {
  const user = await requireAcademyUser();
  if (!id.safeParse(blockId).success || !user.member) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("academy_record_block_view", { p_block_id: blockId });
  if (error) {
    console.error("recordBlockView", error.code, error.message);
    return { ok: false };
  }
  return { ok: true };
}

const noteSchema = z
  .object({
    lessonId: z.guid().nullable(),
    moduleId: z.guid().nullable(),
    body: z.string().max(50_000),
  })
  .refine((v) => (v.lessonId === null) !== (v.moduleId === null));

export type SaveNoteResult = { ok: true; savedAt: string } | { ok: false };

/** Autosave of the notes block: own note per lesson or per module. */
export async function saveNote(input: { lessonId: string | null; moduleId: string | null; body: string }): Promise<SaveNoteResult> {
  const user = await requireAcademyUser();
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success || !user.member) return { ok: false };
  const { lessonId, moduleId, body } = parsed.data;
  const supabase = await createClient();

  let existing = supabase.from("academy_notes").select("id").eq("profile_id", user.id);
  existing = lessonId ? existing.eq("lesson_id", lessonId) : existing.eq("module_id", moduleId as string);
  const { data: found } = await existing.maybeSingle();

  const { data, error } = found
    ? await supabase.from("academy_notes").update({ body }).eq("id", found.id).select("updated_at").single()
    : await supabase
        .from("academy_notes")
        .insert({ profile_id: user.id, lesson_id: lessonId, module_id: moduleId, body })
        .select("updated_at")
        .single();
  if (error || !data) {
    console.error("saveNote", error?.code, error?.message);
    return { ok: false };
  }
  return { ok: true, savedAt: data.updated_at };
}

/** The language switch in the header. */
export async function switchLocale(locale: string): Promise<{ ok: boolean }> {
  const user = await requireAcademyUser();
  if (!isAcademyLocale(locale) || !user.member) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("academy_members").update({ locale }).eq("profile_id", user.id);
  if (error) {
    console.error("switchLocale", error.code, error.message);
    return { ok: false };
  }
  revalidatePath("/academy", "layout");
  return { ok: true };
}

const settingsSchema = z.object({
  locale: z.string().refine(isAcademyLocale),
  time_zone: z.string().refine(isAcademyTimeZone),
  digest_frequency: z.enum(["daily", "weekly", "off"]),
});

/** Language, time zone and mail summary. */
export async function saveAcademySettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAcademyUser();
  const parsed = settingsSchema.safeParse({
    locale: formData.get("locale"),
    time_zone: formData.get("time_zone"),
    digest_frequency: formData.get("digest_frequency"),
  });
  if (!parsed.success || !user.member) return { error: t(user.locale, "settings.failed") };
  const { locale, time_zone, digest_frequency } = parsed.data;
  const supabase = await createClient();
  const [member, profile] = await Promise.all([
    supabase
      .from("academy_members")
      .update({ locale: locale as "nl" | "en", digest_frequency })
      .eq("profile_id", user.id),
    supabase.from("profiles").update({ time_zone }).eq("id", user.id),
  ]);
  if (member.error || profile.error) {
    console.error("saveAcademySettings", member.error?.message, profile.error?.message);
    return { error: t(user.locale, "settings.failed") };
  }
  revalidatePath("/academy", "layout");
  return { ok: true, message: t(locale as "nl" | "en", "settings.saved") };
}
