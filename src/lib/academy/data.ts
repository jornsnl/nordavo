import "server-only";
import type {
  AcademyCourseRow,
  AcademyLessonBlockRow,
  AcademyLessonRow,
  AcademyMyCourseRow,
  AcademyMyPlacementRow,
  AcademyOutlineRow,
  AcademyPeopleProgressRow,
} from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";
import { type AcademyUser, requireAcademyUser } from "@/lib/academy/auth";
import { loadBlockStates } from "@/lib/academy/blocks/server";
import { type OutlineModule, buildOutline, moduleOfLesson } from "@/lib/academy/progress";
import { createClient } from "@/lib/supabase/server";

// Learner side of the Academy (/academy). Every read goes through RLS or the
// academy_* security definer functions, as the signed-in user; managers get
// a preview of everything (drafts too) without progress being recorded.

export async function listMyCourses(): Promise<AcademyMyCourseRow[]> {
  await requireAcademyUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_my_courses");
  if (error) throw new Error(`Could not load courses: ${error.message}`);
  return (data ?? []) as AcademyMyCourseRow[];
}

export async function getCourse(courseId: string): Promise<AcademyCourseRow | null> {
  await requireAcademyUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("academy_courses").select("*").eq("id", courseId).maybeSingle();
  if (error) throw new Error(`Could not load the course: ${error.message}`);
  return data;
}

export async function getCourseOutline(courseId: string): Promise<OutlineModule[]> {
  await requireAcademyUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_course_outline", { p_course_id: courseId });
  if (error) throw new Error(`Could not load the course outline: ${error.message}`);
  return buildOutline((data ?? []) as AcademyOutlineRow[]);
}

export type LessonView = {
  lesson: AcademyLessonRow;
  blocks: AcademyLessonBlockRow[];
  done: Record<string, boolean>;
  states: Record<string, Json>;
  moduleId: string | null;
  /** Manager preview: nothing is recorded. */
  preview: boolean;
};

/**
 * A lesson for the player, in the context of a course. Null when the lesson
 * is not in this course or not visible. Blocks are empty when the lesson is
 * locked (RLS on academy_lesson_blocks).
 */
export async function getLessonView(
  user: AcademyUser,
  courseId: string,
  lessonId: string,
  outline: OutlineModule[],
  moduleId?: string | null,
): Promise<LessonView | null> {
  const mod = moduleOfLesson(outline, lessonId, moduleId);
  if (!mod) return null;
  const supabase = await createClient();
  const [{ data: lesson }, { data: blocks }, { data: state }] = await Promise.all([
    supabase.from("academy_lessons").select("*").eq("id", lessonId).maybeSingle(),
    supabase.from("academy_lesson_blocks").select("*").eq("lesson_id", lessonId).order("position").order("id"),
    supabase.rpc("academy_lesson_blocks_state", { p_lesson_id: lessonId }),
  ]);
  if (!lesson) return null;
  const preview = user.isManager && !user.member;
  const list = (blocks ?? []) as AcademyLessonBlockRow[];
  const done: Record<string, boolean> = {};
  for (const row of (state ?? []) as { block_id: string; done: boolean }[]) done[row.block_id] = row.done;
  const states = await loadBlockStates(list, { supabase, userId: user.id, lessonId, moduleId: mod.id, preview });
  return { lesson, blocks: list, done, states, moduleId: mod.id, preview };
}

/** Own placements, without money (academy_my_placements). */
export async function listMyPlacements(): Promise<AcademyMyPlacementRow[]> {
  await requireAcademyUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_my_placements");
  if (error) throw new Error(`Could not load placements: ${error.message}`);
  return (data ?? []) as AcademyMyPlacementRow[];
}

/** Unread notifications for the bell in the header. */
export async function countUnreadNotifications(): Promise<number> {
  const user = await requireAcademyUser();
  const supabase = await createClient();
  const { count } = await supabase
    .from("academy_notifications")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", user.id)
    .is("read_at", null);
  return count ?? 0;
}

/** Progress and scores of the people the user may follow (academy_people_progress; never answers). */
export async function listPeopleProgress(): Promise<AcademyPeopleProgressRow[]> {
  await requireAcademyUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_people_progress");
  if (error) throw new Error(`Could not load progress: ${error.message}`);
  return (data ?? []) as AcademyPeopleProgressRow[];
}
