"use client";

import { useId, useState } from "react";
import { Ban, PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";

export type ExitMode = "park" | "reject";

export type ExitRequest = {
  mode: ExitMode;
  /** "Asha" for one card, "12 candidates" for a bulk action. */
  subject: string;
};

const copy: Record<ExitMode, { title: string; placeholder: string; confirm: string }> = {
  park: {
    title: "Park",
    placeholder: "For example: good profile, but notice period of 90 days.",
    confirm: "Park",
  },
  reject: {
    title: "Reject",
    placeholder: "For example: English not strong enough for client contact.",
    confirm: "Reject",
  },
};

/**
 * Parking and rejecting use the same modal, so parking is exactly as easy:
 * a reason (optional for both) and, for parking, an optional date to look
 * at the candidate again.
 */
export function ExitModal({
  request,
  onConfirm,
  onCancel,
}: {
  request: ExitRequest | null;
  onConfirm: (input: { reason: string; parkUntil?: string }) => void;
  onCancel: () => void;
}) {
  const mode = request?.mode ?? "park";
  return (
    <Modal open={!!request} onClose={onCancel} title={copy[mode].title} description={request?.subject}>
      {request && <ExitForm key={`${request.mode}-${request.subject}`} mode={request.mode} onConfirm={onConfirm} onCancel={onCancel} />}
    </Modal>
  );
}

function ExitForm({
  mode,
  onConfirm,
  onCancel,
}: {
  mode: ExitMode;
  onConfirm: (input: { reason: string; parkUntil?: string }) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [parkUntil, setParkUntil] = useState("");
  const Icon = mode === "park" ? PauseCircle : Ban;

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm({ reason: reason.trim(), parkUntil: mode === "park" && parkUntil ? parkUntil : undefined });
      }}
    >
      <Field
        label="Reason"
        htmlFor={`${id}-reason`}
        hint={mode === "park" ? "Shown on the card, so you know why when you pick it up again." : "Helps with the next selection."}
      >
        <Textarea
          id={`${id}-reason`}
          rows={3}
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={copy[mode].placeholder}
          autoFocus
        />
      </Field>
      {mode === "park" && (
        <Field label="Look again on" htmlFor={`${id}-until`} hint="Optional.">
          <Input id={`${id}-until`} type="date" value={parkUntil} onChange={(e) => setParkUntil(e.target.value)} />
        </Field>
      )}
      <div className="flex gap-3 max-sm:*:flex-1 sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant={mode === "park" ? "primary" : "danger"}>
          <Icon aria-hidden="true" />
          {copy[mode].confirm}
        </Button>
      </div>
    </form>
  );
}
