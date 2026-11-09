"use client";

import { useState, useTransition, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";

/**
 * A button that runs one server action (already bound to its arguments) and
 * shows the error or message next to it. With confirm, the browser asks
 * first.
 */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  size = "sm",
  confirm,
  className = "",
  ariaLabel,
  showMessage = true,
}: {
  action: () => Promise<ActionState>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  confirm?: string;
  className?: string;
  ariaLabel?: string;
  showMessage?: boolean;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={pending}
        aria-busy={pending}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setState((await action()) ?? {}));
        }}
      >
        {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        {children}
      </Button>
      {showMessage && state.error && (
        <span role="alert" className="text-xs font-medium text-danger">
          {state.error}
        </span>
      )}
      {showMessage && !state.error && state.ok && state.message && (
        <span role="status" className="text-xs text-emerald-700">
          {state.message}
        </span>
      )}
    </span>
  );
}
