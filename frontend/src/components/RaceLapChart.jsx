import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { motionOff } from "../hooks/motion.js";

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

// The replay: the race is played back lap by lap, the lines drawing themselves
// left to right with a dot on each car's current place, so overtakes are seen
// happening instead of reconstructed from a finished tangle. Takes as long as
// it takes to follow (a few seconds however long the race), plays once when the
// chart opens, and hands over to a scrubber the moment somebody wants to look
// at a particular lap. Where motion is off (reduced motion, Lite mode) it opens
// on the finished chart and only moves when somebody presses Play.
const REPLAY_MIN_MS = 6000;
const REPLAY_MAX_MS = 14000;
const REPLAY_MS_PER_LAP = 300;

// Where a car is at a (fractional) lap: its place, tweened between the two laps
// either side. Null before its first lap; held at its last place after it stops.
function placeAt(points, lap) {
  const n = points.length;
  if (!n || lap < points[0].lap) return null;
  if (lap >= points[n - 1].lap) return points[n - 1].position;
  let i = 0;
  while (i < n - 2 && points[i + 1].lap <= lap) i += 1;
  const a = points[i];
  const b = points[i + 1];
  const t = (lap - a.lap) / Math.max(1e-6, b.lap - a.lap);
  return a.position + (b.position - a.position) * t;
}

// The lines themselves never change during a replay (the clip in front of them
// does), so they sit in a memo and are not rebuilt sixty times a second.
// `lit` is the set of highlighted lines, or null when nobody is picked.
const Lines = memo(function Lines({ polys, maxLap, lit, stroke }) {
  // One line picked loses its dash and gets a lot heavier; a whole tier picked
  // keeps the dashes (team mates share a colour) and only gets a little heavier,
  // or ten fat lines turn back into the tangle they were picked out of.
  const solo = lit && lit.size === 1;
  const bump = solo ? 2 : lit && lit.size <= 4 ? 1.5 : 1;
  // The picked lines are drawn last so they run over the dimmed field.
  const ordered = lit ? [...polys.filter((d) => !lit.has(d.id)), ...polys.filter((d) => lit.has(d.id))] : polys;
  return (
    <svg
      viewBox={`0 0 ${maxLap - 1} 100`}
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full overflow-visible"
      aria-hidden="true"
    >
      {ordered.map((d) => {
        const on = lit?.has(d.id);
        const dim = lit && !on;
        return (
          <polyline
            key={d.id}
            points={d.pts}
            fill="none"
            stroke={d.color}
            strokeWidth={on ? stroke + bump : stroke}
            strokeDasharray={on && solo ? undefined : d.dash}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            // Dimmed, not erased: picking a driver should show where
            // they were in the race, and a field faded to nothing
            // leaves one line floating in an empty box with no
            // traffic to have overtaken.
            opacity={dim ? 0.22 : 1}
            className="transition-opacity"
          />
        );
      })}
    </svg>
  );
});

