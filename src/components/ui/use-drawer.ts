"use client";

import { useEffect } from "react";

/** Open drawers and sheets that hold the page scroll; the lock lifts when the last one closes. */
let locks = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

function lockScroll() {
  if (locks++ > 0) return;
  const root = document.documentElement;
  const scrollbar = window.innerWidth - root.clientWidth;
  saved = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
  root.style.overflow = "hidden";
  // Keep the page from shifting where the scroll bar takes room (desktop).
  if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
}

function unlockScroll() {
  if (--locks > 0 || !saved) return;
  const root = document.documentElement;
  root.style.overflow = saved.overflow;
  root.style.paddingRight = saved.paddingRight;
  saved = null;
}

/** Locks the page scroll while `active` (drawers, bottom sheets). */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lockScroll();
    return unlockScroll;
  }, [active]);
}

/**
 * Behaviour of a slide-in menu: Escape closes it, the page behind it does
 * not scroll, and focus goes into the drawer on open and back to what opened
 * it on close.
 */
export function useDrawer(open: boolean, close: () => void, panelId: string) {
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    // After the slide starts, so the focus ring does not jump around.
    const timer = window.setTimeout(() => {
      const panel = document.getElementById(panelId);
      (panel?.querySelector<HTMLElement>("[data-drawer-focus]") ?? panel?.querySelector<HTMLElement>("input, a[href], button:not([disabled])"))?.focus({ preventScroll: true });
    }, 50);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
      opener?.focus({ preventScroll: true });
    };
  }, [open, close, panelId]);
}
