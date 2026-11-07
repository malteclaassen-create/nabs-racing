// ---------------------------------------------------------------------------
// Season awards: the honours the league hands out by vote or by decision at the
// end of a season (best rookie, best qualifier, best Tier 1 driver, race of
// the season, ...). Nothing here is worked out from the results: the admin
// types the award and picks who won it. The computed honours (best newcomer,
// most overtakes, ...) stay in services/honoursService.js.
//
// One row per award in "SeasonAward", raw-SQL managed like "NewsComment"
// (ensureSeasonAwardTable, called from ensureAppSchema) and mirrored by a
// migration. An award is won by ONE of: a driver of that season, a team of
// that season, a race of that season, or a name typed by hand (someone who
// is not on the roster). A driver award can name a second driver for an
// award two people share (best partnership), or the race it was won in
// (drive of the season). A short line under it says why,
// if the league wants one.
//
// Shown in the Hall of Fame (all seasons) and in the season honours on Home.
// ---------------------------------------------------------------------------
import { randomUUID } from "node:crypto";
import { getIdentityOverrides } from "./persons.js";
import { parseCardPhotoPos, personPhotoFor, photoFallbacksFor } from "./cardPhoto.js";

export const AWARD_LIMITS = { title: 60, winner: 80, note: 200, perSeason: 40 };

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isAwardId(id) {
  return ID_RE.test(String(id ?? ""));
}

// --- the table ---------------------------------------------------------------

export async function ensureSeasonAwardTable(prisma) {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SeasonAward" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "driverId" TEXT,
    "partnerId" TEXT,
    "teamId" TEXT,
    "raceId" TEXT,
    "winnerText" TEXT,
    "note" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // A table from before shared awards gets the column on its own.
  const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("SeasonAward")`);
  if (!cols.some((c) => c.name === "partnerId")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "SeasonAward" ADD COLUMN "partnerId" TEXT`);
  }
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "SeasonAward_seasonId_position_idx" ON "SeasonAward"("seasonId", "position")`
  );
}

// --- input -------------------------------------------------------------------

function cleanText(v, max) {
  if (v == null) return "";
  return String(v).replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// What an admin sent, checked and trimmed. Exactly one kind of winner:
// { kind: "driver"|"team"|"race"|"text", winnerId?, partnerId?, raceId?,
// winnerText? }; partnerId and raceId only with a driver. The ids are checked
// against the season by the caller (checkWinnerInSeason), since that needs
// the database.
export function sanitizeAwardInput(body) {
  const b = body && typeof body === "object" ? body : {};
  const title = cleanText(b.title, AWARD_LIMITS.title);
  if (!title) return { error: "Give the award a name." };
  const note = cleanText(b.note, AWARD_LIMITS.note) || null;
  const kind = String(b.kind || "");
  const out = { title, note, driverId: null, partnerId: null, teamId: null, raceId: null, winnerText: null };
  if (kind === "driver" || kind === "team" || kind === "race") {
    const id = String(b.winnerId ?? "");
    if (!isAwardId(id)) return { error: `Pick the ${kind} who won it.` };
    out[`${kind}Id`] = id;
    const partner = b.partnerId == null ? "" : String(b.partnerId);
    if (kind === "driver" && partner) {
      if (!isAwardId(partner)) return { error: "Pick the second driver again." };
      if (partner === id) return { error: "Pick two different drivers." };
      out.partnerId = partner;
    }
    const race = b.raceId == null ? "" : String(b.raceId);
    if (kind === "driver" && race) {
      if (!isAwardId(race)) return { error: "Pick the race again." };
      out.raceId = race;
    }
  } else if (kind === "text") {
    const text = cleanText(b.winnerText, AWARD_LIMITS.winner);
    if (!text) return { error: "Type who won it." };
    out.winnerText = text;
  } else {
    return { error: "Say whether a driver, a team or a race won it." };
  }
  return { value: out };
}

// The picked driver, team or race must belong to the award's season, or the
// Hall of Fame would show a Season 3 award won by a Season 7 row.
export async function checkWinnerInSeason(prisma, seasonId, award) {
  // A driver award's race is checked on its own; the driver below.
  if (award.driverId && award.raceId) {
    const rows = await prisma.$queryRawUnsafe(`SELECT "seasonId" FROM "Race" WHERE "id" = ?`, award.raceId);
    if (!rows.length || rows[0].seasonId !== seasonId) return false;
  }
  if (award.partnerId) {
    const rows = await prisma.$queryRawUnsafe(`SELECT "seasonId" FROM "Driver" WHERE "id" = ?`, award.partnerId);
    if (!rows.length || rows[0].seasonId !== seasonId) return false;
  }
  const [table, id] = award.driverId
    ? ["Driver", award.driverId]
    : award.teamId
      ? ["Team", award.teamId]
      : award.raceId
        ? ["Race", award.raceId]
        : [null, null];
  if (!table) return true;
  const rows = await prisma.$queryRawUnsafe(`SELECT "seasonId" FROM "${table}" WHERE "id" = ?`, id);
  return rows.length > 0 && rows[0].seasonId === seasonId;
}

// --- writes ------------------------------------------------------------------

export async function createAward(prisma, seasonId, award) {
  const [{ n } = { n: 0 }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS "n" FROM "SeasonAward" WHERE "seasonId" = ?`,
    seasonId
  );
  if (Number(n) >= AWARD_LIMITS.perSeason) return { error: `A season can have at most ${AWARD_LIMITS.perSeason} awards.` };
  const [{ p } = { p: null }] = await prisma.$queryRawUnsafe(
    `SELECT MAX("position") AS "p" FROM "SeasonAward" WHERE "seasonId" = ?`,
    seasonId
  );
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SeasonAward" ("id","seasonId","title","driverId","partnerId","teamId","raceId","winnerText","note","position")
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, seasonId, award.title, award.driverId, award.partnerId ?? null, award.teamId, award.raceId, award.winnerText, award.note,
    p == null ? 0 : Number(p) + 1
  );
  return { id };
}

