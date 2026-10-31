import { ChevronDown, CircleDashed } from "lucide-react";
import { secs, lossNote } from "./PitStopSetting.jsx";

// One neighbour at the rejoin: who, how far, and whether they are on another
// lap (a backmarker in the way, or the leader coming through).
function Neighbour({ label, n, nameOf, traffic }) {
  if (!n) return null;
  const close = traffic && n.ms <= traffic;
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-light">{label}</span>
      <span className="truncate font-semibold text-dark">{nameOf(n)}</span>
      <span className={`font-mono tabular-nums ${close ? "font-bold text-amber-600 dark:text-amber-400" : "text-medium"}`}>{secs(n.ms)} s</span>
      {n.laps !== 0 && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-light">{n.laps < 0 ? "lapped" : `${n.laps} ${n.laps === 1 ? "lap" : "laps"} up`}</span>
      )}
    </span>
  );
}

// Under the live map: where a stop right now would put the car, and among
// whom. Read-only on purpose: the stop time is set before the race, up in
// the page header (PitStopSetting), not clicked at in the middle of one.
// Folded, it is one line; the ring on the map stays either way. `win` is
// computePitWindow's answer.
export default function PitWindowPanel({ win, who, loss, nameOf, trafficMs, open, onToggle, onShowMine, className = "" }) {
  const lost = win && !win.inLane ? win.position - win.positionNow : 0;
  const result = !win ? null : win.inLane ? "In the pit lane" : `Box now P${win.position}`;

  return (
    <div className={`rounded-xl border border-border bg-card px-3 py-2.5 ${className}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2.5 text-left">
        <CircleDashed className={`h-4 w-4 shrink-0 ${win?.traffic ? "text-amber-500" : "text-medium"}`} strokeWidth={2.25} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">Pit window</span>
          <span className="block truncate font-display text-sm font-extrabold uppercase leading-tight text-dark">{who}</span>
        </span>
        {!open && result && <span className="shrink-0 font-mono text-xs tabular-nums text-medium">{result}</span>}
        <ChevronDown className={`h-4 w-4 shrink-0 text-light transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        <span className="sr-only">{open ? "Fold the pit window" : "Open the pit window"}</span>
      </button>

      {open && (
        <>
          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            {!win ? (
              <span className="text-light">Waiting for a lap time.</span>
            ) : win.inLane ? (
              <span className="text-medium">In the pit lane right now.</span>
            ) : (
              <>
                <span className="inline-flex items-baseline gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-light">Box now</span>
                  <span className="font-display text-lg font-extrabold leading-none text-dark">P{win.position}</span>
                  {lost > 0 && <span className="font-mono text-xs text-light">{lost} {lost === 1 ? "place" : "places"} down</span>}
                </span>
                <Neighbour label="Ahead" n={win.ahead} nameOf={nameOf} traffic={trafficMs} />
                <Neighbour label="Behind" n={win.behind} nameOf={nameOf} traffic={trafficMs} />
              </>
            )}
          </div>

          <p className="mt-1.5 text-xs leading-relaxed text-light">
            Stop {secs(loss.ms)} s, {lossNote(loss).toLowerCase()}. Change it under Pit stop at the top.
            {onShowMine && (
              <>
                {" "}
                <button type="button" onClick={onShowMine} className="underline underline-offset-2 hover:text-dark">
                  Show my car
                </button>
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
