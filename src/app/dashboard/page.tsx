import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { RecentActivity } from "@/components/entity/recent-activity";
import { AttentionVacancies } from "@/components/overview/attention-vacancies";
import { PipelineFunnel } from "@/components/overview/pipeline-funnel";
import { StatCards, StatCardsSkeleton } from "@/components/overview/stat-cards";
import { UpcomingMoments } from "@/components/overview/upcoming-moments";
import { MyTasksWidget } from "@/components/tasks/my-tasks-widget";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Overview",
};

const process = [
  {
    step: "01",
    title: "Job profile",
    text: "The client provides the job description. We turn it into a clear profile.",
  },
  {
    step: "02",
    title: "Sourcing and screening",
    text: "A technical test by our specialist and a communication interview in English.",
  },
  {
    step: "03",
    title: "Three candidates",
    text: "Within 2 to 3 weeks: three profiles with a video intro and assessment results.",
  },
  {
    step: "04",
    title: "Placement",
    text: "The client chooses. We arrange the contract, payroll and onboarding in Bangalore.",
  },
];

export default function DashboardPage() {
  return (
    <>
      <Suspense fallback={<GreetingSkeleton />}>
        <Greeting />
      </Suspense>

      <Suspense fallback={<StatCardsSkeleton />}>
        <StatCards />
      </Suspense>

      <div className="mb-8 grid gap-4 sm:mb-10 sm:gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-4 sm:space-y-6">
          <Card>
            <CardHeader
              title="Vacancies that need attention"
              description="Propose 3 candidates within 3 weeks. Longest open is at the top."
              actions={
                <Link
                  href="/dashboard/vacancies"
                  className="text-sm font-semibold text-brand-600 hover:text-brand-800 pointer-coarse:-my-3 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                >
                  All vacancies
                </Link>
              }
            />
            <Suspense fallback={<PanelSkeleton />}>
              <AttentionVacancies />
            </Suspense>
          </Card>

          {/* Both widgets render their own card and header. */}
          <Suspense fallback={<PanelSkeleton />}>
            <MyTasksWidget />
          </Suspense>

          <Suspense fallback={<PanelSkeleton />}>
            <RecentActivity />
          </Suspense>
        </div>

        <div className="min-w-0 space-y-4 sm:space-y-6">
          <Card>
            <CardHeader
              title="Upcoming moments"
              description="Check-ins, guarantee end dates and last working days."
            />
            <Suspense fallback={<PanelSkeleton />}>
              <UpcomingMoments />
            </Suspense>
          </Card>

          <Card>
            <CardHeader title="Pipeline" description="Candidates per stage, for open vacancies." />
            <Suspense fallback={<PanelSkeleton />}>
              <PipelineFunnel />
            </Suspense>
          </Card>
        </div>
      </div>

      <section
        aria-labelledby="process-heading"
        className="rounded-2xl border border-border bg-card px-5 py-6 shadow-xs sm:p-8"
      >
        <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id="process-heading"
              className="font-display text-xl font-semibold text-brand-900"
            >
              How Nordavo works
            </h2>
            <p className="mt-1 text-sm text-muted">
              From vacancy to a developer in your team. This is the process we
              will support here step by step.
            </p>
          </div>
          <Link
            href="/dashboard/vacancies"
            className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-brand-600 hover:text-brand-800 pointer-coarse:min-h-11"
          >
            Go to vacancies
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        {/* On phones the steps swipe sideways instead of stacking four tall cards. */}
        <ol className="-mx-5 flex snap-strip scrollbar-none gap-3 px-5 sm:-mx-8 sm:px-8 md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 xl:grid-cols-4">
          {process.map(({ step, title, text }) => (
            <li key={step} className="w-[78%] shrink-0 snap-start scroll-ml-5 rounded-xl sm:scroll-ml-8 bg-surface p-5 md:w-auto">
              <span className="font-display text-sm font-bold text-accent-600">
                {step}
              </span>
              <p className="mt-2 font-display font-semibold text-brand-900">
                {title}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

async function Greeting() {
  const user = await getCurrentUser();
  const firstName = user.name.split(" ")[0];
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Europe/Amsterdam",
    }).format(new Date()),
  );
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <header className="mb-6 sm:mb-8">
      <p className="mb-1.5 text-xs font-semibold tracking-wider text-accent-600 uppercase">
        Overview
      </p>
      <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900 sm:text-3xl">
        {greeting}, {firstName}
      </h1>
      <p className="mt-2 text-muted max-sm:text-sm">
        At a glance: where things stand with clients, vacancies,
        candidates and placements.
      </p>
    </header>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-2 p-5" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function GreetingSkeleton() {
  return (
    <div className="mb-8 space-y-3" aria-hidden="true">
      <span className="block h-3 w-20 animate-pulse rounded bg-brand-100" />
      <span className="block h-8 w-64 animate-pulse rounded bg-brand-100" />
      <span className="block h-4 w-96 max-w-full animate-pulse rounded bg-brand-100" />
    </div>
  );
}
