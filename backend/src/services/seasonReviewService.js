// ---------------------------------------------------------------------------
// The season review: one driver's season, told in the race recap's chapters.
//
// The race recap (lib/raceRecap.js) tells one round from a driver's seat. This
// does the same for a whole season: where they finished and how the table
// moved round by round, every round as a line of a results sheet, the best
// race and the biggest climb, the team-mate and the driver next to them in the
// table, their numbers set against the rest of the field, the contact race by
// race, and what the season gave them.
//
// Nothing is worked out here that the site does not already publish. The
// season figures are the driver profile's (getDriverProfile), the table is the
// standings, the honours are the Home page's season honours and the awards are
// the ones the league typed in. What is new is only the telling, and the one
// thing a profile cannot do on its own: put a number next to everybody else's
// ("3rd most overtakes of 19"). Every rank is taken over the drivers who raced
// in the same table, so a "P4 of 19" here is the "P4 of 19" of the profile.
//
// Public data only: no rating breakdown, no tokens, no names of who touched
// whom. It is a page that can be passed around, so it is one page per driver
// row (and so per season), open to whoever may see that driver's profile.
//
// A season still being raced gets the same page as "so far", without the
// honours (nobody has won them yet). Archived seasons carry less (no grid
// slots, no telemetry, early rounds that only exist as points), and a chapter
// whose data the season does not have stays away.
//
// The league switches it on like the recap: off, admins first, everyone.
// ---------------------------------------------------------------------------
import { getDriverProfile } from "./driverProfileService.js";
import { applyDropScores, compareFinishSheets, finishSheetOf } from "./standingsService.js";
import { getSeasonHonours } from "./honoursService.js";
import { seasonCompleteFromRaces, isSeasonComplete } from "../lib/seasonComplete.js";
import { finishesOf, hasRaced, roundsOf } from "../lib/standingsRow.js";
import { readSprintChildren } from "../lib/sprintRaces.js";
import { readPoleHolders, readManualFastestLaps } from "../lib/raceHonours.js";
import { telemetryBySeason } from "../lib/telemetryRead.js";
import { readRaceHeroes } from "../lib/raceHero.js";
import { readSeasonAwards } from "../lib/seasonAwards.js";
import { taggedPhotos } from "../lib/racePhotoTags.js";

export const REVIEW_SETTING = "season_review";
// Off or on, the same for everybody, admins included. ("admins", a former
// step, reads as off.)
export const REVIEW_MODES = ["off", "all"];
export const DEFAULT_REVIEW_MODE = "off";

// The fewest rounds a season needs before it has a story to tell.
export const MIN_ROUNDS = 2;

export async function reviewMode(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: REVIEW_SETTING } });
    if (REVIEW_MODES.includes(row?.value)) return row.value;
  } catch {
    /* fresh database, no Setting table yet */
  }
  return DEFAULT_REVIEW_MODE;
}

export async function setReviewMode(prisma, mode) {
  const value = REVIEW_MODES.includes(mode) ? mode : DEFAULT_REVIEW_MODE;
  await prisma.setting.upsert({
    where: { key: REVIEW_SETTING },
    create: { key: REVIEW_SETTING, value },
    update: { value },
  });
  return value;
}

// Until when drivers can watch it (an admin setting): a date, YYYY-MM-DD, to
// the end of that day in the league's time zone; none means no end.
export const REVIEW_UNTIL_SETTING = "season_review_until";
const leagueToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

export async function reviewUntil(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: REVIEW_UNTIL_SETTING } });
    return /^\d{4}-\d{2}-\d{2}$/.test(row?.value || "") ? row.value : null;
  } catch {
    return null;
  }
}

export async function setReviewUntil(prisma, until) {
  const value = /^\d{4}-\d{2}-\d{2}$/.test(String(until || "")) ? String(until) : null;
  if (value) await prisma.setting.upsert({ where: { key: REVIEW_UNTIL_SETTING }, create: { key: REVIEW_UNTIL_SETTING, value }, update: { value } });
  else await prisma.setting.deleteMany({ where: { key: REVIEW_UNTIL_SETTING } });
  return value;
}

// Whether the Wrapped is open right now: switched on and not past the end
// date. Everybody then watches only their own.
export async function membersMayWatch(prisma) {
  if ((await reviewMode(prisma)) !== "all") return false;
  const until = await reviewUntil(prisma);
  return !until || leagueToday() <= until;
}

// Which seasons have a Wrapped at all (an admin setting, for everybody,
// admins included): a list of season ids. Unset, it is only the newest
// finished season of the main series, so no old season and no side series
// gets one until an admin ticks it.
export const REVIEW_SEASONS_SETTING = "season_review_seasons";

async function newestFinishedSeasons(prisma) {
  const main = await prisma.series.findFirst({ where: { isActive: true }, orderBy: { order: "asc" }, select: { id: true } }).catch(() => null);
  const seasons = await prisma.season.findMany({
    where: main ? { seriesId: main.id } : {},
    orderBy: [{ number: "desc" }],
    select: { id: true },
  });
  for (const s of seasons) if (await isSeasonComplete(prisma, s.id)) return [s.id];
  return [];
}

export async function reviewSeasons(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: REVIEW_SEASONS_SETTING } });
    const list = row ? JSON.parse(row.value) : null;
    if (Array.isArray(list)) return { ids: list.filter((x) => typeof x === "string"), chosen: true };
  } catch {
    /* unset or unreadable: the default below */
  }
  return { ids: await newestFinishedSeasons(prisma), chosen: false };
}

