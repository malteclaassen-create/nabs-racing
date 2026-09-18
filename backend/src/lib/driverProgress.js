// ---------------------------------------------------------------------------
// PROGRESS — the staff's judgement on a driver, beside the numbers.
//
// The activity tracker (lib/attendanceActivity.js) answers what HAPPENED: the
// rounds a driver raced, the rounds they answered, how long they have been
// quiet. That is evidence, and evidence is not a decision. Whether a reserve
// has earned a seat, whether a full-timer is about to lose one, whether
// somebody is still being looked at — none of that can be computed, because it
// is an opinion the league holds about a person.
//
// It was held in a spreadsheet: one row per driver, a "Progress" column, five
// labels. The trouble with the spreadsheet is not the labels, it is that the
// names and teams in it are a second copy of the roster that goes stale the
// moment somebody transfers. So the labels move here, onto the driver row, and
// sit next to the numbers that justify them — the roster stays the one the
// rest of the site already keeps.
//
// The five labels are the league's own, kept as they were written so nobody
// has to relearn what they mean. Nothing computes them and nothing reads them
// back into the standings: this column only ever says what a person decided.
//
// Per DRIVER ROW, which is per season — the judgement is about this season's
// seat, and last season's answer should not follow anybody into the next one.
// Like role / hideFromStandings / manual points, the column lives outside the
// generated Prisma client (ensureAppSchema, raw SQL — the running dev server
// holds the client lock on Windows), so every read and write goes through
// here. Mirrored by migration driver_progress for production.
// ---------------------------------------------------------------------------

// In the order they read as a story about a seat: holding one, at risk of
// losing one, earning one, being looked at, unsure. The order is what the
// dropdown and the sort use, so it lives here rather than in the browser.
export const PROGRESS_STATES = [
  { key: "FULL_TIME", label: "Full time" },
  { key: "POSSIBLY_RESERVE", label: "Possibly reserve" },
  { key: "DESERVING", label: "Deserving" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "TENTATIVE", label: "Tentative" },
];

export const PROGRESS_KEYS = PROGRESS_STATES.map((s) => s.key);

const LABELS = new Map(PROGRESS_STATES.map((s) => [s.key, s.label]));
export const progressLabel = (key) => LABELS.get(key) || null;

// What an admin may send. "" / null / undefined all mean "clear it" — nothing
// set is the normal state for a driver nobody has formed a view on yet, and it
// has to stay reachable from the dropdown. Anything else must be one of the
// five; an unknown string is refused rather than stored, so the column can
// never hold a label the page has no name for.
export function parseProgress(raw) {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  const key = String(raw).trim().toUpperCase();
  if (!PROGRESS_KEYS.includes(key)) {
    return { error: `Unknown progress "${raw}". Use one of: ${PROGRESS_KEYS.join(", ")}, or blank to clear it.` };
  }
  return { ok: true, value: key };
}

// Map driverId -> key for one season's drivers. Only rows that carry a value
// appear, so a league that has never touched this gets an empty map and every
// caller no-ops. Empty map when the column doesn't exist yet (a fresh checkout
// before ensureAppSchema has run).
export async function readDriverProgress(prisma, seasonId) {
  if (!seasonId) return new Map();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "progress" FROM "Driver" WHERE "seasonId" = ? AND "progress" IS NOT NULL`,
      seasonId
    );
    const out = new Map();
    for (const r of rows) {
      // A value the code no longer knows is dropped on the way out rather than
      // shown: a renamed label should read as "not set", not as a blank pill.
      if (PROGRESS_KEYS.includes(r.progress)) out.set(r.id, r.progress);
    }
    return out;
  } catch {
    return new Map();
  }
}

// Write one driver row's progress. `null` clears it.
export async function writeDriverProgress(prisma, driverId, key) {
  await prisma.$executeRawUnsafe(`UPDATE "Driver" SET "progress" = ? WHERE "id" = ?`, key || null, driverId);
}
