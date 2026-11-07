// ---------------------------------------------------------------------------
// The small line of figures under a season award card, worked out from the
// results so nobody has to type it, and picked to suit the award: a
// qualifying award shows qualifying figures, a clean-racing award contacts,
// a race of the season who won it and from where.
//
// What the figures are about is read from the award's name (statKindOf),
// since the league names its awards freely:
//
//   driver, "quali"/"pole"           poles, front rows, average qualifying spot
//   driver, "clean"/"fair"           contacts per race, DNFs, starts
//   driver, "improv"                 last season's position -> this one's, points
//   driver, "climb"/"overtak"/...    places gained, overtakes
//   driver, anything else            position, points, wins, poles
//   driver with a race               that driver's race: finish, start, overtakes
//   two drivers                      both positions, points and wins together
//   team                             position in its tier, points
//   race, "chao"/"crash"/...         contacts, DNFs, overtakes
//   race, anything else              who won and from where, overtakes
//
// Each figure is { value, label?, pre? }: "4" "poles", or "won by" "13bot"
// "from P36". A count of zero is left out unless the zero is the point (DNFs
// on a clean-racing award), and a figure the files have no data for (no
// telemetry, no qualifying) is left out rather than shown as zero.
// ---------------------------------------------------------------------------
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "../services/standingsService.js";
import { readPoleHolders } from "./raceHonours.js";
import { readSprintChildren } from "./sprintRaces.js";
import { finishesOf, roundsOf, startsOf } from "./standingsRow.js";
import { getPersonGroups } from "./persons.js";

const plural = (n, one, many) => (n === 1 ? one : many);
const count = (n, one, many) => ({ value: String(n), label: plural(n, one, many) });
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

// What an award's figures should be about, from its name.
export function statKindOf(title, kind = "driver") {
  const t = String(title || "").toLowerCase();
  if (kind === "race") return /chao|crash|carnage|wild|mayhem/.test(t) ? "chaos" : "race";
  if (/quali|pole/.test(t)) return "quali";
  if (/clean|fair|sportsman/.test(t)) return "clean";
  if (/improv/.test(t)) return "improved";
  if (/climb|overtak|grain|charg|comeback|mover|gain/.test(t)) return "climber";
  return "season";
}

// --- the lines -----------------------------------------------------------------

// One driver's season, from their standings row, their result rows and their
// qualifying sessions. `results`: [{ status, position, grid, contacts,
// overtakes }]; `quali`: the qualifying positions they set.
export function driverSeason(row, results = [], quali = [], poles = 0) {
  const finishes = finishesOf(roundsOf(row || {}));
  const starts = (results || []).filter((r) => r.status && r.status !== "DNS");
  const rated = (key) => starts.filter((r) => r[key] != null);
  const sum = (list, key) => list.reduce((a, r) => a + Number(r[key]), 0);
  const gainedRows = starts.filter((r) => r.status === "FINISHED" && r.grid != null && r.position != null);
  return {
    position: row?.position ?? null,
    points: row?.total ?? null,
    wins: finishes.filter((f) => f.position === 1).length,
    podiums: finishes.filter((f) => f.position <= 3).length,
    starts: row ? startsOf(roundsOf(row)).length : starts.length,
    dnfs: starts.filter((r) => r.status === "DNF" || r.status === "DSQ").length,
    contacts: rated("contacts").length ? sum(rated("contacts"), "contacts") : null,
    contactRaces: rated("contacts").length,
    overtakes: rated("overtakes").length ? sum(rated("overtakes"), "overtakes") : null,
    gained: gainedRows.length ? gainedRows.reduce((a, r) => a + (r.grid - r.position), 0) : null,
    poles,
    frontRows: quali.length ? quali.filter((p) => p <= 2).length : null,
    avgQuali: quali.length ? quali.reduce((a, b) => a + b, 0) / quali.length : null,
  };
}

// The line for one driver award of `kind` from driverSeason() figures. `prev`
// is last season's championship position, for "improved".
export function driverStatsOf(s, kind = "season", prev = null) {
  if (!s || !s.starts) return null;
  const out = [];
  if (kind === "quali") {
    if (s.poles) out.push(count(s.poles, "pole", "poles"));
    if (s.frontRows) out.push(count(s.frontRows, "front row", "front rows"));
    if (s.avgQuali != null) out.push({ pre: "avg quali", value: `P${s.avgQuali.toFixed(1)}` });
    if (out.length) return out;
  }
  if (kind === "clean") {
    if (s.contacts != null && s.contactRaces) {
      out.push({ value: (s.contacts / s.contactRaces).toFixed(1), label: "contacts per race" });
    }
    out.push(count(s.dnfs, "DNF", "DNFs"));
    out.push(count(s.starts, "start", "starts"));
    return out;
  }
  if (kind === "improved" && prev != null && s.position != null) {
    out.push({ value: `P${prev} → P${s.position}` });
    if (s.points != null) out.push({ value: String(s.points), label: "pts" });
    return out;
  }
  if (kind === "climber") {
    if (s.gained != null && s.gained > 0) out.push({ value: `+${s.gained}`, label: "places gained" });
    if (s.overtakes) out.push(count(s.overtakes, "overtake", "overtakes"));
    if (out.length) return out;
  }
  if (s.position != null) out.push({ value: `P${s.position}` });
  if (s.points != null) out.push({ value: String(s.points), label: "pts" });
  if (s.wins) out.push(count(s.wins, "win", "wins"));
  if (s.poles) out.push(count(s.poles, "pole", "poles"));
  else if (s.podiums && !s.wins) out.push(count(s.podiums, "podium", "podiums"));
  return out.length ? out : null;
}

