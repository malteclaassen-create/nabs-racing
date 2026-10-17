import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAdminRequest } from "../middleware/auth.js";
import { dbListSeries, seasonIdsOfSeries } from "../lib/series.js";

const router = Router();

// GET /api/series -> visible series in switcher order, for the NavBar series
// switcher and the SeriesProvider. Private (unpublished) series are hidden
// from the public; a signed-in admin sees them all (with isPublic) so the
// admin can build up a new series quietly and preview it on the real site.
// When a special event happens, for the switcher line under its name: the
// first race of the series that is still to come, else the last one it had
// (an event that is over still shows when it was). null while no race has a
// date yet.
export function eventDateOf(races, now = Date.now()) {
  const dated = races.filter((r) => r.date).map((r) => ({ ...r, t: new Date(r.date).getTime() }));
  // A race counts as still to come until it is marked done, or a day has gone.
  const upcoming = dated.filter((r) => !r.isCompleted && r.t > now - 24 * 3600e3).sort((a, b) => a.t - b.t);
  if (upcoming.length) return new Date(upcoming[0].t).toISOString();
  const past = dated.sort((a, b) => b.t - a.t);
  return past.length ? new Date(past[0].t).toISOString() : null;
}

async function eventDate(seriesId) {
  const seasons = await seasonIdsOfSeries(prisma, seriesId);
  if (!seasons.length) return null;
  const races = await prisma.race.findMany({
    where: { seasonId: { in: seasons.map((s) => s.id) } },
    select: { date: true, isCompleted: true },
  });
  return eventDateOf(races);
}

router.get("/", async (req, res, next) => {
  try {
    const series = await dbListSeries(prisma, { includePrivate: isAdminRequest(req) });
    const eventAt = new Map(
      await Promise.all(series.filter((s) => s.kind === "event").map(async (s) => [s.id, await eventDate(s.id)]))
    );
    res.json(
      series.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        game: s.game,
        description: s.description,
        order: s.order,
        isActive: s.isActive,
        isPublic: s.isPublic,
        accentColor: s.accentColor,
        logoDarkUrl: s.logoDarkUrl,
        kind: s.kind,
        eventAt: eventAt.get(s.id) ?? null,
      }))
    );
  } catch (e) {
    next(e);
  }
});

export default router;
