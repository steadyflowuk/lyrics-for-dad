// Offline support: the app itself is kept on the tablet so saved songs open without the internet.
// Bump VERSION whenever an app file changes so the tablet picks up the update.
// Lyrics searches (lrclib.net, lyrics.ovh) are never cached here.
const VERSION = "2026-11-15.5";
const CACHE = `my-songs-${VERSION}`;
const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/app.js",
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
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("my-songs-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // lyrics lookups go straight to the internet

  if (req.mode === "navigate") {
    // Page loads: try the internet briefly so updates arrive, otherwise use the saved copy.
    const saved = () => caches.match("index.html", { ignoreSearch: true });
    const fromNet = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("index.html", copy)); }
      return res;
    });
    // Don't keep him waiting on slow Wi-Fi: after 3 seconds, open the saved copy instead.
    const slow = new Promise(resolve => setTimeout(resolve, 3000)).then(saved);
    event.respondWith(
      Promise.race([fromNet, slow.then(r => r || fromNet)])
        .then(r => r || saved())
        .catch(() => saved().then(r => r || fromNet))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});