export async function setReviewSeasons(prisma, ids) {
  if (ids == null) {
    await prisma.setting.deleteMany({ where: { key: REVIEW_SEASONS_SETTING } });
    return reviewSeasons(prisma);
  }
  const value = JSON.stringify([...new Set((Array.isArray(ids) ? ids : []).map(String))]);
  await prisma.setting.upsert({ where: { key: REVIEW_SEASONS_SETTING }, create: { key: REVIEW_SEASONS_SETTING, value }, update: { value } });
  return reviewSeasons(prisma);
}

// Is the Wrapped open at all (for that season, when given)? One rule for
// everybody, admins included: switched on, not past the end date, a ticked
// season, and then only one's OWN (the routes check whose it is).
export async function reviewVisibleTo(prisma, req, seasonId = null) {
  if (!(await membersMayWatch(prisma))) return false;
  if (seasonId && !(await reviewSeasons(prisma)).ids.includes(seasonId)) return false;
  return true;
}

// --- the pure parts -------------------------------------------------------------

const MAX_LAP_MS = 1_800_000;
const isLap = (ms) => ms != null && ms > 0 && ms <= MAX_LAP_MS;
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const isFinish = (c) => c.status === "FINISHED" && c.position != null;

// Every classification of a profile's race-by-race rows: the feature race of
// each round and, on a sprint weekend, the sprint.
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

// The Tier 2 lens. A Tier 2 driver, or a reserve who mostly finished behind
// where the Tier 1 cars do, is told their races among the Tier 2 drivers
// (the same field the Tier 2 table counts, the driver added): P18 overall
// may be P5 among them, and that is the race they were really in. Returns the race-by-race rows with
// those places (the overall one kept as `overall`), each race's field of
// such cars, and their wins and podiums in it; null for everyone else and
// for seasons without tiers.
export async function classLens(prisma, rows, me, perRace) {
  if (!me) return null;
  const tierOf = (r) => r.team?.tier ?? r.tier ?? null;
  const t1 = new Set(rows.filter((r) => tierOf(r) === 1).map((r) => r.driverId));
  const t2 = new Set(rows.filter((r) => tierOf(r) === 2).map((r) => r.driverId));
  if (!t1.size || !t2.size) return null;
  const mine = tierOf(me);
  if (mine === 1) return null;
  if (mine !== 2) {
    const fins = (perRace || []).filter(isFinish).map((r) => r.position);
    if (!fins.length) return null;
    if (fins.reduce((a, b) => a + b, 0) / fins.length <= t1.size) return null;
  }
  const ids = [];
  for (const r of perRace || []) {
    if (r.raceId) ids.push(r.raceId);
    if (r.sprint?.raceId) ids.push(r.sprint.raceId);
  }
  if (!ids.length) return null;
  const res = await prisma.raceResult.findMany({ where: { raceId: { in: ids } }, select: { raceId: true, driverId: true, position: true, grid: true, status: true } });
  const field = new Map();
  for (const x of res) {
    if (!t2.has(x.driverId) && x.driverId !== me.driverId) continue;
    if (!field.has(x.raceId)) field.set(x.raceId, []);
    field.get(x.raceId).push(x);
  }
  // Places are counted on the sheet's own (raw) order, the driver's too, so
  // everyone is measured the same way.
  const placeIn = (raceId, cell) => {
    const cars = field.get(raceId);
    const own = cars?.find((x) => x.driverId === me.driverId);
    if (!cell || !cars || !own) return cell;
    const others = cars.filter((x) => x.driverId !== me.driverId);
    const position = isFinish(cell) && own.position != null ? 1 + others.filter((x) => x.status === "FINISHED" && x.position != null && x.position < own.position).length : cell.position;
    const grid = own.grid > 0 ? 1 + others.filter((x) => x.grid > 0 && x.grid < own.grid).length : cell.grid;
    return { ...cell, position, grid, overall: cell.position };
  };
  const lensed = (perRace || []).map((r) => {
    const out = placeIn(r.raceId, r);
    return r.sprint ? { ...out, sprint: placeIn(r.sprint.raceId, r.sprint) } : out;
  });
  const starters = new Map([...field].map(([raceId, cars]) => [raceId, cars.filter((x) => x.status !== "DNS").length]));
  const fin = classificationsOfPerRace(lensed).filter(isFinish);
  return {
    label: "Tier 2",
    perRace: lensed,
    starters,
    wins: fin.filter((c) => c.position === 1).length,
    podiums: fin.filter((c) => c.position <= 3).length,
  };
}

// The best race: the highest classified finish, then the most points, then
// the earlier round (the first time is the one people remember), the feature
// race before the sprint.
export function bestResult(perRace) {
  const fin = classificationsOfPerRace(perRace).filter(isFinish);
  if (!fin.length) return null;
  fin.sort((a, b) => a.position - b.position || b.points - a.points || a.round - b.round || Number(a.sprint) - Number(b.sprint));
  return fin[0];
}

// The biggest climb from grid to flag, feature races only (a sprint grid is
// reversed or inherited, the same rule as the profile's places gained). Three
// places is the least worth telling.
export function biggestClimb(perRace, least = 3) {
  let best = null;
  for (const c of classificationsOfPerRace(perRace)) {
    if (c.sprint || !isFinish(c) || !(c.grid > 0)) continue;
    const gained = c.grid - c.position;
    if (gained >= least && (!best || gained > best.gained)) best = { ...c, gained };
  }
  return best;
}

// Two standings rows side by side over the rounds both drove: who finished
// ahead (both classified, sprints included), who started ahead (the feature
// race's grid). Rows are standings rows: perRace keyed by round number, cells
// { status, position, grid, sprint }.
export function headToHead(mine, theirs) {
  const out = { races: 0, ahead: 0, behind: 0, starts: 0, qualiAhead: 0, qualiBehind: 0 };
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
      out.starts += 1;
      if (cell.grid < other.grid) out.qualiAhead += 1;
      else out.qualiBehind += 1;
    }
  }
  return out;
}

