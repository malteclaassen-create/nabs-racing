// ---------------------------------------------------------------------------
// Season Wrapped (services/seasonWrappedService.js), public while it is on.
//
//   GET /api/wrapped/status?series=        { open } — does this visitor get it
//   GET /api/wrapped?series=&season=       the hub: every driver of a season
//   GET /api/wrapped/driver/:key?series=&season=
//                                          one driver's Wrapped. :key is the
//                                          row id (what the site links), or
//                                          the handle with ?season= naming
//                                          which season (lib/driverHandles.js)
//
// "Not open" answers 404 with a sentence, so the page can say so instead of
// pretending the driver does not exist.
// ---------------------------------------------------------------------------
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser, isAdminRequest } from "../middleware/auth.js";
import { resolveDriverRow } from "../lib/driverHandles.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { getSeasonWrapped, getWrappedHub, wrappedVisibleTo } from "../services/seasonWrappedService.js";

const router = Router();
router.use(optionalUser);

const NOT_OPEN = "Season Wrapped isn't open yet.";
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

router.get("/status", async (req, res, next) => {
  try {
    res.json({ open: await wrappedVisibleTo(prisma, req) });
  } catch (e) {
    next(e);
  }
});

router.get("/", async (req, res, next) => {
  try {
    if (!(await wrappedVisibleTo(prisma, req))) return res.status(404).json({ error: NOT_OPEN, closed: true });
    const hub = await getWrappedHub(prisma, {
      series: str(req.query.series),
      season: str(req.query.season),
      includePrivate: isAdminRequest(req),
      discordId: req.user?.discordId || null,
    });
    if (!hub) return res.status(404).json({ error: "No such season" });
    res.json(hub);
  } catch (e) {
    next(e);
  }
});

router.get("/driver/:key", async (req, res, next) => {
  try {
    if (!(await wrappedVisibleTo(prisma, req))) return res.status(404).json({ error: NOT_OPEN, closed: true });
    const admin = isAdminRequest(req);
    const hit = await resolveDriverRow(prisma, req.params.key, {
      series: str(req.query.series),
      season: str(req.query.season),
      includePrivate: admin,
    });
    const row = hit ? await prisma.driver.findUnique({ where: { id: hit.id }, select: { id: true, seasonId: true } }) : null;
    if (!row) return res.status(404).json({ error: "Driver not found" });
    // An unpublished season stays unpublished, whatever the address says.
    if (!admin && row.seasonId && (await getPrivateSeasonIds(prisma)).has(row.seasonId)) {
      return res.status(404).json({ error: "Driver not found" });
    }
    const body = await getSeasonWrapped(prisma, row.id);
    if (!body) return res.status(404).json({ error: "Driver not found" });
    res.json(body);
  } catch (e) {
    next(e);
  }
});

export default router;
