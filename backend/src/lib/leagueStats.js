// ---------------------------------------------------------------------------
// The headline numbers on the newcomer landing page.
//
// Two of them (teams, seasons) the site already knows from its own tables. The
// other two do not exist anywhere in the database:
//
//   Discord members — read live from Discord's public invite endpoint. The
//     league's own invite is already stored (Setting `social_discord`), and
//     `?with_counts=true` answers with an approximate member count for anyone,
//     no bot and no token involved. Cached for an hour: this sits on the most
//     visited page of the site and the number moves by a handful a week.
//
//   Racing since — the archived seasons carry no dates at all (only S6 onward
//     have them), so "N years of racing" cannot be derived: the earliest dated
//     race is months old while the league is years old. It is therefore a
//     single admin-set year, next to the Discord link it belongs with.
// ---------------------------------------------------------------------------

const MEMBERS_TTL_MS = 60 * 60 * 1000;
let membersCache = { value: null, at: 0 };

// The invite code out of whatever shape the admin pasted: a bare code, a
// discord.gg link, or a full discord.com/invite/... URL.
export function inviteCode(url) {
  if (!url) return null;
  const m = String(url).trim().match(/(?:discord\.(?:gg|com)\/(?:invite\/)?)?([A-Za-z0-9-]{2,32})\/?$/);
  return m ? m[1] : null;
}

// Approximate member count of the league's Discord, or null when it cannot be
// read (no invite configured, invite expired, Discord unreachable). Null means
// the tile simply shows something else — a landing page must never wait on, or
// break because of, a third party.
export async function discordMemberCount(prisma) {
  const now = Date.now();
  if (membersCache.value != null && now - membersCache.at < MEMBERS_TTL_MS) return membersCache.value;
  try {
    const row = await prisma.setting.findUnique({ where: { key: "social_discord" } });
    const code = inviteCode(row?.value);
    if (!code) return membersCache.value;
    const res = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return membersCache.value; // keep the last good number
    const data = await res.json();
    const n = Number(data?.approximate_member_count);
    if (!Number.isFinite(n) || n <= 0) return membersCache.value;
    membersCache = { value: n, at: now };
    return n;
  } catch {
    // Stale is better than nothing, and nothing is better than a broken page.
    return membersCache.value;
  }
}

export async function leagueSince(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "league_since" } });
    const n = Number(row?.value);
    return Number.isFinite(n) && n > 2000 && n <= new Date().getFullYear() ? n : null;
  } catch {
    return null;
  }
}

export async function setLeagueSince(prisma, year) {
  const value = year == null || year === "" ? "" : String(Number(year) || "");
  await prisma.setting.upsert({
    where: { key: "league_since" },
    update: { value },
    create: { key: "league_since", value },
  });
  return leagueSince(prisma);
}

// Rounded DOWN, and never below 1: "3 years of racing" should not become "4"
// the moment the calendar year ticks over in January.
export function yearsOfRacing(since) {
  if (!since) return null;
  const years = new Date().getFullYear() - since;
  return years >= 1 ? years : null;
}
