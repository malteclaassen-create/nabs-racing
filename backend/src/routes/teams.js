import { Router } from "express";
import prisma from "../lib/prisma.js";
import { resolveSeasonId } from "../services/seasonService.js";
import { isAdminRequest } from "../middleware/auth.js";
import { getNameOverrides } from "../lib/persons.js";
import { readDriverRoles } from "../lib/driverRoles.js";

const router = Router();

// GET /api/teams -> all teams (with drivers) in the selected (default: active)
// season. An admin may target a private season (site preview); the public can't.
router.get("/", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, { includePrivate: isAdminRequest(req) });
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
    // Special roles (raw-SQL column) for the role badge / admin role select.
    const roles = await readDriverRoles(prisma, teams.flatMap((t) => t.drivers.map((d) => d.id)));
    // Archive rosters show the person's current name with a "raced as" note.
    // No-op for the active season (its own row already carries the current name).
    for (const t of teams) {
      for (const d of t.drivers) {
        const ov = nameOverrides.get(d.id);
        if (ov) {
          d.formerName = ov.formerName;
          d.name = ov.displayName;
        }
        d.role = roles.get(d.id) || null;
      }
    }
    res.json(teams);
  } catch (e) {
    next(e);
  }
});

export default router;
