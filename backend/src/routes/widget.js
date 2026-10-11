import { Router } from "express";
import prisma from "../lib/prisma.js";
import { buildWidget } from "../lib/widget.js";

const router = Router();

const one = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// GET /api/widget[?series=<slug>][&driver=<name>] -> the iPhone home screen
// widget's data (lib/widget.js). Public and read-only; five minutes of caching
// is plenty for a widget iOS refreshes on its own schedule anyway. The widget
// adds ?t=<timestamp> to get past caches when it wants to; it changes nothing
// here.
router.get("/", async (req, res, next) => {
  try {
    const body = await buildWidget(prisma, { series: one(req.query.series), driver: one(req.query.driver) });
    if (!body) return res.status(404).json({ error: "No season found for that series" });
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(body);
  } catch (e) {
    next(e);
  }
});

export default router;
