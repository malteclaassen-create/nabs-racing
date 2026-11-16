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

// The headline beside the big number.
export function resultHeadline(review) {
  const { position } = review.championship;
  const { complete, roundsRun } = review.season;
  if (!position) return "Not classified";
  if (!complete) return position === 1 ? `Leading after round ${roundsRun}` : `${nth(position)} after round ${roundsRun}`;
  if (position === 1) return "Champion";
  if (position === 2) return "Runner-up";
  if (position === 3) return "Third in the championship";
  return `${nth(position)} in the championship`;
}

// The championship line through the season, in one sentence: where it began,
// where it ended, and the best place on the way when that was neither.
export function journeyLine(review) {
  const j = review.championship.journey || [];
  if (j.length < 2) return null;
  const first = j[0];
  const last = j[j.length - 1];
  const peak = review.championship.peak;
  const end = review.season.complete ? "at the end" : `after round ${last.round}`;
  const bits = [`P${first.position} after ${roundName(first)}, P${last.position} ${end}.`];
  if (peak && peak.position < last.position && peak.position < first.position) bits.push(`Best place: P${peak.position} after ${roundName(peak)}.`);
  const led = review.championship.roundsLed || 0;
  if (led > 0) bits.push(`Led the table after ${plural(led, "round")}.`);
  return bits.join(" ");
}

// The driver next in the table, and how the two of them compared on track.
export function neighbourLine(n, { ahead = true } = {}) {
  if (!n) return null;
  const where = ahead ? `${n.name} finished P${n.position}, ${plural(n.gap, "point")} up.` : `${n.name} finished P${n.position}, ${plural(n.gap, "point")} back.`;
  if (!n.races) return where;
  return `${where} Ahead on track in ${n.ahead} of the ${plural(n.races, "race")} both finished.`;
}

// Under the round-by-round sheet: how many rounds paid, the retirements, the
// dropped rounds.
export function roundsLine(review) {
  const rounds = review.rounds || [];
  if (!rounds.length) return null;
  const scored = rounds.filter((r) => r.points > 0).length;
  const bits = [`Points in ${scored} of ${plural(rounds.length, "round")}.`];
  const dnf = rounds.filter((r) => r.status === "DNF" || r.status === "DSQ");
  if (dnf.length === 1) bits.push(`The one ${dnf[0].status} was ${roundName(dnf[0])}.`);
  else if (dnf.length > 1) bits.push(`${dnf.length} retirements: ${dnf.map(roundName).join(", ")}.`);
  const missed = rounds.filter((r) => r.status === "DNS").length;
  if (missed) bits.push(`Missed ${plural(missed, "round")}.`);
  const dropped = rounds.filter((r) => r.dropped);
  if (dropped.length) bits.push(`Dropped under the rules: ${dropped.map(roundName).join(", ")}.`);
  return bits.join(" ");
}

// The best round, under its name.
export function bestLine(best) {
  if (!best) return null;
  const race = best.sprint ? "the sprint" : null;
  const from = best.grid > 0 ? `Started P${best.grid}, finished P${best.position}` : `Finished P${best.position}`;
  return `${from}${race ? ` in ${race}` : ""}. ${plural(best.points, "point")}.`;
}

export function climbLine(climb) {
  if (!climb) return null;
  return `${roundName(climb)}: P${climb.grid} to P${climb.position}, ${plural(climb.gained, "place")} made up.`;
}

// The contact chapter's summary.
export function contactLine(contact) {
  if (!contact) return null;
  const bits = [`${plural(contact.cars, "contact")} with other cars in ${plural(contact.races, "race")}, ${contact.scenery} with the scenery.`];
  if (contact.clean > 0) bits.push(`${contact.clean} of the ${contact.races} without touching another car.`);
  return bits.join(" ");
}

// A team-mate duel as three score lines.
export function duelLines(mate) {
  const lines = [];
  if (mate.races > 0) lines.push({ key: "races", label: "Races", me: mate.ahead, them: mate.behind, note: `of ${plural(mate.races, "race")} both finished` });
  if (mate.starts > 0) lines.push({ key: "grid", label: "Grid", me: mate.qualiAhead, them: mate.qualiBehind, note: `of ${plural(mate.starts, "start")}` });
  lines.push({ key: "points", label: "Points", me: mate.myPoints, them: mate.points, note: null });
  return lines;
}

// The source note at the foot of the page.
export function sourceLine(review) {
  const rounds = review.rounds?.length || 0;
  const withTel = (review.rounds || []).filter((r) => r.contacts != null).length;
  const base = `From the league's results for ${plural(rounds, "round")}`;
  return withTel ? `${base}, and the race server's files for ${withTel} of them. Contacts under 10 km/h are not counted.` : `${base}.`;
}
