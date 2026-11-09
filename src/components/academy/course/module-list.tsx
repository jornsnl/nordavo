import Link from "next/link";
import { BookOpen, Star } from "lucide-react";
import type { AcademyLocale } from "@/lib/academy/database";
import { t } from "@/lib/academy/i18n";
import { type OutlineModule, isOpenState, moduleStateLabel } from "@/lib/academy/progress";
import { LessonMark, StateBadge } from "@/components/academy/ui";

/** The modules of a course with their lessons; closed modules stay visible with a lock. */
export function ModuleList({
  courseId,
  modules,
  locale,
  timeZone,
}: {
  courseId: string;
  modules: OutlineModule[];
  locale: AcademyLocale;
  timeZone: string;
}) {
  return (
    <ol className="space-y-4">
      {modules.map((mod, index) => {
        const open = isOpenState(mod.state);
        return (
          <li
            key={mod.id}
            className={`rounded-2xl border bg-white shadow-xs ${open ? "border-academy-blue-200" : "border-academy-blue-100 bg-white/70"}`}
          >
            <div className="flex flex-col gap-2 border-b border-academy-blue-100 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:px-5">
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-wide text-academy-blue-600 uppercase">
                  {t(locale, "course.module", { number: index + 1 })}
                </p>
                <h2 className={`font-display text-base font-semibold ${open ? "text-academy-blue-900" : "text-academy-blue-800/70"}`}>{mod.title}</h2>
                {mod.description && <p className="mt-1 text-sm text-muted">{mod.description}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {mod.isCore && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-academy-orange-50 px-2 py-0.5 text-xs font-medium text-academy-orange-700">
                      <Star className="size-3" aria-hidden="true" />
                      {t(locale, "course.core")}
                    </span>
                  )}
                  {mod.requiredBeforeStart && (
                    <span className="rounded-full bg-academy-blue-100 px-2 py-0.5 text-xs font-medium text-academy-blue-800">{t(locale, "course.beforeStart")}</span>
                  )}
                </div>
              </div>
              <StateBadge state={mod.state} label={moduleStateLabel(mod, locale, timeZone)} />
            </div>
            {mod.lessons.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted sm:px-5">{t(locale, "course.noLessons")}</p>
            ) : (
              <ul className="divide-y divide-academy-blue-100">
                {mod.lessons.map((lesson) => {
                  const content = (
                    <>
                      <LessonMark done={Boolean(lesson.completedAt)} locked={!open} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{lesson.title}</span>
                        {lesson.status === "draft" && <span className="text-xs text-academy-orange-700">Draft</span>}
                      </span>
                      {lesson.durationMinutes ? (
                        <span className="shrink-0 text-xs text-muted">{t(locale, "lesson.minutes", { count: lesson.durationMinutes })}</span>
                      ) : null}
                    </>
                  );
                  return (
                    <li key={lesson.id}>
                      {open ? (
                        <Link
                          href={`/academy/courses/${courseId}/lessons/${lesson.id}?module=${mod.id}`}
                          className="flex items-center gap-3 px-4 py-3 text-sm text-ink transition hover:bg-academy-blue-50 focus-visible:outline-2 focus-visible:outline-academy-orange-600 sm:px-5 pointer-coarse:min-h-12"
                        >
                          {content}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3 px-4 py-3 text-sm text-muted sm:px-5" aria-disabled="true">
                          {content}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {mod.workbookDocumentId && open && (
              <p className="flex items-center gap-2 border-t border-academy-blue-100 px-4 py-2.5 text-xs text-academy-blue-800 sm:px-5">
                <BookOpen className="size-3.5" aria-hidden="true" />
                {t(locale, "course.workbook")}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
