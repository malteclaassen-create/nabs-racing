import { useMemo } from "react";
import TeamLogo from "./TeamLogo.jsx";
import { THROTTLE_COLOR, BRAKE_COLOR } from "./TelemetryCharts.jsx";
import { deltaTrend, formatLapTime } from "../utils/telemetryAnalysis.js";

// ---------------------------------------------------------------------------
// The live readout: what each car was doing at the cursor, drawn the way a
// broadcast graphic draws it — a speed you can read from across the room, the
// gear in a box, two pedal bars, a steering wheel that actually turns — plus
// the gap between the two at that exact point and a friction circle. Scrub or
// play and all of it moves.
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function Wheel({ angle, color }) {
  return (
    <svg viewBox="-24 -24 48 48" className="h-12 w-12" style={{ transform: `rotate(${clamp(angle, -720, 720)}deg)`, transition: "transform 90ms linear" }} aria-hidden="true">
      <circle r="20" fill="none" stroke={color} strokeWidth="4.5" />
      <path d="M-18,0 H-6 M6,0 H18 M0,6 V17" stroke={color} strokeWidth="4" strokeLinecap="round" />
      <circle r="6" fill={color} />
      <circle cy="-20" r="2.6" fill="var(--c-card)" stroke={color} strokeWidth="1" />
    </svg>
  );
}

function PedalBar({ value, color, label }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-20 w-3.5 overflow-hidden rounded-sm bg-surface2 ring-1 ring-border" aria-hidden="true">
        <div className="absolute inset-x-0 bottom-0 transition-[height] duration-75" style={{ height: `${clamp(value || 0, 0, 100)}%`, background: color }} />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-light">{Math.round(value || 0)}</span>
      <span className="text-[9px] uppercase tracking-wide text-light">{label}</span>
    </div>
  );
}

const gearLabel = (g) => (g === 0 ? "N" : g < 0 ? "R" : String(Math.round(g)));

