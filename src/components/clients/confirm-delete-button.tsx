"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState, type ActionState } from "@/lib/action-state";

/** A delete button that asks for confirmation in a modal before running the action. */
export function ConfirmDeleteButton({
  action,
  title,
  description,
  label = "Verwijderen",
  confirmLabel = "Ja, verwijder",
  iconOnly = false,
  size = "md",
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  title: string;
  description: string;
  label?: string;
  confirmLabel?: string;
  iconOnly?: boolean;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result?.ok) setOpen(false);
    return result ?? prev;
  }, initialActionState);

  return (
    <>
      {iconOnly ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          aria-label={label}
          title={label}
          className="text-danger hover:bg-danger-bg"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      ) : (
        <Button variant="secondary" size={size} onClick={() => setOpen(true)}>
          <Trash2 aria-hidden="true" />
          {label}
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <form action={formAction} className="space-y-5">
          <p className="text-sm leading-relaxed text-muted">{description}</p>
          <FormMessage error={state.error} />
          <div className="flex gap-2 max-sm:*:flex-1 sm:justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Annuleren
            </Button>
            <SubmitButton variant="danger" pendingLabel="Bezig met verwijderen">
              {confirmLabel}
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
