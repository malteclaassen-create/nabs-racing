import { Router } from "express";
import prisma from "../lib/prisma.js";
import { resolveSeasonId } from "../services/seasonService.js";
import { isAdminRequest } from "../middleware/auth.js";
import { getNameOverrides, discordIdsForDrivers } from "../lib/persons.js";
import { readDriverRoles } from "../lib/driverRoles.js";

const router = Router();

// GET /api/teams -> all teams (with drivers) in the selected (default: active)
// season. An admin may target a private season (site preview); the public can't.
router.get("/", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, {
      includePrivate: isAdminRequest(req),
      series: req.query.series,
    });
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
    const allIds = teams.flatMap((t) => t.drivers.map((d) => d.id));
    const roles = await readDriverRoles(prisma, allIds);
    // Standings-hidden flag (raw-SQL column) for the admin Drivers tab toggle.
    // .catch: fresh checkout before ensureAppSchema ran.
    let hiddenSet = new Set();
    if (allIds.length) {
      const ph = allIds.map(() => "?").join(",");
      const hiddenRows = await prisma
        .$queryRawUnsafe(`SELECT "id" FROM "Driver" WHERE "hideFromStandings" = 1 AND "id" IN (${ph})`, ...allIds)
        .catch(() => []);
      hiddenSet = new Set(hiddenRows.map((r) => r.id));
    }
    // The person's EFFECTIVE Discord id: the literal value lives on one row
    // per person (unique), but login and mentions inherit it through the
    // person links — so the admin Drivers tab should show it too instead of a
    // misleading "not set" on a fresh season row.
    const effectiveDiscord = await discordIdsForDrivers(prisma, allIds).catch(() => new Map());
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
        d.hideFromStandings = hiddenSet.has(d.id);
        // Inherited from a linked season row (own column empty).
        const eff = effectiveDiscord.get(d.id) || null;
        d.inheritedDiscordUserId = !d.discordUserId && eff ? eff : null;
      }
    }
    res.json(teams);
  } catch (e) {
    next(e);
  }
});

export default router;
