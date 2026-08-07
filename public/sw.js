// Offline service worker: HTML is network-first (fresh when online, cached when
// offline); hashed assets (JS/CSS/WASM) are cache-first (immutable by hash, so
// new deploys fetch new files — no stale-asset trap). Once loaded online, the
// whole tool works fully offline. Cross-origin requests are left untouched.
const CACHE = "ot-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // ignore Plausible, GitHub API, etc.

  const isHTML =
    req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./"))),
    );
  } else {
    e.respondWith(
      caches.match(req).then(
        (r) =>
          r ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
