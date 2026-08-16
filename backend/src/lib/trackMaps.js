// ---------------------------------------------------------------------------
// The real outline of a track, and the arithmetic that puts a world position on
// it.
//
// Assetto Corsa ships every track with an overhead map — `map.png` — and a
// `map.ini` that says how to place a world coordinate on it:
//
//     px = (x + X_OFFSET) / SCALE_FACTOR
//     py = (z + Z_OFFSET) / SCALE_FACTOR
//
// The league's server manager serves both publicly, and the live page already
// draws the cars on them (services/liveTiming.js). The telemetry laps record
// the same world coordinates the live page uses for the cars, so the same two
// files turn two recorded laps into two racing lines inside the real track
// edges — where they are, rather than floating in white space.
//
// The live page fetches these per RUNNING session and holds them in memory.
// This is the other half: any track that has laps, whether or not a server is
// on it right now, cached on disk beside the other things the league keeps
// (results archive, telemetry laps). A track map is 100-200 KB and never
// changes, so it is fetched once and kept.
//
// A track without a published map is a normal outcome, not a failure: the
// comparison falls back to drawing the lap's own outline, which is what it did
// before any of this existed. The miss is remembered for a while so a track
// nobody serves is not re-fetched on every page load.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { DATA_ROOT } from "./dataDirs.js";
import { LIVE_SERVERS } from "./liveServers.js";

export const TRACK_MAPS_DIR = join(DATA_ROOT, "track-maps");

const PNG_SIG = "89504e47";
const FETCH_MS = 8000;
// How long a track that answered with nothing is left alone. Long enough that
// a page can be opened repeatedly without hammering the server manager, short
// enough that a track added upstream today is picked up today.
const MISS_TTL_MS = 60 * 60 * 1000;
const misses = new Map(); // key -> at

const safe = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

function dirFor(track, layout) {
  return join(TRACK_MAPS_DIR, layout ? `${safe(track)}--${safe(layout)}` : safe(track));
}

// The same fields the live page's parser takes, from the same ini.
export function parseMapIni(text) {
  if (!text) return null;
  const num = (re) => {
    const m = text.match(re);
    return m ? parseFloat(m[1]) : null;
  };
  const width = num(/WIDTH\s*=\s*([\d.]+)/i);
  const height = num(/HEIGHT\s*=\s*([\d.]+)/i);
  const scaleFactor = num(/SCALE_FACTOR\s*=\s*([\d.]+)/i);
  if (!width || !height || !scaleFactor) return null;
  return {
    width,
    height,
    scaleFactor,
    xOffset: num(/X_OFFSET\s*=\s*(-?[\d.]+)/i) ?? 0,
    zOffset: num(/Z_OFFSET\s*=\s*(-?[\d.]+)/i) ?? 0,
    padding: num(/PADDING\s*=\s*(-?[\d.]+)/i) ?? 0,
  };
}

async function get(url, kind) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return kind === "buf" ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

// What is already on disk for this track, or null.
export function readTrackMap(track, layout) {
  const dir = dirFor(track, layout);
  const ini = join(dir, "map.ini");
  const png = join(dir, "map.png");
  if (!existsSync(ini) || !existsSync(png)) return null;
  try {
    const calib = JSON.parse(readFileSync(ini, "utf8"));
    return calib?.scaleFactor ? { calib, png } : null;
  } catch {
    return null;
  }
}

// Fetch it if we do not have it. Tries every server the league runs and both
// spellings of the path, the way the live page does — the same track can sit
// under its config folder or beside it depending on how it was installed.
export async function ensureTrackMap(track, layout) {
  const have = readTrackMap(track, layout);
  if (have) return have;

  const key = `${track}|${layout || ""}`;
  const missedAt = misses.get(key);
  if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return null;

  const enc = encodeURIComponent;
  for (const server of LIVE_SERVERS) {
    const base = `${String(server.origin).replace(/\/+$/, "")}/content/tracks`;
    const cfg = layout ? `${base}/${enc(track)}/${enc(layout)}` : `${base}/${enc(track)}`;
    const plain = `${base}/${enc(track)}`;

    let calib = null;
    for (const u of [`${cfg}/data/map.ini`, `${cfg}/map.ini`, `${plain}/data/map.ini`, `${plain}/map.ini`]) {
      calib = parseMapIni(await get(u, "text"));
      if (calib) break;
    }
    if (!calib) continue;

    let png = null;
    for (const u of [`${cfg}/map.png`, `${cfg}/data/map.png`, `${plain}/map.png`]) {
      const buf = await get(u, "buf");
      if (buf && buf.length > 1000 && buf.slice(0, 4).toString("hex") === PNG_SIG) {
        png = buf;
        break;
      }
    }
    if (!png) continue;

    const dir = dirFor(track, layout);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "map.png"), png);
    writeFileSync(join(dir, "map.ini"), JSON.stringify(calib));
    misses.delete(key);
    return { calib, png: join(dir, "map.png") };
  }

  misses.set(key, Date.now());
  return null;
}
