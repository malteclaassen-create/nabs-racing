import { Router } from "express";
import prisma from "../db.js";
import { getSettings, publicSettings } from "../lib/settings.js";
import { buildStandings } from "../lib/standings.js";
import { racePoints } from "../lib/points.js";
import { requireUser } from "../auth.js";
import { liveConfigured } from "../live/relay.js";

const router = Router();

const resultInclude = { driver: { include: { team: true } }, team: true };

// The season asked for (?season=<id>), else the current one, else the newest.
export async function resolveSeason(id) {
  if (id) {
    const s = await prisma.season.findUnique({ where: { id: Number(id) } });
    if (s) return s;
  }
  return (
    (await prisma.season.findFirst({ where: { isCurrent: true } })) ||
    (await prisma.season.findFirst({ orderBy: { id: "desc" } }))
  );
}

const teamOut = (t) => (t ? { id: t.id, name: t.name, color: t.color } : null);
const driverOut = (d) =>
  d ? { id: d.id, name: d.name, number: d.number, country: d.country, team: teamOut(d.team) } : null;

function resultsOut(race, settings) {
  const { points, fastestId } = racePoints(race, settings);
  return [...race.results]
    .sort((a, b) => a.position - b.position)
    .map((r) => ({
      id: r.id,
      position: r.position,
      status: r.status,
      laps: r.laps,
      totalTimeMs: r.totalTimeMs,
      bestLapMs: r.bestLapMs,
      carModel: r.carModel,
      points: points.get(r.id) || 0,
      pointsAdjust: r.pointsAdjust,
      fastestLap: r.id === fastestId,
      driver: { id: r.driver.id, name: r.driver.name, number: r.driver.number, country: r.driver.country },
      team: teamOut(r.team),
    }));
}

async function seasonRaces(season) {
  if (!season) return [];
  return prisma.race.findMany({
    where: { seasonId: season.id },
    include: { results: { include: resultInclude }, _count: { select: { signups: { where: { status: "in" } } } } },
    orderBy: [{ round: "asc" }, { startsAt: "asc" }],
  });
}

router.get("/health", (_req, res) => res.json({ ok: true }));

router.get("/settings", async (_req, res) => {
  res.json({ ...(await publicSettings()), liveEnabled: await liveConfigured() });
});

router.get("/seasons", async (_req, res) => {
  const seasons = await prisma.season.findMany({ orderBy: { id: "desc" } });
  res.json(seasons.map((s) => ({ id: s.id, name: s.name, isCurrent: s.isCurrent })));
});

router.get("/standings", async (req, res) => {
  const season = await resolveSeason(req.query.season);
  const races = await seasonRaces(season);
  res.json({ season, ...buildStandings(races, await getSettings()) });
});

router.get("/races", async (req, res) => {
  const season = await resolveSeason(req.query.season);
  const settings = await getSettings();
  const races = await seasonRaces(season);
  res.json({
    season,
    races: races.map((race) => ({
      id: race.id,
      round: race.round,
      name: race.name,
      track: race.track,
      startsAt: race.startsAt,
      pointsMultiplier: race.pointsMultiplier,
      done: race.results.length > 0,
      signedUp: race._count.signups,
      podium: race.results.length ? resultsOut(race, settings).slice(0, 3) : [],
    })),
  });
});

router.get("/races/:id", async (req, res) => {
  const race = await prisma.race.findUnique({
    where: { id: Number(req.params.id) || 0 },
    include: {
      season: true,
      results: { include: resultInclude },
      signups: { include: { user: { include: { driver: { include: { team: true } } } } }, orderBy: { updatedAt: "asc" } },
    },
  });
  if (!race) return res.status(404).json({ error: "Race not found." });
  const settings = await getSettings();
  const mine = req.user ? race.signups.find((s) => s.userId === req.user.id) : null;
  res.json({
    id: race.id,
    round: race.round,
    name: race.name,
    track: race.track,
    startsAt: race.startsAt,
    notes: race.notes,
    pointsMultiplier: race.pointsMultiplier,
    season: { id: race.season.id, name: race.season.name },
    results: resultsOut(race, settings),
    signups: race.signups.map((s) => ({
      userId: req.isAdmin ? s.userId : undefined,
      status: s.status,
      name: s.user.driver?.name || s.user.name,
      avatar: s.user.avatar,
      team: teamOut(s.user.driver?.team),
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

router.get("/home", async (_req, res) => {
  const season = await resolveSeason();
  const settings = await getSettings();
  const races = await seasonRaces(season);
  const standings = buildStandings(races, settings);
  const now = Date.now();
  const next = races.find((r) => !r.results.length && new Date(r.startsAt).getTime() > now - 3 * 60 * 60 * 1000);
  const last = [...races].reverse().find((r) => r.results.length);
  res.json({
    season,
    nextRace: next
      ? { id: next.id, round: next.round, name: next.name, track: next.track, startsAt: next.startsAt, signedUp: next._count.signups }
      : null,
    lastRace: last
      ? { id: last.id, round: last.round, name: last.name, track: last.track, startsAt: last.startsAt, podium: resultsOut(last, settings).slice(0, 3) }
      : null,
    drivers: standings.drivers.slice(0, 5),
    teams: standings.teams.slice(0, 5),
    roundsDone: races.filter((r) => r.results.length).length,
    roundsTotal: races.length,
  });
});

router.get("/drivers/:id", async (req, res) => {
  const driver = await prisma.driver.findUnique({ where: { id: Number(req.params.id) || 0 }, include: { team: true } });
  if (!driver) return res.status(404).json({ error: "Driver not found." });
  const season = await resolveSeason(req.query.season);
  const settings = await getSettings();
  const races = await seasonRaces(season);
  const standings = buildStandings(races, settings);
  const row = standings.drivers.find((d) => d.id === driver.id) || null;
  const results = [];
  for (const race of races) {
    if (!race.results.length) continue;
    const mine = resultsOut(race, settings).find((r) => r.driver.id === driver.id);
    if (mine) results.push({ race: { id: race.id, round: race.round, name: race.name, track: race.track }, ...mine });
  }
  res.json({ driver: driverOut(driver), season, standing: row, results });
});

router.get("/teams", async (req, res) => {
  const season = await resolveSeason(req.query.season);
  const standings = buildStandings(await seasonRaces(season), await getSettings());
  const teams = await prisma.team.findMany({
    // archived teams still show in a season they scored in
    where: { OR: [{ archived: false }, { id: { in: standings.teams.map((t) => t.id) } }] },
    include: { drivers: { orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });
  const byId = new Map(standings.teams.map((t) => [t.id, t]));
  res.json({
    season,
    rounds: standings.rounds,
    teams: teams
      .map((t) => ({
        ...teamOut(t),
        standing: byId.get(t.id) || null,
        drivers: t.drivers.map((d) => ({ id: d.id, name: d.name, number: d.number, country: d.country })),
      }))
      .sort((a, b) => (a.standing?.position ?? 999) - (b.standing?.position ?? 999) || a.name.localeCompare(b.name)),
  });
});

router.get("/downloads", async (_req, res) => {
  const list = await prisma.download.findMany({ orderBy: [{ order: "asc" }, { id: "asc" }] });
  res.json(list.map(({ fileName, ...d }) => ({ ...d, isFile: !!fileName })));
});

export default router;
