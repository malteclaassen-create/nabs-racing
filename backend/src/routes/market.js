// ---------------------------------------------------------------------------
// Driver Market.
// A full-time driver who can't attend offers their seat for an upcoming race;
// reserve drivers express interest; the offering driver picks one of them.
// Identity always comes from the Discord login (optionalUser -> req.user), so
// every action is tied to the acting driver and can't be forged. Admin override
// (swap / clear / cancel any offer) lives in routes/admin.js.
// ---------------------------------------------------------------------------
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser, resolveDriverId, isAdminRequest } from "../middleware/auth.js";
import { resolveSeasonId } from "../services/seasonService.js";
import { seasonRowForDriver } from "../lib/persons.js";
import { eventSeasonIds } from "./events.js";
import { notifySeatOffered, notifySeatFilled, notifyAdminsSeatDropped } from "../lib/notifications.js";
import { syncRaceToDiscord } from "../services/discordService.js";

const router = Router();
router.use(optionalUser);

// Resolve the logged-in driver (with team) or send a 401. Returns null on fail.
// The driver is re-resolved from the DB (not the token snapshot), so admin
// unlink/relink in the Members tab applies to running sessions immediately.
async function requireDriver(req, res) {
  const driverId = await resolveDriverId(prisma, req.user);
  if (!driverId) {
    res.status(401).json({ error: "Sign in with Discord first" });
    return null;
  }
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { team: true },
  });
  if (!driver) {
    res.status(404).json({ error: "Driver not found" });
    return null;
  }
  return driver;
}

// Resolve the logged-in driver AS THEIR ROW IN `seasonId` (or 401/403). Market
// actions are per-race and a race belongs to a season — the login however
// points at ONE row (usually the active season's). Acting on another season's
// race must book that season's roster row, or offers/interest would carry a
// foreign season's team ids into the race.
async function requireDriverForSeason(req, res, seasonId) {
  const base = await requireDriver(req, res);
  if (!base) return null;
  const row = await seasonRowForDriver(prisma, base, seasonId, req.user?.discordId);
  if (!row) {
    res.status(403).json({ error: "You're not on this season's roster" });
    return null;
  }
  return row;
}

// A driver can offer a seat only if they hold a real (tier 1/2) seat.
const hasRealSeat = (driver) => driver.team?.tier === 1 || driver.team?.tier === 2;
// Only reserve-roster drivers (tier 0) can take a seat over.
const isReserve = (driver) => driver.team?.tier === 0;

// Being given a seat IS the answer to "are you on the grid", the mirror of the
// DECLINED that offering one files. Without it a stand-in sat in nobody's
// column while the admin built the grid from that very list, and the person who
// had just been told "you are driving" still saw three unanswered buttons.
//
// Clearing the pick takes the answer away again rather than leaving it at
// ACCEPTED: an accepted row is a promise to be on the grid, and somebody who no
// longer has the car cannot keep it. Back to no answer, not to DECLINED, so
// they can still say yes if a different seat opens.
export async function setSeatRsvp(prisma, raceId, driverId, seated) {
  if (!raceId || !driverId) return;
  if (seated) {
    await prisma.raceRsvp
      .upsert({
        where: { raceId_driverId: { raceId, driverId } },
        update: { status: "ACCEPTED" },
        create: { raceId, driverId, status: "ACCEPTED" },
      })
      .catch(() => {});
    return;
  }
  await prisma.raceRsvp.deleteMany({ where: { raceId, driverId, status: "ACCEPTED" } }).catch(() => {});
}

