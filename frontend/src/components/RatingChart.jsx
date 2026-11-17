import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Line chart of one rating series: stretched SVG with a crisp non-scaling
// stroke, dashed gridlines, a soft area fill, one dot per race and a hover
// card reporting what that race did. `career` = the all-time view, where the
// points span several seasons (dashed separators, season names under the
// axis) instead of a single season's rounds.
export default function RatingChart({ points, statKey, color, career = false, perRace = false }) {
  // { i, x, y } — index plus the hovered dot's position ON SCREEN, so the card
  // can be positioned fixed and float clear of the plot (which scrolls
  // horizontally and would otherwise clip it).
  const [hover, setHover] = useState(null);
  const N = points.length;

  // Edge fades: when the plot scrolls sideways, the cut-off edges get a soft
  // gradient into the card background instead of a hard clip — and each fade
  // only shows where there actually IS more content (same pattern as the
  // Races page's round rail). ALL hooks live above the empty-state return
  // below, or React's hook order breaks when the state flips (the "By race"
  // view renders empty for a beat while its points load).
  const scrollRef = useRef(null);
  const [fade, setFade] = useState({ l: false, r: false });
  const updateFade = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const l = el.scrollLeft > 4;
    const r = max - el.scrollLeft > 4;
    setFade((cur) => (cur.l === l && cur.r === r ? cur : { l, r }));
  };
  // Re-check when the layout settles or changes (mount, resize, more points).
  useEffect(() => {
    updateFade();
    const el = scrollRef.current;
    const ro = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(updateFade) : null;
    if (el) ro?.observe(el);
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [N, perRace]);

  // The detail card is pinned to screen coordinates, so scrolling the PAGE
  // would leave it floating over the wrong spot — drop it on any page scroll
  // (the plot's own sideways scroll already does the same).
  useEffect(() => {
    const drop = () => setHover((cur) => (cur ? null : cur));
    window.addEventListener("scroll", drop, { passive: true });
    return () => window.removeEventListener("scroll", drop);
  }, []);

  // Drag-to-pan with the mouse: hold down anywhere on the plot and slide it
  // sideways (touch already pans natively). A real drag (>4px) swallows the
  // click that follows, so letting go doesn't also open a race's detail card.
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const onDragStart = (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    dragRef.current = { x: e.clientX, sl: el.scrollLeft, moved: false };
    setDragging(true);
  };
  const onDragMove = (e) => {
    const d = dragRef.current;
    const el = scrollRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) d.moved = true;
    el.scrollLeft = d.sl - dx;
  };
  const onDragEnd = () => {
    setDragging(false);
    // Cleared on the next tick, AFTER the click event this drag may produce —
    // the column click handler reads `moved` to tell a drag from a tap.
    setTimeout(() => {
      dragRef.current = null;
    }, 0);
  };

  const rated = points.map((p, i) => (p.ratings ? { i, v: p.ratings[statKey] } : null)).filter(Boolean);
  if (rated.length === 0) return <div className="p-6 text-sm text-light">No rated rounds yet.</div>;
  const vals = rated.map((r) => r.v);
  const lo = Math.max(0, Math.min(...vals) - 3);
  const hi = Math.min(99, Math.max(...vals) + 3);
  const span = Math.max(1, hi - lo);
  const yPct = (v) => 8 + (1 - (v - lo) / span) * 84;

  const step = span <= 8 ? 2 : span <= 20 ? 5 : 10;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);

  const line = rated.map((r) => ({ x: r.i + 0.5, y: yPct(r.v) }));
  const d = line.map((pt, k) => `${k ? "L" : "M"}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(" ");
  const areaD = line.length > 1 ? `${d} L${line[line.length - 1].x.toFixed(2)},100 L${line[0].x.toFixed(2)},100 Z` : null;
  const gradId = `rt-grad-${statKey}${career ? "-c" : ""}`;
  // The per-race career view packs far more points in, so each gets a
  // narrower column (and scrolls sideways once even that runs out).
  // A handful of season points fits a phone without scrolling sideways.
  const minW = Math.max(career && !perRace ? 240 : 360, N * (perRace ? 34 : 62));
  const seasonBest = Math.max(...vals);
  const seasonLow = Math.min(...vals);

  // Season blocks for the all-time axis: where each season starts and how many
  // races it contributes, so its name can sit centred under its own block.
  const groups = [];
  points.forEach((p, i) => {
    const key = p.seasonNumber ?? null;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.count++;
    else groups.push({ key, from: i, count: 1, label: p.seasonName || (key != null ? `Season ${key}` : "") });
  });

  const hp = hover ? points[hover.i] : null;
  const hv = hp?.ratings ? hp.ratings[statKey] : null;

  // Pin the detail card to a column. Works for mouse hover AND touch: phones
  // can't hover, so a tap on a race opens its card (tapping it again, tapping
  // another race, or scrolling the plot dismisses it).
  const showFrom = (i, el, r) => {
    const box = el.getBoundingClientRect();
    setHover({
      i,
      x: box.left + box.width / 2,
      y: box.top + (r != null ? (yPct(r) / 100) * box.height : box.height / 2),
    });
  };

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className={`scrollbar-none w-full overflow-x-auto overflow-y-hidden overscroll-x-none ${
          dragging ? "cursor-grabbing select-none" : fade.l || fade.r ? "cursor-grab" : ""
        }`}
        onScroll={() => {
          setHover(null);
          updateFade();
        }}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerLeave={onDragEnd}
        onPointerCancel={onDragEnd}
      >
      <div className="flex h-72 flex-col" style={{ minWidth: minW + 40 }}>
        <div className="flex min-h-0 flex-1 items-stretch">
          {/* Pinned y-axis. Its solid column is a touch wider than the numbers
              (pr-2) so scrolled-away content can never peek through between
              the numbers and the plot — and the numbers sit clearly apart. */}
          <div className="sticky-fade sticky left-0 z-10 w-10 shrink-0 bg-card pr-2">
            <div className="relative h-full">
              {ticks.map((v) => (
                <span key={v} className="absolute right-0 -translate-y-1/2 font-mono text-[10px] font-bold tabular-nums text-faint" style={{ top: `${yPct(v)}%` }}>
                  {v}
                </span>
              ))}
            </div>
          </div>
          <div className="relative flex-1">
            {ticks.map((v) => (
              <span key={v} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${yPct(v)}%` }} />
            ))}
            {/* season separators (only where a season spans several points) */}
            {perRace &&
              groups.slice(1).map((g) => (
                <span
                  key={`sep-${g.from}`}
                  className="absolute inset-y-0 border-l border-dashed border-border"
                  style={{ left: `${(g.from / N) * 100}%` }}
                />
              ))}
            {/* keyed on the shown series: switching RAC/AWA/... remounts the
                plot, so it wipes in from the left again instead of the dots
                sliding vertically from their old values to the new ones */}
            <div key={`${statKey}-${career ? "c" : "s"}`} className="wipe-ltr absolute inset-0" style={{ "--wipe-dur": "1.2s" }}>
              <svg viewBox={`0 0 ${N} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {areaD && <path d={areaD} fill={`url(#${gradId})`} stroke="none" />}
                {line.length > 1 && (
                  <path d={d} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                )}
              </svg>
              <div className="absolute inset-0 flex">
                {points.map((p, i) => {
                  const r = p.ratings ? p.ratings[statKey] : null;
                  const isHover = hover?.i === i;
                  // the run's high and low get a coloured ring, so the peaks
                  // read without hunting through the numbers
                  const ring = r == null ? null : r === seasonBest ? "#16a34a" : r === seasonLow && seasonLow !== seasonBest ? "#dc2626" : null;
                  return (
                    // the whole column is the hover target, so the pointer
                    // catches a race anywhere above or below its dot
                    <div
                      key={p.raceId || i}
                      className="relative flex-1 cursor-pointer"
                      // Hover for mouse; tap for touch (toggles this race's card).
                      onMouseEnter={(e) => showFrom(i, e.currentTarget, r)}
                      onMouseLeave={() => setHover((cur) => (cur?.i === i ? null : cur))}
                      onClick={(e) => {
                        if (dragRef.current?.moved) return; // that was a pan, not a tap
                        if (hover?.i === i) setHover(null);
                        else showFrom(i, e.currentTarget, r);
                      }}
                    >
                      {isHover && <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />}
                      {r != null && (
                        <>
                          {ring && (
                            // a bordered circle (not a box-shadow halo), so its
                            // visible edge is exactly concentric with the dot
                            <span
                              className="absolute h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                              style={{ left: "50%", top: `${yPct(r)}%`, borderColor: ring }}
                            />
                          )}
                          {/* only the hover grow is animated — never the
                              position, or a series switch would slide every
                              dot vertically to its new value */}
                          <span
                            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card transition-[width,height] duration-quick"
                            style={{
                              left: "50%",
                              top: `${yPct(r)}%`,
                              backgroundColor: color,
                              width: isHover ? 18 : 14,
                              height: isHover ? 18 : 14,
                            }}
                          />
                          {/* the value rides along only where there's room;
                              in the dense per-race view the hover card
                              carries it instead */}
                          {!perRace && (
                            // lifted clear of the best/low rings, which reach
                            // further out than the plain dots
                            <span
                              className="absolute -translate-x-1/2 font-display text-xs font-black tabular-nums text-dark"
                              style={{ left: "50%", top: `calc(${yPct(r)}% - 2.1rem)` }}
                            >
                              {r}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Hover card. Rendered through a PORTAL onto the body: the plot
                  scrolls horizontally and its ancestors carry transforms (the
                  reveal + wipe animations), which would both clip the card and
                  break `fixed` positioning. On the body it floats free above
                  everything and sits above the dot (below it near the top of
                  the screen), so it never covers the point being read. */}
              {hp &&
                createPortal(
                  <div
                    className="pointer-events-none fixed z-50 w-max max-w-[17rem] rounded-xl border border-border bg-card p-3.5 text-left shadow-2xl shadow-ink/30"
                    style={{
                      left: Math.min(Math.max(hover.x, 150), window.innerWidth - 150),
                      ...(hover.y > 260
                        ? { top: hover.y - 18, transform: "translate(-50%, -100%)" }
                        : { top: hover.y + 18, transform: "translate(-50%, 0)" }),
                    }}
                  >
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                    <span className="font-display text-lg font-black uppercase leading-tight tracking-tight text-dark">{hp.track}</span>
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                      {career
                        ? perRace && hp.seasonNumber != null
                          ? `S${hp.seasonNumber} · R${hp.number}`
                          : `${hp.races ?? ""}${hp.races ? " races" : ""}`
                        : `Round ${hp.number}`}
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2.5">
                    <span className="font-display text-3xl font-black leading-none tabular-nums" style={{ color }}>
                      {hv ?? "–"}
                    </span>
                    {hp.delta?.[statKey] != null && (
                      <span
                        className="rounded-md px-1.5 py-0.5 font-mono text-sm font-bold tabular-nums"
                        style={{
                          color: hp.delta[statKey] > 0 ? "#16a34a" : hp.delta[statKey] < 0 ? "#dc2626" : undefined,
                          backgroundColor:
                            hp.delta[statKey] > 0
                              ? "rgba(22,163,74,0.12)"
                              : hp.delta[statKey] < 0
                                ? "rgba(220,38,38,0.12)"
                                : "transparent",
                        }}
                      >
                        {hp.delta[statKey] === 0
                          ? "±0"
                          : hp.delta[statKey] > 0
                            ? `▲${hp.delta[statKey]}`
                            : `▼${-hp.delta[statKey]}`}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-medium">
                    {hp.race
                      ? hp.race.raced
                        ? `${hp.race.position != null ? `P${hp.race.position}` : hp.race.status}${hp.race.grid != null ? ` from P${hp.race.grid}` : ""}`
                        : "Did not race"
                      : /* season point: its headline numbers instead */
                        [
                          hp.starts != null && `${hp.starts} start${hp.starts === 1 ? "" : "s"}`,
                          hp.wins ? `${hp.wins} win${hp.wins === 1 ? "" : "s"}` : null,
                          hp.podiums ? `${hp.podiums} podium${hp.podiums === 1 ? "" : "s"}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </div>
                  {hp.rank != null && (
                    <div className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-light">
                      #{hp.rank} of {hp.fieldSize} rated
                    </div>
                  )}
                  </div>,
                  document.body
                )}
            </div>
          </div>
        </div>
        {/* x-axis: round (plus the circuit where there is room); in the
            all-time view the season name spans its own block of races */}
        <div className="flex pt-2.5">
          {/* sticky spacer: covers scrolled-away labels, like the axis above */}
          <div className="sticky-fade sticky left-0 z-10 w-10 shrink-0 bg-card" />
          {points.map((p, i) => (
            <div key={p.raceId || i} className="min-w-0 flex-1 px-0.5 text-center">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
                {career && !perRace ? `S${p.number}` : p.number}
              </div>
              {!perRace && (
                <div className="truncate font-display text-[11px] font-bold uppercase tracking-tight text-light" title={p.track}>
                  {p.track}
                </div>
              )}
            </div>
          ))}
        </div>
        {perRace && (
          <div className="mt-1.5 flex">
            <div className="sticky left-0 z-10 w-10 shrink-0 bg-card" />
            {/* the separator sits on the CONTENT half only, so it starts at the
                axis edge instead of running left under it */}
            <div className="flex min-w-0 flex-1 border-t border-border pt-1.5">
              {groups.map((g) => (
                <div key={g.from} className="min-w-0 px-1 text-center" style={{ flex: `${g.count} 1 0%` }}>
                  <span className="block truncate font-display text-[11px] font-bold uppercase tracking-tight text-light">{g.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>
      {/* soft edges over the scrolling plot: left one starts after the pinned
          y-axis, each side only shows while there is more to scroll to, and
          both stop above the scrollbar strip so the thumb stays readable */}
      {fade.l && (
        <div aria-hidden className="pointer-events-none absolute bottom-2 left-10 top-0 w-8 bg-gradient-to-r from-card to-transparent" />
      )}
      {fade.r && (
        <div aria-hidden className="pointer-events-none absolute bottom-2 right-0 top-0 w-8 bg-gradient-to-l from-card to-transparent" />
      )}
    </div>
  );
}
