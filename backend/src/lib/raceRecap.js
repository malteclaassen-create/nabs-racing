// ---------------------------------------------------------------------------
// The race recap: what a driver sees the first time they open the site after
// the league office has saved a round. One round, told from their seat: where
// they finished, what it did to the championship, how the live rating moved,
// what it paid in NABS Tokens, and the round's facts for everyone.
//
// A SPRINT WEEKEND is one round with two races (lib/sprintRaces.js), and the
// recap tells it as two. The feature race is the recap's own subject as ever;
// the sprint comes back beside it under `sprint`, built to the same shape from
// the hidden child row, so the page can show either half without knowing which
// one it is looking at. What the two share — the championship, the rating, the
// season, the NABS Tokens — is told once, over the whole weekend, and its
// points are shown as the two races that paid them rather than as one sum:
// `weekend` carries the feature's share, the sprint's, and the total.
//
// Nothing here is stored. Every number is derived on request from the same
// services the site's pages use (the classification, the standings frozen at
// a round, the rating replay, the token ledger), so the recap can never
// disagree with the page it sends the reader to. The only state is which
// round a member has already been shown (MemberAccount.recapSeenRaceId).
//
// The switch works like the NABS Tokens one: off, admins only (to look at it
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
import { readCardPhotoPos, cardPictureFor, personPhotoFor, photoFallbacksFor } from "./cardPhoto.js";
import { readDriverRoles } from "./driverRoles.js";
import { getIdentityOverrides } from "./persons.js";
import { tokensVisibleTo, isEarningOn, syncEarned, dbBalance, tunedRules } from "./tokens.js";
import { raceWasClean, stewardingClosed, withMultiplier } from "./tokenRules.js";
import { findArchiveForRace, analyzeRaceFor, raceInsightsFor, fieldPaceTable, hasArchiveFor } from "./cockpitArchive.js";
import { readParentIds, readSprintChildren } from "./sprintRaces.js";
import { readRaceFormat } from "./raceFormat.js";
import { contactsForDriver } from "./raceContacts.js";
import { groupKeyFor } from "./trackKeys.js";
import { cockpitContext } from "../services/cockpitService.js";
import { cardCatalogueFor } from "./tokens.js";

export const RECAP_SETTING = "race_recap";
export const RECAP_MODES = ["off", "admins", "all"];

// How long after the race a recap is still offered. Somebody who opens the
// site three weeks later has moved on, and a recap of a round that old would
// only look like a bug.
const FRESH_DAYS = 10;

// How long a sprint weekend waits for its second result file before the recap
// gives up and tells the round with what is on file. See weekendStillArriving.
// Well inside FRESH_DAYS, so a round that waits the whole time still has days
// left in which to be offered.
const HOLD_DAYS = 7;

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

// Is half of this round's night still to be imported? A sprint weekend is
// saved as TWO files, one after the other — the feature race, then the sprint
// (routes/admin.js) — and the "results are in" notification goes out with the
// FIRST of them. So between the two saves the round is finished as far as the
// database can tell while half the evening is still missing, and that is
// precisely the minute a member is most likely to open the site. A recap handed
// over then would tell a driver about one of the two races they drove, and
// arriving on it counts as seen for good: the sprint would never reach them.
//
// So a round whose format says it runs a sprint waits for its sprint. The wait
// is bounded, because a weekend scheduled as a sprint and then run as a single
// race — or one whose sprint file never arrives — must not cost the driver the
// recap altogether: after HOLD_DAYS the round is told with what is on file.
// (The admin's own way out is the race format, which is what says a round runs
// a sprint in the first place: clearing it back to a single race releases the
// recap at once.)
//
// This holds only the recap that is PUSHED to a member. Opening a round's recap
// from its race page reads whatever is saved, which is right — and never marks
// anything as seen.
async function weekendStillArriving(prisma, race) {
  const format = (await readRaceFormat(prisma, [race.id])).get(race.id);
  if (format?.raceFormat !== "SPRINT_FEATURE") return false;
  const ran = race.date ? new Date(race.date).getTime() : null;
  if (ran != null && Date.now() - ran > HOLD_DAYS * 86_400_000) return false;
  const childId = (await readSprintChildren(prisma, [race.id])).get(race.id) || null;
  // No child row at all: the sprint file has not been imported yet.
  if (!childId) return true;
  const saved = await prisma.raceResult.count({ where: { raceId: childId } }).catch(() => 0);
  return saved === 0;
}

