// ---------------------------------------------------------------------------
// The race recap: what a driver sees the first time they open the site after
// the league office has saved a round. One round, told from their seat: where
// they finished, what it did to the championship, how the live rating moved,
// what it paid in NABS Points, and the round's facts for everyone.
//
// Nothing here is stored. Every number is derived on request from the same
// services the site's pages use (the classification, the standings frozen at
// a round, the rating replay, the token ledger), so the recap can never
// disagree with the page it sends the reader to. The only state is which
// round a member has already been shown (MemberAccount.recapSeenRaceId).
//
// The switch works like the NABS Points one: off, admins only (to look at it
// on the real site before anybody else does), everyone.
// ---------------------------------------------------------------------------
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "../services/standingsService.js";
import { getDriverRatingHistory } from "../services/ratingHistoryService.js";
import { raceDetailPayload } from "../services/raceDetailService.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { getLinkedDriverIds } from "./persons.js";
import { isIdleReserve } from "./standingsRow.js";
import { getSeriesById } from "./series.js";
import { readRaceHeroes } from "./raceHero.js";
import { getCardRating } from "../services/cardRatingService.js";
import { readCardEdition, readCardAnim } from "./cardEditions.js";
import { readCardPhotoPos } from "./cardPhoto.js";
import { readDriverRoles } from "./driverRoles.js";
import { getIdentityOverrides } from "./persons.js";
import { tokensVisibleTo, isEarningOn, syncEarned, dbBalance, tunedRules } from "./tokens.js";
import { raceWasClean, stewardingClosed, withMultiplier } from "./tokenRules.js";
import { findArchiveForRace, analyzeRaceFor, raceInsightsFor } from "./cockpitArchive.js";
import { cardCatalogueFor } from "./tokens.js";

export const RECAP_SETTING = "race_recap";
export const RECAP_MODES = ["off", "admins", "all"];

// How long after the race a recap is still offered. Somebody who opens the
// site three weeks later has moved on, and a recap of a round that old would
// only look like a bug.
const FRESH_DAYS = 10;

// --- the switch -------------------------------------------------------------

export async function recapMode(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: RECAP_SETTING } });
    if (RECAP_MODES.includes(row?.value)) return row.value;
  } catch {
    /* fresh database, no Setting table yet */
  }
  return "off";
}

export async function setRecapMode(prisma, mode) {
  const value = RECAP_MODES.includes(mode) ? mode : "off";
  await prisma.setting.upsert({
    where: { key: RECAP_SETTING },
    create: { key: RECAP_SETTING, value },
    update: { value },
  });
  return value;
}

// Does THIS request get the recap? Everybody in all-mode, league admins in
// admins-mode (req.isAdminRequest comes from the auth middleware).
export async function recapVisibleTo(prisma, req) {
  const mode = await recapMode(prisma);
  if (mode === "all") return true;
  if (mode === "admins") return req?.isAdminRequest === true;
  return false;
}

// --- what a member has been shown -------------------------------------------

