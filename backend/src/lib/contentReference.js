// ---------------------------------------------------------------------------
// REFERENCE INSTALLS for the Windows Content Check.
//
// The race server hands out its data files but not the 3D models (.kn5) or
// the livery textures, so the full check can only say a model must EXIST,
// never that it is the right one. The way round that: an admin whose install
// matches the server runs the tool, and the tool uploads the file list of
// that install, path, size and MD5, never the files themselves. Every check
// after that compares the drivers' copies against it as well.
//
// One record per car and per track, on disk as JSON:
//   content-reference/car/<model>.json
//   content-reference/track/<track>.json   (all layouts the admin had; the
//                                           check picks the one in play)
//   { v: 1, kind, name, by, at, files: [{ p, s, m }] }   p relative to the
//                                                        car / track folder
//
// The server stays the authority. An upload is only taken when the files the
// server also holds hash the same on the admin's side, and a stored record is
// set aside as stale the moment the server's copy of one of those files
// changes (a new car or track version) — a reference must never argue with
// the server.
// ---------------------------------------------------------------------------
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONTENT_REFERENCE_DIR } from "./dataDirs.js";
import { classifyTrackFile, isSafeSegment } from "./acServerContent.js";

const MAX_FILES_PER_GROUP = 20000;
const MAX_GROUPS = 41; // a full grid of cars plus the track
const MD5_RE = /^[0-9a-f]{32}$/;

export function referenceFile(kind, name) {
  return join(CONTENT_REFERENCE_DIR, kind, `${name}.json`);
}

export function readReference(kind, name) {
  if (!["car", "track"].includes(kind) || !isSafeSegment(name)) return null;
  try {
    const file = referenceFile(kind, name);
    if (!existsSync(file)) return null;
    const rec = JSON.parse(readFileSync(file, "utf8"));
    return rec?.v === 1 && Array.isArray(rec.files) ? rec : null;
  } catch {
    return null;
  }
}

// Written to a temporary name first: a half-written reference would be read
// as an install with half its files missing.
export function writeReference(rec) {
  const file = referenceFile(rec.kind, rec.name);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec));
  renameSync(tmp, file);
}

// The tool's upload, checked and normalised:
//   { by, groups: [{ kind: "car"|"track", name, files: [{ p, s, m }] }] }
// Returns { by, groups } or { error }.
export function parseReferenceUpload(body) {
  const by = String(body?.by || "").trim().slice(0, 60) || "an admin";
  const groups = Array.isArray(body?.groups) ? body.groups : null;
  if (!groups?.length) return { error: "Nothing to save" };
  if (groups.length > MAX_GROUPS) return { error: "Too many cars and tracks in one upload" };
  const out = [];
  for (const g of groups) {
    if (!["car", "track"].includes(g?.kind) || !isSafeSegment(g?.name)) return { error: "Unknown car or track" };
    if (!Array.isArray(g.files) || !g.files.length) return { error: `No files for ${g.kind} ${g.name}` };
    if (g.files.length > MAX_FILES_PER_GROUP) return { error: `Too many files for ${g.kind} ${g.name}` };
    const files = [];
    const seen = new Set();
    for (const f of g.files) {
      const p = String(f?.p || "").replace(/\\/g, "/");
      const s = Number(f?.s);
      const m = String(f?.m || "").toLowerCase();
      if (!p.split("/").every(isSafeSegment) || !Number.isSafeInteger(s) || s < 0 || !MD5_RE.test(m)) {
        return { error: `Bad file entry in ${g.kind} ${g.name}` };
      }
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({ p, s, m });
    }
    out.push({ kind: g.kind, name: g.name, files });
  }
  return { by, groups: out };
}

// The files of a group the server ALSO hashes (from the full manifest), keyed
// by their path inside the car / track folder, lower case: Windows does not
// mind case, and neither does the comparison.
//
// `racingOnly` leaves out what only looks (map.ini and the like): a driver's
// copy may differ there and still race on the server, so it must neither stop
// an admin from saving a reference nor mark a saved one as out of date.
function serverHashesFor(manifest, base, { racingOnly = false } = {}) {
  const out = new Map();
  for (const f of manifest?.files || []) {
    if (f.source === "reference" || !f.md5 || !f.path.startsWith(`${base}/`)) continue;
    if (racingOnly && f.level === "cosmetic") continue;
    out.set(f.path.slice(base.length + 1).toLowerCase(), f.md5);
  }
  return out;
}

// Files the server hashes that the reference lacks or has in another version,
// counting only what matters for racing (kick / problem). Empty means the
// reference install races exactly like the server's content.
export function conflictsWithServer(manifest, kind, name, files) {
  const base = `content/${kind === "car" ? "cars" : "tracks"}/${name}`;
  const mine = new Map(files.map((f) => [f.p.toLowerCase(), f.m]));
  const out = [];
  for (const [rel, md5] of serverHashesFor(manifest, base, { racingOnly: true })) {
    if (mine.get(rel) !== md5) out.push(rel);
  }
  return out;
}

