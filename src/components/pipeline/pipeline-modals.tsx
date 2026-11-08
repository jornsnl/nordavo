"use client";

import { startTransition, useActionState, useMemo, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { LoaderCircle, Plus, Search, Trash2, UserRound } from "lucide-react";
import { linkCandidateToVacancy } from "@/app/dashboard/candidates/actions";
import { removeApplication, updateApplication } from "@/app/dashboard/vacancies/[id]/pipeline/actions";
import { initialActionState } from "@/lib/action-state";
import type { CandidateOption } from "@/lib/data/candidates";
import { formatDate, formatDateTime } from "@/lib/format";
import { applicationStages, candidateStatuses, clientDecisions, optionFor } from "@/lib/labels";
import { ConfirmButton } from "@/components/candidates/confirm-button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { DetailList } from "@/components/ui/card";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { CustomFieldsPanel } from "@/components/custom-fields/custom-fields-panel";
import type { BoardCard } from "./pipeline-card";
import { PRESENTED_STAGES } from "./stages";

/** Details of one card: scores, notes, client feedback and removal. */
export function ApplicationModal({
  card,
  onClose,
}: {
  card: BoardCard | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!card}
      onClose={onClose}
      title={card?.candidate.full_name ?? "Candidate"}
      description={card?.candidate.current_title ?? undefined}
      size="lg"
    >
      {card && <ApplicationDetails key={card.id} card={card} onClose={onClose} />}
    </Modal>
  );
}

function ApplicationDetails({ card, onClose }: { card: BoardCard; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(updateApplication, initialActionState);
  const errors = state.fieldErrors ?? {};
  const stage = optionFor(applicationStages, card.stage);
  const decision = optionFor(clientDecisions, card.client_decision);
  const presented = PRESENTED_STAGES.includes(card.stage) || !!card.presented_at;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={stage.tone}>{stage.label}</Badge>
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

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <input type="hidden" name="id" value={card.id} />
        <FormMessage error={state.error} success={state.ok ? state.message : undefined} />
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Field label="Technical score" htmlFor="technical_score" hint="0 to 100" error={errors.technical_score}>
            <Input
              id="technical_score"
              name="technical_score"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              enterKeyHint="next"
              defaultValue={card.technical_score ?? ""}
              aria-invalid={!!errors.technical_score}
              aria-describedby={errors.technical_score ? "technical_score-error" : undefined}
            />
          </Field>
          <Field label="English score" htmlFor="english_score" hint="0 to 100" error={errors.english_score}>
            <Input
              id="english_score"
              name="english_score"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              enterKeyHint="next"
              defaultValue={card.english_score ?? ""}
              aria-invalid={!!errors.english_score}
              aria-describedby={errors.english_score ? "english_score-error" : undefined}
            />
          </Field>
        </div>
        <Field label="Assessment notes" htmlFor="assessment_notes" error={errors.assessment_notes}>
          <Textarea
            id="assessment_notes"
            name="assessment_notes"
            rows={4}
            placeholder="What stood out in the test and the interview?"
            defaultValue={card.assessment_notes ?? ""}
          />
        </Field>
        <Field
          label="Rejection reason"
          htmlFor="rejection_reason"
          hint="For internal use only."
          error={errors.rejection_reason}
        >
          <Textarea
            id="rejection_reason"
            name="rejection_reason"
            rows={2}
            defaultValue={card.rejection_reason ?? ""}
          />
        </Field>
        <div className="flex justify-end max-sm:*:flex-1">
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            Save
          </Button>
        </div>
      </form>

      <CustomFieldsPanel entity="application" recordId={card.id} />

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
                value: card.client_feedback ? (
                  <span className="whitespace-pre-line">{card.client_feedback}</span>
                ) : null,
              },
            ]}
          />
        ) : (
          <p className="text-sm text-muted">
            Not presented yet. The client only sees this candidate from the Presented to client stage.
          </p>
        )}
      </section>

      {card.stage === "placed" && (
        <div className="flex flex-col gap-3 rounded-xl border border-emerald-600/20 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-emerald-800">Placed. Record the placement for contract and payroll.</p>
          <ButtonLink href={`/dashboard/placements/new?application=${card.id}`} size="sm">
            Record placement
          </ButtonLink>
        </div>
      )}

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

/** Asks for an optional reason when a card lands in "rejected". */
export function RejectModal({
  name,
  onConfirm,
  onCancel,
}: {
  name: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={!!name} onClose={onCancel} title="Reject candidate" description={name ?? undefined}>
      {name && <RejectForm onConfirm={onConfirm} onCancel={onCancel} />}
    </Modal>
  );
}

function RejectForm({ onConfirm, onCancel }: { onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm(reason.trim());
      }}
    >
      <Field label="Reason" htmlFor="reject-reason" hint="Optional. Helps with the next selection.">
        <Textarea
          id="reject-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="For example: English not strong enough for client contact."
          autoFocus
        />
      </Field>
      <div className="flex gap-3 max-sm:*:flex-1 sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="danger">
          Reject
        </Button>
      </div>
    </form>
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
