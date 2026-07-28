// ---------------------------------------------------------------------------
// Track history: aggregates every completed round run at the same circuit across
// ALL seasons into a "track record" (most wins here, overall fastest race lap,
// most poles, most crashes, most cuts) plus a per-season edition list and, for a
// logged-in member, their own history at the track. Powers the upcoming-race
// panel and the /attendance page. Private (unpublished) seasons are excluded for
// non-admins. Persons are merged so a driver reads under their current name.
// ---------------------------------------------------------------------------
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser, isAdminRequest, resolveDriverId } from "../middleware/auth.js";
import { groupKeyFor, trackKeyFor, displayNameFor } from "../lib/trackKeys.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { resolveSeries, seasonSeriesMap } from "../lib/series.js";
import { getPersonGroups, getNameOverrides, getLinkedDriverIds } from "../lib/persons.js";
import { telemetryForRaces } from "../lib/telemetryRead.js";
import { readTrackInfo, readHotlapFallback, videosWithFallback } from "../lib/trackInfo.js";
import { readTrackCountries, staticCountryFor } from "../lib/raceCountries.js";

const router = Router();

// GET /api/tracks/countries -> { <trackKey>: "gb", ... } — every admin-stored
// track country. The frontend loads this once and layers it over its static
// circuit table, so edited/unknown-circuit flags show site-wide.
router.get("/countries", async (_req, res, next) => {
  try {
    res.json(await readTrackCountries(prisma));
  } catch (e) {
    next(e);
  }
});

const MAX_LAP_MS = 1_800_000;
const isLap = (ms) => ms != null && ms > 0 && ms <= MAX_LAP_MS;

