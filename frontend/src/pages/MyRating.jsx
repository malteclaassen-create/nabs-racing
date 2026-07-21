import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Skeleton, CountUp } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import { RATING_INFO } from "../components/RatingCard.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";
import { flagFor } from "../data/circuits.js";

// ---------------------------------------------------------------------------
// "My Rating" — the private deep dive behind the four numbers on the card.
// Own eyes only (the /me endpoint scopes it to the logged-in driver): the
// season curve per value, what each race did to the numbers, and where the
// strengths and weak spots sit. The public profile only ever shows the card.
// ---------------------------------------------------------------------------

// The five plottable series. `overall` reuses the card's RTG label; the four
// sub-ratings borrow their plain-words explanations from the card.
const SERIES = [
  { key: "overall", code: "RTG", label: "Overall" },
  { key: "rac", code: "RAC", label: "Racecraft" },
  { key: "aha", code: "AWA", label: "Awareness" },
  { key: "pac", code: "PAC", label: "Pace" },
  { key: "exp", code: "EXP", label: "Experience" },
];

// What feeds each sub-rating, in the order the formula weighs them. EXP is
// absolute (shares of the formula, not a field ranking) — flagged so the bars
// can be labelled honestly.
const COMPONENT_INFO = {
  rac: {
    title: "Racecraft",
    note: "How you race on Sundays. Measured on this season only and ranked against everyone else in the field.",
    parts: [
      { k: "finish", label: "Finishing positions", hint: "where you cross the line · higher = better" },
      { k: "gained", label: "Places gained", hint: "grid slot to chequered flag · more = better" },
      { k: "podium", label: "Podiums", hint: "starts ending in the top three · more = better" },
      { k: "overtakes", label: "On-track overtakes", hint: "passes counted from telemetry · more = better" },
    ],
  },
  aha: {
    title: "Awareness",
    note: "How cleanly and reliably you drive. Ranked against everyone else in the field.",
    parts: [
      { k: "finishRate", label: "Finish rate", hint: "starts you bring home · more = better" },
      { k: "consistency", label: "Lap consistency", hint: "spread of your clean laps · steadier = better" },
      { k: "dnf", label: "Few DNFs", hint: "retirements and DSQs · fewer = better" },
      { k: "contacts", label: "Car contacts", hint: "car-to-car touches · fewer = better" },
      { k: "env", label: "Off-track hits", hint: "walls, barriers, scenery · fewer = better" },
      { k: "penalties", label: "In-game penalties", hint: "cuts and speeding · fewer = better" },
    ],
  },
  pac: {
    title: "Pace",
    note: "Raw one-lap and race speed. Looks at your whole career window, ranked against the season's regulars.",
    parts: [
      { k: "quali", label: "Grid slots", hint: "average starting position · further up = better" },
      { k: "bestLap", label: "Best-lap gap", hint: "your best lap vs the race's fastest · smaller = better" },
      { k: "consistency", label: "Consistency %", hint: "steadiness of your lap times · higher = better" },
    ],
  },
  exp: {
    title: "Experience",
    note: "Your career mileage and record. This is an absolute score: only YOUR history counts, nobody else's results can move it.",
    absolute: true,
    parts: [
      { k: "starts", label: "Race starts", hint: "60 starts in the window = full block" },
      { k: "championship", label: "Championship record", hint: "your and your teams' standings · recent seasons weigh most" },
      { k: "finishing", label: "Finisher bonus", hint: "all or nothing: finish 95% of your races" },
      { k: "activity", label: "Seasons active", hint: "seasons raced within the window" },
    ],
  },
};

const fmtDelta = (d) => (d > 0 ? `+${d}` : `${d}`);
const deltaColor = (d) => (d > 0 ? "#16a34a" : d < 0 ? "#dc2626" : undefined);

