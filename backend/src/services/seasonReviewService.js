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
import { seasonCompleteFromRaces } from "../lib/seasonComplete.js";
import { finishesOf, hasRaced, roundsOf } from "../lib/standingsRow.js";
import { readSprintChildren } from "../lib/sprintRaces.js";
import { readPoleHolders, readManualFastestLaps } from "../lib/raceHonours.js";
import { telemetryBySeason } from "../lib/telemetryRead.js";
import { readRaceHeroes } from "../lib/raceHero.js";
import { readSeasonAwards } from "../lib/seasonAwards.js";

export const REVIEW_SETTING = "season_review";
export const REVIEW_MODES = ["off", "admins", "all"];
// Admins first: the league looks at it on the live site before anyone else.
export const DEFAULT_REVIEW_MODE = "admins";

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

// Is it open to THIS request? Everybody once it is on, admins (checked live by
// the auth middleware) while it is being tried out.
export async function reviewVisibleTo(prisma, req) {
  const mode = await reviewMode(prisma);
  if (mode === "all") return true;
  if (mode === "admins") return req?.isAdminRequest === true;
  return false;
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
  if (position === 1) out.push({ key: "champion", title: "Champion", detail: honours.seasonName || null });
  else if (position === 2) out.push({ key: "vice", title: "Runner-up", detail: "Second in the championship" });
  else if (position === 3) out.push({ key: "third", title: "Third overall", detail: "Third in the championship" });
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

  // Pole is per round, and only the feature race has one (a sprint grid is
  // not a qualifying result).
  const featureIds = [...run.map((r) => r.id), ...[...div2Of.values()].map((r) => r.id)];
  const raceIds = [...featureIds, ...sprintIdOf.values()];
  const [poles, fastest] = await Promise.all([
    readPoleHolders(prisma, featureIds).catch(() => new Map()),
    fastestLapHolders(prisma, raceIds),
  ]);
  const dotd = new Map();
  for (const id of raceIds) {
    const r = byId.get(id);
    if (r?.driverOfTheDayId) dotd.set(id, r.driverOfTheDayId);
  }
  return { rounds, run, complete, div2Of, sprintIdOf, poles, fastest, dotd };
}

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
      points: row.total ?? 0,
      wins: fin.filter((c) => c.position === 1).length,
      podiums: fin.filter((c) => c.position <= 3).length,
      poles: 0,
      fastestLaps: 0,
      dotd: 0,
      overtakes: null,
      lapsLed: null,
      contacts: null,
      envContacts: null,
      telemetryStarts: 0,
    });
  }
  for (const round of facts.run) {
    const fid = featureOf(round);
    if (!fid) continue;
    const ids = [fid, facts.sprintIdOf.get(fid)].filter(Boolean);
    const pole = facts.poles.get(fid);
    if (pole && out.has(pole)) out.get(pole).poles += 1;
    for (const id of ids) {
      for (const d of facts.fastest.get(id) || []) if (out.has(d)) out.get(d).fastestLaps += 1;
      const dd = facts.dotd.get(id);
      if (dd && out.has(dd)) out.get(dd).dotd += 1;
    }
  }
  for (const [key, t] of tel) {
    const driverId = key.slice(key.indexOf("|") + 1);
    const o = out.get(driverId);
    if (!o || t.contacts == null) continue;
    o.overtakes = (o.overtakes || 0) + (t.overtakes || 0);
    o.lapsLed = (o.lapsLed || 0) + (t.lapsLed || 0);
    o.contacts = (o.contacts || 0) + (t.contacts || 0);
    o.envContacts = (o.envContacts || 0) + (t.envContacts || 0);
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

  // The table after every round, and this driver's line through it.
  const trackOf = new Map(facts.run.map((r) => [r.number, r.track]));
  const after = journeyTables(
    { rows: table, raceNumbers: profile.season?.raceNumbers || facts.rounds.map((r) => r.number), dropWorst: profile.season?.dropWorst || 0 },
    facts.run.map((r) => r.number),
    facts.complete && !profile.season?.officialTotals ? rows : null
  );
  const journey = (after.get(driverId) || []).map((j) => ({ ...j, track: trackOf.get(j.round) || null }));
  // Seasons scored off the league's own sheet (officialTotals) do not add up
  // round by round, so they get no line: the final place is the only true one.
  const showJourney = !profile.season?.officialTotals && journey.length >= MIN_ROUNDS;
  const peak = showJourney ? journey.reduce((best, j) => (!best || j.position < best.position ? j : best), null) : null;

  // Everybody's season, for the ranks.
  const tallies = fieldTallies(rows, facts, tel, division);
  const mine = tallies.get(driverId) || {};
  const all = (key) => [...tallies.values()].map((t) => t[key]);
  const telStarts = mine.telemetryStarts || 0;
  // Contact per race, fewest first, among drivers who raced a fair share of
  // the rounds the figures exist for (two races and a clean sheet is luck).
  const minTel = Math.max(3, Math.ceil(Math.max(...all("telemetryStarts"), 0) / 2));
  const perRaceContact = [...tallies.values()].filter((t) => t.telemetryStarts >= minTel).map((t) => t.contacts / t.telemetryStarts);
  const ranks = {
    wins: rankAmong(all("wins"), mine.wins),
    podiums: rankAmong(all("podiums"), mine.podiums),
    poles: rankAmong(all("poles"), mine.poles),
    fastestLaps: rankAmong(all("fastestLaps"), mine.fastestLaps),
    overtakes: rankAmong(all("overtakes"), mine.overtakes),
    lapsLed: rankAmong(all("lapsLed"), mine.lapsLed),
    contactPerRace: telStarts >= minTel ? rankAmong(perRaceContact, mine.contacts / telStarts, { more: false }) : null,
  };

  // Every round as a line of the sheet.
  const featureOf = (raceId) => (division === 2 ? facts.div2Of.get(raceId)?.id : raceId);
  const best = bestResult(profile.perRace);
  const climb = biggestClimb(profile.perRace);
  const afterByRound = new Map(journey.map((j) => [j.round, j.position]));
  const rounds = (profile.perRace || []).map((r) => {
    const fid = featureOf(r.raceId);
    const sid = fid ? facts.sprintIdOf.get(fid) : null;
    const flHeld = (id) => !!id && (facts.fastest.get(id)?.has(driverId) || false);
    return {
      round: r.number,
      raceId: r.raceId,
      track: r.track,
      status: r.status,
      position: r.position ?? null,
      grid: r.grid ?? null,
      points: r.points || 0,
      sprint: r.sprint ? { position: r.sprint.position ?? null, status: r.sprint.status, points: r.sprint.points || 0 } : null,
      pole: !!fid && facts.poles.get(fid) === driverId,
      fastestLap: flHeld(fid) || flHeld(sid),
      dotd: [fid, sid].some((id) => id && facts.dotd.get(id) === driverId),
      contacts: r.contacts ?? null,
      envContacts: r.envContacts ?? null,
      after: showJourney ? afterByRound.get(r.number) ?? null : null,
      // Struck out under the season's drop rule (the table's own reading).
      dropped: (me?.droppedRounds || []).includes(r.number),
      best: !!best && best.round === r.number,
    };
  });

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
  const contact = withTel.length
    ? {
        races: withTel.length,
        cars: withTel.reduce((n, r) => n + r.contacts, 0),
        scenery: withTel.reduce((n, r) => n + (r.envContacts || 0), 0),
        clean: withTel.filter((r) => r.contacts === 0 && r.status !== "DNS").length,
        rank: ranks.contactPerRace,
      }
    : null;

  const [honours, awards, heroes, starters] = await Promise.all([
    facts.complete ? getSeasonHonours(prisma, row.seasonId).catch(() => null) : null,
    readSeasonAwards(prisma, [row.seasonId]).catch(() => new Map()),
    readRaceHeroes(prisma, [best?.raceId, climb?.raceId].filter(Boolean)).catch(() => new Map()),
    startersOf(prisma, [best, climb].filter(Boolean).map((c) => (c.sprint ? c.raceId : featureOf(c.raceId) || c.raceId))).catch(() => new Map()),
  ]);
  const fieldOf = (c) => starters.get(c.sprint ? c.raceId : featureOf(c.raceId) || c.raceId) ?? null;
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
      poles: mine.poles ?? stats.polePositions ?? 0,
      fastestLaps: mine.fastestLaps ?? stats.fastestLaps ?? 0,
      dnf: stats.dnf,
      bestFinish: stats.bestFinish,
      avgFinish: avg(finishes),
      positionsGained: stats.positionsGained,
      overtakes: mine.overtakes ?? null,
      lapsLed: mine.lapsLed ?? null,
      dotd: mine.dotd || 0,
      bestLap: stats.fastestLap || null,
    },
    ranks,
    best: best ? { ...best, starters: fieldOf(best), heroImageUrl: heroes.get(best.raceId) || null } : null,
    climb: climb ? { ...climb, starters: fieldOf(climb) } : null,
    teammates,
    contact,
    honours: honoursFor(honours, { driverId, teamId: team?.id || null, position, complete: facts.complete }),
    awards: myAwards,
  };
}
