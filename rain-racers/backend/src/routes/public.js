import { Router } from "express";
import prisma from "../db.js";
import { getSettings, publicSettings } from "../lib/settings.js";
import { publicStandings } from "../lib/standings.js";
import { racePoints, sessionOf, poleDriverId } from "../lib/points.js";
import { driverSeasonStats, headToHead, teamAt } from "../lib/stats.js";
import { resolveSeason, seasonRaces, seasonStandings, resultInclude } from "../lib/seasonData.js";
import { requireUser } from "../auth.js";
import { liveSeries } from "../live/relay.js";

const router = Router();

const teamOut = (t) => (t ? { id: t.id, name: t.name, color: t.color } : null);
const seriesOut = (s) => (s ? { id: s.id, name: s.name, slug: s.slug, color: s.color, schedule: s.schedule } : null);
const seasonOut = (s) => (s ? { id: s.id, name: s.name, isCurrent: s.isCurrent, series: seriesOut(s.series) } : null);
// Teams alphabetically, drivers without a team last.
const byTeamThenName = (x, y) => (x ? 0 : 1) - (y ? 0 : 1) || (x && y ? x.localeCompare(y) : 0);
const driverOut = (d) => ({ id: d.id, name: d.name, number: d.number, country: d.country });

// The results of one session of a round, ordered, with points, grid and
// places gained.
function sessionOut(race, session, points, fastest) {
  const qualiPos = new Map((race.qualifying || []).map((q) => [q.driverId, q.position]));
  return race.results
    .filter((r) => sessionOf(r) === session)
    .sort((a, b) => a.position - b.position)
    .map((r) => {
      const grid = r.grid ?? (session === "FEATURE" ? qualiPos.get(r.driverId) ?? null : null);
      return {
        id: r.id,
        position: r.position,
        status: r.status,
        laps: r.laps,
        totalTimeMs: r.totalTimeMs,
        penaltyMs: r.penaltyMs,
        penaltyNote: r.penaltyNote,
        bestLapMs: r.bestLapMs,
        carModel: r.carModel,
        grid,
        gained: grid != null && r.status === "FIN" ? grid - r.position : null,
        points: points.get(r.id) || 0,
        pointsAdjust: r.pointsAdjust,
        fastestLap: r.id === fastest[session],
        driver: driverOut(r.driver),
        team: teamOut(r.team),
      };
    });
}

function raceSummary(race, season, settings) {
  const done = race.results.length > 0;
  const { points, fastest } = racePoints(race, season, settings);
  return {
    id: race.id,
    round: race.round,
    name: race.name,
    track: race.track,
    startsAt: race.startsAt,
    hasSprint: race.hasSprint,
    pointsMultiplier: race.pointsMultiplier,
    customPoints: !!race.pointsTable,
    done,
    signedUp: race._count?.signups ?? 0,
    podium: done ? sessionOut(race, "FEATURE", points, fastest).slice(0, 3) : [],
  };
}

router.get("/health", (_req, res) => res.json({ ok: true }));

router.get("/settings", async (_req, res) => {
  res.json({ ...(await publicSettings()), liveEnabled: (await liveSeries()).length > 0 });
});

router.get("/series", async (_req, res) => {
  const [list, live] = await Promise.all([
    prisma.series.findMany({ orderBy: [{ order: "asc" }, { id: "asc" }], include: { seasons: { orderBy: { id: "desc" } } } }),
    liveSeries(),
  ]);
  res.json(
    list.map((s) => {
      const current = s.seasons.find((x) => x.isCurrent) || s.seasons[0] || null;
      return {
        ...seriesOut(s),
        description: s.description,
        live: live.some((l) => l.slug === s.slug),
        currentSeason: current ? { id: current.id, name: current.name } : null,
        seasons: s.seasons.map((x) => ({ id: x.id, name: x.name, isCurrent: x.isCurrent })),
      };
    }),
  );
});