// The newest finished round of any PUBLIC season this person is in, if it is
// recent enough, finished arriving, and they have not been shown it yet.
// null = nothing to show.
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
    select: { id: true, date: true },
  });
  if (!race) return null;
  if (await weekendStillArriving(prisma, race)) return null;
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
// `sprint` reads the sprint half's file of a sprint weekend; `race` then has
// to be the archive's view of the child row (archiveView below), which
// carries its event's round number.
async function storyFor(prisma, race, rowId, ownRow, rows = [], sprint = false) {
  if (!rowId || !ownRow || ownRow.status === "DNS") return null;
  const d = await prisma.driver.findUnique({ where: { id: rowId }, select: { steamId: true } }).catch(() => null);
  if (!d?.steamId) return null;
  const json = findArchiveForRace(race, { sprint });
  if (!json) return null;
  const a = analyzeRaceFor(json, d.steamId);
  if (!a) return null;
  const ins = raceInsightsFor(json, d.steamId);
  const paceTable = await paceTableFor(prisma, race, json, d.steamId, rows).catch(() => null);
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
    paceTable,
  };
}

// Everyone's race pace, so the driver's own number has company. The file
// knows cars by Steam id and its own names; the league's names and the
// classification come from the saved result, matched on the Steam id.
async function paceTableFor(prisma, race, json, ownGuid, rows) {
  const table = fieldPaceTable(json);
  if (!table?.rows.length) return null;
  const guids = table.rows.map((r) => r.guid);
  const drivers = await prisma.driver.findMany({
    where: { seasonId: race.seasonId, steamId: { in: guids } },
    select: { id: true, steamId: true },
  });
  const idByGuid = new Map(drivers.map((d) => [String(d.steamId), d.id]));
  const rowById = new Map(rows.map((r) => [r.driverId, r]));
  return {
    field: table.field,
    rows: table.rows.map((r) => {
      const row = rowById.get(idByGuid.get(r.guid));
      return {
        driverId: row?.driverId || null,
        name: row?.name || r.name || "?",
        position: row?.position ?? null,
        status: row?.status || null,
        laps: r.laps,
        paceMs: r.paceMs,
        rank: r.rank,
        gapMs: r.gapMs,
        bestLapMs: r.bestLapMs,
        you: r.guid === String(ownGuid),
      };
    }),
  };
}

// The driver's contacts in this race, from their side: the lap, the speed,
// who with. Read from the same archived file the stewards' reports use, so
// only when that file is really this race's. The other car is named by the
// league's own name where the Steam id is known, else by the game's.
async function incidentsFor(prisma, race, rowId, ownRow, steamId, sprint = false) {
  if (!rowId || !steamId || !findArchiveForRace(race, { sprint })) return null;
  let list = [];
  try {
    list = contactsForDriver(race.season, race.number, steamId, sprint);
  } catch {
    return null;
  }
  const guids = [...new Set(list.map((c) => c.other?.guid).filter(Boolean))];
  const named = guids.length
    ? await prisma.driver.findMany({ where: { seasonId: race.seasonId, steamId: { in: guids } }, select: { id: true, name: true, steamId: true } })
    : [];
  const byGuid = new Map(named.map((d) => [String(d.steamId), d]));
  return {
    contacts: list.map((c) => {
      const d = byGuid.get(String(c.other?.guid));
      return { lap: c.lap ?? null, kph: c.kph ?? null, name: d?.name || c.other?.name || "another car", driverId: d?.id || null };
    }),
    envContacts: ownRow?.envContacts ?? null,
  };
}