// The championship as it stood after each round, for every driver: the table
// the site showed that night. Built from the final rows' round cells: after
// round k a driver has the points of rounds 1..k, and the drop rule works the
// way it did then, over the whole calendar with the rounds still to come
// counting as zeroes (so they are the first to go, and a real result only
// drops once the season runs out of empty rounds). Ties go to the countback.
// Ranked among the drivers who had raced by then.
//
// A finished season's last point is the final table itself (champion rule,
// official sheet and hand-set points included), so the line ends on the
// number the page prints at the top.
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

// Where `mine` stands among `values` (one per driver, the driver's own among
// them): 1 + how many did better. `more` says which way is better. Null when
// the figure is nothing to rank (no value, or a zero where more is better).
export function rankAmong(values, mine, { more = true } = {}) {
  const list = values.filter((v) => v != null && Number.isFinite(v));
  if (mine == null || !Number.isFinite(mine) || !list.length) return null;
  if (more && mine <= 0) return null;
  const better = list.filter((v) => (more ? v > mine : v < mine)).length;
  const level = list.filter((v) => v === mine).length;
  return { rank: better + 1, of: list.length, shared: level > 1 };
}

// The honours of the season that went to this driver, from the Home page's
// season honours. Only for a finished season: an award is not won until the
// season is over.
export function honoursFor(honours, { driverId, teamId = null, position = null, complete = false }) {
  const out = [];
  if (!complete || !honours) return out;
  // A title says it all on its own: no detail that only repeats it.
  if (position === 1) out.push({ key: "champion", title: "Champion", detail: null });
  else if (position === 2) out.push({ key: "vice", title: "Runner-up", detail: null });
  else if (position === 3) out.push({ key: "third", title: "Third in the championship", detail: null });
  for (const t of honours.teamChampions || []) {
    if (teamId && t.teamId === teamId) out.push({ key: "team", title: "Team champions", detail: `${t.name}, Tier ${t.tier}` });
  }
  if (honours.bestNewcomer?.driverId === driverId) out.push({ key: "newcomer", title: "Best newcomer", detail: "The top driver in their first season" });
  if (honours.fastestLap?.driverId === driverId) {
    out.push({ key: "fastest-lap", title: "Fastest lap of the season", detail: honours.fastestLap.track || null, ms: honours.fastestLap.ms ?? null });
  }
  if (honours.mostOvertakes?.driverId === driverId) out.push({ key: "overtakes", title: "Most overtakes", detail: `${honours.mostOvertakes.count} passes` });
  if (honours.mostLapsLed?.driverId === driverId) out.push({ key: "laps-led", title: "Most laps led", detail: `${honours.mostLapsLed.count} laps in front` });
  if (honours.cleanest?.driverId === driverId) {
    out.push({ key: "cleanest", title: "Cleanest driver", detail: `${honours.cleanest.contacts} contacts in ${honours.cleanest.starts} starts` });
  }
  return out;
}

// The driver's place in the final table with the rows around it: two above,
// two below, more at the ends so the window stays five long.
export function tableWindow(rows, driverId, size = 5) {
  const i = rows.findIndex((r) => r.driverId === driverId);
  if (i < 0) return [];
  let from = Math.max(0, i - Math.floor(size / 2));
  const to = Math.min(rows.length, from + size);
  from = Math.max(0, to - size);
  return rows.slice(from, to).map((r, k) => ({
    position: from + k + 1,
    driverId: r.driverId,
    name: r.name,
    points: r.total,
    team: r.team ? { name: r.team.name, color: r.team.color || null } : null,
    you: r.driverId === driverId,
  }));
}

// --- the season around one driver --------------------------------------------------

// Every race of the season with the columns the review reads, by raw SQL
// because the division, parent and Driver of the Day columns are managed
// outside the Prisma schema (lib/ensureSchema.js).
async function seasonRaces(prisma, seasonId) {
  try {
    return await prisma.$queryRawUnsafe(
      `SELECT "id", "number", "track", "date", "isCompleted", "isSpecialEvent", "division", "parentRaceId", "driverOfTheDayId" FROM "Race" WHERE "seasonId" = ?`,
      seasonId
    );
  } catch {
    const rows = await prisma.race.findMany({
      where: { seasonId },
      select: { id: true, number: true, track: true, date: true, isCompleted: true, isSpecialEvent: true },
    });
    return rows.map((r) => ({ ...r, division: null, parentRaceId: null, driverOfTheDayId: null }));
  }
}

const truthy = (v) => v === true || v === 1 || v === "1";

// Who held the fastest lap of each race: the admin's record where there is
// one, else the quickest stored lap of the race (ties count for both), the
// same reading as the driver profile's fastest laps.
async function fastestLapHolders(prisma, raceIds) {
  const ids = [...new Set(raceIds)];
  const held = new Map(); // raceId -> Set<driverId>
  if (!ids.length) return held;
  const manual = await readManualFastestLaps(prisma, new Set(ids)).catch(() => new Map());
  for (const [raceId, driverId] of manual) held.set(raceId, new Set([driverId]));
  const rest = ids.filter((id) => !manual.has(id));
  if (!rest.length) return held;
  const rows = await prisma.raceResult.findMany({ where: { raceId: { in: rest } }, select: { raceId: true, driverId: true, bestLapMs: true } });
  const best = new Map();
  for (const r of rows) {
    if (!isLap(r.bestLapMs)) continue;
    const b = best.get(r.raceId);
    if (b == null || r.bestLapMs < b) best.set(r.raceId, r.bestLapMs);
  }
  for (const r of rows) {
    if (isLap(r.bestLapMs) && r.bestLapMs === best.get(r.raceId)) {
      if (!held.has(r.raceId)) held.set(r.raceId, new Set());
      held.get(r.raceId).add(r.driverId);
    }
  }
  return held;
}

