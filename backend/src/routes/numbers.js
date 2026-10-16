// ---------------------------------------------------------------------------
// The league in numbers (services/leagueNumbersService.js), public.
//
//   GET /api/numbers?series=<slug>&season=<n|all>
//       One season's numbers (the active one when none is named), or every
//       season of the series added up with season=all.
// ---------------------------------------------------------------------------
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAdminRequest } from "../middleware/auth.js";
import { getLeagueNumbers } from "../services/leagueNumbersService.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const raw = typeof req.query.season === "string" ? req.query.season.trim() : "";
    const season = raw === "all" ? "all" : /^\d{1,4}$/.test(raw) ? Number(raw) : null;
    const series = typeof req.query.series === "string" && req.query.series.trim() ? req.query.series.trim() : null;
    const body = await getLeagueNumbers(prisma, { series, season, includePrivate: isAdminRequest(req) });
    if (!body) return res.status(404).json({ error: "No such season" });
    res.json(body);
  } catch (e) {
    next(e);
  }
});

export default router;
