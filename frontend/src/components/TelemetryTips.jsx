import { Fragment, useState } from "react";
import { Check, Lightbulb } from "lucide-react";
import { Panel, Segmented } from "./TelemetryUI.jsx";
import { formatLapTime } from "../utils/telemetryAnalysis.js";

// ---------------------------------------------------------------------------
// Tips: the comparison read out loud for the driver of the slower lap
// (utils/drivingTips.js writes the sentences). On the left a practice plan:
// the three corners worth the most, each as one thing to do, to tick off, and
// the lap time they add up to. On the right every corner of the lap with what
// it costs, biggest first; one is open at a time with the sentence, what the
// quicker lap did there and the corner's own trace. Every corner zooms the
// traces below to it, where the claim can be checked.
// ---------------------------------------------------------------------------

const secs = (ms) => `${ms < 0 ? "−" : "+"}${(Math.abs(ms) / 1000).toFixed(2)}`;
// How much a corner costs, as a colour: the same three steps everywhere on
// the panel, so a red bar is a red number.
const severity = (ms) => (ms < 0 ? "rgb(var(--c-ok))" : ms >= 150 ? "rgb(var(--c-bad))" : ms >= 80 ? "#fb923c" : "rgb(var(--c-warn))");
const dayMonth = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(d) : "";
};

// "**15 m earlier**" in the sentences becomes bold.
function Say({ text, className = "" }) {
  const parts = String(text).split(/\*\*(.+?)\*\*/g);
  return (
    <p className={className}>
      {parts.map((p, i) => (i % 2 ? <strong key={i} className="font-bold text-eyebrow">{p}</strong> : <Fragment key={i}>{p}</Fragment>))}
    </p>
  );
}

