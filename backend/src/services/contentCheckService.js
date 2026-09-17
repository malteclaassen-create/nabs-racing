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
} from "../lib/acServerContent.js";

const CACHE_MS = 5 * 60 * 1000;
// A full grid is ~30 cars; beyond that something is wrong with the entry list
// and we are not going to read a gigabyte off the race server to find out.
const MAX_CARS = 40;

const cache = new Map(); // `${serverKey}|${sessionId ?? ""}` -> { at, promise }

export function invalidateContentCheckCache() {
  cache.clear();
}

export function contentCheckServers() {
  return LIVE_SERVERS.map((s) => ({ key: s.key, name: s.name, origin: s.origin }));
}

// The manifest for one server, for a named session or its newest one.
export async function getContentCheck(serverKey, { sessionId = null } = {}) {
  const server = LIVE_SERVERS.find((s) => s.key === serverKey) || LIVE_SERVERS.find((s) => s.key === DEFAULT_SERVER_KEY);
  if (!server) return null;
  const key = `${server.key}|${sessionId || ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;

  const promise = buildContentCheck(server, sessionId);
  cache.set(key, { at: Date.now(), promise });
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
