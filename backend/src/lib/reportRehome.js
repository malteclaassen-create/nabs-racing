// ---------------------------------------------------------------------------
// Which of a sprint weekend's two races an in-game report belongs to.
//
// A press of the button in the car arrives while the session is on air, and
// the ingest can only file it under the evening's event (the feature row):
// the two races of a sprint weekend are both RACE sessions on the same server
// on the same night, and the live board does not say which of the two it is
// looking at. So the sprint's presses land on the feature until the result
// files are in. Each file carries the session's clock (lib/raceContacts.js:
// its start, and the last lap crossed), and a press stamped inside the
// sprint's window is the sprint's. The commit calls this once either file of
// the weekend lands, and moves every in-game report to the race it was
// pressed in. Reports somebody filed by hand are left alone: they picked.
// ---------------------------------------------------------------------------
import { sessionWindowForRound } from "./raceContacts.js";

// A press just before the file's first lap (the formation lap, the grid) or
// just after its last one (the cool-down, the results screen) is still that
// race's. Wider than that and the two windows of one evening could overlap.
const PAD_S = 180;

const within = (win, t) => !!win && win.start != null && win.end != null && t >= win.start - PAD_S && t <= win.end + PAD_S;

// `season` is the season row, `parent` the event (feature) row with its round
// number, `child` the sprint row. Returns how many reports changed race.
export async function rehomeWeekendReports(prisma, { season, parent, child }) {
  if (!season || !parent?.id || !child?.id || parent.number == null) return 0;
  const feature = sessionWindowForRound(season, parent.number, false);
  const sprint = sessionWindowForRound(season, parent.number, true);
  if (!feature && !sprint) return 0;

  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", "raceId", "incidentAt" FROM "Report"
      WHERE "source" = 'INGAME' AND "incidentAt" IS NOT NULL AND "raceId" IN (?, ?)`,
    parent.id,
    child.id
  );
  let moved = 0;
  for (const r of rows) {
    const t = Math.round(new Date(r.incidentAt).getTime() / 1000);
    if (!Number.isFinite(t)) continue;
    // The sprint's window is asked first: with only the feature's file on
    // disk, a press after that race ended would otherwise be nobody's and
    // stay put, which is right; with both on disk the two do not overlap.
    const target = within(sprint, t) ? child.id : within(feature, t) ? parent.id : null;
    if (!target || target === r.raceId) continue;
    await prisma.$executeRawUnsafe(`UPDATE "Report" SET "raceId" = ? WHERE "id" = ?`, target, r.id);
    moved += 1;
  }
  return moved;
}
