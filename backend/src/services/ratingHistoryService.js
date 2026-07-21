// ---------------------------------------------------------------------------
// Rating history for the driver-rating detail page: the season replayed round
// by round through the real rating formula. There are no stored snapshots on
// purpose — getDriverRatings recomputes from the results every time, so the
// history here is computed the same way: "the field as of round 1", "as of
// round 2", ... via the upToRaceNumber cut. That keeps the curve consistent
// with the current formula even after the admin retunes the weights.
//
// Alongside the curve, each round carries the driver's own facts from that
// race (position, grid, places gained, contacts, overtakes, penalties, DNF),
// so the page can say in plain words what pushed a rating up or down.
//
// Replaying N rounds means N full rating computations — cheap enough on a
// league-sized field, but not free, so results are cached for a few minutes
// per driver (same spirit as the standings cache in careerRatingService).
// ---------------------------------------------------------------------------
import { getDriverRatings } from "./driverRatingsService.js";
import { telemetryBySeason } from "../lib/telemetryRead.js";
import { getLinkedDriverIds } from "../lib/persons.js";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // driverId -> { at, value }
const careerCache = new Map(); // `${driverId}|${perRace}` -> { at, value }

export function invalidateRatingHistoryCache() {
  cache.clear();
  careerCache.clear();
}

// The seasons of one person, oldest first, scoped to the series their current
// row belongs to (the career window never crosses series either).
async function personSeasons(prisma, driverId) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver?.seasonId) return null;
  const linkedIds = await getLinkedDriverIds(prisma, driverId);
  const rows = await prisma.driver.findMany({
    where: { id: { in: linkedIds } },
    select: { id: true, seasonId: true, season: { select: { id: true, number: true, name: true } } },
  });
  const seriesOf = async (seasonId) => {
    try {
      const r = await prisma.$queryRawUnsafe(`SELECT "seriesId" FROM "Season" WHERE "id" = ?`, seasonId);
      return r[0]?.seriesId ?? null;
    } catch {
      return null; // no series column on a fresh checkout: treat all as one
    }
  };
  const seriesId = await seriesOf(driver.seasonId);
  const out = [];
  for (const row of rows) {
    if (!row.season) continue;
    if (seriesId !== null && (await seriesOf(row.seasonId)) !== seriesId) continue;
    out.push(row);
  }
  out.sort((a, b) => (a.season.number ?? 0) - (b.season.number ?? 0));
  return out;
}

// Season-to-season (or race-to-race) deltas over a finished point list.
function attachDeltas(points) {
  let prev = null;
  for (const p of points) {
    p.delta = prev ? Object.fromEntries(["overall", "exp", "pac", "rac", "aha"].map((k) => [k, p.ratings[k] - prev[k]])) : null;
    prev = p.ratings;
  }
  return points;
}

// ---------------------------------------------------------------------------
// The all-time curve: EVERY race of every season this person has driven,
// replayed the same way the single season is (the field "as of round N" of
// that season). Scoped to the series of the passed driver row, since the
// career window itself never crosses series.
//
// This is the expensive one — one full field computation per round of every
// season — so it is cached for a few minutes per driver and skips the
// telemetry detail the season view carries (the tooltip only needs the
// result). The standings cache inside careerRatingService absorbs most of the
// repeated work.
// ---------------------------------------------------------------------------
// `perRace: false` (the default) is the CHEAP one: a single point per season,
// its final standing — one rating computation per season, so it stays fast
// however many seasons a career grows to. `perRace: true` replays every round
// of every season and is only fetched when the reader asks for that detail.
export async function getDriverCareerRatings(prisma, driverId, { perRace = false } = {}) {
  const key = `${driverId}|${perRace ? "race" : "season"}`;
  const hit = careerCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const seasons = await personSeasons(prisma, driverId);
  if (!seasons) return null;

  const points = [];
  for (const row of seasons) {
    // No `select` on purpose: `country` is a raw-SQL managed column the
    // generated client may not know, which makes an explicit select throw.
    const races = await prisma.race.findMany({
      where: { seasonId: row.seasonId, isSpecialEvent: false, isCompleted: true },
      orderBy: { number: "asc" },
    });
    // A season with nothing scored yet (a brand-new one) simply adds no point.
    if (!races.length) continue;

    const seasonLabel = row.season.name || `Season ${row.season.number}`;

    if (!perRace) {
      const field = await getDriverRatings(prisma, row.seasonId);
      const idx = field.findIndex((r) => r.driverId === row.id);
      if (idx < 0) continue; // no starts that season -> no rating, no point
      const me = field[idx];
      points.push({
        raceId: row.seasonId,
        number: row.season.number,
        track: seasonLabel,
        seasonNumber: row.season.number,
        seasonName: seasonLabel,
        ratings: me.ratings,
        provisional: me.provisional,
        rank: idx + 1,
        fieldSize: field.length,
        starts: me.starts,
        wins: me.wins,
        podiums: me.podiums,
        races: races.length,
      });
      continue;
    }

    const raceIds = races.map((r) => r.id);
    const myResults = await prisma.raceResult.findMany({
      where: { driverId: row.id, raceId: { in: raceIds } },
      select: { raceId: true, status: true, position: true, grid: true },
    });
    const resultByRace = new Map(myResults.map((r) => [r.raceId, r]));

    for (const race of races) {
      const field = await getDriverRatings(prisma, row.seasonId, { upToRaceNumber: race.number });
      const idx = field.findIndex((r) => r.driverId === row.id);
      if (idx < 0) continue; // not rated yet at that point of that season
      const me = field[idx];
      const res = resultByRace.get(race.id) || null;
      const started = !!res && res.status !== "DNS";
      const finished = started && res.status === "FINISHED" && res.position != null;
      points.push({
        raceId: race.id,
        number: race.number,
        track: race.track,
        country: race.country || null,
        seasonNumber: row.season.number,
        seasonName: seasonLabel,
        ratings: me.ratings,
        provisional: me.provisional,
        rank: idx + 1,
        fieldSize: field.length,
        race: {
          raced: started,
          status: res ? res.status : null,
          position: finished ? res.position : null,
          grid: started && res.grid != null ? res.grid : null,
        },
      });
    }
  }

  const value = { points: attachDeltas(points) };
  careerCache.set(key, { at: Date.now(), value });
  return value;
}

