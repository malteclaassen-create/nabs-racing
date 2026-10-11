import { Router } from "express";
import prisma from "../lib/prisma.js";
import { buildWidget } from "../lib/widget.js";
import { avatarImage } from "../lib/widgetAvatar.js";
import { isSafeId } from "../lib/safeUpload.js";

const router = Router();

const one = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// GET /api/widget[?series=<slug>][&driver=<name>] -> the iPhone home screen
// widget's data (lib/widget.js). Public and read-only; five minutes of caching
// is plenty for a widget iOS refreshes on its own schedule anyway. The widget
// adds ?t=<timestamp> to get past caches when it wants to; it changes nothing
// here.
router.get("/", async (req, res, next) => {
  try {
    const body = await buildWidget(prisma, {
      series: one(req.query.series),
      driver: one(req.query.driver),
      // `trust proxy` is set, so this is the address the visitor used.
      origin: `${req.protocol}://${req.get("host")}`,
    });
    if (!body) return res.status(404).json({ error: "No season found for that series" });
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(body);
  } catch (e) {
    next(e);
  }
});

// GET /api/widget/avatar/:driverId -> the picture behind that driver's card,
// as a JPEG of at most 600px, square or portrait (lib/widgetAvatar.js). The
// URL me.avatar names carries a version, so a day of caching is safe.
router.get("/avatar/:driverId", async (req, res, next) => {
  try {
    if (!isSafeId(req.params.driverId)) return res.status(404).json({ error: "No picture" });
    const jpeg = await avatarImage(prisma, req.params.driverId);
    if (!jpeg) return res.status(404).json({ error: "No picture" });
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(jpeg);
  } catch (e) {
    next(e);
  }
});

export default router;
