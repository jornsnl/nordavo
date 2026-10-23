"use client";

import { useActionState, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { candidateStatuses, optionFor, vacancyStatuses } from "@/lib/labels";
import type { CandidateStatus, VacancyStatus } from "@/lib/database.types";
import { ButtonLink } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { addDays } from "./dates";
import { PendingSubmit, submitWithoutReset } from "./form-utils";

type Option = { id: string; name: string };
type CandidateOption = { id: string; full_name: string; status: CandidateStatus };
type VacancyOption = { id: string; title: string; client_id: string; status: VacancyStatus };

export type PlacementFormValues = {
  client_id?: string;
  candidate_id?: string;
  vacancy_id?: string | null;
  application_id?: string | null;
  start_date?: string;
  end_date?: string | null;
  monthly_rate?: number | null;
  next_checkin_at?: string | null;
  notes?: string | null;
};

export function PlacementForm({
  action,
  mode,
  options,
  defaults = {},
  locked = false,
  cancelHref,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  mode: "create" | "edit";
  options: { clients: Option[]; candidates: CandidateOption[]; vacancies: VacancyOption[] };
  defaults?: PlacementFormValues;
  /** Client, candidate and vacancy come from the pipeline and cannot change. */
  locked?: boolean;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};

  const [clientId, setClientId] = useState(defaults.client_id ?? "");
  const [vacancyId, setVacancyId] = useState(defaults.vacancy_id ?? "");
  const [startDate, setStartDate] = useState(defaults.start_date ?? "");
  const [nextCheckin, setNextCheckin] = useState(defaults.next_checkin_at ?? "");
  const [checkinTouched, setCheckinTouched] = useState(mode === "edit" || Boolean(defaults.next_checkin_at));

  const clientVacancies = useMemo(
    () => options.vacancies.filter((v) => v.client_id === clientId),
    [options.vacancies, clientId],
  );

  const describedBy = (name: string) => (errors[name] ? `${name}-error` : undefined);

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-6" noValidate>
      <FormMessage error={state.error} />

      {defaults.application_id && (
        <input type="hidden" name="application_id" value={defaults.application_id} />
      )}

      {locked && (
        <p className="flex items-start gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Klant, kandidaat en vacature komen uit de pipeline en liggen vast.
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Klant" htmlFor="client_id" required error={errors.client_id}>
          {locked && <input type="hidden" name="client_id" value={clientId} />}
          <Select
            id="client_id"
            name={locked ? undefined : "client_id"}
            value={clientId}
            disabled={locked}
            required
            aria-invalid={Boolean(errors.client_id)}
            aria-describedby={describedBy("client_id")}
            onChange={(event) => {
              setClientId(event.target.value);
              setVacancyId("");
            }}
          >
            <option value="">Kies een klant</option>
            {options.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Kandidaat" htmlFor="candidate_id" required error={errors.candidate_id}>
          {locked && <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />}
          <Select
            id="candidate_id"
            name={locked ? undefined : "candidate_id"}
            defaultValue={defaults.candidate_id ?? ""}
            disabled={locked}
            required
            aria-invalid={Boolean(errors.candidate_id)}
            aria-describedby={describedBy("candidate_id")}
          >
            <option value="">Kies een kandidaat</option>
            {options.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.full_name}
                {candidate.status !== "available" &&
                  ` (${optionFor(candidateStatuses, candidate.status).label.toLowerCase()})`}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Vacature"
          htmlFor="vacancy_id"
          error={errors.vacancy_id}
          hint={clientId ? undefined : "Kies eerst een klant."}
          className="sm:col-span-2"
        >
          {locked && <input type="hidden" name="vacancy_id" value={vacancyId} />}
          <Select
            id="vacancy_id"
            name={locked ? undefined : "vacancy_id"}
            value={vacancyId}
            disabled={locked || !clientId}
            aria-invalid={Boolean(errors.vacancy_id)}
            aria-describedby={describedBy("vacancy_id")}
            onChange={(event) => setVacancyId(event.target.value)}
          >
            <option value="">Geen vacature</option>
            {clientVacancies.map((vacancy) => (
              <option key={vacancy.id} value={vacancy.id}>
                {vacancy.title}
                {vacancy.status !== "open" &&
                  ` (${optionFor(vacancyStatuses, vacancy.status).label.toLowerCase()})`}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Startdatum" htmlFor="start_date" required error={errors.start_date}>
          <Input
            id="start_date"
            name="start_date"
            type="date"
            required
            value={startDate}
            aria-invalid={Boolean(errors.start_date)}
            aria-describedby={describedBy("start_date")}
            onChange={(event) => {
              const value = event.target.value;
              setStartDate(value);
              if (!checkinTouched && value) setNextCheckin(addDays(value, 14));
            }}
          />
        </Field>

        <Field
          label="Maandtarief"
          htmlFor="monthly_rate"
          error={errors.monthly_rate}
          hint="In euro, exclusief btw."
        >
          <Input
            id="monthly_rate"
            name="monthly_rate"
            inputMode="decimal"
            placeholder="4500"
            defaultValue={defaults.monthly_rate ?? ""}
            aria-invalid={Boolean(errors.monthly_rate)}
            aria-describedby={describedBy("monthly_rate")}
          />
        </Field>

        <Field
          label="Eerste check-in"
          htmlFor="next_checkin_at"
          error={errors.next_checkin_at}
          hint={mode === "create" ? "Standaard 14 dagen na de start." : undefined}
        >
          <Input
            id="next_checkin_at"
            name="next_checkin_at"
            type="date"
            value={nextCheckin}
            aria-invalid={Boolean(errors.next_checkin_at)}
            aria-describedby={describedBy("next_checkin_at")}
            onChange={(event) => {
              setNextCheckin(event.target.value);
              setCheckinTouched(true);
            }}
          />
        </Field>

        {mode === "edit" && (
          <Field
            label="Einddatum"
            htmlFor="end_date"
            error={errors.end_date}
            hint="Laat leeg zolang de plaatsing doorloopt."
          >
            <Input
              id="end_date"
              name="end_date"
              type="date"
              defaultValue={defaults.end_date ?? ""}
              aria-invalid={Boolean(errors.end_date)}
              aria-describedby={describedBy("end_date")}
            />
          </Field>
        )}

        <Field label="Notities" htmlFor="notes" error={errors.notes} className="sm:col-span-2">
          <Textarea
            id="notes"
            name="notes"
            rows={4}
            defaultValue={defaults.notes ?? ""}
            placeholder="Afspraken over onboarding, hardware, werktijden."
          />
        </Field>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
        <ButtonLink href={cancelHref} variant="secondary">
          Annuleren
        </ButtonLink>
        <PendingSubmit pending={pending} pendingLabel="Bezig met opslaan">
          {mode === "create" ? "Plaatsing aanmaken" : "Wijzigingen opslaan"}
        </PendingSubmit>
      </div>
    </form>
  );
}
