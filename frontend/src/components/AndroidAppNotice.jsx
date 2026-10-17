import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { appIsBehind, readAppMark } from "../utils/androidApp.mjs";

// ---------------------------------------------------------------------------
// "A new version of the NABS app is out."
//
// The Android app is a download from the site (an APK, android/), not a Play
// Store app, so nothing updates it by itself. Most changes never need it to: the
// app shows the live site. Only a change to the app itself (the widgets' side
// of it, the icon) does, and then the people who have it need to hear about it.
//
// The app says it is the app, and which version, in the address it opens
// (?app=android&appv=N). That is remembered for the tab (sessionStorage: the
// app's tab is its own, and a normal Chrome tab never sees it) and taken out of
// the address. If the server names a newer APK, this offers it, once per tab.
// ---------------------------------------------------------------------------

const VERSION_KEY = "nabs_android_appv";
const DISMISSED_KEY = "nabs_android_update_later";

function stored(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* no storage: the notice simply comes back on the next visit */
  }
}

export default function AndroidAppNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const [latest, setLatest] = useState(null);
  const [version, setVersion] = useState(() => Number(stored(VERSION_KEY)) || null);
  const [hidden, setHidden] = useState(false);

  // Read the mark off the address, and take it out of it.
  useEffect(() => {
    const { version: v, rest } = readAppMark(location.search);
    if (rest === null) return;
    if (v) {
      store(VERSION_KEY, String(v));
      setVersion(v);
    }
    navigate({ pathname: location.pathname, search: rest, hash: location.hash }, { replace: true, state: location.state });
  }, [location, navigate]);

  useEffect(() => {
    if (!version) return undefined;
    let alive = true;
    fetch("/api/app/android")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive) setLatest(j);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [version]);

  if (hidden || !appIsBehind(version, latest)) return null;
  if (stored(DISMISSED_KEY) === String(latest.versionCode)) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+var(--bnav))] z-chrome flex justify-center px-4">
      <div className="content-in pointer-events-auto flex items-center gap-3 rounded-2xl border border-brand/40 bg-card px-4 py-3 shadow-lg shadow-ink/20">
        <span className="text-sm text-medium">A new version of the NABS app is out ({latest.versionName}).</span>
        <a
          href="/android.apk"
          className="shrink-0 rounded-lg bg-brand px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-ink transition hover:brightness-105"
        >
          Get it
        </a>
        <button
          type="button"
          onClick={() => {
            store(DISMISSED_KEY, String(latest.versionCode));
            setHidden(true);
          }}
          title="Not now"
          className="shrink-0 rounded-lg border border-border px-2 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-light transition hover:bg-surface2 hover:text-dark"
        >
          Later
        </button>
      </div>
    </div>
  );
}
