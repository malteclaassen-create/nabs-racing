import { useState } from "react";

// ---------------------------------------------------------------------------
// Where the time goes. Two views of the same subtraction: the lap in three
// sectors of equal distance, and the slow sections one by one, each with a
// diverging bar (left = A gains, right = B gains) and the facts behind it.
// ---------------------------------------------------------------------------

const seconds = (ms) => (Math.abs(ms) / 1000).toFixed(ms % 1000 === 0 ? 0 : 3).replace(/\.?0+$/, (m) => (m.includes(".") ? "" : m)) || "0";
const fmt = (ms) => (Math.abs(ms) / 1000).toFixed(3);

// A bar that grows left from the middle when A gains and right when B gains.
function DivergingBar({ value, max, colorA, colorB, className = "" }) {
  const w = (Math.min(1, Math.abs(value) / (max || 1)) * 50).toFixed(1);
  return (
    <span className={`relative block h-2 overflow-hidden rounded-full bg-surface2 ${className}`} aria-hidden="true">
      <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
      {Math.abs(value) >= 5 && (
        <span className="absolute inset-y-0 rounded-full" style={value > 0 ? { right: "50%", width: `${w}%`, background: colorA } : { left: "50%", width: `${w}%`, background: colorB }} />
      )}
    </span>
  );
}

export function SectorStrip({ sectors, colorA, colorB, onSelect }) {
  const max = Math.max(50, ...sectors.map((s) => Math.abs(s.deltaMs)));
  return (
    <div className="grid grid-cols-3 gap-2" aria-label="Time gained per sector">
      {sectors.map((s) => {
        const even = Math.abs(s.deltaMs) < 5;
        const aGains = s.deltaMs > 0;
        return (
          <button key={s.n} type="button" onClick={() => onSelect?.(s)} className="min-w-0 rounded-lg border border-border px-2 py-1.5 text-left transition hover:bg-surface2" title={`Sector ${s.n}: A ${fmt(s.timeA)} s · B ${fmt(s.timeB)} s`}>
            <div className="flex items-baseline justify-between gap-1">
              <span className="font-mono text-[10px] font-bold uppercase text-light">S{s.n}</span>
              <span className="truncate font-mono text-[11px] font-semibold tabular-nums" style={{ color: even ? "var(--c-text3)" : aGains ? colorA : colorB }}>
                {even ? "even" : `${aGains ? "A" : "B"} +${seconds(s.deltaMs)}`}
              </span>
            </div>
            <DivergingBar value={s.deltaMs} max={max} colorA={colorA} colorB={colorB} className="mt-1 h-1.5" />
          </button>
        );
      })}
    </div>
  );
}

function Chip({ children, color }) {
  return <span className="rounded bg-surface2 px-1.5 py-0.5 font-mono text-[10px] tabular-nums" style={{ color }}>{children}</span>;
}

export function SectionsPanel({ insights, activeN, colorA, colorB, onSelect }) {
  const [sort, setSort] = useState("lap");
  const rows = sort === "lap" ? insights : [...insights].sort((x, y) => Math.abs(y.gainMs) - Math.abs(x.gainMs));
  const max = Math.max(50, ...insights.map((c) => Math.abs(c.gainMs)));
  const aTotal = insights.filter((c) => c.gainMs > 0).reduce((s, c) => s + c.gainMs, 0);
  const bTotal = insights.filter((c) => c.gainMs < 0).reduce((s, c) => s - c.gainMs, 0);
  const aCount = insights.filter((c) => c.gainMs >= 10).length;
  const bCount = insights.filter((c) => c.gainMs <= -10).length;
  const net = aTotal - bTotal;
  const summary = insights.length === 0 ? "" :
    `${aCount ? `A gains ${fmt(aTotal)} s across ${aCount} section${aCount === 1 ? "" : "s"}` : "A gains nothing"}, ${bCount ? `B gains ${fmt(bTotal)} s across ${bCount}` : "B gains nothing"}. Net through the slow parts: ${Math.abs(net) < 5 ? "level" : `${net > 0 ? "A" : "B"} +${fmt(net)} s`}.`;
  return (
    <section className="rounded-xl border border-border" aria-label="Where the time goes">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-dark">Where the time goes</h3>
          <p className="text-xs text-light">{summary}</p>
        </div>
        <div className="flex gap-1 text-[11px]" role="group" aria-label="Sort sections">
          {[["lap", "Lap order"], ["size", "Biggest first"]].map(([key, label]) => (
            <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)}
              className={`rounded-md px-2 py-1 font-semibold transition ${sort === key ? "bg-brand/15 text-dark" : "text-light hover:bg-surface2"}`}>{label}</button>
          ))}
        </div>
      </header>
      <div className="divide-y divide-border">
        {rows.map((c) => {
          const active = c.n === activeN;
          const even = Math.abs(c.gainMs) < 10;
          const who = c.gainMs >= 0 ? "A" : "B";
          const tone = even ? "var(--c-text3)" : who === "A" ? colorA : colorB;
          const chips = [];
          if (c.brakeDeltaM != null && Math.abs(c.brakeDeltaM) >= 3) chips.push([`${c.brakeDeltaM > 0 ? "B" : "A"} brakes ${Math.abs(c.brakeDeltaM)} m later`, c.brakeDeltaM > 0 ? colorB : colorA]);
          if (Math.abs(c.midDelta) >= 2) chips.push([`${c.midDelta > 0 ? "B" : "A"} +${Math.abs(c.midDelta).toFixed(0)} km/h min`, c.midDelta > 0 ? colorB : colorA]);
          if (Math.abs(c.exitDelta) >= 2) chips.push([`${c.exitDelta > 0 ? "B" : "A"} +${Math.abs(c.exitDelta).toFixed(0)} km/h exit`, c.exitDelta > 0 ? colorB : colorA]);
          if (c.throttleDeltaM != null && Math.abs(c.throttleDeltaM) >= 3) chips.push([`${c.throttleDeltaM > 0 ? "A" : "B"} on full throttle ${Math.abs(c.throttleDeltaM)} m earlier`, c.throttleDeltaM > 0 ? colorA : colorB]);
          return (
            <button key={c.n} type="button" onClick={() => onSelect(c)} aria-current={active ? "true" : undefined}
              className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-left text-xs transition hover:bg-surface2 ${active ? "bg-surface2" : ""}`}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-bold text-dark"
                style={active ? { borderColor: "rgb(var(--c-brand))", background: "rgb(var(--c-brand) / 0.2)" } : { borderColor: "var(--c-border)" }}>{c.n}</span>
              <span className="w-24 shrink-0 font-mono text-[11px] tabular-nums text-light">{c.atPct}%{c.atM != null ? ` · ${c.atM.toLocaleString("en-GB")} m` : ""}</span>
              <DivergingBar value={c.gainMs} max={max} colorA={colorA} colorB={colorB} className="min-w-[110px] flex-1" />
              <span className="w-24 shrink-0 text-right font-mono text-xs font-semibold tabular-nums" style={{ color: tone }}>{even ? "even" : `${who} +${fmt(c.gainMs)} s`}</span>
              <span className="flex basis-full flex-wrap gap-1 pl-9 sm:basis-auto sm:pl-0">
                {chips.length ? chips.map(([text, color], k) => <Chip key={k} color={color}>{text}</Chip>) : <span className="text-[11px] text-light">no large difference in the sampled inputs</span>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="border-t border-border px-4 py-2 text-[11px] text-light">Sections are the slow parts of lap A’s speed trace, numbered in lap order for pointing at. They are not the circuit’s corner numbers. Select one to zoom the traces to it.</p>
    </section>
  );
}
