// The season's Reserve pool (the tier-0 team). Seasons made via clone always
// have one; a hand-built season without one gets a minimal pool created on
// first use. Shared by the attendance auto-reserve (routes/events.js) and the
// driver-delete demotion (routes/admin.js).
export async function ensureReservePool(prisma, seasonId) {
  const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { id: true, number: true } });
  if (!season) return null;
  let pool = await prisma.team.findFirst({ where: { seasonId: season.id, tier: 0 } });
  if (!pool) {
    const poolId = `reserve_s${season.number}_${Date.now().toString(36)}`;
    pool = await prisma.team.create({
      data: { id: poolId, name: "Reserve", tier: 0, color: "#64748b", seasonId: season.id },
    });
  }
  return pool;
}
