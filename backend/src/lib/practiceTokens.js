// ---------------------------------------------------------------------------
// Points for training laps.
//
// The league's practice server runs the week's track and car and sits there
// between one race and the next, so whatever it counts is the week's practice:
// 20 laps pays 10 points, 50 laps pays another 20. Every completed lap counts,
// cut or not, because this pays for time spent rather than for speed.
//
// The laps arrive one at a time from the live relay (services/liveTiming.js),
// which is connected to the race server around the clock whether anybody is
// watching the live page or not. One row per driver per week in TokenPractice,
// keyed by the Steam id, because that is the only name the race server knows;
// the Discord account behind it is looked up when a milestone pays.
//
// A WEEK IS RACE TO RACE, not Monday to Sunday: the period is the round the
// practice is leading up to, so a fortnight's break between rounds is one
// week's worth of laps and not two.
//
// Paid the moment the lap that reaches the milestone is completed, so the
// progress bar on the points page and the bell tell somebody the same evening.
// The ledger's unique (member, refKey) is what keeps that honest: the payout
// is also re-checked whenever the page is opened, which is what settles a week
// whose laps were driven while the counting was switched off.
// ---------------------------------------------------------------------------
import {
  tunedRules,
  tunedStartDay,
  isEarningOn,
  ensureTokenAccount,
  dbAward,
  driverIdsFor,
  discordForDrivers,
} from "./tokens.js";
import { leagueDay } from "./tokenRules.js";

const STEAM_RE = /^\d{10,20}$/;

// The milestones, as the league has them set: lowest first.
export function practiceTiers() {
  return tunedRules()
    .filter((r) => Number(r.laps) > 0)
    .map((r) => ({
      key: r.key,
      label: r.label,
      laps: Number(r.laps),
      points: Number(r.points) || 0,
      active: r.active !== false,
    }))
    .sort((a, b) => a.laps - b.laps);
}

// ---- Which week the laps belong to ------------------------------------------

// The next round of a series, which is what its training week is for. Held for
// a few minutes: it is asked on every lap, and it changes once a fortnight.
const periodCache = new Map(); // series slug -> { at, period }
const PERIOD_TTL_MS = 5 * 60 * 1000;