export async function getDriverRatingHistory(prisma, driverId) {
  const hit = cache.get(driverId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const driver = await prisma.driver.findUnique({ where: { id: driverId }, include: { team: true } });
  if (!driver || !driver.seasonId) return null;

  const [races, telemetry] = await Promise.all([
    prisma.race.findMany({
      where: { seasonId: driver.seasonId, isSpecialEvent: false, isCompleted: true },
      orderBy: { number: "asc" },
    }),
    telemetryBySeason(prisma, driver.seasonId),
  ]);

  // This driver's own result rows plus per-race contacts (raw-SQL column).
  const raceIds = races.map((r) => r.id);
  const myResults = raceIds.length
    ? await prisma.raceResult.findMany({ where: { driverId, raceId: { in: raceIds } } })
    : [];
  const resultByRace = new Map(myResults.map((r) => [r.raceId, r]));
  let contactByRace = new Map();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "raceId", "contacts" FROM "RaceResult" WHERE "driverId" = ? AND "contacts" IS NOT NULL`,
      driverId
    );
    contactByRace = new Map(rows.map((r) => [r.raceId, Number(r.contacts)]));
  } catch {
    contactByRace = new Map(); // column missing on a fresh checkout
  }

  // The fastest race lap per round, to phrase the driver's best-lap gap.
  const fieldLaps = raceIds.length
    ? await prisma.raceResult.findMany({
        where: { raceId: { in: raceIds }, bestLapMs: { not: null } },
        select: { raceId: true, bestLapMs: true },
      })
    : [];
  const fastestByRace = new Map();
  for (const r of fieldLaps) {
    const cur = fastestByRace.get(r.raceId);
    if (cur == null || r.bestLapMs < cur) fastestByRace.set(r.raceId, r.bestLapMs);
  }

  // Replay: the full field rating "as of" each completed round; the driver's
  // row (with components on the final point) becomes one history point. The
  // rounds run sequentially on purpose — each replay is itself a bundle of
  // parallel queries, and a league season is a dozen rounds, not a thousand.
  const points = [];
  let lastRow = null;
  for (const race of races) {
    const rows = await getDriverRatings(prisma, driver.seasonId, {
      upToRaceNumber: race.number,
      withComponents: race === races[races.length - 1],
    });
    const idx = rows.findIndex((r) => r.driverId === driverId);
    const row = idx >= 0 ? rows[idx] : null;
    if (row) lastRow = row;

    const res = resultByRace.get(race.id) || null;
    const tel = telemetry.get(`${race.id}|${driverId}`) || null;
    const started = !!res && res.status !== "DNS";
    const finished = started && res.status === "FINISHED" && res.position != null;
    const fastest = fastestByRace.get(race.id) || null;

    points.push({
      raceId: race.id,
      number: race.number,
      track: race.track,
      country: race.country || null,
      date: race.date,
      // ratings as of this round (null until the driver's first start)
      ratings: row ? row.ratings : null,
      provisional: row ? row.provisional : null,
      rank: row ? idx + 1 : null,
      fieldSize: rows.length,
      // what this driver actually did in THIS race
      race: {
        raced: started,
        status: res ? res.status : null,
        position: finished ? res.position : null,
        grid: started && res.grid != null ? res.grid : null,
        gained: finished && res.grid != null ? res.grid - res.position : null,
        podium: finished && res.position <= 3,
        win: finished && res.position === 1,
        bestLapGapPct:
          started && res.bestLapMs != null && fastest
            ? Math.round((res.bestLapMs / fastest - 1) * 1000) / 10
            : null,
        contacts: started ? (contactByRace.has(race.id) ? contactByRace.get(race.id) : null) : null,
        overtakes: started && tel?.overtakes != null ? tel.overtakes : null,
        envContacts: started && tel?.envContacts != null ? tel.envContacts : null,
        gamePenalties: started && tel?.gamePenalties != null ? tel.gamePenalties : null,
      },
    });
  }

  // Per-round deltas, so the page can print "+2 / −1" without re-deriving.
  let prev = null;
  for (const p of points) {
    if (p.ratings && prev) {
      p.delta = {};
      for (const k of ["overall", "exp", "pac", "rac", "aha"]) p.delta[k] = p.ratings[k] - prev[k];
    } else {
      p.delta = null;
    }
    if (p.ratings) prev = p.ratings;
  }

  const value = {
    driver: {
      id: driver.id,
      name: driver.name,
      seasonId: driver.seasonId,
      team: driver.team ? { id: driver.team.id, name: driver.team.name, color: driver.team.color } : null,
    },
    points,
    // The full current row incl. component percentiles + active blend weights,
    // for the "what goes into it" section.
    current: lastRow,
  };
  cache.set(driverId, { at: Date.now(), value });
  return value;
}