// The season and the career around this one race: what came first, what
// was best, what the record at this track is, how long the run is, where
// it points. All from stored results of the person's rows in this series,
// so it works for any round, not just the newest.
async function careerFor(prisma, race, rowId, ownRow, season) {
  if (!rowId || !ownRow) return null;
  const ctx = await cockpitContext(prisma, rowId).catch(() => null);
  if (!ctx) return null;
  const ids = ctx.rows.map((r) => r.id);
  const seasonNumberOf = new Map(ctx.rows.map((r) => [r.seasonId, r.season?.number ?? null]));
  const results = await prisma.raceResult.findMany({
    where: { driverId: { in: ids } },
    include: { race: { select: { id: true, track: true, number: true, seasonId: true, date: true, isCompleted: true, isSpecialEvent: true } } },
  });
  const rows = results.filter((r) => r.race?.isCompleted && !r.race.isSpecialEvent && r.race.id !== race.id);
  const thisSeasonNumber = race.season?.number ?? null;
  // Everything before this race: earlier seasons, and earlier rounds of this one.
  const before = rows.filter((r) => {
    const sn = seasonNumberOf.get(r.race.seasonId);
    if (sn == null || thisSeasonNumber == null) return false;
    return sn < thisSeasonNumber || (sn === thisSeasonNumber && r.race.number != null && race.number != null && r.race.number < race.number);
  });
  const started = before.filter((r) => r.status !== "DNS");
  const finished = before.filter((r) => r.status === "FINISHED" && r.position != null);
  const bestBefore = finished.length ? Math.min(...finished.map((r) => r.position)) : null;
  const pos = ownRow.status === "FINISHED" ? ownRow.position : null;
  const firsts = [];
  if (pos != null) {
    if (started.length === 0) firsts.push({ key: "first-start", text: "Your first race in the league." });
    if (pos === 1 && !finished.some((r) => r.position === 1)) firsts.push({ key: "first-win", text: "Your first win." });
    else if (pos <= 3 && !finished.some((r) => r.position <= 3)) firsts.push({ key: "first-podium", text: "Your first podium." });
    else if (bestBefore != null && pos < bestBefore) firsts.push({ key: "best-ever", text: `Your best finish in ${started.length + 1} starts.` });
    else if (bestBefore != null && pos === bestBefore && pos > 3) firsts.push({ key: "equal-best", text: `Level with your best finish, P${pos}.` });
  }
  // The record at this track, from every earlier visit.
  const key = groupKeyFor(race.track);
  const here = before.filter((r) => groupKeyFor(r.race.track) === key);
  const lapsHere = here.map((r) => r.bestLapMs).filter((ms) => ms != null && ms > 0 && ms <= 1_800_000);
  const recordBefore = lapsHere.length ? Math.min(...lapsHere) : null;
  const recordRow = recordBefore != null ? here.find((r) => r.bestLapMs === recordBefore) : null;
  const finishesHere = here.filter((r) => r.status === "FINISHED" && r.position != null);
  const track = {
    visits: here.length,
    recordBeforeMs: recordBefore,
    recordSeason: recordRow ? seasonNumberOf.get(recordRow.race.seasonId) ?? null : null,
    newRecord: recordBefore != null && ownRow.bestLapMs != null && ownRow.bestLapMs > 0 && ownRow.bestLapMs < recordBefore,
    bestFinishBefore: finishesHere.length ? Math.min(...finishesHere.map((r) => r.position)) : null,
  };
  // Runs in the current season, ending at this round.
  let pointsRun = 0;
  let finishRun = 0;
  if (season?.rounds) {
    const upTo = season.rounds.filter((r) => r.run && r.number <= race.number).sort((a, b) => b.number - a.number);
    for (const r of upTo) {
      if ((r.points || 0) > 0) pointsRun += 1;
      else break;
    }
    for (const r of upTo) {
      if (r.status === "FINISHED") finishRun += 1;
      else break;
    }
  }
  // Where the season points to at this rate.
  let projection = null;
  if (season?.rounds?.length) {
    const run = season.rounds.filter((r) => r.run);
    const total = run.reduce((s, r) => s + (r.points || 0), 0);
    const left = season.rounds.length - run.length;
    if (run.length && left > 0) projection = { perRound: Math.round((total / run.length) * 10) / 10, total: Math.round(total + (total / run.length) * left), roundsLeft: left };
  }
  return {
    starts: started.length + (ownRow.status !== "DNS" ? 1 : 0),
    wins: finished.filter((r) => r.position === 1).length + (pos === 1 ? 1 : 0),
    podiums: finished.filter((r) => r.position <= 3).length + (pos != null && pos <= 3 ? 1 : 0),
    bestBefore,
    firsts,
    track,
    pointsRun,
    finishRun,
    projection,
  };
}

