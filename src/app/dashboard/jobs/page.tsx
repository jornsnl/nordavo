import type { Metadata } from "next";
import { Suspense } from "react";
import Form from "next/form";
import { History, KeyRound, TriangleAlert, Workflow } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { FilterSheet } from "@/components/leads/filter-sheet";
import { RunJobForm } from "@/components/jobs/run-job-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { ListSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  getLastRuns,
  hasJobDb,
  hasMail,
  isJobStatus,
  JOB_REQUIRED_PARAMS,
  listJobRuns,
  listVacancyOptions,
  missingEnvFor,
  type JobRunItem,
} from "@/lib/data/jobs";
import { formatDateTime, formatRelativeDays } from "@/lib/format";
import { jobStatuses, optionFor } from "@/lib/labels";
import { chains, jobs } from "@/jobs/registry";
import { getCurrentUser } from "@/lib/auth";
import { jobModule } from "@/lib/modules";
import { runJobAction } from "./actions";

export const metadata: Metadata = {
  title: "Jobs",
};

// A manual run waits for the job (or a whole chain) to finish.
export const maxDuration = 300;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatDuration(ms: number | null) {
  if (ms === null) return "Still running";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${seconds % 60} s`;
}

function StatusBadge({ run }: { run: JobRunItem | undefined }) {
  if (!run) return <Badge tone="neutral">Never run</Badge>;
  const option = optionFor(jobStatuses, run.status);
  return <Badge tone={option.tone}>{option.label}</Badge>;
}

function triggerLabel(triggeredBy: string) {
  return triggeredBy.startsWith("user:") ? "Manual" : triggeredBy === "schedule" ? "Schedule" : triggeredBy;
}

/** Log of one run, folded away. */
function RunLog({ run }: { run: JobRunItem }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500 max-md:flex max-md:min-h-11 max-md:items-center">
        View log ({run.log.length} {run.log.length === 1 ? "line" : "lines"})
      </summary>
      <pre className="mt-2 max-h-80 overflow-auto overscroll-contain rounded-xl bg-brand-950 p-3 text-xs leading-relaxed whitespace-pre-wrap text-brand-50">
        {run.log.join("\n")}
        {run.error ? `${run.log.length > 0 ? "\n\n" : ""}${run.error}` : ""}
      </pre>
    </details>
  );
}

export default function Page({ searchParams }: PageProps<"/dashboard/jobs">) {
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Jobs"
        description="The scheduled scripts of the sales flow. Every run is logged in the history; Julius gets an email when one fails."
      />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <JobsOverview />
      </Suspense>
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <RunHistory searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function JobsOverview() {
  // Only the jobs of the user's modules (2.5); the run history follows RLS.
  const user = await getCurrentUser();
  const visible = (name: string) => {
    const module = jobModule(name);
    return module === null || user.modules.includes(module);
  };
  const names = Object.keys(jobs).filter(visible);
  const visibleChains = Object.entries(chains).filter(([, chain]) => chain.jobs.every(visible));
  const needsVacancy = names.some((n) => JOB_REQUIRED_PARAMS[n]?.name === "vacancy");
  const [lastRuns, vacancies] = await Promise.all([
    getLastRuns(names),
    needsVacancy ? listVacancyOptions() : Promise.resolve([]),
  ]);
  const dbReady = hasJobDb();
  const noDbReason = dbReady ? null : "SUPABASE_SECRET_KEY is missing";

  return (
    <div className="mb-8 space-y-6">
      {!dbReady && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-danger/20 bg-danger-bg px-5 py-4 text-sm text-danger"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            <strong className="font-semibold">SUPABASE_SECRET_KEY is missing on the server.</strong> Jobs write with the
            service role and cannot run without this key, not even from this page. Set it in the environment of the app
            and of GitHub Actions.
          </p>
        </div>
      )}
      {!hasMail() && (
        <p className="flex items-start gap-3 rounded-2xl border border-amber-600/20 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <KeyRound className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          RESEND_API_KEY is missing: error alerts and the weekly report are not emailed. So check here yourself whether
          the jobs succeeded.
        </p>
      )}

      <Card>
        <CardHeader title="Chains" description="Run on a schedule through GitHub Actions. A chain runs its jobs one after the other." />
        <ul className="divide-y divide-border">
          {visibleChains.map(([name, chain]) => (
            <li key={name} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-ink capitalize">{name}</p>
                <p className="text-sm text-muted">{chain.description}</p>
                <p className="text-xs text-muted">
                  {chain.jobs.join(", ")}
                  {chain.stopOnFailure ? ". Stops at the first failure." : ". Continues after a failure."}
                </p>
              </div>
              <div className="shrink-0">
                <RunJobForm
                  label="Run chain"
                  action={runJobAction.bind(null, name)}
                  disabledReason={noDbReason}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Single jobs" description="Last run per job, and missing keys." />
        <ul className="divide-y divide-border">
          {names.map((name) => {
            const job = jobs[name];
            const run = lastRuns[name];
            const missing = missingEnvFor(name);
            const required = JOB_REQUIRED_PARAMS[name];
            return (
              <li key={name} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm font-semibold text-ink">{name}</p>
                    <StatusBadge run={run} />
                  </div>
                  <p className="text-sm text-muted">{job.description}</p>
                  {run && (
                    <p className="text-xs text-muted">
                      Last run {formatRelativeDays(run.startedAt)} at {formatDateTime(run.startedAt)}, {run.recordsIn} in,{" "}
                      {run.recordsOut} out, {formatDuration(run.durationMs)}
                      {run.status === "failed" && run.errorFirstLine ? `. Error: ${run.errorFirstLine}` : ""}
                    </p>
                  )}
                  {missing.required.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-danger">
                      <span className="font-medium">Missing:</span>
                      {missing.required.map((n) => (
                        <code key={n} className="rounded bg-danger-bg px-1.5 py-0.5">
                          {n}
                        </code>
                      ))}
                    </p>
                  )}
                  {missing.optional.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span className="font-medium">Optional, not set:</span>
                      {missing.optional.map((n) => (
                        <code key={n} className="rounded bg-surface px-1.5 py-0.5">
                          {n}
                        </code>
                      ))}
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  <RunJobForm
                    label="Run now"
                    action={runJobAction.bind(null, name)}
                    vacancies={required?.name === "vacancy" ? vacancies : undefined}
                    showLimit={!required}
                    disabledReason={
                      noDbReason ??
                      (missing.required.length > 0 ? `Missing: ${missing.required.join(", ")}` : null)
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

async function RunHistory({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const jobName = typeof params.job === "string" && jobs[params.job] ? params.job : undefined;
  const status = isJobStatus(params.status) ? params.status : undefined;
  const runs = await listJobRuns({ jobName, status, limit: 100 });

  return (
    <section aria-labelledby="history-title" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="history-title" className="font-display text-lg font-semibold text-brand-900">
            History
          </h2>
          <p className="text-sm text-muted">The last 100 runs, newest first.</p>
        </div>
        <Form action="/dashboard/jobs" className="flex items-center gap-2 max-md:justify-between">
          <p className="text-sm text-muted md:hidden">
            {[jobName, status ? optionFor(jobStatuses, status).label : null].filter(Boolean).join(", ") || "All runs"}
          </p>
          <FilterSheet activeCount={[jobName, status].filter(Boolean).length} resetHref="/dashboard/jobs" title="Filter runs">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <label htmlFor="history-job" className="sr-only max-md:not-sr-only max-md:text-sm max-md:font-medium max-md:text-ink">
                Job
              </label>
              <Select id="history-job" name="job" defaultValue={jobName ?? ""} className="md:w-56">
                <option value="">All jobs</option>
                {Object.keys(jobs).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
              <label htmlFor="history-status" className="sr-only max-md:not-sr-only max-md:mt-2 max-md:text-sm max-md:font-medium max-md:text-ink">
                Status
              </label>
              <Select id="history-status" name="status" defaultValue={status ?? ""} className="md:w-40">
                <option value="">Any status</option>
                {jobStatuses.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="secondary" className="max-md:hidden">
                Filter
              </Button>
            </div>
          </FilterSheet>
        </Form>
      </div>

      {runs.length === 0 ? (
        <EmptyState
          icon={jobName || status ? History : Workflow}
          title={jobName || status ? "No runs found" : "No runs yet"}
          description={
            jobName || status
              ? "No runs match this filter."
              : "As soon as a job runs, on schedule or with Run now, it appears here."
          }
        />
      ) : (
        <>
          <MobileList label="Runs" className="md:hidden">
            {runs.map((run) => {
              const option = optionFor(jobStatuses, run.status);
              return (
                <MobileListItem
                  key={run.id}
                  title={<span className="font-mono text-sm">{run.jobName}</span>}
                  subtitle={`${formatDateTime(run.startedAt)}, ${formatDuration(run.durationMs)}`}
                  meta={`${triggerLabel(run.triggeredBy)}, ${run.recordsIn} in, ${run.recordsOut} out`}
                  trailing={<Badge tone={option.tone}>{option.label}</Badge>}
                >
                  {run.errorFirstLine && <p className="mb-1 text-sm break-words text-danger">{run.errorFirstLine}</p>}
                  {(run.log.length > 0 || run.error) && <RunLog run={run} />}
                </MobileListItem>
              );
            })}
          </MobileList>
          <Table className="hidden md:block">
            <THead>
              <tr>
                <TH>Job</TH>
                <TH>Status</TH>
                <TH>Started</TH>
                <TH>Duration</TH>
                <TH className="text-right">In</TH>
                <TH className="text-right">Out</TH>
                <TH>Details</TH>
              </tr>
            </THead>
            <TBody>
              {runs.map((run) => {
                const option = optionFor(jobStatuses, run.status);
                return (
                  <TR key={run.id} className="align-top">
                    <TD>
                      <span className="font-mono text-xs font-semibold">{run.jobName}</span>
                      <p className="text-xs text-muted">
                        {triggerLabel(run.triggeredBy)}
                      </p>
                    </TD>
                    <TD>
                      <Badge tone={option.tone}>{option.label}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-muted">{formatDateTime(run.startedAt)}</TD>
                    <TD className="whitespace-nowrap text-muted">{formatDuration(run.durationMs)}</TD>
                    <TD className="text-right tabular-nums">{run.recordsIn}</TD>
                    <TD className="text-right tabular-nums">{run.recordsOut}</TD>
                    <TD className="max-w-md">
                      {run.errorFirstLine && <p className="mb-1 text-sm text-danger">{run.errorFirstLine}</p>}
                      {run.log.length > 0 || run.error ? (
                        <RunLog run={run} />
                      ) : (
                        !run.errorFirstLine && <span className="text-sm text-muted">No log</span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </>
      )}
    </section>
  );
}
