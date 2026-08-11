// ---------------------------------------------------------------------------
// Standings service - reads from the DB and assembles the standings payloads.
// All computation happens here (server-side). Both driver and constructor
// totals are computed from the RaceResult rows, so the per-driver drop rule
// (see below) can trace every team point back to the driver who scored it.
// ---------------------------------------------------------------------------
import {
  getDriverResultPoints,
  applyPenalties,
  calculateT1ConstructorContributions,
  calculateT2ConstructorContributions,
  DEFAULT_POINTS_TABLE,
} from "./pointsCalculator.js";
import { getSeasonScoring } from "./seasonService.js";
import { getNameOverrides, getIdentityOverrides, getPersonGroups } from "../lib/persons.js";

// Apply each race's position penalties before scoring. Grouping by race keeps a
// penalty's re-ranking contained to its own round. With no penalties this is a
// no-op, so existing standings are unaffected.
function withPenaltiesApplied(results) {
  const byRace = new Map();
  for (const r of results) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId).push(r);
  }
  const out = [];
  for (const rs of byRace.values()) out.push(...applyPenalties(rs));
  return out;
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
      pointsByDriver.get(r.driverId)[num] = getDriverResultPoints(r, table);
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

    for (const c of contributionsFor(results, drivers, teams, table)) {
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
    for (const c of contributionsFor(results, drivers, teams, table)) {
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
    for (const c of contributionsFor(results, drivers, teams, table)) {
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
// countback above.
export function finishSheetOf(row) {
  return Object.values(row.perRace || {})
    .filter((v) => v.status === "FINISHED" && v.position != null)
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
export function buildDriverPerRace(results, driverId, raceNumberById, table = DEFAULT_POINTS_TABLE) {
  const perRace = {}; // raceNumber -> { points, status, position }
  const pointsByRound = {};
  for (const r of results) {
    if (r.driverId !== driverId) continue;
    const num = raceNumberById.get(r.raceId);
    if (num == null) continue;
    const pts = getDriverResultPoints(r, table);
    pointsByRound[num] = pts;
    perRace[num] = { points: pts, status: r.status, position: r.position };
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
export function attachPrevPositions(rows, raceNumbers, dropN) {
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
    return { driverId: row.driverId, name: row.name, perRace, total };
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
  const [drivers, allRaces, results, scoring, nameOverrides, identity] = await Promise.all([
    prisma.driver.findMany({ where: { seasonId }, include: { team: true } }),
    prisma.race.findMany({ where: { seasonId, isSpecialEvent: false }, orderBy: { number: "asc" } }),
    // Championship rounds only, the same scope as the race list above. A
    // training session carries isSpecialEvent, and its results have no round
    // number to sit under — they used to land in perRace keyed "undefined",
    // which the head-to-head on a driver profile then counted as a shared
    // round. A season whose only completed session is a friendly showed
    // records for the people who turned up to it.
    prisma.raceResult.findMany({ where: { race: { seasonId, isSpecialEvent: false } } }),
    getSeasonScoring(prisma, seasonId),
    getNameOverrides(prisma),
    getIdentityOverrides(prisma),
  ]);
  const table = scoring.pointsTable || DEFAULT_POINTS_TABLE;

  const partial = upToRound != null && allRaces.some((r) => r.number > upToRound);
  const races = partial ? allRaces.filter((r) => r.number <= upToRound) : allRaces;

  const raceNumberById = new Map(races.map((r) => [r.id, r.number]));
  const raceNumbers = races.map((r) => r.number);
  const appliedResults = withPenaltiesApplied(extraResults.length ? [...results, ...extraResults] : results);

  // Admin-hidden rows (a deactivated driver removed from the public table) get
  // no standings row at all — everyone below moves up. Their race results and
  // constructor points are untouched. Raw column (ensureAppSchema); .catch:
  // fresh checkout before the schema upkeep ran.
  const hiddenRows = await prisma
    .$queryRawUnsafe(`SELECT "id" FROM "Driver" WHERE "seasonId" = ? AND "hideFromStandings" = 1`, seasonId)
    .catch(() => []);
  const hidden = new Set(hiddenRows.map((r) => r.id));

  const rows = drivers.filter((d) => !hidden.has(d.id)).map((driver) => {
    const { perRace, pointsByRound } = buildDriverPerRace(appliedResults, driver.id, raceNumberById, table);

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
      total,
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
  attachPrevPositions(rows, raceNumbers, scoring.dropWorst);

  // Archived seasons: official totals & order win over the computed ones. Not
  // for a mid-season view, though: the official sheet is where the season
  // ENDED, so stamping it onto "after round 4" would answer a question nobody
  // asked with numbers from eight rounds later.
  if (!partial) applyFinalStandings(rows, scoring.finalStandings?.drivers, "driverId");

  // officialTotals tells the UI the totals come from the league's official
  // final sheet (not computed), so per-race sums may not add up exactly.
  return {
    raceNumbers,
    dropWorst: scoring.dropWorst,
    officialTotals: !partial && !!scoring.finalStandings?.drivers?.length,
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

  const raceNumberById = new Map(races.map((r) => [r.id, r.number]));
  const raceNumbers = races.map((r) => r.number);

  // Group by round with each race's penalties applied; results of special
  // events (not in the number map) never score constructor points.
  const byRace = new Map();
  for (const r of extraResults.length ? [...results, ...extraResults] : results) {
    const num = raceNumberById.get(r.raceId);
    if (num == null) continue;
    if (!byRace.has(num)) byRace.set(num, []);
    byRace.get(num).push(r);
  }
  const resultsByRound = new Map();
  for (const [num, rs] of byRace) resultsByRound.set(num, applyPenalties(rs));

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
    dropWorst: scoring.dropWorst,
    // The rule actually in force for the constructor table, so the UI footnote
    // matches: "team" (N lowest single-driver round scores dropped),
    // "teamRounds" (N lowest whole team rounds dropped, sheet style), "driver"
    // (legacy inheritance) or "official" (archived verbatim totals).
    dropMode,
    teamDropWorst: dropMode === "team" || dropMode === "teamRounds" ? scoring.teamDropWorst : null,
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
