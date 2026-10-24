"use client";

import { useState, useTransition, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";

/** A button that asks for confirmation in a modal before running an action. */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel,
  action,
  onDone,
  variant = "secondary",
  size = "md",
}: {
  children: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  action: () => Promise<ActionState>;
  onDone?: () => void;
  variant?: "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(undefined);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      onDone?.();
    });
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Modal open={open} onClose={() => !pending && setOpen(false)} title={title}>
        <div className="space-y-5">
          <p className="text-sm text-muted">{description}</p>
          <FormMessage error={error} />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Annuleren
            </Button>
            <Button variant="danger" onClick={confirm} disabled={pending} aria-busy={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {confirmLabel}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