// The league home: every series at a glance, the next races and the latest
// results across all of them.
router.get("/overview", async (_req, res) => {
  const settings = await getSettings();
  const series = await prisma.series.findMany({ orderBy: [{ order: "asc" }, { id: "asc" }] });
  const now = Date.now();
  const cards = [];
  const upcoming = [];
  const latest = [];
  for (const s of series) {
    const season = await resolveSeason({ series: s.slug });
    const races = season ? await seasonRaces(season.id) : [];
    const standings = await seasonStandings(season, races);
    const next = races.find((r) => !r.results.length && new Date(r.startsAt).getTime() > now - 3 * 60 * 60 * 1000);
    cards.push({
      series: { ...seriesOut(s), description: s.description },
      season: season ? { id: season.id, name: season.name } : null,
      roundsDone: races.filter((r) => r.results.length).length,
      roundsTotal: races.length,
      leader: standings.drivers[0] ? { ...driverOut(standings.drivers[0]), points: standings.drivers[0].points, team: standings.drivers[0].team } : null,
      nextRace: next ? raceSummary(next, season, settings) : null,
    });
    for (const r of races) {
      const item = { ...raceSummary(r, season, settings), series: seriesOut(s) };
      if (r.results.length) latest.push(item);
      else if (new Date(r.startsAt).getTime() > now - 3 * 60 * 60 * 1000) upcoming.push(item);
    }
  }
  upcoming.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  latest.sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
  res.json({ series: cards, upcoming: upcoming.slice(0, 6), latest: latest.slice(0, 4) });
});

// The home of one series (its current or the asked-for season).
router.get("/home", async (req, res) => {
  const season = await resolveSeason(req.query);
  const settings = await getSettings();
  const races = season ? await seasonRaces(season.id) : [];
  const standings = await seasonStandings(season, races);
  const now = Date.now();
  const next = races.find((r) => !r.results.length && new Date(r.startsAt).getTime() > now - 3 * 60 * 60 * 1000);
  const last = [...races].reverse().find((r) => r.results.length);
  res.json({
    season: seasonOut(season),
    nextRace: next ? raceSummary(next, season, settings) : null,
    lastRace: last ? raceSummary(last, season, settings) : null,
    drivers: publicStandings(standings).drivers.slice(0, 5),
    teams: publicStandings(standings).teams.slice(0, 5),
    progression: { ...standings.progression, drivers: standings.progression.drivers.slice(0, 6), teams: standings.progression.teams.slice(0, 6) },
    roundsDone: races.filter((r) => r.results.length).length,
    roundsTotal: races.length,
  });
});

router.get("/standings", async (req, res) => {
  const season = await resolveSeason(req.query);
  const standings = await seasonStandings(season);
  res.json({
    season: seasonOut(season),
    dropWorst: season?.dropWorst ?? 0,
    ...publicStandings(standings),
  });
});

router.get("/races", async (req, res) => {
  const season = await resolveSeason(req.query);
  const settings = await getSettings();
  const races = season ? await seasonRaces(season.id) : [];
  res.json({ season: seasonOut(season), races: races.map((r) => raceSummary(r, season, settings)) });
});

router.get("/races/:id", async (req, res) => {
  const race = await prisma.race.findUnique({
    where: { id: Number(req.params.id) || 0 },
    include: {
      season: { include: { series: true } },
      results: { include: resultInclude },
      qualifying: { include: { driver: true }, orderBy: { position: "asc" } },
      signups: { include: { user: { include: { driver: true } } }, orderBy: { updatedAt: "asc" } },
    },
  });
  if (!race) return res.status(404).json({ error: "Race not found." });
  const settings = await getSettings();
  const { points, fastest } = racePoints(race, race.season, settings);
  const mine = req.user ? race.signups.find((s) => s.userId === req.user.id) : null;
  // the team each member drives for in this round
  const entries = await prisma.entry.findMany({ where: { seasonId: race.seasonId }, include: { team: true } });
  const transfers = await prisma.transfer.findMany({ where: { seasonId: race.seasonId }, include: { team: true } });
  const teams = await prisma.team.findMany({ where: { seriesId: race.season.seriesId } });
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const teamOfDriver = (driverId) => {
    const entry = entries.find((e) => e.driverId === driverId);
    if (!entry) return null;
    return teamById.get(teamAt({ entry, transfers: transfers.filter((t) => t.driverId === driverId) }, race.round)) || null;
  };
  const pole = poleDriverId(race);
  res.json({
    id: race.id,
    round: race.round,
    name: race.name,
    track: race.track,
    startsAt: race.startsAt,
    notes: race.notes,
    hasSprint: race.hasSprint,
    pointsMultiplier: race.pointsMultiplier,
    customPoints: !!race.pointsTable,
    season: seasonOut(race.season),
    sessions: {
      FEATURE: sessionOut(race, "FEATURE", points, fastest),
      SPRINT: sessionOut(race, "SPRINT", points, fastest),
    },
    qualifying: race.qualifying.map((q, i, list) => ({
      position: q.position,
      bestLapMs: q.bestLapMs,
      gapMs: q.bestLapMs && list[0]?.bestLapMs ? q.bestLapMs - list[0].bestLapMs : null,
      driver: driverOut(q.driver),
      team: teamOut(teamOfDriver(q.driverId)),
    })),
    poleDriverId: pole,
    signups: race.signups.map((s) => ({
      userId: req.isAdmin ? s.userId : undefined,
      status: s.status,
      name: s.user.driver?.name || s.user.name,
      avatar: s.user.avatar,
      team: teamOut(s.user.driver ? teamOfDriver(s.user.driver.id) : null),
    })),
    mySignup: mine?.status ?? null,
    signupOpen: race.results.length === 0,
  });
});