// One little cause chip in the round-by-round list: green for things that push
// ratings up, red for things that drag them down, neutral grey otherwise.
// One value's move after a round, as a solid pill: the code stays quiet, the
// number carries an arrow and the colour. Unchanged reads as a calm "±0" so
// the eye skips it.
function DeltaPill({ value, code }) {
  const d = value ?? null;
  const cls =
    d == null || d === 0
      ? "bg-surface2 text-light"
      : d > 0
        ? "bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300"
        : "bg-red-500/[0.12] text-red-700 dark:text-red-300";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[13px] font-bold tabular-nums ${cls}`}>
      <span className="text-[10px] uppercase tracking-wider opacity-60">{code}</span>
      {d == null ? "–" : d === 0 ? "±0" : d > 0 ? `▲${d}` : `▼${-d}`}
    </span>
  );
}

// A cause chip. Colour carries the verdict, but the text stays high-contrast
// (a strong shade on a barely-tinted background) instead of red-on-red.
function Cause({ tone, children }) {
  const cls =
    tone === "good"
      ? "bg-emerald-500/[0.07] text-emerald-700 ring-emerald-600/35 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/35"
      : tone === "bad"
        ? "bg-red-500/[0.07] text-red-700 ring-red-600/35 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/35"
        : "bg-surface2 text-medium ring-border";
  return (
    <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-[13px] font-bold ring-1 ${cls}`}>
      {children}
    </span>
  );
}

// The plain-words cause chips for one race, derived from the same facts the
// formula reads. Kept honest: only signals that actually feed a rating.
function causesFor(r) {
  const out = [];
  if (!r.raced) return out;
  if (r.status === "DNF" || r.status === "DSQ") {
    out.push({ tone: "bad", text: r.status === "DSQ" ? "Disqualified" : "Retired", hits: "AWA · RAC" });
  }
  if (r.win) out.push({ tone: "good", text: "Race win", hits: "RAC" });
  else if (r.podium) out.push({ tone: "good", text: "Podium", hits: "RAC" });
  if (r.gained != null && r.gained > 0) out.push({ tone: "good", text: `Gained ${r.gained} place${r.gained === 1 ? "" : "s"}`, hits: "RAC" });
  if (r.gained != null && r.gained < 0) out.push({ tone: "bad", text: `Lost ${-r.gained} place${r.gained === -1 ? "" : "s"}`, hits: "RAC" });
  if (r.overtakes != null && r.overtakes > 0) out.push({ tone: "good", text: `${r.overtakes} overtake${r.overtakes === 1 ? "" : "s"}`, hits: "RAC" });
  if (r.contacts != null && r.contacts > 0) out.push({ tone: "bad", text: `${r.contacts} contact${r.contacts === 1 ? "" : "s"}`, hits: "AWA" });
  if (r.contacts === 0) out.push({ tone: "good", text: "Contact-free", hits: "AWA" });
  if (r.envContacts != null && r.envContacts > 2) out.push({ tone: "bad", text: `${r.envContacts} off-track hits`, hits: "AWA" });
  if (r.gamePenalties != null && r.gamePenalties > 0) out.push({ tone: "bad", text: `${r.gamePenalties} penalt${r.gamePenalties === 1 ? "y" : "ies"}`, hits: "AWA" });
  if (r.bestLapGapPct != null && r.bestLapGapPct <= 1) out.push({ tone: "good", text: `Best lap +${r.bestLapGapPct}%`, hits: "PAC" });
  return out;
}

