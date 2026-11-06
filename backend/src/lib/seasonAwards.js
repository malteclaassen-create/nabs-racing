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
// is not on the roster, or "X and Y" for a shared award). A short line under
// it says why, if the league wants one.
//
// Shown in the Hall of Fame (all seasons) and in the season honours on Home.
// ---------------------------------------------------------------------------
import { randomUUID } from "node:crypto";

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
    "teamId" TEXT,
    "raceId" TEXT,
    "winnerText" TEXT,
    "note" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
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
// { kind: "driver"|"team"|"race"|"text", id?, text? }. The ids are checked
// against the season by the caller (checkWinnerInSeason), since that needs
// the database.
export function sanitizeAwardInput(body) {
  const b = body && typeof body === "object" ? body : {};
  const title = cleanText(b.title, AWARD_LIMITS.title);
  if (!title) return { error: "Give the award a name." };
  const note = cleanText(b.note, AWARD_LIMITS.note) || null;
  const kind = String(b.kind || "");
  const out = { title, note, driverId: null, teamId: null, raceId: null, winnerText: null };
  if (kind === "driver" || kind === "team" || kind === "race") {
    const id = String(b.winnerId ?? "");
    if (!isAwardId(id)) return { error: `Pick the ${kind} who won it.` };
    out[`${kind}Id`] = id;
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
    `INSERT INTO "SeasonAward" ("id","seasonId","title","driverId","teamId","raceId","winnerText","note","position")
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id, seasonId, award.title, award.driverId, award.teamId, award.raceId, award.winnerText, award.note,
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
    `UPDATE "SeasonAward" SET "title" = ?, "driverId" = ?, "teamId" = ?, "raceId" = ?, "winnerText" = ?, "note" = ? WHERE "id" = ?`,
    award.title, award.driverId, award.teamId, award.raceId, award.winnerText, award.note, id
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
  const [drivers, teams, races] = await Promise.all([
    ids("driverId").length
      ? prisma.driver.findMany({
          where: { id: { in: ids("driverId") } },
          select: {
            id: true, name: true, photoUrl: true, discordAvatar: true, country: true, tier: true,
            team: { select: { id: true, name: true, color: true, logoUrl: true } },
          },
        })
      : [],
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
  const d = byId(drivers);
  const t = byId(teams);
  const r = byId(races);

  for (const row of rows) {
    const award = shapeAward(row, { driver: d.get(row.driverId), team: t.get(row.teamId), race: r.get(row.raceId) });
    if (!award) continue;
    if (!out.has(row.seasonId)) out.set(row.seasonId, []);
    out.get(row.seasonId).push(award);
  }
  return out;
}

// One award as the API hands it out. A winner whose row has since been
// deleted falls back to the typed name, and with none the award is dropped
// rather than shown as won by nobody.
export function shapeAward(row, { driver, team, race } = {}) {
  const base = { id: row.id, title: row.title, note: row.note || null };
  if (row.driverId && driver) {
    return {
      ...base,
      kind: "driver",
      driver: {
        driverId: driver.id,
        name: driver.name,
        photoUrl: driver.photoUrl || driver.discordAvatar || null,
        country: driver.country || null,
        tier: driver.tier ?? null,
        team: driver.team ? { ...driver.team } : null,
      },
    };
  }
  if (row.teamId && team) {
    return { ...base, kind: "team", team: { ...team } };
  }
  if (row.raceId && race) {
    return {
      ...base,
      kind: "race",
      race: {
        id: race.id,
        round: race.number ?? null,
        track: race.track,
        country: race.country || null,
        date: race.date ? new Date(race.date).toISOString() : null,
        isCompleted: !!race.isCompleted,
      },
    };
  }
  if (row.winnerText) return { ...base, kind: "text", winnerText: row.winnerText };
  return null;
}
