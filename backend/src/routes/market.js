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

// Shape one offer for the API (team, who offered, who's picked, interest list).
function shapeOffer(o) {
  return {
    id: o.id,
    raceId: o.raceId,
    status: o.status,
    team: { id: o.team.id, name: o.team.name, color: o.team.color },
    offeredBy: { driverId: o.driver.id, name: o.driver.name },
    filledBy: o.filledBy ? { driverId: o.filledBy.id, name: o.filledBy.name } : null,
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
    // The market only deals in upcoming races, i.e. the active season.
    // (Admins may preview a private season's market; the public can't.)
    const seasonId = await resolveSeasonId(prisma, req.query.season, { includePrivate: isAdminRequest(req) });
    const races = await prisma.race.findMany({
      where: { isCompleted: false, isSpecialEvent: false, seasonId },
      orderBy: { number: "asc" },
      include: {
        seatOffers: {
          where: { status: { not: "CANCELLED" } },
          include: offerInclude,
          orderBy: { createdAt: "asc" },
        },
      },
    });

    // The caller's market context IN THIS SEASON: their login may point at
    // another season's row, so map it to this season's roster (person link /
    // unclaimed name match — same rules as the login's season handover).
    let me = null;
    const myDriverId = await resolveDriverId(prisma, req.user);
    if (myDriverId) {
      const base = await prisma.driver.findUnique({
        where: { id: myDriverId },
        include: { team: true },
      });
      const d = await seasonRowForDriver(prisma, base, seasonId, req.user?.discordId);
      if (d) {
        me = {
          driverId: d.id,
          name: d.name,
          teamId: d.teamId,
          tier: d.team?.tier ?? d.tier,
          canOffer: hasRealSeat(d),
          isReserve: isReserve(d),
        };
      }
    }

    res.json({
      me,
      races: races.map((race) => ({
        id: race.id,
        number: race.number,
        track: race.track,
        date: race.date,
        offers: race.seatOffers.map(shapeOffer),
      })),
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/market/offer { raceId } -> the logged-in full-time driver offers
// their seat for that race. Idempotent: re-offering reopens a cancelled offer.
router.post("/offer", async (req, res, next) => {
  try {
    const { raceId } = req.body || {};
    const race = await prisma.race.findUnique({ where: { id: raceId } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    if (race.isCompleted) return res.status(400).json({ error: "Race already completed" });
    // Special events aren't scored and have no market (the market view never
    // lists them) — refuse the write too so no orphaned offers can exist.
    if (race.isSpecialEvent) return res.status(400).json({ error: "Special events have no driver market" });
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
    res.json({ ok: true, offer: shapeOffer(updated) });
  } catch (e) {
    next(e);
  }
});

export default router;
