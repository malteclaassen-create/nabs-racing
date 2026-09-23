// ---------------------------------------------------------------------------
// Merging two rows of the same driver in one season.
//
// How a season ends up with two: the admin brings last season's field over
// (one row, linked to the person), the driver then logs in and the sign-up or
// a hand-made entry gives them a second row, and the race imports match some
// rounds to one and some to the other. Neither row can be deleted then — both
// have results, and deleting either would take a career with it.
//
// So instead of deleting, the admin picks the row that STAYS (usually the one
// the driver has been looking after: photo, bio, links, the login) and this
// moves everything the other row holds onto it, then removes the empty shell:
//
//   * race results, attendance answers, driver-market offers and interests,
//     recorded transfers, driver-of-the-day picks, incident reports;
//   * the Discord login and the Steam id, where the kept row has none;
//   * every profile field the kept row left empty (photo, card, bio, number,
//     socials, flag, role, manual points);
//   * the person link, so the career across seasons stays one person.
//
// Results keep their team stamps, so no constructor total moves. The one
// thing that cannot be merged is two results in the SAME race, so the plan
// refuses with the rounds named and the admin sorts those out by hand first.
//
// planMerge is the dry run the confirm dialog reads out; mergeDrivers runs the
// same plan for real, inside one transaction.
// ---------------------------------------------------------------------------
import { dbLinkDrivers, dbUnlinkDriver, discordIdsForDrivers } from "../lib/persons.js";
import { dbGetMember } from "../lib/members.js";

// Profile fields carried over when the kept row's own value is empty.
const PROFILE_FIELDS = [
  "photoUrl", "discordAvatar", "cardPhotoUrl", "cardPhotoPos", "cardStyle", "cardAnim",
  "country", "bio", "number", "socials", "profileTiles", "role", "pointsAdjust", "pointsOverride",
];

function empty(v) {
  return v === null || v === undefined || v === "";
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// What one row holds — the facts the dialog shows side by side.
async function facts(prisma, driver, roundOfRace) {
  const [results, rsvps, offers, interests, filled, transfers, dotd, reports] = await Promise.all([
    prisma.raceResult.findMany({ where: { driverId: driver.id }, select: { raceId: true } }),
    prisma.raceRsvp.count({ where: { driverId: driver.id } }),
    prisma.seatOffer.count({ where: { driverId: driver.id } }),
    prisma.seatInterest.count({ where: { driverId: driver.id } }),
    prisma.seatOffer.count({ where: { filledById: driver.id } }),
    prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "DriverTeamChange" WHERE "driverId" = ?`, driver.id).catch(() => [{ n: 0 }]),
    prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "Race" WHERE "driverOfTheDayId" = ?`, driver.id).catch(() => [{ n: 0 }]),
    prisma.report.count({ where: { accusedDriverId: driver.id } }).catch(() => 0),
  ]);
  let socials = [];
  try {
    socials = Object.keys(JSON.parse(driver.socials || "{}")).filter(Boolean);
  } catch {
    socials = [];
  }
  return {
    id: driver.id,
    name: driver.name,
    team: driver.team ? { id: driver.team.id, name: driver.team.name, tier: driver.team.tier, color: driver.team.color } : null,
    isActive: driver.isActive,
    rounds: results.map((r) => roundOfRace.get(r.raceId)).filter((n) => n != null).sort((a, b) => a - b),
    results: results.length,
    rsvps,
    marketEntries: offers + interests + filled,
    transfers: Number(transfers[0]?.n || 0),
    driverOfTheDay: Number(dotd[0]?.n || 0),
    reports,
    discordUserId: driver.discordUserId || null,
    steamId: driver.steamId || null,
    photo: !!driver.photoUrl || !!driver.cardPhotoUrl,
    bio: !empty(driver.bio),
    number: driver.number ?? null,
    socials,
    country: driver.country || null,
  };
}