// The season's races sorted into what the review needs: the rounds that were
// run, their sprint and Division 2 races, and per race who took pole, who set
// the fastest lap and who was Driver of the Day.
async function seasonFacts(prisma, seasonId) {
  const all = await seasonRaces(prisma, seasonId);
  const rounds = all
    .filter((r) => r.number != null && !truthy(r.isSpecialEvent) && !r.parentRaceId)
    .sort((a, b) => a.number - b.number);
  const run = rounds.filter((r) => truthy(r.isCompleted));
  const complete = seasonCompleteFromRaces(rounds.map((r) => ({ ...r, isCompleted: truthy(r.isCompleted), isSpecialEvent: false })));
  const runIds = new Set(run.map((r) => r.id));

  // Division 2 races hang off their round (lib/divisions.js); a sprint hangs
  // off its round too (lib/sprintRaces.js). Both are found by their parent.
  const div2Of = new Map(); // round id -> Division 2 race
  for (const r of all) if (Number(r.division) === 2 && r.parentRaceId && runIds.has(r.parentRaceId)) div2Of.set(r.parentRaceId, r);
  const sprintIdOf = await readSprintChildren(prisma, [...run.map((r) => r.id), ...[...div2Of.values()].map((r) => r.id)]).catch(() => new Map());
  const byId = new Map(all.map((r) => [r.id, r]));

  // Pole is per round: the feature race's holder, else the sprint's (the
  // site's one rule for it, driverProfileService / recordsService).
  const featureIds = [...run.map((r) => r.id), ...[...div2Of.values()].map((r) => r.id)];
  const raceIds = [...featureIds, ...sprintIdOf.values()];
  const [poles, fastest] = await Promise.all([
    readPoleHolders(prisma, raceIds).catch(() => new Map()),
    fastestLapHolders(prisma, raceIds),
  ]);
  const dotd = new Map();
  for (const id of raceIds) {
    const r = byId.get(id);
    if (r?.driverOfTheDayId) dotd.set(id, r.driverOfTheDayId);
  }
  return { rounds, run, complete, div2Of, sprintIdOf, poles, fastest, dotd };
}

// The round's pole sitter: the feature race's, else its sprint's.
const poleOf = (facts, fid) => (fid ? facts.poles.get(fid) ?? facts.poles.get(facts.sprintIdOf.get(fid)) ?? null : null);

// Each driver's season totals the profile cannot rank on its own, for every
// driver of the table at once: wins and podiums from the table's own cells,
// poles, fastest laps and Driver of the Day from the races, and the telemetry
// sums (passes, laps led, contact) from the stored race figures.
function fieldTallies(rows, facts, tel, division) {
  const out = new Map();
  const featureOf = (round) => (division === 2 ? facts.div2Of.get(round.id)?.id : round.id);
  for (const row of rows) {
    const fin = finishesOf(roundsOf(row));
    out.set(row.driverId, {
      driverId: row.driverId,
      name: row.name,
      points: row.total ?? 0,
      wins: fin.filter((c) => c.position === 1).length,
      podiums: fin.filter((c) => c.position <= 3).length,
      finishes: fin.length,
      avgFinish: avg(fin.map((c) => c.position)),
      poles: 0,
      fastestLaps: 0,
      dotd: 0,
      overtakes: null,
      lapsLed: null,
      contacts: null,
      envContacts: null,
      telemetryStarts: 0,
      lapsRaced: null,
      cuts: null,
    });
  }
  // The championship's own races, so the stored figures are summed over the
  // same races the table is (no special events, no other division).
  const champ = new Set();
  for (const round of facts.run) {
    const fid = featureOf(round);
    if (!fid) continue;
    const ids = [fid, facts.sprintIdOf.get(fid)].filter(Boolean);
    ids.forEach((id) => champ.add(id));
    const pole = poleOf(facts, fid);
    if (pole && out.has(pole)) out.get(pole).poles += 1;
    for (const id of ids) {
      for (const d of facts.fastest.get(id) || []) if (out.has(d)) out.get(d).fastestLaps += 1;
      const dd = facts.dotd.get(id);
      if (dd && out.has(dd)) out.get(dd).dotd += 1;
    }
  }
  for (const [key, t] of tel) {
    const cut = key.indexOf("|");
    if (!champ.has(key.slice(0, cut))) continue;
    const o = out.get(key.slice(cut + 1));
    if (!o || t.contacts == null) continue;
    o.overtakes = (o.overtakes || 0) + (t.overtakes || 0);
    o.lapsLed = (o.lapsLed || 0) + (t.lapsLed || 0);
    o.contacts = (o.contacts || 0) + (t.contacts || 0);
    o.envContacts = (o.envContacts || 0) + (t.envContacts || 0);
    o.lapsRaced = (o.lapsRaced || 0) + (t.laps || 0);
    o.cuts = (o.cuts || 0) + (t.cuts || 0);
    o.telemetryStarts += 1;
  }
  return out;
}