// Two drivers who share an award: both positions, then what they scored and
// won between them.
export function pairStatsOf(a, b) {
  if (!a?.starts || !b?.starts) return null;
  const out = [];
  if (a.position != null && b.position != null) out.push({ value: `P${a.position} & P${b.position}` });
  if (a.points != null && b.points != null) out.push({ value: String(a.points + b.points), label: "pts together" });
  const wins = a.wins + b.wins;
  const podiums = a.podiums + b.podiums;
  if (wins) out.push(count(wins, "win", "wins"));
  else if (podiums) out.push(count(podiums, "podium", "podiums"));
  return out.length ? out : null;
}

// A driver award tied to one race (drive of the season): how that race went
// for them.
export function driveStatsOf(result) {
  if (!result || !result.status || result.status === "DNS") return null;
  const finished = result.status === "FINISHED" && result.position != null;
  const out = [
    {
      value: finished ? `P${result.position}` : result.status,
      label: result.grid != null ? `from P${result.grid}` : null,
    },
  ];
  if (result.overtakes) out.push(count(result.overtakes, "overtake", "overtakes"));
  return out;
}

// A team's line from its constructor standings row.
export function teamStatsOf(row, tier) {
  if (!row || !row.total) return null;
  const out = [];
  if (row.position != null) out.push({ value: `P${row.position}`, label: tier ? `Tier ${tier}` : null });
  out.push({ value: String(row.total), label: "pts" });
  return out;
}

// A race's line from its result rows (the feature race and, on a sprint
// weekend, the sprint, its rows marked `sprint`). Every car-to-car contact is
// on file twice, once for each car, so the sum is halved. DNFs count
// disqualifications too. `names`: driverId -> name, for the winner.
export function raceStatsOf(results, kind = "race", names = new Map()) {
  const rows = results || [];
  if (!rows.length) return null;
  const sum = (key) => {
    const vals = rows.map((r) => r[key]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + Number(b), 0) : null;
  };
  const contacts = sum("contacts");
  const overtakes = sum("overtakes");
  const dnfs = rows.filter((r) => r.status === "DNF" || r.status === "DSQ").length;
  const out = [];
  if (kind === "chaos") {
    if (contacts) out.push(count(Math.ceil(contacts / 2), "contact", "contacts"));
    if (dnfs) out.push(count(dnfs, "DNF", "DNFs"));
    if (overtakes) out.push(count(overtakes, "overtake", "overtakes"));
    return out.length ? out : null;
  }
  const winner = rows.find((r) => r.position === 1 && r.status === "FINISHED" && !r.sprint);
  if (winner && names.get(winner.driverId)) {
    out.push({ pre: "won by", value: names.get(winner.driverId), label: winner.grid != null ? `from P${winner.grid}` : null });
  }
  if (overtakes) out.push(count(overtakes, "overtake", "overtakes"));
  if (!out.length && dnfs) out.push(count(dnfs, "DNF", "DNFs"));
  return out.length ? out : null;
}

// --- reading -----------------------------------------------------------------

// The qualifying positions per driver over the given races' sessions.
async function readQualiPositions(prisma, raceIds) {
  const out = new Map();
  if (!raceIds.length) return out;
  let rows = [];
  try {
    rows = await prisma.$queryRawUnsafe(
      `SELECT "qualiJson" FROM "Race" WHERE "qualiJson" IS NOT NULL AND "id" IN (${raceIds.map(() => "?").join(",")})`,
      ...raceIds
    );
  } catch {
    return out;
  }
  for (const row of rows) {
    let blob;
    try {
      blob = JSON.parse(row.qualiJson);
    } catch {
      continue;
    }
    for (const e of Array.isArray(blob?.entries) ? blob.entries : []) {
      if (!e?.driverId || e.position == null) continue;
      if (!out.has(e.driverId)) out.set(e.driverId, []);
      out.get(e.driverId).push(Number(e.position));
    }
  }
  return out;
}

async function readResults(prisma, raceIds) {
  if (!raceIds.length) return [];
  try {
    return await prisma.$queryRawUnsafe(
      `SELECT "raceId","driverId","status","position","grid","contacts","overtakes" FROM "RaceResult"
       WHERE "raceId" IN (${raceIds.map(() => "?").join(",")})`,
      ...raceIds
    );
  } catch {
    return [];
  }
}

