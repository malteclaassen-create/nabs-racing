import { useEffect, useState } from "react";

const KEY = "nabs_theme";

function initialTheme() {
  const saved = localStorage.getItem(KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Shared module-level state so every useTheme() consumer stays in sync. Without
// this each component had its own useState, so toggling in the NavBar never
// reached other components that branch on the theme (e.g. the home hero).
let current = initialTheme();
const listeners = new Set();

function apply(theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(KEY, theme);
}

// Make sure the <html> class matches the stored choice on first load.
apply(current);

function setTheme(theme) {
  current = theme;
  apply(current);
  listeners.forEach((notify) => notify(current));
}

export function useTheme() {
  const [theme, setLocal] = useState(current);

  useEffect(() => {
    // Re-sync in case the shared value changed between render and mount.
    setLocal(current);
    listeners.add(setLocal);
    return () => listeners.delete(setLocal);
  }, []);

  const toggle = () => setTheme(current === "dark" ? "light" : "dark");
  return { theme, toggle };
}
