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
import prisma from "../lib/prisma.js";
import { telemetryScript } from "../lib/telemetryScript.js";
import { telemetryReadGate } from "../lib/telemetryAccess.js";
import { parseLapPayload, keepIfFaster, listTracks, listLaps, readLap, isTrackKey, isSteamId, isLapId, pruneSeasonsBefore } from "../lib/telemetryLaps.js";
import { recordTelemetryEvent } from "../lib/telemetryIngestLog.js";
import { getNameOverrides } from "../lib/persons.js";
import { ensureTrackMap } from "../lib/trackMaps.js";
import { resolveSeason } from "../services/seasonService.js";

const router = Router();

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

// Who is on the other end of a fetch, verbatim. On the night this was added,
// the whole diagnosis hinged on one "Script sent" row that could equally have
// been a joining car or an admin's browser refreshing the URL — the card had
// no way to say which. The raw User-Agent settles it: browsers announce
// themselves as Mozilla/..., the game's HTTP stack does not.
//
// Two more facts ride along because each once cost an evening: which script
// VERSION the config asked for (the &v= the race server's snippet carries —
// an old v on a fresh fetch means the server config is stale), and whether
// the client was revalidating a cached copy rather than downloading (CSP
// caches downloaded scripts on disk by URL, and a revalidation answered with
// 304 would keep the old script in the car while looking like a serve here).
function fetcher(req) {
  const bits = [String(req.get("user-agent") || "no user-agent")];
  if (req.query.v) bits.push(`v=${String(req.query.v).slice(0, 16)}`);
  if (req.get("if-none-match") || req.get("if-modified-since")) bits.push("revalidating");
  return bits.join(" · ");
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
    if (!secret) {
      recordTelemetryEvent("off");
      return res.status(503).json({ error: "Telemetry recording is switched off" });
    }
    if (String(req.query.key || "") !== secret) {
      recordTelemetryEvent("bad-key");
      return res.status(401).json({ error: "Bad key" });
    }
    // The app's Test button: proves URL + key without inventing a fake lap.
    if (req.query.ping) {
      recordTelemetryEvent("ping", { detail: fetcher(req) });
      return res.json({ ok: true, pong: true });
    }
    // The recorder's own voice, added the night a driver put 23 laps on the
    // timing screen and this file recorded nothing — with no way to say why
    // from outside the car. `hello` is the script's proof of life on its first
    // update tick (with the facts the silent failures hide behind: Steam id,
    // JSON, CSP build); `diag` is what became of a finished lap it did not
    // send. Both ride the query string alone, no body, so they survive a game
    // where JSON is exactly what is broken. Ahead of the flood gate on
    // purpose: when posts flood, these are what explains the flood.
    if (req.query.hello) {
      recordTelemetryEvent("car-alive", {
        detail: req.query.info,
        name: req.query.name,
        track: req.query.track,
      });
      return res.json({ ok: true });
    }
    if (req.query.diag) {
      recordTelemetryEvent("car-skipped", {
        detail: req.query.diag,
        name: req.query.name,
        track: req.query.track,
        lapTimeMs: req.query.lapms,
      });
      return res.json({ ok: true });
    }
    if (flooded()) {
      recordTelemetryEvent("flooded");
      return res.status(429).json({ error: "Too many laps at once" });
    }
    hits.push(Date.now());

    const parsed = parseLapPayload(req.body);
    if (!parsed.ok) {
      // The reason, verbatim: "Bad steamId" and "Implausible lap time" send
      // somebody to two different places, and the script cannot report either.
      recordTelemetryEvent("lap-refused", { detail: parsed.error });
      return res.status(400).json({ error: parsed.error });
    }
    // WHICH SEASON this lap belongs to is the site's to say, not the game's:
    // the car knows the track and nothing about the league's calendar. Stamped
    // on arrival, because the league runs different cars each season and a lap
    // is only comparable within one.
    parsed.lap.season = await activeSeasonNumber();
    const result = keepIfFaster(parsed.lap);
    // A lap that was too slow to keep is still a lap that ARRIVED, and the two
    // are counted apart for that reason: "not stored" is the recorder working,
    // not failing.
    recordTelemetryEvent(result.kept ? "lap-kept" : "lap-slower", {
      name: parsed.lap.name,
      track: parsed.lap.trackKey,
      lapTimeMs: parsed.lap.lapTimeMs,
    });
    dropOldSeasons(parsed.lap.season);
    grabTrackMap(parsed.lap.track, parsed.lap.layout);
    // `kept` tells the app whether the lap made this driver's stored three, so
    // the in-game line can say "saved" vs "your stored 1:31.2 stands".
    res.json({ ok: true, kept: result.kept, bestMs: result.bestMs, stored: result.stored });
  } catch (e) {
    next(e);
  }
});

