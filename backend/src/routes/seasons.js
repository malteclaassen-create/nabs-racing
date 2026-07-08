import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAdminRequest } from "../middleware/auth.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";

const router = Router();

// GET /api/seasons -> all seasons, newest first (for the public season switcher
// and season-aware copy: the Welcome page reads dropWorst/teamDropWorst/
// pointsTable so its rules texts always match the season being shown).
// Private (unpublished) seasons are hidden from the public; a signed-in admin
// sees them all (with isPublic) so the admin season switcher can reach them.
router.get("/", async (req, res, next) => {
  try {
    const isAdmin = isAdminRequest(req);
    const [seasons, raw, priv] = await Promise.all([
      prisma.season.findMany({
        orderBy: { number: "desc" },
        select: { id: true, number: true, name: true, game: true, isActive: true, dropWorst: true, pointsTable: true },
      }),
      // teamDropWorst / isPublic aren't in the generated client yet -> raw read.
      prisma.$queryRawUnsafe(`SELECT "id", "teamDropWorst", "isPublic" FROM "Season"`).catch(() => []),
      getPrivateSeasonIds(prisma),
    ]);
    const rawById = new Map(raw.map((r) => [r.id, r]));
    const visible = isAdmin ? seasons : seasons.filter((s) => !priv.has(s.id));
    res.json(
      visible.map((s) => {
        const extra = rawById.get(s.id) || {};
        return {
          ...s,
          pointsTable: s.pointsTable ? JSON.parse(s.pointsTable) : null,
          teamDropWorst: extra.teamDropWorst == null ? null : Number(extra.teamDropWorst),
          isPublic: extra.isPublic == null ? true : !!Number(extra.isPublic),
        };
      })
    );
  } catch (e) {
    next(e);
  }
});

export default router;
