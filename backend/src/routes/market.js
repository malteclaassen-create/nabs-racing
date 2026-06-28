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
import { optionalUser } from "../middleware/auth.js";

const router = Router();
router.use(optionalUser);

// Resolve the logged-in driver (with team) or send a 401. Returns null on fail.
async function requireDriver(req, res) {
  const driverId = req.user?.driverId;
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
    const races = await prisma.race.findMany({
      where: { isCompleted: false, isSpecialEvent: false },
      orderBy: { number: "asc" },
      include: {
        seatOffers: {
          where: { status: { not: "CANCELLED" } },
          include: offerInclude,
          orderBy: { createdAt: "asc" },
        },
      },
    });

    let me = null;
    if (req.user?.driverId) {
      const d = await prisma.driver.findUnique({
        where: { id: req.user.driverId },
        include: { team: true },
      });
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
    const driver = await requireDriver(req, res);
    if (!driver) return;
    if (!hasRealSeat(driver)) {
      return res.status(403).json({ error: "Only full-time drivers can offer a seat" });
    }
    const { raceId } = req.body || {};
    const race = await prisma.race.findUnique({ where: { id: raceId } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    if (race.isCompleted) return res.status(400).json({ error: "Race already completed" });

    const offer = await prisma.seatOffer.upsert({
      where: { raceId_driverId: { raceId: race.id, driverId: driver.id } },
      update: { status: "OPEN" },
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
    const driver = await requireDriver(req, res);
    if (!driver) return;
    const offer = await prisma.seatOffer.findUnique({ where: { id: req.params.offerId } });
    if (!offer) return res.status(404).json({ error: "Offer not found" });
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
    const driver = await requireDriver(req, res);
    if (!driver) return;
    if (!isReserve(driver)) {
      return res.status(403).json({ error: "Only reserve drivers can express interest" });
    }
    const offer = await prisma.seatOffer.findUnique({ where: { id: req.params.offerId } });
    if (!offer) return res.status(404).json({ error: "Offer not found" });
    if (offer.status === "CANCELLED") return res.status(400).json({ error: "Offer is no longer open" });

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
    const driver = await requireDriver(req, res);
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
    const driver = await requireDriver(req, res);
    if (!driver) return;
    const offer = await prisma.seatOffer.findUnique({
      where: { id: req.params.offerId },
      include: { interests: true },
    });
    if (!offer) return res.status(404).json({ error: "Offer not found" });
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
