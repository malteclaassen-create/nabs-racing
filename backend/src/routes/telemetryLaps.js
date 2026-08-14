// ---------------------------------------------------------------------------
// Telemetry laps: the in-game nabsTelemetry app posts here, the /tools
// comparison reads here. See lib/telemetryLaps.js for what is stored and why.
//
// The ingest works exactly like the in-race report ingest one file over: OFF
// until an admin mints a key (Setting telemetry_ingest_key), and the key rides
// in the URL because a CSP Lua app cannot set request headers. A key that only
// ever ADDS a lap — and only a faster one than the driver's own stored best —
// is an acceptable thing to have in a query string; nothing here reads or
// deletes with it.
// ---------------------------------------------------------------------------
import { Router } from "express";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import prisma from "../lib/prisma.js";
import { parseLapPayload, keepIfFaster, listTracks, listLaps, readLap, isTrackKey, isSteamId } from "../lib/telemetryLaps.js";
import { getNameOverrides } from "../lib/persons.js";

const router = Router();
const __dir = dirname(fileURLToPath(import.meta.url));

// The same generous flood ceiling as the report ingest: it exists to stop a
// stuck loop filling the disk, not to ration a busy practice evening.
const INGEST_MAX = 60; // per minute, across everyone
let hits = [];
function flooded() {
  const cutoff = Date.now() - 60_000;
  hits = hits.filter((t) => t > cutoff);
  return hits.length >= INGEST_MAX;
}

async function ingestKey() {
  return prisma.setting
    .findUnique({ where: { key: "telemetry_ingest_key" } })
    .then((s) => s?.value || "")
    .catch(() => "");
}

// POST /api/telemetry-laps/ingest?key=...  (&ping=1 to test the URL alone)
router.post("/ingest", async (req, res, next) => {
  try {
    const secret = await ingestKey();
    if (!secret) return res.status(503).json({ error: "Telemetry recording is switched off" });
    if (String(req.query.key || "") !== secret) return res.status(401).json({ error: "Bad key" });
    // The app's Test button: proves URL + key without inventing a fake lap.
    if (req.query.ping) return res.json({ ok: true, pong: true });
    if (flooded()) return res.status(429).json({ error: "Too many laps at once" });
    hits.push(Date.now());

    const parsed = parseLapPayload(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const result = keepIfFaster(parsed.lap);
    // `kept` tells the app whether this beat the driver's stored best, so the
    // in-game line can say "saved" vs "your stored 1:31.2 stands".
    res.json({ ok: true, kept: result.kept, bestMs: result.bestMs });
  } catch (e) {
    next(e);
  }
});

// League identity for a set of steamIds: current display name + profile link,
// resolved the same two ways as everywhere else (captured SteamID on a roster
// row, current name overrides on top). A lap from someone the league doesn't
// know keeps the name the game recorded.
async function leagueNames(steamIds) {
  const ids = [...new Set(steamIds)].filter(Boolean);
  const out = new Map();
  if (!ids.length) return out;
  const rows = await prisma.driver.findMany({
    where: { steamId: { in: ids } },
    select: { id: true, steamId: true, name: true },
  });
  const overrides = await getNameOverrides(prisma);
  for (const d of rows) {
    // Several season rows can share a SteamID; any of them names the person,
    // and the override map already speaks with their current name.
    if (!out.has(d.steamId)) out.set(d.steamId, { driverId: d.id, name: overrides.get(d.id)?.displayName || d.name });
  }
  return out;
}

// GET /api/telemetry-laps/app.lua?key=... — the script itself, served by the
// site so the RACE SERVER can hand it to every driver who joins.
//
// This is the "drivers do nothing" path: the league server's
// csp_extra_options.ini points a [SCRIPT_...] section at this URL, CSP
// downloads it into each joining client, and it records and posts on its own.
// The key does double duty — it gates the download exactly like the ingest,
// and it is baked into the served source as the ingest address, so minting a
// new key invalidates both ends at once. The admin card prints the ready-made
// ini snippet.
router.get("/app.lua", async (req, res, next) => {
  try {
    const secret = await ingestKey();
    // 404, not 401/503: an unauthenticated probe learns nothing, not even
    // whether the feature exists.
    if (!secret || String(req.query.key || "") !== secret) return res.status(404).end();
    const base = `${req.protocol}://${req.get("host")}`;
    // replaceAll, learned the embarrassing way: the placeholder appears in the
    // template's own header comment too, and .replace() swapped only that one —
    // the served script compiled fine and would have posted to the literal
    // string "__INGEST_URL__" for ever.
    const src = readFileSync(join(__dir, "../lib/telemetryOnlineScript.lua"), "utf8").replaceAll(
      "__INGEST_URL__",
      `${base}/api/telemetry-laps/ingest?key=${secret}`
    );
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    // No caching: a re-minted key must reach the server's next fetch, not a
    // stale copy of the old script with the dead key inside.
    res.setHeader("Cache-Control", "no-store");
    res.send(src);
  } catch (e) {
    next(e);
  }
});

// GET /api/telemetry-laps -> tracks that have laps
router.get("/", async (req, res, next) => {
  try {
    res.json({ tracks: listTracks() });
  } catch (e) {
    next(e);
  }
});

// GET /api/telemetry-laps/:trackKey -> that track's laps, fastest first
router.get("/:trackKey", async (req, res, next) => {
  try {
    if (!isTrackKey(req.params.trackKey)) return res.status(400).json({ error: "Bad track key" });
    const laps = listLaps(req.params.trackKey);
    const known = await leagueNames(laps.map((l) => l.steamId));
    res.json({
      laps: laps.map((l) => ({
        ...l,
        driverId: known.get(l.steamId)?.driverId ?? null,
        name: known.get(l.steamId)?.name || l.name,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/telemetry-laps/:trackKey/:steamId -> one lap, channels included
router.get("/:trackKey/:steamId", async (req, res, next) => {
  try {
    if (!isTrackKey(req.params.trackKey) || !isSteamId(req.params.steamId)) {
      return res.status(400).json({ error: "Bad address" });
    }
    const lap = readLap(req.params.trackKey, req.params.steamId);
    if (!lap) return res.status(404).json({ error: "No lap stored there" });
    const known = await leagueNames([lap.steamId]);
    res.json({ ...lap, driverId: known.get(lap.steamId)?.driverId ?? null, name: known.get(lap.steamId)?.name || lap.name });
  } catch (e) {
    next(e);
  }
});

export default router;
