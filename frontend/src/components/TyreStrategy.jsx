import { Fragment } from "react";
import { tyreCompound } from "../data/liveTiming.js";

// Tyre strategy in the style of the league's own race-standings graphic: per
// driver one THIN line along the lap axis, coloured by compound, with a filled
// tyre disc (compound letter inside) marking where each stint began — a tyre
// change reads as a new disc and the line switching colour. The scale is SHARED
// across all drivers: in a race it runs the full race distance
// (session.raceLaps), otherwise at least 10 laps or the longest run on the
// board. A driver with no laps yet shows an empty placeholder slot; a driver
// still out has a small hollow marker riding the end of their line; a car in
// the pit lane gets a little PIT block that disappears once they're rolling.

// Compound letters that need dark ink: the pale/light compounds (medium white,
// hard ice blue) plus the bright hypersoft pink and soft yellow (black HS on
// pink, black S on yellow, like the reference graphic). Everything else — the
// deep supersoft red, wet blue, intermediate green — takes white.
function inkOn(t) {
  return t.light || t.label === "HS" || t.label === "S" ? "#111827" : "#fff";
}

// The filled tyre disc: compound-coloured circle, letter inside, thin dark rim
// so the pale compounds hold their shape on any surface. Shared by the stint
// marks, the current-tyre column and the legend.
export function TyreBadge({ t, size = 20, className = "" }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full text-center font-mono font-black uppercase ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: t.color,
        boxShadow: "0 0 0 2px rgba(10,15,30,0.55)",
        color: inkOn(t),
        fontSize: Math.round(size * (String(t.label).length > 1 ? 0.44 : 0.54)),
        lineHeight: 1,
      }}
      title={t.name}
      aria-label={t.name}
    >
      {t.label}
    </span>
  );
}

// The pit-lane block: shown only while the car is actually in the pits, gone the
// moment they roll out. Hatched so it never reads as a compound. Positioned by
// the track (absolute, just past the end of the line).
function PitBlock({ leftPct = 0 }) {
  return (
    <div
      className="absolute top-1/2 flex h-5 -translate-y-1/2 items-center rounded-[5px] px-2"
      style={{
        left: `min(calc(${leftPct}% + 10px), calc(100% - 36px))`,
        background:
          "repeating-linear-gradient(135deg, var(--c-surface2) 0 4px, var(--c-border) 4px 6px)",
      }}
      title="In the pit lane right now"
    >
      <span className="font-mono text-[9px] font-black uppercase tracking-wider text-light">Pit</span>
    </div>
  );
}

// The stint track for one driver: a thin line per stint along the shared lap
// axis, its colour the compound, a tyre disc pinned where the stint started.
// Empty history -> a dashed placeholder ("a tyre will appear here"). `delayMs`
// staggers the wipe-in so the rows build up one after another, like the TV
// graphic being drawn (the wipe utility already sits still under
// Performance-Lite / reduced motion).
function StintTrack({ stints, axisLaps, live, inPits, delayMs = 0 }) {
  // Cumulative lap positions: each stint knows where on the axis it starts.
  let acc = 0;
  const segs = stints.map((s) => {
    const laps = Math.max(1, s.laps || 0);
    const seg = { tyre: s.tyre, laps, start: acc };
    acc += laps;
    return seg;
  });
  const total = acc;
  const totalPct = (total / axisLaps) * 100;
  return (
    <div className="relative h-10 w-full border-r border-dashed border-border/70">
      {total === 0 ? (
        <>
          <div className="flex h-full w-12 items-center justify-center rounded-lg border border-dashed border-border text-[9px] font-bold uppercase tracking-wider text-faint">
            <span className="sr-only">No laps yet</span>
          </div>
          {inPits && <PitBlock leftPct={0} />}
        </>
      ) : (
        <div
          className="wipe-ltr absolute inset-0"
          style={{ "--wipe-dur": "0.8s", "--reveal-delay": `${delayMs}ms` }}
        >
          {segs.map((s, i) => {
            const t = tyreCompound(s.tyre);
            const leftPct = (s.start / axisLaps) * 100;
            const widthPct = (s.laps / axisLaps) * 100;
            const isLive = live && i === segs.length - 1;
            return (
              <Fragment key={i}>
                {/* the stint's line — thick enough to read as the graphic's
                    coloured strip, dead on the row's centre line */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    left: `${leftPct}%`,
                    width: `max(${widthPct}%, 14px)`,
                    height: 8,
                    backgroundColor: t.color,
                    // the pale hard compound needs a rim to hold its line shape
                    boxShadow: t.light ? "0 0 0 1px rgba(17,24,39,0.3)" : "none",
                  }}
                  title={`${t.name} · ${s.laps} lap${s.laps === 1 ? "" : "s"}${isLive ? " · still out on this set" : ""}`}
                />
                {/* the tyre disc at the stint's first lap, centred on the line */}
                <span
                  className="absolute top-1/2 z-10 flex -translate-y-1/2"
                  style={{ left: `max(0px, calc(${leftPct}% - 13px))` }}
                >
                  <TyreBadge t={t} size={26} />
                </span>
              </Fragment>
            );
          })}
          {/* hollow marker riding the end of a live line: still out, still adding laps */}
          {live && (
            <span
              className="absolute top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-[3px] bg-card"
              style={{
                left: `calc(${Math.min(totalPct, 100)}% - 7px)`,
                borderColor: tyreCompound(segs[segs.length - 1].tyre).color,
              }}
              title="Still out on track"
            />
          )}
          {inPits && <PitBlock leftPct={totalPct} />}
        </div>
      )}
    </div>
  );
}

