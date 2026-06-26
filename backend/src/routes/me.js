// Self-service endpoints for the logged-in (Discord) driver. Identity always
// comes from the user JWT (optionalUser -> req.user.driverId); there is no way
// to act as anyone else.
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser } from "../middleware/auth.js";

const router = Router();
router.use(optionalUser);

// Resolve the logged-in driver id or send a 401. Returns null when not allowed.
function requireDriver(req, res) {
  const driverId = req.user?.driverId;
  if (!driverId) {
    res.status(401).json({ error: "Sign in with Discord first" });
    return null;
  }
  return driverId;
}

// GET /api/me -> the logged-in driver's own record (incl. self-set country).
router.get("/", async (req, res, next) => {
  try {
    const driverId = requireDriver(req, res);
    if (!driverId) return;
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, name: true, country: true },
    });
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    res.json({ driverId: driver.id, name: driver.name, country: driver.country || "" });
  } catch (e) {
    next(e);
  }
});

// PUT /api/me/country { country }  -> set/clear the driver's own nationality.
// `country` is an ISO 3166-1 alpha-2 code (e.g. "de"); "" clears it.
const CODE = /^[a-z]{2}$/;
router.put("/country", async (req, res, next) => {
  try {
    const driverId = requireDriver(req, res);
    if (!driverId) return;
    const country = String(req.body?.country || "").trim().toLowerCase();
    if (country && !CODE.test(country)) {
      return res.status(400).json({ error: "country must be a 2-letter code or empty" });
    }
    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: { country: country || null },
      select: { id: true, country: true },
    });
    res.json({ ok: true, country: driver.country || "" });
  } catch (e) {
    next(e);
  }
});

export default router;
