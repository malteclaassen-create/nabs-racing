import { useState } from "react";

// ---------------------------------------------------------------------------
// The slow sections one by one, on one grid so the bars line up, each with a bar that grows left when A gains
// and right when B gains, and the facts behind it. The sectors and the
// headline differences are in TelemetryOverview.jsx.
// ---------------------------------------------------------------------------

export const fmt = (ms) => (Math.abs(ms) / 1000).toFixed(3);
export const who = (ms) => (ms > 0 ? "A" : "B");

export function DivergingBar({ value, max, colorA, colorB, className = "" }) {
  const w = (Math.min(1, Math.abs(value) / (max || 1)) * 50).toFixed(1);
  return (
    <span className={`relative block overflow-hidden rounded-sm bg-surface2 ${className}`} aria-hidden="true">
      <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
      {Math.abs(value) >= 5 && (
        <span className="absolute inset-y-0" style={value > 0 ? { right: "50%", width: `${w}%`, background: colorA } : { left: "50%", width: `${w}%`, background: colorB }} />
      )}
    </span>
  );
}

// The facts behind one section's time, in words and numbers: who brakes later,
// who carries more speed through and out of it, who is back on full throttle
// first. Shared by the list below and the overview's biggest differences.
export function sectionFacts(c) {
  const facts = [];
  if (c.brakeDeltaM != null && Math.abs(c.brakeDeltaM) >= 3) facts.push(`${c.brakeDeltaM > 0 ? "B" : "A"} brakes ${Math.abs(c.brakeDeltaM)} m later`);
  if (Math.abs(c.midDelta) >= 2) facts.push(`${c.midDelta > 0 ? "B" : "A"} +${Math.abs(c.midDelta).toFixed(0)} km/h minimum`);
  if (Math.abs(c.exitDelta) >= 2) facts.push(`${c.exitDelta > 0 ? "B" : "A"} +${Math.abs(c.exitDelta).toFixed(0)} km/h on exit`);
  if (c.throttleDeltaM != null && Math.abs(c.throttleDeltaM) >= 3) facts.push(`${c.throttleDeltaM > 0 ? "A" : "B"} on full throttle ${Math.abs(c.throttleDeltaM)} m earlier`);
  return facts;
}

export function SectionsPanel({ insights, activeN, colorA, colorB, onSelect }) {
  const [sort, setSort] = useState("lap");
  const rows = sort === "lap" ? insights : [...insights].sort((x, y) => Math.abs(y.gainMs) - Math.abs(x.gainMs));
  const max = Math.max(50, ...insights.map((c) => Math.abs(c.gainMs)));
  const aTotal = insights.filter((c) => c.gainMs > 0).reduce((s, c) => s + c.gainMs, 0);
  const bTotal = insights.filter((c) => c.gainMs < 0).reduce((s, c) => s - c.gainMs, 0);
  const net = aTotal - bTotal;
  const summary = [aTotal >= 5 && `A +${fmt(aTotal)} s`, bTotal >= 5 && `B +${fmt(bTotal)} s`].filter(Boolean).join(", ")
    + (aTotal >= 5 && bTotal >= 5 ? ` · net ${Math.abs(net) < 5 ? "level" : `${who(net)} +${fmt(net)} s`}` : "");
  return (
    <section aria-label="Slow sections">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
        <h3 className="text-sm font-semibold text-dark">Slow sections{summary && <span className="font-normal text-light"> · {summary}</span>}</h3>
        <p className="text-[11px] text-light">
          {[["lap", "lap order"], ["size", "biggest first"]].map(([key, label], k) => (
            <span key={key}>{k > 0 && " · "}<button type="button" aria-pressed={sort === key} onClick={() => setSort(key)} className={sort === key ? "font-semibold text-dark" : "hover:underline"}>{label}</button></span>
          ))}
        </p>
      </div>
      <div className="divide-y divide-border">
        {rows.map((c) => {
          const active = c.n === activeN;
          const even = Math.abs(c.gainMs) < 10;
          const facts = sectionFacts(c);
          return (
            <button key={c.n} type="button" onClick={() => onSelect(c)} aria-current={active ? "true" : undefined}
              className={`grid w-full grid-cols-[1.25rem_6.5rem_minmax(0,1fr)_6rem] items-center gap-x-3 gap-y-1 px-1 py-2 sm:grid-cols-[1.25rem_6.5rem_minmax(0,1fr)_6rem_minmax(0,1.4fr)] text-left text-xs transition hover:bg-surface2 ${active ? "bg-surface2" : ""}`}>
              <span className="font-mono font-semibold tabular-nums" style={{ color: active ? "rgb(var(--c-accent))" : "var(--c-text)" }}>{c.n}</span>
              <span className="truncate font-mono text-[11px] tabular-nums text-light">{c.atPct}%{c.atM != null ? ` · ${c.atM.toLocaleString("en-GB")} m` : ""}</span>
              <DivergingBar value={c.gainMs} max={max} colorA={colorA} colorB={colorB} className="h-1.5" />
              <span className="text-right font-mono font-semibold tabular-nums" style={{ color: even ? "var(--c-text3)" : who(c.gainMs) === "A" ? colorA : colorB }}>{even ? "even" : `${who(c.gainMs)} +${fmt(c.gainMs)} s`}</span>
              <span className="col-span-full pl-8 text-[11px] text-light sm:col-span-1 sm:pl-0">{facts.join(" · ") || "no large difference in the sampled inputs"}</span>
            </button>
          );
        })}
      </div>
      <p className="pt-2 text-[11px] text-light">From A’s speed trace, numbered in lap order — not the circuit’s corner numbers. Select one to zoom the traces to it.</p>
    </section>
  );
}
