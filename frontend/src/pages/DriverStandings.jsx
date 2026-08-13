import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSeasonParam } from "../hooks/useSeasonParam.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, TableSkeleton, Skeleton, TierBadge, Rank, MEDAL, DriverAvatar, CountUp, EmptyState, PosDelta } from "../components/ui.jsx";
import { playStandingsReplay } from "../utils/standingsReplay.js";
import { useTilt, motionOff } from "../hooks/motion.js";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import StandingsTable from "../components/StandingsTable.jsx";
import RatingCard from "../components/RatingCard.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";
import { countryFor } from "../data/driverCountries.js";
import { isIdleReserve } from "../utils/standingsRow.js";

// The caption under a driver's points, on the podium cards and in every row.
//
// Who leads is decided by RANK, never by the points gap. Before a season's
// first round everybody sits on zero, so a gap-based test called the entire
// podium "Leader" at once — which is what an announced-but-not-started season
// showed. And a driver who is genuinely level with the leader reads "level"
// rather than "−0", which looked like a rounding fault.
function standingCaption(position, gap, { decided = false, unit = "", lower = false } = {}) {
  const cased = (s) => (lower ? s.toLowerCase() : s);
  if (position === 1) return cased(decided ? "Champion" : "Leader");
  if (gap <= 0) return cased("Level");
  return `−${gap}${unit}`;
}

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
      className={`transition card shine tilt relative block h-full overflow-hidden p-5 hover:shadow-xl ${champion ? "champion-gold" : ""}`}
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
              {champion ? "Champion" : standingCaption(row.position, gap, { unit: " pts" })}
            </span>
          </div>
        </div>
      </div>
    </Link>
    </div>
  );
}

// PosDelta (the ▲/▼ movement chip) lives in ui.jsx now — the constructors
// round matrix shows the same movement, and two copies would drift.

