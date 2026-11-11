// ---------------------------------------------------------------------------
// Division 2.
//
// Newcomers race in a field of their own: same evening, same briefing, but
// qualifying and race run on the league's second server, in parallel with the
// main race on the first. Division 1 keeps its two tiers; Division 2 has one
// tier for everybody and teams of its own (they may share a name with a
// Division 1 team, two Red Bulls are fine, they are separate rows).
//
// How it is stored:
//   * A Division 2 team is a Team with tier 3. Every reader that asks for
//     tier 1 or tier 2 therefore never sees one, and the Division 1 tables
//     stay exactly what they were.
//   * A driver is in Division 2 when their team is (Driver.tier follows the
//     team, so 3 as well), or when they are a reserve (tier 0) with
//     Driver.division = 2: the Division 2 reserve pool.
//   * The Division 2 classification of a round sits on a hidden CHILD race row
//     like a sprint's (Race.parentRaceId), told apart by Race.division = 2.
//     The child is SPECIAL-typed and isSpecialEvent, so nothing that counts
//     rounds, signs people up or keeps records ever mistakes it for a round.
//     The Division 2 standings find it through readDivisionChildren below.
//   * Season.division2 switches the division on for a season; Race.capacity2
//     is the second field's grid size (null = the round's own capacity).
//
// All of these are raw-SQL columns (ensureAppSchema), so every read and write
// of them goes through here.
// ---------------------------------------------------------------------------
import { writeRaceType } from "./raceTypes.js";

export const DIV2_TIER = 3;

// Which division a driver races in: 1 or 2. `driver` needs tier, and
// `division` when it was read (reserves only); `team` is optional and wins when
// given, because a driver row's tier can lag a team that was just re-tiered.
export function divisionOf(driver, team = driver?.team) {
  const tier = team?.tier ?? driver?.tier;
  if (tier === DIV2_TIER) return 2;
  if ((driver?.tier ?? tier) === 0 && Number(driver?.division) === 2) return 2;
  return 1;
}

// Driver id -> division for every driver of a season (only Division 2 rows
// appear; anyone missing is Division 1).
export async function readDivision2Drivers(prisma, seasonId) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT d."id" FROM "Driver" d LEFT JOIN "Team" t ON t."id" = d."teamId"
        WHERE d."seasonId" = ? AND (t."tier" = ? OR d."tier" = ? OR (d."tier" = 0 AND d."division" = 2))`,
      seasonId,
      DIV2_TIER,
      DIV2_TIER
    );
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}

// The Division 2 drivers of a season that RUNS Division 2 (Season.division2);
// an empty set otherwise, so a season with the switch off has one grid.
export async function activeDivision2Drivers(prisma, seasonId) {
  if (!(await seasonHasDivision2(prisma, seasonId))) return new Set();
  return readDivision2Drivers(prisma, seasonId);
}

// The reserve-pool flag of the given drivers: Map driverId -> 2 (only the
// Division 2 pool appears).
export async function readDriverDivisions(prisma, driverIds) {
  const ids = [...new Set(driverIds || [])].filter(Boolean);
  if (!ids.length) return new Map();
  try {
    const qs = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "division" FROM "Driver" WHERE "division" = 2 AND "id" IN (${qs})`,
      ...ids
    );
    return new Map(rows.map((r) => [r.id, 2]));
  } catch {
    return new Map();
  }
}

export async function writeDriverDivision(prisma, driverId, division) {
  const value = Number(division) === 2 ? 2 : null;
  await prisma.$executeRawUnsafe(`UPDATE "Driver" SET "division" = ? WHERE "id" = ?`, value, driverId);
  return value;
}

// Is Division 2 switched on for this season?
export async function seasonHasDivision2(prisma, seasonId) {
  if (!seasonId) return false;
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT "division2" FROM "Season" WHERE "id" = ?`, seasonId);
    return !!Number(rows[0]?.division2);
  } catch {
    return false;
  }
}

export async function writeSeasonDivision2(prisma, seasonId, on) {
  await prisma.$executeRawUnsafe(`UPDATE "Season" SET "division2" = ? WHERE "id" = ?`, on ? 1 : 0, seasonId);
  return !!on;
}

// Map raceId -> true for the given ids that ARE Division 2 children.
export async function readDivisionChildIds(prisma, raceIds) {
  const ids = [...new Set(raceIds || [])].filter(Boolean);
  if (!ids.length) return new Set();
  try {
    const qs = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Race" WHERE "division" = 2 AND "id" IN (${qs})`,
      ...ids
    );
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}

