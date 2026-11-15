// Offline support and updates.
// Each time the app opens with the internet, the newest app files are fetched (and saved for
// offline use). If the internet is slow or missing, the saved copy is used after a few seconds.
// So closing the app and opening it again is all it takes to get an update.
// Bump VERSION whenever an app file changes (tools/check_brief.py --fix does this).
// Lyrics searches (lrclib.net, lyrics.ovh) are never cached here.
const VERSION = "2026-11-15.7";
const CACHE = `my-songs-${VERSION}`;
const WAIT_MS = 3500;
const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/app.js",
  "js/chords.js",
  "js/db.js",
  "js/online.js",
  "js/template.js",
  "assets/fonts/atkinson-regular.woff",
  "assets/fonts/atkinson-bold.woff",
  "assets/icons/icon-192.png",
  "assets/icons/favicon-64.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    // Keep anything the old copy had that the new one doesn't (nothing is lost if a fetch failed).
    const keys = await caches.keys();
    const fresh = await caches.open(CACHE);
    for (const k of keys) {
      if (!k.startsWith("my-songs-") || k === CACHE) continue;
      const old = await caches.open(k);
      for (const req of await old.keys()) {
        if (!(await fresh.match(req))) await fresh.put(req, await old.match(req));
      }
      await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

function key(req) {
  // Page loads all share one saved copy of the page.
  return req.mode === "navigate" ? "index.html" : req;
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // lyrics lookups go straight to the internet

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = () => cache.match(key(req), { ignoreSearch: true });
    // "no-cache" asks the server whether the file changed, so a new version is never missed.
    const fromNet = fetch(req.mode === "navigate" ? req.url : req, { cache: "no-cache" }).then(res => {
      if (res.ok && res.type === "basic") cache.put(key(req), res.clone());
      return res;
    });
    fromNet.catch(() => {}); // a late failure after the saved copy was used is fine
    const timeout = new Promise(resolve => setTimeout(resolve, WAIT_MS)).then(saved);
    try {
      const first = await Promise.race([fromNet, timeout]);
      if (first) return first;
      return await fromNet;   // nothing saved yet: keep waiting for the internet
    } catch {
      const s = await saved();
      if (s) return s;
      throw new Error("offline and not saved");
    }
  })());
});
