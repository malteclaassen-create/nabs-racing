// ---------------------------------------------------------------------------
// The season's transfer market: which team every driver drove for in every
// round, and where the moves are.
//
// Three sources say who drove for whom, and until now each lived on its own
// page: the RaceResult stamp (lib/resultTeam.js) for rounds already driven, the
// DriverTeamChange records (services/driverTransfers.js) for moves entered in
// advance, and Driver.teamId for "their team today". This service lays them
// side by side, one row per driver and one column per round, so a season's
// line-up history reads like a grid instead of being reconstructed by hand
// from result tables.
//
// Every cell carries a status, because "Ferrari" alone does not say whether
// the driver raced for Ferrari that night, is a reserve who filled in there,
// or is merely booked to drive for them from that round on:
//
//   driven    they drove that round for this team (their own seat)
//   sub       a reserve drive FOR this team (subForTeamId) — their own team is
//             untouched by it, and rides along as fromTeamId
//   absent    the round is over and they were not in it; the team is the one
//             they were with at the time, shown for the tooltip only
//   planned   a round still ahead that a recorded transfer already covers
//   expected  a round still ahead with nothing recorded: their team today
//
// buildTeamHistory is pure and tested; readTeamHistory gathers its input.
// ---------------------------------------------------------------------------
import { readTransfers, byDriver, teamForRound } from "./driverTransfers.js";
import { resultTeamId } from "../lib/resultTeam.js";
import { readParentIds } from "../lib/sprintRaces.js";
import { getNameOverrides, getIdentityOverrides } from "../lib/persons.js";

// The change in effect for a round (not just its team id), so a cell can say
// whether the record behind it is still waiting to apply.
function changeForRound(changes, roundNumber) {
  let found = null;
  for (const c of changes || []) {
    if (c.fromRound <= roundNumber) found = c;
  }
  return found;
}

// The round the season drives next: the lowest incomplete scored round, else
// one past the last. A change from that round on has not applied yet.
export function nextRoundOf(rounds) {
  const open = rounds.find((r) => !r.isCompleted);
  if (open) return Number(open.number);
  const last = rounds.length ? Number(rounds[rounds.length - 1].number) : 0;
  return last + 1;
}

