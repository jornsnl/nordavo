"use client";

import { startTransition, useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { initialActionState, type ActionState } from "@/lib/action-state";
import type { Seniority, VacancyStatus } from "@/lib/database.types";
import { seniorities, vacancyStatuses } from "@/lib/labels";

export type VacancyFormValues = {
  client_id: string;
  title: string;
  description: string | null;
  stack: string[];
  seniority: Seniority;
  status: VacancyStatus;
  monthly_budget: number | null;
  desired_start_date: string | null;
  owner_id: string | null;
};

type Option = { id: string; label: string };

export function VacancyForm({
  action,
  defaults,
  clients,
  staff,
  cancelHref,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: Partial<VacancyFormValues>;
  clients: Option[];
  staff: Option[];
  cancelHref: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};
  const invalid = (name: string) =>
    errors[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {};

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(event) => {
        // Submit manually so React does not reset the fields when validation fails.
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      <FormMessage error={state.error} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Klant" htmlFor="client_id" required error={errors.client_id}>
          <Select id="client_id" name="client_id" required defaultValue={defaults?.client_id ?? ""} {...invalid("client_id")}>
            <option value="" disabled>
              Kies een klant
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Functietitel" htmlFor="title" required error={errors.title}>
          <Input
            id="title"
            name="title"
            required
            placeholder="Bijvoorbeeld Senior Data Engineer"
            defaultValue={defaults?.title}
            {...invalid("title")}
          />
        </Field>
        <Field
          label="Functieprofiel"
          htmlFor="description"
          error={errors.description}
          hint="Wat de developer gaat doen, het team en wat de klant belangrijk vindt."
          className="sm:col-span-2"
        >
          <Textarea id="description" name="description" rows={8} defaultValue={defaults?.description ?? ""} {...invalid("description")} />
        </Field>
        <Field
          label="Stack"
          htmlFor="stack"
          error={errors.stack}
          hint="Scheid met komma's, bijvoorbeeld Python, dbt, Snowflake"
          className="sm:col-span-2"
        >
          <Input id="stack" name="stack" defaultValue={defaults?.stack?.join(", ") ?? ""} {...invalid("stack")} />
        </Field>
        <Field label="Senioriteit" htmlFor="seniority" required error={errors.seniority}>
          <Select id="seniority" name="seniority" defaultValue={defaults?.seniority ?? "senior"} {...invalid("seniority")}>
            {seniorities.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Status"
          htmlFor="status"
          required
          error={errors.status}
          hint="Bij Ingevuld of Gesloten zetten we de sluitdatum op vandaag."
        >
          <Select id="status" name="status" defaultValue={defaults?.status ?? "open"} {...invalid("status")}>
            {vacancyStatuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Budget per maand (EUR)" htmlFor="monthly_budget" error={errors.monthly_budget}>
          <Input
            id="monthly_budget"
            name="monthly_budget"
            inputMode="decimal"
            placeholder="4500"
            defaultValue={defaults?.monthly_budget ?? ""}
            {...invalid("monthly_budget")}
          />
        </Field>
        <Field label="Gewenste startdatum" htmlFor="desired_start_date" error={errors.desired_start_date}>
          <Input
            id="desired_start_date"
            name="desired_start_date"
            type="date"
            defaultValue={defaults?.desired_start_date ?? ""}
            {...invalid("desired_start_date")}
          />
        </Field>
        <Field label="Eigenaar" htmlFor="owner_id" error={errors.owner_id} hint="Wie bij Nordavo deze vacature trekt">
          <Select id="owner_id" name="owner_id" defaultValue={defaults?.owner_id ?? ""} {...invalid("owner_id")}>
            <option value="">Geen eigenaar</option>
            {staff.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
        <ButtonLink href={cancelHref} variant="secondary">
          Annuleren
        </ButtonLink>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? "Bezig met opslaan" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
