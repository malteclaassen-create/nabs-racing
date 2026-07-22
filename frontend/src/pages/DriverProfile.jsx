import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSeasonParam } from "../hooks/useSeasonParam.js";
import {
  ErrorBox, PageHeaderSkeleton, Skeleton, TierBadge, StatusPill, DriverAvatar, MEDAL, MEDAL_TEXT, CountUp,
} from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import SocialLinks from "../components/SocialLinks.jsx";
import RatingCard from "../components/RatingCard.jsx";
import ChampionBadge, { TeamPodiumBadge } from "../components/ChampionBadge.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";
import { countryFor } from "../data/driverCountries.js";
import { flagFor } from "../data/circuits.js";

const TIER_LABEL = { 1: "Tier 1", 2: "Tier 2", 0: "Reserve" };

// Amber pill marking the league's safety car driver, next to the tier badge.
function SafetyCarBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-amber-600 ring-1 ring-amber-500/40 dark:text-amber-400">
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 17h18M5 17l1.5-4.5A3 3 0 019.3 10h5.4a3 3 0 012.8 2l1.5 5M7.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM16.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
      </svg>
      Safety Car
    </span>
  );
}

// Public driver page layout switch:
//   "card"    → the rating-card–led design (no dark hero banner, no rating
//               breakdown); the card is the centrepiece of a coherent top block.
//   "classic" → the original design: dark hero banner + rating card + breakdown.
// The classic layout is kept fully intact below as a fallback — flip this back
// to "classic" to restore it.
const LAYOUT = "card";

// --- tiny inline icons (stroke = currentColor) ---------------------------
const I = {
  trophy: "M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM7 5H4v2a3 3 0 003 3M17 5h3v2a3 3 0 01-3 3",
  podium: "M4 21V11h5v10M9 21V5h6v16M15 21V9h5v12",
  flagChk: "M5 21V4M5 4h14l-3 4 3 4H5",
  chart: "M4 19h16M7 15l3-4 3 3 4-6",
  flag: "M5 21V4M5 4c3-1.5 6 1.5 9 0s4-1 4-1v9s-1 .5-4 1-6-1.5-9 0",
  trend: "M3 17l6-6 4 4 7-7M14 8h6v6",
  swap: "M4 8h13l-3-3M20 16H7l3 3",
  lead: "M5 20h14M6 20V9l3 2 3-6 3 6 3-2v11",
  gauge: "M12 13l3.5-3.5M6.5 19a8 8 0 1111 0",
  alert: "M10.3 4.3l-7.4 12.8A1.5 1.5 0 004.2 19.4h15.6a1.5 1.5 0 001.3-2.3L13.7 4.3a1.5 1.5 0 00-2.6 0zM12 9v4M12 16.5h.01",
  spark: "M13 2L4.5 13H11l-1 9 8.5-11H12l1-9z",
  medal: "M12 14a5 5 0 100-10 5 5 0 000 10zM8.5 12.5L7 21l5-2.2L17 21l-1.5-8.5",
  stack: "M12 3l9 5-9 5-9-5 9-5zM3 13.5l9 5 9-5",
  cross: "M12 21a9 9 0 100-18 9 9 0 000 18zM9 9l6 6M15 9l-6 6",
  grid: "M4 4h16v16H4zM4 12h16M12 4v16",
  stopwatch: "M12 13V9M9 2h6M19 6l-1.5 1.5M12 21a8 8 0 100-16 8 8 0 000 16z",
};

