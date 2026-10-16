// Compare within your tier: one shared choice for the whole page, the whole
// field (the default), Tier 1 or Tier 2. Every reading that ranks the driver
// against the field (the Pace tiles and their Compare tables, the finishing
// card's grid-to-flag track, the starters beaten, the final classification)
// reads it from here, so they all switch together. The replay never does: it
// is the race as it was run.
//
// A driver's tier in a round is the tier of the seat they raced in: a reserve
// standing in for a Tier 2 team races, and is classified, in Tier 2 that
// night (the same reading as the league's own Tier 2 re-rank of a round,
// services/raceDetailService.js). Reserves who drove for nobody (tier 0) are
// part of the whole field only.
import { createContext, useContext, useMemo } from "react";

export const tierOf = (r) => r?.effectiveTeam?.tier || r?.team?.tier || r?.driverTier || 0;

const CmpCtx = createContext(null);
const NONE = { available: false, tier: "all", live: false, youIn: true, youTier: 0, keep: () => true, word: "Field", label: "Whole field", count: 0, set: () => {} };
export const useCmp = () => useContext(CmpCtx) || NONE;

// `results` is the shown race's classification; `you` the driver's seat.
export function useCmpValue(results, you, tier, setTier, live) {
  return useMemo(() => {
    const byId = new Map((results || []).map((r) => [r.driverId, tierOf(r)]));
    const started = (results || []).filter((r) => r.status !== "DNS");
    const n1 = started.filter((r) => byId.get(r.driverId) === 1).length;
    const n2 = started.filter((r) => byId.get(r.driverId) === 2).length;
    const available = n1 > 0 && n2 > 0;
    const t = available ? tier : "all";
    const youTier = you ? byId.get(you.driverId) || 0 : 0;
    const keep = t === "all" ? () => true : (r) => (r?.driverId != null ? byId.get(r.driverId) : tierOf(r)) === t;
    return {
      available,
      tier: t,
      set: setTier,
      live,
      byId,
      youTier,
      youIn: t === "all" || youTier === t,
      keep,
      word: t === "all" ? "Field" : `Tier ${t}`,
      label: t === "all" ? "Whole field" : `Tier ${t}`,
      // The starters the comparison is made against.
      count: t === "all" ? started.length : t === 1 ? n1 : n2,
      counts: { all: started.length, 1: n1, 2: n2 },
    };
  }, [results, you, tier, setTier, live]);
}

export function CmpProvider({ value, children }) {
  return <CmpCtx.Provider value={value}>{children}</CmpCtx.Provider>;
}

// The switch, in the site's segmented look (a well with a card-coloured pill;
// TelemetryUI's Segmented). The pill moves by transform only: the three
// segments are equal, so it slides a whole segment at a time.
export function TierSwitch({ className = "", compact = false }) {
  const c = useCmp();
  if (!c.available) return null;
  const items = [
    { key: "all", label: compact ? "All" : "Whole field" },
    { key: 1, label: "Tier 1" },
    { key: 2, label: "Tier 2" },
  ];
  const idx = Math.max(0, items.findIndex((it) => it.key === c.tier));
  return (
    <div role="group" aria-label="Compare against" className={`rr-seg relative grid grid-cols-3 rounded-lg border border-border bg-surface2 p-0.5 ${className}`}>
      <span className="rr-seg-pill pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 rounded-md bg-card shadow-sm" style={{ transform: `translateX(${idx * 100}%)` }} aria-hidden="true" />
      {items.map((it) => {
        const on = it.key === c.tier;
        const mine = it.key === c.youTier;
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={on}
            onClick={() => c.set(it.key)}
            className={`relative z-10 inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-bold transition-colors max-sm:min-h-[34px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${on ? "text-dark" : "text-light hover:text-dark"}`}
          >
            {it.label}
            {mine && (
              <span className="rr-seg-you font-mono text-[8px] font-bold uppercase leading-none tracking-[0.14em]" aria-label="(your tier)">
                you
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// The sentence beside the switch: what the numbers are being set against.
export function cmpLine(c) {
  if (c.tier === "all") return `All ${c.count} starters, both tiers and the reserves`;
  if (!c.youIn) return `You're not in this tier: the ${c.count} ${c.label} starters, without you`;
  return `The ${c.count} ${c.label} starters, you among them`;
}

// The driver's place within the shown tier, worked out from the classification
// and, lap by lap, from the lap chart. null pieces when the data is missing.
export function tierPlaces({ c, you, results, chart }) {
  if (!you || c.tier === "all" || !c.youIn) return null;
  const rows = (results || []).filter((r) => r.status !== "DNS" && c.keep(r));
  const others = rows.filter((r) => r.driverId !== you.driverId);
  const field = rows.length;
  const grid = you.grid != null ? 1 + others.filter((r) => r.grid != null && r.grid < you.grid).length : null;
  const place = you.position != null ? 1 + others.filter((r) => r.position != null && r.position < you.position).length : null;
  const classified = rows.filter((r) => r.status === "FINISHED").length;
  let laps = null;
  const mine = chart?.drivers?.find((d) => d.driverId === you.driverId);
  if (mine) {
    const at = new Map(others.map((r) => [r.driverId, null]));
    const lanes = chart.drivers.filter((d) => at.has(d.driverId)).map((d) => new Map(d.points.map((p) => [p.lap, p.position])));
    laps = mine.points
      .filter((p) => p.position != null)
      .map((p) => ({ lap: p.lap, position: 1 + lanes.filter((m) => m.get(p.lap) != null && m.get(p.lap) < p.position).length }));
  }
  let best = null;
  let bestRun = null;
  if (laps?.length) {
    best = Math.min(...laps.map((l) => l.position));
    let s = null;
    for (const l of laps) {
      if (l.position === best) {
        if (s == null) s = l.lap;
        if (!bestRun || l.lap - s > bestRun.to - bestRun.from) bestRun = { from: s, to: l.lap };
      } else s = null;
    }
  }
  return { field, grid, place, classified, best, bestRun, lap1: laps && laps.length >= 5 ? laps[0].position : null };
}
