// Who is in the briefing, and who from the grid isn't.
// One briefing channel for every series. The bot only looks at it from 5 min
// before a race's start till an hour after (BRIEFING_WINDOW), and reports on
// joins/leaves and once a minute while people are in it.
// Memory only, a restart just waits for the next report.
import { getPersonGroups, discordIdsForDrivers } from "./persons.js";
import { collapseByPerson, byNewestAnswer } from "./onePerPerson.js";
import { dbListSeries, seasonIdsOfSeries } from "./series.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { readRaceTypes } from "./raceTypes.js";
import { readHiddenRaceIds } from "./attendanceHidden.js";
import { raceKickoff } from "./raceKickoff.js";

let room = null;

const MAX_MEMBERS = 200;

// What the bot sent, tidied. Anything without an id is dropped.
export function setBriefingRoom(body, now = Date.now()) {
  const members = (Array.isArray(body?.members) ? body.members : [])
    .slice(0, MAX_MEMBERS)
    .map((m) => ({ discordId: String(m?.discordId || ""), name: m?.name ? String(m.name).slice(0, 80) : null }))
    .filter((m) => /^\d{5,25}$/.test(m.discordId));
  room = {
    watching: body?.watching !== false,
    channelId: body?.channelId ? String(body.channelId) : null,
    channelName: body?.channelName ? String(body.channelName).slice(0, 100) : null,
    members,
    at: now,
  };
  return room;
}

export const getBriefingRoom = () => room;

// bot repeats itself every minute while the room is busy, 3 min quiet = bot down
export const STALE_MS = 3 * 60 * 1000;

// when the bot looks at the briefing channel, around each race's start
export const BRIEFING_WINDOW = { beforeMin: 5, afterMin: 60 };

export function inBriefingWindow(kickoffs, now = Date.now(), win = BRIEFING_WINDOW) {
  return (kickoffs || []).some((k) => {
    const t = new Date(k).getTime();
    return Number.isFinite(t) && now >= t - win.beforeMin * 60_000 && now <= t + win.afterMin * 60_000;
  });
}

// "Start now" in the admin: the bot watches till this time, whatever the
// start times say. Kept in Settings so a site restart mid-briefing keeps it.
const MANUAL_KEY = "briefing_manual_until";
export const MANUAL_MIN = 60;

export async function readManualUntil(prisma, now = Date.now()) {
  const row = await prisma.setting.findUnique({ where: { key: MANUAL_KEY } }).catch(() => null);
  const until = Number(row?.value);
  return until > now ? until : null;
}

// null stops it
export async function setManualUntil(prisma, until) {
  if (!until) {
    await prisma.setting.deleteMany({ where: { key: MANUAL_KEY } });
    return null;
  }
  const value = String(until);
  await prisma.setting.upsert({ where: { key: MANUAL_KEY }, create: { key: MANUAL_KEY, value }, update: { value } });
  return until;
}

// two per series covers a Friday + Sunday weekend
const PER_SERIES = 2;

// one race's accepted drivers against the room. no Discord id = can't check.
// extras = in the room but not on this grid
export function compareWithRoom(grid, roomMembers) {
  const inRoom = new Set((roomMembers || []).map((m) => m.discordId));
  const onGrid = new Set();
  const missing = [];
  const present = [];
  const unlinked = [];
  for (const d of grid || []) {
    if (!d.discordUserId) {
      unlinked.push(d);
      continue;
    }
    onGrid.add(d.discordUserId);
    (inRoom.has(d.discordUserId) ? present : missing).push(d);
  }
  const extras = (roomMembers || []).filter((m) => !onGrid.has(m.discordId));
  return { missing, present, unlinked, extras };
}

