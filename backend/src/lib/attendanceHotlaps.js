// ---------------------------------------------------------------------------
// Whether the attendance page shows its hotlap column, per series.
//
// The sign-up page is built as two halves: the round and its entry list down
// the left, a lap of the circuit on the right. That is the right shape for a
// league that films its laps, and half a page of "No hotlap yet" for one that
// does not. So a series can switch the column off, and its sign-up then takes
// the full width instead of leaving a gap where a video was supposed to be.
//
// Per series rather than site-wide: one league can run a video channel while
// the other never films anything, and the videos themselves already belong to
// a race and therefore to one series.
//
// Stored as a list of the series that have it OFF, so the default (show it) is
// what an untouched installation and every new series get.
// ---------------------------------------------------------------------------

const KEY = "attendance_hotlaps_off";

async function readOff(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    const arr = row?.value ? JSON.parse(row.value) : null;
    return new Set(Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : []);
  } catch {
    return new Set();
  }
}

// True when this series' attendance page should draw the hotlap column.
export async function hotlapsShownFor(prisma, seriesSlug) {
  if (!seriesSlug) return true;
  return !(await readOff(prisma)).has(String(seriesSlug));
}

export async function setHotlapsShown(prisma, seriesSlug, shown) {
  const slug = String(seriesSlug || "");
  if (!slug) return true;
  const off = await readOff(prisma);
  if (shown) off.delete(slug);
  else off.add(slug);
  const value = JSON.stringify([...off]);
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return shown;
}
