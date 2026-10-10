import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { readableAccent } from "./ui.jsx";

// The championship around one driver, told as a gap: the driver is the flat
// line at zero and the four nearest rows of the table run above it (ahead on
// points) or below it (behind), round by round. Where a line crosses zero is
// where somebody went past, which parallel points lines hide.
//
// Sits on the dark ink surface in both themes, so team colours are lifted
// until they read on it (readableAccent), the same way the dark card does.
// The viewBox is measured off the card like PointsChart, so the type keeps its
// real size on a phone instead of shrinking with the drawing.

const MONO = "JetBrains Mono, monospace";

// "Nice" step for the gap axis, so the ticks land on round numbers.
function niceStep(range) {
  const raw = Math.max(1, range / 4);
  const e = Math.floor(Math.log10(raw));
  const f = raw / Math.pow(10, e);
  const nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  return nf * Math.pow(10, e);
}

const short = (name, max) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);
const signed = (v) => (v > 0 ? `+${v}` : `${v}`);

// End labels sit at the height of their line, but two lines a few points apart
// would print on top of each other: walk them apart, then back inside the box.
function spread(labels, gapPx, top, bottom) {
  const out = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < out.length; i++) out[i].y = Math.max(out[i].y, out[i - 1].y + gapPx);
  if (out.length && out[out.length - 1].y > bottom) {
    out[out.length - 1].y = bottom;
    for (let i = out.length - 2; i >= 0; i--) out[i].y = Math.min(out[i].y, out[i + 1].y - gapPx);
  }
  for (const l of out) l.y = Math.max(l.y, top);
  return out;
}

