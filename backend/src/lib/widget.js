// ---------------------------------------------------------------------------
// The home screen widget (GET /api/widget): the few numbers an iPhone widget
// (Scriptable) has room for — the next round, the last round's podium and the
// top of the driver table — in one small, public, cacheable answer.
//
// Every figure is the one the Home page shows, because it comes out of the
// same code: the calendar the way /api/races builds it, the next round picked
// by the Home page's own nextUpcomingRace (imported from the frontend, not
// copied), the podium from raceDetailPayload (what /api/races/:id/results
// sends) and the table from getDriverStandings (/api/standings/drivers). The
// widget and the site can therefore never disagree about who is P1.
//
// Public on purpose and cached by shared caches for five minutes, so private
// seasons stay out of it even for a signed-in admin.
// ---------------------------------------------------------------------------
import { resolveSeason } from "../services/seasonService.js";
import { getDriverStandings } from "../services/standingsService.js";
import { raceDetailPayload } from "../services/raceDetailService.js";
import { readParentIds } from "./sprintRaces.js";
import { readRaceTypes } from "./raceTypes.js";
import { raceKickoff, LEAGUE_TZ } from "./raceKickoff.js";
import { nextUpcomingRace } from "../../../frontend/src/utils/raceFormat.js";
import { seasonGameParts } from "../../../frontend/src/utils/seasonGame.js";

const PODIUM_SIZE = 3;
const STANDINGS_SIZE = 5;

// The season's calendar as /api/races lists it, reduced to what the Home page
// reads from it: sprint classifications left out (they belong to their event),
// each row typed the same way, ordered by round number.
async function seasonCalendar(prisma, seasonId) {
  const all = await prisma.race.findMany({
    where: { seasonId },
    orderBy: { number: "asc" },
    include: { season: { select: { id: true, number: true } } },
  });
  const parentOf = await readParentIds(prisma, all.map((r) => r.id));
  const races = all.filter((r) => !parentOf.has(r.id));
  const types = await readRaceTypes(prisma, races.map((r) => r.id));
  return races.map((r) => ({ ...r, type: types.get(r.id) || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP") }));
}

// The Home page's two picks from that calendar: the last championship round
// with its result in, and the next race on the countdown card.
export function pickRaces(races) {
  const champRaces = (races || []).filter((r) => !r.isSpecialEvent && r.number != null);
  const completedRaces = champRaces.filter((r) => r.isCompleted);
  return {
    lastRace: completedRaces[completedRaces.length - 1] || null,
    nextRace: nextUpcomingRace(races),
  };
}

// "Season 8 · F1 2010": the season's name with the car era, which is the part
// of the game label that tells seasons apart (the sim rarely changes).
export function seasonLabel(season) {
  const { era } = seasonGameParts(season);
  return era ? `${season.name} · ${era}` : season.name;
}

const berlinParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: LEAGUE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const pad2 = (n) => String(n).padStart(2, "0");

// An instant as ISO 8601 in league time with its offset, e.g.
// "2026-10-16T19:30:00+02:00". The offset follows daylight saving, so a round
// after the clocks change reads +01:00.
export function leagueIso(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const p = Object.fromEntries(berlinParts.formatToParts(d).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offset = Math.round((wall - (d.getTime() - d.getUTCMilliseconds())) / 60000);
  const abs = Math.abs(offset);
  const sign = offset < 0 ? "-" : "+";
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

// The answer itself, from the pieces gathered by buildWidget. Pure, so the
// shape is pinned by tests without a database.
//   lastResults = raceDetailPayload of the last round (or null)
//   standings   = getDriverStandings(...).standings
export function widgetPayload({ season, nextRace, lastRace, lastResults, standings, now = new Date() }) {
  // The Home hero's podium: the classified top three by final position, with
  // what the round paid them.
  const podium = (lastResults?.results || [])
    .filter((r) => r.position != null)
    .sort((a, b) => a.position - b.position)
    .slice(0, PODIUM_SIZE)
    .map((r) => ({ pos: r.position, driver: r.name, team: r.team?.name ?? null, points: r.points ?? 0 }));
  return {
    season: seasonLabel(season),
    nextRace: nextRace
      ? { round: nextRace.number ?? null, track: nextRace.track, date: leagueIso(raceKickoff(nextRace.date)) }
      : null,
    lastRace: lastRace ? { round: lastRace.number, track: lastRace.track, podium } : null,
    standings: (standings || []).slice(0, STANDINGS_SIZE).map((d) => ({
      pos: d.position,
      driver: d.name,
      team: d.team?.name ?? null,
      points: d.total,
    })),
    updatedAt: new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

// The widget for a series (slug; empty = the primary series), or null when
// there is no such public series or it has no season yet.
export async function buildWidget(prisma, series) {
  const season = await resolveSeason(prisma, null, { includePrivate: false, series });
  if (!season) return null;
  const races = await seasonCalendar(prisma, season.id);
  const { lastRace, nextRace } = pickRaces(races);
  const [lastResults, { standings }] = await Promise.all([
    lastRace ? raceDetailPayload(prisma, lastRace) : null,
    getDriverStandings(prisma, season.id),
  ]);
  return widgetPayload({ season, nextRace, lastRace, lastResults, standings });
}
