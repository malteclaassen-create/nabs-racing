import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAdminRequest } from "../middleware/auth.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
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
    const [bySeries, rows] = await Promise.all([
      seasonSeriesMap(prisma),
      prisma
        .$queryRawUnsafe(`SELECT "id","number","name","game" FROM "Season" WHERE "isAnnounced" = 1 ORDER BY "number" ASC`)
        .catch(() => []),
    ]);
    const inSeries = (id) => bySeries.size === 0 || bySeries.get(id) === series.id;
    // The series' own running season (there is at most one active per series).
    // Pre-backfill DBs (empty map) fall back to the global active season.
    const activeRow = bySeries.size
      ? (
          await prisma
            .$queryRawUnsafe(
              `SELECT "number" FROM "Season" WHERE "isActive" = 1 AND "seriesId" = ? LIMIT 1`,
              series.id
            )
            .catch(() => [])
        )[0]
      : await prisma.season.findFirst({ where: { isActive: true }, select: { number: true } });
    const activeNumber = activeRow ? Number(activeRow.number) : null;
    // Only a season AHEAD of the series' running one may announce itself (a
    // stale flag on an activated or archived season is simply ignored).
    const teased = rows.find(
      (r) => inSeries(r.id) && (activeNumber == null || Number(r.number) > Number(activeNumber))
    );
    if (!teased) return res.json(null);
    const firstRace = await prisma.race.findFirst({
      where: { seasonId: teased.id, isSpecialEvent: false, number: { not: null }, isCompleted: false },
      orderBy: { number: "asc" },
      select: { track: true, date: true },
    });
    res.json({
      number: Number(teased.number),
      name: teased.name,
      game: teased.game || null,
      firstRace: firstRace ? { track: firstRace.track, date: firstRace.date } : null,
    });
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
      prisma.$queryRawUnsafe(`SELECT "id", "teamDropWorst", "teamDropMode", "isPublic", "heroImageUrl" FROM "Season"`).catch(() => []),
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
        };
      })
    );
  } catch (e) {
    next(e);
  }
});

export default router;
