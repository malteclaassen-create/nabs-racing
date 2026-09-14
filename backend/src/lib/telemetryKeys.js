// ---------------------------------------------------------------------------
// The recorder key — one per series, because one per site was one too few.
//
// The in-game recorder (lib/telemetryOnlineScript.lua) has exactly one way to
// say where a lap came from: the key in the URL it was handed by the race
// server's config line. A car knows the track and the driver; it does not know
// that the server it joined is the Sunday league's. So the key IS the series:
// each league mints its own, pastes its own line into its own server, and a
// lap that arrives with that key belongs to that league's store — which is how
// two leagues on two servers stop landing in one list.
//
// Settings, per series slug:
//
//   telemetry_ingest_key:<slug>   the key, minted once and PERMANENT (the
//                                 reason is in routes/admin.js: it lives in a
//                                 config line written by whoever runs the
//                                 server, usually not the person clicking)
//   telemetry_ingest_off:<slug>   "1" while recording is paused. The key stays.
//
// The bare keys the site used before it had series were handed to the primary
// series once (adoptBareIngestKey, run from lib/ensureSchema.js), so the line
// already in that league's server config went on working unchanged.
//
// Read on every script fetch and every lap post, and changed about twice in
// the life of a series — so one query answers for ten seconds. A write
// invalidates, and a paused key goes dark on the next post either way.
// ---------------------------------------------------------------------------
import { randomUUID } from "crypto";
import { dbListSeries } from "./series.js";

export const TELEMETRY_KEY_RE = /^[a-f0-9]{32}$/;
export const keySettingOf = (slug) => `telemetry_ingest_key:${slug}`;
export const offSettingOf = (slug) => `telemetry_ingest_off:${slug}`;

// The bare settings from before there were series. Read once by the adoption
// below and never again.
const BARE_KEY = "telemetry_ingest_key";
const BARE_OFF = "telemetry_ingest_off";

const CACHE_MS = 10_000;
let cache = { at: 0, rows: null }; // [{ slug, key, paused }]

export function invalidateTelemetryKeys() {
  cache = { at: 0, rows: null };
}

// Every series with whatever key and pause flag it holds ("" when never
// minted). Private series included: a league is private exactly while it is
// being set up, and setting up is when its recorder gets switched on.
async function allConfigs(prisma) {
  const now = Date.now();
  if (cache.rows && now - cache.at < CACHE_MS) return cache.rows;
  let rows = [];
  try {
    const series = await dbListSeries(prisma, { includePrivate: true });
    const keys = series.flatMap((s) => [keySettingOf(s.slug), offSettingOf(s.slug)]);
    const settings = keys.length ? await prisma.setting.findMany({ where: { key: { in: keys } } }) : [];
    const get = (k) => settings.find((r) => r.key === k)?.value || "";
    rows = series.map((s) => ({
      slug: s.slug,
      key: get(keySettingOf(s.slug)),
      paused: get(offSettingOf(s.slug)) === "1",
    }));
  } catch {
    // A database that cannot answer has no keys: nothing is served, nothing is
    // accepted, and the next request asks again.
    rows = [];
  }
  cache = { at: now, rows };
  return rows;
}

// One series' recorder: { key, paused }. `key` is "" while none was ever made.
export async function readIngestConfig(prisma, slug) {
  const row = (await allConfigs(prisma)).find((r) => r.slug === slug);
  return row ? { key: row.key, paused: row.paused } : { key: "", paused: false };
}

// The series a key opens: { slug, paused }, or null when no series holds it.
// The caller decides what a paused match means (the script route and the
// ingest both go dark, and say so differently).
export async function seriesForKey(prisma, key) {
  const k = String(key || "");
  if (!k) return null;
  const row = (await allConfigs(prisma)).find((r) => r.key && r.key === k);
  return row ? { slug: row.slug, paused: row.paused } : null;
}

// Whether any series has a key at all — what tells "wrong key" (somebody is
// posting with a key that is not ours) from "recording was never switched on
// anywhere" (a 503 that says so, as it did when there was one key for the site).
export async function anyIngestKey(prisma) {
  return (await allConfigs(prisma)).some((r) => !!r.key);
}

async function writeSetting(prisma, key, value) {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

// Pause or resume one series' recorder. The key is untouched either way.
export async function setIngestPaused(prisma, slug, paused) {
  await writeSetting(prisma, offSettingOf(slug), paused ? "1" : "");
  invalidateTelemetryKeys();
}

// Switch a series' recorder on: with the key it already holds, with a key the
// admin typed in (a config line written before the site had one, or surviving
// a database loss), or with a freshly minted one. Returns { ok, key } or
// { ok: false, status, error } for the route to pass on.
//
// Two refusals, both about the permanence guarantee: a different key for a
// series that holds one is refused whatever the UI sent, and a key another
// series already holds is refused because the key is what tells their laps
// apart — two leagues on one key would be one league again.
export async function ensureIngestKey(prisma, slug, given = "") {
  const rows = await allConfigs(prisma);
  const mine = rows.find((r) => r.slug === slug)?.key || "";
  const typed = String(given || "").trim().toLowerCase();
  if (typed && !TELEMETRY_KEY_RE.test(typed)) {
    return { ok: false, status: 400, error: "A key must be 32 characters, 0-9 and a-f" };
  }
  if (mine && typed && typed !== mine) {
    return { ok: false, status: 409, error: "The key is permanent and cannot be replaced. Switching on brings back the existing key." };
  }
  if (!mine && typed && rows.some((r) => r.slug !== slug && r.key === typed)) {
    return { ok: false, status: 409, error: "Another series already uses that key. Each series needs its own, or their laps cannot be told apart." };
  }
  const key = mine || typed || randomUUID().replace(/-/g, "");
  await writeSetting(prisma, keySettingOf(slug), key);
  await writeSetting(prisma, offSettingOf(slug), "");
  invalidateTelemetryKeys();
  return { ok: true, key };
}

// Hand the site's one pre-series key to the series that was using it.
//
// Before there were series the key was minted once for the whole site, and
// it sits in a race server's config line that nobody wants to redo. The series
// that server belongs to is the primary one — the only one that existed — so
// its per-series settings take the bare values, once, and only where the
// series has none of its own yet. Idempotent by construction: a series that
// already holds a key is left alone, so a restored backup cannot overwrite a
// key minted since.
//
// Returns true when something was copied, so the boot log can say.
export async function adoptBareIngestKey(prisma, slug) {
  if (!slug) return false;
  const [bareKey, bareOff, ownKey] = await Promise.all([
    prisma.setting.findUnique({ where: { key: BARE_KEY } }).catch(() => null),
    prisma.setting.findUnique({ where: { key: BARE_OFF } }).catch(() => null),
    prisma.setting.findUnique({ where: { key: keySettingOf(slug) } }).catch(() => null),
  ]);
  if (!bareKey?.value || ownKey?.value) return false;
  await writeSetting(prisma, keySettingOf(slug), bareKey.value);
  await writeSetting(prisma, offSettingOf(slug), bareOff?.value === "1" ? "1" : "");
  invalidateTelemetryKeys();
  return true;
}
