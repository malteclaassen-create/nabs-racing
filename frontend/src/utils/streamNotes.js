// ---------------------------------------------------------------------------
// The streamer's read-off sheet (/s/<series>/stream): what the championship
// maths says about tonight's round, and the fun facts worth saying out loud
// while the cars go round. Pure functions over the data the public pages
// already load (driver standings, the calendar, the track history), so the
// sheet can never say something the standings or the track page disagree with.
//
// The title maths is shared with the Home page's Title fight: one set of rules
// for "who can still win", so the two never disagree about who is alive.
// ---------------------------------------------------------------------------

import { finishesOf, hasRaced, roundsOf } from "./standingsRow.js";
import { fmtLap } from "./format.js";

// The league default points table (P1..P18), the fallback a season without its
// own table scores by. Mirror of the backend's DEFAULT_POINTS_TABLE
// (services/pointsCalculator.js); change both together.
export const DEFAULT_POINTS_TABLE = [35, 30, 25, 22, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1];

// The championship as the maths sees it with the remaining rounds still open.
//
// "Still in it" is EXACT under the season's drop rule: a chaser survives when
// their best-case final total (maximum points in every remaining round, then
// the N worst rounds dropped) at least matches the leader's guaranteed floor
// (zero in every remaining round, same drop rule). The per-round maximum is
// the season's own P1 score (`tableMax`, fastest-lap bonus included) or the
// best single-round haul seen this season, whichever is higher.
//
// Returns null while there is nothing to work out (no round run yet, none
// left, fewer than two drivers, nobody on the board).
export function titleMath({
  standings,
  raceNumbers,
  completedNumbers,
  totalRounds,
  dropWorst = 0,
  tableMax = 0,
  sprintRounds = [],
  customPoints = {},
}) {
  const completedCount = completedNumbers.length;
  const remaining = totalRounds - completedCount;
  if (remaining <= 0 || completedCount < 1 || standings.length < 2) return null;

  const done = new Set(completedNumbers);
  // A sprint+feature weekend pays twice — both races score the full table —
  // so those rounds are priced at double below, and an observed haul from one
  // counts as two races' worth in the single-race maximum.
  const sprint = new Set(sprintRounds);
  // A round with its own points table pays what THAT table's P1 says.
  const customMax = (n) => (Array.isArray(customPoints?.[n]) && customPoints[n].length ? customPoints[n][0] : null);
  // Points a round can pay at most: the season's OWN points table (P1's score —
  // admin-editable per season, so a rule change flows straight in here), or,
  // when the season runs on the league default (no stored table), the best
  // single-round haul actually seen. The observed value also wins if official/
  // bonus points ever exceeded the table.
  const maxPerRound = Math.max(
    tableMax || 0,
    ...standings.flatMap((d) =>
      Object.entries(d.perRace || {})
        // A round on its own table says nothing about a normal one.
        .filter(([n]) => done.has(Number(n)) && customMax(Number(n)) == null)
        // A sprint weekend's haul is two races' worth: halve it to keep the
        // fallback a single-race figure.
        .map(([n, r]) => (sprint.has(Number(n)) ? (r?.points || 0) / 2 : r?.points || 0))
    )
  );
  if (!maxPerRound) return null;
  // What a round can pay at most: its own table's P1 where it has one, twice
  // over for a sprint weekend.
  const maxFor = (n) => (customMax(n) ?? maxPerRound) * (sprint.has(n) ? 2 : 1);

  const dropN = Math.min(dropWorst ?? 0, raceNumbers.length);
  const dropSum = (vals) => [...vals].sort((a, b) => a - b).slice(dropN).reduce((s, v) => s + v, 0);
  const actual = (d, n) => d.perRace?.[n]?.points ?? 0;
  // A final total under the drop rule, with every round not yet run scored by
  // `open(n)`: the run rounds always count what they paid.
  const finalWith = (d, open) => dropSum(raceNumbers.map((n) => (done.has(n) ? actual(d, n) : open(n))));
  // Current standing under the drop rule with the remaining rounds still at 0.
  // Recomputed (not read from d.total) so the demo's rewound rounds are
  // consistent too; on the live season this equals the server total.
  const floorTotal = (d) => finalWith(d, () => 0);
  // Best possible final total: max points in every remaining round, then drop.
  const maxFinal = (d) => finalWith(d, maxFor);

  const rows = standings
    .map((d) => ({ d, cur: floorTotal(d), best: maxFinal(d) }))
    .sort((a, b) => b.cur - a.cur);
  const leader = rows[0];
  if (!leader.cur) return null;
  const alive = rows.filter((r) => r === leader || r.best >= leader.cur);
  const upcoming = raceNumbers.filter((n) => !done.has(n)).sort((a, b) => a - b);
  // What is still on the table: each remaining round at its own maximum (a
  // double-points finale counts for what it really pays).
  const potential = upcoming.reduce((s, n) => s + maxFor(n), 0) || remaining * maxPerRound;

  return {
    remaining,
    potential,
    upcoming,
    leader,
    rows,
    alive,
    decided: alive.length < 2,
    dropN,
    maxFor,
    finalWith,
    isSprint: (n) => sprint.has(n),
    customTable: (n) => (Array.isArray(customPoints?.[n]) && customPoints[n].length ? customPoints[n] : null),
  };
}

