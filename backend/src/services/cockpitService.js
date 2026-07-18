// ---------------------------------------------------------------------------
// The private Cockpit: everything the logged-in driver sees about themselves.
// One builder per tab (overview / season / tracks / career / duels /
// achievements / race analysis), all starting from the same resolved context:
// the acting driver row plus the person's linked rows in the SAME series
// (public seasons only). Official points always come from standingsService —
// nothing here re-invents scoring.
// ---------------------------------------------------------------------------
import { getDriverStandings } from "./standingsService.js";
import { applyDropScores } from "./standingsService.js";
import { getSeasonScoring, getActiveSeason } from "./seasonService.js";
import { getDriverRatings } from "./driverRatingsService.js";
import { getLinkedDriverIds, getNameOverrides, getPersonGroups } from "../lib/persons.js";
import { seasonSeriesMap } from "../lib/series.js";
import { isSeasonComplete, seasonConcluded } from "../lib/seasonComplete.js";
import { telemetryForDriver, telemetryForRace } from "../lib/telemetryRead.js";
import { groupKeyFor, displayNameFor, countryFor } from "../lib/trackKeys.js";
import { raceKickoff } from "../lib/raceKickoff.js";
import { achievementStateFor } from "../lib/achievements.js";
import { findArchiveFor, analyzeRaceFor, raceInsightsFor } from "../lib/cockpitArchive.js";

const MAX_LAP_MS = 1_800_000;
const isLap = (ms) => ms != null && ms > 0 && ms <= MAX_LAP_MS;
const avg = (nums) => (nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null);

// --- shared context -----------------------------------------------------------

// The person behind a driver row, scoped to that row's series: every linked
// row in a PUBLIC season of the same series, sorted oldest season first.
export async function cockpitContext(prisma, driverId) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { team: true, season: { select: { id: true, number: true, name: true } } },
  });
  if (!driver) return null;

  const [linkedIds, bySeries, privateRows] = await Promise.all([
    getLinkedDriverIds(prisma, driverId),
    seasonSeriesMap(prisma),
    prisma.$queryRawUnsafe(`SELECT "id" FROM "Season" WHERE "isPublic" = 0`).catch(() => []),
  ]);
  const privateSeasonIds = new Set(privateRows.map((r) => r.id));
  const ownSeriesId = bySeries.get(driver.seasonId) ?? null;

  const linkedRows = await prisma.driver.findMany({
    where: { id: { in: linkedIds } },
    include: { team: true, season: { select: { id: true, number: true, name: true } } },
  });
  const rows = linkedRows
    .filter(
      (r) =>
        r.seasonId &&
        (bySeries.get(r.seasonId) ?? null) === ownSeriesId &&
        (!privateSeasonIds.has(r.seasonId) || r.seasonId === driver.seasonId)
    )
    .sort((a, b) => (a.season?.number ?? 0) - (b.season?.number ?? 0));

  return { driver, rows, ownSeriesId, privateSeasonIds };
}

// Per-request standings cache so several builders can share one computation.
function standingsCache(prisma) {
  const cache = new Map();
  return (seasonId) => {
    if (!cache.has(seasonId)) cache.set(seasonId, getDriverStandings(prisma, seasonId));
    return cache.get(seasonId);
  };
}

// All completed championship rounds of one season, calendar order.
function completedChampionshipRaces(prisma, seasonId) {
  return prisma.race.findMany({
    where: { seasonId, isSpecialEvent: false, isCompleted: true },
    orderBy: { number: "asc" },
  });
}

// --- overview -----------------------------------------------------------------

