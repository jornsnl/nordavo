"use client";

import { startTransition, useActionState, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { initialActionState, type ActionState } from "@/lib/action-state";
import type { Seniority, TalentStage, VacancySource, VacancyStatus } from "@/lib/database.types";
import { seniorities, talentStages, vacancyStatuses } from "@/lib/labels";
import { vacancySources } from "./talent-labels";

export type VacancyFormValues = {
  client_id: string;
  company_id: string;
  talent_stage: TalentStage;
  source: VacancySource | null;
  onepage_deal_id: string | null;
  hours: number | null;
  timezone_overlap: string | null;
  budget_min: number | null;
  budget_max: number | null;
  client_contact_required: boolean | null;
  must_haves: string[];
  nice_to_haves: string[];
  unclear: string[];
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
  companies,
  staff,
  cancelHref,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: Partial<VacancyFormValues>;
  clients: Option[];
  /** GTM companies (prospects), for a vacancy before the company is a client. */
  companies: Option[];
  staff: Option[];
  cancelHref: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};
  const invalid = (name: string) =>
    errors[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {};
  const [ownerType, setOwnerType] = useState<"client" | "company">(
    defaults?.company_id && !defaults?.client_id ? "company" : "client",
  );
  const contactDefault =
    defaults?.client_contact_required === true ? "ja" : defaults?.client_contact_required === false ? "nee" : "";

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
        <fieldset className="space-y-3 sm:col-span-2">
          <legend className="text-sm font-medium text-ink">
            Voor wie is deze vacature<span className="ml-0.5 text-danger" aria-hidden="true">*</span>
          </legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="owner_type"
                value="client"
                checked={ownerType === "client"}
                onChange={() => setOwnerType("client")}
                className="size-4 accent-brand-700"
              />
              Bestaande klant
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="owner_type"
                value="company"
                checked={ownerType === "company"}
                onChange={() => setOwnerType("company")}
                className="size-4 accent-brand-700"
              />
              Prospect uit sales
            </label>
          </div>
          {ownerType === "client" ? (
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
          ) : (
            <Field
              label="Bedrijf"
              htmlFor="company_id"
              required
              error={errors.company_id}
              hint="GO prospects en actieve bedrijven uit sales. Staat het bedrijf er niet bij, open dan de vacature vanuit de lead."
            >
              <Select id="company_id" name="company_id" required defaultValue={defaults?.company_id ?? ""} {...invalid("company_id")}>
                <option value="" disabled>
                  Kies een bedrijf
                </option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </fieldset>
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
        <Field label="Fase talent" htmlFor="talent_stage" required error={errors.talent_stage}>
          <Select id="talent_stage" name="talent_stage" defaultValue={defaults?.talent_stage ?? "intake"} {...invalid("talent_stage")}>
            {talentStages.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bron" htmlFor="source" error={errors.source}>
          <Select id="source" name="source" defaultValue={defaults?.source ?? ""} {...invalid("source")}>
            <option value="">Onbekend</option>
            {vacancySources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Deal in OnePageCRM"
          htmlFor="onepage_deal_id"
          error={errors.onepage_deal_id}
          hint="De deal-id, zodat verstuurde profielen bij de deal komen."
        >
          <Input id="onepage_deal_id" name="onepage_deal_id" defaultValue={defaults?.onepage_deal_id ?? ""} {...invalid("onepage_deal_id")} />
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

      <fieldset className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
        <legend className="sr-only">Vaste eisen</legend>
        <div className="sm:col-span-2">
          <h3 className="font-display text-base font-semibold text-brand-900">Vaste eisen</h3>
          <p className="mt-0.5 text-sm text-muted">Vul je liever niet zelf in? Lees de vacature uit op de detailpagina.</p>
        </div>
        <Field label="Uren per week" htmlFor="hours" error={errors.hours}>
          <Input id="hours" name="hours" inputMode="numeric" placeholder="40" defaultValue={defaults?.hours ?? ""} {...invalid("hours")} />
        </Field>
        <Field label="Overlap tijdzone" htmlFor="timezone_overlap" error={errors.timezone_overlap}>
          <Input
            id="timezone_overlap"
            name="timezone_overlap"
            placeholder="Bijvoorbeeld 4 uur overlap per dag"
            defaultValue={defaults?.timezone_overlap ?? ""}
            {...invalid("timezone_overlap")}
          />
        </Field>
        <Field label="Budget minimaal per maand (EUR)" htmlFor="budget_min" error={errors.budget_min}>
          <Input id="budget_min" name="budget_min" inputMode="decimal" defaultValue={defaults?.budget_min ?? ""} {...invalid("budget_min")} />
        </Field>
        <Field label="Budget maximaal per maand (EUR)" htmlFor="budget_max" error={errors.budget_max}>
          <Input id="budget_max" name="budget_max" inputMode="decimal" defaultValue={defaults?.budget_max ?? ""} {...invalid("budget_max")} />
        </Field>
        <Field
          label="Direct contact met klanten van de klant"
          htmlFor="client_contact_required"
          error={errors.client_contact_required}
          hint="Ja is een no go voor Nordavo."
          className="sm:col-span-2"
        >
          <Select id="client_contact_required" name="client_contact_required" defaultValue={contactDefault}>
            <option value="">Nog onbekend</option>
            <option value="nee">Nee</option>
            <option value="ja">Ja</option>
          </Select>
        </Field>
        <Field label="Must haves" htmlFor="must_haves" error={errors.must_haves} hint="Eén eis per regel">
          <Textarea id="must_haves" name="must_haves" rows={5} defaultValue={defaults?.must_haves?.join("\n") ?? ""} {...invalid("must_haves")} />
        </Field>
        <Field label="Nice to haves" htmlFor="nice_to_haves" error={errors.nice_to_haves} hint="Eén punt per regel">
          <Textarea
            id="nice_to_haves"
            name="nice_to_haves"
            rows={5}
            defaultValue={defaults?.nice_to_haves?.join("\n") ?? ""}
            {...invalid("nice_to_haves")}
          />
        </Field>
        <Field label="Nog navragen" htmlFor="unclear" error={errors.unclear} hint="Eén vraag per regel" className="sm:col-span-2">
          <Textarea id="unclear" name="unclear" rows={3} defaultValue={defaults?.unclear?.join("\n") ?? ""} {...invalid("unclear")} />
        </Field>
      </fieldset>

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