export async function seenRecapRaceId(prisma, discordId) {
  if (!discordId) return null;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "recapSeenRaceId" FROM "MemberAccount" WHERE "discordId" = ?`,
      discordId
    );
    return rows[0]?.recapSeenRaceId || null;
  } catch {
    return null; // column not there yet: nothing has been seen
  }
}

export async function markRecapSeen(prisma, discordId, raceId) {
  if (!discordId || !raceId) return;
  await prisma
    .$executeRawUnsafe(`UPDATE "MemberAccount" SET "recapSeenRaceId" = ? WHERE "discordId" = ?`, raceId, discordId)
    .catch(() => {});
}

// --- which round to offer ---------------------------------------------------

// The person's rows across every season they raced, and the seasons those
// rows sit in. `driverId` is the acting row (resolveDriverId).
async function personRows(prisma, driverId) {
  const linked = await getLinkedDriverIds(prisma, driverId);
  const ids = linked.length ? linked : [driverId];
  return prisma.driver.findMany({
    where: { id: { in: ids } },
    select: { id: true, seasonId: true, name: true, teamId: true, tier: true },
  });
}

// The newest finished round of any PUBLIC season this person is in, if it is
// recent enough and they have not been shown it yet. null = nothing to show.
export async function pendingRecapRace(prisma, driverId, discordId) {
  const rows = await personRows(prisma, driverId);
  const priv = await getPrivateSeasonIds(prisma);
  const seasonIds = [...new Set(rows.map((r) => r.seasonId).filter((id) => id && !priv.has(id)))];
  if (!seasonIds.length) return null;
  const race = await prisma.race.findFirst({
    where: {
      seasonId: { in: seasonIds },
      isCompleted: true,
      isSpecialEvent: false,
      number: { not: null },
      date: { gte: new Date(Date.now() - FRESH_DAYS * 86_400_000) },
      results: { some: {} },
    },
    orderBy: { date: "desc" },
    select: { id: true },
  });
  if (!race) return null;
  if ((await seenRecapRaceId(prisma, discordId)) === race.id) return null;
  return race.id;
}

// --- the recap itself -------------------------------------------------------

const pick = (row) => (row ? { position: row.position, total: row.total } : null);

// Standings of the season as they stood before and after the round. `after`
// is the live table when this is the newest round (so hand-set points and an
// overridden champion show as they do on the site) and a frozen table
// otherwise; `before` is always frozen at the previous round, and absent for
// the season opener, which has no previous table.
async function standingsAround(prisma, seasonId, number) {
  const latest = await prisma.race.findFirst({
    where: { seasonId, isCompleted: true, isSpecialEvent: false, number: { not: null } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const isLatest = latest?.number === number;
  const opts = isLatest ? {} : { upToRound: number };
  const [after, before, t1, t2] = await Promise.all([
    getDriverStandings(prisma, seasonId, opts),
    number > 1 ? getDriverStandings(prisma, seasonId, { upToRound: number - 1 }) : null,
    getT1ConstructorStandings(prisma, seasonId, opts),
    getT2ConstructorStandings(prisma, seasonId, opts),
  ]);
  const [t1Before, t2Before] =
    number > 1
      ? await Promise.all([
          getT1ConstructorStandings(prisma, seasonId, { upToRound: number - 1 }),
          getT2ConstructorStandings(prisma, seasonId, { upToRound: number - 1 }),
        ])
      : [null, null];
  return { after, before, teams: { 1: [t1, t1Before], 2: [t2, t2Before] } };
}

// What the archived result file knows about the driver's race that the
// classification does not: pace against the field, the best place they held
// and for how long, the lap the best lap came on, the time lost off their
// own pace, the stints. null without a file, or a driver without a Steam id.
async function storyFor(prisma, race, rowId, ownRow) {
  if (!rowId || !ownRow || ownRow.status === "DNS") return null;
  const d = await prisma.driver.findUnique({ where: { id: rowId }, select: { steamId: true } }).catch(() => null);
  if (!d?.steamId) return null;
  const json = findArchiveForRace(race);
  if (!json) return null;
  const a = analyzeRaceFor(json, d.steamId);
  if (!a) return null;
  const ins = raceInsightsFor(json, d.steamId);
  const positions = a.laps.map((l) => l.position).filter((p) => p != null);
  const bestPosition = positions.length ? Math.min(...positions) : null;
  let bestRun = null;
  if (bestPosition != null) {
    let start = null;
    for (const l of a.laps) {
      if (l.position === bestPosition) {
        if (start == null) start = l.lap;
        if (!bestRun || l.lap - start > bestRun.to - bestRun.from) bestRun = { from: start, to: l.lap };
      } else {
        start = null;
      }
    }
  }
  return {
    paceMs: ins?.ownPaceMs ?? a.ownPaceMs ?? null,
    paceRank: ins?.paceRank ?? null,
    paceField: ins?.paceField ?? null,
    gapToBestPaceMs: ins?.gapToBestPaceMs ?? null,
    lap1Pos: ins?.lap1Pos ?? null,
    offPaceMs: ins?.offPaceMs ?? null,
    bestPosition,
    bestRun,
    bestLapAt: a.laps.find((l) => l.timeMs != null && l.timeMs === a.bestLapMs)?.lap ?? null,
    stints: ins?.stints || [],
    laps: a.laps.map((l) => ({ lap: l.lap, position: l.position, timeMs: l.timeMs, slow: !!l.slow })),
  };
}

// The driver's own line of the round: the classification row plus what it
// paid, phrased from the standings cell (which folds a sprint in).
function ownRace(row, cell, fastestLapMs, fieldSize) {
  if (!row) return null;
  const finished = row.status === "FINISHED" && row.position != null;
  const raced = row.status !== "DNS";
  return {
    driverId: row.driverId,
    name: row.name,
    team: row.effectiveTeam || row.team || null,
    raced,
    finished,
    status: row.status,
    position: finished ? row.position : null,
    rawPosition: finished ? row.rawPosition : null,
    grid: raced ? row.grid ?? null : null,
    gained: finished && row.grid != null ? row.grid - row.position : null,
    fieldSize,
    points: cell?.points ?? row.points ?? 0,
    fastestLapBonus: cell?.fastestLap ?? row.fastestLap ?? 0,
    sprint: cell?.sprint || null,
    bestLapMs: raced ? row.bestLapMs ?? null : null,
    fastestLapMs: fastestLapMs ?? null,
    lapGapMs: raced && row.bestLapMs != null && fastestLapMs != null ? Math.max(0, row.bestLapMs - fastestLapMs) : null,
    laps: raced ? row.laps ?? null : null,
    penaltySeconds: raced ? Number(row.penaltySeconds) || 0 : null,
    gamePenalties: raced ? row.gamePenalties ?? null : null,
    contacts: raced ? row.contacts ?? null : null,
    overtakes: raced ? row.overtakes ?? null : null,
    lapsLed: raced ? row.lapsLed ?? null : null,
    consistencyPct: raced ? row.consistencyPct ?? null : null,
    cleanRace: raced ? raceWasClean(row) : null,
  };
}

// What this round did to the live rating. The card a driver carries is frozen
// for the season (cardRatingService), so this is deliberately the LIVE curve
// the My Rating tab shows, and the recap says so.
async function ratingMove(prisma, rowId, raceId) {
  const history = await getDriverRatingHistory(prisma, rowId).catch(() => null);
  const points = history?.points || [];
  const idx = points.findIndex((p) => p.raceId === raceId);
  if (idx < 0) return null;
  const point = points[idx];
  if (!point.ratings) return null;
  let before = null;
  for (let i = idx - 1; i >= 0 && !before; i--) if (points[i].ratings) before = points[i].ratings;
  const keys = ["overall", "exp", "pac", "rac", "aha"];
  return {
    before,
    after: point.ratings,
    delta: before ? Object.fromEntries(keys.map((k) => [k, Math.round((point.ratings[k] - before[k]) * 10) / 10])) : null,
    provisional: point.provisional ?? null,
    rank: point.rank ?? null,
    fieldSize: point.fieldSize ?? null,
  };
}

// The NABS Points this round paid the member, read straight off the ledger,
// plus a clean-race bonus that is still waiting for the stewards. null when
// the feature is not on for this request.
// `demo` (the admin preview) fills in what the round WOULD pay when the
// ledger has nothing for it yet (counting paused, or a round before the
// start day), so the chapter can be looked at before the first real payout.
async function pointsFor(prisma, req, discordId, race, rowId, own, demo = false) {
  if (!discordId || !(await tokensVisibleTo(prisma, req))) return null;
  const earning = await isEarningOn(prisma);
  if (earning) await syncEarned(prisma, discordId).catch(() => {});
  const keys = [`race:${race.id}:${rowId}`, `clean:${race.id}:${rowId}`];
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT "rule", "title", "delta" FROM "TokenLedger" WHERE "discordId" = ? AND "refKey" IN (?, ?) ORDER BY "rowid" ASC`,
      discordId,
      ...keys
    )
    .catch(() => []);
  const entries = rows.map((r) => ({ rule: r.rule, title: r.title, delta: Number(r.delta) || 0 }));
  const rateRow = await prisma
    .$queryRawUnsafe(`SELECT "rate" FROM "TokenRaceRate" WHERE "raceId" = ? AND "driverId" = ?`, race.id, rowId)
    .catch(() => []);
  const rate = Number(rateRow[0]?.rate) || null;
  // The bonus the round will still pay once the stewards are done with it,
  // priced the way the payout will price it (the league's own numbers, at
  // the rate stamped for this round).
  let pending = null;
  const cleanRule = tunedRules().find((r) => r.key === "clean_race");
  if (
    earning &&
    own?.finished &&
    own.cleanRace &&
    cleanRule &&
    cleanRule.active !== false &&
    !entries.some((e) => e.rule === "clean_race") &&
    !stewardingClosed(race.date)
  ) {
    pending = { rule: "clean_race", title: "Clean race, no penalties", delta: withMultiplier(cleanRule.points, rate || 1) };
  }
  let hypothetical = false;
  if (demo && !entries.length && !pending && own?.finished) {
    const finishRule = tunedRules().find((r) => r.key === "race_finish");
    if (finishRule && finishRule.active !== false) {
      entries.push({ rule: "race_finish", title: "Finished a race", delta: withMultiplier(finishRule.points, rate || 1) });
    }
    if (own.cleanRace && cleanRule && cleanRule.active !== false) {
      pending = { rule: "clean_race", title: "Clean race, no penalties", delta: withMultiplier(cleanRule.points, rate || 1) };
    }
    hypothetical = entries.length > 0;
  }
  // The cheapest card design still to be bought, so the chapter can say how
  // far the balance is from the next one.
  let nextCard = null;
  try {
    const designs = (await cardCatalogueFor(prisma, discordId)).flatMap((c) => c.designs.map((d) => ({ ...d, collectionName: c.name })));
    const open = designs.filter((d) => !d.owned && d.cost > 0).sort((a, b) => a.cost - b.cost);
    if (open[0]) nextCard = { name: open[0].name, collection: open[0].collectionName || null, cost: open[0].cost };
  } catch {
    nextCard = null;
  }
  return {
    earning,
    rate,
    entries,
    earned: entries.reduce((s, e) => s + e.delta, 0),
    pending,
    hypothetical,
    balance: await dbBalance(prisma, discordId),
    nextCard,
  };
}