// Monday of the week an instant falls in, league time. Only used when the
// calendar has run out: with no round ahead there is nothing to train for, but
// the laps still have to land somewhere rather than pile onto the last round.
function weekKey(now = Date.now()) {
  const day = leagueDay(now);
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export async function currentPeriod(prisma, series, now = Date.now()) {
  const slug = String(series || "");
  if (!slug) return null;
  const hit = periodCache.get(slug);
  if (hit && now - hit.at < PERIOD_TTL_MS) return hit.period;

  let period = { key: `week:${weekKey(now)}`, label: "This week", raceId: null, track: null, date: null };
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT ra."id", ra."track", ra."number", ra."date"
         FROM "Race" ra
         JOIN "Season" s ON s."id" = ra."seasonId"
         JOIN "Series" se ON se."id" = s."seriesId"
        WHERE se."slug" = ? AND s."isActive" = 1
          AND ra."isCompleted" = 0 AND ra."isSpecialEvent" = 0
        ORDER BY (ra."date" IS NULL), ra."date" ASC, ra."number" ASC
        LIMIT 1`,
      slug
    );
    const r = rows[0];
    if (r?.id) {
      period = {
        key: `race:${r.id}`,
        label: r.number ? `Round ${r.number}, ${r.track}` : String(r.track || "Next round"),
        raceId: r.id,
        track: r.track || null,
        date: r.date || null,
      };
    }
  } catch {
    // A database that cannot answer is not a reason to stop counting laps: the
    // week key below still files them somewhere sensible.
  }
  periodCache.set(slug, { at: now, period });
  return period;
}

export function __clearCaches() {
  periodCache.clear();
  discordBySteam.clear();
  paidByPeriod.clear();
}

// ---- Counting ---------------------------------------------------------------

// The relay hands laps in as they happen and must not wait for a database, so
// the work is chained rather than awaited. One chain for all of them, which
// also means two laps crossing the line in the same tick cannot both read the
// same lap count and pay the same milestone twice.
let chain = Promise.resolve();

export function notePracticeLap(prisma, lap) {
  chain = chain.then(() => countLap(prisma, lap)).catch(() => {});
  return chain;
}

// Wait for whatever is still being written. Tests use it; nothing else does.
export function practiceWritesSettled() {
  return chain;
}

async function countLap(prisma, { series, steamId, car = "", trackKey = "", at = 0 } = {}) {
  const id = String(steamId || "");
  const stamp = Math.round(Number(at) || 0);
  if (!STEAM_RE.test(id) || stamp <= 0) return;
  const period = await currentPeriod(prisma, series);
  if (!period) return;

  // The lap is counted only when it is newer than the last one counted for this
  // driver, so a relay that reconnects and sees the same lap again adds nothing.
  // Nothing written means exactly that, and there is nothing else to do.
  const written = await prisma
    .$executeRawUnsafe(
      `INSERT INTO "TokenPractice" ("steamId","series","period","laps","trackKey","car","lastAt","updatedAt")
       VALUES (?,?,?,1,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT("steamId","series","period") DO UPDATE SET
         "laps" = "laps" + 1,
         "trackKey" = excluded."trackKey",
         "car" = excluded."car",
         "lastAt" = excluded."lastAt",
         "updatedAt" = CURRENT_TIMESTAMP
       WHERE excluded."lastAt" > "TokenPractice"."lastAt"`,
      id,
      String(series || ""),
      period.key,
      String(trackKey || "").slice(0, 80) || null,
      String(car || "").slice(0, 80) || null,
      stamp
    )
    .catch(() => 0);
  if (!Number(written)) return;

  // Everything below is the payout, and most laps are nowhere near a
  // milestone. The row's own count is one cheap read that decides whether the
  // rest of it is worth doing at all.
  const tiers = practiceTiers().filter((t) => t.active && t.points > 0);
  if (!tiers.length) return;
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT "laps" FROM "TokenPractice" WHERE "steamId" = ? AND "series" = ? AND "period" = ?`,
      id,
      String(series || ""),
      period.key
    )
    .catch(() => []);
  if (Number(rows[0]?.laps || 0) < tiers[0].laps) return;

  const discordId = await discordForSteamIds(prisma, [id]);
  if (!discordId) return; // nobody to pay yet; the laps are kept all the same

  // Once a milestone is paid it stays paid, and re-running the whole payout on
  // every lap for the rest of the week is work with no answer in it.
  const memo = paidMemo(series, period.key);
  const reached = tiers.filter((t) => Number(rows[0]?.laps || 0) >= t.laps);
  if (reached.every((t) => memo.has(`${discordId}:${t.key}`))) return;
  await payPractice(prisma, discordId, { series, period });
  for (const t of reached) memo.add(`${discordId}:${t.key}`);
}

// What this process has already paid, for the week it is in. One week at a
// time: when the round changes the old set goes, so this cannot grow.
const paidByPeriod = new Map();
function paidMemo(series, periodKey) {
  const key = `${series}|${periodKey}`;
  if (!paidByPeriod.has(key)) {
    paidByPeriod.clear();
    paidByPeriod.set(key, new Set());
  }
  return paidByPeriod.get(key);
}

// ---- Who the laps belong to --------------------------------------------------

// The Discord account behind a Steam id, following the person links the way
// every other payout does.
const discordBySteam = new Map(); // steamId -> { at, discordId } — a lap-rate lookup
const STEAM_TTL_MS = 10 * 60 * 1000;

async function discordForSteamIds(prisma, steamIds) {
  const ids = [...new Set((steamIds || []).filter((v) => STEAM_RE.test(String(v || ""))))];
  if (!ids.length) return null;
  if (ids.length === 1) {
    const hit = discordBySteam.get(ids[0]);
    if (hit && Date.now() - hit.at < STEAM_TTL_MS) return hit.discordId;
  }
  const ph = ids.map(() => "?").join(",");
  const rows = await prisma
    .$queryRawUnsafe(`SELECT "id","discordUserId" FROM "Driver" WHERE "steamId" IN (${ph})`, ...ids)
    .catch(() => []);
  const remember = (v) => {
    if (ids.length === 1) discordBySteam.set(ids[0], { at: Date.now(), discordId: v });
    return v;
  };
  if (!rows.length) return remember(null);
  for (const r of rows) if (r.discordUserId) return remember(r.discordUserId);
  const linked = await discordForDrivers(prisma, rows.map((r) => r.id)).catch(() => new Map());
  for (const v of linked.values()) if (v) return remember(v);
  return remember(null);
}

// Every Steam id this member races under, across seasons and series.
async function steamIdsFor(prisma, discordId) {
  const driverIds = await driverIdsFor(prisma, discordId).catch(() => []);
  if (!driverIds.length) return [];
  const ph = driverIds.map(() => "?").join(",");
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT DISTINCT "steamId" FROM "Driver" WHERE "id" IN (${ph}) AND "steamId" IS NOT NULL`,
      ...driverIds
    )
    .catch(() => []);
  return rows.map((r) => String(r.steamId)).filter((v) => STEAM_RE.test(v));
}

async function lapsOf(prisma, steamIds, series, periodKey) {
  if (!steamIds.length) return { laps: 0, trackKey: null, car: null };
  const ph = steamIds.map(() => "?").join(",");
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT COALESCE(SUM("laps"), 0) AS "laps",
              MAX("trackKey") AS "trackKey", MAX("car") AS "car"
         FROM "TokenPractice"
        WHERE "steamId" IN (${ph}) AND "series" = ? AND "period" = ?`,
      ...steamIds,
      String(series || ""),
      String(periodKey || "")
    )
    .catch(() => []);
  return {
    laps: Number(rows[0]?.laps || 0),
    trackKey: rows[0]?.trackKey || null,
    car: rows[0]?.car || null,
  };
}

