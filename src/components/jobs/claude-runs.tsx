import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listClaudeRuns, type JobRunItem } from "@/lib/data/jobs";
import { formatDateTime, formatRelativeDays } from "@/lib/format";
import { jobStatuses, optionFor } from "@/lib/labels";

function StatusBadge({ run }: { run: JobRunItem }) {
  const option = optionFor(jobStatuses, run.status);
  return <Badge tone={option.tone}>{option.label}</Badge>;
}

function Meta({ run }: { run: JobRunItem }) {
  if (run.metaSummary.length === 0) return <span className="text-sm text-muted">No details</span>;
  return (
    <ul className="space-y-0.5 text-xs text-muted">
      {run.metaSummary.map((line) => (
        <li key={line} className="break-words">
          {line}
        </li>
      ))}
    </ul>
  );
}

/**
 * The log of Claude's scheduled tasks (docs/claude-jobs.md). Claude starts
 * and finishes every run with the MCP tool log_job_run; the portal itself
 * does not run them.
 */
export async function ClaudeRuns() {
  const { latest, runs } = await listClaudeRuns(50);
  return (
    <section aria-labelledby="claude-runs-title" className="mb-8 space-y-4">
      <div>
        <h2 id="claude-runs-title" className="flex items-center gap-2 font-display text-lg font-semibold text-brand-900">
          <Bot className="size-5 text-brand-600" aria-hidden="true" />
          Claude&apos;s scheduled tasks
        </h2>
        <p className="text-sm text-muted">
          Cal.com bookings, replies from Instantly and Seleqt, sequences, new companies, ICP verdicts, matching, CV
          scores and the other requests for its judgement. Claude runs these
          on its own schedule through the MCP and logs every run here; a run that keeps saying Running did not finish.
        </p>
      </div>

      {runs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-brand-200 bg-card px-5 py-8 text-center text-sm text-muted">
          No runs logged yet. Set up the scheduled tasks with the prompts in docs/claude-jobs.md.
        </p>
      ) : (
        <>
          <Card>
            <CardHeader title="Last run per task" />
            <ul className="divide-y divide-border">
              {latest.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-ink">{run.jobName}</p>
                    <p className="text-xs text-muted">
                      {formatRelativeDays(run.startedAt)} at {formatDateTime(run.startedAt)}, {run.recordsIn} in, {run.recordsOut} out
                      {run.status === "failed" && run.errorFirstLine ? `. Error: ${run.errorFirstLine}` : ""}
                    </p>
                  </div>
                  <StatusBadge run={run} />
                </li>
              ))}
            </ul>
          </Card>

          <MobileList label="Runs of Claude's tasks" className="md:hidden">
            {runs.map((run) => (
              <MobileListItem
                key={run.id}
                title={<span className="font-mono text-sm">{run.jobName}</span>}
                subtitle={`${formatDateTime(run.startedAt)}${run.finishedAt ? ` to ${formatDateTime(run.finishedAt)}` : ""}`}
                meta={`${run.recordsIn} in, ${run.recordsOut} out`}
                trailing={<StatusBadge run={run} />}
              >
                {run.errorFirstLine && <p className="mb-1 text-sm break-words text-danger">{run.errorFirstLine}</p>}
                <Meta run={run} />
              </MobileListItem>
            ))}
          </MobileList>
          <Table className="hidden md:block">
            <THead>
              <tr>
                <TH>Task</TH>
                <TH>Status</TH>
                <TH>Started</TH>
                <TH>Finished</TH>
                <TH className="text-right">In</TH>
                <TH className="text-right">Out</TH>
                <TH>Details</TH>
              </tr>
            </THead>
            <TBody>
              {runs.map((run) => (
                <TR key={run.id} className="align-top">
                  <TD>
                    <span className="font-mono text-xs font-semibold">{run.jobName}</span>
                  </TD>
                  <TD>
                    <StatusBadge run={run} />
                  </TD>
                  <TD className="whitespace-nowrap text-muted">{formatDateTime(run.startedAt)}</TD>
                  <TD className="whitespace-nowrap text-muted">{run.finishedAt ? formatDateTime(run.finishedAt) : "Not yet"}</TD>
                  <TD className="text-right tabular-nums">{run.recordsIn}</TD>
                  <TD className="text-right tabular-nums">{run.recordsOut}</TD>
                  <TD className="max-w-md">
                    {run.errorFirstLine && <p className="mb-1 text-sm break-words text-danger">{run.errorFirstLine}</p>}
                    <Meta run={run} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </section>
  );
}