export async function getCockpitOverview(prisma, driverId) {
  const ctx = await cockpitContext(prisma, driverId);
  if (!ctx) return null;
  const { driver } = ctx;
  const seasonId = driver.seasonId;

  const [standings, races, upcoming, telemetry] = await Promise.all([
    getDriverStandings(prisma, seasonId),
    completedChampionshipRaces(prisma, seasonId),
    prisma.race.findMany({
      where: { seasonId, isSpecialEvent: false, isCompleted: false },
      orderBy: { number: "asc" },
    }),
    telemetryForDriver(prisma, driverId),
  ]);

  const me = standings.standings.find((r) => r.driverId === driverId) || null;
  const completedNumbers = races.map((r) => r.number);

  // Form: the last five completed rounds, oldest first.
  const form = races.slice(-5).map((race) => {
    const pr = me?.perRace?.[race.number];
    return {
      raceId: race.id,
      number: race.number,
      track: race.track,
      country: race.country || countryFor(race.track) || null,
      position: pr?.position ?? null,
      status: pr?.status ?? "DNS",
      points: pr?.points ?? 0,
      dropped: (me?.droppedRounds || []).includes(race.number),
    };
  });

  // Position trend: where the driver stood BEFORE the latest completed round
  // (same drop rule with that round zeroed for everyone).
  let trend = 0;
  if (me && races.length >= 2) {
    const lastNum = races[races.length - 1].number;
    const before = standings.standings
      .map((r) => {
        const pts = {};
        for (const [num, v] of Object.entries(r.perRace || {})) {
          if (Number(num) !== lastNum) pts[num] = v.points;
        }
        const { total } = applyDropScores(pts, standings.raceNumbers.filter((n) => n !== lastNum), standings.dropWorst);
        return { driverId: r.driverId, total, name: r.name };
      })
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const prevPos = before.findIndex((r) => r.driverId === driverId) + 1;
    if (prevPos > 0 && me.position != null) trend = prevPos - me.position;
  }

  // Points gaps to the car ahead and the leader.
  const idx = me ? standings.standings.findIndex((r) => r.driverId === driverId) : -1;
  const leader = standings.standings[0] || null;
  const ahead = idx > 0 ? standings.standings[idx - 1] : null;

  // Next race + this person's history on that circuit (linked rows, all seasons).
  let nextRace = null;
  if (upcoming.length) {
    const race = upcoming[0];
    const key = groupKeyFor(race.track);
    const history = await trackHistoryFor(prisma, ctx, key);
    nextRace = {
      raceId: race.id,
      number: race.number,
      track: race.track,
      country: race.country || countryFor(race.track) || null,
      date: race.date,
      kickoff: raceKickoff(race.date),
      history,
    };
  }

  // Season quick numbers from the perRace map + telemetry.
  const rounds = Object.values(me?.perRace || {});
  const started = rounds.filter((v) => v.status !== "DNS");
  const finished = started.filter((v) => v.status === "FINISHED" && v.position != null);
  let contacts = 0, cuts = 0, anyTel = false;
  for (const t of telemetry.values()) {
    if (t.contacts != null) { contacts += t.contacts; anyTel = true; }
    if (t.cuts != null) cuts += t.cuts;
  }

  return {
    driver: {
      id: driver.id,
      name: driver.name,
      number: driver.number ?? null,
      country: driver.country || null,
      photoUrl: driver.photoUrl || driver.discordAvatar || null,
      seasonNumber: driver.season?.number ?? null,
      seasonName: driver.season?.name ?? null,
      team: driver.team
        ? { id: driver.team.id, name: driver.team.name, color: driver.team.color, tier: driver.team.tier, logoUrl: driver.team.logoUrl }
        : null,
    },
    championship: {
      position: me?.position ?? null,
      points: me?.total ?? 0,
      fieldSize: standings.standings.length,
      trend,
      gapToLeader: leader && me ? leader.total - me.total : null,
      gapToAhead: ahead && me ? ahead.total - me.total : null,
      completedRounds: completedNumbers.length,
      totalRounds: standings.raceNumbers.length,
    },
    form,
    nextRace,
    quick: {
      avgPoints: started.length ? Math.round(((me?.total ?? 0) / started.length) * 10) / 10 : null,
      pointsFinishRate: started.length
        ? Math.round((rounds.filter((v) => v.points > 0).length / started.length) * 100)
        : null,
      dnfCount: started.filter((v) => v.status === "DNF").length,
      wins: finished.filter((v) => v.position === 1).length,
      podiums: finished.filter((v) => v.position <= 3).length,
      avgFinish: avg(finished.map((v) => v.position)),
      contacts: anyTel ? contacts : null,
      cuts: anyTel ? cuts : null,
    },
  };
}

// --- season (championship calculator, rivals, goals) --------------------------

export async function getCockpitSeason(prisma, driverId) {
  const ctx = await cockpitContext(prisma, driverId);
  if (!ctx) return null;
  const { driver } = ctx;
  const seasonId = driver.seasonId;

  const [standings, scoring, races] = await Promise.all([
    getDriverStandings(prisma, seasonId),
    getSeasonScoring(prisma, seasonId),
    prisma.race.findMany({ where: { seasonId, isSpecialEvent: false }, orderBy: { number: "asc" } }),
  ]);

  const completed = races.filter((r) => r.isCompleted).map((r) => r.number);
  const remaining = races.filter((r) => !r.isCompleted).map((r) => r.number);
  // Best single-round haul: the season's points-table maximum, or (points-only
  // archive) the best observed round.
  const tableMax = Array.isArray(scoring.pointsTable) && scoring.pointsTable.length
    ? scoring.pointsTable[0]
    : Math.max(0, ...standings.standings.flatMap((r) => Object.values(r.perRace || {}).map((v) => v.points)));

  const dropN = standings.dropWorst ?? 0;
  // Floor = every remaining round scores 0; ceiling = every remaining round
  // scores tableMax — both under the season's own drop rule. Identical maths
  // to the Home page's title-fight widget, now for every position.
  const calc = standings.standings.map((r) => {
    const pts = {};
    for (const [num, v] of Object.entries(r.perRace || {})) pts[num] = v.points;
    const floorPts = { ...pts };
    const maxPts = { ...pts };
    for (const num of remaining) {
      floorPts[num] = 0;
      maxPts[num] = tableMax;
    }
    return {
      driverId: r.driverId,
      name: r.name,
      position: r.position,
      total: r.total,
      teamColor: r.team?.color ?? null,
      teamName: r.team?.name ?? null,
      photoUrl: r.photoUrl ?? null,
      perRace: r.perRace,
      droppedRounds: r.droppedRounds,
      floor: applyDropScores(floorPts, standings.raceNumbers, dropN).total,
      ceiling: applyDropScores(maxPts, standings.raceNumbers, dropN).total,
    };
  });

  // Self-set goals (raw column; private to the driver).
  let goals = [];
  try {
    const rows = await prisma.$queryRaw`SELECT "cockpitGoals" FROM "Driver" WHERE "id" = ${driverId}`;
    const parsed = rows[0]?.cockpitGoals ? JSON.parse(rows[0].cockpitGoals) : null;
    if (Array.isArray(parsed)) goals = parsed;
  } catch {
    /* column not there yet / unreadable -> no goals */
  }

  return {
    meId: driverId,
    raceNumbers: standings.raceNumbers,
    completedNumbers: completed,
    remainingNumbers: remaining,
    dropWorst: dropN,
    tableMax,
    officialTotals: standings.officialTotals,
    standings: calc,
    goals,
  };
}

