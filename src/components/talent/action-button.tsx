"use client";

import { useActionState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TalentActionState } from "@/lib/talent/types";

/** Shows the result of a talent action: error, success and an optional warning. */
export function ActionFeedback({ state, className = "" }: { state: TalentActionState; className?: string }) {
  if (!state.error && !state.message && !state.warning) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      {state.error && (
        <p role="alert" className="rounded-xl border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.message && !state.error && (
        <p role="status" className="rounded-xl border border-emerald-600/20 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.message}
        </p>
      )}
      {state.warning && (
        <p role="status" className="rounded-xl border border-amber-600/20 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {state.warning}
        </p>
      )}
    </div>
  );
}

/** One button that runs a bound server action, with a spinner and inline feedback. */
export function ActionButton({
  action,
  children,
  pendingLabel,
  variant = "secondary",
  size = "sm",
  className = "",
  feedback = true,
  ariaLabel,
}: {
  action: (prev: TalentActionState, formData: FormData) => Promise<TalentActionState>;
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
  feedback?: boolean;
  ariaLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as TalentActionState);
  return (
    <form action={formAction} className={className}>
      <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending} aria-label={ariaLabel}>
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        {pending && pendingLabel ? pendingLabel : children}
      </Button>
      {feedback && <ActionFeedback state={state} className="mt-2" />}
    </form>
  );
}
