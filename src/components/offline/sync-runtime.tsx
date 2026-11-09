"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "@/components/ui/toaster";
import { REJECTED_EVENT, RETRY_MS, SYNCED_EVENT, flush, refreshState, releaseStale } from "@/lib/offline/sync";
import { LOCAL_NOTICE_KEY, pageInfo, warmPages } from "@/lib/offline/worker";

/** Data on screen older than this is fetched again when the app comes back to the front. */
export const STALE_AFTER_MS = 30_000;

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The background work of offline sync, once per shell:
 *   * sends the outbox when the connection comes back and every 20 seconds;
 *   * fetches the page again after changes reached the server;
 *   * tells about changes the server refused;
 *   * asks the service worker to keep the main pages for offline;
 *   * says once per visit that the page came from this device;
 *   * refreshes on focus only what is older than 30 seconds. An installed
 *     app gets a focus event on every switch, so this keeps it from
 *     reloading all the time.
 */
export function SyncRuntime({ warm }: { warm: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const freshAt = useRef(0);

  // A navigation fetched fresh data.
  useEffect(() => {
    freshAt.current = Date.now();
  }, [pathname]);

  useEffect(() => {
    void releaseStale().catch(() => {});
    void flush();
    const onOnline = () => void flush();
    const onOffline = () => void refreshState();
    const timer = window.setInterval(() => void flush(), RETRY_MS);
    let refreshTimer: number | undefined;
    const onSynced = () => {
      // Several changes in a row: one refresh after the last.
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        freshAt.current = Date.now();
        router.refresh();
      }, 300);
    };
    const onRejected = (event: Event) => {
      const { label, error } = (event as CustomEvent<{ label: string; error: string }>).detail;
      toast(label ? `Not saved: ${label}. ${error}` : error, { tone: "error" });
    };
    const onFront = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (Date.now() - freshAt.current < STALE_AFTER_MS) return;
      freshAt.current = Date.now();
      router.refresh();
      void flush();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(SYNCED_EVENT, onSynced);
    window.addEventListener(REJECTED_EVENT, onRejected);
    window.addEventListener("focus", onFront);
    document.addEventListener("visibilitychange", onFront);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(refreshTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(SYNCED_EVENT, onSynced);
      window.removeEventListener(REJECTED_EVENT, onRejected);
      window.removeEventListener("focus", onFront);
      document.removeEventListener("visibilitychange", onFront);
    };
  }, [router]);

  // The main pages, kept ahead of time while online (the worker limits it to once per 5 minutes a page).
  const warmKey = warm.join("|");
  useEffect(() => {
    if (!navigator.onLine) return;
    const timer = window.setTimeout(() => void warmPages(warmKey.split("|")), 1500);
    return () => window.clearTimeout(timer);
  }, [warmKey, pathname]);

  // Once per visit: this page came from the device.
  useEffect(() => {
    let shown = false;
    try {
      shown = window.sessionStorage.getItem(LOCAL_NOTICE_KEY) === "1";
    } catch {
      // Storage blocked: show it.
    }
    if (shown) return;
    void pageInfo().then(({ fromCache, cachedAt }) => {
      if (!fromCache) return;
      try {
        window.sessionStorage.setItem(LOCAL_NOTICE_KEY, "1");
      } catch {
        // Ignore: it may show once more.
      }
      toast(
        `No connection: this page opened from your device${cachedAt ? ` (saved ${time(cachedAt)})` : ""}. Changes are sent when you are back online.`,
        { tone: "info", duration: 7000 },
      );
    });
  }, [pathname]);

  return null;
}
