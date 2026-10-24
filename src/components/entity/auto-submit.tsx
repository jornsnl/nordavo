"use client";

import type { ReactNode } from "react";

/**
 * Submits the surrounding filter form as soon as a select changes, on
 * phones only, where the form has no Filteren button. Desktop keeps the
 * explicit button.
 */
export function AutoSubmitSelects({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={className}
      onChange={(event) => {
        const target = event.target as HTMLElement;
        if (target.tagName !== "SELECT" || !window.matchMedia("(max-width: 639px)").matches) return;
        target.closest("form")?.requestSubmit();
      }}
    >
      {children}
    </div>
  );
}
