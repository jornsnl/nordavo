/*
 * Nordavo service worker: the portal on a phone without a connection.
 *
 *   Build files (/_next/static, hashed) and icons: from the cache first,
 *     they never change under the same name.
 *   App pages (/work, /dashboard, ...): always fresh from the network when
 *     there is one. The last good copy is kept and shown when there is none.
 *     Never kept: a redirect (to sign in), an error, or anything not HTML.
 *     The copy carries the moment it was kept (x-nordavo-cached-at).
 *   Neither: the offline page instead of the browser error.
 *
 * Messages from the page:
 *   { type: "warm", urls }   keep these pages (and the build files they load)
 *                            ahead of time, each at most once per 5 minutes
 *   { type: "clear" }        forget every page (sign out)
 *   { type: "pages" }        which pages open offline, and from when
 *   { type: "page-info" }    whether this page came from the device
 *
 * Writes (POST: server actions) always go to the network; the page keeps
 * them in its own outbox (src/lib/offline) when that fails.
 */
const VERSION = "v2";
const STATIC_CACHE = `nordavo-static-${VERSION}`;
const PAGE_CACHE = `nordavo-pages-${VERSION}`;
const CURRENT = [STATIC_CACHE, PAGE_CACHE];
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];
const CACHED_AT = "x-nordavo-cached-at";
const WARM_EVERY_MS = 5 * 60 * 1000;

/** Signed-in pages that may be kept. Sign in, auth and public pages never are. */
const APP_PREFIXES = ["/dashboard", "/work", "/portal", "/academy", "/caller"];
const NEVER = ["/work/sign-in", "/work/invite", "/work/files", "/auth", "/login", "/api"];

const under = (path, prefixes) => prefixes.some((p) => path === p || path.startsWith(`${p}/`));
const isAppPage = (url) => url.origin === self.location.origin && under(url.pathname, APP_PREFIXES) && !under(url.pathname, NEVER);
const isStatic = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || PRECACHE.includes(url.pathname));

/** Last warm per page, so a page is fetched ahead at most once per 5 minutes. */
const warmedAt = new Map();
/** Pages a client was opened from the device with: clientId -> cachedAt. */
const servedFromCache = new Map();

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("nordavo-") && !CURRENT.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** Pages are kept by path and query, without Next's cache-busting _rsc param. */
function pageKey(url) {
  const u = new URL(url);
  u.searchParams.delete("_rsc");
  u.hash = "";
  return u.toString();
}

function keepable(response) {
  if (!response || !response.ok || response.redirected || response.type !== "basic") return false;
  return (response.headers.get("content-type") || "").includes("text/html");
}

async function keepPage(key, response) {
  const body = await response.clone().arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT, String(Date.now()));
  // A kept copy is never sent as fresh by mistake.
  headers.delete("set-cookie");
  const cache = await caches.open(PAGE_CACHE);
  await cache.put(key, new Response(body, { status: 200, statusText: "OK", headers }));
}

async function cachedPage(url) {
  const cache = await caches.open(PAGE_CACHE);
  const exact = await cache.match(pageKey(url));
  if (exact) return exact;
  // The same page with other filters is better than nothing.
  const u = new URL(url);
  u.search = "";
  return cache.match(u.toString());
}

async function offlinePage() {
  return (await caches.match(OFFLINE_URL)) || new Response("You are offline", { status: 503, headers: { "content-type": "text/plain" } });
}

async function handlePage(event) {
  const { request } = event;
  const url = new URL(request.url);
  try {
    const response = await fetch(request);
    if (isAppPage(url) && keepable(response)) {
      event.waitUntil(keepPage(pageKey(request.url), response).catch(() => {}));
    }
    // The server is down (502, 503): the kept copy beats an error page.
    if (response.status >= 502 && isAppPage(url)) {
      const cached = await cachedPage(request.url);
      if (cached) return cached;
    }
    return response;
  } catch {
    if (isAppPage(url)) {
      const cached = await cachedPage(request.url);
      if (cached) {
        const clientId = event.resultingClientId || event.clientId;
        if (clientId) servedFromCache.set(clientId, Number(cached.headers.get(CACHED_AT)) || null);
        return cached;
      }
    }
    return offlinePage();
  }
}

async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") cache.put(request, response.clone()).catch(() => {});
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate") {
    event.respondWith(handlePage(event));
    return;
  }
  if (isStatic(url)) event.respondWith(handleStatic(request));
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** The build files a page loads: scripts, styles and fonts under /_next/static. */
function buildFiles(html) {
  const files = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) files.add(match[1]);
  return [...files];
}

async function warm(urls) {
  const cache = await caches.open(PAGE_CACHE);
  const staticCache = await caches.open(STATIC_CACHE);
  const kept = [];
  for (const raw of urls) {
    const url = new URL(raw, self.location.origin);
    if (!isAppPage(url)) continue;
    const key = pageKey(url.toString());
    const last = warmedAt.get(key) ?? Number((await cache.match(key))?.headers.get(CACHED_AT)) ?? 0;
    if (last && Date.now() - last < WARM_EVERY_MS) {
      kept.push(key);
      continue;
    }
    try {
      const response = await fetch(url.toString(), { credentials: "same-origin", headers: { accept: "text/html" } });
      if (!keepable(response)) continue;
      await keepPage(key, response);
      warmedAt.set(key, Date.now());
      kept.push(key);
      const html = await response.text();
      await Promise.all(
        buildFiles(html).map(async (file) => {
          if (await staticCache.match(file)) return;
          const asset = await fetch(file);
          if (asset.ok) await staticCache.put(file, asset);
        }),
      );
    } catch {
      // Offline or the server is down: try again on the next warm.
    }
  }
  return kept;
}

async function listPages() {
  const cache = await caches.open(PAGE_CACHE);
  const requests = await cache.keys();
  const pages = [];
  for (const request of requests) {
    const response = await cache.match(request);
    pages.push({ url: request.url, cachedAt: Number(response?.headers.get(CACHED_AT)) || null });
  }
  return pages.sort((a, b) => a.url.localeCompare(b.url));
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  const reply = (message) => event.source && event.source.postMessage(message);
  if (data.type === "warm" && Array.isArray(data.urls)) {
    event.waitUntil(warm(data.urls).then((pages) => reply({ type: "warmed", pages })));
  } else if (data.type === "clear") {
    warmedAt.clear();
    servedFromCache.clear();
    event.waitUntil(caches.delete(PAGE_CACHE).then(() => reply({ type: "cleared" })));
  } else if (data.type === "pages") {
    event.waitUntil(listPages().then((pages) => reply({ type: "pages", pages })));
  } else if (data.type === "page-info") {
    const id = event.source && event.source.id;
    const fromCache = id ? servedFromCache.has(id) : false;
    reply({ type: "page-info", fromCache, cachedAt: fromCache ? servedFromCache.get(id) : null });
  }
});
