import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAdminRequest } from "../middleware/auth.js";
import { dbListSeries } from "../lib/series.js";

const router = Router();

// GET /api/series -> visible series in switcher order, for the NavBar series
// switcher and the SeriesProvider. Private (unpublished) series are hidden
// from the public; a signed-in admin sees them all (with isPublic) so the
// admin can build up a new series quietly and preview it on the real site.
router.get("/", async (req, res, next) => {
  try {
    const series = await dbListSeries(prisma, { includePrivate: isAdminRequest(req) });
    res.json(
      series.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        game: s.game,
        description: s.description,
        order: s.order,
        isActive: s.isActive,
        isPublic: s.isPublic,
        accentColor: s.accentColor,
        logoDarkUrl: s.logoDarkUrl,
      }))
    );
  } catch (e) {
    next(e);
  }
});

export default router;
