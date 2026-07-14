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
import { groupKeyFor, trackKeyFor, displayNameFor, countryFor } from "../lib/trackKeys.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { resolveSeries, seasonSeriesMap } from "../lib/series.js";
import { getPersonGroups, getNameOverrides, getLinkedDriverIds } from "../lib/persons.js";
import { telemetryForRaces } from "../lib/telemetryRead.js";
import { readTrackInfo } from "../lib/trackInfo.js";

const router = Router();

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

    const [races, priv, groups, nameOverrides, info, series, bySeries] = await Promise.all([
      prisma.race.findMany({
        where: { isCompleted: true, isSpecialEvent: false },
        include: { season: { select: { id: true, number: true, name: true } } },
      }),
      getPrivateSeasonIds(prisma),
      getPersonGroups(prisma),
      getNameOverrides(prisma),
      readTrackInfo(prisma, groupKey),
      // Track records are per SERIES (GT laps must not enter the F1 record
      // book). ?series=<slug>; default = the active (primary) series.
      resolveSeries(prisma, req.query.series, { includePrivate: isAdmin }),
      seasonSeriesMap(prisma),
    ]);

    // Races at this circuit: this series' seasons only, and only public
    // (non-private) ones unless we're admin.
    const inSeries = (seasonId) =>
      !series || bySeries.size === 0 || bySeries.get(seasonId) === series.id;
    const here = races.filter(
      (r) => groupKeyFor(r.track) === groupKey && (isAdmin || !priv.has(r.seasonId)) && inSeries(r.seasonId)
    );
    const raceIds = here.map((r) => r.id);

    if (!raceIds.length) {
      return res.json({
        track: key ? displayNameFor(key) : track,
        key: groupKey,
        country: countryFor(track),
        stats: {},
        editions: [],
        customFacts: info.facts,
        mapImageUrl: info.mapImageUrl,
        mapRotation: info.mapRotation || 0,
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
      const sn = driver.seasonId ? seasonNumberOfSeasonId(driver.seasonId, here) : 0;
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
      track: key ? displayNameFor(key) : track,
      key: groupKey,
      country: countryFor(track),
      stats,
      editions,
      customFacts: info.facts,
      mapImageUrl: info.mapImageUrl,
      mapRotation: info.mapRotation || 0,
      me,
    });
  } catch (e) {
    next(e);
  }
});

// Season number for a driver's own season id, looked up from the loaded races.
function seasonNumberOfSeasonId(seasonId, races) {
  const hit = races.find((r) => r.seasonId === seasonId);
  return hit?.season?.number ?? 0;
}

export default router;
