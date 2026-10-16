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
//   images/fonts  cache first as well, revalidated in the background: a team
//                 logo or a flag that changed is not worth waiting for, but it
//                 must not be frozen either, so the copy on screen is the
//                 cached one and the next page load has the new one.
//   everything else, /api included, goes straight to the network, untouched.
//
// Bumping CACHE_VERSION throws away every previous cache on activation. Do it
// when the caching rules below change; the hashed file names take care of the
// ordinary case (a new deploy) on their own.
//
// It also delivers PUSH NOTIFICATIONS, at the bottom of this file: the bell's
// entries, on the lock screen, for members who switched that on (backend
// lib/push.js). Showing one and opening its link is all it does with them.
// ---------------------------------------------------------------------------

const CACHE_VERSION = "v2";
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
      //
      // `cache: "no-cache"` is the whole point of this line and was missing:
      // a plain fetch() is allowed to come out of the BROWSER's own cache, and
      // these files are served with a week's max-age, so the "refresh" was
      // quietly re-storing the same stale bytes for up to seven days. A shop
      // picture or a team logo replaced under its old name never arrived. This
      // forces a conditional request instead — one ETag round trip, answered
      // with a 304 and no body while the file is unchanged.
      fetch(request, { cache: "no-cache" })
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

// ---------------------------------------------------------------------------
// Push notifications.
//
// The server sends one bell entry per message, already in the shape it will be
// shown in: { title, body, url, tag, type } (backend lib/push.js). Every push
// has to end in a visible notification, which is also the promise the page
// made when it subscribed (`userVisibleOnly`), so there is no silent branch.
//
// The tag lets a newer message replace an older one on the lock screen: a
// race's "coming up" gives way to its "race day" instead of stacking beside
// it. `renotify` makes the replacement buzz again, which is the point of a
// reminder.
// ---------------------------------------------------------------------------
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "NABS Racing";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    // Android draws the small status-bar icon from this picture's outline
    // only, so it is the logo in white on nothing.
    badge: "/push-badge.png",
    data: { url: data.url || "/" },
  };
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // A tab that is open right now counts the new entry at once instead of
      // at its next minute's poll (components/NotificationBell.jsx).
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((tabs) => tabs.forEach((tab) => tab.postMessage({ type: "nabs-push" })))
        .catch(() => {}),
    ])
  );
});

// The open app is asked to go there itself (a client-side navigation keeps the
// signed-in session and whatever it was showing, see components/PushBridge.jsx)
// and answers on a private channel. An app that does not answer in time, a tab
// opened before this deploy, is navigated the hard way instead.
function askAppToOpen(tab, url) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 800);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
    try {
      tab.postMessage({ type: "nabs-open", url }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  event.waitUntil(
    (async () => {
      // An admin's announcement may point off the site: open it as it is.
      if (target.origin !== self.location.origin) return self.clients.openWindow(target.href);
      const path = target.pathname + target.search + target.hash;
      const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const tab = tabs.find((t) => new URL(t.url).origin === self.location.origin);
      if (!tab) return self.clients.openWindow(target.href);
      await tab.focus().catch(() => {});
      if (await askAppToOpen(tab, path)) return undefined;
      if ("navigate" in tab) return tab.navigate(target.href).catch(() => self.clients.openWindow(target.href));
      return self.clients.openWindow(target.href);
    })()
  );
});

// The browser renewed this device's subscription on its own (Firefox does,
// now and then). Subscribe again with the same server key so the device keeps
// receiving; the worker has no session to tell the server with, so the app
// does that the next time it is opened (utils/push.js, syncPushSubscription).
self.addEventListener("pushsubscriptionchange", (event) => {
  const key = event.oldSubscription?.options?.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => {})
  );
});
