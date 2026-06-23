// ---------------------------------------------------------------------------
// Season helpers. The public site shows ONE season at a time: the active one
// by default, or a specific season when the client asks for it (?season=N).
// Everything season-scoped (teams, drivers, races, standings) is filtered
// through the id resolved here, so older seasons stay readable as an archive.
// ---------------------------------------------------------------------------

// The currently active season (falls back to the highest-numbered one).
export async function getActiveSeason(prisma) {
  const active = await prisma.season.findFirst({ where: { isActive: true } });
  if (active) return active;
  return prisma.season.findFirst({ orderBy: { number: "desc" } });
}

// Resolve a season from an optional round-number selector (e.g. a query param).
// `null`/undefined -> the active season. Returns null if nothing matches.
export async function resolveSeason(prisma, seasonNumber) {
  if (seasonNumber === undefined || seasonNumber === null || seasonNumber === "") {
    return getActiveSeason(prisma);
  }
  const n = Number(seasonNumber);
  if (!Number.isFinite(n)) return getActiveSeason(prisma);
  return prisma.season.findUnique({ where: { number: n } });
}

// Convenience: just the id of the resolved season (or null).
export async function resolveSeasonId(prisma, seasonNumber) {
  const s = await resolveSeason(prisma, seasonNumber);
  return s ? s.id : null;
}
