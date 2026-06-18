import { Router } from "express";
import prisma from "../lib/prisma.js";
import { getDriverProfile } from "../services/driverProfileService.js";

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

export default router;
