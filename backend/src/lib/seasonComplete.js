// ---------------------------------------------------------------------------
// "Is a season finished?" — one definition, shared. A season is complete once
// every championship round (a race with a round number, not a special event)
// has been run. honoursService uses it for the end-of-season celebration; the
// profile badge shelf and the card editions use it so a season's honours (gold
// card, champion seal) appear the moment the finale is imported, not only once
// the next season starts.
// ---------------------------------------------------------------------------

// Pure: given a season's races, is it complete? Callers that already loaded the
// races (honoursService, getDriverProfile) use this to avoid a second query.
export function seasonCompleteFromRaces(races) {
  const rounds = (races || []).filter((r) => !r.isSpecialEvent && r.number != null);
  return rounds.length > 0 && rounds.every((r) => r.isCompleted);
}

// Async convenience for callers that only have a seasonId.
export async function isSeasonComplete(prisma, seasonId) {
  if (!seasonId) return false;
  const races = await prisma.race.findMany({
    where: { seasonId, isSpecialEvent: false },
    select: { number: true, isCompleted: true, isSpecialEvent: true },
  });
  return seasonCompleteFromRaces(races);
}

// The shared "this season's honours count now" rule: a season is concluded when
// it lies behind the active one, or it IS the active one and every round has
// run. `activeNumber`/`activeComplete` describe the series' active season.
export function seasonConcluded(seasonNumber, activeNumber, activeComplete) {
  if (seasonNumber == null || activeNumber == null) return false;
  return seasonNumber < activeNumber || (seasonNumber === activeNumber && !!activeComplete);
}