function LapDash({ lap, index, color, side, g }) {
  const i = clamp(Math.round(index), 0, lap.n - 1);
  const peak = useMemo(() => Math.round(Math.max(...lap.speed)), [lap]);
  const steer = (lap.steer[i] ?? 0) / 10;
  return (
    <div className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-border bg-surface2/30 p-3" style={{ borderTopColor: color, borderTopWidth: 3 }} aria-label={`Lap ${side} at cursor`}>
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span className="font-mono font-bold" style={{ color }}>{side}</span>
        <span className="truncate font-semibold text-dark">{lap.name}</span>
        {lap.team && <span className="ml-auto shrink-0"><TeamLogo id={lap.team.id} name={lap.team.name} color={color} logoUrl={lap.team.logoUrl} size={18} /></span>}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <div className="font-display text-4xl font-extrabold leading-none tabular-nums text-dark">{Math.round(lap.speed[i] ?? 0)}</div>
          <div className="mt-1 text-[10px] uppercase tracking-wide text-light">km/h</div>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border-2 font-display text-2xl font-extrabold tabular-nums text-dark" style={{ borderColor: color }} aria-label={`Gear ${gearLabel(lap.gear[i])}`}>
          {gearLabel(lap.gear[i] ?? 0)}
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="flex gap-3">
          <PedalBar value={lap.gas[i]} color={THROTTLE_COLOR} label="thr" />
          <PedalBar value={lap.brake[i]} color={BRAKE_COLOR} label="brk" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <Wheel angle={steer} color={color} />
          <span className="font-mono text-[10px] tabular-nums text-light">{steer > 0 ? "+" : ""}{steer.toFixed(0)}°</span>
        </div>
        {g && (
          <div className="text-right font-mono text-[10px] leading-5 tabular-nums text-light">
            <div>lat <span className="text-dark">{g.lat ? Math.abs(g.lat[i]).toFixed(1) : "—"}</span> g</div>
            <div>{g.long[i] < -0.05 ? "brk" : "acc"} <span className="text-dark">{Math.abs(g.long[i]).toFixed(1)}</span> g</div>
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-between border-t border-border pt-2 font-mono text-[11px] tabular-nums text-light">
        <span>{formatLapTime(lap.t[i])}</span>
        <span>peak {peak} km/h</span>
      </div>
    </div>
  );
}

function DeltaBox({ lapA, lapB, at, colorA, colorB, dist, n }) {
  const gap = (lapB.t[at] - lapA.t[at]) / 1000; // + = A ahead
  const trend = deltaTrend(lapA, lapB, at, 20);
  const leader = gap > 0.0005 ? "A" : gap < -0.0005 ? "B" : null;
  const tone = leader === "A" ? colorA : leader === "B" ? colorB : "var(--c-text)";
  return (
    <div className="flex min-w-[9rem] flex-1 flex-col items-center justify-center rounded-xl border border-border px-4 py-3 text-center">
      <span className="text-[10px] uppercase tracking-wide text-light">Gap here</span>
      <span className="font-display text-3xl font-extrabold leading-tight tabular-nums" style={{ color: tone }}>{Math.abs(gap).toFixed(3)}<span className="text-sm font-bold"> s</span></span>
      <span className="text-xs font-semibold" style={{ color: tone }}>{leader ? `${leader} ahead` : "level"}</span>
      <span className="mt-2 text-[11px]">
        {Math.abs(trend) < 4
          ? <span className="text-light">holding</span>
          : <span className="font-semibold" style={{ color: trend > 0 ? colorA : colorB }}>{trend > 0 ? "A" : "B"} gaining ▲</span>}
      </span>
      <span className="mt-2 font-mono text-[10px] tabular-nums text-light">{((at / (n - 1)) * 100).toFixed(1)}%{dist ? ` · ${Math.round(dist[at]).toLocaleString("en-GB")} m` : ""}</span>
    </div>
  );
}

// Lateral g across, longitudinal g up (accelerating) and down (braking): the
// friction circle. The dot is where the tyre's grip is being spent right now;
// the fading tail is the last second or so of lap A.
function FrictionCircle({ gA, gB, iA, iB, colorA, colorB }) {
  const R = 50, MAX = 4.5;
  const s = (g) => (clamp(g || 0, -MAX, MAX) / MAX) * R;
  const trail = [];
  for (let k = 13; k >= 1; k--) if (iA - k >= 0) trail.push(iA - k);
  const at = (g, i) => ({ x: g.lat ? s(g.lat[i]) : 0, y: -s(g.long[i]) });
  const a = at(gA, iA);
  const b = gB ? at(gB, iB) : null;
  return (
    <svg viewBox="-60 -60 120 120" className="h-full max-h-64 w-full" aria-label="Friction circle: lateral and longitudinal g">
      {[1, 2, 3, 4].map((g) => <circle key={g} r={s(g)} fill="none" stroke="var(--c-border)" strokeWidth="0.8" />)}
      <line x1={-R} x2={R} y1="0" y2="0" stroke="var(--c-border)" strokeWidth="0.8" />
      <line x1="0" x2="0" y1={-R} y2={R} stroke="var(--c-border)" strokeWidth="0.8" />
      <text x={R + 2} y="3" fontSize="6.5" fill="var(--c-text3)" textAnchor="start">lat</text>
      <text x="0" y={-R - 3} fontSize="6.5" fill="var(--c-text3)" textAnchor="middle">acc</text>
      <text x="0" y={R + 8} fontSize="6.5" fill="var(--c-text3)" textAnchor="middle">brk</text>
      {[1, 2, 3, 4].map((g) => <text key={g} x={s(g) + 1} y="-1.5" fontSize="5" fill="var(--c-text3)">{g}g</text>)}
      {trail.map((i, k) => { const p = at(gA, i); return <circle key={i} cx={p.x} cy={p.y} r="1.6" fill={colorA} opacity={((k + 1) / trail.length) * 0.55} />; })}
      {b && <circle cx={b.x} cy={b.y} r="3.6" fill="var(--c-card)" stroke={colorB} strokeWidth="2" />}
      <circle cx={a.x} cy={a.y} r="4" fill={colorA} stroke="var(--c-card)" strokeWidth="1.5" />
    </svg>
  );
}

export default function TelemetryDashboard({ lapA, lapB, at, atB, colorA, colorB, gA, gB, dist, n }) {
  const iA = clamp(Math.round(at), 0, n - 1);
  const iB = lapB ? clamp(Math.round(atB ?? at), 0, n - 1) : null;
  const circle = gA?.lat && (
    <div className="flex min-h-[10rem] flex-1 items-center justify-center rounded-xl border border-border p-2" title="Friction circle: lateral g across, accelerating up, braking down">
      <FrictionCircle gA={gA} gB={lapB ? gB : null} iA={iA} iB={iB} colorA={colorA} colorB={colorB} />
    </div>
  );
  return (
    <div className="grid h-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <LapDash lap={lapA} index={iA} color={colorA} side="A" g={gA} />
      {lapB ? (
        <>
          <div className="order-3 col-span-2 flex flex-wrap items-stretch justify-center gap-3 sm:order-2 sm:col-span-1 sm:w-48 sm:flex-col sm:justify-start">
            <DeltaBox lapA={lapA} lapB={lapB} at={iA} colorA={colorA} colorB={colorB} dist={dist} n={n} />
            {circle}
          </div>
          <div className="order-2 min-w-0 sm:order-3"><LapDash lap={lapB} index={iB} color={colorB} side="B" g={gB} /></div>
        </>
      ) : (
        <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row">
          {circle || <div className="flex-1 rounded-xl border border-dashed border-border p-3 text-xs text-light">Choose lap B to see the gap here, who is gaining, and both cars on the friction circle.</div>}
        </div>
      )}
    </div>
  );
}
