import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, GraduationCap } from "lucide-react";
import { requireAcademyUser } from "@/lib/academy/auth";
import { getCourseOutline, listMyCourses, listMyPlacements, listPeopleProgress } from "@/lib/academy/data";
import { t } from "@/lib/academy/i18n";
import { continueTarget, courseProgress } from "@/lib/academy/progress";
import { isHttpsUrl } from "@/lib/sales/booking";
import {
  OpenTasksSection,
  PeopleProgressSection,
  PlacementSection,
  PlanCallSection,
  RitualsSection,
  UpcomingSection,
} from "@/components/academy/home/sections";
import { ActionLink, Panel, ProgressBar } from "@/components/academy/ui";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function Page() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <Home />
    </Suspense>
  );
}

async function Home() {
  const user = await requireAcademyUser();
  const [courses, placements] = await Promise.all([listMyCourses(), user.member ? listMyPlacements() : Promise.resolve([])]);
  const visible = courses.filter((c) => c.status === "published" || user.isManager);

  // "Continue where you left off": the course viewed last, else the first.
  const recent = [...visible].sort((a, b) => (b.last_viewed_at ?? "").localeCompare(a.last_viewed_at ?? ""))[0] ?? null;
  const outline = recent ? await getCourseOutline(recent.course_id) : [];
  const target = continueTarget(outline);

  const follows = user.academyRole === "client_admin" || user.academyRole === "client_reader" || user.isManager;
  const people = follows && user.member ? await listPeopleProgress() : [];

  const contactBooking = placements.find((p) => isHttpsUrl(p.nordavo_contact_booking_url))?.nordavo_contact_booking_url ?? null;
  const envBooking = process.env.NEXT_PUBLIC_ACADEMY_BOOKING_URL;
  const bookingUrl = contactBooking ?? (isHttpsUrl(envBooking) ? envBooking : null);
  const firstName = user.name.split(/\s+/)[0] || user.name;
  const inPlacement = placements.length > 0;
  const tr = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) => t(user.locale, key, vars);

  return (
    <div className="space-y-6">
      <header className="rounded-3xl bg-gradient-to-br from-academy-blue-700 to-academy-blue-900 px-5 py-6 text-white shadow-sm sm:px-8 sm:py-8">
        <p className="text-xs font-semibold tracking-wider text-academy-blue-200 uppercase">{tr("shell.academy")}</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">{tr("home.welcome", { name: firstName })}</h1>
        <p className="mt-2 max-w-2xl text-academy-blue-100">{tr("home.intro")}</p>
        {target && recent && (
          <ActionLink href={`/academy/courses/${recent.course_id}/lessons/${target.lessonId}?module=${target.moduleId}`} className="mt-5">
            {outline.some((m) => m.lessons.some((l) => l.startedAt)) ? tr("home.continue") : tr("home.start")}
            <ArrowRight aria-hidden="true" />
          </ActionLink>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title={tr("home.progress")}>
            {visible.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <GraduationCap className="size-4" aria-hidden="true" />
                {tr("home.noCourses")}
              </p>
            ) : (
              <ul className="space-y-5">
                {visible.map((course) => {
                  const percent = course.lessons_total === 0 ? 0 : Math.round((course.lessons_done / course.lessons_total) * 100);
                  const progress = course.course_id === recent?.course_id ? courseProgress(outline) : null;
                  return (
                    <li key={course.course_id}>
                      <div className="flex items-baseline justify-between gap-3">
                        <Link href={`/academy/courses/${course.course_id}`} className="font-semibold text-academy-blue-900 hover:underline">
                          {course.title}
                        </Link>
                        {course.completed ? (
                          <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="size-4" aria-hidden="true" />
                            {tr("home.courseCompleted")}
                          </span>
                        ) : (
                          <span className="text-xs text-muted tabular-nums">{progress?.percent ?? percent}%</span>
                        )}
                      </div>
                      <div className="mt-2">
                        <ProgressBar percent={progress?.percent ?? percent} label={course.title} />
                      </div>
                      <p className="mt-1.5 text-xs text-muted">
                        {tr("home.lessonsDone", { done: course.lessons_done, total: course.lessons_total })}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            {recent && !target && visible.length > 0 && outline.length > 0 && courseProgress(outline).total > 0 && (
              <p className="mt-4 text-sm text-emerald-700">{tr("home.allDone")}</p>
            )}
          </Panel>

          <PeopleProgressSection user={user} rows={people} />
          <OpenTasksSection user={user} />
          {inPlacement && <RitualsSection user={user} />}
        </div>

        <div className="space-y-6">
          <PlacementSection user={user} placements={placements} />
          {(inPlacement || user.academyRole?.startsWith("client")) && <UpcomingSection user={user} />}
          <PlanCallSection user={user} bookingUrl={bookingUrl} />
        </div>
      </div>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <Skeleton className="h-40 rounded-3xl" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ListSkeleton rows={3} />
        </div>
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
