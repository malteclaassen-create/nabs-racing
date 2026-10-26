// ---------------------------------------------------------------------------
// Hall of Fame: all-time records across every (visible) season of one series.
// Read-only aggregation over the same standings the season pages use — official
// final sheets, penalties and drop rules are already applied there — merged
// person-wide via the admin's person links, so a driver's whole career counts
// as one line no matter how often their handle changed.
//
// Deliberately structured as DATA-DRIVEN lists/records so new categories
// (anything telemetry grows) are one entry in the arrays below, not a new page
// layout.
// ---------------------------------------------------------------------------
import { getDriverStandings, getT1ConstructorStandings, getT2ConstructorStandings } from "./standingsService.js";
import { getPersonGroups } from "../lib/persons.js";
import { readManualFastestLaps, readPoleHolders } from "../lib/raceHonours.js";
import { resolveSeries, getActiveSeries } from "../lib/series.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { seasonCompleteFromRaces } from "../lib/seasonComplete.js";
import { readSprintChildrenOf } from "../lib/sprintRaces.js";
import { classificationsOf, finishesOf, startsOf } from "../lib/standingsRow.js";
import { teamLineageKey, readTeamLinkMap } from "../lib/teamLineage.js";

// Heavy (walks every season), so one result is kept warm per series for a few
// minutes. Results imports simply age out within CACHE_MS.
const CACHE_MS = 5 * 60 * 1000;
// The cached value is the PROMISE, not the finished result. Storing the result
// meant that the moment the entry aged out, every request arriving in the gap
// started its own full recomputation — on a race night with a few dozen people
// on the Hall of Fame page that was a few dozen parallel walks over every
// season, all hitting the same SQLite file. Now the first caller starts the
// work and the rest await the same promise.
const cache = new Map(); // `${seriesId}|${admin}` -> { at, promise }
export function invalidateRecordsCache() {
  cache.clear();
}

// A season row's points WITHOUT the drop rule: the official/computed total the
// standings show, plus the points the drop rule took off it again. Built that
// way round on purpose — for an archived season the total comes from the
// league's official sheet, so starting there keeps the gross figure anchored to
// the number the league published and it can never come out BELOW it. Rounds a
// driver didn't score in drop first and add nothing back. Pure, exported for
// the test.
export function seasonPointsBeforeDrop(row) {
  const dropped = (row.droppedRounds || []).reduce(
    (sum, num) => sum + (row.perRace?.[num]?.points || 0),
    0
  );
  return (row.total || 0) + dropped;
}

// The winner of every race of a season, in the order they were driven: for
// each completed round the SPRINT first and then the feature race, because
// that is how a sprint weekend runs. A classification only takes a place in
// the sequence when the season has it on record — a round flagged complete
// with no results at all is a gap in the data, not a race somebody else won,
// and must not break a streak. null = the race ran with nobody classified
// first, which does break one. Pure, exported for the test.
export function raceWinnerSequence(races, rows) {
  const slots = new Map(); // round number -> { sprintRan, sprint, featureRan, feature }
  for (const row of rows) {
    for (const [num, cell] of Object.entries(row.perRace || {})) {
      const n = Number(num);
      const slot = slots.get(n) || { sprintRan: false, sprint: null, featureRan: false, feature: null };
      if (cell.status) {
        slot.featureRan = true;
        if (cell.status === "FINISHED" && cell.position === 1) slot.feature = row.driverId;
      }
      if (cell.sprint?.status) {
        slot.sprintRan = true;
        if (cell.sprint.status === "FINISHED" && cell.sprint.position === 1) slot.sprint = row.driverId;
      }
      slots.set(n, slot);
    }
  }
  const out = [];
  for (const race of races) {
    if (!race.isCompleted || race.number == null) continue;
    const slot = slots.get(race.number);
    if (!slot) continue;
    if (slot.sprintRan) out.push(slot.sprint);
    if (slot.featureRan) out.push(slot.feature);
  }
  return out;
}

// The longest run of the same winner in that sequence, as { person, length },
// or null when nobody ever won twice in a row (a single win is a run of one).
// Pure, exported for the test.
export function longestStreak(winners) {
  let best = null;
  let run = { person: null, length: 0 };
  for (const person of winners) {
    if (person && person === run.person) run.length += 1;
    else run = { person, length: person ? 1 : 0 };
    if (run.person && (!best || run.length > best.length)) best = { ...run };
  }
  return best;
}

