import "server-only";
import type {
  AcademyCourseAccessRow,
  AcademyCourseRow,
  AcademyDocumentRow,
  AcademyGroupRow,
  AcademyLessonBlockRow,
  AcademyLessonRow,
  AcademyMemberRow,
  AcademyModuleRow,
  AcademyOpenModuleRow,
} from "@/lib/academy/database";
import type { ProfileRole } from "@/lib/database.types";
import { requireAcademyManager } from "@/lib/academy/auth";
import { createClient } from "@/lib/supabase/server";

// Nordavo side of the Academy (/dashboard/academy): content and people.
// Every function starts with requireAcademyManager(); RLS lets managers
// (admins and members with module academy) read and write all Academy tables.

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`Could not load ${what}: ${error?.message ?? "unknown error"}`);
}

export type CourseListItem = AcademyCourseRow & { moduleCount: number; lessonCount: number; peopleCount: number };

export async function listCoursesForAdmin(): Promise<CourseListItem[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const [courses, modules, links, access] = await Promise.all([
    supabase.from("academy_courses").select("*").order("position").order("title"),
    supabase.from("academy_modules").select("id, course_id"),
    supabase.from("academy_module_lessons").select("module_id, lesson_id"),
    supabase.from("academy_course_access").select("course_id, profile_id, group_id"),
  ]);
  if (courses.error) fail("courses", courses.error);
  const moduleCourse = new Map((modules.data ?? []).map((m) => [m.id, m.course_id]));
  return (courses.data ?? []).map((course) => {
    const lessonIds = new Set((links.data ?? []).filter((l) => moduleCourse.get(l.module_id) === course.id).map((l) => l.lesson_id));
    return {
      ...course,
      moduleCount: (modules.data ?? []).filter((m) => m.course_id === course.id).length,
      lessonCount: lessonIds.size,
      peopleCount: (access.data ?? []).filter((a) => a.course_id === course.id).length,
    };
  });
}

export type EditorLesson = AcademyLessonRow & { position: number; usedInModules: number };
export type EditorModule = AcademyModuleRow & { lessons: EditorLesson[]; requiredModuleIds: string[] };
export type AccessItem = AcademyCourseAccessRow & { label: string; email: string | null };

export type CourseEditor = {
  course: AcademyCourseRow;
  modules: EditorModule[];
  /** Modules of every course, for "requires module". */
  allModules: { id: string; title: string; courseTitle: string }[];
  access: AccessItem[];
  groups: AcademyGroupRow[];
};

export async function getCourseEditor(courseId: string): Promise<CourseEditor | null> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data: course, error } = await supabase.from("academy_courses").select("*").eq("id", courseId).maybeSingle();
  if (error) fail("the course", error);
  if (!course) return null;

  const [modules, allModules, courses, access, groups] = await Promise.all([
    supabase.from("academy_modules").select("*").eq("course_id", courseId).order("position").order("id"),
    supabase.from("academy_modules").select("id, title, course_id, position").order("position"),
    supabase.from("academy_courses").select("id, title"),
    supabase.from("academy_course_access").select("*").eq("course_id", courseId).order("created_at"),
    supabase.from("academy_groups").select("*").order("name"),
  ]);
  const moduleIds = (modules.data ?? []).map((m) => m.id);
  const [links, requirements] = await Promise.all([
    moduleIds.length
      ? supabase.from("academy_module_lessons").select("module_id, lesson_id, position").in("module_id", moduleIds).order("position")
      : Promise.resolve({ data: [] as { module_id: string; lesson_id: string; position: number }[] }),
    moduleIds.length
      ? supabase.from("academy_module_requirements").select("module_id, required_module_id").in("module_id", moduleIds)
      : Promise.resolve({ data: [] as { module_id: string; required_module_id: string }[] }),
  ]);
  const lessonIds = [...new Set((links.data ?? []).map((l) => l.lesson_id))];
  const [lessons, usage] = await Promise.all([
    lessonIds.length ? supabase.from("academy_lessons").select("*").in("id", lessonIds) : Promise.resolve({ data: [] as AcademyLessonRow[] }),
    lessonIds.length
      ? supabase.from("academy_module_lessons").select("lesson_id").in("lesson_id", lessonIds)
      : Promise.resolve({ data: [] as { lesson_id: string }[] }),
  ]);
  const lessonById = new Map((lessons.data ?? []).map((l) => [l.id, l]));
  const usedIn = new Map<string, number>();
  for (const u of usage.data ?? []) usedIn.set(u.lesson_id, (usedIn.get(u.lesson_id) ?? 0) + 1);

  // Names for the access list.
  const profileIds = (access.data ?? []).map((a) => a.profile_id).filter((id): id is string => Boolean(id));
  const { data: profiles } = profileIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", profileIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const groupById = new Map((groups.data ?? []).map((g) => [g.id, g]));
  const courseTitle = new Map((courses.data ?? []).map((c) => [c.id, c.title]));

  return {
    course,
    modules: (modules.data ?? []).map((m) => ({
      ...m,
      requiredModuleIds: (requirements.data ?? []).filter((r) => r.module_id === m.id).map((r) => r.required_module_id),
      lessons: (links.data ?? [])
        .filter((l) => l.module_id === m.id)
        .map((l) => {
          const lesson = lessonById.get(l.lesson_id);
          return lesson ? { ...lesson, position: l.position, usedInModules: usedIn.get(l.lesson_id) ?? 1 } : null;
        })
        .filter((l): l is EditorLesson => l !== null),
    })),
    allModules: (allModules.data ?? []).map((m) => ({ id: m.id, title: m.title, courseTitle: courseTitle.get(m.course_id) ?? "" })),
    access: (access.data ?? []).map((a) => {
      const person = a.profile_id ? profileById.get(a.profile_id) : null;
      const group = a.group_id ? groupById.get(a.group_id) : null;
      return {
        ...a,
        label: person ? person.full_name || person.email || "Unknown" : group ? `Group: ${group.name}` : "Unknown",
        email: person?.email ?? null,
      };
    }),
    groups: groups.data ?? [],
  };
}

