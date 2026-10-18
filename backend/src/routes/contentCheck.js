// ---------------------------------------------------------------------------
// GET /api/content-check[?server=nabs1]
//
// The files the race server checksums for a session, with the MD5 of the
// server's own copy (services/contentCheckService.js). Public on purpose: a
// driver who has just been kicked with "Checksum failed" is exactly the person
// who cannot be asked to log in first, and the payload is nothing but hashes
// of files the server already hands out unauthenticated.
// ---------------------------------------------------------------------------
import { Router } from "express";
import { getContentCheck, getFullContentCheck, contentCheckServers } from "../services/contentCheckService.js";
import { isValidServerKey, DEFAULT_SERVER_KEY } from "../lib/liveServers.js";
import { contentCheckTool, CONTENT_CHECK_TOOL_NAME } from "../lib/contentCheckTool.js";

const router = Router();

// GET /api/content-check/tool -> the same check as a Windows download
// (lib/contentCheckTool.js), pointed at the address it was downloaded from.
// Public like the manifest it reads.
router.get("/tool", (req, res) => {
  // `trust proxy` is set, so this is the address the visitor used.
  const body = contentCheckTool(`${req.protocol}://${req.get("host")}`);
  if (!body) return res.status(400).json({ error: "Unusable site address" });
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${CONTENT_CHECK_TOOL_NAME}"`);
  // Built from the request's Host header: never let a cache hand one visitor's
  // copy to another.
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

// GET /api/content-check/full[?server=nabs1] -> what the Windows tool
// compares: every file the server holds for the session's cars and track,
// plus the models and liveries that must exist on the driver's disk
// (services/contentCheckService.js, buildFullContentCheck). Same rules as the
// short list below: newest session only, cached, public.
router.get("/full", (req, res, next) => sendManifest(req, res, next, getFullContentCheck));

router.get("/", (req, res, next) => sendManifest(req, res, next, getContentCheck));

async function sendManifest(req, res, next, build) {
  try {
    const key = isValidServerKey(req.query.server) ? req.query.server : DEFAULT_SERVER_KEY;
    // Always the server's newest session, never a caller-named one: a session
    // id from the query would let anyone start an unbounded number of walks
    // over the race server, one per id, each one megabytes of reads. The two
    // servers therefore have exactly two possible answers between them, and
    // both sit in the cache. The service still takes an id for a future admin
    // view, which is not a public door.
    const data = await build(key);
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
}

export default router;
