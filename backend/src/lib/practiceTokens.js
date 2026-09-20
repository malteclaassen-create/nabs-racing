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
  practiceServerOn,
  tokensPublic,
  tunedRules,
  tunedStartDay,
  isEarningOn,
  ensureTokenAccount,
  dbAward,
  driverIdsFor,
  discordForDrivers,
} from "./tokens.js";
import { leagueDay } from "./tokenRules.js";
import { groupKeyFor } from "./trackKeys.js";
import { LIVE_SERVERS } from "./liveServers.js";

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
  seriesCache.clear();
  discordBySteam.clear();
  paidByPeriod.clear();
}

// ---- Which series a lap belongs to ------------------------------------------
//
// The league runs two race servers and more than one series, and the two do
// not line up by themselves:
//
//   * a server with no series assigned to it (the admin has never touched the
//     assignment, which is the normal state) used to drop every lap on the
//     floor — and the second server is exactly the one the league practices on;
//   * a server that serves BOTH series would have filed everybody's laps under
//     whichever series happened to be listed first.
//
// So the server's assignment is the first word, not the last one. When it does
// not decide the question on its own, the TRACK does: the practice server runs
// the week's circuit, and the week's circuit is the next round's. When that
// does not decide it either (an unknown track name, a fun session somewhere
// else), the DRIVER does: which series they actually race in this season.
// Only if all three are silent does it fall back to the first candidate.
const seriesCache = new Map(); // `${server}|${trackKey}|${steamId}` -> { at, slug }
const SERIES_TTL_MS = 5 * 60 * 1000;

async function activeSeriesSlugs(prisma) {
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT DISTINCT se."slug" AS "slug"
         FROM "Series" se JOIN "Season" s ON s."seriesId" = se."id"
        WHERE s."isActive" = 1`
    )
    .catch(() => []);
  return rows.map((r) => String(r.slug)).filter(Boolean);
}

// The series this Steam id races in this season, as slugs.
async function seriesOfDriver(prisma, steamId) {
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT DISTINCT se."slug" AS "slug"
         FROM "Driver" d
         JOIN "Season" s ON s."id" = d."seasonId"
         JOIN "Series" se ON se."id" = s."seriesId"
        WHERE d."steamId" = ? AND s."isActive" = 1`,
      String(steamId)
    )
    .catch(() => []);
  return rows.map((r) => String(r.slug)).filter(Boolean);
}

