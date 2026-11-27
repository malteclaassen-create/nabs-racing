// ---------------------------------------------------------------------------
// Once: the seats of Division 2 drivers who had already said no are put on the
// Driver Market.
//
// A Division 2 driver's no puts their seat up since reserves get into a race
// through the market only (lib/seatAuto.js, lib/reserveRules.js). That happens
// at the moment of declining, so it missed everybody who declined before the
// rule arrived: on the first race night with it, five of Division 2 were out
// and not one Division 2 seat was on the market, which is the only way in for
// a reserve and the only seats a new driver may take.
//
// So, once: for every championship round that has not started, in a season
// that runs Division 2, a Division 2 driver who is down as declined and has no
// offer for that round gets one, exactly as declining now makes it (same row,
// same bell for the reserves).
//
// Division 2 only. A Tier 1 or Tier 2 driver's decline has put the seat up for
// a long time, so one who is declined WITHOUT an offer took it back on purpose.
// And a driver with any offer row for the round is left alone, a cancelled one
// included: an admin took that back.
//
// Flag-guarded (Setting), so it runs on the first boot with this code only.
// ---------------------------------------------------------------------------
import { offerSeatOnDecline } from "./seatAuto.js";
import { DIV2_TIER } from "./divisions.js";

const MARKER = "division2_declines_offered";

export async function offerDeclinedDivision2Seats(prisma, { now = new Date() } = {}) {
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
  const offered = [];
  for (const race of races) {
    try {
      const [declined, offers] = await Promise.all([
        prisma.raceRsvp.findMany({
          where: { raceId: race.id, status: "DECLINED" },
          include: { driver: { include: { team: true } } },
        }),
        prisma.seatOffer.findMany({ where: { raceId: race.id }, select: { driverId: true } }),
      ]);
      const has = new Set(offers.map((o) => o.driverId));
      for (const r of declined) {
        if (r.driver?.team?.tier !== DIV2_TIER || has.has(r.driverId)) continue;
        const offer = await offerSeatOnDecline(prisma, race, r.driver);
        if (offer) offered.push({ raceId: race.id, driverId: r.driverId, name: r.driver.name });
      }
    } catch (e) {
      console.error(`[division 2] declined seats of race ${race.id} not put up:`, e?.message || e);
    }
  }
  return offered;
}

export async function offerDeclinedDivision2SeatsOnce(prisma) {
  try {
    if (await prisma.setting.findUnique({ where: { key: MARKER } })) return null;
    const offered = await offerDeclinedDivision2Seats(prisma);
    const value = JSON.stringify({ at: new Date().toISOString(), offered });
    await prisma.setting.upsert({ where: { key: MARKER }, create: { key: MARKER, value }, update: { value } });
    console.log(`[division 2] seats of drivers who had declined put on the Driver Market: ${offered.length}`);
    return offered;
  } catch (e) {
    console.error("[division 2] putting declined seats up failed:", e?.message || e);
    return null;
  }
}
