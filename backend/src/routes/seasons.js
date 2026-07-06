import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

// GET /api/seasons -> all seasons, newest first (for the public season switcher
// and season-aware copy: the Welcome page reads dropWorst/pointsTable so its
// rules texts always match the season being shown).
router.get("/", async (req, res, next) => {
  try {
    const seasons = await prisma.season.findMany({
      orderBy: { number: "desc" },
      select: { id: true, number: true, name: true, game: true, isActive: true, dropWorst: true, pointsTable: true },
    });
    res.json(seasons.map((s) => ({ ...s, pointsTable: s.pointsTable ? JSON.parse(s.pointsTable) : null })));
  } catch (e) {
    next(e);
  }
});

export default router;
