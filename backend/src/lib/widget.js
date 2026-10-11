// ---------------------------------------------------------------------------
// The home screen widget (GET /api/widget): what an iPhone widget (Scriptable)
// has room for — the series, the next and the last round, the tables, the live
// session and, for a driver who asks with ?driver=<name>, their own season — in
// one public, cacheable answer.
//
// Every figure is the one the website shows, because it comes out of the same
// code. Server side that is the services the pages' endpoints call (the
// calendar the way /api/races builds it, raceDetailPayload, the standings
// services, the card ratings, the live board, the sign-up seats). Where the
// page itself does the last step in the browser — which round is next, how a
// gap is written, which flag a driver gets, who an in-game name is — the
// frontend's own helpers are imported rather than copied, so the widget and
// the site can never disagree. The few lines that only exist inside a page
// component are mirrored here, each with a note saying where from.
//
// Version 2 only ADDS fields: the ones version 1 shipped (season, nextRace's
// round/track/date, lastRace's round/track/podium, standings' pos/driver/team/
// points, updatedAt) keep their meaning, so widgets already on a home screen
// keep working. A missing piece of information is null, never an error.
//
// Public on purpose and cached by shared caches for five minutes, so private
// seasons stay out of it even for a signed-in admin.
// ---------------------------------------------------------------------------
import { resolveSeries } from "./series.js";
import { getActiveSeason } from "../services/seasonService.js";
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "../services/standingsService.js";
import { raceDetailPayload } from "../services/raceDetailService.js";
import { getCardRating } from "../services/cardRatingService.js";
import { getBoard } from "../services/liveTiming.js";
import { resolveServerKey } from "./liveServers.js";
import { readParentIds } from "./sprintRaces.js";
import { readRaceTypes } from "./raceTypes.js";
import { readRaceCountries, staticCountryFor } from "./raceCountries.js";
import { raceKickoff, LEAGUE_TZ } from "./raceKickoff.js";
import { seatsFor } from "./waitlist.js";
import { attendanceGate, readAttendanceOverrides } from "./attendanceGate.js";
import { readHiddenRaceIds } from "./attendanceHidden.js";
import { readNotifySettings } from "./notifications.js";
import { activityFor } from "./attendanceActivity.js";
import { getNameOverrides, getIdentityOverrides, getLinkedDriverIds } from "./persons.js";
import { readDriverRoles } from "./driverRoles.js";
import { avatarUrlFor } from "./widgetAvatar.js";
import { nextUpcomingRace } from "../../../frontend/src/utils/raceFormat.js";
import { seasonGameParts } from "../../../frontend/src/utils/seasonGame.js";
import { seriesThemeColor } from "../../../frontend/src/utils/seriesColor.js";
import { isIdleReserve } from "../../../frontend/src/utils/standingsRow.js";
import { fmtGap } from "../../../frontend/src/utils/raceDuration.js";
import { isLapTime } from "../../../frontend/src/utils/format.js";
import { countryFor } from "../../../frontend/src/data/driverCountries.js";
import { CIRCUITS, circuitFor, canonicalTrack, circuitForLive } from "../../../frontend/src/data/circuits.js";
import { makeDriverMatcher, formatLap, formatGap } from "../../../frontend/src/data/liveTiming.js";

const PODIUM_SIZE = 3;
const RESULTS_SIZE = 10;
const STANDINGS_SIZE = 10;
const LIVE_SIZE = 8;
const FORM_SIZE = 6;

// Flags are stored and drawn from lowercase ISO codes; the widget gets them
// the way the flag's label reads, upper case. "" (no flag) becomes null.
const flagCode = (code) => (code ? String(code).toUpperCase() : null);

// A part of the answer that could not be worked out is null rather than a
// failed request: the widget keeps everything else it was sent.
async function orNull(label, work) {
  try {
    return await work();
  } catch (e) {
    console.error(`widget ${label}:`, e);
    return null;
  }
}

// The season's calendar as /api/races lists it, reduced to what the pages
// read from it: sprint classifications left out (they belong to their event),
// each row typed the same way, ordered by round number. `childrenOf` keeps the
// sprint rows' link to their event, for a driver's attendance.
async function seasonCalendar(prisma, seasonId) {
  const all = await prisma.race.findMany({
    where: { seasonId },
    orderBy: { number: "asc" },
    include: { season: { select: { id: true, number: true } } },
  });
  const parentOf = await readParentIds(prisma, all.map((r) => r.id));
  const races = all.filter((r) => !parentOf.has(r.id));
  const [types, countries] = await Promise.all([
    readRaceTypes(prisma, races.map((r) => r.id)),
    readRaceCountries(prisma, races.map((r) => r.id)),
  ]);
  const childrenOf = new Map();
  for (const [childId, parentId] of parentOf) {
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId).push(childId);
  }
  return {
    races: races.map((r) => ({
      ...r,
      type: types.get(r.id) || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP"),
      country: countries.get(r.id) || staticCountryFor(r.track),
    })),
    childrenOf,
  };
}

