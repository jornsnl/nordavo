import Link from "next/link";
import type { AcademyLocale } from "@/lib/academy/database";
import { t } from "@/lib/academy/i18n";
import { type OutlineModule, courseProgress, isOpenState, moduleStateLabel } from "@/lib/academy/progress";
import { LessonMark, ProgressBar } from "@/components/academy/ui";

/** Lessons of the course on the left: checks, locks, the current lesson highlighted. */
export function LessonSidebar({
  courseId,
  courseTitle,
  modules,
  currentLessonId,
  currentModuleId,
  locale,
  timeZone,
}: {
  courseId: string;
  courseTitle: string;
  modules: OutlineModule[];
  currentLessonId: string;
  currentModuleId: string | null;
  locale: AcademyLocale;
  timeZone: string;
}) {
  const progress = courseProgress(modules);
  return (
    <nav aria-label={t(locale, "lesson.lessonsInCourse")} className="space-y-4">
      <div className="space-y-2">
        <Link href={`/academy/courses/${courseId}`} className="font-display text-sm font-semibold text-academy-blue-900 hover:underline">
          {courseTitle}
        </Link>
        <ProgressBar percent={progress.percent} label={t(locale, "lesson.courseProgress", { percent: progress.percent })} size="sm" />
        <p className="text-xs text-muted">{t(locale, "lesson.courseProgress", { percent: progress.percent })}</p>
      </div>
      <ol className="space-y-3">
        {modules.map((mod, index) => {
          const open = isOpenState(mod.state);
          return (
            <li key={mod.id}>
              <p className={`flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase ${open ? "text-academy-blue-700" : "text-academy-blue-500/70"}`}>
                {t(locale, "course.module", { number: index + 1 })}
              </p>
              <p className={`text-sm font-medium ${open ? "text-academy-blue-900" : "text-muted"}`}>{mod.title}</p>
              {!open && <p className="text-xs text-muted">{moduleStateLabel(mod, locale, timeZone)}</p>}
              <ul className="mt-1.5 space-y-0.5">
                {mod.lessons.map((lesson) => {
                  const current = lesson.id === currentLessonId && (currentModuleId === null || currentModuleId === mod.id);
                  const mark = <LessonMark done={Boolean(lesson.completedAt)} locked={!open} className="size-4" />;
                  return (
                    <li key={lesson.id}>
                      {open ? (
                        <Link
                          href={`/academy/courses/${courseId}/lessons/${lesson.id}?module=${mod.id}`}
                          aria-current={current ? "page" : undefined}
                          className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition pointer-coarse:min-h-10 ${
                            current ? "bg-academy-blue-100 font-semibold text-academy-blue-900" : "text-ink hover:bg-academy-blue-50"
                          }`}
                        >
                          {mark}
                          <span className="min-w-0 truncate">{lesson.title}</span>
                        </Link>
                      ) : (
                        <span className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted">
                          {mark}
                          <span className="min-w-0 truncate">{lesson.title}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
