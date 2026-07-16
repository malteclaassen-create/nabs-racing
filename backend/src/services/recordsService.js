// ---------------------------------------------------------------------------
// Hall of Fame: all-time records across every (visible) season of one series.
// Read-only aggregation over the same standings the season pages use — official
// final sheets, penalties and drop rules are already applied there — merged
// person-wide via the admin's person links, so a driver's whole career counts
// as one line no matter how often their handle changed.
//
// Deliberately structured as DATA-DRIVEN lists/records so new categories (e.g.
// poles once quali data lands, or anything telemetry grows) are one entry in
// the arrays below, not a new page layout.
// ---------------------------------------------------------------------------
import { getDriverStandings, getT1ConstructorStandings, getT2ConstructorStandings } from "./standingsService.js";
import { getPersonGroups } from "../lib/persons.js";
import { resolveSeries, getActiveSeries } from "../lib/series.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { seasonCompleteFromRaces } from "../lib/seasonComplete.js";

// Heavy (walks every season), so one result is kept warm per series for a few
// minutes. Results imports simply age out within CACHE_MS.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // `${seriesId}|${admin}` -> { at, data }
export function invalidateRecordsCache() {
  cache.clear();
}

const pickPerson = (p) => ({
  driverId: p.driverId, // newest row = the career profile link
  name: p.name,
  country: p.country,
  photoUrl: p.photoUrl,
  team: p.team, // newest season's team (colour accent)
});

