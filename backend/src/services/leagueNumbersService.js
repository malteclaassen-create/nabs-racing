// ---------------------------------------------------------------------------
// The league in numbers: one season, or every season of a series, added up.
//
// The Hall of Fame (recordsService) answers "who has the most"; this answers
// "how much happened": how many races, how many starts, how many laps, how
// many passes, how many different people stood on the top step, and the
// nights that stood out (the closest finish, the biggest margin, the biggest
// climb through the field, the busiest race).
//
// Everything is read off the classified results the standings use: a car a
// time penalty moved is counted where the stewards put it, and the gaps are
// taken on the same penalised times the classification is built from
// (pointsCalculator.classifyResults). Both races of a sprint weekend count, as
// they do everywhere else on the site: a sprint start is a start, a sprint win
// a win. Poles stay one per round, from qualifying where it is on file.
//
// The older seasons were imported from result files that never carried laps,
// passes or contacts, and season 7's first rounds only exist as points. So a
// sum of one of those says how many races it was taken from, and the page
// prints that next to it. A blank is better than a total that looks complete
// and is not.
// ---------------------------------------------------------------------------
import { applyPenalties } from "./pointsCalculator.js";
import { getPrivateSeasonIds, resolveSeason } from "./seasonService.js";
import { resolveSeries, seasonIdsOfSeries } from "../lib/series.js";
import { readSprintChildrenOf } from "../lib/sprintRaces.js";
import { readPoleHolders } from "../lib/raceHonours.js";
import { getPersonGroups, getNameOverrides, getIdentityOverrides } from "../lib/persons.js";
import { personPhotoFor } from "../lib/cardPhoto.js";
import { resultTeamId } from "../lib/resultTeam.js";

const finished = (r) => (!r.status || r.status === "FINISHED") && r.position != null;
const started = (r) => r.status !== "DNS";

// The penalised time a classification is built from, or null without a time.
const adjusted = (r) => (r.totalTimeMs > 0 ? r.totalTimeMs + (r.penaltySeconds || 0) * 1000 : null);

// A sum over a column some races never recorded: the total, and how many of
// the races it covers. `value` is null when no race carries the column at all.
function coveredSum(races, resultsOf, pick) {
  let value = 0;
  let covered = 0;
  for (const race of races) {
    const rows = resultsOf(race.id).filter(started);
    const known = rows.filter((r) => pick(r) != null);
    if (!known.length) continue;
    covered += 1;
    for (const r of known) value += pick(r);
  }
  return { value: covered ? value : null, races: covered };
}

// The gap between the classified winner and the car in second, when both were
// on the lead lap with a time on file. null otherwise (a lap down is not a
// "close finish", and a round typed in by hand has no times).
export function winningGap(rows) {
  const fin = rows.filter(finished).sort((a, b) => a.position - b.position);
  const [p1, p2] = fin;
  if (!p1 || !p2 || p1.position !== 1) return null;
  const a = adjusted(p1);
  const b = adjusted(p2);
  if (a == null || b == null) return null;
  if (Number.isInteger(p1.laps) && Number.isInteger(p2.laps) && p1.laps !== p2.laps) return null;
  const gap = b - a;
  return gap >= 0 ? { gapMs: gap, winner: p1, second: p2 } : null;
}

