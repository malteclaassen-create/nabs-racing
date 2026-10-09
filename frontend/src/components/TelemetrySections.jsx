import { useState } from "react";
import { Flag } from "lucide-react";
import { Panel, Segmented } from "./TelemetryUI.jsx";

// ---------------------------------------------------------------------------
// The slow sections one by one, on one grid so the bars line up, each with a
// bar that grows left when lap A gains and right when lap B gains, and the
// facts behind it. Named the same way as everywhere else on the page (utils/
// sectionNames.js); the sectors are in TelemetryOverview.jsx.
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
// first. `names` are the two laps' names ({ a, b }).
export function sectionFacts(c, names = { a: "A", b: "B" }) {
  const facts = [];
  const of = (bSide) => (bSide ? names.b : names.a);
  if (c.brakeDeltaM != null && Math.abs(c.brakeDeltaM) >= 3) facts.push(`${of(c.brakeDeltaM > 0)} brakes ${Math.abs(c.brakeDeltaM)} m later`);
  if (Math.abs(c.midDelta) >= 2) facts.push(`${of(c.midDelta > 0)} +${Math.abs(c.midDelta).toFixed(0)} km/h at the slowest point`);
  if (Math.abs(c.exitDelta) >= 2) facts.push(`${of(c.exitDelta > 0)} +${Math.abs(c.exitDelta).toFixed(0)} km/h on exit`);
  if (c.throttleDeltaM != null && Math.abs(c.throttleDeltaM) >= 3) facts.push(`${of(c.throttleDeltaM < 0)} on full throttle ${Math.abs(c.throttleDeltaM)} m earlier`);
  return facts;
}

export function SectionsPanel({ insights, activeN, colorA, colorB, nameA, nameB, onSelect }) {
  const names = { a: nameA, b: nameB };
  const [sort, setSort] = useState("lap");
  const rows = sort === "lap" ? insights : [...insights].sort((x, y) => Math.abs(y.gainMs) - Math.abs(x.gainMs));
  const max = Math.max(50, ...insights.map((c) => Math.abs(c.gainMs)));
  const aTotal = insights.filter((c) => c.gainMs > 0).reduce((s, c) => s + c.gainMs, 0);
  const bTotal = insights.filter((c) => c.gainMs < 0).reduce((s, c) => s - c.gainMs, 0);
  const net = aTotal - bTotal;
  const gains = (side, ms) => `${side === "A" ? nameA : nameB} gains ${fmt(ms)} s`;
  const summary = [aTotal >= 5 && gains("A", aTotal), bTotal >= 5 && gains("B", bTotal)].filter(Boolean).join(", ")
    + (aTotal >= 5 && bTotal >= 5 ? ` · net ${Math.abs(net) < 5 ? "level" : `${who(net) === "A" ? nameA : nameB} ${fmt(net)} s`}` : "");
  return (
    <Panel title="Slow sections" icon={Flag} note={summary} bodyClassName="!pt-1"
      actions={<Segmented label="Order" value={sort} onChange={setSort} items={[{ key: "lap", label: "Lap order" }, { key: "size", label: "Biggest first" }]} />}>
      <div className="divide-y divide-border">
        {rows.map((c) => {
          const active = c.n === activeN;
          const even = Math.abs(c.gainMs) < 10;
          const facts = sectionFacts(c, names);
          const winner = who(c.gainMs) === "A" ? nameA : nameB;
          return (
            <button key={c.n} type="button" onClick={() => onSelect(c)} aria-current={active ? "true" : undefined}
              className={`grid w-full grid-cols-[4.5rem_minmax(0,1fr)_7.5rem] items-center gap-x-3 gap-y-1 rounded-md px-2 py-2.5 text-left text-xs transition hover:bg-surface2 sm:grid-cols-[5rem_6.5rem_minmax(0,1fr)_8.5rem_minmax(0,1.4fr)] ${active ? "bg-surface2" : ""}`}>
              <span className="truncate font-semibold" style={{ color: active ? "rgb(var(--c-accent))" : "var(--c-text)" }} title={c.label}>{c.named ? c.label.split(" ")[0] : `Section ${c.n}`}</span>
              <span className="hidden truncate font-mono text-[11px] tabular-nums text-light sm:block">{c.atPct}%{c.atM != null ? ` · ${c.atM.toLocaleString("en-GB")} m` : ""}</span>
              <DivergingBar value={c.gainMs} max={max} colorA={colorA} colorB={colorB} className="h-1.5" />
              <span className="flex min-w-0 items-baseline justify-end gap-1 font-semibold" style={{ color: even ? "var(--c-text3)" : who(c.gainMs) === "A" ? colorA : colorB }}>
                {even ? "even" : <><span className="min-w-0 truncate">{winner}</span><span className="shrink-0 font-mono tabular-nums">−{fmt(c.gainMs)}</span></>}
              </span>
              <span className="col-span-full text-[11px] text-light sm:col-span-1">{facts.join(" · ") || "no large difference in the sampled inputs"}</span>
            </button>
          );
        })}
      </div>
      <p className="border-t border-border pt-2 text-[11px] text-light">Every place the car slows down, found on {nameA}'s speed trace and named after the circuit's corners in it. A minus is the time the named driver gains there. Select one to zoom the traces to it.</p>
    </Panel>
  );
}
