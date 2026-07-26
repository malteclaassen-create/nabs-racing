import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAdminRequest } from "../middleware/auth.js";
import { getPrivateSeasonIds, getSeasonTeaser } from "../services/seasonService.js";
import { resolveSeries, seasonSeriesMap } from "../lib/series.js";

const router = Router();

// GET /api/seasons/teaser?series=<slug> -> the next ANNOUNCED upcoming season
// of the series, for the "Coming up" strip on Home/Welcome — or null. Works
// for PRIVATE seasons too, on purpose: the admin flips "Announce" (Seasons
// tab) to advertise a season before it becomes browsable, and this
// deliberately leaks ONLY the teaser facts (name, game, opener track + date),
// never rosters or results. Scoped per series so the GT page never teases the
// F1 league's next season.
router.get("/teaser", async (req, res, next) => {
  try {
    const series = await resolveSeries(prisma, req.query.series, {
      includePrivate: isAdminRequest(req),
    });
    if (!series) return res.json(null);
    // Field by field, not the whole object: getSeasonTeaser also carries the
    // season's id for its server-side callers, and the teased season is usually
    // still private.
    const t = await getSeasonTeaser(prisma, series);
    res.json(t && { number: t.number, name: t.name, game: t.game, firstRace: t.firstRace });
  } catch (e) {
    next(e);
  }
});

// GET /api/seasons?series=<slug> -> the series' seasons, newest first (for the
// public season switcher and season-aware copy: the Welcome page reads
// dropWorst/teamDropWorst/pointsTable so its rules texts always match the
// season being shown). No ?series= = the active (primary) series, which keeps
// the single-series behaviour identical to before.
// Private (unpublished) seasons are hidden from the public; a signed-in admin
// sees them all (with isPublic) so the admin season switcher can reach them.
router.get("/", async (req, res, next) => {
  try {
    const isAdmin = isAdminRequest(req);
    const series = await resolveSeries(prisma, req.query.series, { includePrivate: isAdmin });
    if (!series) return res.json([]);
    const [seasons, raw, priv, bySeries] = await Promise.all([
      prisma.season.findMany({
        orderBy: { number: "desc" },
        select: { id: true, number: true, name: true, game: true, isActive: true, dropWorst: true, pointsTable: true },
      }),
      // teamDropWorst / teamDropMode / isPublic / heroImageUrl aren't in the
      // generated client yet -> raw read.
      prisma.$queryRawUnsafe(`SELECT "id", "teamDropWorst", "teamDropMode", "isPublic", "heroImageUrl", "carImageUrl" FROM "Season"`).catch(() => []),
      getPrivateSeasonIds(prisma),
      seasonSeriesMap(prisma),
    ]);
    const rawById = new Map(raw.map((r) => [r.id, r]));
    const visible = seasons.filter(
      (s) =>
        (isAdmin || !priv.has(s.id)) &&
        // Pre-backfill rows (no series map yet) stay visible everywhere.
        (bySeries.size === 0 || bySeries.get(s.id) === series.id)
    );
    res.json(
      visible.map((s) => {
        const extra = rawById.get(s.id) || {};
        return {
          ...s,
          pointsTable: s.pointsTable ? JSON.parse(s.pointsTable) : null,
          teamDropWorst: extra.teamDropWorst == null ? null : Number(extra.teamDropWorst),
          teamDropMode: extra.teamDropMode === "rounds" ? "rounds" : null,
          isPublic: extra.isPublic == null ? true : !!Number(extra.isPublic),
          heroImageUrl: extra.heroImageUrl || null,
          carImageUrl: extra.carImageUrl || null,
        };
      })
    );
  } catch (e) {
    next(e);
  }
});

export default router;
