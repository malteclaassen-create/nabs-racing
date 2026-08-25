// How a race day's sessions read on the site: the upcoming-race panel on Home
// and the sign-up page both print the same line, so the wording lives here.
//
// A sprint weekend (raceFormat SPRINT_FEATURE, the F2 shape) names both races
// even when a distance is still TBA — "there is a sprint" is the part people
// need to know. A normal round keeps saying "Race 20 laps" exactly as before.
export function sessionSummary(race = {}) {
  const out = [];
  if (race.qualiMinutes) out.push(`Qualifying ${race.qualiMinutes} min`);
  if (race.raceFormat === "SPRINT_FEATURE") {
    out.push(race.sprintLaps ? `Sprint ${race.sprintLaps} laps` : "Sprint race");
    out.push(race.raceLaps ? `Feature ${race.raceLaps} laps` : "Feature race");
  } else if (race.raceLaps) {
    out.push(`Race ${race.raceLaps} laps`);
  }
  return out;
}