// The Home page's picks from that calendar: the championship rounds, the last
// one with its result in, and the next race on the countdown card.
export function pickRaces(races) {
  const champRaces = (races || []).filter((r) => !r.isSpecialEvent && r.number != null);
  const completedRaces = champRaces.filter((r) => r.isCompleted);
  return {
    champRaces,
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

export function seriesInfo(series) {
  return { slug: series.slug, name: series.name, accent: seriesThemeColor(series).toUpperCase() };
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

// Where and when a round is: the circuit's name as the race cards print it
// (frontend data/circuits.js), the round's flag as /api/races sends it, and
// the real kickoff.
function raceFacts(race) {
  const outline = outlineFor(race.track);
  return {
    track: race.track,
    circuit: circuitFor(race.track)?.circuit ?? null,
    country: flagCode(race.country),
    date: leagueIso(raceKickoff(race.date)),
    // Only where the site draws the circuit; the widget has its own otherwise.
    ...(outline ? { outline } : {}),
  };
}

// The circuit outline the site draws for a track (frontend data/circuits.js),
// as "x,y x,y …" fitted into a 100 × 70 box and centred in it. The site's
// outlines are one polyline each, in a box whose long side is 100.
const OUTLINE_W = 100;
const OUTLINE_H = 70;
export function outlineFor(track) {
  const c = circuitFor(track);
  if (!c?.path || !c.box) return null;
  const [bx, by, bw, bh] = c.box.split(/\s+/).map(Number);
  if (!(bw > 0) || !(bh > 0)) return null;
  const scale = Math.min(OUTLINE_W / bw, OUTLINE_H / bh);
  const ox = (OUTLINE_W - bw * scale) / 2;
  const oy = (OUTLINE_H - bh * scale) / 2;
  const r1 = (v) => Math.round(v * 10) / 10;
  const points = [...c.path.matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map(
    ([, x, y]) => `${r1(ox + (x - bx) * scale)},${r1(oy + (y - by) * scale)}`
  );
  return points.length > 1 ? points.join(" ") : null;
}

// How many drivers have a seat for this round, counted the way the sign-up
// card counts "18/40 seats taken" (lib/waitlist.js). null whenever the card
// shows no such line (components/RaceSignupCard.jsx `gridRow`): the round is
// not on the Attendance page, its sign-up opens later, or the league shows no
// "Accepted" list.
async function signedUpFor(prisma, race) {
  const [hidden, notify, overrides] = await Promise.all([
    readHiddenRaceIds(prisma),
    readNotifySettings(prisma),
    readAttendanceOverrides(prisma),
  ]);
  if (hidden.has(race.id)) return null;
  const gate = attendanceGate(race, notify, overrides);
  const notYetOpen = gate.forced !== "closed" && !!gate.opensAt && gate.opensAt.getTime() > Date.now();
  const shows = !Array.isArray(notify.attendanceShow) || notify.attendanceShow.includes("ACCEPTED");
  if (notYetOpen || !shows) return null;
  return (await seatsFor(prisma, race)).accepted;
}

// ---------------------------------------------------------------------------
// The last round's classification, row by row as the race results table
// (frontend components/RaceResults.jsx) shows it. The table's own closures —
// the fastest-lap holder, the time column, the grid arrow — are mirrored here;
// the formatters they call are imported.
// ---------------------------------------------------------------------------
const isFin = (r) => !r.status || r.status === "FINISHED";

export function resultRows(payload, limit = RESULTS_SIZE) {
  const race = payload?.race || {};
  const results = payload?.results || [];
  // Over every row, DNFs included, before anything is cut: the admin-recorded
  // holder first, else the quickest stored lap.
  const lapRows = results.filter((r) => isLapTime(r.bestLapMs));
  const fastestMs = lapRows.length ? Math.min(...lapRows.map((r) => r.bestLapMs)) : null;
  const fastestDriverId =
    race.fastestLapDriverId || (fastestMs != null ? lapRows.find((r) => r.bestLapMs === fastestMs)?.driverId : null) || null;
  // Race time with the stewards' seconds added, and the winner's as the line.
  const adjMs = (r) => (r.totalTimeMs > 0 ? r.totalTimeMs + (r.penaltySeconds || 0) * 1000 : null);
  const leader = results.find((r) => isFin(r) && r.position === 1);
  const leaderMs = leader ? adjMs(leader) : null;
  const leaderLaps = leader?.laps ?? null;
  // The Time column's "+gap" (the winner has none); a lapped car reads "+1 lap".
  const gapOf = (r) => {
    if (r.position === 1 || leaderMs == null) return null;
    const ms = adjMs(r);
    if (ms == null) return null;
    if (leaderLaps != null && r.laps != null && r.laps < leaderLaps) {
      const down = leaderLaps - r.laps;
      return `+${down} lap${down > 1 ? "s" : ""}`;
    }
    const gap = ms - leaderMs;
    return gap > 0 ? fmtGap(gap) : null;
  };
  return results
    .filter((r) => r.position != null && isFin(r))
    .slice(0, limit)
    .map((r) => {
      // The car the round was driven in: a reserve standing in reads as that
      // team, marked as the sub.
      const team = r.effectiveTeam || r.team;
      return {
        pos: r.position,
        driver: r.name,
        country: flagCode(countryFor(r.driverId, r.country)),
        team: team ? `${team.name}${r.isSub && r.subForTeam ? " (sub)" : ""}` : null,
        teamColor: team?.color ?? null,
        points: r.points ?? 0,
        gained: r.grid != null ? r.grid - r.position : null,
        gap: gapOf(r),
        fastestLap: !!fastestDriverId && r.driverId === fastestDriverId,
      };
    });
}

// The Home hero's podium, exactly as version 1 sent it.
function podiumRows(payload) {
  return (payload?.results || [])
    .filter((r) => r.position != null)
    .sort((a, b) => a.position - b.position)
    .slice(0, PODIUM_SIZE)
    .map((r) => ({ pos: r.position, driver: r.name, team: r.team?.name ?? null, points: r.points ?? 0 }));
}

// ---------------------------------------------------------------------------
// The driver table as the Standings page lists it (pages/DriverStandings.jsx):
// the reserves who never drove left out, the rest ranked 1..n, and the arrow
// against the table before the last round re-ranked inside that same view.
// `decided` (every round run) takes the arrows away, as on the page.
// ---------------------------------------------------------------------------
export function standingsView(data, { decided = false } = {}) {
  const all = data?.standings || [];
  const rows = all.filter((r) => !isIdleReserve(r)).map((d, i) => ({ ...d, position: i + 1 }));
  const scoredRounds = (data?.raceNumbers || []).filter((n) => all.some((r) => r.perRace?.[n] != null));
  const lastRound = scoredRounds[scoredRounds.length - 1];
  const startedBefore = (r) => scoredRounds.some((n) => n < lastRound && r.perRace?.[n] != null);
  const prevInView = new Map(
    rows
      .filter((r) => r.prevPosition != null && startedBefore(r))
      .sort((a, b) => a.prevPosition - b.prevPosition)
      .map((r, i) => [r.driverId, i + 1])
  );
  return rows.map((r) => {
    const prev = prevInView.get(r.driverId) ?? null;
    return { ...r, prevPosition: prev, change: !decided && prev != null ? prev - r.position : null };
  });
}

function standingRow(r, leaderTotal) {
  return {
    pos: r.position,
    driver: r.name,
    country: flagCode(countryFor(r.driverId, r.country)),
    team: r.team?.name ?? null,
    teamColor: r.team?.color ?? null,
    points: r.total,
    gap: r.position === 1 ? null : r.total - leaderTotal,
    change: r.change,
  };
}

function constructorRows(data) {
  return (data?.standings || []).map((t) => ({
    pos: t.position,
    team: t.name,
    teamColor: t.color ?? null,
    points: t.total,
  }));
}

// ---------------------------------------------------------------------------
// The live session, as the Live page (pages/Live.jsx) heads and lists it. The
// board knows in-game names only; the page puts a league driver, flag and
// team behind each one with makeDriverMatcher over the season's roster, and so
// does this.
// ---------------------------------------------------------------------------

// The roster the Live page matches against: /api/teams for the season, in its
// order (the matcher keeps the first row a name points at), with the person's
// current name and flag.
async function liveRoster(prisma, seasonId) {
  const [teams, nameOverrides, identity] = await Promise.all([
    prisma.team.findMany({
      where: { seasonId },
      include: { drivers: { orderBy: { name: "asc" } } },
      orderBy: [{ tier: "asc" }, { name: "asc" }],
    }),
    getNameOverrides(prisma),
    getIdentityOverrides(prisma),
  ]);
  const roles = await readDriverRoles(prisma, teams.flatMap((t) => t.drivers.map((d) => d.id)));
  for (const t of teams) {
    for (const d of t.drivers) {
      const ov = nameOverrides.get(d.id);
      if (ov) d.name = ov.displayName;
      const idov = identity.get(d.id);
      if (!d.country && idov?.country) d.country = idov.country;
      d.role = roles.get(d.id) || null;
    }
  }
  return teams;
}

// Live.jsx liveTrackName: the circuit the session is at, as the calendar
// names it, else whatever the server called it.
function liveTrackName(session) {
  for (const t of [session.track, session.trackName]) {
    if (t && circuitFor(t)) return canonicalTrack(t);
  }
  const c = circuitForLive(session.trackName, session.track);
  if (c) {
    const hit = Object.entries(CIRCUITS).find(([, v]) => v === c);
    if (hit) return hit[0];
  }
  return session.trackName || session.track || null;
}

// Live.jsx carLabel: the car, when the driver is nobody the roster knows.
const carLabel = (carName) => (carName ? carName.replace(/^f1\s*\d{4}\s*[-–—]\s*/i, "").trim() || null : null);

export function liveBlock(board, teams, now = Date.now()) {
  const s = board?.session;
  if (!s) return null;
  // Who is out on the server right now, counted the way /api/live/status
  // counts it for the nav bar; somebody driving is what makes it active.
  const onTrack = (board.entries || []).filter((e) => e.onTrack).length;
  // The board still hears from the server (the relay marks it stale after 75
  // seconds of silence), so its "Time left" is current.
  const current = !!board.ok && !board.stale;
  const match = makeDriverMatcher(teams);
  const timed = (board.entries || [])
    .filter((e) => e.bestLapMs > 0)
    .sort((a, b) => a.bestLapMs - b.bestLapMs)
    .slice(0, LIVE_SIZE);
  const best = timed.map((e, i) => {
    const m = match(e.name);
    return {
      pos: i + 1,
      // Upper case is how the board prints every name.
      driver: String(m?.nabsName || e.name || "").toUpperCase() || null,
      country: flagCode(m?.country),
      team: m?.teamName || carLabel(e.carName) || null,
      teamColor: m?.teamColor || null,
      time: formatLap(e.bestLapMs),
      gap: i === 0 ? null : formatGap(e.bestLapMs - timed[0].bestLapMs),
    };
  });
  return {
    active: onTrack > 0,
    onTrack,
    // The session card's headline, without the content pack's suffix.
    name: (s.trackName || "").replace(/\s*[-–—]\s*F1\s*2025\s*[-–—]\s*EuroRacers\s*$/i, "") || null,
    track: liveTrackName(s),
    session: s.type ? `${s.type}${s.sessionCount > 1 ? ` ${s.sessionIndex + 1}/${s.sessionCount}` : ""}` : null,
    // "Time left" as a moment, so the widget can count down on its own.
    endsAt: current && s.remainingMs != null ? leagueIso(new Date(now + s.remainingMs)) : null,
    // The session's best times (Live page, "Classification · Session Best
    // Times"), whether or not anybody is out there now.
    best,
  };
}

// ---------------------------------------------------------------------------
// One driver's season (?driver=<name>).
// ---------------------------------------------------------------------------
const norm = (s) => String(s || "").trim().toLowerCase();

// The row a name means: the league name or the Discord name, any case. A
// person with two rows in the season gets the one the table ranks.
export function findDriverRow(rows, name) {
  const q = norm(name);
  if (!q) return null;
  const hits = rows.filter((r) => norm(r.name) === q || norm(r.discordName) === q);
  return hits.sort((a, b) => a.position - b.position)[0] || null;
}

// A driver's rounds of the season, one status each:
//   attended / missed  a completed round, by whether they started it (feature
//                      or sprint; a DNS is not a start) — lib/attendanceActivity.js
//   signed             a round to come they hold a seat for
//   pending            the next round, or one taking sign-ups now, without one
//   future             a later round
//   rounds   the season's championship rounds, in order
//   started  Map roundId -> result status (sprint folded into its round)
//   answers  Map roundId -> their sign-up answer
//   openIds  rounds whose sign-up is open
export function attendanceBlock(rounds, started, answers, openIds) {
  const done = rounds.filter((r) => r.isCompleted);
  const activity = activityFor(done, started, null);
  const ahead = rounds.filter((r) => !r.isCompleted);
  const statusOf = new Map(activity.cells.map((c) => [c.raceId, c.raced ? "attended" : "missed"]));
  ahead.forEach((r, i) => {
    if (answers.get(r.id) === "ACCEPTED") statusOf.set(r.id, "signed");
    else if (i === 0 || openIds.has(r.id)) statusOf.set(r.id, "pending");
    else statusOf.set(r.id, "future");
  });
  let streak = 0;
  for (let i = activity.cells.length - 1; i >= 0 && activity.cells[i].raced; i--) streak++;
  return {
    driven: activity.starts,
    total: done.length,
    streak,
    next: ahead.length ? statusOf.get(ahead[0].id) : null,
    rounds: rounds.map((r) => ({ round: r.number, status: statusOf.get(r.id) })),
  };
}

async function driverAttendance(prisma, { champRaces, childrenOf, linkedIds, driverId }) {
  const done = champRaces.filter((r) => r.isCompleted);
  const ahead = champRaces.filter((r) => !r.isCompleted);
  const roundOf = new Map(done.map((r) => [r.id, r.id]));
  for (const r of done) for (const child of childrenOf.get(r.id) || []) roundOf.set(child, r.id);
  const [resultRowsOfPerson, notify, overrides] = await Promise.all([
    prisma.raceResult.findMany({
      where: { raceId: { in: [...roundOf.keys()] }, driverId: { in: linkedIds } },
      select: { raceId: true, status: true },
    }),
    readNotifySettings(prisma),
    readAttendanceOverrides(prisma),
  ]);
  // Turning up beats not turning up, across their rows and both races of a
  // weekend (the rule of the Attendance tab's activity view).
  const startedStatus = (s) => !!s && s !== "DNS";
  const started = new Map();
  for (const r of resultRowsOfPerson) {
    const round = roundOf.get(r.raceId);
    const seen = started.get(round);
    if (!seen || (!startedStatus(seen) && startedStatus(r.status))) started.set(round, r.status);
  }
  // Their answer for each round to come, by person (lib/waitlist.js).
  const answers = new Map(
    await Promise.all(ahead.map(async (r) => [r.id, (await seatsFor(prisma, r, driverId)).mine]))
  );
  const openIds = new Set(ahead.filter((r) => attendanceGate(r, notify, overrides).open).map((r) => r.id));
  return attendanceBlock(champRaces, started, answers, openIds);
}

// The driver card's five numbers (components/RatingCard.jsx: AWA is stored as
// `aha`), or null where the site shows no card.
async function cardRating(prisma, seasonId, driverId) {
  const rows = await prisma.$queryRawUnsafe(`SELECT "cardsEnabled" FROM "Season" WHERE "id" = ?`, seasonId).catch(() => []);
  const enabled = rows[0]?.cardsEnabled == null ? true : !!Number(rows[0].cardsEnabled);
  if (!enabled) return null;
  const g = (await getCardRating(prisma, seasonId, driverId))?.ratings;
  return g ? { rtg: g.overall, exp: g.exp, rac: g.rac, awa: g.aha, pac: g.pac } : null;
}

async function meBlock(prisma, name, { origin, season, champRaces, childrenOf, lastRace, lastResults, standingsData, view }) {
  const row = findDriverRow(standingsData?.standings || [], name);
  if (!row) return null;
  const at = view.findIndex((r) => r.driverId === row.driverId);
  const mine = at >= 0 ? view[at] : null;
  const ahead = at > 0 ? view[at - 1] : null;
  const behind = at >= 0 && at < view.length - 1 ? view[at + 1] : null;
  const linkedIds = await getLinkedDriverIds(prisma, row.driverId);
  const [number, avatar, rating, attendance] = await Promise.all([
    orNull("number", async () =>
      (await prisma.driver.findUnique({ where: { id: row.driverId }, select: { number: true } }))?.number ?? null
    ),
    // The picture behind their driver card, sized for a widget (lib/widgetAvatar.js).
    orNull("avatar", () => avatarUrlFor(prisma, row.driverId, origin)),
    orNull("rating", () => cardRating(prisma, season.id, row.driverId)),
    orNull("attendance", () => driverAttendance(prisma, { champRaces, childrenOf, linkedIds, driverId: row.driverId })),
  ]);
  // Their line in the last round's classification; null when they did not start.
  const res = (lastResults?.results || []).find((r) => linkedIds.includes(r.driverId));
  const lastResult =
    lastRace && res && res.status !== "DNS"
      ? { round: lastRace.number, track: lastRace.track, pos: isFin(res) ? res.position : null, points: res.points ?? 0 }
      : null;
  // The last rounds run, oldest first, as the profile's season form plots them:
  // a finishing position, or a gap (null) where they did not start or finish.
  const form = champRaces
    .filter((r) => r.isCompleted)
    .slice(-FORM_SIZE)
    .map((r) => {
      const cell = row.perRace?.[r.number];
      return { round: r.number, track: r.track, pos: cell?.status === "FINISHED" && cell.position != null ? cell.position : null };
    });
  // Same team, same season, as the profile's team panel; the Reserve pool is
  // not a team anybody shares.
  const mate =
    row.team?.tier === 0
      ? null
      : view.filter((r) => r.team?.id === row.team?.id && r.driverId !== row.driverId).sort((a, b) => a.position - b.position)[0];
  return {
    driver: row.name,
    number,
    avatar,
    country: flagCode(countryFor(row.driverId, row.country)),
    team: row.team?.name ?? null,
    teamColor: row.team?.color ?? null,
    // The tier on their card; a reserve (tier 0, "Reserve" on the card) has none.
    tier: row.tier === 1 || row.tier === 2 ? row.tier : null,
    pos: mine?.position ?? null,
    points: row.total,
    gapAhead: mine && ahead ? mine.total - ahead.total : null,
    gapBehind: mine && behind ? mine.total - behind.total : null,
    gapLeader: mine && at > 0 ? mine.total - view[0].total : null,
    rating,
    lastResult,
    form,
    teammate: mate ? { driver: mate.name, pos: mate.position, points: mate.total } : null,
    attendance,
  };
}

// ---------------------------------------------------------------------------
// The answer.
// ---------------------------------------------------------------------------

// The widget for a series (slug; empty = the primary series), or null when
// there is no such public series or it has no season yet. `driver` fills `me`;
// `origin` is the site's address, for the absolute picture URL in it.
export async function buildWidget(prisma, { series, driver, origin = "" } = {}) {
  const seriesRow = await resolveSeries(prisma, series, { includePrivate: false });
  if (!seriesRow) return null;
  const season = await getActiveSeason(prisma, seriesRow.id);
  if (!season) return null;
  const { races, childrenOf } = await seasonCalendar(prisma, season.id);
  const { champRaces, lastRace, nextRace } = pickRaces(races);
  // The arrows stop once the title is decided (Standings page).
  const decided = champRaces.length > 0 && champRaces.every((r) => r.isCompleted);

  const [lastResults, standingsData, t1, t2, signedUp, live] = await Promise.all([
    lastRace ? raceDetailPayload(prisma, lastRace) : null,
    getDriverStandings(prisma, season.id),
    orNull("tier 1", () => getT1ConstructorStandings(prisma, season.id)),
    orNull("tier 2", () => getT2ConstructorStandings(prisma, season.id)),
    nextRace ? orNull("signed up", () => signedUpFor(prisma, nextRace)) : null,
    orNull("live", async () => {
      // The board the series' Live page shows (no slug = the root page's).
      const board = getBoard(await resolveServerKey(prisma, { series }));
      return board?.session ? liveBlock(board, await liveRoster(prisma, season.id)) : null;
    }),
  ]);
  const view = standingsView(standingsData, { decided });
  const leaderTotal = view[0]?.total ?? 0;
  const me = driver
    ? await orNull("me", () =>
        meBlock(prisma, driver, { origin, season, champRaces, childrenOf, lastRace, lastResults, standingsData, view })
      )
    : null;

  return {
    series: seriesInfo(seriesRow),
    season: seasonLabel(season),
    nextRace: nextRace
      ? {
          round: nextRace.number ?? null,
          totalRounds: champRaces.length,
          ...raceFacts(nextRace),
          signedUp,
        }
      : null,
    lastRace: lastRace
      ? {
          round: lastRace.number,
          ...raceFacts(lastRace),
          podium: podiumRows(lastResults),
          results: resultRows(lastResults),
        }
      : null,
    standings: view.slice(0, STANDINGS_SIZE).map((r) => standingRow(r, leaderTotal)),
    constructors: {
      tier1: constructorRows(t1),
      tier2: constructorRows(t2),
    },
    live,
    me,
    updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}
