import type { ReactNode } from "react";

/**
 * Cancel and submit row at the bottom of a long create or edit form. On
 * phones it sticks above the tab bar, so saving never needs a scroll to the
 * end; the submit button (the last child) takes most of the width. From sm
 * it is the usual right aligned row. `bleed` matches the horizontal padding
 * of the surrounding card, so the bar reaches its edges.
 */
export function FormActions({
  children,
  bleed = "max-sm:-mx-4 max-sm:px-4",
  divider = true,
}: {
  children: ReactNode;
  bleed?: string;
  /** A line above the buttons from sm on too; phones always get one. */
  divider?: boolean;
}) {
  return (
    <div
      className={`flex gap-2 border-border max-sm:border-t ${divider ? "border-t pt-5" : ""} max-sm:sticky max-sm:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] max-sm:z-20 max-sm:bg-card/95 max-sm:pb-3 max-sm:pt-3 max-sm:backdrop-blur max-sm:*:flex-1 max-sm:*:whitespace-nowrap max-sm:*:last:flex-[2] sm:justify-end ${bleed}`}
    >
      {children}
    </div>
  );
}