// Last season's championship position for each of the given drivers: the
// same person (linked rows) or the same name, in the season numbered one
// lower in the same series. Only for a driver who started races there.
async function readPreviousPositions(prisma, season, drivers) {
  const out = new Map();
  if (!season || season.number <= 1 || !drivers.length) return out;
  const prev = await prisma.season.findFirst({
    where: { seriesId: season.seriesId ?? null, number: season.number - 1 },
    select: { id: true },
  });
  if (!prev) return out;
  const [{ standings }, { byDriver }] = await Promise.all([getDriverStandings(prisma, prev.id), getPersonGroups(prisma)]);
  const prevRows = standings || [];
  for (const d of drivers) {
    const person = byDriver.get(d.driverId);
    const hit =
      (person && prevRows.find((r) => byDriver.get(r.driverId) === person)) ||
      prevRows.find((r) => norm(r.name) === norm(d.name));
    if (hit?.position != null && startsOf(roundsOf(hit)).length) out.set(d.driverId, hit.position);
  }
  return out;
}

// Map<awardId, stats|null> for one season's shaped awards. Reads only what
// the awards need.
export async function readAwardStats(prisma, seasonId, awards) {
  const out = new Map();
  const list = awards || [];
  const driverAwards = list.filter((a) => a.kind === "driver");
  const teamAwards = list.filter((a) => a.kind === "team");
  const raceAwards = list.filter((a) => a.kind === "race");
  if (!list.length) return out;

  const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { id: true, number: true, seriesId: true } });
  const roundIds = (
    await prisma.race.findMany({
      where: { seasonId, isSpecialEvent: false, isCompleted: true, number: { not: null } },
      select: { id: true },
    })
  ).map((r) => r.id);
  // A sprint is a child race of its round; its rows count as that round's.
  const sprintOf = await readSprintChildren(prisma, roundIds).catch(() => new Map()); // round -> sprint
  const roundOf = new Map([...sprintOf].map(([round, sprint]) => [sprint, round]));

  if (driverAwards.length) {
    const [standings, results, quali, poleHolders] = await Promise.all([
      getDriverStandings(prisma, seasonId),
      readResults(prisma, [...roundIds, ...sprintOf.values()]),
      readQualiPositions(prisma, roundIds),
      readPoleHolders(prisma, roundIds),
    ]);
    const rows = new Map((standings.standings || []).map((r) => [r.driverId, r]));
    const poles = new Map();
    for (const id of poleHolders.values()) poles.set(id, (poles.get(id) || 0) + 1);
    const byDriver = new Map();
    for (const r of results) {
      if (!byDriver.has(r.driverId)) byDriver.set(r.driverId, []);
      byDriver.get(r.driverId).push(r);
    }
    const seasonOf = (id) => driverSeason(rows.get(id), byDriver.get(id) || [], quali.get(id) || [], poles.get(id) || 0);
    const improved = driverAwards.filter((a) => !a.partner && !a.race && statKindOf(a.title) === "improved");
    const prev = improved.length ? await readPreviousPositions(prisma, season, improved.map((a) => a.driver)) : new Map();

    for (const a of driverAwards) {
      const id = a.driver.driverId;
      if (a.partner) out.set(a.id, pairStatsOf(seasonOf(id), seasonOf(a.partner.driverId)));
      else if (a.race) out.set(a.id, driveStatsOf((byDriver.get(id) || []).find((r) => r.raceId === a.race.id)));
      else out.set(a.id, driverStatsOf(seasonOf(id), statKindOf(a.title), prev.get(id) ?? null));
    }
  }

  if (teamAwards.length) {
    const [t1, t2] = await Promise.all([getT1ConstructorStandings(prisma, seasonId), getT2ConstructorStandings(prisma, seasonId)]);
    const byTier = { 1: t1, 2: t2 };
    for (const a of teamAwards) {
      const row = (byTier[a.team.tier]?.standings || []).find((r) => r.teamId === a.team.id);
      out.set(a.id, teamStatsOf(row, a.team.tier));
    }
  }

  if (raceAwards.length) {
    const ids = [...new Set(raceAwards.flatMap((a) => [a.race.id, sprintOf.get(a.race.id)]).filter(Boolean))];
    const rows = await readResults(prisma, ids);
    const drivers = await prisma.driver.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.driverId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(drivers.map((d) => [d.id, d.name]));
    const byRace = new Map();
    for (const r of rows) {
      const round = roundOf.get(r.raceId);
      const id = round || r.raceId;
      if (!byRace.has(id)) byRace.set(id, []);
      byRace.get(id).push({ ...r, sprint: !!round });
    }
    for (const a of raceAwards) out.set(a.id, raceStatsOf(byRace.get(a.race.id), statKindOf(a.title, "race"), names));
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
