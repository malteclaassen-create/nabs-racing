import { Fragment } from "react";
import { Lightbulb } from "lucide-react";
import { Panel } from "./TelemetryUI.jsx";

// ---------------------------------------------------------------------------
// Tips: the comparison read out loud for the driver of the slower lap
// (utils/drivingTips.js writes the sentences). Where the gap goes corner by
// corner, then the biggest three as cards — what differs, the numbers behind
// it, what the quicker lap did there — and the rest as one line each. Every
// card zooms the traces below to its corner, where the claim can be checked.
// ---------------------------------------------------------------------------

const secs = (ms) => `${ms < 0 ? "−" : "+"}${(Math.abs(ms) / 1000).toFixed(2)}`;
// How much a corner costs, as a colour: the same three steps everywhere on
// the panel, so a red card is a red bar is a red number.
const severity = (ms) => (ms < 0 ? "rgb(var(--c-ok))" : ms >= 150 ? "rgb(var(--c-bad))" : ms >= 80 ? "#fb923c" : "rgb(var(--c-warn))");

// "**15 m earlier**" in the sentences becomes bold.
function Say({ text, className = "" }) {
  const parts = String(text).split(/\*\*(.+?)\*\*/g);
  return (
    <p className={className}>
      {parts.map((p, i) => (i % 2 ? <strong key={i} className="font-bold text-eyebrow">{p}</strong> : <Fragment key={i}>{p}</Fragment>))}
    </p>
  );
}

// Where the gap goes: one bar per section, losses right of the line and gains
// left of it, then what the sections do not account for.
function Breakdown({ tips, onSection }) {
  const rows = [...tips.rows].filter((r) => Math.abs(r.lostMs) >= 10).sort((a, b) => b.lostMs - a.lostMs);
  const rest = tips.restMs;
  const max = Math.max(60, ...rows.map((r) => Math.abs(r.lostMs)), Math.abs(rest));
  const zero = 14; // percent of the track where "no difference" sits
  const bar = (ms) => {
    const w = (Math.abs(ms) / max) * (100 - zero - 2);
    return { left: `${ms >= 0 ? zero : zero - Math.min(zero, w)}%`, width: `${ms >= 0 ? w : Math.min(zero, w)}%`, background: severity(ms) };
  };
  const line = (key, label, sub, ms, onClick) => (
    <button key={key} type="button" onClick={onClick} disabled={!onClick}
      className="grid w-full grid-cols-[minmax(0,9rem)_minmax(0,1fr)_4rem] items-center gap-3 rounded-md px-2 py-1.5 text-left transition enabled:hover:bg-surface2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_4.5rem]">
      <span className="min-w-0 truncate text-[13px] font-semibold text-medium">
        {label}
        {sub && <span className="ml-1.5 font-mono text-[10px] font-normal text-light">{sub}</span>}
      </span>
      <span className="relative h-3.5">
        <span className="absolute -bottom-1 -top-1 w-px bg-faint" style={{ left: `${zero}%` }} aria-hidden="true" />
        <span className="absolute top-0.5 h-2.5 rounded-sm" style={bar(ms)} />
      </span>
      <span className="text-right font-mono text-xs font-bold tabular-nums" style={{ color: ms < 0 ? "rgb(var(--c-ok))" : "rgb(var(--c-bad))" }}>{secs(ms)}</span>
    </button>
  );
  return (
    <div>
      {rows.map((r) => line(r.n, r.place, r.named ? null : `${Math.round(r.apexPct)}%`, r.lostMs, () => onSection(r)))}
      {Math.abs(rest) >= 10 && line("rest", "Rest of the lap", "straights", rest, null)}
      <div className="mt-1 flex items-center justify-between border-t border-border px-2 pt-2 text-[13px] font-bold text-dark">
        <span>Total</span>
        <span className="font-mono text-sm tabular-nums text-bad">{secs(tips.gapMs)} s</span>
      </div>
    </div>
  );
}

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
  const marker = (idx, color) => (idx != null && idx >= from && idx <= to ? (
    <line x1={x(idx)} x2={x(idx)} y1={pt} y2={H - pb} stroke={color} strokeWidth="1" strokeDasharray="3 3" />
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
      <path d={path(other)} fill="none" stroke={colorRef} strokeWidth="2" strokeDasharray="5 3" />
      <path d={path(me)} fill="none" stroke={colorMe} strokeWidth="2.4" />
      <text x={pl} y={H - 3} fontSize="9" className="font-mono" fill="var(--c-faint)">km/h · dashed lines: brake points</text>
    </svg>
  );
}

