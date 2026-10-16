// Per-race session format (qualifying minutes / race laps, and whether the day
// runs a sprint before the main race) for announcements and the site's
// upcoming-race panels. The columns live outside the generated Prisma client
// (added by ensureAppSchema, raw SQL), so reads go through here.

// Shape of the race day. SINGLE is what every round was before sprints existed,
// so it is also the fallback for a row that predates the column.
export const RACE_FORMATS = ["SINGLE", "SPRINT_FEATURE"];

// A stored points table (JSON array of non-negative integers for P1..Pn) as an
// array, or null when unset/unusable. Same reading as Season.pointsTable.
export function parseStoredPointsTable(raw) {
  if (!raw) return null;
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const nums = arr.map(Number);
    return nums.some((n) => !Number.isInteger(n) || n < 0) ? null : nums;
  } catch {
    return null;
  }
}

// Map raceId -> { qualiMinutes, qualiT2Minutes, qualiT1Minutes, raceLaps,
// raceFormat, sprintLaps, pointsTable } for the given ids (pointsTable = the round's own table as an array, or
// null for the season's). Returns an empty map when the columns don't exist
// yet (fresh checkout before ensureAppSchema).
export async function readRaceFormat(prisma, raceIds) {
  const ids = [...new Set(raceIds)].filter(Boolean);
  if (!ids.length) return new Map();
  try {
    const qs = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "qualiMinutes", "qualiT2Minutes", "qualiT1Minutes", "raceLaps", "raceFormat", "sprintLaps", "pointsTable" FROM "Race" WHERE "id" IN (${qs})`,
      ...ids
    );
    return new Map(
      rows.map((r) => [
        r.id,
        {
          qualiMinutes: r.qualiMinutes == null ? null : Number(r.qualiMinutes),
          qualiT2Minutes: r.qualiT2Minutes == null ? null : Number(r.qualiT2Minutes),
          qualiT1Minutes: r.qualiT1Minutes == null ? null : Number(r.qualiT1Minutes),
          raceLaps: r.raceLaps == null ? null : Number(r.raceLaps),
          raceFormat: RACE_FORMATS.includes(r.raceFormat) ? r.raceFormat : "SINGLE",
          sprintLaps: r.sprintLaps == null ? null : Number(r.sprintLaps),
          pointsTable: parseStoredPointsTable(r.pointsTable),
        },
      ])
    );
  } catch {
    return new Map();
  }
}

// Validate an admin-supplied points table for ONE round: an array of up to
// 40 whole numbers 0..1000 for P1..Pn, stored as JSON; null / "" / [] means
// back to the season's table. Same {ok,value}/{error} contract as below.
export function parseRacePointsTable(raw) {
  if (raw === undefined) return { ok: false };
  if (raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0)) return { ok: true, value: null };
  if (!Array.isArray(raw) || raw.length > 40) {
    return { error: "The round's points table must be a list of up to 40 point values" };
  }
  const nums = raw.map(Number);
  if (nums.some((v) => !Number.isInteger(v) || v < 0 || v > 1000)) {
    return { error: "The round's points table may only contain whole numbers from 0 to 1000" };
  }
  return { ok: true, value: JSON.stringify(nums) };
}

// Validate an admin-supplied format value: a positive whole number up to
// `max`, or null/"" to clear. Returns { ok, value } or { error }.
export function parseFormatNumber(raw, label, max) {
  if (raw === undefined) return { ok: false };
  if (raw === null || raw === "") return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    return { error: `${label} must be a whole number between 1 and ${max}` };
  }
  return { ok: true, value: n };
}

// Validate the race-day shape. Same {ok,value}/{error} contract as above; an
// empty value means "back to a single race" rather than "leave it alone",
// because that is the admin clearing the sprint off the event.
export function parseRaceFormat(raw) {
  if (raw === undefined) return { ok: false };
  if (raw === null || raw === "") return { ok: true, value: "SINGLE" };
  const v = String(raw).trim().toUpperCase();
  if (!RACE_FORMATS.includes(v)) {
    return { error: `Race format must be one of: ${RACE_FORMATS.join(", ")}` };
  }
  return { ok: true, value: v };
}

// The tier split of qualifying, validated together because one without the
// other means nothing: Tier 2 runs the first minutes of the session, Tier 1
// the rest. Takes the already-parsed {ok,value} pair of each half and returns
// { error }, {} (neither supplied: leave everything alone) or
// { qualiT2Minutes, qualiT1Minutes, qualiMinutes? } — the total is the sum
// whenever a split is set, so the plain "20 min qualifying" readers stay right.
export function combineQualiSplit(t2, t1) {
  if (!t2.ok && !t1.ok) return {};
  const a = t2.ok ? t2.value : null;
  const b = t1.ok ? t1.value : null;
  if ((a == null) !== (b == null)) {
    return { error: "Enter both tier qualifying times (Tier 2 first, Tier 1 last), or neither" };
  }
  if (a == null) return { qualiT2Minutes: null, qualiT1Minutes: null };
  if (a + b > 240) return { error: "Tier 2 and Tier 1 qualifying together may be at most 240 minutes" };
  return { qualiT2Minutes: a, qualiT1Minutes: b, qualiMinutes: a + b };
}

// Whether a race carries a complete tier split.
export function hasQualiSplit(format = {}) {
  return Boolean(format.qualiT2Minutes && format.qualiT1Minutes);
}

// The session line as it is announced, e.g.
// ["15 min qualifying", "20 lap feature race", "12 lap sprint"]. Only the parts
// that are actually set, except on a sprint weekend: there both races are named
// even without a distance, because "there is a sprint" is the announcement.
export function sessionLines(format = {}) {
  const out = [];
  if (hasQualiSplit(format)) {
    const total = format.qualiT2Minutes + format.qualiT1Minutes;
    out.push(`${total} min qualifying (T2 first ${format.qualiT2Minutes} min, T1 last ${format.qualiT1Minutes} min)`);
  } else if (format.qualiMinutes) {
    out.push(`${format.qualiMinutes} min qualifying`);
  }
  if (format.raceFormat === "SPRINT_FEATURE") {
    out.push(format.raceLaps ? `${format.raceLaps} lap feature race` : "feature race");
    out.push(format.sprintLaps ? `${format.sprintLaps} lap sprint` : "sprint race");
  } else if (format.raceLaps) {
    out.push(`${format.raceLaps} lap race`);
  }
  return out;
}
