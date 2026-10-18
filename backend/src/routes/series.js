import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAdminRequest } from "../middleware/auth.js";
import { dbListSeries, resolveSeries, seasonIdsOfSeries } from "../lib/series.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { readRaceFormat } from "../lib/raceFormat.js";

const router = Router();

// The race a special event is about: the first one still to come, else the
// last one it had (an event that is over still shows when it was). A race
// counts as still to come until it is marked done, or a day has gone. null
// while no race has a date yet.
export function eventRaceOf(races, now = Date.now()) {
  const dated = races.filter((r) => r.date).map((r) => ({ r, t: new Date(r.date).getTime() }));
  const upcoming = dated.filter((x) => !x.r.isCompleted && x.t > now - 24 * 3600e3).sort((a, b) => a.t - b.t);
  if (upcoming.length) return upcoming[0].r;
  const past = dated.sort((a, b) => b.t - a.t);
  return past.length ? past[0].r : null;
}

// When a special event happens, for the switcher line under its name.
export function eventDateOf(races, now = Date.now()) {
  const race = eventRaceOf(races, now);
  return race ? new Date(race.date).toISOString() : null;
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

// GET /api/series -> visible series in switcher order, for the NavBar series
// switcher and the SeriesProvider. Private (unpublished) series are hidden
// from the public; a signed-in admin sees them all (with isPublic) so the
// admin can build up a new series quietly and preview it on the real site.
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
        // Promo film for the series' main card, and the admin's "show the
        // promo page" switch (the time it was switched on, else null).
        promoVideoUrl: s.promoVideoUrl,
        promoLoopUrl: s.promoLoopUrl,
        promoAt: s.promoAt,
      }))
    );
  } catch (e) {
    next(e);
  }
});

// GET /api/series/:slug/promo -> everything the promo page of a special event
// shows: the series (name, tagline, colour, film), its race (track, date,
// laps, qualifying, grid) and the pictures to fall back on without a film.
// Same visibility as the series itself: a private one is a 404 for the public,
// and so is the race while its season is still private.
router.get("/:slug/promo", async (req, res, next) => {
  try {
    const admin = isAdminRequest(req);
    const series = await resolveSeries(prisma, req.params.slug, { includePrivate: admin });
    if (!series || series.slug !== req.params.slug) return res.status(404).json({ error: "Series not found" });
    const [seasonRefs, priv] = await Promise.all([seasonIdsOfSeries(prisma, series.id), getPrivateSeasonIds(prisma)]);
    const visible = seasonRefs.filter((s) => admin || !priv.has(s.id)).map((s) => s.id);
    const races = visible.length
      ? await prisma.race.findMany({
          where: { seasonId: { in: visible }, isSpecialEvent: false },
          include: { season: { select: { id: true, name: true, game: true } } },
        })
      : [];
    const race = eventRaceOf(races);
    const format = race ? (await readRaceFormat(prisma, [race.id])).get(race.id) || {} : {};
    // The season's own pictures (raw columns), for the page's backdrop when
    // there is no film, and its poster frame when there is.
    let pictures = {};
    if (race) {
      const rows = await prisma
        .$queryRawUnsafe(`SELECT "heroImageUrl", "carImageUrl" FROM "Season" WHERE "id" = ?`, race.seasonId)
        .catch(() => []);
      pictures = rows[0] || {};
    }
    res.json({
      series: {
        id: series.id,
        name: series.name,
        slug: series.slug,
        kind: series.kind,
        game: series.game,
        description: series.description,
        accentColor: series.accentColor,
        logoDarkUrl: series.logoDarkUrl,
        promoVideoUrl: series.promoVideoUrl,
        promoAt: series.promoAt,
        isPublic: series.isPublic,
      },
      race: race && {
        id: race.id,
        track: race.track,
        country: race.country,
        date: race.date,
        isCompleted: race.isCompleted,
        capacity: race.capacity,
        info: race.info,
        seasonName: race.season?.name || null,
        game: race.season?.game || series.game || null,
        raceLaps: format.raceLaps ?? null,
        qualiMinutes: format.qualiMinutes ?? null,
        raceFormat: format.raceFormat ?? "SINGLE",
        sprintLaps: format.sprintLaps ?? null,
      },
      heroImageUrl: pictures.heroImageUrl || null,
      carImageUrl: pictures.carImageUrl || null,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
