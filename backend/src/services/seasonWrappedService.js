// ---------------------------------------------------------------------------
// Season Wrapped: one driver's season, told as a handful of cards.
//
// The race recap (lib/raceRecap.js) tells one round from a driver's seat; this
// does the same for a whole season once it is over: where they finished, the
// numbers of their year, their best night and their biggest climb, how the
// championship went round by round, the team-mate battle, the rival they
// finished next to, what they won, and what kind of driver the season says
// they were. Made to be passed around, so it is a public page per driver and
// season, built from public data only: no tokens, no private rating detail.
//
// Every figure comes from the services the rest of the site reads, so the
// numbers here are the numbers on the driver's profile and in the standings.
// The season totals are the profile's own stat tiles (getDriverProfile), the
// positions round by round are the standings as they stood after each round
// (the final table's own round cells under the season's drop rule, see
// journeyTables), the awards are the Home page's season honours
// (getSeasonHonours). What is new here is only the telling.
//
// A season still running gets the same page as "so far", without the awards
// (nobody has won them yet). Archived seasons carry less (no grid slots, no
// telemetry, early rounds that only exist as points), and a card whose data
// the season does not have simply stays away.
//
// The league switches it on like the recap: off, admins first, everyone.
// ---------------------------------------------------------------------------
import { getDriverProfile } from "./driverProfileService.js";
import { applyDropScores, compareFinishSheets, finishSheetOf, getDriverStandings } from "./standingsService.js";
import { getSeasonHonours } from "./honoursService.js";
import { getActiveSeason, getPrivateSeasonIds, resolveSeason } from "./seasonService.js";
import { resolveSeries, seasonIdsOfSeries, seasonSeriesMap, dbListSeries } from "../lib/series.js";
import { seasonCompleteFromRaces } from "../lib/seasonComplete.js";
import { finishesOf, hasRaced, roundsOf } from "../lib/standingsRow.js";
import { getLinkedDriverIds, discordIdsForDrivers } from "../lib/persons.js";
import { readSprintChildrenOf } from "../lib/sprintRaces.js";
import { getAdminDiscordIds } from "../lib/adminUsers.js";
import { dbCreateNotification } from "../lib/notifications.js";

export const WRAPPED_SETTING = "season_wrapped";
export const WRAPPED_MODES = ["off", "admins", "all"];
export const DEFAULT_WRAPPED_MODE = "admins";

export async function wrappedMode(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: WRAPPED_SETTING } });
    if (WRAPPED_MODES.includes(row?.value)) return row.value;
  } catch {
    /* fresh database, no Setting table yet */
  }
  return DEFAULT_WRAPPED_MODE;
}

export async function setWrappedMode(prisma, mode) {
  const value = WRAPPED_MODES.includes(mode) ? mode : DEFAULT_WRAPPED_MODE;
  await prisma.setting.upsert({
    where: { key: WRAPPED_SETTING },
    create: { key: WRAPPED_SETTING, value },
    update: { value },
  });
  return value;
}

// Is it open to THIS request? Everybody once it is on, admins (checked live by
// the auth middleware) while it is being tried out.
export async function wrappedVisibleTo(prisma, req) {
  const mode = await wrappedMode(prisma);
  if (mode === "all") return true;
  if (mode === "admins") return req?.isAdminRequest === true;
  return false;
}

// --- the pure parts -------------------------------------------------------------

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

// Every classification of a profile's race-by-race rows: the feature race of
// each round and, on a sprint weekend, the sprint. What the "best result" and
// the wins list are picked from.
export function classificationsOfPerRace(perRace) {
  const out = [];
  for (const r of perRace || []) {
    out.push({
      round: r.number,
      track: r.track,
      raceId: r.raceId,
      sprint: false,
      status: r.status,
      position: r.position ?? null,
      grid: r.grid ?? null,
      // The round cell's points are the weekend's; the feature race's share is
      // what is left after the sprint's.
      points: (r.points || 0) - (r.sprint?.points || 0),
    });
    if (r.sprint) {
      out.push({
        round: r.number,
        track: r.track,
        raceId: r.sprint.raceId,
        sprint: true,
        status: r.sprint.status,
        position: r.sprint.position ?? null,
        grid: r.sprint.grid ?? null,
        points: r.sprint.points || 0,
      });
    }
  }
  return out;
}

