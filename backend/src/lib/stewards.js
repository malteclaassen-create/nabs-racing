// ---------------------------------------------------------------------------
// Drivers appointed to steward: they can read EVERY incident report and answer
// in any of them, and that is the whole of it. No admin area, no results, no
// settings.
//
// It exists because judging incidents and running a league are two different
// jobs. Handing somebody the admin PIN so they can look at a report gives them
// the results editor and the championship with it; this gives them the reports
// and nothing else.
//
// Stored the same way admin access is (lib/adminUsers.js): a Setting holding a
// JSON array of DISCORD ids, cached briefly and re-read live. By Discord id and
// not by driver row on purpose — a steward is a person, and a person gets a new
// driver row every season. Driver.role was the other candidate and is the wrong
// shelf: it is per season row, and it already holds "safety car driver".
//
// An admin is a steward implicitly. Nobody should have to be added twice.
// ---------------------------------------------------------------------------
import { isDiscordAdmin } from "./adminUsers.js";

const KEY = "steward_discord_ids";
const CACHE_MS = 30_000;

let cache = { set: null, at: 0 };

export function invalidateStewardsCache() {
  cache = { set: null, at: 0 };
}

export async function getStewardDiscordIds(prisma) {
  const now = Date.now();
  if (!cache.set || now - cache.at > CACHE_MS) {
    try {
      const row = await prisma.setting.findUnique({ where: { key: KEY } });
      const arr = row?.value ? JSON.parse(row.value) : [];
      cache = { set: new Set(Array.isArray(arr) ? arr.map(String) : []), at: now };
    } catch {
      cache = { set: new Set(), at: now };
    }
  }
  return cache.set;
}

// Does this account get to see every report? Admins do, without being listed.
export async function isSteward(prisma, discordId) {
  if (!discordId) return false;
  if ((await getStewardDiscordIds(prisma)).has(String(discordId))) return true;
  return isDiscordAdmin(prisma, discordId);
}

// Appointed EXPLICITLY, ignoring the admin implication. The admin screen needs
// this to know whether a row's switch is on.
export async function isNamedSteward(prisma, discordId) {
  if (!discordId) return false;
  return (await getStewardDiscordIds(prisma)).has(String(discordId));
}

export async function setSteward(prisma, discordId, on) {
  const ids = new Set(await getStewardDiscordIds(prisma));
  if (on) ids.add(String(discordId));
  else ids.delete(String(discordId));
  const value = JSON.stringify([...ids]);
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  invalidateStewardsCache();
  return [...ids];
}
