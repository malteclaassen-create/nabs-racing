import { Router } from "express";
import prisma from "../lib/prisma.js";
import { resolveSeasonId } from "../services/seasonService.js";
import { getNameOverrides } from "../lib/persons.js";

const router = Router();

// GET /api/teams -> all teams (with drivers) in the selected (default: active) season
router.get("/", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season);
    const [teams, nameOverrides] = await Promise.all([
      prisma.team.findMany({
        where: { seasonId },
        include: {
          drivers: { orderBy: { name: "asc" } },
        },
        orderBy: [{ tier: "asc" }, { name: "asc" }],
      }),
      getNameOverrides(prisma),
    ]);
    // Archive rosters show the person's current name with a "raced as" note.
    // No-op for the active season (its own row already carries the current name).
    for (const t of teams) {
      for (const d of t.drivers) {
        const ov = nameOverrides.get(d.id);
        if (ov) {
          d.formerName = ov.formerName;
          d.name = ov.displayName;
        }
      }
    }
    res.json(teams);
  } catch (e) {
    next(e);
  }
});

export default router;
