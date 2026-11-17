"use client";

import { ExternalLink } from "lucide-react";
import { Modal } from "@/components/ui/modal";

/**
 * The Cal.com agenda inside the call screen (feedback Julius): the caller looks at the
 * calendar with the prospect, without leaving the page and without saving an outcome.
 * Cal.com booking pages may be framed; when a browser blocks it, the link below opens
 * the same page in a new tab.
 */
export function BookingModal({
  open,
  url,
  title,
  description,
  onClose,
  links,
  activeLink,
  onPickLink,
}: {
  open: boolean;
  /** The prefilled Cal.com link; null keeps the window empty. */
  url: string | null;
  title: string;
  description?: string;
  onClose: () => void;
  /** More than one link (Julius, Floris): pick whose agenda to show. */
  links?: { id: string; label: string }[];
  activeLink?: string;
  onPickLink?: (id: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} size="lg">
      {open && url && (
        <div className="space-y-3">
          {links && links.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Whose agenda">
              {links.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={l.id === activeLink}
                  onClick={() => onPickLink?.(l.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium pointer-coarse:min-h-11 ${l.id === activeLink ? "bg-brand-700 text-white" : "bg-surface text-muted hover:text-brand-900"}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
          <iframe
            src={url}
            title={title}
            className="h-[65dvh] w-full rounded-xl border border-border bg-white"
            allow="payment; clipboard-write"
          />
          <p className="text-xs text-muted">
            Does the calendar not load?{" "}
            <a href={url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium text-brand-700 underline">
              Open it in a new tab
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </p>
        </div>
      )}
    </Modal>
  );
}
