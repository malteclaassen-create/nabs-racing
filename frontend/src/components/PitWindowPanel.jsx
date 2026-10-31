import { useEffect, useState } from "react";
import { CircleDashed, Minus, Plus, X } from "lucide-react";
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

// Under the live map: what a stop would cost and where it would put the car,
// with the stop cost adjustable. `win` is computePitWindow's answer.
export default function PitWindowPanel({ win, who, loss, nameOf, onClose, trafficMs, className = "" }) {
  const [draft, setDraft] = useState(secs(loss.ms));
  useEffect(() => setDraft(secs(loss.ms)), [loss.ms]);
  const commit = (text) => {
    const v = Number(String(text).replace(",", "."));
    if (Number.isFinite(v) && v > 0) loss.set(v * 1000);
    else setDraft(secs(loss.ms));
  };
  const step = (dir) => loss.set(loss.ms + dir * 500);
  const btn = "grid h-8 w-8 place-items-center text-medium transition hover:bg-surface2 hover:text-dark disabled:opacity-40";
  const lost = win && !win.inLane ? win.position - win.positionNow : 0;

  return (
    <div className={`rounded-xl border border-border bg-card px-3 py-2.5 ${className}`}>
      <div className="flex items-center gap-2.5">
        <CircleDashed className={`h-4 w-4 shrink-0 ${win?.traffic ? "text-amber-500" : "text-medium"}`} strokeWidth={2.25} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">Pit window</div>
          <div className="truncate font-display text-sm font-extrabold uppercase leading-tight text-dark">{who}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Hide the pit window"
          aria-label="Hide the pit window"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-light transition hover:bg-surface2 hover:text-dark"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center overflow-hidden rounded-lg border border-border" title="What a stop costs: pit lane plus standstill">
          <button type="button" className={`${btn} border-r border-border`} onClick={() => step(-1)} disabled={loss.ms <= MIN_LOSS_MS} title="Half a second less" aria-label="Half a second less">
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
          <button type="button" className={`${btn} border-l border-border`} onClick={() => step(1)} disabled={loss.ms >= MAX_LOSS_MS} title="Half a second more" aria-label="Half a second more">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {!win ? (
          <span className="text-sm text-light">Waiting for a lap time.</span>
        ) : win.inLane ? (
          <span className="text-sm text-medium">In the pit lane right now.</span>
        ) : (
          <span className="inline-flex items-baseline gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-light">Box now</span>
            <span className="font-display text-lg font-extrabold leading-none text-dark">P{win.position}</span>
            {lost > 0 && <span className="font-mono text-xs text-light">{lost} {lost === 1 ? "place" : "places"} down</span>}
          </span>
        )}
      </div>

      {win && !win.inLane && (win.ahead || win.behind) && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <Neighbour label="Ahead" n={win.ahead} nameOf={nameOf} traffic={trafficMs} />
          <Neighbour label="Behind" n={win.behind} nameOf={nameOf} traffic={trafficMs} />
        </div>
      )}

      <p className="mt-1.5 text-xs leading-relaxed text-light">
        {loss.source === "learned" ? (
          <>
            A stop costs {secs(loss.ms)} s, learned from {loss.learnedStops} {loss.learnedStops === 1 ? "stop" : "stops"} in this race
            (pit lane plus standstill).
          </>
        ) : loss.source === "yours" ? (
          <>
            A stop costs {secs(loss.ms)} s, your number for this circuit.
            {loss.learnedMs != null && (
              <>
                {" "}
                <button type="button" onClick={() => loss.set(null)} className="underline underline-offset-2 hover:text-dark">
                  Use the race&rsquo;s {secs(loss.learnedMs)} s
                </button>
              </>
            )}
          </>
        ) : (
          <>A stop costs {secs(loss.ms)} s as a first guess, until somebody in this race stops. Set your own: pit lane plus standstill.</>
        )}
      </p>
    </div>
  );
}
