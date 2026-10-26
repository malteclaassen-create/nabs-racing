// ---------------------------------------------------------------------------
// A team's all-time drivers: everyone who ever raced for it, across every
// visible season of its series, with the points, wins, podiums and starts they
// brought in FOR THIS TEAM. The team page's answer to "who are the greatest
// drivers this team has had".
//
// Same sources and rules as the Hall of Fame (recordsService.js), so the two
// pages can never disagree about a race: the season's driver standings
// (penalties, official sheets and sprint weekends already applied), every
// classification counted (a sprint win is a win, lib/standingsRow.js), points
// GROSS of any drop rule, and one line per PERSON via the admin's person links.
//
// What it adds is the team of each drive. A driver can change team mid-season
// and a reserve drives for whoever needs them that weekend, so the team comes
// off the result's own stamp (lib/resultTeam.js) — subForTeamId, then teamId —
// and only falls back to the driver's season team where a result carries
// neither.
//
// Teams are matched across seasons by NAME within the series, exactly like
// GET /teams/:id/history (lib/teamLineage.js: spelling forgiven, renames
// joined up): ids are per season and there is no link table.
// ---------------------------------------------------------------------------
import { getDriverStandings, scoringRaces } from "./standingsService.js";
import { seasonPointsBeforeDrop } from "./recordsService.js";
import { getPersonGroups } from "../lib/persons.js";
import { sameTeamBySeason, teamLineageKey } from "../lib/teamLineage.js";

// Walks every season of the series, so one answer is kept for a few minutes
// per team name, the way the Hall of Fame keeps its own. A results import
// clears it (raceWriter / admin, next to the records cache).
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // `${seriesId}|${name}|${admin}` -> { at, promise }
export function invalidateTeamAllTimeCache() {
  cache.clear();
}

// The two halves of a round cell: the feature race and, on a sprint weekend,
// the sprint. The cell's `points` is the weekend's total, so the feature's
// share is what is left once the sprint's is taken out.
function partsOf(cell) {
  const sprintPts = cell.sprint?.points || 0;
  const out = [{ sprint: false, status: cell.status ?? null, position: cell.position ?? null, points: (cell.points || 0) - sprintPts }];
  if (cell.sprint) out.push({ sprint: true, status: cell.sprint.status ?? null, position: cell.sprint.position ?? null, points: sprintPts });
  return out;
}

// Fold one season of driver standings into the per-person totals for the team
// `teamId` (that season's row of the team). `teamOf(driverId, round, sprint)`
// is the team stamped on that drive, or null when the result carries none.
// `personOf(driverId)` maps a season row to its person. Mutates `totals`
// (Map personId -> aggregate) and returns it. Pure otherwise, exported for the
// test.
export function addSeasonToTeamTotals(totals, { seasonNumber, rows, teamId, teamOf, personOf = (id) => id }) {
  for (const row of rows || []) {
    const ownTeam = row.team?.id ?? null;
    const cells = Object.entries(row.perRace || {});
    let points = 0, starts = 0, wins = 0, podiums = 0, drives = 0, elsewhere = 0;

    if (cells.length === 0) {
      // An archived season kept as official totals only: the season team is
      // the only evidence of who the points were scored for.
      if (ownTeam !== teamId || !(row.total > 0)) continue;
      points = row.total;
      drives = 1;
    } else {
      for (const [num, cell] of cells) {
        if (!cell) continue;
        for (const part of partsOf(cell)) {
          if (!part.status && !part.points) continue;
          const team = teamOf(row.driverId, Number(num), part.sprint) ?? ownTeam;
          if (team !== teamId) {
            elsewhere++;
            continue;
          }
          drives++;
          points += part.points;
          if (part.status && part.status !== "DNS") starts++;
          if (part.status === "FINISHED" && part.position != null) {
            if (part.position === 1) wins++;
            if (part.position <= 3) podiums++;
          }
        }
      }
      if (drives === 0) continue;
      // The whole season for this team: take the season figure, anchored to an
      // official sheet where there is one, as the Hall of Fame does.
      if (elsewhere === 0) points = seasonPointsBeforeDrop(row);
    }

    const person = personOf(row.driverId);
    let t = totals.get(person);
    if (!t) {
      t = { points: 0, starts: 0, wins: 0, podiums: 0, seasons: new Set(), newestSeason: -1, identity: null };
      totals.set(person, t);
    }
    t.points += points;
    t.starts += starts;
    t.wins += wins;
    t.podiums += podiums;
    t.seasons.add(seasonNumber);
    // The newest season's row is the face of the line (name, photo, link).
    if (seasonNumber > t.newestSeason) {
      t.newestSeason = seasonNumber;
      t.identity = {
        driverId: row.driverId,
        name: row.name,
        country: row.country || null,
        photoUrl: row.photoUrl || null,
        photoFallbacks: row.photoFallbacks || null,
      };
    }
  }
  return totals;
}

