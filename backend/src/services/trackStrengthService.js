// ---------------------------------------------------------------------------
// Track strengths: which KIND of circuit a driver goes best on.
//
// Every race a driver finished becomes one number between 0 and 1, measured
// against the field of that very race, so a P5 in a stacked grid and a P5 in a
// grid of six are not the same result:
//
//   finish  where they were classified among the finishers: 1 = won, 0 = last.
//   pace    where their best race lap ranked among everybody's best laps.
//
// The race's number is the mean of the two that exist (a round typed in by
// hand has no lap times, so it is scored on the finish alone). Then those are
// averaged per circuit TYPE (lib/trackProfile.js: high-speed, street, …) and
// per circuit, and put on a 0-100 scale.
//
// Because both are ranks inside the race, the average driver of the field
// lands on 50 by construction: 50 means "as good as the grid around them",
// 70 means clearly ahead of it. That is what makes one driver's high-speed
// number comparable with their own street number, and with another driver's.
//
// Feature races only: the sprint of a sprint weekend runs at the same circuit
// on the same evening and would count that circuit twice. DNS rows are not a
// race at all; DNF/DSQ rows have no finish, but still carry a best lap.
// ---------------------------------------------------------------------------
import { TRACK_TYPES, effectiveTypes } from "../lib/trackProfile.js";
import { readTrackInfo } from "../lib/trackInfo.js";
import { groupKeyFor, trackKeyFor } from "../lib/trackKeys.js";
import { applyPenalties } from "./pointsCalculator.js";
import { getPrivateSeasonIds } from "./seasonService.js";
import { seasonSeriesMap } from "../lib/series.js";
import { getLinkedDriverIds } from "../lib/persons.js";
import { prettiestName } from "./careerService.js";

const MAX_LAP_MS = 1_800_000;
const isLap = (ms) => ms != null && ms > 0 && ms <= MAX_LAP_MS;
const finished = (r) => (!r.status || r.status === "FINISHED") && r.position != null;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const score = (v) => (v == null ? null : Math.round(v * 100));

// One race, from the classified field: this driver's finish and pace ranks,
// their position and their gap to the fastest lap. null when there is nothing
// to measure (did not start, or neither a finish nor a lap). Pure.
export function raceEntry(field, driverId) {
  const me = field.find((r) => r.driverId === driverId);
  if (!me || me.status === "DNS") return null;
  let finishPct = null;
  if (finished(me)) {
    const n = field.filter(finished).length;
    // Positions are classified ranks, so they already run 1..n; the clamp is
    // for a field whose rows disagree with themselves (a hand-typed round).
    if (n > 1) finishPct = Math.max(0, Math.min(1, (n - me.position) / (n - 1)));
  }
  let pacePct = null;
  let gapPct = null;
  if (isLap(me.bestLapMs)) {
    const laps = field.map((r) => r.bestLapMs).filter(isLap).sort((a, b) => a - b);
    if (laps.length > 1) {
      // Ties share the better rank.
      const ahead = laps.filter((ms) => ms < me.bestLapMs).length;
      pacePct = (laps.length - 1 - ahead) / (laps.length - 1);
    }
    gapPct = ((me.bestLapMs - laps[0]) / laps[0]) * 100;
  }
  const parts = [finishPct, pacePct].filter((v) => v != null);
  if (!parts.length) return null;
  return {
    value: mean(parts),
    finishPct,
    pacePct,
    position: finished(me) ? me.position : null,
    gapPct,
  };
}

// The races of one bucket (a type, or a circuit) folded into what the page
// shows. Pure.
function bucket(entries) {
  const positions = entries.map((e) => e.position).filter((p) => p != null);
  const gap = mean(entries.map((e) => e.gapPct).filter((v) => v != null));
  return {
    score: score(mean(entries.map((e) => e.value))),
    races: entries.length,
    avgFinish: round1(mean(positions)),
    bestFinish: positions.length ? Math.min(...positions) : null,
    // Hundredths of a percent: the gaps between drivers live there.
    avgGapPct: gap == null ? null : Math.round(gap * 100) / 100,
  };
}

