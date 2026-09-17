// ---------------------------------------------------------------------------
// GET /api/content-check[?server=nabs1][&session=<id>]
//
// The files the race server checksums for a session, with the MD5 of the
// server's own copy (services/contentCheckService.js). Public on purpose: a
// driver who has just been kicked with "Checksum failed" is exactly the person
// who cannot be asked to log in first, and the payload is nothing but hashes
// of files the server already hands out unauthenticated.
// ---------------------------------------------------------------------------
import { Router } from "express";
import { getContentCheck, contentCheckServers } from "../services/contentCheckService.js";
import { isValidServerKey, DEFAULT_SERVER_KEY } from "../lib/liveServers.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const key = isValidServerKey(req.query.server) ? req.query.server : DEFAULT_SERVER_KEY;
    const sessionId = typeof req.query.session === "string" && req.query.session ? req.query.session : null;
    const data = await getContentCheck(key, { sessionId });
    if (!data) return res.status(404).json({ error: "Unknown server" });
    res.json({ servers: contentCheckServers().map(({ key, name }) => ({ key, name })), ...data });
  } catch (e) {
    // The race server being unreachable is not a bug on this side, and the
    // page can say something useful about it.
    if (e?.name === "AbortError" || e?.status >= 500 || e?.message?.includes("fetch")) {
      return res.status(502).json({ error: "The race server did not answer. Try again in a minute." });
    }
    next(e);
  }
});

export default router;
