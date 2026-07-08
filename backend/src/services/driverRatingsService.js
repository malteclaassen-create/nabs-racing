// ---------------------------------------------------------------------------
// Driver Ratings service — EA-/F1-25-style rating cards, computed automatically
// from a season's real race data. Every driver gets four sub-ratings plus an
// overall:
//
//   EXP  Experience  — how many races the driver has under their belt
//   PAC  Pace        — raw speed: best-lap pace vs the field + qualifying (grid)
//   RAC  Racecraft   — race result: finishing position, places gained, podiums
//   AHA  Awareness   — cleanliness/consistency: finish rate, few DNFs, low spread
//   RTG  Overall     — weighted blend of the four (RAC + PAC weigh most)
//
// All four are RELATIVE to the season's field: we rank each driver against the
// pack of regulars and map that rank onto a 60–93 band, so the grid looks like
// the official cards (best ~90+, backmarkers ~60s) instead of clumping in the
// middle. Low-sample drivers (a reserve with one or two outings) are pulled
// toward the field average ("shrinkage") so a single lucky/unlucky race can't
// rocket them to 90 or sink them to 60, and they are flagged `provisional`.
//
// Pure read service in the style of standingsService / driverProfileService:
// no DB writes, recomputes on every call, so it always reflects the latest
// imported results.
// ---------------------------------------------------------------------------
import { telemetryBySeason } from "../lib/telemetryRead.js";
import { readRatingWeights } from "../lib/ratingWeights.js";

// --- tunables (kept together so the curve is easy to adjust) ----------------
const BAND_LOW = 58; // worst-in-field maps here
const BAND_HIGH = 96; // best-in-field maps here
const SHRINK_K = 3; // pull small samples toward the field mean by this much
const NO_SHRINK_ABOVE = 6; // a real regular (>= this many samples) isn't shrunk,
//                            so a dominant driver isn't dragged back to the mean
const MIN_STARTS_REF = 3; // a "regular": sets the scale everyone is measured on
const PROVISIONAL_BELOW = 3; // fewer starts than this -> rating shown as provisional
// Experience saturates: once a driver has raced this share of the season's run
// rounds they count as a seasoned regular (full EXP), so missing a race or two
// no longer tanks the score. Below it, EXP scales down toward the reserves.
const FULL_XP_SHARE = 0.7;

// How the overall RTG is blended from the four sub-ratings.
const RTG_WEIGHTS = { rac: 0.35, pac: 0.3, aha: 0.2, exp: 0.15 };
// How each sub-rating is blended from its underlying percentile components.
const PAC_WEIGHTS = { lap: 0.65, grid: 0.35 };
// Racecraft: finishing position, places gained, on-track overtakes and podiums.
const RAC_WEIGHTS = { finish: 0.45, gained: 0.2, overtakes: 0.15, podium: 0.2 };
// Awareness/discipline: reliability (finishing, few DNFs), lap consistency, and
// staying out of trouble (car contacts, off-track/env hits, in-game penalties).
// `cuts` is available as a tunable but defaults to 0 (old seasons log no cuts).
const AHA_WEIGHTS = { finishRate: 0.25, dnf: 0.15, consistency: 0.25, contacts: 0.15, env: 0.1, penalties: 0.1, cuts: 0 };
// A dominant driver (high win share) gets a small boost on top of the blended
// overall, so a season's runaway leader reads ~99 instead of capping in the low
// 90s. boost = max * min(1, winShare / fullAt).
const DOMINANCE = { max: 6, fullAt: 0.6 };

