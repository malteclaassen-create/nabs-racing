import { useEffect, useRef, useState } from "react";
import { useSeason } from "../context/SeasonContext.jsx";

// The season switcher, built straight into the Home ticker line ("SEASON 7 · LIVE
// | F1 2007 …"). The season name IS the control: click it to open a tidy menu of
// every season and jump between them. Replaces the old NavBar <select>.

// Some seasons are stored with just a number as their name (e.g. a future "8");
// show "Season 8" rather than a bare "8".
function nameOf(s) {
  return /^\d+$/.test((s.name || "").trim()) ? `Season ${s.number}` : s.name || `Season ${s.number}`;
}

function LiveDot({ className = "" }) {
  return (
    <span className={`relative flex h-1.5 w-1.5 ${className}`} aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
    </span>
  );
}

export default function SeasonPicker() {
  const { seasons, season, setSeason, current, active } = useSeason();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

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

  const isPast = current && active && current.number < active.number;
  const label = current ? nameOf(current) : "Season";

  // Just a status word when there's nothing to switch between.
  if (!seasons || seasons.length <= 1) {
    return (
      <span className="flex items-center gap-2 text-dark">
        {label} · {isPast ? "Complete" : "Live"}
      </span>
    );
  }

  const byNewest = [...seasons].sort((a, b) => b.number - a.number);
  const pick = (n) => {
    setSeason(n);
    setOpen(false);
  };

  return (
    <span ref={wrapRef} className="relative inline-flex">
      {/* Trigger — a pill inside the ticker line: styled to clearly read as an
          interactive control (brand-tinted border + chevron badge), while still
          matching the line's mono/uppercase type. */}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`group inline-flex items-center gap-2 rounded-full border py-1 pl-3 pr-1.5 font-mono text-[13px] font-semibold uppercase tracking-[0.2em] text-dark shadow-sm transition hover:-translate-y-px ${
          open ? "border-accent bg-accent/10 shadow" : "border-accent/50 bg-accent/[0.07] hover:border-accent/80 hover:bg-accent/10"
        }`}
        title="Switch season"
      >
        {!isPast && <LiveDot />}
        <span>{label}</span>
        <span className={isPast ? "text-emerald-600" : "text-eyebrow"}>· {isPast ? "Complete" : "Live"}</span>
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 text-eyebrow transition group-hover:bg-accent/30">
          <svg
            viewBox="0 0 24 24"
            className={`h-3 w-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {/* Menu */}
      <div
        role="menu"
        className={`absolute left-0 top-full z-40 mt-2.5 w-64 origin-top-left rounded-2xl border border-border bg-card p-1.5 normal-case tracking-normal shadow-xl shadow-ink/10 transition duration-150 ${
          open ? "visible scale-100 opacity-100" : "invisible scale-[0.97] opacity-0"
        }`}
      >
        <div className="max-h-[60vh] overflow-y-auto scrollbar-slim">
          {byNewest.map((s) => {
            const viewing = s.number === season;
            const past = active && s.number < active.number;
            return (
              <button
                key={s.id}
                role="menuitemradio"
                aria-checked={viewing}
                onClick={() => pick(s.number)}
                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                  viewing ? "bg-accent/10 ring-1 ring-inset ring-accent/40" : "hover:bg-surface2"
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-base font-black tabular-nums ${
                    viewing ? "bg-brand text-ink" : "bg-surface2 text-medium"
                  }`}
                >
                  {s.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-display text-sm font-bold uppercase tracking-tight text-dark">{nameOf(s)}</span>
                    {s.isActive && <LiveDot />}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-light">
                    {s.game || (past ? "Archived season" : "Upcoming")}
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
