"use client";

import { startTransition, useActionState, useMemo, useState, type FormEvent } from "react";
import { Link2, LoaderCircle, Trash2 } from "lucide-react";
import { deleteCandidate, linkCandidateToVacancy } from "@/app/dashboard/kandidaten/actions";
import { initialActionState } from "@/lib/action-state";
import type { VacancyOption } from "@/lib/data/applications";
import { optionFor, vacancyStatuses } from "@/lib/labels";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, FormMessage, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { ConfirmButton } from "./confirm-button";

export function DeleteCandidateButton({ candidateId, name }: { candidateId: string; name: string }) {
  return (
    <ConfirmButton
      title="Kandidaat verwijderen?"
      description={`${name} verdwijnt uit het systeem, inclusief cv en alle pipelines. Dit kun je niet ongedaan maken.`}
      confirmLabel="Ja, verwijderen"
      action={() => deleteCandidate(candidateId)}
    >
      <Trash2 aria-hidden="true" />
      Verwijderen
    </ConfirmButton>
  );
}

/** "Aan vacature koppelen": pick an open vacancy and add the candidate in stage sourced. */
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
        Aan vacature koppelen
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Aan vacature koppelen"
        description="De kandidaat komt in de fase Gesourcet van de pipeline."
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
            Sluiten
          </Button>
          <ButtonLink href={`/dashboard/vacatures/${vacancyId}/pipeline`}>Naar de pipeline</ButtonLink>
        </div>
      </div>
    );
  }

  if (vacancies.length === 0) {
    return (
      <p className="text-sm text-muted">
        Er zijn geen open vacatures waar deze kandidaat nog niet in staat. Maak eerst een vacature aan.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="candidate_id" value={candidateId} />
      <FormMessage error={state.error} />
      <Field label="Vacature" htmlFor="link-vacancy" required error={state.fieldErrors?.vacancy_id}>
        <Select
          id="link-vacancy"
          name="vacancy_id"
          value={vacancyId}
          onChange={(e) => setVacancyId(e.target.value)}
          required
        >
          {vacancies.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title} bij {v.clientName}
              {v.status !== "open" ? ` (${optionFor(vacancyStatuses, v.status).label})` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Annuleren
        </Button>
        <Button type="submit" disabled={pending || !vacancyId} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          Koppelen
        </Button>
      </div>
    </form>
  );
}
