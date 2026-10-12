import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { seasonLabelOf } from "../utils/pageTitle.js";
import { useSeasonParam } from "../hooks/useSeasonParam.js";
import { ArrowDownUp, ChevronRight, Users } from "lucide-react";
import { ErrorBox, PageHeader, PageHeaderSkeleton, SectionHeading, TableSkeleton, Skeleton, DriverAvatar } from "../components/ui.jsx";
import { useTilt } from "../hooks/motion.js";
import ConstructorTable from "../components/ConstructorTable.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";
import Flag from "../components/Flag.jsx";
import { countryFor } from "../data/driverCountries.js";
import { useTransfersVisible } from "../hooks/useTransfersVisible.js";

// Rounds that actually have scores recorded (for the progression chart).
function completedRounds(data) {
  return data.raceNumbers.filter((n) => data.standings.some((t) => t.perRace[n] != null));
}

// One tier shown as a unit: championship table and the line-ups of every team
// in that tier. `championTeamId` (set once the season is decided) puts the
// golden champion treatment on that team. `reserves` (the reserve pool's team
// row) adds the pool's tile after the line-ups.
function TierBlock({ id, tier, standings, teams, races, title, championTeamId, decided = false, showMovement = false, reserves = null }) {
  const rows = standings.standings;
  const transfers = useTransfersVisible();
  const done = completedRounds(standings);
  const lastRound = done[done.length - 1];

  // Line-up cards in championship order, mirroring the table above (the roster
  // endpoint returns them in admin order). Teams without a standings entry
  // (no points recorded yet) keep their roster order at the end.
  const posByTeam = new Map(rows.map((r, i) => [r.teamId, i]));
  const orderedTeams = [...teams].sort(
    (a, b) => (posByTeam.get(a.id) ?? Infinity) - (posByTeam.get(b.id) ?? Infinity)
  );
  const rowByTeam = new Map(rows.map((r) => [r.teamId, r]));
  const rosterByTeam = new Map(teams.map((t) => [t.id, t.drivers]));

  return (
    <section id={id} className="reveal scroll-mt-28 space-y-6">
      {/* No "Champions" pill up here — the gold first row of the table and the
          champion team card below already say it. */}
      <SectionHeading
        eyebrow="Constructors' Championship"
        title={title || `Tier ${tier}`}
        right={
          lastRound != null && (
            <span className="hidden shrink-0 font-mono text-[11px] font-bold uppercase tracking-wider text-light sm:block">
              After R{lastRound} of {standings.raceNumbers.length}
            </span>
          )
        }
      />

      <ConstructorTable standings={standings} races={races} rosterByTeam={rosterByTeam} decided={decided} showMovement={showMovement} />

      <div className="space-y-3 pt-2">
        {/* The cards show who is in each seat today and what each of them has
            brought in. Moves, past and booked, live on the transfer market
            page, one tap away. */}
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">Line-ups</h3>
          {transfers && (
          <Link
            to="/transfers"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-medium transition hover:border-brand/50 hover:text-dark"
            title="Every team change of this season, and who drove for whom round by round"
          >
            <ArrowDownUp className="h-3.5 w-3.5" aria-hidden="true" />
            Team changes
          </Link>
          )}
        </div>
        <div className="cascade grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orderedTeams.map((team, i) => (
            <TeamCard key={team.id} team={team} row={rowByTeam.get(team.id) || null} index={i} champion={team.id === championTeamId} />
          ))}
          {reserves && reserves.drivers.length > 0 && (
            <div style={{ "--i": orderedTeams.length }}>
              <Link
                to={`/teams/${reserves.id}`}
                className="flex h-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border p-6 text-center transition hover:border-brand/50"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-light shadow-card">
                  <Users className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="mt-2 font-display text-sm font-bold uppercase text-dark">Reserve pool</span>
                <span className="text-xs text-light">
                  {reserves.drivers.length} {reserves.drivers.length === 1 ? "driver" : "drivers"} ready to fill in
                </span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// A team's line-up: place and points up top, then each driver in the seat
// today with the points they have scored for this team and their share of
// everything the team scored on track (subs included, before drops). Archived
// seasons that only kept the team's own round sheet have no such split, so
// those cards show the names alone.
function TeamCard({ team, row, index = 0, champion = false }) {
  const tiltRef = useTilt({ max: 5, lift: 5 });
  const scorers = row?.scorers || null;
  const scoredByTeam = scorers ? scorers.reduce((s, x) => s + x.points, 0) : 0;
  const scorerOf = new Map((scorers || []).map((x) => [x.driverId, x]));
  const seated = new Set(team.drivers.map((d) => d.id));
  // Points brought in by drivers not in these seats today (subs, and anyone
  // who moved on), said in one line so the bars above still add up.
  const others = (scorers || []).filter((x) => !seated.has(x.driverId)).reduce((s, x) => s + x.points, 0);
  const drivers = [...team.drivers].sort(
    (a, b) => (scorerOf.get(b.id)?.points ?? 0) - (scorerOf.get(a.id)?.points ?? 0)
  );
  return (
    // Wrapper takes the cascade entrance so its filled keyframe can't pin the
    // card's transform — that's what kept the tilt from easing in smoothly.
    <div style={{ "--i": index }}>
    <div
      ref={tiltRef}
      className={`transition card shine tilt relative h-full overflow-hidden p-4 hover:shadow-lift ${champion ? "champion-gold" : ""}`}
    >
      <Link to={`/teams/${team.id}`} className="group flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `color-mix(in srgb, ${team.color} 12%, transparent)` }}
        >
          <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={30} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-base font-extrabold uppercase tracking-tight text-dark transition group-hover:text-brand">
            {team.name}
          </span>
          <span className="block font-mono text-[10px] font-bold uppercase tracking-wider text-light">
            {row ? `P${row.position} · ${row.total} pts` : "No points yet"}
          </span>
        </span>
        {champion && (
          <span className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--medal-1)" }}>
            Champions
          </span>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
      </Link>
      <ul className="mt-2 divide-y divide-border">
        {drivers.map((d) => {
          const pts = scorerOf.get(d.id)?.points ?? 0;
          const share = scoredByTeam > 0 ? Math.round((pts / scoredByTeam) * 100) : 0;
          return (
            <li key={d.id}>
              <Link
                to={`/drivers/${d.id}`}
                className="group/driver flex items-center gap-3 py-2"
                title={scorers ? `${pts} of the ${scoredByTeam} points ${team.name} scored on track (${share}%)` : undefined}
              >
                <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={team.color} size={30} />
                {/* The driver's name keeps its line; the Discord name gives way. */}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-display text-sm font-bold uppercase tracking-tight text-dark transition group-hover/driver:text-brand">
                      {d.name}
                    </span>
                    <Flag code={countryFor(d.id, d.country)} />
                  </span>
                  {d.discordName && <span className="block truncate text-xs text-light">@{d.discordName}</span>}
                </span>
                {scorers && (
                  <span className="w-20 shrink-0">
                    <span className="block text-right font-mono text-xs font-bold tabular-nums text-dark">{pts}</span>
                    <span className="mt-1 block h-1 rounded-full bg-surface2">
                      <span className="block h-1 rounded-full" style={{ width: `${share}%`, backgroundColor: team.color }} />
                    </span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
        {team.drivers.length === 0 && <li className="py-2 text-sm text-light">No drivers assigned.</li>}
      </ul>
      {others > 0 && (
        <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-light">
          {others} pts from other drivers
        </p>
      )}
    </div>
    </div>
  );
}

// Quick anchor pills in the page header so Tier 2 is one tap away instead of a
// long scroll past the whole Tier-1 block.
function TierJump({ className = "" }) {
  // Slightly tighter below sm so both pills fit beside the page title.
  const cls =
    "rounded-lg border border-border bg-card px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-medium transition hover:border-brand/50 hover:text-dark sm:px-3 sm:text-[11px]";
  return (
    <div className={`gap-1.5 sm:gap-2 ${className}`}>
      <a href="#tier-1" className={cls}>
        Tier 1
      </a>
      <a href="#tier-2" className={cls}>
        Tier 2
      </a>
    </div>
  );
}

export default function Constructors() {
  useSeasonParam(); // honour a ?season=N deep link (e.g. from the global search)
  const t1 = useApi(useCallback(() => api.t1Standings(), []));
  const t2 = useApi(useCallback(() => api.t2Standings(), []));
  const teams = useApi(useCallback(() => api.teams(), []));
  const races = useApi(useCallback(() => api.races(), []));
  // The late-season "drop worst" preview, as on the driver standings: how many
  // worst DRIVER results so far to take off, or null for the real table. Our
  // rule drops drivers' results, never a team's whole round, so the preview
  // does too (the backend picks the per-driver or per-seat count the season
  // uses). Both tiers are fetched together and swapped in once they arrive,
  // so the tables stay up. Not remembered: the real table is the default.
  const [dropPick, setDropPick] = useState(null);
  const [projected, setProjected] = useState(null); // { n, t1, t2 }
  useEffect(() => {
    if (dropPick == null || projected?.n === dropPick) return undefined;
    let alive = true;
    Promise.all([api.t1Standings(undefined, null, dropPick), api.t2Standings(undefined, null, dropPick)])
      .then(([a, b]) => alive && setProjected({ n: dropPick, t1: a, t2: b }))
      .catch(() => alive && setDropPick(null));
    return () => { alive = false; };
  }, [dropPick, projected]);
  const { current: season, active } = useSeason();
  // The season belongs in the heading, not only in the switcher above it.
  // Eight seasons of this page otherwise share one H1, so neither a reader
  // landing from a search nor the search engine itself can tell them apart —
  // and the tab title has named the season all along. Same label as there
  // (utils/pageTitle.js), so the two never disagree.
  const seasonName = seasonLabelOf(season);
  const seasonHeading = seasonName ? `${seasonName} Constructors` : "Constructors";

  if (t1.loading || t2.loading || teams.loading)
    return (
      <div className="space-y-6 sm:space-y-14">
        <PageHeaderSkeleton />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-5">
            <Skeleton className="h-7 w-48" />
            <TableSkeleton rows={6} />
          </div>
        ))}
      </div>
    );
  if (t1.error || t2.error || teams.error)
    return (
      <div>
        <PageHeader eyebrow="Championship" title={seasonHeading} />
        <ErrorBox
          message={t1.error || t2.error || teams.error}
          onRetry={() => { t1.reload(); t2.reload(); teams.reload(); }}
        />
      </div>
    );

  // The tables on show: the preview once it has arrived, otherwise the real ones.
  const projecting = dropPick != null && projected?.n === dropPick;
  const t1Data = projecting ? projected.t1 : t1.data;
  const t2Data = projecting ? projected.t2 : t2.data;

  const t1Teams = teams.data.filter((t) => t.tier === 1);
  const t2Teams = teams.data.filter((t) => t.tier === 2);
  // The reserve pool (tier 0), shown once, after the last tier's line-ups.
  const reserveTeam = teams.data.find((t) => t.tier === 0) || null;
  // Single-class seasons (archived S1–S5) have no Tier 2 at all: hide the split
  // and the jump pills, and title the one block plainly "Constructors".
  const hasT2 = t2Data.standings.length > 0 || t2Teams.length > 0;
  // The title is decided: archived season, or the live one with every round in.
  const champRounds = (races.data || []).filter((r) => !r.isSpecialEvent && r.number != null);
  const seasonDecided =
    (!!season && !!active && season.number < active.number) ||
    (champRounds.length > 0 && champRounds.every((r) => r.isCompleted));
  const champId = (data) => (seasonDecided && (data.standings[0]?.total ?? 0) > 0 ? data.standings[0].teamId : null);
  // Movement arrows + the shake-up replay, same gate as the driver standings:
  // live seasons only (a decided table should sit still), with the dev-only
  // ?demo knob to preview on an archive.
  const demoArrows = import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo");
  const showMovement = (!seasonDecided || demoArrows) && !projecting;
  // Same window as the driver standings: only in the last stretch (no more
  // rounds left than drops), live seasons only. The choices run from what the
  // rule drops TODAY (unrun rounds soak up drops) up to the season's count.
  const roundsLeft = t1.data.raceNumbers.length - completedRounds(t1.data).length;
  const previewDrops = t1.data.previewDrops || 0;
  const dropsNow = Math.min(t1.data.dropsNow ?? 0, hasT2 ? t2.data.dropsNow ?? 0 : Infinity);
  const dropChoices =
    !seasonDecided && previewDrops > 0 && roundsLeft > 0 && roundsLeft <= previewDrops
      ? Array.from({ length: previewDrops - dropsNow + 1 }, (_, i) => dropsNow + i)
      : [];
  const pickDrops = (n) => setDropPick(n === dropsNow ? null : n);
  const teamRule = t1.data.dropMode === "team";

  return (
    <div className="content-in space-y-10 sm:space-y-16">
      {/* The tier pills share the title line on every width (rightInline) —
          they're small enough now that they no longer push the header past
          the viewport, and the content starts a row earlier on phones. */}
      <PageHeader
        eyebrow="Championship"
        title={seasonHeading}
        rightInline
        right={hasT2 ? <TierJump className="flex shrink-0" /> : null}
      />

      {dropChoices.length > 1 && (
        <div className="-mt-4 space-y-2 sm:-mt-8">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-medium">Drop worst</span>
              <SlidingTabs
                items={dropChoices.map((n) => ({
                  key: n,
                  title: n === dropsNow ? "The tables as they stand" : `Preview with ${n} worst driver results dropped`,
                  label: <span className="font-mono tabular-nums">{n}</span>,
                }))}
                value={dropPick ?? dropsNow}
                onChange={pickDrops}
                wrapClassName="flex rounded-lg bg-surface2 p-0.5"
                btnClassName="flex h-6 min-w-[28px] items-center justify-center px-2 text-xs font-bold"
                pillClassName="rounded-md bg-brand"
                activeClassName="text-onbrand"
                idleClassName="text-light hover:text-dark"
              />
            </div>
            <span className="font-mono text-[11px] uppercase tracking-wider text-light">
              <b className="tabular-nums text-dark">{t1.data.raceNumbers.length}</b> rounds
            </span>
          </div>
          {dropPick != null && (
            <p className="content-in flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-warn/10 px-3 py-2 text-[13px] text-warn">
              <span>
                <b>Preview, not the real table.</b>{" "}
                {teamRule && projecting && t1Data.projectedTeamDrops != null ? (
                  <>
                    {dropPick} worst result{dropPick === 1 ? "" : "s"} per driver so far: each team&rsquo;s{" "}
                    {t1Data.projectedTeamDrops} worst single-driver result{t1Data.projectedTeamDrops === 1 ? " is" : "s are"} dropped
                  </>
                ) : (
                  <>
                    Every driver&rsquo;s {dropPick} worst result{dropPick === 1 ? "" : "s"} so far{" "}
                    {dropPick === 1 ? "is" : "are"} dropped from the team they drove for
                  </>
                )}
                , never a team&rsquo;s whole round. That only holds if nobody does worse in the last{" "}
                {roundsLeft === 1 ? "round" : `${roundsLeft} rounds`} than in those.
              </span>
              <button
                type="button"
                onClick={() => setDropPick(null)}
                className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-dark shadow-sm transition hover:bg-surface2"
              >
                Back to real table
              </button>
            </p>
          )}
        </div>
      )}

      <TierBlock id="tier-1" tier={1} standings={t1Data} teams={t1Teams} races={races.data || []} title={hasT2 ? undefined : "Constructors"} championTeamId={champId(t1Data)} decided={seasonDecided} showMovement={showMovement} reserves={hasT2 ? null : reserveTeam} />
      {hasT2 && <TierBlock id="tier-2" tier={2} standings={t2Data} teams={t2Teams} races={races.data || []} championTeamId={champId(t2Data)} decided={seasonDecided} showMovement={showMovement} reserves={reserveTeam} />}
    </div>
  );
}