const isFinish = (c) => c.status === "FINISHED" && c.position != null;

// The best night: the highest classified finish, then the most points, then
// the earlier round (the first time is the one people remember).
export function bestResult(perRace) {
  const fin = classificationsOfPerRace(perRace).filter(isFinish);
  if (!fin.length) return null;
  fin.sort((a, b) => a.position - b.position || b.points - a.points || a.round - b.round || Number(a.sprint) - Number(b.sprint));
  return fin[0];
}

// The biggest climb from grid to flag, feature races only (a sprint grid is
// reversed or inherited, the same rule as the profile's places gained). Three
// places is the least worth a card.
export function biggestClimb(perRace, least = 3) {
  let best = null;
  for (const c of classificationsOfPerRace(perRace)) {
    if (c.sprint || !isFinish(c) || !(c.grid > 0)) continue;
    const gained = c.grid - c.position;
    if (gained >= least && (!best || gained > best.gained)) best = { ...c, gained };
  }
  return best;
}

// The rounds and sprints won, in order.
export function winsOf(perRace) {
  return classificationsOfPerRace(perRace)
    .filter((c) => isFinish(c) && c.position === 1)
    .map(({ round, track, sprint, raceId }) => ({ round, track, sprint, raceId }));
}

// Two standings rows side by side over the rounds both drove: who finished
// ahead (both classified, sprints included), who started ahead (the feature
// race's grid), and the points. Rows are standings rows: perRace keyed by
// round number, cells { status, position, grid, sprint }.
export function headToHead(mine, theirs) {
  const out = { races: 0, ahead: 0, behind: 0, qualiAhead: 0, qualiBehind: 0 };
  for (const [round, cell] of Object.entries(mine?.perRace || {})) {
    const other = theirs?.perRace?.[round];
    if (!other) continue;
    const pairs = [[cell, other]];
    if (cell.sprint && other.sprint) pairs.push([cell.sprint, other.sprint]);
    for (const [a, b] of pairs) {
      if (a.status !== "FINISHED" || b.status !== "FINISHED" || a.position == null || b.position == null) continue;
      out.races += 1;
      if (a.position < b.position) out.ahead += 1;
      else if (a.position > b.position) out.behind += 1;
    }
    if (cell.grid > 0 && other.grid > 0 && cell.grid !== other.grid) {
      if (cell.grid < other.grid) out.qualiAhead += 1;
      else out.qualiBehind += 1;
    }
  }
  return out;
}

// The rival: whoever finished right next to them in the table, the one just
// ahead (somebody to beat next year) or, for the champion, the runner-up.
// `rows` are the final standings, in order, of the drivers who raced.
export function pickRival(rows, driverId) {
  const i = rows.findIndex((r) => r.driverId === driverId);
  if (i < 0 || rows.length < 2) return null;
  return rows[i > 0 ? i - 1 : 1] || null;
}

// What kind of driver the season says they were. One label, the first rule
// that fits, always with the numbers that earned it. Deliberately simple and
// always explainable: a label that cannot say why is a horoscope.
export function driverType({ stats, champion = false, complete = false, roundsRun = 0 }) {
  const s = stats || {};
  const starts = s.starts || 0;
  const finishes = s.finishes || 0;
  if (!starts) return null;
  const share = (n) => n / starts;
  if (champion && complete) {
    return { key: "champion", title: "The Champion", line: `${s.wins || 0} ${(s.wins || 0) === 1 ? "win" : "wins"} and the title.` };
  }
  if ((s.wins || 0) >= 3 || (starts >= 4 && share(s.wins || 0) >= 0.25)) {
    return { key: "winner", title: "The Winner", line: `${s.wins} wins from ${starts} starts.` };
  }
  if ((s.polePositions || 0) >= 2) {
    return { key: "qualifier", title: "The Qualifier", line: `${s.polePositions} poles. Saturday was yours.` };
  }
  if ((s.podiums || 0) >= 3) {
    return { key: "podium", title: "The Podium Regular", line: `${s.podiums} podiums from ${starts} starts.` };
  }
  const gainedPerFinish = finishes ? (s.positionsGained || 0) / finishes : 0;
  if ((s.positionsGained || 0) >= 15 || (finishes >= 3 && gainedPerFinish >= 3)) {
    return { key: "charger", title: "The Charger", line: `${s.positionsGained} places made up from the grid.` };
  }
  if (starts >= 4 && finishes === starts && !(s.dnf || 0)) {
    return { key: "finisher", title: "The Finisher", line: `Saw the flag in all ${starts} starts.` };
  }
  if (starts >= 4 && share(s.top10 || 0) >= 0.7) {
    return { key: "regular", title: "The Top-Ten Regular", line: `${s.top10} top-ten finishes from ${starts} starts.` };
  }
  if (roundsRun >= 4 && starts >= roundsRun) {
    return { key: "ever-present", title: "The Ever-Present", line: `On the grid for every one of the ${roundsRun} rounds.` };
  }
  return { key: "racer", title: "The Racer", line: `${starts} ${starts === 1 ? "start" : "starts"}, every one of them counted.` };
}