// The rating card the driver carries this season, with what the card needs
// to draw itself (the same fields the profile hands RatingCard). null when
// the season has cards switched off or nobody has rated them yet.
async function cardFor(prisma, race, rowId, ownRow) {
  if (!rowId) return null;
  const enabled = await prisma
    .$queryRawUnsafe(`SELECT "cardsEnabled" FROM "Season" WHERE "id" = ?`, race.seasonId)
    .then((rows) => rows[0]?.cardsEnabled == null || !!Number(rows[0].cardsEnabled))
    .catch(() => true);
  if (!enabled) return null;
  const rating = await getCardRating(prisma, race.seasonId, rowId).catch(() => null);
  if (!rating?.ratings) return null;
  const driver = await prisma.driver.findUnique({ where: { id: rowId }, include: { team: true } });
  if (!driver) return null;
  const idov = (await getIdentityOverrides(prisma)).get(rowId);
  const cardPhotoUrl = (
    await prisma.$queryRawUnsafe(`SELECT "cardPhotoUrl" FROM "Driver" WHERE "id" = ?`, rowId).catch(() => [])
  )[0]?.cardPhotoUrl || null;
  const team = ownRow?.effectiveTeam || ownRow?.team || driver.team;
  return {
    driver: {
      id: driver.id,
      name: ownRow?.name || driver.name,
      number: driver.number ?? null,
      country: driver.country || idov?.country || null,
      photoUrl: driver.photoUrl || driver.discordAvatar || idov?.photoUrl || null,
      cardPhotoUrl,
      photoPos: (await readCardPhotoPos(prisma, rowId)) || idov?.photoPos || null,
      cardStyle: await readCardEdition(prisma, rowId),
      cardAnim: await readCardAnim(prisma, rowId),
      tier: driver.tier,
      role: (await readDriverRoles(prisma, [rowId])).get(rowId) || null,
      seasonNumber: race.season.number,
      team: team ? { id: team.id, name: team.name, color: team.color, logoUrl: team.logoUrl } : null,
    },
    rating,
  };
}

