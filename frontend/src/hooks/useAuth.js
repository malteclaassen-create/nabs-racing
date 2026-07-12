import { useCallback, useEffect, useState } from "react";

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

// Reactive view of the logged-in driver (via Discord).
export function useAuth() {
  const [user, setUser] = useState(readUser);

  useEffect(() => {
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
