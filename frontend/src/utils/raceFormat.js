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

// The race the home/welcome "Next Race" card counts down to: the earliest
// upcoming championship round OR training session, by date. Trainings belong
// here — an F2 sprint night IS the league's next race even though it isn't
// scored — while specials stay announcement-only, exactly like the sign-up
// page. A sprint weekend's hidden sprint row never reaches this list (the API
// filters it out of the calendar). Dateless races sort last, by round number,
// which is what "first uncompleted round" used to give.
export function nextUpcomingRace(races) {
  const kind = (r) => r.type || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
  return (
    [...(races || [])]
      .filter((r) => !r.isCompleted && kind(r) !== "SPECIAL")
      .sort((a, b) => {
        const ad = a.date ? new Date(a.date).getTime() : Infinity;
        const bd = b.date ? new Date(b.date).getTime() : Infinity;
        if (ad !== bd) return ad - bd;
        return (a.number ?? 999) - (b.number ?? 999);
      })[0] || null
  );
}
