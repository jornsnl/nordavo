"use client";

import { startTransition, useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { FormActions } from "@/components/entity/form-actions";
import { initialActionState, type ActionState } from "@/lib/action-state";
import type { ClientStatus } from "@/lib/database.types";
import { clientStatuses } from "@/lib/labels";

export type ClientFormValues = {
  name: string;
  website: string | null;
  industry: string | null;
  city: string | null;
  status: ClientStatus;
  owner_id: string | null;
  notes: string | null;
};

export function ClientForm({
  action,
  defaults,
  staff,
  cancelHref,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: ClientFormValues;
  staff: { id: string; label: string }[];
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
        <Field label="Naam" htmlFor="name" required error={errors.name} className="sm:col-span-2">
          <Input id="name" name="name" required defaultValue={defaults?.name} autoComplete="organization" enterKeyHint="next" {...invalid("name")} />
        </Field>
        <Field label="Website" htmlFor="website" error={errors.website} hint="Bijvoorbeeld bedrijf.nl">
          <Input
            id="website"
            name="website"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="next"
            defaultValue={defaults?.website ?? ""}
            {...invalid("website")}
          />
        </Field>
        <Field label="Branche" htmlFor="industry" error={errors.industry}>
          <Input id="industry" name="industry" enterKeyHint="next" defaultValue={defaults?.industry ?? ""} placeholder="Bijvoorbeeld fintech" {...invalid("industry")} />
        </Field>
        <Field label="Plaats" htmlFor="city" error={errors.city}>
          <Input id="city" name="city" autoComplete="address-level2" enterKeyHint="next" defaultValue={defaults?.city ?? ""} {...invalid("city")} />
        </Field>
        <Field label="Status" htmlFor="status" required error={errors.status}>
          <Select id="status" name="status" defaultValue={defaults?.status ?? "lead"} {...invalid("status")}>
            {clientStatuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Eigenaar" htmlFor="owner_id" error={errors.owner_id} hint="Wie bij Nordavo deze klant beheert">
          <Select id="owner_id" name="owner_id" defaultValue={defaults?.owner_id ?? ""} {...invalid("owner_id")}>
            <option value="">Geen eigenaar</option>
            {staff.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notities" htmlFor="notes" error={errors.notes} className="sm:col-span-2">
          <Textarea id="notes" name="notes" rows={5} defaultValue={defaults?.notes ?? ""} {...invalid("notes")} />
        </Field>
      </div>

      <FormActions>
        <ButtonLink href={cancelHref} variant="secondary">
          Annuleren
        </ButtonLink>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? "Bezig met opslaan" : submitLabel}
        </Button>
      </FormActions>
    </form>
  );
}
