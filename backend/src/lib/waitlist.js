// ---------------------------------------------------------------------------
// The waiting list.
//
// A round's grid size (Race.capacity, "43/42 seats taken" on the sign-up card)
// used to be a label and nothing else: the server never looked at it, so a 43rd
// driver could accept a seat that does not exist and the admin found out while
// building the grid. The number is now the rule. Accept is refused once the
// grid is full, and the answer on offer instead is WAITLIST: a queue, in the
// order people joined it.
//
// Nobody is ever pushed out. A round that is already over its capacity when
// this arrives keeps everyone who accepted; the cap only applies to the next
// person through the door, and the queue starts moving once the count drops
// back under the line.
//
// Queue order is the answer's own timestamp (RaceRsvp.updatedAt). The sign-up
// route leaves it alone when the answer has not actually changed, so pressing
// the button twice does not send anybody to the back.
// ---------------------------------------------------------------------------

import { getPersonGroups } from "./persons.js";
import { collapseByPerson, byNewestAnswer, personKey } from "./onePerPerson.js";
import { DEFAULT_GRID_SIZE } from "./gridSize.js";
import { notifyWaitlistPromoted } from "./notifications.js";
import { activeDivision2Drivers as readDivision2Drivers, readCapacity2, filledDivision2Seats } from "./divisions.js";

export const WAITLIST = "WAITLIST";

const joinedAt = (r) => new Date(r.updatedAt || 0).getTime() || 0;

// Everyone's answer for one race, one row per PERSON (lib/onePerPerson.js), so
// a member with two roster rows in the season fills one seat and not two.
//
// DIVISIONS. A season running Division 2 (lib/divisions.js) has two grids on
// the same evening, one per server, each with its own size and its own queue.
// `division` keeps only that grid's people; omitted, everybody (which is the
// same thing for a season without Division 2).
async function answersFor(prisma, raceId, division = null) {
  const rows = await prisma.raceRsvp.findMany({
    where: { raceId },
    include: { driver: { select: { id: true, name: true, discordUserId: true, seasonId: true } } },
  });
  const people = await getPersonGroups(prisma).catch(() => ({ byDriver: new Map() }));
  let kept = collapseByPerson(rows, people.byDriver, byNewestAnswer).kept;
  if (division != null) {
    const seasonId = rows[0]?.driver?.seasonId;
    const div2 = seasonId ? await readDivision2Drivers(prisma, seasonId) : new Set();
    // A reserve who took over a Division 2 seat tonight races on its grid.
    if (div2.size) for (const id of await filledDivision2Seats(prisma, raceId)) div2.add(id);
    kept = kept.filter((r) => (div2.has(r.driverId) ? 2 : 1) === division);
  }
  return { kept, byDriver: people.byDriver };
}

// Which grid a driver lines up on for this race: 1 or 2.
export async function divisionForDriver(prisma, race, driverId) {
  if (!driverId || !race?.seasonId) return 1;
  const div2 = await readDivision2Drivers(prisma, race.seasonId);
  if (div2.has(driverId)) return 2;
  // One Reserve pool: a reserve is on Division 2's grid only for a race where
  // they took over a Division 2 seat.
  return div2.size && (await filledDivision2Seats(prisma, race.id)).has(driverId) ? 2 : 1;
}

// The size of one grid: Division 1 is the round's capacity, Division 2 its
// capacity2, falling back to the round's when unset.
export async function capacityFor(prisma, race, division = 1) {
  const base = race?.capacity || DEFAULT_GRID_SIZE;
  if (division !== 2) return base;
  const own = (await readCapacity2(prisma, [race.id])).get(race.id);
  return own || base;
}

// A car on the Driver Market is still somebody's seat.
//
// Offering your seat files a DECLINED (routes/market.js), so the accepted count
// drops by one — but that seat is not going spare, it is being handed to a
// reserve. Counting open offers as taken is what keeps the two queues from
// handing out the same seat: the waiting list does not eat it, and when the
// reserve is picked the grid lands back on its number instead of one over.
async function openOffers(prisma, raceId, division = null) {
  if (division == null) return prisma.seatOffer.count({ where: { raceId, status: "OPEN" } }).catch(() => 0);
  let offers = [];
  try {
    offers = await prisma.seatOffer.findMany({
      where: { raceId, status: "OPEN" },
      select: { driverId: true, driver: { select: { seasonId: true } } },
    });
  } catch {
    return prisma.seatOffer.count({ where: { raceId, status: "OPEN" } }).catch(() => 0);
  }
  if (!offers.length) return 0;
  const div2 = await readDivision2Drivers(prisma, offers[0].driver?.seasonId);
  return offers.filter((o) => (div2.has(o.driverId) ? 2 : 1) === division).length;
}

