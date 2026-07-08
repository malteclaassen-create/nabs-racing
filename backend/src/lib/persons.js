// ---------------------------------------------------------------------------
// Cross-season person links. Driver rows are per-season, so one real person who
// raced in S5, S6 and S7 has three Driver rows with different ids (and sometimes
// different handles). PersonLink groups those rows under one shared personId so:
//   * a driver profile can aggregate a career across seasons,
//   * archive tables show the person's CURRENT name with a "raced as <old>" note,
//   * Discord login can follow a person to their latest-season row.
//
// Like MemberAccount/Download, managed via raw SQL (the running dev server locks
// the generated Prisma client on Windows). Keep in sync with the PersonLink model
// in prisma/schema.prisma.
// ---------------------------------------------------------------------------
import { randomUUID } from "crypto";

// Link a set of driver rows to one person. If any of them are already linked,
// their groups are merged (all end up sharing a single personId). Returns that
// personId. A single-id call still records the row (harmless; lets the admin
// "seed" a person before adding more).
export async function dbLinkDrivers(prisma, driverIds) {
  const ids = [...new Set((driverIds || []).filter(Boolean))];
  if (!ids.length) return null;
  const placeholders = ids.map(() => "?").join(",");
  const existing = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT "personId" FROM "PersonLink" WHERE "driverId" IN (${placeholders})`,
    ...ids
  );
  const personId = existing[0]?.personId || randomUUID();
  // Merge: repoint every already-linked member of the touched groups too.
  const otherPersonIds = existing.map((r) => r.personId).filter((p) => p && p !== personId);
  if (otherPersonIds.length) {
    const ph = otherPersonIds.map(() => "?").join(",");
    await prisma.$executeRawUnsafe(
      `UPDATE "PersonLink" SET "personId" = ? WHERE "personId" IN (${ph})`,
      personId,
      ...otherPersonIds
    );
  }
  const now = new Date().toISOString();
  for (const id of ids) {
    await prisma.$executeRaw`
      INSERT INTO "PersonLink" ("driverId","personId","createdAt")
      VALUES (${id}, ${personId}, ${now})
      ON CONFLICT("driverId") DO UPDATE SET "personId" = ${personId}`;
  }
  return personId;
}

export async function dbUnlinkDriver(prisma, driverId) {
  await prisma.$executeRaw`DELETE FROM "PersonLink" WHERE "driverId" = ${driverId}`;
}

// All person groups: [{ personId, driverIds: [...] }].
export async function dbListPersons(prisma) {
  const rows = await prisma.$queryRaw`SELECT "driverId","personId" FROM "PersonLink"`;
  const byPerson = new Map();
  for (const r of rows) {
    if (!byPerson.has(r.personId)) byPerson.set(r.personId, []);
    byPerson.get(r.personId).push(r.driverId);
  }
  return [...byPerson.entries()].map(([personId, driverIds]) => ({ personId, driverIds }));
}

// Fast lookups: { byDriver: Map<driverId, personId>, byPerson: Map<personId, [driverId]> }.
export async function getPersonGroups(prisma) {
  let rows = [];
  try {
    rows = await prisma.$queryRaw`SELECT "driverId","personId" FROM "PersonLink"`;
  } catch {
    // Table missing (fresh checkout before ensureAppSchema): no links.
    rows = [];
  }
  const byDriver = new Map();
  const byPerson = new Map();
  for (const r of rows) {
    byDriver.set(r.driverId, r.personId);
    if (!byPerson.has(r.personId)) byPerson.set(r.personId, []);
    byPerson.get(r.personId).push(r.driverId);
  }
  return { byDriver, byPerson };
}

// Every driver row belonging to the same person as `driverId` (including itself).
export async function getLinkedDriverIds(prisma, driverId) {
  const { byDriver, byPerson } = await getPersonGroups(prisma);
  const personId = byDriver.get(driverId);
  if (!personId) return [driverId];
  return byPerson.get(personId) || [driverId];
}

// Pure core of the name resolution (exported for testing). `rows` =
// [{ personId, driverId, name, seasonNumber }]. Returns Map<driverId, {
// displayName, formerName }> for every linked driver whose own name differs from
// the person's CURRENT name (the name on their highest-season-number row).
export function resolveNameOverrides(rows) {
  const byPerson = new Map();
  for (const r of rows) {
    if (!byPerson.has(r.personId)) byPerson.set(r.personId, []);
    byPerson.get(r.personId).push(r);
  }
  const out = new Map();
  for (const members of byPerson.values()) {
    if (members.length < 2) continue;
    const current = members.reduce((a, b) => ((b.seasonNumber ?? -1) > (a.seasonNumber ?? -1) ? b : a));
    for (const m of members) {
      if (m.name && current.name && m.name !== current.name) {
        out.set(m.driverId, { displayName: current.name, formerName: m.name });
      }
    }
  }
  return out;
}

// Name overrides for linked drivers, keyed by driverId. Callers filter to the
// season they're rendering. Safe when the table is missing.
export async function getNameOverrides(prisma) {
  let rows = [];
  try {
    rows = await prisma.$queryRawUnsafe(
      `SELECT pl."personId" AS "personId", d."id" AS "driverId", d."name" AS "name", s."number" AS "seasonNumber"
       FROM "PersonLink" pl
       JOIN "Driver" d ON d."id" = pl."driverId"
       LEFT JOIN "Season" s ON s."id" = d."seasonId"`
    );
  } catch {
    return new Map();
  }
  return resolveNameOverrides(rows.map((r) => ({ ...r, seasonNumber: r.seasonNumber == null ? null : Number(r.seasonNumber) })));
}
