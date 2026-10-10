import { Gauge } from "lucide-react";
import { fmt, who } from "./TelemetrySections.jsx";
import { Panel } from "./TelemetryUI.jsx";
import { formatLapTime } from "../utils/telemetryAnalysis.js";

// ---------------------------------------------------------------------------
// The comparison at a glance, above the map and the traces: the three sectors
// with both times, and what each lap was made of. Where the time goes corner
// by corner is the Tips panel's job (TelemetryTips.jsx); it used to be here a
// second time, numbered differently. A sector zooms the traces to it.
//
// The laps are called by their drivers' names and drawn in their colours, the
// same as everywhere else on the page; a dot in the lap's colour stands for
// the name where a tile has no room for it.
// ---------------------------------------------------------------------------

// "2,846 to 5,681 m" or "33 to 67%": one unit for the pair.
const span = (from, to, dist, n) => (dist
  ? `${Math.round(dist[from]).toLocaleString("en-GB")} to ${Math.round(dist[to]).toLocaleString("en-GB")} m`
  : `${Math.round((from / (n - 1)) * 100)} to ${Math.round((to / (n - 1)) * 100)}%`);
const sectorTime = (ms) => (ms >= 60000 ? formatLapTime(ms) : (ms / 1000).toFixed(3));

function PanelHeading({ title, note }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h4 className="text-xs font-semibold text-dark">{title}</h4>
      {note && <p className="text-[11px] text-light">{note}</p>}
    </div>
  );
}

// One sector: both times, the quicker one in its lap's colour, and the bar
// that grows towards whoever gained. The three add up to the finish-line gap.
const Dot = ({ color }) => <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />;

// Who the two colours are, once per panel.
function Legend({ nameA, nameB, colorA, colorB }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-medium">
      <span className="flex min-w-0 items-center gap-1.5"><Dot color={colorA} /><span className="truncate">{nameA}</span></span>
      {nameB && <span className="flex min-w-0 items-center gap-1.5"><Dot color={colorB} /><span className="truncate">{nameB}</span></span>}
    </span>
  );
}

