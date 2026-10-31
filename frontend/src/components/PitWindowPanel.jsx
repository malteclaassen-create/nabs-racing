import { ChevronDown, ChevronRight, CircleDashed, TriangleAlert } from "lucide-react";
import { secs, lossNote } from "./PitStopSetting.jsx";

// How much road the strip under the map shows either side of the rejoin, in
// milliseconds. Further away than this a car sits pinned to the edge.
const STRIP_MS = 8000;

const code = (name) => (String(name || "").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 3) || "?").toUpperCase();

// Places lost by stopping, as the timing tables show a move: a tinted pill.
function LostPill({ lost }) {
  if (!lost) {
    return <span className="inline-flex h-6 items-center rounded-full bg-emerald-500/15 px-2 font-mono text-xs font-bold text-ok">Holds</span>;
  }
  return (
    <span className="inline-flex h-6 items-center gap-0.5 rounded-full bg-red-500/10 px-2 font-mono text-xs font-bold tabular-nums text-bad" title={`${lost} ${lost === 1 ? "place" : "places"} lost`}>
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
        <path d="M12 19L5 8h14z" />
      </svg>
      {lost}
    </span>
  );
}

// The road around the rejoin, drawn flat: the ring in the middle, the car it
// would come out behind to the right (the direction of travel), the one it
// would come out ahead of to the left, each as far away as the gap. The
// shaded band is the traffic zone, amber once somebody is in it.
function GapStrip({ win, infoOf, traffic, trafficMs, smooth }) {
  const at = (ms, side) => 50 + side * Math.min(46, (ms / STRIP_MS) * 46);
  const band = (trafficMs / STRIP_MS) * 46;
  const slide = smooth ? "transition-[left] duration-700 ease-linear" : "";
  const dot = (n, side) => {
    if (!n) return null;
    const info = infoOf(n);
    const pinned = n.ms > STRIP_MS;
    return (
      <span
        className={`absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center ${slide}`}
        style={{ left: `${at(n.ms, side)}%` }}
        title={`${info.name}, ${secs(n.ms)} s ${side > 0 ? "ahead" : "behind"}`}
      >
        <span className="mb-1 font-mono text-[10px] font-bold leading-none text-medium">{code(info.name)}</span>
        <span className="h-3.5 w-3.5 rounded-full border-2 border-card shadow-sm" style={{ backgroundColor: info.color }} />
        <span className={`mt-1 h-3 font-mono text-[10px] leading-none ${pinned ? "text-light" : "text-transparent"}`}>{pinned ? (side > 0 ? "›" : "‹") : "·"}</span>
      </span>
    );
  };
  return (
    <div className="relative h-14 select-none" aria-hidden="true">
      <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
      {/* Which way the cars are going. */}
      <ChevronRight className="absolute -right-1 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-light" aria-hidden="true" />
      <span
        className={`absolute top-1/2 h-5 -translate-y-1/2 rounded ${traffic ? "bg-amber-500/20" : "bg-surface2"}`}
        style={{ left: `${50 - band}%`, width: `${band * 2}%` }}
      />
      <span
        className={`absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed ${traffic ? "border-amber-500" : "border-dark"}`}
      />
      {dot(win.behind, -1)}
      {dot(win.ahead, 1)}
    </div>
  );
}

// One side of the strip in words: who, how far, and which lap they are on.
function Side({ label, n, infoOf, trafficMs, align }) {
  if (!n) {
    return (
      <div className={align}>
        <div className="font-mono text-[9px] uppercase tracking-wider text-light">{label}</div>
        <div className="text-sm text-light">Clear road</div>
      </div>
    );
  }
  const info = infoOf(n);
  const close = n.ms <= trafficMs;
  return (
    <div className={`min-w-0 ${align}`}>
      <div className="font-mono text-[9px] uppercase tracking-wider text-light">
        {label}
        {n.laps !== 0 && <> · {n.laps < 0 ? "lapped" : `${n.laps} ${n.laps === 1 ? "lap" : "laps"} up`}</>}
      </div>
      <div className="truncate font-display text-sm font-bold uppercase tracking-tight text-dark">{info.name}</div>
      <div className={`font-mono text-xs tabular-nums ${close ? "font-bold text-amber-600 dark:text-amber-400" : "text-medium"}`}>{secs(n.ms)} s</div>
    </div>
  );
}

