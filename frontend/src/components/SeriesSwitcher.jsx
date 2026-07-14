import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSeries } from "../context/SeriesContext.jsx";

// The series switcher. Lives on the line under the NavBar wordmark (where the
// season name used to sit) and at the top of the mobile burger menu. With one
// series it renders NOTHING — the league looks exactly like the single-series
// site it used to be; the control only appears once a second series exists.
// Switching stays on the same section (Drivers -> Drivers), deep pages
// (/drivers/<id>) fall back to that section's list, everything else lands on
// the series home.

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
  const { seriesList, current } = useSeries();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => wrapRef.current && !wrapRef.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Hidden entirely while there is nothing to switch between.
  if (seriesList.length <= 1) return null;

  // The section of the page being viewed ("/drivers", "/races", ... or "" for
  // home) — switching series stays on the same section. Only the FIRST path
  // segment carries over: /drivers/<id> is a driver of the OLD series, so the
  // switch lands on the new series' drivers list instead.
  const m = /^\/s\/[^/]+(\/[^/]+)?/.exec(location.pathname);
  const section = m && m[1] ? m[1] : "";

  const pick = (s) => {
    setOpen(false);
    navigate(`/s/${s.slug}${section}`);
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
              {current?.isPublic === false && <LockIcon className="h-3 w-3 shrink-0 text-amber-600" />}
              <span className="truncate">{label}</span>
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-eyebrow">Series</span>
          </>
        ) : (
          <>
            {current?.isPublic === false && <LockIcon className="h-2.5 w-2.5 shrink-0 text-amber-600" />}
            <span className="block truncate text-xs font-semibold uppercase tracking-widest text-light transition group-hover:text-dark">
              {label}
            </span>
            <svg
              viewBox="0 0 24 24"
              className={`h-3 w-3 shrink-0 text-eyebrow transition-transform duration-200 ${open ? "rotate-180" : ""}`}
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
        className={`absolute left-0 top-full z-40 mt-2 w-64 origin-top-left rounded-2xl border border-border bg-card p-1.5 shadow-xl shadow-ink/10 transition-[opacity,transform,visibility] duration-150 ${
          open ? "visible scale-100 opacity-100" : "invisible scale-[0.97] opacity-0"
        }`}
      >
        <div className="max-h-[60vh] overflow-y-auto scrollbar-slim">
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
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-amber-600">
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
