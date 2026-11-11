"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/**
 * Asks why a company was lost (Lost needs a reason). Used by
 * the board when a card is dragged to Lost and by the table when a cell or
 * a bulk edit sets the stage to Lost.
 */
export function LostReasonDialog({
  open,
  description,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** Which company or companies, under the title. */
  description?: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const close = () => {
    setReason("");
    onCancel();
  };
  return (
    <Modal open={open} onClose={close} title="Why was this lost?" description={description}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const text = reason.trim();
          if (!text) return;
          setReason("");
          onConfirm(text);
        }}
      >
        <label className="block space-y-1.5 text-sm font-medium">
          Reason
          <textarea
            required
            autoFocus
            maxLength={2000}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="block w-full rounded-xl border border-border px-3 py-2 font-normal"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!reason.trim()}>
            Move to Lost
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A month from today as YYYY-MM-DD, the default date to get in touch again. */
export function inAMonth(now = new Date()): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Asks until when a company is parked: on that date it comes back as the
 * next action, so a client that says "not now" does not get lost. Used by
 * the board, the table and the lead page.
 */
export function ParkDialog({
  open,
  description,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  description?: string;
  onCancel: () => void;
  onConfirm: (date: string) => void;
}) {
  const [date, setDate] = useState(() => inAMonth());
  const today = new Date().toISOString().slice(0, 10);
  const close = () => {
    setDate(inAMonth());
    onCancel();
  };
  return (
    <Modal open={open} onClose={close} title="Park until when?" description={description}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!date) return;
          onConfirm(date);
          setDate(inAMonth());
        }}
      >
        <label className="block space-y-1.5 text-sm font-medium">
          Get in touch again on
          <input
            type="date"
            required
            autoFocus
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="block w-full rounded-xl border border-border px-3 py-2 font-normal"
          />
        </label>
        <p className="text-sm text-muted">On this date the company shows up as the next action.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!date}>
            Park
          </Button>
        </div>
      </form>
    </Modal>
  );
}