export async function seriesForLap(prisma, { serverKey = "", scopes = [], trackKey = "", steamId = "" } = {}) {
  const key = `${serverKey}|${trackKey}|${steamId}`;
  const hit = seriesCache.get(key);
  if (hit && Date.now() - hit.at < SERIES_TTL_MS) return hit.slug;

  const remember = (slug) => {
    seriesCache.set(key, { at: Date.now(), slug: slug || null });
    return slug || null;
  };

  const assigned = [...new Set((scopes || []).map((s) => String(s?.series || "")).filter(Boolean))];
  if (assigned.length === 1) return remember(assigned[0]);

  const candidates = assigned.length ? assigned : await activeSeriesSlugs(prisma);
  if (!candidates.length) return remember(null);
  if (candidates.length === 1) return remember(candidates[0]);

  // The track the session is on, against each candidate's next round.
  const onTrack = groupKeyFor(String(trackKey || "").split("--")[0]);
  if (onTrack) {
    const here = [];
    for (const slug of candidates) {
      const period = await currentPeriod(prisma, slug);
      if (period?.track && groupKeyFor(period.track) === onTrack) here.push(slug);
    }
    if (here.length === 1) return remember(here[0]);
  }

  // Whose driver is this.
  const mine = (await seriesOfDriver(prisma, steamId)).filter((slug) => candidates.includes(slug));
  if (mine.length === 1) return remember(mine[0]);

  return remember(candidates[0]);
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

async function countLap(prisma, { series, serverKey, scopes, steamId, car = "", trackKey = "", at = 0, laps = 1 } = {}) {
  const id = String(steamId || "");
  const stamp = Math.round(Number(at) || 0);
  // More than one lap when the relay was away while they were driving: the
  // caller counts the difference in the server's own lap counter, not the
  // number of times it happened to look.
  const many = Math.min(50, Math.max(1, Math.round(Number(laps) || 1)));
  if (!STEAM_RE.test(id) || stamp <= 0) return;
  // A server the league has switched off pays nothing and is not even
  // counted: a bar that fills from a server that will never pay for it is a
  // promise the site cannot keep.
  const from = String(serverKey || "");
  if (!practiceServerOn(from)) return;
  // `series` is only passed by the tests; the relay hands over what it knows
  // about the server and lets the rule above decide.
  const slug = series || (await seriesForLap(prisma, { serverKey, scopes, trackKey, steamId: id }));
  if (!slug) return;
  const period = await currentPeriod(prisma, slug);
  if (!period) return;

  // The lap is counted only when it is newer than the last one counted for this
  // driver, so a relay that reconnects and sees the same lap again adds nothing.
  // Nothing written means exactly that, and there is nothing else to do.
  const written = await prisma
    .$executeRawUnsafe(
      `INSERT INTO "TokenPractice" ("steamId","series","period","server","laps","trackKey","car","lastAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT("steamId","series","period","server") DO UPDATE SET
         "laps" = "laps" + excluded."laps",
         "trackKey" = excluded."trackKey",
         "car" = excluded."car",
         "lastAt" = excluded."lastAt",
         "updatedAt" = CURRENT_TIMESTAMP
       WHERE excluded."lastAt" > "TokenPractice"."lastAt"`,
      id,
      slug,
      period.key,
      from,
      many,
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
      `SELECT COALESCE(SUM("laps"), 0) AS "laps" FROM "TokenPractice"
        WHERE "steamId" = ? AND "series" = ? AND "period" = ?`,
      id,
      slug,
      period.key
    )
    .catch(() => []);
  if (Number(rows[0]?.laps || 0) < tiers[0].laps) return;

  const discordId = await discordForSteamIds(prisma, [id]);
  if (!discordId) return; // nobody to pay yet; the laps are kept all the same

  // Once a milestone is paid it stays paid, and re-running the whole payout on
  // every lap for the rest of the week is work with no answer in it.
  const memo = paidMemo(slug, period.key);
  const reached = tiers.filter((t) => Number(rows[0]?.laps || 0) >= t.laps);
  if (reached.every((t) => memo.has(`${discordId}:${t.key}`))) return;
  await payPractice(prisma, discordId, { series: slug, period });
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
      `SELECT "server" AS "server", COALESCE(SUM("laps"), 0) AS "laps",
              MAX("trackKey") AS "trackKey", MAX("car") AS "car"
         FROM "TokenPractice"
        WHERE "steamId" IN (${ph}) AND "series" = ? AND "period" = ?
        GROUP BY "server"
        ORDER BY "laps" DESC`,
      ...steamIds,
      String(series || ""),
      String(periodKey || "")
    )
    .catch(() => []);
  return {
    laps: rows.reduce((sum, r) => sum + Number(r.laps || 0), 0),
    trackKey: rows[0]?.trackKey || null,
    car: rows[0]?.car || null,
    // Where the week's laps were driven, biggest first. One server is the
    // normal case and says nothing worth printing; two is worth saying.
    servers: rows
      .map((r) => {
        const key = String(r.server || "");
        return {
          key,
          name: LIVE_SERVERS.find((s) => s.key === key)?.name || key || "Unknown server",
          laps: Number(r.laps || 0),
        };
      })
      .filter((r) => r.laps > 0),
  };
}

// ---- Paying ------------------------------------------------------------------

