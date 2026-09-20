import { Router } from "express";
import prisma from "../lib/prisma.js";
import { applyPenalties } from "../services/pointsCalculator.js";
import { resolveSeasonId, resolveSeason, getPrivateSeasonIds } from "../services/seasonService.js";
import { getSeriesById } from "../lib/series.js";
import { buildRaceCalendar } from "../lib/ics.js";
import { isAdminRequest } from "../middleware/auth.js";
import { getNameOverrides, getIdentityOverrides } from "../lib/persons.js";
import { readRaceFormat } from "../lib/raceFormat.js";
import { readParentIds, readSprintChildren } from "../lib/sprintRaces.js";
import { readRaceHighlights } from "../lib/raceHighlights.js";
import { readRaceHeroes } from "../lib/raceHero.js";
import { readRaceTypes } from "../lib/raceTypes.js";
import { dbReplaysByRace } from "../lib/downloads.js";
import { readRaceCountries, staticCountryFor } from "../lib/raceCountries.js";
import { readPhotoCounts } from "../lib/racePhotos.js";
import { findArchiveForRace, lapChartFrom } from "../lib/cockpitArchive.js";
import { raceDetailPayload } from "../services/raceDetailService.js";

const router = Router();

// Winner (P1 after penalties/DSQ) of each completed race, for the calendar
// cards. Uses the exact same derived-results path as the results endpoint
// (applyPenalties -> contiguous reclassification), so steward decisions are
// respected. Historical points-only rounds (no recorded positions) fall back
// to the highest-scoring finisher.
async function raceWinners(races) {
  const ids = races.filter((r) => r.isCompleted).map((r) => r.id);
  if (!ids.length) return new Map();
  const [results, nameOverrides, identity] = await Promise.all([
    prisma.raceResult.findMany({
      where: { raceId: { in: ids } },
      include: { driver: { include: { team: true } }, subForTeam: true },
    }),
    getNameOverrides(prisma),
    getIdentityOverrides(prisma),
  ]);
  const byRace = new Map();
  for (const r of results) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId).push(r);
  }
  // The team each result was stamped with when it was saved, which is what the
  // winner should be shown in even if they have since moved elsewhere. Only the
  // teams actually named here, so this stays a small lookup on a big calendar.
  const stampedIds = [...new Set(results.map((r) => r.teamId).filter(Boolean))];
  const teamById = new Map(
    stampedIds.length
      ? (await prisma.team.findMany({ where: { id: { in: stampedIds } } })).map((t) => [t.id, t])
      : []
  );
  const winners = new Map();
  for (const [raceId, rows] of byRace) {
    const applied = applyPenalties(rows);
    const finished = applied.filter((r) => r.status === "FINISHED");
    let win = finished.find((r) => r.position === 1);
    if (!win && finished.length && applied.every((r) => r.position == null)) {
      // points-only archive round: best stored points wins
      win = [...finished].sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0];
      if ((win?.points ?? 0) <= 0) win = null;
    }
    if (!win) continue;
    const team = win.subForTeam || teamById.get(win.teamId) || win.driver.team;
    const ov = nameOverrides.get(win.driverId);
    winners.set(raceId, {
      driverId: win.driverId,
      name: ov?.displayName || win.driver.name,
      // Linked-person fallback: an archive winner without a photo of their own
      // shows the person's current one (same rule as the standings).
      photoUrl: win.driver.photoUrl || win.driver.discordAvatar || identity.get(win.driverId)?.photoUrl || null,
      team: team ? { id: team.id, name: team.name, color: team.color, logoUrl: team.logoUrl } : null,
    });
  }
  return winners;
}

