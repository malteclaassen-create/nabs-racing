import { useEffect, useState } from "react";

const KEY = "nabs_feature_satellite_v1_seen";
const EVENT = "nabs-live-feature-seen";
function unread() {
  try { return localStorage.getItem(KEY) !== "1"; } catch { return true; }
}

export function useLiveFeatureNotice() {
  const [isNew, setIsNew] = useState(unread);
  useEffect(() => {
    const sync = () => setIsNew(unread());
    const dismiss = () => setIsNew(false);
    window.addEventListener("storage", sync);
    window.addEventListener(EVENT, dismiss);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(EVENT, dismiss);
    };
  }, []);
  const dismiss = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* Still dismiss for this visit. */ }
    setIsNew(false);
    window.dispatchEvent(new Event(EVENT));
  };
  return { isNew, dismiss };
}