// --- tracks -------------------------------------------------------------------

// The person's rows on ONE circuit (used by the overview's next-race panel).
async function trackHistoryFor(prisma, ctx, trackKey) {
  const results = await prisma.raceResult.findMany({
    where: { driverId: { in: ctx.rows.map((r) => r.id) } },
    include: { race: { select: { id: true, track: true, number: true, seasonId: true, isCompleted: true, isSpecialEvent: true } } },
  });
  const seasonNumById = new Map(ctx.rows.map((r) => [r.season.id, r.season.number]));
  const rows = results.filter(
    (r) => r.race?.isCompleted && !r.race.isSpecialEvent && groupKeyFor(r.race.track) === trackKey
  );
  if (!rows.length) return null;
  const finished = rows.filter((r) => r.status === "FINISHED" && r.position != null);
  const bestLap = Math.min(...rows.map((r) => r.bestLapMs).filter(isLap));
  return {
    starts: rows.filter((r) => r.status !== "DNS").length,
    bestFinish: finished.length ? Math.min(...finished.map((r) => r.position)) : null,
    avgFinish: avg(finished.map((r) => r.position)),
    wins: finished.filter((r) => r.position === 1).length,
    podiums: finished.filter((r) => r.position <= 3).length,
    bestLapMs: Number.isFinite(bestLap) ? bestLap : null,
    recent: rows
      .sort((a, b) => (seasonNumById.get(a.race.seasonId) ?? 0) - (seasonNumById.get(b.race.seasonId) ?? 0))
      .slice(-4)
      .map((r) => ({
        seasonNumber: seasonNumById.get(r.race.seasonId) ?? null,
        position: r.position,
        grid: r.grid,
        status: r.status,
      })),
  };
}

export async function getCockpitTracks(prisma, driverId) {
  const ctx = await cockpitContext(prisma, driverId);
  if (!ctx) return null;

  const results = await prisma.raceResult.findMany({
    where: { driverId: { in: ctx.rows.map((r) => r.id) } },
    include: { race: { select: { id: true, track: true, number: true, seasonId: true, isCompleted: true, isSpecialEvent: true } } },
  });
  const seasonNumById = new Map(ctx.rows.map((r) => [r.season.id, r.season.number]));
  const rows = results.filter((r) => r.race?.isCompleted && !r.race.isSpecialEvent);

  const byTrack = new Map();
  for (const r of rows) {
    const key = groupKeyFor(r.race.track);
    if (!byTrack.has(key)) byTrack.set(key, { key, name: displayNameFor(key) || r.race.track, country: countryFor(r.race.track), rows: [] });
    byTrack.get(key).rows.push(r);
  }

  const allFinished = rows.filter((r) => r.status === "FINISHED" && r.position != null);
  const overallAvgFinish = avg(allFinished.map((r) => r.position));

  const tracks = [...byTrack.values()]
    .map((t) => {
      const finished = t.rows.filter((r) => r.status === "FINISHED" && r.position != null);
      const bestLap = Math.min(...t.rows.map((r) => r.bestLapMs).filter(isLap));
      // Best lap per season, oldest first — the "am I getting faster here" line.
      const bySeason = new Map();
      for (const r of t.rows) {
        const num = seasonNumById.get(r.race.seasonId);
        if (num == null) continue;
        const cur = bySeason.get(num) || { seasonNumber: num, bestLapMs: null, positions: [] };
        if (isLap(r.bestLapMs) && (cur.bestLapMs == null || r.bestLapMs < cur.bestLapMs)) cur.bestLapMs = r.bestLapMs;
        if (r.status === "FINISHED" && r.position != null) cur.positions.push(r.position);
        bySeason.set(num, cur);
      }
      return {
        key: t.key,
        name: t.name,
        country: t.country || null,
        starts: t.rows.filter((r) => r.status !== "DNS").length,
        wins: finished.filter((r) => r.position === 1).length,
        podiums: finished.filter((r) => r.position <= 3).length,
        bestFinish: finished.length ? Math.min(...finished.map((r) => r.position)) : null,
        avgFinish: avg(finished.map((r) => r.position)),
        dnf: t.rows.filter((r) => r.status === "DNF").length,
        bestLapMs: Number.isFinite(bestLap) ? bestLap : null,
        seasons: [...bySeason.values()]
          .sort((a, b) => a.seasonNumber - b.seasonNumber)
          .map((s) => ({ seasonNumber: s.seasonNumber, bestLapMs: s.bestLapMs, avgFinish: avg(s.positions) })),
      };
    })
    .sort((a, b) => b.starts - a.starts || a.name.localeCompare(b.name));

  return { overallAvgFinish, tracks };
}

// --- career -------------------------------------------------------------------

