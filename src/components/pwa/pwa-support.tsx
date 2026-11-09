"use client";

import { useEffect, useState } from "react";
import { Share, SquarePlus, X } from "lucide-react";
import { INSTALL_HINT_KEY, shouldShowInstallHint } from "@/lib/pwa/install-hint";
import { countOutbox, isAvailable } from "@/lib/offline/db";
import { clearDevice } from "@/lib/offline/worker";

/** Pages where the hint makes sense: signed in areas, not the public form or sign in. */
const HINT_PATHS = ["/dashboard", "/portal", "/work", "/academy"];

/**
 * The installable part, the same layouts that link the manifest
 * (installableMetadata). Public pages (/apply, /working-style, invites) do
 * not register the service worker.
 */
export const APP_PATHS = ["/dashboard", "/portal", "/work", "/academy", "/caller", "/login"];

const under = (paths: string[], path: string) => paths.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Home screen app support:
 * 1. registers the service worker (offline page) in production, in the app part only;
 * 2. on iPhone and iPad in the browser, explains once how to put Nordavo on
 *    the home screen. iOS has no install button or prompt for web apps, so
 *    this is the only way people find out. Dismissed for 30 days.
 */
export function PwaSupport() {
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const path = window.location.pathname;
    // Production only: in development the worker would serve stale builds.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator && under(APP_PATHS, path)) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }

    if (!under(HINT_PATHS, path)) return;

    let dismissedAt: number | null = null;
    try {
      const raw = window.localStorage.getItem(INSTALL_HINT_KEY);
      dismissedAt = raw ? Number(raw) : null;
    } catch {
      // Storage blocked (private mode): just show the hint.
    }

    const standalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;

    const show = shouldShowInstallHint({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      standalone,
      dismissedAt,
      now: Date.now(),
    });
    if (!show) return;
    // Let the page settle first, so the hint is not the first thing that moves.
    const timer = window.setTimeout(() => setShowHint(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  // Sign out wipes what this device kept (src/lib/offline), after a warning
  // when changes have not reached the server yet. Every shell signs out with
  // a form posting to /auth/signout, so one listener covers them all.
  useEffect(() => {
    const onSubmit = async (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.action.includes("/auth/signout") || form.dataset.cleared) return;
      event.preventDefault();
      let pending = 0;
      try {
        pending = isAvailable() ? await countOutbox() : 0;
      } catch {
        // No database: nothing waiting.
      }
      if (
        pending > 0 &&
        !window.confirm(
          `${pending === 1 ? "1 change on this device has" : `${pending} changes on this device have`} not reached the server yet. If you sign out now, ${pending === 1 ? "it is" : "they are"} lost. Sign out anyway?`,
        )
      ) {
        return;
      }
      await clearDevice();
      form.dataset.cleared = "1";
      // form.submit() skips this listener and posts the form as before.
      form.submit();
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  function dismiss() {
    setShowHint(false);
    try {
      window.localStorage.setItem(INSTALL_HINT_KEY, String(Date.now()));
    } catch {
      // Ignore: the hint simply comes back next time.
    }
  }

  if (!showHint) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="pwa-hint-title"
      aria-describedby="pwa-hint-body"
      className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 mx-auto max-w-md rounded-2xl border border-brand-200 bg-white/95 p-4 shadow-xl backdrop-blur lg:bottom-6"
    >
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p id="pwa-hint-title" className="font-display text-sm font-semibold text-brand-900">
            Put Nordavo on your home screen
          </p>
          <p id="pwa-hint-body" className="mt-1 text-sm text-muted">
            Tap <Share className="inline size-4 align-text-bottom" aria-label="Share" /> in the browser bar, then{" "}
            <span className="whitespace-nowrap font-medium text-ink">
              <SquarePlus className="inline size-4 align-text-bottom" aria-hidden="true" /> Add to Home Screen
            </span>
            . Nordavo then opens full screen, like an app.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="-mt-1 -mr-1 grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-brand-50 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
