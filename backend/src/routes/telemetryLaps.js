// ---------------------------------------------------------------------------
// Telemetry laps: the in-game nabsTelemetry app posts here, the /tools
// comparison reads here. See lib/telemetryLaps.js for what is stored and why.
//
// The ingest works exactly like the in-race report ingest one file over: OFF
// until an admin mints a key (Setting telemetry_ingest_key), and the key rides
// in the URL because a CSP Lua app cannot set request headers. A key that only
// ever ADDS a lap — and only one that belongs in the driver's own fastest
// three — is an acceptable thing to have in a query string; nothing here reads
// or deletes with it.
// ---------------------------------------------------------------------------
import { Router } from "express";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import prisma from "../lib/prisma.js";
import { telemetryReadGate } from "../lib/telemetryAccess.js";
import { parseLapPayload, keepIfFaster, listTracks, listLaps, readLap, isTrackKey, isSteamId, isLapId } from "../lib/telemetryLaps.js";
import { getNameOverrides } from "../lib/persons.js";
import { resolveSeason } from "../services/seasonService.js";

const router = Router();
const __dir = dirname(fileURLToPath(import.meta.url));

// A ceiling against a stuck loop, and nothing else — which is why it is high.
//
// It cannot be sized like the report ingest, which was its first draft at 60 a
// minute. Reports are a handful on a race night; laps come from a PRACTICE
// server that stands between races with a full grid on it, and the moment that
// server restarts every driver rejoins at once, the script's memory of its own
// session best resets, and each of them posts their first clean lap. Forty-odd
// cars around a 66-second circuit puts that well past sixty in a minute, and a
// refused post is a lap silently dropped: the script logs the 429 and moves on.
//
// It can afford to be high because it is not what protects the disk. The store
// keeps three laps per driver per track and prunes the rest (lib/telemetryLaps
// .js), so the space this can ever occupy is drivers x tracks x 3 no matter how
// many posts arrive. What is left to protect is CPU and bandwidth, and 300 laps
// a minute is about 8 MB — far below anything that troubles either.
const INGEST_MAX = 300; // per minute, across everyone
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
    // WHICH SEASON this lap belongs to is the site's to say, not the game's:
    // the car knows the track and nothing about the league's calendar. Stamped
    // on arrival, because the league runs different cars each season and a lap
    // is only comparable within one.
    parsed.lap.season = await activeSeasonNumber();
    const result = keepIfFaster(parsed.lap);
    // `kept` tells the app whether the lap made this driver's stored three, so
    // the in-game line can say "saved" vs "your stored 1:31.2 stands".
    res.json({ ok: true, kept: result.kept, bestMs: result.bestMs, stored: result.stored });
  } catch (e) {
    next(e);
  }
});

// The season a lap belongs to, and the season a reader is looking at. The
// practice server runs between the rounds of whatever season is on, so "now" is
// the right answer for an arriving lap; a reader can ask for an older one.
//
// Series: the ingest cannot say which one it came from — a key, a car and a
// track is all it has — so an arriving lap is stamped with the primary series'
// active season. A second series recording telemetry would need its own key to
// tell them apart, and that is a bridge for the day it happens.
async function activeSeasonNumber() {
  try {
    const season = await resolveSeason(prisma, null, { includePrivate: true });
    return Number(season?.number) || 0;
  } catch {
    return 0;
  }
}

// Which season the caller is asking about, and whether that is the one running
// now — laps recorded before this store had seasons can only belong to that one.
async function seasonAsked(req) {
  const active = await activeSeasonNumber();
  const wanted = Number(req.query?.season);
  const season = Number.isFinite(wanted) && wanted > 0 ? wanted : active;
  return { season, legacy: season === active };
}

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

// --- reading: the stewards' desk only, for now ------------------------------
//
// Everything above this line is the RECORDING half: the app downloads itself
// and posts laps with the minted key, and none of it is affected by the gate
// below. A driver's car keeps sending whatever the league switched on.
//
// Reading is what is held back. A lap is a driver's inputs — where they lift,
// how they trail the brake, what they do with the wheel mid-corner — and the
// league has not decided yet whether that is something everyone gets to study
// about everyone. Until it has, the comparison is a tool for the people
// running the league to try out, and the answer to "who may look" is one line
// here rather than a page that quietly went public with the feature.
//
// Opening it later is ONE SWITCH, not a deploy: Admin -> League -> Telemetry
// flips `telemetry_public`, and the same view appears on the members' side.
// Until then this is the stewards' desk and nothing else. See
// lib/telemetryAccess.js, which owns the question and answers it in one place.
router.use(telemetryReadGate(prisma));

// GET /api/telemetry-laps -> tracks that have laps
router.get("/", async (req, res, next) => {
  try {
    const { season, legacy } = await seasonAsked(req);
    res.json({ season, tracks: listTracks(season, legacy) });
  } catch (e) {
    next(e);
  }
});

// GET /api/telemetry-laps/:trackKey -> that track's laps, fastest first
router.get("/:trackKey", async (req, res, next) => {
  try {
    if (!isTrackKey(req.params.trackKey)) return res.status(400).json({ error: "Bad track key" });
    const { season, legacy } = await seasonAsked(req);
    const laps = listLaps(season, req.params.trackKey, legacy);
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

// GET /api/telemetry-laps/:trackKey/:steamId[/:lapId] -> one lap, channels
// included. Without a lapId, the driver's fastest — which is what the address
// meant when a driver had only one, so old links still answer.
router.get("/:trackKey/:steamId/:lapId?", async (req, res, next) => {
  try {
    if (!isTrackKey(req.params.trackKey) || !isSteamId(req.params.steamId)) {
      return res.status(400).json({ error: "Bad address" });
    }
    if (req.params.lapId != null && !isLapId(req.params.lapId)) {
      return res.status(400).json({ error: "Bad lap" });
    }
    const { season, legacy } = await seasonAsked(req);
    const lap = readLap(season, req.params.trackKey, req.params.steamId, req.params.lapId ?? null, legacy);
    if (!lap) return res.status(404).json({ error: "No lap stored there" });
    const known = await leagueNames([lap.steamId]);
    res.json({ ...lap, driverId: known.get(lap.steamId)?.driverId ?? null, name: known.get(lap.steamId)?.name || lap.name });
  } catch (e) {
    next(e);
  }
});

export default router;
