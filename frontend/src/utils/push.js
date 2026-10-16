// ---------------------------------------------------------------------------
// Push notifications, the browser's side: asking for permission, subscribing
// this device at its browser's push service, and telling the league server
// about it (backend routes/push.js). The worker that shows the messages is
// public/sw.js; the pure decisions are utils/pushKeys.mjs.
//
// A subscription belongs to the DEVICE (this browser on this phone), not to
// the account. The account's choice of what to push lives on the server and
// applies to every device; whether this one gets anything is decided here.
// ---------------------------------------------------------------------------
import { api } from "../api/client.js";
import { isAppleMobile, keyBytes, sameServerKey, syncDue } from "./pushKeys.mjs";

const SYNC_KEY = "nabs_push_sync"; // { at, user } of the last check-in

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// On an iPhone or iPad, push only exists for the site opened from the Home
// Screen; in Safari itself the switch would do nothing.
export function needsHomeScreen() {
  if (typeof navigator === "undefined") return false;
  if (!isAppleMobile(navigator.userAgent, navigator.maxTouchPoints || 0)) return false;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
  return !standalone;
}

export function pushPermission() {
  return typeof Notification === "undefined" ? "default" : Notification.permission;
}

// The worker's registration. `ready` never settles where no worker was ever
// registered (a dev build registers none, see main.jsx), so it gives up.
async function registration(timeoutMs = 5000) {
  if (!pushSupported()) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

export async function currentSubscription() {
  const reg = await registration();
  if (!reg) return null;
  try {
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

function markSynced(user) {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ at: Date.now(), user: user || null }));
  } catch {
    /* private mode: the next visit just checks in again */
  }
}

function lastSync() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_KEY) || "null") || {};
  } catch {
    return {};
  }
}

async function subscribeWith(reg, publicKey) {
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameServerKey(sub.options?.applicationServerKey, publicKey)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  return sub;
}

// Switch push on for this device. Must run straight from a tap: Safari only
// shows the permission question to a page that asks in direct answer to one,
// which is why the question goes out before anything else is awaited.
// Throws { code: "denied" | "dismissed" | "unsupported" } for the page to word.
export async function enablePush(publicKey, user = null) {
  if (!pushSupported()) throw Object.assign(new Error("unsupported"), { code: "unsupported" });
  const asked = Notification.requestPermission();
  const regPromise = registration();
  const permission = await asked;
  if (permission !== "granted") {
    throw Object.assign(new Error(permission), { code: permission === "denied" ? "denied" : "dismissed" });
  }
  const reg = await regPromise;
  if (!reg) throw Object.assign(new Error("unsupported"), { code: "unsupported" });
  const sub = await subscribeWith(reg, publicKey);
  const res = await api.pushSubscribe(sub.toJSON());
  markSynced(user);
  return { ...res, endpoint: sub.endpoint };
}

// Switch it off for this device: the server forgets it, and so does the
// browser, so nothing arrives even from a message already on its way.
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return null;
  const res = await api.pushUnsubscribe(sub.endpoint).catch(() => null);
  await sub.unsubscribe().catch(() => {});
  return res;
}

// Signing out: this device must stop showing the account's messages. The
// session is already gone by then, so the server cannot be told; dropping the
// browser's subscription is enough, the next message to it comes back "gone"
// and the server forgets the device (lib/push.js).
export async function dropLocalSubscription() {
  const sub = await currentSubscription();
  if (sub) await sub.unsubscribe().catch(() => {});
  try {
    localStorage.removeItem(SYNC_KEY);
  } catch {
    /* nothing to forget */
  }
}

// The daily check-in (components/PushBridge.jsx): a device with push on tells
// the server it is still there, under whoever is signed in now, and picks up a
// subscription the browser renewed by itself (sw.js, pushsubscriptionchange).
export async function syncPushSubscription(user) {
  if (!pushSupported() || pushPermission() !== "granted") return;
  const last = lastSync();
  if (!syncDue(last.at, Date.now(), user, last.user)) return;
  const reg = await registration();
  if (!reg) return;
  const existing = await reg.pushManager.getSubscription().catch(() => null);
  if (!existing) return;
  const status = await api.pushStatus().catch(() => null);
  if (!status?.available || !status.publicKey) return;
  const sub = await subscribeWith(reg, status.publicKey).catch(() => null);
  if (!sub) return;
  await api.pushSubscribe(sub.toJSON());
  markSynced(user);
}