// The next races of every series the public can see.
async function nextRaces(prisma) {
  const series = await dbListSeries(prisma);
  const priv = await getPrivateSeasonIds(prisma);
  const seasonToSeries = new Map();
  for (const s of series) {
    for (const season of await seasonIdsOfSeries(prisma, s.id)) {
      if (!priv.has(season.id)) seasonToSeries.set(season.id, s);
    }
  }
  if (!seasonToSeries.size) return [];

  const upcoming = await prisma.race.findMany({
    where: { isCompleted: false, seasonId: { in: [...seasonToSeries.keys()] } },
    select: { id: true, number: true, track: true, country: true, date: true, seasonId: true, isSpecialEvent: true },
  });
  const [types, hidden] = await Promise.all([
    readRaceTypes(prisma, upcoming.map((r) => r.id)),
    readHiddenRaceIds(prisma),
  ]);
  const typeOf = (r) => types.get(r.id) || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");

  // same queue as the attendance page: no special events, no hidden rounds
  const bySeries = new Map();
  for (const r of upcoming) {
    if (typeOf(r) === "SPECIAL" || hidden.has(r.id)) continue;
    const s = seasonToSeries.get(r.seasonId);
    const list = bySeries.get(s.id) || [];
    list.push({ ...r, type: typeOf(r), kickoff: raceKickoff(r.date), series: s });
    bySeries.set(s.id, list);
  }
  const races = [];
  for (const list of bySeries.values()) {
    list.sort((a, b) => (a.kickoff?.getTime() ?? Infinity) - (b.kickoff?.getTime() ?? Infinity));
    races.push(...list.slice(0, PER_SERIES));
  }
  return races.sort((a, b) => (a.kickoff?.getTime() ?? Infinity) - (b.kickoff?.getTime() ?? Infinity));
}

// start times only, for the bot
export async function briefingKickoffs(prisma) {
  return (await nextRaces(prisma)).filter((r) => r.kickoff).map((r) => r.kickoff.toISOString());
}

// the next races with who accepted
export async function briefingRaces(prisma) {
  const races = await nextRaces(prisma);
  if (!races.length) return [];

  const [rsvps, people] = await Promise.all([
    prisma.raceRsvp.findMany({
      where: { raceId: { in: races.map((r) => r.id) } },
      include: { driver: { include: { team: { select: { name: true, color: true, tier: true } } } } },
    }),
    getPersonGroups(prisma).catch(() => ({ byDriver: new Map() })),
  ]);
  const accepted = new Map(races.map((r) => [r.id, []]));
  for (const race of races) {
    const own = rsvps.filter((a) => a.raceId === race.id);
    for (const a of collapseByPerson(own, people.byDriver, byNewestAnswer).kept) {
      if (a.status === "ACCEPTED") accepted.get(race.id).push(a.driver);
    }
  }
  const discordIds = await discordIdsForDrivers(
    prisma,
    [...accepted.values()].flat().map((d) => d.id)
  ).catch(() => new Map());

  return races.map((r) => ({
    id: r.id,
    number: r.number,
    type: r.type,
    track: r.track,
    country: r.country || null,
    date: r.date,
    kickoff: r.kickoff ? r.kickoff.toISOString() : null,
    series: { slug: r.series.slug, name: r.series.name },
    grid: accepted
      .get(r.id)
      .map((d) => ({
        driverId: d.id,
        name: d.name,
        discordName: d.discordName || null,
        discordUserId: discordIds.get(d.id) || null,
        team: d.team?.name || null,
        teamColor: d.team?.color || null,
        tier: d.team?.tier ?? d.tier,
      }))
      // teams in tier order, reserves (tier 0) last
      .sort(
        (a, b) =>
          (a.tier || 9) - (b.tier || 9) ||
          (a.team || "").localeCompare(b.team || "") ||
          a.name.localeCompare(b.name)
      ),
  }));
}

// the admin page asks every few seconds during a briefing. the room changes
// that fast, the grid doesn't, so the grid is reused for a little while
let cache = null;
export async function cachedBriefingRaces(prisma, maxAgeMs = 20_000, now = Date.now()) {
  if (cache && now - cache.at < maxAgeMs) return cache.races;
  const races = await briefingRaces(prisma);
  cache = { at: now, races };
  return races;
}
