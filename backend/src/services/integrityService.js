// ---------------------------------------------------------------------------
// Season integrity check. Recomputes and cross-checks everything
// that has historically gone wrong, so an admin can verify a whole season with
// one click instead of hunting inconsistencies by hand:
//
//   - per-round constructor scores: stored (official) vs recomputed from the
//     race results — a mismatch means lineups/subs/positions don't add up
//   - stored driver points that contradict the stored finishing position
//     (how the swapped R7 P17/P18 was found)
//   - finishers without a position (breaks the Tier-2 re-rank)
//   - points that count for no team (reserve without a "drove for" team)
//   - duplicate finishing positions, non-finishers with points
//   - cross-season references (a result pointing at another season's team...)
//   - config sanity: drop count vs calendar size, team colour collisions
//
// analyzeSeason() is pure (data in, issues out) so it can be unit-tested;
// checkSeasonIntegrity() loads the data and delegates.
// ---------------------------------------------------------------------------
import {
  applyPenalties,
  calculateT1ConstructorPoints,
  calculateT2ConstructorPoints,
  getPointsForPosition,
  DEFAULT_POINTS_TABLE,
} from "./pointsCalculator.js";
import { getSeasonScoring } from "./seasonService.js";

// severity: "error" (wrong data, fix it) | "warning" (probably wrong) |
// "info" (worth a look, may well be intentional)
const issue = (severity, area, message, round = null) => ({ severity, area, message, round });