export async function getCockpitCareer(prisma, driverId) {
  const ctx = await cockpitContext(prisma, driverId);
  if (!ctx) return null;
  const getStandings = standingsCache(prisma);

  const [activeSeason] = await Promise.all([getActiveSeason(prisma, ctx.ownSeriesId)]);
  const activeComplete = activeSeason ? await isSeasonComplete(prisma, activeSeason.id) : false;
  const concluded = (num) => seasonConcluded(num, activeSeason?.number ?? null, activeComplete);

  const seasons = [];
  const ratingHistory = [];
  for (const row of ctx.rows) {
    const st = await getStandings(row.seasonId);
    const me = st.standings.find((r) => r.driverId === row.id);
    if (!me) continue;
    const rounds = Object.values(me.perRace || {});
    const started = rounds.filter((v) => v.status !== "DNS");
    const finished = started.filter((v) => v.status === "FINISHED" && v.position != null);
    seasons.push({
      driverId: row.id,
      seasonNumber: row.season.number,
      seasonName: row.season.name,
      isCurrent: row.seasonId === ctx.driver.seasonId,
      concluded: concluded(row.season.number),
      teamName: row.team?.name ?? null,
      teamColor: row.team?.color ?? null,
      position: me.position ?? null,
      points: me.total ?? 0,
      starts: started.length,
      wins: finished.filter((v) => v.position === 1).length,
      podiums: finished.filter((v) => v.position <= 3).length,
      poles: 0, // filled below from result rows (grid isn't in perRace)
    });
    // Rating history: this row's card numbers in its own season.
    try {
      const ratings = await getDriverRatings(prisma, row.seasonId);
      const mine = ratings.find((r) => r.driverId === row.id || r.id === row.id);
      if (mine?.ratings) {
        ratingHistory.push({ seasonNumber: row.season.number, ...mine.ratings });
      }
    } catch {
      /* a season that can't be rated simply has no point on the curve */
    }
  }

  // Poles + personal records come from the raw result rows.
  const results = await prisma.raceResult.findMany({
    where: { driverId: { in: ctx.rows.map((r) => r.id) } },
    include: { race: { select: { track: true, number: true, seasonId: true, isCompleted: true, isSpecialEvent: true } } },
  });
  const champRows = results.filter((r) => r.race?.isCompleted && !r.race.isSpecialEvent);
  const bySeasonId = new Map(ctx.rows.map((r) => [r.seasonId, r]));
  for (const s of seasons) {
    s.poles = champRows.filter(
      (r) => bySeasonId.get(r.race.seasonId)?.season.number === s.seasonNumber && r.grid === 1 && r.status !== "DNS"
    ).length;
  }

  const inputs = await buildAchievementInputs(prisma, ctx, { standings: getStandings });
  const totals = seasons.reduce(
    (t, s) => ({
      seasons: t.seasons + 1,
      points: t.points + s.points,
      starts: t.starts + s.starts,
      wins: t.wins + s.wins,
      podiums: t.podiums + s.podiums,
      poles: t.poles + s.poles,
    }),
    { seasons: 0, points: 0, starts: 0, wins: 0, podiums: 0, poles: 0 }
  );

  return {
    seasons: seasons.sort((a, b) => a.seasonNumber - b.seasonNumber),
    totals: { ...totals, fastestLaps: inputs.fastestLaps, laps: inputs.laps, lapsLed: inputs.lapsLed, overtakes: inputs.overtakes },
    ratingHistory: ratingHistory.sort((a, b) => a.seasonNumber - b.seasonNumber),
    records: {
      longestPointsStreak: inputs.longestPointsStreak,
      longestPodiumStreak: inputs.longestPodiumStreak,
      bestComeback: inputs.bestComeback,
      distinctWinTracks: inputs.distinctWinTracks,
      cleanRaces: inputs.cleanRaces,
      titles: inputs.titles,
      bestSeason: seasons.filter((s) => s.position != null && s.starts > 0).sort((a, b) => a.position - b.position)[0] || null,
    },
  };
}

// --- duels --------------------------------------------------------------------

