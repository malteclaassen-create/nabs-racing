// ---------------------------------------------------------------------------
// Standings service - reads from the DB and assembles the standings payloads.
// All computation happens here (server-side). Both driver and constructor
// totals are computed from the RaceResult rows, so the per-driver drop rule
// (see below) can trace every team point back to the driver who scored it.
// ---------------------------------------------------------------------------
import {
  getDriverResultPoints,
  fastestLapBonusOf,
  stampFastestLapBonus,
  stampRacePointsTable,
  applyPenalties,
  calculateT1ConstructorContributions,
  calculateT2ConstructorContributions,
  DEFAULT_POINTS_TABLE,
} from "./pointsCalculator.js";
import { getSeasonScoring } from "./seasonService.js";
import { getNameOverrides, getIdentityOverrides, getPersonGroups } from "../lib/persons.js";
import { readSprintChildrenOf, readParentIds } from "../lib/sprintRaces.js";
import { readRaceFormat } from "../lib/raceFormat.js";
import { readManualFastestLaps } from "../lib/raceHonours.js";
import { finishesOf, roundsOf } from "../lib/standingsRow.js";
import { readManualPoints, applyManualPoints } from "../lib/manualPoints.js";

// Apply each race's position penalties before scoring. Grouping by race keeps a
// penalty's re-ranking contained to its own classification — a sprint and its
// feature race share a round number but never a classification (see
// roundContributions). With no penalties this is a no-op, so existing
// standings are unaffected.
export function withPenaltiesApplied(results) {
  const byRace = new Map();
  for (const r of results) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId).push(r);
  }
  const out = [];
  for (const rs of byRace.values()) out.push(...applyPenalties(rs));
  return out;
}

// The stored rows PRICED: penalties applied within each classification, then
// the season's fastest-lap bonus stamped onto each classification's holder
// (pointsCalculator.stampFastestLapBonus), then each round's OWN points
// table stamped onto its rows where it has one (a sprint child uses its
// round's, pointsCalculator.stampRacePointsTable). Every scorer of stored
// results — both standings tables and the admin preview — goes through
// here, so a bonus or a round's special table can never be paid in one
// table and missing from another. A season without the bonus skips the
// honours read entirely.
export async function withScoringApplied(prisma, results, scoring) {
  let applied = withPenaltiesApplied(results);
  const raceIds = [...new Set(applied.map((r) => r.raceId).filter(Boolean))];
  const bonus = scoring?.fastestLapPoints || 0;
  if (bonus > 0) {
    const manual = await readManualFastestLaps(prisma, new Set(raceIds));
    applied = stampFastestLapBonus(applied, bonus, manual);
  }
  return stampRacePointsTable(applied, await roundPointsTables(prisma, raceIds));
}

