import { useEffect, useRef, useState } from "react";
import { readableAccent } from "./ui.jsx";
import { cumulativeTotals } from "../utils/cumulativePoints.js";

// Red for "behind" on the dark ink surface. Fixed, not the theme's `bad`: the
// ink card is dark in both themes, and light mode's deep red disappears on it.
const BEHIND = "#f87171";

// Signed points, with a real minus sign.
const signed = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "0");

// Tick step that keeps the scale at two steps either side of the zero line.
function stepFor(maxAbs) {
  return [5, 10, 20, 25, 50, 100, 200, 250, 500].find((s) => s * 2 >= maxAbs) || Math.ceil(maxAbs / 2000) * 1000;
}

// "Margin at the top": after every round, how far this team was ahead of the
// rest of its tier (above the line) or behind whoever was P1 (below it). The
// cumulative totals are the championship ones, so each round adds what it
// counts after drops, the same way the standings and the points chart do it.
// A dark card in both themes, on the ink surface.
export default function TeamMarginChart({ team, standings, completed }) {
  const boxRef = useRef(null);
  const [boxW, setBoxW] = useState(() => (typeof window !== "undefined" && window.innerWidth < 640 ? window.innerWidth - 72 : null));
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setBoxW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const N = completed.length;
  const cum = cumulativeTotals(standings, completed);
  const mine = cum.get(team.id) || Array(N + 1).fill(0);
  const margins = mine.map((v, i) => {
    let best = -Infinity;
    for (const [id, pts] of cum) if (id !== team.id) best = Math.max(best, pts[i]);
    return best === -Infinity ? 0 : v - best;
  });
  const now = margins[N];
  const leadingNow = now > 0;

  const line = readableAccent(team.color, { dark: true });
  const maxAbs = Math.max(1, ...margins.map(Math.abs));
  const step = stepFor(maxAbs);
  const maxY = step * 2;

  const compact = boxW != null && boxW < 560;
  const W = boxW != null ? Math.max(260, boxW) : 820;
  const H = compact ? 240 : 300;
  // Right padding leaves room for half of the last round's label.
  const padL = compact ? 36 : 44, padR = compact ? 16 : 22, padT = 22, padB = compact ? 26 : 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xFor = (i) => padL + (N ? (i / N) * plotW : 0);
  const yFor = (v) => padT + plotH / 2 - (v / maxY) * (plotH / 2);
  const zeroY = yFor(0);
  const fs = compact ? 9 : 11;
  const labelEvery = compact && N > 8 ? 2 : 1;
  const pts = margins.map((m, i) => `${xFor(i).toFixed(1)},${yFor(m).toFixed(1)}`).join(" ");
  const area = `${xFor(0).toFixed(1)},${zeroY.toFixed(1)} ${pts} ${xFor(N).toFixed(1)},${zeroY.toFixed(1)}`;
  const ticks = [-2, -1, 0, 1, 2].map((k) => k * step);
  const clip = `margin-${team.id}`.replace(/[^a-zA-Z0-9_-]/g, "");

  return (
    <section className="reveal rounded-2xl bg-ink p-5 text-white shadow-lift sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Margin at the top</div>
          <h2 className="font-display text-2xl font-black uppercase tracking-tight sm:text-3xl">
            {team.name} vs. {leadingNow ? "P2" : "the leader"}
          </h2>
          <p className="mt-1 max-w-lg text-sm text-white/60">
            Above the line: {team.name} leads by that many points. Below: the gap to whoever was P1.
          </p>
        </div>
        <div className="rounded-xl bg-white/10 px-4 py-2 text-right">
          <div className="font-mono text-[10px] uppercase text-white/50">Now</div>
          <div className="font-display text-3xl font-black tabular-nums" style={{ color: now < 0 ? BEHIND : now > 0 ? line : "#fff" }}>
            {signed(now)}
          </div>
        </div>
      </div>
      <div ref={boxRef} className="mt-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          fontFamily="JetBrains Mono, monospace"
          role="img"
          aria-label={`${team.name}'s margin to the top of the table after each round, now ${signed(now)} points`}
        >
          <defs>
            <clipPath id={`${clip}-above`}><rect x="0" y="0" width={W} height={zeroY} /></clipPath>
            <clipPath id={`${clip}-below`}><rect x="0" y={zeroY} width={W} height={H - zeroY} /></clipPath>
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={yFor(v)} y2={yFor(v)} stroke="rgba(255,255,255,.07)" strokeDasharray="3 4" />
              <text x={padL - 8} y={yFor(v) + 3.5} textAnchor="end" fontSize={fs} fill="rgba(255,255,255,.45)">
                {v > 0 ? `+${v}` : v}
              </text>
            </g>
          ))}
          {margins.map((_, i) =>
            i % labelEvery === 0 || i === N ? (
              <text key={i} x={xFor(i)} y={H - 8} textAnchor="middle" fontSize={fs} fill="rgba(255,255,255,.45)">
                {i === 0 ? "Start" : `R${completed[i - 1]}`}
              </text>
            ) : null
          )}
          <polygon clipPath={`url(#${clip}-above)`} points={area} fill={line} opacity=".45" />
          <polygon clipPath={`url(#${clip}-below)`} points={area} fill={BEHIND} opacity=".35" />
          <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="#fff" strokeOpacity=".5" />
          {margins.map((m, i) =>
            i === 0 ? null : (
              <text
                key={i}
                x={xFor(i)}
                y={m >= 0 ? yFor(m) - 10 : yFor(m) + 18}
                textAnchor="middle"
                fontSize={compact ? 10 : 12}
                fontWeight="700"
                fill="#fff"
              >
                {signed(m)}
              </text>
            )
          )}
          <polyline points={pts} fill="none" stroke={line} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          {margins.map((m, i) => (
            <circle key={i} cx={xFor(i)} cy={yFor(m)} r="4" fill="rgb(var(--c-ink))" stroke={line} strokeWidth="2" />
          ))}
        </svg>
      </div>
    </section>
  );
}
