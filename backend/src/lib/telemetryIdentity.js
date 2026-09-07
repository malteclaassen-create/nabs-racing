// Resolve by Steam ID inside the recorded season, never by a similar name or
// by whichever season's roster row the database happens to return first.
export async function telemetryIdentities(prisma, steamIds, seasonId, overrides = new Map()) {
  const ids = [...new Set(steamIds)].filter(Boolean);
  if (!seasonId || !ids.length) return new Map();
  const rows = await prisma.driver.findMany({
    where: {seasonId, steamId: {in: ids}},
    select: {id:true, steamId:true, name:true, team:{select:{id:true, name:true, color:true, logoUrl:true}}},
  });
  return new Map(rows.map(d => [d.steamId, {driverId:d.id, name:overrides.get(d.id)?.displayName || d.name, team:d.team || null}]));
}