// A car file of the reference, judged like classifyTrackFile judges a track
// file. `skinsInUse` limits liveries to the ones on the grid.
export function classifyCarFile(rel, skinsInUse = null) {
  const parts = String(rel).split("/");
  const lower = parts.map((x) => x.toLowerCase());
  const name = lower[lower.length - 1];
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  // The server's own list covers these: the checksummed data and its trap.
  if (lower[0] === "data.acd" || lower[0] === "data" || lower[0] === "ui") return null;
  if (lower[0] === "skins") {
    if (parts.length < 3 || (skinsInUse && !skinsInUse.has(parts[1]))) return null;
    // Content Manager redraws these on the driver's side: false alarms.
    if (["preview.jpg", "livery.png", "ui_skin.json"].includes(name)) return null;
    return { level: "cosmetic", what: "a livery file: that car looks different for you." };
  }
  if (ext === ".kn5") {
    return name.includes("collider")
      ? { level: "problem", what: "the car's collision model: contact with other cars works differently for you." }
      : { level: "problem", what: "a 3D model of the car: it looks different from everyone else's." };
  }
  if (lower[0] === "extension" && [".ini", ".lua"].includes(ext)) return { level: "problem", what: "CSP car config (lights, sometimes physics extras)." };
  if ([".png", ".jpg", ".jpeg", ".json", ".txt", ".md"].includes(ext)) return null;
  if (ext === ".bank" || lower[0] === "sfx") return { level: "cosmetic", what: "car sounds." };
  return { level: "cosmetic", what: "car file." };
}

// A track file of the reference. Other layouts are left out: their folders
// and models_<layout>.ini mean nothing for the session in play.
export function classifyReferenceTrackFile(rel, config, layouts) {
  const parts = String(rel).split("/");
  const lower = parts.map((x) => x.toLowerCase());
  const name = lower[lower.length - 1];
  const cfg = String(config || "").toLowerCase();
  if (layouts.has(lower[0]) && lower[0] !== cfg) return null;
  const otherModels = name.match(/^models_(.+)\.ini$/);
  if (parts.length === 1 && otherModels && otherModels[1] !== cfg) return null;
  if (parts.length === 1 && name === "models.ini" && cfg) return null;
  // On a layout track the root data/ and ai/ are not the ones in use.
  if (cfg && ["data", "ai"].includes(lower[0])) return null;
  if (name.endsWith(".kn5")) {
    return /collision|road|physics|kerb|terrain|grass/.test(name)
      ? { level: "problem", what: "a 3D model the car drives on: grip and kerbs can feel different for you." }
      : { level: "problem", what: "a 3D model of the track: it looks different from everyone else's." };
  }
  return classifyTrackFile(rel);
}

// The reference entries for one full manifest: what to append to its files,
// and a line per car / track saying whose install it is or why it was set
// aside. Never mutates the manifest it is given (that one sits in a cache).
export function referenceEntriesFor(manifest, { read = readReference } = {}) {
  const entries = [];
  const references = [];
  const groups = [];
  const skinsByModel = new Map();
  for (const p of manifest?.present || []) {
    const m = p.path.match(/^content\/cars\/([^/]+)\/skins\/([^/]+)$/);
    if (m) (skinsByModel.get(m[1]) || skinsByModel.set(m[1], new Set()).get(m[1])).add(m[2]);
  }
  for (const f of manifest?.files || []) {
    const car = f.path.match(/^content\/cars\/([^/]+)\/data\.acd$/);
    if (car) groups.push({ kind: "car", name: car[1], group: f.group });
  }
  if (manifest?.track) {
    const trackFile = (manifest.files || []).find((f) => f.path.startsWith(`content/tracks/${manifest.track}/`));
    const group = trackFile?.group || (manifest.config ? `track ${manifest.track} (${manifest.config})` : `track ${manifest.track}`);
    groups.push({ kind: "track", name: manifest.track, group });
  }

  for (const g of groups) {
    const rec = read(g.kind, g.name);
    if (!rec) continue;
    const info = { group: g.group, kind: g.kind, name: g.name, by: rec.by, at: rec.at, stale: false, count: 0 };
    references.push(info);
    if (conflictsWithServer(manifest, g.kind, g.name, rec.files).length) {
      info.stale = true;
      continue;
    }
    const base = `content/${g.kind === "car" ? "cars" : "tracks"}/${g.name}`;
    const onServer = serverHashesFor(manifest, base);
    const layouts = new Set(
      rec.files
        .map((f) => f.p.toLowerCase().match(/^models_(.+)\.ini$/)?.[1])
        .filter(Boolean)
    );
    for (const f of rec.files) {
      if (onServer.has(f.p.toLowerCase())) continue; // the server's own hash wins
      const judged =
        g.kind === "car"
          ? classifyCarFile(f.p, skinsByModel.get(g.name) || new Set())
          : classifyReferenceTrackFile(f.p, manifest.config, layouts);
      if (!judged) continue;
      entries.push({ group: g.group, path: `${base}/${f.p}`, md5: f.m, size: f.s, source: "reference", ...judged });
      info.count++;
    }
  }
  return { entries, references };
}