export default function TyreStrategy({ entries, matchFn, raceLaps }) {
  // Everyone out on track (so a fresh run shows its empty slot) plus anyone with a
  // stint history to plot. A driver who never ran and isn't out is simply absent.
  const rows = (entries || []).filter((e) => e.onTrack || (Array.isArray(e.stints) && e.stints.length > 0));

  if (rows.length === 0) {
    return (
      <div className="card py-16 text-center text-light">
        No tyre data yet. Strategy fills in once cars start running laps.
      </div>
    );
  }

  // One shared scale for every row. A race pins the axis to the RACE DISTANCE so
  // the bars read as progress through the race; other sessions fall back to at
  // least 10 laps or the longest run on the board. The longest run still wins if
  // someone somehow exceeds the distance (extra formation laps and the like).
  const longestRun = Math.max(
    ...rows.map((e) => (e.stints || []).reduce((a, s) => a + Math.max(1, s.laps || 0), 0))
  );
  const axisLaps = raceLaps > 0 ? Math.max(raceLaps, longestRun) : Math.max(10, longestRun);

  return (
    <div className="card overflow-hidden">
      {/* Shared-axis header: lap numbers along the track column, like the race
          graphic's 5/10/15… strip. The final tick is the axis end (the race
          distance in a race) and only yields when a rounder tick sits nearly
          on top of it. */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2 sm:px-5">
        <span className="w-6 shrink-0" />
        <span className="w-1.5 shrink-0" />
        <span className="w-24 shrink-0 sm:w-44" />
        <div
          className="relative h-4 min-w-0 flex-1 font-mono text-[11px] font-bold tabular-nums text-faint"
          title={raceLaps > 0 ? `Race distance: ${axisLaps} laps` : `${axisLaps} laps`}
        >
          {(() => {
            const step = axisLaps > 80 ? 20 : axisLaps > 50 ? 10 : 5;
            const ticks = [];
            for (let l = step; l <= axisLaps; l += step) ticks.push(l);
            const last = ticks[ticks.length - 1];
            if (last !== axisLaps) {
              if (axisLaps - last < step / 2) ticks.pop();
              ticks.push(axisLaps);
            }
            return ticks.map((l) => (
              <span
                key={l}
                className="absolute top-0 -translate-x-1/2"
                style={{ left: `${(l / axisLaps) * 100}%` }}
              >
                {l}
              </span>
            ));
          })()}
        </div>
        {/* mirrors the current-compound column, which phones drop */}
        <span className="hidden w-16 shrink-0 sm:block" />
      </div>

      {/* cascade: rows deal in one after another, their bars wiping in right
          behind them — the graphic builds up like the TV version */}
      <div className="cascade divide-y divide-border">
        {rows.map((e, i) => {
          const m = matchFn ? matchFn(e.name) : null;
          const name = m?.nabsName || e.name;
          const color = m?.teamColor || "var(--c-border)";
          const stints = Array.isArray(e.stints) ? e.stints : [];
          // No lap driven and no compound reported yet -> a quiet dash, not a "?" pill.
          const curName = e.currentTyre || stints[stints.length - 1]?.tyre || null;
          const cur = curName ? tyreCompound(curName) : null;
          const curLaps = stints[stints.length - 1]?.laps || 0;
          const live = !!e.onTrack && !e.inPits;
          return (
            <div key={e.guid} style={{ "--i": Math.min(i, 16) }} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <span className="w-6 shrink-0 text-center font-display text-base font-black tabular-nums text-medium">
                {e.position ?? i + 1}
              </span>
              <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              {/* name at the same size the standings tables use */}
              <div className="w-24 shrink-0 sm:w-44">
                <span className="block truncate font-display text-base font-bold uppercase tracking-tight text-dark" title={e.name}>
                  {name}
                </span>
                <span className="hidden truncate text-xs text-light sm:block">{m?.teamName || "—"}</span>
              </div>
              <div className="min-w-0 flex-1">
                <StintTrack
                  stints={stints}
                  axisLaps={axisLaps}
                  live={live}
                  inPits={!!e.inPits}
                  delayMs={Math.min(i, 16) * 60}
                />
              </div>
              {/* current compound as the F1 tyre mark + laps on the set —
                  phones drop the column (the discs on the line carry it) so the
                  track itself keeps usable width */}
              <div className="hidden w-16 shrink-0 flex-col items-end gap-1 sm:flex">
                {cur ? (
                  <TyreBadge t={cur} size={28} />
                ) : (
                  <span className="font-mono text-xs text-faint">–</span>
                )}
                <span className="font-mono text-xs tabular-nums text-light">L{curLaps}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
