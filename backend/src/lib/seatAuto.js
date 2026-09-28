// ---------------------------------------------------------------------------
// A full-time driver's sign-up answer and their seat in the Driver Market,
// kept in step.
//
// Declining used to be one thing and offering the seat another: a driver said
// "no" on the sign-up card and the car then sat empty until they also went to
// the market and offered it, which most of them never did. The league asked
// for the two to be one step (Steve, 2026-09-28): a full-time driver who
// declines has their seat put up in the Driver Market straight away. Put up,
// not handed over. Who gets it is still picked the way it always was, by the
// driver or by an admin, from the reserves who raise their hand.
//
// And the way back: a driver who declined, saw their seat put up, and then
// says yes after all gets their seat back. If a reserve had already been
// picked for it, that reserve loses the car (it was never theirs to keep once
// its owner can drive) and is put down as interested in every other seat still
// open for that race, so they are first in line for the next one without having
// to find out and ask again.
// ---------------------------------------------------------------------------
import { notifySeatOffered, notifySeatReclaimed } from "./notifications.js";

// Same rule the market itself uses: only a Tier 1/2 seat is a seat to offer.
const hasRealSeat = (team) => team?.tier === 1 || team?.tier === 2;

// The seat a driver has on the market for one race, if any.
export function standingOffer(prisma, raceId, driverId) {
  return prisma.seatOffer.findFirst({
    where: { raceId, driverId, status: { not: "CANCELLED" } },
  });
}

// The driver just declined: put their seat up. Nothing happens for a reserve,
// a special event, a finished race, or a seat that is already up.
export async function offerSeatOnDecline(prisma, race, driver) {
  if (!race?.id || !driver?.id || race.isCompleted || race.isSpecialEvent) return null;
  const team = driver.team || (driver.teamId ? await prisma.team.findUnique({ where: { id: driver.teamId } }) : null);
  if (!hasRealSeat(team)) return null;
  if (await standingOffer(prisma, race.id, driver.id)) return null;
  const offer = await prisma.seatOffer.upsert({
    where: { raceId_driverId: { raceId: race.id, driverId: driver.id } },
    // A cancelled offer from before starts fresh, pick and all.
    update: { status: "OPEN", filledById: null },
    create: { raceId: race.id, driverId: driver.id, teamId: driver.teamId, status: "OPEN" },
  });
  // The same bell a hand-made offer rings for the reserves.
  notifySeatOffered(prisma, { race, teamName: team?.name, driver });
  return offer;
}

// The driver said yes after declining: the seat comes off the market and is
// theirs again. Returns what happened, for the caller and the tests.
export async function reclaimSeat(prisma, race, driverId) {
  const offer = await standingOffer(prisma, race.id, driverId);
  if (!offer) return { reclaimed: false, bumped: null, movedTo: 0 };

  const bumpedId = offer.filledById || null;
  // Interests cascade with the offer.
  await prisma.seatOffer.delete({ where: { id: offer.id } });
  if (!bumpedId) return { reclaimed: true, bumped: null, movedTo: 0 };

  // The reserve had been put down as driving it; they are not any more. Back
  // to no answer rather than DECLINED, so they can still take another car.
  await prisma.raceRsvp.deleteMany({ where: { raceId: race.id, driverId: bumpedId, status: "ACCEPTED" } });

  // First in line for every other seat still open: interest, not a seat.
  // Whoever offered that one still picks.
  const open = await prisma.seatOffer.findMany({
    where: { raceId: race.id, status: "OPEN", driverId: { not: bumpedId } },
    select: { id: true },
  });
  for (const o of open) {
    await prisma.seatInterest
      .upsert({
        where: { offerId_driverId: { offerId: o.id, driverId: bumpedId } },
        update: {},
        create: { offerId: o.id, driverId: bumpedId },
      })
      .catch(() => {});
  }

  const reserve = await prisma.driver.findUnique({ where: { id: bumpedId } });
  notifySeatReclaimed(prisma, { race, reserve, openSeats: open.length });
  return { reclaimed: true, bumped: bumpedId, movedTo: open.length };
}
