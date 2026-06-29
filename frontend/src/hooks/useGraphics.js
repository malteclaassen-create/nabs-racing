import { useEffect, useState } from "react";

// "Graphics quality" preference, controlled from the Settings panel.
//   full -> all effects (blur, animations, aurora …)
//   lite -> drops the GPU-heavy effects so the site stays smooth on weak
//           machines or when the browser's hardware acceleration is off.
// Applied as a `fx-lite` class on <html>; see the .fx-lite rules in index.css.
const KEY = "nabs_fx";

function initial() {
  return localStorage.getItem(KEY) === "lite" ? "lite" : "full";
}

// Shared module-level state so every useGraphics() consumer stays in sync.
let current = initial();
const listeners = new Set();

function apply(mode) {
  document.documentElement.classList.toggle("fx-lite", mode === "lite");
  localStorage.setItem(KEY, mode);
}
apply(current);

function setMode(mode) {
  current = mode === "lite" ? "lite" : "full";
  apply(current);
  listeners.forEach((notify) => notify(current));
}

export function useGraphics() {
  const [mode, setLocal] = useState(current);

  useEffect(() => {
    setLocal(current);
    listeners.add(setLocal);
    return () => listeners.delete(setLocal);
  }, []);

  return {
    mode,
    lite: mode === "lite",
    setMode,
    toggle: () => setMode(current === "lite" ? "full" : "lite"),
  };
}
