"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import Link from "next/link";
import { SlidersHorizontal, X } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

/**
 * Filter fields that sit inline on desktop and in a bottom sheet on phones.
 * Render it inside the filter <form>: the fields stay in the DOM while the
 * sheet is closed, so a search from the bar above still keeps every filter.
 * The sheet is a native <dialog>, styled like <Modal>; from md up it is shown
 * as a plain block.
 */
export function FilterSheet({
  activeCount,
  resetHref,
  title = "Filters",
  className = "",
  children,
}: {
  /** Number of filters that are set, shown on the button. */
  activeCount: number;
  /** Link that clears all filters. */
  resetHref: string;
  title?: string;
  /** Extra classes for the inline (desktop) block, e.g. md:basis-full. */
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Close the sheet when the form is sent, e.g. with the return key in a field.
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const close = () => ref.current?.close();
    form.addEventListener("submit", close);
    return () => form.removeEventListener("submit", close);
  }, []);

  return (
    <>
      <FilterButton activeCount={activeCount} onClick={() => ref.current?.showModal()} />
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClick={(event) => {
          if (event.target === ref.current) ref.current.close();
        }}
        className={`sheet-up border-0 max-md:mx-0 max-md:mt-auto max-md:mb-0 max-md:max-h-[92dvh] max-md:w-full max-md:max-w-none max-md:overflow-y-auto max-md:overscroll-contain max-md:rounded-t-2xl max-md:border-t max-md:border-border max-md:bg-card max-md:p-0 max-md:pb-safe max-md:text-ink max-md:shadow-2xl max-md:backdrop:bg-brand-950/50 md:static md:m-0 md:block md:w-auto md:max-w-none md:bg-transparent md:p-0 md:text-inherit ${className}`}
      >
        <div aria-hidden="true" className="flex justify-center pt-2.5 md:hidden">
          <span className="h-1 w-10 rounded-full bg-border" />
        </div>
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-card px-5 py-3 md:hidden">
          <h2 id={titleId} className="font-display text-lg font-semibold text-brand-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="flex size-11 items-center justify-center rounded-lg text-muted active:bg-brand-50"
            aria-label="Sluiten"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>
        <div className="max-md:px-5 max-md:py-5">{children}</div>
        <div className="sticky bottom-0 flex gap-2 border-t border-border bg-card px-5 py-3 md:hidden">
          <Link href={resetHref} onClick={() => ref.current?.close()} className={buttonClasses({ variant: "secondary", className: "flex-1" })}>
            Wissen
          </Link>
          <button type="submit" className={buttonClasses({ className: "flex-1" })}>
            Toon resultaten
          </button>
        </div>
      </dialog>
    </>
  );
}

/** "Filters" button with the number of active filters, phones only. */
function FilterButton({ activeCount, onClick }: { activeCount: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={buttonClasses({ variant: "secondary", className: "shrink-0 md:hidden" })}
    >
      <SlidersHorizontal aria-hidden="true" />
      Filters
      {activeCount > 0 && (
        <span className="flex min-w-5 items-center justify-center rounded-full bg-brand-700 px-1.5 text-xs text-white tabular-nums">
          {activeCount}
          <span className="sr-only"> actief</span>
        </span>
      )}
    </button>
  );
}