// The honours of the season that went to this driver, from the Home page's
// season honours, plus the Driver of the Day picks. Only for a finished
// season: an award is not won until the season is over.
export function honoursFor(honours, { driverId, teamId = null, position = null, complete = false, dotd = 0 }) {
  const out = [];
  if (complete && honours) {
    if (position === 1) out.push({ key: "champion", title: "Champion", detail: honours.seasonName || null });
    else if (position === 2) out.push({ key: "vice", title: "Runner-up", detail: "Second in the championship" });
    else if (position === 3) out.push({ key: "third", title: "Third overall", detail: "On the championship podium" });
    for (const t of honours.teamChampions || []) {
      if (teamId && t.teamId === teamId) out.push({ key: "team", title: "Team champions", detail: `${t.name}, Tier ${t.tier}` });
    }
    if (honours.bestNewcomer?.driverId === driverId) out.push({ key: "newcomer", title: "Best newcomer", detail: "The top driver in their first season" });
    if (honours.fastestLap?.driverId === driverId) {
      out.push({ key: "fastest-lap", title: "Fastest lap of the season", detail: honours.fastestLap.track || null, ms: honours.fastestLap.ms ?? null });
    }
    if (honours.mostOvertakes?.driverId === driverId) {
      out.push({ key: "overtakes", title: "Most overtakes", detail: `${honours.mostOvertakes.count} passes` });
    }
    if (honours.mostLapsLed?.driverId === driverId) {
      out.push({ key: "laps-led", title: "Most laps led", detail: `${honours.mostLapsLed.count} laps in front` });
    }
    if (honours.cleanest?.driverId === driverId) {
      out.push({ key: "cleanest", title: "Cleanest driver", detail: `${honours.cleanest.contacts} contacts in ${honours.cleanest.starts} starts` });
    }
  }
  if (dotd > 0) out.push({ key: "dotd", title: dotd === 1 ? "Driver of the Day" : `Driver of the Day ×${dotd}`, detail: null });
  return out;
}

// The championship as it stood after each round, for every driver: the table
// the site showed on that night. Built from the final rows' round cells: after
// round k a driver has the points of rounds 1..k, and the drop rule works the
// way it did then, over the whole calendar with the rounds still to come
// counting as zeroes (so they are the first to go, and a real result only
// drops once the season runs out of empty rounds). Ties go to the countback.
// Rank among the drivers who had raced by then, the "P4 of 19" of the profile.
//
// A finished season's last point is the final table itself, champion rule,
// official sheet and hand-set points included, so the curve ends on the
// number the headline prints.
export function journeyTables({ rows, raceNumbers, dropWorst = 0 }, runRounds, finalRanking = null) {
  const out = new Map(); // driverId -> [{ round, position, points }]
  const push = (id, entry) => {
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(entry);
  };
  runRounds.forEach((round, i) => {
    if (finalRanking && i === runRounds.length - 1) {
      finalRanking.forEach((r, idx) => push(r.driverId, { round, position: idx + 1, points: r.total }));
      return;
    }
    const table = [];
    for (const row of rows) {
      const cells = Object.entries(row.perRace || {}).filter(([n]) => Number(n) <= round);
      if (!cells.length) continue;
      const pointsByRound = Object.fromEntries(cells.map(([n, c]) => [n, c?.points || 0]));
      const { total } = applyDropScores(pointsByRound, raceNumbers, dropWorst);
      table.push({ driverId: row.driverId, name: row.name || "", total, sheet: finishSheetOf({ perRace: Object.fromEntries(cells) }) });
    }
    table.sort((a, b) => b.total - a.total || compareFinishSheets(a.sheet, b.sheet) || a.name.localeCompare(b.name));
    table.forEach((t, idx) => push(t.driverId, { round, position: idx + 1, points: t.total }));
  });
  return out;
}