// Build the recap of `raceId` for the person behind `driverId` (any of their
// rows; the one in the race's season is used). `discordId` is the member the
// points belong to; `req` decides what they may see. driverId null = a
// spectator's recap: the round's story without a "you" in it.
export async function buildRaceRecap(prisma, { raceId, driverId = null, discordId = null, req = null, demo = false }) {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    include: { season: { select: { id: true, number: true, name: true, seriesId: true } } },
  });
  if (!race || !race.seasonId) return null;
  const detail = await raceDetailPayload(prisma, race);
  const rows = detail.results || [];
  if (!rows.length) return null;

  // The person's row in THIS season, if they have one.
  let rowId = null;
  if (driverId) {
    const rows0 = await personRows(prisma, driverId);
    rowId = rows0.find((r) => r.seasonId === race.seasonId)?.id || null;
  }
  const ownRow = rowId ? rows.find((r) => r.driverId === rowId) || null : null;

  const finished = rows.filter((r) => r.status === "FINISHED" && r.position != null);
  const fastestLapMs = rows.reduce((b, r) => (r.bestLapMs != null && (b == null || r.bestLapMs < b) ? r.bestLapMs : b), null);

  // Standings and the team table, both sides of the round.
  let standings = null;
  let team = null;
  let cell = null;
  let season = null;
  let teammates = [];
  const number = race.number;
  if (number != null && !race.isSpecialEvent) {
    const around = await standingsAround(prisma, race.seasonId, number);
    // The field as the standings page shows it: reserves who never got in a
    // car are not in the championship, so they are neither counted nor ranked.
    const field = (table) => (table ? table.standings.filter((r) => !isIdleReserve(r)) : []);
    const listAfter = field(around.after);
    const listBefore = field(around.before);
    const meAfter = rowId ? listAfter.find((r) => r.driverId === rowId) : null;
    const meBefore = rowId ? listBefore.find((r) => r.driverId === rowId) : null;
    cell = meAfter?.perRace?.[number] || null;
    if (meAfter) {
      const list = listAfter;
      const i = list.indexOf(meAfter);
      const leader = list[0];
      // The table around the driver, two rows either side, each with where
      // it stood a round ago: the page glides them from there.
      const prevPos = new Map(listBefore.map((r, n) => [r.driverId, n + 1]));
      const start = Math.max(0, Math.min(i - 2, list.length - 5));
      const window = list.slice(start, start + 5).map((r) => ({
        driverId: r.driverId,
        name: r.name,
        country: r.country,
        team: r.team ? { id: r.team.id, name: r.team.name, color: r.team.color, logoUrl: r.team.logoUrl } : null,
        total: r.total,
        position: list.indexOf(r) + 1,
        prevPosition: prevPos.get(r.driverId) ?? null,
        roundPoints: r.perRace?.[number]?.points ?? 0,
      }));
      // The season so far, round by round, for the points curve: every
      // championship round of the calendar, the driver's points and status on
      // the ones already run, and which of them the drop rule takes away.
      const calendar = await prisma.race.findMany({
        where: { seasonId: race.seasonId, isSpecialEvent: false, number: { not: null } },
        orderBy: { number: "asc" },
        select: { id: true, number: true, track: true, isCompleted: true },
      });
      const dropped = new Set(meAfter.droppedRounds || []);
      const rounds = calendar.map((r) => {
        const c = meAfter.perRace?.[r.number] || null;
        const run = r.isCompleted && r.number <= number;
        return {
          number: r.number,
          raceId: r.id,
          track: r.track,
          run,
          points: run ? c?.points ?? 0 : null,
          status: run ? c?.status ?? "DNS" : null,
          position: run && c?.status === "FINISHED" ? c.position ?? null : null,
          grid: run ? c?.grid ?? null : null,
          dropped: run && dropped.has(r.number),
        };
      });
      const finishes = rounds.filter((r) => r.position != null);
      const bestFinish = finishes.length ? finishes.reduce((b, r) => (r.position < b.position ? r : b)) : null;
      season = {
        rounds,
        dropWorst: around.after.dropWorst ?? 0,
        bestFinish: bestFinish ? { position: bestFinish.position, track: bestFinish.track, number: bestFinish.number } : null,
      };
      // The other cars in the same colours, with their race and their season.
      const myTeamId = (ownRow?.effectiveTeam || ownRow?.team)?.id || null;
      if (myTeamId) {
        teammates = rows
          .filter((r) => r.driverId !== rowId && (r.effectiveTeam || r.team)?.id === myTeamId)
          .map((r) => {
            const srow = list.find((x) => x.driverId === r.driverId);
            return {
              driverId: r.driverId,
              name: r.name,
              country: r.country,
              photoUrl: r.photoUrl,
              position: r.status === "FINISHED" ? r.position : null,
              status: r.status,
              grid: r.grid ?? null,
              bestLapMs: r.bestLapMs ?? null,
              seasonPoints: srow?.total ?? null,
              seasonPosition: srow ? list.indexOf(srow) + 1 : null,
            };
          });
      }
      standings = {
        before: meBefore ? { position: listBefore.indexOf(meBefore) + 1, total: meBefore.total } : null,
        after: { position: i + 1, total: meAfter.total },
        window,
        fieldSize: list.length,
        leader: leader && leader.driverId !== rowId ? { name: leader.name, total: leader.total } : null,
        ahead: i > 0 ? { name: list[i - 1].name, gap: list[i - 1].total - meAfter.total } : null,
        behind: i < list.length - 1 ? { name: list[i + 1].name, gap: meAfter.total - list[i + 1].total } : null,
        isLeader: i === 0,
        // A dropped round scores nothing for the total, and the recap should
        // say so rather than promise points the table will never show.
        roundDropped: Array.isArray(meAfter.droppedRounds) && meAfter.droppedRounds.includes(number),
      };
    }
    const teamRow = ownRow?.effectiveTeam || ownRow?.team || null;
    if (teamRow?.tier && around.teams[teamRow.tier]) {
      const [tAfter, tBefore] = around.teams[teamRow.tier];
      const a = tAfter?.standings.find((r) => r.teamId === teamRow.id);
      const b = tBefore?.standings.find((r) => r.teamId === teamRow.id);
      if (a) {
        team = {
          id: teamRow.id,
          name: teamRow.name,
          color: teamRow.color,
          logoUrl: teamRow.logoUrl,
          tier: teamRow.tier,
          before: pick(b),
          after: pick(a),
          fieldSize: tAfter.standings.length,
        };
      }
    }
  }

  const own = ownRace(ownRow, cell, fastestLapMs, finished.length);
  if (own?.finished) {
    // Whole teams the driver finished ahead of: every classified car of that
    // team behind them (only teams that got two or more cars home, so "both
    // Williams cars" is true as written).
    const byTeam = new Map();
    for (const r of finished) {
      const t = r.effectiveTeam || r.team;
      if (!t || t.id === (ownRow.effectiveTeam || ownRow.team)?.id) continue;
      if (!byTeam.has(t.id)) byTeam.set(t.id, { name: t.name, positions: [] });
      byTeam.get(t.id).positions.push(r.position);
    }
    own.beatTeams = [...byTeam.values()].filter((t) => t.positions.length >= 2 && t.positions.every((p) => p > own.position)).map((t) => t.name);
  }
  const [rating, points, series, card, heroes, seasonHero, story] = await Promise.all([
    rowId && own?.raced ? ratingMove(prisma, rowId, race.id) : null,
    rowId ? pointsFor(prisma, req, discordId, race, rowId, own, demo) : null,
    race.season.seriesId ? getSeriesById(prisma, race.season.seriesId) : null,
    cardFor(prisma, race, rowId, ownRow),
    readRaceHeroes(prisma, [race.id]).catch(() => new Map()),
    prisma
      .$queryRawUnsafe(`SELECT "heroImageUrl" FROM "Season" WHERE "id" = ?`, race.seasonId)
      .then((rows) => rows[0]?.heroImageUrl || null)
      .catch(() => null),
    storyFor(prisma, race, rowId, ownRow).catch(() => null),
  ]);

  return {
    race: {
      ...detail.race,
      seasonNumber: race.season.number,
      seasonName: race.season.name,
      seriesSlug: series?.slug || null,
      seriesName: series?.name || null,
      fieldSize: rows.length,
      starters: rows.filter((r) => r.status !== "DNS").length,
      finishers: finished.length,
      // The picture over the page: the round's own photo, else the season's,
      // else the frontend's league default.
      heroImageUrl: heroes.get(race.id) || seasonHero || null,
    },
    card,
    results: rows,
    quali: detail.quali,
    you: own,
    story,
    season,
    teammates,
    standings,
    team,
    rating,
    points,
  };
}
