// The sentences of the season review (SeasonReview.jsx), each filled from the
// same review object the tables on the page are drawn from, so the words and
// the numbers can never say two different things.
//
// The page is a results sheet anybody can open, so it names nobody as "you"
// and uses no "he" or "she": a driver's own line reads the same whoever is
// looking. Plain words, numbers with what they are set against, no praise.

// 1st, 2nd, 3rd, 11th, 12th, 13th, 21st, 32nd ...
export const nth = (n) => (n % 100 >= 11 && n % 100 <= 13 ? `${n}th` : `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`);

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "4th of 19", "joint 2nd of 19", or null when there is no rank to give.
export function rankText(r) {
  if (!r) return null;
  return `${r.shared ? "joint " : ""}${nth(r.rank)} of ${r.of}`;
}

// "R6 Jeddah"
export const roundName = (r) => (r ? `R${r.round}${r.track ? ` ${r.track}` : ""}` : "");

// The line under the big position: the field it was taken in and the gap to
// the car either side.
export function resultLine(review) {
  const c = review.championship;
  const complete = review.season.complete;
  if (!c.position) return null;
  const field = `${c.fieldSize} driver${c.fieldSize === 1 ? "" : "s"} who ${complete ? "raced" : "have raced so far"}`;
  if (c.position === 1) {
    if (!c.behind) return `First of the ${field}.`;
    return complete
      ? `Champion, ${plural(c.behind.gap, "point")} ahead of ${c.behind.name}.`
      : `Leading the ${field}, ${plural(c.behind.gap, "point")} ahead of ${c.behind.name}.`;
  }
  const head = `P${c.position} of the ${field}.`;
  if (!c.ahead) return head;
  return `${head} ${plural(c.ahead.gap, "point")} behind ${c.ahead.name} in P${c.ahead.position}.`;
}

// The headline beside the big number. The number already says the place,
// so the headline says what the place is worth: the title, or the gap to the
// car ahead.
export function resultHeadline(review) {
  const { position, ahead, behind } = review.championship;
  const { complete } = review.season;
  if (!position) return "Not classified";
  if (position === 1) {
    if (complete) return "Champion";
    return behind ? `Leading by ${plural(behind.gap, "point")}` : "Leading the table";
  }
  if (!ahead) return `${nth(position)} in the championship`;
  return ahead.gap === 0 ? `Level on points with P${ahead.position}` : `${plural(ahead.gap, "point")} off P${ahead.position}`;
}

// The championship line through the season, in one sentence: where it began,
// where it ended, and the best place on the way when that was neither.
export function journeyLine(review) {
  const j = review.championship.journey || [];
  if (j.length < 2) return null;
  const first = j[0];
  const last = j[j.length - 1];
  const peak = review.championship.peak;
  const end = review.season.complete ? "at the end" : `after ${roundName(last)}`;
  const bits = [`P${first.position} after ${roundName(first)}, P${last.position} ${end}.`];
  if (peak && peak.position < last.position && peak.position < first.position) bits.push(`Best place: P${peak.position} after ${roundName(peak)}.`);
  const led = review.championship.roundsLed || 0;
  if (led > 0) bits.push(`Led the table after ${plural(led, "round")}.`);
  return bits.join(" ");
}

// The driver next in the table and how the two compared on track. The
// counts are the reviewed driver's (`ahead` = races they finished ahead in),
// so the driver the page is about is the one named as ahead.
export function neighbourLine(n, me) {
  if (!n || !n.races) return null;
  return `Against ${n.name}, P${n.position}: ${me} finished ahead in ${n.ahead} of the ${plural(n.races, "race")} both finished.`;
}

// "R1 Melbourne", "R1 Melbourne and R7 Spa", "R1 A, R4 B and R7 C"
const listOf = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

// Under the round-by-round sheet: what the sheet's columns do not say on
// their own. The retirements, the rounds not started, the dropped rounds.
export function roundsLine(review) {
  const rounds = review.rounds || [];
  if (!rounds.length) return null;
  const bits = [];
  const out = rounds.filter((r) => r.status === "DNF" || r.status === "DSQ");
  if (out.length) bits.push(`${out.length === 1 ? `Out of ${roundName(out[0])}` : `Out of ${listOf(out.map(roundName))}`} (${out.map((r) => r.status).join(", ")}).`);
  const missed = rounds.filter((r) => r.status === "DNS");
  if (missed.length) bits.push(`Did not start ${listOf(missed.map(roundName))}.`);
  const dropped = rounds.filter((r) => r.dropped);
  if (dropped.length) bits.push(`Dropped under the rules: ${listOf(dropped.map(roundName))}.`);
  if (!bits.length) bits.push(`Started and finished all ${plural(rounds.length, "round")}.`);
  return bits.join(" ");
}

// The best round, under its name.
export function bestLine(best) {
  if (!best) return null;
  const race = best.sprint ? "the sprint" : null;
  const from = best.grid > 0 ? `Started P${best.grid}, finished P${best.position}` : `Finished P${best.position}`;
  return `${from}${race ? ` in ${race}` : ""}.`;
}

export function climbLine(climb) {
  if (!climb) return null;
  return `${roundName(climb)}: P${climb.grid} to P${climb.position}, ${plural(climb.gained, "place")} made up.`;
}

// The contact chapter's line: where the contact came, which the counts in
// the rows beside it do not say.
export function contactLine(contact, rounds = []) {
  if (!contact) return null;
  if (!contact.cars) return `No contact with another car in ${plural(contact.rounds ?? contact.races, "round")} on file.`;
  const hit = rounds.filter((r) => r.contacts > 0).sort((a, b) => b.contacts - a.contacts || a.round - b.round);
  if (hit.length <= 3) return `The contact with other cars came in ${listOf(hit.map((r) => `${roundName(r)} (${r.contacts})`))}.`;
  const top = hit[0];
  return `The most in one round: ${top.contacts}, in ${roundName(top)}. Contact in ${hit.length} of the ${plural(contact.rounds ?? contact.races, "round")} on file.`;
}

// A team-mate duel as three score lines.
export function duelLines(mate) {
  const lines = [];
  if (mate.races > 0) lines.push({ key: "races", label: "At the flag", me: mate.ahead, them: mate.behind, note: `ahead, ${plural(mate.races, "race")} both finished` });
  if (mate.starts > 0) lines.push({ key: "grid", label: "On the grid", me: mate.qualiAhead, them: mate.qualiBehind, note: `ahead, ${plural(mate.starts, "start")} on different slots` });
  lines.push({ key: "points", label: "Points", me: mate.myPoints, them: mate.points, note: null });
  return lines;
}

// The source note at the foot of the page.
export function sourceLine(review) {
  const rounds = review.rounds?.length || 0;
  const withTel = (review.rounds || []).filter((r) => r.contacts != null).length;
  const base = `From the league's results for ${plural(rounds, "round")}`;
  return withTel
    ? `${base}, and the race server's files for ${withTel} of them. Contact with a car under 10 km/h and with the scenery under 15 km/h is not counted.`
    : `${base}.`;
}
