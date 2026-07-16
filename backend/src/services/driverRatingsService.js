// ---------------------------------------------------------------------------
// Driver Ratings service — EA-/F1-25-style rating cards, computed automatically
// from real race data. Every driver gets four sub-ratings plus an overall:
//
//   EXP  Experience  — CAREER formula (admin's sheet, confirmed 2026-07-15):
//                      over the last-7-finished-seasons window, 45% race
//                      starts (60 = full), 45% championship results (recency-
//                      weighted, 60/40 drivers/constructors, position-value
//                      curves incl. per-tier tables), 5% finishing >= 95%
//                      (all-or-nothing), 5% seasons active. Absolute scale,
//                      floor 35 up to 99 — NOT relative to the field.
//   PAC  Pace        — career window too: average grid slot (our only
//                      qualifying signal), average best-race-lap gap, and the
//                      simresults consistency %, percentile-ranked against the
//                      season's regulars and mapped onto a 50–99 band.
//   RAC  Racecraft   — race result: finishing position, places gained, podiums
//   AWA  Awareness   — cleanliness/consistency: finish rate, few DNFs, low spread
//                      (displayed as AWA; the internal key stays `aha`)
//   RTG  Overall     — weighted blend of the four (RAC + PAC weigh most)
//
// RAC and AWA stay RELATIVE to the rated season's field: percentile-ranked
// against the regulars, mapped onto the shared band. Low-sample drivers are
// pulled toward the field average ("shrinkage") so a single lucky/unlucky race
// can't rocket them to 90 or sink them to 60; they are flagged `provisional`.
//
// Pure read service in the style of standingsService / driverProfileService:
// no DB writes, recomputes on every call, so it always reflects the latest
// imported results.
// ---------------------------------------------------------------------------
import { telemetryBySeason } from "../lib/telemetryRead.js";
import { readRatingWeights } from "../lib/ratingWeights.js";
import { getCareerInputs } from "./careerRatingService.js";

// --- tunables (kept together so the curve is easy to adjust) ----------------
const BAND_LOW = 58; // worst-in-field maps here
const BAND_HIGH = 96; // best-in-field maps here
const SHRINK_K = 3; // pull small samples toward the field mean by this much
const NO_SHRINK_ABOVE = 6; // a real regular (>= this many samples) isn't shrunk,
//                            so a dominant driver isn't dragged back to the mean
const MIN_STARTS_REF = 3; // a "regular": sets the scale everyone is measured on
const PROVISIONAL_BELOW = 3; // fewer starts than this -> rating shown as provisional

// How the overall RTG is blended from the four sub-ratings.
const RTG_WEIGHTS = { rac: 0.35, pac: 0.3, aha: 0.2, exp: 0.15 };
// Pace components (career window): quali = average grid slot, bestLap =
// average best-race-lap gap, consistency = simresults %, poleGap = average gap
// to the qualifying pole TIME. poleGap is the sheet's fourth component but
// needs qualifying times we don't import yet, so it ships at weight 0 (inert)
// and the admin raises it once a quali-session import populates qualiTimeMs.
const PAC_WEIGHTS = { quali: 1, bestLap: 1, consistency: 1, poleGap: 0 };
// Racecraft: finishing position, places gained, on-track overtakes and podiums.
const RAC_WEIGHTS = { finish: 0.45, gained: 0.2, overtakes: 0.15, podium: 0.2 };
// Awareness/discipline: reliability (finishing, few DNFs), lap consistency, and
// staying out of trouble (car contacts, off-track/env hits, in-game penalties).
// `cuts` is available as a tunable but defaults to 0 (old seasons log no cuts).
const AHA_WEIGHTS = { finishRate: 0.25, dnf: 0.15, consistency: 0.25, contacts: 0.15, env: 0.1, penalties: 0.1, cuts: 0 };

// The career window both EXP and PAC look at: the last N finished seasons of
// the rated season's series, with recency weights (percent, newest first).
const WINDOW_DEFAULTS = { seasons: 7, recency: [25, 20, 20, 15, 10, 5, 5] };