// What a milestone's payment is filed under. One place, because the page reads
// the same keys back to find out WHEN a milestone paid.
const refKeyFor = (tierKey, series, periodKey) => `practice:${tierKey}:${series}:${periodKey}`;

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
      refKey: refKeyFor(tier.key, series, period.key),
    });
    if (written) paid += tier.points;
  }
  return paid;
}

// ---- What the page draws -----------------------------------------------------

// This member's training weeks: how many laps, what the next milestone is,
// and which of them are already in the ledger. Pays anything outstanding on
// the way past, so opening the page settles a week the relay could not pay
// for.
//
// EVERY series, not one. NABS Points are the site's, not a series' — racing
// anywhere pays, and so does practising for anywhere. A member who races in
// two of them has two weeks running at once (each series has its own next
// round) and each pays its own milestones, exactly as two races in a week pay
// twice. `weeks` carries them all; the top level is the one that page should
// lead with, which is the series it is showing (`prefer`) and otherwise the
// one with the most laps in it.
export async function practiceProgress(prisma, discordId, { prefer = null } = {}) {
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

  const paying = await payingNow(prisma);
  const publicPages = await tokensPublic(prisma);
  const target = tiers[tiers.length - 1].laps;

  const weeks = [];
  for (const row of seriesRows) {
    const period = await currentPeriod(prisma, row.slug);
    if (!period) continue;
    const { laps, car, servers } = await lapsOf(prisma, steamIds, row.slug, period.key);
    if (laps) await payPractice(prisma, discordId, { series: row.slug, period, laps });

    // When each milestone paid. The cue at the bottom of the site celebrates a
    // payment from the last few hours and stays quiet about an older one,
    // which is what stops a week of milestones popping up on a Sunday visit.
    const keys = tiers.map((t) => refKeyFor(t.key, row.slug, period.key));
    const ph = keys.map(() => "?").join(",");
    const paidRows = await prisma
      .$queryRawUnsafe(
        `SELECT "refKey","createdAt" FROM "TokenLedger" WHERE "discordId" = ? AND "refKey" IN (${ph})`,
        discordId,
        ...keys
      )
      .catch(() => []);
    const paidAt = new Map(paidRows.map((r) => [r.refKey, r.createdAt]));

    const next = tiers.find((t) => laps < t.laps) || null;
    weeks.push({
      series: row.slug,
      seriesName: row.name,
      laps,
      target,
      label: period.label,
      period: period.key,
      car: car || null,
      servers,
      earned: tiers.filter((t) => laps >= t.laps).reduce((sum, t) => sum + t.points, 0),
      next: next ? { laps: next.laps, points: next.points, toGo: next.laps - laps } : null,
      tiers: tiers.map((t) => ({
        key: t.key,
        laps: t.laps,
        points: t.points,
        done: laps >= t.laps,
        paidAt: paidAt.get(refKeyFor(t.key, row.slug, period.key)) || null,
      })),
    });
  }
  if (!weeks.length) return null;

  const wanted = prefer ? weeks.find((w) => w.series === prefer) : null;
  const lead = wanted || weeks.reduce((a, b) => (b.laps > a.laps ? b : a), weeks[0]);
  // A series this member has not turned a lap in is not their week. The one
  // the page is showing stays either way, so a driver who has not started yet
  // still sees an empty bar to fill rather than nothing at all.
  const shown = weeks.filter((w) => w.laps > 0 || w.series === lead.series);

  return {
    // Whether a milestone would actually pay right now. The bar says so rather
    // than promising points the trial is not handing out yet.
    paying,
    // Whether the feature is out in the open (everyone-mode) rather than shown
    // to admins only. The live page is a public page and waits for this, the
    // same rule the flair and the wall follow; the member's own points page
    // does not, which is what lets an admin try the whole thing first.
    publicPages,
    ...lead,
    // Every series' week they have driven in, so a page can show the lot
    // rather than hide one.
    weeks: shown,
  };
}