// --- one race of the weekend -------------------------------------------------

// The round's points told as the races that paid them. The championship adds
// both halves of a sprint weekend under the one round number, and the cell it
// keeps carries the total with the sprint's own share beside it
// (services/standingsService.js buildDriverPerRace) — so the feature's share
// is what is left when the sprint's is taken back out, and the recap can show
// the sum AND what made it instead of a number nobody can account for.
// `row` is the driver's feature classification, used when the standings have
// no cell for the round (a special event, or a season without a table yet).
export function weekendPoints(cell, row = null) {
  const total = cell?.points ?? row?.points ?? 0;
  const sprint = cell?.sprint ? cell.sprint.points ?? 0 : null;
  return {
    isSprintWeekend: !!cell?.sprint,
    feature: total - (sprint || 0),
    featureFastestLap: cell?.fastestLap ?? row?.fastestLap ?? 0,
    sprint,
    sprintFastestLap: cell?.sprint?.fastestLap ?? 0,
    total,
  };
}

// Whole teams the driver finished ahead of: every classified car of that team
// behind them, and only teams that got two or more cars home, so "both
// Williams cars" is true as written.
function beatWholeTeams(finished, own, ownTeamId) {
  const byTeam = new Map();
  for (const r of finished) {
    const t = r.effectiveTeam || r.team;
    if (!t || t.id === ownTeamId) continue;
    if (!byTeam.has(t.id)) byTeam.set(t.id, { name: t.name, positions: [] });
    byTeam.get(t.id).positions.push(r.position);
  }
  return [...byTeam.values()].filter((t) => t.positions.length >= 2 && t.positions.every((p) => p > own.position)).map((t) => t.name);
}

// The driver's own line of ONE race — the feature race of the round, or the
// sprint of a sprint weekend. `cell` is that race's share of the standings
// cell, so `points` is always what THIS race paid; the round's total is
// `weekend` on the recap.
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
    bestLapMs: raced ? row.bestLapMs ?? null : null,
    fastestLapMs: fastestLapMs ?? null,
    lapGapMs: raced && row.bestLapMs != null && fastestLapMs != null ? Math.max(0, row.bestLapMs - fastestLapMs) : null,
    laps: raced ? row.laps ?? null : null,
    // Laps the telemetry saw no contact on. Straight off the classification
    // row, where the site's own race facts read it.
    cleanLaps: raced ? row.cleanLaps ?? null : null,
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