// How the grid stands right now, from the caller's point of view.
// `free` is what decides whether Accept is still on the table; `mine` is the
// answer this driver already has, because somebody who is IN keeps their seat
// no matter how full the round is.
//
// With Division 2 running, the grid is the driver's own division's (with no
// driver given: Division 1's).
export async function seatsFor(prisma, race, driverId = null, { division: asked = null } = {}) {
  const division = asked ?? (await divisionForDriver(prisma, race, driverId));
  const capacity = await capacityFor(prisma, race, division);
  const [{ kept, byDriver }, reserved] = await Promise.all([
    answersFor(prisma, race.id, division),
    openOffers(prisma, race.id, division),
  ]);
  const accepted = kept.filter((r) => r.status === "ACCEPTED").length;
  // By person, not by row. A member with two roster rows in one season has one
  // answer between them (lib/onePerPerson.js), and it can be sitting on the
  // other row — matching the id alone would then say they have not answered
  // and refuse the seat they are already in.
  const me = driverId ? personKey(driverId, byDriver) : null;
  const mine = me ? kept.find((r) => personKey(r.driverId, byDriver) === me)?.status || null : null;
  return {
    division,
    capacity,
    accepted,
    reserved,
    waiting: kept.filter((r) => r.status === WAITLIST).length,
    free: accepted + reserved < capacity,
    mine,
  };
}

// A seat came free (somebody declined, cleared their answer, offered their car
// in the Driver Market, or an admin raised the grid size): move the front of
// the queue onto the grid, as many as now fit, and tell them.
//
// Best-effort and never throws: this runs behind the request that freed the
// seat, and that request must not fail because the queue could not be worked.
export async function promoteFromWaitlist(prisma, raceId) {
  try {
    const race = await prisma.race.findUnique({ where: { id: raceId } });
    if (!race || race.isCompleted) return [];
    // Each division's queue moves onto its own grid only.
    const promoted = [];
    for (const division of [1, 2]) {
      const capacity = await capacityFor(prisma, race, division);
      const [{ kept }, reserved] = await Promise.all([
        answersFor(prisma, race.id, division),
        openOffers(prisma, race.id, division),
      ]);
      let accepted = kept.filter((r) => r.status === "ACCEPTED").length + reserved;
      if (accepted >= capacity) continue;
      const queue = kept.filter((r) => r.status === WAITLIST).sort((a, b) => joinedAt(a) - joinedAt(b));
      for (const row of queue) {
        if (accepted >= capacity) break;
        await prisma.raceRsvp.update({ where: { id: row.id }, data: { status: "ACCEPTED" } });
        accepted += 1;
        promoted.push(row);
      }
    }
    for (const row of promoted) {
      await notifyWaitlistPromoted(prisma, { race, driver: row.driver });
    }
    return promoted;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// The admin's hand on the wheel (Admin -> Attendance -> "Grid & waiting list").
//
// Everything above runs by itself. What follows only ever happens because an
// admin pressed something, and it breaks two of the rules above on purpose:
//
// The grid size does not apply. An admin who puts a 43rd car on the grid has
// decided to, and the panel says so rather than refusing.
//
// And nothing is promoted automatically behind an admin's back. Freeing a seat
// as a member does hands it to the front of the queue; freeing one from here
// leaves it open, because the point is usually to give that seat to somebody
// specific in the next click — and for the trim below, auto-promotion would
// simply undo the thing that was asked for.
// ---------------------------------------------------------------------------

// Where somebody sits in the queue: 1 is next onto the grid, null is "not in
// it". Only for the message that tells them — "you are on the waiting list"
// without a number is the start of a Discord conversation, not the end of one.
export async function queuePlace(prisma, raceId, driverId) {
  try {
    const race = await prisma.race.findUnique({ where: { id: raceId } });
    const { kept } = await answersFor(prisma, raceId, await divisionForDriver(prisma, race, driverId));
    const queue = kept.filter((r) => r.status === WAITLIST).sort((a, b) => joinedAt(a) - joinedAt(b));
    const i = queue.findIndex((r) => r.driverId === driverId);
    return i < 0 ? null : i + 1;
  } catch {
    return null;
  }
}

// Grid -> queue, WITHOUT sending them to the back of it.
//
// RaceRsvp.updatedAt is the queue position, and an accepted driver's timestamp
// is when they took the seat — which on a round that filled up is before
// anybody who is now waiting. Writing it back untouched is what puts the 43rd
// accepted driver at the FRONT of the queue instead of behind the people who
// only ever joined it, which is the whole difference between "you lost your
// seat" and "you lost your seat and your place in line".
//
// Prisma honours an explicit value for an @updatedAt field, so this is the
// write it looks like rather than a raw statement.
export async function moveToWaitlist(prisma, raceId, driverId) {
  const row = await prisma.raceRsvp.findUnique({
    where: { raceId_driverId: { raceId, driverId } },
    include: { driver: { select: { id: true, name: true, discordUserId: true } } },
  });
  if (!row) return null;
  if (row.status === WAITLIST) return row;
  await prisma.raceRsvp.update({
    where: { id: row.id },
    data: { status: WAITLIST, updatedAt: row.updatedAt },
  });
  return row;
}

// Who is over the line, newest answer first: the last people in are the ones
// who made the grid too big, and they are the ones this offers to move.
//
// Counted the same way everything else here counts, open Driver Market offers
// included, so the panel's "43 of 42" and the button's "move 1" never disagree
// with the rule that refuses the 43rd Accept in the first place.
export async function overCapacity(prisma, race, division = 1) {
  const capacity = await capacityFor(prisma, race, division);
  const [{ kept }, reserved] = await Promise.all([answersFor(prisma, race.id, division), openOffers(prisma, race.id, division)]);
  const accepted = kept.filter((r) => r.status === "ACCEPTED").sort((a, b) => joinedAt(b) - joinedAt(a));
  const over = accepted.length + reserved - capacity;
  return { capacity, accepted: accepted.length, reserved, over: Math.max(0, over), tail: accepted.slice(0, Math.max(0, over)) };
}