// Which of these races already carry a qualifying classification. The import
// page asks so it can tell a round that still needs its quali from one that is
// complete, instead of the admin opening each round to find out.
// Raw SQL because qualiJson is an ensureAppSchema column (see raceHighlights).
async function racesWithQuali(raceIds) {
  const ids = [...new Set((raceIds || []).filter(Boolean))];
  const out = new Set();
  if (!ids.length) return out;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Race" WHERE "qualiJson" IS NOT NULL AND "id" IN (${ids.map(() => "?").join(",")})`,
      ...ids
    );
    for (const r of rows) out.add(r.id);
  } catch {
    /* column missing pre-migration */
  }
  return out;
}

// GET /api/races -> list of all races in the selected (default: active) season.
// An admin may target a private season (site preview); the public can't.
router.get("/", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, {
      includePrivate: isAdminRequest(req),
      series: req.query.series,
    });
    const allRaces = await prisma.race.findMany({
      where: { seasonId },
      orderBy: { number: "asc" },
      include: { _count: { select: { results: true } } },
    });
    // Sprint classifications are attached to their event, not to the calendar:
    // by default the list hides them (Home, Races, every admin calendar), and
    // ?includeSprints=1 (the results editor) gets them back, labelled by the
    // sprintOf link so the picker can say whose sprint each one is.
    const parentOf = await readParentIds(prisma, allRaces.map((r) => r.id));
    const includeSprints = req.query.includeSprints === "1" || req.query.includeSprints === "true";
    const races = includeSprints ? allRaces : allRaces.filter((r) => !parentOf.has(r.id));
    const sprintChildren = await readSprintChildren(prisma, races.map((r) => r.id));
    // Session format + race type (raw-SQL columns) for the upcoming-race panel
    // and the calendar's grouping, and any published replay downloads so the
    // calendar can offer a Replay button.
    const [format, types, replays, winners, countries, photoCounts, highlights, withQuali, heroes] = await Promise.all([
      readRaceFormat(prisma, races.map((r) => r.id)),
      readRaceTypes(prisma, races.map((r) => r.id)),
      dbReplaysByRace(prisma, races.map((r) => r.id)),
      raceWinners(races),
      readRaceCountries(prisma, races.map((r) => r.id)),
      // How many gallery photos each round has, so the calendar can mark the
      // ones worth opening without loading a single image.
      readPhotoCounts(prisma, races.map((r) => r.id)),
      // Which rounds have a highlights cut, so the admin's round picker can say
      // so on arrival instead of one round at a time as they are opened.
      readRaceHighlights(prisma, races.map((r) => r.id)),
      racesWithQuali(races.map((r) => r.id)),
      // The per-round main-card photo, so the Home hero can wear the picture of
      // the round it is actually about (lib/raceHero.js).
      readRaceHeroes(prisma, races.map((r) => r.id)),
    ]);
    // Whether a classification pays championship points: a championship round
    // does, and so does the SPRINT of one — the child row is typed SPECIAL so
    // nothing counts it as a round of its own, but it scores under its event's
    // round (lib/sprintRaces.js). The results tables show the points column by
    // this rather than by the type.
    const allById = new Map(allRaces.map((r) => [r.id, r]));
    const kindOf = (id) => types.get(id) || (allById.get(id)?.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
    const scoresOf = (r) =>
      kindOf(r.id) === "CHAMPIONSHIP" || (parentOf.has(r.id) && kindOf(parentOf.get(r.id)) === "CHAMPIONSHIP");
    res.json(
      races.map((r) => ({
        id: r.id,
        number: r.number,
        track: r.track,
        country: countries.get(r.id) || staticCountryFor(r.track),
        date: r.date,
        isCompleted: r.isCompleted,
        isSpecialEvent: r.isSpecialEvent,
        type: kindOf(r.id),
        scores: scoresOf(r),
        resultCount: r._count.results,
        hasQuali: withQuali.has(r.id),
        info: r.info || null,
        qualiMinutes: format.get(r.id)?.qualiMinutes ?? null,
        raceLaps: format.get(r.id)?.raceLaps ?? null,
        raceFormat: format.get(r.id)?.raceFormat ?? "SINGLE",
        sprintLaps: format.get(r.id)?.sprintLaps ?? null,
        // The round's own points table (array) or null = the season's.
        pointsTable: format.get(r.id)?.pointsTable ?? null,
        // The event this row is the sprint classification of (only with
        // includeSprints), and the sprint child hanging off this event (so the
        // import page knows a sprint result is already in).
        sprintOf: parentOf.get(r.id) ?? null,
        sprintRaceId: sprintChildren.get(r.id) ?? null,
        replayDownloadId: replays.get(r.id) || null,
        highlightsUrl: highlights.get(r.id) || null,
        heroImageUrl: heroes.get(r.id) || null,
        photoCount: photoCounts.get(r.id) || 0,
        winner: winners.get(r.id) || null,
      }))
    );
  } catch (e) {
    next(e);
  }
});