async function load(prisma, keepId, dropId) {
  if (!keepId || !dropId) throw fail(400, "Pick the row to keep and the row to fold into it");
  if (keepId === dropId) throw fail(400, "That is the same row twice");
  const [keep, drop] = await Promise.all(
    [keepId, dropId].map((id) =>
      prisma.driver.findUnique({ where: { id }, include: { team: { select: { id: true, name: true, tier: true, color: true } } } })
    )
  );
  if (!keep) throw fail(404, "The row to keep was not found");
  if (!drop) throw fail(404, "The row to fold in was not found");
  if (keep.seasonId !== drop.seasonId) throw fail(400, "Both rows have to be in the same season. Rows of different seasons are linked as one person on the Members tab instead.");
  return { keep, drop };
}

// Everything the merge would do, without doing it.
export async function planMerge(prisma, { keepId, dropId }) {
  const { keep, drop } = await load(prisma, keepId, dropId);
  const races = await prisma.race.findMany({ where: { seasonId: keep.seasonId }, select: { id: true, number: true, track: true } });
  const roundOfRace = new Map(races.map((r) => [r.id, r.number]));
  const trackOf = new Map(races.map((r) => [r.id, r.track]));

  const [k, d] = await Promise.all([facts(prisma, keep, roundOfRace), facts(prisma, drop, roundOfRace)]);

  // The one thing that cannot be merged: a result for both rows in one race.
  const keepRaces = new Set((await prisma.raceResult.findMany({ where: { driverId: keep.id }, select: { raceId: true } })).map((r) => r.raceId));
  const clashes = (await prisma.raceResult.findMany({ where: { driverId: drop.id }, select: { raceId: true } }))
    .filter((r) => keepRaces.has(r.raceId))
    .map((r) => ({ raceId: r.raceId, round: roundOfRace.get(r.raceId) ?? null, track: trackOf.get(r.raceId) || "" }));

  // Answers and entries both rows gave for the same race: the kept row's stay,
  // the other row's are dropped rather than doubled.
  const keepRsvpRaces = new Set((await prisma.raceRsvp.findMany({ where: { driverId: keep.id }, select: { raceId: true } })).map((r) => r.raceId));
  const dropRsvps = await prisma.raceRsvp.findMany({ where: { driverId: drop.id }, select: { raceId: true } });
  const rsvpsDropped = dropRsvps.filter((r) => keepRsvpRaces.has(r.raceId)).length;

  const profile = PROFILE_FIELDS.filter((f) => empty(keep[f]) && !empty(drop[f]));
  const [handles, inherited] = await Promise.all([
    Promise.all([keep, drop].map((x) => (x.discordUserId ? dbGetMember(prisma, x.discordUserId).catch(() => null) : null))),
    discordIdsForDrivers(prisma, [keep.id, drop.id]).catch(() => new Map()),
  ]);
  k.discordHandle = handles[0]?.username || handles[0]?.displayName || null;
  d.discordHandle = handles[1]?.username || handles[1]?.displayName || null;
  k.inheritedDiscordUserId = !keep.discordUserId ? inherited.get(keep.id) || null : null;
  d.inheritedDiscordUserId = !drop.discordUserId ? inherited.get(drop.id) || null : null;

  return {
    keep: k,
    drop: d,
    clashes,
    moves: {
      results: d.results,
      rsvps: d.rsvps - rsvpsDropped,
      rsvpsDropped,
      marketEntries: d.marketEntries,
      transfers: d.transfers,
      driverOfTheDay: d.driverOfTheDay,
      reports: d.reports,
      discord: !keep.discordUserId && !!drop.discordUserId,
      steam: !keep.steamId && !!drop.steamId,
      profile,
    },
    ok: clashes.length === 0,
  };
}

