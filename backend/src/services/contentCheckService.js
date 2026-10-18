// ---------------------------------------------------------------------------
// CONTENT CHECK — "why does the server kick me with Checksum failed?"
//
// Builds the list of files the race server checksums for a session, each with
// the MD5 of the SERVER's own copy (lib/acServerContent.js). The browser then
// hashes the driver's local files against it and names the one that differs,
// which is the same comparison Assetto Corsa makes when someone joins.
//
// Heavy-ish (a handful of half-megabyte reads off the race server), so one
// manifest per server is kept warm for a few minutes and every caller in that
// window awaits the same promise — a grid of twenty drivers all pasting the
// link at once must not turn into twenty passes over the server's content.
// ---------------------------------------------------------------------------
import { LIVE_SERVERS, DEFAULT_SERVER_KEY } from "../lib/liveServers.js";
import {
  latestSessionId,
  fetchSessionJson,
  hashServerFile,
  checksumPathsFor,
  sessionContentOf,
  sessionIdInfo,
  sessionSkinsOf,
  listServerDir,
  walkServerTree,
  kn5FilesOfModelsIni,
  classifyTrackFile,
  isSafeSegment,
  fetchServerText,
} from "../lib/acServerContent.js";
import { referenceEntriesFor } from "../lib/contentReference.js";

const CACHE_MS = 5 * 60 * 1000;
// A full grid is ~30 cars; beyond that something is wrong with the entry list
// and we are not going to read a gigabyte off the race server to find out.
const MAX_CARS = 40;

const cache = new Map(); // `${serverKey}|${sessionId ?? ""}` -> { at, promise }
// One live entry per server is the normal state (the public route only ever
// asks for the newest session). The cap is for the admin path that may name
// one: expired entries are dropped on every call, so nothing accumulates.
const MAX_CACHE_ENTRIES = 8;

export function invalidateContentCheckCache() {
  cache.clear();
}

export function contentCheckServers() {
  return LIVE_SERVERS.map((s) => ({ key: s.key, name: s.name, origin: s.origin }));
}

function serverFor(serverKey) {
  return LIVE_SERVERS.find((s) => s.key === serverKey) || LIVE_SERVERS.find((s) => s.key === DEFAULT_SERVER_KEY);
}

// The manifest for one server, for a named session or its newest one.
export async function getContentCheck(serverKey, { sessionId = null } = {}) {
  const server = serverFor(serverKey);
  if (!server) return null;
  return cached(`${server.key}|${sessionId || ""}`, () => buildContentCheck(server, sessionId));
}

// The FULL manifest for the newest session (the Windows tool's list): every
// file the server holds for the session's cars and track, not just the two
// the join checksums. See buildFullContentCheck.
//
// The reference installs (lib/contentReference.js) are merged in on every
// call rather than cached with the rest: an admin who has just saved one
// should see it used on the very next check.
export async function getFullContentCheck(serverKey) {
  const manifest = await getServerFullContentCheck(serverKey);
  if (!manifest?.session) return manifest;
  const { entries, references } = referenceEntriesFor(manifest);
  return { ...manifest, files: [...manifest.files, ...entries], references };
}

// The full manifest as the race server alone sees it: what a reference upload
// is checked against.
export async function getServerFullContentCheck(serverKey) {
  const server = serverFor(serverKey);
  if (!server) return null;
  return cached(`full|${server.key}`, () => buildFullContentCheck(server));
}

function cached(key, build) {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(k);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.promise;
  while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);

  const promise = build();
  cache.set(key, { at: now, promise });
  // A failed run must not sit in the cache for the rest of the window: the
  // race server being briefly unreachable would otherwise keep the page
  // broken for five minutes after it came back.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

async function buildContentCheck(server, sessionId) {
  const session = sessionId ? sessionIdInfo(sessionId) : await latestSessionId(server.origin);
  if (!session?.id) {
    return {
      server: { key: server.key, name: server.name },
      session: null,
      track: null,
      config: null,
      files: [],
      generatedAt: new Date().toISOString(),
      note: "This server has no session results to read a car list from yet.",
    };
  }
  const json = await fetchSessionJson(server.origin, session.id);
  const { track, config, cars } = sessionContentOf(json);
  const wanted = checksumPathsFor({ cars: cars.slice(0, MAX_CARS), track, config });

  // Read the server's own copies. One failure must not sink the manifest: a
  // file the server does not serve comes back as unreadable and the browser
  // says so for that row instead of showing nothing at all.
  const files = [];
  for (const entry of wanted) {
    let hashed = null;
    let error = null;
    try {
      hashed = await hashServerFile(server.origin, entry.path);
    } catch (e) {
      error = e?.message || "could not be read";
    }
    files.push({
      kind: entry.kind,
      label: entry.label,
      path: entry.path,
      inPlay: entry.inPlay,
      unpackedDir: entry.unpackedDir || null,
      md5: hashed?.md5 || null,
      size: hashed?.size ?? null,
      // null md5 with no error = the server itself does not have this file, so
      // it is not part of what it checksums.
      missingOnServer: !hashed && !error,
      error,
    });
  }

  return {
    server: { key: server.key, name: server.name },
    session: { id: session.id, type: session.type, date: session.date },
    track,
    config: config || null,
    carCount: cars.length,
    truncated: cars.length > MAX_CARS,
    files,
    generatedAt: new Date().toISOString(),
  };
}