// The EXP formula (admin's sheet). All percent values; weight groups are
// normalised at read time, so partial edits stay safe.
const EXP_DEFAULTS = {
  // The four building blocks: starts / championship / finishing / activity.
  weights: { starts: 45, championship: 45, finishing: 5, activity: 5 },
  // Starts needed in the window for full marks on the starts block.
  fullStarts: 60,
  // Finishing block is all-or-nothing: finish rate >= this percent -> full.
  finishThreshold: 95,
  // Within one season's championship block: drivers vs constructors table.
  split: { drivers: 60, constructors: 40 },
  // Drivers' standings value by position (percent, P1 first). Beyond the
  // table's end the last value applies.
  driverCurve: [100, 75, 50, 40, 37.6, 35.1, 32.7, 30.2, 27.8, 25.4, 22.9, 20.5, 18.1, 15.6, 13.2, 10.8, 8.3, 5.9, 3.4, 1],
  // Constructors' standings value by position. Pre-tier seasons (one class)
  // use one table; tiered seasons pick the tier table matching the number of
  // teams in that tier (the sheet defines them per field size). A tier-2
  // title is deliberately worth half a tier-1 title.
  constructors: {
    preTier: [100, 75, 50, 40, 33.5, 27, 20.5, 14, 7.5, 1],
    tier1: [
      { teams: 6, values: [100, 80, 60, 50, 40, 10] },
      { teams: 5, values: [100, 80, 60, 40, 10] },
    ],
    tier2: [{ teams: 5, values: [50, 40, 30, 20, 10] }],
  },
  // Progression curve: the raw 0..1 EXP score is raised to this exponent
  // before it maps onto the 35..99 band. Below 1 the curve is concave —
  // newcomers climb quickly out of the floor while the last points toward 99
  // keep getting harder (the "multiplier that shrinks as you gain XP").
  // 1 = linear (off). The 35 floor and the 99 ceiling stay exactly where
  // they are; only the path between them bends.
  progression: 0.6,
};

// EXP is absolute (floor..99); PAC spans 50..99 per the sheet.
const EXP_BAND = { low: 35, high: 99 };
const PAC_BAND = { low: 50, high: 99 };

// All knobs in one place, so the admin tuning panel can read the defaults and
// pass back overrides. `band` is the visible 0–99 range shared by RAC/AWA;
// `bands` overrides floor/ceiling PER sub-rating — EXP and PAC default to the
// sheet's absolute scales (35–99 / 50–99). The rest are the blend weights for
// the overall and each sub-rating, plus the career window and EXP formula.
export const RATING_DEFAULTS = {
  band: { low: BAND_LOW, high: BAND_HIGH },
  bands: {
    exp: { ...EXP_BAND },
    pac: { ...PAC_BAND },
    rac: { low: BAND_LOW, high: BAND_HIGH },
    aha: { low: BAND_LOW, high: BAND_HIGH },
  },
  window: { seasons: WINDOW_DEFAULTS.seasons, recency: [...WINDOW_DEFAULTS.recency] },
  exp: {
    weights: { ...EXP_DEFAULTS.weights },
    fullStarts: EXP_DEFAULTS.fullStarts,
    finishThreshold: EXP_DEFAULTS.finishThreshold,
    split: { ...EXP_DEFAULTS.split },
    driverCurve: [...EXP_DEFAULTS.driverCurve],
    constructors: {
      preTier: [...EXP_DEFAULTS.constructors.preTier],
      tier1: EXP_DEFAULTS.constructors.tier1.map((t) => ({ teams: t.teams, values: [...t.values] })),
      tier2: EXP_DEFAULTS.constructors.tier2.map((t) => ({ teams: t.teams, values: [...t.values] })),
    },
    progression: EXP_DEFAULTS.progression,
  },
  rtg: { ...RTG_WEIGHTS },
  pac: { ...PAC_WEIGHTS },
  rac: { ...RAC_WEIGHTS },
  aha: { ...AHA_WEIGHTS },
};

// Scale a group of weights so they sum to 1 (forgiving: the admin can type any
// numbers and they're treated proportionally). Empty/zero -> fall back to base.
function normalizeGroup(group, base) {
  const src = group && typeof group === "object" ? group : base;
  const keys = Object.keys(base);
  const vals = keys.map((k) => Math.max(0, Number(src[k]) || 0));
  const sum = vals.reduce((a, b) => a + b, 0);
  const out = {};
  keys.forEach((k, i) => (out[k] = sum > 0 ? vals[i] / sum : base[k]));
  return out;
}