// Lap-time formatter for the fastest-lap tile (1:43.250).
function fmtLapMs(ms) {
  if (!ms || ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
function Icon({ name, className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={I[name]} />
    </svg>
  );
}

// --- colour helpers -------------------------------------------------------
// Team colours drive the head-to-head bar; a soft white seam marks the split,
// so teammates (same colour on both sides) still read as two sides.
function hexToHsl(hex) {
  let c = (hex || "").replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
// Pick black or white text for legibility on a solid colour fill.
function readableText(hex) {
  return hexToHsl(hex).l > 62 ? "#0b1020" : "#ffffff";
}

// Career stats derived from a standings row — keeps focal driver and any
// head-to-head opponent measured the same way.
function statsFromRow(row) {
  const fin = Object.values(row.perRace).filter((r) => r.status === "FINISHED" && r.position != null);
  const pos = fin.map((r) => r.position);
  return {
    points: row.total,
    wins: fin.filter((r) => r.position === 1).length,
    podiums: fin.filter((r) => r.position <= 3).length,
    bestFinish: pos.length ? Math.min(...pos) : null,
    avgFinish: pos.length ? Math.round((pos.reduce((a, b) => a + b, 0) / pos.length) * 10) / 10 : null,
  };
}

function Stat({ icon, label, value, sub, accent, className = "" }) {
  // -ml/-mt tuck each tile's top/left rule under its neighbour (or the frame),
  // so any tile count renders with clean hairlines and no stray edges.
  return (
    <div className={`-ml-px -mt-px border-l border-t border-border bg-card p-4 ${className}`}>
      <div className="flex items-center gap-2 text-light">
        <Icon name={icon} className="h-4 w-4" />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 font-display text-3xl font-black leading-none tabular-nums text-dark"
        style={accent ? { color: accent } : undefined}>
        {typeof value === "number" ? <CountUp end={value} /> : value}
      </div>
      {sub && <div className="mt-1.5 text-xs font-medium text-light">{sub}</div>}
    </div>
  );
}

// The headline season stats. The driver picks which tiles show on their own
// profile (self-service on /profile); null = the classic six. Tiles whose data
// simply doesn't exist for this season (telemetry on an archive season, no
// fastest lap recorded) drop out on their own even when selected.
const DEFAULT_TILES = ["wins", "podiums", "bestFinish", "avgFinish", "poles", "gained"];

const TILE_DEFS = (stats) => [
  { key: "wins", icon: "trophy", label: "Wins", value: stats.wins, sub: `${stats.winRate}% of starts`, accent: stats.wins ? MEDAL_TEXT[0] : undefined },
  { key: "podiums", icon: "podium", label: "Podiums", value: stats.podiums, sub: `${stats.podiumRate}% of starts` },
  { key: "bestFinish", icon: "flagChk", label: "Best Finish", value: stats.bestFinish ? `P${stats.bestFinish}` : "–", sub: `${stats.starts} starts` },
  { key: "avgFinish", icon: "chart", label: "Avg Finish", value: stats.avgFinish != null ? `P${stats.avgFinish}` : "–", sub: `${stats.pointsFinishes} in the points` },
  { key: "poles", icon: "flag", label: "Poles", value: stats.polePositions, sub: `best grid P${stats.bestGrid ?? "–"}` },
  {
    key: "gained", icon: "trend", label: "Places Gained",
    value: stats.positionsGained > 0 ? `+${stats.positionsGained}` : stats.positionsGained,
    sub: "start → finish",
    accent: stats.positionsGained > 0 ? "#16a34a" : stats.positionsGained < 0 ? "#dc2626" : undefined,
  },
  { key: "top5", icon: "medal", label: "Top 5s", value: stats.top5, sub: `${stats.finishes} finishes` },
  { key: "top10", icon: "stack", label: "Top 10s", value: stats.top10, sub: `${stats.finishes} finishes` },
  { key: "pointsFinishes", icon: "spark", label: "In the Points", value: stats.pointsFinishes, sub: `of ${stats.starts} starts` },
  {
    key: "dnf", icon: "cross", label: "DNFs", value: stats.dnf,
    sub: stats.dsq ? `plus ${stats.dsq} DSQ` : "retirements",
    accent: stats.dnf === 0 ? "#16a34a" : undefined,
  },
  { key: "avgGrid", icon: "grid", label: "Avg Grid", value: stats.avgGrid != null ? `P${stats.avgGrid}` : "–", sub: "qualifying" },
  {
    // Headline = how many rounds this driver set the race's overall fastest
    // lap; the personal-best time lives on as the subtitle.
    key: "fastestLap", icon: "gauge", label: "Fastest Laps",
    value: stats.fastestLaps ?? 0,
    sub: stats.fastestLap ? `best ${fmtLapMs(stats.fastestLap.bestLapMs)} · ${stats.fastestLap.track}` : "",
    available: !!stats.fastestLap || (stats.fastestLaps ?? 0) > 0,
  },
  { key: "overtakes", icon: "swap", label: "Overtakes", value: stats.overtakes, sub: "on-track passes", available: stats.overtakes != null },
  { key: "lapsLed", icon: "lead", label: "Laps Led", value: stats.lapsLed, sub: "laps out front", available: stats.lapsLed != null },
  {
    key: "contacts", icon: "alert", label: "Contacts", value: stats.contacts, sub: "car to car",
    accent: stats.contacts === 0 ? "#16a34a" : undefined, available: stats.contacts != null,
  },
  {
    key: "consistency", icon: "stopwatch", label: "Consistency",
    value: stats.avgConsistencyMs != null ? `±${(stats.avgConsistencyMs / 1000).toFixed(2)}s` : "–",
    sub: "clean-lap spread", available: stats.avgConsistencyMs != null,
  },
  {
    key: "penalties", icon: "flagChk", label: "Penalty Time",
    value: `${Math.round((stats.stewardPenaltySeconds || 0) + (stats.gamePenaltySeconds || 0))}s`,
    sub: "steward + in-game",
    accent: !(stats.stewardPenaltySeconds || stats.gamePenaltySeconds) ? "#16a34a" : undefined,
  },
];

// The tiles sit in one hairline-ruled frame; a tile count that doesn't fill
// the last row (7 tiles in a 3-wide grid, say) would leave a borderless hole
// in the frame. So the LAST tile stretches over whatever is left of its row —
// per breakpoint, since the column count changes (2 → sm:3 → lg:6). Static
// class literals on purpose: Tailwind only generates classes it can see.
const LAST_SPAN_2 = { 0: "col-span-1", 1: "col-span-2" };
const LAST_SPAN_3 = { 0: "sm:col-span-1", 1: "sm:col-span-3", 2: "sm:col-span-2" };
const LAST_SPAN_6 = {
  0: "lg:col-span-1",
  1: "lg:col-span-6",
  2: "lg:col-span-5",
  3: "lg:col-span-4",
  4: "lg:col-span-3",
  5: "lg:col-span-2",
};

function StatTiles({ stats, visible, className = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" }) {
  const picked = visible || DEFAULT_TILES;
  const defs = TILE_DEFS(stats).filter((t) => picked.includes(t.key) && t.available !== false);
  if (!defs.length) return null;
  const lastSpan = [
    LAST_SPAN_2[defs.length % 2],
    LAST_SPAN_3[defs.length % 3],
    className.includes("lg:grid-cols-6") ? LAST_SPAN_6[defs.length % 6] : "",
  ]
    .join(" ")
    .trim();
  return (
    // One quiet framed block with hairline rules between the stats, instead of
    // a loose grid of separate bordered cards.
    <div className={`reveal grid overflow-hidden rounded-xl border border-border bg-card ${className}`}>
      {defs.map((t, i) => (
        <Stat
          key={t.key}
          icon={t.icon}
          label={t.label}
          value={t.value}
          sub={t.sub}
          accent={t.accent}
          className={i === defs.length - 1 ? lastSpan : ""}
        />
      ))}
    </div>
  );
}

// A quiet footer line per OTHER series this person races in (the career table
// itself stays scoped to the profile's own series). Line-separated list, no
// deep link into the other series' row here — the switcher is one click away.
function OtherSeriesLines({ otherSeries }) {
  if (!otherSeries?.length) return null;
  return (
    <div className="divide-y divide-border border-t border-border">
      {otherSeries.map((o) => (
        <div key={o.seriesSlug || o.seriesName} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3 sm:px-6">
          <span className="text-sm text-medium">
            Also races in{" "}
            {o.seriesSlug ? (
              <Link to={`/s/${o.seriesSlug}`} className="font-semibold text-dark hover:text-brand">
                {o.seriesName}
              </Link>
            ) : (
              <span className="font-semibold text-dark">{o.seriesName}</span>
            )}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-wider text-light">
            {o.seasons} {o.seasons === 1 ? "season" : "seasons"} · {o.starts} starts · {o.wins} wins ·{" "}
            {o.points} pts{o.bestPosition ? ` · best P${o.bestPosition}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// Cross-season career: one row per linked season of THIS series, current name
// resolved. The backend folds two rows of the SAME season (handle change
// mid-season) into a single line, so this renders whenever there's anything
// aggregated at all; other series show as one summary line each underneath.
function CareerBlock({ career, otherSeries }) {
  const hasTable = career && (career.seasons?.length ?? 0) >= 1;
  if (!hasTable && !otherSeries?.length) return null;
  if (!hasTable) {
    // The person only spans series, not seasons: just the summary lines.
    return (
      <div className="reveal card overflow-hidden">
        <h2 className="border-b border-border px-5 py-4 font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:px-6 sm:text-xl">
          Across the leagues
        </h2>
        <OtherSeriesLines otherSeries={otherSeries} />
      </div>
    );
  }
  const { seasons, totals } = career;
  return (
    <div className="reveal card overflow-hidden">
      <h2 className="border-b border-border px-5 py-4 font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:px-6 sm:text-xl">
        Career across seasons
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
              <th className="px-5 py-2.5">Season</th>
              <th className="px-2 py-2.5">Team</th>
              <th className="px-2 py-2.5 text-center">Pos</th>
              <th className="px-2 py-2.5 text-center">Starts</th>
              <th className="px-2 py-2.5 text-center">Wins</th>
              <th className="px-2 py-2.5 text-center">Podiums</th>
              <th className="px-5 py-2.5 text-right">Pts</th>
            </tr>
          </thead>
          <tbody className="cascade divide-y divide-border">
            {seasons.map((s, i) => (
              <tr key={s.driverId} style={{ "--i": Math.min(i, 16) }} className="transition hover:bg-surface2">
                <td className="px-5 py-3">
                  <Link
                    to={`/drivers/${s.driverId}${s.seasonNumber != null ? `?season=${s.seasonNumber}` : ""}`}
                    className="font-display font-bold uppercase tracking-tight text-dark hover:text-brand"
                  >
                    {s.seasonName || `Season ${s.seasonNumber}`}
                  </Link>
                  {s.isCurrent && <span className="ml-2 pill bg-surface2 text-light">this one</span>}
                </td>
                <td className="px-2 py-3">
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-1.5 rounded-full" style={{ backgroundColor: s.teamColor || "#64748b" }} />
                    <span className="text-medium">{s.teamName || "—"}</span>
                  </span>
                </td>
                {/* No championship position before the season has actually
                    been raced — a standings rank over zero starts means nothing. */}
                <td className="px-2 py-3 text-center font-mono tabular-nums text-medium">{s.position && s.starts > 0 ? `P${s.position}` : "–"}</td>
                <td className="px-2 py-3 text-center tabular-nums text-medium">{s.starts}</td>
                <td className="px-2 py-3 text-center tabular-nums text-dark">{s.wins}</td>
                <td className="px-2 py-3 text-center tabular-nums text-dark">{s.podiums}</td>
                <td className="px-5 py-3 text-right font-display font-black tabular-nums text-dark">{s.points}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-mono text-[11px] uppercase tracking-wider text-light">
              <td className="px-5 py-2.5">{totals.seasons} {totals.seasons === 1 ? "season" : "seasons"}</td>
              <td className="px-2 py-2.5" />
              <td className="px-2 py-2.5" />
              <td className="px-2 py-2.5 text-center tabular-nums text-medium">{totals.starts}</td>
              <td className="px-2 py-2.5 text-center tabular-nums text-dark">{totals.wins}</td>
              <td className="px-2 py-2.5 text-center tabular-nums text-dark">{totals.podiums}</td>
              <td className="px-5 py-2.5 text-right font-display font-black tabular-nums text-dark">{totals.points}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <OtherSeriesLines otherSeries={otherSeries} />
    </div>
  );
}

// Companion panel beside the rating card: the four sub-ratings as labelled bars,
// each backed by the real season stat that drives it.
function RatingBreakdown({ rating, stats, color }) {
  const g = rating.ratings;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const dnf = Math.max(0, (rating.starts ?? 0) - (rating.finishes ?? 0));
  // `k` is the backend key (aha stays aha); `code` is the displayed shorthand.
  const rows = [
    { k: "exp", code: "EXP", label: "Experience", note: plural(rating.starts ?? 0, "start") },
    { k: "rac", code: "RAC", label: "Racecraft", note: `${plural(rating.wins ?? 0, "win")} · ${plural(rating.podiums ?? 0, "podium")}` },
    { k: "aha", code: "AWA", label: "Awareness", note: `${plural(rating.contacts ?? 0, "contact")} · ${plural(dnf, "DNF")}` },
    { k: "pac", code: "PAC", label: "Pace", note: stats?.bestGrid ? `best grid P${stats.bestGrid}` : stats?.avgGrid != null ? `avg grid P${stats.avgGrid}` : "—" },
  ];
  return (
    <div className="card p-5 sm:p-6">
      <h2 className="mb-4 border-b border-border pb-3 font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">
        Rating Breakdown
      </h2>
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.k}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-sm font-bold uppercase tracking-tight text-dark">
                {r.label}
                <span className="ml-1.5 font-mono text-[10px] font-semibold text-light">{r.code}</span>
              </span>
              <span className="font-display text-xl font-black tabular-nums" style={{ color }}>{g[r.k]}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface2">
              <div className="h-full rounded-full" style={{ width: `${g[r.k]}%`, backgroundColor: color }} />
            </div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-light">{r.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Season-form chart: finishing position per round (P1 at the top), with a
// y-axis (positions), an x-axis of rounds, the best/worst finishes ringed, and
// the per-round result chips sitting directly under each round. The line only
// connects rounds the driver actually finished — rounds they sat out (or
// retired from) leave a gap and the line simply carries on to the next finish.
function FormChart({ perRace, color }) {
  const N = perRace.length;
  if (!N) return <div className="text-sm text-light">No races yet.</div>;

  const finishes = perRace
    .map((r, i) => (r.status === "FINISHED" && r.position != null ? { i, p: r.position } : null))
    .filter(Boolean);
  const positions = finishes.map((f) => f.p);
  const best = positions.length ? Math.min(...positions) : null;
  const worst = positions.length ? Math.max(...positions) : null;
  const maxPos = Math.max(3, worst || 3);

  // Map a finishing position to a vertical %, inset into a band so P1 and the
  // worst position aren't flush against the chart edges.
  const yPct = (p) => 8 + (maxPos > 1 ? (p - 1) / (maxPos - 1) : 0) * 84;

  const step = maxPos <= 6 ? 1 : maxPos <= 12 ? 2 : 5;
  const ticks = [];
  for (let p = 1; p <= maxPos; p += step) ticks.push(p);
  if (ticks[ticks.length - 1] !== maxPos) ticks.push(maxPos);

  // The line passes through finished rounds only (skips DNS/DNF -> the gap).
  const linePts = finishes.map((f) => ({ x: f.i + 0.5, y: yPct(f.p) }));
  const d = linePts.map((pt, k) => `${k ? "L" : "M"}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(" ");
  // Soft area under the trend line, closed down to the chart floor.
  const areaD = linePts.length > 1
    ? `${d} L${linePts[linePts.length - 1].x.toFixed(2)},100 L${linePts[0].x.toFixed(2)},100 Z`
    : null;
  const gradId = `form-grad-${color.replace(/[^a-z0-9]/gi, "")}`;
  const minW = Math.max(360, N * 46);

  return (
    // A SINGLE horizontal scroll wraps the plot and the per-round chips, with a
    // sticky y-axis pinned to the left. On a phone this means the trend line and
    // the result chips beneath it always scroll together and stay aligned —
    // before, they were two separate scroll strips that could drift apart.
    <div className="scrollbar-slim h-full min-h-[240px] w-full overflow-x-auto">
      <div className="flex h-full flex-col" style={{ minWidth: minW + 36 }}>
      {/* plot region — pinned y-axis + plot, both share this row's height so
          the position ticks line up exactly with the dots */}
      <div className="flex min-h-0 flex-1 items-stretch gap-2">
        {/* y-axis: finishing positions, stays put while the plot scrolls */}
        <div className="sticky left-0 z-10 w-7 shrink-0 bg-card">
          <div className="relative h-full">
          {ticks.map((p) => (
            <span
              key={p}
              className="absolute right-0 -translate-y-1/2 font-mono text-[10px] font-bold tabular-nums text-faint"
              style={{ top: `${yPct(p)}%` }}
            >
              P{p}
            </span>
          ))}
          </div>
        </div>

        <div className="relative flex-1">
          <div className="relative h-full">
            {/* gridlines */}
            {ticks.map((p) => (
              <span
                key={p}
                className="absolute inset-x-0 border-t border-dashed border-border"
                style={{ top: `${yPct(p)}%` }}
              />
            ))}
            {/* line, area and dots share one wrapper that wipes open from the
                left when the card reveals, so the whole plot builds itself
                round by round (SVG dash draw-ins don't work here — the
                stretched viewBox + non-scaling-stroke measure dashes in screen
                pixels, so that classic trick degrades to a dotted line). */}
            <div className="wipe-ltr absolute inset-0" style={{ "--wipe-dur": "2s" }}>
            {/* trend area + connecting line (stretched to fill; stroke crisp) */}
            <svg
              viewBox={`0 0 ${N} 100`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full overflow-visible"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              {areaD && <path d={areaD} fill={`url(#${gradId})`} stroke="none" />}
              {finishes.length > 1 && (
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
            </svg>
            {/* dots — finished rounds only; best ringed green, worst ringed red */}
            <div className="absolute inset-0 flex">
              {perRace.map((r, i) => {
                const finished = r.status === "FINISHED" && r.position != null;
                if (!finished) return <div key={i} className="flex-1" />;
                const medal = r.position <= 3 ? MEDAL[r.position - 1] : null;
                const isBest = r.position === best;
                const isWorst = r.position === worst && worst !== best;
                const top = `${yPct(r.position)}%`;
                return (
                  <div key={i} className="relative flex-1">
                    {(isBest || isWorst) && (
                      <span
                        className="absolute h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{ left: "50%", top, boxShadow: `0 0 0 2px ${isBest ? "#16a34a" : "#dc2626"}` }}
                      />
                    )}
                    <span
                      className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                      style={{ left: "50%", top, backgroundColor: medal || color }}
                      title={`R${r.number} ${r.track} · P${r.position}`}
                    />
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* per-round result chips — a spacer matching the pinned y-axis keeps
          each chip directly under its dot */}
      <div className="mt-3 flex shrink-0 gap-2">
        <div className="sticky left-0 z-10 w-7 shrink-0 bg-card" />
        {/* same wipe, same duration as the plot above — chips surface exactly
            when the line reaches their round */}
        <div className="wipe-ltr flex flex-1" style={{ "--wipe-dur": "2s" }}>
          {perRace.map((r) => {
              const finished = r.status === "FINISHED" && r.position != null;
              const medal = finished && r.position <= 3 ? MEDAL[r.position - 1] : null;
              const isBest = finished && r.position === best;
              const isWorst = finished && r.position === worst && worst !== best;
              const ring = isBest
                ? "ring-2 ring-emerald-500"
                : isWorst
                ? "ring-2 ring-red-500"
                : medal
                ? ""
                : "ring-1 ring-border";
              return (
                <div
                  key={r.number}
                  className="flex flex-1 flex-col items-center gap-1.5"
                  title={`R${r.number} ${r.track} · ${finished ? "P" + r.position : r.status}`}
                >
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-lg font-display font-black tabular-nums ${
                      finished ? "text-sm" : "text-[10px] tracking-tight"
                    } ${
                      medal ? "text-ink" : finished ? "bg-surface2 text-dark" : "bg-surface2 text-light"
                    } ${ring}`}
                    style={medal ? { backgroundColor: medal } : undefined}
                  >
                    {finished ? r.position : r.status}
                  </span>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-light">
                    R{r.number}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
      </div>
    </div>
  );
}

function HeadToHead({ me, meRow, standings }) {
  const others = useMemo(
    () => standings.filter((s) => s.driverId !== me.driver.id).sort((a, b) => a.position - b.position),
    [standings, me.driver.id]
  );
  const defaultOpp = useMemo(() => {
    const mate = others.find((o) => o.team.id === me.driver.team.id);
    if (mate) return mate.driverId;
    return others.sort((a, b) => Math.abs(a.position - (meRow?.position ?? 0)) - Math.abs(b.position - (meRow?.position ?? 0)))[0]?.driverId;
  }, [others, meRow, me.driver]);

  const [oppId, setOppId] = useState(defaultOpp);
  const opp = standings.find((s) => s.driverId === oppId) || others[0];
  // The split bar trails the picker by one beat: on a switch it keeps showing
  // the OLD opponent with a quick fade-out, then swaps to the new one, whose
  // bar wipes in fresh. barLeaving marks that brief exit window.
  const [barOppId, setBarOppId] = useState(defaultOpp);
  const barLeaving = !!opp && barOppId !== opp.driverId;
  useEffect(() => {
    if (!opp || barOppId === opp.driverId) return;
    const t = setTimeout(() => setBarOppId(opp.driverId), 180);
    return () => clearTimeout(t);
  }, [opp?.driverId, barOppId]);
  // Without the focal driver's row (or no one to compare against) there's no
  // head-to-head to show — hide the panel instead of crashing the page.
  if (!meRow || !opp) return null;

  const meStats = statsFromRow(meRow);
  const oppStats = statsFromRow(opp);
  let meAhead = 0, oppAhead = 0, shared = 0;
  for (const num of Object.keys(meRow.perRace)) {
    const a = meRow.perRace[num], b = opp.perRace[num];
    if (!a || !b || a.status !== "FINISHED" || b.status !== "FINISHED" || a.position == null || b.position == null) continue;
    shared++;
    if (a.position < b.position) meAhead++;
    else if (b.position < a.position) oppAhead++;
  }
  // The split bar shows the championship points share; the finished-ahead
  // record lives in the stat rows below. It renders barOpp — the opponent it
  // is still showing — which trails `opp` by the fade-out beat on a switch.
  const barOpp = standings.find((s) => s.driverId === barOppId) || opp;
  const barOppStats = barOpp === opp ? oppStats : statsFromRow(barOpp);
  const pointsTotal = meStats.points + barOppStats.points;
  const mePct = pointsTotal ? Math.round((meStats.points / pointsTotal) * 100) : 50;
  const oppPct = 100 - mePct;
  // Drawn width is capped at 85/15 so a lopsided split (255 vs 0 pts) still
  // leaves the smaller side room for its numbers — the printed percentages
  // stay the real ones.
  const meBarW = Math.min(85, Math.max(15, mePct));
  const barOppColor = barOpp.team.color;
  const meColor = me.driver.team.color;
  // Both sides wear their REAL team colour — teammates share it, and the soft
  // white seam in the bar is what marks where one side ends.
  const oppColor = opp.team.color;

  // cmp > 0 -> the focal driver leads this stat, < 0 -> the opponent, 0 -> tie.
  const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
  // Values render through CountUp, keyed on the picked opponent: every switch
  // remounts just the numbers, so BOTH columns (the focal driver's too, even
  // where the value itself is unchanged) run up again — while the rows around
  // them stay put instead of re-entering.
  const num = (v, { prefix = "" } = {}) =>
    v == null ? "–" : <CountUp key={opp.driverId} end={v} prefix={prefix} decimals={Number.isInteger(v) ? 0 : 1} />;
  const rows = [
    {
      label: "Finished ahead",
      sub: (
        <>
          <CountUp key={opp.driverId} end={shared} /> shared {shared === 1 ? "race" : "races"}
        </>
      ),
      a: num(meAhead),
      b: num(oppAhead),
      cmp: sign(meAhead - oppAhead),
    },
    { label: "Wins", a: num(meStats.wins), b: num(oppStats.wins), cmp: sign(meStats.wins - oppStats.wins) },
    { label: "Podiums", a: num(meStats.podiums), b: num(oppStats.podiums), cmp: sign(meStats.podiums - oppStats.podiums) },
    { label: "Best finish", a: num(meStats.bestFinish, { prefix: "P" }), b: num(oppStats.bestFinish, { prefix: "P" }), cmp: sign((oppStats.bestFinish ?? 99) - (meStats.bestFinish ?? 99)) },
    { label: "Avg finish", a: num(meStats.avgFinish), b: num(oppStats.avgFinish), cmp: sign((oppStats.avgFinish ?? 99) - (meStats.avgFinish ?? 99)) },
  ];

  return (
    <div className="reveal card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Head to Head</h2>
        <select value={opp.driverId} onChange={(e) => setOppId(e.target.value)}
          className="max-w-[11rem] rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-sm font-bold text-dark focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
          {others.map((o) => <option key={o.driverId} value={o.driverId}>P{o.position} · {o.name}</option>)}
        </select>
      </div>

      <div className="p-5">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <DriverAvatar name={me.driver.name} photoUrl={me.driver.photoUrl} color={meColor} size={60} />
            <div className="truncate font-display text-base font-extrabold uppercase tracking-tight text-dark">{me.driver.name}</div>
            <TeamLogo id={me.driver.team.id} name={me.driver.team.name} color={me.driver.team.color} logoUrl={me.driver.team.logoUrl} size={16} showName className="justify-center" nameClassName="truncate text-[11px] text-light" />
          </div>
          <span className="shrink-0 font-display text-xl font-black text-faint">VS</span>
          <Link to={`/drivers/${opp.driverId}`} className="group flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <DriverAvatar name={opp.name} photoUrl={opp.photoUrl} color={oppColor} size={60} />
            <div className="truncate font-display text-base font-extrabold uppercase tracking-tight text-dark group-hover:text-primary">{opp.name}</div>
            <TeamLogo id={opp.team.id} name={opp.team.name} color={opp.team.color} logoUrl={opp.team.logoUrl} size={16} showName className="justify-center" nameClassName="truncate text-[11px] text-light" />
          </Link>
        </div>

        {/* points split: each driver's championship points as a split bar with
            the raw totals either side. Each side keeps a min width so a 0%
            side still shows its colour and label. */}
        <div className="mb-2 flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-wider text-light">
          <span>Points</span>
        </div>
        {/* Keyed on the opponent the bar is SHOWING: on a switch the old bar
            first dips out (fade-out while barLeaving), then this remounts for
            the new opponent and the wipe + count-ups run fresh. */}
        <div key={`bar-${barOpp.driverId}`} className={barLeaving ? "fade-out" : ""}>
          {/* gap-1 leaves a real transparent slit between the two sides — the
              card shows through it, so the two colours never touch */}
          <div className="flex h-8 gap-1 overflow-hidden rounded-lg text-xs font-black ring-1 ring-black/5">
            {/* the two halves wipe in toward each other — the left one from the
                left edge, the right one from the right — and meet at the seam
                while the numbers count up */}
            <div className="wipe-ltr flex min-w-16 items-center justify-start gap-1.5 rounded-lg px-2.5 tabular-nums" style={{ "--wipe-dur": "1.8s", width: `${meBarW}%`, backgroundColor: meColor, color: readableText(meColor) }}>
              <span className="font-display text-sm"><CountUp end={meStats.points} /></span>
              <span className="opacity-80"><CountUp end={mePct} suffix="%" /></span>
            </div>
            <div className="wipe-rtl flex min-w-16 flex-1 items-center justify-end gap-1.5 rounded-lg px-2.5 tabular-nums" style={{ "--wipe-dur": "1.8s", backgroundColor: barOppColor, color: readableText(barOppColor) }}>
              <span className="opacity-80"><CountUp end={oppPct} suffix="%" /></span>
              <span className="font-display text-sm"><CountUp end={barOppStats.points} /></span>
            </div>
          </div>
          {/* the names ride the same wipes as their bar halves */}
          <div className="mb-5 mt-1.5 flex justify-between px-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider">
            <span className="wipe-ltr truncate" style={{ "--wipe-dur": "1.8s", color: meColor }}>{me.driver.name}</span>
            <span className="wipe-rtl truncate text-right" style={{ "--wipe-dur": "1.8s", color: barOppColor }}>{barOpp.name}</span>
          </div>
        </div>

        {/* NOT keyed on the opponent: the rows stay put on a switch — only
            their numbers count up to the new values (CountUp re-counts). */}
        <div className="cascade divide-y divide-border overflow-hidden rounded-xl bg-surface2/60">
          {rows.map((r, i) => {
            const aWin = r.cmp > 0, bWin = r.cmp < 0;
            const cell = (val, win, color, align) =>
              win ? (
                <span
                  className={`inline-block rounded-md px-2 py-0.5 font-display text-base font-black tabular-nums ${align}`}
                  style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
                >
                  {val}
                </span>
              ) : (
                <span className={`font-display text-base font-black tabular-nums text-medium ${align}`}>{val}</span>
              );
            return (
              <div key={r.label} style={{ "--i": i }} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2.5">
                <span className="flex justify-start">{cell(r.a, aWin, meColor, "text-left")}</span>
                <span className="text-center font-mono text-[10px] font-semibold uppercase tracking-wider text-medium">
                  {r.label}
                  {r.sub && <span className="block text-[9px] font-medium normal-case tracking-normal text-light">{r.sub}</span>}
                </span>
                <span className="flex justify-end">{cell(r.b, bWin, oppColor, "text-right")}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TeamPanel({ driver, standings, career }) {
  const mates = standings
    .filter((s) => s.team.id === driver.team.id && s.driverId !== driver.id)
    .sort((a, b) => a.position - b.position);
  const c = driver.team.color;
  const isReserve = driver.team.tier === 0;

  // (1) The team's constructor-championship standing, fetched for the
  // profile's own season (tier 1 and tier 2 have separate tables; the
  // Reserve pool has no constructor entry).
  const consApi = useApi(
    useCallback(
      () =>
        driver.team.tier === 1
          ? api.t1Standings(driver.seasonNumber)
          : driver.team.tier === 2
            ? api.t2Standings(driver.seasonNumber)
            : Promise.resolve(null),
      [driver.team.id, driver.team.tier, driver.seasonNumber]
    )
  );
  const consRows = consApi.data?.standings || [];
  const consRow = consRows.find((r) => r.teamId === driver.team.id) || null;
  // Context line: the leader chases nobody, so show the lead over P2; everyone
  // else shows the gap to the team directly ahead.
  const consAhead = consRow && consRow.position > 1 ? consRows.find((r) => r.position === consRow.position - 1) : null;
  const consNext = consRow && consRow.position === 1 ? consRows.find((r) => r.position === 2) : null;

  // (2) Share of the team's driver points, focal driver included. Uses the
  // driver standings that are already here, so it always matches the page.
  const meRow = standings.find((s) => s.driverId === driver.id) || null;
  const shareRows = [meRow, ...mates].filter(Boolean).filter((r) => (r.total || 0) > 0);
  const shareTotal = shareRows.reduce((sum, r) => sum + (r.total || 0), 0);

  // (4) The driver's history with THIS team across their linked seasons.
  // teamName can read "A / B" after a mid-season move, so match by inclusion.
  const withTeam = (career?.seasons || [])
    .filter((s) => s.teamName && s.teamName.split(" / ").includes(driver.team.name))
    // Only seasons actually raced (or the one being viewed) count — a signed
    // seat for next season shouldn't already read as a season together.
    .filter((s) => (s.starts || 0) > 0 || s.isCurrent)
    .sort((a, b) => (a.seasonNumber || 0) - (b.seasonNumber || 0));
  const historyBest = withTeam
    .filter((s) => s.position != null && s.starts > 0)
    .reduce((best, s) => (best == null || s.position < best.position ? s : best), null);
  // The Reserve "team" can have 50+ drivers, which used to stretch this panel
  // far past the race-by-race table beside it. Long lists start collapsed at
  // roughly that table's height; a footer button reveals the rest. Lists only
  // a little over the cap stay uncollapsed — hiding 2 names behind a button
  // would be sillier than just showing them.
  const CAP = 9;
  const [showAllMates, setShowAllMates] = useState(false);
  const collapsible = mates.length > CAP + 3;
  const shownMates = collapsible && !showAllMates ? mates.slice(0, CAP) : mates;
  return (
    <div className="reveal card overflow-hidden">
      <h2 className="border-b border-border px-5 py-4 font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Team</h2>
      {/* Team-colour seam along the card's top edge, like the hero banner. */}
      <span className="absolute inset-x-0 top-0 z-10 h-1" style={{ backgroundColor: c }} />
      <div className="relative overflow-hidden p-5">
        <div className="absolute inset-0 opacity-[0.1]" style={{ background: `radial-gradient(circle at 85% 0%, ${c}, transparent 60%)` }} />
        <div className="relative flex items-center gap-3">
          <TeamLogo id={driver.team.id} name={driver.team.name} color={c} logoUrl={driver.team.logoUrl} size={48} />
          <div>
            <Link to={`/teams/${driver.team.id}`} className="font-display text-2xl font-black uppercase tracking-tight text-dark transition hover:text-brand">
              {driver.team.name}
            </Link>
            <div className="mt-0.5 flex items-center gap-2">
              <TierBadge tier={driver.tier} />
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-light">{TIER_LABEL[driver.team.tier] ?? "—"}</span>
            </div>
          </div>
        </div>

        {/* (1) Championship standing as one stat strip: position · points · gap */}
        {consRow && (
          <div className="relative mt-4 grid grid-cols-3 divide-x divide-border border-y border-border text-center">
            <div className="py-3">
              <div className="font-display text-2xl font-black tabular-nums leading-none" style={{ color: consRow.position === 1 ? MEDAL_TEXT[0] : undefined }}>
                <span className={consRow.position === 1 ? "" : "text-dark"}>P{consRow.position}</span>
              </div>
              <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-wider text-light">Championship</div>
            </div>
            <div className="py-3">
              <div className="font-display text-2xl font-black tabular-nums leading-none text-dark">
                <CountUp end={consRow.total} />
              </div>
              <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-wider text-light">Points</div>
            </div>
            <div className="py-3">
              <div className={`font-display text-2xl font-black tabular-nums leading-none ${consRow.position === 1 ? "text-emerald-600" : "text-dark"}`}>
                {consRow.position === 1
                  ? consNext ? `+${consRow.total - consNext.total}` : "+0"
                  : consAhead ? `-${consAhead.total - consRow.total}` : "–"}
              </div>
              <div className="mt-1 truncate font-mono text-[10px] font-bold uppercase tracking-wider text-light">
                {consRow.position === 1
                  ? consNext ? `Lead over ${consNext.name}` : "Lead"
                  : consAhead ? `To ${consAhead.name}` : "Gap"}
              </div>
            </div>
          </div>
        )}

        {/* (2) The line-up, focal driver included — each row carries a slim
            bar showing that driver's share of the team's points. */}
        <div className="relative mt-4">
          <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
            {isReserve ? "Reserve drivers" : "Line-up"}
          </div>
          {isReserve && mates.length === 0 && <div className="text-sm text-light">No teammates this season.</div>}
          <div className="cascade space-y-1">
            {(isReserve ? shownMates : [meRow, ...mates].filter(Boolean)).map((m, i) => {
              const self = m.driverId === driver.id;
              const pct = !isReserve && shareTotal > 0 ? ((m.total || 0) / shareTotal) * 100 : null;
              const inner = (
                <>
                  <DriverAvatar name={m.name} photoUrl={m.photoUrl} color={m.team.color} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-display text-sm font-bold uppercase tracking-tight ${self ? "text-dark" : "text-dark"}`}>
                      {m.name}
                      {self && <span className="ml-1.5 align-middle font-mono text-[9px] font-bold uppercase tracking-wider text-eyebrow">this page</span>}
                    </span>
                    {pct != null && (
                      <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-surface2">
                        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: c, opacity: self ? 1 : 0.45 }} />
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-xs font-semibold tabular-nums text-light">P{m.position}</span>
                  <span className="font-display text-sm font-black tabular-nums text-dark">{m.total}</span>
                  {pct != null && (
                    <span className="w-9 text-right font-mono text-[10px] font-semibold tabular-nums text-light">{Math.round(pct)}%</span>
                  )}
                </>
              );
              return self ? (
                <div key={m.driverId} className="flex items-center gap-3 rounded-lg bg-surface2/50 px-2 py-2 ring-1 ring-inset ring-border">
                  {inner}
                </div>
              ) : (
                <Link key={m.driverId} to={`/drivers/${m.driverId}`} style={{ "--i": Math.min(i, 16) }}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-surface2">
                  {inner}
                </Link>
              );
            })}
          </div>
          {collapsible && (
            <button
              type="button"
              onClick={() => setShowAllMates((v) => !v)}
              className="mt-3 w-full rounded-lg border border-border bg-surface2/60 px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-light transition hover:bg-surface2 hover:text-dark"
            >
              {showAllMates ? "Show fewer" : `Show all ${mates.length} teammates`}
            </button>
          )}
        </div>

        {/* (4) The driver's history with this team across their seasons */}
        {!isReserve && withTeam.length > 0 && (
          <div className="relative mt-5 border-t border-border pt-4">
            <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
              {driver.name.split(" ")[0]} &amp; {driver.team.name}
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-light">Together</span>
                <span className="font-display font-bold tabular-nums text-dark">
                  {withTeam.length === 1
                    ? `First season (S${withTeam[0].seasonNumber})`
                    : `${withTeam.length} seasons · since S${withTeam[0].seasonNumber}`}
                </span>
              </div>
              {historyBest && (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-light">Best finish together</span>
                  <span
                    className="font-display font-bold tabular-nums"
                    style={{ color: historyBest.position <= 3 ? MEDAL_TEXT[historyBest.position - 1] : undefined }}
                  >
                    <span className={historyBest.position <= 3 ? "" : "text-dark"}>
                      {historyBest.position === 1 ? "Champion" : `P${historyBest.position}`} (S{historyBest.seasonNumber})
                    </span>
                  </span>
                </div>
              )}
              {withTeam.length > 1 && (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-light">Wins together</span>
                  <span className="font-display font-bold tabular-nums text-dark">
                    {withTeam.reduce((s, x) => s + (x.wins || 0), 0)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Classic top: the original dark "speed" hero banner. Kept as a fallback
// (rendered only when LAYOUT === "classic").
function ClassicHero({ driver, championship, color }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-ink text-white shadow-lg">
      <span className="absolute inset-x-0 top-0 z-10 h-1.5" style={{ backgroundColor: color }} />
      {/* layered "speed" backdrop */}
      <div className="absolute inset-0" style={{ background: `radial-gradient(120% 140% at 88% 10%, ${color}55, transparent 55%)` }} />
      <div className="absolute inset-y-0 right-0 w-2/3" style={{ background: `repeating-linear-gradient(115deg, transparent 0 22px, ${color}14 22px 25px)` }} />
      <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-transparent" />

      <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:gap-7 sm:p-8">
        <DriverAvatar name={driver.name} photoUrl={driver.photoUrl} color={color} size={112} className="text-4xl ring-4 ring-white/10" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-4xl font-black uppercase tracking-tight sm:text-6xl">{driver.name}</h1>
            <Flag code={countryFor(driver.id, driver.country)} w={30} h={22} />
            <TierBadge tier={driver.tier} />
            {driver.role === "safety" && <SafetyCarBadge />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-white/70">
            <Link to={`/teams/${driver.team.id}`} className="group flex items-center gap-2">
              <TeamLogo id={driver.team.id} name={driver.team.name} color={color} logoUrl={driver.team.logoUrl} size={22} />
              <span className="font-display text-base font-bold uppercase tracking-tight text-white/90 transition group-hover:text-white">{driver.team.name}</span>
            </Link>
            <span className="text-white/30">·</span>
            <span className="text-sm">{driver.discordName}</span>
          </div>
          <SocialLinks links={driver.socials} baseClass="text-white/55" className="mt-3.5" />
        </div>
        <div className="flex gap-8 border-t border-white/10 pt-4 sm:flex-col sm:gap-3 sm:border-l sm:border-t-0 sm:pl-7 sm:pt-0 sm:text-right">
          <div>
            <div className="font-display text-5xl font-black leading-none tabular-nums">
              <CountUp end={championship.position} prefix="P" />
            </div>
            <div className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white/50">of {championship.fieldSize}</div>
          </div>
          <div>
            <div className="font-display text-4xl font-black leading-none tabular-nums" style={{ color }}>
              <CountUp end={championship.points} />
            </div>
            <div className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white/50">points</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Card-led top: the rating card is the centrepiece; the driver's identity,
// championship standing and the six headline stats are packed in beside it on a
// light panel that echoes the card's team-colour frame and fills its full
// height, so nothing reads as empty. No dark hero, no rating breakdown.
// Pinned-achievement medallion for the trophy shelf: a trophy tile in the
// achievement category's colour, with the same hover popover the podium seals
// use — the name big, the "how you earn it" line underneath.
const ACH_CAT_COLORS = {
  milestones: "#ec4899",
  speed: "#38bdf8",
  racecraft: "#a78bfa",
  consistency: "#34d399",
  special: "#f59e0b",
};

function AchievementBadge({ name, tagline, cat }) {
  const color = ACH_CAT_COLORS[cat] || "#ec4899";
  return (
    <span
      className="group relative inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold text-dark"
      role="img"
      aria-label={`Achievement: ${name}`}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" style={{ color }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="9" r="5" />
        <path d="M9.5 13.5L8 21l4-2 4 2-1.5-7.5" />
      </svg>
      {name}
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-1/2 top-full z-30 mt-2 w-max max-w-[14rem] -translate-x-1/2 translate-y-1 whitespace-normal rounded-lg border border-border bg-card px-3 py-2 text-left opacity-0 shadow-xl shadow-ink/20 transition duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
      >
        <span className="block whitespace-nowrap font-display text-xs font-extrabold uppercase tracking-tight text-dark">{name}</span>
        <span className="mt-0.5 block text-[11px] font-normal leading-snug text-light">{tagline}</span>
      </span>
    </span>
  );
}

function CardHeader({ driver, rating, championship, color, stats, allTime, career, badges, teamBadges, pinnedAchievements }) {
  // Season ⇄ All-time switch for the headline numbers. Only offered when the
  // driver actually spans several seasons (allTime comes with the career).
  const [scope, setScope] = useState("season");
  const showAll = !!allTime && scope === "all";
  const shown = showAll ? allTime : stats;
  // Trophy shelf: the driver's own podium seals (labelled WDC) with the
  // constructor seals of their teams beneath (WCC) — desktop as its own
  // column just left of the scoreboard's divider line, phones centred under
  // the championship strip.
  const hasSeals = (badges || []).length > 0 || (teamBadges || []).length > 0;
  const sealLabel = (text, title) => (
    <span
      title={title}
      className="cursor-help font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-light"
    >
      {text}
    </span>
  );
  // Each shelf row: the label ABOVE its seals; wide enough for seven wreaths
  // (7 × 32px + 6 gaps ≈ 16.5rem) before a row wraps.
  const sealRows = (alignRight) => (
    <>
      {(badges || []).length > 0 && (
        <div className={`flex flex-col gap-1 ${alignRight ? "items-end" : "items-center"}`}>
          {sealLabel("WDC", "Drivers' championship podiums")}
          <div className={`flex max-w-[16.5rem] flex-wrap gap-1.5 ${alignRight ? "justify-end" : "justify-center"}`}>
            {badges.map((b) => (
              <ChampionBadge
                key={`${b.type}-${b.seasonNumber}`}
                type={b.type}
                seasonNumber={b.seasonNumber}
                seasonName={b.seasonName}
                game={b.game}
                points={b.points}
                align={alignRight ? "right" : "center"}
              />
            ))}
          </div>
        </div>
      )}
      {(teamBadges || []).length > 0 && (
        <div className={`flex flex-col gap-1 ${alignRight ? "items-end" : "items-center"}`}>
          {sealLabel("WCC", "Constructors' championship podiums (the driver's team)")}
          <div className={`flex max-w-[16.5rem] flex-wrap gap-1.5 ${alignRight ? "justify-end" : "justify-center"}`}>
            {teamBadges.map((b) => (
              <TeamPodiumBadge
                key={`team-${b.seasonNumber}`}
                position={b.position}
                seasonNumber={b.seasonNumber}
                seasonName={b.seasonName}
                game={b.game}
                points={b.points}
                team={b.team}
                align={alignRight ? "right" : "center"}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
  return (
    <div className="reveal card relative overflow-hidden p-5 sm:p-6">
      {/* team-colour top strip + faint wash tie the panel to the card frame */}
      <span className="absolute inset-x-0 top-0 h-1.5" style={{ backgroundColor: color }} />
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ background: `radial-gradient(130% 120% at 6% 0%, ${color}, transparent 55%)` }} />

      <div className="relative grid gap-6 lg:grid-cols-[auto_1fr] lg:items-stretch">
        {/* rating card — vertically CENTRED, never stretched: when the info
            column grows taller than the card (all-time toggle, many tiles),
            the card keeps its own height and floats mid-row with equal space
            above and below, instead of its frame stretching down. */}
        <div className="flex items-center justify-center">
          {/* safety car drivers get their card even with no races (no rating).
              `explain`: hovering/tapping EXP·RAC·AWA·PAC pops a note on how
              that value is computed. */}
          {rating || driver.role === "safety" ? (
            <RatingCard driver={driver} rating={rating} explain />
          ) : (
            <DriverAvatar name={driver.name} photoUrl={driver.photoUrl} color={color} size={160} className="text-6xl" />
          )}
        </div>

        {/* identity (left) + championship scoreboard (top right) + stats */}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1 text-center lg:text-left">
              <div className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                <h1 className="font-display text-4xl font-black uppercase tracking-tight text-dark sm:text-5xl">{driver.name}</h1>
                <Flag code={countryFor(driver.id, driver.country)} w={30} h={22} />
                <TierBadge tier={driver.tier} />
                {driver.role === "safety" && <SafetyCarBadge />}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2 text-light lg:justify-start">
                <Link to={`/teams/${driver.team.id}`} className="group flex items-center gap-2">
                  <TeamLogo id={driver.team.id} name={driver.team.name} color={color} logoUrl={driver.team.logoUrl} size={22} />
                  <span className="font-display text-base font-bold uppercase tracking-tight text-medium transition group-hover:text-dark">{driver.team.name}</span>
                </Link>
                <span className="text-faint">·</span>
                <span className="text-sm">{driver.discordName}</span>
              </div>
              {driver.formerName && (
                <div className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-light">
                  raced as {driver.formerName}
                </div>
              )}
              {/* The driver's own "about me" line fills the panel with a bit of
                  personality — especially when they've hidden some stat tiles. */}
              {driver.bio && (
                <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-medium lg:mx-0">{driver.bio}</p>
              )}
              <SocialLinks links={driver.socials} baseClass="text-light" className="mt-3.5 justify-center lg:justify-start" />
            </div>

            {/* trophy shelf — its own column just LEFT of the scoreboard's
                divider line, vertically centred on the scoreboard (lg+) */}
            {hasSeals && (
              <div className="hidden shrink-0 flex-col items-end justify-center gap-2.5 self-stretch lg:flex">
                {sealRows(true)}
              </div>
            )}

            {/* championship (or career) scoreboard fills the former dead corner (lg+) */}
            <div className="hidden shrink-0 flex-col items-end border-l border-border pl-6 text-right lg:flex">
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">
                {showAll ? "Career" : "Championship"}
              </div>
              <div className="mt-1.5 font-display text-5xl font-black leading-none tabular-nums text-dark">
                {showAll ? (
                  <CountUp end={career.totals.seasons} />
                ) : championship.position ? (
                  <CountUp end={championship.position} prefix="P" />
                ) : (
                  "—"
                )}
              </div>
              <div className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
                {showAll
                  ? (career.totals.seasons === 1 ? "season" : "seasons")
                  : championship.fieldSize
                    ? `of ${championship.fieldSize}`
                    : "no races yet"}
              </div>
              <div className="mt-3 font-display text-3xl font-black leading-none tabular-nums" style={{ color }}>
                <CountUp end={showAll ? career.totals.points : championship.points} />
              </div>
              <div className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-light">points</div>
            </div>
          </div>

          {/* championship + trophy shelf for phones — ONE box (the lg+ scoreboard
              and its own shelf column carry these on desktop). Folding the seals
              into the same surface as the P/points readout keeps the middle of
              the card reading as a single block, not stacked leftovers. Without
              seals it's just the stats row, so there's no empty hole. */}
          <div className="mt-5 rounded-xl bg-surface2/70 lg:hidden">
            <div className="flex items-center justify-center gap-5 px-4 py-3">
              <div className="text-center">
                <div className="font-display text-4xl font-black leading-none tabular-nums text-dark sm:text-5xl">
                  {showAll ? (
                    <CountUp end={career.totals.seasons} />
                  ) : championship.position ? (
                    <CountUp end={championship.position} prefix="P" />
                  ) : (
                    "—"
                  )}
                </div>
                <div className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
                  {showAll
                    ? (career.totals.seasons === 1 ? "season" : "seasons")
                    : championship.fieldSize
                      ? `of ${championship.fieldSize}`
                      : "no races yet"}
                </div>
              </div>
              <div className="h-11 w-px bg-border" />
              <div className="text-center">
                <div className="font-display text-4xl font-black leading-none tabular-nums sm:text-5xl" style={{ color }}>
                  <CountUp end={showAll ? career.totals.points : championship.points} />
                </div>
                <div className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-light">points</div>
              </div>
            </div>
            {hasSeals && (
              <div className="flex flex-col items-center gap-2.5 border-t border-border px-4 py-3.5">
                {sealRows(false)}
              </div>
            )}
          </div>

          {/* headline stats — bottom-anchored so they fill the space beside the
              card. Linked multi-season drivers get the Season ⇄ All-time switch. */}
          <div className="mt-5 lg:mt-auto lg:pt-5">
            {/* pinned achievements (self-chosen in the private area, max 3) sit
                right above the stats heading; hovering explains each one */}
            {(pinnedAchievements || []).length > 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                {pinnedAchievements.map((a) => (
                  <AchievementBadge key={a.key} name={a.name} tagline={a.tagline} cat={a.cat} />
                ))}
              </div>
            )}
            {allTime && (
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                  {showAll ? `All-time · ${career.totals.seasons} seasons` : "This season"}
                </span>
                <SlidingTabs
                  wrapClassName="inline-flex rounded-lg border border-border bg-card p-0.5"
                  btnClassName="px-2.5 py-1 text-xs"
                  pillClassName="rounded-md bg-brand"
                  items={[
                    { key: "season", label: "Season" },
                    { key: "all", label: "All-time" },
                  ]}
                  value={showAll ? "all" : "season"}
                  onChange={setScope}
                />
              </div>
            )}
            <StatTiles stats={shown} visible={driver.profileTiles} className="grid-cols-2 sm:grid-cols-3" />
          </div>
        </div>
      </div>
    </div>
  );
}

// The person's season → row-id map, remembered per row id across the page
// remount a season switch causes. With it, the fresh mount can redirect to the
// right season's row in its FIRST render — without it the page first reloaded
// the OLD row (skeleton), then navigated and loaded again (second skeleton),
// which read as a stuttering double transition.
const careerRowsByDriver = new Map(); // driverId -> Map(seasonNumber -> driverId)

// `previewId` + `preview` turn the page into the LIVE PREVIEW embedded on the
// private /profile editor: the id comes from the prop instead of the route,
// and `preview` (unsaved edits: name, bio, tiles, photo framing, …) overlays
// the fetched driver, so the page shows what the edits WOULD look like.
export default function DriverProfile({ previewId, preview }) {
  const { id: routeId } = useParams();
  const id = previewId || routeId;
  const navigate = useNavigate();
  const { user: authedUser } = useAuth();
  // Drawer for the site settings button shown on one's OWN profile.
  const { data, loading, error } = useApi(
    useCallback(() => Promise.all([api.driverProfile(id), api.driverRating(id)]), [id])
  );

  // Honour a ?season=N deep link (search results / career-table links): steer
  // the season switcher to the row's own season before the sync below runs.
  useSeasonParam();
  const { season, current: currentSeason } = useSeason();
  const [searchParams] = useSearchParams();
  const pendingSeasonParam = searchParams.get("season") != null;

  // Keep the profile and the NavBar season switcher in step. When they
  // disagree (the visitor just used the switcher, or arrived on an archived
  // row without a ?season hint): if this driver has a linked row in the
  // selected season, go to THAT page. Seasons they did NOT race stay put and
  // render a "didn't race this season" notice instead (below).
  useEffect(() => {
    if (previewId || !data || pendingSeasonParam) return;
    const prof = data[0];
    const own = prof?.driver?.seasonNumber;
    if (season == null || own == null || season === own) return;
    const row = (prof.career?.seasons || []).find((s) => s.seasonNumber === season);
    if (row && row.driverId !== prof.driver.id) {
      navigate(`/drivers/${row.driverId}?season=${season}`, { replace: true });
    }
  }, [previewId, data, season, pendingSeasonParam, navigate]);

  // Remember the person's season → row map for every one of their rows, so
  // the NEXT season switch can redirect instantly (see careerRowsByDriver).
  useEffect(() => {
    const prof = data?.[0];
    if (!prof) return;
    const rows = prof.career?.seasons?.length
      ? prof.career.seasons
      : [{ driverId: prof.driver.id, seasonNumber: prof.driver.seasonNumber }];
    const map = new Map(rows.filter((s) => s.seasonNumber != null).map((s) => [s.seasonNumber, s.driverId]));
    for (const rowId of map.values()) careerRowsByDriver.set(rowId, map);
  }, [data]);

  // Instant redirect on a fresh mount after a season switch: if we already
  // know this person's row for the selected season, go there before fetching
  // anything — no wrong-row skeleton, no double page transition.
  const cachedTarget = !previewId && season != null ? careerRowsByDriver.get(id)?.get(season) : null;
  if (cachedTarget && cachedTarget !== id && !pendingSeasonParam) {
    return <Navigate to={`/drivers/${cachedTarget}?season=${season}`} replace />;
  }

  if (loading)
    return (
      <div className="space-y-8">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <PageHeaderSkeleton />
      </div>
    );
  if (error) return <ErrorBox message={error} />;

  const [p, rating] = data;
  // The driver's OWN season standings (sent with the profile), so a driver
  // opened from an archived season still resolves against the right field.
  const standingsData = p.season;
  const { championship, stats, perRace } = p;
  // Preview mode: unsaved profile edits overlay the stored driver fields.
  const driver = preview ? { ...p.driver, ...preview } : p.driver;
  const color = driver.team.color;
  const meRow = standingsData.standings.find((s) => s.driverId === driver.id);
  // Rounds dropped from this driver's total (the season's drop rule).
  const droppedRounds = new Set(meRow?.droppedRounds || []);
  const dropWorst = standingsData.dropWorst ?? 3;
  const totalRounds = standingsData.raceNumbers?.length || 0;
  // The nav chip leads HERE (the public page) — so the page returns the
  // favour: the owner gets a button through to the private editor. Hidden in
  // the /profile live preview, which would otherwise show it to no purpose.
  // "Own" means ANY of the person's linked season rows, so the buttons stay
  // put while browsing one's own archive seasons too.
  const isOwnProfile =
    !previewId &&
    !!authedUser?.driverId &&
    (authedUser.driverId === driver.id ||
      (p.career?.seasons || []).some((s) => s.driverId === authedUser.driverId));

  const ownControls = isOwnProfile && (
    <div className="-mb-2 flex justify-end gap-2">
      <Link to="/profile" data-tour="personal-area" className="btn-secondary inline-flex items-center gap-1.5">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
        Personal Area
      </Link>
      {/* Site settings moved into the /profile member bar — no gear here. */}
    </div>
  );

  // The switcher points at a season this person has NO row in: keep the
  // switcher where the visitor put it and say so, instead of silently
  // snapping back (or showing another season's numbers under this label).
  const racedSeasons = p.career?.seasons?.length
    ? p.career.seasons
    : [{ driverId: driver.id, seasonNumber: driver.seasonNumber, seasonName: null }];
  const notInSeason =
    !previewId &&
    !pendingSeasonParam &&
    season != null &&
    driver.seasonNumber != null &&
    season !== driver.seasonNumber &&
    !racedSeasons.some((s) => s.seasonNumber === season);
  if (notInSeason) {
    const seasonLabel = currentSeason?.name || `Season ${season}`;
    return (
      <div className="content-in space-y-6">
        {ownControls}
        <div className="card flex flex-col items-center gap-4 px-6 py-14 text-center">
          <DriverAvatar name={driver.name} photoUrl={driver.photoUrl} color={color} size={72} />
          <div>
            <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight text-dark sm:text-3xl">
              {driver.name}
            </h1>
            <p className="mt-2 text-sm text-medium">didn&rsquo;t race in {seasonLabel}.</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <span className="mr-1 font-mono text-[11px] font-bold uppercase tracking-wider text-light">Raced in</span>
            {[...racedSeasons]
              .sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0))
              .map((s) => (
                <Link
                  key={s.driverId}
                  to={`/drivers/${s.driverId}?season=${s.seasonNumber}`}
                  className="rounded-lg bg-surface2 px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wide text-medium transition hover:bg-brand hover:text-ink"
                >
                  S{s.seasonNumber}
                </Link>
              ))}
          </div>
          <Link to="/drivers" className="text-sm font-semibold text-primary hover:underline">
            All drivers of {seasonLabel} →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="content-in space-y-6">
      {ownControls}
      {LAYOUT === "classic" ? (
        <>
          {/* Classic hero banner */}
          <ClassicHero driver={driver} championship={championship} color={color} />

          {/* Official rating card (FIFA/EA-style) + breakdown */}
          {rating && (
            <div>
              <div className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-light">
                Official Driver Rating
              </div>
              <div className="grid items-start gap-6 lg:grid-cols-[auto_1fr]">
                <RatingCard driver={driver} rating={rating} />
                <RatingBreakdown rating={rating} stats={stats} color={color} />
              </div>
            </div>
          )}
          <StatTiles stats={stats} visible={driver.profileTiles} />
        </>
      ) : (
        /* Card-led top: rating card is the centrepiece; identity, championship
           and the headline stats fill the space beside it (no dark hero, no breakdown) */
        <CardHeader
          driver={driver}
          rating={rating}
          championship={championship}
          color={color}
          stats={stats}
          allTime={p.allTime}
          career={p.career}
          badges={p.badges}
          teamBadges={p.teamBadges}
          pinnedAchievements={p.pinnedAchievements}
        />
      )}

      {/* The per-season AC telemetry (overtakes, consistency, contacts,
          penalties) is deliberately NOT shown here — it feeds the rating
          calculation and the per-round Race Facts instead. */}

      {/* Pinned achievements render INSIDE the CardHeader (above the stats
          heading) — no standalone row here anymore. */}

      {/* Season form + Head to head */}
      <div className="grid gap-6 lg:grid-cols-3 lg:items-stretch">
        <div className="reveal card flex flex-col overflow-hidden lg:col-span-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-5 py-4 sm:px-6">
            <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Season Form</h2>
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-light">finishing position by round</span>
            {stats.bestFinish != null && (
              <span className="ml-auto flex items-center gap-3 font-mono text-[11px] font-bold uppercase tracking-wider">
                <span className="flex items-center gap-1.5 text-emerald-600">
                  <span className="h-2 w-2 rounded-full ring-2 ring-emerald-500" /> Best P{stats.bestFinish}
                </span>
                {stats.worstFinish != null && stats.worstFinish !== stats.bestFinish && (
                  <span className="flex items-center gap-1.5 text-red-500">
                    <span className="h-2 w-2 rounded-full ring-2 ring-red-500" /> Worst P{stats.worstFinish}
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="flex-1 p-5 sm:p-6">
            <FormChart perRace={perRace} color={color} />
          </div>
        </div>

        <HeadToHead me={p} meRow={meRow} standings={standingsData.standings} />
      </div>

      {/* Race by race + Team */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="reveal card overflow-hidden lg:col-span-2">
          <h2 className="border-b border-border px-5 py-4 font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:px-6 sm:text-xl">Race by Race</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
                  <th className="px-5 py-2.5">Rnd</th>
                  <th className="px-2 py-2.5">Circuit</th>
                  <th className="px-2 py-2.5 text-center">Grid</th>
                  <th className="px-2 py-2.5 text-center">Race</th>
                  <th className="px-2 py-2.5 text-right">Pts</th>
                  <th className="hidden px-5 py-2.5 text-right sm:table-cell">+/−</th>
                </tr>
              </thead>
              {/* cascade: rounds deal in one after another, like the standings rows */}
              <tbody className="cascade divide-y divide-border">
                {perRace.map((r, i) => {
                  const finished = r.status === "FINISHED" && r.position != null;
                  const medal = finished && r.position <= 3 ? MEDAL[r.position - 1] : null;
                  const delta = finished && r.grid != null ? r.grid - r.position : null;
                  const dropped = droppedRounds.has(r.number);
                  const raceHref = r.raceId
                    ? `/races?race=${r.raceId}${driver.seasonNumber != null ? `&season=${driver.seasonNumber}` : ""}`
                    : null;
                  return (
                    <tr
                      key={r.number}
                      style={{ "--i": Math.min(i, 16) }}
                      title={dropped ? "Dropped: one of the lowest-scoring rounds, not counted toward the total" : raceHref ? "Open this race" : undefined}
                      onClick={raceHref ? () => navigate(raceHref) : undefined}
                      onKeyDown={raceHref ? (e) => { if (e.key === "Enter") navigate(raceHref); } : undefined}
                      tabIndex={raceHref ? 0 : undefined}
                      role={raceHref ? "link" : undefined}
                      className={`group transition hover:bg-surface2 ${raceHref ? "cursor-pointer" : ""}`}
                    >
                      <td className="px-5 py-3 font-mono font-bold tabular-nums text-light">{r.number}</td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2.5">
                          <Flag code={flagFor(r.track)?.country} w={22} h={16} />
                          <span className="font-display font-bold uppercase tracking-tight text-dark transition group-hover:text-brand">{r.track}</span>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-center font-mono tabular-nums text-medium">{r.grid ? `P${r.grid}` : "–"}</td>
                      <td className="px-2 py-3 text-center">
                        {finished ? (
                          <span className={`inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md px-1.5 font-display text-sm font-black tabular-nums ${
                            medal ? "text-ink" : "bg-surface2 text-dark ring-1 ring-border"}`}
                            style={medal ? { backgroundColor: medal } : undefined}>
                            P{r.position}
                          </span>
                        ) : <StatusPill status={r.status} />}
                      </td>
                      <td className="px-2 py-3 text-right font-display text-base font-black tabular-nums">
                        {dropped ? (
                          <span className="text-faint line-through decoration-2">{r.points}</span>
                        ) : (
                          <span className="text-dark">{r.points}</span>
                        )}
                      </td>
                      <td className="hidden px-5 py-3 text-right font-mono text-sm font-bold tabular-nums sm:table-cell">
                        {delta == null || delta === 0
                          ? <span className="text-faint">–</span>
                          : <span style={{ color: delta > 0 ? "#16a34a" : "#dc2626" }}>{delta > 0 ? `▲${delta}` : `▼${-delta}`}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {dropWorst > 0 && (
            <p className="border-t border-border px-5 py-2.5 font-mono text-[11px] leading-relaxed text-light sm:px-6">
              <span className="text-faint line-through decoration-2">Struck</span> points are dropped: a driver&rsquo;s {dropWorst}
              {" "}lowest-scoring round{dropWorst === 1 ? " doesn't" : "s don't"} count toward the total
              {totalRounds > dropWorst && <> (best {totalRounds - dropWorst} of {totalRounds})</>}.
            </p>
          )}
        </div>

        <TeamPanel driver={driver} standings={standingsData.standings} career={p.career} />
      </div>

      {/* Career across linked seasons (only when this driver spans more than one) */}
      <CareerBlock career={p.career} otherSeries={p.otherSeries} />

      <div>
        <Link to="/drivers" className="text-sm font-semibold text-primary hover:underline">← All drivers</Link>
      </div>
    </div>
  );
}