export async function getCockpitDuels(prisma, driverId) {
  const ctx = await cockpitContext(prisma, driverId);
  if (!ctx) return null;

  const [persons, nameOverrides] = await Promise.all([getPersonGroups(prisma), getNameOverrides(prisma)]);
  const ownIds = new Set(ctx.rows.map((r) => r.id));

  // Every result of every season the person raced in, penalties as stored.
  const seasonIds = [...new Set(ctx.rows.map((r) => r.seasonId))];
  const [allResults, allDrivers] = await Promise.all([
    prisma.raceResult.findMany({
      where: { race: { seasonId: { in: seasonIds }, isCompleted: true, isSpecialEvent: false } },
      include: { race: { select: { id: true, seasonId: true } } },
    }),
    prisma.driver.findMany({ where: { seasonId: { in: seasonIds } }, include: { team: true } }),
  ]);
  const driverById = new Map(allDrivers.map((d) => [d.id, d]));
  const myTeamBySeason = new Map(ctx.rows.map((r) => [r.seasonId, r.teamId]));

  // Group the field's rows by race so duels compare within one classification.
  const byRace = new Map();
  for (const r of allResults) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId).push(r);
  }

  // Opponent identity: their person when linked, else the row itself.
  const oppKey = (id) => persons.byDriver.get(id) || id;

  const duels = new Map();
  for (const rows of byRace.values()) {
    const mine = rows.find((r) => ownIds.has(r.driverId));
    if (!mine) continue;
    const seasonId = rows[0].race.seasonId;
    for (const other of rows) {
      if (other.driverId === mine.driverId || ownIds.has(other.driverId)) continue;
      const od = driverById.get(other.driverId);
      if (!od) continue;
      const key = oppKey(other.driverId);
      let d = duels.get(key);
      if (!d) {
        d = {
          key,
          name: od.name,
          photoUrl: od.photoUrl || od.discordAvatar || null,
          teamName: od.team?.name ?? null,
          teamColor: od.team?.color ?? null,
          isTeammate: false,
          shared: 0,
          raceWins: 0,
          raceLosses: 0,
          qualiWins: 0,
          qualiLosses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        };
        duels.set(key, d);
      }
      // The newest row's face/team wins the label (matches site-wide identity).
      const ov = nameOverrides.get(other.driverId);
      if (ov?.displayName) d.name = ov.displayName;
      if (od.photoUrl || od.discordAvatar) d.photoUrl = od.photoUrl || od.discordAvatar;
      if (od.team?.name) { d.teamName = od.team.name; d.teamColor = od.team.color; }
      if (od.teamId && od.teamId === myTeamBySeason.get(seasonId)) d.isTeammate = true;

      d.shared += 1;
      // Race duel: both classified -> lower position wins. A driver with a
      // position beats one without (DNF/DNS holds no slot in the classification).
      const mp = mine.status === "FINISHED" ? mine.position : null;
      const op = other.status === "FINISHED" ? other.position : null;
      if (mp != null && op != null) {
        if (mp < op) d.raceWins += 1;
        else if (op < mp) d.raceLosses += 1;
      } else if (mp != null && op == null) d.raceWins += 1;
      else if (mp == null && op != null) d.raceLosses += 1;
      // Quali duel: both need a grid slot.
      if (mine.grid != null && other.grid != null && mine.grid !== other.grid) {
        if (mine.grid < other.grid) d.qualiWins += 1;
        else d.qualiLosses += 1;
      }
      d.pointsFor += mine.points ?? 0;
      d.pointsAgainst += other.points ?? 0;
    }
  }

  const list = [...duels.values()]
    .filter((d) => d.shared >= 1)
    .sort((a, b) => b.shared - a.shared || a.name.localeCompare(b.name));

  // Nemesis / favourite opponent among rivals met often enough to mean something.
  const meaningful = list.filter((d) => d.raceWins + d.raceLosses >= 5);
  const ratio = (d) => d.raceWins / Math.max(1, d.raceWins + d.raceLosses);
  const nemesis = meaningful.length ? [...meaningful].sort((a, b) => ratio(a) - ratio(b))[0] : null;
  const favourite = meaningful.length ? [...meaningful].sort((a, b) => ratio(b) - ratio(a))[0] : null;

  return {
    duels: list,
    nemesisKey: nemesis && ratio(nemesis) < 0.5 ? nemesis.key : null,
    favouriteKey: favourite && ratio(favourite) > 0.5 ? favourite.key : null,
  };
}

// --- achievements -------------------------------------------------------------

