/* eslint-env serviceworker */
// ---------------------------------------------------------------------------
// The service worker. Small, hand-written, no build step and no library.
//
// What it is FOR: the site is used on a phone, at a track day, on a train, and
// installed to the home screen by a fair number of members. Without a worker,
// opening the app with no signal shows the browser's own error page, which in
// an installed app looks like the app is broken. It also makes a returning
// visit noticeably quicker, because the fonts, flags, team logos and the hashed
// JavaScript bundles no longer come down the wire again.
//
// What it is EMPHATICALLY NOT for: caching data. Everything under /api is live
// (standings after a race, who has signed up, the live timing feed, anything
// behind a login) and is never touched here. A stale standings table would be
// worse than no standings table.
//
// THE STALE-APP TRAP, and how this avoids it. The classic service worker bug is
// serving yesterday's index.html from cache, which points at JavaScript bundles
// the server deleted in the last deploy, and the site is dead until the visitor
// clears their browser. So:
//
//   navigations   NETWORK FIRST. index.html always comes fresh when there is a
//                 connection; the cache is only consulted when the network says
//                 no, and even then only to show the offline page.
//   /assets/*     cache first, because Vite puts a content hash in every one of
//                 those file names. A given URL's content can never change, so
//                 a hit is always correct, and a new build simply asks for new
//                 names.
//   images/fonts  cache first as well, refreshed in the background: a team logo
//                 or a flag that changed is not worth a round trip on every
//                 page, but it should not be frozen for ever either.
//   everything else, /api included, goes straight to the network, untouched.
//
// Bumping CACHE_VERSION throws away every previous cache on activation. Do it
// when the caching rules below change; the hashed file names take care of the
// ordinary case (a new deploy) on their own.
// ---------------------------------------------------------------------------

const CACHE_VERSION = "v1";
const SHELL_CACHE = `nabs-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `nabs-assets-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

// The only thing precached: the page shown when there is no connection. It is
// deliberately standalone (its own inline styles, no JavaScript, no font file),
// so it renders even when nothing else in the cache survived.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      // A failed precache must not block installation: the worker is still
      // useful for assets, and the offline page will be fetched on demand.
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("nabs-") && k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

const isAsset = (url) => url.pathname.startsWith("/assets/");
const isMedia = (url) =>
  /\.(png|jpe?g|webp|gif|svg|ico|woff2?)$/i.test(url.pathname) &&
  // Uploads are member content that can be replaced under the same name
  // (a new profile picture keeps the driver's id); leave those to the network,
  // which already sends them with a cache-busting ?v= anyway.
  !url.pathname.startsWith("/api/");

async function cacheFirst(request, cacheName, { revalidate = false } = {}) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) {
    if (revalidate) {
      // Refresh in the background. Failures are ignored on purpose: the visitor
      // already has a usable answer in their hands.
      fetch(request)
        .then((res) => (res.ok ? cache.put(request, res.clone()) : null))
        .catch(() => {});
    }
    return hit;
  }
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone()).catch(() => {});
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only ever plain GETs from this origin. A POST (signing up for a race,
  // filing a report) must never be replayed or intercepted.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live data, uploads, downloads, the login callbacks: all straight through.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return (
          (await cache.match(OFFLINE_URL)) ||
          new Response("You are offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      })
    );
    return;
  }

  if (isAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE).catch(() => fetch(request)));
    return;
  }
  if (isMedia(url)) {
    event.respondWith(
      cacheFirst(request, ASSET_CACHE, { revalidate: true }).catch(() => fetch(request))
    );
  }
});