export async function readAwardRow(prisma, id) {
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "SeasonAward" WHERE "id" = ?`, id);
  return rows[0] || null;
}

export async function updateAward(prisma, id, award) {
  await prisma.$executeRawUnsafe(
    `UPDATE "SeasonAward" SET "title" = ?, "driverId" = ?, "partnerId" = ?, "teamId" = ?, "raceId" = ?, "winnerText" = ?, "note" = ? WHERE "id" = ?`,
    award.title, award.driverId, award.partnerId ?? null, award.teamId, award.raceId, award.winnerText, award.note, id
  );
}

export async function deleteAward(prisma, id) {
  await prisma.$executeRawUnsafe(`DELETE FROM "SeasonAward" WHERE "id" = ?`, id);
}

// The season's awards in the order given (ids). Ids that are not the season's
// are ignored; awards left out keep their place after the named ones.
export async function reorderAwards(prisma, seasonId, ids) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "SeasonAward" WHERE "seasonId" = ? ORDER BY "position", "createdAt"`,
    seasonId
  );
  const order = orderIds(rows.map((r) => r.id), ids);
  for (let i = 0; i < order.length; i++) {
    await prisma.$executeRawUnsafe(`UPDATE "SeasonAward" SET "position" = ? WHERE "id" = ?`, i, order[i]);
  }
}

// Pure part of reorderAwards: the existing ids, the wanted ones first.
export function orderIds(existing, wanted) {
  const have = new Set(existing);
  const seen = new Set();
  const front = [];
  for (const id of Array.isArray(wanted) ? wanted : []) {
    if (have.has(id) && !seen.has(id)) {
      front.push(id);
      seen.add(id);
    }
  }
  return [...front, ...existing.filter((id) => !seen.has(id))];
}

// --- reads -------------------------------------------------------------------

