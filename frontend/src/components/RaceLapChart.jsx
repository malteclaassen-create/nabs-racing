import { useMemo, useState } from "react";

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

// How many names the legend shows before it asks. Roughly the front half of a
// normal grid: enough that the people being talked about after a race are
// there, short enough that the chart stays the biggest thing on the card.
const LEGEND_CAP = 12;

export default function RaceLapChart({ data, className = "" }) {
  const [focus, setFocus] = useState(null); // guid of the highlighted driver
  const [allNames, setAllNames] = useState(false);

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

  // The plot grows with the field instead of being one fixed height. A 38-car
  // grid in the 224px box this started with left six pixels between one
  // position and the next, which is not a chart, it is a texture. Twelve
  // pixels a place gives every line somewhere to be; the cap keeps a full grid
  // from turning the panel into a wall.
  const plotH = Math.min(540, Math.max(224, maxPos * 12));
  // Weight enough to be followed across the plot, a touch less on a deep grid
  // so neighbouring lines don't merge into a band.
  const stroke = maxPos > 24 ? 2.2 : 2.6;

  const colorOf = (d, i) => d.color || NEUTRAL[i % NEUTRAL.length];
  // What identifies a line. NOT the file's GUID — that is a SteamID, and the
  // endpoint deliberately doesn't hand those to the public — so a driver's own
  // id, and their place in the field for anyone the league couldn't match.
  const idOf = (d, i) => d.driverId || `row-${i}`;
  const shownDrivers = allNames ? drivers : drivers.slice(0, LEGEND_CAP);

  // Team mates share a team colour, so on a full grid half the lines have a
  // twin. The second car of a colour is dashed and the third dotted, which
  // separates them without inventing colours the rest of the site doesn't use.
  const dashes = useMemo(() => {
    const seen = new Map();
    return (data?.drivers || []).map((d, i) => {
      const c = d.color || NEUTRAL[i % NEUTRAL.length];
      const n = (seen.get(c) || 0) + 1;
      seen.set(c, n);
      return n === 1 ? undefined : n === 2 ? "7 4" : "2 3";
    });
  }, [data]);

  return (
    // Its own card, like the results table it stands in for — and the reason
    // the pinned axis can be bg-card: without the panel, the chart would sit
    // straight on the page and the axis column would be a lighter block
    // floating over a darker background.
    <div className={`card overflow-hidden ${className}`}>
      {/* Same scrolling contract as the season-form chart: sideways only, no
          bars, and the pinned axis fades whatever slides under it. */}
      {/* The card's side padding belongs to the CONTENT here, not to the
          scroll box. As padding on the scroller it sat inside the clip region,
          so a scrolled line slid into those twenty pixels and stayed visible
          there — to the LEFT of the pinned axis, which sticks to the content
          edge and so never covered them. Lines reappeared past the labels they
          had just disappeared behind. With the inset carried by the axis
          column (pl-5) and the right edge (pr-5), the pinned column starts at
          the scroll box's own edge and there is nowhere left to hide. */}
      <div className="scrollbar-none w-full overflow-x-auto overflow-y-hidden overscroll-x-none pt-5">
        <div style={{ minWidth: minW + 52 }} className="pr-5 sm:pr-6">
          <div className="flex items-stretch gap-2">
            {/* pinned position axis */}
            <div className="sticky-fade sticky left-0 z-10 w-12 shrink-0 bg-card pl-5 sm:w-[3.25rem] sm:pl-6" style={{ height: plotH }}>
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

            <div className="relative flex-1" style={{ height: plotH }}>
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
                  const id = idOf(d, i);
                  const dim = focus && focus !== id;
                  return (
                    <polyline
                      key={id}
                      points={pts}
                      fill="none"
                      stroke={colorOf(d, i)}
                      strokeWidth={focus === id ? stroke + 2 : stroke}
                      strokeDasharray={focus === id ? undefined : dashes[i]}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      // Dimmed, not erased: picking a driver should show where
                      // they were in the race, and a field faded to nothing
                      // leaves one line floating in an empty box with no
                      // traffic to have overtaken.
                      opacity={dim ? 0.28 : 1}
                      className="transition-opacity"
                    />
                  );
                })}
              </svg>
            </div>
          </div>

          {/* lap axis, under the plot and aligned with it */}
          <div className="mt-2 flex gap-2">
            <div className="sticky-fade sticky left-0 z-10 w-12 shrink-0 bg-card pl-5 sm:w-[3.25rem] sm:pl-6" />
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
        </div>
      </div>
      {/* Outside the scroller: centred on the card, where it can be read,
          rather than centred on a plot that is wider than the screen and
          therefore off to one side of it. */}
      <div className="pb-1 pt-1 text-center font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
        Lap
      </div>

      {/* The legend is also the control: the lines are thin and many, so the
          way to follow one driver is to pick their name. Finishing order, so
          it reads like the classification it replaced.
          On a full grid it is also the longest thing on the card — 38 names is
          eight rows of chips under a chart people came to look AT — so it
          starts at the front of the field and opens on request. */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border px-5 py-4 sm:px-6">
        {shownDrivers.map((d, i) => {
          const id = idOf(d, i);
          const active = focus === id;
          const dash = dashes[i];
          const cls = `flex items-center gap-1.5 rounded-lg px-2 py-1 font-display text-[11px] font-bold uppercase tracking-tight transition ${
            active ? "bg-surface2 text-dark ring-1 ring-border" : "text-medium hover:bg-surface2 hover:text-dark"
          }`;
          return (
            // A plain button, and only a button. It used to carry a link to
            // the driver's profile inside it — an <a> in a <button>, which is
            // invalid and behaved like it: a tap meant to follow a line
            // navigated away instead. Every name in the classification next
            // door is already a link; here the job is to pick out one line.
            <button
              key={id}
              type="button"
              className={cls}
              onMouseEnter={() => setFocus(id)}
              onMouseLeave={() => setFocus(null)}
              onClick={() => setFocus(active ? null : id)}
              aria-pressed={active}
              title={`${d.name} — tap to follow their line`}
            >
              {/* The swatch repeats the line's dash pattern, or two lines of
                  the same colour would look like one entry in the key. */}
              <span
                className="h-0.5 w-4 shrink-0 rounded-full"
                style={
                  dash
                    ? { backgroundImage: `repeating-linear-gradient(to right, ${colorOf(d, i)} 0 ${dash === "7 4" ? "5px" : "2px"}, transparent ${dash === "7 4" ? "5px 8px" : "2px 4px"})` }
                    : { backgroundColor: colorOf(d, i) }
                }
              />
              <span className="truncate">{d.name}</span>
            </button>
          );
        })}
        {drivers.length > LEGEND_CAP && (
          <button
            type="button"
            className="rounded-lg px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-link transition hover:underline"
            onClick={() => setAllNames((v) => !v)}
          >
            {allNames ? "Show fewer" : `All ${drivers.length} drivers`}
          </button>
        )}
      </div>
    </div>
  );
}
