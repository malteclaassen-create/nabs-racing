import { useEffect, useMemo, useRef, useState } from "react";

// Colours for lines without a team colour of their own.
const PALETTE = ["#38bdf8", "#f97316", "#a3e635", "#e879f9", "#facc15", "#f87171", "#2dd4bf", "#818cf8", "#fb7185", "#4ade80"];

// A small SVG line chart: one line per entry over the rounds, a crosshair
// with the values on hover or tap, and a legend that switches lines on and
// off. `invert` puts the lowest value on top (for finishing positions).
//
//   labels  ["R1", "R2", ...]
//   lines   [{ id, label, color?, values: [number|null, ...], dashed? }]
export default function LineChart({ labels, lines, invert = false, height = 260, valueLabel = (v) => v, initialVisible = 6 }) {
  const [hidden, setHidden] = useState(() => new Set(lines.slice(initialVisible).map((l) => l.id)));
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const wrap = useRef(null);
  // drawn at the width it is shown at, so the labels stay readable on a phone
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Two lines in the same team colour: the second one is drawn dashed.
  const styled = useMemo(() => {
    const seen = new Map();
    return lines.map((l, i) => {
      const color = l.color || PALETTE[i % PALETTE.length];
      const n = seen.get(color) || 0;
      seen.set(color, n + 1);
      return { ...l, color, dashed: l.dashed ?? n > 0 };
    });
  }, [lines]);

  const shown = styled.filter((l) => !hidden.has(l.id));
  const values = shown.flatMap((l) => l.values.filter((v) => v != null));
  const lo = invert ? 1 : Math.min(0, ...values);
  const hi = Math.max(invert ? 2 : 1, ...values);

  // a fixed height, or one that follows the width (`height(width)`)
  const H = typeof height === "function" ? height(W) : height;
  const pad = { l: 36, r: 12, t: 12, b: 26 };
  const x = (i) => pad.l + (labels.length <= 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (labels.length - 1));
  const y = (v) => {
    const t = (v - lo) / (hi - lo || 1);
    return invert ? pad.t + t * (H - pad.t - pad.b) : H - pad.b - t * (H - pad.t - pad.b);
  };
  const ticks = niceTicks(lo, hi, invert);

  function onMove(e) {
    const rect = box.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < labels.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  }

  if (!labels.length) return null;
  const hoverRows =
    hover == null
      ? []
      : shown
          .map((l) => ({ ...l, v: l.values[hover] }))
          .filter((l) => l.v != null)
          .sort((a, b) => (invert ? a.v - b.v : b.v - a.v));

  return (
    <div ref={wrap}>
      <div className="relative">
        <svg
          ref={box}
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full touch-none select-none"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label="Chart"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} style={{ stroke: "rgb(var(--line))" }} strokeWidth="1" />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" style={{ fill: "rgb(var(--muted))" }}>
                {t}
              </text>
            </g>
          ))}
          {labels.map((label, i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" style={{ fill: "rgb(var(--muted))" }}>
              {label}
            </text>
          ))}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} style={{ stroke: "rgb(var(--ink) / 0.35)" }} strokeDasharray="3 3" />}
          {shown.map((l) => {
            const pts = l.values.map((v, i) => (v == null ? null : [x(i), y(v)]));
            const segs = [];
            let cur = [];
            for (const p of pts) {
              if (p) cur.push(p);
              else if (cur.length) {
                segs.push(cur);
                cur = [];
              }
            }
            if (cur.length) segs.push(cur);
            return (
              <g key={l.id}>
                {segs.map((seg, i) => (
                  <polyline
                    key={i}
                    points={seg.map((p) => p.join(",")).join(" ")}
                    fill="none"
                    style={{ stroke: l.color }}
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={l.dashed ? "6 5" : undefined}
                    // solid lines draw themselves in, dashed ones fade in
                    pathLength={l.dashed ? undefined : 1}
                    className={l.dashed ? "fade-in" : "draw"}
                  />
                ))}
                {pts.map(
                  (p, i) =>
                    p && <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 4.5 : 2.5} className="fade-in" style={{ fill: l.color, transition: "r 0.15s" }} />,
                )}
              </g>
            );
          })}
        </svg>
        {hover != null && hoverRows.length > 0 && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-lg border border-line bg-bg/95 px-3 py-2 text-xs shadow-xl"
            style={x(hover) > W / 2 ? { left: 8 } : { right: 8 }}
          >
            <div className="mb-1 font-bold text-muted">{labels[hover]}</div>
            {hoverRows.slice(0, 10).map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 truncate">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: l.color }} />
                  {l.label}
                </span>
                <b className="tabular">{valueLabel(l.v)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      {styled.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {styled.map((l) => {
            const off = hidden.has(l.id);
            return (
              <button
                key={l.id}
                onClick={() =>
                  setHidden((h) => {
                    const next = new Set(h);
                    if (off) next.delete(l.id);
                    else next.add(l.id);
                    return next;
                  })
                }
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${off ? "border-line text-muted/60" : "border-line text-ink"}`}
                aria-pressed={!off}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: off ? "rgb(var(--line))" : l.color }} />
                {l.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function niceTicks(lo, hi, invert) {
  if (invert) {
    const step = hi <= 6 ? 1 : hi <= 12 ? 2 : 5;
    const out = [1];
    for (let v = step === 1 ? 2 : step; v <= hi; v += step) out.push(v);
    return out;
  }
  const span = hi - lo || 1;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
