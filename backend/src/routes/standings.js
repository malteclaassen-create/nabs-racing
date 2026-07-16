import { Router } from "express";
import prisma from "../lib/prisma.js";
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "../services/standingsService.js";
import { getSeasonHonours } from "../services/honoursService.js";
import { getSeriesRecords } from "../services/recordsService.js";
import { resolveSeasonId } from "../services/seasonService.js";
import { getDriverRatings } from "../services/driverRatingsService.js";
import { parseCardPhotoPos } from "../lib/cardPhoto.js";
import { isKnownEdition, DEFAULT_CARD_EDITION } from "../lib/cardEditions.js";
import { isAdminRequest } from "../middleware/auth.js";

const router = Router();

// Public reads, but a signed-in admin may point them at a PRIVATE (unpublished)
// season to preview it on the real site; everyone else gets null -> no data.
// ?series=<slug> scopes the season lookup to that series (default: the active
// primary series), so every standings read is transitively series-scoped.
function seasonOpts(req) {
  return { includePrivate: isAdminRequest(req), series: req.query.series };
}

router.get("/drivers", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, seasonOpts(req));
    res.json(await getDriverStandings(prisma, seasonId));
  } catch (e) {
    next(e);
  }
});

// GET /standings/ratings -> every rated driver of the season with their card
// look (edition, picture, framing, animation), so the standings page can show
// the whole field as actual rating cards. Same season/series scoping as the
// other reads; null season -> empty list.
router.get("/ratings", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, seasonOpts(req));
    if (!seasonId) return res.json({ ratings: [] });
    const [ratings, season, rows] = await Promise.all([
      getDriverRatings(prisma, seasonId),
      prisma.season.findUnique({ where: { id: seasonId }, select: { number: true } }),
      // Card columns are raw-SQL columns; one bulk read for the whole field.
      prisma.$queryRaw`
        SELECT "id","number","country","photoUrl","discordAvatar","role",
               "cardStyle","cardAnim","cardPhotoPos","cardPhotoUrl"
        FROM "Driver" WHERE "seasonId" = ${seasonId}`,
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    res.json({
      seasonNumber: season?.number ?? null,
      ratings: ratings.map((r) => {
        const d = byId.get(r.driverId) || {};
        return {
          ...r,
          number: d.number ?? null,
          country: d.country || null,
          role: d.role || null,
          photoUrl: d.photoUrl || d.discordAvatar || null,
          cardStyle: isKnownEdition(d.cardStyle) && d.cardStyle !== DEFAULT_CARD_EDITION ? d.cardStyle : null,
          cardAnim: d.cardAnim === "off" ? "off" : null,
          photoPos: parseCardPhotoPos(d.cardPhotoPos),
          cardPhotoUrl: d.cardPhotoUrl || null,
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

// GET /standings/records?series= -> the Hall of Fame: all-time top lists,
// single records and the champions timeline across every visible season of
// the series (default: the active one). Series-scoped, NOT season-scoped.
router.get("/records", async (req, res, next) => {
  try {
    const data = await getSeriesRecords(prisma, req.query.series, { includePrivate: isAdminRequest(req) });
    if (!data) return res.status(404).json({ error: "Series not found" });
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// End-of-season honours (champion, podium, team champions, season awards) —
// the Home page's "season complete" celebration reads this.
router.get("/honours", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, seasonOpts(req));
    res.json(await getSeasonHonours(prisma, seasonId));
  } catch (e) {
    next(e);
  }
});

router.get("/constructors/t1", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, seasonOpts(req));
    res.json(await getT1ConstructorStandings(prisma, seasonId));
  } catch (e) {
    next(e);
  }
});

router.get("/constructors/t2", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, seasonOpts(req));
    res.json(await getT2ConstructorStandings(prisma, seasonId));
  } catch (e) {
    next(e);
  }
});

export default router;
