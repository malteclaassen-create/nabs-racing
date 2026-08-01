// ---------------------------------------------------------------------------
// Off the attendance page entirely.
//
// A different question from open/closed (lib/attendanceGate.js): a CLOSED race
// is still ON the page, counting down to when it opens. HIDDEN means it isn't
// there at all — for the training session that went into the calendar early, or
// the round that turns out not to be happening. It keeps its date, its results
// and its place in the calendar; it just stops being something the grid is
// asked about, and stops sending sign-up reminders.
//
// Its own Setting key rather than a fourth gate state, so hiding a race and
// un-hiding it later doesn't quietly throw away whether it was open or closed.
//
// A module of its own, and deliberately dependency-free: attendanceGate.js
// reads attendanceOpensAt() out of notifications.js, and notifications.js needs
// this — putting it in either of those two would close the import loop.
// ---------------------------------------------------------------------------

const KEY = "attendance_hidden";

export async function readHiddenRaceIds(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    const arr = row?.value ? JSON.parse(row.value) : null;
    return new Set(Array.isArray(arr) ? arr.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export async function writeHiddenRace(prisma, raceId, hidden) {
  const set = await readHiddenRaceIds(prisma);
  if (hidden) set.add(raceId);
  else set.delete(raceId);
  const json = JSON.stringify([...set]);
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: json },
    update: { value: json },
  });
  return [...set];
}
