"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { createLeadAction } from "@/app/dashboard/leads/manual-actions";
import { FormActions } from "@/components/entity/form-actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { initialActionState } from "@/lib/action-state";
import { segments } from "@/lib/labels";
import { invalidProps } from "./action-modal";

/** "Add lead": a company entered by hand. On success the action opens the new lead. */
export function NewLeadForm() {
  const [state, formAction, pending] = useActionState(createLeadAction, initialActionState);
  const e = state.fieldErrors ?? {};

  // Submit by hand so React does not reset the fields after a validation error.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <FormMessage error={state.error} link={state.link} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Company name" htmlFor="name" required error={e.name}>
          <Input
            id="name"
            name="name"
            required
            autoComplete="organization"
            enterKeyHint="next"
            {...invalidProps(state, "name")}
          />
        </Field>
        <Field
          label="Website or domain"
          htmlFor="website"
          required
          hint="The domain is the key of a lead: one lead per domain."
          error={e.website}
        >
          <Input
            id="website"
            name="website"
            required
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="acme.com"
            enterKeyHint="next"
            {...invalidProps(state, "website")}
          />
        </Field>
        <Field label="Sector" htmlFor="sector" error={e.sector}>
          <Input id="sector" name="sector" placeholder="For example fintech" {...invalidProps(state, "sector")} />
        </Field>
        <Field label="City" htmlFor="city" error={e.city}>
          <Input id="city" name="city" autoComplete="address-level2" {...invalidProps(state, "city")} />
        </Field>
        <Field
          label="Segment"
          htmlFor="segment"
          hint="Leave empty to let the qualification decide."
          error={e.segment}
        >
          <Select id="segment" name="segment" defaultValue="">
            <option value="">No segment</option>
            {segments.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Legal form"
          htmlFor="legal_form"
          hint="An eenmanszaak or vof never goes on a call list."
          error={e.legal_form}
        >
          <Input id="legal_form" name="legal_form" placeholder="For example bv" {...invalidProps(state, "legal_form")} />
        </Field>
        <Field label="Employees" htmlFor="employees" error={e.employees}>
          <Input
            id="employees"
            name="employees"
            type="number"
            min={0}
            inputMode="numeric"
            {...invalidProps(state, "employees")}
          />
        </Field>
        <Field label="KvK number" htmlFor="kvk_number" error={e.kvk_number}>
          <Input
            id="kvk_number"
            name="kvk_number"
            inputMode="numeric"
            maxLength={8}
            {...invalidProps(state, "kvk_number")}
          />
        </Field>
        <Field label="LinkedIn company page" htmlFor="linkedin_url" error={e.linkedin_url} className="sm:col-span-2">
          <Input
            id="linkedin_url"
            name="linkedin_url"
            type="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="linkedin.com/company/acme"
            {...invalidProps(state, "linkedin_url")}
          />
        </Field>
        <Field label="General number" htmlFor="general_phone" hint="The reception or main number of the company." error={e.general_phone}>
          <Input id="general_phone" name="general_phone" type="tel" autoComplete="off" {...invalidProps(state, "general_phone")} />
        </Field>
        <Field label="Opening line" htmlFor="opening_line" error={e.opening_line} className="sm:col-span-2">
          <Textarea id="opening_line" name="opening_line" rows={2} placeholder="What you open the call or mail with" {...invalidProps(state, "opening_line")} />
        </Field>
        <Field label="Red flags" htmlFor="red_flags" hint="One per line." error={e.red_flags} className="sm:col-span-2">
          <Textarea id="red_flags" name="red_flags" rows={3} {...invalidProps(state, "red_flags")} />
        </Field>
        {e.confirm_duplicate && (
          <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:col-span-2">
            <input type="checkbox" name="confirm_duplicate" className="mt-0.5 size-4" />
            <span>This is another company: add the lead anyway.</span>
          </label>
        )}
      </div>
      <FormActions>
        <ButtonLink href="/dashboard/leads" variant="secondary">
          Cancel
        </ButtonLink>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? "Adding lead" : "Add lead"}
        </Button>
      </FormActions>
    </form>
  );
}
