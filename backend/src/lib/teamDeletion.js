// ---------------------------------------------------------------------------
// What stands in the way of deleting a team.
//
// The subtlety worth having in one place: a ConstructorRaceScore row is not
// proof that a team raced. constructorScores.js writes one row per tier team
// per scored round, zeros included, so the per-round columns of the standings
// line up instead of gaining and losing teams round by round. A team that has
// never scored therefore collects a blank row every round — and treating those
// as history made a brand-new team with no drivers, no results and 0 points
// permanently undeletable ("still has 6 constructor score(s)").
//
// So: only a row that moved points counts. Blank rows are bookkeeping and go
// with the team, like its driver-market seat offers.
// ---------------------------------------------------------------------------

// Each count named the way an admin would have to go and look for it. Returns
// the reasons in the order they should be read; empty means the team may go.
export function teamDeletionBlockers({
  drivers = 0,
  subResults = 0,
  stampedResults = 0,
  scoredRounds = 0,
  transfers = 0,
} = {}) {
  const hard = [];
  if (drivers > 0) hard.push(`${drivers} driver(s) in its seats`);
  if (subResults > 0) hard.push(`${subResults} race result(s) subbed for it`);
  if (stampedResults > 0) hard.push(`${stampedResults} race result(s) scored under it`);
  if (scoredRounds > 0) hard.push(`${scoredRounds} round(s) where it scored points`);
  // A recorded "from round N they drive for this team" (DriverTeamChange, no
  // foreign key): deleted with the team, the round would be saved under a
  // team id that no longer exists and its constructor points would vanish.
  if (transfers > 0) hard.push(`${transfers} recorded driver transfer(s) to it`);
  return hard;
}