// Map<raceId, number[]> of the rounds' own points tables for the given race
// ids, a sprint child reading its round's. Only ids with a table appear.
export async function roundPointsTables(prisma, raceIds) {
  const ids = [...new Set((raceIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const parents = await readParentIds(prisma, ids);
  const format = await readRaceFormat(prisma, [...ids, ...parents.values()]);
  for (const id of ids) {
    // A sprint child never carries a table of its own: its round's counts.
    const parent = parents.get(id);
    const t = (parent ? format.get(parent) : format.get(id))?.pointsTable ?? null;
    if (Array.isArray(t) && t.length) out.set(id, t);
  }
  return out;
}

// A season's scoring races and the round each one scores under: every
// championship round under its own number, and the sprint classification of a
// sprint+feature weekend (the hidden child row, lib/sprintRaces.js) under its
// PARENT's number. One evening, one round, two classifications that both pay
// the season's points table — which is how the league scored its sprints
// before the site did.
//
// Returns { raceNumberById, sprintRaceIds, sprintChildOf, raceIds }: the
// number map every builder below keys on, the ids that are sprints (their
// result gets the `sprint` share of the round cell rather than the feature's
// slot), each round's sprint child by round id, and the full list of race ids
// whose results score. Shared with the admin preview so it prices a proposal
// exactly as saving it would.
export async function scoringRaces(prisma, rounds) {
  const raceNumberById = new Map(rounds.map((r) => [r.id, r.number]));
  const sprintRaceIds = new Set();
  const sprintChildOf = new Map();
  const children = await readSprintChildrenOf(prisma, rounds);
  for (const [childId, parent] of children) {
    raceNumberById.set(childId, parent.number);
    sprintRaceIds.add(childId);
    sprintChildOf.set(parent.id, childId);
  }
  return { raceNumberById, sprintRaceIds, sprintChildOf, raceIds: [...raceNumberById.keys()] };
}

// The rounds run as sprint+feature weekends (by the event's session format, so
// a scheduled sprint weekend is known before its results are in). The tables
// mark those columns and the title-fight maths lets them pay twice. Alongside:
// the rounds paying by their own table ({ [number]: table }), for the same
// marks and maths.
async function roundFormats(prisma, rounds) {
  const format = await readRaceFormat(prisma, rounds.map((r) => r.id));
  const sprintRounds = rounds.filter((r) => format.get(r.id)?.raceFormat === "SPRINT_FEATURE").map((r) => r.number);
  const customPoints = {};
  for (const r of rounds) {
    const t = format.get(r.id)?.pointsTable;
    if (Array.isArray(t) && t.length && r.number != null) customPoints[r.number] = t;
  }
  return { sprintRounds, customPoints };
}

// One round's constructor contributions. A sprint weekend puts TWO
// classifications under one round number — the sprint child's results and the
// feature's — and each must be scored on its own (the Tier-2 re-rank in
// particular can never be run over a field with two winners in it). So the
// round's results are split by race, scored per race, and then each driver's
// shares are merged into the ONE contribution per driver-and-team that every
// drop rule below counts, exactly as if the weekend had paid out once. Results
// without a raceId (pure tests, hypothetical rows) are one classification.
export function roundContributions(contributionsFor, results, drivers, teams, table = DEFAULT_POINTS_TABLE) {
  const byRace = new Map();
  for (const r of results) {
    const key = r.raceId ?? "";
    if (!byRace.has(key)) byRace.set(key, []);
    byRace.get(key).push(r);
  }
  const merged = new Map();
  for (const rs of byRace.values()) {
    for (const c of contributionsFor(rs, drivers, teams, table)) {
      const key = `${c.driverId}|${c.teamId}`;
      const cur = merged.get(key);
      if (cur) cur.points += c.points;
      else merged.set(key, { ...c });
    }
  }
  return [...merged.values()];
}

// DEFAULT number of lowest-scoring rounds dropped from every season total
// ("drop scores" / Streichresultate). A round a competitor didn't score in
// counts as 0 and is dropped first. Rounds not yet run also count as 0, so
// mid-season nothing real is dropped until fewer than this many rounds remain
// unscored. The drop is PER DRIVER: each driver's N lowest rounds don't count
// in the driver standings, and the constructor standings exclude exactly those
// driver-rounds too (the points go missing from whichever team the driver
// drove for in that round — their own team or, for a sub, the team they
// subbed for). There is no separate team-level drop. Each season can override
// the count (Season.dropWorst, 0 = keep every round); for Season 7: 12 rounds
// -> each driver's best 9 count.
const DROP_LOWEST_N = 3;

// Given a map of roundNumber -> points and the full list of calendar round
// numbers, returns { total, droppedRounds } after removing the DROP_LOWEST_N
// lowest rounds. Rounds missing from the map count as 0. If the calendar has
// DROP_LOWEST_N or fewer rounds, nothing is dropped (so a brand-new / very
// short season doesn't zero everyone out). Pure / side-effect free.
export function applyDropScores(pointsByRound, roundNumbers, dropN = DROP_LOWEST_N) {
  const entries = roundNumbers.map((num) => ({ num, points: pointsByRound[num] ?? 0 }));
  if (entries.length <= dropN) {
    return { total: entries.reduce((s, e) => s + e.points, 0), droppedRounds: [] };
  }
  // Lowest points first; on a tie drop the later round (keeps the earlier
  // result — purely cosmetic, equal points don't change the total).
  const sorted = [...entries].sort((a, b) => a.points - b.points || b.num - a.num);
  const droppedRounds = sorted.slice(0, dropN).map((e) => e.num).sort((a, b) => a - b);
  const total = sorted.slice(dropN).reduce((s, e) => s + e.points, 0);
  return { total, droppedRounds };
}

// Each driver's dropped rounds, computed exactly like the driver standings do
// it: their driver-standings points per round (missing / DNS / DNF / unrun
// rounds = 0), lowest dropN rounds dropped. Takes the season's results grouped
// by round number (penalties already applied) and returns
// Map<driverId, Set<roundNumber>>. Pure / side-effect free.
export function computeDriverDropRounds(resultsByRound, raceNumbers, dropN, table = DEFAULT_POINTS_TABLE) {
  const pointsByDriver = new Map();
  for (const [num, results] of resultsByRound) {
    for (const r of results) {
      if (!pointsByDriver.has(r.driverId)) pointsByDriver.set(r.driverId, {});
      // Summed, not set: a sprint weekend gives a driver two results in one
      // round, and the round they may drop is worth both together.
      const mine = pointsByDriver.get(r.driverId);
      mine[num] = (mine[num] || 0) + getDriverResultPoints(r, table);
    }
  }
  const dropped = new Map();
  for (const [driverId, pointsByRound] of pointsByDriver) {
    const { droppedRounds } = applyDropScores(pointsByRound, raceNumbers, dropN);
    dropped.set(driverId, new Set(droppedRounds));
  }
  return dropped;
}

// Constructor season rows under the per-driver drop rule. For every round the
// tier's constructor points are broken down per driver; a driver's
// contribution is excluded when that round is one of the driver's own dropped
// rounds. perRace keeps the FULL points the team scored in the round (what
// the race actually paid out); droppedPerRace says how much of it doesn't
// count; total sums only the counting share. Pure / side-effect free.
export function buildConstructorRows({ tier, teams, drivers, raceNumbers, resultsByRound, dropN, table = DEFAULT_POINTS_TABLE }) {
  const dropRounds = computeDriverDropRounds(resultsByRound, raceNumbers, dropN, table);
  const contributionsFor =
    tier === 1 ? calculateT1ConstructorContributions : calculateT2ConstructorContributions;
  const tierTeams = teams.filter((t) => t.tier === tier);

  const perTeam = new Map(
    tierTeams.map((t) => [t.id, { perRace: {}, droppedPerRace: {}, total: 0 }])
  );

  for (const num of raceNumbers) {
    const results = resultsByRound.get(num);
    if (!results || results.length === 0) continue; // round not run yet
    // The round happened: every tier team gets an explicit 0 so the UI can
    // tell "scored nothing" apart from "not raced yet".
    for (const row of perTeam.values()) row.perRace[num] = row.perRace[num] ?? 0;

    for (const c of roundContributions(contributionsFor, results, drivers, teams, table)) {
      const row = perTeam.get(c.teamId);
      if (!row) continue;
      row.perRace[num] += c.points;
      if (dropRounds.get(c.driverId)?.has(num)) {
        // 0-point contributions in a dropped round change nothing — don't
        // record them, so droppedPerRace only lists real deductions.
        if (c.points > 0) row.droppedPerRace[num] = (row.droppedPerRace[num] || 0) + c.points;
      } else {
        row.total += c.points;
      }
    }
  }

  return tierTeams.map((team) => ({ team, ...perTeam.get(team.id) }));
}

// Team-level drop rule (opt-in per season via Season.teamDropWorst). Instead of
// inheriting each driver's own dropped rounds, a team drops its own N lowest
// single-driver-per-round contributions. Modelled as "slots": one slot per
// driver contribution in a run round (subs included), plus ghost 0-slots so
// every calendar round has at least `rosterSlots` slots (this makes mid-season
// nothing real drop until enough rounds are behind us, exactly like the driver
// rule). The N lowest-scoring slots are removed. Pure / side-effect free.
export function applyTeamDrop({ contributions, rosterSlots, roundNumbers, dropN }) {
  const slots = [];
  const countByRound = new Map();
  for (const c of contributions) {
    slots.push({ round: c.round, points: c.points });
    countByRound.set(c.round, (countByRound.get(c.round) || 0) + 1);
  }
  // Ghost 0-slots pad each calendar round up to rosterSlots (covers unrun rounds
  // and rounds where a seat went unfilled).
  for (const round of roundNumbers) {
    const have = countByRound.get(round) || 0;
    for (let i = have; i < rosterSlots; i++) slots.push({ round, points: 0 });
  }
  const fullTotal = slots.reduce((s, x) => s + x.points, 0);
  if (dropN <= 0 || slots.length <= dropN) {
    return { total: fullTotal, droppedPerRace: {} };
  }
  // Lowest points first; tie -> drop the later round (matches applyDropScores).
  const sorted = [...slots].sort((a, b) => a.points - b.points || b.round - a.round);
  const dropped = sorted.slice(0, dropN);
  const droppedPerRace = {};
  let droppedSum = 0;
  for (const d of dropped) {
    if (d.points > 0) {
      droppedPerRace[d.round] = (droppedPerRace[d.round] || 0) + d.points;
      droppedSum += d.points;
    }
  }
  return { total: fullTotal - droppedSum, droppedPerRace };
}

// Constructor rows under the team-level drop rule. Each tier scores in its own
// currency (T1 real points, T2 re-ranked points); a team's roster size sets how
// many slots per round pad the drop model. Pure / side-effect free.
export function buildTeamDropConstructorRows({ tier, teams, drivers, raceNumbers, resultsByRound, teamDropN, table = DEFAULT_POINTS_TABLE }) {
  const contributionsFor =
    tier === 1 ? calculateT1ConstructorContributions : calculateT2ConstructorContributions;
  const tierTeams = teams.filter((t) => t.tier === tier);
  const rosterSlots = new Map(
    tierTeams.map((t) => [t.id, Math.max(1, drivers.filter((d) => d.teamId === t.id && d.tier === tier).length)])
  );
  const contribs = new Map(tierTeams.map((t) => [t.id, []]));
  const perRace = new Map(tierTeams.map((t) => [t.id, {}]));

  for (const num of raceNumbers) {
    const results = resultsByRound.get(num);
    if (!results || results.length === 0) continue;
    for (const t of tierTeams) perRace.get(t.id)[num] = perRace.get(t.id)[num] ?? 0;
    for (const c of roundContributions(contributionsFor, results, drivers, teams, table)) {
      if (!contribs.has(c.teamId)) continue;
      contribs.get(c.teamId).push({ round: num, points: c.points });
      perRace.get(c.teamId)[num] += c.points;
    }
  }

  return tierTeams.map((team) => {
    const { total, droppedPerRace } = applyTeamDrop({
      contributions: contribs.get(team.id),
      rosterSlots: rosterSlots.get(team.id),
      roundNumbers: raceNumbers,
      dropN: teamDropN,
    });
    return {
      teamId: team.id,
      name: team.name,
      color: team.color,
      tier: team.tier,
      logoUrl: team.logoUrl,
      perRace: perRace.get(team.id),
      droppedPerRace,
      total,
    };
  });
}

// Sheet-style team drop (Season.teamDropMode = 'rounds'): instead of dropping
// single-driver contributions, each team's N lowest WHOLE round totals are
// dropped — rounds not yet run count as 0 and are dropped first, exactly how
// the league's official sheet computes its constructor standings. Round scores
// still come from the live per-driver contributions (subs land with the team
// they drove for). Pure / side-effect free.
export function buildTeamRoundDropConstructorRows({ tier, teams, drivers, raceNumbers, resultsByRound, teamDropN, table = DEFAULT_POINTS_TABLE }) {
  const contributionsFor =
    tier === 1 ? calculateT1ConstructorContributions : calculateT2ConstructorContributions;
  const tierTeams = teams.filter((t) => t.tier === tier);
  const perRace = new Map(tierTeams.map((t) => [t.id, {}]));

  for (const num of raceNumbers) {
    const results = resultsByRound.get(num);
    if (!results || results.length === 0) continue;
    for (const t of tierTeams) perRace.get(t.id)[num] = perRace.get(t.id)[num] ?? 0;
    for (const c of roundContributions(contributionsFor, results, drivers, teams, table)) {
      if (!perRace.has(c.teamId)) continue;
      perRace.get(c.teamId)[num] += c.points;
    }
  }

  return tierTeams.map((team) => {
    const pr = perRace.get(team.id);
    const { total, droppedRounds } = applyDropScores(pr, raceNumbers, teamDropN);
    const droppedPerRace = {};
    for (const num of droppedRounds) if (pr[num]) droppedPerRace[num] = pr[num];
    return {
      teamId: team.id,
      name: team.name,
      color: team.color,
      tier: team.tier,
      logoUrl: team.logoUrl,
      perRace: pr,
      droppedPerRace,
      total,
    };
  });
}

// Countback tie-break (the FIA way): drivers on equal points rank by their
// results — more wins first, then more second places, then thirds, and so on;
// this also orders the zero-point drivers (a P12 beats a best of P14), and any
// classified finish beats none at all. `a`/`b` are each driver's classified
// finishing positions sorted ascending; comparing them element by element IS
// the countback (equal prefixes fall through, the longer sheet — more finishes
// at the deciding position — wins). Returns <0 when `a` ranks ahead. Pure core
// exported for tests.
export function compareFinishSheets(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return b.length - a.length;
}

// The ascending list of classified finishes behind a standings row, for the
// countback above. EVERY classification counts, the sprint of a sprint weekend
// included (lib/standingsRow.js): "more wins" has to mean the same thing here
// as it does on the Hall of Fame and the driver profile, or two drivers level
// on points would be split by a rule the site contradicts one page later.
export function finishSheetOf(row) {
  return finishesOf(roundsOf(row))
    .map((v) => v.position)
    .sort((x, y) => x - y);
}

// Overlay official final standings on top of computed rows (archived seasons).
// Rows whose id appears in `finals` take its official total and keep the given
// array order; rows not listed keep their computed total and sort after, by
// total desc then name. `finals` is an array of { id, points }. Mutates &
// re-sorts `rows` in place and renumbers positions. No-op when `finals` is
// falsy/empty, so live seasons are completely unaffected.
export function applyFinalStandings(rows, finals, idKey) {
  if (!finals || finals.length === 0) return rows;
  const order = new Map(finals.map((e, i) => [e.id, { points: e.points, index: i }]));
  for (const row of rows) {
    const o = order.get(row[idKey]);
    if (o) row.total = o.points;
  }
  rows.sort((a, b) => {
    const oa = order.get(a[idKey]);
    const ob = order.get(b[idKey]);
    if (oa && ob) return oa.index - ob.index;
    if (oa) return -1;
    if (ob) return 1;
    return b.total - a.total || a.name.localeCompare(b.name);
  });
  rows.forEach((row, i) => (row.position = i + 1));
  return rows;
}

// Lay the league's hand-set points over a sorted table (lib/manualPoints.js):
// a bonus added to what the row already has, or a total typed in whole. Runs
// AFTER the official final sheet on purpose — an admin typing a number today
// means it, and a season that stores both would otherwise swallow the edit
// without a word. Rows then re-rank on the totals, with the order they already
// had (countback, or the official sheet's own order) settling ties, so a
// season nobody touched by hand comes out of here exactly as it went in.
// Mutates & renumbers `rows`. Pure, exported for the test.
export function applyManualTotals(rows, manual) {
  if (!manual || manual.size === 0) return rows;
  let touched = false;
  for (const row of rows) {
    const m = manual.get(row.driverId);
    if (!m) continue;
    row.pointsAdjust = m.adjust || 0;
    row.pointsOverride = m.override ?? null;
    const next = applyManualPoints(row.total, m);
    if (next !== row.total) touched = true;
    row.total = next;
  }
  if (!touched) return rows;
  const was = new Map(rows.map((r, i) => [r.driverId, i]));
  rows.sort((a, b) => b.total - a.total || was.get(a.driverId) - was.get(b.driverId));
  rows.forEach((row, i) => (row.position = i + 1));
  return rows;
}

// Move the league's decided champion to the top of a sorted table (see
// getDriverStandings). Mutates `rows` and renumbers positions. Returns
// { driverId, name } when a row was moved, null when there was nothing to do
// (no override, unknown id, or that driver leads on points anyway). Pure,
// exported for the test.
export function applyChampionOverride(rows, championDriverId) {
  if (!championDriverId || !rows?.length) return null;
  const idx = rows.findIndex((r) => r.driverId === championDriverId);
  if (idx < 0) return null;
  const [row] = rows.splice(idx, 1);
  rows.unshift(row);
  rows.forEach((r, i) => (r.position = i + 1));
  return idx === 0 ? null : { driverId: row.driverId, name: row.name };
}

// Constructor rows built straight from stored OFFICIAL per-race team points
// (archived seasons whose sheet lists them, e.g. Season 6). These seasons used
// the old per-TEAM drop rule, so each team's own worst `dropN` rounds are
// dropped — reproduced here exactly, unlike the live per-driver computation
// which can't see per-round subs. `teamPerRace` = { teamId: { round: points } }.
export function buildStoredConstructorRows({ tier, teams, raceNumbers, teamPerRace, dropN }) {
  return teams
    .filter((t) => t.tier === tier)
    .map((team) => {
      const per = teamPerRace[team.id] || {};
      const perRace = {};
      const pointsByRound = {};
      for (const num of raceNumbers) {
        if (per[num] != null) {
          perRace[num] = per[num];
          pointsByRound[num] = per[num];
        }
      }
      const { total, droppedRounds } = applyDropScores(pointsByRound, raceNumbers, dropN);
      const droppedPerRace = {};
      for (const num of droppedRounds) if (perRace[num]) droppedPerRace[num] = perRace[num];
      return {
        teamId: team.id,
        name: team.name,
        color: team.color,
        tier: team.tier,
        logoUrl: team.logoUrl,
        perRace,
        droppedPerRace,
        total,
      };
    });
}

// Returns the ordered list of completed race numbers, e.g. [1,2,...,9].
async function getRaceNumbers(prisma, seasonId) {
  const races = await prisma.race.findMany({
    where: { seasonId, isSpecialEvent: false },
    orderBy: { number: "asc" },
    select: { number: true },
  });
  return races.map((r) => r.number);
}

// DRIVER STANDINGS -----------------------------------------------------------
// `extraResults` lets a caller inject HYPOTHETICAL result rows (same shape as
// RaceResult, raceId must belong to the season) on top of the stored ones —
// the live championship projection runs the running race order through the
// exact same scoring pipeline this way. Empty/omitted = plain stored standings.
// Where each driver of `seasonId` finished LAST season, as a sort key.
//
// A season that has not run a round yet has every driver on zero, so the only
// thing left to order by was the name — an announced season's table opened
// alphabetically, which tells a visitor nothing and reads as if the roster were
// unranked. Last season's finishing order is the closest thing to a meaningful
// starting grid, and it is what a reader expects to see before round one.
//
// Drivers are matched across seasons by person link (Driver rows are per-season
// and ids/handles change), falling back to the id and then the name. Anyone with
// no previous season sorts after everyone who has one.
//
// `depth` stops the lookup chaining: if last season also never ran, we do not
// walk back through the whole archive — those drivers simply have no key.
async function previousSeasonOrder(prisma, seasonId, depth) {
  if (depth <= 0) return null;
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) return null;
  const prev = await prisma.season.findFirst({
    where: { seriesId: season.seriesId ?? null, number: { lt: season.number } },
    orderBy: { number: "desc" },
  });
  if (!prev) return null;
  const prevStandings = await getDriverStandings(prisma, prev.id, { _depth: depth - 1 });
  if (!prevStandings.standings.length) return null;
  const { byDriver } = await getPersonGroups(prisma);
  const byPerson = new Map();
  const byId = new Map();
  const byName = new Map();
  for (const r of prevStandings.standings) {
    const person = byDriver.get(r.driverId);
    if (person && !byPerson.has(person)) byPerson.set(person, r.position);
    if (!byId.has(r.driverId)) byId.set(r.driverId, r.position);
    const key = (r.name || "").trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, r.position);
  }
  return (driverId, name) => {
    const person = byDriver.get(driverId);
    if (person && byPerson.has(person)) return byPerson.get(person);
    if (byId.has(driverId)) return byId.get(driverId);
    const key = (name || "").trim().toLowerCase();
    if (key && byName.has(key)) return byName.get(key);
    return null;
  };
}

// One driver's season laid out round by round: what they scored, how they
// finished, and which rounds those were. Pure, so the rule that matters here
// can be pinned down by a test.
//
// THE RULE: a result only counts when its race is one of this season's
// CHAMPIONSHIP rounds, i.e. it appears in `raceNumberById`. A training session
// or a special event carries no round number, and a result from one used to
// land under the key "undefined" — invisible in the standings table, which
// walks the real round list, but very visible on a driver profile, where the
// head-to-head panel walks the keys of this map instead. A season whose only
// completed session was a friendly showed duel records for whoever raced it.
//
// A SPRINT WEEKEND is one round with two results. The sprint's race id is in
// `raceNumberById` under the weekend's number (scoringRaces) and named in
// `sprintRaceIds`, and its points are ADDED to the round: `points` is the
// weekend's total, while status, position and grid stay the FEATURE race's —
// they are what the round cell shows and what the medal colours read. The
// sprint's own share sits beside them as `sprint`, so the table can explain a
// cell whose number is more than its position pays, and so that every counter
// of wins and podiums can see both races of the weekend: a sprint win counts
// as a win site-wide (lib/standingsRow.js), the countback here included.
//
// A FASTEST-LAP BONUS the result collected (rows stamped by withScoringApplied)
// is inside `points` already; `fastestLap` names the bonus beside it (on the
// cell for the feature, on `sprint` for the sprint), only where one was paid,
// so the table can explain a cell that pays one more than its position.
export function buildDriverPerRace(results, driverId, raceNumberById, table = DEFAULT_POINTS_TABLE, sprintRaceIds = new Set()) {
  const perRace = {}; // raceNumber -> { points, status, position, grid, sprint?, fastestLap? }
  const pointsByRound = {};
  for (const r of results) {
    if (r.driverId !== driverId) continue;
    const num = raceNumberById.get(r.raceId);
    if (num == null) continue;
    const pts = getDriverResultPoints(r, table);
    const bonus = fastestLapBonusOf(r);
    if (sprintRaceIds.has(r.raceId)) {
      // The sprint may arrive before or after the feature's row; a driver who
      // only started the sprint gets a cell with no feature finish in it.
      const cell = perRace[num] || (perRace[num] = { points: 0, status: null, position: null, grid: null });
      cell.points += pts;
      cell.sprint = { points: pts, status: r.status, position: r.position };
      if (bonus) cell.sprint.fastestLap = bonus;
      pointsByRound[num] = cell.points;
      continue;
    }
    // grid rides along so a comparison between two drivers (the head-to-head
    // panel) can put their qualifying side by side — the standings table
    // itself ignores it. Rounds without a recorded grid slot carry null.
    const sprint = perRace[num]?.sprint;
    perRace[num] = { points: pts + (sprint?.points || 0), status: r.status, position: r.position, grid: r.grid ?? null };
    if (sprint) perRace[num].sprint = sprint;
    if (bonus) perRace[num].fastestLap = bonus;
    pointsByRound[num] = perRace[num].points;
  }
  return { perRace, pointsByRound };
}

// Rank the same rows AGAIN with the latest completed round taken out, and pin
// each driver's previous position onto their row — the movement arrows on the
// standings table. Same drop rule, same countback comparator, so the delta can
// never disagree with the logic that built the table itself. Pure (works on
// the already-built rows, no queries) and exported for tests.
//
// After the season opener there IS no previous table (the pre-season order is
// a courtesy sort, not standings), so prevPosition stays absent and the UI
// shows no arrows until round two — the first moment movement means anything.
export function attachPrevPositions(rows, raceNumbers, dropN, manualOf = () => null) {
  const completed = new Set();
  for (const r of rows) for (const num of Object.keys(r.perRace)) completed.add(Number(num));
  const latest = completed.size ? Math.max(...completed) : null;
  if (latest == null || completed.size < 2) return;
  const prior = rows.map((row) => {
    const perRace = {};
    const pointsByRound = {};
    for (const [num, v] of Object.entries(row.perRace)) {
      if (Number(num) === latest) continue;
      perRace[num] = v;
      pointsByRound[num] = v.points;
    }
    const { total } = applyDropScores(pointsByRound, raceNumbers, dropN);
    // Hand-set points belong to the season, not to a round, so they sit on the
    // previous table exactly as they sit on this one — otherwise every driver
    // carrying one would show a movement arrow invented by the override.
    return {
      driverId: row.driverId,
      name: row.name,
      perRace,
      total: applyManualPoints(total, manualOf(row.driverId)),
    };
  });
  const priorSheets = new Map(prior.map((r) => [r.driverId, finishSheetOf(r)]));
  prior.sort(
    (a, b) =>
      b.total - a.total ||
      compareFinishSheets(priorSheets.get(a.driverId), priorSheets.get(b.driverId)) ||
      a.name.localeCompare(b.name)
  );
  const prevPos = new Map(prior.map((r, i) => [r.driverId, i + 1]));
  for (const row of rows) row.prevPosition = prevPos.get(row.driverId) ?? null;
}

// `upToRound` freezes the table as it stood after that round: rounds above it
// are dropped from the race list, and since every total, every drop and every
// countback below is computed FROM that list, the whole table follows without
// a second code path. That is the point of doing it here rather than in the
// caller — a mid-season standings poster has to be the same table the site
// showed that week, drop rule and tie-breaks included, not a re-sum of points.
export async function getDriverStandings(prisma, seasonId, { extraResults = [], upToRound = null, _depth = 1 } = {}) {
  const [drivers, allRaces, scoring, nameOverrides, identity] = await Promise.all([
    prisma.driver.findMany({ where: { seasonId }, include: { team: true } }),
    prisma.race.findMany({ where: { seasonId, isSpecialEvent: false }, orderBy: { number: "asc" } }),
    getSeasonScoring(prisma, seasonId),
    getNameOverrides(prisma),
    getIdentityOverrides(prisma),
  ]);
  const table = scoring.pointsTable || DEFAULT_POINTS_TABLE;

  const partial = upToRound != null && allRaces.some((r) => r.number > upToRound);
  const races = partial ? allRaces.filter((r) => r.number <= upToRound) : allRaces;

  // The rounds plus their sprint classifications, each under its round number
  // (scoringRaces). Results are read for exactly those races: a training
  // session or a special event has no round number to sit under — its results
  // used to land in perRace keyed "undefined", which the head-to-head on a
  // driver profile then counted as a shared round, so a season whose only
  // completed session was a friendly showed records for whoever turned up.
  const { raceNumberById, sprintRaceIds, raceIds } = await scoringRaces(prisma, races);
  const [results, { sprintRounds, customPoints }] = await Promise.all([
    prisma.raceResult.findMany({ where: { raceId: { in: raceIds } } }),
    roundFormats(prisma, races),
  ]);
  const raceNumbers = races.map((r) => r.number);
  const appliedResults = await withScoringApplied(
    prisma,
    extraResults.length ? [...results, ...extraResults] : results,
    scoring
  );

  // Admin-hidden rows (a deactivated driver removed from the public table) get
  // no standings row at all — everyone below moves up. Their race results and
  // constructor points are untouched. Raw column (ensureAppSchema); .catch:
  // fresh checkout before the schema upkeep ran.
  const hiddenRows = await prisma
    .$queryRawUnsafe(`SELECT "id" FROM "Driver" WHERE "seasonId" = ? AND "hideFromStandings" = 1`, seasonId)
    .catch(() => []);
  const hidden = new Set(hiddenRows.map((r) => r.id));

  // Points the admin set by hand for this season (lib/manualPoints.js): a
  // bonus/penalty on top of the computed total, or a total typed in whole.
  // Not on a frozen mid-season view — the same reasoning as the official final
  // sheet below: these are the season's numbers, not round four's.
  const manualPoints = partial ? new Map() : await readManualPoints(prisma, seasonId);

  const rows = drivers.filter((d) => !hidden.has(d.id)).map((driver) => {
    const { perRace, pointsByRound } = buildDriverPerRace(appliedResults, driver.id, raceNumberById, table, sprintRaceIds);

    // Season total drops each driver's N lowest rounds (unscored / not-yet-run
    // rounds count as 0 and are dropped first). The per-race grid still shows
    // every real result; droppedRounds tells the UI which ones don't count.
    const { total, droppedRounds } = applyDropScores(pointsByRound, raceNumbers, scoring.dropWorst);

    // Linked-person display: archive rows show the person's current name with a
    // subtle "raced as <old handle>" note (formerName), plus their CURRENT
    // photo and flag as fallbacks — so the same face follows the person into
    // every season they raced. A row's own values always win.
    const ov = nameOverrides.get(driver.id);
    const idov = identity.get(driver.id);

    return {
      driverId: driver.id,
      name: ov?.displayName || driver.name,
      formerName: ov?.formerName || null,
      discordName: driver.discordName,
      tier: driver.tier,
      isActive: driver.isActive,
      country: driver.country || idov?.country || null,
      photoUrl: driver.photoUrl || driver.discordAvatar || idov?.photoUrl || null,
      team: {
        id: driver.team.id,
        name: driver.team.name,
        color: driver.team.color,
        tier: driver.team.tier,
        logoUrl: driver.team.logoUrl,
      },
      perRace,
      droppedRounds,
      // What the season's own scoring pays. The admin's hand on it comes last,
      // in applyManualTotals below.
      total,
      pointsAdjust: 0,
      pointsOverride: null,
    };
  });

  // Nothing scored yet this season: fall back to last season's finishing order
  // rather than the alphabet (see previousSeasonOrder). The moment the first
  // round is in, points take over again and this never runs.
  const anyPoints = rows.some((r) => r.total > 0);
  const prevPos = anyPoints ? null : await previousSeasonOrder(prisma, seasonId, _depth);
  if (prevPos) {
    rows.sort((a, b) => {
      const pa = prevPos(a.driverId, a.name);
      const pb = prevPos(b.driverId, b.name);
      if (pa != null && pb != null && pa !== pb) return pa - pb;
      if (pa != null && pb == null) return -1; // newcomers line up behind
      if (pa == null && pb != null) return 1;
      return a.name.localeCompare(b.name);
    });
  } else {
    // Points first; equal points settled by countback (more wins, then more
    // seconds, …) — see compareFinishSheets. Name only when even the results
    // are identical. Archived seasons' official order still wins below.
    const sheets = new Map(rows.map((r) => [r.driverId, finishSheetOf(r)]));
    rows.sort(
      (a, b) =>
        b.total - a.total ||
        compareFinishSheets(sheets.get(a.driverId), sheets.get(b.driverId)) ||
        a.name.localeCompare(b.name)
    );
  }
  rows.forEach((row, i) => (row.position = i + 1));

  // Where everyone stood BEFORE the latest completed round, so the table can
  // carry movement arrows the way championship tables do (see
  // attachPrevPositions).
  attachPrevPositions(rows, raceNumbers, scoring.dropWorst, (id) => manualPoints.get(id) || null);

  // Archived seasons: official totals & order win over the computed ones. Not
  // for a mid-season view, though: the official sheet is where the season
  // ENDED, so stamping it onto "after round 4" would answer a question nobody
  // asked with numbers from eight rounds later.
  if (!partial) applyFinalStandings(rows, scoring.finalStandings?.drivers, "driverId");

  // Points the league set by hand — last, so they win over the computed total
  // and over an official sheet alike (see applyManualTotals).
  applyManualTotals(rows, manualPoints);

  // A champion the league decided by a rule the points do not express
  // (Season.championDriverId, admin Seasons tab): that driver's row goes to
  // the top of the FINAL table and the rest keep their order. Not for a
  // mid-season view, which is a question about the points as they stood.
  // The Hall of Fame, the honours and the seals read the table's first row,
  // so they follow without knowing the rule.
  const championOverride = !partial ? applyChampionOverride(rows, scoring.championDriverId) : null;

  // officialTotals tells the UI the totals come from the league's official
  // final sheet (not computed), so per-race sums may not add up exactly.
  return {
    raceNumbers,
    // Rounds run as sprint+feature weekends: both races score, so these
    // columns can pay twice (the tables mark them, the title fight prices them).
    sprintRounds,
    // Rounds paying by their own points table: { [number]: [P1, P2, …] }.
    customPoints,
    // The overridden champion ({ driverId, name }) or null.
    championOverride,
    dropWorst: scoring.dropWorst,
    // Bonus the fastest race lap pays this season (0 = none), so the table
    // can footnote it and explain the cells that carry it.
    fastestLapPoints: scoring.fastestLapPoints || 0,
    officialTotals: !partial && !!scoring.finalStandings?.drivers?.length,
    // True when at least one row's total was set or nudged by hand, so the
    // table can footnote it (rows carry pointsAdjust / pointsOverride).
    manualPoints: rows.some((r) => r.pointsAdjust || r.pointsOverride != null),
    standings: rows,
  };
}

// CONSTRUCTOR STANDINGS ------------------------------------------------------
// Computed from the raw race results (not the stored per-team round scores),
// because the drop rule needs each round's points traced to the driver who
// scored them: a driver's own dropped rounds don't count for the team they
// drove for in those rounds.
// `extraResults` works exactly like in getDriverStandings (hypothetical rows
// for the live projection); omitted = plain stored standings.
// `upToRound` freezes the table after that round, exactly as it does for the
// drivers above: the later rounds leave the race list, and every total, drop
// and tie-break below is computed from that list.
async function getConstructorStandings(prisma, tier, seasonId, { extraResults = [], upToRound = null } = {}) {
  const [teams, drivers, allRaces, results, scoring] = await Promise.all([
    // ALL season teams/drivers (not just this tier): resolving a result's
    // effective team & tier needs the full grid, reserves included.
    prisma.team.findMany({ where: { seasonId } }),
    prisma.driver.findMany({ where: { seasonId } }),
    prisma.race.findMany({ where: { seasonId, isSpecialEvent: false }, orderBy: { number: "asc" } }),
    prisma.raceResult.findMany({ where: { race: { seasonId } } }),
    getSeasonScoring(prisma, seasonId),
  ]);
  const table = scoring.pointsTable || DEFAULT_POINTS_TABLE;

  const partial = upToRound != null && allRaces.some((r) => r.number > upToRound);
  const races = partial ? allRaces.filter((r) => r.number <= upToRound) : allRaces;

  // Rounds and their sprint classifications, each under its round number.
  const [{ raceNumberById }, { sprintRounds, customPoints }] = await Promise.all([
    scoringRaces(prisma, races),
    roundFormats(prisma, races),
  ]);
  const raceNumbers = races.map((r) => r.number);

  // Each race's penalties applied within its own classification, THEN grouped
  // by round: a sprint and its feature race share the round but are two
  // classifications, and a penalty in one must never re-rank the other. The
  // builders split the round by race again before scoring (roundContributions).
  // Results of special events (not in the number map) never score.
  const resultsByRound = new Map();
  const priced = await withScoringApplied(prisma, extraResults.length ? [...results, ...extraResults] : results, scoring);
  for (const r of priced) {
    const num = raceNumberById.get(r.raceId);
    if (num == null) continue;
    if (!resultsByRound.has(num)) resultsByRound.set(num, []);
    resultsByRound.get(num).push(r);
  }

  // Four ways to score a constructor season:
  //   official   — archived seasons that ship verbatim per-team round points;
  //   team       — team drop counts single-driver round scores (Season.teamDropWorst);
  //   teamRounds — team drop counts whole team rounds (teamDropMode 'rounds',
  //                the official sheet's style);
  //   driver     — the legacy default: teams inherit each driver's own dropped rounds.
  const dropMode = scoring.finalStandings?.teamPerRace
    ? "official"
    : scoring.teamDropWorst != null
      ? scoring.teamDropMode === "rounds"
        ? "teamRounds"
        : "team"
      : "driver";
  // The whole mode dispatch as a function of its inputs, because it runs
  // TWICE: once for the real table and once with the latest completed round
  // taken out, which is where the movement arrows come from. Recomputing with
  // the same builder is the only honest way to get the prior order — the team
  // drop rules trace each round's points to the drivers who scored them, and
  // that cannot be reconstructed from the finished rows.
  const buildRows = (rbr, teamPerRace) =>
    dropMode === "official"
      ? buildStoredConstructorRows({ tier, teams, raceNumbers, teamPerRace, dropN: scoring.dropWorst })
      : dropMode === "teamRounds"
        ? buildTeamRoundDropConstructorRows({ tier, teams, drivers, raceNumbers, resultsByRound: rbr, teamDropN: scoring.teamDropWorst, table })
      : dropMode === "team"
        ? buildTeamDropConstructorRows({ tier, teams, drivers, raceNumbers, resultsByRound: rbr, teamDropN: scoring.teamDropWorst, table })
        : buildConstructorRows({
            tier,
            teams,
            drivers,
            raceNumbers,
            resultsByRound: rbr,
            dropN: scoring.dropWorst,
            table,
          }).map(({ team, perRace, droppedPerRace, total }) => ({
            teamId: team.id,
            name: team.name,
            color: team.color,
            tier: team.tier,
            logoUrl: team.logoUrl,
            perRace,
            droppedPerRace,
            total,
          }));
  const constructorOrder = (a, b) => b.total - a.total || a.name.localeCompare(b.name);

  const rows = buildRows(resultsByRound, scoring.finalStandings?.teamPerRace);
  rows.sort(constructorOrder);
  rows.forEach((row, i) => (row.position = i + 1));

  // Movement vs the previous round, same contract as the driver table: absent
  // until two rounds are in, then prevPosition per team.
  {
    const playedRounds =
      dropMode === "official"
        ? [...new Set(Object.values(scoring.finalStandings.teamPerRace || {}).flatMap((m) => Object.keys(m || {}).map(Number)))]
        : [...resultsByRound.keys()];
    if (playedRounds.length >= 2) {
      const latest = Math.max(...playedRounds);
      let prior;
      if (dropMode === "official") {
        const trimmed = {};
        for (const [teamId, m] of Object.entries(scoring.finalStandings.teamPerRace || {})) {
          trimmed[teamId] = Object.fromEntries(Object.entries(m || {}).filter(([n]) => Number(n) !== latest));
        }
        prior = buildRows(resultsByRound, trimmed);
      } else {
        const priorByRound = new Map([...resultsByRound].filter(([n]) => n !== latest));
        prior = buildRows(priorByRound, undefined);
      }
      prior.sort(constructorOrder);
      const prevPos = new Map(prior.map((r, i) => [r.teamId, i + 1]));
      for (const row of rows) row.prevPosition = prevPos.get(row.teamId) ?? null;
    }
  }
  // Archived seasons: official team totals & order win (finalStandings.teams
  // holds every team; only this tier's rows exist here, so the rest are
  // ignored). Not for a mid-season view: that sheet is where the season ended.
  if (!partial) applyFinalStandings(rows, scoring.finalStandings?.teams, "teamId");

  return {
    tier,
    raceNumbers,
    // Sprint+feature weekends and rounds with their own table, as on the driver table.
    sprintRounds,
    customPoints,
    dropWorst: scoring.dropWorst,
    // The rule actually in force for the constructor table, so the UI footnote
    // matches: "team" (N lowest single-driver round scores dropped),
    // "teamRounds" (N lowest whole team rounds dropped, sheet style), "driver"
    // (legacy inheritance) or "official" (archived verbatim totals).
    dropMode,
    teamDropWorst: dropMode === "team" || dropMode === "teamRounds" ? scoring.teamDropWorst : null,
    fastestLapPoints: scoring.fastestLapPoints || 0,
    officialTotals: !partial && !!scoring.finalStandings?.teams?.length,
    standings: rows,
  };
}

export function getT1ConstructorStandings(prisma, seasonId, opts) {
  return getConstructorStandings(prisma, 1, seasonId, opts);
}

export function getT2ConstructorStandings(prisma, seasonId, opts) {
  return getConstructorStandings(prisma, 2, seasonId, opts);
}

export { getRaceNumbers };