// Shape one offer for the API (team, who offered, who's picked, interest list).
function shapeOffer(o) {
  return {
    id: o.id,
    raceId: o.raceId,
    status: o.status,
    // `tier` so the market can put the Tier-1 cars first, `logoUrl` so it can
    // show whose car it is rather than a coloured dot.
    team: { id: o.team.id, name: o.team.name, color: o.team.color, tier: o.team.tier ?? null, logoUrl: o.team.logoUrl || null },
    offeredBy: { driverId: o.driver.id, name: o.driver.name, country: o.driver.country || null },
    filledBy: o.filledBy
      ? { driverId: o.filledBy.id, name: o.filledBy.name, country: o.filledBy.country || null }
      : null,
    interests: o.interests
      .map((i) => ({
        driverId: i.driver.id,
        name: i.driver.name,
        country: i.driver.country || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const offerInclude = {
  team: true,
  driver: true,
  filledBy: true,
  interests: { include: { driver: true } },
};

// GET /api/market -> upcoming races with their seat offers + the caller's
// own context (so the UI knows whether to show "offer seat" / "express
// interest" / "pick a reserve").
router.get("/", async (req, res, next) => {
  try {
    // The market deals in upcoming races — like the events list, that spans
    // every visible season of the series (next season's races can already
    // trade seats while the current one finishes). Same season resolution as
    // routes/events.js, so the Attendance page's two data sources line up.
    const seasonIds = await eventSeasonIds(prisma, req);
    const races = await prisma.race.findMany({
      where: { isCompleted: false, isSpecialEvent: false, seasonId: { in: seasonIds } },
      orderBy: { number: "asc" },
      include: {
        seatOffers: {
          where: { status: { not: "CANCELLED" } },
          include: offerInclude,
          orderBy: { createdAt: "asc" },
        },
      },
    });

    // The caller's market context PER SEASON: whether they hold a real seat
    // (or are a reserve) can differ between this season's and next season's
    // roster, so each race carries the context of ITS season. The top-level
    // `me` (the viewed/active season's row) stays for the page-level bits.
    const meBySeason = new Map();
    const myDriverId = await resolveDriverId(prisma, req.user);
    if (myDriverId) {
      const base = await prisma.driver.findUnique({
        where: { id: myDriverId },
        include: { team: true },
      });
      for (const sid of new Set(races.map((r) => r.seasonId))) {
        const d = base && (await seasonRowForDriver(prisma, base, sid, req.user?.discordId));
        if (d) {
          meBySeason.set(sid, {
            driverId: d.id,
            name: d.name,
            teamId: d.teamId,
            tier: d.team?.tier ?? d.tier,
            canOffer: hasRealSeat(d),
            isReserve: isReserve(d),
          });
        }
      }
    }
    const activeSeasonId = await resolveSeasonId(prisma, req.query.season, {
      includePrivate: isAdminRequest(req),
      series: req.query.series,
    });

    res.json({
      me: meBySeason.get(activeSeasonId) || meBySeason.values().next().value || null,
      races: races.map((race) => ({
        id: race.id,
        number: race.number,
        track: race.track,
        date: race.date,
        me: meBySeason.get(race.seasonId) || null,
        offers: race.seatOffers.map(shapeOffer),
      })),
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/market/offer { raceId } -> the logged-in full-time driver offers
// their seat for that race. Idempotent: re-offering reopens a cancelled offer.
// What the admins have actually announced, and when. See POST
// /api/admin/market/announce for why this exists at all.
export const ANNOUNCE_KEY = "market_announce";
export async function readAnnounce(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: ANNOUNCE_KEY } });
    const v = row?.value ? JSON.parse(row.value) : null;
    return { at: v?.at || "", ids: Array.isArray(v?.ids) ? v.ids : [] };
  } catch {
    return { at: "", ids: [] };
  }
}

// GET /api/market/alert -> { isReserve, raceId, open: [token], mine: [token] }
//
// The little bit the SITE CHROME needs: is a seat going begging, and has this
// person already put their hand up for it. The full market list is a page's
// worth of data (every upcoming race with its offers and everyone interested in
// them) and the nav bar cannot pull that on every page just to decide whether to
// light up an item.
//
// Reserve drivers only. Everybody else gets isReserve:false and empty lists, and
// the browser never asks again for the rest of the visit.
//
// Only seats an admin has ANNOUNCED count. A seat can sit open for a good
// reason — the round is weeks off, the deal is half agreed on Discord, the
// admin wants a word with somebody first — and a site that chases every reserve
// the moment a row appears takes that decision away from them.
//
// The ids come back as "<offerId>@<announcedAt>" rather than bare ids. The
// browser only ever compares them against what it has already shown, so
// announcing the same seat a second time is a token it has not seen and the
// nudge comes back, which is exactly what pressing the button again is for.
router.get("/alert", async (req, res, next) => {
  try {
    const empty = { isReserve: false, raceId: null, open: [], mine: [] };
    const myDriverId = await resolveDriverId(prisma, req.user);
    if (!myDriverId) return res.json(empty);

    const seasonIds = await eventSeasonIds(prisma, req);
    const races = await prisma.race.findMany({
      where: { isCompleted: false, isSpecialEvent: false, seasonId: { in: seasonIds } },
      orderBy: { number: "asc" },
      select: {
        id: true,
        seasonId: true,
        seatOffers: {
          where: { status: "OPEN" },
          select: { id: true, driverId: true, interests: { select: { driverId: true } } },
        },
      },
    });
    if (!races.some((r) => r.seatOffers.length)) return res.json(empty);

    const base = await prisma.driver.findUnique({ where: { id: myDriverId }, include: { team: true } });
    // The roster row of the race's own season, not the login's: a person can be
    // a reserve next season and a full-time driver in this one.
    const rowFor = new Map();
    for (const sid of new Set(races.map((r) => r.seasonId))) {
      rowFor.set(sid, base && (await seasonRowForDriver(prisma, base, sid, req.user?.discordId)));
    }

    const announced = await readAnnounce(prisma);
    const live = new Set(announced.ids);
    const open = [];
    const mine = [];
    let raceId = null;
    let reserveSomewhere = false;
    for (const race of races) {
      const row = rowFor.get(race.seasonId);
      if (!row || !isReserve(row)) continue;
      reserveSomewhere = true;
      for (const offer of race.seatOffers) {
        // Their own seat is not an opportunity, however open it is.
        if (offer.driverId === row.id) continue;
        if (!live.has(offer.id)) continue; // open, but nobody has been told yet
        const token = `${offer.id}@${announced.at}`;
        open.push(token);
        if (offer.interests.some((i) => i.driverId === row.id)) mine.push(token);
        if (!raceId) raceId = race.id;
      }
    }
    res.json({ isReserve: reserveSomewhere, raceId, open, mine });
  } catch (e) {
    next(e);
  }
});

router.post("/offer", async (req, res, next) => {
  try {
    const { raceId } = req.body || {};
    const race = await prisma.race.findUnique({ where: { id: raceId } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    if (race.isCompleted) return res.status(400).json({ error: "Race already completed" });
    // Special events and training sessions aren't scored and have no market
    // (the market view never lists them — both carry isSpecialEvent) — refuse
    // the write too so no orphaned offers can exist.
    if (race.isSpecialEvent) return res.status(400).json({ error: "Only championship rounds have a driver market" });
    // Act as the row this person has in the RACE's season (offers carry that
    // season's team, and the import pre-fill relies on those ids matching).
    const driver = await requireDriverForSeason(req, res, race.seasonId);
    if (!driver) return;
    if (!hasRealSeat(driver)) {
      return res.status(403).json({ error: "Only full-time drivers can offer a seat" });
    }

    const offer = await prisma.seatOffer.upsert({
      where: { raceId_driverId: { raceId: race.id, driverId: driver.id } },
      // Re-opening an old offer starts fresh: a leftover pick must not ride
      // along into the new round of interest.
      update: { status: "OPEN", filledById: null },
      create: { raceId: race.id, driverId: driver.id, teamId: driver.teamId, status: "OPEN" },
      include: offerInclude,
    });

    // Offering your seat IS the answer to "are you on the grid". It said
    // nothing before, so a driver could give their seat away and stand in the
    // accepted column at the same time — and did, because the sign-up answer
    // usually comes first and nothing went back to change it. The entry list
    // that the admin builds the grid from was then wrong in the one case it
    // most needed to be right.
    //
    // Written here rather than left to the page, so it holds however the offer
    // was made, and deliberately not undone when the offer is withdrawn: by
    // then it is a real answer that happens to be correct, and quietly putting
    // somebody back on the grid is worse than leaving them to say so.
    await prisma.raceRsvp.upsert({
      where: { raceId_driverId: { raceId: race.id, driverId: driver.id } },
      update: { status: "DECLINED" },
      create: { raceId: race.id, driverId: driver.id, status: "DECLINED" },
    });

    // Bell notification for this season's reserves (plus members who opted in
    // to all offers). Deduped per offer+recipient, so a re-offer stays silent.
    notifySeatOffered(prisma, { race, teamName: offer.team?.name, driver });
    // The Discord post lists the three columns, so it has to hear about the
    // line above. Never fails the offer.
    try {
      await syncRaceToDiscord(prisma, race.id);
    } catch {
      /* Discord is a mirror of this, not the record of it */
    }
    res.json({ ok: true, offer: shapeOffer(offer) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/market/offer/:offerId -> the offering driver withdraws their
// offer entirely (removes it and any interest on it).
router.delete("/offer/:offerId", async (req, res, next) => {
  try {
    const offer = await prisma.seatOffer.findUnique({
      where: { id: req.params.offerId },
      include: { race: { select: { seasonId: true, isCompleted: true } } },
    });
    if (!offer) return res.status(404).json({ error: "Offer not found" });
    // Once the race ran, the offer is the RECORD of who stood in for whom —
    // it stays for the admin's takeover history (only an admin can remove it).
    if (offer.race?.isCompleted) {
      return res.status(400).json({ error: "Race already completed. This offer is kept as the takeover record" });
    }
    const driver = await requireDriverForSeason(req, res, offer.race?.seasonId);
    if (!driver) return;
    if (offer.driverId !== driver.id) {
      return res.status(403).json({ error: "You can only withdraw your own offer" });
    }
    await prisma.seatOffer.delete({ where: { id: offer.id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/market/offer/:offerId/interest -> a reserve driver raises their
// hand for an offered seat (stays open even after the seat is filled).
router.post("/offer/:offerId/interest", async (req, res, next) => {
  try {
    const offer = await prisma.seatOffer.findUnique({
      where: { id: req.params.offerId },
      include: { race: { select: { seasonId: true, isCompleted: true } } },
    });
    if (!offer) return res.status(404).json({ error: "Offer not found" });
    if (offer.status === "CANCELLED") return res.status(400).json({ error: "Offer is no longer open" });
    if (offer.race?.isCompleted) return res.status(400).json({ error: "Race already completed" });
    const driver = await requireDriverForSeason(req, res, offer.race?.seasonId);
    if (!driver) return;
    if (!isReserve(driver)) {
      return res.status(403).json({ error: "Only reserve drivers can express interest" });
    }

    await prisma.seatInterest.upsert({
      where: { offerId_driverId: { offerId: offer.id, driverId: driver.id } },
      update: {},
      create: { offerId: offer.id, driverId: driver.id },
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/market/offer/:offerId/interest -> a reserve withdraws their
// own interest.
router.delete("/offer/:offerId/interest", async (req, res, next) => {
  try {
    const offer = await prisma.seatOffer.findUnique({
      where: { id: req.params.offerId },
      include: { race: { select: { seasonId: true, isCompleted: true } } },
    });
    if (!offer) return res.status(404).json({ error: "Offer not found" });
    if (offer.race?.isCompleted) return res.status(400).json({ error: "Race already completed" });
    const driver = await requireDriverForSeason(req, res, offer.race?.seasonId);
    if (!driver) return;
    await prisma.seatInterest.deleteMany({
      where: { offerId: req.params.offerId, driverId: driver.id },
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/market/offer/:offerId/pick { driverId } -> the offering driver
// chooses one of the interested reserves (or { driverId: null } to clear).
router.post("/offer/:offerId/pick", async (req, res, next) => {
  try {
    const offer = await prisma.seatOffer.findUnique({
      where: { id: req.params.offerId },
      include: { interests: true, race: { select: { seasonId: true, isCompleted: true } } },
    });
    if (!offer) return res.status(404).json({ error: "Offer not found" });
    // The pick freezes with the race: post-race corrections are admin-only
    // (Driver Market tab), so the takeover record can't be rewritten quietly.
    if (offer.race?.isCompleted) return res.status(400).json({ error: "Race already completed" });
    const driver = await requireDriverForSeason(req, res, offer.race?.seasonId);
    if (!driver) return;
    if (offer.driverId !== driver.id) {
      return res.status(403).json({ error: "Only the offering driver can pick a replacement" });
    }

    const pickId = req.body?.driverId || null;
    if (pickId) {
      // Must be one of the reserves who actually expressed interest.
      if (!offer.interests.some((i) => i.driverId === pickId)) {
        return res.status(400).json({ error: "That driver hasn't expressed interest" });
      }
    }
    const updated = await prisma.seatOffer.update({
      where: { id: offer.id },
      data: { filledById: pickId, status: pickId ? "FILLED" : "OPEN" },
      include: offerInclude,
    });
    // The person losing the seat and the person gaining it both need their
    // entry-list answer put right. Order matters only in that the old one goes
    // first, in case an admin re-picks the same driver.
    if (offer.filledById && offer.filledById !== pickId) {
      await setSeatRsvp(prisma, offer.raceId, offer.filledById, false);
    }
    if (pickId) await setSeatRsvp(prisma, offer.raceId, pickId, true);
    // Tell the picked reserve personally (needs their linked Discord id).
    if (updated.filledBy) {
      notifySeatFilled(prisma, { offerId: offer.id, raceId: offer.raceId, reserve: updated.filledBy });
    }
    res.json({ ok: true, offer: shapeOffer(updated) });
  } catch (e) {
    next(e);
  }
});

// POST /api/market/offer/:offerId/stand-down -> the reserve who was GIVEN this
// seat gives it back.
//
// Withdrawing interest is not the same thing and cannot cover this: by the time
// somebody has been picked, an admin has built a grid around them and the round
// may be days away. So this is its own action, it puts the seat back on the
// market, it takes their entry-list answer with it, and it tells the admins,
// because nobody would otherwise find out until the cars lined up.
router.post("/offer/:offerId/stand-down", async (req, res, next) => {
  try {
    const offer = await prisma.seatOffer.findUnique({
      where: { id: req.params.offerId },
      include: { driver: true, filledBy: true, race: true },
    });
    if (!offer) return res.status(404).json({ error: "Offer not found" });
    if (offer.race?.isCompleted) {
      return res.status(400).json({ error: "Race already ran. Talk to a steward" });
    }
    const driver = await requireDriverForSeason(req, res, offer.race?.seasonId);
    if (!driver) return;
    if (offer.filledById !== driver.id) {
      return res.status(403).json({ error: "You do not hold this seat" });
    }

    await prisma.seatOffer.update({
      where: { id: offer.id },
      data: { filledById: null, status: "OPEN" },
    });
    await setSeatRsvp(prisma, offer.raceId, driver.id, false);
    // Their interest goes too. Standing down and staying on the shortlist would
    // put them straight back in front of whoever picks next.
    await prisma.seatInterest
      .deleteMany({ where: { offerId: offer.id, driverId: driver.id } })
      .catch(() => {});

    notifyAdminsSeatDropped(prisma, {
      race: offer.race,
      offerId: offer.id,
      reserve: offer.filledBy || driver,
      offeredByName: offer.driver?.name || null,
    });
    // The Discord post carries the three columns, so it has to hear about the
    // answer that just disappeared.
    try {
      await syncRaceToDiscord(prisma, offer.raceId);
    } catch {
      /* Discord is a mirror of this, not the record of it */
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
