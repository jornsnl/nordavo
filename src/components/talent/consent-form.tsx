"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import type { TalentActionState } from "@/lib/talent/types";
import { ActionFeedback } from "./action-button";

/**
 * Rule 13 fallback while the Airtable consent field is missing or empty:
 * a staff member confirms that the candidate gave consent.
 */
export function ConsentForm({
  action,
  id,
}: {
  action: (prev: TalentActionState, formData: FormData) => Promise<TalentActionState>;
  id: string;
}) {
  const [state, formAction] = useActionState(action, {} as TalentActionState);
  return (
    <form action={formAction} className="space-y-2">
      <label htmlFor={`consent-${id}`} className="flex items-start gap-2 text-sm text-ink">
        <input id={`consent-${id}`} name="consent" type="checkbox" required className="mt-0.5 size-4 shrink-0 accent-brand-700" />
        Kandidaat heeft toestemming gegeven om dit anonieme profiel met de klant te delen
      </label>
      <SubmitButton variant="secondary" size="sm" pendingLabel="Bezig met vastleggen">
        Toestemming vastleggen
      </SubmitButton>
      <ActionFeedback state={state} />
    </form>
  );
}