function SectorCards({ sectors, colorA, colorB, nameA, nameB, dist, n, onSelect }) {
  // One scale for the three bars, so a long bar is a big sector everywhere.
  const max = Math.max(50, ...sectors.map((s) => Math.abs(s.deltaMs)));
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {sectors.map((s) => {
        const even = Math.abs(s.deltaMs) < 5;
        const side = who(s.deltaMs);
        const color = even ? "var(--c-text3)" : side === "A" ? colorA : colorB;
        const time = (lap, ms, dot) => {
          const quicker = !even && side === lap;
          return (
            <span className="flex items-center justify-between gap-1">
              <Dot color={dot} />
              <span className={`font-mono tabular-nums ${quicker ? "font-bold text-dark" : "text-light"}`}>{sectorTime(ms)}</span>
            </span>
          );
        };
        return (
          <button key={s.n} type="button" onClick={() => onSelect?.(s)}
            className="min-w-0 rounded-xl border border-border bg-card p-2.5 text-left transition hover:border-medium hover:bg-surface2/60 sm:p-4"
            title={`Zoom the traces to sector ${s.n}`}>
            <span className="flex items-baseline justify-between gap-1">
              <span className="font-display text-base font-black text-dark sm:text-xl">S{s.n}</span>
              <span className="hidden truncate font-mono text-[10px] tabular-nums text-light sm:inline">{span(s.from, s.to, dist, n)}</span>
            </span>
            <span className="mt-2 block space-y-0.5 text-xs sm:text-sm">
              {time("A", s.timeA, colorA)}
              {time("B", s.timeB, colorB)}
            </span>
            {/* What the sector is worth, in the colour of whoever took it. */}
            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface2" aria-hidden="true">
              {!even && <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (Math.abs(s.deltaMs) / max) * 100)}%`, background: color }} />}
            </span>
            <span className="mt-1 flex min-w-0 items-baseline justify-end gap-1 text-[11px] font-bold" style={{ color }}
              title={even ? "Level" : `${side === "A" ? nameA : nameB} is ${fmt(s.deltaMs)} s quicker here`}>
              {even ? "even" : <>
                {/* The name where a tile has room for it; on a phone's three
                    across, the lap's dot, which says the same in its colour. */}
                <span className="hidden min-w-0 truncate font-semibold sm:inline">{side === "A" ? nameA : nameB}</span>
                <span className="self-center sm:hidden"><Dot color={color} /></span>
                <span className="shrink-0 font-mono tabular-nums">−{fmt(s.deltaMs)}</span>
              </>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// What each lap was made of. Neither column is "better": more time on the
// brakes is slower on one track and the only way round another. The numbers
// are for spotting where two laps are built differently.
const PROFILE = [
  { key: "fullThrottlePct", label: "Full throttle", unit: "%", digits: 1, hint: "Share of the lap time with the throttle at 90% or more" },
  { key: "brakingPct", label: "Braking", unit: "%", digits: 1, hint: "Share of the lap time with the brake at 10% or more" },
  { key: "coastingPct", label: "Coasting", unit: "%", digits: 1, hint: "Share of the lap time on neither pedal (both under 10%)" },
  { key: "topSpeed", label: "Top speed", unit: "km/h", digits: 0 },
  { key: "avgSpeed", label: "Average", unit: "km/h", digits: 1, hint: "Distance over time" },
  { key: "minSpeed", label: "Slowest", unit: "km/h", digits: 0, hint: "Lowest speed anywhere on the lap" },
  { key: "peakBrakeG", label: "Peak braking", unit: "g", digits: 1, hint: "Derived from the speed trace" },
  { key: "peakLatG", label: "Peak lateral", unit: "g", digits: 1, hint: "Derived from the recorded line" },
  { key: "shifts", label: "Gear shifts", unit: "", digits: 0 },
];

// The end of a bar's scale: the next round number above the larger of the
// two values. The bars start at zero on purpose: two laps 1% apart should
// look nearly the same, because they are.
function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((k) => k * mag >= v) || 10;
  return step * mag;
}

// One label per number, both values beside it and a thin bar per lap under
// it, three columns from md up and one on a phone.
function LapProfile({ profileA, profileB, colorA, colorB }) {
  const rows = PROFILE.filter((m) => profileA[m.key] != null);
  const value = (p, m) => (p?.[m.key] == null ? "n/a" : p[m.key].toFixed(m.digits));
  const bar = (p, top, key, color) => (
    <span className="block h-1 overflow-hidden rounded-full bg-surface2">
      {p?.[key] != null && <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, (p[key] / top) * 100))}%`, background: color }} />}
    </span>
  );
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-3">
      {rows.map((m) => {
        const top = niceMax(Math.max(profileA[m.key] ?? 0, profileB?.[m.key] ?? 0));
        return (
          <div key={m.key} className="min-w-0" title={m.hint}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <dt className="min-w-0 truncate text-light">{m.label}{m.unit && <span className="text-faint"> {m.unit}</span>}</dt>
              <dd className="shrink-0 font-mono tabular-nums">
                <span className="font-bold text-dark">{value(profileA, m)}</span>
                {profileB && <><span className="text-faint"> / </span><span className="text-medium">{value(profileB, m)}</span></>}
              </dd>
            </div>
            <span className="mt-1 block space-y-0.5" aria-hidden="true">
              {bar(profileA, top, m.key, colorA)}
              {profileB && bar(profileB, top, m.key, colorB)}
            </span>
          </div>
        );
      })}
    </dl>
  );
}

export default function TelemetryOverview({ sectors, sectorsReal, profileA, profileB, colorA, colorB, nameA, nameB, dist, n, onSector }) {
  const both = !!(sectors && profileB);
  return (
    <Panel title="At a glance" icon={Gauge} note={both ? "Sectors, and what each lap was made of" : "What this lap was made of"} bodyClassName="space-y-4"
      actions={<Legend nameA={nameA} nameB={both ? nameB : null} colorA={colorA} colorB={colorB} />}>
      {both && (
        <div className="min-w-0">
          <PanelHeading title="Sectors"
            note={sectorsReal ? "The server's sectors · select one to zoom" : "Equal thirds of the lap until the server's sector lines are known here · select one to zoom"} />
          <SectorCards sectors={sectors} colorA={colorA} colorB={colorB} nameA={nameA} nameB={nameB} dist={dist} n={n} onSelect={onSector} />
        </div>
      )}
      <div className={both ? "border-t border-border pt-4" : ""}>
        <PanelHeading title="Lap profile" note="Shares are of lap time" />
        <LapProfile profileA={profileA} profileB={profileB} colorA={colorA} colorB={colorB} />
      </div>
    </Panel>
  );
}