// Line chart of one rating series: stretched SVG with a crisp non-scaling
// stroke, dashed gridlines, a soft area fill, one dot per race and a hover
// card reporting what that race did. `career` = the all-time view, where the
// points span several seasons (dashed separators, season names under the
// axis) instead of a single season's rounds.
function RatingChart({ points, statKey, color, career = false, perRace = false }) {
  // { i, x, y } — index plus the hovered dot's position ON SCREEN, so the card
  // can be positioned fixed and float clear of the plot (which scrolls
  // horizontally and would otherwise clip it).
  const [hover, setHover] = useState(null);
  const rated = points.map((p, i) => (p.ratings ? { i, v: p.ratings[statKey] } : null)).filter(Boolean);
  if (rated.length === 0) return <div className="p-6 text-sm text-light">No rated rounds yet.</div>;
  const N = points.length;
  const vals = rated.map((r) => r.v);
  const lo = Math.max(0, Math.min(...vals) - 3);
  const hi = Math.min(99, Math.max(...vals) + 3);
  const span = Math.max(1, hi - lo);
  const yPct = (v) => 8 + (1 - (v - lo) / span) * 84;

  const step = span <= 8 ? 2 : span <= 20 ? 5 : 10;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);

  const line = rated.map((r) => ({ x: r.i + 0.5, y: yPct(r.v) }));
  const d = line.map((pt, k) => `${k ? "L" : "M"}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(" ");
  const areaD = line.length > 1 ? `${d} L${line[line.length - 1].x.toFixed(2)},100 L${line[0].x.toFixed(2)},100 Z` : null;
  const gradId = `rt-grad-${statKey}${career ? "-c" : ""}`;
  // The per-race career view packs far more points in, so each gets a
  // narrower column (and scrolls sideways once even that runs out).
  const minW = Math.max(360, N * (perRace ? 34 : 62));
  const seasonBest = Math.max(...vals);
  const seasonLow = Math.min(...vals);

  // Season blocks for the all-time axis: where each season starts and how many
  // races it contributes, so its name can sit centred under its own block.
  const groups = [];
  points.forEach((p, i) => {
    const key = p.seasonNumber ?? null;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.count++;
    else groups.push({ key, from: i, count: 1, label: p.seasonName || (key != null ? `Season ${key}` : "") });
  });

  const hp = hover ? points[hover.i] : null;
  const hv = hp?.ratings ? hp.ratings[statKey] : null;

  return (
    <div className="scrollbar-slim w-full overflow-x-auto">
      <div className="flex h-72 flex-col" style={{ minWidth: minW + 40 }}>
        <div className="flex min-h-0 flex-1 items-stretch gap-2">
          {/* pinned y-axis */}
          <div className="sticky left-0 z-10 w-8 shrink-0 bg-card">
            <div className="relative h-full">
              {ticks.map((v) => (
                <span key={v} className="absolute right-0 -translate-y-1/2 font-mono text-[10px] font-bold tabular-nums text-faint" style={{ top: `${yPct(v)}%` }}>
                  {v}
                </span>
              ))}
            </div>
          </div>
          <div className="relative flex-1">
            {ticks.map((v) => (
              <span key={v} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${yPct(v)}%` }} />
            ))}
            {/* season separators (only where a season spans several points) */}
            {perRace &&
              groups.slice(1).map((g) => (
                <span
                  key={`sep-${g.from}`}
                  className="absolute inset-y-0 border-l border-dashed border-border"
                  style={{ left: `${(g.from / N) * 100}%` }}
                />
              ))}
            {/* keyed on the shown series: switching RAC/AWA/... remounts the
                plot, so it wipes in from the left again instead of the dots
                sliding vertically from their old values to the new ones */}
            <div key={`${statKey}-${career ? "c" : "s"}`} className="wipe-ltr absolute inset-0" style={{ "--wipe-dur": "1.2s" }}>
              <svg viewBox={`0 0 ${N} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {areaD && <path d={areaD} fill={`url(#${gradId})`} stroke="none" />}
                {line.length > 1 && (
                  <path d={d} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                )}
              </svg>
              <div className="absolute inset-0 flex">
                {points.map((p, i) => {
                  const r = p.ratings ? p.ratings[statKey] : null;
                  const isHover = hover?.i === i;
                  // the run's high and low get a coloured ring, so the peaks
                  // read without hunting through the numbers
                  const ring = r == null ? null : r === seasonBest ? "#16a34a" : r === seasonLow && seasonLow !== seasonBest ? "#dc2626" : null;
                  return (
                    // the whole column is the hover target, so the pointer
                    // catches a race anywhere above or below its dot
                    <div
                      key={p.raceId || i}
                      className="relative flex-1"
                      onMouseEnter={(e) => {
                        // remember where this dot sits on screen, so the card
                        // can float above it outside the plot's own bounds
                        const box = e.currentTarget.getBoundingClientRect();
                        setHover({
                          i,
                          x: box.left + box.width / 2,
                          y: box.top + (r != null ? (yPct(r) / 100) * box.height : box.height / 2),
                        });
                      }}
                      onMouseLeave={() => setHover((cur) => (cur?.i === i ? null : cur))}
                    >
                      {isHover && <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />}
                      {r != null && (
                        <>
                          {ring && (
                            <span
                              className="absolute h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                              style={{ left: "50%", top: `${yPct(r)}%`, boxShadow: `0 0 0 2px ${ring}` }}
                            />
                          )}
                          {/* only the hover grow is animated — never the
                              position, or a series switch would slide every
                              dot vertically to its new value */}
                          <span
                            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card transition-[width,height] duration-150"
                            style={{
                              left: "50%",
                              top: `${yPct(r)}%`,
                              backgroundColor: color,
                              width: isHover ? 18 : 14,
                              height: isHover ? 18 : 14,
                            }}
                          />
                          {/* the value rides along only where there's room;
                              in the dense per-race view the hover card
                              carries it instead */}
                          {!perRace && (
                            <span
                              className="absolute -translate-x-1/2 font-display text-xs font-black tabular-nums text-dark"
                              style={{ left: "50%", top: `calc(${yPct(r)}% - 1.6rem)` }}
                            >
                              {r}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Hover card. Rendered through a PORTAL onto the body: the plot
                  scrolls horizontally and its ancestors carry transforms (the
                  reveal + wipe animations), which would both clip the card and
                  break `fixed` positioning. On the body it floats free above
                  everything and sits above the dot (below it near the top of
                  the screen), so it never covers the point being read. */}
              {hp &&
                createPortal(
                  <div
                    className="pointer-events-none fixed z-50 w-max max-w-[17rem] rounded-xl border border-border bg-card p-3.5 text-left shadow-2xl shadow-ink/30"
                    style={{
                      left: Math.min(Math.max(hover.x, 150), window.innerWidth - 150),
                      ...(hover.y > 260
                        ? { top: hover.y - 18, transform: "translate(-50%, -100%)" }
                        : { top: hover.y + 18, transform: "translate(-50%, 0)" }),
                    }}
                  >
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                    <span className="font-display text-lg font-black uppercase leading-tight tracking-tight text-dark">{hp.track}</span>
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-light">
                      {career
                        ? perRace && hp.seasonNumber != null
                          ? `S${hp.seasonNumber} · R${hp.number}`
                          : `${hp.races ?? ""}${hp.races ? " races" : ""}`
                        : `Round ${hp.number}`}
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2.5">
                    <span className="font-display text-3xl font-black leading-none tabular-nums" style={{ color }}>
                      {hv ?? "–"}
                    </span>
                    {hp.delta?.[statKey] != null && (
                      <span
                        className="rounded-md px-1.5 py-0.5 font-mono text-sm font-bold tabular-nums"
                        style={{
                          color: hp.delta[statKey] > 0 ? "#16a34a" : hp.delta[statKey] < 0 ? "#dc2626" : undefined,
                          backgroundColor:
                            hp.delta[statKey] > 0
                              ? "rgba(22,163,74,0.12)"
                              : hp.delta[statKey] < 0
                                ? "rgba(220,38,38,0.12)"
                                : "transparent",
                        }}
                      >
                        {hp.delta[statKey] === 0
                          ? "±0"
                          : hp.delta[statKey] > 0
                            ? `▲${hp.delta[statKey]}`
                            : `▼${-hp.delta[statKey]}`}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-medium">
                    {hp.race
                      ? hp.race.raced
                        ? `${hp.race.position != null ? `P${hp.race.position}` : hp.race.status}${hp.race.grid != null ? ` from P${hp.race.grid}` : ""}`
                        : "Did not race"
                      : /* season point: its headline numbers instead */
                        [
                          hp.starts != null && `${hp.starts} start${hp.starts === 1 ? "" : "s"}`,
                          hp.wins ? `${hp.wins} win${hp.wins === 1 ? "" : "s"}` : null,
                          hp.podiums ? `${hp.podiums} podium${hp.podiums === 1 ? "" : "s"}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </div>
                  {hp.rank != null && (
                    <div className="mt-0.5 font-mono text-xs uppercase tracking-wide text-light">
                      #{hp.rank} of {hp.fieldSize} rated
                    </div>
                  )}
                  </div>,
                  document.body
                )}
            </div>
          </div>
        </div>
        {/* x-axis: round (plus the circuit where there is room); in the
            all-time view the season name spans its own block of races */}
        <div className="ml-10 flex pt-2.5">
          {points.map((p, i) => (
            <div key={p.raceId || i} className="min-w-0 flex-1 px-0.5 text-center">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wide text-faint">
                {career && !perRace ? `S${p.number}` : p.number}
              </div>
              {!perRace && (
                <div className="truncate font-display text-[11px] font-bold uppercase tracking-tight text-light" title={p.track}>
                  {p.track}
                </div>
              )}
            </div>
          ))}
        </div>
        {perRace && (
          <div className="ml-10 mt-1.5 flex border-t border-border pt-1.5">
            {groups.map((g) => (
              <div key={g.from} className="min-w-0 px-1 text-center" style={{ flex: `${g.count} 1 0%` }}>
                <span className="block truncate font-display text-[11px] font-bold uppercase tracking-tight text-light">{g.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// "What goes into it": one block per sub-rating, its ingredients as quiet
// line-separated rows. Each row shows the formula weight and, where the value
// is a field ranking, how this driver ranks (percentile bar); EXP rows show
// the absolute share earned instead.
function fieldStanding(pct) {
  const top = Math.max(1, 100 - pct);
  const bottom = Math.max(1, pct);
  if (pct >= 67) return { text: `top ${top}%`, color: "#16a34a" };
  if (pct <= 33) return { text: `bottom ${bottom}%`, color: "#dc2626" };
  return { text: pct >= 50 ? `top ${top}%` : `bottom ${bottom}%`, color: null };
}

function CompositionBlock({ statKey, components, weights, color }) {
  const info = COMPONENT_INFO[statKey];
  const comp = components?.[statKey];
  const w = weights?.[statKey];
  if (!info || !comp || !w) return null;
  const wSum = info.parts.reduce((a, p) => a + (Number(w[p.k]) || 0), 0) || 1;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3.5 sm:px-6">
        <h3 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">
          {info.title}
          <span className="ml-2 font-mono text-[10px] font-semibold text-light">{RATING_INFO[statKey]?.code}</span>
        </h3>
        {info.absolute && (
          <span className="font-mono text-[10px] font-bold uppercase tracking-wide text-light">absolute scale</span>
        )}
      </div>
      <div className="divide-y divide-border">
        {info.parts.map((p) => {
          const share = Math.round(((Number(w[p.k]) || 0) / wSum) * 100);
          const pct = Math.round((Number(comp[p.k]) || 0) * 100);
          const standing = info.absolute ? null : fieldStanding(pct);
          return (
            // The one-line explanation lives in the tooltip, so the row stays
            // just label · weight · bar · standing.
            <div key={p.k} className="cursor-help px-5 py-3 sm:px-6" title={p.hint}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-sm font-bold text-dark">
                  {p.label}
                  <span className="ml-2 font-mono text-[10px] font-bold uppercase tracking-wide text-faint">{share}%</span>
                </span>
                <span
                  className="font-display text-base font-black uppercase tabular-nums tracking-tight"
                  style={standing?.color ? { color: standing.color } : undefined}
                >
                  {info.absolute ? `${pct}%` : standing.text}
                </span>
              </div>
              <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-surface2">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: standing?.color || color }} />
                {!info.absolute && <span className="absolute inset-y-0 left-1/2 w-px bg-faint/40" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Your strongest and weakest ingredients across the three field-ranked
// sub-ratings, plus the round that lifted you most and the one that cost the
// most — the "where do I gain, where do I bleed" summary up top.
function buildHighlights(rating, points) {
  const ranked = [];
  for (const statKey of ["rac", "aha", "pac"]) {
    const info = COMPONENT_INFO[statKey];
    const comp = rating.components?.[statKey];
    const w = rating.weights?.[statKey];
    if (!comp || !w) continue;
    for (const p of info.parts) {
      if (!(Number(w[p.k]) > 0)) continue; // inert components can't cost or earn anything
      const v = Number(comp[p.k]);
      if (Number.isFinite(v)) ranked.push({ stat: RATING_INFO[statKey]?.code, label: p.label, v });
    }
  }
  ranked.sort((a, b) => b.v - a.v);
  const best = ranked[0] || null;
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  let up = null;
  let down = null;
  for (const p of points) {
    const d = p.delta?.overall;
    if (d == null) continue;
    if (d > 0 && (up == null || d > up.d)) up = { d, p };
    if (d < 0 && (down == null || d < down.d)) down = { d, p };
  }
  return { best, worst, up, down };
}

const HL_ICONS = {
  trophy: "M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM7 5H4v2a3 3 0 003 3M17 5h3v2a3 3 0 01-3 3",
  alert: "M10.3 4.3l-7.4 12.8A1.5 1.5 0 004.2 19.4h15.6a1.5 1.5 0 001.3-2.3L13.7 4.3a1.5 1.5 0 00-2.6 0zM12 9v4M12 16.5h.01",
  up: "M3 17l6-6 4 4 7-7M14 8h6v6",
  down: "M3 7l6 6 4-4 7 7M14 16h6v-6",
};

// One highlight tile: a soft-tinted icon chip and the eyebrow on top, the
// subject calm in the text colour, and the verdict line below carrying the
// green / red — so the colour marks the judgement, not the whole tile.
function HighlightTile({ icon, eyebrow, main, subPrefix, subValue, tone }) {
  const c = tone === "good" ? "#16a34a" : "#dc2626";
  const chipBg = tone === "good" ? "rgba(22,163,74,0.12)" : "rgba(220,38,38,0.12)";
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: chipBg, color: c }}>
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={HL_ICONS[icon]} />
          </svg>
        </span>
        <span className="font-mono text-[13px] font-bold uppercase tracking-[0.1em] text-dark">{eyebrow}</span>
      </div>
      {/* the subject reads as a sentence-case line, not shouted caps — long
          labels like "On-track overtakes" stay scannable */}
      <div className="mt-3 font-display text-[19px] font-extrabold leading-snug tracking-tight text-dark">{main}</div>
      <div className="mt-1.5 text-sm leading-snug">
        {subPrefix && <span className="font-semibold text-medium">{subPrefix} · </span>}
        <span className="font-bold" style={{ color: c }}>{subValue}</span>
      </div>
    </div>
  );
}

// `me` is the /api/me payload the Personal Area already holds (name, team, …).
export default function MyRating({ me }) {
  const { data, loading, error } = useApi(useCallback(() => api.myRatingHistory(), []));
  const [stat, setStat] = useState("overall");
  // "season" = this season round by round · "career" = across the seasons
  const [scope, setScope] = useState("season");
  // Inside the all-time view: one point per season, or every single race.
  const [grain, setGrain] = useState("seasons");
  // The per-race career curve is the expensive one, so it is fetched only when
  // the reader actually switches to it, and then kept.
  const [racePoints, setRacePoints] = useState(null);
  const [raceLoading, setRaceLoading] = useState(false);
  useEffect(() => {
    if (scope !== "career" || grain !== "races" || racePoints || raceLoading) return;
    setRaceLoading(true);
    api
      .myRatingCareer()
      .then((r) => setRacePoints(r.points || []))
      .catch(() => setRacePoints([]))
      .finally(() => setRaceLoading(false));
  }, [scope, grain, racePoints, raceLoading]);

  const points = data?.points || [];
  const ratedPoints = useMemo(() => points.filter((p) => p.race?.raced || p.ratings), [points]);

  if (loading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  // No rating yet (no starts this season) comes back as a 404 — show it kindly.
  if (error)
    return /no rating yet/i.test(String(error)) ? (
      <div className="card px-6 py-14 text-center">
        <h2 className="font-display text-2xl font-extrabold uppercase tracking-tight text-dark">No rating yet</h2>
        <p className="mt-2 text-sm text-medium">Start a race this season and your rating breakdown appears here.</p>
      </div>
    ) : (
      <ErrorBox message={error} />
    );

  const rating = data.current;
  const color = me?.team?.color || data.driver?.team?.color || "#3b4254";
  // The chart can zoom out: "season" = this season round by round, "career" =
  // the whole career, either one point per season or every race. The all-time
  // view only makes sense once the person has more than one rated season.
  const careerSeasons = data.careerSeasons || [];

  // Every new season starts here: no scored round yet, so there is no current
  // rating. Rather than an empty page, keep the career curve on show — for a
  // returning driver that is the interesting half anyway.
  if (!rating || ratedPoints.length === 0) {
    return (
      <div className="space-y-6">
        <div className="card px-6 py-12 text-center">
          <h2 className="font-display text-2xl font-extrabold uppercase tracking-tight text-dark">No rating this season yet</h2>
          <p className="mt-2 text-sm text-medium">
            Your card is rated once the season&rsquo;s first result is in. {careerSeasons.length > 0 && "Your earlier seasons are below."}
          </p>
        </div>
        {careerSeasons.length > 0 && (
          <div className="reveal card overflow-hidden">
            <div className="border-b border-border px-5 py-4 sm:px-6">
              <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Your seasons so far</h2>
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
                overall rating at the end of each season
              </span>
            </div>
            <div className="p-5 sm:p-6">
              <RatingChart points={careerSeasons} statKey="overall" color={color} career />
            </div>
          </div>
        )}
      </div>
    );
  }

  const latest = [...points].reverse().find((p) => p.ratings);
  const { best, worst, up, down } = buildHighlights(rating, points);

  const hasCareer = careerSeasons.length > 1;
  const inCareer = scope === "career" && hasCareer;
  const perRace = inCareer && grain === "races";
  const chartPoints = inCareer ? (perRace ? racePoints || [] : careerSeasons) : points;
  const chartFirst = chartPoints.find((p) => p.ratings);
  const chartLast = [...chartPoints].reverse().find((p) => p.ratings);
  const seasonMove =
    chartLast && chartFirst && chartLast !== chartFirst ? chartLast.ratings[stat] - chartFirst.ratings[stat] : null;

  // The four highlights as plain data, for the variants that render them in
  // their own visual language instead of the tile component.
  const hl = [
    best && { key: "s", icon: "trophy", eyebrow: "Biggest strength", tone: "good", main: best.label, subPrefix: best.stat, subValue: `top ${Math.max(1, 100 - Math.round(best.v * 100))}% of the field` },
    worst && { key: "w", icon: "alert", eyebrow: "Costing you most", tone: "bad", main: worst.label, subPrefix: worst.stat, subValue: `bottom ${Math.max(1, Math.round(worst.v * 100))}% of the field` },
    up && { key: "u", icon: "up", eyebrow: "Best weekend", tone: "good", main: up.p.track, subPrefix: `R${up.p.number}`, subValue: `overall ${fmtDelta(up.d)}` },
    down && { key: "d", icon: "down", eyebrow: "Toughest weekend", tone: "bad", main: down.p.track, subPrefix: `R${down.p.number}`, subValue: `overall ${fmtDelta(down.d)}` },
  ].filter(Boolean);

  const provisionalPill = rating.provisional && (
    <span className="rounded-full bg-amber-500/15 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-amber-600 ring-1 ring-amber-500/40 dark:text-amber-400">
      Provisional
    </span>
  );

  const rankBlock = latest?.rank != null && (
    <div>
      <div className="font-display text-3xl font-black leading-none tabular-nums text-dark sm:text-4xl">
        <CountUp end={latest.rank} prefix="#" />
      </div>
      <div className="mt-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-light">of {latest.fieldSize} rated</div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* headline: the number, your place in the rated field, and the
          strengths / weak spots the formula sees right now */}
      <div className="reveal card relative overflow-hidden p-5 sm:p-6">
        <span className="absolute inset-x-0 top-0 h-1.5" style={{ backgroundColor: color }} />
        {/* the number leads, the title reads off it: "86 · Rating breakdown" */}
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
          <div className="flex min-w-0 items-center gap-5">
            <span className="font-display text-6xl font-black leading-none tabular-nums sm:text-7xl" style={{ color }}>
              <CountUp end={rating.ratings.overall} />
            </span>
            <span className="h-14 w-px shrink-0 bg-border" />
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-black uppercase leading-tight tracking-tight text-dark sm:text-3xl">
                Rating breakdown
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                {latest?.rank != null && (
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
                    <b className="text-dark">#{latest.rank}</b> of {latest.fieldSize} rated
                  </span>
                )}
                {provisionalPill}
              </div>
            </div>
          </div>
        </div>
        {hl.length > 0 && (
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {hl.map((h) => (
              <HighlightTile key={h.key} icon={h.icon} eyebrow={h.eyebrow} tone={h.tone} main={h.main} subPrefix={h.subPrefix} subValue={h.subValue} />
            ))}
          </div>
        )}
      </div>

      {/* development chart — the picked value's own scoreboard sits in the
          header (current number + what it did across the season), so the card
          says something even before you read the curve */}
      <div className="reveal card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border px-5 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <span className="font-display text-4xl font-black leading-none tabular-nums text-dark">{rating.ratings[stat]}</span>
            <div>
              <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">
                {stat === "overall" ? "Overall" : COMPONENT_INFO[stat].title}
                <span className="ml-2 font-mono text-[11px] font-semibold text-light">
                  {SERIES.find((s) => s.key === stat)?.code}
                </span>
              </h2>
              <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
                {seasonMove == null ? (
                  scope === "career" ? "season by season" : "after each round"
                ) : (
                  <>
                    <b style={{ color: seasonMove > 0 ? "#16a34a" : seasonMove < 0 ? "#dc2626" : undefined }}>
                      {seasonMove === 0 ? "±0" : fmtDelta(seasonMove)}
                    </b>{" "}
                    {scope === "career" ? "over your career" : "this season"}
                  </>
                )}
              </div>
            </div>
          </div>
          {/* The group is right-aligned, and the grain switch comes FIRST in
              it: switching to all-time then grows the row leftwards, leaving
              Season/All-time and the value tabs exactly where they were. */}
          <div className="flex flex-wrap items-center gap-2">
            {/* inside all-time: season summary or every single race */}
            {inCareer && (
              <SlidingTabs
                wrapClassName="inline-flex rounded-lg border border-border bg-card p-0.5"
                btnClassName="px-3 py-1.5 text-xs font-bold"
                pillClassName="rounded-md bg-brand"
                items={[
                  { key: "seasons", label: "Seasons" },
                  { key: "races", label: "Races" },
                ]}
                value={grain}
                onChange={setGrain}
              />
            )}
            {/* zoom out to every season this person has raced */}
            {hasCareer && (
              <SlidingTabs
                wrapClassName="inline-flex rounded-lg border border-border bg-card p-0.5"
                btnClassName="px-3 py-1.5 text-xs font-bold"
                pillClassName="rounded-md bg-brand"
                items={[
                  { key: "season", label: "Season" },
                  { key: "career", label: "All-time" },
                ]}
                value={scope}
                onChange={setScope}
              />
            )}
            <SlidingTabs
              wrapClassName="inline-flex rounded-lg border border-border bg-card p-0.5"
              btnClassName="px-3 py-1.5 text-xs font-bold"
              pillClassName="rounded-md bg-brand"
              items={SERIES.map((s) => ({ key: s.key, label: s.code }))}
              value={stat}
              onChange={setStat}
            />
          </div>
        </div>
        <div className="p-5 sm:p-6">
          {perRace && raceLoading ? (
            <div className="flex h-72 items-center justify-center font-mono text-[11px] uppercase tracking-wider text-light">
              Replaying every race…
            </div>
          ) : (
            <RatingChart points={chartPoints} statKey={stat} color={color} career={inCareer} perRace={perRace} />
          )}
        </div>
        {/* Always one footnote line, whatever the mode — otherwise the card
            would grow and shrink as you switch between the views. */}
        <p className="border-t border-border px-5 py-2.5 font-mono text-[11px] leading-relaxed text-light sm:px-6">
          {inCareer
            ? perRace
              ? "Every race you have driven · hover one for its detail"
              : "One point per season, at its end · hover one for its detail"
            : stat === "pac" || stat === "exp"
              ? "Career-window value · it moves slowly within a season"
              : "Your rating after each round · hover one for its detail"}
        </p>
      </div>

      {/* round by round */}
      <div className="reveal card overflow-hidden">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Round by round</h2>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-light">what moved your numbers, race by race</span>
        </div>
        <div className="cascade divide-y divide-border">
          {ratedPoints.map((p, i) => {
            const causes = causesFor(p.race || {});
            return (
              <div key={p.raceId} style={{ "--i": Math.min(i, 16) }} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
                  <span className="w-8 shrink-0 font-mono text-base font-bold tabular-nums text-faint">{p.number}</span>
                  <Flag code={p.country || flagFor(p.track)?.country} w={26} h={19} />
                  <span className="min-w-0 flex-1 truncate font-display text-lg font-extrabold uppercase tracking-tight text-dark">
                    {p.track}
                  </span>
                  {p.race?.raced ? (
                    <span className="shrink-0 text-sm font-bold text-dark">
                      {p.race.position != null ? `P${p.race.position}` : p.race.status}
                      {p.race.grid != null && <span className="font-semibold text-light"> from P{p.race.grid}</span>}
                    </span>
                  ) : (
                    <span className="shrink-0 text-sm font-semibold text-light">sat out</span>
                  )}
                  {/* per-value deltas — solid pills, big enough to read at a glance */}
                  <span className="flex flex-wrap items-center gap-1.5">
                    {["overall", "rac", "aha", "pac", "exp"].map((k) => (
                      <DeltaPill key={k} value={p.delta?.[k]} code={SERIES.find((s) => s.key === k)?.code} />
                    ))}
                  </span>
                </div>
                {causes.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-12">
                    {causes.map((c, j) => (
                      <Cause key={j} tone={c.tone}>
                        {c.text}
                        <span className="ml-2 border-l pl-2 opacity-70" style={{ borderColor: "currentColor" }}>
                          {c.hits}
                        </span>
                      </Cause>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* composition */}
      <div className="reveal space-y-3">
        <div>
          <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">What goes into it</h2>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
            weight · your rank vs the field · hover a row for details
          </span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {["rac", "aha", "pac", "exp"].map((k) => (
            <CompositionBlock key={k} statKey={k} components={rating.components} weights={rating.weights} color={color} />
          ))}
        </div>
        <p className="font-mono text-[11px] leading-relaxed text-light">
          Overall = RAC {Math.round((rating.weights?.rtg?.rac ?? 0.35) * 100)}% · PAC {Math.round((rating.weights?.rtg?.pac ?? 0.3) * 100)}% ·
          AWA {Math.round((rating.weights?.rtg?.aha ?? 0.2) * 100)}% · EXP {Math.round((rating.weights?.rtg?.exp ?? 0.15) * 100)}%
        </p>
      </div>
    </div>
  );
}
