import { useEffect, useRef, useState } from "react";

// The home page shows the whole field and keeps that version off phones (its
// call sites wrap it in `hidden md:block`): a dozen equal lines do not read at
// that width. A team page instead passes `highlight`: that team's line is drawn
// bold with its name and total at the end, the rest of its tier stays behind it
// as faint context. One line to follow reads fine on a phone. At every width
// the viewBox is as wide as the card itself, so the axis type keeps its real
// size and the chart its height instead of both scaling with the drawing.

// Combined points-progression chart: every team's cumulative points as lines in
// one graph. Hover a round to read exact points; hover/click a team in the
// legend to highlight its line. Lines draw themselves in on mount.

// "Nice" number for axis ticks so the top of the scale hugs the data.
function niceNum(v, round) {
  const e = Math.floor(Math.log10(v));
  const f = v / Math.pow(10, e);
  let nf;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, e);
}

// `completed` = rounds plotted on the x-axis (those with scores). `allRounds` =
// the full season calendar (incl. not-yet-run rounds), used in the footnote.
// `dropMode` / `teamDropWorst` mirror the standings payload so the footnote
// describes whichever drop rule is actually in force.
// `highlight` = teamId drawn bold and labelled (team and driver pages).
// `eyebrow` / `title` give the card its own header row. `note` replaces the
// footnote under the legend, which is written for the constructor tables
// (a driver page plots drivers: rows in the same shape, keyed by driver id).
export default function PointsChart({ standings = [], completed = [], allRounds = [], dropWorst = 3, dropMode = "driver", teamDropWorst = null, highlight = null, eyebrow = null, title = null, note = null }) {
  const [focus, setFocus] = useState(null); // hovered team
  const [pinned, setPinned] = useState(null); // clicked team
  const [hover, setHover] = useState(null); // { idx, x, w }
  const svgRef = useRef(null);
  const boxRef = useRef(null);
  // Width of the plot box, for the narrow layout. Guessed from the window on
  // the first render so a phone does not draw the wide version first.
  const [boxW, setBoxW] = useState(() => (typeof window !== "undefined" && window.innerWidth < 640 ? window.innerWidth - 72 : null));
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setBoxW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
    // The box only exists once there is something to plot (the empty state
    // renders without it), so look again when the first round arrives.
  }, [completed.length > 0]);


  if (!completed.length) {
    return <div className="card p-6 text-sm text-light">No completed rounds yet.</div>;
  }

  const N = completed.length;
  const series = standings.map((t) => {
    // Cumulative CHAMPIONSHIP total after each round: each round adds what it
    // actually counts toward the season total (its scored points minus the
    // share the standings marked as dropped in droppedPerRace). The standings
    // already applied whichever drop rule is in force, so the line ends
    // exactly on the team's real season total (the number in the table).
    const pts = [0];
    let cum = 0;
    for (const n of completed) {
      const scored = t.perRace?.[n] || 0;
      const dropped = Math.min(scored, t.droppedPerRace?.[n] || 0);
      cum += scored - dropped;
      pts.push(cum);
    }
    return { teamId: t.teamId, name: t.name, color: t.color, total: t.total, perRace: t.perRace, pts };
  });

  const rawMax = Math.max(1, ...series.map((s) => s.pts[s.pts.length - 1]));
  const step = niceNum(rawMax / 4, true);
  const maxY = Math.ceil(rawMax / step) * step;

  // The viewBox is the card's own width, so 1 unit = 1px: the axis type stays
  // at its real size and the height stays put on a wide screen, instead of the
  // whole drawing scaling up with the card (a 360-high chart grew to ~600px
  // across a desktop). Before the first measurement the old fixed box is used.
  const compact = boxW != null && boxW < 560;
  const W = boxW != null ? Math.max(260, boxW) : 820;
  const H = compact ? 260 : boxW != null ? 320 : 360;
  const padL = compact ? 38 : 46, padR = compact ? 10 : 16, padT = 20, padB = compact ? 30 : 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xFor = (i) => padL + (i / N) * plotW;
  const yFor = (v) => padT + plotH - (v / maxY) * plotH;

  const gridVals = [];
  for (let v = 0; v <= maxY + 1e-6; v += step) gridVals.push(v);

  // What the user points at wins; otherwise the page's own team.
  const active = pinned ?? focus ?? highlight;
  // Resting on the page's team: the others stay readable as context instead of
  // fading out the way they do when you single a line out yourself.
  const resting = highlight != null && active === highlight;
  const dimOpacity = resting ? 0.4 : 0.12;
  // On a narrow card every second round label goes once they would touch.
  const labelEvery = compact && N > 8 ? 2 : 1;
  const activeSeries = active ? series.find((s) => s.teamId === active) : null;
  const AXIS = { fill: "var(--c-text3)", fontFamily: "JetBrains Mono, monospace", fontSize: 11, fontWeight: 600 };

  function onMove(e) {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const vbX = ((e.clientX - r.left) / r.width) * W;
    let idx = Math.round(((vbX - padL) / plotW) * N);
    idx = Math.max(0, Math.min(N, idx));
    setHover({ idx, x: (xFor(idx) / W) * r.width, w: r.width });
  }

  // Tooltip rows for the hovered round.
  let tip = null;
  if (hover) {
    const idx = hover.idx;
    const label = idx === 0 ? "Season start" : `Round ${completed[idx - 1]}`;
    let rows = series.map((s) => ({
      teamId: s.teamId,
      name: s.name,
      color: s.color,
      // raw points actually scored that round (the cumulative `cum` is the
      // championship total, which may not move if this round is being dropped)
      race: idx > 0 ? s.perRace?.[completed[idx - 1]] || 0 : 0,
      cum: s.pts[idx],
    }));
    if (active) rows = rows.filter((s) => s.teamId === active);
    // The whole field, in order at that point of the season. It used to stop
    // after the top eight, which quietly cut the bottom half of a fourteen-team
    // tier: those lines are drawn, their dots light up on the guide line, and
    // then the reading for them was missing. A long list gets tighter line
    // spacing instead, so it still fits beside the graph.
    else rows = rows.sort((a, b) => b.cum - a.cum);
    tip = { idx, label, rows, left: Math.min(Math.max(hover.x, 96), hover.w - 96) };
  }

  return (
    <div className="reveal-chart card p-5 sm:p-6">
      {(eyebrow || title) && (
        <div className="-mx-5 -mt-5 mb-5 border-b border-border px-5 py-4 sm:-mx-6 sm:-mt-6 sm:px-6">
          {eyebrow && <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow">{eyebrow}</div>}
          {title && (
            <h2 className="mt-0.5 font-display text-lg font-extrabold uppercase leading-tight tracking-tight text-dark sm:text-xl">{title}</h2>
          )}
        </div>
      )}
      <div ref={boxRef} className="relative">
        {/* Deliberately no touch-action override: the chart is hover-only (mouse
            handlers), so switching off touch gestures only trapped the finger and
            stopped the page scrolling wherever the chart sat on screen. */}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full select-none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* horizontal grid + y labels */}
          {gridVals.map((v, i) => (
            <g key={i}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yFor(v)}
                y2={yFor(v)}
                stroke="var(--c-border)"
                strokeWidth="1"
                strokeDasharray={i === 0 ? "0" : "3 4"}
              />
              <text x={padL - 9} y={yFor(v) + 4} textAnchor="end" {...AXIS}>
                {Math.round(v)}
              </text>
            </g>
          ))}

          {/* x labels */}
          {completed.map((n, idx) =>
            (N - 1 - idx) % labelEvery === 0 ? (
              <text key={n} x={xFor(idx + 1)} y={H - padB + 20} textAnchor="middle" {...AXIS}>
                R{n}
              </text>
            ) : null
          )}

          {/* hover round guide */}
          {hover && (
            <line
              x1={xFor(hover.idx)}
              x2={xFor(hover.idx)}
              y1={padT}
              y2={padT + plotH}
              stroke="var(--c-text3)"
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.5"
            />
          )}

          {/* one line per team */}
          {series.map((s, i) => {
            const isLeader = i === 0;
            const dim = active && active !== s.teamId;
            const on = active === s.teamId;
            const d = s.pts
              .map((v, j) => `${j ? "L" : "M"}${xFor(j).toFixed(1)},${yFor(v).toFixed(1)}`)
              .join(" ");
            return (
              <path
                key={s.teamId}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={on ? 4 : resting ? 1.75 : isLeader ? 3 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={dim ? dimOpacity : on ? 1 : isLeader ? 1 : 0.85}
                pathLength={1}
                className="chart-line"
                style={{ animationDelay: `${i * 0.07}s`, transition: "opacity var(--t-base), stroke-width var(--t-base)" }}
              >
                <title>{`${s.name} · ${s.total} pts`}</title>
              </path>
            );
          })}

          {/* end markers + hover dots */}
          {series.map((s, i) => {
            const dim = active && active !== s.teamId;
            return (
              <circle
                key={s.teamId}
                cx={xFor(N)}
                cy={yFor(s.pts[N])}
                r={active === s.teamId ? 5 : 2.8}
                fill={s.color}
                opacity={dim ? dimOpacity : 1}
                style={{ transition: "opacity var(--t-base), r var(--t-base)" }}
              />
            );
          })}
          {hover &&
            (active ? series.filter((s) => s.teamId === active) : series).map((s) => (
              <circle
                key={s.teamId}
                cx={xFor(hover.idx)}
                cy={yFor(s.pts[hover.idx])}
                r="3.6"
                fill={s.color}
                stroke="var(--c-card)"
                strokeWidth="1.6"
              />
            ))}

          {/* the followed team's name and total at the end of its line */}
          {activeSeries && !hover && (
            <text
              x={xFor(N) - 6}
              y={Math.max(padT + 4, yFor(activeSeries.pts[N]) - 12)}
              textAnchor="end"
              fill="var(--c-text)"
              stroke="var(--c-card)"
              strokeWidth="4"
              paintOrder="stroke"
              strokeLinejoin="round"
              className="font-display"
              style={{ fontSize: compact ? 13 : 15, fontWeight: 800, textTransform: "uppercase", letterSpacing: "-0.01em" }}
            >
              {activeSeries.name} {activeSeries.total}
            </text>
          )}

          {/* mouse capture overlay */}
          <rect
            x={padL}
            y={padT}
            width={plotW}
            height={plotH}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: "crosshair" }}
          />
        </svg>

        {/* Hover tooltip. Two elements on purpose: the outer one places the box
            (centred on the round's guide line, kept clear of both edges), the
            inner one plays the entrance. They used to be one, and the entrance
            won — it ends on `transform: none`, which threw away the centring
            for good, so the box hung its full width to the RIGHT of the guide
            line and out over the edge of the card. */}
        {tip && (
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2"
            style={{ left: tip.left }}
          >
          <div className="pop-in rounded-lg border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
            <div className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
              {tip.label}
            </div>
            <div className={tip.rows.length > 9 ? "space-y-0.5" : "space-y-1"}>
              {tip.rows.map((r) => (
                <div key={r.teamId} className="flex items-center gap-2 whitespace-nowrap">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: r.color }} />
                  <span className="mr-2 font-display text-xs font-bold uppercase tracking-tight text-dark">
                    {r.name}
                  </span>
                  <span className="ml-auto font-mono text-xs font-bold tabular-nums text-dark">{r.cum}</span>
                  <span className="font-mono text-[10px] tabular-nums text-light">
                    {r.race > 0 ? `+${r.race}` : "·"}
                  </span>
                </div>
              ))}
            </div>
          </div>
          </div>
        )}
      </div>

      {/* legend — hover to highlight, click to pin */}
      <div className="mt-4 flex flex-wrap gap-x-2 gap-y-1.5 border-t border-border pt-4">
        {series.map((s) => {
          const on = active === s.teamId;
          const dim = active && !on && !resting;
          return (
            <button
              key={s.teamId}
              type="button"
              onMouseEnter={() => setFocus(s.teamId)}
              onMouseLeave={() => setFocus(null)}
              onClick={() => setPinned((p) => (p === s.teamId ? null : s.teamId))}
              className={`flex items-center gap-2 rounded-md px-2 py-1 transition ${
                on ? "bg-surface2 ring-1 ring-border" : "hover:bg-surface2"
              } ${dim ? "opacity-40" : ""}`}
            >
              <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: s.color }} />
              <span className={`font-display text-[13px] uppercase tracking-tight ${resting && !on ? "font-semibold text-medium" : "font-bold text-dark"}`}>
                {s.name}
              </span>
              <span className={`font-mono text-xs ${resting && on ? "font-bold text-dark" : "text-light"}`}>{s.total}</span>
            </button>
          );
        })}
      </div>

      {note ?? (
      <p className="mt-3 text-xs text-light">
        Cumulative championship points after each round
        {dropMode === "teamRounds" && teamDropWorst > 0 ? (
          <>
            ; each team&rsquo;s {teamDropWorst} lowest round total{teamDropWorst === 1 ? " doesn't" : "s don't"} count
            {allRounds.length > teamDropWorst && <> (best&nbsp;{allRounds.length - teamDropWorst} of&nbsp;{allRounds.length})</>}
          </>
        ) : dropMode === "team" && teamDropWorst > 0 ? (
          <>
            ; each team&rsquo;s {teamDropWorst} lowest single-driver round score{teamDropWorst === 1 ? " doesn't" : "s don't"} count
          </>
        ) : dropMode === "official" && dropWorst > 0 ? (
          <>
            ; each team&rsquo;s {dropWorst} lowest round{dropWorst === 1 ? " is" : "s are"} dropped
            {allRounds.length > dropWorst && <> (best&nbsp;{allRounds.length - dropWorst} of&nbsp;{allRounds.length})</>}
          </>
        ) : dropWorst > 0 ? (
          <>
            ; each driver&rsquo;s {dropWorst} lowest round{dropWorst === 1 ? " doesn't" : "s don't"} count for their team
          </>
        ) : null}
        , so the line ends on the same total as the standings table.
      </p>
      )}
    </div>
  );
}