// What tonight (round `n`, the next one to run) can do to the title.
//
//   clinchPosition  the worst finish that wins the leader the title tonight
//                   WHATEVER the others do, or null when no finish is enough.
//                   Priced against every rival's best case: the field's P1
//                   (P2 when the leader wins) plus the fastest-lap bonus for
//                   the rival, nothing extra for the leader. On a sprint
//                   weekend it means that finish in both races.
//   clinchPossible  the leader can win it tonight at all — at best, with the
//                   maximum for themselves and nothing for anyone else.
//   atRisk          chasers who could be mathematically out after tonight:
//                   nothing for them, the maximum for the leader.
//   earliest        the first round the title can be decided in at all (the
//                   leader at maximum every round, nobody else scoring).
//   chaseLimit      for a season without dropped rounds: how far behind the
//                   leader a chaser can be AFTER tonight and still be alive —
//                   exactly the points left once tonight is done.
//
// Ties count as alive (countback could still go the chaser's way), so a clinch
// here needs the leader strictly out of reach.
export function tonight(math, n, { table = DEFAULT_POINTS_TABLE, fastestLapPoints = 0 } = {}) {
  if (!math || math.decided || !math.upcoming.includes(n)) return null;
  const { leader, alive, maxFor, finalWith, upcoming } = math;
  const rivals = alive.filter((r) => r !== leader);
  const t = math.customTable(n) || (Array.isArray(table) && table.length ? table : DEFAULT_POINTS_TABLE);
  const races = math.isSprint(n) ? 2 : 1;
  const pts = (k) => (t[k - 1] ?? 0) * races;

  // Is the leader out of reach of every chaser, given what each one scores in
  // the rounds still to run?
  const outOfReach = (leaderOpen, rivalOpen) => {
    const floor = finalWith(leader.d, leaderOpen);
    return rivals.every((r) => finalWith(r.d, rivalOpen) < floor);
  };
  const tonightOnly = (v) => (m) => (m === n ? v : 0);
  const tonightThenMax = (v) => (m) => (m === n ? v : maxFor(m));

  // A better finish only ever helps the leader, so the finishes that clinch are
  // P1..Pk; walk down until one stops being enough.
  let clinchPosition = null;
  for (let k = 1; k <= t.length; k++) {
    const rivalBest = pts(k === 1 ? 2 : 1) + fastestLapPoints * races;
    if (!outOfReach(tonightOnly(pts(k)), tonightThenMax(rivalBest))) break;
    clinchPosition = k;
  }
  const clinchPossible = outOfReach(tonightOnly(maxFor(n)), tonightThenMax(0));

  const leaderMaxFloor = finalWith(leader.d, tonightOnly(maxFor(n)));
  const atRisk = rivals.filter((r) => finalWith(r.d, tonightThenMax(0)) < leaderMaxFloor);

  let earliest = null;
  for (let j = 0; j < upcoming.length && earliest == null; j++) {
    const decidedBy = new Set(upcoming.slice(0, j + 1));
    const leaderOpen = (m) => (decidedBy.has(m) ? maxFor(m) : 0);
    const rivalOpen = (m) => (decidedBy.has(m) ? 0 : maxFor(m));
    if (outOfReach(leaderOpen, rivalOpen)) earliest = upcoming[j];
  }

  const after = upcoming.filter((m) => m !== n).reduce((s, m) => s + maxFor(m), 0);
  return {
    round: n,
    sprint: races === 2,
    clinchPosition,
    clinchPossible,
    atRisk,
    earliest,
    chaseLimit: math.dropN === 0 ? after : null,
    pointsTonight: maxFor(n),
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
// Names go in **double stars**: the page sets them bold, the copied text
// strips the stars again (plainFact below).
const b = (s) => `**${s}**`;
export const plainFact = (text) => String(text).replace(/\*\*/g, "");

// Wins, podiums and the like for one standings row: a sprint win is a win and
// a sprint podium a podium (the league counts both, see standingsRow.js);
// poles stay per round, read off grid slot 1.
export function driverSeason(row, completedNumbers = []) {
  const fin = finishesOf(roundsOf(row));
  const cells = completedNumbers.map((n) => row.perRace?.[n] || null);
  // Consecutive completed rounds with points, counted back from the latest.
  let pointsStreak = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    if ((cells[i]?.points || 0) > 0) pointsStreak++;
    else break;
  }
  const best = fin.length ? Math.min(...fin.map((f) => f.position)) : null;
  return {
    wins: fin.filter((f) => f.position === 1).length,
    podiums: fin.filter((f) => f.position <= 3).length,
    poles: cells.filter((c) => c?.grid === 1).length,
    best,
    pointsStreak,
    started: cells.filter((c) => c && c.status && c.status !== "DNS").length,
    // The last three rounds, oldest first: "P4", "DNF", or "–" for a round
    // the driver did not take part in. A finish stored without a position
    // (points-only archive rows) reads "Fin".
    form: cells.slice(-3).map((c) =>
      !c || !c.status ? "–" : c.status !== "FINISHED" ? c.status : c.position != null ? `P${c.position}` : "Fin"
    ),
  };
}

// The talking points, in the order a broadcast would reach for them: the title
// first, then tonight's circuit, then the season's stories. Each fact is
// { key, group, text } with names in **double stars**. Every one of them only
// appears when the data behind it exists.
export function buildTalkingPoints({
  standings = [],
  races = [],
  math = null,
  night = null,
  race = null,
  history = null,
  constructors = [],
}) {
  const out = [];
  const push = (group, key, text) => out.push({ group, key, text });
  const raced = standings.filter(hasRaced);
  const champRounds = races.filter((r) => !r.isSpecialEvent && r.number != null && (r.type || "CHAMPIONSHIP") === "CHAMPIONSHIP");
  const completed = champRounds.filter((r) => r.isCompleted).sort((a, c) => a.number - c.number);
  const completedNumbers = completed.map((r) => r.number);
  const total = champRounds.length;

  // --- The championship ------------------------------------------------------
  if (race?.number != null && total) {
    const after = champRounds.filter((r) => !r.isCompleted && r.number > race.number).length;
    push(
      "title",
      "round",
      `Round ${race.number} of ${total}${after ? `: ${plural(after, "round")} to go after this one.` : ": the season finale."}`
    );
  }
  if (math) {
    const [p1, p2, p3] = math.rows;
    if (math.decided) {
      push("title", "decided", `The title is decided: ${b(p1.d.name)} is champion, whatever happens from here.`);
    } else {
      const gap = p1.cur - p2.cur;
      push(
        "title",
        "lead",
        gap === 0
          ? `${b(p1.d.name)} and ${b(p2.d.name)} are level on ${p1.cur} pts at the top.`
          : `${b(p1.d.name)} leads the championship by ${plural(gap, "pt")} over ${b(p2.d.name)}.`
      );
      // P3 only while they are still in the title fight themselves.
      if (p3 && math.alive.includes(p3)) {
        push("title", "p3", `${b(p3.d.name)} is only ${plural(p2.cur - p3.cur, "pt")} behind ${b(p2.d.name)} for P2.`);
      }
      push(
        "title",
        "pool",
        `Up to ${math.potential} pts still on the table over the last ${plural(math.remaining, "round")}.`
      );
      push(
        "title",
        "alive",
        math.alive.length === 2
          ? `It is a two-horse race: only ${b(p1.d.name)} and ${b(p2.d.name)} can still win the title.`
          : `${math.alive.length} drivers can still mathematically win the title.`
      );
    }
  }
  if (night && math) {
    const lead = math.leader.d.name;
    const both = night.sprint ? " in both races" : "";
    if (night.clinchPosition) {
      push(
        "title",
        "clinch",
        night.clinchPosition === 1
          ? `${b(lead)} wins the title tonight with a win${both}, whatever the others do.`
          : `${b(lead)} wins the title tonight with P${night.clinchPosition} or better${both}, whatever the others do.`
      );
    } else if (night.clinchPossible) {
      push("title", "clinch", `${b(lead)} can wrap up the title tonight, but only if the chasers have a bad night.`);
    } else if (night.earliest != null) {
      push("title", "earliest", `The earliest the title can be decided is round ${night.earliest}.`);
    }
    if (night.atRisk.length && !night.clinchPosition) {
      const names = night.atRisk.map((r) => b(r.d.name));
      push(
        "title",
        "risk",
        `${listOf(names)} ${names.length === 1 ? "could be" : names.length === 2 ? "could both be" : "could all be"} out of the title fight after tonight.`
      );
    }
    if (night.chaseLimit != null && night.chaseLimit > 0) {
      push("title", "limit", `To stay in it, a chaser must be no more than ${night.chaseLimit} pts behind ${b(lead)} after tonight.`);
    }
  }
  // `constructors`: [{ label, standings }], label "Tier 1"/"Tier 2", or empty
  // for a single-class season's one table.
  for (const tier of constructors) {
    const [c1, c2] = tier.standings || [];
    if (!c1 || !c2 || !(c1.total > 0)) continue;
    const gap = c1.total - c2.total;
    const which = tier.label ? `${tier.label} constructors` : "constructors";
    push(
      "title",
      `teams-${tier.label || "all"}`,
      gap === 0
        ? `${b(c1.name)} and ${b(c2.name)} are level at the top of the ${which}.`
        : `${b(c1.name)} lead the ${which} by ${plural(gap, "pt")} over ${b(c2.name)}.`
    );
  }

  // --- Tonight's circuit -------------------------------------------------------
  if (race && history) {
    const editions = history.editions || [];
    const track = history.track || race.track;
    if (!editions.length) {
      push("track", "first", `First time the league races at ${b(track)}: no history here yet.`);
    } else {
      push("track", "visits", `This is the ${ordinal(editions.length + 1)} time the league races at ${b(track)}.`);
      const last = editions[0];
      if (last?.winner) {
        const when = [last.seasonNumber != null && `Season ${last.seasonNumber}`, last.raceNumber != null && `round ${last.raceNumber}`]
          .filter(Boolean)
          .join(", ");
        push(
          "track",
          "last",
          `Last time here${when ? ` (${when})` : ""}: ${b(last.winner.name)} won${last.poleman ? `, ${last.poleman.driverId === last.winner.driverId ? "from pole" : `${b(last.poleman.name)} on pole`}` : ""}.`
        );
      }
      const s = history.stats || {};
      if (s.mostWins && s.mostWins.count >= 2) {
        push("track", "kings", `${b(s.mostWins.name)} has won here ${s.mostWins.count} times, more than anyone.`);
      }
      if (s.fastestLap) {
        push(
          "track",
          "lap",
          `The fastest race lap here is ${fmtLap(s.fastestLap.ms)} by ${b(s.fastestLap.name)}${s.fastestLap.seasonNumber ? ` (Season ${s.fastestLap.seasonNumber})` : ""}.`
        );
      }
      // Former winners who are in this season's field. Track history names
      // people by their current display name, the same one the standings use.
      const names = new Set(raced.map((d) => d.name));
      const ids = new Set(raced.map((d) => d.driverId));
      const formerWinners = [...new Set(editions.filter((e) => e.winner).map((e) => e.winner.name))].filter(
        (name) => names.has(name) || editions.some((e) => e.winner?.name === name && ids.has(e.winner.driverId))
      );
      if (formerWinners.length) {
        push(
          "track",
          "winners",
          formerWinners.length === 1
            ? `${b(formerWinners[0])} is the only driver in this season's field who has won here before.`
            : `Drivers in the field who have won here before: ${listOf(formerWinners.map(b))}.`
        );
      }
    }
    for (const [i, f] of (history.customFacts || []).entries()) {
      push("track", `custom-${i}`, [f.label, f.value].filter(Boolean).join(": "));
    }
  }

  // --- The season's stories ----------------------------------------------------
  const winners = completed.map((r) => r.winner).filter(Boolean);
  if (winners.length >= 2) {
    const distinct = new Set(winners.map((w) => w.driverId || w.name)).size;
    push(
      "season",
      "seasonwinners",
      distinct === 1
        ? `${b(winners[0].name)} has won every round so far.`
        : `${plural(distinct, "different winner")} in ${plural(completed.length, "round")} this season.`
    );
  }
  // A winning run: the same name on top of the last two or more rounds.
  if (winners.length >= 2 && completed[completed.length - 1]?.winner) {
    const lastWinner = completed[completed.length - 1].winner;
    let run = 0;
    for (let i = completed.length - 1; i >= 0; i--) {
      if (completed[i].winner && completed[i].winner.driverId === lastWinner.driverId) run++;
      else break;
    }
    if (run >= 2 && run < completed.length) {
      push("season", "streak", `${b(lastWinner.name)} has won the last ${run} rounds in a row.`);
    }
  }
  const last = completed[completed.length - 1];
  if (last?.winner) {
    push("season", "lastwin", `Last round, ${b(last.winner.name)} won at ${b(last.track)}.`);
  }
  const seasonRows = raced.map((d) => ({ d, s: driverSeason(d, completedNumbers) }));
  // Points in every round so far — only worth saying a few rounds in.
  if (completed.length >= 3) {
    const everyRound = seasonRows.filter(({ s }) => s.pointsStreak === completed.length).map(({ d }) => b(d.name));
    if (everyRound.length && everyRound.length <= 4) {
      push("season", "scored", `${listOf(everyRound)} ${everyRound.length === 1 ? "has" : "have"} scored in every round this season.`);
    }
  }
  // The top of the table still without a win.
  const winless = seasonRows.slice(0, 5).filter(({ s }) => s.wins === 0 && s.best != null);
  for (const { d, s } of winless.slice(0, 2)) {
    push(
      "season",
      `nowin-${d.driverId}`,
      `${b(d.name)} is P${d.position} in the championship without a win yet (best finish this season: P${s.best}).`
    );
  }
  const mostWins = seasonRows.reduce((m, x) => (x.s.wins > (m?.s.wins || 0) ? x : m), null);
  if (mostWins && mostWins.s.wins >= 2) {
    push("season", "mostwins", `${b(mostWins.d.name)} has the most wins this season: ${mostWins.s.wins}.`);
  }
  return out;
}

function listOf(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