// Career-wide inputs for the achievements catalogue (person-scoped, own series).
export async function buildAchievementInputs(prisma, ctx, { standings } = {}) {
  const getStandings = standings || standingsCache(prisma);
  const ids = ctx.rows.map((r) => r.id);

  const results = await prisma.raceResult.findMany({
    where: { driverId: { in: ids } },
    include: { race: { select: { id: true, track: true, number: true, seasonId: true, isCompleted: true, isSpecialEvent: true } } },
  });
  const rows = results
    .filter((r) => r.race?.isCompleted && !r.race.isSpecialEvent)
    .sort((a, b) => {
      const sa = ctx.rows.find((x) => x.seasonId === a.race.seasonId)?.season.number ?? 0;
      const sb = ctx.rows.find((x) => x.seasonId === b.race.seasonId)?.season.number ?? 0;
      return sa - sb || a.race.number - b.race.number;
    });

  const started = rows.filter((r) => r.status !== "DNS");
  const finished = started.filter((r) => r.status === "FINISHED" && r.position != null);

  // Season points/positions from the official standings; titles need the
  // concluded rule (a live season's P1 isn't a title yet).
  const activeSeason = await getActiveSeason(prisma, ctx.ownSeriesId);
  const activeComplete = activeSeason ? await isSeasonComplete(prisma, activeSeason.id) : false;
  let points = 0;
  let titles = 0;
  let noDnfSeasons = 0;
  let fullSeasons = 0;
  for (const row of ctx.rows) {
    const st = await getStandings(row.seasonId);
    const me = st.standings.find((r) => r.driverId === row.id);
    if (!me) continue;
    points += me.total ?? 0;
    const isConcluded = seasonConcluded(row.season.number, activeSeason?.number ?? null, activeComplete);
    if (isConcluded && me.position === 1) titles += 1;
    const rounds = Object.values(me.perRace || {});
    const startedRounds = rounds.filter((v) => v.status !== "DNS");
    if (isConcluded && startedRounds.length >= 5 && !startedRounds.some((v) => v.status === "DNF")) noDnfSeasons += 1;
    if (isConcluded && st.raceNumbers.length > 0 && startedRounds.length === st.raceNumbers.length) fullSeasons += 1;
  }

  // Fastest laps: rounds where an own row held the race's overall best lap.
  const withLap = rows.filter((r) => isLap(r.bestLapMs));
  let fastestLaps = 0;
  let fastestByRace = new Map();
  if (withLap.length) {
    const raceIds = [...new Set(withLap.map((r) => r.raceId))];
    const field = await prisma.raceResult.findMany({
      where: { raceId: { in: raceIds } },
      select: { raceId: true, bestLapMs: true },
    });
    const minByRace = new Map();
    for (const f of field) {
      if (!isLap(f.bestLapMs)) continue;
      const m = minByRace.get(f.raceId);
      if (m == null || f.bestLapMs < m) minByRace.set(f.raceId, f.bestLapMs);
    }
    for (const r of withLap) {
      if (r.bestLapMs === minByRace.get(r.raceId)) {
        fastestLaps += 1;
        fastestByRace.set(r.raceId, true);
      }
    }
  }

  // Photo finishes + back-row points need the race's full classification.
  const finishedRaceIds = [...new Set(finished.map((r) => r.raceId))];
  const fieldRows = finishedRaceIds.length
    ? await prisma.raceResult.findMany({
        where: { raceId: { in: finishedRaceIds } },
        select: { raceId: true, driverId: true, position: true, totalTimeMs: true, grid: true, status: true },
      })
    : [];
  const fieldByRace = new Map();
  for (const f of fieldRows) {
    if (!fieldByRace.has(f.raceId)) fieldByRace.set(f.raceId, []);
    fieldByRace.get(f.raceId).push(f);
  }
  let photoFinishes = 0;
  let pointsFromBackRow = 0;
  for (const r of finished) {
    const field = fieldByRace.get(r.raceId) || [];
    if (r.position > 1 && r.totalTimeMs) {
      const aheadRow = field.find((f) => f.position === r.position - 1 && f.status === "FINISHED");
      if (aheadRow?.totalTimeMs && r.totalTimeMs - aheadRow.totalTimeMs > 0 && r.totalTimeMs - aheadRow.totalTimeMs < 1000) {
        photoFinishes += 1;
      }
    }
    const gridSize = field.filter((f) => f.grid != null).length;
    if (r.grid != null && gridSize >= 6 && r.grid >= gridSize - 1 && (r.points ?? 0) > 0) pointsFromBackRow += 1;
  }

  // Telemetry sums + clean races across all linked rows.
  let overtakes = 0, lapsLed = 0, laps = 0, cleanRaces = 0;
  for (const row of ctx.rows) {
    const tel = await telemetryForDriver(prisma, row.id);
    for (const t of tel.values()) {
      if (t.overtakes != null) overtakes += t.overtakes;
      if (t.lapsLed != null) lapsLed += t.lapsLed;
      if (t.laps != null) laps += t.laps;
      if (t.contacts === 0 && (t.laps ?? 0) > 0) cleanRaces += 1;
    }
  }

  // Streaks over the chronological championship rounds the driver started.
  let pointsStreak = 0, longestPointsStreak = 0, podiumStreak = 0, longestPodiumStreak = 0;
  for (const r of started) {
    const scored = (r.points ?? 0) > 0 || (r.status === "FINISHED" && r.position != null && r.position <= 10);
    pointsStreak = scored ? pointsStreak + 1 : 0;
    longestPointsStreak = Math.max(longestPointsStreak, pointsStreak);
    const podium = r.status === "FINISHED" && r.position != null && r.position <= 3;
    podiumStreak = podium ? podiumStreak + 1 : 0;
    longestPodiumStreak = Math.max(longestPodiumStreak, podiumStreak);
  }

  const wins = finished.filter((r) => r.position === 1);
  return {
    starts: started.length,
    wins: wins.length,
    podiums: finished.filter((r) => r.position <= 3).length,
    poles: started.filter((r) => r.grid === 1).length,
    frontRows: started.filter((r) => r.grid != null && r.grid <= 2).length,
    points: Math.round(points),
    pointsFinishes: rows.filter((r) => (r.points ?? 0) > 0 || (r.status === "FINISHED" && r.position != null && r.position <= 10)).length,
    fastestLaps,
    hatTricks: wins.filter((r) => r.grid === 1 && fastestByRace.get(r.raceId)).length,
    winsFromP6: wins.filter((r) => r.grid != null && r.grid >= 6).length,
    bestComeback: Math.max(0, ...finished.filter((r) => r.grid != null).map((r) => r.grid - r.position)),
    distinctWinTracks: new Set(wins.map((r) => groupKeyFor(r.race.track))).size,
    overtakes,
    lapsLed,
    laps,
    cleanRaces,
    longestPointsStreak,
    longestPodiumStreak,
    noDnfSeasons,
    fullSeasons,
    titles,
    pointsFromBackRow,
    photoFinishes,
  };
}

export async function getCockpitAchievements(prisma, driverId) {
  const ctx = await cockpitContext(prisma, driverId);
  if (!ctx) return null;
  const inputs = await buildAchievementInputs(prisma, ctx);
  const state = achievementStateFor(inputs);

  let pinned = [];
  try {
    const rows = await prisma.$queryRaw`SELECT "achievementsPinned" FROM "Driver" WHERE "id" = ${driverId}`;
    const parsed = rows[0]?.achievementsPinned ? JSON.parse(rows[0].achievementsPinned) : null;
    if (Array.isArray(parsed)) pinned = parsed.filter((k) => typeof k === "string");
  } catch {
    /* none pinned */
  }

  // Locked hidden entries go out masked — the surprise is the point.
  const shaped = state.map((a) =>
    a.hidden && !a.unlocked
      ? { key: a.key, cat: a.cat, hidden: true, unlocked: false, masked: true }
      : { ...a, masked: false }
  );
  return { achievements: shaped, pinned, unlockedCount: state.filter((a) => a.unlocked).length, total: state.length };
}

// --- race list + lap-level analysis -------------------------------------------

