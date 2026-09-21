// ---------------------------------------------------------------------------
// One finished round, the way the site shows it: the classification with
// penalties applied, the round's honours, the qualifying sheet, the format and
// the media that travels with it. Built here rather than inside the route
// because a second reader arrived (the race recap a driver sees after a round,
// lib/raceRecap.js) and two copies of a 300-line derivation would drift apart
// the first time one of them learned something new.
//
// `race` is the Race row with its season number included; the caller decides
// who may see it (private seasons are the route's business).
// ---------------------------------------------------------------------------
import {
  getDriverResultPoints,
  getPointsForPosition,
  applyPenalties,
  stampFastestLapBonus,
  stampRacePointsTable,
  fastestLapBonusOf,
  DEFAULT_POINTS_TABLE,
} from "./pointsCalculator.js";
import { getSeasonScoring } from "./seasonService.js";
import { getNameOverrides, getIdentityOverrides } from "../lib/persons.js";
import { readDriverRoles } from "../lib/driverRoles.js";
import { telemetryForRace } from "../lib/telemetryRead.js";
import { readManualFastestLaps } from "../lib/raceHonours.js";
import { readRaceFormat } from "../lib/raceFormat.js";
import { readParentIds, readSprintChildren } from "../lib/sprintRaces.js";
import { readRaceHighlights } from "../lib/raceHighlights.js";
import { readRaceTypes } from "../lib/raceTypes.js";
import { dbReplaysByRace } from "../lib/downloads.js";
import { readRaceCountries, staticCountryFor } from "../lib/raceCountries.js";
import { readRacePhotos, withUrls } from "../lib/racePhotos.js";
import { hasArchiveFor } from "../lib/cockpitArchive.js";
import { resultTeamId } from "../lib/resultTeam.js";

export async function raceDetailPayload(prisma, race) {
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
  // the original finishing position so the UI can show "P2 → P5". The
  // season's fastest-lap bonus is stamped the same way the standings do it
  // (recorded holder first, then the best stored lap), so the points column
  // here is the figure the tables add up.
  const manualFlHolder = (await readManualFastestLaps(prisma, [race.id])).get(race.id) || null;
  // The round's own points table, if any (a sprint child uses its round's).
  const parentForTable = (await readParentIds(prisma, [race.id])).get(race.id) || null;
  const tableFormat = await readRaceFormat(prisma, [race.id, parentForTable].filter(Boolean));
  const racePointsTable =
    (parentForTable ? tableFormat.get(parentForTable) : tableFormat.get(race.id))?.pointsTable ?? null;
  const applied = stampRacePointsTable(
    stampFastestLapBonus(
      applyPenalties(results),
      scoring.fastestLapPoints || 0,
      manualFlHolder ? new Map([[race.id, manualFlHolder]]) : new Map()
    ),
    new Map([[race.id, racePointsTable]])
  );
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
        points: getPointsForPosition(rank, racePointsTable || table) + fastestLapBonusOf(r),
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
        // The face for the podium in the race recap; the same fallback chain
        // the standings use, so the recap shows the picture the tables show.
        photoUrl: r.driver.photoUrl || r.driver.discordAvatar || identity.get(r.driverId)?.photoUrl || null,
        role: roles.get(r.driverId) || null,
        driverTier: r.driver.tier,
        position: r.position,
        rawPosition: rawById.get(r.driverId) ?? null,
        status: r.status,
        points: getDriverResultPoints(r, table),
        // The share of `points` that is the fastest-lap bonus (0 = none).
        fastestLap: fastestLapBonusOf(r),
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
  // Both directions of the sprint link (lib/sprintRaces.js), and the kinds
  // of this race and of the event it is the sprint of: a sprint child is
  // typed SPECIAL (not a round of its own) but scores when its event is a
  // championship round, and the results table shows its points by that.
  const sprintRaceId = (await readSprintChildren(prisma, [race.id])).get(race.id) ?? null;
  const sprintOf = (await readParentIds(prisma, [race.id])).get(race.id) ?? null;
  const kinds = await readRaceTypes(prisma, [race.id, sprintOf].filter(Boolean));
  const kind = kinds.get(race.id) || (race.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
  const scores = kind === "CHAMPIONSHIP" || (!!sprintOf && (kinds.get(sprintOf) || "CHAMPIONSHIP") === "CHAMPIONSHIP");
  // The round's photo gallery. It travels with the round rather than on its
  // own endpoint so the page opens complete, the same way the replay link and
  // the session format already do.
  const photos = withUrls(await readRacePhotos(prisma, race.id));
  // A sprint classification's archived file is filed under its EVENT's round
  // number with the sprint flag (lib/cockpitArchive.js), because the child row
  // carries no number of its own. Look for the lap-by-lap view there, or the
  // Sprint tab would never be offered one.
  const filedNumber = sprintOf
    ? (await prisma.race.findUnique({ where: { id: sprintOf }, select: { number: true } }).catch(() => null))?.number ?? null
    : race.number;
  return {
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
      // The round's own points table (array) or null = the season's, as
      // applied above.
      pointsTable: racePointsTable,
      // Both directions of the sprint link: an event says where its sprint
      // classification lives (the Races page adds a Sprint tab and fetches
      // it through this same endpoint), a sprint row says whose it is.
      sprintRaceId,
      sprintOf,
      replayDownloadId: replays.get(race.id) || null,
      // The round's highlights video, if the admin pasted one.
      highlightsUrl: (await readRaceHighlights(prisma, [race.id])).get(race.id) || null,
      hasPositions,
      // Whether this round has an archived raw result file, and therefore a
      // lap-by-lap view to switch the classification over to. A directory
      // listing, not a parse (lib/cockpitArchive.js) — the chart itself is
      // fetched only if somebody asks for it.
      hasLapChart: hasArchiveFor(race.season, filedNumber, { sprint: !!sprintOf }),
      // Championship round, training session or special event. The list
      // endpoint has always sent this; the detail one did not, so the results
      // table had no way to tell them apart and showed a points column for
      // sessions that score nothing.
      isSpecialEvent: race.isSpecialEvent,
      type: kind,
      // Pays championship points: a round, or the sprint of one.
      scores,
      driverOfTheDay,
      // Admin-recorded fastest-lap holder (archive rounds, lib/raceHonours.js).
      // When set, the race page marks THIS driver instead of deriving the
      // holder from the stored lap times. null = derive as always.
      fastestLapDriverId: manualFlHolder,
      // Bonus the fastest race lap pays this season (0 = none).
      fastestLapPoints: scoring.fastestLapPoints || 0,
    },
    results: rows,
    quali,
  };
}
