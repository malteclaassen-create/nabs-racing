import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSeasonParam } from "../hooks/useSeasonParam.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, TableSkeleton, Skeleton, TierBadge, Rank, MEDAL, DriverAvatar, CountUp } from "../components/ui.jsx";
import { useTilt } from "../hooks/motion.js";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import StandingsTable from "../components/StandingsTable.jsx";
import RatingCard from "../components/RatingCard.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";
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

// The page remounts on every season switch (App keys the content on the
// season), which used to reset the view/filters to their defaults — switching
// from the Season 7 cards to Season 6 dumped you back into the list. These
// tiny sessionStorage-backed states survive the remount (and navigation away
// and back), so the page reopens exactly how you left it. Per tab on purpose.
function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw != null ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  const set = (v) => {
    setValue(v);
    try {
      sessionStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* private mode etc. — the pick simply won't persist */
    }
  };
  return [value, set];
}

export default function DriverStandings() {
  useSeasonParam(); // honour a ?season=N deep link (e.g. from the global search)
  const { data, loading, error } = useApi(useCallback(() => api.driverStandings(), []));
  const races = useApi(useCallback(() => api.races(), []));
  const { current: season, active } = useSeason();
  const [onlyScoring, setOnlyScoring] = usePersistentState("nabs.standings.onlyScoring", false);
  const [tier, setTier] = usePersistentState("nabs.standings.tier", "all");
  // "list" = the ranked cards/rows; "grid" = the per-round points matrix (same
  // table the Constructors page uses); "cards" = the whole field as their
  // actual driver rating cards, in championship order.
  const [view, setView] = usePersistentState("nabs.standings.view", "list");

  // Ratings (incl. each driver's card look) are only fetched once the Cards
  // view is opened — the list/matrix don't need them.
  const [cardData, setCardData] = useState(null);
  useEffect(() => {
    if (view !== "cards" || cardData) return;
    let alive = true;
    api
      .seasonRatings()
      .then((d) => alive && setCardData(d || { ratings: [] }))
      .catch(() => alive && setCardData({ ratings: [] }));
    return () => { alive = false; };
  }, [view, cardData]);

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

  return (
    <div className="content-in">
      <PageHeader eyebrow="Championship" title="Driver Standings" />

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
          <SlidingTabs
            items={tierFilters.map((t) => ({ key: t.id, label: t.label }))}
            value={activeTier}
            onChange={setTier}
          />
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-3">
          {hasRounds && (
            <SlidingTabs
              items={[
                { key: "list", label: "List" },
                { key: "grid", label: "By round" },
                { key: "cards", label: "Cards" },
              ]}
              value={activeView}
              onChange={setView}
            />
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
      ) : activeView === "cards" ? (
        // The field as their actual rating cards, in championship order of the
        // current filter view. Drivers without a card yet (no race this season)
        // simply don't appear; the note below says so.
        !cardData ? (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3" style={{ justifyItems: "center" }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[470px] w-[332px] max-w-full rounded-2xl" />
            ))}
          </div>
        ) : (() => {
          const ratingById = new Map(cardData.ratings.map((r) => [r.driverId, r]));
          const withCards = rows.filter((d) => ratingById.has(d.driverId));
          if (withCards.length === 0)
            return <div className="card p-8 text-center text-medium">No rating cards yet — they appear once drivers have raced.</div>;
          return (
            <div>
              <div className="rcard-fit cascade grid gap-x-4 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" style={{ justifyItems: "center" }}>
                {withCards.map((d, i) => {
                  const r = ratingById.get(d.driverId);
                  return (
                    <div key={d.driverId} className="w-full max-w-[332px]" style={{ "--i": Math.min(i, 16) }}>
                      {/* Standing line ABOVE the card — plain text, no box:
                          rank (medal-coloured on the podium) + gap, points right. */}
                      <div className="mb-2 flex items-end justify-between px-1">
                        <span className="flex items-center gap-2.5">
                          <Rank position={d.position} />
                          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">
                            {d.position === 1 ? (seasonDecided ? "Champion" : "Leader") : `−${leaderTotal - d.total} pts`}
                          </span>
                        </span>
                        <span className="font-display text-xl font-black leading-none tabular-nums text-dark">
                          {d.total}
                          <span className="ml-1 font-mono text-[10px] font-bold uppercase tracking-wider text-light">pts</span>
                        </span>
                      </div>
                      <Link to={`/drivers/${d.driverId}`} className="block transition hover:-translate-y-1">
                        <RatingCard
                          driver={{
                            id: d.driverId,
                            name: d.name,
                            number: r.number,
                            country: d.country || r.country,
                            photoUrl: d.photoUrl || r.photoUrl,
                            tier: d.tier,
                            role: r.role,
                            team: d.team,
                            cardStyle: r.cardStyle,
                            cardAnim: r.cardAnim,
                            photoPos: r.photoPos,
                            cardPhotoUrl: r.cardPhotoUrl,
                            seasonNumber: cardData.seasonNumber,
                          }}
                          rating={r}
                        />
                      </Link>
                    </div>
                  );
                })}
              </div>
              {withCards.length < rows.length && (
                <p className="mt-6 text-center text-xs text-light">
                  {rows.length - withCards.length} of {rows.length} drivers have no card yet (no race this season).
                </p>
              )}
            </div>
          );
        })()
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
