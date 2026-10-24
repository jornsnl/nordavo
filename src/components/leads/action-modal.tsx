"use client";

import { startTransition, useActionState, useState, type ReactNode } from "react";
import { LoaderCircle, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { initialActionState, type ActionState } from "@/lib/action-state";

export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Field props for an input with a zod error from the action. */
export function invalidProps(state: ActionState, name: string, id = name) {
  return state.fieldErrors?.[name] ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};
}

/**
 * A button that opens a modal with a form. The form runs a server action,
 * shows its errors, and closes on success. The success message stays visible
 * next to the button.
 */
export function ActionModal({
  label,
  icon: Icon,
  variant = "secondary",
  size = "sm",
  ariaLabel,
  disabled,
  title,
  description,
  action,
  submitLabel = "Opslaan",
  pendingLabel = "Bezig met opslaan",
  modalSize = "md",
  children,
}: {
  label: string;
  icon?: LucideIcon;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  ariaLabel?: string;
  disabled?: boolean;
  title: string;
  description?: string;
  action: FormAction;
  submitLabel?: string;
  pendingLabel?: string;
  modalSize?: "md" | "lg";
  children: (state: ActionState) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Remount the form on every open, so it starts clean.
  const [round, setRound] = useState(0);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => {
          setMessage(null);
          setRound((r) => r + 1);
          setOpen(true);
        }}
      >
        {Icon && <Icon aria-hidden="true" />}
        {label}
      </Button>
      {message && (
        <span role="status" className="sr-only">
          {message}
        </span>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description} size={modalSize}>
        <ModalForm
          key={round}
          action={action}
          submitLabel={submitLabel}
          pendingLabel={pendingLabel}
          onCancel={() => setOpen(false)}
          onDone={(m) => {
            setMessage(m);
            setOpen(false);
          }}
        >
          {children}
        </ModalForm>
      </Modal>
    </>
  );
}

function ModalForm({
  action,
  submitLabel,
  pendingLabel,
  onCancel,
  onDone,
  children,
}: {
  action: FormAction;
  submitLabel: string;
  pendingLabel: string;
  onCancel: () => void;
  onDone: (message: string) => void;
  children: (state: ActionState) => ReactNode;
}) {
  const [state, formAction, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result?.ok) onDone(result.message ?? "Opgeslagen.");
    return result ?? prev;
  }, initialActionState);

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        // Submit by hand so the fields keep their values when the action returns errors.
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      <FormMessage error={state.error} />
      {children(state)}
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Annuleren
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
