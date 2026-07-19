// ---------------------------------------------------------------------------
// Discord login accounts ("MemberAccount"): one row per Discord account that
// has ever logged in on the site, whether or not it could be matched to a
// Driver. Powers the admin Members tab (see who registered, link them to a
// roster driver by hand, ban accounts) and the ban check on every
// authenticated request.
//
// Like Download, the table is managed via raw SQL rather than the generated
// Prisma client (the running dev server locks the client engine on Windows).
// Keep the columns in sync with the MemberAccount model in prisma/schema.prisma.
// ---------------------------------------------------------------------------

// Plain, JSON-safe shape (raw SQLite rows carry BigInt for INTEGER columns and
// 0/1 for booleans).
export function shapeMember(r) {
  if (!r) return null;
  return {
    discordId: r.discordId,
    username: r.username,
    displayName: r.displayName ?? null,
    avatarUrl: r.avatarUrl ?? null,
    banned: !!Number(r.banned),
    banReason: r.banReason ?? null,
    firstLoginAt: r.firstLoginAt,
    lastLoginAt: r.lastLoginAt,
    loginCount: Number(r.loginCount) || 0,
    // "I want to race" hand-raise from the Attendance page (accounts without
    // a driver profile). Cleared once the account is linked / gets a driver.
    raceRequestAt: r.raceRequestAt ?? null,
    raceRequestText: r.raceRequestText ?? null,
  };
}

export async function dbSetRaceRequest(prisma, discordId, text) {
  await prisma.$executeRaw`
    UPDATE "MemberAccount" SET
      "raceRequestAt" = ${new Date().toISOString()},
      "raceRequestText" = ${text ?? null}
    WHERE "discordId" = ${discordId}`;
  return dbGetMember(prisma, discordId);
}

export async function dbClearRaceRequest(prisma, discordId) {
  await prisma.$executeRaw`
    UPDATE "MemberAccount" SET "raceRequestAt" = NULL, "raceRequestText" = NULL
    WHERE "discordId" = ${discordId}`;
}

export async function dbGetMember(prisma, discordId) {
  const rows = await prisma.$queryRaw`SELECT * FROM "MemberAccount" WHERE "discordId" = ${discordId} LIMIT 1`;
  return rows[0] || null;
}

export async function dbListMembers(prisma) {
  return prisma.$queryRaw`SELECT * FROM "MemberAccount" ORDER BY "lastLoginAt" DESC`;
}

// Called on every successful Discord login: create the account row on first
// sight, otherwise refresh names/avatar and bump the login counter.
export async function dbRecordLogin(prisma, { discordId, username, displayName, avatarUrl }) {
  const now = new Date().toISOString();
  const existing = await dbGetMember(prisma, discordId);
  if (existing) {
    await prisma.$executeRaw`
      UPDATE "MemberAccount" SET
        "username" = ${username},
        "displayName" = ${displayName ?? null},
        "avatarUrl" = ${avatarUrl ?? null},
        "lastLoginAt" = ${now},
        "loginCount" = "loginCount" + 1
      WHERE "discordId" = ${discordId}`;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "MemberAccount"
        ("discordId","username","displayName","avatarUrl","banned","banReason","firstLoginAt","lastLoginAt","loginCount")
      VALUES (${discordId}, ${username}, ${displayName ?? null}, ${avatarUrl ?? null}, 0, NULL, ${now}, ${now}, 1)`;
  }
  return dbGetMember(prisma, discordId);
}

export async function dbSetBanned(prisma, discordId, banned, reason = null) {
  await prisma.$executeRaw`
    UPDATE "MemberAccount" SET
      "banned" = ${banned ? 1 : 0},
      "banReason" = ${banned ? reason ?? null : null}
    WHERE "discordId" = ${discordId}`;
  invalidateBanCache();
  return dbGetMember(prisma, discordId);
}

// --- ban check with a short cache -------------------------------------------
// Sessions are stateless JWTs, so banning must be enforced per request. A tiny
// in-memory cache (refreshed at most every BAN_CACHE_MS) keeps that to roughly
// one DB read a minute instead of one per request. Ban/unban invalidates it
// immediately, so an admin action takes effect on the very next request.
const BAN_CACHE_MS = 60_000;
let banCache = { set: null, at: 0 };

export function invalidateBanCache() {
  banCache = { set: null, at: 0 };
}

export async function getBannedSet(prisma) {
  const now = Date.now();
  if (!banCache.set || now - banCache.at > BAN_CACHE_MS) {
    try {
      const rows = await prisma.$queryRaw`SELECT "discordId" FROM "MemberAccount" WHERE "banned" = 1`;
      banCache = { set: new Set(rows.map((r) => r.discordId)), at: now };
    } catch {
      // Table missing (fresh checkout before migrations): treat as no bans.
      banCache = { set: new Set(), at: now };
    }
  }
  return banCache.set;
}

export async function isBanned(prisma, discordId) {
  if (!discordId) return false;
  return (await getBannedSet(prisma)).has(discordId);
}
