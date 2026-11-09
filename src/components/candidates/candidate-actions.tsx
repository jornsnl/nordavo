"use client";

import { startTransition, useActionState, useMemo, useState, type FormEvent } from "react";
import { Link2, LoaderCircle, Trash2 } from "lucide-react";
import { deleteCandidate, linkCandidateToVacancy } from "@/app/dashboard/candidates/actions";
import { initialActionState } from "@/lib/action-state";
import type { VacancyOption } from "@/lib/data/applications";
import { optionFor, vacancyStatuses } from "@/lib/labels";
import { Button, ButtonLink } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import { Field, FormMessage } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { ConfirmButton } from "./confirm-button";

export function DeleteCandidateButton({ candidateId, name }: { candidateId: string; name: string }) {
  return (
    <ConfirmButton
      title="Delete candidate?"
      description={`${name} is removed from the system, including the CV and all pipelines. You cannot undo this.`}
      confirmLabel="Yes, delete"
      action={() => deleteCandidate(candidateId)}
    >
      <Trash2 aria-hidden="true" />
      Delete
    </ConfirmButton>
  );
}

/** "Link to vacancy": pick an open vacancy and add the candidate in stage sourced. */
export function LinkVacancyButton({
  candidateId,
  vacancies,
  linkedVacancyIds,
}: {
  candidateId: string;
  vacancies: VacancyOption[];
  linkedVacancyIds: string[];
}) {
  const [open, setOpen] = useState(false);
  // Remount the form on every open so the previous result is cleared.
  const [formKey, setFormKey] = useState(0);
  const available = useMemo(
    () => vacancies.filter((v) => !linkedVacancyIds.includes(v.id)),
    [vacancies, linkedVacancyIds],
  );

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <Link2 aria-hidden="true" />
        Link to vacancy
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Link to vacancy"
        description="The candidate enters the Sourced stage of the pipeline."
      >
        <LinkVacancyForm
          key={formKey}
          candidateId={candidateId}
          vacancies={available}
          onClose={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

function LinkVacancyForm({
  candidateId,
  vacancies,
  onClose,
}: {
  candidateId: string;
  vacancies: VacancyOption[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(linkCandidateToVacancy, initialActionState);
  const [vacancyId, setVacancyId] = useState(vacancies[0]?.id ?? "");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  if (state.ok) {
    return (
      <div className="space-y-5">
        <FormMessage success={state.message} />
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <ButtonLink href={`/dashboard/vacancies/${vacancyId}/pipeline`}>Go to pipeline</ButtonLink>
        </div>
      </div>
    );
  }

  if (vacancies.length === 0) {
    return (
      <p className="text-sm text-muted">
        There are no open vacancies this candidate is not already in. Create a vacancy first.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="candidate_id" value={candidateId} />
      <FormMessage error={state.error} />
      <Field label="Vacancy" htmlFor="link-vacancy" required error={state.fieldErrors?.vacancy_id}>
        <SearchSelect
          id="link-vacancy"
          name="vacancy_id"
          value={vacancyId || null}
          onChange={(value) => setVacancyId(value ?? "")}
          required
          allowClear={false}
          placeholder="Pick a vacancy"
          searchPlaceholder="Search vacancies or clients"
          options={vacancies.map((v) => ({
            value: v.id,
            label: `${v.title} at ${v.clientName}`,
            hint: v.status !== "open" ? optionFor(vacancyStatuses, v.status).label : undefined,
          }))}
        />
      </Field>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !vacancyId} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          Link
        </Button>
      </div>
    </form>
  );
}
