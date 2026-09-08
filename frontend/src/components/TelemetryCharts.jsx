import { useId, useMemo, useRef, useState } from "react";
import { telemetryIndexAt } from "../utils/telemetryWindow.js";
import TeamLogo from "./TeamLogo.jsx";

export const LAP_A_COLOR = "#0ea5e9";
export const LAP_B_COLOR = "#f43f5e";
// The pedals keep their own colours everywhere they are drawn (bars, fills,
// legend): green is the throttle and red is the brake, on every telemetry
// screen anyone has ever watched.
export const THROTTLE_COLOR = "#22c55e";
export const BRAKE_COLOR = "#ef4444";
export const lapColor = (lap, side) => /^#[\da-f]{6}$/i.test(lap?.team?.color || '') ? lap.team.color : side === 'A' ? LAP_A_COLOR : LAP_B_COLOR;
export const signedSeconds = (seconds, digits = 3) => `${seconds > 0 ? "+" : seconds < 0 ? "−" : ""}${Math.abs(seconds).toFixed(digits)} s`;

const yOf = (v, lo, hi) => 96 - ((v - lo) / (hi - lo || 1)) * 92;
const points = (values, lo, hi) => values.map((v, i) => `${i},${yOf(v, lo, hi).toFixed(2)}`).join(" ");

// One pointer surface for every chart: hover moves the cursor, a click sets
// it, a drag selects a stretch to zoom into. Labels stay outside it, so
// selecting 50% always means 50% on every channel.
function useChartPointer(visible, onPick, onSelectRange) {
  const drag = useRef(null);
  const [selection, setSelection] = useState(null);
  const indexAt = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    return telemetryIndexAt((event.clientX - box.left) / box.width, visible);
  };
  const cancel = () => { drag.current = null; setSelection(null); };
  const handlers = {
    onPointerDown: (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      const index = indexAt(event);
      drag.current = { index, x: event.clientX, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      onPick(index);
    },
    onPointerMove: (event) => {
      const index = indexAt(event);
      if (drag.current) {
        if (Math.abs(event.clientX - drag.current.x) >= 6) drag.current.moved = true;
        if (drag.current.moved) setSelection([Math.min(drag.current.index, index), Math.max(drag.current.index, index)]);
      } else if (event.pointerType !== "touch") onPick(index);
    },
    onPointerUp: (event) => {
      const active = drag.current;
      const index = indexAt(event);
      cancel();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (active?.moved) onSelectRange?.(active.index, index);
      else if (active) onPick(index);
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  };
  return { handlers, selection };
}

// The slow sections as bands behind the trace, with their number in the
// corner. The band itself lets the pointer through (hovering across it still
// moves the cursor); only the little number is a button.
function Bands({ bands, visible, span, onBand }) {
  if (!bands?.length) return null;
  return bands.map((b) => {
    if (b.end < visible[0] || b.start > visible[1]) return null;
    const from = Math.max(b.start, visible[0]);
    const to = Math.min(b.end, visible[1]);
    return (
      <div key={b.n} className="pointer-events-none absolute inset-y-0" style={{ left: `${((from - visible[0]) / span) * 100}%`, width: `${((to - from) / span) * 100}%` }}>
        <div className="absolute inset-0" style={{ background: b.active ? "rgb(var(--c-brand))" : "var(--c-text)", opacity: b.active ? 0.09 : 0.05 }} />
        {onBand && (
          <button type="button" className="pointer-events-auto absolute left-0.5 top-0.5 rounded px-1 font-mono text-[9px] font-bold leading-4 hover:bg-surface2"
            style={{ color: b.active ? "var(--c-text)" : "var(--c-text3)" }}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onBand(b); }} aria-label={`Slow section ${b.n}`}>{b.n}</button>
        )}
      </div>
    );
  });
}

