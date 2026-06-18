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

function readUser() {
  try {
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
    return () => {
      window.removeEventListener("nabs-auth", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const logout = useCallback(() => clearUser(), []);
  return { user, isLoggedIn: !!user, logout };
}
