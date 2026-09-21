import { Router } from "express";
import prisma from "../lib/prisma.js";
import { getCareer } from "../services/careerService.js";
import { isAdminRequest } from "../middleware/auth.js";

const router = Router();

// GET /api/career/:key -> one person's whole record, every league included.
// `key` is a driver handle ("maltegoat") or any of their row ids.
router.get("/:key", async (req, res, next) => {
  try {
    const career = await getCareer(prisma, req.params.key, { includePrivate: isAdminRequest(req) });
    if (!career) return res.status(404).json({ error: "Driver not found" });
    res.json(career);
  } catch (e) {
    next(e);
  }
});

export default router;
