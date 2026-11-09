import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { getGroupReport } from "@/lib/academy/ats/data";
import { scoreBuckets } from "@/lib/academy/ats/pool";
import { listCourseOptions } from "@/lib/academy/admin";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { FunnelTable } from "@/components/academy/ats/funnel-table";
import { GroupSettingsForm } from "@/components/academy/ats/settings-form";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Academy group" };

export default function Page({ params }: PageProps<"/dashboard/academy/groups/[id]">) {
  return (
    <>
      <Link href="/dashboard/academy/groups" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All groups
      </Link>
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Group params={params} />
      </Suspense>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-brand-900 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Distribution({ title, distribution }: { title: string; distribution: Record<string, number> }) {
  const buckets = scoreBuckets(distribution);
  return (
    <div>
      <h3 className="text-sm font-semibold text-brand-900">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {buckets.map((b) => (
          <li key={b.bucket} className="grid grid-cols-[4rem_minmax(0,1fr)_3rem] items-center gap-2 text-sm">
            <span className="text-muted tabular-nums">{b.bucket}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <span className="block h-full bg-brand-600" style={{ width: `${b.share}%` }} />
            </span>
            <span className="text-right tabular-nums">{b.count}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted">No score yet: {distribution.none ?? 0}</p>
    </div>
  );
}

async function Group({ params }: Pick<PageProps<"/dashboard/academy/groups/[id]">, "params">) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();
  const data = await getGroupReport(id);
  if (!data) notFound();
  const { group, settings, report } = data;
  const supabase = await createClient();
  const [courses, { data: vacancies }] = await Promise.all([
    listCourseOptions(),
    supabase.from("vacancies").select("id, title").order("opened_at", { ascending: false }).limit(300),
  ]);
  const modules = courses.find((c) => c.id === report.course_id)?.modules ?? [];
  const s = report.summary;

  return (
    <>
      <PageHeader
        eyebrow="Academy · Group"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {group.name}
            <Badge>{group.kind}</Badge>
          </span>
        }
        description={group.description ?? "Report of the group in the developer course: started, completed, where they drop out and the score distribution."}
        actions={
          <>
            <ButtonLink href={`/dashboard/academy/people?group=${group.id}`} variant="secondary">
              People
            </ButtonLink>
            <ButtonLink href={`/dashboard/candidates/academy?group=${group.id}`} variant="secondary">
              In the talent pool
            </ButtonLink>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Members" value={report.members} hint={`${s.candidates} from the ATS`} />
            <Stat label="Started" value={s.started} />
            <Stat label="Completed" value={s.completed} hint={s.avg_lead_time_days !== null ? `in ${s.avg_lead_time_days} days on average` : undefined} />
            <Stat label="Inactive 14 days" value={s.inactive} />
            <Stat label="Avg progress" value={s.avg_progress !== null ? `${s.avg_progress}%` : "–"} />
            <Stat label="Avg knowledge check" value={s.avg_check !== null ? `${s.avg_check}%` : "–"} />
            <Stat label="Avg final score" value={s.avg_final ?? "–"} />
            <Stat label="Certificates" value={s.certificates} />
          </div>
          <Card>
            <CardHeader title="Score distribution" description="Average best knowledge check and average final assignment score per candidate." />
            <CardBody className="grid gap-6 sm:grid-cols-2">
              <Distribution title="Knowledge checks" distribution={report.check_distribution} />
              <Distribution title="Assignments (final score)" distribution={report.final_distribution} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Where they drop out" />
            <CardBody>
              <FunnelTable rows={report.funnel} />
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader title="Vacancy and automatic access" />
          <CardBody>
            <GroupSettingsForm
              groupId={group.id}
              vacancyId={group.vacancy_id}
              settings={settings}
              vacancies={vacancies ?? []}
              modules={modules.map((m) => ({ id: m.id, title: m.title, in_default_access: m.in_default_access }))}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
