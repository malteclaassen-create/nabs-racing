import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

// ---------------------------------------------------------------------------
// The round, lap by lap: one line per car, position down the y-axis, laps
// along the x. The classification says who won; this says how.
//
// It stands in the classification's place rather than under it (the round
// panel is long enough already), which is also why it carries no heading of
// its own — the switch above it names the view.
//
// The numbers come from the archived raw result file, the same source the
// Cockpit's per-driver race analysis reads (GET /api/races/:id/laps). A line
// simply ends where its driver stopped appearing: a retirement is a line that
// stops, not a line that falls to the floor.
// ---------------------------------------------------------------------------

// Nothing here is drawn per pixel: the SVG is stretched to the plot box with
// preserveAspectRatio="none" and the strokes are non-scaling, exactly like the
// season-form chart on a driver's profile.
const PLOT_TOP = 6; // % inset so P1's line isn't flush against the top edge
const PLOT_BOTTOM = 94;

// A car without a league team (a guest, or a driver whose row we couldn't
// match) still needs to be told apart from its neighbours, so the unmatched
// ones cycle through a few neutral greys rather than all sharing one.
const NEUTRAL = ["#94a3b8", "#64748b", "#a1a1aa", "#71717a"];

export default function RaceLapChart({ data, className = "" }) {
  const [focus, setFocus] = useState(null); // guid of the highlighted driver

  const { drivers, maxLap, maxPos } = useMemo(() => {
    const ds = (data?.drivers || []).filter((d) => (d.points || []).length > 0);
    const maxPos = Math.max(1, ...ds.flatMap((d) => d.points.map((p) => p.position)));
    return { drivers: ds, maxLap: data?.maxLap || 0, maxPos };
  }, [data]);

  if (!drivers.length || maxLap < 2) {
    return <div className="card px-5 py-8 text-center text-sm text-light">No lap data for this round.</div>;
  }

  const yPct = (pos) => PLOT_TOP + ((pos - 1) / Math.max(1, maxPos - 1)) * (PLOT_BOTTOM - PLOT_TOP);
  // Position ticks: every position on a small grid, every fifth on a big one,
  // and the last one always, so the axis says how deep the field goes.
  const step = maxPos <= 8 ? 1 : maxPos <= 20 ? 2 : 5;
  const ticks = [];
  for (let p = 1; p <= maxPos; p += step) ticks.push(p);
  if (ticks[ticks.length - 1] !== maxPos) ticks.push(maxPos);
  // Lap labels thin out the same way — a 60-lap race can't print 60 numbers.
  const lapStep = maxLap <= 12 ? 1 : maxLap <= 30 ? 5 : 10;

  // Room for every lap to be distinguishable; below that the whole race
  // squeezes into a phone and the swaps turn into noise. Scrolls sideways.
  const minW = Math.max(320, maxLap * 22);

  const colorOf = (d, i) => d.color || NEUTRAL[i % NEUTRAL.length];

  return (
    // Its own card, like the results table it stands in for — and the reason
    // the pinned axis can be bg-card: without the panel, the chart would sit
    // straight on the page and the axis column would be a lighter block
    // floating over a darker background.
    <div className={`card overflow-hidden ${className}`}>
      {/* Same scrolling contract as the season-form chart: sideways only, no
          bars, and the pinned axis fades whatever slides under it. */}
      <div className="scrollbar-none w-full overflow-x-auto overflow-y-hidden overscroll-x-none px-5 pt-5 sm:px-6">
        <div style={{ minWidth: minW + 32 }}>
          <div className="flex items-stretch gap-2">
            {/* pinned position axis */}
            <div className="sticky-fade sticky left-0 z-10 h-56 w-7 shrink-0 bg-card">
              <div className="relative h-full">
                {ticks.map((p) => (
                  <span
                    key={p}
                    className="absolute right-0 -translate-y-1/2 font-mono text-[10px] font-bold tabular-nums text-faint"
                    style={{ top: `${yPct(p)}%` }}
                  >
                    P{p}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative h-56 flex-1">
              {ticks.map((p) => (
                <span
                  key={p}
                  className="absolute inset-x-0 border-t border-dashed border-border"
                  style={{ top: `${yPct(p)}%` }}
                />
              ))}
              <svg
                viewBox={`0 0 ${maxLap - 1} 100`}
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full overflow-visible"
                aria-hidden="true"
              >
                {drivers.map((d, i) => {
                  const pts = d.points
                    .map((p) => `${(p.lap - 1).toFixed(2)},${yPct(p.position).toFixed(2)}`)
                    .join(" ");
                  const dim = focus && focus !== d.guid;
                  return (
                    <polyline
                      key={d.guid || i}
                      points={pts}
                      fill="none"
                      stroke={colorOf(d, i)}
                      strokeWidth={focus === d.guid ? 3.5 : 2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      opacity={dim ? 0.12 : 1}
                      className="transition-opacity"
                    />
                  );
                })}
              </svg>
            </div>
          </div>

          {/* lap axis, under the plot and aligned with it */}
          <div className="mt-2 flex gap-2">
            <div className="sticky-fade sticky left-0 z-10 w-7 shrink-0 bg-card" />
            <div className="relative h-4 flex-1">
              {Array.from({ length: maxLap }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === maxLap || n % lapStep === 0)
                .map((n) => (
                  // The first and last labels line up with the INSIDE of the
                  // plot rather than centring on it: centred, lap 1 sat half
                  // under the axis fade and the final lap was cut off by the
                  // right edge of the scroller.
                  <span
                    key={n}
                    className={`absolute font-mono text-[10px] font-semibold tabular-nums text-light ${
                      n === 1 ? "" : n === maxLap ? "-translate-x-full" : "-translate-x-1/2"
                    }`}
                    style={{ left: `${((n - 1) / Math.max(1, maxLap - 1)) * 100}%` }}
                  >
                    {n}
                  </span>
                ))}
            </div>
          </div>
          <div className="mt-1 flex gap-2">
            <div className="w-7 shrink-0" />
            <div className="flex-1 text-center font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
              Lap
            </div>
          </div>
        </div>
      </div>

      {/* The legend is also the control: the lines are thin and many, so the
          way to follow one driver is to pick their name. Finishing order, so
          it reads like the classification it replaced. */}
      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border px-5 py-4 sm:px-6">
        {drivers.map((d, i) => {
          const active = focus === d.guid;
          const chip = (
            <>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(d, i) }} />
              <span className="truncate">{d.name}</span>
            </>
          );
          const cls = `flex items-center gap-1.5 rounded-lg px-2 py-1 font-display text-[11px] font-bold uppercase tracking-tight transition ${
            active ? "bg-surface2 text-dark ring-1 ring-border" : "text-medium hover:bg-surface2 hover:text-dark"
          }`;
          return (
            <button
              key={d.guid || i}
              type="button"
              className={cls}
              onMouseEnter={() => setFocus(d.guid)}
              onMouseLeave={() => setFocus(null)}
              onClick={() => setFocus(active ? null : d.guid)}
              title={d.driverId ? `${d.name} — tap to follow, name links to their profile` : d.name}
            >
              {d.driverId ? (
                <Link to={`/drivers/${d.driverId}`} className="flex items-center gap-1.5 truncate" onClick={(e) => e.stopPropagation()}>
                  {chip}
                </Link>
              ) : (
                chip
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
