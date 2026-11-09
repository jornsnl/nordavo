"use client";

import { startTransition, useActionState, useId } from "react";
import { LoaderCircle, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
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
              Vacancy
            </label>
            <SearchSelect
              id={`${id}-vacancy`}
              name="vacancy"
              className="sm:w-64"
              disabled={pending || noVacancies}
              required
              placeholder={noVacancies ? "No open vacancies" : "Pick a vacancy"}
              searchPlaceholder="Search vacancies"
              options={vacancies.map((v) => ({ value: v.id, label: v.label }))}
            />
          </>
        )}
        {showLimit && (
          <>
            <label htmlFor={`${id}-limit`} className="sr-only">
              Limit
            </label>
            <Input
              id={`${id}-limit`}
              name="limit"
              type="number"
              min={1}
              max={5000}
              inputMode="numeric"
              placeholder="Limit, optional"
              enterKeyHint="go"
              className="sm:w-40"
              disabled={pending}
            />
          </>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={disabled}
          aria-busy={pending}
          title={disabledReason ?? undefined}
          className="pointer-coarse:min-h-11"
        >
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
          {pending ? "Running" : label}
        </Button>
      </div>
      {pending && (
        <p className="text-xs text-muted" role="status">
          This can take a few minutes. Keep the page open.
        </p>
      )}
      {!pending && <FormMessage error={state.error} success={state.ok ? state.message : undefined} />}
    </form>
  );
}
