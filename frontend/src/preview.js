// Owner-only "preview mode": lets you flip the home page between the newcomer
// Welcome landing and the normal member home WITHOUT logging in/out. Activated
// by visiting `/?preview=welcome` (or `?preview=home`); persists in
// localStorage so a small floating toggle (PreviewToggle) can switch it after.
// Real visitors never set the flag, so they never see any of this.
import { useEffect, useState } from "react";

const KEY = "nabs_home_preview"; // "welcome" | "home" | null

export function getPreview() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setPreview(value) {
  try {
    if (value === "welcome" || value === "home") localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("nabs-preview"));
}

// Pick up `?preview=welcome|home|off` from the URL once (so a shared link can
// drop the owner straight into a given preview).
export function applyPreviewFromUrl() {
  const p = new URLSearchParams(window.location.search).get("preview");
  if (p === "welcome" || p === "home") setPreview(p);
  else if (p === "off") setPreview(null);
}

// Reactive view of the current preview override.
export function usePreviewMode() {
  const [value, setValue] = useState(getPreview);
  useEffect(() => {
    const sync = () => setValue(getPreview());
    window.addEventListener("nabs-preview", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("nabs-preview", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return value;
}
