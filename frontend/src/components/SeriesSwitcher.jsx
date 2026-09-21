import { useCallback, useRef, useState } from "react";
import { useDismiss } from "./overlay.jsx";
import { useLocation, useNavigate } from "react-router-dom";
import { useSeries } from "../context/SeriesContext.jsx";
import { seriesThemeColor } from "../utils/seriesColor.js";
import { seriesSwitchTarget } from "./seriesSwitchTarget.mjs";

// The series switcher. Lives on the line under the NavBar wordmark (where the
// season name used to sit) and at the top of the mobile burger menu. With one
// series it renders NOTHING — the league looks exactly like the single-series
// site it used to be; the control only appears once a second series exists.
// Switching keeps you where you are: the same section (Drivers -> Drivers), and
// on the pages without a /s/<slug> in the address (the admin, your profile,
// Race Info, …) the very same page — only the series behind it changes. Deep
// pages (/drivers/<id>) are the exception: that id belongs to the old series,
// so those fall back to the section's list.

// Padlock marking a private (unpublished) series — only admins get those in
// their list, so whoever sees this is previewing hidden data.
function LockIcon({ className = "h-3 w-3" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  );
}

export default function SeriesSwitcher({ mobile = false, onPick }) {
  const { seriesList, current, setSlug } = useSeries();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Escape and click-outside come from the shared overlay layer, so this menu
  // dismisses exactly the way the drawers, the dialogs and the other four
  // dropdowns do. It also gains touchstart, which this hand-rolled version
  // lacked: on a phone a tap outside left the menu up until the tap finished.
  useDismiss(open, useCallback(() => setOpen(false), []), { ref: wrapRef });

  // Hidden entirely while there is nothing to switch between.
  if (seriesList.length <= 1) return null;

  // Whether the site is running as the installed app rather than in a browser
  // tab: a Trusted Web Activity reports the manifest's display mode, a tab
  // reports "browser".
  const installedApp = () =>
    typeof window.matchMedia === "function" && !window.matchMedia("(display-mode: browser)").matches;

  const pick = (s) => {
    setOpen(false);
    const to = seriesSwitchTarget(location.pathname, s.slug);
    if (!to) {
      // A page with no series in its address (admin, profile, Race Info, …):
      // stay put and only point the sticky selection at the new series. App
      // remounts the page area on it, which is what makes the page refetch,
      // and the query string survives — so ?tab=rating stays on My Rating.
      setSlug(s.slug);
      onPick?.(s);
      return;
    }
    // In the installed app the phone's status bar takes its colour from the
    // document that was loaded and does not follow the theme-color tag as the
    // page changes it (SeriesContext does that, which is enough for a browser).
    // So a switch to a series with a different colour is a real page load: the
    // server puts the new series' colour into the document it serves (backend
    // lib/pageMeta.js). Same colour, or a browser tab: the in-app navigation.
    if (installedApp() && seriesThemeColor(s) !== seriesThemeColor(current)) {
      window.location.assign(to);
      return;
    }
    navigate(to);
    onPick?.(s);
  };

  const label = current ? current.name : "Series";

  return (
    <span ref={wrapRef} className={`relative ${mobile ? "block" : "inline-flex"}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Switch series"
        className={
          mobile
            ? `flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                open ? "border-brand/60 bg-brand/10 text-dark" : "border-border text-medium hover:bg-surface2"
              }`
            : "group flex items-center gap-1 text-left"
        }
      >
        {mobile ? (
          <>
            <span className="flex min-w-0 items-center gap-2">
              {current?.isPublic === false && <LockIcon className="h-3 w-3 shrink-0 text-warn" />}
              <span className="truncate">{label}</span>
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow">Series</span>
          </>
        ) : (
          <>
            {current?.isPublic === false && <LockIcon className="h-2.5 w-2.5 shrink-0 text-warn" />}
            <span className="block truncate text-xs font-semibold uppercase tracking-widest text-light transition group-hover:text-dark">
              {label}
            </span>
            <svg
              viewBox="0 0 24 24"
              className={`h-3 w-3 shrink-0 text-eyebrow transition-transform duration-quick ${open ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </>
        )}
      </button>

      {/* Menu — rendered from the /series list, so it scales to any number. */}
      <div
        role="menu"
        className={`absolute left-0 top-full z-dropdown mt-2 w-64 origin-top-left rounded-2xl border border-border bg-card p-1.5 shadow-xl shadow-ink/10 transition-[opacity,transform,visibility] duration-quick ${
          open ? "visible scale-100 opacity-100" : "invisible scale-[0.97] opacity-0"
        }`}
      >
        {/* py-px so the highlighted entry's ring isn't shaved off at the
            list's own clipping edge (see SeasonPicker for the same fix). */}
        <div className="max-h-[60vh] overflow-y-auto py-px scrollbar-slim">
          {seriesList.map((s) => {
            const viewing = current && s.slug === current.slug;
            return (
              <button
                key={s.id}
                role="menuitemradio"
                aria-checked={viewing}
                onClick={() => pick(s)}
                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                  viewing ? "bg-accent/10 ring-1 ring-inset ring-accent/40" : "hover:bg-surface2"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-display text-sm font-bold uppercase tracking-tight text-dark">{s.name}</span>
                    {s.isPublic === false && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-warn">
                        <LockIcon className="h-2.5 w-2.5" />
                        Private
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-light">
                    {s.isPublic === false ? "Only admins can see this series" : s.game || s.description || "Racing series"}
                  </span>
                </span>
                {viewing && (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-eyebrow" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12l5 5L20 6" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </span>
  );
}