// Y axis, grid, bands, selection and cursor — the frame every chart sits in.
// `children` is the SVG content, `overlay` any HTML laid over the plot.
function ChartFrame({ height, ticks, visible, span, cursor, handlers, selection, bands, onBand, onResetRange, dashedMid = false, children, overlay }) {
  return (
    <div className="flex gap-2" style={{ height }}>
      <div className="relative w-10 shrink-0 font-mono text-[10px] tabular-nums text-light" aria-hidden="true">
        {ticks.map((t, i) => <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: `${4 + i * 46}%` }}>{t}</span>)}
      </div>
      <div className="relative min-w-0 flex-1 cursor-crosshair select-none overflow-hidden rounded border border-border bg-surface2/30"
        style={{ touchAction: "pan-y" }} {...handlers} onDoubleClick={onResetRange}>
        <Bands bands={bands} visible={visible} span={span} onBand={onBand} />
        {[0, 25, 50, 75, 100].map((p) => <div key={p} className="pointer-events-none absolute inset-y-0 border-l border-border opacity-50" style={{ left: `${p}%` }} />)}
        {[4, 50, 96].map((p) => <div key={p} className={`pointer-events-none absolute inset-x-0 border-t border-border ${dashedMid && p === 50 ? "border-dashed" : "opacity-50"}`} style={{ top: `${p}%` }} />)}
        <svg viewBox={`${visible[0]} 0 ${span} 100`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {children}
        </svg>
        {overlay}
        {selection && <div className="pointer-events-none absolute inset-y-0 border-x border-primary bg-primary/15" style={{ left: `${((selection[0] - visible[0]) / span) * 100}%`, width: `${((selection[1] - selection[0]) / span) * 100}%` }} />}
        {cursor >= visible[0] && cursor <= visible[1] && <div className="pointer-events-none absolute inset-y-0 border-l border-dark/60" style={{ left: `${((cursor - visible[0]) / span) * 100}%` }} />}
      </div>
    </div>
  );
}

function ChartHeader({ title, unit, children }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
      <h3 className="font-semibold text-dark">{title} <span className="font-normal text-light">{unit}</span></h3>
      <div className="flex gap-4 font-mono text-[11px] tabular-nums">{children}</div>
    </div>
  );
}

