"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/**
 * Asks why a company was lost (section 2.5: Lost needs a reason). Used by
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
