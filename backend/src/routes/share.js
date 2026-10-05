// ---------------------------------------------------------------------------
// Link-preview pictures the server draws itself (lib/resultShareImage.js).
//
//   GET /api/share/result.jpg?series=<slug>[&race=<id>][&v=<version>]
//       The results page's picture: the latest round's podium, or the named
//       round's. `v` is only there to give each version its own address for
//       Discord's cache; the picture is always the current one.
//   GET /api/share/result-version?series=<slug>[&race=<id>][&season=<n>]
//       { version } for the results page to put in the address bar, so the
//       link people copy changes whenever the picture does. null = nothing
//       to draw (no finished round yet).
// ---------------------------------------------------------------------------
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { resolveSeries } from "../lib/series.js";
import { resultShareState, renderResultShareImage } from "../lib/resultShareImage.js";

const router = Router();

const queryOf = (req) => ({
  race: typeof req.query.race === "string" ? req.query.race : undefined,
  season: typeof req.query.season === "string" ? req.query.season : undefined,
});

async function seriesOf(req) {
  const slug = typeof req.query.series === "string" ? req.query.series : undefined;
  return resolveSeries(prisma, slug, { includePrivate: false });
}

router.get("/result-version", async (req, res, next) => {
  try {
    const series = await seriesOf(req);
    const state = series ? await resultShareState(prisma, series, queryOf(req)) : null;
    res.setHeader("Cache-Control", "no-store");
    res.json({ version: state?.version ?? null });
  } catch (e) {
    next(e);
  }
});

router.get("/result.jpg", async (req, res, next) => {
  try {
    const series = await seriesOf(req);
    const state = series ? await resultShareState(prisma, series, queryOf(req)) : null;
    if (!state) return res.status(404).json({ error: "No result to show" });
    const jpeg = await renderResultShareImage(state, { host: req.get("host") });
    res.type("jpeg");
    // The address already changes with what is drawn (the v parameter), so a
    // day of caching is safe for anyone holding the current one.
    res.setHeader("Cache-Control", req.query.v === state.version ? "public, max-age=86400" : "no-cache");
    res.send(jpeg);
  } catch (e) {
    next(e);
  }
});

export default router;
