import { useMemo, useRef, useState } from "react";
import { telemetryIndexAt } from "../utils/telemetryWindow.js";
import TeamLogo from "./TeamLogo.jsx";

export const LAP_A_COLOR = "#0ea5e9";
export const LAP_B_COLOR = "#f43f5e";
export const lapColor = (lap, side) => /^#[\da-f]{6}$/i.test(lap?.team?.color || '') ? lap.team.color : side === 'A' ? LAP_A_COLOR : LAP_B_COLOR;
export const signedSeconds = (seconds, digits = 3) => `${seconds > 0 ? "+" : seconds < 0 ? "−" : ""}${Math.abs(seconds).toFixed(digits)} s`;

function points(values, lo, hi) {
  return values.map((v, i) => `${i},${(96 - ((v - lo) / (hi - lo || 1)) * 92).toFixed(2)}`).join(" ");
}

// Every plot uses the same track-position axis and cursor. Labels stay outside
// the pointer surface, so selecting 50% always means 50% on every channel.
export function ChannelChart({ title, unit, a, b, lo, hi, cursor, onPick, range, onSelectRange, onResetRange, colorA = LAP_A_COLOR, colorB = LAP_B_COLOR, pedal, height = 116, format = Math.round, delta = false }) {
  const paths = useMemo(() => ({ a: points(a, lo, hi), b: b ? points(b, lo, hi) : null }), [a, b, lo, hi]);
  const visible = range || [0, a.length - 1];
  const span = visible[1] - visible[0];
  const drag = useRef(null);
  const [selection, setSelection] = useState(null);
  const indexAt = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    return telemetryIndexAt((event.clientX - box.left) / box.width, visible);
  };
  const cancel = () => { drag.current = null; setSelection(null); };
  const start = (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const index = indexAt(event);
    drag.current = { index, x: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    onPick(index);
  };
  const move = (event) => {
    const index = indexAt(event);
    if (drag.current) {
      if (Math.abs(event.clientX - drag.current.x) >= 6) drag.current.moved = true;
      if (drag.current.moved) setSelection([Math.min(drag.current.index, index), Math.max(drag.current.index, index)]);
    } else if (event.pointerType !== "touch") onPick(index);
  };
  const finish = (event) => {
    const active = drag.current;
    const index = indexAt(event);
    cancel();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (active?.moved) onSelectRange?.(active.index, index);
    else if (active) onPick(index);
  };
  const ticks = [hi, (hi + lo) / 2, lo];
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <h3 className="flex items-center gap-2 font-semibold text-dark">{pedal && <span className="h-2 w-2 rounded-sm" style={{background:pedal==='gas'?'#22c55e':'#ef4444'}} />}{title} <span className="font-normal text-light">{unit}</span></h3>
        <div className="flex gap-4 font-mono text-[11px] tabular-nums">
          {delta ? <span className="text-light">{signedSeconds(a[cursor] ?? 0)}</span> : <>
            <span style={{ color: colorA }}>A {format(a[cursor] ?? 0)}{pedal && <PedalMeter value={a[cursor]} color={colorA} />}</span>
            {b && <span style={{ color: colorB }}>B {format(b[cursor] ?? 0)}{pedal && <PedalMeter value={b[cursor]} color={colorB} dashed />}</span>}
          </>}
        </div>
      </div>
      <div className="flex gap-2" style={{ height }}>
        <div className="relative w-10 shrink-0 font-mono text-[10px] tabular-nums text-light" aria-hidden="true">
          {ticks.map((v, i) => <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: `${4 + i * 46}%` }}>{delta ? signedSeconds(v, 2).replace(" s", "") : format(v)}</span>)}
        </div>
        <div className="relative min-w-0 flex-1 cursor-crosshair select-none overflow-hidden rounded border border-border bg-surface2/30"
          style={{ touchAction: 'pan-y' }}
          onPointerMove={move} onPointerDown={start} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} onDoubleClick={onResetRange}>
          {[0, 25, 50, 75, 100].map((p) => <div key={p} className="pointer-events-none absolute inset-y-0 border-l border-border opacity-50" style={{ left: `${p}%` }} />)}
          {[4, 50, 96].map((p) => <div key={p} className={`pointer-events-none absolute inset-x-0 border-t border-border ${delta && p === 50 ? "border-dashed" : "opacity-50"}`} style={{ top: `${p}%` }} />)}
          <svg viewBox={`${visible[0]} 0 ${span} 100`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            {pedal && <polygon points={`0,96 ${paths.a} ${a.length-1},96`} fill={colorA} opacity={0.11} />}
            {pedal && paths.b && <polygon points={`0,96 ${paths.b} ${a.length-1},96`} fill={colorB} opacity={0.06} />}
            <polyline points={paths.a} fill="none" stroke={delta ? "var(--c-text)" : colorA} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {paths.b && <polyline points={paths.b} fill="none" stroke={colorB} strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
          </svg>
          {selection && <div className="pointer-events-none absolute inset-y-0 border-x border-primary bg-primary/15" style={{ left: `${(selection[0] - visible[0]) / span * 100}%`, width: `${(selection[1] - selection[0]) / span * 100}%` }} />}
          {cursor >= visible[0] && cursor <= visible[1] && <div className="pointer-events-none absolute inset-y-0 border-l border-dark/60" style={{ left: `${(cursor - visible[0]) / span * 100}%` }} />}
        </div>
      </div>
    </div>
  );
}