// Everything below, from rows already gathered. Pure, so the test can feed it
// a season by hand.
//
//   races    [{ id, season, round, track, sprint, roundId }] — one per
//            classification, sprints included (roundId = the feature race's
//            id, where the round's pole is filed)
//   results  RaceResult rows of those races, positions RAW (classified here)
//   people   { keyOf(driverId) -> person key, who(key) -> { name, driverId,
//            country, photoUrl } }
//   poles    Map<roundId, driverId>
//   teams    Map<teamId, { name, color, logoUrl }> (for wins by team)
//   teamIdOf which team a result was driven for (lib/resultTeam.js)
export function aggregateNumbers({
  races,
  results,
  people,
  poles = new Map(),
  teams = new Map(),
  teamIdOf = (r) => r.subForTeamId || r.teamId || null,
}) {
  const byRace = new Map();
  for (const r of results) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId).push(r);
  }
  const classified = new Map();
  for (const [raceId, rows] of byRace) classified.set(raceId, applyPenalties(rows));
  const resultsOf = (raceId) => classified.get(raceId) || [];
  // A race that has no rows at all was entered and never filled in; it is not
  // a race anybody drove as far as these numbers go.
  const run = races.filter((race) => resultsOf(race.id).length > 0);

  const raceRef = (race) => ({
    raceId: race.roundId || race.id,
    season: race.season,
    round: race.round,
    track: race.track,
    sprint: !!race.sprint,
  });
  const personRef = (driverId) => {
    const key = people.keyOf(driverId);
    return { key, ...people.who(key) };
  };

  let starts = 0;
  let finishes = 0;
  let dnfs = 0;
  let dsqs = 0;
  let penaltySeconds = 0;
  const drivers = new Set();
  const winners = new Map(); // person key -> wins
  const podiumPeople = new Set();
  const winsByTeam = new Map();
  let biggestField = null;
  let smallestField = null;
  let closest = null;
  let margin = null;
  let comeback = null;
  let busiest = null;
  const trackCounts = new Map();
  const perRound = new Map(); // `${season}:${round}` -> { season, round, track, starters, overtakes, dnfs }

  for (const race of run) {
    const rows = resultsOf(race.id);
    const startedRows = rows.filter(started);
    starts += startedRows.length;
    for (const r of startedRows) drivers.add(people.keyOf(r.driverId));
    for (const r of rows) {
      if (finished(r)) finishes += 1;
      else if (r.status === "DNF") dnfs += 1;
      else if (r.status === "DSQ") dsqs += 1;
      penaltySeconds += r.penaltySeconds || 0;
    }

    const winner = rows.find((r) => finished(r) && r.position === 1);
    if (winner) {
      const key = people.keyOf(winner.driverId);
      winners.set(key, (winners.get(key) || 0) + 1);
      const teamId = teamIdOf(winner);
      if (teamId && teams.has(teamId)) winsByTeam.set(teamId, (winsByTeam.get(teamId) || 0) + 1);
    }
    for (const r of rows) if (finished(r) && r.position <= 3) podiumPeople.add(people.keyOf(r.driverId));

    // The field: the cars that took the start, per classification.
    const n = startedRows.length;
    if (n && (!biggestField || n > biggestField.value)) biggestField = { value: n, race: raceRef(race) };
    if (n && (!smallestField || n < smallestField.value)) smallestField = { value: n, race: raceRef(race) };

    const gap = winningGap(rows);
    if (gap) {
      const entry = {
        gapMs: gap.gapMs,
        race: raceRef(race),
        winner: personRef(gap.winner.driverId),
        second: personRef(gap.second.driverId),
      };
      if (!closest || gap.gapMs < closest.gapMs) closest = entry;
      if (!margin || gap.gapMs > margin.gapMs) margin = entry;
    }

    // The climb: grid slot to classified finish. Feature races only, as on
    // the profiles: a sprint starts from a reversed or inherited grid.
    if (!race.sprint) {
      for (const r of rows) {
        if (!finished(r) || !(r.grid > 0)) continue;
        const gained = r.grid - r.position;
        if (gained > 0 && (!comeback || gained > comeback.gained)) {
          comeback = { gained, grid: r.grid, position: r.position, race: raceRef(race), driver: personRef(r.driverId) };
        }
      }
    }

    const passes = startedRows.filter((r) => r.overtakes != null);
    if (passes.length) {
      const total = passes.reduce((s, r) => s + r.overtakes, 0);
      if (!busiest || total > busiest.overtakes) busiest = { overtakes: total, race: raceRef(race) };
    }

    if (!race.sprint) trackCounts.set(race.track, (trackCounts.get(race.track) || 0) + 1);

    const k = `${race.season}:${race.round}`;
    const pr = perRound.get(k) || { season: race.season, round: race.round, track: race.track, starters: 0, overtakes: null, dnfs: 0 };
    // A sprint weekend is one round with two races: the bigger field of the
    // two is the round's field, and both races' passes and retirements count.
    pr.starters = Math.max(pr.starters, n);
    if (passes.length) pr.overtakes = (pr.overtakes || 0) + passes.reduce((s, r) => s + r.overtakes, 0);
    pr.dnfs += rows.filter((r) => r.status === "DNF").length;
    perRound.set(k, pr);
  }

  // Poles: one per round, read from the round's own race.
  const poleKeys = new Set();
  let polesCounted = 0;
  for (const race of run) {
    if (race.sprint) continue;
    const holder = poles.get(race.roundId || race.id);
    if (!holder) continue;
    polesCounted += 1;
    poleKeys.add(people.keyOf(holder));
  }

  const rounds = new Set(run.map((r) => `${r.season}:${r.round}`)).size;
  const seasons = new Set(run.map((r) => r.season)).size;
  const sprints = run.filter((r) => r.sprint).length;
  const mostRaced = [...trackCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;

  return {
    totals: {
      seasons,
      rounds,
      races: run.length,
      sprints,
      starts,
      drivers: drivers.size,
      finishes,
      dnfs,
      dsqs,
      finishRate: starts ? Math.round((finishes / starts) * 1000) / 10 : null,
      laps: coveredSum(run, resultsOf, (r) => (Number.isInteger(r.laps) ? r.laps : null)),
      overtakes: coveredSum(run, resultsOf, (r) => r.overtakes ?? null),
      contacts: coveredSum(run, resultsOf, (r) => r.contacts ?? null),
      gamePenalties: coveredSum(run, resultsOf, (r) => r.gamePenalties ?? null),
      penaltySeconds,
    },
    winners: {
      count: winners.size,
      list: [...winners.entries()]
        .map(([key, wins]) => ({ key, ...people.who(key), wins }))
        .sort((a, b) => b.wins - a.wins || String(a.name).localeCompare(String(b.name))),
    },
    polesitters: { count: poleKeys.size, rounds: polesCounted },
    podiumFinishers: podiumPeople.size,
    field: {
      average: run.length ? Math.round((starts / run.length) * 10) / 10 : null,
      biggest: biggestField,
      smallest: smallestField,
    },
    closestFinish: closest,
    biggestMargin: margin,
    biggestComeback: comeback,
    busiestRace: busiest,
    tracks: {
      count: trackCounts.size,
      mostRaced: mostRaced ? { track: mostRaced[0], rounds: mostRaced[1] } : null,
    },
    winsByTeam: [...winsByTeam.entries()]
      .map(([teamId, wins]) => ({ teamId, ...teams.get(teamId), wins }))
      .sort((a, b) => b.wins - a.wins || String(a.name).localeCompare(String(b.name))),
    perRound: [...perRound.values()].sort((a, b) => a.season - b.season || a.round - b.round),
  };
}

