import type { Metadata } from "next";
import { Suspense } from "react";
import Form from "next/form";
import { History, KeyRound, TriangleAlert, Workflow } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { RunJobForm } from "@/components/jobs/run-job-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
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
import { runJobAction } from "./actions";

export const metadata: Metadata = {
  title: "Jobs",
};

// A manual run waits for the job (or a whole chain) to finish.
export const maxDuration = 300;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatDuration(ms: number | null) {
  if (ms === null) return "Loopt nog";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${seconds % 60} s`;
}

function StatusBadge({ run }: { run: JobRunItem | undefined }) {
  if (!run) return <Badge tone="neutral">Nog nooit gedraaid</Badge>;
  const option = optionFor(jobStatuses, run.status);
  return <Badge tone={option.tone}>{option.label}</Badge>;
}

export default function Page({ searchParams }: PageProps<"/dashboard/jobs">) {
  return (
    <>
      <PageHeader
        eyebrow="Beheer"
        title="Jobs"
        description="De geplande scripts van de salesflow. Elke run komt in de historie; bij een fout krijgt Julius een mail."
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
  const names = Object.keys(jobs);
  const needsVacancy = names.some((n) => JOB_REQUIRED_PARAMS[n]?.name === "vacancy");
  const [lastRuns, vacancies] = await Promise.all([
    getLastRuns(names),
    needsVacancy ? listVacancyOptions() : Promise.resolve([]),
  ]);
  const dbReady = hasJobDb();
  const noDbReason = dbReady ? null : "SUPABASE_SECRET_KEY ontbreekt";

  return (
    <div className="mb-8 space-y-6">
      {!dbReady && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-danger/20 bg-danger-bg px-5 py-4 text-sm text-danger"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            <strong className="font-semibold">SUPABASE_SECRET_KEY ontbreekt op de server.</strong> Jobs schrijven met de
            service role en kunnen zonder deze sleutel niet draaien, ook niet vanaf deze pagina. Zet hem in de omgeving
            van de app en van GitHub Actions.
          </p>
        </div>
      )}
      {!hasMail() && (
        <p className="flex items-start gap-3 rounded-2xl border border-amber-600/20 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <KeyRound className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          RESEND_API_KEY ontbreekt: foutmeldingen en het weekrapport worden niet gemaild. Kijk hier dus zelf of de jobs
          gelukt zijn.
        </p>
      )}

      <Card>
        <CardHeader title="Ketens" description="Draaien op schema via GitHub Actions. Een keten draait de jobs na elkaar." />
        <ul className="divide-y divide-border">
          {Object.entries(chains).map(([name, chain]) => (
            <li key={name} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-ink capitalize">{name}</p>
                <p className="text-sm text-muted">{chain.description}</p>
                <p className="text-xs text-muted">
                  {chain.jobs.join(", ")}
                  {chain.stopOnFailure ? ". Stopt bij de eerste fout." : ". Gaat door na een fout."}
                </p>
              </div>
              <div className="shrink-0">
                <RunJobForm
                  label="Keten draaien"
                  action={runJobAction.bind(null, name)}
                  disabledReason={noDbReason}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Losse jobs" description="Laatste run per job, en ontbrekende sleutels." />
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
                      Laatst {formatRelativeDays(run.startedAt)} om {formatDateTime(run.startedAt)}, {run.recordsIn} in,{" "}
                      {run.recordsOut} uit, {formatDuration(run.durationMs)}
                      {run.status === "failed" && run.errorFirstLine ? `. Fout: ${run.errorFirstLine}` : ""}
                    </p>
                  )}
                  {missing.required.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-danger">
                      <span className="font-medium">Ontbreekt:</span>
                      {missing.required.map((n) => (
                        <code key={n} className="rounded bg-danger-bg px-1.5 py-0.5">
                          {n}
                        </code>
                      ))}
                    </p>
                  )}
                  {missing.optional.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span className="font-medium">Optioneel, niet gezet:</span>
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
                    label="Nu draaien"
                    action={runJobAction.bind(null, name)}
                    vacancies={required?.name === "vacancy" ? vacancies : undefined}
                    showLimit={!required}
                    disabledReason={
                      noDbReason ??
                      (missing.required.length > 0 ? `Ontbreekt: ${missing.required.join(", ")}` : null)
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
            Historie
          </h2>
          <p className="text-sm text-muted">De laatste 100 runs, nieuwste eerst.</p>
        </div>
        <Form action="/dashboard/jobs" className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="history-job" className="sr-only">
            Job
          </label>
          <Select id="history-job" name="job" defaultValue={jobName ?? ""} className="sm:w-56">
            <option value="">Alle jobs</option>
            {Object.keys(jobs).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <label htmlFor="history-status" className="sr-only">
            Status
          </label>
          <Select id="history-status" name="status" defaultValue={status ?? ""} className="sm:w-40">
            <option value="">Elke status</option>
            {jobStatuses.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            Filteren
          </Button>
        </Form>
      </div>

      {runs.length === 0 ? (
        <EmptyState
          icon={jobName || status ? History : Workflow}
          title={jobName || status ? "Geen runs gevonden" : "Nog geen runs"}
          description={
            jobName || status
              ? "Geen runs met dit filter."
              : "Zodra een job draait, op schema of met Nu draaien, staat hij hier."
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Job</TH>
              <TH>Status</TH>
              <TH>Gestart</TH>
              <TH>Duur</TH>
              <TH className="text-right">In</TH>
              <TH className="text-right">Uit</TH>
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
                      {run.triggeredBy.startsWith("user:") ? "Handmatig" : run.triggeredBy === "schedule" ? "Schema" : run.triggeredBy}
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
                      <details className="group">
                        <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
                          Log bekijken ({run.log.length} regels)
                        </summary>
                        <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-brand-950 p-3 text-xs leading-relaxed whitespace-pre-wrap text-brand-50">
                          {run.log.join("\n")}
                          {run.error ? `${run.log.length > 0 ? "\n\n" : ""}${run.error}` : ""}
                        </pre>
                      </details>
                    ) : (
                      !run.errorFirstLine && <span className="text-sm text-muted">Geen log</span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </section>
  );
}
