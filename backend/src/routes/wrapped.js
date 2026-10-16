// ---------------------------------------------------------------------------
// Season Wrapped (services/seasonWrappedService.js), public while it is on.
//
//   GET /api/wrapped/status?series=        { open, seasons } — does this visitor
//                                          get it, and which seasons have one
//                                          (finished ones only)
//   GET /api/wrapped?series=&season=       the hub: every driver of a season
//   GET /api/wrapped/driver/:key?series=&season=
//                                          one driver's Wrapped. :key is the
//                                          row id (what the site links), or
//                                          the handle with ?season= naming
//                                          which season (lib/driverHandles.js);
//                                          `mine` says whether it is the
//                                          signed-in member's own
//
// "Not open" answers 404 with a sentence, so the page can say so instead of
// pretending the driver does not exist. So does a season still being raced:
// a Wrapped comes when the season is over, and not before.
// ---------------------------------------------------------------------------
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser, isAdminRequest } from "../middleware/auth.js";
import { resolveDriverRow } from "../lib/driverHandles.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { getSeasonWrapped, getWrappedHub, isOwnWrapped, wrappedSeasonNumbers, wrappedVisibleTo } from "../services/seasonWrappedService.js";

const router = Router();
router.use(optionalUser);

const NOT_OPEN = "Season Wrapped isn't open yet.";
const NOT_FINISHED = "Season Wrapped comes when the season is over.";
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

router.get("/status", async (req, res, next) => {
  try {
    const open = await wrappedVisibleTo(prisma, req);
    res.json({ open, seasons: open ? await wrappedSeasonNumbers(prisma, str(req.query.series)) : [] });
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
    if (hub.notFinished) return res.status(404).json({ error: NOT_FINISHED, notFinished: true });
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
    if (body.notFinished) return res.status(404).json({ error: NOT_FINISHED, notFinished: true, season: body.season });
    // `mine`: the viewer is this driver, and the story talks to them.
    res.json({ ...body, mine: await isOwnWrapped(prisma, req.user?.discordId, row.id).catch(() => false) });
  } catch (e) {
    next(e);
  }
});

export default router;
