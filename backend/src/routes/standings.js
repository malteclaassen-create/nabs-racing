import { Router } from "express";
import prisma from "../lib/prisma.js";
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "../services/standingsService.js";
import { resolveSeasonId } from "../services/seasonService.js";

const router = Router();

router.get("/drivers", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season);
    res.json(await getDriverStandings(prisma, seasonId));
  } catch (e) {
    next(e);
  }
});

router.get("/constructors/t1", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season);
    res.json(await getT1ConstructorStandings(prisma, seasonId));
  } catch (e) {
    next(e);
  }
});

router.get("/constructors/t2", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season);
    res.json(await getT2ConstructorStandings(prisma, seasonId));
  } catch (e) {
    next(e);
  }
});

export default router;