// Merge admin overrides onto the defaults and normalise the weight groups.
// A blank input ("" from an empty admin field) counts as "not set", NOT as 0.
function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// A percent curve from admin input: array of finite numbers clamped 0..100.
// Anything unusable falls back to the default curve.
function resolveCurve(input, fallback) {
  if (!Array.isArray(input)) return [...fallback];
  const clean = input.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (!clean.length) return [...fallback];
  return clean.map((v) => Math.max(0, Math.min(100, v)));
}

// Per-team-count constructor tables: [{ teams, values }] with sane bounds.
function resolveTierTables(input, fallback) {
  if (!Array.isArray(input)) return fallback.map((t) => ({ teams: t.teams, values: [...t.values] }));
  const clean = input
    .map((t) => ({
      teams: Math.max(2, Math.min(30, Math.round(Number(t?.teams)) || 0)),
      values: resolveCurve(t?.values, []),
    }))
    .filter((t) => t.teams >= 2 && t.values.length > 0);
  return clean.length ? clean : fallback.map((t) => ({ teams: t.teams, values: [...t.values] }));
}

export function resolveConfig(opts = {}) {
  const low = numOrNull(opts.band?.low);
  const high = numOrNull(opts.band?.high);
  const band = {
    low: low ?? BAND_LOW,
    high: high ?? BAND_HIGH,
  };
  // Per-stat floor/ceiling. RAC/AWA inherit the shared band; EXP and PAC have
  // their own absolute scales from the formula sheet (35–99 / 50–99) unless
  // the admin explicitly overrides them.
  const bandFor = (key, base = band) => ({
    low: numOrNull(opts.bands?.[key]?.low) ?? base.low,
    high: numOrNull(opts.bands?.[key]?.high) ?? base.high,
  });

  const windowSeasons = Math.max(1, Math.min(20, Math.round(numOrNull(opts.window?.seasons) ?? WINDOW_DEFAULTS.seasons)));
  const recency = resolveCurve(opts.window?.recency, WINDOW_DEFAULTS.recency);

  const exp = {
    weights: normalizeGroup(opts.exp?.weights, EXP_DEFAULTS.weights),
    fullStarts: Math.max(1, numOrNull(opts.exp?.fullStarts) ?? EXP_DEFAULTS.fullStarts),
    finishThreshold: Math.max(0, Math.min(100, numOrNull(opts.exp?.finishThreshold) ?? EXP_DEFAULTS.finishThreshold)),
    split: normalizeGroup(opts.exp?.split, EXP_DEFAULTS.split),
    driverCurve: resolveCurve(opts.exp?.driverCurve, EXP_DEFAULTS.driverCurve),
    constructors: {
      preTier: resolveCurve(opts.exp?.constructors?.preTier, EXP_DEFAULTS.constructors.preTier),
      tier1: resolveTierTables(opts.exp?.constructors?.tier1, EXP_DEFAULTS.constructors.tier1),
      tier2: resolveTierTables(opts.exp?.constructors?.tier2, EXP_DEFAULTS.constructors.tier2),
    },
    // Exponent on the raw 0..1 score (1 = linear). Clamped to a sane range so
    // a typo can't flatten everyone onto the floor or the ceiling.
    progression: Math.max(0.1, Math.min(3, numOrNull(opts.exp?.progression) ?? EXP_DEFAULTS.progression)),
  };

  return {
    band,
    bands: {
      exp: bandFor("exp", EXP_BAND),
      pac: bandFor("pac", PAC_BAND),
      rac: bandFor("rac"),
      aha: bandFor("aha"),
    },
    window: { seasons: windowSeasons, recency },
    exp,
    rtg: normalizeGroup(opts.rtg, RTG_WEIGHTS),
    pac: normalizeGroup(opts.pac, PAC_WEIGHTS),
    rac: normalizeGroup(opts.rac, RAC_WEIGHTS),
    aha: normalizeGroup(opts.aha, AHA_WEIGHTS),
  };
}

// --- small stats helpers ----------------------------------------------------
function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stddev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

