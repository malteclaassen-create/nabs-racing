import { useRef, useState } from "react";

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
export default function PointsChart({ standings = [], completed = [], allRounds = [], dropWorst = 3, dropMode = "driver", teamDropWorst = null }) {
  const [focus, setFocus] = useState(null); // hovered team
  const [pinned, setPinned] = useState(null); // clicked team
  const [hover, setHover] = useState(null); // { idx, x, w }
  const svgRef = useRef(null);

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

  const W = 820, H = 360, padL = 46, padR = 16, padT = 20, padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xFor = (i) => padL + (i / N) * plotW;
  const yFor = (v) => padT + plotH - (v / maxY) * plotH;

  const gridVals = [];
  for (let v = 0; v <= maxY + 1e-6; v += step) gridVals.push(v);

  const active = pinned ?? focus;
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
    else rows = rows.sort((a, b) => b.cum - a.cum).slice(0, 8);
    tip = { idx, label, rows, left: Math.min(Math.max(hover.x, 96), hover.w - 96) };
  }

  return (
    <div className="reveal-chart card p-5 sm:p-6">
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none select-none"
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
          {completed.map((n, idx) => (
            <text key={n} x={xFor(idx + 1)} y={H - padB + 20} textAnchor="middle" {...AXIS}>
              R{n}
            </text>
          ))}

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
                strokeWidth={on ? 4 : isLeader ? 3 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={dim ? 0.12 : on ? 1 : isLeader ? 1 : 0.85}
                pathLength={1}
                className="chart-line"
                style={{ animationDelay: `${i * 0.07}s`, transition: "opacity .2s, stroke-width .2s" }}
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
                r={active === s.teamId ? 4 : 2.8}
                fill={s.color}
                opacity={dim ? 0.12 : 1}
                style={{ transition: "opacity .2s, r .2s" }}
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

        {/* hover tooltip */}
        {tip && (
          <div
            className="pop-in pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur"
            style={{ left: tip.left }}
          >
            <div className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
              {tip.label}
            </div>
            <div className="space-y-1">
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
        )}
      </div>

      {/* legend — hover to highlight, click to pin */}
      <div className="mt-4 flex flex-wrap gap-x-2 gap-y-1.5 border-t border-border pt-4">
        {series.map((s) => {
          const on = active === s.teamId;
          const dim = active && !on;
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
              <span className="font-display text-[13px] font-bold uppercase tracking-tight text-dark">
                {s.name}
              </span>
              <span className="font-mono text-xs text-light">{s.total}</span>
            </button>
          );
        })}
      </div>

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
    </div>
  );
}
