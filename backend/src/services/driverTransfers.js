// ---------------------------------------------------------------------------
// Driver transfers, recorded against a ROUND rather than against "now".
//
// "Maltegoat drives for Ferrari from round 5" is the sentence a league actually
// says, and it points in both directions in time:
//
//   forward   round 5 has not been driven yet. Nothing may change today; the
//             switch has to be waiting when that round is finally saved.
//   backward  round 5 is long gone and nobody wrote the move down. The rounds
//             since then are attributed to the wrong team, and the constructor
//             points with them.
//
// One record covers both: DriverTeamChange (driverId, fromRound, teamId). The
// team of any given round is the newest change whose round has already come,
// and everything else follows from that:
//
//   * saving a round asks this list first (raceWriter), so a change entered
//     weeks in advance simply applies itself when the round arrives;
//   * entering a change for a round already saved re-stamps those results and
//     rescores exactly those rounds, because the old attribution was wrong;
//   * Driver.teamId — what the roster and the standings call "their team" —
//     is moved only when the change's round is the one being driven next.
//
// Nothing here happens silently: applyTransfer runs as a dry run first and
// hands back every round it would touch and every constructor total that would
// move, which is what the admin confirms.
// ---------------------------------------------------------------------------
import { getSeasonScoring } from "./seasonService.js";
import { DEFAULT_POINTS_TABLE } from "./pointsCalculator.js";
import { constructorRowsFor, constructorDelta, writeConstructorScores } from "./constructorScores.js";
import { ensureReservePool } from "../lib/reservePool.js";

// Raw-SQL table (ensureAppSchema + migration driver_team_change), like
// PersonLink and the traffic tables: it has to be writable with the dev server
// holding the generated client.
export async function ensureTransferTable(prisma) {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "DriverTeamChange" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "driverId"  TEXT NOT NULL,
    "seasonId"  TEXT,
    "fromRound" INTEGER NOT NULL,
    "teamId"    TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // One statement per driver and round: entering the same round twice replaces
  // the earlier answer rather than stacking two contradictory ones.
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "DriverTeamChange_driverId_fromRound_key" ON "DriverTeamChange"("driverId", "fromRound")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "DriverTeamChange_seasonId_idx" ON "DriverTeamChange"("seasonId")`
  );
}

// All recorded changes, oldest round first. Scope by season or by driver.
export async function readTransfers(prisma, { seasonId, driverId } = {}) {
  const where = [];
  const args = [];
  if (seasonId) { where.push(`"seasonId" = ?`); args.push(seasonId); }
  if (driverId) { where.push(`"driverId" = ?`); args.push(driverId); }
  const sql =
    `SELECT "id", "driverId", "seasonId", "fromRound", "teamId", "createdAt" FROM "DriverTeamChange"` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY "fromRound" ASC`;
  try {
    return await prisma.$queryRawUnsafe(sql, ...args);
  } catch {
    return []; // table not created yet (first boot of an older database)
  }
}

// driverId -> their changes, oldest round first.
export function byDriver(rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (!out.has(r.driverId)) out.set(r.driverId, []);
    out.get(r.driverId).push(r);
  }
  return out;
}

// The team a driver is recorded as driving for in this round: the newest change
// whose round has already come. `null` when nothing has been recorded for them
// that early, which means the caller's own fallback applies.
export function teamForRound(changes, roundNumber, fallback = null) {
  if (roundNumber == null) return fallback;
  let found = null;
  for (const c of changes || []) {
    if (c.fromRound <= roundNumber) found = c;
  }
  return found ? found.teamId : fallback;
}