// Fractional rank of `v` within `arr` in [0,1]: share of the field that `v`
// beats (+ half of any ties). `higherBetter` flips the direction. Robust to
// outliers and independent of scale, which is exactly what we want when mixing
// lap-time gaps, grid slots and finish rates into one number. Empty field or no
// value -> 0.5 (neutral middle).
function percentile(v, arr, higherBetter) {
  if (v == null || !arr.length) return 0.5;
  let worse = 0;
  let equal = 0;
  for (const a of arr) {
    if (a === v) equal++;
    else if (higherBetter ? a < v : a > v) worse++;
  }
  return (worse + 0.5 * equal) / arr.length;
}

// Shrink a small-sample value toward the field mean: (n·v + K·mean)/(n+K).
// With n≫K this is ~v; with n small it leans on the field average. A driver with
// a full sample (>= NO_SHRINK_ABOVE) is left untouched, so the season's stand-out
// performers keep their real values instead of being pulled toward average.
export function shrink(v, n, fieldMean) {
  if (v == null) return fieldMean;
  if (n >= NO_SHRINK_ABOVE) return v;
  return (n * v + SHRINK_K * fieldMean) / (n + SHRINK_K);
}

function clampRating(pct, band) {
  const r = Math.round(band.low + pct * (band.high - band.low));
  return Math.max(0, Math.min(99, r));
}

// ---------------------------------------------------------------------------
// Per-driver raw metrics, straight from the result rows. Everything here is an
// honest measurement; the relative scaling happens afterwards.
// ---------------------------------------------------------------------------
function rawMetrics(driver, results, raceMeta) {
  // "started" = took part (anything that isn't an explicit DNS).
  const started = results.filter((r) => r.status !== "DNS");
  const finishes = started.filter((r) => r.status === "FINISHED" && r.position != null);
  const dnfs = started.filter((r) => r.status === "DNF" || r.status === "DSQ");

  const starts = started.length;
  const podiums = finishes.filter((r) => r.position <= 3).length;

  // PACE — best-lap gap to the fastest lap set in that same race (track-neutral),
  // and grid slot normalised to the size of that race's field. Lower = faster.
  const lapGaps = [];
  const gridNorms = [];
  for (const r of started) {
    const m = raceMeta.get(r.raceId);
    if (!m) continue;
    if (r.bestLapMs != null && m.fastestLap) lapGaps.push(r.bestLapMs / m.fastestLap - 1);
    if (r.grid != null && m.gridSize > 1) gridNorms.push((r.grid - 1) / (m.gridSize - 1));
  }

  // RACECRAFT — finishing position normalised to the race field (0 = win), and
  // places gained from grid to flag (start → finish).
  const finishNorms = [];
  const gained = [];
  for (const r of finishes) {
    const m = raceMeta.get(r.raceId);
    if (m && m.fieldSize > 1) finishNorms.push((r.position - 1) / (m.fieldSize - 1));
    if (r.grid != null) gained.push(r.grid - r.position);
  }

  return {
    driverId: driver.id,
    starts,
    finishes: finishes.length,
    wins: finishes.filter((r) => r.position === 1).length,
    podiums,
    // raw inputs (null where there's no sample at all)
    avgLapGap: lapGaps.length ? mean(lapGaps) : null,
    nLap: lapGaps.length,
    avgGridNorm: gridNorms.length ? mean(gridNorms) : null,
    nGrid: gridNorms.length,
    avgFinishNorm: finishNorms.length ? mean(finishNorms) : null,
    nFinish: finishNorms.length,
    avgGained: gained.length ? mean(gained) : null,
    nGained: gained.length,
    finishRate: starts ? finishes.length / starts : null,
    dnfRate: starts ? dnfs.length / starts : null,
    podiumRate: starts ? podiums / starts : null,
    // consistency = spread of finishing positions (needs >= 2 finishes)
    finishSpread: finishNorms.length >= 2 ? stddev(finishNorms) : null,
  };
}

