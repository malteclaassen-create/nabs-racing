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
import { getActiveSeason } from "../services/seasonService.js";

// The active season's number, or null when it can't be read (fresh checkout,
// missing tables). Null just means "no cap": overrides then consider every row.
async function activeSeasonNumber(prisma) {
  try {
    const active = await getActiveSeason(prisma);
    return active?.number ?? null;
  } catch {
    return null;
  }
}

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
// the person's CURRENT name: the name on their highest-season-number row up to
// `activeSeasonNumber`. Rows beyond the active season are pre-season drafts
// (cloned rosters) and must never mask a rename the member makes on their
// active-season row. A case-only difference (e.g. "DanielJ" vs "Danielj") gets
// no override: names render uppercase anyway, and a "raced as" note that spells
// the same name would just look broken.
export function resolveNameOverrides(rows, activeSeasonNumber = null) {
  const byPerson = new Map();
  for (const r of rows) {
    if (!byPerson.has(r.personId)) byPerson.set(r.personId, []);
    byPerson.get(r.personId).push(r);
  }
  const out = new Map();
  for (const members of byPerson.values()) {
    if (members.length < 2) continue;
    const eligible =
      activeSeasonNumber == null ? members : members.filter((m) => (m.seasonNumber ?? -1) <= activeSeasonNumber);
    const pool = eligible.length ? eligible : members;
    const current = pool.reduce((a, b) => ((b.seasonNumber ?? -1) > (a.seasonNumber ?? -1) ? b : a));
    for (const m of members) {
      if (m.name && current.name && m.name.toLowerCase() !== current.name.toLowerCase()) {
        out.set(m.driverId, { displayName: current.name, formerName: m.name });
      }
    }
  }
  return out;
}

// Pure core of the identity resolution (exported for testing). `rows` =
// [{ personId, driverId, seasonNumber, photoUrl, discordAvatar, country,
// cardPhotoPos }]. Returns Map<driverId, { photoUrl, photoPos, country }> with
// the person's CURRENT identity: the photo (and its card framing) from their
// newest row that has one, the country likewise — so archive rows show the
// same face and flag as the person's latest season. Rows beyond
// `activeSeasonNumber` are pre-season drafts (cloned rosters): they rank last,
// so a stale clone can't shadow a photo/flag the member changes on their
// active-season row. Callers use these as FALLBACKS only (a row's own values
// always win).
export function resolveIdentityOverrides(rows, activeSeasonNumber = null) {
  const byPerson = new Map();
  for (const r of rows) {
    if (!byPerson.has(r.personId)) byPerson.set(r.personId, []);
    byPerson.get(r.personId).push(r);
  }
  const out = new Map();
  for (const members of byPerson.values()) {
    if (members.length < 2) continue;
    const isDraft = (m) => activeSeasonNumber != null && (m.seasonNumber ?? -1) > activeSeasonNumber;
    const sorted = [...members].sort(
      (a, b) => (isDraft(a) ? 1 : 0) - (isDraft(b) ? 1 : 0) || (b.seasonNumber ?? -1) - (a.seasonNumber ?? -1)
    );
    const photoRow = sorted.find((m) => m.photoUrl || m.discordAvatar);
    const countryRow = sorted.find((m) => m.country);
    if (!photoRow && !countryRow) continue;
    const identity = {
      photoUrl: photoRow ? photoRow.photoUrl || photoRow.discordAvatar : null,
      // raw JSON string; consumers parse via lib/cardPhoto parseCardPhotoPos
      photoPos: photoRow ? photoRow.cardPhotoPos || null : null,
      country: countryRow ? countryRow.country : null,
    };
    for (const m of members) out.set(m.driverId, identity);
  }
  return out;
}

// Identity overrides (photo, card framing, country) for linked drivers, keyed
// by driverId. Safe when the tables/columns are missing.
export async function getIdentityOverrides(prisma) {
  let rows = [];
  try {
    rows = await prisma.$queryRawUnsafe(
      `SELECT pl."personId" AS "personId", d."id" AS "driverId", s."number" AS "seasonNumber",
              d."photoUrl" AS "photoUrl", d."discordAvatar" AS "discordAvatar",
              d."country" AS "country", d."cardPhotoPos" AS "cardPhotoPos"
       FROM "PersonLink" pl
       JOIN "Driver" d ON d."id" = pl."driverId"
       LEFT JOIN "Season" s ON s."id" = d."seasonId"`
    );
  } catch {
    return new Map();
  }
  return resolveIdentityOverrides(
    rows.map((r) => ({ ...r, seasonNumber: r.seasonNumber == null ? null : Number(r.seasonNumber) })),
    await activeSeasonNumber(prisma)
  );
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
  return resolveNameOverrides(
    rows.map((r) => ({ ...r, seasonNumber: r.seasonNumber == null ? null : Number(r.seasonNumber) })),
    await activeSeasonNumber(prisma)
  );
}