export function analyzeSeason({ season, teams, drivers, races, results, scores, table = DEFAULT_POINTS_TABLE, dropWorst = 3 }) {
  const issues = [];
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const rounds = races.filter((r) => !r.isSpecialEvent && r.number != null);
  const raceById = new Map(races.map((r) => [r.id, r]));

  // Group results by race.
  const byRace = new Map();
  for (const r of results) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId).push(r);
  }
  const storedByKey = new Map();
  for (const s of scores) storedByKey.set(`${s.raceId}|${s.teamId}`, s.points);

  // --- per-round checks ------------------------------------------------------
  for (const race of rounds) {
    const rs = byRace.get(race.id) || [];
    const n = race.number;

    if (race.isCompleted && rs.length === 0) {
      issues.push(issue("warning", "Races", `Round ${n} is marked completed but has no results.`, n));
    }
    if (!race.isCompleted && rs.length > 0) {
      issues.push(issue("warning", "Races", `Round ${n} has results but is not marked completed.`, n));
    }
    if (rs.length === 0) continue;

    const hasPenalties = rs.some((r) => (r.penaltySeconds || 0) > 0);

    // Duplicate finishing positions.
    const posSeen = new Map();
    for (const r of rs) {
      if (r.position == null || r.status === "DNS") continue;
      const prev = posSeen.get(r.position);
      if (prev) {
        issues.push(issue(
          "error", "Results",
          `Round ${n}: position P${r.position} is assigned twice (${driverById.get(prev)?.name} and ${driverById.get(r.driverId)?.name}).`,
          n
        ));
      } else {
        posSeen.set(r.position, r.driverId);
      }
    }

    for (const r of rs) {
      const d = driverById.get(r.driverId);
      const name = d?.name || r.driverId;

      // Finisher without a position -> invisible to the Tier-2 re-rank.
      if (r.status === "FINISHED" && r.position == null) {
        const sev = (r.points || 0) > 0 ? "warning" : "info";
        issues.push(issue(sev, "Results", `Round ${n}: ${name} is classified (FINISHED${r.points ? `, ${r.points} pts` : ""}) but has no stored position.`, n));
      }

      // Non-finisher with explicit points (they always score 0).
      if (r.status !== "FINISHED" && (r.points || 0) > 0) {
        issues.push(issue("warning", "Results", `Round ${n}: ${name} is ${r.status} but has ${r.points} points stored (counts as 0).`, n));
      }

      // Stored points contradict the stored position (only meaningful without
      // time penalties, which legitimately shift the classification). Exactly
      // ONE point above the table is almost always a historic bonus point
      // (Season 5 awarded +1 for pole / most consistent driver) — keep those
      // visible but as info, so real data errors stand out in the report.
      if (
        !hasPenalties &&
        r.status === "FINISHED" &&
        r.position != null &&
        r.points != null &&
        r.points !== getPointsForPosition(r.position, table)
      ) {
        const tablePts = getPointsForPosition(r.position, table);
        if (r.points === tablePts + 1 || r.points === tablePts + 2) {
          issues.push(issue(
            "info", "Results",
            `Round ${n}: ${name} has ${r.points - tablePts} point(s) more than P${r.position} pays (${r.points} vs ${tablePts}) — probably bonus points (pole / most consistent).`,
            n
          ));
        } else {
          issues.push(issue(
            "warning", "Results",
            `Round ${n}: ${name} is P${r.position} (${tablePts} pts per the table) but ${r.points} pts are stored — check position or points.`,
            n
          ));
        }
      }

      // Points that count for nobody. Only when NO explicit "drove for" team is
      // set — an admin who deliberately marked a drive as teamless (sub team =
      // reserve) has already answered the question.
      const effTeam = teamById.get(r.subForTeamId || d?.teamId);
      const effTier = effTeam?.tier ?? 0;
      if (!r.subForTeamId && (r.points || 0) > 0 && effTier !== 1 && effTier !== 2) {
        issues.push(issue(
          "info", "Assignment",
          `Round ${n}: ${name} has ${r.points} points but they count for no team (no "drove for" team set). Intentional?`,
          n
        ));
      }

      // Cross-season references.
      if (d && d.seasonId && race.seasonId && d.seasonId !== race.seasonId) {
        issues.push(issue("error", "Season", `Round ${n}: result of ${name} belongs to a different season than the race.`, n));
      }
      if (r.subForTeamId) {
        const st = teamById.get(r.subForTeamId);
        if (!st) {
          issues.push(issue("error", "Season", `Round ${n}: ${name} drove for a team that doesn't exist in this season (${r.subForTeamId}).`, n));
        } else if (st.seasonId && race.seasonId && st.seasonId !== race.seasonId) {
          issues.push(issue("error", "Season", `Round ${n}: ${name} is assigned to a team from another season (${st.name}).`, n));
        }
      }
    }

    // Recomputed constructor scores vs stored official values.
    const applied = applyPenalties(rs);
    const t1 = calculateT1ConstructorPoints(applied, drivers, teams, table);
    const t2 = calculateT2ConstructorPoints(applied, drivers, teams, table);
    for (const team of teams) {
      if (team.tier !== 1 && team.tier !== 2) continue;
      const stored = storedByKey.get(`${race.id}|${team.id}`);
      if (stored === undefined) continue; // no stored row -> nothing to compare
      const recomputed = (team.tier === 1 ? t1 : t2)[team.id] ?? 0;
      if (stored !== recomputed) {
        issues.push(issue(
          "warning", "Team points",
          `Round ${n}: ${team.name} — stored round points ${stored}, recomputed ${recomputed}. Check lineup ("drove for"), positions or penalties.`,
          n
        ));
      }
    }
  }

  // Stored constructor rows pointing at races/teams outside this season set.
  for (const s of scores) {
    if (!raceById.has(s.raceId)) {
      issues.push(issue("error", "Team points", `Constructor round points reference an unknown race (${s.raceId}).`));
    }
    if (!teamById.has(s.teamId)) {
      issues.push(issue("error", "Team points", `Constructor round points reference an unknown team (${s.teamId}).`));
    }
  }

  // --- roster checks ---------------------------------------------------------
  for (const d of drivers) {
    const t = teamById.get(d.teamId);
    if (!t) {
      issues.push(issue("error", "Roster", `${d.name} belongs to a team that doesn't exist in this season (${d.teamId}).`));
      continue;
    }
    if (t.seasonId && d.seasonId && t.seasonId !== d.seasonId) {
      issues.push(issue("error", "Season", `${d.name} is assigned to a team from another season (${t.name}).`));
    }
    if (d.tier !== t.tier) {
      issues.push(issue("info", "Roster", `${d.name} is Tier ${d.tier} but their team ${t.name} is Tier ${t.tier}.`));
    }
  }

  // --- config checks ---------------------------------------------------------
  if (rounds.length > 0 && dropWorst >= rounds.length) {
    issues.push(issue("warning", "Season", `Dropped results (${dropWorst}) is not smaller than the number of rounds (${rounds.length}) — nothing would be dropped.`));
  }
  const dupNums = new Map();
  for (const r of rounds) {
    if (dupNums.has(r.number)) issues.push(issue("error", "Races", `Round number ${r.number} is assigned twice.`));
    dupNums.set(r.number, true);
  }
  const now = Date.now();
  for (const r of races) {
    if (!r.isCompleted && !r.isSpecialEvent && r.date && new Date(r.date).getTime() < now - 24 * 3600 * 1000) {
      issues.push(issue("info", "Races", `Round ${r.number ?? "?"} (${r.track}) is in the past but has no results yet.`, r.number));
    }
  }

  // Team colour collisions within a tier (hard to tell apart in charts).
  const hex = (c) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "").trim());
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  for (const tier of [1, 2]) {
    const tierTeams = teams.filter((t) => t.tier === tier);
    for (let i = 0; i < tierTeams.length; i++) {
      for (let j = i + 1; j < tierTeams.length; j++) {
        const a = hex(tierTeams[i].color);
        const b = hex(tierTeams[j].color);
        if (!a || !b) continue;
        const dist = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
        if (dist < 50) {
          issues.push(issue(
            "info", "Teams",
            `${tierTeams[i].name} and ${tierTeams[j].name} (Tier ${tier}) have nearly identical colours — hard to tell apart in charts.`
          ));
        }
      }
    }
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return { issues, counts };
}

export async function checkSeasonIntegrity(prisma, seasonId) {
  const [season, teams, drivers, races, results, scores, scoring] = await Promise.all([
    prisma.season.findUnique({ where: { id: seasonId } }),
    prisma.team.findMany({ where: { seasonId } }),
    prisma.driver.findMany({ where: { seasonId } }),
    prisma.race.findMany({ where: { seasonId }, orderBy: { number: "asc" } }),
    prisma.raceResult.findMany({ where: { race: { seasonId } } }),
    prisma.constructorRaceScore.findMany({ where: { race: { seasonId } } }),
    getSeasonScoring(prisma, seasonId),
  ]);
  const table = scoring.pointsTable || DEFAULT_POINTS_TABLE;
  const { issues, counts } = analyzeSeason({
    season, teams, drivers, races, results, scores, table, dropWorst: scoring.dropWorst,
  });
  // Stable ordering: errors first, then warnings, then infos; by round within.
  const rank = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.round ?? 999) - (b.round ?? 999));
  return { checkedAt: new Date().toISOString(), season: season?.name ?? null, counts, issues };
}
