import { useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Trophy } from "lucide-react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeasonParam } from "../hooks/useSeasonParam.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useTheme } from "../hooks/useTheme.js";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { ErrorBox, PageHeaderSkeleton, Skeleton, MEDAL, MEDAL_TEXT, DriverAvatar, CountUp, readableAccent } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import TeamMarginChart from "../components/TeamMarginChart.jsx";
import TeamAllTimeDrivers from "../components/TeamAllTimeDrivers.jsx";
import { flagFor } from "../data/circuits.js";
import { countryFor } from "../data/driverCountries.js";
import { NO_VALUE } from "../utils/format.js";
import { isIdleReserve, finishesOf, roundsOf } from "../utils/standingsRow.js";
import { cumulativeTotals } from "../utils/cumulativePoints.js";

const TIER_LABEL = { 1: "Tier 1", 2: "Tier 2", 0: "Reserve" };

// A team colour at a given strength over whatever sits behind it (any colour
// string the admin typed, not only six-digit hex).
const tint = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

// --- tiny inline icons (stroke = currentColor) ---------------------------
const I = {
  trophy: "M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM7 5H4v2a3 3 0 003 3M17 5h3v2a3 3 0 01-3 3",
  podium: "M4 21V11h5v10M9 21V5h6v16M15 21V9h5v12",
  flagChk: "M5 21V4M5 4h14l-3 4 3 4H5",
  chart: "M4 19h16M7 15l3-4 3 3 4-6",
  hash: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
};
function Icon({ name, className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={I[name]} />
    </svg>
  );
}

