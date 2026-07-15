// ---------------------------------------------------------------------------
// Career inputs for the rating cards' EXP and PAC, per the league admin's
// formula sheet (driver cards.xlsx, confirmed 2026-07-15):
//
// Both ratings look at a ROLLING WINDOW of the last N finished seasons of the
// rated season's series (default 7). "Finished" = has championship races and
// none of them are still open, so a running season doesn't count until its
// finale is imported: while season 8 runs the window is 1–7, once it's done
// the window rolls to 2–8.
//
// Per PERSON (driver rows of the same human are linked across seasons via
// PersonLink), this service aggregates over the window:
//   * starts / finishes  (a start = any result that isn't DNS)
//   * championship score — per season: 60% drivers' standings + 40%
//     constructors' standings (the driver's team, within its tier), each
//     priced by a position-value curve, then recency-weighted (newest season
//     weighs most) and summed to one 0..1 value
//   * seasons active (>= 1 start) vs. window size
//   * pace inputs — average grid slot (the only qualifying signal we store
//     today), average best-race-lap gap to that race's fastest lap, the average
//     simresults-style consistency % (higher = steadier), and — once a
//     qualifying-session import populates RaceResult.qualiTimeMs — the average
//     gap to that race's pole time (min qualiTimeMs). Null everywhere until the
//     quali files arrive, so the PAC pole component stays inert.
//
// Pure read service; standings of finished seasons are cached in-memory for a
// few minutes since they only change when an admin edits an archived result.
// ---------------------------------------------------------------------------
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "./standingsService.js";
import { getPersonGroups } from "../lib/persons.js";

// --- position-value curves ----------------------------------------------------

// Value (0..1) for finishing position `pos` from a percent table like
// [100, 75, 50, ...]. Positions beyond the table get the table's last value,
// so P25 in a 24-car season still scores the P20 tail value instead of zero.
export function curveValue(pos, table) {
  if (!Array.isArray(table) || table.length === 0 || !Number.isFinite(pos) || pos < 1) return 0;
  const idx = Math.min(Math.floor(pos) - 1, table.length - 1);
  const v = Number(table[idx]);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : 0;
}

// Pick the constructor table matching this tier's team count. Exact match
// first; otherwise the closest count (the sheet defines them per field size:
// tier 1 with 6 teams pays differently than with 5).
export function constructorTableFor(tables, teamCount) {
  if (!Array.isArray(tables) || tables.length === 0) return null;
  let best = null;
  for (const t of tables) {
    if (!t || !Array.isArray(t.values)) continue;
    if (best === null || Math.abs((t.teams || 0) - teamCount) < Math.abs((best.teams || 0) - teamCount)) {
      best = t;
    }
  }
  return best ? best.values : null;
}

// --- window resolution ----------------------------------------------------------