export default function RaceLapChart({ data, className = "" }) {
  // Who is highlighted. `pinned` is what was clicked and stays lit until it is
  // clicked again; `hover` is the name under the mouse, lit only while it is
  // there and on top of whatever is pinned.
  const [pinned, setPinned] = useState(() => new Set());
  const [hover, setHover] = useState(null);
  const [allNames, setAllNames] = useState(false);
  const lit = useMemo(() => {
    if (!pinned.size && !hover) return null;
    const s = new Set(pinned);
    if (hover) s.add(hover);
    return s;
  }, [pinned, hover]);
  const togglePin = (id) =>
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // The replay position, in laps (fractional while playing). Starts at lap 1
  // and plays, unless motion is off, in which case the chart opens finished.
  const lastLap = data?.maxLap || 0;
  const startPlaying = lastLap >= 2 && !motionOff();
  const [lap, setLapState] = useState(startPlaying ? 1 : lastLap);
  const [playing, setPlaying] = useState(startPlaying);
  const lapRef = useRef(lap);
  // The plot is wider than a phone, so the replay's front edge would run off the
  // right of the screen: the strip follows it (and rewinds with a replay).
  const scrollerRef = useRef(null);
  const plotRef = useRef(null);
  const go = useCallback((v) => {
    lapRef.current = v;
    setLapState(v);
  }, []);
  const msPerLap = Math.min(REPLAY_MAX_MS, Math.max(REPLAY_MIN_MS, lastLap * REPLAY_MS_PER_LAP)) / Math.max(1, lastLap - 1);
  useEffect(() => {
    const sc = scrollerRef.current;
    const plot = plotRef.current;
    if (!sc || !plot || lastLap < 2 || lap >= lastLap) return;
    const sr = sc.getBoundingClientRect();
    const pr = plot.getBoundingClientRect();
    const headX = pr.left - sr.left + sc.scrollLeft + ((lap - 1) / (lastLap - 1)) * pr.width;
    // Only move when the front edge leaves the comfortable middle of the view,
    // so the strip glides in steps rather than juddering every frame.
    if (headX > sc.scrollLeft + sc.clientWidth * 0.85 || headX < sc.scrollLeft + 70) {
      sc.scrollLeft = Math.max(0, headX - sc.clientWidth * 0.6);
    }
  }, [lap, lastLap]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now) => {
      // A backgrounded tab stops calling this and then hands over one enormous
      // gap; capped, the replay resumes where it was instead of jumping ahead.
      const dt = Math.min(100, now - prev);
      prev = now;
      const next = lapRef.current + dt / msPerLap;
      if (next >= lastLap) {
        go(lastLap);
        setPlaying(false);
        return;
      }
      go(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, lastLap, msPerLap, go]);

  const { drivers, maxLap, maxPos } = useMemo(() => {
    const ds = (data?.drivers || []).filter((d) => (d.points || []).length > 0);
    const maxPos = Math.max(1, ...ds.flatMap((d) => d.points.map((p) => p.position)));
    return { drivers: ds, maxLap: data?.maxLap || 0, maxPos };
  }, [data]);

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

  const polys = useMemo(() => {
    const yOf = (pos) => PLOT_TOP + ((pos - 1) / Math.max(1, maxPos - 1)) * (PLOT_BOTTOM - PLOT_TOP);
    return drivers.map((d, i) => ({
      // What identifies a line. NOT the file's GUID — that is a SteamID, and the
      // endpoint deliberately doesn't hand those to the public — so a driver's
      // own id, and their place in the field for anyone the league couldn't match.
      id: d.driverId || `row-${i}`,
      color: d.color || NEUTRAL[i % NEUTRAL.length],
      dash: dashes[i],
      pts: d.points.map((p) => `${(p.lap - 1).toFixed(2)},${yOf(p.position).toFixed(2)}`).join(" "),
    }));
  }, [drivers, maxPos, dashes]);

  // Every hook above this line, because the guard below returns early: a round
  // whose laps arrive a moment later would otherwise render a different number
  // of hooks the second time and take the page down.
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

  // Whole groups at once: Tier 1, Tier 2, Reserve. Only offered when the field
  // actually has more than one of them, a series without tiers gets no buttons.
  const groups = [
    { tier: 1, label: "Tier 1" },
    { tier: 2, label: "Tier 2" },
    { tier: 0, label: "Reserve" },
  ]
    .map((g) => ({ ...g, ids: drivers.map((d, i) => (d.tier === g.tier ? idOf(d, i) : null)).filter(Boolean) }))
    .filter((g) => g.ids.length > 0);
  const showGroups = groups.length > 1;
  // A group button is on when all of its drivers are pinned. Pressing it then
  // takes them off again; otherwise it adds them to whatever is already picked,
  // so Tier 1 plus one reserve is two clicks.
  const groupOn = (g) => g.ids.every((id) => pinned.has(id));
  const toggleGroup = (g) =>
    setPinned((prev) => {
      const next = new Set(prev);
      if (g.ids.every((id) => prev.has(id))) g.ids.forEach((id) => next.delete(id));
      else g.ids.forEach((id) => next.add(id));
      return next;
    });
  // Touch fires mouseenter on a tap and never the leave, which left a tapped
  // name lit for good. Hover is a mouse thing; on a phone the tap pins.
  const hoverIn = (id) => (e) => {
    if (e.pointerType === "mouse") setHover(id);
  };
  const hoverOut = () => setHover(null);
  const chip = (active) =>
    `flex items-center gap-1.5 rounded-lg px-2 py-1 font-display text-[11px] font-bold uppercase tracking-tight transition ${
      active ? "bg-surface2 text-dark ring-1 ring-border" : "text-medium hover:bg-surface2 hover:text-dark"
    }`;

  // Replay state for the render: the clip that uncovers the lines up to the
  // current lap, and whether it has played out.
  const done = lap >= maxLap;
  const pct = Math.max(0, Math.min(100, ((lap - 1) / Math.max(1, maxLap - 1)) * 100));
  const clip = done ? undefined : { clipPath: `inset(-8px ${(100 - pct).toFixed(2)}% -8px -8px)` };
  // The leftmost lap of the slider is 1; pressing Play at the end starts over.
  const onPlay = () => {
    if (playing) return setPlaying(false);
    if (done) go(1);
    setPlaying(true);
  };

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
      <div ref={scrollerRef} className="scrollbar-none w-full overflow-x-auto overflow-y-hidden overscroll-x-none pt-5">
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

            <div ref={plotRef} className="relative flex-1" style={{ height: plotH }}>
              {ticks.map((p) => (
                <span
                  key={p}
                  className="absolute inset-x-0 border-t border-dashed border-border"
                  style={{ top: `${yPct(p)}%` }}
                />
              ))}
              {/* The lines, clipped to the replay's current lap. Once it has
                  played out the clip is dropped altogether and this is the
                  plain finished chart. */}
              <div className="absolute inset-0" style={clip}>
                <Lines polys={polys} maxLap={maxLap} lit={lit} stroke={stroke} />
              </div>
              {/* A dot on every car's current place while the replay is on the
                  way (or being scrubbed): HTML rather than SVG so it stays
                  round in a plot that is stretched to fit. */}
              {!done &&
                drivers.map((d, i) => {
                  const pos = placeAt(d.points, lap);
                  if (pos == null) return null;
                  const id = polys[i].id;
                  const out = lap > d.points[d.points.length - 1].lap;
                  return (
                    <span
                      key={id}
                      aria-hidden="true"
                      className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                      style={{
                        left: `${((lap - 1) / Math.max(1, maxLap - 1)) * 100}%`,
                        top: `${yPct(pos)}%`,
                        backgroundColor: polys[i].color,
                        opacity: lit && !lit.has(id) ? 0.25 : out ? 0.35 : 1,
                        zIndex: lit?.has(id) ? 1 : undefined,
                      }}
                    />
                  );
                })}
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

      {/* The replay's controls: play / pause / replay, a scrubber to any lap
          (dragging it takes over from the playback), and where it is. */}
      <div className="flex items-center gap-3 px-5 pb-1 pt-2 sm:px-6">
        <button
          type="button"
          onClick={onPlay}
          className="btn-secondary shrink-0 gap-1.5 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider"
          aria-label={playing ? "Pause the replay" : done ? "Replay the race" : "Play the replay"}
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
          ) : done ? (
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {playing ? "Pause" : done ? "Replay" : "Play"}
        </button>
        <input
          type="range"
          min={1}
          max={maxLap}
          step={0.01}
          value={lap}
          onPointerDown={() => setPlaying(false)}
          onChange={(e) => go(Number(e.target.value))}
          aria-label="Lap"
          aria-valuetext={`Lap ${Math.floor(lap)} of ${maxLap}`}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-brand"
        />
        <span className="w-16 shrink-0 text-right font-mono text-[11px] font-bold tabular-nums text-medium">
          {Math.floor(lap)} / {maxLap}
        </span>
      </div>

      {/* The legend is also the control: the lines are thin and many, so the
          way to follow one driver is to pick their name. Finishing order, so
          it reads like the classification it replaced.
          On a full grid it is also the longest thing on the card — 38 names is
          eight rows of chips under a chart people came to look AT — so it
          starts at the front of the field and opens on request. */}
      {/* Groups first, then the names. Both pin: a click keeps the lines lit
          until it is clicked again, and any number can be lit at once. */}
      {(showGroups || pinned.size > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border px-5 pt-4 sm:px-6">
          {showGroups &&
            groups.map((g) => {
              const on = groupOn(g);
              return (
                <button
                  key={g.tier}
                  type="button"
                  className={chip(on)}
                  onClick={() => toggleGroup(g)}
                  aria-pressed={on}
                  title={on ? `Stop highlighting ${g.label}` : `Highlight every ${g.label} driver`}
                >
                  {g.label}
                  <span className="font-mono text-[10px] text-faint">{g.ids.length}</span>
                </button>
              );
            })}
          {pinned.size > 0 && (
            <button
              type="button"
              className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-link transition hover:underline"
              onClick={() => setPinned(new Set())}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>
      )}
      <div
        className={`flex flex-wrap items-center gap-1.5 px-5 pb-4 sm:px-6 ${
          showGroups || pinned.size > 0 ? "pt-2" : "mt-4 border-t border-border pt-4"
        }`}
      >
        {shownDrivers.map((d, i) => {
          const id = idOf(d, i);
          const active = pinned.has(id);
          const dash = dashes[i];
          const cls = chip(active);
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
              onPointerEnter={hoverIn(id)}
              onPointerLeave={hoverOut}
              onClick={() => togglePin(id)}
              aria-pressed={active}
              title={active ? `${d.name}: click to let go of their line` : `${d.name}: click to keep their line highlighted`}
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
