import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

// GET /api/seasons -> all seasons, newest first (for the public season switcher).
router.get("/", async (req, res, next) => {
  try {
    const seasons = await prisma.season.findMany({
      orderBy: { number: "desc" },
      select: { id: true, number: true, name: true, game: true, isActive: true },
    });
    res.json(seasons);
  } catch (e) {
    next(e);
  }
});

export default router;
