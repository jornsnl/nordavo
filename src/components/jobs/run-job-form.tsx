"use client";

import { startTransition, useActionState, useId } from "react";
import { LoaderCircle, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Select } from "@/components/ui/field";
import { initialActionState, type ActionState } from "@/lib/action-state";

/** "Nu draaien" for one job or chain, with optional parameters. */
export function RunJobForm({
  label,
  action,
  vacancies,
  showLimit = false,
  disabledReason,
}: {
  label: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** Set for jobs that need a vacancy (t2-match). */
  vacancies?: { id: string; label: string }[];
  showLimit?: boolean;
  disabledReason?: string | null;
}) {
  const id = useId();
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const noVacancies = vacancies !== undefined && vacancies.length === 0;
  const disabled = pending || Boolean(disabledReason) || noVacancies;

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {vacancies && (
          <>
            <label htmlFor={`${id}-vacancy`} className="sr-only">
              Vacature
            </label>
            <Select id={`${id}-vacancy`} name="vacancy" defaultValue="" className="sm:w-64" disabled={pending}>
              <option value="" disabled>
                {noVacancies ? "Geen open vacatures" : "Kies een vacature"}
              </option>
              {vacancies.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </>
        )}
        {showLimit && (
          <>
            <label htmlFor={`${id}-limit`} className="sr-only">
              Limiet
            </label>
            <Input
              id={`${id}-limit`}
              name="limit"
              type="number"
              min={1}
              max={5000}
              inputMode="numeric"
              placeholder="Limiet, optioneel"
              className="sm:w-40"
              disabled={pending}
            />
          </>
        )}
        <Button type="submit" size="sm" disabled={disabled} aria-busy={pending} title={disabledReason ?? undefined}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
          {pending ? "Draait" : label}
        </Button>
      </div>
      {pending && (
        <p className="text-xs text-muted" role="status">
          Dit kan een paar minuten duren. Laat de pagina open.
        </p>
      )}
      {!pending && <FormMessage error={state.error} success={state.ok ? state.message : undefined} />}
    </form>
  );
}
