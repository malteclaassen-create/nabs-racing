// ---------------------------------------------------------------------------
// Reads the AC telemetry columns of RaceResult via raw SQL. These columns
// (contacts, envContacts, cuts, overtakes, laps, cleanLaps, consistencyMs,
// gamePenalties, gamePenaltySeconds) are added by ensureAppSchema at boot, but
// the generated Prisma client on disk may not know them yet (it can't be
// regenerated while the dev server holds it on Windows). Reading them raw makes
// every consumer work regardless of the client's generation state — the same
// pattern used for `contacts` elsewhere. SQLite INTEGER comes back as BigInt, so
// everything is coerced with Number().
// ---------------------------------------------------------------------------

const COLS = [
  "contacts", "envContacts", "cuts", "overtakes", "lapsLed", "laps",
  "cleanLaps", "consistencyMs", "consistencyPct", "gamePenalties", "gamePenaltySeconds",
  "stints",
];

const num = (v) => (v == null ? null : Number(v));

// stints is stored as JSON text ([{tyre, laps}]); anything unparseable = null.
function parseStints(v) {
  if (!v || typeof v !== "string") return null;
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch {
    return null;
  }
}

function shape(r) {
  return {
    contacts: num(r.contacts),
    envContacts: num(r.envContacts),
    cuts: num(r.cuts),
    overtakes: num(r.overtakes),
    lapsLed: num(r.lapsLed),
    laps: num(r.laps),
    cleanLaps: num(r.cleanLaps),
    consistencyMs: num(r.consistencyMs),
    consistencyPct: num(r.consistencyPct),
    gamePenalties: num(r.gamePenalties),
    gamePenaltySeconds: num(r.gamePenaltySeconds),
    stints: parseStints(r.stints),
  };
}

const SELECT_COLS = COLS.map((c) => `"${c}"`).join(", ");

// Map<driverId, telemetry> for one race.
export async function telemetryForRace(prisma, raceId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "driverId", ${SELECT_COLS} FROM "RaceResult" WHERE "raceId" = ?`,
    raceId
  );
  return new Map(rows.map((r) => [r.driverId, shape(r)]));
}

// Map<raceId, telemetry> for one driver (across every race they ran).
export async function telemetryForDriver(prisma, driverId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "raceId", ${SELECT_COLS} FROM "RaceResult" WHERE "driverId" = ?`,
    driverId
  );
  return new Map(rows.map((r) => [r.raceId, shape(r)]));
}

// Map<`${raceId}|${driverId}`, telemetry> for a whole season.
export async function telemetryBySeason(prisma, seasonId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT rr."raceId" AS "raceId", rr."driverId" AS "driverId", ${COLS.map((c) => `rr."${c}"`).join(", ")}
     FROM "RaceResult" rr JOIN "Race" r ON r."id" = rr."raceId"
     WHERE r."seasonId" = ?`,
    seasonId
  );
  return new Map(rows.map((r) => [`${r.raceId}|${r.driverId}`, shape(r)]));
}

// Raw telemetry rows for many races at once (track history across seasons).
// Returns [{ raceId, driverId, ...telemetry }].
export async function telemetryForRaces(prisma, raceIds) {
  if (!raceIds || !raceIds.length) return [];
  const placeholders = raceIds.map(() => "?").join(",");
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "raceId", "driverId", ${SELECT_COLS} FROM "RaceResult" WHERE "raceId" IN (${placeholders})`,
    ...raceIds
  );
  return rows.map((r) => ({ raceId: r.raceId, driverId: r.driverId, ...shape(r) }));
}