export type LessonEditor = {
  lesson: AcademyLessonRow;
  blocks: AcademyLessonBlockRow[];
  usedIn: { moduleId: string; moduleTitle: string; courseId: string; courseTitle: string }[];
};

export async function getLessonEditor(lessonId: string): Promise<LessonEditor | null> {
  await requireAcademyManager();
  const supabase = await createClient();
  const [lesson, blocks, links] = await Promise.all([
    supabase.from("academy_lessons").select("*").eq("id", lessonId).maybeSingle(),
    supabase.from("academy_lesson_blocks").select("*").eq("lesson_id", lessonId).order("position").order("id"),
    supabase.from("academy_module_lessons").select("module_id").eq("lesson_id", lessonId),
  ]);
  if (lesson.error) fail("the lesson", lesson.error);
  if (!lesson.data) return null;
  const moduleIds = (links.data ?? []).map((l) => l.module_id);
  const { data: modules } = moduleIds.length
    ? await supabase.from("academy_modules").select("id, title, course_id").in("id", moduleIds)
    : { data: [] as { id: string; title: string; course_id: string }[] };
  const courseIds = [...new Set((modules ?? []).map((m) => m.course_id))];
  const { data: courses } = courseIds.length
    ? await supabase.from("academy_courses").select("id, title").in("id", courseIds)
    : { data: [] as { id: string; title: string }[] };
  const courseTitle = new Map((courses ?? []).map((c) => [c.id, c.title]));
  return {
    lesson: lesson.data,
    blocks: blocks.data ?? [],
    usedIn: (modules ?? []).map((m) => ({ moduleId: m.id, moduleTitle: m.title, courseId: m.course_id, courseTitle: courseTitle.get(m.course_id) ?? "" })),
  };
}

export type LibraryLesson = AcademyLessonRow & { usedIn: { moduleTitle: string; courseTitle: string }[] };

/** Every lesson, with where it is used: the library of reusable lessons. */
export async function listLibraryLessons(): Promise<LibraryLesson[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const [lessons, links, modules, courses] = await Promise.all([
    supabase.from("academy_lessons").select("*").order("title"),
    supabase.from("academy_module_lessons").select("module_id, lesson_id"),
    supabase.from("academy_modules").select("id, title, course_id"),
    supabase.from("academy_courses").select("id, title"),
  ]);
  if (lessons.error) fail("lessons", lessons.error);
  const moduleById = new Map((modules.data ?? []).map((m) => [m.id, m]));
  const courseTitle = new Map((courses.data ?? []).map((c) => [c.id, c.title]));
  return (lessons.data ?? []).map((lesson) => ({
    ...lesson,
    usedIn: (links.data ?? [])
      .filter((l) => l.lesson_id === lesson.id)
      .map((l) => {
        const mod = moduleById.get(l.module_id);
        return { moduleTitle: mod?.title ?? "", courseTitle: mod ? (courseTitle.get(mod.course_id) ?? "") : "" };
      }),
  }));
}

/** Global documents (reusable as block or module workbook). */
export async function listLibraryDocuments(): Promise<AcademyDocumentRow[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data, error } = await supabase.from("academy_documents").select("*").eq("scope", "global").order("title");
  if (error) fail("documents", error);
  return data ?? [];
}

/** The people list shows the most recent this many (URL length of the .in() lookups); search narrows it. */
export const PEOPLE_PAGE = 300;

export type PersonItem = AcademyMemberRow & {
  fullName: string | null;
  email: string | null;
  profileRole: ProfileRole;
  clientId: string | null;
  timeZone: string;
  courseIds: string[];
  groupIds: string[];
};

