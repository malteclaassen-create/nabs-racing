// ---------------------------------------------------------------------------
// The headline numbers on the newcomer landing page.
//
// Two of them (teams, seasons) the site already knows from its own tables. The
// other two do not exist anywhere in the database:
//
//   Discord members — read live from Discord's public invite endpoint. The
//     league's own invite is already stored (Setting `social_discord`), and
//     `?with_counts=true` answers with an approximate member count for anyone,
//     no bot and no token involved. The same answer says how many of them are
//     online, which the landing page shows next to it. Cached for ten minutes:
//     this sits on the most visited page of the site, and an online count from
//     an hour ago would be a different evening.
//
//   Racing since — the archived seasons carry no dates at all (only S6 onward
//     have them), so "N years of racing" cannot be derived: the earliest dated
//     race is months old while the league is years old. It is therefore a
//     single admin-set year, next to the Discord link it belongs with.
// ---------------------------------------------------------------------------

const COUNTS_TTL_MS = 10 * 60 * 1000;
let countsCache = { value: null, at: 0 };
const NO_COUNTS = { members: null, online: null };

// The invite code out of whatever shape the admin pasted: a bare code, a
// discord.gg link, or a full discord.com/invite/... URL.
export function inviteCode(url) {
  if (!url) return null;
  const m = String(url).trim().match(/(?:discord\.(?:gg|com)\/(?:invite\/)?)?([A-Za-z0-9-]{2,32})\/?$/);
  return m ? m[1] : null;
}

// A positive whole number, or null. An invite to a server Discord will not
// describe comes back without the counts at all.
function positive(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Approximate member and online counts of the league's Discord, as
// { members, online }. Either is null when it cannot be read (no invite
// configured, invite expired, Discord unreachable). Null means the page simply
// leaves that figure out — a landing page must never wait on, or break because
// of, a third party.
export async function discordCounts(prisma) {
  const now = Date.now();
  const last = countsCache.value || NO_COUNTS;
  if (countsCache.value && now - countsCache.at < COUNTS_TTL_MS) return countsCache.value;
  try {
    const row = await prisma.setting.findUnique({ where: { key: "social_discord" } });
    const code = inviteCode(row?.value);
    if (!code) return last;
    const res = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return last; // keep the last good numbers
    const data = await res.json();
    const members = positive(data?.approximate_member_count);
    if (!members) return last;
    countsCache = { value: { members, online: positive(data?.approximate_presence_count) }, at: now };
    return countsCache.value;
  } catch {
    // Stale is better than nothing, and nothing is better than a broken page.
    return last;
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