// The last `windowSize` FINISHED seasons of the rated season's series, up to and
// including the rated season itself, newest first. Uses raw SQL for seriesId
// (raw-managed column) and derives "finished" from the race table.
export async function getRatingWindow(prisma, ratedSeason, windowSize) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT s."id", s."number",
            SUM(CASE WHEN r."isSpecialEvent" = 0 THEN 1 ELSE 0 END) AS champ,
            SUM(CASE WHEN r."isSpecialEvent" = 0 AND r."isCompleted" = 0 THEN 1 ELSE 0 END) AS open
       FROM "Season" s
       LEFT JOIN "Race" r ON r."seasonId" = s."id"
      WHERE COALESCE(s."seriesId", '') = COALESCE((SELECT "seriesId" FROM "Season" WHERE "id" = ?), '')
        AND s."number" <= ?
      GROUP BY s."id"
      ORDER BY s."number" DESC`,
    ratedSeason.id,
    ratedSeason.number
  );
  return rows
    .filter((r) => Number(r.champ) > 0 && Number(r.open) === 0)
    .slice(0, Math.max(1, windowSize))
    .map((r) => ({ id: r.id, number: Number(r.number) }));
}

// --- standings positions per season (cached) -----------------------------------

// One finished season's championship positions: drivers by driverId, teams by
// teamId with their tier context. `tiered` = the season splits into two tiers;
// otherwise its single constructor table uses the pre-tier curve.
const STANDINGS_CACHE_MS = 5 * 60 * 1000;
const standingsCache = new Map(); // seasonId -> { at, value }

async function seasonPositions(prisma, seasonId) {
  const hit = standingsCache.get(seasonId);
  if (hit && Date.now() - hit.at < STANDINGS_CACHE_MS) return hit.value;

  const [drv, t1, t2] = await Promise.all([
    getDriverStandings(prisma, seasonId),
    getT1ConstructorStandings(prisma, seasonId),
    getT2ConstructorStandings(prisma, seasonId),
  ]);
  const driverPos = new Map();
  for (const row of drv.standings || []) driverPos.set(row.driverId, row.position);
  const teamPos = new Map(); // teamId -> { position, tier, count }
  const t1Rows = t1.standings || [];
  const t2Rows = t2.standings || [];
  for (const row of t1Rows) teamPos.set(row.teamId, { position: row.position, tier: 1, count: t1Rows.length });
  for (const row of t2Rows) teamPos.set(row.teamId, { position: row.position, tier: 2, count: t2Rows.length });

  const value = { driverPos, teamPos, tiered: t2Rows.length > 0 };
  standingsCache.set(seasonId, { at: Date.now(), value });
  return value;
}

export function invalidateCareerStandingsCache() {
  standingsCache.clear();
}

// --- the main aggregation --------------------------------------------------------

// For every driver row of the rated season, the person-level window inputs.
// cfg needs: window { seasons, recency[] } and exp { split, driverCurve,
// constructors { preTier, tier1, tier2 } } — resolved by driverRatingsService.
//
// Returns Map<ratedDriverId, {
//   starts, finishes, finishRate, activeSeasons, windowSize, champPct,
//   pace: { avgGridNorm, nGrid, avgLapGap, nLap, avgConsistency, nCons },
// }>
export async function getCareerInputs(prisma, ratedSeason, ratedDrivers, cfg) {
  const window = await getRatingWindow(prisma, ratedSeason, cfg.window.seasons);
  const windowIds = window.map((s) => s.id);
  const empty = () => ({
    starts: 0,
    finishes: 0,
    finishRate: null,
    activeSeasons: 0,
    windowSize: window.length,
    champPct: 0,
    pace: {
      avgGridNorm: null, nGrid: 0,
      avgLapGap: null, nLap: 0,
      avgConsistency: null, nCons: 0,
      avgPoleGap: null, nPole: 0,
    },
  });
  const out = new Map(ratedDrivers.map((d) => [d.id, empty()]));
  if (window.length === 0) return out;

  // Person groups: every rated driver expands to all their linked rows, so
  // starts and results from earlier seasons (old name, other roster row) count.
  const { byDriver, byPerson } = await getPersonGroups(prisma);
  const linkedOf = (driverId) => {
    const p = byDriver.get(driverId);
    return p ? byPerson.get(p) || [driverId] : [driverId];
  };
  const allLinkedIds = new Set();
  for (const d of ratedDrivers) for (const id of linkedOf(d.id)) allLinkedIds.add(id);

  // Every driver row of the window seasons (for team/tier + season mapping),
  // and every result of our linked ids inside the window.
  const [windowDrivers, results] = await Promise.all([
    prisma.driver.findMany({
      where: { seasonId: { in: windowIds } },
      select: { id: true, seasonId: true, teamId: true },
    }),
    prisma.raceResult.findMany({
      where: {
        driverId: { in: [...allLinkedIds] },
        race: { seasonId: { in: windowIds }, isSpecialEvent: false, isCompleted: true },
      },
      select: {
        driverId: true,
        raceId: true,
        status: true,
        position: true,
        grid: true,
        bestLapMs: true,
        race: { select: { seasonId: true } },
      },
    }),
  ]);
  const rowSeason = new Map(windowDrivers.map((d) => [d.id, d.seasonId]));
  const rowTeam = new Map(windowDrivers.map((d) => [d.id, d.teamId]));

  // Per-race pace reference: the fastest best-lap and grid size of each race,
  // computed over the WHOLE field (not just our linked ids) so the gap is real.
  const raceIds = [...new Set(results.map((r) => r.raceId))];
  const raceMeta = new Map();
  if (raceIds.length) {
    const fieldRows = await prisma.raceResult.findMany({
      where: { raceId: { in: raceIds } },
      select: { raceId: true, grid: true, bestLapMs: true },
    });
    for (const raceId of raceIds) {
      const rs = fieldRows.filter((r) => r.raceId === raceId);
      const laps = rs.map((r) => r.bestLapMs).filter((x) => x != null);
      raceMeta.set(raceId, {
        fastestLap: laps.length ? Math.min(...laps) : null,
        gridSize: rs.filter((r) => r.grid != null).length,
      });
    }
  }

  // Consistency % is a raw-SQL telemetry column -> read it raw in one go.
  let consRows = [];
  try {
    const placeholders = windowIds.map(() => "?").join(",");
    consRows = await prisma.$queryRawUnsafe(
      `SELECT rr."driverId" AS "driverId", rr."consistencyPct" AS "pct"
         FROM "RaceResult" rr
         JOIN "Race" r ON r."id" = rr."raceId"
        WHERE r."seasonId" IN (${placeholders})
          AND r."isSpecialEvent" = 0 AND r."isCompleted" = 1
          AND rr."consistencyPct" IS NOT NULL`,
      ...windowIds
    );
  } catch {
    consRows = []; // column missing on a fresh checkout: no consistency signal
  }
  const consByDriver = new Map();
  for (const r of consRows) {
    if (!consByDriver.has(r.driverId)) consByDriver.set(r.driverId, []);
    consByDriver.get(r.driverId).push(Number(r.pct));
  }

  // Qualifying times (raw-SQL column, not populated yet): pole = the race's
  // fastest quali lap, gap = qualiTimeMs / pole - 1. Missing column or no
  // rows -> no pole-gap signal (the PAC component degrades to neutral).
  let qualiRows = [];
  try {
    const placeholders = windowIds.map(() => "?").join(",");
    qualiRows = await prisma.$queryRawUnsafe(
      `SELECT rr."raceId" AS "raceId", rr."driverId" AS "driverId", rr."qualiTimeMs" AS "q"
         FROM "RaceResult" rr
         JOIN "Race" r ON r."id" = rr."raceId"
        WHERE r."seasonId" IN (${placeholders})
          AND r."isSpecialEvent" = 0 AND r."isCompleted" = 1
          AND rr."qualiTimeMs" IS NOT NULL AND rr."qualiTimeMs" > 0`,
      ...windowIds
    );
  } catch {
    qualiRows = []; // column missing on a fresh checkout: no pole-gap signal
  }
  const poleByRace = new Map();
  for (const r of qualiRows) {
    const q = Number(r.q);
    if (!Number.isFinite(q) || q <= 0) continue;
    const cur = poleByRace.get(r.raceId);
    if (cur == null || q < cur) poleByRace.set(r.raceId, q);
  }
  const poleGapByDriver = new Map();
  for (const r of qualiRows) {
    const q = Number(r.q);
    const pole = poleByRace.get(r.raceId);
    if (!Number.isFinite(q) || q <= 0 || !pole) continue;
    if (!poleGapByDriver.has(r.driverId)) poleGapByDriver.set(r.driverId, []);
    poleGapByDriver.get(r.driverId).push(q / pole - 1);
  }

  // Championship positions of every window season (cached).
  const positions = new Map();
  for (const s of window) positions.set(s.id, await seasonPositions(prisma, s.id));

  // Recency weights, newest season first, renormalised over the actual window
  // length (a young league with 4 finished seasons uses the first 4 weights).
  const recencyRaw = window.map((_, i) => {
    const w = Number(cfg.window.recency[i]);
    return Number.isFinite(w) && w > 0 ? w : 0;
  });
  const recencySum = recencyRaw.reduce((a, b) => a + b, 0);
  const recency = recencyRaw.map((w) => (recencySum > 0 ? w / recencySum : 1 / window.length));

  const splitSum = cfg.exp.split.drivers + cfg.exp.split.constructors;
  const wDrivers = splitSum > 0 ? cfg.exp.split.drivers / splitSum : 0.6;
  const wCons = splitSum > 0 ? cfg.exp.split.constructors / splitSum : 0.4;

  for (const rated of ratedDrivers) {
    const acc = out.get(rated.id);
    const linked = linkedOf(rated.id);
    const linkedSet = new Set(linked);

    // Results of this person inside the window.
    const mine = results.filter((r) => linkedSet.has(r.driverId));
    const started = mine.filter((r) => r.status !== "DNS");
    const finished = started.filter((r) => r.status === "FINISHED" && r.position != null);
    acc.starts = started.length;
    acc.finishes = finished.length;
    acc.finishRate = acc.starts ? acc.finishes / acc.starts : null;

    const seasonsWithStart = new Set(started.map((r) => r.race.seasonId));
    acc.activeSeasons = seasonsWithStart.size;

    // Championship score, season by season, recency-weighted.
    let champ = 0;
    window.forEach((s, i) => {
      const pos = positions.get(s.id);
      // This person's roster row in that season (first linked row that lives there).
      const rowId = linked.find((id) => rowSeason.get(id) === s.id);
      if (!rowId) return;
      const dPos = pos.driverPos.get(rowId);
      const dVal = dPos != null ? curveValue(dPos, cfg.exp.driverCurve) : 0;
      let cVal = 0;
      const teamId = rowTeam.get(rowId);
      const tp = teamId != null ? pos.teamPos.get(teamId) : null;
      if (tp) {
        const table = pos.tiered
          ? tp.tier === 2
            ? constructorTableFor(cfg.exp.constructors.tier2, tp.count)
            : constructorTableFor(cfg.exp.constructors.tier1, tp.count)
          : cfg.exp.constructors.preTier;
        cVal = table ? curveValue(tp.position, table) : 0;
      }
      champ += recency[i] * (wDrivers * dVal + wCons * cVal);
    });
    acc.champPct = Math.max(0, Math.min(1, champ));

    // Pace inputs over the window.
    const gridNorms = [];
    const lapGaps = [];
    for (const r of started) {
      const m = raceMeta.get(r.raceId);
      if (!m) continue;
      if (r.grid != null && m.gridSize > 1) gridNorms.push((r.grid - 1) / (m.gridSize - 1));
      if (r.bestLapMs != null && m.fastestLap) lapGaps.push(r.bestLapMs / m.fastestLap - 1);
    }
    const cons = linked.flatMap((id) => consByDriver.get(id) || []).filter((x) => Number.isFinite(x));
    const poleGaps = linked.flatMap((id) => poleGapByDriver.get(id) || []).filter((x) => Number.isFinite(x));
    acc.pace = {
      avgGridNorm: gridNorms.length ? gridNorms.reduce((a, b) => a + b, 0) / gridNorms.length : null,
      nGrid: gridNorms.length,
      avgLapGap: lapGaps.length ? lapGaps.reduce((a, b) => a + b, 0) / lapGaps.length : null,
      nLap: lapGaps.length,
      avgConsistency: cons.length ? cons.reduce((a, b) => a + b, 0) / cons.length : null,
      nCons: cons.length,
      avgPoleGap: poleGaps.length ? poleGaps.reduce((a, b) => a + b, 0) / poleGaps.length : null,
      nPole: poleGaps.length,
    };
  }

  return out;
}