// GET /api/races/calendar.ics -> the season's rounds as a calendar feed.
//
// Meant to be SUBSCRIBED to, not downloaded once: a calendar app re-reads this
// URL on its own schedule, so a round that moves or gains a date reaches every
// subscriber without anyone lifting a finger (lib/ics.js explains what that
// costs the format). Which is also why this endpoint stays deliberately cheap:
// it is polled by machines, forever. One race query plus the two raw-SQL side
// tables the format needs, and nothing that touches a results table.
//
// Registered ahead of the /:id/… routes below. They are two segments deep so
// there is no real ambiguity, but a single-segment sibling is the kind of thing
// a later /:id route would quietly swallow.
router.get("/calendar.ics", async (req, res, next) => {
  try {
    // Private seasons never leave the building through here. Unlike the JSON
    // endpoints there is no admin case to make: a calendar URL is pasted into
    // Google or Apple and fetched by THEIR servers, with no session of ours
    // attached, so an admin-only feed could not work even if we wanted one.
    const season = await resolveSeason(prisma, req.query.season, { series: req.query.series });
    if (!season) return res.status(404).type("text/plain").send("No such season");

    const allRaces = await prisma.race.findMany({
      where: { seasonId: season.id },
      orderBy: { number: "asc" },
      select: { id: true, number: true, track: true, date: true, isCompleted: true, isSpecialEvent: true, info: true },
    });
    // A sprint weekend stores its sprint as a hidden CHILD row of the event
    // (lib/sprintRaces.js), sharing the event's date. Both halves run on the
    // one evening, so letting the child through would put the same night in
    // everybody's calendar twice. Same filter the list endpoint applies, and
    // for the same reason.
    const parentOf = await readParentIds(prisma, allRaces.map((r) => r.id));
    const races = allRaces.filter((r) => !parentOf.has(r.id));
    const ids = races.map((r) => r.id);
    const [format, types, seriesRow] = await Promise.all([
      readRaceFormat(prisma, ids),
      readRaceTypes(prisma, ids),
      season.seriesId ? getSeriesById(prisma, season.seriesId).catch(() => null) : null,
    ]);

    const origin = `${req.protocol}://${req.get("host")}`;
    const prefix = seriesRow?.slug ? `/s/${seriesRow.slug}` : "";
    const seasonLabel = season.name || `Season ${season.number}`;

    const body = buildRaceCalendar(
      races.map((r) => ({
        id: r.id,
        number: r.number,
        track: r.track,
        date: r.date,
        isCompleted: r.isCompleted,
        info: r.info,
        // Already filtered above; passed through so lib/ics.js can refuse a
        // sprint child on its own too.
        parentRaceId: parentOf.get(r.id) ?? null,
        type: types.get(r.id) || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP"),
        qualiMinutes: format.get(r.id)?.qualiMinutes ?? null,
        raceLaps: format.get(r.id)?.raceLaps ?? null,
      })),
      {
        origin,
        calName: seriesRow?.name ? `${seriesRow.name} · ${seasonLabel}` : `NABS Racing · ${seasonLabel}`,
        calDesc: `Race calendar for ${seasonLabel}.`,
        // Deep link to the round on the calendar page, the same shape the
        // notification bell uses.
        linkFor: (race) => `${prefix}/races?season=${season.number}&race=${race.id}`,
      }
    );

    res.type("text/calendar; charset=utf-8");
    // Named so a browser download lands as something recognisable, `inline` so
    // a calendar app fetching it is not pushed into a save dialog.
    res.setHeader("Content-Disposition", 'inline; filename="nabs-races.ics"');
    // Half an hour is short enough that a date entered this evening reaches
    // subscribers before the race, and long enough that the pollers do not
    // become traffic. REFRESH-INTERVAL inside the file asks for 12 hours; this
    // is the floor under whatever the client actually decides to do.
    res.setHeader("Cache-Control", "public, max-age=1800");
    res.send(body);
  } catch (e) {
    next(e);
  }
});

