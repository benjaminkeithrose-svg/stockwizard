// Stock Wizard service worker. Bump CACHE with APP_BUILD in src/config.ts on
// every change (a test checks they agree), or phones keep the old build.
const CACHE = "stockwizard-sw-v25";

self.addEventListener("install", (e) => {
  // Cache the shell; each file on its own, so one failure cannot block the rest.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(["./", "./index.html", "./manifest.webmanifest", "./icon.svg"].map((u) => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("stockwizard-") && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Only the app's own files. Supabase and everything else go straight to the network.
  if (e.request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html"))),
  );
});
