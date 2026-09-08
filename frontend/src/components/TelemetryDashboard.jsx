import { useEffect, useRef, useState } from "react";
import { THROTTLE_COLOR, BRAKE_COLOR } from "./TelemetryCharts.jsx";
import { deltaTrend, formatLapTime } from "../utils/telemetryAnalysis.js";

// A signed reading turned into "A", "B" or nothing, without the flicker.
// Recorded laps are noisy, and a value that hovers around a single threshold
// flips sides several times a second during playback. So: it takes `enter`
// to claim a side and only `exit` to keep it (hysteresis), and any change has
// to hold for `holdMs` before it is shown. Re-renders itself when a pending
// change comes due, so a paused readout settles too.
function useSteadySide(value, enter, exit, holdMs = 400) {
  const ref = useRef({ shown: null, pending: null, since: 0 });
  const [, tick] = useState(0);
  const s = ref.current;
  const abs = Math.abs(value);
  const candidate = abs >= enter ? (value > 0 ? "A" : "B") : abs < exit ? null : s.shown;
  const now = performance.now();
  if (candidate !== s.pending) { s.pending = candidate; s.since = now; }
  if (s.pending !== s.shown && now - s.since >= holdMs) s.shown = s.pending;
  useEffect(() => {
    if (s.pending === s.shown) return undefined;
    const t = setTimeout(() => tick((v) => v + 1), holdMs - (performance.now() - s.since) + 10);
    return () => clearTimeout(t);
  });
  return s.shown;
}

// ---------------------------------------------------------------------------
// What each car was doing at the cursor, one column per lap, in the same
// hairline-ruled form the lap summaries above it use. Scrub or play and every
// number moves; the steering wheel turns with the recorded angle. Below the
// columns, the gap at that exact point, and the friction circle when the lap
// recorded positions.
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const gearLabel = (g) => (g === 0 ? "N" : g < 0 ? "R" : String(Math.round(g)));

function Wheel({ angle, color, className = "h-6 w-6" }) {
  return (
    <svg viewBox="-24 -24 48 48" className={`${className} shrink-0`} style={{ transform: `rotate(${clamp(angle, -720, 720)}deg)`, transition: "transform 90ms linear" }} aria-hidden="true">
      <circle r="19" fill="none" stroke={color} strokeWidth="5" />
      <path d="M-17,0 H-5 M5,0 H17 M0,5 V16" stroke={color} strokeWidth="4.5" strokeLinecap="round" />
      <circle r="5" fill={color} />
    </svg>
  );
}

function Meter({ value, color }) {
  return (
    <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-surface2" aria-hidden="true">
      <span className="block h-full transition-[width] duration-75" style={{ width: `${clamp(value || 0, 0, 100)}%`, background: color }} />
    </span>
  );
}

function Row({ label, value, children }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-[4.5rem] shrink-0 text-light">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-2">
        <span className="w-14 shrink-0 font-mono tabular-nums text-dark">{value}</span>
        {children}
      </dd>
    </div>
  );
}

function Column({ lap, i, color, side, g }) {
  const steer = (lap.steer[i] ?? 0) / 10;
  const long = g?.long?.[i] ?? 0;
  return (
    <div className="min-w-0 border-l-2 pl-3" style={{ borderColor: color }}>
      <div className="flex items-center gap-2 text-xs font-semibold">
        <span className="font-mono" style={{ color }}>{side}</span>
        <span className="truncate text-dark">{lap.name}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-3xl font-bold tabular-nums text-dark">{Math.round(lap.speed[i] ?? 0)}</span>
        <span className="text-xs text-light">km/h</span>
        <span className="ml-auto font-mono text-sm tabular-nums text-dark">gear {gearLabel(lap.gear[i] ?? 0)}</span>
      </div>
      <dl className="mt-2 space-y-1.5 text-xs">
        <Row label="Throttle" value={`${Math.round(lap.gas[i] ?? 0)}%`}><Meter value={lap.gas[i]} color={THROTTLE_COLOR} /></Row>
        <Row label="Brake" value={`${Math.round(lap.brake[i] ?? 0)}%`}><Meter value={lap.brake[i]} color={BRAKE_COLOR} /></Row>
      </dl>
      {/* The wheel takes the room to the right of the remaining rows, big
          enough to read the angle off it rather than the number. */}
      <div className="mt-1.5 flex items-center gap-3">
        <dl className="min-w-0 flex-1 space-y-1.5 text-xs">
          <Row label="Steering" value={`${steer > 0 ? "+" : ""}${steer.toFixed(0)}°`} />
          {g && <Row label="Lateral" value={g.lat ? `${Math.abs(g.lat[i]).toFixed(1)} g` : "—"} />}
          {g && <Row label="Long." value={`${long >= 0 ? "+" : "−"}${Math.abs(long).toFixed(1)} g`} />}
          <Row label="Elapsed" value={formatLapTime(lap.t[i])} />
        </dl>
        <Wheel angle={steer} color={color} className="h-20 w-20" />
      </div>
    </div>
  );
}

