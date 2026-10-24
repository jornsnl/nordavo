"use client";

import { useActionState, useState } from "react";
import { KeyRound, Pencil } from "lucide-react";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { ConfirmButton } from "@/components/candidates/confirm-button";
import { PendingSubmit, submitWithoutReset } from "@/components/placements/form-utils";

/** One passkey in the list, with inline rename and revoke. */
export function PasskeyItem({
  id,
  name,
  synced,
  createdAt,
  lastUsedAt,
  renameAction,
  removeAction,
}: {
  id: string;
  name: string;
  synced: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  renameAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
  removeAction: (id: string) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(renameAction, initialActionState);
  // The action state when the rename form was opened: the form closes on the
  // first successful save after that, and older messages stay hidden.
  const [openedWith, setOpenedWith] = useState<ActionState | null>(null);
  const answered = openedWith !== null && state !== openedWith;
  const editing = openedWith !== null && !(answered && state.ok);
  const error = answered ? (state.fieldErrors?.name ?? state.error) : undefined;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
      <KeyRound className="size-5 shrink-0 text-brand-600" aria-hidden="true" />

      {editing ? (
        <form
          onSubmit={submitWithoutReset(formAction)}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          noValidate
        >
          <input type="hidden" name="id" value={id} />
          <label htmlFor={`passkey-name-${id}`} className="sr-only">
            Nieuwe naam voor {name}
          </label>
          <Input
            id={`passkey-name-${id}`}
            name="name"
            defaultValue={name}
            maxLength={80}
            required
            autoFocus
            className="w-56 py-1.5 max-sm:w-full"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `passkey-name-${id}-error` : undefined}
          />
          <PendingSubmit size="sm" variant="secondary" pending={pending} pendingLabel="Bezig">
            Opslaan
          </PendingSubmit>
          <Button size="sm" variant="ghost" onClick={() => setOpenedWith(null)} disabled={pending}>
            Annuleren
          </Button>
          {error && (
            <p id={`passkey-name-${id}-error`} role="alert" className="w-full text-xs font-medium text-danger">
              {error}
            </p>
          )}
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
              <span className="truncate">{name}</span>
              <Badge tone={synced ? "success" : "neutral"}>
                {synced ? "Gesynchroniseerd" : "Op één apparaat"}
              </Badge>
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Toegevoegd {createdAt} · {lastUsedAt ? `laatst gebruikt ${lastUsedAt}` : "nog niet gebruikt"}
            </p>
          </div>
          {/* 44px tap targets on touch screens, also for the confirm dialog. */}
          <div className="flex items-center gap-2 pointer-coarse:[&_button]:min-h-11 max-sm:w-full max-sm:*:flex-1">
            <Button size="sm" variant="ghost" onClick={() => setOpenedWith(state)} aria-label={`${name} hernoemen`}>
              <Pencil aria-hidden="true" />
              Hernoemen
            </Button>
            <ConfirmButton
              size="sm"
              variant="ghost"
              title="Passkey intrekken?"
              description={`Met "${name}" kun je daarna niet meer inloggen. Op het apparaat zelf blijft de passkey bestaan; die kun je daar verwijderen.`}
              confirmLabel="Intrekken"
              action={() => removeAction(id)}
            >
              Intrekken
            </ConfirmButton>
          </div>
        </>
      )}
    </li>
  );
}
