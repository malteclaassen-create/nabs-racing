// ---------------------------------------------------------------------------
// The small line of figures under a season award card: what the winner did
// that season, worked out from the results so nobody has to type it.
//
//   driver  championship position, points, wins, poles
//   team    position in its tier's constructor standings, points
//   race    car contacts, overtakes and DNFs in that race
//
// A shared award (two drivers) and a typed name get no line. Each figure is
// { value, label } ("4", "wins"); a zero count is left out rather than shown,
// and a race whose file had no telemetry gives no line at all.
// ---------------------------------------------------------------------------
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "../services/standingsService.js";
import { readPoleHolders } from "./raceHonours.js";
import { readSprintChildren } from "./sprintRaces.js";
import { finishesOf, roundsOf, startsOf } from "./standingsRow.js";

const plural = (n, one, many) => (n === 1 ? one : many);

// A driver's line from their standings row and their pole count.
export function driverStatsOf(row, poles = 0) {
  // A driver who never started (a season not run yet, a reserve) has no
  // season to sum up: "P93 · 0 pts" would only embarrass them.
  if (!row || !startsOf(roundsOf(row)).length) return null;
  const finishes = finishesOf(roundsOf(row));
  const wins = finishes.filter((f) => f.position === 1).length;
  const out = [];
  if (row.position != null) out.push({ value: `P${row.position}`, label: null });
  if (row.total != null) out.push({ value: String(row.total), label: "pts" });
  if (wins) out.push({ value: String(wins), label: plural(wins, "win", "wins") });
  if (poles) out.push({ value: String(poles), label: plural(poles, "pole", "poles") });
  return out.length ? out : null;
}

// A team's line from its constructor standings row.
export function teamStatsOf(row, tier) {
  if (!row || !row.total) return null;
  const out = [];
  if (row.position != null) out.push({ value: `P${row.position}`, label: tier ? `Tier ${tier}` : null });
  if (row.total != null) out.push({ value: String(row.total), label: "pts" });
  return out.length ? out : null;
}

// A race's line from its result rows (feature race and, on a sprint weekend,
// the sprint). Every car-to-car contact is on file twice, once for each car,
// so the sum is halved. DNFs count disqualifications too.
export function raceStatsOf(results) {
  const rows = results || [];
  if (!rows.length) return null;
  const sum = (key) => {
    const vals = rows.map((r) => r[key]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + Number(b), 0) : null;
  };
  const contacts = sum("contacts");
  const overtakes = sum("overtakes");
  const out = [];
  if (contacts) {
    const n = Math.ceil(contacts / 2);
    out.push({ value: String(n), label: plural(n, "contact", "contacts") });
  }
  if (overtakes) out.push({ value: String(overtakes), label: plural(overtakes, "overtake", "overtakes") });
  const retired = rows.filter((r) => r.status === "DNF" || r.status === "DSQ").length;
  if (retired) out.push({ value: String(retired), label: plural(retired, "DNF", "DNFs") });
  return out.length ? out : null;
}

// Map<awardId, stats|null> for one season's shaped awards. Reads only what the
// awards need: the driver standings when a driver won something, the tier
// tables when a team did, the result rows of the races that won.
export async function readAwardStats(prisma, seasonId, awards) {
  const out = new Map();
  const list = awards || [];
  const solo = list.filter((a) => a.kind === "driver" && !a.partner);
  const teams = list.filter((a) => a.kind === "team");
  const races = list.filter((a) => a.kind === "race");

  if (solo.length) {
    const [standings, seasonRaces] = await Promise.all([
      getDriverStandings(prisma, seasonId),
      prisma.race.findMany({
        where: { seasonId, isSpecialEvent: false, isCompleted: true, number: { not: null } },
        select: { id: true },
      }),
    ]);
    const rows = new Map((standings.standings || []).map((r) => [r.driverId, r]));
    const poles = new Map();
    for (const driverId of (await readPoleHolders(prisma, seasonRaces.map((r) => r.id))).values()) {
      poles.set(driverId, (poles.get(driverId) || 0) + 1);
    }
    for (const a of solo) {
      out.set(a.id, driverStatsOf(rows.get(a.driver.driverId), poles.get(a.driver.driverId) || 0));
    }
  }

  if (teams.length) {
    const [t1, t2] = await Promise.all([getT1ConstructorStandings(prisma, seasonId), getT2ConstructorStandings(prisma, seasonId)]);
    const byTier = { 1: t1, 2: t2 };
    for (const a of teams) {
      const table = byTier[a.team.tier];
      const row = (table?.standings || []).find((r) => r.teamId === a.team.id);
      out.set(a.id, teamStatsOf(row, a.team.tier));
    }
  }

  if (races.length) {
    const raceIds = races.map((a) => a.race.id);
    const children = await readSprintChildren(prisma, raceIds).catch(() => new Map());
    const childOf = new Map();
    for (const [parentId, childId] of children) childOf.set(childId, parentId);
    const ids = [...raceIds, ...childOf.keys()].filter(Boolean);
    let rows = [];
    try {
      rows = await prisma.$queryRawUnsafe(
        `SELECT "raceId","status","contacts","overtakes" FROM "RaceResult" WHERE "raceId" IN (${ids.map(() => "?").join(",")})`,
        ...ids
      );
    } catch {
      rows = [];
    }
    const byRace = new Map();
    for (const r of rows) {
      const id = childOf.get(r.raceId) || r.raceId;
      if (!byRace.has(id)) byRace.set(id, []);
      byRace.get(id).push(r);
    }
    for (const a of races) out.set(a.id, raceStatsOf(byRace.get(a.race.id)));
  }
  return out;
}

// Adds `stats` to every award of every season in the map from
// readSeasonAwards (seasonId -> awards). A failure leaves the cards without
// figures rather than taking the awards down with it.
export async function withAwardStats(prisma, bySeason) {
  for (const [seasonId, awards] of bySeason) {
    let stats = new Map();
    try {
      stats = await readAwardStats(prisma, seasonId, awards);
    } catch (e) {
      console.warn(`[awards] figures for season ${seasonId} skipped: ${e.message}`);
    }
    for (const a of awards) a.stats = stats.get(a.id) || null;
  }
  return bySeason;
}
