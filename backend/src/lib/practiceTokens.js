// ---------------------------------------------------------------------------
// Points for training laps.
//
// The league's practice server runs the week's track and car and sits there
// between one race and the next, so whatever it counts is the week's practice:
// 20 laps pays 10 points, 50 laps pays another 20. Every completed lap counts,
// cut or not, because this pays for time spent rather than for speed.
//
// EACH RACE SERVER COUNTS FOR ITSELF. Nineteen laps on one and nineteen on the
// other is nothing: the milestone is twenty laps on a server, not twenty laps
// added up across the league's machines. The two servers run different cars on
// different circuits in the same week, so a week split between them is two
// half-weeks of preparation and not one whole one.
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
// is also re-checked whenever the page is opened. Laps driven while the
// counting is off still count for the week they are in, and pay when it is
// switched on; earlier weeks do not.
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
import { raceKickoff } from "./raceKickoff.js";
import { groupKeyFor, trackKeyFor } from "./trackKeys.js";
import { LIVE_SERVERS } from "./liveServers.js";
import { boardScopes } from "./liveBestLaps.js";

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
  if (hit && now - hit.at < PERIOD_TTL_MS && !(hit.until && now >= hit.until)) return hit.period;

  let period = { key: `week:${weekKey(now)}`, label: "This week", raceId: null, track: null, date: null };
  let turnsAt = null;
  try {
    // The week ends when the round starts (the briefing, 19:30 on a Friday),
    // not when somebody gets round to importing the results. A round whose
    // start has passed is over for training whether it is marked done or not.
    const rows = await prisma.$queryRawUnsafe(
      `SELECT ra."id", ra."track", ra."number", ra."date", ra."isCompleted"
         FROM "Race" ra
         JOIN "Season" s ON s."id" = ra."seasonId"
         JOIN "Series" se ON se."id" = s."seriesId"
        WHERE se."slug" = ? AND s."isActive" = 1 AND ra."isSpecialEvent" = 0
        ORDER BY (ra."date" IS NULL), ra."date" ASC, ra."number" ASC`,
      slug
    );
    const r = rows.find((row) => {
      if (row.date == null) return !Number(row.isCompleted);
      const start = raceKickoff(new Date(Number(row.date)));
      return start && start.getTime() > now;
    });
    if (r?.id) {
      const start = r.date == null ? null : raceKickoff(new Date(Number(r.date)));
      turnsAt = start ? start.getTime() : null;
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
  // Held until the round starts at the latest, so the switch happens on time.
  periodCache.set(slug, { at: now, period, until: turnsAt });
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

// Which series a SERVER is being used for, with no lap and no driver to go
// on: what the league assigned it, else the first active series. Only used to
// give a server nobody has driven on yet an empty bar with a week behind it.
export async function seriesForServer(prisma, serverKey) {
  const assigned = [...new Set(boardScopes(serverKey).map((s) => String(s?.series || "")).filter(Boolean))];
  if (assigned.length === 1) return assigned[0];
  const active = await activeSeriesSlugs(prisma);
  return assigned.find((slug) => active.includes(slug)) || active[0] || null;
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

// ---- Is this lap on the week's track ----------------------------------------
//
// After a race the server stays on the circuit it was raced on, in a practice
// session, until the league puts the next round's track up. Laps driven there
// are not practice for the next round, but the week already belongs to it, so
// they used to fill the next round's bar before its track was even on the
// server. A lap counts once the server runs the round's circuit.
//
// Only a clear mismatch is refused: both names known circuits, and different
// ones. An unknown track name (a new mod, a round with no track yet) is let
// through, as before, rather than silently paying nobody.
export function offTrack(periodTrack, lapTrackKey) {
  const want = trackKeyFor(String(periodTrack || ""));
  const got = trackKeyFor(String(lapTrackKey || "").split("--")[0]);
  return !!(want && got && want !== got);
}

// A member's rows for the running weeks, summed per server, series and week,
// leaving out a row whose laps were driven on the old circuit.
function sumOnTrack(rows, periods) {
  const out = new Map();
  for (const r of rows || []) {
    const p = periods.find((x) => x.slug === r.series && x.period.key === r.period);
    if (p && offTrack(p.period.track, r.trackKey)) continue;
    const key = `${r.server}|${r.series}|${r.period}`;
    const have = out.get(key);
    if (have) {
      have.laps += Number(r.laps || 0);
      if (!have.car && r.car) have.car = r.car;
    } else {
      out.set(key, { server: r.server, series: r.series, period: r.period, laps: Number(r.laps || 0), car: r.car || null });
    }
  }
  return [...out.values()];
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
  // Counted while the counting is off too: this week's laps pay once it is
  // switched on (settleThisWeek). Older weeks are cleared at that moment.
  // `series` is only passed by the tests; the relay hands over what it knows
  // about the server and lets the rule above decide.
  const slug = series || (await seriesForLap(prisma, { serverKey, scopes, trackKey, steamId: id }));
  if (!slug) return;
  const period = await currentPeriod(prisma, slug);
  if (!period) return;
  if (offTrack(period.track, trackKey)) return;

  // Laps already filed for this week from the old circuit (from before this
  // rule, or a server that went back to it) are not practice for this round:
  // the first lap on the right track starts the count again.
  const filed = await prisma
    .$queryRawUnsafe(
      `SELECT "trackKey" FROM "TokenPractice"
        WHERE "steamId" = ? AND "series" = ? AND "period" = ? AND "server" = ?`,
      id,
      slug,
      period.key,
      from
    )
    .catch(() => []);
  const restart = filed.length > 0 && offTrack(period.track, filed[0].trackKey) ? 1 : 0;

  // The lap is counted only when it is newer than the last one counted for this
  // driver, so a relay that reconnects and sees the same lap again adds nothing.
  // Nothing written means exactly that, and there is nothing else to do.
  const written = await prisma
    .$executeRawUnsafe(
      `INSERT INTO "TokenPractice" ("steamId","series","period","server","laps","trackKey","car","lastAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT("steamId","series","period","server") DO UPDATE SET
         "laps" = CASE WHEN ? THEN excluded."laps" ELSE "laps" + excluded."laps" END,
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
      stamp,
      restart
    )
    .catch(() => 0);
  if (!Number(written)) return;

  // Everything below is the payout, and most laps are nowhere near a
  // milestone. The row's own count is one cheap read that decides whether the
  // rest of it is worth doing at all.
  const tiers = practiceTiers().filter((t) => t.active && t.points > 0);
  if (!tiers.length) return;
  // THIS server's laps in this week, which is what the milestones are counted
  // against. The other server's week is its own.
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT "laps" FROM "TokenPractice"
        WHERE "steamId" = ? AND "series" = ? AND "period" = ? AND "server" = ?`,
      id,
      slug,
      period.key,
      from
    )
    .catch(() => []);
  const here = Number(rows[0]?.laps || 0);
  if (here < tiers[0].laps) return;

  const discordId = await discordForSteamIds(prisma, [id]);
  if (!discordId) return; // nobody to pay yet; the laps are kept all the same

  // Once a milestone is paid it stays paid, and re-running the whole payout on
  // every lap for the rest of the week is work with no answer in it.
  const memo = paidMemo(slug, period.key);
  const reached = tiers.filter((t) => here >= t.laps);
  if (reached.every((t) => memo.has(`${discordId}:${from}:${t.key}`))) return;
  await payPractice(prisma, discordId, { series: slug, period, server: from, laps: here });
  for (const t of reached) memo.add(`${discordId}:${from}:${t.key}`);
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

// ---- Paying ------------------------------------------------------------------

// What the league calls a race server.
export const serverName = (key) =>
  LIVE_SERVERS.find((s) => s.key === String(key || ""))?.name || String(key || "") || "Unknown server";

// The servers a training lap can count on right now: the league's, minus any
// it has switched off in the admin.
export const countingServers = () => LIVE_SERVERS.filter((s) => practiceServerOn(s.key));

// What a milestone's payment is filed under. One place, because the page reads
// the same keys back to find out WHEN a milestone paid.
const refKeyFor = (tierKey, series, periodKey, server) =>
  `practice:${tierKey}:${series}:${periodKey}:${server || ""}`;

// Has the counting even started? Same two gates every other rule passes: the
// league's switch, and the day it decided to start from.
async function payingNow(prisma) {
  if (!(await isEarningOn(prisma))) return false;
  const from = tunedStartDay();
  return !from || leagueDay() >= from;
}

// Pay whatever this member has reached in one week and has not been paid for.
// Safe to call as often as you like: the ledger drops the second attempt.
export async function payPractice(prisma, discordId, { series, period, server = "", laps = 0 } = {}) {
  if (!discordId || !period || !laps) return 0;
  const tiers = practiceTiers().filter((t) => t.active && t.points > 0);
  if (!tiers.length) return 0;
  if (!(await payingNow(prisma))) return 0;

  const where = serverName(server);
  let paid = 0;
  for (const tier of tiers) {
    if (laps < tier.laps) continue;
    await ensureTokenAccount(prisma, discordId);
    const written = await dbAward(prisma, {
      discordId,
      delta: tier.points,
      rule: tier.key,
      title: tier.label,
      // The server, and nothing about the round: the milestones are per
      // server, the two servers are not at the same round in the same week,
      // and the ledger row carries its own date for "which week was that".
      detail: where,
      refKey: refKeyFor(tier.key, series, period.key, server),
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
// ONE ENTRY PER RACE SERVER, because that is what a week is here: each server
// carries its own milestones, and a server is only ever being used for one
// thing at a time. The series still decides WHEN the week turns over (its next
// round), but it is not a second dimension of the list — listing a server once
// per series put the same machine on the page twice, with two different
// numbers, which is a week nobody can read.
//
// Which series a server's week belongs to is answered by the laps themselves:
// whatever the counting decided while they were being driven. A server nobody
// has turned a lap on yet falls back to its assignment, and then to the first
// active series, so it still has an empty bar to fill.
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
  const servers = countingServers();
  if (!servers.length || !seriesRows.length) return null;

  // Every series' week that is running right now.
  const periods = [];
  for (const row of seriesRows) {
    const period = await currentPeriod(prisma, row.slug);
    if (period) periods.push({ slug: row.slug, name: row.name, period });
  }
  if (!periods.length) return null;

  // This member's laps inside those weeks, per server and series, in one read.
  const ph = steamIds.map(() => "?").join(",");
  const periodPh = periods.map(() => "?").join(",");
  const lapRows = await prisma
    .$queryRawUnsafe(
      `SELECT "server" AS "server", "series" AS "series", "period" AS "period",
              "laps" AS "laps", "car" AS "car", "trackKey" AS "trackKey"
         FROM "TokenPractice"
        WHERE "steamId" IN (${ph}) AND "period" IN (${periodPh})`,
      ...steamIds,
      ...periods.map((p) => p.period.key)
    )
    .then((rows) => sumOnTrack(rows, periods))
    .catch(() => []);

  const weeks = [];
  for (const srv of servers) {
    // What this server has been used for this week: the series its laps were
    // filed under. Ties go to the bigger number, which is the one being driven.
    const mine = lapRows
      .filter((r) => String(r.server || "") === srv.key)
      .map((r) => ({ ...r, laps: Number(r.laps || 0) }))
      .sort((a, b) => b.laps - a.laps);
    let on = mine[0]
      ? periods.find((p) => p.slug === mine[0].series && p.period.key === mine[0].period)
      : null;
    if (!on) {
      const slug = await seriesForServer(prisma, srv.key);
      on = periods.find((p) => p.slug === slug) || periods[0];
    }
    const laps = mine[0]?.laps || 0;
    if (laps) await payPractice(prisma, discordId, { series: on.slug, period: on.period, server: srv.key, laps });

    const keys = tiers.map((t) => refKeyFor(t.key, on.slug, on.period.key, srv.key));
    const keyPh = keys.map(() => "?").join(",");
    const paidRows = await prisma
      .$queryRawUnsafe(
        `SELECT "refKey","createdAt" FROM "TokenLedger" WHERE "discordId" = ? AND "refKey" IN (${keyPh})`,
        discordId,
        ...keys
      )
      .catch(() => []);
    const paidAt = new Map(paidRows.map((r) => [r.refKey, r.createdAt]));

    const next = tiers.find((t) => laps < t.laps) || null;
    weeks.push({
      series: on.slug,
      seriesName: on.name,
      server: srv.key,
      serverName: srv.name,
      laps,
      target,
      label: on.period.label,
      period: on.period.key,
      car: mine[0]?.car || null,
      earned: tiers.filter((t) => laps >= t.laps).reduce((sum, t) => sum + t.points, 0),
      next: next ? { laps: next.laps, points: next.points, toGo: next.laps - laps } : null,
      tiers: tiers.map((t) => ({
        key: t.key,
        laps: t.laps,
        points: t.points,
        done: laps >= t.laps,
        paidAt: paidAt.get(refKeyFor(t.key, on.slug, on.period.key, srv.key)) || null,
      })),
    });
  }

  // The one a page should lead with: the server showing the series it asked
  // for, else the fullest bar.
  const mineFirst = prefer ? weeks.filter((w) => w.series === prefer) : [];
  const pool = mineFirst.length ? mineFirst : weeks;
  const lead = pool.reduce((a, b) => (b.laps > a.laps ? b : a), pool[0]);

  return {
    // Whether a milestone would actually pay right now. The bar says so rather
    // than promising points the trial is not handing out yet.
    paying,
    // Whether the feature is out in the open (everyone-mode) rather than shown
    // to admins only. The live page is a public page and waits for this, the
    // same rule the flair and the hall of fame wall follow; the member's own
    // points page does not, which lets an admin try the whole thing first.
    publicPages,
    ...lead,
    // One per race server, in the league's own order.
    weeks,
  };
}

// The counting has just been switched on. This week's laps count (the league
// wanted "from this week"), so whatever they already reached pays now, before
// the round starts and the week is gone. Laps from earlier weeks are dropped.
export async function settleThisWeek(prisma) {
  const seriesRows = await prisma
    .$queryRawUnsafe(
      `SELECT DISTINCT se."slug" AS "slug" FROM "Series" se JOIN "Season" s ON s."seriesId" = se."id" WHERE s."isActive" = 1`
    )
    .catch(() => []);
  const current = [];
  for (const row of seriesRows) {
    const period = await currentPeriod(prisma, row.slug);
    if (period) current.push({ slug: row.slug, period });
  }
  if (!current.length) {
    await prisma.$executeRawUnsafe(`DELETE FROM "TokenPractice"`).catch(() => {});
    return 0;
  }
  const keep = current.map((c) => `${c.slug}|${c.period.key}`);
  await prisma
    .$executeRawUnsafe(
      `DELETE FROM "TokenPractice" WHERE ("series" || '|' || "period") NOT IN (${keep.map(() => "?").join(",")})`,
      ...keep
    )
    .catch(() => {});
  const rows = await prisma
    .$queryRawUnsafe(`SELECT "steamId","series","period","server","laps","trackKey" FROM "TokenPractice"`)
    .catch(() => []);
  let paid = 0;
  for (const r of rows) {
    const on = current.find((c) => c.slug === r.series && c.period.key === r.period);
    if (!on || offTrack(on.period.track, r.trackKey)) continue;
    const discordId = await discordForSteamIds(prisma, [r.steamId]);
    if (!discordId) continue;
    paid += await payPractice(prisma, discordId, {
      series: r.series,
      period: on.period,
      server: r.server,
      laps: Number(r.laps) || 0,
    });
  }
  return paid;
}