// The NABS Tokens this round paid the member, read straight off the ledger,
// plus a clean-race bonus that is still waiting for the stewards. null when
// the feature is not on for this request.
//
// A sprint weekend pays TWICE: the sprint is saved as its own race, so the
// payout wrote its own ledger rows under the child's id (lib/tokens.js
// payRace). `halves` is therefore a list — the feature race, and the sprint
// where there is one — and every entry says which race it came from, so two
// "Finished a race" rows read as the two races they are.
//
// `demo` (the admin preview) fills in what the round WOULD pay when the
// ledger has nothing for it yet (counting paused, or a round before the
// start day), so the chapter can be looked at before the first real payout.
async function pointsFor(prisma, req, discordId, race, rowId, halves, demo = false) {
  if (!discordId || !(await tokensVisibleTo(prisma, req))) return null;
  const earning = await isEarningOn(prisma);
  if (earning) await syncEarned(prisma, discordId).catch(() => {});
  const races = halves.filter((h) => h.raceId && h.own);
  const keys = races.flatMap((h) => [`race:${h.raceId}:${rowId}`, `clean:${h.raceId}:${rowId}`]);
  const halfOfKey = new Map(races.flatMap((h) => [[`race:${h.raceId}:${rowId}`, h], [`clean:${h.raceId}:${rowId}`, h]]));
  const rows = keys.length
    ? await prisma
        .$queryRawUnsafe(
          `SELECT "rule", "title", "delta", "refKey" FROM "TokenLedger" WHERE "discordId" = ? AND "refKey" IN (${keys
            .map(() => "?")
            .join(",")}) ORDER BY "rowid" ASC`,
          discordId,
          ...keys
        )
        .catch(() => [])
    : [];
  // Only a weekend of two races needs its entries labelled; a plain round's
  // chips would only be made noisier by a word that says nothing.
  const twoRaces = races.length > 1;
  const label = (h) => (twoRaces ? h.label : null);
  const entries = rows.map((r) => ({
    rule: r.rule,
    title: r.title,
    delta: Number(r.delta) || 0,
    race: label(halfOfKey.get(r.refKey)) ?? null,
  }));
  const rateRow = await prisma
    .$queryRawUnsafe(`SELECT "rate" FROM "TokenRaceRate" WHERE "raceId" = ? AND "driverId" = ?`, race.id, rowId)
    .catch(() => []);
  const rate = Number(rateRow[0]?.rate) || null;
  // The bonuses the weekend will still pay once the stewards are done with it,
  // priced the way the payout will price it (the league's own numbers, at
  // the rate stamped for this round) — one per clean race still open.
  const pending = [];
  // The series' own numbers where it has them (the Sunday league pays half).
  const seriesSlug = race.season?.seriesId
    ? (await getSeriesById(prisma, race.season.seriesId).catch(() => null))?.slug || null
    : null;
  const cleanRule = tunedRules(seriesSlug, race.date).find((r) => r.key === "clean_race");
  const cleanOn = !!cleanRule && cleanRule.active !== false;
  const paidClean = (h) => rows.some((r) => r.refKey === `clean:${h.raceId}:${rowId}`);
  if (earning && cleanOn && !stewardingClosed(race.date)) {
    for (const h of races) {
      if (!h.own.finished || !h.own.cleanRace || paidClean(h)) continue;
      pending.push({ rule: "clean_race", title: "Clean race, no penalties", delta: withMultiplier(cleanRule.points, rate || 1), race: label(h) });
    }
  }
  let hypothetical = false;
  if (demo && !entries.length && !pending.length && races.some((h) => h.own.finished)) {
    const finishRule = tunedRules(seriesSlug, race.date).find((r) => r.key === "race_finish");
    for (const h of races) {
      if (!h.own.finished) continue;
      if (finishRule && finishRule.active !== false) {
        entries.push({ rule: "race_finish", title: "Finished a race", delta: withMultiplier(finishRule.points, rate || 1), race: label(h) });
      }
      if (h.own.cleanRace && cleanOn) {
        pending.push({ rule: "clean_race", title: "Clean race, no penalties", delta: withMultiplier(cleanRule.points, rate || 1), race: label(h) });
      }
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
  const ownCardPhotoUrl = (
    await prisma.$queryRawUnsafe(`SELECT "cardPhotoUrl" FROM "Driver" WHERE "id" = ?`, rowId).catch(() => [])
  )[0]?.cardPhotoUrl || null;
  // Same picture rule as the profile card: the row's own uploads first, then
  // what the person carries from their other rows (lib/cardPhoto).
  const ownPictures = {
    cardPhotoUrl: ownCardPhotoUrl,
    photoUrl: driver.photoUrl || null,
    discordAvatar: driver.discordAvatar || null,
    photoPos: await readCardPhotoPos(prisma, rowId),
  };
  const { cardPhotoUrl, photoPos } = cardPictureFor(ownPictures, idov);
  const team = ownRow?.effectiveTeam || ownRow?.team || driver.team;
  return {
    driver: {
      id: driver.id,
      name: ownRow?.name || driver.name,
      number: driver.number ?? null,
      country: driver.country || idov?.country || null,
      photoUrl: personPhotoFor(ownPictures, idov),
      cardPhotoUrl,
      photoFallbacks: photoFallbacksFor(ownPictures, idov),
      photoPos,
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

// The race row as the ARCHIVE knows a sprint classification: the child row
// carries no round number and no season of its own, so it borrows its event's
// (lib/cockpitArchive.js files the sprint under the round number, flagged).
const archiveView = (child, parent) => ({ ...child, number: parent.number, season: parent.season, seasonId: parent.seasonId });

// The sprint half of a sprint weekend, built to the same shape as the feature
// race so the page can show either without knowing which it has: the
// classification, the driver's line of it, what the archived sprint file knows
// and the contacts it recorded. null when the round ran one race, or when the
// sprint has no result on file yet.
//
// `cell` is the driver's round cell from the standings; its `sprint` share is
// what this race paid, so the half never has to price a result itself.
async function sprintHalf(prisma, parent, childId, rowId, cell, steamId) {
  const child = await prisma.race
    .findUnique({ where: { id: childId }, include: { season: { select: { id: true, number: true, name: true, seriesId: true } } } })
    .catch(() => null);
  if (!child) return null;
  const detail = await raceDetailPayload(prisma, child);
  const rows = detail.results || [];
  if (!rows.length) return null;
  const ownRow = rowId ? rows.find((r) => r.driverId === rowId) || null : null;
  const finished = rows.filter((r) => r.status === "FINISHED" && r.position != null);
  const fastestLapMs = rows.reduce((b, r) => (r.bestLapMs != null && (b == null || r.bestLapMs < b) ? r.bestLapMs : b), null);
  const own = ownRace(ownRow, cell?.sprint ? { points: cell.sprint.points ?? 0, fastestLap: cell.sprint.fastestLap ?? 0 } : null, fastestLapMs, finished.length);
  if (own?.finished) own.beatTeams = beatWholeTeams(finished, own, (ownRow.effectiveTeam || ownRow.team)?.id || null);
  const filed = archiveView(child, parent);
  const [story, incidents] = await Promise.all([
    storyFor(prisma, filed, rowId, ownRow, rows, true).catch(() => null),
    incidentsFor(prisma, filed, rowId, ownRow, steamId, true).catch(() => null),
  ]);
  return {
    race: {
      ...detail.race,
      seasonNumber: parent.season.number,
      // The sprint is not a round of its own, and saying "Round 1" over it
      // twice would read as two rounds. It is the round's sprint, and the
      // page names it that way.
      number: parent.number,
      isSprint: true,
      fieldSize: rows.length,
      starters: rows.filter((r) => r.status !== "DNS").length,
      finishers: finished.length,
      hasLapChart: hasArchiveFor(parent.season, parent.number, { sprint: true }),
    },
    results: rows,
    quali: detail.quali,
    you: own,
    story,
    incidents,
  };
}

// Build the recap of `raceId` for the person behind `driverId` (any of their
// rows; the one in the race's season is used). `discordId` is the member the
// points belong to; `req` decides what they may see. driverId null = a
// spectator's recap: the round's story without a "you" in it.
//
// Asked for the sprint half of a sprint weekend, this builds the WEEKEND: the
// sprint is not a round of its own and its recap is the round's, with both
// races in it.
export async function buildRaceRecap(prisma, { raceId, driverId = null, discordId = null, req = null, demo = false }) {
  const parentId = (await readParentIds(prisma, [raceId])).get(raceId) || null;
  const race = await prisma.race.findUnique({
    where: { id: parentId || raceId },
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
      // The other cars in the same colours, with their race and their season,
      // and the season-long duel: rounds where both were classified, who was
      // ahead; and the same for the grid.
      const myTeamId = (ownRow?.effectiveTeam || ownRow?.team)?.id || null;
      if (myTeamId) {
        teammates = rows
          .filter((r) => r.driverId !== rowId && (r.effectiveTeam || r.team)?.id === myTeamId)
          .map((r) => {
            const srow = list.find((x) => x.driverId === r.driverId);
            const duel = { raceWins: 0, raceLosses: 0, qualiWins: 0, qualiLosses: 0 };
            for (const [num, mine] of Object.entries(meAfter.perRace || {})) {
              if (Number(num) > number) continue;
              const theirs = srow?.perRace?.[num];
              if (!theirs) continue;
              if (mine.status === "FINISHED" && mine.position != null && theirs.status === "FINISHED" && theirs.position != null) {
                if (mine.position < theirs.position) duel.raceWins += 1;
                else if (mine.position > theirs.position) duel.raceLosses += 1;
              } else if (mine.status === "FINISHED" && mine.position != null && theirs.status && theirs.status !== "DNS") {
                duel.raceWins += 1; // they dropped out, you were classified
              } else if (theirs.status === "FINISHED" && theirs.position != null && mine.status && mine.status !== "DNS") {
                duel.raceLosses += 1;
              }
              if (mine.grid != null && theirs.grid != null && mine.grid !== theirs.grid) {
                if (mine.grid < theirs.grid) duel.qualiWins += 1;
                else duel.qualiLosses += 1;
              }
            }
            return {
              duel,
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
      // The neighbours' gaps as they stood a round ago, so the page can say
      // what this round did to them.
      const gapBefore = (driverId, sign) => {
        if (!meBefore) return null;
        const other = listBefore.find((r) => r.driverId === driverId);
        return other ? sign * (other.total - meBefore.total) : null;
      };
      const aheadRow = i > 0 ? list[i - 1] : null;
      const behindRow = i < list.length - 1 ? list[i + 1] : null;
      standings = {
        before: meBefore ? { position: listBefore.indexOf(meBefore) + 1, total: meBefore.total } : null,
        after: { position: i + 1, total: meAfter.total },
        window,
        aheadGapBefore: aheadRow ? gapBefore(aheadRow.driverId, 1) : null,
        behindGapBefore: behindRow ? gapBefore(behindRow.driverId, -1) : null,
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

  // The feature race's own share of the round, so the big number on the card
  // is what THIS race paid rather than the weekend's total.
  const weekend = weekendPoints(cell, ownRow);
  const own = ownRace(ownRow, cell ? { ...cell, points: weekend.feature } : null, fastestLapMs, finished.length);
  if (own?.finished) own.beatTeams = beatWholeTeams(finished, own, (ownRow.effectiveTeam || ownRow.team)?.id || null);
  const steamRow = rowId ? await prisma.driver.findUnique({ where: { id: rowId }, select: { steamId: true } }).catch(() => null) : null;
  // The sprint of a sprint weekend, told the same way as the race above. It
  // is built before the NABS Tokens so the ledger can be asked about both
  // races at once.
  const sprintId = (await readSprintChildren(prisma, [race.id])).get(race.id) || null;
  const sprint = sprintId ? await sprintHalf(prisma, race, sprintId, rowId, cell, steamRow?.steamId).catch(() => null) : null;
  // The ROUND ran a sprint whether or not this driver scored in it (a DNS
  // leaves no sprint share on their cell), and the page is telling them about
  // the weekend, not about their cell.
  if (sprint) weekend.isSprintWeekend = true;
  const halves = [
    { raceId: race.id, label: sprint ? "Feature race" : "Race", own },
    ...(sprint ? [{ raceId: sprintId, label: "Sprint", own: sprint.you }] : []),
  ];
  const [rating, points, series, card, heroes, seasonHero, story, incidents, career] = await Promise.all([
    rowId && own?.raced ? ratingMove(prisma, rowId, race.id) : null,
    rowId ? pointsFor(prisma, req, discordId, race, rowId, halves, demo) : null,
    race.season.seriesId ? getSeriesById(prisma, race.season.seriesId) : null,
    cardFor(prisma, race, rowId, ownRow),
    readRaceHeroes(prisma, [race.id]).catch(() => new Map()),
    prisma
      .$queryRawUnsafe(`SELECT "heroImageUrl" FROM "Season" WHERE "id" = ?`, race.seasonId)
      .then((rows) => rows[0]?.heroImageUrl || null)
      .catch(() => null),
    storyFor(prisma, race, rowId, ownRow, rows).catch(() => null),
    incidentsFor(prisma, race, rowId, ownRow, steamRow?.steamId).catch(() => null),
    careerFor(prisma, race, rowId, ownRow, season).catch(() => null),
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
    incidents,
    // The other race of a sprint weekend, in the same shape as the five
    // fields above it (race / results / quali / you / story / incidents), so
    // the page can swap one for the other. null on a one-race round.
    sprint,
    // What the round paid, as the races that paid it: never only the sum.
    weekend,
    career,
    season,
    teammates,
    standings,
    team,
    rating,
    points,
  };
}