// Take the track's map while the car is still on it.
//
// The comparison draws laps inside the real track edges using the map.png and
// map.ini the server manager publishes (lib/trackMaps.js). Fetching those the
// first time somebody OPENS a comparison is too late: the servers only serve
// what is installed, and a track is installed around the rounds it is used for
// — measured, not assumed, and half the circuits the league has raced answer
// 404 for their map today. A lap arriving is proof that the track is on a
// server right now, which makes it the one moment the map is certain to be
// there.
//
// Fire and forget, and cheap to call on every lap: ensureTrackMap returns
// immediately once the map is on disk, and remembers a miss for an hour so a
// track nobody publishes is not re-fetched by every post.
function grabTrackMap(track, layout) {
  ensureTrackMap(track, layout).catch(() => {});
}

// The first lap of a new season takes the old ones with it.
//
// Triggered here rather than by a clock or a button because this is the exact
// moment the old seasons stop being current: somebody is out on track in the
// new car. The guard is so that a busy practice evening does not read the
// directory on every post — the work only ever happens once per season, on
// whichever lap happens to be the first.
let prunedFor = null;
function dropOldSeasons(season) {
  if (!season || season === prunedFor) return;
  prunedFor = season;
  try {
    const gone = pruneSeasonsBefore(season);
    if (gone.length) {
      console.log(`[telemetry] season ${season} started: removed laps from season ${gone.join(", ")}`);
    }
  } catch {
    /* never worth failing an ingest over; the next new season tries again */
  }
}

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
    if (!secret || String(req.query.key || "") !== secret) {
      recordTelemetryEvent("script-refused");
      return res.status(404).end();
    }
    const base = `${req.protocol}://${req.get("host")}`;
    const { src, version } = telemetryScript();
    // replaceAll, learned the embarrassing way: the placeholder appears in the
    // template's own header comment too, and .replace() swapped only that one —
    // the served script compiled fine and would have posted to the literal
    // string "__INGEST_URL__" for ever.
    const body = src
      .replaceAll("__INGEST_URL__", `${base}/api/telemetry-laps/ingest?key=${secret}`)
      .replaceAll("__SCRIPT_VERSION__", version);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    // No caching, said every way HTTP can say it: a re-minted key or a fixed
    // recorder must reach the next fetch, not a stale copy. CSP's downloader
    // honors HTTP caching rules, and the real cache-buster is the &v= in the
    // URL (lib/telemetryScript.js) — but these headers are the belt to that
    // suspender.
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    // Counted AFTER the key check, so this number means "a car was handed the
    // recorder" and nothing else. It is the first half of the chain, and the
    // half a race server's config can break on its own — see
    // lib/telemetryIngestLog.js for why it is worth a counter at all.
    recordTelemetryEvent("script-served", { detail: fetcher(req) });
    // res.end, not res.send: send() stamps an ETag, and a client revalidating
    // against it would get an empty 304 — which a caching client reads as
    // "keep the copy you have", the exact opposite of everything above.
    res.end(body);
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

// GET /api/telemetry-laps/:trackKey/map -> the track's real outline, if the
// server manager publishes one, as the calibration plus a URL for the image.
//
// The lap's own recorded positions can always draw an outline of the racing
// line; this draws the TRACK, so two lines can be read against the kerbs they
// were actually near. Answers 404 when the track has no published map, which is
// a normal outcome for anything raced outside the league's own servers — the
// comparison falls back to the lap's own shape.
//
// Declared before the driver route below, or "map" is read as a Steam id.
router.get("/:trackKey/map", async (req, res, next) => {
  try {
    if (!isTrackKey(req.params.trackKey)) return res.status(400).json({ error: "Bad track key" });
    const { season, legacy } = await seasonAsked(req);
    // The AC track and layout ids, taken from a lap rather than from the slug:
    // the slug is lossy (lower case, punctuation folded) and the upstream path
    // needs them exactly as the game spells them.
    const one = listLaps(season, req.params.trackKey, legacy)[0];
    if (!one) return res.status(404).json({ error: "No laps at that track" });
    const map = await ensureTrackMap(one.track, one.layout);
    if (!map) return res.status(404).json({ error: "No published map for that track" });
    res.json({ ...map.calib, url: `/api/telemetry-laps/${req.params.trackKey}/map.png` });
  } catch (e) {
    next(e);
  }
});

router.get("/:trackKey/map.png", async (req, res, next) => {
  try {
    if (!isTrackKey(req.params.trackKey)) return res.status(400).json({ error: "Bad track key" });
    const { season, legacy } = await seasonAsked(req);
    const one = listLaps(season, req.params.trackKey, legacy)[0];
    const map = one ? await ensureTrackMap(one.track, one.layout) : null;
    if (!map) return res.status(404).end();
    // Immutable: a track's overhead map does not change, and the file is only
    // ever written once (lib/trackMaps.js).
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.sendFile(map.png);
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
