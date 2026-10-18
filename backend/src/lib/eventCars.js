// ---------------------------------------------------------------------------
// The car a driver brings to a special event: a race number and, if they made
// one, a link to their own livery.
//
// Only special events (Series.kind "event") ask for these. A championship has
// its teams and their liveries; a one-off like the NASCAR night is everyone in
// the same car, so the number is what tells the cars apart and the skin is the
// driver's own. The organiser collects the livery links to build the server's
// car pack, which is why there is a deadline and why only admins see the links.
//
// Two columns on RaceRsvp, the sign-up they belong to. Raw-SQL managed
// (ensureAppSchema) like the other late columns, and written with a plain
// UPDATE on purpose: RaceRsvp.updatedAt is the waiting list's queue position
// (lib/waitlist.js), and Prisma would bump it on every edit of a link.
// ---------------------------------------------------------------------------
import { raceKickoff } from "./raceKickoff.js";

export const CAR_NUMBER_MIN = 1;
export const CAR_NUMBER_MAX = 99;
const LIVERY_URL_MAX = 500;
// The links are due the day before the race, an hour before the race's own
// clock time: Thursday 17:30 UTC for a Friday 18:30 UTC start. That is when the
// organiser builds the car pack.
const LIVERY_DEADLINE_HOURS = 25;

// Answers that hold a car. A driver who declined has given theirs back, so
// their number is free for somebody else.
const HOLDS_A_CAR = ["ACCEPTED", "TENTATIVE", "WAITLIST"];

export function liveryDeadline(race) {
  const kickoff = raceKickoff(race?.date);
  return kickoff ? new Date(kickoff.getTime() - LIVERY_DEADLINE_HOURS * 3600e3) : null;
}

export function carLocked(race, now = Date.now()) {
  const d = liveryDeadline(race);
  return !!d && now >= d.getTime();
}

// { ok, value } for a race number from the form: a whole number 1..99, or null
// for "none" when `optional`.
export function parseCarNumber(v, { optional = false } = {}) {
  if (v === null || v === undefined || v === "") {
    return optional ? { ok: true, value: null } : { ok: false, error: "Pick a car number" };
  }
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < CAR_NUMBER_MIN || n > CAR_NUMBER_MAX) {
    return { ok: false, error: `Car numbers go from ${CAR_NUMBER_MIN} to ${CAR_NUMBER_MAX}` };
  }
  return { ok: true, value: n };
}

// { ok, value } for the livery link: empty = no custom livery (the default skin
// it is), otherwise an http(s) address. Anything else is refused rather than
// stored, since an admin opens these links.
export function parseLiveryUrl(v) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return { ok: true, value: null };
  if (s.length > LIVERY_URL_MAX) return { ok: false, error: "That link is too long" };
  let u;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "The livery link has to be a web address (https://...)" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, error: "The livery link has to be a web address (https://...)" };
  }
  return { ok: true, value: u.toString() };
}

// Is this race the race of a special event?
export async function isEventRace(prisma, raceId) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT s."kind" AS kind FROM "Race" r
         JOIN "Season" se ON se."id" = r."seasonId"
         JOIN "Series" s ON s."id" = se."seriesId"
        WHERE r."id" = ?`,
      raceId
    );
    return rows[0]?.kind === "event";
  } catch {
    return false;
  }
}

// Map driverId -> { carNumber, liveryUrl } for the sign-ups of the given races,
// keyed `${raceId}:${driverId}`. A missing column (before ensureAppSchema ran)
// reads as "nothing entered yet".
export async function readCars(prisma, raceIds) {
  const ids = [...new Set((raceIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  try {
    const ph = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "raceId", "driverId", "carNumber", "liveryUrl" FROM "RaceRsvp"
        WHERE "raceId" IN (${ph}) AND ("carNumber" IS NOT NULL OR "liveryUrl" IS NOT NULL)`,
      ...ids
    );
    for (const r of rows) {
      out.set(`${r.raceId}:${r.driverId}`, {
        carNumber: r.carNumber == null ? null : Number(r.carNumber),
        liveryUrl: r.liveryUrl || null,
      });
    }
  } catch {
    /* columns not there yet */
  }
  return out;
}

// Whoever else on this race already holds `number`, or null. The person's own
// other rows don't count (`exceptDriverIds`): a duplicate row of the same human
// is not a rival for the number.
export async function numberTakenBy(prisma, raceId, number, exceptDriverIds = []) {
  const except = exceptDriverIds.filter(Boolean);
  const notIn = except.length ? ` AND r."driverId" NOT IN (${except.map(() => "?").join(",")})` : "";
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r."driverId", d."name" FROM "RaceRsvp" r JOIN "Driver" d ON d."id" = r."driverId"
      WHERE r."raceId" = ? AND r."carNumber" = ?
        AND r."status" IN (${HOLDS_A_CAR.map(() => "?").join(",")})${notIn}
      LIMIT 1`,
    raceId,
    number,
    ...HOLDS_A_CAR,
    ...except
  );
  return rows[0] || null;
}

// Write the car onto an existing sign-up. `fields` holds only what changes.
export async function writeCar(prisma, raceId, driverId, fields) {
  const sets = [];
  const vals = [];
  if ("carNumber" in fields) {
    sets.push(`"carNumber" = ?`);
    vals.push(fields.carNumber);
  }
  if ("liveryUrl" in fields) {
    sets.push(`"liveryUrl" = ?`);
    vals.push(fields.liveryUrl);
  }
  if (!sets.length) return;
  await prisma.$executeRawUnsafe(
    `UPDATE "RaceRsvp" SET ${sets.join(", ")} WHERE "raceId" = ? AND "driverId" = ?`,
    ...vals,
    raceId,
    driverId
  );
}
