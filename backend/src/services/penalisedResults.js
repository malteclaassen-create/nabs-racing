// ---------------------------------------------------------------------------
// A driver's result rows with their CLASSIFIED position.
//
// RaceResult.position is the raw finishing order of the file; time penalties
// (and the slots non-finishers release) only move a car when the round is
// classified through applyPenalties. The standings do that on every read, so
// their points are right. Anything that shows a per-race position straight
// off the row (driver profile, stats) has to run the same pass, otherwise a
// car promoted by a penalty keeps its old place while its points say otherwise.
//
// Takes the rows already loaded (any select, as long as raceId and driverId are
// there), loads the FULL field of every race they belong to, classifies each
// race, and hands the same rows back with position/points from the
// classification. Rows the classification does not cover (DNF, DNS, DSQ)
// come back untouched.
// ---------------------------------------------------------------------------
import { applyPenalties } from "./pointsCalculator.js";

export async function withClassifiedPositions(prisma, results) {
  if (!results?.length) return results;
  const raceIds = [...new Set(results.map((r) => r.raceId).filter(Boolean))];
  if (!raceIds.length) return results;
  const field = await prisma.raceResult.findMany({ where: { raceId: { in: raceIds } } });
  const byRace = new Map();
  for (const r of field) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId).push(r);
  }
  const classified = new Map();
  for (const [raceId, rs] of byRace) {
    for (const a of applyPenalties(rs)) classified.set(`${raceId}:${a.driverId}`, a);
  }
  return results.map((r) => {
    const a = classified.get(`${r.raceId}:${r.driverId}`);
    if (!a || a.position === r.position) return r;
    return { ...r, position: a.position, points: a.points };
  });
}