// GET /api/races/:id/laps -> the running order lap by lap, whole field.
//
// Feeds the "Lap by lap" view of a round's classification: one line per car,
// position on the y-axis, laps along the x. The numbers come from the archived
// raw result file (lib/cockpitArchive.js), which is also where the Cockpit's
// per-driver race analysis reads from — so a round has this view exactly when
// it has that one, and answers { available: false } when the file was never
// archived. The page then simply doesn't offer the switch.
//
// League identity (team colour, profile link, current display name) is matched
// on by the driver's captured SteamID, falling back to an exact name match in
// the file — the same two steps, in the same order, as the Cockpit's analysis.
router.get("/:id/laps", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({
      where: { id: req.params.id },
      include: { season: { select: { id: true, number: true } } },
    });
    if (!race) return res.status(404).json({ error: "Race not found" });
    if (race.seasonId && !isAdminRequest(req) && (await getPrivateSeasonIds(prisma)).has(race.seasonId)) {
      return res.status(404).json({ error: "Race not found" });
    }

    // A file that is not from this race night is not this race's chart
    // (findArchiveForRace checks the date).
    const json = findArchiveForRace(race);
    const chart = json ? lapChartFrom(json) : null;
    if (!chart) return res.json({ available: false, maxLap: 0, drivers: [] });

    const [drivers, overrides] = await Promise.all([
      prisma.driver.findMany({
        where: { seasonId: race.seasonId },
        include: { team: { select: { color: true, name: true } } },
      }),
      getNameOverrides(prisma),
    ]);
    const bySteam = new Map();
    for (const d of drivers) if (d.steamId) bySteam.set(String(d.steamId), d);
    const byName = new Map(drivers.map((d) => [d.name.trim().toLowerCase(), d]));

    res.json({
      available: true,
      maxLap: chart.maxLap,
      drivers: chart.drivers.map((c) => {
        const d = bySteam.get(c.guid) || (c.name ? byName.get(c.name.trim().toLowerCase()) : null) || null;
        return {
          driverId: d?.id ?? null,
          // The league's own display name wins over the one the game recorded:
          // a driver who changed their in-game handle mid-season should not
          // read as two different people between the table and the chart.
          name: (d && (overrides.get(d.id)?.displayName || d.name)) || c.name || "?",
          color: d?.team?.color || null,
          points: c.points,
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/races/:id/results -> full results of one race
router.get("/:id/results", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({
      where: { id: req.params.id },
      include: { season: { select: { id: true, number: true } } },
    });
    if (!race) return res.status(404).json({ error: "Race not found" });
    // A race in a private (unpublished) season is 404 to the public.
    if (race.seasonId && !isAdminRequest(req) && (await getPrivateSeasonIds(prisma)).has(race.seasonId)) {
      return res.status(404).json({ error: "Race not found" });
    }

    res.json(await raceDetailPayload(prisma, race));
  } catch (e) {
    next(e);
  }
});

export default router;