// Run the plan. Throws 409 when the plan is not clean.
export async function mergeDrivers(prisma, { keepId, dropId }) {
  const plan = await planMerge(prisma, { keepId, dropId });
  if (!plan.ok) {
    throw fail(
      409,
      `Both rows have a result in ${plan.clashes.map((c) => `R${c.round ?? "?"} ${c.track}`).join(", ")}. ` +
        "Fix those rounds in Edit Results first (one of the two has to go), then merge."
    );
  }
  const { keep, drop } = await load(prisma, keepId, dropId);

  await prisma.$transaction(async (tx) => {
    // Results: no clash by now, so a plain re-point.
    await tx.raceResult.updateMany({ where: { driverId: drop.id }, data: { driverId: keep.id } });

    // Attendance answers: the kept row's answer wins where both answered.
    const keepRsvpRaces = new Set((await tx.raceRsvp.findMany({ where: { driverId: keep.id }, select: { raceId: true } })).map((r) => r.raceId));
    for (const r of await tx.raceRsvp.findMany({ where: { driverId: drop.id } })) {
      if (keepRsvpRaces.has(r.raceId)) await tx.raceRsvp.delete({ where: { id: r.id } });
      else await tx.raceRsvp.update({ where: { id: r.id }, data: { driverId: keep.id } });
    }

    // Driver market: offers they made (one per race), interests (one per
    // offer), seats they were picked to fill.
    const keepOfferRaces = new Set((await tx.seatOffer.findMany({ where: { driverId: keep.id }, select: { raceId: true } })).map((o) => o.raceId));
    for (const o of await tx.seatOffer.findMany({ where: { driverId: drop.id } })) {
      if (keepOfferRaces.has(o.raceId)) await tx.seatOffer.delete({ where: { id: o.id } });
      else await tx.seatOffer.update({ where: { id: o.id }, data: { driverId: keep.id } });
    }
    const keepInterestOffers = new Set((await tx.seatInterest.findMany({ where: { driverId: keep.id }, select: { offerId: true } })).map((i) => i.offerId));
    for (const i of await tx.seatInterest.findMany({ where: { driverId: drop.id } })) {
      if (keepInterestOffers.has(i.offerId)) await tx.seatInterest.delete({ where: { id: i.id } });
      else await tx.seatInterest.update({ where: { id: i.id }, data: { driverId: keep.id } });
    }
    await tx.seatOffer.updateMany({ where: { filledById: drop.id }, data: { filledById: keep.id } });

    // Recorded transfers (one per round): the kept row's statement wins.
    await tx.$executeRawUnsafe(
      `DELETE FROM "DriverTeamChange" WHERE "driverId" = ? AND "fromRound" IN (SELECT "fromRound" FROM "DriverTeamChange" WHERE "driverId" = ?)`,
      drop.id, keep.id
    ).catch(() => {});
    await tx.$executeRawUnsafe(`UPDATE "DriverTeamChange" SET "driverId" = ? WHERE "driverId" = ?`, keep.id, drop.id).catch(() => {});

    // Picks and reports that name the row.
    await tx.$executeRawUnsafe(`UPDATE "Race" SET "driverOfTheDayId" = ? WHERE "driverOfTheDayId" = ?`, keep.id, drop.id).catch(() => {});
    await tx.report.updateMany({ where: { accusedDriverId: drop.id }, data: { accusedDriverId: keep.id } }).catch(() => {});
    // A title the league awarded by rule to the dropped row stays awarded.
    await tx.$executeRawUnsafe(`UPDATE "Season" SET "championDriverId" = ? WHERE "championDriverId" = ?`, keep.id, drop.id).catch(() => {});

    // Identity and profile: the login and the Steam id are unique, so they
    // leave the old row before they land on the kept one.
    const data = {};
    if (!keep.discordUserId && drop.discordUserId) data.discordUserId = drop.discordUserId;
    if (!keep.steamId && drop.steamId) data.steamId = drop.steamId;
    for (const f of PROFILE_FIELDS) if (empty(keep[f]) && !empty(drop[f])) data[f] = drop[f];
    if (!keep.isActive && drop.isActive) data.isActive = true;
    if (data.discordUserId || data.steamId) {
      await tx.driver.update({ where: { id: drop.id }, data: { discordUserId: null, steamId: null } });
    }
    if (Object.keys(data).length) await tx.driver.update({ where: { id: keep.id }, data });

    // One person across seasons: pull the old row's links over, drop its own.
    await dbLinkDrivers(tx, [keep.id, drop.id]);
    await dbUnlinkDriver(tx, drop.id);

    await tx.driver.delete({ where: { id: drop.id } });
  });

  return { ...plan, merged: true };
}
