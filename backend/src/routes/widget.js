import { Router } from "express";
import prisma from "../lib/prisma.js";
import { buildWidget } from "../lib/widget.js";

const router = Router();

// GET /api/widget[?series=<slug>] -> the iPhone home screen widget's data
// (lib/widget.js). Public and read-only; five minutes of caching is plenty
// for a widget iOS refreshes on its own schedule anyway.
router.get("/", async (req, res, next) => {
  try {
    const body = await buildWidget(prisma, req.query.series);
    if (!body) return res.status(404).json({ error: "No season found for that series" });
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(body);
  } catch (e) {
    next(e);
  }
});

export default router;