// --- reading it ---------------------------------------------------------------

// Results change a few times a week; the page is read far more often. The
// same promise-sharing cache as the Hall of Fame (recordsService): the first
// caller computes, the rest wait for it. Dropped whenever results are saved.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();
export function invalidateLeagueNumbersCache() {
  cache.clear();
}

// `season` is a season number, or "all" for every season of the series.
// Private seasons stay out unless an admin asks.
export function getLeagueNumbers(prisma, { series = null, season = null, includePrivate = false } = {}) {
  const key = `${series || ""}|${season ?? ""}|${includePrivate ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = computeLeagueNumbers(prisma, { series, season, includePrivate });
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

async function computeLeagueNumbers(prisma, { series, season, includePrivate }) {
  const seriesRow = await resolveSeries(prisma, series || undefined, { includePrivate });
  if (!seriesRow) return null;
  const priv = includePrivate ? new Set() : await getPrivateSeasonIds(prisma);
  const allSeasons = (await seasonIdsOfSeries(prisma, seriesRow.id)).filter((s) => !priv.has(s.id));
  const seasonRows = await prisma.season.findMany({
    where: { id: { in: allSeasons.map((s) => s.id) } },
    select: { id: true, number: true, name: true, isActive: true },
    orderBy: { number: "asc" },
  });

  const allTime = season === "all";
  let picked = seasonRows;
  if (!allTime) {
    const s = await resolveSeason(prisma, season ?? null, { includePrivate, series: seriesRow.slug });
    if (!s || priv.has(s.id)) return null;
    picked = seasonRows.filter((x) => x.id === s.id);
    if (!picked.length) return null;
  }
  const seasonNumberOf = new Map(picked.map((s) => [s.id, s.number]));

  const rounds = await prisma.race.findMany({
    where: { seasonId: { in: picked.map((s) => s.id) }, isSpecialEvent: false, isCompleted: true, number: { not: null } },
    select: { id: true, number: true, track: true, seasonId: true },
    orderBy: [{ number: "asc" }],
  });
  const sprintParentOf = await readSprintChildrenOf(prisma, rounds);
  const races = [
    ...rounds.map((r) => ({ id: r.id, roundId: r.id, season: seasonNumberOf.get(r.seasonId), round: r.number, track: r.track, sprint: false })),
    ...[...sprintParentOf].map(([childId, parent]) => ({
      id: childId,
      roundId: parent.id,
      season: seasonNumberOf.get(parent.seasonId),
      round: parent.number,
      track: parent.track,
      sprint: true,
    })),
  ];
  const raceIds = races.map((r) => r.id);
  const [results, poles, groups, nameOv, identity, teams] = await Promise.all([
    raceIds.length ? prisma.raceResult.findMany({ where: { raceId: { in: raceIds } } }) : [],
    readPoleHolders(prisma, rounds.map((r) => r.id)),
    getPersonGroups(prisma),
    getNameOverrides(prisma),
    getIdentityOverrides(prisma),
    prisma.team.findMany({
      where: { seasonId: { in: picked.map((s) => s.id) } },
      select: { id: true, name: true, color: true, logoUrl: true },
    }),
  ]);
  const driverIds = [...new Set(results.map((r) => r.driverId))];
  const drivers = driverIds.length
    ? await prisma.driver.findMany({
        where: { id: { in: driverIds } },
        select: { id: true, name: true, country: true, photoUrl: true, discordAvatar: true, seasonId: true, teamId: true },
      })
    : [];
  const driverById = new Map(drivers.map((d) => [d.id, d]));

  // One person, one entry: the person link when there is one (so a driver
  // who raced five seasons counts once in "drivers" all-time and their wins
  // add up), the row otherwise. The newest row speaks for the person.
  const keyOf = (driverId) => groups.byDriver.get(driverId) || driverId;
  const newestRow = new Map();
  for (const d of drivers) {
    const key = keyOf(d.id);
    const cur = newestRow.get(key);
    const n = seasonNumberOf.get(d.seasonId) ?? -1;
    if (!cur || n > cur.n) newestRow.set(key, { n, d });
  }
  const who = (key) => {
    const d = newestRow.get(key)?.d || driverById.get(key);
    if (!d) return { name: "Unknown", driverId: null, country: null, photoUrl: null };
    const ov = nameOv.get(d.id);
    const idov = identity.get(d.id);
    return {
      name: ov?.displayName || d.name,
      driverId: d.id,
      country: d.country || idov?.country || null,
      photoUrl: personPhotoFor(d, idov),
    };
  };

  const body = aggregateNumbers({
    races,
    results,
    people: { keyOf, who },
    poles,
    // Wins by team only make sense inside one season: a team row belongs to
    // one season, and "Ferrari" across seven seasons is seven teams.
    teams: allTime ? new Map() : new Map(teams.map((t) => [t.id, { name: t.name, color: t.color, logoUrl: t.logoUrl }])),
    teamIdOf: (r) => resultTeamId(r, driverById),
  });
  if (allTime) body.perRound = [];

  const shown = allTime ? null : picked[0];
  return {
    series: { slug: seriesRow.slug, name: seriesRow.name },
    scope: allTime ? "all" : "season",
    season: shown ? { number: shown.number, name: shown.name, isActive: !!shown.isActive } : null,
    // The seasons the picker offers: every visible season of the series.
    seasons: seasonRows.map((s) => ({ number: s.number, name: s.name, isActive: !!s.isActive })).reverse(),
    ...body,
  };
}