// Which plan steps a driver has ticked off, per comparison and per browser:
// the same two laps open on the same ticks next time. Storage can be missing
// or throw (private windows); the plan then simply starts unticked. Only the
// most recent comparisons are kept, so the entry cannot grow without end.
const PLAN_KEY = "nabs_tel_plan";
const PLAN_KEEP = 40;
function readPlans() {
  try {
    const v = JSON.parse(localStorage.getItem(PLAN_KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function writePlan(key, done) {
  try {
    const all = readPlans();
    all[key] = { at: Date.now(), done };
    const keep = Object.entries(all).sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0)).slice(0, PLAN_KEEP);
    localStorage.setItem(PLAN_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* per-browser nicety only */ }
}
const lapKey = (lap) => `${lap.steamId || lap.name}:${lap.lapTimeMs}`;
const planKeyOf = (me, other) => `${me.track || ""}/${me.layout || ""}|${lapKey(me)}|${lapKey(other)}`;
const stepKey = (t) => `${t.n}:${t.kind}`;

// The corner's speed trace, both laps, with where each started braking. Just
// enough to see the tip's claim; the full traces are one click away.
function MiniTrace({ me, other, row, colorMe, colorRef }) {
  const W = 360, H = 118, pl = 30, pr = 6, pt = 16, pb = 16;
  const from = Math.max(0, row.start);
  const to = Math.min(me.speed.length - 1, row.end);
  if (to - from < 3) return null;
  const vs = [];
  for (let i = from; i <= to; i++) vs.push(me.speed[i], other.speed[i]);
  const lo = Math.floor((Math.min(...vs) - 10) / 10) * 10;
  const hi = Math.ceil((Math.max(...vs) + 5) / 10) * 10;
  const x = (i) => pl + ((i - from) / (to - from)) * (W - pl - pr);
  const y = (v) => pt + (1 - (v - lo) / (hi - lo || 1)) * (H - pt - pb);
  const path = (lap) => {
    let d = "";
    for (let i = from; i <= to; i++) d += `${i === from ? "M" : "L"}${x(i).toFixed(1)},${y(lap.speed[i]).toFixed(1)}`;
    return d;
  };
  // Brake points as thin solid lines with a dot on top: dashed ones read as a
  // third lap next to the dashed reference trace.
  const marker = (idx, color) => (idx != null && idx >= from && idx <= to ? (
    <g>
      <line x1={x(idx)} x2={x(idx)} y1={pt} y2={H - pb} stroke={color} strokeWidth="1" strokeOpacity="0.7" />
      <circle cx={x(idx)} cy={pt} r="2.5" fill={color} />
    </g>
  ) : null);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Speed through ${row.place}: slowest ${row.minMe} against ${row.minRef} km/h`}>
      {[0.33, 0.66].map((f) => <line key={f} x1={pl} x2={W - pr} y1={pt + f * (H - pt - pb)} y2={pt + f * (H - pt - pb)} stroke="var(--c-border)" strokeDasharray="2 3" />)}
      <text x={pl - 4} y={pt + 4} textAnchor="end" fontSize="9" className="font-mono" fill="var(--c-faint)">{hi}</text>
      <text x={pl - 4} y={H - pb} textAnchor="end" fontSize="9" className="font-mono" fill="var(--c-faint)">{lo}</text>
      {row.apex >= from && row.apex <= to && (
        <>
          <line x1={x(row.apex)} x2={x(row.apex)} y1={pt} y2={H - pb} stroke="var(--c-faint)" strokeWidth="0.8" />
          <text x={x(row.apex)} y={pt - 5} textAnchor="middle" fontSize="9" className="font-mono" fill="var(--c-text3)">APEX</text>
        </>
      )}
      {marker(row.brakeIdxRef, colorRef)}
      {marker(row.brakeIdxMe, colorMe)}
      {/* The quicker lap on top, dashed: where the two run together the
          solid line shows through its gaps and both stay visible. Drawn
          underneath, it vanished wherever the laps matched. */}
      <path d={path(me)} fill="none" stroke={colorMe} strokeWidth="2" />
      <path d={path(other)} fill="none" stroke={colorRef} strokeWidth="2" strokeDasharray="5 4" />
      <text x={pl} y={H - 3} fontSize="9" className="font-mono" fill="var(--c-faint)">km/h · lines with a dot: brake points</text>
    </svg>
  );
}

// The corner from above: both lines through it, the road's edges when the
// track has them, and where each started braking. What a "most likely the
// line" tip needs, since the speed trace cannot show it. Positions are in
// decimetres (lib/telemetryLaps.js), the road in metres, both in the same
// world frame the big map uses.
function MiniLine({ me, other, row, colorMe, colorRef, road }) {
  // The bottom 16 units hold the scale and the caption, clear of the lines.
  const W = 360, H = 150, pad = 12, plotH = H - 16;
  if (!me.x || !me.z || !other.x || !other.z) return null;
  const from = Math.max(0, row.start);
  const to = Math.min(me.x.length - 1, row.end);
  if (to - from < 3) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const lap of [me, other]) {
    for (let i = from; i <= to; i++) {
      const x = lap.x[i] / 10, y = lap.z[i] / 10;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const scale = Math.min((W - 2 * pad) / Math.max(1, maxX - minX), (plotH - 2 * pad) / Math.max(1, maxY - minY));
  const ox = (W - (maxX - minX) * scale) / 2, oy = (plotH - (maxY - minY) * scale) / 2;
  const px = (x) => ox + (x - minX) * scale;
  const py = (y) => oy + (y - minY) * scale;
  const path = (lap) => {
    let d = "";
    for (let i = from; i <= to; i++) d += `${i === from ? "M" : "L"}${px(lap.x[i] / 10).toFixed(1)},${py(lap.z[i] / 10).toFixed(1)}`;
    return d;
  };
  // The road's edges inside the frame, as runs of points: an edge leaves the
  // frame and comes back, and joining across the gap would draw a chord.
  const margin = 30 / scale;
  // Clipped to the drawing area too: an edge that runs on past the corner
  // would otherwise cross the caption.
  const inside = ([x, y]) => x >= minX - margin && x <= maxX + margin && y >= minY - margin && y <= maxY + margin
    && py(y) >= 2 && py(y) <= plotH && px(x) >= 2 && px(x) <= W - 2;
  const edges = [];
  for (const edge of [road?.track?.left, road?.track?.right].filter(Boolean)) {
    let run = "";
    for (const p of edge) {
      if (inside(p)) run += `${run ? "L" : "M"}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`;
      else if (run) { edges.push(run); run = ""; }
    }
    if (run) edges.push(run);
  }
  const dot = (lap, idx, color) => (idx != null && idx >= from && idx <= to
    ? <circle cx={px(lap.x[idx] / 10)} cy={py(lap.z[idx] / 10)} r="3.5" fill={color} stroke="var(--c-card)" strokeWidth="1.2" />
    : null);
  // A scale bar of a round length, so "a car's width" can be judged by eye.
  const bar = [5, 10, 20, 50, 100].find((m) => m * scale >= 36) || 100;
  const apexX = px(me.x[row.apex] / 10), apexY = py(me.z[row.apex] / 10);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Both racing lines through ${row.place}, seen from above`}>
      {edges.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--c-text3)" strokeOpacity="0.55" strokeWidth="1.2" />)}
      <path d={path(me)} fill="none" stroke={colorMe} strokeWidth="2" strokeLinejoin="round" />
      <path d={path(other)} fill="none" stroke={colorRef} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />
      {row.apex >= from && row.apex <= to && <circle cx={apexX} cy={apexY} r="5.5" fill="none" stroke="var(--c-text3)" strokeWidth="1" />}
      {dot(other, row.brakeIdxRef, colorRef)}
      {dot(me, row.brakeIdxMe, colorMe)}
      <line x1={pad} x2={pad + bar * scale} y1={H - 6} y2={H - 6} stroke="var(--c-faint)" strokeWidth="1.5" />
      <text x={pad + bar * scale + 4} y={H - 3} fontSize="9" className="font-mono" fill="var(--c-faint)">{bar} m · dots: brake points · ring: apex</text>
    </svg>
  );
}

// The open corner's chart: its speed trace, or both lines from above when the
// laps recorded positions. A tip that blames the line opens on the line.
function CornerChart({ row, me, other, names, colorMe, colorRef, road, preferLine }) {
  const hasLine = !!(me.x && me.z && other.x && other.z);
  const [view, setView] = useState(hasLine && preferLine ? "line" : "speed");
  return (
    <div className="min-w-0 rounded-lg bg-card p-2 ring-1 ring-border">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-medium">
        {hasLine
          ? <Segmented label="Chart" value={view} onChange={setView} items={[{ key: "speed", label: "Speed" }, { key: "line", label: "Line" }]} />
          : <span className="font-mono uppercase tracking-wider text-light">Speed</span>}
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex min-w-0 items-center gap-1.5"><span className="h-0.5 w-3.5 shrink-0 rounded-full" style={{ background: colorMe }} /><span className="truncate">{names.me}</span></span>
          <span className="flex min-w-0 items-center gap-1.5"><span className="w-3.5 shrink-0 border-t-2 border-dashed" style={{ borderColor: colorRef }} /><span className="truncate">{names.ref}</span></span>
        </span>
      </div>
      {view === "line" && hasLine
        ? <MiniLine me={me} other={other} row={row} colorMe={colorMe} colorRef={colorRef} road={road} />
        : <MiniTrace me={me} other={other} row={row} colorMe={colorMe} colorRef={colorRef} />}
    </div>
  );
}

// What opens under a corner's row: the sentence, the numbers behind it and
// what the quicker lap did, beside the corner's own trace.
function CornerDetail({ row, tip, strength, refName, chart, colorMe, colorRef, onSection }) {
  return (
    <div className="grid grid-cols-1 gap-3 px-3 pb-4 sm:px-5 md:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        {tip ? <>
          <Say text={tip.say} className="text-sm leading-relaxed text-dark" />
          {tip.facts.length > 0 && (
            <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              {tip.facts.map((f) => (
                <div key={f.label} className="flex min-w-0 items-baseline gap-1.5">
                  <dt className="font-mono font-semibold uppercase tracking-wider text-light">{f.label}</dt>
                  <dd className="font-mono font-bold tabular-nums">
                    <span style={{ color: colorMe }}>{f.me}</span>
                    {f.ref && <><span className="font-normal text-faint"> vs </span><span style={{ color: colorRef }}>{f.ref}</span></>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-2 text-[13px] leading-relaxed text-medium">
            <span className="mr-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ok">Try</span>{tip.try}
          </p>
        </> : strength ? (
          <Say text={strength.say} className="text-sm leading-relaxed text-dark" />
        ) : (
          <p className="text-sm leading-relaxed text-medium">Within a few hundredths of {refName} here, so there is no tip for this corner.</p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-light">
          <span>{Math.round(row.apexPct)}% of lap{row.atM != null ? ` · ${row.atM.toLocaleString("en-GB")} m` : ""}</span>
          <button type="button" className="font-semibold text-link hover:underline" onClick={() => onSection(row)}>Show in the traces ↓</button>
        </div>
      </div>
      <CornerChart key={row.n} row={row} preferLine={tip?.kind === "line"} {...chart} />
    </div>
  );
}

// The plan: the biggest three, each as one thing to do, ticked off by the
// driver, and the lap they add up to.
function PracticePlan({ steps, done, onToggle, openN, onOpen, me, refName, top3Ms, pattern }) {
  return (
    <>
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow">Practice plan</p>
      <ol className="mt-3 space-y-2">
        {steps.map((t) => {
          const at = done[stepKey(t)];
          const id = `tel-plan-${t.n}`;
          return (
            <li key={t.n} className={`flex gap-3 rounded-xl bg-card p-3 shadow-card ${openN === t.n ? "ring-2 ring-primary" : ""}`}>
              <input id={id} type="checkbox" className="peer sr-only" checked={!!at} onChange={() => onToggle(t)} />
              <label htmlFor={id} title={at ? "Mark as not done" : "Mark as done"}
                className={`mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-2 transition peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-1 ${at ? "border-ok bg-ok text-card" : "border-border bg-card"}`}>
                {at && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
                <span className="sr-only">{t.step}</span>
              </label>
              <button type="button" onClick={() => onOpen(t.n)} className="min-w-0 text-left" title="Open this corner in the list">
                <span className={`block text-sm font-bold text-dark ${at ? "line-through decoration-ok/60" : ""}`}>{t.step}</span>
                <span className="block text-xs text-light">worth {(t.lostMs / 1000).toFixed(2)} s{at ? ` · done on ${dayMonth(at)}` : ""}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {/* ink is dark in both themes, so the text on it stays light. */}
      <div className="mt-4 rounded-xl bg-ink p-3 text-white">
        <p className="font-mono text-[10px] uppercase tracking-widest text-white/60">Target lap</p>
        <p className="font-display text-2xl font-black tabular-nums">
          {formatLapTime(me.lapTimeMs - top3Ms)} <span className="text-sm text-emerald-300">−{(top3Ms / 1000).toFixed(2)}</span>
        </p>
        <p className="mt-0.5 text-[11px] text-white/60">Your {formatLapTime(me.lapTimeMs)} if {steps.length === 1 ? "this corner matches" : `these ${steps.length} corners match`} {refName}</p>
      </div>
      {pattern && (
        <p className="mt-3 text-[13px] leading-relaxed text-medium">
          <strong className="text-dark">{(pattern.ms / 1000).toFixed(2)} s of it is {pattern.label.toLowerCase()}</strong>, in{" "}
          {pattern.places.join(", ")}. One habit behind several corners: fix it once and it pays everywhere.
        </p>
      )}
    </>
  );
}

const ROW_GRID = "grid-cols-[1.25rem_minmax(0,1fr)_auto] sm:grid-cols-[1.75rem_minmax(0,9rem)_7rem_minmax(0,1fr)_4rem]";

export default function TelemetryTips({ tips, lapA, lapB, colorA, colorB, nameA, nameB, road, onSection }) {
  const [order, setOrder] = useState("cost");
  const [openN, setOpenN] = useState(() => tips?.tips[0]?.n ?? null);
  const student = tips?.student;
  const me = student === "A" ? lapA : lapB;
  const other = student === "A" ? lapB : lapA;
  const planKey = me && other ? planKeyOf(me, other) : "";
  const [done, setDone] = useState(() => (planKey ? readPlans()[planKey]?.done || {} : {}));
  if (!tips || !me || !other) return null;

  const names = student === "A" ? { me: nameA, ref: nameB } : { me: nameB, ref: nameA };
  const colorMe = student === "A" ? colorA : colorB;
  const colorRef = student === "A" ? colorB : colorA;
  const level = tips.gapMs < 10;
  const steps = tips.tips.slice(0, 3);
  const byTip = new Map(tips.tips.map((t) => [t.n, t]));
  const byStrength = new Map(tips.strengths.map((s) => [s.n, s]));
  const ordered = order === "cost" ? [...tips.rows].sort((a, b) => b.lostMs - a.lostMs) : tips.rows;
  const rest = tips.restMs;
  const max = Math.max(60, ...tips.rows.map((r) => Math.abs(r.lostMs)), Math.abs(rest));
  const chart = { me, other, names, colorMe, colorRef, road };
  const toggle = (t) => {
    const next = { ...done };
    if (next[stepKey(t)]) delete next[stepKey(t)];
    else next[stepKey(t)] = new Date().toISOString();
    setDone(next);
    writePlan(planKey, next);
  };
  const open = (n) => {
    setOpenN(n);
    // The plan sits above the list on a phone: bring the opened row up.
    requestAnimationFrame(() => document.getElementById(`tel-corner-${n}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };
  const bar = (ms) => (
    <span className="hidden h-2 overflow-hidden rounded-full bg-surface2 sm:block" aria-hidden="true">
      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (Math.abs(ms) / max) * 100)}%`, background: severity(ms) }} />
    </span>
  );
  const pill = (label, tone) => (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>
  );

  return (
    <Panel title={`Tips for ${tips.studentName}`} icon={Lightbulb} flush
      note={level ? "These two laps are level" : `against ${tips.sameDriver ? "their quicker lap" : tips.refName} · ${secs(tips.gapMs)} s`}
      actions={<Segmented label="Order" value={order} onChange={setOrder} items={[{ key: "cost", label: "By cost" }, { key: "lap", label: "Lap order" }]} />}>
      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-w-0 border-b border-border bg-surface2/50 p-3 sm:p-5 lg:border-b-0 lg:border-r">
          {steps.length ? (
            <PracticePlan steps={steps} done={done} onToggle={toggle} openN={openN} onOpen={open} me={me} refName={tips.refName} top3Ms={tips.top3Ms} pattern={tips.pattern} />
          ) : (
            <p className="text-sm text-light">
              No corner costs {tips.studentName} more than a few hundredths against {tips.refName}. The gap
              {level ? " is too small to explain" : " is spread over the whole lap rather than in one place"}.
            </p>
          )}
        </aside>
        <div className="min-w-0">
          <div className={`hidden gap-3 border-b border-border px-5 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-light sm:grid ${ROW_GRID}`} aria-hidden="true">
            <span>#</span><span>Corner</span><span>What</span><span>Cost</span><span className="text-right">s</span>
          </div>
          <ul className="divide-y divide-border">
            {ordered.map((r, i) => {
              const isOpen = r.n === openN;
              const tip = byTip.get(r.n);
              const strength = byStrength.get(r.n);
              return (
                <li key={r.n} id={`tel-corner-${r.n}`} className={isOpen ? "bg-primary/10" : ""} style={{ scrollMarginTop: "var(--tel-top, 84px)" }}>
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpenN(isOpen ? null : r.n)}
                    className={`grid w-full items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left transition hover:bg-surface2/70 sm:px-5 ${ROW_GRID}`}>
                    <span className="font-mono text-xs font-bold tabular-nums text-faint">{i + 1}</span>
                    <span className="min-w-0 truncate text-[13px] font-bold text-dark">
                      {r.place}
                      {!r.named && <span className="ml-1.5 font-mono text-[10px] font-normal text-light">{Math.round(r.apexPct)}%</span>}
                    </span>
                    <span className="order-last col-span-2 col-start-2 sm:order-none sm:col-span-1 sm:col-start-auto">
                      {tip ? pill(tip.kindLabel, "bg-surface2 text-medium") : strength ? pill(strength.kindLabel, "bg-ok/10 text-ok") : pill("Close", "text-light")}
                    </span>
                    {bar(r.lostMs)}
                    <span className={`text-right font-mono text-xs font-bold tabular-nums ${r.lostMs < 0 ? "text-ok" : "text-bad"}`}>{secs(r.lostMs)}</span>
                  </button>
                  {isOpen && <CornerDetail row={r} tip={tip} strength={strength} refName={tips.refName} chart={chart} colorMe={colorMe} colorRef={colorRef} onSection={onSection} />}
                </li>
              );
            })}
            {Math.abs(rest) >= 10 && (
              <li className={`grid items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:px-5 ${ROW_GRID}`}>
                <span />
                <span className="min-w-0 truncate text-[13px] font-semibold text-medium">Rest of the lap</span>
                <span className="order-last col-span-2 col-start-2 sm:order-none sm:col-span-1 sm:col-start-auto">{pill("Straights", "text-light")}</span>
                {bar(rest)}
                <span className={`text-right font-mono text-xs font-bold tabular-nums ${rest < 0 ? "text-ok" : "text-bad"}`}>{secs(rest)}</span>
              </li>
            )}
          </ul>
          <div className="flex items-center justify-between border-t border-border px-3 py-2.5 text-[13px] font-bold text-dark sm:px-5">
            <span>Total</span>
            <span className="font-mono text-sm tabular-nums text-bad">{secs(tips.gapMs)} s</span>
          </div>
        </div>
      </div>
      <p className="border-t border-border px-3 py-2 text-[11px] leading-relaxed text-light sm:px-4">
        Written from the same numbers as the sections below: brake point, slowest speed, exit speed and where full
        throttle comes back. Only corners worth more than 0.03 s get a tip. The suggestions are what the quicker lap
        did in that corner, not a diagnosis.
        {!tips.namedCorners && " Corners are numbered in lap order until an admin names them (Admin → Tracks)."}
      </p>
    </Panel>
  );
}