function Stat({ icon, label, value, sub, accent, index = 0 }) {
  return (
    <div className="card shine p-4" style={{ "--i": index }}>
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

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const roundsText = (n) => `${WORDS[n] ?? n} round${n === 1 ? "" : "s"}`;
const pointsText = (n) => `${n} point${n === 1 ? "" : "s"}`;

// [1,2,3,4,5,8] -> "R1 to R5 and R8"
function roundRanges(nums) {
  const parts = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(i === j ? `R${nums[i]}` : `R${nums[i]} to R${nums[j]}`);
    i = j;
  }
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "";
}

// The hero's one line of context: where the team stands against the top of
// its table, how many rounds are left, and when it last led if it does not
// now. Everything comes from the standings already on the page.
function standingLine({ teamRow, rows, toGo, decided, ledAfter }) {
  if (!teamRow) return null;
  if (!ledAfter.total) return <>No rounds raced yet this season.</>;
  const leader = rows[0];
  const second = rows[1];
  const left = toGo > 0 ? <> with {roundsText(toGo)} to go</> : null;
  if (teamRow.position === 1) {
    if (!second) return decided ? <>Constructors&rsquo; champions.</> : null;
    const margin = teamRow.total - second.total;
    if (decided)
      return margin > 0 ? (
        <>Constructors&rsquo; champions, <b>{pointsText(margin)}</b> clear of {second.name}.</>
      ) : (
        <>Constructors&rsquo; champions on countback against {second.name}.</>
      );
    return margin > 0 ? (
      <>Leads the table by <b>{pointsText(margin)}</b> over {second.name}{left}.</>
    ) : (
      <>Level on points with {second.name} at the top, ahead on countback{left}.</>
    );
  }
  const gap = leader.total - teamRow.total;
  const led = ledAfter.rounds.length > 0 ? <> Led the table after {roundRanges(ledAfter.rounds)}.</> : null;
  if (decided)
    return (
      <>
        Finished P{teamRow.position}, {gap > 0 ? <><b>{pointsText(gap)}</b> behind {leader.name}</> : <>level on points with {leader.name}</>}.{led}
      </>
    );
  return gap > 0 ? (
    <><b>{pointsText(gap)}</b> behind {leader.name}{left}.{led}</>
  ) : (
    <>Level on points with {leader.name}, behind on countback{left}.{led}</>
  );
}

// Per-round points as columns in the team colour, with a dashed line at the
// team's average and its best round ringed. Points scored but dropped are the
// faded top of a column (a fully dropped round is all faded). Upcoming rounds
// show an empty stub. On phones the columns turn into one bar per round.
function RoundBars({ raceNumbers, perRace, droppedPerRace, raceByNumber, color }) {
  const rounds = raceNumbers.map((n) => {
    const race = raceByNumber.get(n);
    const pts = perRace?.[n];
    const done = pts != null;
    const dropped = done ? Math.min(pts, droppedPerRace?.[n] || 0) : 0;
    return {
      n,
      race,
      done,
      pts: pts ?? 0,
      counted: (pts ?? 0) - dropped,
      dropped,
      circ: race ? flagFor(race.track, race.country) : null,
    };
  });
  const played = rounds.filter((r) => r.done);
  const maxPts = Math.max(1, ...played.map((r) => r.pts));
  const best = played.reduce((b, r) => (r.pts > (b?.pts ?? 0) ? r : b), null);
  const avg = played.length ? played.reduce((s, r) => s + r.counted, 0) / played.length : 0;
  const BAR_H = 160;
  const faded = tint(color, 30);
  const fill = (r) => {
    if (r.pts > 0 && r.dropped >= r.pts) return faded;
    if (r.dropped > 0) {
      const pct = Math.round((r.counted / r.pts) * 100);
      return `linear-gradient(to top, ${color} ${pct}%, ${faded} ${pct}%)`;
    }
    return color;
  };
  const label = (r) =>
    r.dropped > 0 && r.dropped < r.pts ? (
      <>
        {r.counted}
        <s className="ml-0.5 text-[9px] font-semibold text-faint">{r.pts}</s>
      </>
    ) : r.pts > 0 && r.dropped >= r.pts ? (
      <s className="text-faint">{r.pts}</s>
    ) : (
      r.pts
    );
  const title = (r) =>
    `R${r.n} ${r.race?.track || ""} · ${r.pts} pts${r.dropped > 0 ? ` (${r.dropped} dropped, ${r.counted} count)` : ""}`;

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-5 py-4 sm:px-6">
        <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Points by round</h2>
        {best && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-light">
            avg {avg.toFixed(1)} · best {best.pts} (R{best.n})
          </span>
        )}
      </div>

      {/* Wide screens: columns with the average across them. */}
      <div className="reveal hidden p-6 sm:block">
        <div className="relative flex items-end gap-2 lg:gap-3" style={{ height: BAR_H + 24 }}>
          {rounds.map((r, i) => (
            <div key={r.n} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              {r.done ? (
                <>
                  <span className="font-mono text-[11px] font-bold tabular-nums text-dark">{label(r)}</span>
                  <div
                    className={`bar-rise w-full max-w-[34px] rounded-t-md ${best && r.n === best.n ? "ring-2 ring-dark ring-offset-2 ring-offset-card" : ""}`}
                    style={{ "--h": `${Math.max(4, Math.round((r.pts / maxPts) * BAR_H))}px`, "--i": i, background: fill(r) }}
                    title={title(r)}
                  />
                </>
              ) : (
                <div
                  className="w-full max-w-[34px] rounded-t-md border border-dashed border-border"
                  style={{ height: 10 }}
                  title={`R${r.n} ${r.race?.track || ""} · upcoming`}
                />
              )}
            </div>
          ))}
          {played.length > 0 && avg > 0 && (
            <div
              className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed"
              style={{ bottom: Math.round((avg / maxPts) * BAR_H), borderColor: "color-mix(in srgb, var(--c-text) 30%, transparent)" }}
            >
              <span className="absolute -top-5 right-0 rounded bg-dark px-1.5 font-mono text-[10px] font-bold text-card">
                avg {Math.round(avg)}
              </span>
            </div>
          )}
        </div>
        <div className="mt-1.5 flex gap-2 lg:gap-3">
          {rounds.map((r) => (
            <div key={r.n} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              {r.circ ? <Flag code={r.circ.country} title={r.circ.countryName} w={14} h={10} /> : <span className="h-[10px]" />}
              <span className={`font-mono text-[10px] font-semibold ${r.done ? "text-light" : "text-faint"}`}>R{r.n}</span>
              {r.race?.track && (
                <span className={`hidden w-full truncate text-center font-mono text-[9px] uppercase lg:block ${r.done ? "text-light" : "text-faint"}`} title={r.race.track}>
                  {r.race.track}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Phones: one bar per round, fits without scrolling. */}
      <ul className="p-4 sm:hidden">
        {rounds.map((r) => (
          <li key={r.n} className={`grid grid-cols-[124px_1fr_36px] items-center gap-2 py-1.5 ${r.done ? "" : "text-faint"}`}>
            <span className={`flex min-w-0 items-center gap-1.5 font-mono text-[11px] ${r.done ? "text-medium" : ""}`}>
              {r.circ ? <Flag code={r.circ.country} title={r.circ.countryName} w={14} h={10} /> : <span className="w-[14px] shrink-0" />}
              <span className="w-7 shrink-0">R{r.n}</span>
              <span className="truncate">{r.race?.track || ""}</span>
            </span>
            {r.done ? (
              <span className="flex h-3" title={title(r)}>
                {r.pts > 0 && (
                  <span
                    className={`rounded ${best && r.n === best.n ? "ring-2 ring-dark ring-offset-1 ring-offset-card" : ""}`}
                    style={{ width: `${Math.max(2, Math.round((r.pts / maxPts) * 100))}%`, background: fill(r) }}
                  />
                )}
              </span>
            ) : (
              <span className="h-3 rounded border border-dashed border-border" />
            )}
            <span className="text-right font-mono text-xs font-bold tabular-nums">
              {r.done ? label(r) : <span className="text-[11px] font-normal">soon</span>}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

// Which share of a team's points a drop rule took, in words, for the note
// under the round columns. Matches the rule the standings actually applied.
function dropNote({ dropMode, dropWorst, teamDropWorst }) {
  if (dropMode === "teamRounds" && teamDropWorst > 0)
    return `Faded = dropped with the team's ${teamDropWorst} lowest round${teamDropWorst === 1 ? "" : "s"}.`;
  if (dropMode === "team" && teamDropWorst > 0)
    return `Faded = dropped with the team's ${teamDropWorst} lowest single-driver score${teamDropWorst === 1 ? "" : "s"}.`;
  if (dropMode === "official" && dropWorst > 0)
    return `Faded = dropped with the team's ${dropWorst} lowest round${dropWorst === 1 ? "" : "s"}.`;
  if (dropMode === "driver" && dropWorst > 0)
    return `Faded = dropped with a driver's ${dropWorst} lowest round${dropWorst === 1 ? "" : "s"}.`;
  return null;
}

export default function TeamProfile() {
  useSeasonParam(); // honour ?season=N (team pages are season-scoped)
  const { id } = useParams();
  const { theme } = useTheme();
  const { data, loading, error } = useApi(
    useCallback(
      () => Promise.all([api.teams(), api.t1Standings(), api.t2Standings(), api.driverStandings(), api.races()]),
      []
    )
  );

  // The team is what this page is about, so the tab and the search result say the
  // team, not just the season. Same wording as the server ships for this address
  // (backend/src/lib/pageMeta.js).
  const { current: shownSeason, active } = useSeason();
  const shownTeam = (data?.[0] || []).find((t) => t.id === id);
  useSpecificTitle(
    shownTeam ? `${shownTeam.name} · ${shownSeason?.name || "NABS Racing League"}` : null
  );

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

  const [teams, t1, t2, driverStandings, races] = data;
  const team = teams.find((t) => t.id === id);
  if (!team) return <ErrorBox message="Team not found." />;

  const color = team.color;
  const dark = theme === "dark";
  const standingsSet = team.tier === 1 ? t1 : team.tier === 2 ? t2 : null;
  const tierRows = standingsSet?.standings || [];
  const teamRow = tierRows.find((r) => r.teamId === id) || null;
  const raceNumbers = standingsSet?.raceNumbers || [];
  const champRaces = races.filter((r) => !r.isSpecialEvent && r.number != null);
  const raceByNumber = new Map(champRaces.map((r) => [r.number, r]));
  const hasT2 = t2.standings.length > 0 || teams.some((t) => t.tier === 2);

  // The title is decided: archived season, or the live one with every round
  // in (the same test the constructors page uses for its champion).
  const decided =
    (!!shownSeason && !!active && shownSeason.number < active.number) ||
    (champRaces.length > 0 && champRaces.every((r) => r.isCompleted));
  const toGo = champRaces.filter((r) => !r.isCompleted).length;

  // The team's drivers, with their championship standings (clickable).
  const drivers = driverStandings.standings
    .filter((d) => d.team.id === id)
    .sort((a, b) => a.position - b.position);
  const driverRowById = new Map(driverStandings.standings.map((d) => [d.driverId, d]));

  // Combined wins / podiums across the team's drivers. Every race of a sprint
  // weekend counts, as everywhere else on the site (utils/standingsRow.js).
  let wins = 0, podiums = 0;
  for (const d of drivers) {
    for (const c of finishesOf(roundsOf(d))) {
      if (c.position === 1) wins++;
      if (c.position <= 3) podiums++;
    }
  }

  const roundsScored = raceNumbers.filter((n) => (teamRow?.perRace?.[n] ?? 0) > 0).length;
  const bestRoundPts = raceNumbers.reduce((m, n) => Math.max(m, teamRow?.perRace?.[n] ?? 0), 0);
  const completedNumbers = raceNumbers.filter((n) => teamRow?.perRace?.[n] != null);

  // After which rounds this team topped its table outright.
  const cum = cumulativeTotals(tierRows, completedNumbers);
  const mine = cum.get(id) || [];
  const ledRounds = completedNumbers.filter((n, i) => {
    const v = mine[i + 1] ?? 0;
    if (v <= 0) return false;
    for (const [other, pts] of cum) if (other !== id && pts[i + 1] >= v) return false;
    return true;
  });
  const line = standingLine({
    teamRow,
    rows: tierRows,
    toGo,
    decided,
    ledAfter: { total: completedNumbers.length, rounds: ledRounds },
  });

  // Who scored the team's points (backend standingsService teamScorers): the
  // seated drivers get cards, everyone else who drove for the team a chip.
  const scorers = teamRow?.scorers || null;
  const scoredByTeam = scorers ? scorers.reduce((s, x) => s + x.points, 0) : 0;
  const scorerOf = new Map((scorers || []).map((x) => [x.driverId, x]));
  const seated = new Set(drivers.map((d) => d.driverId));
  const standIns = (scorers || []).filter((x) => !seated.has(x.driverId));
  const standInsAllReserves = standIns.every((x) => driverRowById.get(x.driverId)?.tier === 0);
  const seats = drivers.length;
  const accent = readableAccent(color, { dark });

  return (
    <div className="content-in space-y-6">
      {/* Hero: the normal card surface, so it follows the theme. */}
      <section className="overflow-hidden rounded-2xl bg-card shadow-card">
        <div className="h-1.5" style={{ backgroundColor: color }} />
        <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-8 sm:p-8">
          <div
            className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 sm:block"
            style={{ background: `linear-gradient(90deg, transparent, ${tint(color, 7)})` }}
          />
          <Link
            to="/constructors"
            className="relative inline-flex items-center gap-1.5 self-start text-xs font-semibold text-link hover:underline sm:absolute sm:left-8 sm:top-5"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {hasT2 && (team.tier === 1 || team.tier === 2) ? `Constructors · Tier ${team.tier}` : "Constructors"}
          </Link>
          <span
            className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl sm:mt-6 sm:h-32 sm:w-32"
            style={{ backgroundColor: tint(color, 8) }}
          >
            <TeamLogo id={team.id} name={team.name} color={color} logoUrl={team.logoUrl} size={80} />
          </span>
          <div className="relative min-w-0 flex-1 sm:mt-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-ink px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-white">
                {TIER_LABEL[team.tier] ?? NO_VALUE}
              </span>
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
                {shownSeason?.name ? `${shownSeason.name} · ` : ""}
                {seats} {seats === 1 ? "race seat" : "race seats"}
              </span>
            </div>
            <h1 className="mt-2 break-words font-display text-4xl font-black uppercase tracking-tight text-dark sm:text-6xl">
              {team.name}
            </h1>
            {line && <p className="mt-2 text-sm text-medium sm:text-base">{line}</p>}
          </div>
          {teamRow && (
            <div className="relative grid grid-cols-2 gap-3 sm:mt-6 sm:w-[260px] sm:shrink-0">
              <div className="rounded-xl bg-surface2 p-4">
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">Position</div>
                <div className="mt-1 font-display text-4xl font-black tabular-nums text-dark">
                  <CountUp end={teamRow.position} prefix="P" />
                  <span className="ml-1 text-sm font-bold text-faint">/{tierRows.length}</span>
                </div>
              </div>
              <div className="rounded-xl p-4" style={{ backgroundColor: tint(color, 10) }}>
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: accent }}>Points</div>
                <div className="mt-1 font-display text-4xl font-black tabular-nums" style={{ color: accent }}>
                  <CountUp end={teamRow.total} />
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Stat tiles */}
      {teamRow && (
        <div className="cascade grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat index={0} icon="hash" label="Championship" value={`P${teamRow.position}`} sub={`of ${standingsSet.standings.length} teams`} />
          <Stat index={1} icon="chart" label="Points" value={teamRow.total} sub={`${TIER_LABEL[team.tier]} table`} accent={color} />
          <Stat index={2} icon="trophy" label="Race Wins" value={wins} sub="by team drivers" accent={wins ? MEDAL_TEXT[0] : undefined} />
          <Stat index={3} icon="podium" label="Podiums" value={podiums} sub="P1 to P3 finishes" />
          <Stat index={4} icon="flagChk" label="Best Round" value={bestRoundPts || "–"} sub="points in one race" />
          <Stat index={5} icon="hash" label="Rounds Scored" value={roundsScored} sub={`of ${raceNumbers.length}`} />
        </div>
      )}

      {/* Line-up: a card per seated driver with their share of the team's points. */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-display text-xl font-extrabold uppercase tracking-tight text-dark sm:text-2xl">Line-up</h2>
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
            {seats} {seats === 1 ? "race seat" : "race seats"}
          </span>
        </div>
        {drivers.length === 0 ? (
          <div className="card px-5 py-4 text-sm text-light">No drivers assigned.</div>
        ) : (
          <div className="cascade grid grid-cols-1 gap-3 md:grid-cols-2">
            {drivers.map((d, i) => {
              const s = scorerOf.get(d.driverId);
              const pts = s?.points ?? 0;
              const share = scoredByTeam > 0 ? Math.round((pts / scoredByTeam) * 100) : 0;
              const starts = s?.starts ?? 0;
              return (
                <Link
                  key={d.driverId}
                  to={`/drivers/${d.driverId}`}
                  style={{ "--i": i }}
                  className="card group flex items-center gap-4 p-4 transition hover:shadow-lift sm:p-5"
                >
                  <span className="relative shrink-0">
                    <DriverAvatar name={d.name} photoUrl={d.photoUrl} fallbacks={d.photoFallbacks} color={color} size={64} />
                    {/* No overall position for a reserve who never started a
                        round: the standings table doesn't list them either. */}
                    {!isIdleReserve(d) && (
                      <span
                        className="absolute -bottom-1 -right-1 rounded-full bg-ink px-1.5 font-mono text-[10px] font-bold leading-5 text-white ring-2 ring-card"
                        title={`P${d.position} in the drivers' standings`}
                      >
                        P{d.position}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-display text-xl font-black uppercase tracking-tight text-dark transition group-hover:text-brand">
                        {d.name}
                      </span>
                      <Flag code={countryFor(d.driverId, d.country)} />
                    </span>
                    <span className="block truncate text-xs text-light">
                      {[
                        d.discordName ? `@${d.discordName}` : null,
                        scorers ? `${starts} ${starts === 1 ? "start" : "starts"} for ${team.name}` : isIdleReserve(d) ? "no starts yet" : `P${d.position} overall`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {scorers && (
                      <>
                        <span className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface2">
                          <span style={{ width: `${share}%`, backgroundColor: color }} />
                        </span>
                        <span className="mt-1 block font-mono text-[10px] text-light">{share}% of team points</span>
                      </>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-display text-3xl font-black tabular-nums text-dark">{scorers ? pts : d.total}</span>
                    <span className="block font-mono text-[10px] uppercase text-light">{scorers ? "for team" : "points"}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
        {standIns.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
              {standInsAllReserves ? "Reserve drives" : "Also drove for the team"}
            </span>
            {standIns.map((x) => {
              const d = driverRowById.get(x.driverId);
              const name = d?.name || x.name || "Unknown driver";
              return (
                <Link
                  key={x.driverId}
                  to={`/drivers/${x.driverId}`}
                  className="inline-flex items-center gap-2 rounded-full bg-card py-1 pl-1 pr-3 text-xs shadow-card transition hover:shadow-lift"
                >
                  <DriverAvatar name={name} photoUrl={d?.photoUrl} fallbacks={d?.photoFallbacks} color={d?.team?.color || color} size={22} />
                  <b className="text-dark">{name}</b>
                  <span className="text-light">
                    {x.starts}× · {x.points} pts
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Per-round points */}
      <section className="card overflow-hidden">
        {teamRow && raceNumbers.length > 0 ? (
          <RoundBars
            raceNumbers={raceNumbers}
            perRace={teamRow.perRace}
            droppedPerRace={teamRow.droppedPerRace}
            raceByNumber={raceByNumber}
            color={color}
          />
        ) : (
          <>
            <div className="border-b border-border px-5 py-4 sm:px-6">
              <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Points by round</h2>
            </div>
            <div className="px-5 py-6 text-sm text-light sm:px-6">No scored rounds yet.</div>
          </>
        )}
        {teamRow && raceNumbers.length > 0 && dropNote(standingsSet) && (
          <p className="border-t border-border px-5 py-3 font-mono text-[11px] text-light sm:px-6">
            <span className="mr-1 inline-block h-2.5 w-3 rounded-sm align-middle" style={{ background: tint(color, 30) }} />
            {dropNote(standingsSet)}
          </p>
        )}
      </section>

      {/* The margin to the top of the table, round by round. */}
      {teamRow && tierRows.length > 1 && completedNumbers.length > 0 && (
        <TeamMarginChart team={team} standings={tierRows} completed={completedNumbers} />
      )}

      <TeamHistory teamId={team.id} currentSeasonId={team.seasonId} color={color} />

      <TeamAllTimeDrivers teamId={team.id} teamName={team.name} color={color} dark={dark} />

      <div>
        <Link to="/constructors" className="inline-flex items-center gap-1.5 text-sm font-semibold text-link transition hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All constructors
        </Link>
      </div>
    </div>
  );
}

// Every season the team has raced, and the constructor seals it earned.
//
// The page used to show one season and stop, while a driver profile carries a
// full career table and a shelf of seals. For a league that has run the same
// team names for eight seasons, that history IS most of what a team page is
// about. Rows link to the same team in that season, so the archive is one click
// deep rather than a season-switcher hunt. The bar shows how high up its table
// the team finished (P1 = full), so a P3 of 12 and a P3 of 5 do not look alike.
function TeamHistory({ teamId, currentSeasonId, color }) {
  const { data } = useApi(useCallback(() => api.teamHistory(teamId), [teamId]));
  const rows = data?.seasons || [];
  // One season on its own is just the page you are already looking at.
  if (rows.length < 2) return null;
  const badges = data?.badges || [];
  const bySeason = new Map(rows.map((r) => [r.seasonNumber, r]));

  return (
    <div className="reveal space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="font-display text-xl font-extrabold uppercase tracking-tight text-dark">Season by season</h2>
        {badges.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            {badges.map((b, i) => (
              <span
                key={i}
                title={`${b.position === 1 ? "Constructors' champion" : b.position === 2 ? "Runner-up" : "Third"} in Season ${b.seasonNumber}${b.tier === 2 ? " (Tier 2)" : ""}`}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider"
                style={{ backgroundColor: `${MEDAL[b.position - 1]}22`, color: `var(--medal-${b.position})` }}
              >
                <Trophy className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
                S{b.seasonNumber}
                {b.tier === 2 && " T2"}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="card divide-y divide-border overflow-hidden">
        {rows.map((r) => {
          const here = r.seasonId === currentSeasonId;
          // Up a tier the season after: Tier 2 this season, Tier 1 the next.
          const promoted = r.tier === 2 && bySeason.get(r.seasonNumber + 1)?.tier === 1;
          const placed = r.position != null && r.of ? Math.round(((r.of - r.position + 1) / r.of) * 100) : 0;
          return (
            <Link
              key={r.seasonId}
              to={`/teams/${r.teamId}?season=${r.seasonNumber}`}
              className={`grid grid-cols-[48px_1fr_auto_auto] items-center gap-3 px-4 py-3 transition sm:grid-cols-[64px_1fr_160px_80px_80px] sm:px-5 ${here ? "bg-surface2" : "hover:bg-surface2"}`}
            >
              <span className="font-mono text-xs font-bold uppercase text-light">S{r.seasonNumber}</span>
              <span className="min-w-0 truncate text-sm text-medium">
                {r.tier === 0 ? "Reserve" : `Tier ${r.tier}`}
                {here && <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-light">this page</span>}
                {promoted && (
                  <span className="ml-2 rounded bg-ok/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-ok">Promoted</span>
                )}
              </span>
              <span className="hidden h-1.5 rounded-full bg-surface2 sm:block">
                {placed > 0 && <span className="block h-1.5 rounded-full" style={{ width: `${placed}%`, backgroundColor: color }} />}
              </span>
              {/* A position from a season still running is today's order, not a
                  result, so it is shown plainly without a medal colour. */}
              <span
                className="text-right font-display text-base font-extrabold tabular-nums text-dark"
                style={r.concluded && r.position >= 1 && r.position <= 3 ? { color: `var(--medal-${r.position})` } : undefined}
              >
                {r.position != null ? `P${r.position}` : NO_VALUE}
                {r.position != null && r.of ? <span className="text-xs text-faint">/{r.of}</span> : null}
              </span>
              <span className="text-right font-mono text-sm tabular-nums text-medium">
                {r.points != null ? r.points : NO_VALUE}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