// A constructor row's points WITHOUT the drop rule, the team's counterpart of
// seasonPointsBeforeDrop: the total the table shows (an official sheet's
// figure for an archived season) plus what every drop mode took off it, which
// each builder lists per round in droppedPerRace. Pure, exported for the test.
export function constructorPointsBeforeDrop(row) {
  const dropped = Object.values(row.droppedPerRace || {}).reduce((sum, p) => sum + (p || 0), 0);
  return (row.total || 0) + dropped;
}

// One season of driver standings folded into the all-time team counts: the
// wins, podiums and starts of every classification, credited to the team the
// drive was FOR. `teamOf(driverId, round, sprint)` is the team stamped on that
// result (a reserve's subForTeamId, else the result's teamId) or null, and
// then the row's season team stands in, as on the team page's all-time
// drivers (teamAllTimeService.js). `keyOf(teamId)` is the team's line across
// seasons (lib/teamLineage.js), or null for a team that is no constructor (the
// reserve pool), whose drives count for nobody. `bucketFor(key)` hands out the
// aggregate. Pure otherwise, exported for the test.
export function addSeasonToTeamCareers({ rows, teamOf, keyOf, bucketFor }) {
  for (const row of rows || []) {
    for (const [num, cell] of Object.entries(row.perRace || {})) {
      for (const c of classificationsOf([cell])) {
        if (!c.status || c.status === "DNS") continue;
        const key = keyOf(teamOf(row.driverId, Number(num), c.sprint) ?? row.team?.id ?? null);
        if (!key) continue;
        const b = bucketFor(key);
        b.starts += 1;
        if (c.status === "FINISHED" && c.position != null) {
          if (c.position === 1) b.wins += 1;
          if (c.position <= 3) b.podiums += 1;
        }
      }
    }
  }
}

const pickPerson = (p) => ({
  driverId: p.driverId, // newest row = the career profile link
  name: p.name,
  country: p.country,
  photoUrl: p.photoUrl,
  team: p.team, // newest season's team (colour accent)
});

