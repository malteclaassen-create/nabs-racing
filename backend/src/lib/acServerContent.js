// ---------------------------------------------------------------------------
// THE RACE SERVER'S OWN CONTENT, read over HTTP.
//
// Assetto Corsa kicks a driver with "Checksum failed" when one of the files
// the server checksums does not hash the same on their machine. The set is
// small and fixed:
//
//   * content/cars/<model>/data.acd            for every car in the entry list
//   * content/tracks/<track>/data/surfaces.ini and, on a track with layouts,
//     content/tracks/<track>/<layout>/data/surfaces.ini
//
// The league's servers run the Assetto Corsa Server Manager (Emperor Servers),
// and that manager serves its content folder as plain files — /content/cars/…
// and /content/tracks/… answer 200 without a login. So the SERVER's own copy
// is readable from here, and hashing it gives exactly the numbers it will
// compare a joining driver against. That is what makes the check in
// services/contentCheckService.js an answer rather than an educated guess.
//
// What is NOT readable: the .kn5 models (the manager 404s them). If a server
// ever adds model checksums of its own, this cannot see them — see the note
// the check hands to the browser.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";

// A car's data.acd is ~0.5 MB, a surfaces.ini a few kB. Anything far bigger is
// not a file we asked for, so the cap is a guard against a proxy handing us an
// error page the size of a movie rather than a real limit. Checked on the
// header first where there is one: a capped read that downloads the whole
// thing before refusing it has spent the memory it was meant to save.
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 30000;

// AC result ids look like 2026_9_11_19_33_RACE.
const SESSION_ID_RE = /^\d{4}_\d{1,2}_\d{1,2}_\d{1,2}_\d{1,2}_[A-Z]+$/;

// A session id's own timestamp, so "the newest session" needs no extra lookup.
export function sessionIdInfo(id) {
  const parts = String(id || "").split("_");
  const type = parts[parts.length - 1] || null;
  const [y, mo, d, h, mi] = parts.slice(0, 5).map(Number);
  const ts = [y, mo, d, h, mi].every((n) => Number.isFinite(n)) ? Date.UTC(y, mo - 1, d, h, mi) : null;
  return { id, type, ts, date: ts != null ? new Date(ts).toISOString() : null };
}

async function fetchWithTimeout(url, { as = "text", timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: as === "json" ? "application/json" : "*/*" },
    });
    if (!res.ok) {
      const err = new Error(`Server responded ${res.status}`);
      err.status = res.status;
      throw err;
    }
    if (as === "json") return res.json();
    if (as === "buffer") {
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) throw new Error("File too large");
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_FILE_BYTES) throw new Error("File too large");
      return buf;
    }
    return res.text();
  } finally {
    clearTimeout(t);
  }
}

// The newest session the manager lists, whatever its type: practice counts.
// A driver who cannot join is usually trying to join the session that is
// running right now, and that is the content the server is holding open.
export async function latestSessionId(origin) {
  const html = await fetchWithTimeout(`${origin.replace(/\/$/, "")}/results`);
  const ids = [...html.matchAll(/\/results\/([A-Za-z0-9_]+)/g)]
    .map((m) => m[1])
    .filter((id) => SESSION_ID_RE.test(id));
  if (!ids.length) return null;
  const rows = [...new Set(ids)].map(sessionIdInfo).filter((r) => r.ts != null);
  rows.sort((a, b) => b.ts - a.ts);
  return rows[0] || null;
}

// One session's raw AC result JSON — where the entry list and the track come
// from. Same file the results import already reads (services/emperorResults).
export async function fetchSessionJson(origin, id) {
  if (!SESSION_ID_RE.test(id)) throw new Error("Invalid session id");
  return fetchWithTimeout(`${origin.replace(/\/$/, "")}/results/download/${id}.json`, { as: "json" });
}

// Hash one file of the server's content folder. Returns { md5, size } or null
// when the server does not have it (404) — a missing file is an answer too:
// it means the server checksums something else, not that the check failed.
export async function hashServerFile(origin, relPath) {
  try {
    const buf = await fetchWithTimeout(`${origin.replace(/\/$/, "")}/${relPath}`, { as: "buffer" });
    return { md5: createHash("md5").update(buf).digest("hex"), size: buf.length };
  } catch (e) {
    if (e?.status === 404) return null;
    throw e;
  }
}

// The files AC will checksum for one session, as relative content paths.
// `cars` are the models of the entry list, `track`/`config` the circuit and
// its layout ("" for a track without layouts).
//
// Both surfaces.ini of a layout track are listed: the layout's own file is the
// one that counts for that config, but the track root carries one too and the
// two are NOT identical — a check comparing the wrong one reports a problem
// that does not exist. Listing both, with the layout marked as the one in
// play, lets the browser say which is which.
export function checksumPathsFor({ cars = [], track, config }) {
  const out = [];
  for (const model of [...new Set(cars)].filter(Boolean).sort()) {
    out.push({
      kind: "car",
      label: model,
      path: `content/cars/${model}/data.acd`,
      // An unpacked data/ folder beside the .acd wins over it in game, and its
      // files hash to something else entirely. Classic cause of a kick after
      // somebody clicked "Unpack data" in Content Manager.
      unpackedDir: `content/cars/${model}/data`,
      inPlay: true,
    });
  }
  if (track) {
    if (config) {
      out.push({
        kind: "track",
        label: `${track} · ${config}`,
        path: `content/tracks/${track}/${config}/data/surfaces.ini`,
        inPlay: true,
      });
    }
    out.push({
      kind: "track",
      label: config ? `${track} (track root)` : track,
      path: `content/tracks/${track}/data/surfaces.ini`,
      // On a layout track the root file is carried for completeness only: the
      // session runs on the layout's copy.
      inPlay: !config,
    });
  }
  return out;
}

// Track, layout and entry list of a session result, as the manifest needs them.
export function sessionContentOf(json) {
  const cars = [...new Set((json?.Cars || []).map((c) => c?.Model).filter(Boolean))];
  return {
    track: json?.TrackName || null,
    // AC writes the layout in TrackConfig; "" on a track without layouts.
    config: json?.TrackConfig || "",
    cars,
  };
}
