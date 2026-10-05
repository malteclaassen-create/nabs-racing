// ---------------------------------------------------------------------------
// Link-preview pictures the server draws itself (lib/sharePictures.js).
//
//   GET /api/share/picture.jpg?path=<page path>[&race=<id>][&season=<n>][&v=…]
//       The picture of that page as it stands. `v` is only there to give
//       each version its own address for Discord's cache; the picture is
//       always the current one.
//   GET /api/share/version?path=<page path>[&race=<id>][&season=<n>]
//       { version } for the site to put in the address bar (?v=…), so the
//       link people copy changes whenever the picture does. null = this
//       page has no drawn picture.
// ---------------------------------------------------------------------------
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { sharePictureState } from "../lib/sharePictures.js";
import { renderSharePicture } from "../lib/sharePictureDraw.js";

const router = Router();

const str = (v) => (typeof v === "string" && v ? v : undefined);
const requestOf = (req) => ({
  path: str(req.query.path) || "/",
  query: { race: str(req.query.race), season: str(req.query.season) },
});

router.get("/version", async (req, res, next) => {
  try {
    const { path, query } = requestOf(req);
    const state = await sharePictureState(prisma, path, query);
    res.setHeader("Cache-Control", "no-store");
    res.json({ version: state?.version ?? null });
  } catch (e) {
    next(e);
  }
});

router.get("/picture.jpg", async (req, res, next) => {
  try {
    const { path, query } = requestOf(req);
    const state = await sharePictureState(prisma, path, query);
    if (!state) return res.status(404).json({ error: "No picture for this page" });
    const jpeg = await renderSharePicture(state);
    res.type("jpeg");
    // The address changes with what is drawn (the v parameter), so a day of
    // caching is safe for anyone holding the current one.
    res.setHeader("Cache-Control", req.query.v === state.version ? "public, max-age=86400" : "no-cache");
    res.send(jpeg);
  } catch (e) {
    next(e);
  }
});

export default router;
