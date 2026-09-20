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
