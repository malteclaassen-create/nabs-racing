// ---------------------------------------------------------------------------
// Once, when the "reserves get in through the Driver Market" rule arrives
// (lib/reserveRules.js): take off the sign-ups reserves had already made.
//
// Until that rule a reserve pressed Accept like anybody else and sat on the
// grid of the coming round. The rule refuses that from now on, but it does not
// look back, so those answers would stay: a reserve without a car on a grid
// they can no longer sign up for, next to reserves who are told to go through
// the market. The league's call (2026-11-27) was to take them off.
//
// What goes: a reserve's accepted, tentative or waiting-list answer for a
// championship round that has not started, in a season that runs Division 2.
// What stays: a decline, the answer of a reserve who holds a seat for that race
// (they were given a car, that IS their place), every driver with a seat of
// their own, and anything about a round that has started or a special event.
//
// Each of them gets a note saying so, because somebody who signed up last week
// otherwise turns up on Friday thinking they are in. The waiting list moves up
// into what came free, and the race posts on Discord are refreshed.
//
// Flag-guarded (Setting), so it runs on the first boot with this code and never
// again: a reserve an admin puts on a grid by hand afterwards is the admin's
// decision and stays.
// ---------------------------------------------------------------------------
import { getPersonGroups, discordIdsForDrivers } from "./persons.js";
import { personKey } from "./onePerPerson.js";
import { promoteFromWaitlist } from "./waitlist.js";
import { notifyReserveSignupRemoved } from "./notifications.js";
import { syncRaceToDiscord } from "../services/discordService.js";

const MARKER = "reserve_signups_cleared";

// The pure half. `rsvps` are one race's answers with their driver and team,
// `seated` the ids of the reserves holding a filled seat for it, `withSeat` the
// person keys of everybody who has a seat of their own in the season (one
// person can have a reserve row and a team row; they are a driver with a seat).
export function reserveSignupsToClear({ rsvps, seated, withSeat, byDriver }) {
  return (rsvps || []).filter((r) => {
    if (r.status === "DECLINED") return false;
    if ((r.driver?.team?.tier ?? r.driver?.tier) !== 0) return false;
    if (seated.has(r.driverId)) return false;
    return !withSeat.has(personKey(r.driverId, byDriver));
  });
}

export async function clearReserveSignups(prisma, { now = new Date() } = {}) {
  const seasons = (await prisma.$queryRawUnsafe(`SELECT "id" FROM "Season" WHERE "division2" = 1`)).map((s) => s.id);
  if (!seasons.length) return [];
  const races = await prisma.race.findMany({
    where: {
      seasonId: { in: seasons },
      isCompleted: false,
      isSpecialEvent: false,
      // Not a round that is on track or over and waiting for its result.
      OR: [{ date: null }, { date: { gt: now } }],
    },
  });
  if (!races.length) return [];
  const { byDriver } = await getPersonGroups(prisma).catch(() => ({ byDriver: new Map() }));
  const removed = [];
  for (const race of races) {
    try {
      const [rsvps, filled, roster] = await Promise.all([
        prisma.raceRsvp.findMany({ where: { raceId: race.id }, include: { driver: { include: { team: true } } } }),
        prisma.seatOffer.findMany({
          where: { raceId: race.id, status: "FILLED", filledById: { not: null } },
          select: { filledById: true },
        }),
        prisma.driver.findMany({
          where: { seasonId: race.seasonId, team: { tier: { not: 0 } } },
          select: { id: true },
        }),
      ]);
      const gone = reserveSignupsToClear({
        rsvps,
        seated: new Set(filled.map((o) => o.filledById)),
        withSeat: new Set(roster.map((d) => personKey(d.id, byDriver))),
        byDriver,
      });
      if (!gone.length) continue;
      await prisma.raceRsvp.deleteMany({ where: { id: { in: gone.map((r) => r.id) } } });
      const discordIds = await discordIdsForDrivers(prisma, gone.map((r) => r.driverId)).catch(() => new Map());
      for (const r of gone) {
        removed.push({ raceId: race.id, driverId: r.driverId, name: r.driver?.name || null, status: r.status });
        await notifyReserveSignupRemoved(prisma, { race, driverId: r.driverId, recipientId: discordIds.get(r.driverId) || null });
      }
      // Seats came free: the front of the queue moves up (lib/waitlist.js).
      await promoteFromWaitlist(prisma, race.id);
      await syncRaceToDiscord(prisma, race.id).catch(() => {});
    } catch (e) {
      console.error(`[reserves] sign-ups of race ${race.id} not cleared:`, e?.message || e);
    }
  }
  return removed;
}

export async function clearReserveSignupsOnce(prisma) {
  try {
    if (await prisma.setting.findUnique({ where: { key: MARKER } })) return null;
    const removed = await clearReserveSignups(prisma);
    // What was taken off stays on record, in case one has to be put back.
    const value = JSON.stringify({ at: new Date().toISOString(), removed });
    await prisma.setting.upsert({ where: { key: MARKER }, create: { key: MARKER, value }, update: { value } });
    console.log(
      `[reserves] sign-ups taken off: ${removed.length} answer(s) of reserves on ${new Set(removed.map((r) => r.raceId)).size} coming round(s)`
    );
    return removed;
  } catch (e) {
    console.error("[reserves] clearing sign-ups failed:", e?.message || e);
    return null;
  }
}
