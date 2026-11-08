"use client";

import { startTransition, useActionState, useCallback, useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import {
  Ban,
  ListChecks,
  LoaderCircle,
  PauseCircle,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import { linkCandidateToVacancy } from "@/app/dashboard/candidates/actions";
import { removeApplication, updateApplication } from "@/app/dashboard/vacancies/[id]/pipeline/actions";
import { loadApplicationExtras, setShortlisted } from "@/app/dashboard/vacancies/[id]/pipeline/recruitment-actions";
import { initialActionState } from "@/lib/action-state";
import type { CandidateOption } from "@/lib/data/candidates";
import type { ApplicationExtras } from "@/lib/data/recruitment";
import type { StaffMember } from "@/lib/data/tasks";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  applicationStages,
  candidateOrigins,
  candidateSources,
  candidateStatuses,
  clientDecisions,
  cvVerdicts,
  optionFor,
} from "@/lib/labels";
import { formStatus, isExitStage } from "@/lib/recruitment/pipeline";
import { ConfirmButton } from "@/components/candidates/confirm-button";
import { CompensationSection } from "@/components/forms/compensation-section";
import { PlanInterviewButton } from "@/components/interviews/plan-interview-button";
import type { InterviewerOption } from "@/lib/data/interviews";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { DetailList } from "@/components/ui/card";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { CustomFieldsPanel } from "@/components/custom-fields/custom-fields-panel";
import { AssessmentPanel, BackgroundCheckPanel } from "./assessment-panel";
import type { BoardCard, CardAction } from "./pipeline-card";
import { StageNoteForm } from "./stage-note-form";
import { StageNoteList } from "./stage-note-list";
import { PRESENTED_STAGES } from "./stages";

type Tab = "assessment" | "notes" | "background" | "client";

const tabs: { value: Tab; label: string }[] = [
  { value: "assessment", label: "Assessment" },
  { value: "notes", label: "Notes" },
  { value: "background", label: "Background check" },
  { value: "client", label: "Client, notes and fields" },
];

/** Details of one card: assessment, notes per stage, background check, client feedback and removal. */
export function ApplicationModal({
  card,
  staff,
  interviewers = [],
  onClose,
  onAction,
}: {
  card: BoardCard | null;
  staff: StaffMember[];
  interviewers?: InterviewerOption[];
  onClose: () => void;
  /** Park, reject, resume: handled by the board with the same modal as there. */
  onAction: (id: string, action: CardAction) => void;
}) {
  return (
    <Modal
      open={!!card}
      onClose={onClose}
      title={card?.candidate.full_name ?? "Candidate"}
      description={card?.candidate.current_title ?? undefined}
      size="lg"
    >
      {card && <ApplicationDetails key={card.id} card={card} staff={staff} interviewers={interviewers} onClose={onClose} onAction={onAction} />}
    </Modal>
  );
}

function useExtras(applicationId: string) {
  const [extras, setExtras] = useState<ApplicationExtras | null>(null);
  const [error, setError] = useState<string>();
  const reload = useCallback(() => {
    void loadApplicationExtras(applicationId).then((result) => {
      if ("error" in result) setError(result.error);
      else {
        setError(undefined);
        setExtras(result);
      }
    });
  }, [applicationId]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { extras, error, reload };
}

function ApplicationDetails({
  card,
  staff,
  interviewers,
  onClose,
  onAction,
}: {
  card: BoardCard;
  staff: StaffMember[];
  interviewers: InterviewerOption[];
  onClose: () => void;
  onAction: (id: string, action: CardAction) => void;
}) {
  const [tab, setTab] = useState<Tab>(card.stage === "final_screening" ? "background" : "assessment");
  const [shortlistPending, startShortlist] = useTransition();
  const [shortlistError, setShortlistError] = useState<string>();
  const { extras, error: extrasError, reload } = useExtras(card.id);
  const stage = optionFor(applicationStages, card.stage);
  const exit = isExitStage(card.stage);
  const form = formStatus(card);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={stage.tone}>{stage.label}</Badge>
        {card.candidate.is_topper && (
          <Badge tone="warning">
            <Star className="size-3 fill-amber-400 text-amber-500" aria-hidden="true" />
            Topper
          </Badge>
        )}
        <Badge tone={optionFor(candidateOrigins, card.origin).tone}>{optionFor(candidateOrigins, card.origin).label}</Badge>
        {card.source && <Badge>{optionFor(candidateSources, card.source).label}</Badge>}
        <span className="text-sm text-muted">
          {card.daysInPipeline === 1 ? "1 day" : `${card.daysInPipeline} days`} in the pipeline
        </span>
        <Link
          href={`/dashboard/candidates/${card.candidate.id}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded text-sm font-medium text-brand-700 hover:underline pointer-coarse:min-h-10 focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <UserRound className="size-4" aria-hidden="true" />
          Go to candidate
        </Link>
      </div>

      <DetailList
        items={[
          {
            label: "CV score",
            value:
              card.cv_score !== null
                ? `${card.cv_score}${card.cv_verdict ? `, ${optionFor(cvVerdicts, card.cv_verdict).label.toLowerCase()}` : ""}`
                : null,
          },
          {
            label: "Form",
            value:
              form === "completed"
                ? `Completed ${formatDate(card.form_completed_at)}`
                : form === "sent"
                  ? `Sent ${formatDate(card.form_sent_at)}, not completed yet`
                  : "Not sent",
          },
          { label: "Interview planned", value: card.interview_at ? formatDateTime(card.interview_at) : null },
          ...(card.candidate.is_topper && card.candidate.topper_reason
            ? [{ label: "Why a topper", value: card.candidate.topper_reason }]
            : []),
        ]}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          variant={card.shortlisted_at ? "primary" : "secondary"}
          size="sm"
          aria-pressed={!!card.shortlisted_at}
          disabled={shortlistPending}
          onClick={() =>
            startShortlist(async () => {
              const result = await setShortlisted(card.id, !card.shortlisted_at);
              setShortlistError(result.error);
            })
          }
        >
          {shortlistPending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ListChecks aria-hidden="true" />}
          {card.shortlisted_at ? `Shortlisted ${formatDate(card.shortlisted_at)}` : "Add to shortlist"}
        </Button>
        <PlanInterviewButton applications={[{ id: card.id, label: "This vacancy" }]} interviewers={interviewers} />
        {exit ? (
          <Button variant="secondary" size="sm" onClick={() => onAction(card.id, "resume")}>
            <RotateCcw aria-hidden="true" />
            Resume{card.exit_from_stage ? ` in ${optionFor(applicationStages, card.exit_from_stage).label}` : ""}
          </Button>
        ) : null}
        {card.stage !== "parked" && (
          <Button variant="secondary" size="sm" onClick={() => onAction(card.id, "park")}>
            <PauseCircle aria-hidden="true" />
            Park
          </Button>
        )}
        {card.stage !== "rejected" && (
          <Button variant="secondary" size="sm" onClick={() => onAction(card.id, "reject")}>
            <Ban aria-hidden="true" />
            Reject
          </Button>
        )}
      </div>
      {shortlistError && <FormMessage error={shortlistError} />}

      <div role="tablist" aria-label="Sections" className="-mx-1 flex snap-strip scrollbar-none gap-1 overflow-x-auto px-1">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={`tab-${t.value}`}
            aria-selected={tab === t.value}
            aria-controls={`panel-${t.value}`}
            onClick={() => setTab(t.value)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition pointer-coarse:min-h-10 focus-visible:outline-2 focus-visible:outline-brand-500 ${
              tab === t.value ? "bg-brand-900 text-white" : "bg-surface text-ink hover:bg-brand-50"
            }`}
          >
            {t.label}
            {t.value === "notes" && extras && extras.notes.length > 0 && (
              <span className="ml-1 tabular-nums opacity-75">{extras.notes.length}</span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {extrasError && <FormMessage error={extrasError} />}
        {tab === "assessment" && (
          <AssessmentPanel card={card} staff={staff} files={extras?.files ?? null} onFilesChange={reload} />
        )}
        {tab === "notes" && (
          <div className="space-y-5">
            <StageNoteForm applicationId={card.id} stageLabel={stage.label} onSaved={reload} />
            {extras ? <StageNoteList notes={extras.notes} /> : <p className="text-sm text-muted">Loading notes...</p>}
          </div>
        )}
        {tab === "background" &&
          (extras ? (
            <BackgroundCheckPanel card={card} files={extras.files} onFilesChange={reload} />
          ) : (
            <p className="text-sm text-muted">Loading...</p>
          ))}
        {tab === "client" && (
          <div className="space-y-5">
            <ClientAndNotes card={card} />
            <CustomFieldsPanel entity="application" recordId={card.id} />
          </div>
        )}
      </div>

      <CompensationSection applicationId={card.id} />

      <div className="flex justify-start border-t border-border pt-4">
        <ConfirmButton
          variant="ghost"
          size="sm"
          title="Remove from the pipeline?"
          description={`${card.candidate.full_name} is removed from this board, including scores and feedback for this vacancy. The candidate profile stays.`}
          confirmLabel="Yes, remove from pipeline"
          action={() => removeApplication(card.id)}
          onDone={onClose}
        >
          <Trash2 aria-hidden="true" />
          Remove from pipeline
        </ConfirmButton>
      </div>
    </div>
  );
}

/** Client verdict, general assessment notes and the park or rejection reason. */
function ClientAndNotes({ card }: { card: BoardCard }) {
  const [state, formAction, pending] = useActionState(updateApplication, initialActionState);
  const errors = state.fieldErrors ?? {};
  const decision = optionFor(clientDecisions, card.client_decision);
  const presented = PRESENTED_STAGES.includes(card.stage) || !!card.presented_at;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <div className="space-y-5">
      <section aria-labelledby="client-heading" className="rounded-xl border border-border bg-surface/60 p-4">
        <h3 id="client-heading" className="mb-3 font-display text-sm font-semibold text-brand-900">
          Client verdict
        </h3>
        {presented ? (
          <DetailList
            items={[
              { label: "Presented on", value: card.presented_at ? formatDate(card.presented_at) : null },
              { label: "Decision", value: <Badge tone={decision.tone}>{decision.label}</Badge> },
              { label: "Decided on", value: card.client_decided_at ? formatDateTime(card.client_decided_at) : null },
              {
                label: "Feedback",
                value: card.client_feedback ? <span className="whitespace-pre-line">{card.client_feedback}</span> : null,
              },
            ]}
          />
        ) : (
          <p className="text-sm text-muted">
            Not presented yet. The client only sees this candidate from the Matched to client stage.
          </p>
        )}
      </section>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <input type="hidden" name="id" value={card.id} />
        <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
        <Field label="General assessment notes" htmlFor="assessment_notes" error={errors.assessment_notes}>
          <Textarea
            id="assessment_notes"
            name="assessment_notes"
            rows={4}
            maxLength={5000}
            placeholder="Anything that does not fit the sections of the assessment."
            defaultValue={card.assessment_notes ?? ""}
          />
        </Field>
        {card.stage === "parked" && (
          <Field label="Park reason" htmlFor="park_reason" hint="For internal use only." error={errors.park_reason}>
            <Textarea id="park_reason" name="park_reason" rows={2} maxLength={2000} defaultValue={card.park_reason ?? ""} />
          </Field>
        )}
        {(card.stage === "rejected" || card.rejection_reason) && (
          <Field label="Rejection reason" htmlFor="rejection_reason" hint="For internal use only." error={errors.rejection_reason}>
            <Textarea
              id="rejection_reason"
              name="rejection_reason"
              rows={2}
              maxLength={2000}
              defaultValue={card.rejection_reason ?? ""}
            />
          </Field>
        )}
        <div className="flex justify-end max-sm:*:flex-1">
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            Save
          </Button>
        </div>
      </form>

      {card.stage === "placed" && (
        <div className="flex flex-col gap-3 rounded-xl border border-emerald-600/20 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-emerald-800">Placed. Record the placement for contract and payroll.</p>
          <ButtonLink href={`/dashboard/placements/new?application=${card.id}`} size="sm">
            Record placement
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

/** "Kandidaat toevoegen": search existing candidates or create a new one. */
export function AddCandidateModal({
  open,
  onClose,
  vacancyId,
  candidates,
  onBoardIds,
}: {
  open: boolean;
  onClose: () => void;
  vacancyId: string;
  candidates: CandidateOption[];
  onBoardIds: Set<string>;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add candidate"
      description="The candidate enters the Sourced stage."
      size="lg"
    >
      {open && <AddCandidateList vacancyId={vacancyId} candidates={candidates} onBoardIds={onBoardIds} />}
    </Modal>
  );
}

function AddCandidateList({
  vacancyId,
  candidates,
  onBoardIds,
}: {
  vacancyId: string;
  candidates: CandidateOption[];
  onBoardIds: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [, startAdding] = useTransition();

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    return candidates
      .filter((c) => !onBoardIds.has(c.id) && !added.includes(c.id))
      .filter(
        (c) =>
          !term ||
          c.full_name.toLowerCase().includes(term) ||
          (c.current_title ?? "").toLowerCase().includes(term) ||
          c.skills.some((s) => s.toLowerCase().includes(term)),
      )
      .slice(0, 50);
  }, [candidates, onBoardIds, added, query]);

  function add(candidateId: string) {
    setError(undefined);
    setPendingId(candidateId);
    startAdding(async () => {
      const formData = new FormData();
      formData.set("candidate_id", candidateId);
      formData.set("vacancy_id", vacancyId);
      const result = await linkCandidateToVacancy(initialActionState, formData);
      setPendingId(null);
      if (result.error) setError(result.error);
      else setAdded((ids) => [...ids, candidateId]);
    });
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <label htmlFor="add-candidate-search" className="sr-only">
          Search by name, title or skill
        </label>
        <Input
          id="add-candidate-search"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, title or skill"
          className="pl-10"
          autoFocus
        />
      </div>

      <FormMessage error={error} success={added.length > 0 ? `${added.length} added to the pipeline.` : undefined} />

      {results.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          {query ? "No candidates found." : "All candidates are already on this board."}
        </p>
      ) : (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {results.map((c) => {
            const status = optionFor(candidateStatuses, c.status);
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar name={c.full_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{c.full_name}</p>
                  <p className="truncate text-xs text-muted">
                    {c.current_title ?? "Title unknown"}
                    {c.years_experience !== null && `, ${c.years_experience} yrs`}
                    {c.skills.length > 0 && `. ${c.skills.slice(0, 3).join(", ")}`}
                  </p>
                </div>
                <span className="hidden sm:inline-flex">
                  <Badge tone={status.tone}>{status.label}</Badge>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => add(c.id)}
                  disabled={pendingId !== null}
                  aria-label={`Add ${c.full_name}`}
                >
                  {pendingId === c.id ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus aria-hidden="true" />
                  )}
                  <span className="hidden sm:inline">Add</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-sm text-muted">
        Candidate not in the list yet?{" "}
        <Link
          href={`/dashboard/candidates/new?vacature=${vacancyId}`}
          className="font-medium text-brand-700 hover:underline"
        >
          Create a new candidate
        </Link>
        . They are then added straight to this board.
      </p>
    </div>
  );
}