export async function listPeople(filter: { search?: string; role?: string; groupId?: string } = {}): Promise<PersonItem[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  let query = supabase.from("academy_members").select("*").order("created_at", { ascending: false }).limit(PEOPLE_PAGE);
  if (filter.role) query = query.eq("academy_role", filter.role as AcademyMemberRow["academy_role"]);
  const { data: members, error } = await query;
  if (error) fail("people", error);
  const search = filter.search?.trim().toLowerCase();
  return (await enrichMembers(members ?? []))
    .filter((p) => !search || `${p.fullName ?? ""} ${p.email ?? ""}`.toLowerCase().includes(search))
    .filter((p) => !filter.groupId || p.groupIds.includes(filter.groupId));
}

export type PersonDetail = {
  person: PersonItem;
  access: AcademyCourseAccessRow[];
  openModules: AcademyOpenModuleRow[];
  courses: (AcademyCourseRow & { modules: Pick<AcademyModuleRow, "id" | "title" | "position" | "in_default_access" | "status">[] })[];
  groups: AcademyGroupRow[];
};

export async function getPerson(profileId: string): Promise<PersonDetail | null> {
  await requireAcademyManager();
  const supabase = await createClient();
  const people = await listPeopleByIds([profileId]);
  const person = people[0];
  if (!person) return null;
  const [access, openModules, courses, modules, groups] = await Promise.all([
    supabase.from("academy_course_access").select("*").eq("profile_id", profileId),
    supabase.from("academy_open_modules").select("*").eq("profile_id", profileId),
    supabase.from("academy_courses").select("*").order("position"),
    supabase.from("academy_modules").select("id, title, position, in_default_access, status, course_id").order("position"),
    supabase.from("academy_groups").select("*").order("name"),
  ]);
  return {
    person,
    access: access.data ?? [],
    openModules: openModules.data ?? [],
    courses: (courses.data ?? []).map((c) => ({
      ...c,
      modules: (modules.data ?? []).filter((m) => m.course_id === c.id),
    })),
    groups: groups.data ?? [],
  };
}

async function listPeopleByIds(ids: string[]): Promise<PersonItem[]> {
  const supabase = await createClient();
  const { data: members } = await supabase.from("academy_members").select("*").in("profile_id", ids);
  return enrichMembers(members ?? []);
}

/** Names, mail, portal role, courses and groups next to the Academy rows. */
async function enrichMembers(members: AcademyMemberRow[]): Promise<PersonItem[]> {
  const ids = members.map((m) => m.profile_id);
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const [{ data: profiles }, { data: access }, { data: groups }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role, client_id, time_zone").in("id", ids),
    supabase.from("academy_course_access").select("course_id, profile_id").in("profile_id", ids),
    supabase.from("academy_group_members").select("group_id, profile_id").in("profile_id", ids),
  ]);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  return members.map((m) => {
    const p = byId.get(m.profile_id);
    return {
      ...m,
      fullName: p?.full_name ?? null,
      email: p?.email ?? null,
      profileRole: (p?.role ?? "external") as ProfileRole,
      clientId: p?.client_id ?? null,
      timeZone: p?.time_zone ?? "Europe/Amsterdam",
      courseIds: (access ?? []).filter((a) => a.profile_id === m.profile_id).map((a) => a.course_id),
      groupIds: (groups ?? []).filter((g) => g.profile_id === m.profile_id).map((g) => g.group_id),
    };
  });
}

export type GroupItem = AcademyGroupRow & { memberIds: string[]; courseIds: string[] };

export async function listGroups(): Promise<GroupItem[]> {
  await requireAcademyManager();
  const supabase = await createClient();
  const [groups, members, access] = await Promise.all([
    supabase.from("academy_groups").select("*").order("name"),
    supabase.from("academy_group_members").select("group_id, profile_id"),
    supabase.from("academy_course_access").select("group_id, course_id").not("group_id", "is", null),
  ]);
  if (groups.error) fail("groups", groups.error);
  return (groups.data ?? []).map((g) => ({
    ...g,
    memberIds: (members.data ?? []).filter((m) => m.group_id === g.id).map((m) => m.profile_id),
    courseIds: (access.data ?? []).filter((a) => a.group_id === g.id).map((a) => a.course_id),
  }));
}

/** Courses for pickers (add person, access). */
export async function listCourseOptions() {
  await requireAcademyManager();
  const supabase = await createClient();
  const [courses, modules] = await Promise.all([
    supabase.from("academy_courses").select("id, title, audience, status").order("position"),
    supabase.from("academy_modules").select("id, title, course_id, position, in_default_access").order("position"),
  ]);
  return (courses.data ?? []).map((c) => ({
    ...c,
    modules: (modules.data ?? []).filter((m) => m.course_id === c.id),
  }));
}

export type CourseOption = Awaited<ReturnType<typeof listCourseOptions>>[number];

export async function listClientOptions() {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data } = await supabase.rpc("academy_client_options");
  return (data ?? []) as { id: string; name: string }[];
}

export async function listCandidateOptions(search: string | null) {
  await requireAcademyManager();
  const supabase = await createClient();
  const { data } = await supabase.rpc("academy_candidate_options", { p_search: search });
  return (data ?? []) as { id: string; full_name: string; email: string | null; top_candidate: boolean }[];
}
