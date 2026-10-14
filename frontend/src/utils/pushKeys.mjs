// ---------------------------------------------------------------------------
// The pure half of the browser's push plumbing (utils/push.js has the rest):
// small decisions that do not need a browser, so node --test can check them.
// ---------------------------------------------------------------------------

// The server's public key arrives as base64url text; PushManager.subscribe()
// wants the raw bytes.
export function keyBytes(base64url) {
  const s = String(base64url || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Was this subscription made with this server key? A device that subscribed
// before the server's key changed has to subscribe again, or every message to
// it is refused. `subscriptionKey` is subscription.options.applicationServerKey
// (an ArrayBuffer, or null where the browser does not say).
export function sameServerKey(subscriptionKey, publicKey) {
  if (!subscriptionKey) return true; // cannot tell: keep it, the server drops a dead one
  const a = new Uint8Array(subscriptionKey);
  const b = keyBytes(publicKey);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// iPhone and iPad, including the iPad that calls itself a Mac. On those, a page
// can only receive push once it has been added to the Home Screen and opened
// from there (iOS 16.4 and later).
export function isAppleMobile(userAgent = "", maxTouchPoints = 0) {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

// The device tells the server it is still there at most once a day: enough to
// heal a subscription the browser renewed on its own, and to move a shared
// device to whoever signed in on it last, without a request on every visit.
export const SYNC_EVERY_MS = 24 * 3600 * 1000;

export function syncDue(lastSync, now = Date.now(), user = null, lastUser = null) {
  if (user && lastUser && user !== lastUser) return true;
  const t = Number(lastSync);
  return !Number.isFinite(t) || t <= 0 || now - t >= SYNC_EVERY_MS;
}
