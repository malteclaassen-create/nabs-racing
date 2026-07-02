import { Router } from "express";
import prisma from "../lib/prisma.js";
import { getDriverProfile } from "../services/driverProfileService.js";
import { getDriverRatings } from "../services/driverRatingsService.js";

const router = Router();

// GET /api/drivers/:id/profile -> full career profile for one driver
router.get("/:id/profile", async (req, res, next) => {
  try {
    const profile = await getDriverProfile(prisma, req.params.id);
    if (!profile) return res.status(404).json({ error: "Driver not found" });
    res.json(profile);
  } catch (e) {
    next(e);
  }
});

// GET /api/drivers/:id/rating -> this driver's computed EA-style rating, or null
// when they have no races yet (so no card is shown). Field-relative, so it's
// computed across the driver's whole season and the matching row returned.
router.get("/:id/rating", async (req, res, next) => {
  try {
    const driver = await prisma.driver.findUnique({ where: { id: req.params.id } });
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    const ratings = await getDriverRatings(prisma, driver.seasonId);
    res.json(ratings.find((r) => r.driverId === driver.id) || null);
  } catch (e) {
    next(e);
  }
});

export default router;