function DriverRow({ d, leaderTotal, index = 0, showTier = true, champion = false, decided = false, delta = null }) {
  const gap = leaderTotal - d.total;
  const pct = d.total > 0 && leaderTotal > 0 ? Math.max(4, (d.total / leaderTotal) * 100) : 0;
  return (
    <Link
      to={`/drivers/${d.driverId}`}
      data-driver-id={d.driverId}
      data-replay-prev={d.prevPosition ?? ""}
      style={{ "--i": index }}
      className={`flex items-center gap-2.5 px-3 py-3 transition sm:gap-4 sm:px-5 ${
        champion ? (decided ? "row-gold" : "row-leader") : "hover:bg-surface2"
      }`}
    >
      <Rank position={d.position} />
      <PosDelta delta={delta} />
      <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: d.team.color }} />
      <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={d.team.color} size={36} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-base font-bold uppercase tracking-tight text-dark sm:text-lg">
            {d.name}
          </span>
          <Flag code={countryFor(d.driverId, d.country)} />
          {/* On phones the badge stole the name's room (even short names were
              cut) — the tier filter tabs above cover that info there. */}
          {showTier && (
            <span className="hidden sm:inline-flex">
              <TierBadge tier={d.tier} />
            </span>
          )}
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

      <div className="w-12 shrink-0 text-right sm:w-20">
        <div className="font-mono text-lg font-bold tabular-nums text-dark sm:text-xl">
          <CountUp end={d.total} duration={900} />
        </div>
        <div className="font-mono text-[11px] tabular-nums text-light">
          {standingCaption(d.position, gap, { lower: true })}
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
  // Whether this mount has already replayed the latest round's position moves
  // (see replayRef below), and the replay's cancel handle so an unmount while
  // it still waits for the list to scroll into view tears its listener down.
  // Declared up here with the other hooks — everything below the early
  // returns must stay hook-free.
  const seasonReplayed = useRef(false);
  const replayCancel = useRef(null);
  const replayNode = useRef(null);
  const { data, loading, error, reload } = useApi(useCallback(() => api.driverStandings(), []));
  const races = useApi(useCallback(() => api.races(), []));
  const { current: season, active } = useSeason();
  // Default OFF on purpose: the full field, reserves included, is what the
  // standings are meant to show. Defaulting this to ON was tried and taken back
  // out — the crowded table is the intended one. The count line under the table
  // still says how many rows a ticked box is holding back.
  const [onlyScoring, setOnlyScoring] = usePersistentState("nabs.standings.onlyScoring", false);
  // Reserves who never got in a car this season (see isIdleReserve below) are
  // off the table by default. This flips them back on.
  const [showIdleReserves, setShowIdleReserves] = usePersistentState("nabs.standings.idleReserves", false);
  const [tier, setTier] = usePersistentState("nabs.standings.tier", "all");
  // "list" = the ranked cards/rows; "grid" = the per-round points matrix (same
  // table the Constructors page uses); "cards" = the whole field as their
  // actual driver rating cards, in championship order.
  const [view, setView] = usePersistentState("nabs.standings.view", "list");
  // Rating cards are a per-season switch (admin Seasons tab): the early seasons
  // were raced without the telemetry the ratings are built from, so their cards
  // would be guesswork. Off = the Cards option isn't offered at all here, and a
  // remembered "cards" choice quietly falls back to the list.
  const cardsEnabled = season?.cardsEnabled !== false;

  // Ratings (incl. each driver's card look) are only fetched once the Cards
  // view is opened — the list/matrix don't need them.
  const [cardData, setCardData] = useState(null);
  useEffect(() => {
    if (view !== "cards" || !cardsEnabled || cardData) return;
    let alive = true;
    api
      .seasonRatings()
      .then((d) => alive && setCardData(d || { ratings: [] }))
      .catch(() => alive && setCardData({ ratings: [] }));
    return () => { alive = false; };
  }, [view, cardsEnabled, cardData]);

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
  // Header stays up on a failed read, so the page still reads as the standings
  // rather than as a broken site.
  if (error)
    return (
      <div>
        <PageHeader eyebrow="Championship" title="Driver Standings" />
        <ErrorBox message={error} onRetry={reload} />
      </div>
    );

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

  // Filter by tier, drop the reserves who haven't raced, then optionally hide
  // point-less drivers, then re-rank the resulting view 1..n so a tier
  // sub-table reads as its own standings.
  let rows = activeTier === "all" ? all : all.filter((r) => String(r.tier) === activeTier);
  // Who the standings are actually for: everyone holding a seat in a Tier 1 or
  // Tier 2 team, plus the reserves who turned up — scored a point, or started
  // a round (a start counts even if it ended in a DNF and no points, which is
  // why this asks perRace rather than the total). A season's reserve pool is
  // the whole sign-up list, so the rest of it is people who haven't driven
  // this season at all: dozens of identical zero rows that are not part of any
  // championship. The count line under the table brings them back in one
  // click, so nobody vanishes without the page saying so. The rule itself
  // lives in utils/standingsRow.js — the driver and team profiles withhold a
  // P-number from exactly these rows, and the two have to agree.
  const idleReserves = rows.filter(isIdleReserve).length;
  if (!showIdleReserves) rows = rows.filter((r) => !isIdleReserve(r));
  // The opt-in "only drivers with points" box on top of that, which also takes
  // out the seated drivers who haven't scored. It only bites once there is a
  // championship to show: before a season's first round nobody has scored, and
  // an empty table is no answer. `hiddenCount` feeds the line under the table,
  // so nothing disappears without saying so.
  const anyScorer = rows.some((r) => r.total > 0);
  const hideScoreless = onlyScoring && anyScorer;
  const hiddenCount = hideScoreless ? rows.filter((r) => r.total <= 0).length : 0;
  if (hideScoreless) rows = rows.filter((r) => r.total > 0);
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
  // Position movement vs. the standings BEFORE the most recent round, computed
  // within the current view (same tier filter, same re-ranking) with the same
  // drop-worst rule the season total uses. Only while the title race runs —
  // archive tables stay quiet.
  // Dev-only (?demo=1): preview the arrows on a finished season too.
  const demoArrows = import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo");
  // Movement vs the previous round comes from the SERVER (prevPosition on each
  // standings row): the previous table is ranked there with the same drop rule
  // and the same FIA countback as the real one, so the arrow can never
  // disagree with the order it sits next to. This used to be approximated here
  // in the browser with a plain points sort — no countback, name as the
  // tie-break — which ranked level drivers differently than the table itself,
  // and re-summed every driver's season inside a comparator on every render.
  const deltaById = new Map();
  if (!seasonDecided || demoArrows) {
    for (const r of rows) {
      if (r.prevPosition != null) deltaById.set(r.driverId, r.prevPosition - r.position);
    }
  }

  // Replay the latest round's shake-up ONCE per visit, live-page style: the
  // list first paints in the PREVIOUS round's order, holds a beat, then every
  // mover glides to their real slot and flashes green or red (same glide and
  // the same flash the projection table uses on race night, so the two pages
  // speak one language). Only on the full list — a tier filter re-sorts for a
  // reason that is not a round landing, and replaying there would be a lie.
  //
  // Runs from the container's CALLBACK REF, not an effect: refs attach in the
  // commit phase, before the browser paints, so the rows are already offset to
  // their old slots by first paint — and a callback needs no hooks, which
  // matters here because this code sits below the component's early returns
  // (loading/error), where a hook would change the hook order between renders
  // and crash the page. That is not hypothetical: the first version did
  // exactly that. The rows are rendered in the FINAL order the whole time;
  // only transforms move, so links, keys and the DOM order never change.
  const replayArmed =
    !seasonReplayed.current &&
    activeTier === "all" &&
    !motionOff() &&
    [...deltaById.values()].some((v) => v !== 0);
  // An INLINE callback ref is re-created every render, and React answers that
  // by detaching (null) and re-attaching on EVERY render — not just on mount
  // and unmount. So the detach arm must tell teardown from render noise, or a
  // cancel fires mid-glide whenever anything re-renders: the node still being
  // in the document means noise (do nothing), the node gone means the page
  // really left (tear the scroll listener down).
  const replayRef = (box) => {
    if (box) {
      replayNode.current = box;
      if (!replayArmed || seasonReplayed.current) return;
      seasonReplayed.current = true;
      replayCancel.current = playStandingsReplay(box);
    } else if (replayNode.current && !replayNode.current.isConnected) {
      replayCancel.current?.();
      replayCancel.current = null;
      replayNode.current = null;
    }
  };

  const scopeLabel = activeTier === "all" ? "drivers" : TIER_FILTERS.find((t) => t.id === activeTier).label;
  // The per-round matrix needs actual rounds; archived totals-only seasons fall
  // back to the list regardless of what's selected — as does a season whose
  // cards the admin switched off.
  const activeView = !hasRounds || (view === "cards" && !cardsEnabled) ? "list" : view;

  return (
    <div className="content-in">
      <PageHeader eyebrow="Championship" title="Driver Standings" />

      {top3.length > 0 && (
        // Phones skip the leader cards entirely — the same three drivers head
        // the table right below, so the cards were a screen of duplicate info
        // before the actual standings. 3-across only from lg: at md widths the
        // cards get so narrow the driver names truncate away entirely.
        <div className="cascade mb-8 hidden gap-4 sm:grid lg:grid-cols-3">
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

      <div data-tour="standings-views" className="mb-4 flex flex-wrap items-center justify-between gap-3">
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
                // Seasons without rating cards don't get the option at all,
                // rather than an option that leads to an empty grid.
                ...(cardsEnabled ? [{ key: "cards", label: "Cards" }] : []),
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
              className="h-4 w-4 rounded border-border text-link focus:ring-primary/30"
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
        {/* Says out loud what the default filter is doing, and undoes it in one
            click. Without this the reserve pool would simply be missing with no
            explanation, which is worse than the crowded table it replaces. */}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setOnlyScoring(false)}
            className="text-light underline decoration-dotted underline-offset-4 transition hover:text-dark"
          >
            <span className="font-mono font-bold tabular-nums">{hiddenCount}</span> without points hidden
          </button>
        )}
        {/* Same idea for the reserve pool: the line names the people the table
            is leaving out and puts them back (or away again) in one click. */}
        {idleReserves > 0 && (
          <button
            type="button"
            onClick={() => setShowIdleReserves(!showIdleReserves)}
            className="text-light underline decoration-dotted underline-offset-4 transition hover:text-dark"
          >
            {showIdleReserves ? (
              <>Hide the <span className="font-mono font-bold tabular-nums">{idleReserves}</span> reserves without a start</>
            ) : (
              <><span className="font-mono font-bold tabular-nums">{idleReserves}</span> reserves without a start hidden</>
            )}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No drivers here"
          hint={
            idleReserves > 0
              ? "Nobody here has started a round yet. The line above shows the reserves who signed up."
              : "Nobody matches this filter yet. Try another tier, or include drivers without points."
          }
        />
      ) : activeView === "cards" ? (
        // The field as their actual rating cards, in championship order of the
        // current filter view. The numbers are the season's FROZEN card values
        // (where each driver stood at the end of the previous season), so they
        // don't move round by round. Drivers nobody has ever rated (a rookie
        // before their first start) have no card; the note below says so.
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
            return <EmptyState title="No rating cards yet" hint="A card is carried over from the previous season, or earned with a driver's first races." />;
          return (
            <div>
              {cardData.cardFromSeasonNumber != null && (
                <p className="mb-6 text-center font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
                  These cards are locked for the season · they show where each driver stood at the end of Season{" "}
                  {cardData.cardFromSeasonNumber}
                </p>
              )}
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
                            {standingCaption(d.position, leaderTotal - d.total, { decided: seasonDecided, unit: " pts" })}
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
                  {rows.length - withCards.length} of {rows.length} drivers have no card yet (never rated in an earlier season).
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
          showMovement={!seasonDecided || demoArrows}
        />
      ) : (
        <div
          ref={replayRef}
          // While the replay runs (and afterwards, for this mount) the cascade
          // entrance stays off: its per-row rise animates transform, and the
          // replay owns transform. The replay IS the entrance on those loads.
          className={`${replayArmed || seasonReplayed.current ? "" : "cascade"} card divide-y divide-border overflow-hidden`}
        >
          {rows.map((d, i) => (
            <DriverRow
              key={d.driverId}
              d={d}
              leaderTotal={leaderTotal}
              index={Math.min(i, 16)}
              showTier={multiTier}
              champion={championIds.has(d.driverId)}
              decided={seasonDecided}
              delta={deltaById.has(d.driverId) ? deltaById.get(d.driverId) : null}
            />
          ))}
        </div>
      )}

      {/* The season total is NOT the sum of a driver's results: the lowest N
          rounds come off first. That was explained in exactly one place, the
          footnote under the round matrix — so in the two views most people
          actually read, the headline number of the whole page was unexplained
          and did not add up. The matrix has its own, fuller wording (it can
          point at the struck-through cells), so this only fills the other two. */}
      {activeView !== "grid" && data.dropWorst > 0 && data.raceNumbers.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-light">
          Points are the season total after the drop rule: each driver&rsquo;s {data.dropWorst} lowest-scoring
          round{data.dropWorst === 1 ? " doesn't" : "s don't"} count
          {data.raceNumbers.length > data.dropWorst && (
            <> (best {data.raceNumbers.length - data.dropWorst} of {data.raceNumbers.length})</>
          )}
          . Switch to <button type="button" onClick={() => setView("grid")} className="underline decoration-dotted underline-offset-2 transition hover:text-dark">By round</button> to see which rounds were dropped.
        </p>
      )}
    </div>
  );
}