// How many took the start of each race: the field a grid slot and a finish
// are measured on (not the season's table, which counts everybody who ever
// drove).
async function startersOf(prisma, raceIds) {
  const ids = [...new Set(raceIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.raceResult.groupBy({ by: ["raceId"], where: { raceId: { in: ids }, status: { not: "DNS" } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.raceId, r._count._all]));
}

// The laps driven on the practice servers in the weeks before each round of
// the season, per driver: the figure the NABS Tokens count training by
// (lib/practiceTokens.js, TokenPractice), kept per Steam id and race week.
// A driver's laps are found through the Steam id on their row.
export async function trainingFor(prisma, { series, seasonId, raceIds, driverId, names }) {
  if (!series || !raceIds.length) return null;
  const periods = raceIds.map((id) => `race:${id}`);
  const [laps, drivers] = await Promise.all([
    prisma.tokenPractice.findMany({ where: { series, period: { in: periods } }, select: { steamId: true, period: true, laps: true } }),
    prisma.driver.findMany({ where: { seasonId, steamId: { not: null } }, select: { id: true, steamId: true } }),
  ]);
  if (!laps.length) return null;
  const rowOf = new Map(drivers.map((d) => [String(d.steamId), d.id]));
  const total = new Map();
  const weeks = new Map();
  for (const l of laps) {
    const id = rowOf.get(String(l.steamId));
    if (!id || !names.has(id) || !(l.laps > 0)) continue;
    total.set(id, (total.get(id) || 0) + l.laps);
    if (!weeks.has(id)) weeks.set(id, new Set());
    weeks.get(id).add(l.period);
  }
  if (!total.size) return null;
  const list = [...total].map(([id, n]) => ({ driverId: id, name: names.get(id), training: n }));
  const sorted = list.sort((a, b) => b.training - a.training || String(a.name).localeCompare(String(b.name)));
  const mineN = total.get(driverId) || 0;
  const row = (t) => ({ name: t.name, value: t.training, you: t.driverId === driverId, rank: 1 + sorted.filter((x) => x.training > t.training).length });
  const top = sorted.slice(0, 5).map(row);
  const at = sorted.findIndex((t) => t.driverId === driverId);
  if (at >= 5) top.push(row(sorted[at]));
  return {
    laps: mineN,
    weeks: weeks.get(driverId)?.size || 0,
    rank: mineN > 0 ? rankAmong(sorted.map((t) => t.training), mineN) : null,
    board: { of: sorted.length, rows: top },
  };
}

// The laps on each tyre over the season, most first, from the stints the
// race files record.
export function tyreMix(rounds) {
  const by = new Map();
  for (const r of rounds) for (const st of r.stints || []) if (st.tyre && st.laps > 0) by.set(st.tyre, (by.get(st.tyre) || 0) + st.laps);
  if (!by.size) return null;
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  return [...by].sort((a, b) => b[1] - a[1]).map(([tyre, laps]) => ({ tyre, laps, share: Math.round((laps / total) * 100) }));
}

const seasonLabelOf = (season) => {
  const name = String(season?.name || "").trim();
  if (name && !/^\d+$/.test(name)) return name;
  return season?.number != null ? `Season ${season.number}` : name || "The season";
};

// --- one driver ---------------------------------------------------------------------

// Worked out once per driver and kept a few minutes; dropped whenever results
// are saved (invalidateSeasonReviewCache, called with the other caches).
const KEEP_MS = 5 * 60 * 1000;
const reviews = new Map(); // driverId -> { at, promise }

export function invalidateSeasonReviewCache() {
  reviews.clear();
}

export function getSeasonReview(prisma, driverId) {
  const hit = reviews.get(driverId);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.promise;
  const promise = buildSeasonReview(prisma, driverId);
  reviews.set(driverId, { at: Date.now(), promise });
  promise.catch(() => reviews.delete(driverId));
  if (reviews.size > 200) reviews.delete(reviews.keys().next().value);
  return promise;
}

async function buildSeasonReview(prisma, driverId) {
  const row = await prisma.driver.findUnique({ where: { id: driverId }, include: { season: true } });
  if (!row?.seasonId) return null;
  const [profile, facts, tel] = await Promise.all([
    getDriverProfile(prisma, driverId),
    seasonFacts(prisma, row.seasonId),
    telemetryBySeason(prisma, row.seasonId).catch(() => new Map()),
  ]);
  if (!profile) return null;
  const season = row.season;
  const division = profile.driver.division === 2 ? 2 : 1;
  const head = {
    number: season.number,
    name: season.name,
    label: seasonLabelOf(season),
    complete: facts.complete,
    roundsRun: facts.run.length,
    totalRounds: facts.rounds.length,
    from: facts.run[0]?.date || null,
    to: facts.run[facts.run.length - 1]?.date || null,
  };
  const stats = profile.stats || {};
  if (facts.run.length < MIN_ROUNDS) return { tooEarly: true, season: head, driver: { id: profile.driver.id, name: profile.driver.name } };
  if (!stats.starts) return { empty: true, season: head, driver: { id: profile.driver.id, name: profile.driver.name } };

  const table = profile.season?.standings || [];
  const rows = table.filter(hasRaced);
  const me = rows.find((r) => r.driverId === driverId) || null;
  const position = profile.championship?.position ?? null;
  // Back in the field: the races told among the cars outside Tier 1.
  const lens = await classLens(prisma, rows, me, profile.perRace).catch(() => null);
  const perRace = lens ? lens.perRace : profile.perRace;

  // The table after every round, and this driver's line through it.
  const trackOf = new Map(facts.run.map((r) => [r.number, r.track]));
  const after = journeyTables(
    { rows: table, raceNumbers: profile.season?.raceNumbers || facts.rounds.map((r) => r.number), dropWorst: profile.season?.dropWorst || 0 },
    facts.run.map((r) => r.number),
    // The table as it stands IS the table after the latest round (hand-set
    // points and the champion rule included), so the line ends on it.
    !profile.season?.officialTotals ? rows : null
  );
  const journey = (after.get(driverId) || []).map((j) => ({ ...j, track: trackOf.get(j.round) || null }));
  // Seasons scored off the league's own sheet (officialTotals) do not add up
  // round by round, so they get no line: the final place is the only true one.
  const showJourney = !profile.season?.officialTotals && journey.length >= MIN_ROUNDS;
  const peak = showJourney ? journey.reduce((best, j) => (!best || j.position < best.position ? j : best), null) : null;

  // Every round as a line of the sheet, read off the race the driver really
  // drove that night: a driver can race in both divisions in one season (a
  // promotion, a reserve taking a Division 2 seat), and the profile files a
  // Division 2 result under its round.
  const ownRaceIds = new Set((await prisma.raceResult.findMany({ where: { driverId }, select: { raceId: true } }).catch(() => [])).map((r) => r.raceId));
  const featureOf = (raceId) => {
    const child = facts.div2Of.get(raceId)?.id;
    if (child && ownRaceIds.has(child)) return child;
    return division === 2 && child ? child : raceId;
  };
  const telOf = (...ids) => {
    const got = ids.filter(Boolean).map((id) => tel.get(`${id}|${driverId}`)).filter((t) => t && t.contacts != null);
    if (!got.length) return null;
    const sum = (k) => got.reduce((n, t) => n + (t[k] || 0), 0);
    return {
      contacts: sum("contacts"),
      envContacts: sum("envContacts"),
      overtakes: sum("overtakes"),
      lapsLed: sum("lapsLed"),
      laps: sum("laps"),
      cuts: sum("cuts"),
      gamePenalties: sum("gamePenalties"),
      stints: got.flatMap((t) => (Array.isArray(t.stints) ? t.stints : [])),
      races: got.length,
    };
  };
  const best = bestResult(perRace);
  const climb = biggestClimb(perRace);
  const afterByRound = new Map(journey.map((j) => [j.round, j.position]));
  const rounds = (perRace || []).map((r) => {
    const fid = featureOf(r.raceId);
    const sid = fid ? facts.sprintIdOf.get(fid) : null;
    const flHeld = (id) => !!id && (facts.fastest.get(id)?.has(driverId) || false);
    const t = r.status === "DNS" && !r.sprint ? null : telOf(fid, sid);
    return {
      round: r.number,
      raceId: r.raceId,
      track: r.track,
      status: r.status,
      position: r.position ?? null,
      // The overall place, where the lens counts the position among Tier 2.
      overall: r.overall ?? null,
      grid: r.grid ?? null,
      points: r.points || 0,
      sprint: r.sprint ? { position: r.sprint.position ?? null, overall: r.sprint.overall ?? null, status: r.sprint.status, points: r.sprint.points || 0 } : null,
      pole: poleOf(facts, fid) === driverId,
      fastestLap: flHeld(fid) || flHeld(sid),
      dotd: [fid, sid].some((id) => id && facts.dotd.get(id) === driverId),
      contacts: t ? t.contacts : null,
      envContacts: t ? t.envContacts : null,
      overtakes: t ? t.overtakes : null,
      lapsRaced: t ? t.laps : null,
      cuts: t ? t.cuts : null,
      gamePenalties: t ? t.gamePenalties : null,
      stints: t ? t.stints.map((st) => ({ tyre: st.tyre || st.compound || null, laps: Number(st.laps) || 0 })) : null,
      lapsLed: t ? t.lapsLed : null,
      telemetryRaces: t ? t.races : 0,
      after: showJourney ? afterByRound.get(r.number) ?? null : null,
      // Struck out under the season's drop rule. Only once the season is
      // over: until then the rule drops the rounds still to come first, and a
      // round that paid nothing is nothing to strike out.
      dropped: facts.complete && (r.points || 0) > 0 && (me?.droppedRounds || []).includes(r.number),
      best: !!best && best.round === r.number,
    };
  });

  // Everybody's season, for the ranks. The driver's own line is the one the
  // rounds above were read from, so the page and its ranks say the same.
  const tallies = fieldTallies(rows, facts, tel, division);
  const mine = { ...(tallies.get(driverId) || {}) };
  const ownTel = rounds.filter((r) => r.contacts != null);
  mine.poles = rounds.filter((r) => r.pole).length;
  mine.fastestLaps = rounds.filter((r) => r.fastestLap).length;
  mine.dotd = rounds.filter((r) => r.dotd).length;
  mine.overtakes = ownTel.length ? ownTel.reduce((n, r) => n + (r.overtakes || 0), 0) : null;
  mine.lapsLed = ownTel.length ? ownTel.reduce((n, r) => n + (r.lapsLed || 0), 0) : null;
  mine.contacts = ownTel.length ? ownTel.reduce((n, r) => n + r.contacts, 0) : null;
  mine.telemetryStarts = ownTel.reduce((n, r) => n + r.telemetryRaces, 0);
  mine.lapsRaced = ownTel.length ? ownTel.reduce((n, r) => n + (r.lapsRaced || 0), 0) : null;
  mine.cuts = ownTel.length ? ownTel.reduce((n, r) => n + (r.cuts || 0), 0) : null;
  tallies.set(driverId, mine);
  const others = [...tallies.values()];
  const all = (key) => others.map((t) => t[key]);
  // Average finish among drivers with a fair share of finishes (two races
  // and a podium is not an average).
  const minFin = Math.max(2, Math.ceil(Math.max(...all("finishes"), 0) / 2));
  const ranks = {
    wins: rankAmong(all("wins"), mine.wins),
    podiums: rankAmong(all("podiums"), mine.podiums),
    poles: rankAmong(all("poles"), mine.poles),
    fastestLaps: rankAmong(all("fastestLaps"), mine.fastestLaps),
    overtakes: rankAmong(all("overtakes"), mine.overtakes),
    lapsLed: rankAmong(all("lapsLed"), mine.lapsLed),
    avgFinish: mine.finishes >= minFin ? rankAmong(others.filter((t) => t.finishes >= minFin).map((t) => t.avgFinish), mine.avgFinish, { more: false }) : null,
  };
  // The leaderboard of one figure: the top five by name, and the driver
  // under them with their own place when they are further back.
  const board = (key, list = others) => {
    const sorted = list.filter((t) => t[key] > 0).sort((a, b) => b[key] - a[key] || String(a.name).localeCompare(String(b.name)));
    if (!sorted.length) return null;
    const row = (t) => ({ name: t.name, value: t[key], you: t.driverId === driverId, rank: 1 + sorted.filter((x) => x[key] > t[key]).length });
    const top = sorted.slice(0, 5).map(row);
    const at = sorted.findIndex((t) => t.driverId === driverId);
    if (at >= 5) top.push(row(sorted[at]));
    return { of: sorted.length, rows: top };
  };
  // How many drivers had the server's figures at all: the field the passes
  // and laps led are ranked in.
  const telField = others.filter((t) => t.telemetryStarts > 0).length;
  // Contact per race against the field's, among drivers who raced a fair
  // share of the races on file. A comparison, not a public ranking.
  const minTel = Math.max(3, Math.ceil(Math.max(...all("telemetryStarts"), 0) / 2));
  const fieldRates = others.filter((t) => t.telemetryStarts >= minTel).map((t) => t.contacts / t.telemetryStarts);

  // A Tier 2 driver's season measured against Tier 2 alone, the way the Home
  // page's Tier view does: the place among Tier 2 in the table, a "win" for
  // the best-placed Tier 2 car of a round, the ranks and leaderboards among
  // Tier 2 drivers only. Tier 1 has no block: overall is their measure.
  const myTier = me ? me.team?.tier ?? me.tier ?? null : null;
  let tier = null;
  if (myTier === 2) {
    const tierRows = rows.filter((r) => (r.team?.tier ?? r.tier) === myTier);
    if (tierRows.length >= 3) {
      const ids = new Set(tierRows.map((r) => r.driverId));
      const tt = others.filter((t) => ids.has(t.driverId));
      const allT = (key) => tt.map((t) => t[key]);
      const perRound = [];
      for (const [round, cell] of Object.entries(me.perRace || {})) {
        if (!cell || cell.status !== "FINISHED" || cell.position == null) continue;
        let rank = 1;
        for (const o of tierRows) {
          if (o.driverId === driverId) continue;
          const c = o.perRace?.[round];
          if (c && c.status === "FINISHED" && c.position != null && c.position < cell.position) rank += 1;
        }
        perRound.push({ round: Number(round), rank });
      }
      perRound.sort((a, b) => a.round - b.round);
      tier = {
        tier: myTier,
        field: tierRows.length,
        position: tierRows.findIndex((r) => r.driverId === driverId) + 1 || null,
        // The lens counts the same field, so the story's races and these
        // figures agree.
        wins: lens ? lens.wins : perRound.filter((p) => p.rank === 1).length,
        podiums: lens ? lens.podiums : perRound.filter((p) => p.rank <= 3).length,
        avgRank: avg(perRound.map((p) => p.rank)),
        perRound,
        ranks: {
          overtakes: rankAmong(allT("overtakes"), mine.overtakes),
          lapsLed: rankAmong(allT("lapsLed"), mine.lapsLed),
          lapsRaced: rankAmong(allT("lapsRaced"), mine.lapsRaced),
          fastestLaps: rankAmong(allT("fastestLaps"), mine.fastestLaps),
          poles: rankAmong(allT("poles"), mine.poles),
        },
        boards: { overtakes: board("overtakes", tt), lapsLed: board("lapsLed", tt), lapsRaced: board("lapsRaced", tt), fastestLaps: board("fastestLaps", tt) },
      };
    }
  }

  // Team-mates: the other drivers of the same roster team who raced. The
  // reserve pool is no team, so a reserve gets no team-mate.
  const team = profile.driver.team;
  const mates = me && team && team.tier !== 0 ? rows.filter((r) => r.driverId !== driverId && r.team?.id === team.id) : [];
  const teammates = mates.map((m) => ({ driverId: m.driverId, name: m.name, points: m.total, myPoints: me.total, ...headToHead(me, m) }));

  // The driver just ahead in the table (the one to catch) and just behind.
  const i = me ? rows.indexOf(me) : -1;
  const neighbour = (r) =>
    r && me
      ? { driverId: r.driverId, name: r.name, position: rows.indexOf(r) + 1, points: r.total, gap: Math.abs(r.total - me.total), ...headToHead(me, r) }
      : null;
  const ahead = i > 0 ? neighbour(rows[i - 1]) : null;
  const behind = i >= 0 && i < rows.length - 1 ? neighbour(rows[i + 1]) : null;

  // The contact race by race, where the figures exist.
  const withTel = rounds.filter((r) => r.contacts != null);
  const races = withTel.reduce((n, r) => n + r.telemetryRaces, 0);
  const cars = withTel.reduce((n, r) => n + r.contacts, 0);
  const round1 = (v) => Math.round(v * 10) / 10;
  const contact = withTel.length
    ? {
        races,
        cars,
        scenery: withTel.reduce((n, r) => n + (r.envContacts || 0), 0),
        clean: withTel.filter((r) => r.contacts === 0).length,
        rounds: withTel.length,
        perRace: races ? round1(cars / races) : null,
        fieldPerRace: fieldRates.length >= 3 ? round1(fieldRates.reduce((a, b) => a + b, 0) / fieldRates.length) : null,
      }
    : null;

  const training = await trainingFor(prisma, {
    series: profile.driver.seriesSlug,
    seasonId: row.seasonId,
    raceIds: [...facts.rounds.map((r) => r.id), ...[...facts.div2Of.values()].map((r) => r.id)],
    driverId,
    names: new Map(rows.map((r) => [r.driverId, r.name])),
  }).catch(() => null);

  const [honours, awards, heroes, starters, photos] = await Promise.all([
    facts.complete ? getSeasonHonours(prisma, row.seasonId).catch(() => null) : null,
    readSeasonAwards(prisma, [row.seasonId]).catch(() => new Map()),
    readRaceHeroes(prisma, [best?.raceId, climb?.raceId].filter(Boolean)).catch(() => new Map()),
    startersOf(prisma, [best, climb].filter(Boolean).map((c) => (c.sprint ? c.raceId : featureOf(c.raceId) || c.raceId))).catch(() => new Map()),
    // The race photos that say what is on them (lib/racePhotoTags.js), for the
    // story to put next to the slide they fit.
    taggedPhotos(prisma, rounds.filter((r) => r.raceId).map((r) => ({ raceId: r.raceId, round: r.round }))).catch(() => []),
  ]);
  // Under the Tier 2 lens a place is out of the cars outside Tier 1.
  const fieldOf = (c) => (lens ? lens.starters.get(c.raceId) : null) ?? starters.get(c.sprint ? c.raceId : featureOf(c.raceId) || c.raceId) ?? null;
  // A climb from a grid slot behind the field (a placeholder slot, a pit
  // lane start) is no climb to tell.
  const climbField = climb ? fieldOf(climb) : null;
  const climbOk = climb && (climbField == null || climb.grid <= climbField);
  const myAwards = facts.complete
    ? (awards.get(row.seasonId) || [])
        .filter((a) => a.driver?.driverId === driverId || a.partner?.driverId === driverId)
        .map((a) => ({ title: a.title, note: a.note || null }))
    : [];

  const finishes = classificationsOfPerRace(profile.perRace).filter(isFinish).map((c) => c.position);
  return {
    season: head,
    series: profile.driver.seriesSlug ? { slug: profile.driver.seriesSlug, name: profile.driver.seriesName } : null,
    driver: {
      id: profile.driver.id,
      name: profile.driver.name,
      number: profile.driver.number ?? null,
      country: profile.driver.country || null,
      photoUrl: profile.driver.photoUrl || null,
      tier: profile.driver.tier,
      division,
      team: team ? { id: team.id, name: team.name, color: team.color, logoUrl: team.logoUrl, tier: team.tier } : null,
    },
    championship: {
      position,
      points: profile.championship?.points ?? 0,
      fieldSize: profile.championship?.fieldSize ?? rows.length,
      dropWorst: profile.season?.dropWorst || 0,
      official: !!profile.season?.officialTotals,
      peak: peak ? { position: peak.position, round: peak.round, track: peak.track } : null,
      roundsLed: showJourney ? journey.filter((j) => j.position === 1).length : null,
      journey: showJourney ? journey : [],
      table: tableWindow(rows, driverId),
      ahead,
      behind,
    },
    rounds,
    stats: {
      starts: stats.starts,
      finishes: stats.finishes,
      wins: stats.wins,
      podiums: stats.podiums,
      top10: stats.top10,
      pointsFinishes: stats.pointsFinishes,
      poles: mine.poles,
      fastestLaps: mine.fastestLaps,
      dnf: stats.dnf,
      bestFinish: stats.bestFinish,
      avgFinish: mine.avgFinish ?? avg(finishes),
      positionsGained: stats.positionsGained,
      overtakes: mine.overtakes ?? null,
      lapsLed: mine.lapsLed ?? null,
      dotd: mine.dotd || 0,
      bestLap: stats.fastestLap || null,
    },
    ranks,
    // The fields the ranks are taken in: everybody who raced, and those of
    // them with the race server's figures (passes, laps led).
    fields: { all: others.length, telemetry: telField },
    // Leaderboards with names, for the story's "where you sit" slides.
    boards: {
      overtakes: board("overtakes"),
      lapsLed: board("lapsLed"),
      fastestLaps: board("fastestLaps"),
      poles: board("poles"),
      wins: board("wins"),
      podiums: board("podiums"),
      lapsRaced: board("lapsRaced"),
      training: training ? training.board : null,
    },
    training: training ? { laps: training.laps, weeks: training.weeks, rank: training.rank } : null,
    racing: mine.lapsRaced ? { laps: mine.lapsRaced, rank: rankAmong(all("lapsRaced"), mine.lapsRaced) } : null,
    tyres: tyreMix(rounds),
    limits:
      mine.cuts != null
        ? {
            cuts: mine.cuts,
            penalties: rounds.reduce((n, r) => n + (r.gamePenalties || 0), 0),
            races: mine.telemetryStarts,
            fieldPerRace: (() => {
              const f = others.filter((t) => t.telemetryStarts >= 3 && t.cuts != null).map((t) => t.cuts / t.telemetryStarts);
              return f.length >= 3 ? Math.round((f.reduce((a, b) => a + b, 0) / f.length) * 10) / 10 : null;
            })(),
          }
        : null,
    // Set when the races are told among the cars outside Tier 1.
    lens: lens ? { label: lens.label, wins: lens.wins, podiums: lens.podiums } : null,
    best: best ? { ...best, starters: fieldOf(best), heroImageUrl: heroes.get(best.raceId) || null } : null,
    climb: climbOk ? { ...climb, starters: climbField } : null,
    teammates,
    contact,
    honours: honoursFor(honours, { driverId, teamId: team?.id || null, position, complete: facts.complete }),
    awards: myAwards,
    photos,
    tier,
  };
}
