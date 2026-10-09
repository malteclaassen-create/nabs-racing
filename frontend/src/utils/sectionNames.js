// ---------------------------------------------------------------------------
// One name per place on the lap comparison, and one name per lap.
//
// The comparison finds its "slow sections" off lap A's speed trace (utils/
// telemetryAnalysis.js), and for a long time every part of the page named
// them its own way: the tips said "T8", the overview "2", the map "section 2"
// and the list at the bottom said outright that its numbers were not the
// circuit's. The circuit's corners are known (lib/trackProfile.js on the
// backend), so every part now asks here and gets the same answer.
//
// A section is named after the corners the car slows down for inside it: one
// corner is "T8", a run of them "T1–T3". A section with no named corner near
// it keeps its number.
// ---------------------------------------------------------------------------
import { cornerName } from "./drivingTips.js";
import { approachStart, speedDips } from "./telemetryAnalysis.js";

// How far (percent of lap) past a corner's slowest point its marked position
// may sit and still count as that corner.
const EDGE_PCT = 1;

// The named corners inside one section, in lap order: from where the car
// starts slowing for its first dip to the slowest point of its last. Without
// a speed trace, the whole slow part.
export function cornersIn(section, corners, n, lap = null) {
  if (!corners?.length || n < 2) return [];
  const pct = (i) => (i / (n - 1)) * 100;
  let from = pct(section.coreStart ?? section.start) - EDGE_PCT;
  let to = pct(section.coreEnd ?? section.end) + EDGE_PCT;
  if (lap?.speed) {
    const dips = speedDips(lap.speed, section.coreStart ?? section.start, section.coreEnd ?? section.end);
    if (!dips.includes(section.apex)) dips.push(section.apex);
    dips.sort((a, b) => a - b);
    from = pct(approachStart(lap, section.start, dips[0]));
    to = pct(dips[dips.length - 1]) + EDGE_PCT;
  }
  const inside = corners.filter((c) => c.at >= from && c.at <= to).sort((a, b) => a.at - b.at);
  return inside;
}

// "T8", "T7 Memorial", "T1–T3", or null when the circuit's corners are not
// known here. `lap` is lap A, whose speed trace the sections were found on.
export function sectionLabel(section, corners, n, lap = null, taken = null) {
  // A corner names one section only. Two sections close together can both
  // reach back over the same marked corner (Interlagos' T8 sat in the
  // approach of the section after it, and both were called "T8 Laranjinha").
  const free = taken ? corners.filter((c) => !taken.has(c)) : corners;
  const inside = cornersIn(section, free, n, lap);
  const name = (c) => (c.turn != null ? `T${c.turn}${inside.length === 1 && c.name ? ` ${c.name}` : ""}` : c.name);
  if (inside.length === 1) return name(inside[0]);
  if (inside.length > 1) {
    const first = inside[0], last = inside[inside.length - 1];
    if (first.turn != null && last.turn != null) return `T${first.turn}–T${last.turn}`;
    return `${name(first)} – ${name(last)}`;
  }
  // Nothing inside: the nearest corner to the apex, when it is close.
  const near = cornerName((section.apex / (n - 1)) * 100, free);
  return near ? near.label : null;
}

// Every section with its `label` (the name, or "Section 4") and `tag` (what
// fits in a small circle on the map: "T8", "T1–3", "4").
export function labelSections(sections, corners, n, lap = null) {
  // In lap order, each section keeping the corners it was named after.
  const taken = new Set();
  const all = corners || [];
  return sections.map((s) => {
    const label = sectionLabel(s, all, n, lap, taken);
    const free = all.filter((c) => !taken.has(c));
    for (const c of cornersIn(s, free, n, lap)) taken.add(c);
    if (label && !cornersIn(s, free, n, lap).length) {
      const near = cornerName((s.apex / (n - 1)) * 100, free);
      if (near) for (const c of free) if (c.turn === near.turn && c.name === near.name) taken.add(c);
    }
    const tag = label ? label.split(" ")[0].replace(/^T(\d+)–T(\d+)$/, "T$1–$2") : String(s.n);
    return { ...s, label: label || `Section ${s.n}`, tag, named: !!label };
  });
}

// What to call the two laps everywhere on the page. Two drivers: their names.
// One driver's two laps: the lap times, since "Malte against Malte" says
// nothing. Before a lap is loaded, the letters.
export function lapNames(lapA, lapB, formatTime) {
  const a = lapA?.name || "Lap A";
  const b = lapB?.name || "Lap B";
  if (lapA && lapB && (a === b || (lapA.steamId && lapA.steamId === lapB.steamId))) {
    return { a: formatTime(lapA.lapTimeMs), b: formatTime(lapB.lapTimeMs), same: true };
  }
  return { a, b, same: false };
}
