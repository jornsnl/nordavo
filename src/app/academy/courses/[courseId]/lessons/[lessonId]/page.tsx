import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, ListTree, Lock } from "lucide-react";
import { z } from "zod";
import { requireAcademyUser } from "@/lib/academy/auth";
import { blockContent, normalizeCompletion } from "@/lib/academy/blocks/types";
import { getCourse, getCourseOutline, getLessonView } from "@/lib/academy/data";
import { t } from "@/lib/academy/i18n";
import { isOpenState, lessonRequirements, moduleOfLesson, moduleStateLabel, neighbours } from "@/lib/academy/progress";
import { blockRegistry } from "@/components/academy/blocks/registry";
import type { ViewerBlock } from "@/components/academy/blocks/types";
import { LessonOpenTracker } from "@/components/academy/lesson/open-tracker";
import { LessonSidebar } from "@/components/academy/lesson/lesson-sidebar";
import { ActionLink, Panel, ProgressBar } from "@/components/academy/ui";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Lesson" };

type Props = PageProps<"/academy/courses/[courseId]/lessons/[lessonId]">;

export default function Page({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<LessonSkeleton />}>
      <Lesson params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Lesson({ params, searchParams }: Props) {
  const [{ courseId, lessonId }, query] = await Promise.all([params, searchParams]);
  const guid = z.guid();
  if (!guid.safeParse(courseId).success || !guid.safeParse(lessonId).success) notFound();
  const moduleParam = typeof query.module === "string" && guid.safeParse(query.module).success ? query.module : null;

  const user = await requireAcademyUser();
  const [course, outline] = await Promise.all([getCourse(courseId), getCourseOutline(courseId)]);
  if (!course) notFound();
  const mod = moduleOfLesson(outline, lessonId, moduleParam);
  if (!mod) notFound();
  const entry = mod.lessons.find((l) => l.id === lessonId)!;
  const open = isOpenState(mod.state);
  const view = open ? await getLessonView(user, courseId, lessonId, outline, mod.id) : null;
  const { previous, next } = neighbours(outline, lessonId, mod.id);
  const tr = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) => t(user.locale, key, vars);

  const blocks: ViewerBlock[] = (view?.blocks ?? []).map((b) => ({
    id: b.id,
    lessonId: b.lesson_id,
    type: b.type,
    title: b.title,
    required: b.required,
    completion: normalizeCompletion(b.type, b.completion),
    content: blockContent(b.content),
    videoId: b.video_id,
    documentId: b.document_id,
  }));
  const requirements = view ? lessonRequirements(view.blocks, view.done, user.locale) : [];
  const completed = Boolean(entry.completedAt);
  const percent = completed ? 100 : requirements.length === 0 ? (entry.startedAt ? 100 : 0) : Math.round((requirements.filter((r) => r.done).length / requirements.length) * 100);

  const sidebar = (
    <LessonSidebar
      courseId={courseId}
      courseTitle={course.title}
      modules={outline}
      currentLessonId={lessonId}
      currentModuleId={mod.id}
      locale={user.locale}
      timeZone={user.timeZone}
    />
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <LessonOpenTracker lessonId={lessonId} courseId={courseId} started={Boolean(entry.startedAt)} completed={completed} enabled={open && !view?.preview} />

      {/* Phones: the lesson list folds away above the lesson. */}
      <details className="rounded-2xl border border-academy-blue-200 bg-white px-4 py-3 shadow-xs lg:hidden">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-academy-blue-900">
          <ListTree className="size-4" aria-hidden="true" />
          {tr("lesson.lessonsInCourse")}
        </summary>
        <div className="mt-4">{sidebar}</div>
      </details>
      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-2xl border border-academy-blue-200 bg-white p-4 shadow-xs">{sidebar}</div>
      </aside>

      <article className="min-w-0 space-y-5">
        <header className="space-y-3 rounded-2xl border border-academy-blue-200 bg-white px-4 py-5 shadow-xs sm:px-6">
          <Link href={`/academy/courses/${courseId}`} className="inline-flex items-center gap-1 text-sm font-medium text-academy-blue-700 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            {tr("lesson.backToCourse")}
          </Link>
          <p className="text-xs font-semibold tracking-wider text-academy-blue-600 uppercase">{mod.title}</p>
          <h1 className="font-display text-2xl font-bold tracking-tight text-academy-blue-900 sm:text-3xl">{view?.lesson.title ?? entry.title}</h1>
          {(view?.lesson.summary ?? entry.summary) && <p className="text-muted">{view?.lesson.summary ?? entry.summary}</p>}
          {open && (
            <div className="space-y-1.5 pt-1">
              <ProgressBar percent={percent} label={tr("lesson.progress")} />
              <p className={`flex items-center gap-1.5 text-sm ${completed ? "font-medium text-emerald-700" : "text-muted"}`}>
                {completed && <CheckCircle2 className="size-4" aria-hidden="true" />}
                {completed ? tr("lesson.done") : `${tr("lesson.progress")}: ${percent}%`}
              </p>
            </div>
          )}
        </header>

        {!open ? (
          <Panel>
            <p className="flex items-center gap-2 text-sm text-academy-blue-800">
              <Lock className="size-4" aria-hidden="true" />
              {tr("lesson.locked")} {moduleStateLabel(mod, user.locale, user.timeZone)}
            </p>
          </Panel>
        ) : (
          <>
            {!completed && (
              <Panel title={tr("lesson.todo")}>
                {requirements.length === 0 ? (
                  <p className="text-sm text-muted">{tr("lesson.noRequirements")}</p>
                ) : (
                  <ul className="space-y-2">
                    {requirements.map((r) => (
                      <li key={r.blockId} className="flex items-start gap-2 text-sm">
                        {r.done ? (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                        ) : (
                          <Circle className="mt-0.5 size-4 shrink-0 text-academy-blue-300" aria-hidden="true" />
                        )}
                        <span className={r.done ? "text-muted line-through" : "text-ink"}>{r.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}

            {blocks.length === 0 && <p className="text-sm text-muted">{tr("lesson.empty")}</p>}
            {blocks.map((block) => {
              const { icon: Icon, viewer: Viewer } = blockRegistry[block.type];
              const done = Boolean(view?.done[block.id]);
              return (
                <section key={block.id} className="rounded-2xl border border-academy-blue-200 bg-white shadow-xs" aria-labelledby={`block-${block.id}`}>
                  <header className="flex items-center justify-between gap-3 border-b border-academy-blue-100 px-4 py-3 sm:px-6">
                    <h2 id={`block-${block.id}`} className="flex min-w-0 items-center gap-2 font-display text-base font-semibold text-academy-blue-900">
                      <Icon className="size-[18px] shrink-0 text-academy-blue-600" aria-hidden="true" />
                      <span className="truncate">{block.title || tr(`block.${block.type}`)}</span>
                    </h2>
                    {block.required &&
                      (done ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                          {tr("block.done")}
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-academy-orange-50 px-2 py-0.5 text-xs font-medium text-academy-orange-700">{tr("lesson.required")}</span>
                      ))}
                  </header>
                  <div className="px-4 py-4 sm:px-6 sm:py-5">
                    <Viewer
                      block={block}
                      done={done}
                      state={view?.states[block.id] ?? null}
                      locale={user.locale}
                      timeZone={user.timeZone}
                      courseId={courseId}
                      moduleId={view?.moduleId ?? mod.id}
                      preview={Boolean(view?.preview)}
                    />
                  </div>
                </section>
              );
            })}
          </>
        )}

        <nav aria-label={tr("lesson.lessonsInCourse")} className="flex items-center justify-between gap-3 pt-2">
          {previous ? (
            <ActionLink variant="secondary" href={`/academy/courses/${courseId}/lessons/${previous.lessonId}?module=${previous.moduleId}`}>
              <ArrowLeft aria-hidden="true" />
              <span className="max-sm:sr-only">{tr("lesson.previous")}</span>
            </ActionLink>
          ) : (
            <span />
          )}
          {next && (
            <ActionLink href={`/academy/courses/${courseId}/lessons/${next.lessonId}?module=${next.moduleId}`}>
              {tr("lesson.next")}
              <ArrowRight aria-hidden="true" />
            </ActionLink>
          )}
        </nav>
      </article>
    </div>
  );
}

function LessonSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]" aria-hidden="true">
      <Skeleton className="hidden h-96 lg:block" />
      <div className="space-y-5">
        <Skeleton className="h-36 rounded-2xl" />
        <ListSkeleton rows={3} />
      </div>
    </div>
  );
}
