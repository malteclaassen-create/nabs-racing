// ---------------------------------------------------------------------------
// The sprint half of a sprint+feature weekend (raceFormat SPRINT_FEATURE,
// lib/raceFormat.js).
//
// One evening, two classifications — but RaceResult is unique per (race,
// driver), so the sprint cannot share the event's row. It gets a CHILD row
// instead: a hidden race pointing back at its event via parentRaceId. The
// child is SPECIAL-typed and isSpecialEvent, so nothing that signs up,
// announces, counts rounds or keeps records ever sees it; calendars filter it
// out by the parent link. The event itself keeps carrying the feature race
// exactly as before, which is why nothing that already read results had to
// change.
//
// THE SPRINT SCORES. It pays the same points table as the feature race, and
// those points land under the weekend's round number — one round, two
// classifications, both counted (the league ran its sprints that way before
// the site existed). The standings, the admin preview and the transfer service
// find the child through readSprintChildrenOf below rather than through the
// isSpecialEvent flag, which is why the flag can stay set: for every OTHER
// reader the child is still not a round of its own, and a season with a
// sprint weekend still has as many rounds as its calendar says.
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

// The sprint classifications hanging off the given championship rounds, as a
// map childRaceId -> parent race row (only rounds that HAVE a sprint on file
// appear). This is the one door through which a sprint reaches the scoring:
// a caller that scores a season's rounds asks for their children here and
// scores each child under its parent's round number.
export async function readSprintChildrenOf(prisma, races) {
  const rounds = (races || []).filter((r) => r?.id);
  const byParent = await readSprintChildren(prisma, rounds.map((r) => r.id));
  const out = new Map();
  for (const race of rounds) {
    const childId = byParent.get(race.id);
    if (childId) out.set(childId, race);
  }
  return out;
}

// The classifications a RATING reads for these rounds: the rounds themselves
// plus, for a sprint weekend, its sprint child. The child comes back carrying
// its parent's `number` (it has none of its own, and every "as of round N" cut
// is made on that number) and `sprintOf` naming the round it belongs to.
//
// The counterpart of withSprintRounds below: that one takes rows that may BE
// children and tells you which round they belong to; this one takes rounds and
// adds the children hanging off them. Rounds without a sprint, and a season
// that runs none, come back exactly as they went in — a league with no sprint
// weekend sees no change from any of this.
//
// Only COMPLETED children join: a sprint whose result is not imported yet is
// not a classification anyone drove as far as the ratings are concerned, and
// the weekend's feature race can well be on file before it.
//
// `rounds` are championship rounds (isSpecialEvent = false). Returns
// { races, sprintIds, roundOf } — `roundOf` maps every race id back to its
// round's id, which is how a caller counts race WEEKENDS rather than
// classifications (see careerRatingService's EXP mileage).
export async function withSprintClassifications(prisma, rounds) {
  const list = (rounds || []).filter((r) => r?.id);
  const roundOf = new Map(list.map((r) => [r.id, r.id]));
  const empty = { races: list, sprintIds: new Set(), roundOf };
  let parentOfChild;
  try {
    parentOfChild = await readSprintChildrenOf(prisma, list); // childId -> parent row
  } catch {
    return empty; // no parentRaceId column (fresh checkout): no sprints exist
  }
  if (!parentOfChild.size) return empty;

  const children = await prisma.race
    .findMany({ where: { id: { in: [...parentOfChild.keys()] } } })
    .catch(() => []);
  const races = [...list];
  const sprintIds = new Set();
  for (const child of children) {
    if (!child.isCompleted) continue;
    const parent = parentOfChild.get(child.id);
    if (!parent) continue;
    sprintIds.add(child.id);
    roundOf.set(child.id, parent.id);
    races.push({ ...child, number: parent.number, sprintOf: parent.id });
  }
  return { races, sprintIds, roundOf };
}

// Race rows as the ARCHIVE knows them. A sprint child carries no round number
// of its own, but its result file is filed under its event's number with the
// sprint flag (lib/cockpitArchive.js). So every reader that goes from a race
// row to a file (the reports, their anchors and contact lists) runs the rows
// through here first: a child comes back with its event's `number` and
// `sprint: true`, everything else with `sprint: false`. An event that has a
// sprint says so (`hasSprint`), so a label can call it the feature; and every
// row names the round it belongs to (`roundId`: the event's id, its own for
// anything else), so the two races of one evening count as one round. Rows
// carry at least `id` and `number`.
export async function withSprintRounds(prisma, races) {
  const rows = (races || []).filter(Boolean);
  const ids = rows.map((r) => r.id);
  const [parentOf, childOf] = await Promise.all([readParentIds(prisma, ids), readSprintChildren(prisma, ids)]);
  const known = new Map(rows.map((r) => [r.id, r.number]));
  const missing = [...new Set([...parentOf.values()])].filter((id) => !known.has(id));
  if (missing.length) {
    const parents = await prisma.race
      .findMany({ where: { id: { in: missing } }, select: { id: true, number: true } })
      .catch(() => []);
    for (const p of parents) known.set(p.id, p.number);
  }
  return rows.map((r) =>
    parentOf.has(r.id)
      ? { ...r, number: known.get(parentOf.get(r.id)) ?? null, sprint: true, hasSprint: false, roundId: parentOf.get(r.id) }
      : { ...r, sprint: false, hasSprint: childOf.has(r.id), roundId: r.id }
  );
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
      // "Not a round of its own": every round-counting read filters on this.
      // The sprint still scores — through the parent link, see the header.
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
