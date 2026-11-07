"use client";

import { startTransition, useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { FormActions } from "@/components/entity/form-actions";
import { initialActionState, type ActionState } from "@/lib/action-state";
import type { Seniority, TalentStage, VacancySource, VacancyStatus } from "@/lib/database.types";
import { seniorities, talentStages, vacancyStatuses } from "@/lib/labels";
import { ownerTypeOf } from "@/lib/talent/talent-pool";
import { OwnerPicker } from "./owner-picker";
import { vacancySources } from "./talent-labels";

export type VacancyFormValues = {
  client_id: string;
  company_id: string;
  is_talent_pool: boolean;
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
  allowTalentPool = true,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: Partial<VacancyFormValues>;
  clients: Option[];
  /** GTM companies (prospects), for a vacancy before the company is a client. */
  companies: Option[];
  staff: Option[];
  cancelHref: string;
  submitLabel: string;
  /**
   * Offer the talent pool as owner. Off when editing a vacancy that is
   * already linked: a linked vacancy does not move back to the pool.
   */
  allowTalentPool?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const errors = state.fieldErrors ?? {};
  const invalid = (name: string) =>
    errors[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {};
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
        <OwnerPicker
          clients={clients}
          companies={companies}
          defaultOwnerType={ownerTypeOf({
            is_talent_pool: defaults?.is_talent_pool,
            client_id: defaults?.client_id,
            company_id: defaults?.company_id,
          })}
          defaultClientId={defaults?.client_id}
          defaultCompanyId={defaults?.company_id}
          allowTalentPool={allowTalentPool}
          errors={errors}
        />
        <Field label="Job title" htmlFor="title" required error={errors.title}>
          <Input
            id="title"
            name="title"
            required
            placeholder="For example Senior Data Engineer"
            autoComplete="off"
            enterKeyHint="next"
            defaultValue={defaults?.title}
            {...invalid("title")}
          />
        </Field>
        <Field
          label="Job profile"
          htmlFor="description"
          error={errors.description}
          hint="What the developer will do, the team and what the client cares about."
          className="sm:col-span-2"
        >
          <Textarea id="description" name="description" rows={8} defaultValue={defaults?.description ?? ""} {...invalid("description")} />
        </Field>
        <Field
          label="Stack"
          htmlFor="stack"
          error={errors.stack}
          hint="Separate with commas, for example Python, dbt, Snowflake"
          className="sm:col-span-2"
        >
          <Input id="stack" name="stack" autoComplete="off" spellCheck={false} enterKeyHint="next" defaultValue={defaults?.stack?.join(", ") ?? ""} {...invalid("stack")} />
        </Field>
        <Field label="Seniority" htmlFor="seniority" required error={errors.seniority}>
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
          hint="Filled or Closed sets the closing date to today."
        >
          <Select id="status" name="status" defaultValue={defaults?.status ?? "open"} {...invalid("status")}>
            {vacancyStatuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Budget per month (EUR)" htmlFor="monthly_budget" error={errors.monthly_budget}>
          <Input
            id="monthly_budget"
            name="monthly_budget"
            inputMode="decimal"
            enterKeyHint="next"
            placeholder="4500"
            defaultValue={defaults?.monthly_budget ?? ""}
            {...invalid("monthly_budget")}
          />
        </Field>
        <Field label="Desired start date" htmlFor="desired_start_date" error={errors.desired_start_date}>
          <Input
            id="desired_start_date"
            name="desired_start_date"
            type="date"
            defaultValue={defaults?.desired_start_date ?? ""}
            {...invalid("desired_start_date")}
          />
        </Field>
        <Field label="Talent stage" htmlFor="talent_stage" required error={errors.talent_stage}>
          <Select id="talent_stage" name="talent_stage" defaultValue={defaults?.talent_stage ?? "intake"} {...invalid("talent_stage")}>
            {talentStages.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source" htmlFor="source" error={errors.source}>
          <Select id="source" name="source" defaultValue={defaults?.source ?? ""} {...invalid("source")}>
            <option value="">Unknown</option>
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
          hint="The deal id, so sent profiles end up on the deal."
        >
          <Input
            id="onepage_deal_id"
            name="onepage_deal_id"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="next"
            defaultValue={defaults?.onepage_deal_id ?? ""}
            {...invalid("onepage_deal_id")}
          />
        </Field>
        <Field label="Owner" htmlFor="owner_id" error={errors.owner_id} hint="Who at Nordavo runs this vacancy">
          <Select id="owner_id" name="owner_id" defaultValue={defaults?.owner_id ?? ""} {...invalid("owner_id")}>
            <option value="">No owner</option>
            {staff.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
        <legend className="sr-only">Fixed requirements</legend>
        <div className="sm:col-span-2">
          <h3 className="font-display text-base font-semibold text-brand-900">Fixed requirements</h3>
          <p className="mt-0.5 text-sm text-muted">Rather not fill this in yourself? Extract it from the vacancy text on the detail page.</p>
        </div>
        <Field label="Hours per week" htmlFor="hours" error={errors.hours}>
          <Input id="hours" name="hours" inputMode="numeric" enterKeyHint="next" placeholder="40" defaultValue={defaults?.hours ?? ""} {...invalid("hours")} />
        </Field>
        <Field label="Time zone overlap" htmlFor="timezone_overlap" error={errors.timezone_overlap}>
          <Input
            id="timezone_overlap"
            name="timezone_overlap"
            placeholder="For example 4 hours overlap per day"
            defaultValue={defaults?.timezone_overlap ?? ""}
            {...invalid("timezone_overlap")}
          />
        </Field>
        <Field label="Minimum budget per month (EUR)" htmlFor="budget_min" error={errors.budget_min}>
          <Input id="budget_min" name="budget_min" inputMode="decimal" enterKeyHint="next" defaultValue={defaults?.budget_min ?? ""} {...invalid("budget_min")} />
        </Field>
        <Field label="Maximum budget per month (EUR)" htmlFor="budget_max" error={errors.budget_max}>
          <Input id="budget_max" name="budget_max" inputMode="decimal" enterKeyHint="next" defaultValue={defaults?.budget_max ?? ""} {...invalid("budget_max")} />
        </Field>
        <Field
          label="Direct contact with the client's customers"
          htmlFor="client_contact_required"
          error={errors.client_contact_required}
          hint="Yes is a no go for Nordavo."
          className="sm:col-span-2"
        >
          <Select id="client_contact_required" name="client_contact_required" defaultValue={contactDefault}>
            <option value="">Not known yet</option>
            <option value="nee">No</option>
            <option value="ja">Yes</option>
          </Select>
        </Field>
        <Field label="Must haves" htmlFor="must_haves" error={errors.must_haves} hint="One requirement per line">
          <Textarea id="must_haves" name="must_haves" rows={5} defaultValue={defaults?.must_haves?.join("\n") ?? ""} {...invalid("must_haves")} />
        </Field>
        <Field label="Nice to haves" htmlFor="nice_to_haves" error={errors.nice_to_haves} hint="One point per line">
          <Textarea
            id="nice_to_haves"
            name="nice_to_haves"
            rows={5}
            defaultValue={defaults?.nice_to_haves?.join("\n") ?? ""}
            {...invalid("nice_to_haves")}
          />
        </Field>
        <Field label="Still to ask" htmlFor="unclear" error={errors.unclear} hint="One question per line" className="sm:col-span-2">
          <Textarea id="unclear" name="unclear" rows={3} defaultValue={defaults?.unclear?.join("\n") ?? ""} {...invalid("unclear")} />
        </Field>
      </fieldset>

      <FormActions>
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? "Saving" : submitLabel}
        </Button>
      </FormActions>
    </form>
  );
}
