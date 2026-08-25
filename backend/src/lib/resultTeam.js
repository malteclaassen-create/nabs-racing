// ---------------------------------------------------------------------------
// Which team a single race result belongs to.
//
// A Driver row carries exactly one team for the whole season, so for a long
// time "the team of this result" was simply "the team that driver is in right
// now". That answer is wrong the moment somebody changes team mid-season: every
// round they had already driven suddenly claimed to have been driven for the
// new team. Constructor points never moved (they are frozen per round in
// ConstructorRaceScore at save time), but the result tables, the race hero, the
// poster and the import preview all rewrote themselves.
//
// So a result now records its own team, stamped when the round is saved, and
// the three sources are consulted in this order:
//
//   1. subForTeamId   a reserve who drove FOR a team this weekend. Always wins:
//                     it is the most specific statement anyone made about this
//                     one drive.
//   2. result.teamId  the team the driver was in when the round was saved. Null
//                     only for rounds saved before the column existed, which
//                     the backfill in ensureSchema fills in once.
//   3. driver.teamId  the driver's team today. The fallback, and the only
//                     answer available for a result that is not saved yet (the
//                     import preview builds its rows before anything is written).
// ---------------------------------------------------------------------------

// `driverById` is a Map of driverId -> driver row (or anything with .teamId).
export function resultTeamId(result, driverById) {
  if (!result) return null;
  if (result.subForTeamId) return result.subForTeamId;
  if (result.teamId) return result.teamId;
  return driverById?.get?.(result.driverId)?.teamId ?? null;
}

// Same question, answered with the team object rather than its id.
// `teamById` is a Map of teamId -> team row.
export function resultTeam(result, driverById, teamById) {
  const id = resultTeamId(result, driverById);
  return id ? teamById?.get?.(id) ?? null : null;
}