export async function getCockpitRaceList(prisma, driverId) {
  const ctx = await cockpitContext(prisma, driverId);
  if (!ctx) return null;
  const results = await prisma.raceResult.findMany({
    where: { driverId: { in: ctx.rows.map((r) => r.id) } },
    // Race.country is a raw-SQL column the generated client may not know —
    // the flag falls back to the static circuit table instead.
    include: { race: { select: { id: true, track: true, number: true, seasonId: true, isCompleted: true, isSpecialEvent: true, date: true } } },
  });
  const rowBySeason = new Map(ctx.rows.map((r) => [r.seasonId, r]));
  const races = results
    .filter((r) => r.race?.isCompleted)
    .map((r) => ({
      raceId: r.race.id,
      seasonNumber: rowBySeason.get(r.race.seasonId)?.season.number ?? null,
      number: r.race.number,
      track: r.race.track,
      country: countryFor(r.race.track) || null,
      date: r.race.date,
      special: r.race.isSpecialEvent,
      position: r.position,
      grid: r.grid,
      status: r.status,
      bestLapMs: r.bestLapMs,
      // Only seasons with an archived raw file can chart laps; the frontend
      // greys the rest out. Season number >= 5 is where the archive begins,
      // but the truth is checked again on the analysis call itself.
      hasArchive: (rowBySeason.get(r.race.seasonId)?.season.number ?? 0) >= 5,
    }))
    .sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0) || (b.number ?? 0) - (a.number ?? 0));
  return { races };
}

export async function getCockpitRaceAnalysis(prisma, driverId, raceId) {
  const ctx = await cockpitContext(prisma, driverId);
  if (!ctx) return null;
  const race = await prisma.race.findUnique({ where: { id: raceId }, include: { season: { select: { id: true, number: true } } } });
  if (!race) return null;
  const myRow = ctx.rows.find((r) => r.seasonId === race.seasonId);
  if (!myRow) return null; // not this person's race

  const [result, telemetry] = await Promise.all([
    prisma.raceResult.findUnique({ where: { raceId_driverId: { raceId, driverId: myRow.id } } }),
    telemetryForRace(prisma, raceId),
  ]);
  if (!result) return null;
  const tel = telemetry.get(myRow.id) || null;

  // Lap-level data from the archived raw JSON. GUID first; when the row has
  // no captured SteamID (old imports), fall back to an exact name match in
  // the file's classification.
  let analysis = null;
  const json = findArchiveFor(race.season?.number, race.number);
  if (json) {
    let guid = myRow.steamId || null;
    if (!guid) {
      const hit = (json.Result || []).find(
        (r) => r?.DriverName && r.DriverName.trim().toLowerCase() === myRow.name.trim().toLowerCase()
      );
      guid = hit?.DriverGuid || null;
    }
    if (guid) analysis = analyzeRaceFor(json, guid);
  }

  // Qualifying: own line + pole from the stored quali blob (when imported).
  let quali = null;
  try {
    const qr = await prisma.$queryRawUnsafe(`SELECT "qualiJson" FROM "Race" WHERE "id" = ?`, raceId);
    if (qr[0]?.qualiJson) {
      const blob = JSON.parse(qr[0].qualiJson);
      const entries = blob.entries || [];
      const mine = entries.find((e) => e.driverId === myRow.id);
      const pole = entries.map((e) => e.bestLapMs).filter((v) => v != null).sort((a, b) => a - b)[0] ?? null;
      if (mine) {
        quali = {
          position: mine.position ?? null,
          bestLapMs: mine.bestLapMs ?? null,
          poleMs: pole,
          gapToPoleMs: mine.bestLapMs != null && pole != null ? mine.bestLapMs - pole : null,
        };
      }
    }
  } catch {
    /* no quali stored */
  }

  return {
    race: {
      raceId: race.id,
      number: race.number,
      track: race.track,
      country: race.country || countryFor(race.track) || null,
      seasonNumber: race.season?.number ?? null,
      special: race.isSpecialEvent,
    },
    result: {
      position: result.position,
      grid: result.grid,
      status: result.status,
      points: result.points,
      bestLapMs: result.bestLapMs,
      totalTimeMs: result.totalTimeMs,
      penaltySeconds: result.penaltySeconds || 0,
    },
    telemetry: tel,
    quali,
    analysis,
  };
}

// --- career insights from the raw lap archives ----------------------------------
// Everything here exists ONLY in the archived AC files — true pace rank, lap-1
// starts, tyre drop-off, time lost off your own pace. Reading ~30 archives is
// a few hundred ms, so the finished aggregate is cached per driver.

const insightsCache = new Map(); // driverId -> { at, data }
const INSIGHTS_TTL_MS = 10 * 60 * 1000;

