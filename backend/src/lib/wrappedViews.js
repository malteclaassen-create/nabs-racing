// Who has watched their own season Wrapped (pages/review/Story.jsx), for the
// admin's System > Wrapped view. One row per member and season: when they
// first and last opened it, how often, and how far they got (the furthest
// slide, out of how many). Only a member opening THEIR OWN Wrapped is kept;
// an admin looking at someone else's is not a view.
import { isSeasonComplete } from "./seasonComplete.js";
import { discordIdsForDrivers } from "./persons.js";

export async function ensureWrappedViewTable(prisma) {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "WrappedView" (
    "seasonId"  TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "driverId"  TEXT NOT NULL,
    "name"      TEXT,
    "firstAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opens"     INTEGER NOT NULL DEFAULT 0,
    "furthest"  INTEGER NOT NULL DEFAULT 0,
    "slides"    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("seasonId", "discordId")
  )`);
}

// The member opened their own Wrapped.
export async function recordWrappedOpen(prisma, { seasonId, discordId, driverId, name }) {
  if (!seasonId || !discordId || !driverId) return;
  const now = new Date().toISOString();
  await prisma.$executeRaw`
    INSERT INTO "WrappedView" ("seasonId","discordId","driverId","name","firstAt","lastAt","opens")
    VALUES (${seasonId}, ${discordId}, ${driverId}, ${name || null}, ${now}, ${now}, 1)
    ON CONFLICT("seasonId","discordId") DO UPDATE SET
      "opens" = "opens" + 1, "lastAt" = ${now}, "driverId" = ${driverId}, "name" = COALESCE(${name || null}, "name")`;
}

// The member reached slide `slide` (0-based) of `slides`; only ever goes up.
export async function recordWrappedProgress(prisma, { seasonId, discordId, slide, slides }) {
  if (!seasonId || !discordId) return;
  const reached = Math.max(0, Math.min(200, Math.floor(Number(slide) || 0))) + 1;
  const total = Math.max(0, Math.min(200, Math.floor(Number(slides) || 0)));
  await prisma.$executeRaw`
    UPDATE "WrappedView" SET
      "furthest" = MAX("furthest", ${reached}),
      "slides" = MAX("slides", ${total}),
      "lastAt" = ${new Date().toISOString()}
    WHERE "seasonId" = ${seasonId} AND "discordId" = ${discordId}`;
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

// The season the admin view opens on: the one watched most lately, or else
// the newest finished season of the series that has one.
async function defaultSeasonId(prisma) {
  const last = await prisma.$queryRaw`SELECT "seasonId" FROM "WrappedView" ORDER BY "lastAt" DESC LIMIT 1`;
  if (last[0]?.seasonId) return last[0].seasonId;
  const seasons = await prisma.season.findMany({ orderBy: [{ isActive: "desc" }, { number: "desc" }], select: { id: true }, take: 12 });
  for (const s of seasons) if (await isSeasonComplete(prisma, s.id)) return s.id;
  return seasons[0]?.id || null;
}

// Every driver who raced the season, with their view (or none yet).
export async function getWrappedViews(prisma, seasonIdIn) {
  const seasonId = seasonIdIn || (await defaultSeasonId(prisma));
  const seasons = await prisma.season.findMany({
    orderBy: [{ number: "desc" }],
    select: { id: true, name: true, number: true, series: { select: { name: true } } },
  });
  if (!seasonId) return { seasonId: null, seasons, complete: false, rows: [] };
  const raced = await prisma.raceResult.findMany({
    where: { race: { seasonId }, status: { not: "DNS" } },
    select: { driverId: true },
    distinct: ["driverId"],
  });
  const drivers = await prisma.driver.findMany({
    where: { id: { in: raced.map((r) => r.driverId) } },
    select: { id: true, name: true, discordUserId: true, team: { select: { name: true, color: true, tier: true } } },
  });
  const views = await prisma.$queryRaw`SELECT * FROM "WrappedView" WHERE "seasonId" = ${seasonId}`;
  // A person's Discord account may sit on another season's row of theirs
  // (the new season's, after the carry-over): sign-in finds it there, and
  // so does this list.
  const discordOf = await discordIdsForDrivers(prisma, drivers.map((d) => d.id)).catch(() => new Map());
  const byDriver = new Map(views.map((v) => [v.driverId, v]));
  const byDiscord = new Map(views.map((v) => [v.discordId, v]));
  const rows = drivers.map((d) => {
    const discordId = discordOf.get(d.id) || d.discordUserId || null;
    const v = byDriver.get(d.id) || (discordId ? byDiscord.get(discordId) : null) || null;
    return {
      driverId: d.id,
      name: d.name,
      team: d.team ? { name: d.team.name, color: d.team.color, tier: d.team.tier } : null,
      // Without a Discord link the driver cannot sign in as themself, so
      // they can only ever watch their Wrapped as a visitor.
      linked: !!discordId,
      view: v
        ? {
            name: v.name || null,
            firstAt: iso(v.firstAt),
            lastAt: iso(v.lastAt),
            opens: Number(v.opens) || 0,
            furthest: Number(v.furthest) || 0,
            slides: Number(v.slides) || 0,
          }
        : null,
    };
  });
  rows.sort((a, b) => (b.view?.lastAt || "").localeCompare(a.view?.lastAt || "") || a.name.localeCompare(b.name));
  return { seasonId, seasons, complete: await isSeasonComplete(prisma, seasonId), rows };
}