// The totals as the list the page shows: biggest points haul first, then wins,
// podiums, starts. Nobody who never started or scored for the team is listed.
export function teamTotalsList(totals) {
  return [...totals.values()]
    .filter((t) => t.identity && (t.starts > 0 || t.points > 0))
    .map((t) => ({
      ...t.identity,
      seasonNumber: t.newestSeason,
      seasons: [...t.seasons].sort((a, b) => a - b),
      points: t.points,
      starts: t.starts,
      wins: t.wins,
      podiums: t.podiums,
    }))
    .sort(
      (a, b) =>
        b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || b.starts - a.starts || a.name.localeCompare(b.name)
    );
}

// `team` is any season's row of the team (with its season); `seasons` the
// visible seasons of its series. Returns { name, seasons, drivers }.
export async function getTeamAllTime(prisma, team, seasons, { includePrivate = false } = {}) {
  const key = `${team.season?.seriesId ?? ""}|${teamLineageKey(team.name)}|${includePrivate ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = computeTeamAllTime(prisma, team, seasons);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

async function computeTeamAllTime(prisma, team, seasons) {
  const siblings = sameTeamBySeason(
    await prisma.team.findMany({
      where: { seasonId: { in: seasons.map((s) => s.id) } },
      select: { id: true, seasonId: true, name: true },
    }),
    team.name
  );
  const teamBySeason = new Map([...siblings].map(([seasonId, t]) => [seasonId, t.id]));
  const { byDriver } = await getPersonGroups(prisma);
  const personOf = (driverId) => byDriver.get(driverId) || driverId;

  const totals = new Map();
  for (const season of seasons) {
    const teamId = teamBySeason.get(season.id);
    if (!teamId) continue;
    const rounds = await prisma.race.findMany({ where: { seasonId: season.id, isSpecialEvent: false } });
    const { raceNumberById, sprintRaceIds, raceIds } = await scoringRaces(prisma, rounds);
    const [standings, stamps] = await Promise.all([
      getDriverStandings(prisma, season.id),
      prisma.raceResult.findMany({
        where: { raceId: { in: raceIds } },
        select: { driverId: true, raceId: true, teamId: true, subForTeamId: true },
      }),
    ]);
    const stamped = new Map();
    for (const r of stamps) {
      const num = raceNumberById.get(r.raceId);
      if (num == null) continue;
      const t = r.subForTeamId || r.teamId;
      if (t) stamped.set(`${r.driverId}|${num}|${sprintRaceIds.has(r.raceId) ? 1 : 0}`, t);
    }
    addSeasonToTeamTotals(totals, {
      seasonNumber: season.number,
      rows: standings.standings,
      teamId,
      teamOf: (driverId, num, sprint) => stamped.get(`${driverId}|${num}|${sprint ? 1 : 0}`) ?? null,
      personOf,
    });
  }

  return { name: team.name, seasons: teamBySeason.size, drivers: teamTotalsList(totals) };
}