// ---------------------------------------------------------------------------
// `opts` may override any of the tunables (see RATING_DEFAULTS): `band`/`bands`,
// the career `window`, the `exp` formula block, and the `rtg` / `pac` / `rac` /
// `aha` weight groups. Each weight group is normalised, so partial or
// unnormalised input is fine. Omitted -> the defaults above. Used by the admin
// tuning panel to preview different curves.
export async function getDriverRatings(prisma, seasonId, opts = {}) {
  // Persisted admin weights are the baseline; explicit opts (the admin preview)
  // override them group-by-group. Both fall through to RATING_DEFAULTS.
  const saved = (await readRatingWeights(prisma)) || {};
  const cfg = resolveConfig({ ...saved, ...opts });
  const [season, drivers, races, results, telemetry] = await Promise.all([
    prisma.season.findUnique({ where: { id: seasonId } }),
    prisma.driver.findMany({ where: { seasonId }, include: { team: true } }),
    prisma.race.findMany({
      where: { seasonId, isSpecialEvent: false, isCompleted: true },
      orderBy: { number: "asc" },
    }),
    prisma.raceResult.findMany({ where: { race: { seasonId } } }),
    telemetryBySeason(prisma, seasonId),
  ]);
  if (!season) return [];

  // Career window inputs (EXP formula + PAC signals), per rated driver row.
  const career = await getCareerInputs(prisma, season, drivers, cfg);

  const completedRaceIds = new Set(races.map((r) => r.id));
  const liveResults = results.filter((r) => completedRaceIds.has(r.raceId));

  // Car-to-car contacts per driver, summed over completed rounds. Read straight
  // from the `contacts` column via SQL so it works regardless of whether the
  // generated client knows the column yet, and degrades to "no contact signal"
  // for a season that hasn't been backfilled (rated = 0 -> neutral).
  const contactRows = await prisma.$queryRawUnsafe(
    `SELECT rr."driverId" AS "driverId",
            SUM(COALESCE(rr."contacts", 0)) AS "total",
            COUNT(rr."contacts") AS "rated"
       FROM "RaceResult" rr
       JOIN "Race" r ON r.id = rr."raceId"
      WHERE r."seasonId" = ? AND r."isSpecialEvent" = 0 AND r."isCompleted" = 1
      GROUP BY rr."driverId"`,
    seasonId
  );
  const contactsById = new Map(
    contactRows.map((x) => [x.driverId, { total: Number(x.total) || 0, rated: Number(x.rated) || 0 }])
  );

  // Extra telemetry per driver, summed over completed rounds (overtakes, env
  // hits, cuts, in-game penalties, and a clean-lap-weighted consistency). Read
  // from the raw telemetry map; missing for un-backfilled seasons -> the
  // percentile degrades to neutral (0.5) for everyone.
  const telById = new Map();
  for (const race of races) {
    for (const r of liveResults) {
      if (r.raceId !== race.id) continue;
      const t = telemetry.get(`${r.raceId}|${r.driverId}`);
      if (!t) continue;
      let cur = telById.get(r.driverId);
      if (!cur) {
        cur = { overtakes: 0, env: 0, cuts: 0, gamePen: 0, consNum: 0, consDen: 0, ratedOt: 0, ratedEnv: 0, ratedPen: 0 };
        telById.set(r.driverId, cur);
      }
      if (t.overtakes != null) { cur.overtakes += t.overtakes; cur.ratedOt++; }
      if (t.envContacts != null) { cur.env += t.envContacts; cur.ratedEnv++; }
      if (t.cuts != null) cur.cuts += t.cuts;
      if (t.gamePenalties != null) { cur.gamePen += t.gamePenalties; cur.ratedPen++; }
      if (t.consistencyMs != null && t.cleanLaps) { cur.consNum += t.consistencyMs * t.cleanLaps; cur.consDen += t.cleanLaps; }
    }
  }

  // Per-race reference numbers used to normalise pace/finish within each round.
  const raceMeta = new Map();
  for (const race of races) {
    const rs = liveResults.filter((r) => r.raceId === race.id);
    const laps = rs.map((r) => r.bestLapMs).filter((x) => x != null);
    raceMeta.set(race.id, {
      fastestLap: laps.length ? Math.min(...laps) : null,
      fieldSize: rs.filter((r) => r.position != null).length, // classified finishers
      gridSize: rs.filter((r) => r.grid != null).length,
    });
  }

  const resultsByDriver = new Map();
  for (const r of liveResults) {
    if (!resultsByDriver.has(r.driverId)) resultsByDriver.set(r.driverId, []);
    resultsByDriver.get(r.driverId).push(r);
  }

  // Raw metrics for everyone who has at least one outing this season.
  const raw = drivers
    .map((d) => ({ driver: d, m: rawMetrics(d, resultsByDriver.get(d.id) || [], raceMeta) }))
    .filter((x) => x.m.starts >= 1);

  // Attach per-start telemetry rates (null when this driver has no backfilled
  // data for that signal, so it drops to a neutral percentile), plus the
  // career-window pace signals EXP/PAC run on.
  for (const { driver, m } of raw) {
    const c = contactsById.get(driver.id);
    m.contactsRate = c && c.rated > 0 && m.starts ? c.total / m.starts : null;
    const t = telById.get(driver.id);
    m.overtakesRate = t && t.ratedOt > 0 ? t.overtakes / t.ratedOt : null;
    m.envRate = t && t.ratedEnv > 0 && m.starts ? t.env / m.starts : null;
    m.penaltyRate = t && t.ratedPen > 0 && m.starts ? t.gamePen / m.starts : null;
    m.cutsRate = t && t.consDen > 0 && m.starts ? t.cuts / m.starts : null;
    m.lapConsistencyMs = t && t.consDen > 0 ? t.consNum / t.consDen : null;
    const cw = career.get(driver.id);
    m.careerGridNorm = cw?.pace.avgGridNorm ?? null;
    m.nCareerGrid = cw?.pace.nGrid ?? 0;
    m.careerLapGap = cw?.pace.avgLapGap ?? null;
    m.nCareerLap = cw?.pace.nLap ?? 0;
    m.careerConsistency = cw?.pace.avgConsistency ?? null;
    m.nCareerCons = cw?.pace.nCons ?? 0;
    m.careerPoleGap = cw?.pace.avgPoleGap ?? null;
    m.nCareerPole = cw?.pace.nPole ?? 0;
  }

  // The reference field = the regulars (>= MIN_STARTS_REF). Their distribution
  // sets both the shrinkage mean and the percentile scale that EVERYONE — even a
  // one-race reserve — is then measured against.
  const ref = raw.filter((x) => x.m.starts >= MIN_STARTS_REF).map((x) => x.m);
  // Fallback for a brand-new season with too few regulars: use the whole field.
  const refField = ref.length >= 3 ? ref : raw.map((x) => x.m);

  const refMean = {
    lapGap: mean(refField.map((m) => m.careerLapGap).filter((x) => x != null)),
    gridNorm: mean(refField.map((m) => m.careerGridNorm).filter((x) => x != null)),
    consistency: mean(refField.map((m) => m.careerConsistency).filter((x) => x != null)),
    poleGap: mean(refField.map((m) => m.careerPoleGap).filter((x) => x != null)),
    finishNorm: mean(refField.map((m) => m.avgFinishNorm).filter((x) => x != null)),
    gained: mean(refField.map((m) => m.avgGained).filter((x) => x != null)),
    finishRate: mean(refField.map((m) => m.finishRate).filter((x) => x != null)),
    dnfRate: mean(refField.map((m) => m.dnfRate).filter((x) => x != null)),
    podiumRate: mean(refField.map((m) => m.podiumRate).filter((x) => x != null)),
    contactsRate: mean(refField.map((m) => m.contactsRate).filter((x) => x != null)),
    overtakesRate: mean(refField.map((m) => m.overtakesRate).filter((x) => x != null)),
    envRate: mean(refField.map((m) => m.envRate).filter((x) => x != null)),
    penaltyRate: mean(refField.map((m) => m.penaltyRate).filter((x) => x != null)),
    cutsRate: mean(refField.map((m) => m.cutsRate).filter((x) => x != null)),
  };

  // Reference distributions (after the same shrinkage we apply per driver), so a
  // driver is compared like-for-like against the regulars.
  const refDist = {
    lapGap: refField.map((m) => shrink(m.careerLapGap, m.nCareerLap, refMean.lapGap)),
    gridNorm: refField.map((m) => shrink(m.careerGridNorm, m.nCareerGrid, refMean.gridNorm)),
    consistency: refField
      .map((m) => (m.careerConsistency != null ? shrink(m.careerConsistency, m.nCareerCons, refMean.consistency) : null))
      .filter((x) => x != null),
    poleGap: refField
      .map((m) => (m.careerPoleGap != null ? shrink(m.careerPoleGap, m.nCareerPole, refMean.poleGap) : null))
      .filter((x) => x != null),
    finishNorm: refField.map((m) => shrink(m.avgFinishNorm, m.nFinish, refMean.finishNorm)),
    gained: refField.map((m) => shrink(m.avgGained, m.nGained, refMean.gained)),
    finishRate: refField.map((m) => shrink(m.finishRate, m.starts, refMean.finishRate)),
    dnfRate: refField.map((m) => shrink(m.dnfRate, m.starts, refMean.dnfRate)),
    podiumRate: refField.map((m) => shrink(m.podiumRate, m.starts, refMean.podiumRate)),
    contactsRate: refField.map((m) => shrink(m.contactsRate, m.starts, refMean.contactsRate)),
    overtakesRate: refField.map((m) => shrink(m.overtakesRate, m.starts, refMean.overtakesRate)),
    envRate: refField.map((m) => shrink(m.envRate, m.starts, refMean.envRate)),
    penaltyRate: refField.map((m) => shrink(m.penaltyRate, m.starts, refMean.penaltyRate)),
    cutsRate: refField.map((m) => shrink(m.cutsRate, m.starts, refMean.cutsRate)),
    spread: refField.map((m) => m.finishSpread).filter((x) => x != null),
    consistencyMs: refField.map((m) => m.lapConsistencyMs).filter((x) => x != null),
  };

  const rows = raw.map(({ driver, m }) => {
    // Shrink each driver's raw value toward the field, then rank it.
    // PACE runs on the career-window signals (grid = our qualifying, best-lap
    // gap, consistency %); everything else stays season-scoped.
    const pLap = percentile(shrink(m.careerLapGap, m.nCareerLap, refMean.lapGap), refDist.lapGap, false);
    const pGrid = percentile(shrink(m.careerGridNorm, m.nCareerGrid, refMean.gridNorm), refDist.gridNorm, false);
    const pCons =
      m.careerConsistency != null && refDist.consistency.length
        ? percentile(shrink(m.careerConsistency, m.nCareerCons, refMean.consistency), refDist.consistency, true)
        : 0.5;
    // Gap to pole (lower = faster). Neutral until quali times are imported.
    const pPole =
      m.careerPoleGap != null && refDist.poleGap.length
        ? percentile(shrink(m.careerPoleGap, m.nCareerPole, refMean.poleGap), refDist.poleGap, false)
        : 0.5;
    const pFinish = percentile(shrink(m.avgFinishNorm, m.nFinish, refMean.finishNorm), refDist.finishNorm, false);
    const pGained = percentile(shrink(m.avgGained, m.nGained, refMean.gained), refDist.gained, true);
    const pPodium = percentile(shrink(m.podiumRate, m.starts, refMean.podiumRate), refDist.podiumRate, true);
    const pFinishRate = percentile(shrink(m.finishRate, m.starts, refMean.finishRate), refDist.finishRate, true);
    const pDnf = percentile(shrink(m.dnfRate, m.starts, refMean.dnfRate), refDist.dnfRate, false);
    // Consistency: lap-time spread of clean laps (lower better) when telemetry
    // exists, else fall back to finishing-position spread so old seasons still
    // get a signal, else neutral.
    const pConsistency =
      m.lapConsistencyMs != null
        ? percentile(m.lapConsistencyMs, refDist.consistencyMs, false)
        : m.finishSpread != null
          ? percentile(m.finishSpread, refDist.spread, false)
          : 0.5;
    const pContacts = percentile(shrink(m.contactsRate, m.starts, refMean.contactsRate), refDist.contactsRate, false);
    const pOvertakes = m.overtakesRate != null
      ? percentile(shrink(m.overtakesRate, m.starts, refMean.overtakesRate), refDist.overtakesRate, true)
      : 0.5;
    const pEnv = m.envRate != null
      ? percentile(shrink(m.envRate, m.starts, refMean.envRate), refDist.envRate, false)
      : 0.5;
    const pPenalties = m.penaltyRate != null
      ? percentile(shrink(m.penaltyRate, m.starts, refMean.penaltyRate), refDist.penaltyRate, false)
      : 0.5;
    const pCuts = m.cutsRate != null
      ? percentile(shrink(m.cutsRate, m.starts, refMean.cutsRate), refDist.cutsRate, false)
      : 0.5;
    // EXPERIENCE — the admin's career formula, absolute (no percentile):
    // starts toward 60, recency-weighted championship record, all-or-nothing
    // finishing block, and share of window seasons raced. The 35..99 scale
    // comes from bands.exp via clampRating below.
    const cw = career.get(driver.id);
    const startsPct = cw ? Math.min(1, cw.starts / cfg.exp.fullStarts) : 0;
    const champPct = cw ? cw.champPct : 0;
    const finishingPct = cw && cw.finishRate != null ? (cw.finishRate * 100 >= cfg.exp.finishThreshold ? 1 : 0) : 0;
    const activityPct = cw && cw.windowSize ? cw.activeSeasons / cw.windowSize : 0;
    const expRaw =
      cfg.exp.weights.starts * startsPct +
      cfg.exp.weights.championship * champPct +
      cfg.exp.weights.finishing * finishingPct +
      cfg.exp.weights.activity * activityPct;
    // Progression curve (exp.progression < 1 = concave): early experience
    // lifts the rating quickly off the floor, the last points toward 99 come
    // ever slower. Floor and ceiling themselves don't move (0->0, 1->1).
    const expPct = Math.pow(Math.max(0, Math.min(1, expRaw)), cfg.exp.progression);

    const pacPct = cfg.pac.quali * pGrid + cfg.pac.bestLap * pLap + cfg.pac.consistency * pCons + cfg.pac.poleGap * pPole;
    const racPct =
      cfg.rac.finish * pFinish + cfg.rac.gained * pGained + cfg.rac.overtakes * pOvertakes + cfg.rac.podium * pPodium;
    const ahaPct =
      cfg.aha.finishRate * pFinishRate +
      cfg.aha.dnf * pDnf +
      cfg.aha.consistency * pConsistency +
      cfg.aha.contacts * pContacts +
      cfg.aha.env * pEnv +
      cfg.aha.penalties * pPenalties +
      cfg.aha.cuts * pCuts;

    const pac = clampRating(pacPct, cfg.bands.pac);
    const rac = clampRating(racPct, cfg.bands.rac);
    const aha = clampRating(ahaPct, cfg.bands.aha);
    const exp = clampRating(expPct, cfg.bands.exp);
    // The overall is purely the weighted blend of the four sub-ratings.
    const blended =
      cfg.rtg.rac * rac + cfg.rtg.pac * pac + cfg.rtg.aha * aha + cfg.rtg.exp * exp;
    const overall = Math.min(99, Math.round(blended));

    return {
      driverId: driver.id,
      name: driver.name,
      tier: driver.tier,
      team: { id: driver.team.id, name: driver.team.name, color: driver.team.color, tier: driver.team.tier },
      starts: m.starts,
      finishes: m.finishes,
      wins: m.wins,
      podiums: m.podiums,
      contacts: contactsById.get(driver.id)?.total ?? null,
      // null (not 0) when the driver has no telemetry for that signal, so the
      // admin table shows "–" instead of a misleading zero.
      overtakes: telById.get(driver.id)?.ratedOt ? telById.get(driver.id).overtakes : null,
      envContacts: telById.get(driver.id)?.ratedEnv ? telById.get(driver.id).env : null,
      gamePenalties: telById.get(driver.id)?.ratedPen ? telById.get(driver.id).gamePen : null,
      provisional: m.starts < PROVISIONAL_BELOW,
      // Career-window inputs behind EXP/PAC, for the admin table and the
      // profile breakdown (starts toward fullStarts, championship score,
      // finish rate vs the threshold, seasons raced in the window).
      career: cw
        ? {
            starts: cw.starts,
            finishes: cw.finishes,
            finishRate: cw.finishRate,
            activeSeasons: cw.activeSeasons,
            windowSize: cw.windowSize,
            champPct: Math.round(cw.champPct * 1000) / 1000,
          }
        : null,
      ratings: { overall, exp, pac, rac, aha },
    };
  });

  rows.sort((a, b) => b.ratings.overall - a.ratings.overall || b.starts - a.starts || a.name.localeCompare(b.name));
  return rows;
}