// --- the season, once for every driver in it -------------------------------------

// Every Wrapped of a season shares the same reading of it: the table after
// each round, the final table, the honours. Worked out once per season and
// kept, like the Hall of Fame's records; dropped whenever results are saved.
const BOOK_MS = 10 * 60 * 1000;
const books = new Map(); // seasonId -> { at, promise }
const wrapped = new Map(); // driverId -> { at, promise }

export function invalidateWrappedCache() {
  books.clear();
  wrapped.clear();
}

function seasonBook(prisma, seasonId) {
  const hit = books.get(seasonId);
  if (hit && Date.now() - hit.at < BOOK_MS) return hit.promise;
  const promise = readSeasonBook(prisma, seasonId);
  books.set(seasonId, { at: Date.now(), promise });
  promise.catch(() => books.delete(seasonId));
  if (books.size > 20) books.delete(books.keys().next().value);
  return promise;
}

async function readSeasonBook(prisma, seasonId) {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) return null;
  const races = await prisma.race.findMany({
    where: { seasonId, isSpecialEvent: false },
    orderBy: { number: "asc" },
    select: { id: true, number: true, track: true, isCompleted: true, date: true, driverOfTheDayId: true, isSpecialEvent: true },
  });
  const rounds = races.filter((r) => r.number != null);
  const run = rounds.filter((r) => r.isCompleted);
  const complete = seasonCompleteFromRaces(races);
  const final = await getDriverStandings(prisma, seasonId);
  const finalRows = (final.standings || []).filter(hasRaced);

  // The table after each round, as it stood then (journeyTables above).
  const trackOf = new Map(run.map((r) => [r.number, r.track]));
  const after = journeyTables(
    { rows: final.standings || [], raceNumbers: final.raceNumbers || rounds.map((r) => r.number), dropWorst: final.dropWorst || 0 },
    run.map((r) => r.number),
    complete ? finalRows : null
  );
  for (const list of after.values()) for (const j of list) j.track = trackOf.get(j.round) || null;

  const dotd = new Map();
  for (const r of run) if (r.driverOfTheDayId) dotd.set(r.driverOfTheDayId, (dotd.get(r.driverOfTheDayId) || 0) + 1);
  // A sprint weekend's Driver of the Day may sit on its sprint (the child row).
  const children = await readSprintChildrenOf(prisma, run);
  if (children.size) {
    const kids = await prisma.race.findMany({
      where: { id: { in: [...children.keys()] } },
      select: { id: true, driverOfTheDayId: true },
    });
    for (const k of kids) if (k.driverOfTheDayId) dotd.set(k.driverOfTheDayId, (dotd.get(k.driverOfTheDayId) || 0) + 1);
  }

  const honours = complete ? await getSeasonHonours(prisma, seasonId).catch(() => null) : null;
  return { season, roundsRun: run.length, totalRounds: rounds.length, complete, finalRows, after, dotd, honours };
}

// --- one driver -------------------------------------------------------------------

const seasonLabelOf = (season) => {
  const name = String(season?.name || "").trim();
  if (name && !/^\d+$/.test(name)) return name;
  return season?.number != null ? `Season ${season.number}` : name || "The season";
};

export function getSeasonWrapped(prisma, driverId) {
  const hit = wrapped.get(driverId);
  if (hit && Date.now() - hit.at < BOOK_MS) return hit.promise;
  const promise = buildSeasonWrapped(prisma, driverId);
  wrapped.set(driverId, { at: Date.now(), promise });
  promise.catch(() => wrapped.delete(driverId));
  if (wrapped.size > 200) wrapped.delete(wrapped.keys().next().value);
  return promise;
}