router.put("/races/:id/signup", requireUser, async (req, res) => {
  const status = req.body?.status;
  const race = await prisma.race.findUnique({ where: { id: Number(req.params.id) || 0 }, include: { _count: { select: { results: true } } } });
  if (!race) return res.status(404).json({ error: "Race not found." });
  if (race._count.results > 0) return res.status(409).json({ error: "This race is over." });
  if (status === null || status === "none") {
    await prisma.signup.deleteMany({ where: { raceId: race.id, userId: req.user.id } });
    return res.json({ status: null });
  }
  if (!["in", "maybe", "out"].includes(status)) return res.status(400).json({ error: "Unknown status." });
  await prisma.signup.upsert({
    where: { raceId_userId: { raceId: race.id, userId: req.user.id } },
    create: { raceId: race.id, userId: req.user.id, status },
    update: { status },
  });
  res.json({ status });
});

// A driver's page: the seasons they raced in (any series), the numbers of
// one of them, the round-by-round form, and the career in all of them.
router.get("/drivers/:id", async (req, res) => {
  const driver = await prisma.driver.findUnique({
    where: { id: Number(req.params.id) || 0 },
    include: { entries: { include: { season: { include: { series: true } }, team: true } } },
  });
  if (!driver) return res.status(404).json({ error: "Driver not found." });
  const settings = await getSettings();
  // every season they have an entry in or a result in
  const resultSeasons = await prisma.race.findMany({
    where: { results: { some: { driverId: driver.id } } },
    select: { seasonId: true },
    distinct: ["seasonId"],
  });
  const seasonIds = [...new Set([...driver.entries.map((e) => e.seasonId), ...resultSeasons.map((r) => r.seasonId)])];
  const seasons = await prisma.season.findMany({ where: { id: { in: seasonIds } }, include: { series: true }, orderBy: { id: "desc" } });

  const career = [];
  for (const season of seasons) {
    const races = await seasonRaces(season.id);
    const standings = await seasonStandings(season, races);
    const row = standings.drivers.find((d) => d.id === driver.id);
    const { stats } = driverSeasonStats(driver.id, races, settings, season);
    career.push({
      season: seasonOut(season),
      position: row?.position ?? null,
      points: row?.points ?? 0,
      champion: !!row?.champion && row.position === 1,
      team: row?.team ?? teamOut(driver.entries.find((e) => e.seasonId === season.id)?.team),
      starts: stats.starts,
      wins: stats.wins,
      podiums: stats.podiums,
      poles: stats.poles,
    });
  }

  const wanted = Number(req.query.season) || null;
  const season = seasons.find((s) => s.id === wanted) || seasons[0] || null;
  let detail = null;
  if (season) {
    const races = await seasonRaces(season.id);
    const standings = await seasonStandings(season, races);
    const { stats, form } = driverSeasonStats(driver.id, races, settings, season);
    const entry = driver.entries.find((e) => e.seasonId === season.id);
    const row = standings.drivers.find((d) => d.id === driver.id);
    detail = {
      season: seasonOut(season),
      standing: row ? { position: row.position, points: row.points, champion: !!row.champion } : null,
      team: row?.team ?? teamOut(entry?.team),
      number: entry?.number ?? driver.number,
      stats,
      form,
      rivals: standings.drivers.filter((d) => d.id !== driver.id).map((d) => ({ id: d.id, name: d.name })),
    };
  }
  res.json({ driver: driverOut(driver), career, detail });
});

router.get("/drivers/:id/h2h", async (req, res) => {
  const a = Number(req.params.id) || 0;
  const b = Number(req.query.other) || 0;
  const season = await resolveSeason(req.query);
  if (!season || !b) return res.status(400).json({ error: "Season and other driver are needed." });
  const [races, other] = await Promise.all([seasonRaces(season.id), prisma.driver.findUnique({ where: { id: b } })]);
  if (!other) return res.status(404).json({ error: "Driver not found." });
  res.json({ other: driverOut(other), ...headToHead(a, b, races, await getSettings(), season) });
});

