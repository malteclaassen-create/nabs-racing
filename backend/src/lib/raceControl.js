// ---------------------------------------------------------------------------
// Race control: the people watching a session live (on the TV board and with
// the NABS Race Control app in the game). Its own role, next to admin and
// steward: stewards judge reports afterwards, race control watches the race
// while it happens. Admins count as race control without being listed.
//
// Stored like the stewards (lib/stewards.js): a Setting with a JSON array of
// Discord ids, cached briefly. Each member of race control also gets a short
// pairing code, typed once into the game app so it can fetch collisions for
// that person. The codes live in one Setting as { discordId: { code, at } }.
// ---------------------------------------------------------------------------
import { randomInt } from "node:crypto";
import { isDiscordAdmin } from "./adminUsers.js";

const ROLE_KEY = "race_control_discord_ids";
const CODES_KEY = "race_control_codes";
const CACHE_MS = 30_000;

let roleCache = { set: null, at: 0 };
let codeCache = { map: null, at: 0 };

export function invalidateRaceControlCache() {
  roleCache = { set: null, at: 0 };
  codeCache = { map: null, at: 0 };
}

async function readJson(prisma, key, fallback) {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row?.value ? JSON.parse(row.value) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(prisma, key, value) {
  const v = JSON.stringify(value);
  await prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

export async function getRaceControlIds(prisma) {
  if (!roleCache.set || Date.now() - roleCache.at > CACHE_MS) {
    const arr = await readJson(prisma, ROLE_KEY, []);
    roleCache = { set: new Set(Array.isArray(arr) ? arr.map(String) : []), at: Date.now() };
  }
  return roleCache.set;
}

// Listed, or an admin.
export async function isRaceControl(prisma, discordId) {
  if (!discordId) return false;
  if ((await getRaceControlIds(prisma)).has(String(discordId))) return true;
  return isDiscordAdmin(prisma, discordId).catch(() => false);
}

export async function setRaceControl(prisma, discordId, on) {
  const ids = new Set(await getRaceControlIds(prisma));
  if (on) ids.add(String(discordId));
  else ids.delete(String(discordId));
  await writeJson(prisma, ROLE_KEY, [...ids]);
  // Taking the role away also takes the code, so the app stops at once.
  if (!on) await dropCode(prisma, discordId);
  invalidateRaceControlCache();
  return [...ids];
}

// ---- pairing codes ----------------------------------------------------------
// Six characters without the ones people mix up (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

async function codes(prisma) {
  if (!codeCache.map || Date.now() - codeCache.at > CACHE_MS) {
    const m = await readJson(prisma, CODES_KEY, {});
    codeCache = { map: m && typeof m === "object" ? m : {}, at: Date.now() };
  }
  return codeCache.map;
}

export function normaliseCode(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

// This person's code, made on first ask.
export async function codeFor(prisma, discordId) {
  const map = await codes(prisma);
  if (map[discordId]?.code) return map[discordId].code;
  return newCode(prisma, discordId);
}

// A fresh code; the old one stops working.
export async function newCode(prisma, discordId) {
  const map = { ...(await readJson(prisma, CODES_KEY, {})) };
  const taken = new Set(Object.values(map).map((v) => v?.code));
  let code = makeCode();
  while (taken.has(code)) code = makeCode();
  map[discordId] = { code, at: Date.now() };
  await writeJson(prisma, CODES_KEY, map);
  codeCache = { map, at: Date.now() };
  return code;
}

async function dropCode(prisma, discordId) {
  const map = { ...(await readJson(prisma, CODES_KEY, {})) };
  if (!map[discordId]) return;
  delete map[discordId];
  await writeJson(prisma, CODES_KEY, map);
}

// Who a code belongs to, if they still have the role.
export async function discordIdForCode(prisma, code) {
  const c = normaliseCode(code);
  if (c.length !== 6) return null;
  const map = await codes(prisma);
  const id = Object.keys(map).find((k) => map[k]?.code === c);
  if (!id) return null;
  return (await isRaceControl(prisma, id)) ? id : null;
}

// ---- is the app there? ------------------------------------------------------
// In memory: when each person's app last asked. Enough for "connected" on the
// admin page; a restart forgets it until the app's next question, seconds later.
const appSeen = new Map(); // discordId -> { first, last }
const APP_GONE_MS = 45_000;

export function markAppSeen(discordId, now = Date.now()) {
  const prev = appSeen.get(discordId);
  const fresh = !prev || now - prev.last > APP_GONE_MS;
  appSeen.set(discordId, { first: fresh ? now : prev.first, last: now });
}

export function appStatus(discordId, now = Date.now()) {
  const s = appSeen.get(discordId);
  if (!s) return { connected: false, since: null, lastSeen: null };
  return { connected: now - s.last <= APP_GONE_MS, since: s.first, lastSeen: s.last };
}

// Wrong codes, per address, so nobody can walk through all of them.
const misses = new Map(); // ip -> { n, since }
const MISS_WINDOW_MS = 10 * 60_000;
const MISS_LIMIT = 20;

export function tooManyMisses(ip, now = Date.now()) {
  const m = misses.get(ip);
  if (!m || now - m.since > MISS_WINDOW_MS) return false;
  return m.n >= MISS_LIMIT;
}

export function noteMiss(ip, now = Date.now()) {
  const m = misses.get(ip);
  if (!m || now - m.since > MISS_WINDOW_MS) misses.set(ip, { n: 1, since: now });
  else m.n++;
  if (misses.size > 5000) misses.clear();
}

export const __testing = { appSeen, misses, makeCode, ALPHABET };