export function LapSummary({ lap, side }) {
  const color = lapColor(lap, side);
  return (
    <div className="my-3 min-w-0 border-l-2 pl-3" style={{borderColor:color}}>
      <div className="flex items-center gap-2 text-xs font-semibold">
        <span className="font-mono" style={{ color }}>{side}</span>
        <span className="truncate text-dark">{lap?.name || "Choose a comparison lap"}</span>
      </div>
      {lap?.team && <div className="mt-2 flex items-center gap-2 text-xs text-light"><TeamLogo key={lap.team.id} id={lap.team.id} name={lap.team.name} color={color} logoUrl={lap.team.logoUrl} size={22} /><span className="truncate">{lap.team.name}</span></div>}
      <div className="mt-2 font-display text-xl font-bold tabular-nums text-dark sm:text-3xl">{lap ? formatTime(lap.lapTimeMs) : "—"}</div>
      <p className="mt-2 text-xs text-light">{lap ? <><span className="block truncate" title={lap.car}>{String(lap.car || 'Unknown car').replaceAll("_", " ")}</span><span className="mt-1 block">{Math.round(Math.max(...lap.speed))} km/h peak</span></> : "Compare another driver or one of your own laps."}</p>
    </div>
  );
}

function PedalMeter({value, color, dashed=false}) {
  return <span className="mt-1 block h-1 w-16 overflow-hidden rounded-sm bg-surface2" aria-hidden="true"><span className="block h-full" style={{width:`${Math.max(0,Math.min(100,value||0))}%`,background:color,opacity:dashed?0.65:1}} /></span>;
}

function formatTime(ms) {
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}`;
}

export function CursorReadout({ lapA, lapB, cursor }) {
  const colorA=lapColor(lapA,'A'),colorB=lapColor(lapB,'B');
  const metrics = [
    ["Elapsed", "t", (v) => formatTime(v)],
    ["Speed", "speed", (v) => `${Math.round(v)} km/h`],
    ["Throttle", "gas", (v) => `${Math.round(v)}%`],
    ["Brake", "brake", (v) => `${Math.round(v)}%`],
    ["Steering", "steer", (v) => `${(v / 10).toFixed(1)}°`],
    ["Gear", "gear", (v) => v === 0 ? "N" : v < 0 ? "R" : Math.round(v)],
  ];
  return (
    <div className="min-w-0 rounded-xl border border-border px-4 py-3">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-dark">At cursor</h3>
        <span className="font-mono text-[11px] tabular-nums text-light">{(cursor / (lapA.n - 1) * 100).toFixed(1)}% of lap</span>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="border-b border-border"><th className="pb-2 text-left font-normal text-light">Channel</th><th className="pb-2 text-right" style={{ color: colorA }}>Lap A</th>{lapB && <th className="pb-2 text-right" style={{ color: colorB }}>Lap B</th>}</tr></thead>
        <tbody>{metrics.map(([label, key, format]) => <tr key={key} className="border-b border-border last:border-0"><th className="py-2 text-left font-normal text-light">{label}</th><td className="py-2 text-right font-mono tabular-nums text-dark">{format(lapA[key][cursor])}{(key==='gas'||key==='brake')&&<span className="flex justify-end"><PedalMeter value={lapA[key][cursor]} color={colorA}/></span>}</td>{lapB && <td className="py-2 text-right font-mono tabular-nums text-dark">{format(lapB[key][cursor])}{(key==='gas'||key==='brake')&&<span className="flex justify-end"><PedalMeter value={lapB[key][cursor]} color={colorB} dashed/></span>}</td>}</tr>)}</tbody>
      </table>
    </div>
  );
}