// --- The full check -----------------------------------------------------------
//
// Everything the server lets us see about the session's content, sorted by
// what a difference would do (lib/acServerContent.js classifyTrackFile):
//
//   files   - hashed on the server; the driver's copy must hash the same
//   present - the server only proves these should exist (the .kn5 models a
//             layout loads, the liveries on the grid, the car's own model):
//             the driver's disk must have them
//   absent  - must NOT be on the driver's disk (an unpacked data folder,
//             which the game reads instead of the data.acd)
//
// Each entry carries `group` (the car or track it belongs to), `level`
// (kick / problem / cosmetic) and `what`, a sentence for the driver, so the
// tool only has to compare and print.

// Small, parallel, and in order: four requests at a time is quick enough for
// a 40-car grid and gentle on the race server.
async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function hashEntry(server, entry) {
  try {
    const hashed = await hashServerFile(server.origin, entry.path);
    return { ...entry, md5: hashed?.md5 || null, size: hashed?.size ?? null, missingOnServer: !hashed, error: null };
  } catch (e) {
    return { ...entry, md5: null, size: null, missingOnServer: false, error: e?.message || "could not be read" };
  }
}

async function buildFullContentCheck(server) {
  const session = await latestSessionId(server.origin);
  const head = { server: { key: server.key, name: server.name }, generatedAt: new Date().toISOString() };
  if (!session?.id) {
    return { ...head, session: null, track: null, config: null, files: [], present: [], absent: [], note: "This server has no session results to read a car list from yet." };
  }
  const json = await fetchSessionJson(server.origin, session.id);
  const { track, config, cars } = sessionContentOf(json);
  const skins = sessionSkinsOf(json);
  const toHash = [];
  const present = [];
  const absent = [];

  // Cars: the data.acd the join checksums, the car's own 3D model, the
  // liveries on the grid, and no unpacked data folder.
  const models = [...new Set(cars)].filter(isSafeSegment).sort().slice(0, MAX_CARS);
  const serverSkins = await mapLimited(models, 4, (m) => listServerDir(server.origin, `content/cars/${m}/skins`).catch(() => null));
  models.forEach((model, i) => {
    const group = `car ${model}`;
    const base = `content/cars/${model}`;
    toHash.push({
      group,
      path: `${base}/data.acd`,
      level: "kick",
      what: "the car's physics. The server checks this file: a different version gets you kicked (Checksum failed).",
    });
    absent.push({ group, path: `${base}/data`, level: "kick", what: "unpacked car data. The game reads it INSTEAD of the data.acd: delete this folder." });
    present.push({ group, path: base, type: "anyKn5", level: "problem", what: "the car's 3D model (.kn5). Without it the car is not installed properly." });
    // Only liveries the server itself has: an entry-list skin it lacks is
    // the server's mistake, not the driver's.
    const onServer = new Set((serverSkins[i] || []).filter((e) => e.dir).map((e) => e.name));
    for (const skin of skins[model] || []) {
      if (!isSafeSegment(skin) || !onServer.has(skin)) continue;
      present.push({ group, path: `${base}/skins/${skin}`, type: "dir", level: "cosmetic", what: "a livery on the grid. Without it you see that car in another livery." });
    }
  });

  // Track: every data file of the layout in play (or of the track itself when
  // it has no layouts), the models list, and each model that list loads.
  if (track && isSafeSegment(track) && (!config || isSafeSegment(config))) {
    const group = config ? `track ${track} (${config})` : `track ${track}`;
    const base = `content/tracks/${track}`;
    present.push({ group, path: config ? `${base}/${config}` : base, type: "dir", level: "kick", what: config ? "the layout folder. Without it you cannot join this session." : "the track folder. Without it you cannot join." });
    // A track's own extension folder (CSP config) counts for every layout.
    const dirs = [...(config ? [config] : ["data", "ai"]), "extension"].map((d) => `${base}/${d}`);
    for (const dir of dirs) {
      for (const path of await walkServerTree(server.origin, dir)) {
        const judged = classifyTrackFile(path.slice(base.length + 1));
        if (judged) toHash.push({ group, path, ...judged });
      }
    }
    const modelsIni = `${base}/${config ? `models_${config}.ini` : "models.ini"}`;
    // No models list readable: the models simply go unchecked.
    const iniText = await fetchServerText(server.origin, modelsIni).catch(() => null);
    if (iniText != null) {
      toHash.push({ group, path: modelsIni, level: "problem", what: "which 3D models the track loads." });
      for (const rel of kn5FilesOfModelsIni(iniText)) {
        present.push({ group, path: `${base}/${rel}`, type: "file", level: "problem", what: "a 3D model this layout loads. Without it the track does not load or the game crashes." });
      }
    } else if (!config) {
      // A track without models.ini loads <track>.kn5 straight from its folder.
      present.push({ group, path: `${base}/${track}.kn5`, type: "file", level: "problem", what: "the track's 3D model. Without it the track does not load." });
    }
  }

  const files = await mapLimited(toHash, 4, (entry) => hashEntry(server, entry));
  return {
    ...head,
    session: { id: session.id, type: session.type, date: session.date },
    track,
    config: config || null,
    carCount: cars.length,
    truncated: cars.length > MAX_CARS,
    files,
    present,
    absent,
  };
}