export async function getSeriesRecords(prisma, seriesSlug, { includePrivate = false } = {}) {
  const series = seriesSlug
    ? await resolveSeries(prisma, seriesSlug, { includePrivate })
    : await getActiveSeries(prisma);
  if (!series) return null;

  const key = `${series.id}|${includePrivate ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;

  const promise = computeSeriesRecords(prisma, series, includePrivate);
  cache.set(key, { at: Date.now(), promise });
  // A failed run must not sit in the cache for the rest of the TTL, or one
  // blip would keep the page broken for five minutes.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

async function computeSeriesRecords(prisma, series, includePrivate) {
  const priv = includePrivate ? new Set() : await getPrivateSeasonIds(prisma);
  const seasons = (
    await prisma.season.findMany({ where: { seriesId: series.id }, orderBy: { number: "asc" } })
  ).filter((s) => !priv.has(s.id));
  if (!seasons.length)
    return { seriesName: series.name, seasons: 0, totals: { races: 0, drivers: 0, champions: 0 }, lists: [], teamLists: [], records: [], champions: [] };

  const seasonIds = seasons.map((s) => s.id);
  const { byDriver } = await getPersonGroups(prisma);
  const personOf = (driverId) => byDriver.get(driverId) || driverId;

  // --- per-season standings (official totals, drops, penalties applied) -----
  const perSeason = [];
  for (const season of seasons) {
    const [standings, races, t1, t2] = await Promise.all([
      getDriverStandings(prisma, season.id),
      prisma.race.findMany({ where: { seasonId: season.id, isSpecialEvent: false }, orderBy: { number: "asc" } }),
      getT1ConstructorStandings(prisma, season.id),
      getT2ConstructorStandings(prisma, season.id),
    ]);
    perSeason.push({ season, standings, races, t1, t2 });
  }

  // --- career aggregation, one bucket per PERSON -----------------------------
  const persons = new Map(); // personId -> aggregate
  const bucketFor = (personId) => {
    let b = persons.get(personId);
    if (!b) {
      b = {
        points: 0, starts: 0, wins: 0, podiums: 0, top5: 0, seasons: 0,
        bestFinish: null, bestSeason: null, // { position, seasonNumber }
        newestSeason: -1, identity: null,
      };
      persons.set(personId, b);
    }
    return b;
  };

  for (const { season, standings } of perSeason) {
    for (const row of standings.standings || []) {
      const results = Object.values(row.perRace || {});
      // Starts, wins, podiums and top fives all count EVERY classification of
      // a round — the feature race and, on a sprint weekend, the sprint
      // (lib/standingsRow.js). Counting starts per race night while counting
      // wins per race was this page's own contradiction: the sprint a driver
      // won was on their wins, the sprint they drove was not on their starts.
      const started = startsOf(results);
      const finished = finishesOf(results);
      const b = bucketFor(personOf(row.driverId));
      // Career points are the GROSS figure: what the driver actually scored,
      // not what the season table credited them with after the drop rule.
      b.points += seasonPointsBeforeDrop(row);
      b.starts += started.length;
      b.wins += finished.filter((r) => r.position === 1).length;
      b.podiums += finished.filter((r) => r.position <= 3).length;
      b.top5 += finished.filter((r) => r.position <= 5).length;
      if (started.length > 0) b.seasons += 1;
      for (const r of finished) {
        if (b.bestFinish == null || r.position < b.bestFinish) b.bestFinish = r.position;
      }
      if (row.position != null && started.length > 0) {
        if (!b.bestSeason || row.position < b.bestSeason.position) {
          b.bestSeason = { position: row.position, seasonNumber: season.number };
        }
      }
      // Newest row wins the identity (current name/photo/team).
      if (season.number > b.newestSeason) {
        b.newestSeason = season.number;
        b.identity = {
          driverId: row.driverId,
          name: row.name,
          country: row.country || null,
          photoUrl: row.photoUrl || null,
          team: row.team ? { id: row.team.id, name: row.team.name, color: row.team.color, logoUrl: row.team.logoUrl } : null,
        };
      }
    }
  }

  // --- extra signals straight off the results (quali, laps, telemetry) -------
  // Every CLASSIFICATION of every completed round counts here: the feature
  // race and, on a sprint weekend, the sprint too. The sprint lives on a
  // hidden child race flagged special (lib/sprintRaces.js), which is exactly
  // why it used to be left out — a league that runs every round as a sprint
  // weekend then saw half its fastest laps missing from this page.
  //
  // Poles: the fastest driver of the round's imported qualifying session, or
  // grid slot 1 where no session is on file (lib/raceHonours.js) — never the
  // grid of a round WITH a quali, because a reverse-grid feature race puts
  // somebody who did not qualify first into slot 1. A round with no pole on
  // its feature race at all takes the sprint's grid-1 row, which is where a
  // pole is recorded by hand for a weekend whose sprint starts from the
  // qualifying order. One pole per round, never one per race.
  // Fastest laps: the best lap of each classification (a sprint has its own).
  // Overtakes, laps led, contacts: summed over both races of a weekend.
  const completedRounds = perSeason.flatMap(({ races }) => races.filter((r) => r.isCompleted));
  const sprintChildren = await readSprintChildrenOf(prisma, completedRounds); // childId -> parent race
  const childOfRound = new Map([...sprintChildren].map(([childId, parent]) => [parent.id, childId]));
  const roundIds = completedRounds.map((r) => r.id);
  const results = await prisma.raceResult.findMany({
    where: {
      OR: [
        { race: { seasonId: { in: seasonIds }, isSpecialEvent: false, isCompleted: true } },
        ...(sprintChildren.size ? [{ raceId: { in: [...sprintChildren.keys()] } }] : []),
      ],
    },
    select: {
      driverId: true, raceId: true, grid: true, bestLapMs: true, position: true, status: true,
      overtakes: true, lapsLed: true, contacts: true, teamId: true, subForTeamId: true,
    },
  });
  const addTo = (map, driverId, n = 1) => {
    const person = personOf(driverId);
    map.set(person, (map.get(person) || 0) + n);
  };
  const poles = new Map();
  const overtakes = new Map();
  const lapsLed = new Map();
  const contacts = new Map();
  const bestLapByRace = new Map(); // raceId -> { driverId, ms }
  const raceIdsInPlay = new Set(results.map((r) => r.raceId));
  const poleByRace = await readPoleHolders(prisma, [...roundIds, ...sprintChildren.keys()]);
  const poleHolders = []; // [{ driverId, raceIds: [feature, sprint?] }], for the team lists
  for (const roundId of roundIds) {
    const holder = poleByRace.get(roundId) ?? poleByRace.get(childOfRound.get(roundId)) ?? null;
    if (!holder) continue;
    addTo(poles, holder);
    poleHolders.push({ driverId: holder, raceIds: [roundId, childOfRound.get(roundId)].filter(Boolean) });
  }
  for (const r of results) {
    if (r.overtakes) addTo(overtakes, r.driverId, r.overtakes);
    if (r.lapsLed) addTo(lapsLed, r.driverId, r.lapsLed);
    if (r.contacts) addTo(contacts, r.driverId, r.contacts);
    if (r.bestLapMs && r.bestLapMs > 0) {
      const cur = bestLapByRace.get(r.raceId);
      if (!cur || r.bestLapMs < cur.ms) bestLapByRace.set(r.raceId, { driverId: r.driverId, ms: r.bestLapMs });
    }
  }
  // Admin-recorded fastest laps (archive rounds without AC data) win over the
  // bestLapMs derivation: the flag is the round's official holder.
  const manualFl = await readManualFastestLaps(prisma);
  for (const [raceId, driverId] of manualFl) {
    if (raceIdsInPlay.has(raceId)) bestLapByRace.set(raceId, { driverId, ms: null });
  }
  const fastestLaps = new Map();
  for (const fl of bestLapByRace.values()) addTo(fastestLaps, fl.driverId);

  // --- single records ---------------------------------------------------------
  // Longest win streak over every RACE of the series in the order they were
  // driven (raceWinnerSequence). It used to walk rounds, so on a sprint
  // weekend the sprint in between two feature wins was neither a win that
  // extended the streak nor a race that broke it — it simply was not there.
  const orderedWins = perSeason
    .flatMap(({ races, standings }) => raceWinnerSequence(races, standings.standings || []))
    .map((driverId) => (driverId ? personOf(driverId) : null));
  const streak = longestStreak(orderedWins);

  // Best single seasons: most wins / most points in one season.
  let mostWinsSeason = null; // { person, value, seasonNumber }
  let mostPointsSeason = null;
  for (const { season, standings } of perSeason) {
    for (const row of standings.standings || []) {
      const wins = finishesOf(Object.values(row.perRace || {})).filter((r) => r.position === 1).length;
      if (wins > 0 && (!mostWinsSeason || wins > mostWinsSeason.value)) {
        mostWinsSeason = { person: personOf(row.driverId), value: wins, seasonNumber: season.number };
      }
      if (row.total > 0 && (!mostPointsSeason || row.total > mostPointsSeason.value)) {
        mostPointsSeason = { person: personOf(row.driverId), value: row.total, seasonNumber: season.number };
      }
    }
  }

  // --- champions timeline (completed seasons only) ---------------------------
  const activeNumber = Math.max(...seasons.filter((s) => s.isActive).map((s) => s.number), -1);
  const champions = [];
  for (const { season, standings, races, t1, t2 } of perSeason) {
    const concluded =
      (activeNumber >= 0 && season.number < activeNumber) || seasonCompleteFromRaces(races);
    if (!concluded) continue;
    const top = (standings.standings || [])[0];
    if (!top || !(top.total > 0)) continue;
    const teams = [];
    for (const [tier, data] of [[1, t1], [2, t2]]) {
      const t = data?.standings?.[0];
      if (t && (t.total ?? 0) > 0) teams.push({ tier, name: t.name, color: t.color, logoUrl: t.logoUrl, teamId: t.teamId, points: t.total });
    }
    champions.push({
      seasonNumber: season.number,
      seasonName: season.name,
      game: season.game || null,
      driver: pickPerson({ driverId: top.driverId, name: top.name, country: top.country, photoUrl: top.photoUrl, team: top.team }),
      points: top.total,
      teams,
    });
  }
  champions.sort((a, b) => b.seasonNumber - a.seasonNumber);

  // --- team careers, one bucket per team LINE across seasons -----------------
  // Team ids are per season, so a team is followed by its name, spelling
  // forgiven and renames joined up (lib/teamLineage.js), exactly as the team
  // page follows it. Only constructors count: the reserve pool (tier 0) is
  // nobody's team, and a reserve's drive counts for the team they subbed for.
  // Points are the constructor tables' own, which already price a Tier-2 drive
  // the way the league does, with the drop rule undone as for the drivers.
  // Wins, podiums, starts, poles and fastest laps are the drivers' ones, each
  // credited to the team the result was stamped for.
  const teamRows = (
    await prisma.team.findMany({
      where: { seasonId: { in: seasonIds } },
      select: { id: true, name: true, tier: true, color: true, logoUrl: true, seasonId: true },
    })
  ).filter((t) => t.tier > 0);
  const seasonNumberById = new Map(seasons.map((s) => [s.id, s.number]));
  const links = await readTeamLinkMap(prisma);
  const teamKeyById = new Map(teamRows.map((t) => [t.id, teamLineageKey(t.name, links)]));
  const keyOf = (teamId) => (teamId ? teamKeyById.get(teamId) ?? null : null);
  const teamCareers = new Map(); // lineage key -> aggregate
  const teamBucketFor = (key) => {
    let b = teamCareers.get(key);
    if (!b) {
      b = { titles: 0, points: 0, wins: 0, podiums: 0, starts: 0, poles: 0, fastestLaps: 0, newestSeason: -1, identity: null };
      teamCareers.set(key, b);
    }
    return b;
  };
  // The newest season's row is the face of the line (name, colour, logo, link).
  for (const t of teamRows) {
    const n = seasonNumberById.get(t.seasonId);
    const b = teamBucketFor(teamKeyById.get(t.id));
    if (n > b.newestSeason) {
      b.newestSeason = n;
      b.identity = { teamId: t.id, name: t.name, color: t.color, logoUrl: t.logoUrl || null };
    }
  }
  const stampByResult = new Map(); // `${driverId}|${raceId}` -> team the drive was for
  for (const r of results) {
    const t = r.subForTeamId || r.teamId;
    if (t) stampByResult.set(`${r.driverId}|${r.raceId}`, t);
  }
  const seasonTeamOf = new Map(); // driverId -> the driver's season team
  for (const { standings, races, t1, t2 } of perSeason) {
    const rows = standings.standings || [];
    for (const row of rows) if (row.team?.id) seasonTeamOf.set(row.driverId, row.team.id);
    const featureByNum = new Map(races.filter((r) => r.number != null).map((r) => [r.number, r.id]));
    addSeasonToTeamCareers({
      rows,
      teamOf: (driverId, num, sprint) => {
        const featureId = featureByNum.get(num);
        const raceId = sprint ? childOfRound.get(featureId) : featureId;
        return raceId ? stampByResult.get(`${driverId}|${raceId}`) ?? null : null;
      },
      keyOf,
      bucketFor: teamBucketFor,
    });
    for (const row of [...(t1?.standings || []), ...(t2?.standings || [])]) {
      const key = keyOf(row.teamId);
      if (key) teamBucketFor(key).points += constructorPointsBeforeDrop(row);
    }
  }
  const teamOfDrive = (driverId, raceIds) =>
    keyOf(
      raceIds.map((id) => stampByResult.get(`${driverId}|${id}`)).find(Boolean) ?? seasonTeamOf.get(driverId) ?? null
    );
  for (const p of poleHolders) {
    const key = teamOfDrive(p.driverId, p.raceIds);
    if (key) teamBucketFor(key).poles += 1;
  }
  for (const [raceId, fl] of bestLapByRace) {
    const key = teamOfDrive(fl.driverId, [raceId]);
    if (key) teamBucketFor(key).fastestLaps += 1;
  }

  // --- shape the output: data-driven top lists + record tiles ----------------
  const identityOf = (personId) => {
    const b = persons.get(personId);
    // seasonNumber rides along so the frontend can deep-link `?season=` and
    // land on the row's own season instead of whatever is being viewed.
    return b?.identity ? { ...b.identity, seasonNumber: b.newestSeason } : null;
  };
  const topList = (key, label, note, valueOf, { unit = "", min = 1 } = {}) => {
    const rows = [...persons.entries()]
      .map(([personId, b]) => ({ id: identityOf(personId), value: valueOf(b, personId) }))
      .filter((r) => r.id && r.value != null && r.value >= min)
      .sort((a, b) => b.value - a.value || a.id.name.localeCompare(b.id.name))
      .slice(0, 10)
      .map((r) => ({ ...r.id, value: r.value }));
    return rows.length ? { key, label, note, unit, rows } : null;
  };

  const lists = [
    topList("wins", "Most wins", "races won, sprints included", (b) => b.wins, { unit: "wins" }),
    topList("podiums", "Most podiums", "top-3 finishes, sprints included", (b) => b.podiums, { unit: "podiums" }),
    topList("points", "Most career points", "every round counted, nothing dropped", (b) => b.points, { unit: "pts" }),
    topList("starts", "Most starts", "races started, sprints included", (b) => b.starts, { unit: "starts" }),
    topList("poles", "Most pole positions", "fastest in qualifying, where the session is on record", (b, id) => poles.get(id) || 0, { unit: "poles" }),
    topList("fastestLaps", "Most fastest laps", "best lap of a race, sprints included", (b, id) => fastestLaps.get(id) || 0, { unit: "laps" }),
    topList("overtakes", "Most overtakes", "on-track passes (telemetry seasons)", (b, id) => overtakes.get(id) || 0, { unit: "passes" }),
    topList("lapsLed", "Most laps led", "laps out front (telemetry seasons)", (b, id) => lapsLed.get(id) || 0, { unit: "laps" }),
    topList("contacts", "Most contacts", "car-to-car contacts (telemetry seasons)", (b, id) => contacts.get(id) || 0, { unit: "hits" }),
  ].filter(Boolean);

  // Constructors' titles, both tiers, off the champions timeline below the
  // page's head, so the two can never disagree.
  for (const c of champions) {
    for (const t of c.teams) {
      const key = keyOf(t.teamId);
      if (key) teamBucketFor(key).titles += 1;
    }
  }
  const teamTopList = (key, label, note, valueOf, { unit = "" } = {}) => {
    const rows = [...teamCareers.values()]
      .filter((b) => b.identity && valueOf(b) >= 1)
      .map((b) => ({ ...b.identity, seasonNumber: b.newestSeason, value: valueOf(b) }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
      .slice(0, 10);
    return rows.length ? { key, label, note, unit, rows } : null;
  };
  const teamLists = [
    teamTopList("titles", "Most championships", "constructors' titles, Tier 1 and Tier 2", (b) => b.titles, { unit: "titles" }),
    teamTopList("wins", "Most wins", "races won by its drivers, sprints included", (b) => b.wins, { unit: "wins" }),
    teamTopList("podiums", "Most podiums", "top-3 finishes by its drivers, sprints included", (b) => b.podiums, { unit: "podiums" }),
    teamTopList("points", "Most constructor points", "every round counted, nothing dropped", (b) => b.points, { unit: "pts" }),
    teamTopList("starts", "Most starts", "cars on the grid, sprints included", (b) => b.starts, { unit: "starts" }),
    teamTopList("poles", "Most pole positions", "fastest in qualifying, where the session is on record", (b) => b.poles, { unit: "poles" }),
    teamTopList("fastestLaps", "Most fastest laps", "best lap of a race, sprints included", (b) => b.fastestLaps, { unit: "laps" }),
  ].filter(Boolean);

  const recordEntry = (key, label, rec, detail) =>
    rec && identityOf(rec.person)
      ? { key, label, holder: identityOf(rec.person), value: rec.value ?? rec.length, detail }
      : null;
  const records = [
    recordEntry("winsSeason", "Most wins in a season", mostWinsSeason, mostWinsSeason ? `Season ${mostWinsSeason.seasonNumber}` : null),
    recordEntry("pointsSeason", "Most points in a season", mostPointsSeason, mostPointsSeason ? `Season ${mostPointsSeason.seasonNumber}` : null),
    recordEntry("winStreak", "Longest win streak", streak, "consecutive races won, sprints included"),
  ].filter(Boolean);

  // The headline numbers over the Hall of Fame. Races are the completed rounds
  // plus every sprint that has results, so they count the way the wins do.
  // Drivers are people, not handles, and only the ones who raced or scored:
  // a reserve who signed up and never drove isn't part of the history. The
  // champion count is people too, so a title defended under a new name is
  // still one champion.
  const sprintsRun = [...sprintChildren.keys()].filter((id) => raceIdsInPlay.has(id)).length;
  const totals = {
    races: completedRounds.length + sprintsRun,
    drivers: [...persons.values()].filter((b) => b.starts > 0 || b.points > 0).length,
    champions: new Set(champions.map((c) => personOf(c.driver.driverId))).size,
  };

  return { seriesName: series.name, seasons: seasons.length, totals, lists, teamLists, records, champions };
}