// One channel, two laps, one shared track-position axis. `delta` draws the
// time difference: the line is neutral and the area is tinted by who is ahead.
export function ChannelChart({ title, unit, a, b, lo, hi, cursor, onPick, range, onSelectRange, onResetRange, colorA = LAP_A_COLOR, colorB = LAP_B_COLOR, height = 116, format = Math.round, delta = false, bands, onBand }) {
  const clip = useId();
  const paths = useMemo(() => ({ a: points(a, lo, hi), b: b ? points(b, lo, hi) : null }), [a, b, lo, hi]);
  const visible = range || [0, a.length - 1];
  const span = visible[1] - visible[0];
  const { handlers, selection } = useChartPointer(visible, onPick, onSelectRange);
  const zeroY = yOf(0, lo, hi);
  const ticks = [hi, (hi + lo) / 2, lo].map((v) => (delta ? signedSeconds(v, 2).replace(" s", "") : format(v)));
  return (
    <div>
      <ChartHeader title={title} unit={unit}>
        {delta ? <span className="text-light">{signedSeconds(a[cursor] ?? 0)}</span> : <>
          <span style={{ color: colorA }}>A {format(a[cursor] ?? 0)}</span>
          {b && <span style={{ color: colorB }}>B {format(b[cursor] ?? 0)}</span>}
        </>}
      </ChartHeader>
      <ChartFrame height={height} ticks={ticks} visible={visible} span={span} cursor={cursor} handlers={handlers} selection={selection} bands={bands} onBand={onBand} onResetRange={onResetRange} dashedMid={delta}>
        {delta && <>
          <defs>
            <clipPath id={`${clip}-up`}><rect x={0} y={0} width={a.length} height={zeroY} /></clipPath>
            <clipPath id={`${clip}-dn`}><rect x={0} y={zeroY} width={a.length} height={100 - zeroY} /></clipPath>
          </defs>
          <polygon points={`0,${zeroY} ${paths.a} ${a.length - 1},${zeroY}`} fill={colorA} opacity={0.22} clipPath={`url(#${clip}-up)`} />
          <polygon points={`0,${zeroY} ${paths.a} ${a.length - 1},${zeroY}`} fill={colorB} opacity={0.22} clipPath={`url(#${clip}-dn)`} />
        </>}
        <polyline points={paths.a} fill="none" stroke={delta ? "var(--c-text)" : colorA} strokeWidth={delta ? 1.6 : 2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {paths.b && <polyline points={paths.b} fill="none" stroke={colorB} strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      </ChartFrame>
    </div>
  );
}

function PedalMeter({ value, color, dashed = false }) {
  return <span className="mt-1 block h-1 w-16 overflow-hidden rounded-sm bg-surface2" aria-hidden="true"><span className="block h-full" style={{ width: `${Math.max(0, Math.min(100, value || 0))}%`, background: color, opacity: dashed ? 0.65 : 1 }} /></span>;
}

// Throttle and brake on one plot, the way a broadcast draws them: throttle
// rises from the middle, brake drops from it. The two pedals of one lap are
// never both down, so the two halves never fight for the same space, and the
// brake point sits right under the throttle lift that preceded it.
export function PedalChart({ a, b, cursor, onPick, range, onSelectRange, onResetRange, colorA = LAP_A_COLOR, colorB = LAP_B_COLOR, height = 150, bands, onBand }) {
  const n = a.gas.length;
  const paths = useMemo(() => {
    const up = (values) => values.map((v, i) => `${i},${(50 - (v / 100) * 46).toFixed(2)}`).join(" ");
    const down = (values) => values.map((v, i) => `${i},${(50 + (v / 100) * 46).toFixed(2)}`).join(" ");
    return { ag: up(a.gas), ab: down(a.brake), bg: b ? up(b.gas) : null, bb: b ? down(b.brake) : null };
  }, [a, b]);
  const visible = range || [0, n - 1];
  const span = visible[1] - visible[0];
  const { handlers, selection } = useChartPointer(visible, onPick, onSelectRange);
  const readout = (lap, color, dashed) => (
    <span className="flex gap-3" style={{ color }}>
      <span>{dashed ? "B" : "A"} thr {Math.round(lap.gas[cursor] ?? 0)}<PedalMeter value={lap.gas[cursor]} color={THROTTLE_COLOR} dashed={dashed} /></span>
      <span>brk {Math.round(lap.brake[cursor] ?? 0)}<PedalMeter value={lap.brake[cursor]} color={BRAKE_COLOR} dashed={dashed} /></span>
    </span>
  );
  const overlay = <>
    <span className="pointer-events-none absolute left-1.5 top-0.5 text-[10px] text-light">throttle</span>
    <span className="pointer-events-none absolute bottom-0.5 left-1.5 text-[10px] text-light">brake</span>
  </>;
  return (
    <div>
      <ChartHeader title="Pedals" unit="% · throttle up, brake down">
        {readout(a, colorA, false)}
        {b && readout(b, colorB, true)}
      </ChartHeader>
      <ChartFrame height={height} ticks={["100", "0", "100"]} visible={visible} span={span} cursor={cursor} handlers={handlers} selection={selection} bands={bands} onBand={onBand} onResetRange={onResetRange} dashedMid overlay={overlay}>
        <polygon points={`0,50 ${paths.ag} ${n - 1},50`} fill={THROTTLE_COLOR} opacity={0.14} />
        <polygon points={`0,50 ${paths.ab} ${n - 1},50`} fill={BRAKE_COLOR} opacity={0.16} />
        <polyline points={paths.ag} fill="none" stroke={colorA} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <polyline points={paths.ab} fill="none" stroke={colorA} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {paths.bg && <polyline points={paths.bg} fill="none" stroke={colorB} strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {paths.bb && <polyline points={paths.bb} fill="none" stroke={colorB} strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      </ChartFrame>
    </div>
  );
}

// The shared x axis under the stack: percent of lap, or metres driven by A
// when the lap recorded positions.
export function ChartAxis({ visibleRange, n, dist, mode = "pct", zoomed = false }) {
  const span = visibleRange[1] - visibleRange[0];
  return (
    <div className="ml-12 flex justify-between font-mono text-[10px] tabular-nums text-light" aria-label="Track position axis">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const idx = Math.round(visibleRange[0] + f * span);
        return <span key={f}>{mode === "dist" && dist ? `${Math.round(dist[idx]).toLocaleString("en-GB")} m` : `${((idx / (n - 1)) * 100).toFixed(zoomed ? 1 : 0)}%`}</span>;
      })}
    </div>
  );
}

export function LapSummary({ lap, side }) {
  const color = lapColor(lap, side);
  return (
    <div className="my-3 min-w-0 border-l-2 pl-3" style={{ borderColor: color }}>
      <div className="flex items-center gap-2 text-xs font-semibold">
        <span className="font-mono" style={{ color }}>{side}</span>
        <span className="truncate text-dark">{lap?.name || "Choose a comparison lap"}</span>
      </div>
      {lap?.team && <div className="mt-2 flex items-center gap-2 text-xs text-light"><TeamLogo key={lap.team.id} id={lap.team.id} name={lap.team.name} color={color} logoUrl={lap.team.logoUrl} size={22} /><span className="truncate">{lap.team.name}</span></div>}
      <div className="mt-2 font-display text-xl font-bold tabular-nums text-dark sm:text-3xl">{lap ? formatTime(lap.lapTimeMs) : "—"}</div>
      <p className="mt-2 text-xs text-light">{lap ? <><span className="block truncate" title={lap.car}>{String(lap.car || 'Unknown car').replaceAll("_", " ")}</span><span className="mt-1 block">{Math.round(Math.max(...lap.speed))} km/h peak{recordedOn(lap.recordedAt)}</span></> : "Compare another driver or one of your own laps."}</p>
    </div>
  );
}

function formatTime(ms) {
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}`;
}

// " · recorded 3 Sep" — which of a driver's laps this is, in a form that
// tells them apart when the times do not.
function recordedOn(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return ` · recorded ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(d)}`;
}