export async function getCockpitInsights(prisma, driverId) {
  const hit = insightsCache.get(driverId);
  if (hit && Date.now() - hit.at < INSIGHTS_TTL_MS) return hit.data;

  const ctx = await cockpitContext(prisma, driverId);
  if (!ctx) return null;

  const results = await prisma.raceResult.findMany({
    where: { driverId: { in: ctx.rows.map((r) => r.id) } },
    include: { race: { select: { id: true, track: true, number: true, seasonId: true, isCompleted: true, isSpecialEvent: true } } },
  });
  const rowBySeason = new Map(ctx.rows.map((r) => [r.seasonId, r]));
  const rows = results
    .filter((r) => r.race?.isCompleted && !r.race.isSpecialEvent && (rowBySeason.get(r.race.seasonId)?.season.number ?? 0) >= 5)
    .sort((a, b) => {
      const sa = rowBySeason.get(a.race.seasonId)?.season.number ?? 0;
      const sb = rowBySeason.get(b.race.seasonId)?.season.number ?? 0;
      return sa - sb || (a.race.number ?? 0) - (b.race.number ?? 0);
    });

  const races = [];
  for (const r of rows) {
    const seasonNumber = rowBySeason.get(r.race.seasonId)?.season.number;
    const json = findArchiveFor(seasonNumber, r.race.number);
    if (!json) continue;
    const myRow = rowBySeason.get(r.race.seasonId);
    let guid = myRow?.steamId || null;
    if (!guid) {
      const hitRow = (json.Result || []).find(
        (x) => x?.DriverName && x.DriverName.trim().toLowerCase() === myRow?.name?.trim().toLowerCase()
      );
      guid = hitRow?.DriverGuid || null;
    }
    if (!guid) continue;
    const ins = raceInsightsFor(json, guid);
    if (!ins) continue;
    races.push({
      seasonNumber,
      number: r.race.number,
      track: r.race.track,
      country: countryFor(r.race.track) || null,
      grid: r.grid,
      finishPos: r.status === "FINISHED" ? r.position : null,
      status: r.status,
      ...ins,
    });
  }
  if (!races.length) {
    const empty = { races: [], pace: null, starts: null, tyres: [], lostTime: null };
    insightsCache.set(driverId, { at: Date.now(), data: empty });
    return empty;
  }

  // --- aggregates ---------------------------------------------------------------
  const avg2 = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

  const paceRanked = races.filter((r) => r.paceRank != null);
  const withFinish = paceRanked.filter((r) => r.finishPos != null);
  const pace = paceRanked.length
    ? {
        avgPaceRank: avg2(paceRanked.map((r) => r.paceRank)),
        avgFinish: avg2(withFinish.map((r) => r.finishPos)),
        // positive = you finish better than your raw speed; negative = raw
        // speed says you should be scoring more than you do.
        deliveryDelta: withFinish.length
          ? Math.round((avg2(withFinish.map((r) => r.paceRank)) - avg2(withFinish.map((r) => r.finishPos))) * 10) / 10
          : null,
        bestPaceRank: Math.min(...paceRanked.map((r) => r.paceRank)),
        topPaceRaces: paceRanked.filter((r) => r.paceRank <= 3).length,
        avgGapToBestMs: avg2(paceRanked.map((r) => r.gapToBestPaceMs).filter((v) => v != null)),
      }
    : null;

  const started = races.filter((r) => r.grid != null && r.lap1Pos != null);
  const startDeltas = started.map((r) => r.grid - r.lap1Pos); // positive = places gained on lap 1
  const bestStart = started.length
    ? started.reduce((best, r) => ((r.grid - r.lap1Pos) > (best.grid - best.lap1Pos) ? r : best), started[0])
    : null;
  const starts = started.length
    ? {
        races: started.length,
        avgLap1Delta: avg2(startDeltas),
        gainedStarts: startDeltas.filter((d) => d > 0).length,
        lostStarts: startDeltas.filter((d) => d < 0).length,
        bestStart: bestStart && bestStart.grid - bestStart.lap1Pos > 0
          ? { track: bestStart.track, seasonNumber: bestStart.seasonNumber, gained: bestStart.grid - bestStart.lap1Pos }
          : null,
      }
    : null;

  // Tyre drop-off per compound, weighted by stint length.
  const byTyre = new Map();
  for (const r of races) {
    for (const s of r.stints) {
      const key = String(s.tyre || "?").toUpperCase();
      const cur = byTyre.get(key) || { tyre: key, laps: 0, weighted: 0, stints: 0, longest: 0 };
      cur.laps += s.laps;
      cur.weighted += s.degMsPerLap * s.laps;
      cur.stints += 1;
      cur.longest = Math.max(cur.longest, s.laps);
      byTyre.set(key, cur);
    }
  }
  const tyres = [...byTyre.values()]
    .filter((t) => t.laps >= 15)
    .map((t) => ({ tyre: t.tyre, laps: t.laps, stints: t.stints, longestStint: t.longest, degMsPerLap: Math.round(t.weighted / t.laps) }))
    .sort((a, b) => b.laps - a.laps);

  const offPace = races.map((r) => r.offPaceMs).filter((v) => v != null);
  const lostTime = offPace.length
    ? {
        totalMs: Math.round(offPace.reduce((a, b) => a + b, 0)),
        perRaceMs: Math.round(offPace.reduce((a, b) => a + b, 0) / offPace.length),
        calmest: races.filter((r) => r.offPaceMs != null).sort((a, b) => a.offPaceMs - b.offPaceMs)[0] || null,
      }
    : null;

  const data = { races, pace, starts, tyres, lostTime };
  insightsCache.set(driverId, { at: Date.now(), data });
  return data;
}

// --- goals + pins (writes) ----------------------------------------------------

export async function saveCockpitGoals(prisma, driverId, goals) {
  const clean = (Array.isArray(goals) ? goals : [])
    .slice(0, 8)
    .map((g) => ({
      id: String(g?.id || "").slice(0, 40) || Math.random().toString(36).slice(2, 10),
      text: String(g?.text || "").trim().slice(0, 120),
      done: !!g?.done,
    }))
    .filter((g) => g.text);
  const value = clean.length ? JSON.stringify(clean) : null;
  await prisma.$executeRaw`UPDATE "Driver" SET "cockpitGoals" = ${value} WHERE "id" = ${driverId}`;
  return clean;
}

export async function savePinnedAchievements(prisma, driverId, keys, unlockedKeys) {
  const clean = (Array.isArray(keys) ? keys : [])
    .filter((k) => typeof k === "string" && unlockedKeys.has(k))
    .slice(0, 3);
  const value = clean.length ? JSON.stringify(clean) : null;
  await prisma.$executeRaw`UPDATE "Driver" SET "achievementsPinned" = ${value} WHERE "id" = ${driverId}`;
  return clean;
}