async function buildSeasonWrapped(prisma, driverId) {
  const row = await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true, seasonId: true } });
  if (!row?.seasonId) return null;
  const [profile, book] = await Promise.all([getDriverProfile(prisma, driverId), seasonBook(prisma, row.seasonId)]);
  if (!profile || !book) return null;
  const stats = profile.stats || {};
  const seasonHead = { number: book.season.number, name: book.season.name, label: seasonLabelOf(book.season), complete: book.complete };
  // Not until the season is over: a Wrapped is the end of the story.
  if (!book.complete) return { notFinished: true, driver: profile.driver, season: seasonHead };
  // Nothing to tell about a season they never started a race in.
  if (!stats.starts) return { empty: true, driver: profile.driver, season: seasonHead };

  const me = book.finalRows.find((r) => r.driverId === driverId) || null;
  const position = profile.championship?.position ?? null;
  const journey = book.after.get(driverId) || [];
  const peak = journey.reduce((best, j) => (!best || j.position < best.position ? j : best), null);

  // Team-mates: the other drivers of the same roster team who raced. The
  // reserve pool is no team, so a reserve gets no team-mate card.
  const team = profile.driver.team;
  const mates =
    team && team.tier !== 0
      ? book.finalRows.filter((r) => r.driverId !== driverId && r.team?.id === team.id)
      : [];
  const teammates = me
    ? mates.map((m) => ({
        driverId: m.driverId,
        name: m.name,
        photoUrl: m.photoUrl || null,
        country: m.country || null,
        points: m.total,
        myPoints: me.total,
        ...headToHead(me, m),
      }))
    : [];

  const rivalRow = pickRival(book.finalRows, driverId);
  const rival = rivalRow && me
    ? {
        driverId: rivalRow.driverId,
        name: rivalRow.name,
        photoUrl: rivalRow.photoUrl || null,
        country: rivalRow.country || null,
        team: rivalRow.team ? { name: rivalRow.team.name, color: rivalRow.team.color, logoUrl: rivalRow.team.logoUrl } : null,
        position: book.finalRows.indexOf(rivalRow) + 1,
        points: rivalRow.total,
        gap: rivalRow.total - me.total,
        ...headToHead(me, rivalRow),
      }
    : null;

  const finishes = classificationsOfPerRace(profile.perRace).filter(isFinish).map((c) => c.position);
  const dotd = book.dotd.get(driverId) || 0;

  return {
    season: {
      number: book.season.number,
      name: book.season.name,
      label: seasonLabelOf(book.season),
      game: book.season.game || null,
      complete: book.complete,
      roundsRun: book.roundsRun,
      totalRounds: book.totalRounds,
    },
    series: profile.driver.seriesSlug ? { slug: profile.driver.seriesSlug, name: profile.driver.seriesName } : null,
    driver: {
      id: profile.driver.id,
      name: profile.driver.name,
      handle: profile.driver.handle || null,
      number: profile.driver.number ?? null,
      country: profile.driver.country || null,
      photoUrl: profile.driver.photoUrl || null,
      tier: profile.driver.tier,
      team: team ? { id: team.id, name: team.name, color: team.color, logoUrl: team.logoUrl, tier: team.tier } : null,
    },
    championship: {
      position,
      points: profile.championship?.points ?? 0,
      fieldSize: profile.championship?.fieldSize ?? book.finalRows.length,
      peak: peak ? { position: peak.position, round: peak.round, track: peak.track } : null,
      journey,
      roundsLed: journey.filter((j) => j.position === 1).length,
    },
    stats: {
      starts: stats.starts,
      finishes: stats.finishes,
      wins: stats.wins,
      podiums: stats.podiums,
      top10: stats.top10,
      poles: stats.polePositions,
      fastestLaps: stats.fastestLaps,
      dnf: stats.dnf,
      bestFinish: stats.bestFinish,
      avgFinish: avg(finishes),
      positionsGained: stats.positionsGained,
      overtakes: stats.overtakes ?? null,
      lapsLed: stats.lapsLed ?? null,
      sprintWins: stats.sprint?.wins ?? null,
      dotd,
    },
    best: bestResult(profile.perRace),
    climb: biggestClimb(profile.perRace),
    wins: winsOf(profile.perRace),
    teammates,
    rival,
    honours: honoursFor(book.honours, {
      driverId,
      teamId: team?.id || null,
      position,
      complete: book.complete,
      dotd,
    }),
    type: driverType({ stats, champion: position === 1, complete: book.complete, roundsRun: book.roundsRun }),
  };
}