// ---- Paying ------------------------------------------------------------------

// Has the counting even started? Same two gates every other rule passes: the
// league's switch, and the day it decided to start from.
async function payingNow(prisma) {
  if (!(await isEarningOn(prisma))) return false;
  const from = tunedStartDay();
  return !from || leagueDay() >= from;
}

// Pay whatever this member has reached in one week and has not been paid for.
// Safe to call as often as you like: the ledger drops the second attempt.
export async function payPractice(prisma, discordId, { series, period, laps = null } = {}) {
  if (!discordId || !period) return 0;
  const tiers = practiceTiers().filter((t) => t.active && t.points > 0);
  if (!tiers.length) return 0;
  if (!(await payingNow(prisma))) return 0;

  const count = laps == null ? (await lapsOf(prisma, await steamIdsFor(prisma, discordId), series, period.key)).laps : laps;
  if (!count) return 0;

  let paid = 0;
  for (const tier of tiers) {
    if (count < tier.laps) continue;
    await ensureTokenAccount(prisma, discordId);
    const written = await dbAward(prisma, {
      discordId,
      delta: tier.points,
      rule: tier.key,
      title: tier.label,
      detail: period.label,
      refKey: `practice:${tier.key}:${series}:${period.key}`,
    });
    if (written) paid += tier.points;
  }
  return paid;
}

// ---- What the page draws -----------------------------------------------------

// This member's training week: how many laps, what the next milestone is, and
// which of them are already in the ledger. Pays anything outstanding on the
// way past, so opening the page settles a week the relay could not pay for.
//
// A member who races in two series gets the one they have done the most laps
// in this week, which on this league's calendar is the only one they are
// training for anyway.
export async function practiceProgress(prisma, discordId) {
  const tiers = practiceTiers().filter((t) => t.active && t.points > 0);
  if (!tiers.length || !discordId) return null;
  // No Steam id on file means the race server cannot tell this member's laps
  // from anybody else's, so there is nothing to draw.
  const steamIds = await steamIdsFor(prisma, discordId);
  if (!steamIds.length) return null;

  const seriesRows = await prisma
    .$queryRawUnsafe(
      `SELECT DISTINCT se."slug" AS "slug", se."name" AS "name"
         FROM "Series" se JOIN "Season" s ON s."seriesId" = se."id"
        WHERE s."isActive" = 1`
    )
    .catch(() => []);

  let best = null;
  for (const row of seriesRows) {
    const period = await currentPeriod(prisma, row.slug);
    if (!period) continue;
    const { laps, trackKey, car } = await lapsOf(prisma, steamIds, row.slug, period.key);
    const cand = { series: row.slug, seriesName: row.name, period, laps, trackKey, car };
    if (!best || cand.laps > best.laps) best = cand;
  }
  if (!best) return null;

  if (best.laps) await payPractice(prisma, discordId, { series: best.series, period: best.period, laps: best.laps });

  const done = tiers.filter((t) => best.laps >= t.laps);
  const next = tiers.find((t) => best.laps < t.laps) || null;
  return {
    laps: best.laps,
    // What the bar runs to, so the second milestone is the end of it.
    target: tiers[tiers.length - 1].laps,
    label: best.period.label,
    series: best.series,
    seriesName: best.seriesName,
    car: best.car || null,
    earned: done.reduce((sum, t) => sum + t.points, 0),
    next: next ? { laps: next.laps, points: next.points, toGo: next.laps - best.laps } : null,
    tiers: tiers.map((t) => ({ laps: t.laps, points: t.points, done: best.laps >= t.laps })),
  };
}
