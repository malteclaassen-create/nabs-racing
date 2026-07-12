// Special league roles per driver row ("role" column, added by ensureAppSchema
// outside the generated Prisma client — so reads and writes go through raw SQL
// here). null = regular driver; "safety" = safety car driver.

export const DRIVER_ROLES = ["safety"];

// Map driverId -> role for the given ids (only rows that HAVE a role appear).
// Empty map when the column doesn't exist yet (fresh checkout).
export async function readDriverRoles(prisma, driverIds) {
  const ids = [...new Set((driverIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const ph = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "role" FROM "Driver" WHERE "id" IN (${ph}) AND "role" IS NOT NULL`,
      ...ids
    );
    return new Map(rows.map((r) => [r.id, r.role]));
  } catch {
    return new Map();
  }
}

// Write a driver's role. `role` must be one of DRIVER_ROLES or null/"" (clear).
export async function writeDriverRole(prisma, driverId, role) {
  const value = role && DRIVER_ROLES.includes(role) ? role : null;
  await prisma.$executeRawUnsafe(`UPDATE "Driver" SET "role" = ? WHERE "id" = ?`, value, driverId);
  return value;
}
