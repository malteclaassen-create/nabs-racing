import { Router } from "express";
import prisma from "../lib/prisma.js";
import { getDriverProfile } from "../services/driverProfileService.js";
import { getCardRating } from "../services/cardRatingService.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { isAdminRequest } from "../middleware/auth.js";

const router = Router();

// A driver in a PRIVATE (unpublished) season is 404 to the public, so a crafted
// /drivers/<id> deep link can't reveal an unreleased roster. Admins see it.
async function seasonHidden(req, seasonId) {
  if (!seasonId || isAdminRequest(req)) return false;
  return (await getPrivateSeasonIds(prisma)).has(seasonId);
}

// GET /api/drivers/:id/profile -> full career profile for one driver
router.get("/:id/profile", async (req, res, next) => {
  try {
    const driver = await prisma.driver.findUnique({ where: { id: req.params.id }, select: { seasonId: true } });
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    if (await seasonHidden(req, driver.seasonId)) return res.status(404).json({ error: "Driver not found" });
    const profile = await getDriverProfile(prisma, req.params.id);
    if (!profile) return res.status(404).json({ error: "Driver not found" });
    res.json(profile);
  } catch (e) {
    next(e);
  }
});

// GET /api/drivers/:id/rating -> this driver's CARD rating for their season, or
// null when nobody has ever rated them (so no card is shown). The card is the
// frozen end-of-previous-season snapshot — see cardRatingService; the live
// numbers behind it are private (/api/me/rating/history).
router.get("/:id/rating", async (req, res, next) => {
  try {
    const driver = await prisma.driver.findUnique({ where: { id: req.params.id } });
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    if (await seasonHidden(req, driver.seasonId)) return res.status(404).json({ error: "Driver not found" });
    res.json(await getCardRating(prisma, driver.seasonId, driver.id));
  } catch (e) {
    next(e);
  }
});

// The round-by-round rating history is NOT public: it lives on /api/me/rating/
// history (me.js), own eyes only — the public profile shows just the card.

export default router;
