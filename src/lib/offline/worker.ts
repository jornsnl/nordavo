import { deleteDatabase } from "./db";

/** Talking to the service worker (public/sw.js). Browser only; quiet when there is none. */

type Reply = { type: string; [key: string]: unknown };

async function ask<T extends Reply>(message: Record<string, unknown>, replyType: string, timeoutMs = 4000): Promise<T | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  const worker = navigator.serviceWorker.controller ?? registration?.active;
  if (!worker) return null;
  return new Promise<T | null>((resolve) => {
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.data?.type !== replyType) return;
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve(event.data as T);
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    worker.postMessage(message);
  });
}

export type CachedPage = { url: string; cachedAt: number | null };

/** Keeps these pages on the device ahead of time (the worker does it at most once per 5 minutes each). */
export async function warmPages(urls: string[]): Promise<CachedPage[] | null> {
  const reply = await ask<{ type: "warmed"; pages: string[] }>({ type: "warm", urls }, "warmed", 60_000);
  return reply ? reply.pages.map((url) => ({ url, cachedAt: null })) : null;
}

export async function listCachedPages(): Promise<CachedPage[]> {
  const reply = await ask<{ type: "pages"; pages: CachedPage[] }>({ type: "pages" }, "pages");
  return reply?.pages ?? [];
}

/** Whether this page was opened from the device (no connection), and from when. */
export async function pageInfo(): Promise<{ fromCache: boolean; cachedAt: number | null }> {
  const reply = await ask<{ type: "page-info"; fromCache: boolean; cachedAt: number | null }>({ type: "page-info" }, "page-info", 2000);
  return reply ? { fromCache: reply.fromCache, cachedAt: reply.cachedAt } : { fromCache: false, cachedAt: null };
}

/** Sign out: everything this device kept of the portal goes, the database and the pages. */
export async function clearDevice() {
  await Promise.allSettled([
    deleteDatabase(),
    ask({ type: "clear" }, "cleared"),
    typeof caches !== "undefined"
      ? caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("nordavo-pages")).map((k) => caches.delete(k))))
      : Promise.resolve(),
  ]);
  try {
    window.sessionStorage.removeItem(LOCAL_NOTICE_KEY);
  } catch {
    // Storage blocked: nothing kept there either.
  }
}

/** Once per visit: the note that the page came from this device. */
export const LOCAL_NOTICE_KEY = "nordavo.offline.notice";