export async function getSeriesRecords(prisma, seriesSlug, { includePrivate = false } = {}) {
  const series = seriesSlug
    ? await resolveSeries(prisma, seriesSlug, { includePrivate })
    : await getActiveSeries(prisma);
  if (!series) return null;

  const key = `${series.id}|${includePrivate ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const priv = includePrivate ? new Set() : await getPrivateSeasonIds(prisma);
  const seasons = (
    await prisma.season.findMany({ where: { seriesId: series.id }, orderBy: { number: "asc" } })
  ).filter((s) => !priv.has(s.id));
  if (!seasons.length) return { seriesName: series.name, seasons: 0, lists: [], records: [], champions: [] };

  const seasonIds = seasons.map((s) => s.id);
  const { byDriver } = await getPersonGroups(prisma);
  const personOf = (driverId) => byDriver.get(driverId) || driverId;

  // --- per-season standings (official totals, drops, penalties applied) -----
  const perSeason = [];
  for (const season of seasons) {
    const [standings, races, t1, t2] = await Promise.all([
      getDriverStandings(prisma, season.id),
      prisma.race.findMany({ where: { seasonId: season.id, isSpecialEvent: false }, orderBy: { number: "asc" } }),
      getT1ConstructorStandings(prisma, season.id),
      getT2ConstructorStandings(prisma, season.id),
    ]);
    perSeason.push({ season, standings, races, t1, t2 });
  }

  // --- career aggregation, one bucket per PERSON -----------------------------
  const persons = new Map(); // personId -> aggregate
  const bucketFor = (personId) => {
    let b = persons.get(personId);
    if (!b) {
      b = {
        points: 0, starts: 0, wins: 0, podiums: 0, top5: 0, seasons: 0,
        bestFinish: null, bestSeason: null, // { position, seasonNumber }
        newestSeason: -1, identity: null,
      };
      persons.set(personId, b);
    }
    return b;
  };

  for (const { season, standings } of perSeason) {
    for (const row of standings.standings || []) {
      const results = Object.values(row.perRace || {});
      const started = results.filter((r) => r.status && r.status !== "DNS");
      const finished = results.filter((r) => r.status === "FINISHED" && r.position != null);
      const b = bucketFor(personOf(row.driverId));
      b.points += row.total || 0;
      b.starts += started.length;
      b.wins += finished.filter((r) => r.position === 1).length;
      b.podiums += finished.filter((r) => r.position <= 3).length;
      b.top5 += finished.filter((r) => r.position <= 5).length;
      if (started.length > 0) b.seasons += 1;
      for (const r of finished) {
        if (b.bestFinish == null || r.position < b.bestFinish) b.bestFinish = r.position;
      }
      if (row.position != null && started.length > 0) {
        if (!b.bestSeason || row.position < b.bestSeason.position) {
          b.bestSeason = { position: row.position, seasonNumber: season.number };
        }
      }
      // Newest row wins the identity (current name/photo/team).
      if (season.number > b.newestSeason) {
        b.newestSeason = season.number;
        b.identity = {
          driverId: row.driverId,
          name: row.name,
          country: row.country || null,
          photoUrl: row.photoUrl || null,
          team: row.team ? { id: row.team.id, name: row.team.name, color: row.team.color, logoUrl: row.team.logoUrl } : null,
        };
      }
    }
  }

  // --- extra signals straight off the results (grid, laps, telemetry) --------
  // Poles: grid data only exists where the AC JSONs carried it (recent
  // seasons) — the list simply reflects what's known. Fastest laps: the best
  // race lap of each completed round.
  const results = await prisma.raceResult.findMany({
    where: { race: { seasonId: { in: seasonIds }, isSpecialEvent: false, isCompleted: true } },
    select: {
      driverId: true, raceId: true, grid: true, bestLapMs: true, position: true, status: true,
      overtakes: true, lapsLed: true, contacts: true,
    },
  });
  const addTo = (map, driverId, n = 1) => {
    const person = personOf(driverId);
    map.set(person, (map.get(person) || 0) + n);
  };
  const poles = new Map();
  const overtakes = new Map();
  const lapsLed = new Map();
  const contacts = new Map();
  const bestLapByRace = new Map(); // raceId -> { driverId, ms }
  for (const r of results) {
    if (r.grid === 1) addTo(poles, r.driverId);
    if (r.overtakes) addTo(overtakes, r.driverId, r.overtakes);
    if (r.lapsLed) addTo(lapsLed, r.driverId, r.lapsLed);
    if (r.contacts) addTo(contacts, r.driverId, r.contacts);
    if (r.bestLapMs && r.bestLapMs > 0) {
      const cur = bestLapByRace.get(r.raceId);
      if (!cur || r.bestLapMs < cur.ms) bestLapByRace.set(r.raceId, { driverId: r.driverId, ms: r.bestLapMs });
    }
  }
  const fastestLaps = new Map();
  for (const fl of bestLapByRace.values()) addTo(fastestLaps, fl.driverId);

  // --- single records ---------------------------------------------------------
  // Longest win streak over the series' championship rounds in calendar order.
  const orderedWins = [];
  for (const { races, standings } of perSeason) {
    const winnerByNumber = new Map();
    for (const row of standings.standings || []) {
      for (const [num, r] of Object.entries(row.perRace || {})) {
        if (r.status === "FINISHED" && r.position === 1) winnerByNumber.set(Number(num), row.driverId);
      }
    }
    for (const race of races) {
      if (!race.isCompleted || race.number == null) continue;
      orderedWins.push(winnerByNumber.get(race.number) ? personOf(winnerByNumber.get(race.number)) : null);
    }
  }
  let streak = null; // { person, length }
  let run = { person: null, length: 0 };
  for (const person of orderedWins) {
    if (person && person === run.person) run.length += 1;
    else run = { person, length: person ? 1 : 0 };
    if (run.person && (!streak || run.length > streak.length)) streak = { ...run };
  }

  // Best single seasons: most wins / most points in one season.
  let mostWinsSeason = null; // { person, value, seasonNumber }
  let mostPointsSeason = null;
  for (const { season, standings } of perSeason) {
    for (const row of standings.standings || []) {
      const wins = Object.values(row.perRace || {}).filter((r) => r.status === "FINISHED" && r.position === 1).length;
      if (wins > 0 && (!mostWinsSeason || wins > mostWinsSeason.value)) {
        mostWinsSeason = { person: personOf(row.driverId), value: wins, seasonNumber: season.number };
      }
      if (row.total > 0 && (!mostPointsSeason || row.total > mostPointsSeason.value)) {
        mostPointsSeason = { person: personOf(row.driverId), value: row.total, seasonNumber: season.number };
      }
    }
  }

  // --- champions timeline (completed seasons only) ---------------------------
  const activeNumber = Math.max(...seasons.filter((s) => s.isActive).map((s) => s.number), -1);
  const champions = [];
  for (const { season, standings, races, t1, t2 } of perSeason) {
    const concluded =
      (activeNumber >= 0 && season.number < activeNumber) || seasonCompleteFromRaces(races);
    if (!concluded) continue;
    const top = (standings.standings || [])[0];
    if (!top || !(top.total > 0)) continue;
    const teams = [];
    for (const [tier, data] of [[1, t1], [2, t2]]) {
      const t = data?.standings?.[0];
      if (t && (t.total ?? 0) > 0) teams.push({ tier, name: t.name, color: t.color, logoUrl: t.logoUrl, teamId: t.teamId, points: t.total });
    }
    champions.push({
      seasonNumber: season.number,
      seasonName: season.name,
      game: season.game || null,
      driver: pickPerson({ driverId: top.driverId, name: top.name, country: top.country, photoUrl: top.photoUrl, team: top.team }),
      points: top.total,
      teams,
    });
  }
  champions.sort((a, b) => b.seasonNumber - a.seasonNumber);

  // --- shape the output: data-driven top lists + record tiles ----------------
  const identityOf = (personId) => {
    const b = persons.get(personId);
    // seasonNumber rides along so the frontend can deep-link `?season=` and
    // land on the row's own season instead of whatever is being viewed.
    return b?.identity ? { ...b.identity, seasonNumber: b.newestSeason } : null;
  };
  const topList = (key, label, note, valueOf, { unit = "", min = 1 } = {}) => {
    const rows = [...persons.entries()]
      .map(([personId, b]) => ({ id: identityOf(personId), value: valueOf(b, personId) }))
      .filter((r) => r.id && r.value != null && r.value >= min)
      .sort((a, b) => b.value - a.value || a.id.name.localeCompare(b.id.name))
      .slice(0, 10)
      .map((r) => ({ ...r.id, value: r.value }));
    return rows.length ? { key, label, note, unit, rows } : null;
  };

  const lists = [
    topList("wins", "Most wins", "championship rounds won", (b) => b.wins, { unit: "wins" }),
    topList("podiums", "Most podiums", "top-3 finishes", (b) => b.podiums, { unit: "podiums" }),
    topList("points", "Most career points", "official season totals, drop rules applied", (b) => b.points, { unit: "pts" }),
    topList("starts", "Most starts", "championship rounds started", (b) => b.starts, { unit: "starts" }),
    topList("poles", "Most pole positions", "where grid data exists", (b, id) => poles.get(id) || 0, { unit: "poles" }),
    topList("fastestLaps", "Most fastest laps", "best race lap of a round", (b, id) => fastestLaps.get(id) || 0, { unit: "laps" }),
    topList("overtakes", "Most overtakes", "on-track passes (telemetry seasons)", (b, id) => overtakes.get(id) || 0, { unit: "passes" }),
    topList("lapsLed", "Most laps led", "laps out front (telemetry seasons)", (b, id) => lapsLed.get(id) || 0, { unit: "laps" }),
    topList("contacts", "Most contacts", "car-to-car contacts (telemetry seasons)", (b, id) => contacts.get(id) || 0, { unit: "hits" }),
  ].filter(Boolean);

  const recordEntry = (key, label, rec, detail) =>
    rec && identityOf(rec.person)
      ? { key, label, holder: identityOf(rec.person), value: rec.value ?? rec.length, detail }
      : null;
  const records = [
    recordEntry("winsSeason", "Most wins in a season", mostWinsSeason, mostWinsSeason ? `Season ${mostWinsSeason.seasonNumber}` : null),
    recordEntry("pointsSeason", "Most points in a season", mostPointsSeason, mostPointsSeason ? `Season ${mostPointsSeason.seasonNumber}` : null),
    recordEntry("winStreak", "Longest win streak", streak, "consecutive rounds won"),
  ].filter(Boolean);

  const data = { seriesName: series.name, seasons: seasons.length, lists, records, champions };
  cache.set(key, { at: Date.now(), data });
  return data;
}