// --- the hub: every Wrapped of one season -------------------------------------------

// The season a hub opens on when the address names none: the newest season of
// the series that is over, or, before the first one ends, the running one.
// A season gets its Wrapped once it is over, and not before: a Wrapped is the
// end of the story. These are the series' finished seasons, newest first.
async function finishedSeasons(prisma, seriesRow, includePrivate) {
  const priv = includePrivate ? new Set() : await getPrivateSeasonIds(prisma);
  const seasons = (await seasonIdsOfSeries(prisma, seriesRow.id)).filter((s) => !priv.has(s.id)).sort((a, b) => b.number - a.number);
  const out = [];
  for (const s of seasons) {
    const races = await prisma.race.findMany({ where: { seasonId: s.id, isSpecialEvent: false }, select: { number: true, isCompleted: true, isSpecialEvent: true } });
    if (seasonCompleteFromRaces(races)) out.push(s);
  }
  return out;
}

// The numbers of a series' finished, public seasons: the ones that have a
// Wrapped. The site shows the way to Wrapped only where this is not empty.
export async function wrappedSeasonNumbers(prisma, series = null) {
  const seriesRow = await resolveSeries(prisma, series || undefined, { includePrivate: false });
  if (!seriesRow) return [];
  return (await finishedSeasons(prisma, seriesRow, false)).map((s) => s.number);
}

// Whether `driverId` is the signed-in member's own row (any of their linked
// rows counts), so the story can say "you". Worked out per request: the
// Wrapped itself is cached and the same for everybody.
export async function isOwnWrapped(prisma, discordId, driverId) {
  if (!discordId || !driverId) return false;
  const row = await prisma.driver.findUnique({ where: { id: driverId }, select: { seasonId: true } });
  if (!row?.seasonId) return false;
  return (await myRowIn(prisma, discordId, row.seasonId)) === driverId;
}

// The member's own row in that season, through the person links.
async function myRowIn(prisma, discordId, seasonId) {
  if (!discordId) return null;
  const own = await prisma.driver.findFirst({ where: { discordUserId: discordId }, select: { id: true } });
  if (!own) return null;
  const ids = await getLinkedDriverIds(prisma, own.id);
  const row = await prisma.driver.findFirst({ where: { id: { in: ids }, seasonId }, select: { id: true } });
  return row?.id || null;
}

// The hub of one finished season (the newest when the address names none).
// A season still being raced has no Wrapped yet: asked for by number it
// answers { notFinished: true }; with nothing finished at all the hub is
// empty (season null) and says what it is waiting for.
export async function getWrappedHub(prisma, { series = null, season = null, includePrivate = false, discordId = null } = {}) {
  const seriesRow = await resolveSeries(prisma, series || undefined, { includePrivate });
  if (!seriesRow) return null;
  const finished = await finishedSeasons(prisma, seriesRow, includePrivate);
  let picked = null;
  if (season != null && season !== "") {
    const asked = await resolveSeason(prisma, season, { includePrivate, series: seriesRow.slug });
    if (!asked) return null;
    if (!finished.some((s) => s.id === asked.id)) return { notFinished: true, season: { number: asked.number, label: seasonLabelOf(asked) } };
    picked = asked;
  } else if (finished.length) {
    picked = await prisma.season.findUnique({ where: { id: finished[0].id } });
  }
  if (!picked) {
    const active = await getActiveSeason(prisma, seriesRow.id).catch(() => null);
    return {
      series: { slug: seriesRow.slug, name: seriesRow.name },
      season: null,
      seasons: [],
      drivers: [],
      mine: null,
      waitingFor: active ? seasonLabelOf(active) : null,
    };
  }
  const book = await seasonBook(prisma, picked.id);
  if (!book) return null;

  const seasonRows = await prisma.season.findMany({ where: { id: { in: finished.map((s) => s.id) } }, select: { number: true, name: true } });

  const drivers = book.finalRows.map((r, i) => {
    const fin = finishesOf(roundsOf(r));
    return {
      driverId: r.driverId,
      name: r.name,
      position: i + 1,
      points: r.total,
      wins: fin.filter((c) => c.position === 1).length,
      podiums: fin.filter((c) => c.position <= 3).length,
      photoUrl: r.photoUrl || null,
      country: r.country || null,
      team: r.team ? { id: r.team.id, name: r.team.name, color: r.team.color, logoUrl: r.team.logoUrl, tier: r.team.tier } : null,
    };
  });

  return {
    series: { slug: seriesRow.slug, name: seriesRow.name },
    season: {
      number: book.season.number,
      name: book.season.name,
      label: seasonLabelOf(book.season),
      complete: book.complete,
      roundsRun: book.roundsRun,
      totalRounds: book.totalRounds,
    },
    seasons: seasonRows.sort((a, b) => b.number - a.number).map((s) => ({ number: s.number, label: seasonLabelOf(s) })),
    drivers,
    mine: await myRowIn(prisma, discordId, picked.id),
  };
}

