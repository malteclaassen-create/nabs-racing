// ---------------------------------------------------------------------------
// End-of-season honours: the champion, the podium, team champions and a set of
// season awards (best newcomer, fastest lap, most overtakes, cleanest driver).
// Read-only aggregation over the standings/results — the Home page shows this
// as the "season complete" celebration between the finale and the next season.
// ---------------------------------------------------------------------------
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "./standingsService.js";
import { getPersonGroups } from "../lib/persons.js";
import { seasonCompleteFromRaces } from "../lib/seasonComplete.js";
import { readSprintChildrenOf } from "../lib/sprintRaces.js";
import { startsOf } from "../lib/standingsRow.js";

function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Trim a standings row to what the celebration card needs.
function pickDriver(row) {
  if (!row) return null;
  return {
    driverId: row.driverId,
    name: row.name,
    points: row.total,
    position: row.position ?? null,
    team: row.team
      ? { id: row.team.id, name: row.team.name, color: row.team.color, logoUrl: row.team.logoUrl }
      : null,
    photoUrl: row.photoUrl || null,
    country: row.country || null,
  };
}

export async function getSeasonHonours(prisma, seasonId) {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) return null;

  const [standings, t1, t2, races, seasonDrivers] = await Promise.all([
    getDriverStandings(prisma, seasonId),
    getT1ConstructorStandings(prisma, seasonId),
    getT2ConstructorStandings(prisma, seasonId),
    prisma.race.findMany({ where: { seasonId, isSpecialEvent: false }, orderBy: { number: "asc" } }),
    prisma.driver.findMany({ where: { seasonId }, select: { id: true, discordName: true } }),
  ]);

  // Shared "season finished" rule (see lib/seasonComplete.js) — the same one
  // the profile badge shelf and the card editions use.
  const complete = seasonCompleteFromRaces(races);
  // Championship rounds (numbered) — trainings/one-offs don't count here.
  const rounds = races.filter((r) => r.number != null);
  const rows = standings.standings || [];

  // Team champions per tier (a single-class season simply has no T2 entry).
  const teamChampions = [];
  for (const [tier, data] of [
    [1, t1],
    [2, t2],
  ]) {
    const top = data?.standings?.[0];
    if (top && (top.total ?? 0) > 0) {
      teamChampions.push({
        tier,
        teamId: top.teamId,
        name: top.name,
        color: top.color,
        logoUrl: top.logoUrl,
        points: top.total,
      });
    }
  }

  // Best newcomer: highest-placed driver who started a round this season and
  // has NO trace in any earlier season — neither via a person link nor by a
  // matching name/Discord handle (defence for unlinked people).
  const priorDrivers = await prisma.driver.findMany({
    where: { season: { number: { lt: season.number } } },
    select: { id: true, name: true, discordName: true },
  });
  const { byDriver } = await getPersonGroups(prisma);
  const priorPersons = new Set(priorDrivers.map((d) => byDriver.get(d.id)).filter(Boolean));
  const priorNames = new Set(
    priorDrivers.flatMap((d) => [norm(d.name), norm(d.discordName)]).filter(Boolean)
  );
  const discordById = new Map(seasonDrivers.map((d) => [d.id, d.discordName]));
  const bestNewcomer =
    season.number > 1
      ? rows.find((r) => {
          const started = startsOf(Object.values(r.perRace || {})).length > 0;
          if (!started) return false;
          const personId = byDriver.get(r.driverId);
          if (personId && priorPersons.has(personId)) return false;
          if (priorNames.has(norm(r.name))) return false;
          if (priorNames.has(norm(discordById.get(r.driverId)))) return false;
          return true;
        }) || null
      : null;

  // Fastest race lap of the season, over every classification: the feature
  // races and, on a sprint weekend, the sprint. The sprint sits on a hidden
  // child race flagged special (lib/sprintRaces.js), so it is reached through
  // the parent link rather than the flag — on a league that runs a sprint
  // every round, half the laps of the season are on those children.
  const sprintChildren = await readSprintChildrenOf(prisma, races.filter((r) => r.isCompleted));
  const sprintRaceIds = [...sprintChildren.keys()];
  const results = await prisma.raceResult.findMany({
    where: {
      OR: [
        { race: { seasonId, isSpecialEvent: false, isCompleted: true } },
        ...(sprintRaceIds.length ? [{ raceId: { in: sprintRaceIds } }] : []),
      ],
    },
    select: { driverId: true, raceId: true, bestLapMs: true },
  });
  // A sprint's lap is reported under its parent round, which is the round the
  // league knows: the child carries no number of its own.
  const raceById = new Map([
    ...races.map((r) => [r.id, r]),
    ...[...sprintChildren].map(([childId, parent]) => [childId, parent]),
  ]);
  let fl = null;
  for (const r of results) {
    if (r.bestLapMs && r.bestLapMs > 0 && (!fl || r.bestLapMs < fl.bestLapMs)) fl = r;
  }
  const flRow = fl ? rows.find((x) => x.driverId === fl.driverId) : null;
  const fastestLap = fl
    ? {
        ...(pickDriver(flRow) || { driverId: fl.driverId, name: "Unknown" }),
        ms: fl.bestLapMs,
        track: raceById.get(fl.raceId)?.track ?? null,
        round: raceById.get(fl.raceId)?.number ?? null,
      }
    : null;

  // Telemetry awards (only where the season has that data): most on-track
  // overtakes overall, and the cleanest driver = fewest car contacts per start
  // among people who started at least 3 rounds.
  // Counted in JS rather than SQL because the sprint halves are reached by the
  // parent link, not by a flag the query could filter on (see the fastest lap
  // above) — and the rows are one season's, a few hundred at most.
  const telSource = await prisma.raceResult.findMany({
    where: {
      OR: [
        { race: { seasonId, isSpecialEvent: false, isCompleted: true } },
        ...(sprintRaceIds.length ? [{ raceId: { in: sprintRaceIds } }] : []),
      ],
      NOT: { status: "DNS" },
    },
    select: { driverId: true, overtakes: true, lapsLed: true, contacts: true },
  });
  const telByDriver = new Map();
  for (const r of telSource) {
    const t = telByDriver.get(r.driverId) || {
      driverId: r.driverId, overtakes: 0, ratedOt: 0, lapsLed: 0, ratedLed: 0, contacts: 0, ratedCt: 0, starts: 0,
    };
    t.starts += 1;
    // "rated" counts the races that REPORTED the signal, so a season without
    // telemetry gives no award rather than a winner on zeroes.
    if (r.overtakes != null) { t.overtakes += r.overtakes; t.ratedOt += 1; }
    if (r.lapsLed != null) { t.lapsLed += r.lapsLed; t.ratedLed += 1; }
    if (r.contacts != null) { t.contacts += r.contacts; t.ratedCt += 1; }
    telByDriver.set(r.driverId, t);
  }
  const telRows = [...telByDriver.values()];
  let mostOvertakes = null;
  let mostLapsLed = null;
  let cleanest = null;
  for (const t of telRows) {
    const row = rows.find((x) => x.driverId === t.driverId);
    if (!row) continue;
    if (Number(t.ratedOt) > 0 && (!mostOvertakes || Number(t.overtakes) > mostOvertakes.count)) {
      mostOvertakes = { ...pickDriver(row), count: Number(t.overtakes) };
    }
    if (Number(t.ratedLed) > 0 && Number(t.lapsLed) > 0 && (!mostLapsLed || Number(t.lapsLed) > mostLapsLed.count)) {
      mostLapsLed = { ...pickDriver(row), count: Number(t.lapsLed) };
    }
    if (Number(t.ratedCt) >= 3 && Number(t.starts) >= 3) {
      const rate = Number(t.contacts) / Number(t.ratedCt);
      if (!cleanest || rate < cleanest.rate || (rate === cleanest.rate && Number(t.contacts) < cleanest.contacts)) {
        cleanest = { ...pickDriver(row), contacts: Number(t.contacts), starts: Number(t.starts), rate };
      }
    }
  }
  if (cleanest) delete cleanest.rate;

  return {
    seasonNumber: season.number,
    seasonName: season.name,
    complete,
    rounds: rounds.length,
    champion: pickDriver(rows[0]),
    podium: rows.slice(0, 3).map(pickDriver),
    viceChampion: pickDriver(rows[1]),
    teamChampions,
    bestNewcomer: pickDriver(bestNewcomer),
    fastestLap,
    mostOvertakes,
    mostLapsLed,
    cleanest,
  };
}