// Under the live map: where a stop right now would put the car, and among
// whom. Read-only on purpose: the stop time is set before the race, up in
// the page header (PitStopSetting), not clicked at in the middle of one.
// Folded, it is the header line alone; the ring on the map stays either way.
// `win` is computePitWindow's answer.
export default function PitWindowPanel({ win, who, subject, loss, infoOf, trafficMs, open, onToggle, onShowMine, className = "" }) {
  const live = win && !win.inLane;
  const lost = live ? Math.max(0, win.position - win.positionNow) : 0;
  const me = subject ? infoOf(subject) : null;
  const smooth = typeof document !== "undefined" && !document.documentElement.classList.contains("fx-lite");
  const near = live ? [win.ahead, win.behind].filter((n) => n && n.ms <= trafficMs).sort((a, b) => a.ms - b.ms)[0] : null;

  return (
    <section className={`overflow-hidden rounded-xl border border-border bg-card ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-surface2 ${open ? "border-b border-border" : ""}`}
      >
        <CircleDashed className={`h-4 w-4 shrink-0 ${win?.traffic ? "text-amber-500" : "text-eyebrow"}`} strokeWidth={2.25} aria-hidden="true" />
        <span className="flex-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Pit window</span>
        {!open && live && (
          <span className="flex items-center gap-2">
            <span className="font-display text-sm font-extrabold text-dark">P{win.position}</span>
            <LostPill lost={lost} />
          </span>
        )}
        {!open && win?.inLane && <span className="font-mono text-[11px] uppercase tracking-wider text-medium">In the pits</span>}
        <ChevronDown className={`h-4 w-4 shrink-0 text-light transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        <span className="sr-only">{open ? "Fold the pit window" : "Open the pit window"}</span>
      </button>

      {open && (
        <>
          <div className="flex items-center gap-3 px-3.5 pt-3">
            <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: me?.color || "var(--c-border)" }} />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[9px] uppercase tracking-wider text-light">If {who === "You" ? "you box" : "they box"} now</div>
              <div className="truncate font-display text-base font-extrabold uppercase leading-tight text-dark">{who}</div>
              {me?.team && <div className="truncate text-[11px] text-light">{me.team}</div>}
            </div>
            {live ? (
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-display text-3xl font-extrabold leading-none tabular-nums text-dark">P{win.position}</span>
                <LostPill lost={lost} />
              </div>
            ) : (
              <span className="shrink-0 font-mono text-xs uppercase tracking-wider text-medium">{win ? "In the pit lane" : "Waiting for a lap"}</span>
            )}
          </div>

          {live && (
            <div className="px-3.5 pb-3 pt-2">
              <GapStrip win={win} infoOf={infoOf} traffic={win.traffic} trafficMs={trafficMs} smooth={smooth} />
              <div className="mt-1 grid grid-cols-2 gap-3">
                <Side label="Behind" n={win.behind} infoOf={infoOf} trafficMs={trafficMs} align="text-left" />
                <Side label="Ahead" n={win.ahead} infoOf={infoOf} trafficMs={trafficMs} align="text-right" />
              </div>
              {near && (
                <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Traffic: {secs(near.ms)} s {near === win.ahead ? "behind" : "ahead of"} {infoOf(near).name} on the way out.
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border bg-surface2 px-3.5 py-2 text-[11px] text-light">
            <span>
              Stop <span className="font-mono font-bold tabular-nums text-medium">{secs(loss.ms)} s</span> · {lossNote(loss)}
            </span>
            {onShowMine && (
              <button type="button" onClick={onShowMine} className="underline underline-offset-2 hover:text-dark">
                Show my car
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