// All knobs in one place, so the admin tuning panel can read the defaults and
// pass back overrides. `band` is the visible 0–99 range; the rest are the blend
// weights for the overall and each sub-rating.
export const RATING_DEFAULTS = {
  band: { low: BAND_LOW, high: BAND_HIGH },
  fullXpShare: FULL_XP_SHARE,
  dominance: { ...DOMINANCE },
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
export function resolveConfig(opts = {}) {
  const low = Number(opts.band?.low);
  const high = Number(opts.band?.high);
  const domMax = Number(opts.dominance?.max);
  const domFullAt = Number(opts.dominance?.fullAt);
  return {
    band: {
      low: Number.isFinite(low) ? low : BAND_LOW,
      high: Number.isFinite(high) ? high : BAND_HIGH,
    },
    fullXpShare: Number.isFinite(Number(opts.fullXpShare)) ? Number(opts.fullXpShare) : FULL_XP_SHARE,
    dominance: {
      max: Number.isFinite(domMax) ? domMax : DOMINANCE.max,
      fullAt: Number.isFinite(domFullAt) && domFullAt > 0 ? domFullAt : DOMINANCE.fullAt,
    },
    rtg: normalizeGroup(opts.rtg, RTG_WEIGHTS),
    pac: normalizeGroup(opts.pac, PAC_WEIGHTS),
    rac: normalizeGroup(opts.rac, RAC_WEIGHTS),
    aha: normalizeGroup(opts.aha, AHA_WEIGHTS),
  };
}

// Small overall boost for a runaway leader. Pure/exported for testing.
export function dominanceBoost(wins, racesRun, dominance = DOMINANCE) {
  if (!racesRun || racesRun < 1) return 0;
  const winShare = wins / racesRun;
  return Math.round(dominance.max * Math.min(1, winShare / dominance.fullAt));
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
// `opts` may override any of the tunables (see RATING_DEFAULTS): `band`,
// `fullXpShare`, and the `rtg` / `pac` / `rac` / `aha` weight groups. Each weight
// group is normalised, so partial or unnormalised input is fine. Omitted -> the
// defaults above. Used by the admin tuning panel to preview different curves.
export async function getDriverRatings(prisma, seasonId, opts = {}) {
  // Persisted admin weights are the baseline; explicit opts (the admin preview)
  // override them group-by-group. Both fall through to RATING_DEFAULTS.
  const saved = (await readRatingWeights(prisma)) || {};
  const cfg = resolveConfig({ ...saved, ...opts });
  const [drivers, races, results, telemetry] = await Promise.all([
    prisma.driver.findMany({ where: { seasonId }, include: { team: true } }),
    prisma.race.findMany({
      where: { seasonId, isSpecialEvent: false, isCompleted: true },
      orderBy: { number: "asc" },
    }),
    prisma.raceResult.findMany({ where: { race: { seasonId } } }),
    telemetryBySeason(prisma, seasonId),
  ]);

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

  // Races needed to count as a fully seasoned regular (EXP saturates here).
  const fullXp = Math.max(4, Math.round(races.length * cfg.fullXpShare));

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
  // data for that signal, so it drops to a neutral percentile).
  for (const { driver, m } of raw) {
    const c = contactsById.get(driver.id);
    m.contactsRate = c && c.rated > 0 && m.starts ? c.total / m.starts : null;
    const t = telById.get(driver.id);
    m.overtakesRate = t && t.ratedOt > 0 ? t.overtakes / t.ratedOt : null;
    m.envRate = t && t.ratedEnv > 0 && m.starts ? t.env / m.starts : null;
    m.penaltyRate = t && t.ratedPen > 0 && m.starts ? t.gamePen / m.starts : null;
    m.cutsRate = t && t.consDen > 0 && m.starts ? t.cuts / m.starts : null;
    m.lapConsistencyMs = t && t.consDen > 0 ? t.consNum / t.consDen : null;
  }

  // The reference field = the regulars (>= MIN_STARTS_REF). Their distribution
  // sets both the shrinkage mean and the percentile scale that EVERYONE — even a
  // one-race reserve — is then measured against.
  const ref = raw.filter((x) => x.m.starts >= MIN_STARTS_REF).map((x) => x.m);
  // Fallback for a brand-new season with too few regulars: use the whole field.
  const refField = ref.length >= 3 ? ref : raw.map((x) => x.m);

  const refMean = {
    lapGap: mean(refField.map((m) => m.avgLapGap).filter((x) => x != null)),
    gridNorm: mean(refField.map((m) => m.avgGridNorm).filter((x) => x != null)),
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
    lapGap: refField.map((m) => shrink(m.avgLapGap, m.nLap, refMean.lapGap)),
    gridNorm: refField.map((m) => shrink(m.avgGridNorm, m.nGrid, refMean.gridNorm)),
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
    const pLap = percentile(shrink(m.avgLapGap, m.nLap, refMean.lapGap), refDist.lapGap, false);
    const pGrid = percentile(shrink(m.avgGridNorm, m.nGrid, refMean.gridNorm), refDist.gridNorm, false);
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
    // Experience is absolute & saturating (not a percentile): at `fullXp`+ races
    // you're a full-marks regular, so missing a round or two barely moves it.
    const expPct = Math.min(1, m.starts / fullXp);

    const pacPct = cfg.pac.lap * pLap + cfg.pac.grid * pGrid;
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

    const pac = clampRating(pacPct, cfg.band);
    const rac = clampRating(racPct, cfg.band);
    const aha = clampRating(ahaPct, cfg.band);
    const exp = clampRating(expPct, cfg.band);
    // Blended overall, then a small dominance boost so a runaway leader reads
    // ~99 rather than capping in the low 90s.
    const blended =
      cfg.rtg.rac * rac + cfg.rtg.pac * pac + cfg.rtg.aha * aha + cfg.rtg.exp * exp;
    const overall = Math.min(99, Math.round(blended) + dominanceBoost(m.wins, races.length, cfg.dominance));

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
      ratings: { overall, exp, pac, rac, aha },
    };
  });

  rows.sort((a, b) => b.ratings.overall - a.ratings.overall || b.starts - a.starts || a.name.localeCompare(b.name));
  return rows;
}
