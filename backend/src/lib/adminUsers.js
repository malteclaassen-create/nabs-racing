// ---------------------------------------------------------------------------
// Discord accounts that are granted admin access. Stored as a Setting
// (`admin_discord_ids` = JSON array of Discord ids); the PIN login stays as the
// always-available fallback. When one of these users logs in with Discord they
// get admin rights automatically (no PIN). Checked live on every admin request
// (with a short cache) so granting/revoking takes effect immediately.
// ---------------------------------------------------------------------------
const KEY = "admin_discord_ids";
const CACHE_MS = 30_000;

let cache = { set: null, at: 0 };

export function invalidateAdminUsersCache() {
  cache = { set: null, at: 0 };
}

export async function getAdminDiscordIds(prisma) {
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

export async function isDiscordAdmin(prisma, discordId) {
  if (!discordId) return false;
  return (await getAdminDiscordIds(prisma)).has(String(discordId));
}

// Grant/revoke admin for one Discord id; persists the updated list.
export async function setDiscordAdmin(prisma, discordId, isAdmin) {
  const ids = new Set(await getAdminDiscordIds(prisma));
  if (isAdmin) ids.add(String(discordId));
  else ids.delete(String(discordId));
  const value = JSON.stringify([...ids]);
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  invalidateAdminUsersCache();
  return [...ids];
}