function TipCard({ t, index, me, other, colorMe, colorRef, onSection }) {
  const c = severity(t.lostMs);
  return (
    <article className="grid overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[minmax(0,1fr)_23rem]">
      <div className="min-w-0 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-lg px-1 font-display text-sm font-black text-ink" style={{ background: c }}>{index + 1}</span>
          <h4 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">{t.place}</h4>
          <span className="pill bg-surface2 text-medium">{t.kindLabel}</span>
          <span className="ml-auto font-display text-xl font-black tabular-nums text-bad">{secs(t.lostMs)}<span className="text-xs font-bold text-light"> s</span></span>
        </div>
        <Say text={t.say} className="mb-3 mt-2.5 text-sm leading-relaxed text-dark" />
        {t.facts.length > 0 && (
          // One line per number on a phone (label left, values right): three
          // tiles side by side there cut the label and wrapped the units.
          <dl className="mb-3 grid grid-cols-1 gap-1.5 sm:grid-cols-3 sm:gap-2">
            {t.facts.map((f) => (
              <div key={f.label} className="flex min-w-0 items-baseline justify-between gap-2 rounded-lg border border-border bg-surface2/60 px-2.5 py-1.5 sm:block">
                <dt className="truncate font-mono text-[10px] font-semibold uppercase tracking-wider text-light">{f.label}</dt>
                <dd className="shrink-0 font-mono text-xs font-bold tabular-nums text-dark sm:mt-0.5">
                  <span style={{ color: colorMe }}>{f.me}</span>
                  {f.ref && <><span className="font-normal text-faint"> vs </span><span style={{ color: colorRef }}>{f.ref}</span></>}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex gap-2.5 rounded-r-lg border-l-[3px] border-ok bg-ok/10 px-3 py-2 text-[13px] leading-relaxed text-medium">
          <span className="pt-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ok">Try</span>
          <span>{t.try}</span>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-light">
          <span>{Math.round(t.apexPct)}% of lap{t.atM != null ? ` · ${t.atM.toLocaleString("en-GB")} m` : ""}</span>
          <button type="button" className="font-semibold text-link hover:underline" onClick={() => onSection(t)}>Show in the traces ↓</button>
        </div>
      </div>
      <div className="border-t border-border bg-surface2/50 px-3 py-2.5 lg:border-l lg:border-t-0">
        <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-medium">
          <span className="font-mono uppercase tracking-wider text-light">Speed</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded-full" style={{ background: colorMe }} />{me.name}</span>
            <span className="flex items-center gap-1.5"><span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: colorRef }} />{other.name}</span>
          </span>
        </div>
        <MiniTrace me={me} other={other} row={t} colorMe={colorMe} colorRef={colorRef} />
      </div>
    </article>
  );
}

export default function TelemetryTips({ tips, lapA, lapB, colorA, colorB, onSection }) {
  if (!tips) return null;
  const me = tips.student === "A" ? lapA : lapB;
  const other = tips.student === "A" ? lapB : lapA;
  const colorMe = tips.student === "A" ? colorA : colorB;
  const colorRef = tips.student === "A" ? colorB : colorA;
  const top = tips.tips.slice(0, 3);
  const small = tips.tips.slice(3);
  const level = tips.gapMs < 10;
  return (
    <Panel title="Tips" icon={Lightbulb}
      note={level ? "These two laps are level" : `For ${tips.studentName}, from ${tips.sameDriver ? "their quicker lap" : `${tips.refName}'s lap`}`}
      bodyClassName="space-y-4">
      {!tips.tips.length ? (
        <p className="py-2 text-sm text-light">
          No corner costs {tips.studentName} more than a few hundredths against {tips.refName}. The gap
          {level ? " is too small to explain" : " is spread over the whole lap rather than in one place"}.
        </p>
      ) : (
        <>
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <h4 className="mb-1.5 text-xs font-semibold text-dark">Where the {(tips.gapMs / 1000).toFixed(3)} s go</h4>
              <Breakdown tips={tips} onSection={onSection} />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border bg-surface2/40 px-3 py-2.5">
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-light">Gap</div>
                  <div className="mt-1 font-display text-2xl font-black tabular-nums text-bad">{secs(tips.gapMs)} s</div>
                </div>
                <div className="rounded-lg border border-border bg-surface2/40 px-3 py-2.5">
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-light">The top {Math.min(3, tips.tips.length)}</div>
                  <div className="mt-1 font-display text-2xl font-black tabular-nums text-ok">−{(tips.top3Ms / 1000).toFixed(2)} s</div>
                  <div className="text-[11px] text-light">if matched</div>
                </div>
              </div>
              {tips.pattern && (
                <div className="rounded-lg border border-border bg-surface2/40 px-3 py-2.5">
                  <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-eyebrow">Pattern</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-medium">
                    <strong className="text-dark">{(tips.pattern.ms / 1000).toFixed(2)} s of it is {tips.pattern.label.toLowerCase()}</strong>, in{" "}
                    {tips.pattern.places.join(", ")}. One habit behind several corners: fix it once and it pays everywhere.
                  </p>
                </div>
              )}
              {tips.strengths.length > 0 && (
                <div className="rounded-lg border border-border bg-surface2/40 px-3 py-2.5">
                  <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-ok">Where {tips.studentName} is quicker</div>
                  <ul className="mt-1 space-y-1">
                    {tips.strengths.slice(0, 3).map((s) => (
                      <li key={s.n}>
                        <button type="button" className="text-left text-[13px] leading-relaxed text-medium hover:text-dark" onClick={() => onSection(s)}>
                          <strong className="text-dark">{s.place}</strong> · {s.say}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {top.map((t, i) => (
              <TipCard key={t.n} t={t} index={i} me={me} other={other} colorMe={colorMe} colorRef={colorRef} onSection={onSection} />
            ))}
          </div>

          {small.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold text-dark">Smaller things</h4>
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {small.map((t) => (
                  <li key={t.n}>
                    {/* On a phone: the corner and its cost on one line, the
                        sentence under both. From sm up, one row of four. */}
                    <button type="button" onClick={() => onSection(t)}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-3 py-2.5 text-left transition hover:bg-surface2 sm:grid-cols-[minmax(0,10rem)_6.5rem_minmax(0,1fr)_4rem]">
                      <span className="order-1 truncate text-[13px] font-bold text-dark">{t.place}</span>
                      <span className="hidden sm:order-2 sm:block"><span className="pill bg-surface2 text-medium">{t.kindLabel}</span></span>
                      <Say text={t.say} className="order-3 col-span-2 min-w-0 text-[13px] leading-relaxed text-medium sm:col-span-1 [&_strong]:text-medium" />
                      <span className="order-2 text-right font-mono text-xs font-bold tabular-nums text-bad sm:order-4">{secs(t.lostMs)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <p className="border-t border-border pt-2 text-[11px] leading-relaxed text-light">
        Written from the same numbers as the sections below: brake point, slowest speed, exit speed and where full
        throttle comes back. Only corners worth more than 0.03 s get a tip. The suggestions are what the quicker lap
        did in that corner, not a diagnosis.
        {!tips.namedCorners && " Corners are numbered in lap order until an admin names them (Admin → Tracks)."}
      </p>
    </Panel>
  );
}