// `rounds`: the season's scored rounds, ascending ({id, number, track,
// isCompleted, date, country}). `results`: every RaceResult of the season,
// sprint classifications included. `roundOfRace`: raceId -> round number (a
// sprint child maps to its event's number). `changes`: DriverTeamChange rows.
export function buildTeamHistory({ drivers, teams, rounds, results, changes, roundOfRace }) {
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const changesBy = byDriver(changes);
  const nextRound = nextRoundOf(rounds);
  const numbers = rounds.map((r) => Number(r.number));
  const roundByNumber = new Map(rounds.map((r) => [Number(r.number), r]));

  // The feature race result wins over the sprint's for the same weekend: both
  // are stamped with the same team, so this only matters for a driver who
  // started one of the two.
  const resultsByDriver = new Map();
  for (const r of results) {
    const n = roundOfRace.get(r.raceId);
    if (n == null) continue;
    if (!resultsByDriver.has(r.driverId)) resultsByDriver.set(r.driverId, new Map());
    const mine = resultsByDriver.get(r.driverId);
    const isFeature = roundByNumber.get(n)?.id === r.raceId;
    if (!mine.has(n) || isFeature) mine.set(n, r);
  }

  const out = [];
  const moves = [];
  for (const d of drivers) {
    const mine = resultsByDriver.get(d.id) || new Map();
    const recorded = changesBy.get(d.id) || [];
    const cells = {};
    // The driver's own seat as the season goes on. null until something says.
    let own = null;
    const ownAt = new Map();
    let raced = 0;
    for (const n of numbers) {
      const round = roundByNumber.get(n);
      const res = mine.get(n);
      const change = changeForRound(recorded, n);
      const recordedTeam = change ? change.teamId : null;
      if (res) {
        raced += 1;
        const teamId = resultTeamId(res, driverById);
        if (res.subForTeamId) {
          own = res.teamId ?? recordedTeam ?? own;
          // Their own seat rides along, so the transfer centre can list the
          // drive as "Reserve -> Ferrari" like a loan.
          cells[n] = { teamId, status: "sub", fromTeamId: own };
        } else {
          own = teamId ?? recordedTeam ?? own;
          cells[n] = { teamId: own, status: "driven" };
        }
      } else if (round.isCompleted) {
        own = recordedTeam ?? own;
        cells[n] = { teamId: own, status: "absent" };
      } else {
        // Ahead of us: the record if there is one, else the roster. The roster
        // is what saving the round falls back to, so it is the honest answer.
        own = recordedTeam ?? d.teamId;
        cells[n] = { teamId: own, status: change && change.fromRound >= nextRound ? "planned" : "expected" };
      }
      ownAt.set(n, own);
    }
    // Rounds before anything was known about them borrow the first answer, so
    // a late starter is not shown moving from "nowhere" to their first team.
    let firstKnown = null;
    for (const n of numbers) if (ownAt.get(n)) { firstKnown = ownAt.get(n); break; }
    for (const n of numbers) {
      if (ownAt.get(n)) break;
      ownAt.set(n, firstKnown);
      if (cells[n] && !cells[n].teamId) cells[n].teamId = firstKnown;
    }

    // Stints: consecutive rounds actually driven, by the team driven for.
    const stints = [];
    for (const n of numbers) {
      const c = cells[n];
      if (!c || (c.status !== "driven" && c.status !== "sub")) continue;
      const last = stints[stints.length - 1];
      if (last && last.teamId === c.teamId) {
        last.to = n;
        last.races += 1;
      } else {
        stints.push({ teamId: c.teamId, from: n, to: n, races: 1 });
      }
    }

    // Moves: every round where the driver's own seat differs from the round
    // before, plus every recorded change (with its id, so the admin can take
    // it back from the same list).
    const byRound = new Map();
    let prev = null;
    for (const n of numbers) {
      const cur = ownAt.get(n);
      if (prev && cur && cur !== prev) {
        byRound.set(n, { driverId: d.id, round: n, fromTeamId: prev, toTeamId: cur, pending: n >= nextRound, changeId: null });
      }
      if (cur) prev = cur;
    }
    for (const c of recorded) {
      const n = Number(c.fromRound);
      const have = byRound.get(n);
      if (have) {
        have.changeId = c.id;
        have.pending = n >= nextRound;
      } else {
        // On record but nothing visibly moved: the round it names is not on
        // the calendar (yet), or it says what the rounds already say.
        const before = numbers.filter((x) => x < n).map((x) => ownAt.get(x)).filter(Boolean).pop() || null;
        byRound.set(n, { driverId: d.id, round: n, fromTeamId: before, toTeamId: c.teamId, pending: n >= nextRound, changeId: c.id, redundant: before === c.teamId });
      }
    }
    const driverMoves = [...byRound.values()].sort((a, b) => a.round - b.round);
    moves.push(...driverMoves);

    out.push({
      id: d.id,
      name: d.name,
      formerName: d.formerName || null,
      country: d.country || null,
      photoUrl: d.photoUrl || null,
      number: d.number ?? null,
      teamId: d.teamId,
      tier: d.tier,
      isActive: d.isActive !== false,
      raced,
      cells,
      stints,
      changes: recorded.map((c) => ({
        id: c.id,
        fromRound: Number(c.fromRound),
        teamId: c.teamId,
        pending: Number(c.fromRound) >= nextRound,
      })),
    });
  }
  moves.sort((a, b) => a.round - b.round || a.driverId.localeCompare(b.driverId));

  return {
    nextRound,
    rounds: rounds.map((r) => ({
      id: r.id,
      number: Number(r.number),
      track: r.track,
      isCompleted: !!r.isCompleted,
      date: r.date ?? null,
      country: r.country ?? null,
    })),
    teams: teams.map((t) => ({ id: t.id, name: t.name, color: t.color, logoUrl: t.logoUrl ?? null, tier: t.tier })),
    drivers: out,
    moves: moves.filter((m) => !m.redundant).map(({ redundant, ...m }) => m),
  };
}

// Everything the grid needs for one season, straight from the database.
export async function readTeamHistory(prisma, seasonId) {
  const [drivers, teams, races, changes, nameOverrides, identity] = await Promise.all([
    prisma.driver.findMany({ where: { seasonId }, orderBy: { name: "asc" } }),
    prisma.team.findMany({ where: { seasonId }, orderBy: [{ tier: "asc" }, { name: "asc" }] }),
    prisma.race.findMany({ where: { seasonId }, orderBy: { number: "asc" } }),
    readTransfers(prisma, { seasonId }),
    getNameOverrides(prisma),
    getIdentityOverrides(prisma),
  ]);

  // A sprint classification is a child race under its event's number
  // (lib/sprintRaces.js): it scores there, so it is read there.
  const parentOf = await readParentIds(prisma, races.map((r) => r.id));
  const raceById = new Map(races.map((r) => [r.id, r]));
  const rounds = races.filter((r) => r.number != null && !parentOf.has(r.id));
  const roundOfRace = new Map();
  for (const r of races) {
    const parent = parentOf.get(r.id);
    const n = parent ? raceById.get(parent)?.number : r.number;
    if (n != null) roundOfRace.set(r.id, Number(n));
  }

  const results = races.length
    ? await prisma.raceResult.findMany({ where: { raceId: { in: [...roundOfRace.keys()] } } })
    : [];

  // The person's current name, flag and picture, as every roster view shows them.
  for (const d of drivers) {
    const ov = nameOverrides.get(d.id);
    if (ov) {
      d.formerName = ov.formerName;
      d.name = ov.displayName;
    }
    const idov = identity.get(d.id);
    if (idov) {
      if (!d.country && idov.country) d.country = idov.country;
      if (!d.photoUrl) d.photoUrl = idov.photoUrl || idov.avatarUrl || null;
    }
  }

  return buildTeamHistory({ drivers, teams, rounds, results, changes, roundOfRace });
}