// The round the season is about to drive: the lowest scored round without
// results. A change from that round on is a change that applies today.
async function nextRoundNumber(prisma, seasonId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT MIN("number") AS n FROM "Race"
      WHERE "seasonId" = ? AND "number" IS NOT NULL AND "isCompleted" = 0`,
    seasonId
  );
  if (rows[0]?.n != null) return Number(rows[0].n);
  const max = await prisma.$queryRawUnsafe(
    `SELECT MAX("number") AS n FROM "Race" WHERE "seasonId" = ? AND "number" IS NOT NULL`,
    seasonId
  );
  return (Number(max[0]?.n) || 0) + 1;
}

// The scored rounds of a season that already have results, oldest first.
async function savedRounds(prisma, seasonId) {
  return prisma.$queryRawUnsafe(
    `SELECT "id", "number", "track" FROM "Race"
      WHERE "seasonId" = ? AND "number" IS NOT NULL AND "isCompleted" = 1
      ORDER BY "number" ASC`,
    seasonId
  );
}

// Work out everything a change would do, without writing any of it: which saved
// rounds get re-attributed, and which constructor totals move as a result.
//
// `changes` is the driver's list AS IT WOULD BE afterwards, so the same routine
// serves both entering a change and taking one back.
async function planFor(prisma, { driver, changes, firstRound, teamById, drivers, teams, table }) {
  const rounds = (await savedRounds(prisma, driver.seasonId)).filter((r) => Number(r.number) >= firstRound);
  const plan = [];

  // Where these rounds fall back to when nothing is recorded for them: the team
  // of the last round the driver drove BEFORE this one. Deliberately not
  // Driver.teamId, which is where a transfer being taken back has already moved
  // them — using that, undoing a change would compare the rounds against the
  // very team it had just put there and conclude that nothing needs undoing.
  const before = await prisma.$queryRawUnsafe(
    `SELECT rr."teamId" AS "teamId" FROM "RaceResult" rr
       JOIN "Race" r ON r."id" = rr."raceId"
      WHERE rr."driverId" = ? AND r."seasonId" = ? AND r."number" IS NOT NULL AND r."number" < ?
      ORDER BY r."number" DESC LIMIT 1`,
    driver.id, driver.seasonId, firstRound
  );
  const baseline = before[0]?.teamId || driver.teamId;

  for (const race of rounds) {
    const results = await prisma.raceResult.findMany({ where: { raceId: race.id } });
    const mine = results.find((r) => r.driverId === driver.id);
    if (!mine) continue; // they did not drive this round, so nothing to move

    // Taking a change back can leave a round with nothing recorded for it. The
    // honest answer then is the team the round in front of it was driven for,
    // and failing that the baseline above.
    const fallback = previousStamp(plan, race.number) ?? baseline;
    const wanted = teamForRound(changes, Number(race.number), fallback);
    if (!wanted || wanted === mine.teamId) {
      plan.push({ raceId: race.id, number: Number(race.number), track: race.track, teamId: mine.teamId, changed: false, delta: [] });
      continue;
    }

    // Rescore the round with the corrected attribution.
    const rescored = results.map((r) => (r.driverId === driver.id ? { ...r, teamId: wanted } : r));
    const fresh = constructorRowsFor(race.id, rescored, drivers, teams, table);
    const stored = await prisma.constructorRaceScore.findMany({ where: { raceId: race.id } });
    plan.push({
      raceId: race.id,
      number: Number(race.number),
      track: race.track,
      teamId: wanted,
      from: teamById.get(mine.teamId)?.name || null,
      to: teamById.get(wanted)?.name || null,
      changed: true,
      delta: constructorDelta(stored, fresh, teams),
      rescored,
    });
  }
  return plan;
}

// The team the most recent already-planned round ended up with.
function previousStamp(plan, number) {
  let found = null;
  for (const p of plan) if (p.number < number) found = p.teamId;
  return found;
}

async function seasonContext(prisma, seasonId) {
  const [drivers, teams, scoring] = await Promise.all([
    prisma.driver.findMany({ where: { seasonId } }),
    prisma.team.findMany({ where: { seasonId } }),
    getSeasonScoring(prisma, seasonId),
  ]);
  return { drivers, teams, table: scoring.pointsTable || DEFAULT_POINTS_TABLE, teamById: new Map(teams.map((t) => [t.id, t])) };
}

// Record (or preview) "this driver drives for this team from this round on".
// Throws a 400/404-flagged error the route can pass straight through.
export async function applyTransfer(prisma, { driverId, teamId, fromRound, dryRun = false }) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { team: { select: { id: true, name: true, tier: true } }, season: { select: { id: true, name: true } } },
  });
  if (!driver) throw fail(404, "Driver not found");
  if (!driver.seasonId) throw fail(400, "This driver has no season, so there are no rounds to transfer between");

  const round = Number(fromRound);
  if (!Number.isInteger(round) || round < 1) throw fail(400, "Pick the round the change takes effect from");

  const target = await resolveTeam(prisma, driver, teamId);
  const { drivers, teams, table, teamById } = await seasonContext(prisma, driver.seasonId);

  // The round has to be one this season actually drives, or the change would
  // sit in a gap and never apply.
  const known = await prisma.$queryRawUnsafe(
    `SELECT "number" FROM "Race" WHERE "seasonId" = ? AND "number" = ? LIMIT 1`, driver.seasonId, round);
  if (!known.length) throw fail(400, `${driver.season?.name || "This season"} has no round ${round}.`);

  const existing = await readTransfers(prisma, { driverId });
  const changes = [...existing.filter((c) => c.fromRound !== round), { fromRound: round, teamId: target.id }]
    .sort((a, b) => a.fromRound - b.fromRound);

  const plan = await planFor(prisma, { driver, changes, firstRound: round, teamById, drivers, teams, table });
  const touched = plan.filter((p) => p.changed);
  const next = await nextRoundNumber(prisma, driver.seasonId);
  const effectiveTeamId = teamForRound(changes, next, null);

  const summary = {
    driver: { id: driver.id, name: driver.name },
    from: driver.team ? { id: driver.team.id, name: driver.team.name, tier: driver.team.tier } : null,
    to: { id: target.id, name: target.name, tier: target.tier },
    fromRound: round,
    nextRound: next,
    // A change for a round still to come touches nothing today: that is the
    // whole point of being able to enter it early.
    appliesLater: round > next,
    rounds: touched.map(({ rescored, ...rest }) => rest),
    unchangedRounds: plan.length - touched.length,
  };
  if (dryRun) return summary;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`DELETE FROM "DriverTeamChange" WHERE "driverId" = ? AND "fromRound" = ?`, driverId, round);
    await tx.$executeRawUnsafe(
      `INSERT INTO "DriverTeamChange" ("id","driverId","seasonId","fromRound","teamId") VALUES (?,?,?,?,?)`,
      `${driverId}_r${round}_${target.id}`.slice(0, 190), driverId, driver.seasonId, round, target.id
    );
    await writePlan(tx, driver.id, touched, drivers, teams, table);
    // The roster follows only once the change's round is the one being driven.
    if (effectiveTeamId && effectiveTeamId !== driver.teamId) {
      const eff = teamById.get(effectiveTeamId);
      if (eff) await tx.driver.update({ where: { id: driver.id }, data: { teamId: eff.id, tier: eff.tier, isActive: eff.tier === 0 ? driver.isActive : true } });
    }
  });
  return { ...summary, applied: true };
}

// Take a recorded change back. The rounds it had claimed fall back to whatever
// was recorded before it, and are rescored accordingly.
export async function removeTransfer(prisma, { driverId, changeId, dryRun = false }) {
  const existing = await readTransfers(prisma, { driverId });
  const gone = existing.find((c) => c.id === changeId);
  if (!gone) throw fail(404, "That transfer is not on record");

  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { team: { select: { id: true, name: true, tier: true } } },
  });
  if (!driver) throw fail(404, "Driver not found");

  const { drivers, teams, table, teamById } = await seasonContext(prisma, driver.seasonId);
  const changes = existing.filter((c) => c.id !== changeId);
  const plan = await planFor(prisma, { driver, changes, firstRound: gone.fromRound, teamById, drivers, teams, table });
  const touched = plan.filter((p) => p.changed);
  const next = await nextRoundNumber(prisma, driver.seasonId);
  // With the change gone, "their team now" is whatever is still recorded for
  // the next round, else the team of the last round they actually drove.
  const effectiveTeamId =
    teamForRound(changes, next, null) ?? lastDrivenTeam(plan) ?? driver.teamId;

  const summary = {
    driver: { id: driver.id, name: driver.name },
    removed: { fromRound: gone.fromRound, team: teamById.get(gone.teamId)?.name || gone.teamId },
    rounds: touched.map(({ rescored, ...rest }) => rest),
  };
  if (dryRun) return summary;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`DELETE FROM "DriverTeamChange" WHERE "id" = ?`, changeId);
    await writePlan(tx, driver.id, touched, drivers, teams, table);
    if (effectiveTeamId && effectiveTeamId !== driver.teamId) {
      const eff = teamById.get(effectiveTeamId);
      if (eff) await tx.driver.update({ where: { id: driver.id }, data: { teamId: eff.id, tier: eff.tier } });
    }
  });
  return { ...summary, applied: true };
}

function lastDrivenTeam(plan) {
  return plan.length ? plan[plan.length - 1].teamId : null;
}

// Re-stamp one driver's results and rescore the rounds that moved. The results
// themselves are untouched apart from the team: positions, times, penalties and
// telemetry all stay exactly where they are.
async function writePlan(tx, driverId, touched, drivers, teams, table) {
  for (const p of touched) {
    await tx.$executeRawUnsafe(
      `UPDATE "RaceResult" SET "teamId" = ? WHERE "raceId" = ? AND "driverId" = ?`,
      p.teamId, p.raceId, driverId
    );
    await writeConstructorScores(tx, p.raceId, p.rescored, drivers, teams, table);
  }
}

// "reserve" is a destination rather than an id: a season without a pool gets
// one, the same way the attendance sign-up and the driver removal do.
async function resolveTeam(prisma, driver, teamId) {
  const wanted = String(teamId || "").trim();
  if (!wanted) throw fail(400, "Pick a team to move them to");
  if (wanted === "reserve") {
    const pool = await ensureReservePool(prisma, driver.seasonId);
    if (!pool) throw fail(404, "Season not found");
    return pool;
  }
  const team = await prisma.team.findUnique({ where: { id: wanted }, select: { id: true, name: true, tier: true, seasonId: true } });
  if (!team) throw fail(404, "Team not found");
  if (team.seasonId && driver.seasonId && team.seasonId !== driver.seasonId) {
    throw fail(400, `${team.name} belongs to a different season. A driver can only move between the teams of their own season.`);
  }
  return team;
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
