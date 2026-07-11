import { Router } from "express";
import prisma from "../lib/prisma.js";
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "../services/standingsService.js";
import { getSeasonHonours } from "../services/honoursService.js";
import { resolveSeasonId } from "../services/seasonService.js";
import { isAdminRequest } from "../middleware/auth.js";

const router = Router();

// Public reads, but a signed-in admin may point them at a PRIVATE (unpublished)
// season to preview it on the real site; everyone else gets null -> no data.
function seasonOpts(req) {
  return { includePrivate: isAdminRequest(req) };
}

router.get("/drivers", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, seasonOpts(req));
    res.json(await getDriverStandings(prisma, seasonId));
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
