import { DivergingBar, fmt, who, sectionFacts } from "./TelemetrySections.jsx";
import { formatLapTime } from "../utils/telemetryAnalysis.js";

// ---------------------------------------------------------------------------
// The comparison at a glance, above the map and the traces: the three sectors
// with both times, the places the two laps differ most, and what each lap was
// made of. Everything here is a door into the detail below it: a sector or a
// section zooms the traces to that stretch.
// ---------------------------------------------------------------------------

// "2,846–5,681 m" or "33–67%": one unit for the pair.
const span = (from, to, dist, n) => (dist
  ? `${Math.round(dist[from]).toLocaleString("en-GB")}–${Math.round(dist[to]).toLocaleString("en-GB")} m`
  : `${Math.round((from / (n - 1)) * 100)}–${Math.round((to / (n - 1)) * 100)}%`);
const sectorTime = (ms) => (ms >= 60000 ? formatLapTime(ms) : (ms / 1000).toFixed(3));

function PanelHeading({ title, note }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="text-xs font-semibold text-dark">{title}</h3>
      {note && <p className="text-[11px] text-light">{note}</p>}
    </div>
  );
}

// One sector: both times, the quicker one in its lap's colour, and the bar
// that grows towards whoever gained. The three add up to the finish-line gap.
function SectorCards({ sectors, colorA, colorB, dist, n, onSelect }) {
  const max = Math.max(50, ...sectors.map((s) => Math.abs(s.deltaMs)));
  return (
    <div className="grid grid-cols-3 gap-2">
      {sectors.map((s) => {
        const even = Math.abs(s.deltaMs) < 5;
        const side = who(s.deltaMs);
        const time = (lap, ms, color) => {
          const quicker = !even && side === lap;
          return (
            <span className="flex items-baseline justify-between gap-1">
              <span className="font-mono text-[10px] font-bold" style={{ color }}>{lap}</span>
              <span className={`font-mono tabular-nums ${quicker ? "font-bold text-dark" : "text-light"}`}>{sectorTime(ms)}</span>
            </span>
          );
        };
        return (
          <button key={s.n} type="button" onClick={() => onSelect?.(s)}
            className="min-w-0 rounded-lg border border-border bg-card px-2.5 py-2 text-left text-xs transition hover:border-medium hover:bg-surface2 sm:px-3"
            title={`Zoom the traces to sector ${s.n}`}>
            <span className="flex items-baseline justify-between gap-1">
              <span className="font-mono text-[11px] font-bold text-dark">S{s.n}</span>
              <span className="hidden truncate font-mono text-[10px] tabular-nums text-light sm:inline">{span(s.from, s.to, dist, n)}</span>
            </span>
            <span className="mt-1.5 block space-y-0.5 text-[11px] sm:text-xs">
              {time("A", s.timeA, colorA)}
              {time("B", s.timeB, colorB)}
            </span>
            <DivergingBar value={s.deltaMs} max={max} colorA={colorA} colorB={colorB} className="mt-2 h-1.5" />
            <span className="mt-1 block truncate text-right font-mono text-[11px] font-semibold tabular-nums" style={{ color: even ? "var(--c-text3)" : side === "A" ? colorA : colorB }}>
              {even ? "even" : `${side} +${fmt(s.deltaMs)} s`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// The sections where the most time changes hands, biggest first, each with the
// facts behind it. The same numbers as the full list at the bottom, sorted for
// the question everybody opens the page with.
function BiggestDifferences({ insights, colorA, colorB, onSelect }) {
  const top = [...insights].filter((c) => Math.abs(c.gainMs) >= 10).sort((x, y) => Math.abs(y.gainMs) - Math.abs(x.gainMs)).slice(0, 3);
  if (!top.length) return <p className="py-2 text-xs text-light">No slow section differs by more than a hundredth — these two laps are level through the corners.</p>;
  return (
    <ol className="space-y-1.5">
      {top.map((c) => {
        const color = who(c.gainMs) === "A" ? colorA : colorB;
        const facts = sectionFacts(c);
        return (
          <li key={c.n}>
            <button type="button" onClick={() => onSelect(c)} title={`Zoom the traces to section ${c.n}`}
              className="flex w-full items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs transition hover:border-medium hover:bg-surface2">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[10px] font-bold text-dark">{c.n}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-mono text-[11px] tabular-nums text-light">{c.atPct}% of lap{c.atM != null ? ` · ${c.atM.toLocaleString("en-GB")} m` : ""}</span>
                  <span className="font-mono font-bold tabular-nums" style={{ color }}>{who(c.gainMs)} +{fmt(c.gainMs)} s</span>
                </span>
                <span className="mt-0.5 block text-[11px] text-light">{facts.slice(0, 2).join(" · ") || "no large difference in the sampled inputs"}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
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
  { key: "minSpeed", label: "Slowest", unit: "km/h", digits: 0, hint: "Lowest speed anywhere on the lap" },
  { key: "avgSpeed", label: "Average", unit: "km/h", digits: 1, hint: "Distance over time" },
  { key: "peakBrakeG", label: "Peak braking", unit: "g", digits: 1, hint: "Derived from the speed trace" },
  { key: "peakLatG", label: "Peak lateral", unit: "g", digits: 1, hint: "Derived from the recorded line" },
  { key: "shifts", label: "Gear shifts", unit: "", digits: 0 },
];

function LapProfile({ profileA, profileB, colorA, colorB }) {
  const rows = PROFILE.filter((m) => profileA[m.key] != null);
  // The unit rides in the label, so the value keeps the room a phone's
  // three-across tiles have: "304.2", not "304.2 km/h" cut to "304.2 k…".
  const value = (p, m) => (p?.[m.key] == null ? "—" : p[m.key].toFixed(m.digits));
  return (
    <dl className="grid grid-cols-3 gap-2 lg:grid-cols-9">
      {rows.map((m) => (
        <div key={m.key} className="flex min-w-0 flex-col justify-between rounded-lg border border-border bg-card px-2 py-2 sm:px-2.5" title={m.hint}>
          <dt className="text-[11px] leading-tight text-light">{m.label}{m.unit && <span className="text-faint"> {m.unit}</span>}</dt>
          <dd className="mt-1 space-y-0.5 font-mono text-xs tabular-nums">
            <span className="flex items-baseline justify-between gap-1"><span className="text-[10px] font-bold" style={{ color: colorA }}>A</span><span className="truncate font-semibold text-dark">{value(profileA, m)}</span></span>
            {profileB && <span className="flex items-baseline justify-between gap-1"><span className="text-[10px] font-bold" style={{ color: colorB }}>B</span><span className="truncate text-medium">{value(profileB, m)}</span></span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function TelemetryOverview({ sectors, insights, profileA, profileB, colorA, colorB, dist, n, onSector, onSection }) {
  const both = !!(sectors && profileB);
  return (
    <section aria-label="Comparison overview" className="space-y-4 rounded-xl border border-border bg-surface2/30 p-3 sm:p-4">
      {both && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <PanelHeading title="Sectors" note="Equal thirds of the lap · select one to zoom" />
            <SectorCards sectors={sectors} colorA={colorA} colorB={colorB} dist={dist} n={n} onSelect={onSector} />
          </div>
          <div className="min-w-0">
            <PanelHeading title="Biggest differences" note="Slow sections, most time first" />
            <BiggestDifferences insights={insights} colorA={colorA} colorB={colorB} onSelect={onSection} />
          </div>
        </div>
      )}
      <div className={both ? "border-t border-border pt-4" : ""}>
        <PanelHeading title="Lap profile" note="Shares are of lap time" />
        <LapProfile profileA={profileA} profileB={profileB} colorA={colorA} colorB={colorB} />
      </div>
    </section>
  );
}
