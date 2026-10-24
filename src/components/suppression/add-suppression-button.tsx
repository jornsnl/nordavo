"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { addSuppressionAction } from "@/app/dashboard/uitsluitingen/actions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { suppressionReasons, suppressionScopes } from "@/lib/labels";

const kinds = [
  { value: "contact", label: "Contact", placeholder: "LinkedIn URL of mailadres van het contact" },
  { value: "bedrijf", label: "Bedrijf", placeholder: "Domein, bijvoorbeeld bedrijf.nl" },
  { value: "email", label: "Alleen een mailadres", placeholder: "naam@bedrijf.nl" },
] as const;

export function AddSuppressionButton() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof kinds)[number]["value"]>("contact");
  const [state, formAction] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await addSuppressionAction(prev, formData);
    if (result.ok) setOpen(false);
    return result;
  }, initialActionState);
  const errors = state.fieldErrors ?? {};
  const current = kinds.find((k) => k.value === kind) ?? kinds[0];

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Uitsluiten
      </Button>
      {state.ok && state.message && !open && (
        <p role="status" className="sr-only">
          {state.message}
        </p>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Iemand uitsluiten"
        description="Een uitsluiting geldt direct voor elke bellijst en mailcampagne."
      >
        <form action={formAction} className="space-y-4">
          <Field label="Wat sluit je uit?" htmlFor="sup-kind" required error={errors.kind}>
            <Select id="sup-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {kinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={kind === "bedrijf" ? "Domein" : kind === "email" ? "Mailadres" : "LinkedIn URL of mailadres"}
            htmlFor="sup-value"
            required
            error={errors.value}
            hint={kind === "bedrijf" ? "Geldt voor iedereen bij dit bedrijf." : undefined}
          >
            <Input
              id="sup-value"
              name="value"
              required
              placeholder={current.placeholder}
              aria-invalid={Boolean(errors.value)}
              aria-describedby={errors.value ? "sup-value-error" : undefined}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reden" htmlFor="sup-reason" required error={errors.reason}>
              <Select id="sup-reason" name="reason" defaultValue="bezwaar">
                {suppressionReasons.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Kanalen" htmlFor="sup-scope" required error={errors.scope}>
              <Select id="sup-scope" name="scope" defaultValue="alle_kanalen">
                {suppressionScopes.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Notitie" htmlFor="sup-notes" error={errors.notes}>
            <Textarea id="sup-notes" name="notes" rows={3} placeholder="Bijvoorbeeld: gaf telefonisch aan niet gebeld te willen worden." />
          </Field>
          <FormMessage error={state.error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Annuleren
            </Button>
            <SubmitButton pendingLabel="Bezig met opslaan">Uitsluiten</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
