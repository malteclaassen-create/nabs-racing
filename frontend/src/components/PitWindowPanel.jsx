import { useEffect, useState } from "react";
import { ChevronDown, CircleDashed, Minus, Plus } from "lucide-react";
import SlidingTabs from "./SlidingTabs.jsx";
import { MIN_LOSS_MS, MAX_LOSS_MS } from "../utils/pitWindow.mjs";

const secs = (ms) => (ms / 1000).toFixed(1);

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

// The stop cost typed in by hand, with half-second steps either side.
function OwnTime({ loss }) {
  const [draft, setDraft] = useState(secs(loss.ms));
  useEffect(() => setDraft(secs(loss.ms)), [loss.ms]);
  const commit = (text) => {
    const v = Number(String(text).replace(",", "."));
    if (Number.isFinite(v) && v > 0) loss.set(v * 1000);
    else setDraft(secs(loss.ms));
  };
  const btn = "grid h-8 w-8 place-items-center text-medium transition hover:bg-surface2 hover:text-dark disabled:opacity-40";
  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-border">
      <button type="button" className={`${btn} border-r border-border`} onClick={() => loss.set(loss.ms - 500)} disabled={loss.ms <= MIN_LOSS_MS} title="Half a second less" aria-label="Half a second less">
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <label className="flex items-baseline gap-0.5 px-1.5">
        <span className="sr-only">Time a pit stop costs, in seconds</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="w-12 bg-transparent text-right font-mono text-base font-bold tabular-nums text-dark outline-none sm:text-sm"
        />
        <span className="font-mono text-[11px] text-light">s</span>
      </label>
      <button type="button" className={`${btn} border-l border-border`} onClick={() => loss.set(loss.ms + 500)} disabled={loss.ms >= MAX_LOSS_MS} title="Half a second more" aria-label="Half a second more">
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

// Under the live map: what a stop would cost and where it would put the car.
// The stop cost is either left to the system (learned from this race's stops)
// or the viewer's own. Folded, it is one line; the ring on the map stays
// either way. `win` is computePitWindow's answer.
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
        {!open && result && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-medium">
            {result} · {secs(loss.ms)} s
          </span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-light transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        <span className="sr-only">{open ? "Fold the pit window" : "Open the pit window"}</span>
      </button>

      {open && (
        <>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <SlidingTabs
              wrapClassName="inline-flex rounded-lg border border-border bg-card p-0.5"
              btnClassName="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider"
              pillClassName="rounded-md bg-brand"
              items={[
                { key: "auto", label: "Auto", title: "Learned from this race's stops" },
                { key: "own", label: "Own time", title: "Your own number for this circuit" },
              ]}
              value={loss.mode}
              onChange={loss.setMode}
            />
            {loss.mode === "own" ? (
              <OwnTime loss={loss} />
            ) : (
              <span className="font-mono text-base font-bold tabular-nums text-dark sm:text-sm">{secs(loss.ms)} s</span>
            )}
          </div>

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
            {loss.source === "learned" ? (
              <>
                Learned from {loss.learnedStops} {loss.learnedStops === 1 ? "stop" : "stops"} in this race, pit lane plus standstill.
              </>
            ) : loss.source === "yours" ? (
              <>Your time for this circuit, kept in this browser.</>
            ) : (
              <>A first guess until somebody in this race stops. Pit lane plus standstill.</>
            )}
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
