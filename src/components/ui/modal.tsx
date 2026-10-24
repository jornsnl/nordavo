"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Accessible modal built on the native <dialog> element.
 * Control it with `open` and `onClose`. On phones it is a bottom sheet.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      className={`sheet-up m-auto w-[calc(100%-2rem)] rounded-2xl border border-border bg-card p-0 text-ink shadow-2xl backdrop:bg-brand-950/50 max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 ${
        size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg"
      }`}
    >
      {open && (
        <div className="max-h-[85dvh] overflow-y-auto overscroll-contain max-sm:max-h-[92dvh] max-sm:pb-safe">
          <div aria-hidden="true" className="flex justify-center pt-2.5 sm:hidden">
            <span className="h-1 w-10 rounded-full bg-border" />
          </div>
          <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-card px-5 py-4 sm:px-6">
            <div>
              <h2 id={titleId} className="font-display text-lg font-semibold text-brand-900">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-ink sm:size-9"
              aria-label="Sluiten"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </header>
          <div className="px-5 py-5 sm:px-6">{children}</div>
        </div>
      )}
    </dialog>
  );
}
