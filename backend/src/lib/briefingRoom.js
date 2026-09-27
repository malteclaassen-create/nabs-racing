// Who is in the briefing, and who from the grid isn't.
// One briefing channel for every series. The bot reports it only while people
// are in it (joins, leaves, once a minute), and once more when it empties.
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

// The next races of every series the public can see, with who accepted.
export async function briefingRaces(prisma) {
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
  if (!races.length) return [];
  races.sort((a, b) => (a.kickoff?.getTime() ?? Infinity) - (b.kickoff?.getTime() ?? Infinity));

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
