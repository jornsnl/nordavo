import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowRight, Award } from "lucide-react";
import { z } from "zod";
import { requireAcademyUser } from "@/lib/academy/auth";
import { getCourse, getCourseOutline } from "@/lib/academy/data";
import { t } from "@/lib/academy/i18n";
import { getMyCertificate } from "@/lib/academy/media/learner";
import { formatAcademyDate } from "@/lib/academy/time";
import { continueTarget, courseProgress } from "@/lib/academy/progress";
import { ModuleList } from "@/components/academy/course/module-list";
import { ActionLink, ProgressBar, actionClasses } from "@/components/academy/ui";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Course" };

export default function Page({ params }: PageProps<"/academy/courses/[courseId]">) {
  return (
    <Suspense fallback={<CourseSkeleton />}>
      <Course params={params} />
    </Suspense>
  );
}

async function Course({ params }: Pick<PageProps<"/academy/courses/[courseId]">, "params">) {
  const { courseId } = await params;
  if (!z.guid().safeParse(courseId).success) notFound();
  const user = await requireAcademyUser();
  const [course, outline, certificate] = await Promise.all([getCourse(courseId), getCourseOutline(courseId), getMyCertificate(courseId)]);
  if (!course) notFound();

  const progress = courseProgress(outline);
  const target = continueTarget(outline);
  const started = outline.some((m) => m.lessons.some((l) => l.startedAt));

  return (
    <div className="space-y-6">
      <header className="space-y-4 rounded-2xl border border-academy-blue-200 bg-white px-4 py-5 shadow-xs sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wider text-academy-orange-600 uppercase">{t(user.locale, "shell.academy")}</p>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-academy-blue-900 sm:text-3xl">{course.title}</h1>
            {course.description && <p className="mt-2 max-w-2xl text-muted">{course.description}</p>}
          </div>
          {target && (
            <ActionLink href={`/academy/courses/${course.id}/lessons/${target.lessonId}?module=${target.moduleId}`} className="shrink-0">
              {started ? t(user.locale, "home.continue") : t(user.locale, "home.start")}
              <ArrowRight aria-hidden="true" />
            </ActionLink>
          )}
        </div>
        <div>
          <ProgressBar percent={progress.percent} label={t(user.locale, "home.progress")} />
          <p className="mt-1.5 text-xs text-muted">{t(user.locale, "home.lessonsDone", { done: progress.done, total: progress.total })}</p>
        </div>
        {/* Media area: the certificate once the course is completed. */}
        {certificate && (
          <div className="flex flex-col gap-3 rounded-xl bg-academy-orange-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-academy-blue-900">
              <Award className="size-5 shrink-0 text-academy-orange-600" aria-hidden="true" />
              <span>
                {t(user.locale, "certificate.ready")}{" "}
                <span className="text-muted">{t(user.locale, "certificate.issued", { date: formatAcademyDate(certificate.issued_at, user.locale, user.timeZone) })}</span>
              </span>
            </p>
            <a href={`/academy/certificates/${certificate.id}`} className={actionClasses("primary", "shrink-0")}>
              {t(user.locale, "certificate.download")}
            </a>
          </div>
        )}
      </header>

      {outline.length === 0 ? (
        <p className="text-sm text-muted">{t(user.locale, "course.noLessons")}</p>
      ) : (
        <ModuleList courseId={course.id} modules={outline} locale={user.locale} timeZone={user.timeZone} />
      )}
    </div>
  );
}

function CourseSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <Skeleton className="h-36 rounded-2xl" />
      <ListSkeleton rows={4} />
    </div>
  );
}