// The most recent finished season of each series, for the launch note and the
// "your Wrapped is ready" note when a finale is saved.
export async function latestCompleteSeasons(prisma) {
  const out = [];
  const [series, bySeason] = await Promise.all([dbListSeries(prisma, { includePrivate: false }), seasonSeriesMap(prisma)]);
  const priv = await getPrivateSeasonIds(prisma);
  for (const s of series) {
    const seasonIds = [...bySeason.entries()].filter(([, sid]) => sid === s.id).map(([id]) => id).filter((id) => !priv.has(id));
    const seasons = await prisma.season.findMany({ where: { id: { in: seasonIds } }, orderBy: { number: "desc" } });
    for (const season of seasons) {
      const races = await prisma.race.findMany({ where: { seasonId: season.id, isSpecialEvent: false }, select: { number: true, isCompleted: true } });
      if (seasonCompleteFromRaces(races)) {
        out.push({ series: s, season });
        break;
      }
    }
  }
  return out;
}

// --- "your Wrapped is ready" --------------------------------------------------------

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

// The finale has been saved: every driver of the season with a login hears
// that their Wrapped is there, once (the dedupe key is per season and person,
// so saving the finale again, or an edit after it, stays silent). Called after
// every results save and does nothing until the season is complete. While the
// page is admins-only, only the admins hear about it. Best-effort, like every
// bell entry: a results save never waits on it or fails because of it.
export async function notifyWrappedReady(prisma, seasonId) {
  try {
    if (!seasonId) return 0;
    const mode = await wrappedMode(prisma);
    if (mode === "off") return 0;
    if ((await getPrivateSeasonIds(prisma)).has(seasonId)) return 0;
    const book = await seasonBook(prisma, seasonId);
    if (!book?.complete || !book.finalRows.length) return 0;

    const seriesId = (await seasonSeriesMap(prisma)).get(seasonId) || null;
    const series = seriesId ? (await dbListSeries(prisma, { includePrivate: true })).find((s) => s.id === seriesId) : null;
    const prefix = series?.slug ? `/s/${series.slug}` : "";
    const label = seasonLabelOf(book.season);
    const ids = await discordIdsForDrivers(prisma, book.finalRows.map((r) => r.driverId));
    const admins = mode === "admins" ? await getAdminDiscordIds(prisma) : null;

    let sent = 0;
    for (const [i, row] of book.finalRows.entries()) {
      const discordId = ids.get(row.driverId);
      if (!discordId || (admins && !admins.has(String(discordId)))) continue;
      const fresh = await dbCreateNotification(prisma, {
        type: "WRAPPED",
        title: `Your ${label} Wrapped is ready`,
        body: `${ordinal(i + 1)} in the championship with ${row.total} points. Your season, told in cards, to keep and to share.`,
        link: `${prefix}/wrapped/${row.driverId}`,
        recipientId: String(discordId),
        dedupeKey: `wrapped:${seasonId}:${discordId}`,
      });
      if (fresh) sent += 1;
    }
    return sent;
  } catch {
    return 0;
  }
}