export default function RivalsGapChart({ driverId, standingsData }) {
  const boxRef = useRef(null);
  const [boxW, setBoxW] = useState(() => (typeof window !== "undefined" && window.innerWidth < 640 ? window.innerWidth - 56 : null));
  const rows = [...(standingsData?.standings || [])]
    .filter((r) => r.position != null)
    .sort((a, b) => a.position - b.position);
  const idx = rows.findIndex((r) => r.driverId === driverId);
  const raceNumbers = standingsData?.raceNumbers || [];
  const completed = raceNumbers.filter((n) => rows.some((r) => r.perRace?.[n] != null));
  const show = idx >= 0 && rows.length >= 2 && completed.length >= 2;

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setBoxW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [show]);

  if (!show) return null;

  // The same five rows the progression chart always showed: this driver and
  // the two places either side (or the nearest five at either end).
  const start = Math.max(0, Math.min(idx - 2, rows.length - 5));
  const field = rows.slice(start, start + 5);
  const me = rows[idx];

  // Championship total after each run round: a dropped round adds nothing, so
  // the line ends on the total the standings table prints.
  const cumOf = (r) => {
    const dropped = new Set(r.droppedRounds || []);
    const pts = [0];
    let cum = 0;
    for (const n of completed) {
      cum += dropped.has(n) ? 0 : r.perRace?.[n]?.points || 0;
      pts.push(cum);
    }
    return pts;
  };
  const mine = cumOf(me);
  const used = new Set([me.team?.color]);
  const rivals = field
    .filter((r) => r.driverId !== driverId)
    .map((r) => {
      const raw = r.team?.color || "#94a3b8";
      // A teammate (or two rivals of one team) shares the colour: the second
      // line goes dashed so the two can still be told apart.
      const dashed = used.has(raw);
      used.add(raw);
      const gaps = cumOf(r).map((v, i) => v - mine[i]);
      return {
        driverId: r.driverId,
        name: r.name,
        total: r.total,
        line: readableAccent(raw, { dark: true, target: 3 }),
        text: readableAccent(raw, { dark: true }),
        bar: raw,
        dashed,
        gaps,
        gap: r.total - me.total,
      };
    });
  const meColor = readableAccent(me.team?.color || "#94a3b8", { dark: true, target: 3 });

  // Rounds still ahead, for the header line.
  const toGo = raceNumbers.length - completed.length;
  const leader = idx === 0;
  const nextUp = rows[idx - 1];
  const status = leader
    ? rows[1]
      ? `Leads by ${me.total - rows[1].total}`
      : "Leads"
    : `${nextUp.total - me.total} behind ${nextUp.name}`;

  // Geometry.
  const compact = boxW != null && boxW < 560;
  const W = boxW != null ? Math.max(280, boxW) : 1000;
  const H = compact ? 260 : 320;
  const fs = compact ? 9 : 11;
  const padL = compact ? 30 : 44;
  const padT = 20;
  const padB = compact ? 24 : 30;
  const T = raceNumbers.length;
  const lastIdx = raceNumbers.indexOf(completed[completed.length - 1]) + 1;
  // Room for the end labels: the stretch of rounds still to run takes them
  // where it is wide enough, a finished season needs a margin of its own.
  const labelW = compact ? 84 : 128;
  const roughPlot = W - padL - labelW;
  const futureW = T ? ((T - lastIdx) / T) * roughPlot : 0;
  const padR = Math.max(compact ? 10 : 16, labelW - futureW);
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xAt = (k) => padL + (T ? (k / T) * plotW : 0);
  const xOfRound = (n) => xAt(raceNumbers.indexOf(n) + 1);

  const all = rivals.flatMap((r) => r.gaps);
  const lo0 = Math.min(0, ...all);
  const hi0 = Math.max(0, ...all);
  const step = niceStep(hi0 - lo0);
  // Always a band on both sides of zero, so "ahead" and "behind" both have a
  // place on the chart even when nobody is ahead yet.
  const hi = Math.max(step, Math.ceil(hi0 / step) * step);
  const lo = Math.min(-step, Math.floor(lo0 / step) * step);
  const yAt = (v) => padT + ((hi - v) / (hi - lo)) * plotH;
  const y0 = yAt(0);
  const ticks = [];
  for (let v = lo; v <= hi + 1e-6; v += step) ticks.push(v);
  const xs = [padL, ...completed.map(xOfRound)];
  const xLast = xs[xs.length - 1];
  const pathOf = (vals) => vals.map((v, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");

  const nameMax = compact ? 9 : 12;
  const labels = spread(
    [
      { key: "me", y: y0 - 6, text: `${short(me.name, nameMax).toUpperCase()} ${me.total}`, fill: "#fff", weight: 800, size: fs + 1 },
      ...rivals.map((r) => ({
        key: r.driverId,
        y: yAt(r.gaps[r.gaps.length - 1]) + 4,
        text: `${short(r.name, nameMax)} ${signed(r.gaps[r.gaps.length - 1])}`,
        fill: r.text,
        weight: 700,
        size: fs,
      })),
    ],
    fs + 4,
    padT + fs,
    padT + plotH
  );
  // Every second round label goes on a narrow card once they would touch.
  const every = compact && T > 8 ? 2 : 1;

  return (
    <div className="reveal-chart overflow-hidden rounded-2xl bg-ink text-white shadow-lift">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-6 w-1.5 shrink-0 -skew-x-12" style={{ backgroundColor: me.team?.color || "#94a3b8" }} aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-display text-lg font-extrabold uppercase tracking-tight sm:text-xl">Championship fight</h2>
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-white/55">
              Points gap to {me.name}, round by round
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider">
          {leader && <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />}
          <span>
            {status}
            {toGo > 0 && ` · ${toGo} to go`}
          </span>
        </div>
      </div>

      <div ref={boxRef} className="px-3 pb-4 pt-4 sm:px-6">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full select-none"
          fontFamily={MONO}
          role="img"
          aria-label={`Points gap to ${me.name}: ${rivals.map((r) => `${r.name} ${signed(r.gap)}`).join(", ")}`}
        >
          <rect x={padL} y={padT} width={plotW} height={Math.max(0, y0 - padT)} className="fill-red-500/[0.07]" />
          <rect x={padL} y={y0} width={plotW} height={Math.max(0, padT + plotH - y0)} className="fill-emerald-500/[0.06]" />
          {ticks.map((v) => (
            <g key={v}>
              {v !== 0 && <line x1={padL} x2={padL + plotW} y1={yAt(v)} y2={yAt(v)} className="stroke-white/[0.07]" />}
              <text x={padL - 8} y={yAt(v) + 4} textAnchor="end" fontSize={fs} className="fill-white/[0.45]">
                {signed(v)}
              </text>
            </g>
          ))}
          {raceNumbers.map((n, i) =>
            (T - 1 - i) % every === 0 ? (
              <text
                key={n}
                x={xAt(i + 1)}
                y={H - 6}
                textAnchor="middle"
                fontSize={fs}
                className={completed.includes(n) ? "fill-white/[0.45]" : "fill-white/25"}
              >
                R{n}
              </text>
            ) : null
          )}
          <text x={padL + 6} y={padT + fs + 3} fontSize={fs} fontWeight="700" className="fill-red-300">
            AHEAD OF {short(me.name, compact ? 12 : 20).toUpperCase()}
          </text>
          <text x={padL + 6} y={padT + plotH - 6} fontSize={fs} fontWeight="700" className="fill-emerald-300">
            BEHIND
          </text>

          {rivals.map((r, i) => (
            <g key={r.driverId}>
              <path
                d={pathOf(r.gaps)}
                fill="none"
                stroke={r.line}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={r.dashed ? "6 4" : undefined}
                pathLength={r.dashed ? undefined : 1}
                className={r.dashed ? undefined : "chart-line"}
                style={{ animationDelay: `${i * 0.07}s` }}
              >
                <title>{`${r.name}: ${signed(r.gap)} on ${me.name}`}</title>
              </path>
              <circle cx={xLast} cy={yAt(r.gaps[r.gaps.length - 1])} r="4" fill={r.line} />
            </g>
          ))}

          {/* The driver: the zero line itself, dashed on through the rounds
              still to run. */}
          <line x1={padL} x2={xLast} y1={y0} y2={y0} stroke={meColor} strokeWidth="4" strokeLinecap="round" />
          {xLast < padL + plotW && (
            <line x1={xLast} x2={padL + plotW} y1={y0} y2={y0} stroke={meColor} strokeWidth="2" strokeDasharray="4 5" />
          )}

          {labels.map((l) => (
            <text key={l.key} x={xLast + 8} y={l.y} fontSize={l.size} fontWeight={l.weight} fill={l.fill}>
              {l.text}
            </text>
          ))}
        </svg>
      </div>

      <div className={`grid gap-px bg-white/10 ${rivals.length === 1 ? "grid-cols-1" : rivals.length === 3 ? "grid-cols-2 sm:grid-cols-3" : rivals.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"}`}>
        {rivals.map((r, i) => (
          <Link
            key={r.driverId}
            to={`/drivers/${r.driverId}`}
            // An odd last one fills its row on a phone instead of leaving a hole.
            className={`flex min-w-0 items-center gap-3 bg-ink px-4 py-3 transition hover:bg-white/5 ${
              rivals.length === 3 && i === 2 ? "col-span-2 sm:col-span-1" : ""
            }`}
          >
            <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: r.bar }} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate font-display text-sm font-black uppercase tracking-tight">{r.name}</span>
              <span className="block font-mono text-[11px] uppercase text-white/55">
                {r.total} pts · {signed(r.gap)}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
