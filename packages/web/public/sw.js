const CACHE_NAME = "pob-web-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // Purge all old caches on activate so new deploys take effect
  e.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => clients.claim())
  );
});

// Only cache immutable hashed assets and large data files
const CACHEABLE = /\.(js|css|wasm|json|png|webp|jpg|svg|woff2?)(\?|$)/;
const NEVER_CACHE = /(sw\.js|index\.html)$/;

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET, cross-origin, and chrome-extension requests
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  // HTML navigations: always network, no cache
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Hashed assets (contain hash in filename): cache-first
  if (CACHEABLE.test(url.pathname) && !NEVER_CACHE.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else: network-first
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
