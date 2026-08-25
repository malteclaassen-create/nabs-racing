// ---------------------------------------------------------------------------
// The per-round constructor totals (ConstructorRaceScore).
//
// These are computed once, when a round is saved, and then stand. Nothing on
// the site recomputes them while reading, which is why moving a driver to
// another team never disturbs a championship that is already on the board.
//
// Two callers need to produce them, and they must produce them identically:
// raceWriter, saving a round's results, and the transfer service, which
// re-attributes rounds a driver is recorded as having driven for someone else.
// Hence one function, and a dry-run twin so a transfer can show what it would
// change BEFORE anything is written.
// ---------------------------------------------------------------------------
import {
  applyPenalties,
  calculateT1ConstructorPoints,
  calculateT2ConstructorPoints,
  DEFAULT_POINTS_TABLE,
} from "./pointsCalculator.js";

// The rows a round's classification produces. Pure: no database, no writing.
// `results` are the round's results (each carrying its own teamId stamp),
// `drivers`/`teams` the season's roster.
export function constructorRowsFor(raceId, results, drivers, teams, table = DEFAULT_POINTS_TABLE) {
  const applied = applyPenalties(results);
  const t1 = calculateT1ConstructorPoints(applied, drivers, teams, table);
  const t2 = calculateT2ConstructorPoints(applied, drivers, teams, table);

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const rows = [];
  for (const [teamId, points] of Object.entries(t1)) rows.push({ raceId, teamId, tier: 1, points });
  for (const [teamId, points] of Object.entries(t2)) rows.push({ raceId, teamId, tier: 2, points });
  // Every tier team gets a row, 0 if it scored nothing, so the per-round columns
  // of the standings line up instead of gaining and losing teams round by round.
  for (const team of teams) {
    if (team.tier !== 1 && team.tier !== 2) continue;
    if (!rows.some((x) => x.teamId === team.id && x.tier === team.tier)) {
      rows.push({ raceId, teamId: team.id, tier: team.tier, points: 0 });
    }
  }
  return rows.filter((r) => teamById.has(r.teamId));
}

// Replace a round's stored constructor totals with freshly computed ones.
// `tx` is a prisma client or an open transaction.
export async function writeConstructorScores(tx, raceId, results, drivers, teams, table) {
  const rows = constructorRowsFor(raceId, results, drivers, teams, table);
  await tx.constructorRaceScore.deleteMany({ where: { raceId } });
  for (const row of rows) await tx.constructorRaceScore.create({ data: row });
  return rows;
}

// What would change if this round were rescored with these results: one entry
// per team whose total moves, named, so a confirm dialog can say it out loud.
// Nothing is written.
export function constructorDelta(stored, fresh, teams) {
  const nameOf = new Map(teams.map((t) => [t.id, t.name]));
  const key = (r) => `${r.teamId}|${r.tier}`;
  const before = new Map(stored.map((r) => [key(r), r.points]));
  const after = new Map(fresh.map((r) => [key(r), r.points]));
  const out = [];
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const from = before.get(k) ?? 0;
    const to = after.get(k) ?? 0;
    if (from === to) continue;
    const [teamId, tier] = k.split("|");
    out.push({ teamId, name: nameOf.get(teamId) || teamId, tier: Number(tier), from, to });
  }
  // Biggest movement first: that is the line the admin needs to read.
  return out.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
}
