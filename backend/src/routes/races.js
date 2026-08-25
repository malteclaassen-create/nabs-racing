import { Router } from "express";
import prisma from "../lib/prisma.js";
import { getDriverResultPoints, getPointsForPosition, applyPenalties, DEFAULT_POINTS_TABLE } from "../services/pointsCalculator.js";
import { resolveSeasonId, getSeasonScoring, getPrivateSeasonIds } from "../services/seasonService.js";
import { isAdminRequest } from "../middleware/auth.js";
import { getNameOverrides, getIdentityOverrides } from "../lib/persons.js";
import { readDriverRoles } from "../lib/driverRoles.js";
import { telemetryForRace } from "../lib/telemetryRead.js";
import { readManualFastestLaps } from "../lib/raceHonours.js";
import { readRaceFormat } from "../lib/raceFormat.js";
import { readParentIds, readSprintChildren } from "../lib/sprintRaces.js";
import { readRaceHighlights } from "../lib/raceHighlights.js";
import { readRaceHeroes } from "../lib/raceHero.js";
import { readRaceTypes } from "../lib/raceTypes.js";
import { dbReplaysByRace } from "../lib/downloads.js";
import { readRaceCountries, staticCountryFor } from "../lib/raceCountries.js";
import { readRacePhotos, readPhotoCounts, withUrls } from "../lib/racePhotos.js";
import { findArchiveFor, lapChartFrom, hasArchiveFor } from "../lib/cockpitArchive.js";
import { resultTeamId } from "../lib/resultTeam.js";

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
    res.json(
      races.map((r) => ({
        id: r.id,
        number: r.number,
        track: r.track,
        country: countries.get(r.id) || staticCountryFor(r.track),
        date: r.date,
        isCompleted: r.isCompleted,
        isSpecialEvent: r.isSpecialEvent,
        type: types.get(r.id) || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP"),
        resultCount: r._count.results,
        hasQuali: withQuali.has(r.id),
        info: r.info || null,
        qualiMinutes: format.get(r.id)?.qualiMinutes ?? null,
        raceLaps: format.get(r.id)?.raceLaps ?? null,
        raceFormat: format.get(r.id)?.raceFormat ?? "SINGLE",
        sprintLaps: format.get(r.id)?.sprintLaps ?? null,
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
      include: { season: { select: { number: true } } },
    });
    if (!race) return res.status(404).json({ error: "Race not found" });
    if (race.seasonId && !isAdminRequest(req) && (await getPrivateSeasonIds(prisma)).has(race.seasonId)) {
      return res.status(404).json({ error: "Race not found" });
    }

    const json = findArchiveFor(race.season?.number, race.number);
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
      include: { season: { select: { number: true } } },
    });
    if (!race) return res.status(404).json({ error: "Race not found" });
    // A race in a private (unpublished) season is 404 to the public.
    if (race.seasonId && !isAdminRequest(req) && (await getPrivateSeasonIds(prisma)).has(race.seasonId)) {
      return res.status(404).json({ error: "Race not found" });
    }

    const [results, drivers, teams, scoring, nameOverrides, identity, telemetry] = await Promise.all([
      prisma.raceResult.findMany({
        where: { raceId: race.id },
        include: { driver: { include: { team: true } }, subForTeam: true },
      }),
      prisma.driver.findMany({ where: { seasonId: race.seasonId } }),
      prisma.team.findMany({ where: { seasonId: race.seasonId } }),
      getSeasonScoring(prisma, race.seasonId),
      getNameOverrides(prisma),
      getIdentityOverrides(prisma),
      telemetryForRace(prisma, race.id),
    ]);
    const table = scoring.pointsTable || DEFAULT_POINTS_TABLE;

    // Qualifying best laps (raw-SQL column): set by a quali import or by an
    // admin-recorded pole lap (Race honours). Rides on each result row so the
    // race facts and the honours editor can show the pole time.
    const qualiTimes = new Map();
    try {
      const qt = await prisma.$queryRawUnsafe(
        `SELECT "driverId", "qualiTimeMs" FROM "RaceResult" WHERE "raceId" = ? AND "qualiTimeMs" IS NOT NULL`,
        race.id
      );
      for (const r of qt) qualiTimes.set(r.driverId, Number(r.qualiTimeMs));
    } catch {
      /* column missing pre-migration */
    }

    const teamById = new Map(teams.map((t) => [t.id, t]));

    // Special league roles ('safety'), so a classification marks the league's
    // safety car drivers the same way their profile and the live board do. The
    // role sits on the SEASON row, so a round shows who held it that season.
    const roles = await readDriverRoles(prisma, [
      ...results.map((r) => r.driverId),
      ...drivers.map((d) => d.id),
    ]);

    // Apply position penalties so the displayed order, points and the Tier-2
    // re-rank all use each car's final (post-penalty) position. `rawById` keeps
    // the original finishing position so the UI can show "P2 → P5".
    const applied = applyPenalties(results);
    const rawById = new Map(results.map((r) => [r.driverId, r.position]));
    // The points column as STORED in the DB (explicit official points, or null
    // when they derive from the position). The admin editor round-trips this
    // raw value — sending back the computed display points would freeze
    // derived points into fake "official" ones.
    const rawPointsById = new Map(results.map((r) => [r.driverId, r.points]));

    // Build T2 re-rank lookup for races that have positions (e.g. R9).
    const hasPositions = applied.some((r) => r.position != null);
    const t2ReRank = {};
    if (hasPositions) {
      const driverById = new Map(drivers.map((d) => [d.id, d]));
      const effTeam = (r) => teamById.get(resultTeamId(r, driverById));
      // Only Tier-2-team results are classified; Tier-1 drivers and team-less
      // reserves are excluded entirely (they don't occupy a slot).
      // FINISHED only, matching the scoring: a DNF/DSQ holds no slot in the
      // re-rank, so this display always mirrors what the teams actually score.
      const remaining = applied
        .filter((r) => r.status === "FINISHED" && r.position != null && effTeam(r)?.tier === 2)
        .sort((a, b) => a.position - b.position);
      remaining.forEach((r, i) => {
        const rank = i + 1;
        const team = effTeam(r);
        t2ReRank[r.driverId] = {
          rank,
          points: getPointsForPosition(rank, table),
          scoresForTeam: team.id,
        };
      });
    }

    const rows = applied
      .map((r) => {
        // The team of THIS drive, not of this driver today: a round stamped its
        // team when it was saved, so a later move to another team leaves the
        // round where it happened (lib/resultTeam.js).
        const ownTeam = teamById.get(r.teamId) || r.driver.team;
        const effectiveTeam = r.subForTeam ? teamById.get(r.subForTeam.id) : ownTeam;
        const ov = nameOverrides.get(r.driverId);
        // AC telemetry read via raw SQL (columns may not be in the generated
        // client yet) — feeds race facts + profiles. null when not imported.
        const tel = telemetry.get(r.driverId) || {};
        return {
          driverId: r.driverId,
          name: ov?.displayName || r.driver.name,
          formerName: ov?.formerName || null,
          discordName: r.driver.discordName,
          // Linked-person fallback (same rule as the standings): an archive row
          // without its own flag shows the person's current one.
          country: r.driver.country || identity.get(r.driverId)?.country || null,
          role: roles.get(r.driverId) || null,
          driverTier: r.driver.tier,
          position: r.position,
          rawPosition: rawById.get(r.driverId) ?? null,
          status: r.status,
          points: getDriverResultPoints(r, table),
          storedPoints: rawPointsById.get(r.driverId) ?? null,
          penaltySeconds: r.penaltySeconds,
          grid: r.grid,
          bestLapMs: r.bestLapMs,
          qualiTimeMs: qualiTimes.get(r.driverId) ?? null,
          totalTimeMs: r.totalTimeMs,
          contacts: tel.contacts ?? null,
          envContacts: tel.envContacts ?? null,
          cuts: tel.cuts ?? null,
          overtakes: tel.overtakes ?? null,
          lapsLed: tel.lapsLed ?? null,
          laps: tel.laps ?? null,
          cleanLaps: tel.cleanLaps ?? null,
          consistencyMs: tel.consistencyMs ?? null,
          consistencyPct: tel.consistencyPct ?? null,
          stints: tel.stints ?? null,
          gamePenalties: tel.gamePenalties ?? null,
          gamePenaltySeconds: tel.gamePenaltySeconds ?? null,
          team: {
            id: ownTeam.id,
            name: ownTeam.name,
            color: ownTeam.color,
            tier: ownTeam.tier,
            logoUrl: ownTeam.logoUrl,
          },
          isSub: !!r.subForTeamId,
          subForTeam: r.subForTeam
            ? { id: r.subForTeam.id, name: r.subForTeam.name, color: r.subForTeam.color, logoUrl: r.subForTeam.logoUrl }
            : null,
          effectiveTeam: effectiveTeam
            ? { id: effectiveTeam.id, name: effectiveTeam.name, color: effectiveTeam.color, tier: effectiveTeam.tier, logoUrl: effectiveTeam.logoUrl }
            : null,
          t2: t2ReRank[r.driverId] || null,
        };
      })
      .sort((a, b) => {
        // classified finishers first (by position), then the non-finishers —
        // like the official result posts (DNF/DNS/DSQ listed at the bottom).
        const af = a.status === "FINISHED" && a.position != null;
        const bf = b.status === "FINISHED" && b.position != null;
        if (af && bf) return a.position - b.position;
        if (af !== bf) return af ? -1 : 1;
        // Neither has a position. That is the normal shape of an archived round
        // scored from the official sheet, where only points were recorded — and
        // the old tie-break compared 999 with 999, so every row was "equal" and
        // the table came out in whatever order the database returned, with the
        // round winner somewhere in the middle. Points are the only ranking
        // those rows carry, so rank by them, highest first.
        const ap = a.points ?? 0;
        const bp = b.points ?? 0;
        if (ap !== bp) return bp - ap;
        return (a.position ?? 999) - (b.position ?? 999);
      });

    // Driver of the Day (admin pick + who made the call) — columns may not be
    // in the generated client.
    let driverOfTheDay = null;
    try {
      const dr = await prisma.$queryRawUnsafe(
        `SELECT "driverOfTheDayId", "driverOfTheDayBy" FROM "Race" WHERE "id" = ?`,
        race.id
      );
      const dotdId = dr[0]?.driverOfTheDayId || null;
      if (dotdId) {
        const row = rows.find((r) => r.driverId === dotdId);
        driverOfTheDay = { driverId: dotdId, name: row?.name || null, pickedBy: dr[0]?.driverOfTheDayBy || null };
      }
    } catch {
      /* column missing pre-migration */
    }

    // Qualifying classification (raw-SQL blob, see ensureAppSchema): enriched
    // at read time with the roster's current name/team/country so renames and
    // person links stay honoured. Entrants without a roster match render under
    // their AC name, team-less. null = no quali imported for this race.
    let quali = null;
    try {
      const qr = await prisma.$queryRawUnsafe(`SELECT "qualiJson" FROM "Race" WHERE "id" = ?`, race.id);
      if (qr[0]?.qualiJson) {
        const blob = JSON.parse(qr[0].qualiJson);
        const driverById = new Map(drivers.map((d) => [d.id, d]));
        const pole = (blob.entries || []).find((e) => e.bestLapMs != null)?.bestLapMs ?? null;
        quali = (blob.entries || []).map((e) => {
          const d = e.driverId ? driverById.get(e.driverId) : null;
          const ov = e.driverId ? nameOverrides.get(e.driverId) : null;
          const team = d ? teamById.get(d.teamId) : null;
          return {
            position: e.position,
            driverId: d ? e.driverId : null,
            name: ov?.displayName || d?.name || e.name || e.acDriverName,
            country: d ? d.country || identity.get(d.id)?.country || null : null,
            role: d ? roles.get(d.id) || null : null,
            bestLapMs: e.bestLapMs ?? null,
            // Sector times of the best lap ([s1,s2,s3] ms) — imports before
            // this feature simply have none and the columns hide.
            sectors: Array.isArray(e.sectors) && e.sectors.length === 3 ? e.sectors : null,
            gapMs: e.bestLapMs != null && pole != null && e.bestLapMs > pole ? e.bestLapMs - pole : null,
            carModel: e.carModel ?? null,
            team: team
              ? { id: team.id, name: team.name, color: team.color, tier: team.tier, logoUrl: team.logoUrl }
              : null,
          };
        });
      }
    } catch {
      /* column missing pre-migration */
    }

    // Session format + details, so the admin race editor can round-trip them,
    // plus the round's published replay (if any) for the Replay button.
    const format = (await readRaceFormat(prisma, [race.id])).get(race.id) || {};
    const replays = await dbReplaysByRace(prisma, [race.id]);
    // The round's photo gallery. It travels with the round rather than on its
    // own endpoint so the page opens complete, the same way the replay link and
    // the session format already do.
    const photos = withUrls(await readRacePhotos(prisma, race.id));
    res.json({
      photos,
      race: {
        id: race.id,
        number: race.number,
        track: race.track,
        country: (await readRaceCountries(prisma, [race.id])).get(race.id) || staticCountryFor(race.track),
        date: race.date,
        isCompleted: race.isCompleted,
        info: race.info || null,
        qualiMinutes: format.qualiMinutes ?? null,
        raceLaps: format.raceLaps ?? null,
        raceFormat: format.raceFormat ?? "SINGLE",
        sprintLaps: format.sprintLaps ?? null,
        // Both directions of the sprint link: an event says where its sprint
        // classification lives (the Races page adds a Sprint tab and fetches
        // it through this same endpoint), a sprint row says whose it is.
        sprintRaceId: (await readSprintChildren(prisma, [race.id])).get(race.id) ?? null,
        sprintOf: (await readParentIds(prisma, [race.id])).get(race.id) ?? null,
        replayDownloadId: replays.get(race.id) || null,
        // The round's highlights video, if the admin pasted one.
        highlightsUrl: (await readRaceHighlights(prisma, [race.id])).get(race.id) || null,
        hasPositions,
        // Whether this round has an archived raw result file, and therefore a
        // lap-by-lap view to switch the classification over to. A directory
        // listing, not a parse (lib/cockpitArchive.js) — the chart itself is
        // fetched only if somebody asks for it.
        hasLapChart: hasArchiveFor(race.season?.number, race.number),
        // Championship round, training session or special event. The list
        // endpoint has always sent this; the detail one did not, so the results
        // table had no way to tell them apart and showed a points column for
        // sessions that score nothing.
        isSpecialEvent: race.isSpecialEvent,
        type: (await readRaceTypes(prisma, [race.id])).get(race.id) || (race.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP"),
        driverOfTheDay,
        // Admin-recorded fastest-lap holder (archive rounds, lib/raceHonours.js).
        // When set, the race page marks THIS driver instead of deriving the
        // holder from the stored lap times. null = derive as always.
        fastestLapDriverId: (await readManualFastestLaps(prisma, [race.id])).get(race.id) || null,
      },
      results: rows,
      quali,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
