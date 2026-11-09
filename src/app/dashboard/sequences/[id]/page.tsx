import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArrowLeft, Pause, Play, RotateCcw, Square, Users } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { ActionButton } from "@/components/sales/action-button";
import { AddStepForm } from "@/components/sequences/add-step-form";
import { channelLabel, enrollmentStatuses } from "@/components/sequences/channel";
import { SequenceForm } from "@/components/sequences/sequence-form";
import { StartSequenceForm } from "@/components/sequences/start-form";
import { StepCard } from "@/components/sequences/step-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { getSequence, type SequenceDetail, type SequenceEnrollment } from "@/lib/data/sequences";
import { formatDate } from "@/lib/format";
import { sequenceStatuses } from "@/lib/sales/labels";
import {
  addStepAction,
  approveDraftAction,
  deleteStepAction,
  moveStepAction,
  rejectDraftAction,
  searchCompaniesAction,
  setEnrollmentStatusAction,
  setSequenceStatusAction,
  startSequenceAction,
  updateSequenceAction,
  updateStepAction,
} from "../actions";

export const metadata: Metadata = {
  title: "Sequence",
};

export default function Page({ params }: PageProps<"/dashboard/sequences/[id]">) {
  return (
    <>
      <Link
        href="/dashboard/sequences"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-700 pointer-coarse:mb-2 pointer-coarse:min-h-11"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All sequences
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <Detail params={params} />
      </Suspense>
    </>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Detail({ params }: { params: PageProps<"/dashboard/sequences/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sequence = await getSequence(id);
  if (!sequence) notFound();
  const status = sequenceStatuses.find((s) => s.value === sequence.status);
  const lastDay = Math.max(0, ...sequence.steps.map((s) => s.dayOffset));

  return (
    <>
      <PageHeader
        eyebrow="Sequence"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {sequence.name}
            <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? sequence.status}</Badge>
          </span>
        }
        description={sequence.description ?? undefined}
        actions={<StatusActions sequence={sequence} />}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="steps-title" className="min-w-0 space-y-4">
          <div>
            <h2 id="steps-title" className="font-display text-lg font-semibold text-brand-900">
              Steps
            </h2>
            <p className="text-sm text-muted">
              In the order they are sent. Mail and LinkedIn need an approved text; a call step lands in the call queue on its day.
            </p>
          </div>
          {sequence.steps.length === 0 ? (
            <EmptyState icon={Play} title="No steps yet" description="Add the first step: a mail on day 0, for example." />
          ) : (
            <ol className="space-y-4">
              {sequence.steps.map((step, i) => (
                <StepCard
                  key={step.id}
                  step={step}
                  index={i}
                  isFirst={i === 0}
                  isLast={i === sequence.steps.length - 1}
                  updateAction={updateStepAction.bind(null, sequence.id, step.id)}
                  approveAction={approveDraftAction.bind(null, sequence.id, step.id)}
                  rejectAction={rejectDraftAction.bind(null, sequence.id, step.id)}
                  moveUpAction={moveStepAction.bind(null, sequence.id, step.id, "up")}
                  moveDownAction={moveStepAction.bind(null, sequence.id, step.id, "down")}
                  deleteAction={deleteStepAction.bind(null, sequence.id, step.id)}
                />
              ))}
            </ol>
          )}
          {sequence.status !== "archived" && (
            <AddStepForm action={addStepAction.bind(null, sequence.id)} nextDay={sequence.steps.length ? lastDay + 2 : 0} />
          )}
        </section>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Start for companies" description="Every step becomes a task on its day; the company goes to In sequence." />
            <CardBody>
              <StartSequenceForm
                action={startSequenceAction.bind(null, sequence.id)}
                search={searchCompaniesAction}
                disabledReason={startBlocker(sequence)}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Name and description" />
            <CardBody>
              <SequenceForm
                action={updateSequenceAction.bind(null, sequence.id)}
                defaults={{ name: sequence.name, description: sequence.description }}
                submitLabel="Save"
              />
            </CardBody>
          </Card>
        </div>
      </div>

      <Enrollments sequence={sequence} />
    </>
  );
}

function startBlocker(sequence: SequenceDetail): string | null {
  if (sequence.status === "archived") return "This sequence is archived.";
  if (sequence.steps.length === 0) return "Add steps first.";
  if (sequence.status !== "active") return "Activate the sequence first (button at the top).";
  if (sequence.unapproved > 0) {
    return `Approve the texts first: ${sequence.unapproved} mail or LinkedIn ${sequence.unapproved === 1 ? "step has" : "steps have"} no approved text.`;
  }
  return null;
}

function StatusActions({ sequence }: { sequence: SequenceDetail }) {
  const set = (status: string) => setSequenceStatusAction.bind(null, sequence.id, status);
  return (
    <>
      {sequence.status !== "active" && (
        <ActionButton action={set("active")} variant="primary" size="md">
          <Play aria-hidden="true" />
          Activate
        </ActionButton>
      )}
      {sequence.status === "active" && (
        <ActionButton action={set("draft")} size="md">
          <RotateCcw aria-hidden="true" />
          Back to draft
        </ActionButton>
      )}
      {sequence.status !== "archived" && (
        <ActionButton
          action={set("archived")}
          size="md"
          confirm="Archive this sequence? Running enrollments keep their tasks; you can no longer start it."
        >
          <Archive aria-hidden="true" />
          Archive
        </ActionButton>
      )}
    </>
  );
}

function nextTask(e: SequenceEnrollment) {
  return e.tasks.find((t) => t.status === "open");
}

function Enrollments({ sequence }: { sequence: SequenceDetail }) {
  const set = (enrollmentId: string, status: string) => setEnrollmentStatusAction.bind(null, sequence.id, enrollmentId, status);
  return (
    <section aria-labelledby="enrollments-title" className="mt-10 space-y-4">
      <div>
        <h2 id="enrollments-title" className="font-display text-lg font-semibold text-brand-900">
          Enrolled companies
        </h2>
        <p className="text-sm text-muted">
          A reply on any channel pauses the company automatically. Pausing removes the open call steps; Claude pauses mail and
          LinkedIn in Instantly and Seleqt.
        </p>
      </div>
      {sequence.enrollments.length === 0 ? (
        <EmptyState icon={Users} title="Nobody enrolled yet" description="Start the sequence for one or more companies." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
          {sequence.enrollments.map((e) => {
            const option = enrollmentStatuses.find((s) => s.value === e.status);
            const next = nextTask(e);
            const doneCount = e.tasks.filter((t) => t.status === "done").length;
            return (
              <li key={e.id} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {e.company ? (
                      <Link href={`/dashboard/leads/${e.company.id}`} className="font-medium text-brand-900 hover:text-brand-600 hover:underline">
                        {e.company.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-muted">Company removed</span>
                    )}
                    <Badge tone={option?.tone ?? "neutral"}>{option?.label ?? e.status}</Badge>
                    {e.source === "claude" && <Badge tone="accent">By Claude</Badge>}
                  </div>
                  <p className="text-sm text-muted">
                    {e.contact ? `${e.contact.name}, ` : ""}started {formatDate(e.startedAt)}. {doneCount} of {e.tasks.length} steps done
                    {next ? `, next: ${channelLabel(next.channel)} on ${formatDate(next.dueDate)}` : ""}.
                  </p>
                  {e.pauseReason && e.status !== "active" && <p className="text-xs text-muted">Reason: {e.pauseReason}</p>}
                  {e.tasks.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline pointer-coarse:min-h-11 pointer-coarse:flex pointer-coarse:items-center">
                        Step tasks
                      </summary>
                      <ul className="mt-2 space-y-1 text-sm">
                        {e.tasks.map((t) => (
                          <li key={t.id} className="flex flex-wrap items-center gap-2">
                            <span className="w-24 shrink-0 text-muted tabular-nums">{formatDate(t.dueDate)}</span>
                            <span className="text-ink">{channelLabel(t.channel)}</span>
                            <Badge tone={t.status === "done" ? "success" : t.status === "open" ? "brand" : "neutral"}>
                              {t.status === "open" ? "Open" : t.status === "done" ? "Done" : t.status === "skipped" ? "Skipped" : "Cancelled"}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                {(e.status === "active" || e.status === "paused") && (
                  <div className="flex flex-wrap gap-2">
                    {e.status === "active" ? (
                      <ActionButton action={set(e.id, "paused")} className="pointer-coarse:min-h-11">
                        <Pause aria-hidden="true" />
                        Pause
                      </ActionButton>
                    ) : (
                      <ActionButton action={set(e.id, "active")} className="pointer-coarse:min-h-11">
                        <Play aria-hidden="true" />
                        Resume
                      </ActionButton>
                    )}
                    <ActionButton
                      action={set(e.id, "stopped")}
                      className="pointer-coarse:min-h-11"
                      confirm="Stop this enrollment? Its open steps are cancelled."
                    >
                      <Square aria-hidden="true" />
                      Stop
                    </ActionButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-8 h-12 w-72" />
      <ListSkeleton rows={4} />
    </div>
  );
}
