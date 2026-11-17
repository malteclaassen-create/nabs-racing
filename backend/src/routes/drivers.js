import { Router } from "express";
import prisma from "../lib/prisma.js";
import { getDriverProfile } from "../services/driverProfileService.js";
import { getCardRating } from "../services/cardRatingService.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { isAdminRequest } from "../middleware/auth.js";
import { resolveDriverRow } from "../lib/driverHandles.js";
import { tokensPublic, flairsFor } from "../lib/tokens.js";
import { discordIdsForDrivers } from "../lib/persons.js";
import { getTrackStrengths } from "../services/trackStrengthService.js";
import { getDriverCareerRatings } from "../services/ratingHistoryService.js";

const router = Router();

// A driver in a PRIVATE (unpublished) season is 404 to the public, so a crafted
// /drivers/<id> deep link can't reveal an unreleased roster. Admins see it.
async function seasonHidden(req, seasonId) {
  if (!seasonId || isAdminRequest(req)) return false;
  return (await getPrivateSeasonIds(prisma)).has(seasonId);
}

// :id is a row id, or the person's handle (their name in url form) when the
// read says which league (?series=) and season (?season=) it is looking at:
// the address /s/<series>/drivers/<handle> stands for the person's row in
// that league and season. See lib/driverHandles.js.
async function rowFor(req) {
  const { series, season } = req.query || {};
  const hit = await resolveDriverRow(prisma, req.params.id, {
    series: series || null,
    season: season ?? null,
    includePrivate: isAdminRequest(req),
  });
  return hit?.id || null;
}

// GET /api/drivers/:id/profile -> full career profile for one driver
router.get("/:id/profile", async (req, res, next) => {
  try {
    const rowId = await rowFor(req);
    const driver = rowId ? await prisma.driver.findUnique({ where: { id: rowId }, select: { seasonId: true } }) : null;
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    if (await seasonHidden(req, driver.seasonId)) return res.status(404).json({ error: "Driver not found" });
    const profile = await getDriverProfile(prisma, rowId);
    if (!profile) return res.status(404).json({ error: "Driver not found" });
    // The flair from the token shop, if this person bought one.
    try {
      if (await tokensPublic(prisma)) {
        const discordId = (await discordIdsForDrivers(prisma, [rowId])).get(rowId);
        const flair = discordId ? (await flairsFor(prisma, [discordId])).get(discordId) : null;
        if (flair) (profile.driver || profile).flair = flair;
      }
    } catch {
      /* no flair then */
    }
    res.json(profile);
  } catch (e) {
    next(e);
  }
});

// GET /api/drivers/:id/track-strengths?scope=all|season -> which kind of
// circuit this person goes best on (services/trackStrengthService.js):
// "all" = every season of this league they raced, "season" = this row's.
router.get("/:id/track-strengths", async (req, res, next) => {
  try {
    const rowId = await rowFor(req);
    const driver = rowId ? await prisma.driver.findUnique({ where: { id: rowId }, select: { seasonId: true } }) : null;
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    if (await seasonHidden(req, driver.seasonId)) return res.status(404).json({ error: "Driver not found" });
    const scope = req.query.scope === "season" ? "season" : "all";
    res.json(await getTrackStrengths(prisma, rowId, { scope, includePrivate: isAdminRequest(req) }));
  } catch (e) {
    next(e);
  }
});

// GET /api/drivers/:id/rating -> this driver's CARD rating for their season, or
// null when nobody has ever rated them (so no card is shown). The card is the
// frozen end-of-previous-season snapshot — see cardRatingService; the live
// numbers behind it are private (/api/me/rating/history).
router.get("/:id/rating", async (req, res, next) => {
  try {
    const rowId = await rowFor(req);
    const driver = rowId ? await prisma.driver.findUnique({ where: { id: rowId } }) : null;
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    if (await seasonHidden(req, driver.seasonId)) return res.status(404).json({ error: "Driver not found" });
    res.json(await getCardRating(prisma, driver.seasonId, driver.id));
  } catch (e) {
    next(e);
  }
});

// GET /api/drivers/:id/rating/seasons -> { points } one point per FINISHED
// season of this league the person raced: the ratings they ended it on (the
// same numbers their next card carried). Public on purpose, the way a card is.
// A season still being raced is left out: its numbers are the live ones, and
// those stay private (/api/me/rating/history).
router.get("/:id/rating/seasons", async (req, res, next) => {
  try {
    const rowId = await rowFor(req);
    const driver = rowId ? await prisma.driver.findUnique({ where: { id: rowId }, select: { seasonId: true } }) : null;
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    if (await seasonHidden(req, driver.seasonId)) return res.status(404).json({ error: "Driver not found" });
    const career = await getDriverCareerRatings(prisma, rowId);
    const all = career?.points || [];
    // A season point carries its season id as `raceId` (ratingHistoryService).
    const ids = all.map((p) => p.raceId);
    const [open, hidden] = await Promise.all([
      ids.length
        ? prisma.race.findMany({
            where: { seasonId: { in: ids }, isSpecialEvent: false, isCompleted: false, number: { not: null } },
            select: { seasonId: true },
          })
        : [],
      isAdminRequest(req) ? new Set() : getPrivateSeasonIds(prisma),
    ]);
    const openIds = new Set(open.map((r) => r.seasonId));
    const points = all
      .filter((p) => !openIds.has(p.raceId) && !hidden.has(p.raceId))
      .map(({ provisional, ...p }) => p);
    res.json({ points });
  } catch (e) {
    next(e);
  }
});

// The round-by-round rating history is NOT public: it lives on /api/me/rating/
// history (me.js), own eyes only — the public profile shows the card and the
// end-of-season numbers above.

export default router;