// Every award of the given seasons, with what the page needs about the winner,
// grouped by season id in award order. Never throws: a database from before
// the table simply has no awards.
export async function readSeasonAwards(prisma, seasonIds) {
  const out = new Map();
  if (!seasonIds?.length) return out;
  let rows;
  try {
    const marks = seasonIds.map(() => "?").join(",");
    rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "SeasonAward" WHERE "seasonId" IN (${marks}) ORDER BY "position", "createdAt"`,
      ...seasonIds
    );
  } catch {
    return out;
  }
  if (!rows.length) return out;

  const ids = (key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))];
  const driverIds = [...new Set([...ids("driverId"), ...ids("partnerId")])];
  const [drivers, pictures, identity, teams, races] = await Promise.all([
    driverIds.length
      ? prisma.driver.findMany({
          where: { id: { in: driverIds } },
          select: {
            id: true, name: true, photoUrl: true, discordAvatar: true, country: true, tier: true,
            team: { select: { id: true, name: true, color: true, logoUrl: true } },
          },
        })
      : [],
    // The card picture columns are raw-SQL columns (see lib/cardPhoto.js).
    driverIds.length
      ? prisma
          .$queryRawUnsafe(
            `SELECT "id","cardPhotoUrl","cardPhotoPos" FROM "Driver" WHERE "id" IN (${driverIds.map(() => "?").join(",")})`,
            ...driverIds
          )
          .catch(() => [])
      : [],
    driverIds.length ? getIdentityOverrides(prisma) : new Map(),
    ids("teamId").length
      ? prisma.team.findMany({
          where: { id: { in: ids("teamId") } },
          select: { id: true, name: true, color: true, logoUrl: true, tier: true },
        })
      : [],
    ids("raceId").length
      ? prisma.race.findMany({
          where: { id: { in: ids("raceId") } },
          select: { id: true, number: true, track: true, country: true, date: true, isCompleted: true },
        })
      : [],
  ]);
  const byId = (list) => new Map(list.map((x) => [x.id, x]));
  // The picture follows the same rule as the standings: the row's own photo,
  // else the linked person's newest, else the Discord avatar, with the rest
  // of that chain as fallbacks for a dead link.
  const pics = byId(pictures);
  const d = new Map(
    drivers.map((x) => {
      const idov = identity.get(x.id);
      const own = {
        cardPhotoUrl: pics.get(x.id)?.cardPhotoUrl || null,
        photoUrl: x.photoUrl || null,
        discordAvatar: x.discordAvatar || null,
        photoPos: parseCardPhotoPos(pics.get(x.id)?.cardPhotoPos),
      };
      return [
        x.id,
        {
          ...x,
          photoUrl: personPhotoFor(own, idov),
          photoFallbacks: photoFallbacksFor(own, idov),
          country: x.country || idov?.country || null,
        },
      ];
    })
  );
  const t = byId(teams);
  const r = byId(races);

  for (const row of rows) {
    const award = shapeAward(row, {
      driver: d.get(row.driverId),
      partner: d.get(row.partnerId),
      team: t.get(row.teamId),
      race: r.get(row.raceId),
    });
    if (!award) continue;
    if (!out.has(row.seasonId)) out.set(row.seasonId, []);
    out.get(row.seasonId).push(award);
  }
  return out;
}

// One award as the API hands it out. A winner whose row has since been
// deleted falls back to the typed name, and with none the award is dropped
// rather than shown as won by nobody.
export function shapeAward(row, { driver, partner, team, race } = {}) {
  const base = { id: row.id, title: row.title, note: row.note || null };
  // A shared award whose first driver is gone keeps the second one.
  const first = row.driverId && driver ? driver : row.partnerId && partner ? partner : null;
  if (first) {
    const second = first === driver && row.partnerId && partner ? partner : null;
    return {
      ...base,
      kind: "driver",
      driver: shapeDriver(first),
      partner: second ? shapeDriver(second) : null,
      // The race a drive of the season was won in, if the award names one.
      race: race ? shapeRace(race) : null,
    };
  }
  if (row.teamId && team) {
    return { ...base, kind: "team", team: { ...team } };
  }
  if (row.raceId && race) return { ...base, kind: "race", race: shapeRace(race) };
  if (row.winnerText) return { ...base, kind: "text", winnerText: row.winnerText };
  return null;
}

function shapeRace(race) {
  return {
    id: race.id,
    round: race.number ?? null,
    track: race.track,
    country: race.country || null,
    date: race.date ? new Date(race.date).toISOString() : null,
    isCompleted: !!race.isCompleted,
  };
}

function shapeDriver(driver) {
  const photoUrl = driver.photoUrl || driver.discordAvatar || null;
  return {
    driverId: driver.id,
    name: driver.name,
    photoUrl,
    photoFallbacks: (driver.photoFallbacks || []).filter((u) => u && u !== photoUrl),
    country: driver.country || null,
    tier: driver.tier ?? null,
    team: driver.team ? { ...driver.team } : null,
  };
}
