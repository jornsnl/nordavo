"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { addSuppressionAction } from "@/app/dashboard/suppressions/actions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { suppressionReasons, suppressionScopes } from "@/lib/labels";

const kinds = [
  { value: "contact", label: "Contact", placeholder: "LinkedIn URL or email address of the contact" },
  { value: "bedrijf", label: "Company", placeholder: "Domain, for example company.com" },
  { value: "email", label: "Just an email address", placeholder: "name@company.com" },
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
        Suppress
      </Button>
      {state.ok && state.message && !open && (
        <p role="status" className="sr-only">
          {state.message}
        </p>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Suppress someone"
        description="A suppression applies right away to every call list and mail campaign."
      >
        <form action={formAction} className="space-y-4">
          <Field label="What do you suppress?" htmlFor="sup-kind" required error={errors.kind}>
            <Select id="sup-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {kinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={kind === "bedrijf" ? "Domain" : kind === "email" ? "Email address" : "LinkedIn URL or email address"}
            htmlFor="sup-value"
            required
            error={errors.value}
            hint={kind === "bedrijf" ? "Applies to everyone at this company." : undefined}
          >
            <Input
              id="sup-value"
              name="value"
              required
              placeholder={current.placeholder}
              type={kind === "email" ? "email" : "text"}
              inputMode={kind === "email" ? "email" : kind === "bedrijf" ? "url" : "text"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              aria-invalid={Boolean(errors.value)}
              aria-describedby={errors.value ? "sup-value-error" : undefined}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reason" htmlFor="sup-reason" required error={errors.reason}>
              <Select id="sup-reason" name="reason" defaultValue="bezwaar">
                {suppressionReasons.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Channels" htmlFor="sup-scope" required error={errors.scope}>
              <Select id="sup-scope" name="scope" defaultValue="alle_kanalen">
                {suppressionScopes.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Note" htmlFor="sup-notes" error={errors.notes}>
            <Textarea id="sup-notes" name="notes" rows={3} placeholder="For example: said on the phone they do not want to be called." />
          </Field>
          <FormMessage error={state.error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Saving">Suppress</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