// Everything the page draws, out of the scored races. `entries` are
// { trackKey, trackName, value, position, gapPct } (from raceEntry plus the
// circuit); `typesByTrack` maps a circuit key to its type keys. Pure.
export function summariseStrengths(entries, typesByTrack) {
  const byTrack = new Map();
  for (const e of entries) {
    if (!byTrack.has(e.trackKey)) byTrack.set(e.trackKey, { names: [], list: [] });
    const t = byTrack.get(e.trackKey);
    t.names.push(e.trackName);
    t.list.push(e);
  }
  const tracks = [...byTrack.entries()]
    .map(([key, t]) => ({
      key,
      name: prettiestName(t.names) || key,
      types: typesByTrack.get(key) || [],
      ...bucket(t.list),
    }))
    .sort((a, b) => b.score - a.score || b.races - a.races || a.name.localeCompare(b.name));

  const types = TRACK_TYPES.map((def) => {
    const here = entries.filter((e) => (typesByTrack.get(e.trackKey) || []).includes(def.key));
    const b = bucket(here);
    return {
      key: def.key,
      label: def.label,
      hint: def.hint,
      ...b,
      tracks: tracks.filter((t) => t.types.includes(def.key)).map((t) => ({ key: t.key, name: t.name, races: t.races })),
    };
  });

  const scored = types.filter((t) => t.score != null);
  const overall = score(mean(entries.map((e) => e.value)));
  // Strongest and weakest are only worth saying when the kinds differ at all,
  // and only among types with more than a single race behind them.
  const solid = scored.filter((t) => t.races >= 2);
  const best = solid.length ? solid.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  const worst = solid.length ? solid.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  const spread = best && worst ? best.score - worst.score : 0;
  return {
    races: entries.length,
    overall,
    strongest: spread >= 8 ? best.key : null,
    weakest: spread >= 8 ? worst.key : null,
    untyped: entries.filter((e) => !(typesByTrack.get(e.trackKey) || []).length).length,
    types,
    tracks,
  };
}

// Result cache: the answer only changes when a result is saved, and a profile
// with a rival picked asks twice. Cleared with the career cache on every save.
const CACHE_MS = 120_000;
const CACHE_MAX = 60;
const cache = new Map();
export function invalidateTrackStrengthCache() {
  cache.clear();
}

// The strengths of the person behind one driver row. `scope` "season" reads
// that row's season only; "all" every season of the same league the person
// raced in (the league, because a profile is a league page and the rival list
// is that league's field). Private seasons stay out unless `includePrivate`.
export async function getTrackStrengths(prisma, rowId, { scope = "all", includePrivate = false } = {}) {
  const key = `${rowId}|${scope}|${includePrivate ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = compute(prisma, rowId, scope === "season" ? "season" : "all", includePrivate);
  cache.set(key, { at: Date.now(), promise });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

async function compute(prisma, rowId, scope, includePrivate) {
  const row = await prisma.driver.findUnique({ where: { id: rowId }, select: { id: true, seasonId: true } });
  if (!row) return null;
  const [priv, bySeries, linked] = await Promise.all([
    includePrivate ? new Set() : getPrivateSeasonIds(prisma),
    seasonSeriesMap(prisma),
    getLinkedDriverIds(prisma, rowId),
  ]);
  const series = bySeries.get(row.seasonId) ?? null;
  const allowed = (seasonId) =>
    !!seasonId &&
    !priv.has(seasonId) &&
    (scope === "season" ? seasonId === row.seasonId : (bySeries.get(seasonId) ?? null) === series);

  const rows = await prisma.driver.findMany({ where: { id: { in: linked } }, select: { id: true, seasonId: true } });
  const ids = rows.filter((r) => allowed(r.seasonId)).map((r) => r.id);
  if (!ids.length) return { scope, ...summariseStrengths([], new Map()), seasons: [] };
  const mine = new Set(ids);

  const my = await prisma.raceResult.findMany({
    where: { driverId: { in: ids }, race: { isCompleted: true, isSpecialEvent: false } },
    select: { raceId: true, driverId: true, race: { select: { id: true, track: true, seasonId: true, season: { select: { number: true } } } } },
  });
  const races = new Map();
  for (const r of my) if (allowed(r.race.seasonId)) races.set(r.raceId, r.race);
  if (!races.size) return { scope, ...summariseStrengths([], new Map()), seasons: [] };

  const field = await prisma.raceResult.findMany({ where: { raceId: { in: [...races.keys()] } } });
  const byRace = new Map();
  for (const r of field) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId).push(r);
  }

  const entries = [];
  const seasons = new Set();
  for (const [raceId, race] of races) {
    // The classified order, time penalties applied, exactly as the standings
    // read it (services/penalisedResults.js does the same for the profile).
    const classified = applyPenalties(byRace.get(raceId) || []);
    const meRow = classified.find((r) => mine.has(r.driverId));
    if (!meRow) continue;
    const e = raceEntry(classified, meRow.driverId);
    if (!e) continue;
    entries.push({ ...e, trackKey: groupKeyFor(race.track), trackName: race.track });
    if (race.season?.number != null) seasons.add(race.season.number);
  }

  const typesByTrack = new Map();
  for (const k of new Set(entries.map((e) => e.trackKey))) {
    const info = await readTrackInfo(prisma, k);
    typesByTrack.set(k, effectiveTypes(info, trackKeyFor(k) ? k : null).types);
  }
  return {
    scope,
    ...summariseStrengths(entries, typesByTrack),
    seasons: [...seasons].sort((a, b) => a - b),
  };
}