// The teams of a series: line-up for the next round (entry list plus
// transfers), standing, and points per round.
router.get("/teams", async (req, res) => {
  const season = await resolveSeason(req.query);
  if (!season) return res.json({ season: null, rounds: [], teams: [] });
  const races = await seasonRaces(season.id);
  const standings = publicStandings(await seasonStandings(season, races));
  const [teams, entries, transfers] = await Promise.all([
    prisma.team.findMany({ where: { seriesId: season.seriesId }, orderBy: { name: "asc" } }),
    prisma.entry.findMany({ where: { seasonId: season.id }, include: { driver: true } }),
    prisma.transfer.findMany({ where: { seasonId: season.id } }),
  ]);
  const nextRound = (races.find((r) => !r.results.length) || races[races.length - 1])?.round ?? 1;
  const lineup = new Map();
  for (const e of entries) {
    const teamId = teamAt({ entry: e, transfers: transfers.filter((t) => t.driverId === e.driverId) }, nextRound);
    if (!teamId) continue;
    const list = lineup.get(teamId) || [];
    list.push({ ...driverOut(e.driver), number: e.number ?? e.driver.number });
    lineup.set(teamId, list);
  }
  const byId = new Map(standings.teams.map((t) => [t.id, t]));
  res.json({
    season: seasonOut(season),
    rounds: standings.rounds,
    progression: { rounds: standings.progression.rounds, teams: standings.progression.teams },
    teams: teams
      .filter((t) => !t.archived || byId.has(t.id))
      .map((t) => ({
        ...teamOut(t),
        standing: byId.get(t.id) || null,
        drivers: (lineup.get(t.id) || []).sort((x, y) => x.name.localeCompare(y.name)),
      }))
      .sort((a, b) => (a.standing?.position ?? 999) - (b.standing?.position ?? 999) || a.name.localeCompare(b.name)),
  });
});

// The transfer market: every driver's team round by round, and the moves.
router.get("/transfers", async (req, res) => {
  const season = await resolveSeason(req.query);
  if (!season) return res.json({ season: null, rounds: [], rows: [], moves: [] });
  const [races, entries, transfers, teams] = await Promise.all([
    prisma.race.findMany({ where: { seasonId: season.id }, orderBy: { round: "asc" }, include: { results: { where: { session: "FEATURE" }, select: { driverId: true, status: true } } } }),
    prisma.entry.findMany({ where: { seasonId: season.id }, include: { driver: true, team: true } }),
    prisma.transfer.findMany({ where: { seasonId: season.id }, include: { driver: true, team: true }, orderBy: [{ fromRound: "asc" }, { id: "asc" }] }),
    prisma.team.findMany({ where: { seriesId: season.seriesId } }),
  ]);
  const teamById = new Map(teams.map((t) => [t.id, teamOut(t)]));
  const rows = entries
    .map((e) => {
      const mine = transfers.filter((t) => t.driverId === e.driverId);
      return {
        driver: driverOut(e.driver),
        cells: races.map((race) => {
          const teamId = teamAt({ entry: e, transfers: mine }, race.round);
          const result = race.results.find((r) => r.driverId === e.driverId);
          return { raceId: race.id, team: teamById.get(teamId) || null, raced: !!result && result.status !== "DNS", done: race.results.length > 0 };
        }),
      };
    })
    .sort((a, b) => byTeamThenName(a.cells.at(-1)?.team?.name, b.cells.at(-1)?.team?.name) || a.driver.name.localeCompare(b.driver.name));
  const doneRounds = new Set(races.filter((r) => r.results.length).map((r) => r.round));
  res.json({
    season: seasonOut(season),
    rounds: races.map((r) => ({ id: r.id, round: r.round, track: r.track, done: r.results.length > 0 })),
    rows,
    moves: transfers.map((t) => {
      const entry = entries.find((e) => e.driverId === t.driverId);
      const before = teamAt({ entry, transfers: transfers.filter((x) => x.driverId === t.driverId && x.id !== t.id && (x.fromRound < t.fromRound || (x.fromRound === t.fromRound && x.id < t.id))) }, t.fromRound);
      return {
        id: t.id,
        driver: driverOut(t.driver),
        from: teamById.get(before) || null,
        to: teamOut(t.team),
        fromRound: t.fromRound,
        upcoming: !doneRounds.has(t.fromRound),
      };
    }),
  });
});

router.get("/downloads", async (_req, res) => {
  const list = await prisma.download.findMany({ orderBy: [{ order: "asc" }, { id: "asc" }] });
  res.json(list.map(({ fileName, ...d }) => ({ ...d, isFile: !!fileName })));
});

export default router;
