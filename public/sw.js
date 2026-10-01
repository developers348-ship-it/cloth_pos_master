// ─── Service Worker — Sidhey Sheikh Cloth Center POS ────────────────────────
// Strategy:
//   • Static assets (_next/static) → Cache First
//   • API routes (/api)            → Network First, no caching
//   • Navigation (HTML pages)      → Network First, offline.html fallback
//   • Fonts / images               → Cache First (long TTL)

const CACHE_NAME = "sscc-pos-v4";
const OFFLINE_URL = "/offline.html";

// `cache.addAll()` is atomic: one 404 here rejects the whole install and the
// service worker never activates, so this list has to stay honest. That is why
// the cache name is bumped alongside it — the old v3 entry named
// "/manifest.json", which stopped existing when the static manifest was
// replaced by the generated `app/manifest.ts` (served at /manifest.webmanifest).
const PRECACHE_URLS = [
  "/",
  "/dashboard",
  "/offline.html",
  "/manifest.webmanifest",
];


// ─── Install ─────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ─── Activate ────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch ───────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // API → Network only (never cache sensitive data)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request).catch(() => new Response(
      JSON.stringify({ error: "offline" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    )));
    return;
  }

  // Static assets → Cache First
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fonts/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          return res;
        });
      })
    );
    return;
  }

  // Navigation → Network First, offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r ?? new Response("Offline", { status: 503 }))
      )
    );
    return;
  }

  // Everything else → Network First
  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((r) => r ?? Response.error()))
  );
});
