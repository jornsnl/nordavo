import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireAcademyUser } from "@/lib/academy/auth";
import { t } from "@/lib/academy/i18n";
import { getPlacementPage } from "@/lib/academy/placement/data";
import { env } from "@/lib/env";
import { PlacementTasksPanel } from "@/components/academy/learn/placement-tasks";
import {
  DocumentsPanel,
  FactsPanel,
  HolidaysPanel,
  LeavePanel,
  PulsePanel,
  RitualsPanel,
  TimelinePanel,
  TrianglePanel,
} from "@/components/academy/placement/sections";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Placement" };

/**
 * One page per placement for the client contacts, the developer and Nordavo
 * (preview): the triangle, the agreements, rituals, timeline with reviews,
 * leave, holidays with the calendar link, documents and open course tasks.
 * Never money: everything comes through academy_placement_view() and RLS.
 */
export default function Page({ params }: PageProps<"/academy/placements/[id]">) {
  return (
    <Suspense fallback={<PlacementSkeleton />}>
      <Placement params={params} />
    </Suspense>
  );
}

async function Placement({ params }: Pick<PageProps<"/academy/placements/[id]">, "params">) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();
  const user = await requireAcademyUser();
  const page = await getPlacementPage(user, id);
  if (!page) notFound();

  const { placement } = page;
  const locale = user.locale;
  const ctx = { page, locale, timeZone: user.timeZone, userId: user.id, isManager: user.isManager };
  const calendarUrl = page.calendarToken ? `${env.siteUrl()}/api/academy/calendar/${page.calendarToken}.ics?lang=${locale}` : null;
  const statusKey = `pl.status.${placement.status}` as const;

  return (
    <div className="space-y-6">
      <Link href="/academy" className="inline-flex items-center gap-1.5 text-sm font-medium text-academy-blue-800 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t(locale, "pl.back")}
      </Link>
      <header className="rounded-3xl bg-gradient-to-br from-academy-blue-700 to-academy-blue-900 px-5 py-6 text-white shadow-sm sm:px-8">
        <p className="text-xs font-semibold tracking-wider text-academy-blue-200 uppercase">
          {t(locale, "pl.title")} · {t(locale, statusKey)}
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {t(locale, "pl.at", { developer: placement.developer_name ?? "—", client: placement.client_name ?? "—" })}
        </h1>
        {placement.vacancy_title && <p className="mt-2 text-academy-blue-100">{placement.vacancy_title}</p>}
      </header>

      <PulsePanel {...ctx} />
      <TrianglePanel {...ctx} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <RitualsPanel {...ctx} />
          <TimelinePanel {...ctx} />
          <LeavePanel {...ctx} />
          {/* Open course tasks of this placement (tasks block, area learn). */}
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <PlacementTasksPanel placementId={placement.id} user={user} />
          </Suspense>
        </div>
        <div className="min-w-0 space-y-6">
          <FactsPanel {...ctx} />
          <HolidaysPanel {...ctx} calendarUrl={calendarUrl} />
          <DocumentsPanel {...ctx} />
        </div>
      </div>
    </div>
  );
}

function PlacementSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <Skeleton className="h-32 rounded-3xl" />
      <Skeleton className="h-40" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ListSkeleton rows={4} />
        </div>
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
