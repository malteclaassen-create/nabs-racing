import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { rememberDevSignOut } from "../devAutoLogin.js";

const TOKEN_KEY = "nabs_user_token";
const USER_KEY = "nabs_user";

export function getUserToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveUser(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event("nabs-auth"));
}

export function clearUser() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  // On a dev machine the auto-login would put the session straight back on the
  // next page load, which is not what pressing "sign out" means. No-op in a
  // build. See devAutoLogin.js.
  rememberDevSignOut();
  window.dispatchEvent(new Event("nabs-auth"));
}

// The Discord session is a 30-day JWT. Once it expires the backend treats the
// visitor as logged out, so the UI must too — otherwise the nav keeps showing
// "signed in" while every member action fails. The expiry rides in the token
// itself (exp, seconds since epoch), readable without any secret.
export function tokenExpired(token) {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" && payload.exp * 1000 < Date.now();
  } catch {
    return false; // unreadable token: let the backend be the judge
  }
}

function readUser() {
  try {
    // An expired (or missing) token means the stored profile is a dead
    // session — drop it so the whole UI flips to logged-out in one go.
    if (tokenExpired(localStorage.getItem(TOKEN_KEY))) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return null;
    }
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// The stored profile is a snapshot from the moment of LOGIN, and the driver
// link is not: an admin links a new member's account in the Members tab AFTER
// they first signed in, and until now the snapshot's empty driverId hid every
// member control (the attendance buttons, above all) until they signed out and
// back in. The backend has resolved the link fresh on every request all along
// (middleware/auth.js resolveDriverId) — it was only this snapshot that was
// stale. So once per page load, ask /api/me who this session is NOW and fold
// the answer back into the snapshot. Silent when nothing changed; a failed
// fetch (offline, expired token) leaves the snapshot as it was.
let checkedLink = false;
async function refreshDriverLink() {
  if (checkedLink) return;
  checkedLink = true;
  const user = readUser();
  if (!user) return;
  try {
    const me = await api.me();
    const freshId = me?.isLinked ? me.driverId : null;
    // The name follows the driver: after Steam found a returning driver, or a
    // merge took the newcomer's own row away, the old one is no longer theirs.
    const freshName = me?.isLinked ? me.name || null : user.driverName ?? null;
    if ((user.driverId || null) !== freshId || (user.driverName ?? null) !== freshName) {
      saveUser(localStorage.getItem(TOKEN_KEY), { ...user, driverId: freshId, driverName: freshName });
    }
  } catch {
    /* the snapshot stands; the next page load asks again */
  }
}

// A newcomer who just signed themselves up (their first race answer, or Join
// on the profile) is a driver from this moment on. The token can stay as it
// is: the backend finds the driver by Discord id on every request. Only the
// snapshot is behind, and without this the page would keep showing them the
// newcomer's view until the next page load.
export function adoptDriver(joined) {
  if (!joined?.driverId) return;
  const user = readUser();
  if (!user || user.driverId === joined.driverId) return;
  saveUser(localStorage.getItem(TOKEN_KEY), {
    ...user,
    driverId: joined.driverId,
    driverName: joined.driverName ?? user.driverName ?? null,
  });
}

// Ask again now, whatever this page load already asked: something just
// changed who this login is (Steam recognised a returning driver, see
// pages/SteamCallback.jsx). Resolves once the snapshot is current.
export function recheckDriverLink() {
  checkedLink = false;
  return refreshDriverLink();
}

// Reactive view of the logged-in driver (via Discord).
export function useAuth() {
  const [user, setUser] = useState(readUser);

  useEffect(() => {
    refreshDriverLink();
    const sync = () => setUser(readUser());
    window.addEventListener("nabs-auth", sync);
    window.addEventListener("storage", sync);
    // A tab that simply stays open must notice the expiry too — re-check once
    // a minute; readUser is cheap and only causes a state change when the
    // session actually flips.
    const id = setInterval(sync, 60_000);
    return () => {
      window.removeEventListener("nabs-auth", sync);
      window.removeEventListener("storage", sync);
      clearInterval(id);
    };
  }, []);

  const logout = useCallback(() => clearUser(), []);
  return { user, isLoggedIn: !!user, logout };
}
