import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { ContentCalendar } from "@/components/content/planning/content-calendar";
import { BufferMeter, RhythmStat, RhythmWarning, TomorrowWarning, formatDay } from "@/components/content/planning/meters";
import { getContentWorkspace, statusLabel } from "@/lib/content/data";
import { listActivePosts, listCalendarPosts, statsFor, timeSlots } from "@/lib/content/planning";
import { addDays, dayKey, isDay, monthGrid, monthStart, weekStart } from "@/lib/content/rules";

export const metadata: Metadata = { title: "Calendar" };

type Search = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function CalendarPage({ params, searchParams }: PageProps<"/content/w/[slug]/calendar">) {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <Calendar params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Calendar({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const workspace = await getContentWorkspace(slug);
  const today = dayKey();
  const view = first(search.view) === "month" ? "month" : "week";
  const date = first(search.date);
  const anchor = date && isDay(date) ? date : today;

  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i)) : monthGrid(anchor);
  const from = days[0];
  const to = addDays(days[days.length - 1], 1);
  const [{ planned, unplanned }, active] = await Promise.all([listCalendarPosts(workspace.id, from, to), listActivePosts([workspace.id])]);
  const stats = statsFor(workspace, active, today);
  const slots = timeSlots(workspace);
  const slotLabel = (value: string | null) => (value ? (slots.find((s) => s.value === value)?.label ?? value) : null);
  const toItem = (p: (typeof planned)[number]) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    statusLabel: statusLabel(workspace, p.status),
    plannedDate: p.plannedDate,
    timeSlot: p.timeSlot,
    slotLabel: slotLabel(p.timeSlot),
  });

  const base = `/content/w/${slug}/calendar`;
  const href = (v: string, d: string) => `${base}?view=${v}&date=${d}`;
  const prev = view === "week" ? addDays(weekStart(anchor), -7) : monthStart(addDays(monthStart(anchor), -1));
  const next = view === "week" ? addDays(weekStart(anchor), 7) : addDays(monthStart(anchor), 32).slice(0, 8) + "01";
  const title =
    view === "week"
      ? `${formatDay(days[0], { day: "numeric", month: "short" })} to ${formatDay(days[6], { day: "numeric", month: "short", year: "numeric" })}`
      : formatDay(monthStart(anchor), { month: "long", year: "numeric" });

  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title="Calendar"
        description={workspace.canWrite ? "Drag a post to another day to reschedule it." : "Planned posts per day."}
        actions={
          <>
            <ButtonLink href={href("week", anchor)} variant={view === "week" ? "primary" : "secondary"}>
              Week
            </ButtonLink>
            <ButtonLink href={href("month", anchor)} variant={view === "month" ? "primary" : "secondary"}>
              Month
            </ButtonLink>
          </>
        }
      />
      <TomorrowWarning posts={stats.tomorrowUnapproved} hrefFor={(p) => `/content/w/${slug}/posts/${p.id}`} />
      <RhythmWarning
        weeks={[
          { label: "This week", rhythm: stats.thisWeek },
          { label: "Next week", rhythm: stats.nextWeek },
        ]}
      />
      <Card className="mb-6">
        <CardBody className="grid gap-5 sm:grid-cols-3">
          <BufferMeter count={stats.buffer} min={workspace.bufferMin} max={workspace.bufferMax} state={stats.bufferState} />
          <RhythmStat label="This week" rhythm={stats.thisWeek} />
          <RhythmStat label="Next week" rhythm={stats.nextWeek} />
        </CardBody>
      </Card>

      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link href={href(view, prev)} className="flex size-9 items-center justify-center rounded-lg hover:bg-brand-50" aria-label={`Previous ${view}`}>
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
          <Link href={href(view, next)} className="flex size-9 items-center justify-center rounded-lg hover:bg-brand-50" aria-label={`Next ${view}`}>
            <ChevronRight className="size-5" aria-hidden="true" />
          </Link>
          <h2 className="ml-1 font-display text-lg font-semibold text-brand-900">{title}</h2>
        </div>
        <Link href={href(view, today)} className="text-sm font-medium text-brand-700 hover:underline">
          Today
        </Link>
      </div>

      <ContentCalendar
        slug={slug}
        view={view}
        days={days}
        month={monthStart(anchor).slice(0, 7)}
        today={today}
        posts={planned.map(toItem)}
        unplanned={unplanned.map(toItem)}
        slots={slots.filter((s) => !s.archived).map((s) => ({ value: s.value, label: s.label, weekdays: s.weekdays }))}
        canEdit={workspace.canWrite}
      />
    </>
  );
}
