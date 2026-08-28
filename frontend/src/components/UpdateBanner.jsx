import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// "There is a new version of this page."
//
// A deploy replaces the JavaScript bundles, but a tab that was already open
// keeps running the old ones for as long as it stays open — and on this site
// that can be all evening, because the live page is left up through a whole
// race. So the page checks, quietly, whether the version it is running is
// still the one being served.
//
// HOW IT KNOWS. Vite puts a content hash in every bundle's file name, so the
// set of <script src> names in index.html IS the version. The check fetches
// index.html (never from cache), reads the hashed names out of it, and compares
// them with the ones this document was loaded with. No build step, no version
// file to keep in step, nothing to forget on a deploy: if the names differ, the
// bundles differ, which is the only thing that matters here.
//
// WHAT IT DOES ABOUT IT. Never a reload out from under somebody: on a race
// night this page is being watched, and a page that reloads itself mid-lap has
// taken something away. So the tab is offered the update and takes it when it
// is not in use — the moment it goes to the background, or on the button. A
// tab that is already hidden when the new version lands reloads straight away,
// which is why coming back to a tab from yesterday shows today's site.
//
// The check is deliberately cheap and rare: index.html is a few kB, it runs
// every ten minutes while the tab is visible and once when a hidden tab comes
// back, and every failure is ignored. Development is skipped entirely — the dev
// server serves unhashed modules, which would look like a new version on every
// single poll.
// ---------------------------------------------------------------------------

const CHECK_EVERY_MS = 10 * 60 * 1000;
// A tab coming back to the foreground checks, but not more than this often, so
// somebody flicking between tabs is not sending a request per flick.
const MIN_GAP_MS = 60 * 1000;

// The hashed bundle names in a piece of HTML, as one comparable string.
function fingerprint(html) {
  const names = [...html.matchAll(/\/assets\/[A-Za-z0-9._-]+\.js/g)].map((m) => m[0]);
  return names.length ? [...new Set(names)].sort().join("|") : null;
}

export default function UpdateBanner() {
  // Two facts, not one: whether a new version EXISTS (true for good, once seen)
  // and whether the banner is on screen. "Later" hides the banner; it does not
  // undo the deploy, so the tab still takes the update when it is put down.
  const [ready, setReady] = useState(false);
  const [banner, setBanner] = useState(false);
  // What this document is running, read from the live DOM rather than from a
  // build constant: it is the same list, by the same rule, as the one the fetch
  // below reads out of the server's HTML.
  const mineRef = useRef(null);
  const lastCheck = useRef(0);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    mineRef.current = fingerprint(
      [...document.querySelectorAll('script[src*="/assets/"]')]
        .map((s) => s.getAttribute("src"))
        .join(" ")
    );
  }, []);

  const check = useCallback(async () => {
    if (!import.meta.env.PROD || ready || !mineRef.current) return;
    if (Date.now() - lastCheck.current < MIN_GAP_MS) return;
    lastCheck.current = Date.now();
    try {
      const res = await fetch(`/?v=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return;
      const served = fingerprint(await res.text());
      // No names found means the answer was not the app's HTML (a captive
      // portal, an error page, a proxy). Say nothing rather than guess.
      if (served && served !== mineRef.current) {
        setReady(true);
        setBanner(true);
      }
    } catch {
      /* offline, or the deploy is mid-flight: ask again next time */
    }
  }, [ready]);

  useEffect(() => {
    if (!import.meta.env.PROD) return undefined;
    const t = setInterval(() => {
      if (!document.hidden) check();
    }, CHECK_EVERY_MS);
    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  // Take the update the moment the tab is put down.
  useEffect(() => {
    if (!ready) return undefined;
    if (document.hidden) {
      window.location.reload();
      return undefined;
    }
    const onHide = () => {
      if (document.hidden) window.location.reload();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [ready]);

  if (!banner) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-chrome flex justify-center px-4">
      <div className="content-in pointer-events-auto flex items-center gap-3 rounded-2xl border border-brand/40 bg-card px-4 py-3 shadow-lg shadow-ink/20">
        <span className="text-sm text-medium">
          A new version of the site is ready.
        </span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-lg bg-brand px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-ink transition hover:brightness-105"
        >
          Reload
        </button>
        {/* Dismissing only silences the banner: the tab still takes the update
            the next time it goes to the background. */}
        <button
          type="button"
          onClick={() => setBanner(false)}
          title="Not now"
          className="shrink-0 rounded-lg border border-border px-2 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-light transition hover:bg-surface2 hover:text-dark"
        >
          Later
        </button>
      </div>
    </div>
  );
}
