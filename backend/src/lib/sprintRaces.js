// ---------------------------------------------------------------------------
// The sprint half of a sprint+feature weekend (raceFormat SPRINT_FEATURE,
// lib/raceFormat.js).
//
// One evening, two classifications — but RaceResult is unique per (race,
// driver), so the sprint cannot share the event's row. It gets a CHILD row
// instead: a hidden race pointing back at its event via parentRaceId. The
// child is SPECIAL-typed and isSpecialEvent, so nothing that scores, signs up
// or announces ever sees it; calendars filter it out by the parent link. The
// event itself keeps carrying the feature race exactly as before, which is why
// nothing that already read results had to change.
//
// parentRaceId lives outside the generated Prisma client (ensureAppSchema,
// raw SQL), so all reads and writes of the link go through here.
// ---------------------------------------------------------------------------
import { writeRaceType } from "./raceTypes.js";

// Map raceId -> parentRaceId for the given ids (only rows that HAVE a parent
// appear). Empty map when the column doesn't exist yet.
export async function readParentIds(prisma, raceIds) {
  const ids = [...new Set(raceIds)].filter(Boolean);
  if (!ids.length) return new Map();
  try {
    const qs = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "parentRaceId" FROM "Race" WHERE "parentRaceId" IS NOT NULL AND "id" IN (${qs})`,
      ...ids
    );
    return new Map(rows.map((r) => [r.id, r.parentRaceId]));
  } catch {
    return new Map();
  }
}

// Map parentRaceId -> childRaceId (the sprint row) for the given parent ids.
export async function readSprintChildren(prisma, raceIds) {
  const ids = [...new Set(raceIds)].filter(Boolean);
  if (!ids.length) return new Map();
  try {
    const qs = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "parentRaceId" FROM "Race" WHERE "parentRaceId" IN (${qs})`,
      ...ids
    );
    return new Map(rows.map((r) => [r.parentRaceId, r.id]));
  } catch {
    return new Map();
  }
}

// Find or create the sprint child of an event. `parent` is the full race row.
// Refuses to nest (a child cannot have children) — the import route turns that
// into a 400. Returns the child race row.
export async function ensureSprintChild(prisma, parent) {
  const isChild = (await readParentIds(prisma, [parent.id])).get(parent.id);
  if (isChild) {
    const err = new Error("This race is itself a sprint classification");
    err.status = 400;
    throw err;
  }
  const existingId = (await readSprintChildren(prisma, [parent.id])).get(parent.id);
  if (existingId) {
    return prisma.race.findUnique({ where: { id: existingId } });
  }
  const child = await prisma.race.create({
    data: {
      number: null,
      track: parent.track,
      date: parent.date,
      seasonId: parent.seasonId,
      // The derived "never scores" flag every scoring read filters on.
      isSpecialEvent: true,
    },
  });
  // SPECIAL: site-only — no RSVP, no announcement, absent from the events feed.
  await writeRaceType(prisma, child.id, "SPECIAL");
  await prisma.$executeRawUnsafe(`UPDATE "Race" SET "parentRaceId" = ? WHERE "id" = ?`, parent.id, child.id);
  // Cosmetics that make the child's own classification read right: the track
  // flag, and the sprint distance as the child's race length (the strategy
  // axis and the session line of the CHILD row — the parent keeps its own).
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "country", "sprintLaps" FROM "Race" WHERE "id" = ?`,
      parent.id
    );
    if (rows[0]?.country) {
      await prisma.$executeRawUnsafe(`UPDATE "Race" SET "country" = ? WHERE "id" = ?`, rows[0].country, child.id);
    }
    if (rows[0]?.sprintLaps != null) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Race" SET "raceLaps" = ? WHERE "id" = ?`,
        Number(rows[0].sprintLaps),
        child.id
      );
    }
  } catch {
    /* cosmetic only */
  }
  return prisma.race.findUnique({ where: { id: child.id } });
}
