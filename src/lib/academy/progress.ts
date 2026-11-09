// The learner's view of a course, built from academy_course_outline() rows:
// modules with their state and lessons, course progress, "continue where you
// left off", Previous and Next in the lesson player, and the list of what a
// lesson still needs. The rules themselves (unlocking, completion) live in
// SQL (academy_module_state, academy_block_done_*); this only presents them.
// Pure, tested in tests/academy-progress.test.ts.

import type { AcademyBlockType, AcademyLocale, AcademyModuleState, AcademyOutlineRow, AcademyStatus } from "@/lib/academy/database";
import type { Json } from "@/lib/database.types";
import { blockTypes, normalizeCompletion } from "@/lib/academy/blocks/types";
import { t } from "@/lib/academy/i18n";
import { formatAcademyDate } from "@/lib/academy/time";

export type OutlineLesson = {
  id: string;
  title: string;
  summary: string | null;
  status: AcademyStatus;
  durationMinutes: number | null;
  startedAt: string | null;
  lastViewedAt: string | null;
  percent: number;
  completedAt: string | null;
};

export type OutlineModule = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  status: AcademyStatus;
  state: AcademyModuleState;
  releaseDate: string | null;
  isCore: boolean;
  requiredBeforeStart: boolean;
  workbookDocumentId: string | null;
  lessons: OutlineLesson[];
};

/** Modules and lessons in order, from the flat outline rows. */
export function buildOutline(rows: readonly AcademyOutlineRow[]): OutlineModule[] {
  const modules = new Map<string, OutlineModule>();
  for (const row of rows) {
    let mod = modules.get(row.module_id);
    if (!mod) {
      mod = {
        id: row.module_id,
        title: row.module_title,
        description: row.module_description,
        position: row.module_position,
        status: row.module_status,
        state: row.module_state,
        releaseDate: row.release_date,
        isCore: row.is_core,
        requiredBeforeStart: row.required_before_start,
        workbookDocumentId: row.workbook_document_id,
        lessons: [],
      };
      modules.set(row.module_id, mod);
    }
    if (row.lesson_id && !mod.lessons.some((l) => l.id === row.lesson_id)) {
      mod.lessons.push({
        id: row.lesson_id,
        title: row.lesson_title ?? "",
        summary: row.lesson_summary,
        status: row.lesson_status ?? "published",
        durationMinutes: row.duration_minutes,
        startedAt: row.started_at,
        lastViewedAt: row.last_viewed_at,
        percent: row.completed_at ? 100 : (row.percent ?? 0),
        completedAt: row.completed_at,
      });
    }
  }
  return [...modules.values()];
}

export function isOpenState(state: AcademyModuleState | null | undefined): boolean {
  return state === "open" || state === "completed";
}

/** Lessons done over the lessons in the person's scope (a lesson used twice counts once). */
export function courseProgress(modules: readonly OutlineModule[]) {
  const lessons = new Map<string, boolean>();
  for (const mod of modules) {
    if (mod.state === "locked_scope") continue;
    for (const lesson of mod.lessons) {
      lessons.set(lesson.id, (lessons.get(lesson.id) ?? false) || Boolean(lesson.completedAt));
    }
  }
  const total = lessons.size;
  const done = [...lessons.values()].filter(Boolean).length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export type LessonStop = { moduleId: string; lessonId: string; title: string; open: boolean; completed: boolean };

/** Every lesson of the course in reading order, with whether it can be opened. */
export function lessonStops(modules: readonly OutlineModule[]): LessonStop[] {
  return modules.flatMap((mod) =>
    mod.lessons.map((lesson) => ({
      moduleId: mod.id,
      lessonId: lesson.id,
      title: lesson.title,
      open: isOpenState(mod.state),
      completed: Boolean(lesson.completedAt),
    })),
  );
}

/**
 * Previous and Next for the player: the nearest open lessons before and
 * after this one. moduleId picks the right spot when a lesson is in two modules.
 */
export function neighbours(modules: readonly OutlineModule[], lessonId: string, moduleId?: string | null) {
  const stops = lessonStops(modules);
  let index = stops.findIndex((s) => s.lessonId === lessonId && (!moduleId || s.moduleId === moduleId));
  if (index === -1) index = stops.findIndex((s) => s.lessonId === lessonId);
  if (index === -1) return { previous: null, next: null };
  const previous = [...stops.slice(0, index)].reverse().find((s) => s.open) ?? null;
  const next = stops.slice(index + 1).find((s) => s.open) ?? null;
  return { previous, next };
}

/** The module a lesson sits in (the given one if it holds the lesson, else the first). */
export function moduleOfLesson(modules: readonly OutlineModule[], lessonId: string, moduleId?: string | null) {
  return (
    modules.find((m) => m.id === moduleId && m.lessons.some((l) => l.id === lessonId)) ??
    modules.find((m) => m.lessons.some((l) => l.id === lessonId)) ??
    null
  );
}

/**
 * "Continue where you left off": the most recently viewed open lesson that
 * is not done, else the first open lesson that is not done, else null.
 */
export function continueTarget(modules: readonly OutlineModule[]): LessonStop | null {
  const stops = lessonStops(modules).filter((s) => s.open && !s.completed);
  if (stops.length === 0) return null;
  let best: { stop: LessonStop; at: string } | null = null;
  for (const mod of modules) {
    if (!isOpenState(mod.state)) continue;
    for (const lesson of mod.lessons) {
      if (lesson.completedAt || !lesson.lastViewedAt) continue;
      if (!best || lesson.lastViewedAt > best.at) {
        const stop = stops.find((s) => s.lessonId === lesson.id && s.moduleId === mod.id);
        if (stop) best = { stop, at: lesson.lastViewedAt };
      }
    }
  }
  return best?.stop ?? stops[0];
}

/** Why a module is closed (or that it is open), in the user's language and zone. */
export function moduleStateLabel(mod: Pick<OutlineModule, "state" | "releaseDate">, locale: AcademyLocale, zone: string): string {
  if (mod.state === "locked_release") {
    return mod.releaseDate
      ? t(locale, "state.locked_release", { date: formatAcademyDate(mod.releaseDate, locale, zone) })
      : t(locale, "state.locked_release_unknown");
  }
  return t(locale, `state.${mod.state}`);
}

export type BlockForRequirements = {
  id: string;
  type: AcademyBlockType;
  required: boolean;
  completion: Json;
};

/** What a lesson still needs: one line per required block, done or not. */
export function lessonRequirements(
  blocks: readonly BlockForRequirements[],
  done: ReadonlyMap<string, boolean> | Record<string, boolean>,
  locale: AcademyLocale,
) {
  const isDone = (id: string) => (done instanceof Map ? Boolean(done.get(id)) : Boolean((done as Record<string, boolean>)[id]));
  return blocks
    .filter((b) => b.required)
    .map((b) => ({
      blockId: b.id,
      type: b.type,
      text: blockTypes[b.type].requirement(normalizeCompletion(b.type, b.completion), locale),
      done: isDone(b.id),
    }));
}
