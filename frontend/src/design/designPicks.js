// Design preview (branch design-varianten only, development only).
//
// The picker at /_design/index.html stores which mockup variant was chosen for
// which element under one localStorage key. The site runs on the same origin,
// so every open tab (and the picker's own preview frame) sees a change at once
// through the `storage` event. Nothing here reaches a built site: every caller
// checks DESIGN_ENABLED, which is a literal false after `vite build`.
import { useEffect, useState } from "react";

export const DESIGN_ENABLED = import.meta.env.DEV;

const PICKS_KEY = "nabs-variant-picks"; // { "<page>/<element id>": { key, file, ... } }
const OFF_KEY = "nabs-design-off"; // "1" = show the original site for a moment
const EVENT = "nabs-design-picks";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function getPicks() {
  return read(PICKS_KEY, {}) || {};
}

export function isDesignOff() {
  return read(OFF_KEY, 0) === 1;
}

export function setDesignOff(off) {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

// Subscribes to the picks (and the on/off switch) across tabs and frames.
export function useDesignPicks() {
  const [state, setState] = useState(() => ({ picks: getPicks(), off: isDesignOff() }));
  useEffect(() => {
    if (!DESIGN_ENABLED) return undefined;
    const sync = () => setState({ picks: getPicks(), off: isDesignOff() });
    const onStorage = (e) => {
      if (e.key === null || e.key === PICKS_KEY || e.key === OFF_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT, sync);
    };
  }, []);
  return state;
}

// The picker's preview frame asks the site to scroll to an element.
export function listenForScrollRequests() {
  if (!DESIGN_ENABLED) return () => {};
  const onMessage = (e) => {
    if (e.origin !== window.location.origin || e.data?.type !== "nabs-design-scroll") return;
    const el = document.querySelector(`[data-design-slot="${CSS.escape(e.data.id)}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
