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

export const WAITLIST = "WAITLIST";

const joinedAt = (r) => new Date(r.updatedAt || 0).getTime() || 0;

// Everyone's answer for one race, one row per PERSON (lib/onePerPerson.js), so
// a member with two roster rows in the season fills one seat and not two.
async function answersFor(prisma, raceId) {
  const rows = await prisma.raceRsvp.findMany({
    where: { raceId },
    include: { driver: { select: { id: true, name: true, discordUserId: true } } },
  });
  const people = await getPersonGroups(prisma).catch(() => ({ byDriver: new Map() }));
  return { kept: collapseByPerson(rows, people.byDriver, byNewestAnswer).kept, byDriver: people.byDriver };
}

// A car on the Driver Market is still somebody's seat.
//
// Offering your seat files a DECLINED (routes/market.js), so the accepted count
// drops by one — but that seat is not going spare, it is being handed to a
// reserve. Counting open offers as taken is what keeps the two queues from
// handing out the same seat: the waiting list does not eat it, and when the
// reserve is picked the grid lands back on its number instead of one over.
function openOffers(prisma, raceId) {
  return prisma.seatOffer.count({ where: { raceId, status: "OPEN" } }).catch(() => 0);
}

// How the grid stands right now, from the caller's point of view.
// `free` is what decides whether Accept is still on the table; `mine` is the
// answer this driver already has, because somebody who is IN keeps their seat
// no matter how full the round is.
export async function seatsFor(prisma, race, driverId = null) {
  const capacity = race?.capacity || DEFAULT_GRID_SIZE;
  const [{ kept, byDriver }, reserved] = await Promise.all([
    answersFor(prisma, race.id),
    openOffers(prisma, race.id),
  ]);
  const accepted = kept.filter((r) => r.status === "ACCEPTED").length;
  // By person, not by row. A member with two roster rows in one season has one
  // answer between them (lib/onePerPerson.js), and it can be sitting on the
  // other row — matching the id alone would then say they have not answered
  // and refuse the seat they are already in.
  const me = driverId ? personKey(driverId, byDriver) : null;
  const mine = me ? kept.find((r) => personKey(r.driverId, byDriver) === me)?.status || null : null;
  return {
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
    const capacity = race.capacity || DEFAULT_GRID_SIZE;
    const [{ kept }, reserved] = await Promise.all([answersFor(prisma, race.id), openOffers(prisma, race.id)]);
    let accepted = kept.filter((r) => r.status === "ACCEPTED").length + reserved;
    if (accepted >= capacity) return [];
    const queue = kept.filter((r) => r.status === WAITLIST).sort((a, b) => joinedAt(a) - joinedAt(b));

    const promoted = [];
    for (const row of queue) {
      if (accepted >= capacity) break;
      await prisma.raceRsvp.update({ where: { id: row.id }, data: { status: "ACCEPTED" } });
      accepted += 1;
      promoted.push(row);
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
    const { kept } = await answersFor(prisma, raceId);
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
export async function overCapacity(prisma, race) {
  const capacity = race?.capacity || DEFAULT_GRID_SIZE;
  const [{ kept }, reserved] = await Promise.all([answersFor(prisma, race.id), openOffers(prisma, race.id)]);
  const accepted = kept.filter((r) => r.status === "ACCEPTED").sort((a, b) => joinedAt(b) - joinedAt(a));
  const over = accepted.length + reserved - capacity;
  return { capacity, accepted: accepted.length, reserved, over: Math.max(0, over), tail: accepted.slice(0, Math.max(0, over)) };
}
