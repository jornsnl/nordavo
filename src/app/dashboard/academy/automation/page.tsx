import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { getAtsSettings, getRetentionOverview, listAtsEvents, listRecentReminders } from "@/lib/academy/ats/data";
import { listCourseOptions } from "@/lib/academy/admin";
import { formatDate, formatDateTime } from "@/lib/format";
import { hasAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/dashboard/page-header";
import { atsEventLabel, atsEventTone } from "@/components/academy/ats/labels";
import { AtsSettingsForm, RetryEventButton } from "@/components/academy/ats/settings-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Academy automation" };

export default function Page({ searchParams }: PageProps<"/dashboard/academy/automation">) {
  return (
    <>
      <PageHeader
        eyebrow="Academy"
        title="ATS automation"
        description="What happens in the Academy on ATS statuses (placed, linked to a vacancy, top candidate), reminders to candidates who get stuck, and retention. Every step is logged below."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<ListSkeleton rows={6} />}>
            <Events searchParams={searchParams} />
          </Suspense>
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <Retention />
          </Suspense>
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <Reminders />
          </Suspense>
        </div>
        <Card>
          <CardHeader title="Settings" />
          <CardBody>
            <Suspense fallback={<ListSkeleton rows={6} />}>
              <Settings />
            </Suspense>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

async function Settings() {
  const [settings, courses] = await Promise.all([getAtsSettings(), listCourseOptions()]);
  const supabase = await createClient();
  const { data: developerCourseId } = await supabase.rpc("academy_ats_developer_course");
  return (
    <>
      {!hasAdminClient() && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          SUPABASE_SECRET_KEY is not set: new accounts, invitations and the jobs wait until it is.
        </p>
      )}
      <AtsSettingsForm
        settings={settings}
        courses={courses.map((c) => ({ id: c.id, title: c.title, audience: c.audience }))}
        modules={courses.flatMap((c) => c.modules.map((m) => ({ id: m.id, title: m.title, course_id: m.course_id, in_default_access: m.in_default_access })))}
        developerCourseId={(developerCourseId as string | null) ?? null}
      />
    </>
  );
}

async function Events({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : undefined;
  const events = await listAtsEvents({ status, limit: 100 });
  const filters = ["all", "pending", "failed", "done", "skipped"];
  return (
    <Card>
      <CardHeader
        title="Automation log"
        description="Pending steps are finished right away when possible, otherwise by the hourly job academy-ats-sync."
        actions={
          <nav aria-label="Status" className="flex flex-wrap gap-1 text-xs">
            {filters.map((f) => (
              <Link
                key={f}
                href={f === "all" ? "/dashboard/academy/automation" : `/dashboard/academy/automation?status=${f}`}
                aria-current={(status ?? "all") === f ? "page" : undefined}
                className={`rounded-full border px-2.5 py-1 ${(status ?? "all") === f ? "border-brand-700 bg-brand-700 text-white" : "border-border bg-white"}`}
              >
                {f}
              </Link>
            ))}
          </nav>
        }
      />
      {events.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Nothing yet.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm sm:px-5">
              <Badge tone={atsEventTone(e.status)}>{e.status}</Badge>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">{atsEventLabel(e.kind)}</span>
                <span className="text-xs text-muted">
                  {e.candidate_id ? (
                    <Link href={`/dashboard/candidates/${e.candidate_id}`} className="hover:underline">
                      {e.candidateName ?? "Candidate"}
                    </Link>
                  ) : null}
                  {e.placement_id && (
                    <>
                      {" · "}
                      <Link href={`/dashboard/placements/${e.placement_id}`} className="hover:underline">
                        placement
                      </Link>
                    </>
                  )}
                  {" · "}
                  {formatDateTime(e.created_at)}
                  {e.attempts > 0 && ` · ${e.attempts} ${e.attempts === 1 ? "attempt" : "attempts"}`}
                </span>
                {e.error && <span className="block text-xs text-danger">{e.error}</span>}
              </span>
              {(e.status === "failed" || e.status === "pending") && <RetryEventButton eventId={e.id} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function Retention() {
  const { due, oldest, log } = await getRetentionOverview();
  return (
    <Card>
      <CardHeader
        title="Retention"
        description={`${due} ${due === 1 ? "candidate is" : "candidates are"} past the retention period${oldest ? `, the oldest without activity since ${formatDate(oldest)}` : ""}.`}
      />
      {log.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">The job has not run yet. Run it by hand on Jobs (academy-retention, dry run by default).</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {log.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5">
              <Badge tone={l.action === "failed" ? "danger" : l.action === "dry_run" ? "neutral" : "warning"}>{l.action.replace("_", " ")}</Badge>
              <span className="text-xs text-muted">
                person {l.profile_id?.slice(0, 8)} · inactive since {formatDate(l.last_activity_at)} · {formatDateTime(l.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function Reminders() {
  const reminders = await listRecentReminders(20);
  return (
    <Card>
      <CardHeader title="Recent reminders" description="Candidates who got stuck, with the lesson they were sent to." />
      {reminders.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">No reminders sent yet.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {reminders.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
              <Link href={`/dashboard/academy/people/${r.profile_id}`} className="font-medium text-brand-900 hover:underline">
                {r.name}
              </Link>
              <span className="text-xs text-muted">
                {r.days_inactive ?? "?"} days inactive · {r.mailed ? "mailed" : "in the app only"} · {formatDateTime(r.sent_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
