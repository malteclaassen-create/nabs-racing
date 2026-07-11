import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { ErrorBox, PageHeader, PageHeaderSkeleton, TableSkeleton, Skeleton, TierBadge, Rank, MEDAL, DriverAvatar, CountUp } from "../components/ui.jsx";
import { useTilt } from "../hooks/motion.js";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import StandingsTable from "../components/StandingsTable.jsx";
import { countryFor } from "../data/driverCountries.js";

function LeaderCard({ row, leaderTotal, rank, index = 0, showTier = true, champion = false }) {
  const gap = leaderTotal - row.total;
  const tiltRef = useTilt({ max: 5, lift: 5 });
  return (
    // The cascade entrance animates this WRAPPER, not the card itself: a filled
    // entrance keyframe pins `transform` on its element, which froze the tilt's
    // smooth hover transition. On the wrapper, the card's transform stays free.
    <div style={{ "--i": index }}>
    <Link
      ref={tiltRef}
      to={`/drivers/${row.driverId}`}
      className={`card shine tilt relative block h-full overflow-hidden p-5 hover:shadow-xl ${champion ? "champion-gold" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* min-w-0 + truncate let a long name give way instead of pushing
            the points total off the card edge on phones */}
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-display text-lg font-black text-ink"
            style={{ backgroundColor: MEDAL[rank] }}
          >
            {row.position}
          </span>
          <DriverAvatar name={row.name} photoUrl={row.photoUrl} color={row.team.color} size={40} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-display text-base font-extrabold uppercase tracking-tight text-dark sm:text-lg">
                {row.name}
              </span>
              <Flag code={countryFor(row.driverId, row.country)} />
              {/* the tier pill costs name space on 375px screens; the table
                  below shows it anyway */}
              {showTier && (
                <span className="hidden sm:inline-flex">
                  <TierBadge tier={row.tier} />
                </span>
              )}
            </div>
            <TeamLogo
              id={row.team.id}
              name={row.team.name}
              color={row.team.color}
              logoUrl={row.team.logoUrl}
              size={18}
              showName
              nameClassName="truncate text-sm text-light"
            />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-2xl font-bold leading-none tabular-nums text-dark sm:text-3xl">
            <CountUp end={row.total} />
          </div>
          <div
            className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider"
            style={champion ? { color: "var(--medal-1)" } : undefined}
          >
            <span className={champion ? "font-bold" : "text-light"}>
              {champion ? "Champion" : gap === 0 ? "Leader" : `−${gap} pts`}
            </span>
          </div>
        </div>
      </div>
    </Link>
    </div>
  );
}

function DriverRow({ d, leaderTotal, index = 0, showTier = true, champion = false, decided = false }) {
  const isLeader = d.position === 1;
  const gap = leaderTotal - d.total;
  const pct = d.total > 0 && leaderTotal > 0 ? Math.max(4, (d.total / leaderTotal) * 100) : 0;
  return (
    <Link
      to={`/drivers/${d.driverId}`}
      style={{ "--i": index }}
      className={`flex items-center gap-3 px-4 py-3 transition sm:gap-4 sm:px-5 ${
        champion ? (decided ? "row-gold" : "row-leader") : "hover:bg-surface2"
      }`}
    >
      <Rank position={d.position} />
      <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: d.team.color }} />
      <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={d.team.color} size={36} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-base font-bold uppercase tracking-tight text-dark sm:text-lg">
            {d.name}
          </span>
          <Flag code={countryFor(d.driverId, d.country)} />
          {showTier && <TierBadge tier={d.tier} />}
          {!d.isActive && <span className="pill bg-surface2 text-light">inactive</span>}
        </div>
        <TeamLogo
          id={d.team.id}
          name={d.team.name}
          color={d.team.color}
          logoUrl={d.team.logoUrl}
          size={16}
          showName
          nameClassName="truncate text-xs text-light sm:text-sm"
        />
      </div>

      {/* points bar */}
      <div className="hidden w-28 shrink-0 md:block lg:w-40 xl:w-56">
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className="bar-fill h-full rounded-full" style={{ "--w": `${pct}%`, backgroundColor: d.team.color }} />
        </div>
      </div>

      <div className="w-14 shrink-0 text-right sm:w-20">
        <div className="font-mono text-lg font-bold tabular-nums text-dark sm:text-xl">{d.total}</div>
        <div className="font-mono text-[11px] tabular-nums text-light">
          {isLeader ? "leader" : `−${gap}`}
        </div>
      </div>
    </Link>
  );
}

// Tier sub-views. "all" keeps the real championship order; picking a tier
// re-ranks that group 1..n on its own (like a mini Tier-1 / Tier-2 table).
const TIER_FILTERS = [
  { id: "all", label: "All" },
  { id: "1", label: "Tier 1" },
  { id: "2", label: "Tier 2" },
  { id: "0", label: "Reserves" },
];

export default function DriverStandings() {
  const { data, loading, error } = useApi(useCallback(() => api.driverStandings(), []));
  const races = useApi(useCallback(() => api.races(), []));
  const { current: season, active } = useSeason();
  const [onlyScoring, setOnlyScoring] = useState(true);
  const [tier, setTier] = useState("all");
  // "list" = the ranked cards/rows; "grid" = the per-round points matrix (same
  // table the Constructors page uses), so you can read each driver's haul at
  // every race. Only offered when the season actually has rounds.
  const [view, setView] = useState("list");

  if (loading)
    return (
      <div>
        <PageHeaderSkeleton />
        <div className="mb-8 grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <TableSkeleton rows={12} />
      </div>
    );
  if (error) return <ErrorBox message={error} />;

  const all = data.standings;
  // Archived single-class seasons (S1–S5) have only one tier: hide the tier
  // filter + per-row tier badges. Totals-only seasons (no races) swap the
  // "Rounds" stat for a "Final standings" label.
  const presentTiers = new Set(all.map((r) => r.tier));
  // "Multi-tier" means a real Tier-1/Tier-2 split (S6/S7). Reserves (tier 0) are
  // a separate axis, so a single-class season with reserves is NOT multi-tier.
  const multiTier = presentTiers.has(2);
  const tierFilters = TIER_FILTERS.filter((t) => t.id === "all" || presentTiers.has(Number(t.id)));
  const hasRounds = data.raceNumbers.length > 0;
  // A tier that no longer exists can't stay selected.
  const activeTier = multiTier && tierFilters.some((t) => t.id === tier) ? tier : "all";

  // Filter by tier, then optionally hide point-less drivers, then re-rank the
  // resulting view 1..n so a tier sub-table reads as its own standings.
  let rows = activeTier === "all" ? all : all.filter((r) => String(r.tier) === activeTier);
  if (onlyScoring) rows = rows.filter((r) => r.total > 0);
  rows = rows.map((d, i) => ({ ...d, position: i + 1 }));

  const leaderTotal = rows[0]?.total ?? 0;
  const top3 = rows.slice(0, 3);
  // The season's title is decided: an archived season, or the live one with
  // every championship round completed. The top card of whatever view is
  // selected (overall, a tier, the reserves) is that group's champion and
  // gets the golden treatment.
  const champRounds = (races.data || []).filter((r) => !r.isSpecialEvent && r.number != null);
  const seasonDecided =
    (!!season && !!active && season.number < active.number) ||
    (champRounds.length > 0 && champRounds.every((r) => r.isCompleted));
  // Highlighted rows in the list: once the season is decided, the best driver
  // of EVERY group in view (Tier 1, Tier 2, the reserves) is that group's
  // champion and wears gold; while it still runs, only the current overall
  // leader is marked, in the pink leader wash. Rows are points-sorted, so the
  // first row of each tier is its champion.
  const championIds = new Set();
  if (rows.length > 0) {
    if (seasonDecided) {
      for (const t of new Set(rows.map((r) => r.tier))) {
        const top = rows.find((r) => r.tier === t);
        if (top && top.total > 0) championIds.add(top.driverId);
      }
    } else if (rows[0].total > 0) {
      championIds.add(rows[0].driverId);
    }
  }
  const scopeLabel = activeTier === "all" ? "drivers" : TIER_FILTERS.find((t) => t.id === activeTier).label;
  // The per-round matrix needs actual rounds; archived totals-only seasons fall
  // back to the list regardless of what's selected.
  const activeView = hasRounds ? view : "list";

  const segCls = (active) =>
    `rounded-lg px-3.5 py-2 text-sm font-bold transition ${
      active ? "bg-brand text-ink shadow" : "text-light hover:text-dark"
    }`;

  return (
    <div className="content-in">
      <PageHeader
        eyebrow="Championship"
        title="Driver Standings"
        subtitle={
          multiTier
            ? "All drivers, from Tier 1 and Tier 2 to the reserves, ranked by total points."
            : "All drivers ranked by total points."
        }
      />

      {top3.length > 0 && (
        // 3-across only from lg: at md widths the cards get so narrow the
        // driver names truncate away entirely
        <div className="cascade mb-8 grid gap-4 lg:grid-cols-3">
          {top3.map((row, i) => (
            <LeaderCard
              key={row.driverId}
              row={row}
              leaderTotal={leaderTotal}
              rank={i}
              index={i}
              showTier={multiTier}
              champion={seasonDecided && i === 0}
            />
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {multiTier ? (
          <div className="inline-flex rounded-xl border border-border bg-card p-1">
            {tierFilters.map((t) => (
              <button key={t.id} type="button" onClick={() => setTier(t.id)} className={segCls(activeTier === t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-3">
          {hasRounds && (
            <div className="inline-flex rounded-xl border border-border bg-card p-1">
              <button type="button" onClick={() => setView("list")} className={segCls(activeView === "list")}>
                List
              </button>
              <button type="button" onClick={() => setView("grid")} className={segCls(activeView === "grid")}>
                By round
              </button>
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-medium">
            <input
              type="checkbox"
              checked={onlyScoring}
              onChange={(e) => setOnlyScoring(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
            />
            Only drivers with points
          </label>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-6 text-sm">
        <span className="text-light">
          Showing: <span className="font-mono font-bold tabular-nums text-dark">{rows.length}</span> {scopeLabel}
        </span>
        <span className="text-light">
          {hasRounds ? (
            <>Rounds: <span className="font-mono font-bold tabular-nums text-dark">{data.raceNumbers.length}</span></>
          ) : (
            <span className="font-mono font-bold uppercase tracking-wider text-dark">Final standings</span>
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-medium">No drivers match this filter.</div>
      ) : activeView === "grid" ? (
        <StandingsTable
          variant="driver"
          raceNumbers={data.raceNumbers}
          rows={rows}
          dropWorst={data.dropWorst}
          officialTotals={data.officialTotals}
          decided={seasonDecided}
        />
      ) : (
        <div className="cascade card divide-y divide-border overflow-hidden">
          {rows.map((d, i) => (
            <DriverRow
              key={d.driverId}
              d={d}
              leaderTotal={leaderTotal}
              index={Math.min(i, 16)}
              showTier={multiTier}
              champion={championIds.has(d.driverId)}
              decided={seasonDecided}
            />
          ))}
        </div>
      )}
    </div>
  );
}