// Lateral g across, longitudinal g up (accelerating) and down (braking). The
// dot is where the tyre's grip is being spent right now; the fading tail is
// the last second or so of lap A.
function FrictionCircle({ gA, gB, iA, iB, colorA, colorB }) {
  const R = 50, MAX = 4.5;
  const s = (g) => (clamp(g || 0, -MAX, MAX) / MAX) * R;
  const trail = [];
  for (let k = 13; k >= 1; k--) if (iA - k >= 0) trail.push(iA - k);
  const at = (g, i) => ({ x: g.lat ? s(g.lat[i]) : 0, y: -s(g.long[i]) });
  const a = at(gA, iA);
  const b = gB ? at(gB, iB) : null;
  return (
    <svg viewBox="-60 -60 120 120" className="h-32 w-32 shrink-0 sm:h-52 sm:w-52 lg:h-60 lg:w-60" aria-label="Friction circle: lateral g across, accelerating up, braking down">
      {[1, 2, 3, 4].map((g) => <circle key={g} r={s(g)} fill="none" stroke="var(--c-border)" strokeWidth="0.8" />)}
      <line x1={-R} x2={R} y1="0" y2="0" stroke="var(--c-border)" strokeWidth="0.8" />
      <line x1="0" x2="0" y1={-R} y2={R} stroke="var(--c-border)" strokeWidth="0.8" />
      <text x={s(2) + 1} y="-2" fontSize="6" fill="var(--c-text3)">2g</text>
      <text x={s(4) + 1} y="-2" fontSize="6" fill="var(--c-text3)">4g</text>
      <text x="0" y={-R - 4} fontSize="5.5" textAnchor="middle" fill="var(--c-text3)">accel</text>
      <text x="0" y={R + 8} fontSize="5.5" textAnchor="middle" fill="var(--c-text3)">brake</text>
      {trail.map((i, k) => { const p = at(gA, i); return <circle key={i} cx={p.x} cy={p.y} r="1.6" fill={colorA} opacity={((k + 1) / trail.length) * 0.55} />; })}
      {b && <circle cx={b.x} cy={b.y} r="3.4" fill="var(--c-card)" stroke={colorB} strokeWidth="2" />}
      <circle cx={a.x} cy={a.y} r="3.8" fill={colorA} stroke="var(--c-card)" strokeWidth="1.5" />
    </svg>
  );
}

export default function TelemetryDashboard({ lapA, lapB, at, atB, colorA, colorB, gA, gB, dist, n, section }) {
  const iA = clamp(Math.round(at), 0, n - 1);
  const iB = lapB ? clamp(Math.round(atB ?? at), 0, n - 1) : null;
  const gap = lapB ? (lapB.t[iA] - lapA.t[iA]) / 1000 : null; // + = A ahead
  // Trend over the last ~40 slices (a couple of hundred metres): + = A gaining.
  const trend = lapB ? deltaTrend(lapA, lapB, iA, 40) : 0;
  const gaining = useSteadySide(trend, 12, 5, 500);
  const leader = useSteadySide((gap ?? 0) * 1000, 10, 4, 300);
  const circle = gA?.lat ? <FrictionCircle gA={gA} gB={lapB ? gB : null} iA={iA} iB={iB} colorA={colorA} colorB={colorB} /> : null;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <h3 className="font-semibold text-dark">At cursor</h3>
        <span className="font-mono tabular-nums text-light">{((iA / (n - 1)) * 100).toFixed(1)}% of lap{dist ? ` · ${Math.round(dist[iA]).toLocaleString("en-GB")} m` : ""}{section ? ` · section ${section}` : ""}</span>
      </div>
      <div className={`mb-3 mt-3 grid gap-x-5 gap-y-4 ${lapB ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
        <Column lap={lapA} i={iA} color={colorA} side="A" g={gA} />
        {lapB && <Column lap={lapB} i={iB} color={colorB} side="B" g={gB} />}
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-border pt-3 sm:items-start">
        {lapB ? (
          <p className="text-xs text-light">
            <span className="block whitespace-nowrap">Gap <span className="font-mono text-base font-semibold tabular-nums" style={{ color: leader === "A" ? colorA : leader === "B" ? colorB : "var(--c-text)" }}>{Math.abs(gap).toFixed(3)} s</span></span>
            <span className="block whitespace-nowrap">{leader ? `${leader} ahead` : "level"}{gaining ? ` · ${gaining} gaining` : ""}</span>
          </p>
        ) : <p className="text-xs text-light">Choose lap B to see the gap at this point.</p>}
        {circle}
      </div>
    </div>
  );
}