// GET /api/tracks/history?track=<name>
router.get("/history", optionalUser, async (req, res, next) => {
  try {
    const track = req.query.track;
    if (!track) return res.status(400).json({ error: "track required" });
    const key = trackKeyFor(track);
    const groupKey = groupKeyFor(track);
    const isAdmin = isAdminRequest(req);

    // Work out the visible scope FIRST, so the race query can be narrowed in SQL.
    // This used to pull every completed race of every series and season on each
    // call and throw most of them away in JS afterwards.
    const [priv, series, bySeries] = await Promise.all([
      getPrivateSeasonIds(prisma),
      // Track records are per SERIES (GT laps must not enter the F1 record
      // book). ?series=<slug>; default = the active (primary) series.
      resolveSeries(prisma, req.query.series, { includePrivate: isAdmin }),
      seasonSeriesMap(prisma),
    ]);

    // Seasons this request is allowed to see. null means "can't narrow" (no
    // series resolved, or the season->series map is empty) — then we fall back
    // to the old behaviour of scanning everything, exactly as before.
    let allowedSeasonIds = null;
    if (series && bySeries.size) {
      allowedSeasonIds = [...bySeries.entries()]
        .filter(([seasonId, seriesId]) => seriesId === series.id && (isAdmin || !priv.has(seasonId)))
        .map(([seasonId]) => seasonId);
    }
    const raceWhere = { isCompleted: true, isSpecialEvent: false };
    if (allowedSeasonIds) raceWhere.seasonId = { in: allowedSeasonIds };

    const [races, groups, nameOverrides, info, fallback] = await Promise.all([
      prisma.race.findMany({
        where: raceWhere,
        // Only the fields this endpoint actually reads.
        select: {
          id: true,
          track: true,
          seasonId: true,
          number: true,
          date: true,
          season: { select: { id: true, number: true, name: true } },
        },
      }),
      getPersonGroups(prisma),
      getNameOverrides(prisma),
      readTrackInfo(prisma, groupKey),
      readHotlapFallback(prisma),
    ]);
    // Real laps if there are any, the stand-in if there aren't and it's on.
    const displayName = key ? displayNameFor(key) : track;
    const videos = videosWithFallback(info.videos, fallback, displayName);

    // Races at this circuit: this series' seasons only, and only public
    // (non-private) ones unless we're admin.
    const inSeries = (seasonId) =>
      !series || bySeries.size === 0 || bySeries.get(seasonId) === series.id;
    const here = races.filter(
      (r) => groupKeyFor(r.track) === groupKey && (isAdmin || !priv.has(r.seasonId)) && inSeries(r.seasonId)
    );
    const raceIds = here.map((r) => r.id);

    // Flag country: admin-stored code on the races wins over the static table.
    const dbCountry = (await readTrackCountries(prisma))[groupKey] || null;

    if (!raceIds.length) {
      return res.json({
        track: displayName,
        key: groupKey,
        country: dbCountry || staticCountryFor(track),
        stats: {},
        editions: [],
        customFacts: info.facts,
        mapImageUrl: info.mapImageUrl,
        mapRotation: info.mapRotation || 0,
        videos,
        me: null,
      });
    }

    const [results, telemetryRows] = await Promise.all([
      prisma.raceResult.findMany({
        where: { raceId: { in: raceIds } },
        include: { driver: { select: { id: true, name: true, country: true, seasonId: true } } },
      }),
      telemetryForRaces(prisma, raceIds),
    ]);
    const telByKey = new Map(telemetryRows.map((t) => [`${t.raceId}|${t.driverId}`, t]));
    const raceById = new Map(here.map((r) => [r.id, r]));
    const seasonNumberOf = (raceId) => raceById.get(raceId)?.season?.number ?? 0;
    // seasonId -> season number, built once. The old helper did a linear scan of
    // `here` for every single result row, which made the whole loop cost
    // results x races.
    const seasonNumberById = new Map();
    for (const r of here) {
      if (r.seasonId != null && !seasonNumberById.has(r.seasonId)) {
        seasonNumberById.set(r.seasonId, r.season?.number ?? 0);
      }
    }

    // Resolve a result row to a stable person key + its current display name and
    // the driverId to link to (newest-season row of that person).
    const personKey = (driverId) => groups.byDriver.get(driverId) || driverId;
    const currentName = (driver) => nameOverrides.get(driver.id)?.displayName || driver.name;

    // Per-person accumulators.
    const people = new Map(); // key -> { name, wins, poles, crashes, cuts, linkId, linkSeason }
    const ensure = (driver) => {
      const k = personKey(driver.id);
      let p = people.get(k);
      if (!p) {
        p = { name: currentName(driver), wins: 0, poles: 0, crashes: 0, cuts: 0, cutsSeen: false, linkId: driver.id, linkSeason: -1 };
        people.set(k, p);
      }
      const sn = driver.seasonId ? seasonNumberById.get(driver.seasonId) ?? 0 : 0;
      if (sn >= p.linkSeason) { p.linkSeason = sn; p.linkId = driver.id; p.name = currentName(driver); }
      return p;
    };

    let fastestLap = null; // { ms, name, driverId, seasonNumber }
    for (const r of results) {
      const p = ensure(r.driver);
      const finished = (!r.status || r.status === "FINISHED") && r.position != null;
      if (finished && r.position === 1) p.wins++;
      if (r.grid === 1) p.poles++;
      const tel = telByKey.get(`${r.raceId}|${r.driverId}`) || {};
      const crashes = (tel.contacts || 0) + (tel.envContacts || 0);
      p.crashes += crashes;
      if (tel.cuts != null) { p.cuts += tel.cuts; p.cutsSeen = true; }
      if (isLap(r.bestLapMs) && (!fastestLap || r.bestLapMs < fastestLap.ms)) {
        fastestLap = { ms: r.bestLapMs, name: currentName(r.driver), driverId: r.driver.id, seasonNumber: seasonNumberOf(r.raceId) };
      }
    }

    const topBy = (pick, guard = () => true) => {
      let best = null;
      for (const p of people.values()) {
        if (!guard(p)) continue;
        const v = pick(p);
        if (v > 0 && (!best || v > best.count)) best = { name: p.name, driverId: p.linkId, count: v };
      }
      return best;
    };

    const anyCuts = [...people.values()].some((p) => p.cutsSeen && p.cuts > 0);
    const stats = {
      mostWins: topBy((p) => p.wins),
      fastestLap: fastestLap ? { name: fastestLap.name, driverId: fastestLap.driverId, ms: fastestLap.ms, seasonNumber: fastestLap.seasonNumber } : null,
      mostPoles: topBy((p) => p.poles),
      mostCrashes: topBy((p) => p.crashes),
      mostCuts: anyCuts ? topBy((p) => p.cuts) : null,
    };

    // Editions: one row per running of this track, newest first.
    const resultsByRace = new Map();
    for (const r of results) {
      if (!resultsByRace.has(r.raceId)) resultsByRace.set(r.raceId, []);
      resultsByRace.get(r.raceId).push(r);
    }
    const editions = here
      .map((race) => {
        const rs = resultsByRace.get(race.id) || [];
        const winner = rs.find((r) => (!r.status || r.status === "FINISHED") && r.position === 1);
        const pole = rs.find((r) => r.grid === 1);
        const laps = rs.filter((r) => isLap(r.bestLapMs));
        const fl = laps.length ? laps.reduce((b, r) => (r.bestLapMs < b.bestLapMs ? r : b)) : null;
        return {
          seasonNumber: race.season?.number ?? null,
          seasonName: race.season?.name ?? null,
          raceNumber: race.number,
          date: race.date,
          winner: winner ? { driverId: winner.driver.id, name: currentName(winner.driver) } : null,
          poleman: pole ? { driverId: pole.driver.id, name: currentName(pole.driver) } : null,
          fastestLapMs: fl ? fl.bestLapMs : null,
        };
      })
      .sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0));

    // Personal history for the logged-in, linked member.
    let me = null;
    const myDriverId = await resolveDriverId(prisma, req.user);
    if (myDriverId) {
      const myIds = new Set(await getLinkedDriverIds(prisma, myDriverId));
      const mine = results.filter((r) => myIds.has(r.driverId));
      if (mine.length) {
        const positions = mine.filter((r) => (!r.status || r.status === "FINISHED") && r.position != null).map((r) => r.position);
        const bestLapMs = mine.filter((r) => isLap(r.bestLapMs)).reduce((m, r) => (m == null || r.bestLapMs < m ? r.bestLapMs : m), null);
        me = {
          editions: mine
            .map((r) => ({
              seasonNumber: seasonNumberOf(r.raceId),
              raceNumber: raceById.get(r.raceId)?.number ?? null,
              position: r.position,
              grid: r.grid,
              status: r.status,
              bestLapMs: isLap(r.bestLapMs) ? r.bestLapMs : null,
            }))
            .sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0)),
          starts: mine.filter((r) => r.status !== "DNS").length,
          wins: positions.filter((p) => p === 1).length,
          bestFinish: positions.length ? Math.min(...positions) : null,
          bestLapMs,
        };
      }
    }

    res.json({
      track: displayName,
      key: groupKey,
      country: dbCountry || staticCountryFor(track),
      stats,
      editions,
      customFacts: info.facts,
      mapImageUrl: info.mapImageUrl,
      mapRotation: info.mapRotation || 0,
      // Hotlap videos for the circuit — the attendance page's own player.
      videos,
      me,
    });
  } catch (e) {
    next(e);
  }
});

// Season number for a driver's own season id, looked up from the loaded races.
export default router;
