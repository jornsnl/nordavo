"use client";

import { useActionState, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { candidateStatuses, optionFor, vacancyStatuses } from "@/lib/labels";
import type { CandidateStatus, VacancyStatus } from "@/lib/database.types";
import { ButtonLink } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/field";
import { FormActions } from "@/components/entity/form-actions";
import { addDays } from "./dates";
import { PendingSubmit, submitWithoutReset } from "./form-utils";

type Option = { id: string; name: string };
type CandidateOption = { id: string; full_name: string; status: CandidateStatus };
type VacancyOption = { id: string; title: string; client_id: string | null; status: VacancyStatus };

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
          Client, candidate and vacancy come from the pipeline and are fixed.
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Client" htmlFor="client_id" required error={errors.client_id}>
          {locked && <input type="hidden" name="client_id" value={clientId} />}
          <SearchSelect
            id="client_id"
            name={locked ? undefined : "client_id"}
            value={clientId || null}
            disabled={locked}
            required
            aria-invalid={Boolean(errors.client_id)}
            aria-describedby={describedBy("client_id")}
            placeholder="Pick a client"
            searchPlaceholder="Search clients"
            allowClear={false}
            options={options.clients.map((client) => ({ value: client.id, label: client.name }))}
            onChange={(value) => {
              setClientId(value ?? "");
              setVacancyId("");
            }}
          />
        </Field>

        <Field label="Candidate" htmlFor="candidate_id" required error={errors.candidate_id}>
          {locked && <input type="hidden" name="candidate_id" value={defaults.candidate_id ?? ""} />}
          <SearchSelect
            id="candidate_id"
            name={locked ? undefined : "candidate_id"}
            defaultValue={defaults.candidate_id ?? null}
            disabled={locked}
            required
            aria-invalid={Boolean(errors.candidate_id)}
            aria-describedby={describedBy("candidate_id")}
            placeholder="Pick a candidate"
            searchPlaceholder="Search candidates"
            allowClear={false}
            options={options.candidates.map((candidate) => ({
              value: candidate.id,
              label: candidate.full_name,
              hint:
                candidate.status !== "available"
                  ? optionFor(candidateStatuses, candidate.status).label
                  : undefined,
            }))}
          />
        </Field>

        <Field
          label="Vacancy"
          htmlFor="vacancy_id"
          error={errors.vacancy_id}
          hint={clientId ? undefined : "Pick a client first."}
          className="sm:col-span-2"
        >
          {locked && <input type="hidden" name="vacancy_id" value={vacancyId} />}
          <SearchSelect
            id="vacancy_id"
            name={locked ? undefined : "vacancy_id"}
            value={vacancyId || null}
            disabled={locked || !clientId}
            aria-invalid={Boolean(errors.vacancy_id)}
            aria-describedby={describedBy("vacancy_id")}
            onChange={(value) => setVacancyId(value ?? "")}
            placeholder="No vacancy"
            searchPlaceholder="Search vacancies"
            options={clientVacancies.map((vacancy) => ({
              value: vacancy.id,
              label: vacancy.title,
              hint: vacancy.status !== "open" ? optionFor(vacancyStatuses, vacancy.status).label : undefined,
            }))}
          />
        </Field>

        <Field label="Start date" htmlFor="start_date" required error={errors.start_date}>
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
          label="Monthly rate"
          htmlFor="monthly_rate"
          error={errors.monthly_rate}
          hint="In euros, excluding VAT."
        >
          <Input
            id="monthly_rate"
            name="monthly_rate"
            inputMode="decimal"
            enterKeyHint="next"
            placeholder="4500"
            defaultValue={defaults.monthly_rate ?? ""}
            aria-invalid={Boolean(errors.monthly_rate)}
            aria-describedby={describedBy("monthly_rate")}
          />
        </Field>

        <Field
          label="First check-in"
          htmlFor="next_checkin_at"
          error={errors.next_checkin_at}
          hint={mode === "create" ? "By default 14 days after the start." : undefined}
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
            label="End date"
            htmlFor="end_date"
            error={errors.end_date}
            hint="Leave empty while the placement is running."
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

        <Field label="Notes" htmlFor="notes" error={errors.notes} className="sm:col-span-2">
          <Textarea
            id="notes"
            name="notes"
            rows={4}
            defaultValue={defaults.notes ?? ""}
            placeholder="Agreements on onboarding, hardware, working hours."
          />
        </Field>
      </div>

      <FormActions>
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
        <PendingSubmit pending={pending} pendingLabel="Saving">
          {mode === "create" ? "Create placement" : "Save changes"}
        </PendingSubmit>
      </FormActions>
    </form>
  );
}