// Map parentRaceId -> Division 2 child id for the given rounds.
export async function readDivisionChildren(prisma, parentIds) {
  const ids = [...new Set(parentIds || [])].filter(Boolean);
  if (!ids.length) return new Map();
  try {
    const qs = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "parentRaceId" FROM "Race" WHERE "division" = 2 AND "parentRaceId" IN (${qs})`,
      ...ids
    );
    return new Map(rows.map((r) => [r.parentRaceId, r.id]));
  } catch {
    return new Map();
  }
}

// Map Division 2 child id -> its round's race id.
export async function readDivisionParents(prisma, childIds) {
  const ids = [...new Set(childIds || [])].filter(Boolean);
  if (!ids.length) return new Map();
  try {
    const qs = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "parentRaceId" FROM "Race" WHERE "division" = 2 AND "parentRaceId" IS NOT NULL AND "id" IN (${qs})`,
      ...ids
    );
    return new Map(rows.map((r) => [r.id, r.parentRaceId]));
  } catch {
    return new Map();
  }
}

// Round capacity of the second field: Map raceId -> capacity2 (null = the
// round's own capacity, which is what the caller falls back to).
export async function readCapacity2(prisma, raceIds) {
  const ids = [...new Set(raceIds || [])].filter(Boolean);
  if (!ids.length) return new Map();
  try {
    const qs = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "capacity2" FROM "Race" WHERE "id" IN (${qs})`,
      ...ids
    );
    return new Map(rows.map((r) => [r.id, r.capacity2 == null ? null : Number(r.capacity2)]));
  } catch {
    return new Map();
  }
}

export async function writeCapacity2(prisma, raceId, value) {
  const n = value === "" || value == null ? null : Math.max(1, Math.min(200, Math.round(Number(value))));
  await prisma.$executeRawUnsafe(
    `UPDATE "Race" SET "capacity2" = ? WHERE "id" = ?`,
    Number.isFinite(n) ? n : null,
    raceId
  );
  return Number.isFinite(n) ? n : null;
}

// Find or create the Division 2 child of a round. `parent` is the full race
// row. Refuses a parent that is itself a child (a sprint or another division).
export async function ensureDivisionChild(prisma, parent) {
  const own = await prisma.$queryRawUnsafe(`SELECT "parentRaceId" FROM "Race" WHERE "id" = ?`, parent.id).catch(() => []);
  if (own[0]?.parentRaceId) {
    const err = new Error("Division 2 results belong to a round, not to a sprint or another division");
    err.status = 400;
    throw err;
  }
  const existingId = (await readDivisionChildren(prisma, [parent.id])).get(parent.id);
  if (existingId) return prisma.race.findUnique({ where: { id: existingId } });

  const child = await prisma.race.create({
    data: {
      number: null,
      track: parent.track,
      date: parent.date,
      seasonId: parent.seasonId,
      // Not a round of its own: every round-counting read filters on this.
      // The division's standings find it through the parent link.
      isSpecialEvent: true,
    },
  });
  await writeRaceType(prisma, child.id, "SPECIAL");
  await prisma.$executeRawUnsafe(
    `UPDATE "Race" SET "parentRaceId" = ?, "division" = 2 WHERE "id" = ?`,
    parent.id,
    child.id
  );
  // The flag and the race length, so the child's own page reads right.
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT "country", "raceLaps", "qualiMinutes" FROM "Race" WHERE "id" = ?`, parent.id);
    const p = rows[0] || {};
    await prisma.$executeRawUnsafe(
      `UPDATE "Race" SET "country" = ?, "raceLaps" = ?, "qualiMinutes" = ? WHERE "id" = ?`,
      p.country ?? null,
      p.raceLaps ?? null,
      p.qualiMinutes ?? null,
      child.id
    );
  } catch {
    /* cosmetic only */
  }
  return prisma.race.findUnique({ where: { id: child.id } });
}
