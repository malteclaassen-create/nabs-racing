// Builds mock/real-recap.js: the race recap of a REAL round, put together from
// the live site's PUBLIC JSON API (cached in api-cache/, see FETCHED below) with
// the same rules as backend/src/lib/raceRecap.js buildRaceRecap on origin/main.
//
// Round: Season 8 (F1 Friday), Round 9, Singapore, 9 Oct 2026 — the newest
// completed championship round when this was built. Seat: Maltegoat.
//
// What the public API cannot give is left the way the real payload leaves a
// section it has nothing for (null), never made up:
//   rating     the live rating history is private (/api/me/rating/history)
//   points     the NABS Tokens ledger needs a signed-in member
//   incidents  contacts per lap come from the archived result file only
//   story.*    lap times (pace, pace rank, pace table, best-lap lap, time off
//              pace, stint degradation) come from the archived file only;
//              positions per lap are public (GET /api/races/:id/laps is built
//              from that same file with the same positionsPerLap), so
//              bestPosition / bestRun / lap1Pos / laps[].position are exact.
//
// FETCHED (plain public GETs, once, into api-cache/):
//   /api/series, /api/seasons
//   /api/races?series=friday-f1&season=8                   -> races-s8.json
//   /api/races/<id>/results                                 -> results-r9.json   (raceDetailPayload)
//   /api/races/<id>/laps                                    -> laps-r9.json      (lap chart)
//   /api/standings/drivers?series=friday-f1&season=8[&upTo=8]        -> standings-after/-before.json
//   /api/standings/constructors/t1|t2?series=friday-f1&season=8[&upTo=8]
//   /api/drivers/maltegoat_s8/profile, /api/drivers/maltegoat_s8/rating (card), /api/career/maltegoat_s8
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, "../api-cache");
const read = (f) => JSON.parse(readFileSync(join(CACHE, f), "utf8"));

const SERIES_SLUG = "friday-f1";
const SEAT = "maltegoat_s8";

const seriesList = read("series.json");
const seasons = read("seasons.json");
const calendarRows = read("races-s8.json");
const detail = read("results-r9.json");
const lapChart = read("laps-r9.json");
const sAfter = read("standings-after.json");
const sBefore = read("standings-before.json");
const t1After = read("t1-after.json");
const t1Before = read("t1-before.json");
const t2After = read("t2-after.json");
const t2Before = read("t2-before.json");
const profile = read("profile-malte.json");
const cardRating = read("card-malte.json");
const careerApi = read("career-malte.json");

const race = detail.race;
const seasonRow = seasons.find((s) => s.isActive);
const series = seriesList.find((s) => s.slug === SERIES_SLUG);
if (race.sprintRaceId) throw new Error("this round ran a sprint: the sprint half would have to be built too");

// --- pictures: the page runs under somebody else's root, so the few pictures
// it actually shows are served from dist/ (build.mjs copies them).
const LOCAL = {
  "/api/uploads/avatars/maltegoat_s8.jpg": "./uploads/avatars/maltegoat_s8.jpg",
  "/api/uploads/avatars/pizd.png": "./uploads/avatars/pizd.png",
  "/api/uploads/teams/s6_brawn_gp.png": "./uploads/teams/s6_brawn_gp.png",
  "/api/uploads/teams/s6_audi.png": "./uploads/teams/s6_audi.png",
};
const localUrl = (url) => {
  if (!url) return url ?? null;
  const path = url.split("?")[0];
  if (LOCAL[path]) return LOCAL[path];
  if (/^\/teams\/[a-z0-9_]+\.png$/.test(path)) return `.${path}`; // bundled in the site's public/teams
  return url;
};
const team = (t) => (t ? { ...t, logoUrl: localUrl(t.logoUrl) } : t);

// --- the classification, as raceDetailPayload hands it to the recap
const rows = detail.results.map((r) => ({
  ...r,
  // Only two faces are shown on the page (yours via the card, the team-mate's);
  // every other row's picture stays out so nothing is fetched from elsewhere.
  photoUrl: r.driverId === "pizd_s8" || r.driverId === SEAT ? localUrl(r.photoUrl) : null,
  team: team(r.team),
  subForTeam: team(r.subForTeam),
  effectiveTeam: team(r.effectiveTeam),
}));
const rowId = SEAT;
const ownRow = rows.find((r) => r.driverId === rowId) || null;
const finished = rows.filter((r) => r.status === "FINISHED" && r.position != null);
const fastestLapMs = rows.reduce((b, r) => (r.bestLapMs != null && (b == null || r.bestLapMs < b) ? r.bestLapMs : b), null);

// --- lib/standingsRow.js
const hasRaced = (row) => !!row && (Object.keys(row.perRace || {}).length > 0 || (row.total || 0) > 0);
const isIdleReserve = (row) => !!row && row.tier === 0 && !hasRaced(row);
// --- lib/tokenRules.js
function raceWasClean(result) {
  if (!result) return false;
  if (Number(result.penaltySeconds || 0) > 0) return false;
  if (result.gamePenalties == null) return false;
  return Number(result.gamePenalties) === 0;
}

// --- standingsAround: this is the newest completed round, so `after` is the
// live table; `before` is frozen at the previous round (?upTo=8).
const number = race.number;
const latest = Math.max(...calendarRows.filter((r) => r.isCompleted && !r.isSpecialEvent && r.number != null).map((r) => r.number));
if (latest !== number) throw new Error("round is not the newest: `after` would have to be ?upTo=" + number);
const around = { after: sAfter, before: sBefore, teams: { 1: [t1After, t1Before], 2: [t2After, t2Before] } };

let standings = null;
let teamCard = null;
let cell = null;
let season = null;
let teammates = [];
const field = (table) => (table ? table.standings.filter((r) => !isIdleReserve(r)) : []);
const listAfter = field(around.after);
const listBefore = field(around.before);
const meAfter = listAfter.find((r) => r.driverId === rowId);
const meBefore = listBefore.find((r) => r.driverId === rowId);
cell = meAfter?.perRace?.[number] || null;
if (meAfter) {
  const list = listAfter;
  const i = list.indexOf(meAfter);
  const leader = list[0];
  const prevPos = new Map(listBefore.map((r, n) => [r.driverId, n + 1]));
  const start = Math.max(0, Math.min(i - 2, list.length - 5));
  const window = list.slice(start, start + 5).map((r) => ({
    driverId: r.driverId,
    name: r.name,
    country: r.country,
    team: r.team ? { id: r.team.id, name: r.team.name, color: r.team.color, logoUrl: localUrl(r.team.logoUrl) } : null,
    total: r.total,
    position: list.indexOf(r) + 1,
    prevPosition: prevPos.get(r.driverId) ?? null,
    roundPoints: r.perRace?.[number]?.points ?? 0,
  }));
  const calendar = calendarRows
    .filter((r) => !r.isSpecialEvent && r.number != null)
    .sort((a, b) => a.number - b.number)
    .map((r) => ({ id: r.id, number: r.number, track: r.track, isCompleted: r.isCompleted }));
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
            duel.raceWins += 1;
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
    roundDropped: Array.isArray(meAfter.droppedRounds) && meAfter.droppedRounds.includes(number),
  };
}
const pick = (row) => (row ? { position: row.position, total: row.total } : null);
const teamRow = ownRow?.effectiveTeam || ownRow?.team || null;
if (teamRow?.tier && around.teams[teamRow.tier]) {
  const [tAfter, tBefore] = around.teams[teamRow.tier];
  const a = tAfter?.standings.find((r) => r.teamId === teamRow.id);
  const b = tBefore?.standings.find((r) => r.teamId === teamRow.id);
  if (a) {
    teamCard = { id: teamRow.id, name: teamRow.name, color: teamRow.color, logoUrl: teamRow.logoUrl, tier: teamRow.tier, before: pick(b), after: pick(a), fieldSize: tAfter.standings.length };
  }
}

// --- weekendPoints / ownRace / beatWholeTeams
function weekendPoints(c, row = null) {
  const total = c?.points ?? row?.points ?? 0;
  const sprint = c?.sprint ? c.sprint.points ?? 0 : null;
  return { isSprintWeekend: !!c?.sprint, feature: total - (sprint || 0), featureFastestLap: c?.fastestLap ?? row?.fastestLap ?? 0, sprint, sprintFastestLap: c?.sprint?.fastestLap ?? 0, total };
}
function beatWholeTeams(fin, own, ownTeamId) {
  const byTeam = new Map();
  for (const r of fin) {
    const t = r.effectiveTeam || r.team;
    if (!t || t.id === ownTeamId) continue;
    if (!byTeam.has(t.id)) byTeam.set(t.id, { name: t.name, positions: [] });
    byTeam.get(t.id).positions.push(r.position);
  }
  return [...byTeam.values()].filter((t) => t.positions.length >= 2 && t.positions.every((p) => p > own.position)).map((t) => t.name);
}
function ownRace(row, c, flMs, fieldSize) {
  if (!row) return null;
  const fin = row.status === "FINISHED" && row.position != null;
  const raced = row.status !== "DNS";
  return {
    driverId: row.driverId,
    name: row.name,
    team: row.effectiveTeam || row.team || null,
    raced,
    finished: fin,
    status: row.status,
    position: fin ? row.position : null,
    rawPosition: fin ? row.rawPosition : null,
    grid: raced ? row.grid ?? null : null,
    gained: fin && row.grid != null ? row.grid - row.position : null,
    fieldSize,
    points: c?.points ?? row.points ?? 0,
    fastestLapBonus: c?.fastestLap ?? row.fastestLap ?? 0,
    bestLapMs: raced ? row.bestLapMs ?? null : null,
    fastestLapMs: flMs ?? null,
    lapGapMs: raced && row.bestLapMs != null && flMs != null ? Math.max(0, row.bestLapMs - flMs) : null,
    laps: raced ? row.laps ?? null : null,
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
const weekend = weekendPoints(cell, ownRow);
const you = ownRace(ownRow, cell ? { ...cell, points: weekend.feature } : null, fastestLapMs, finished.length);
if (you?.finished) you.beatTeams = beatWholeTeams(finished, you, (ownRow.effectiveTeam || ownRow.team)?.id || null);

// --- storyFor, from what is public. The lap chart is the archive's own
// positionsPerLap, so the running order is the real recap's.
function storyFromChart() {
  const mine = lapChart.available ? lapChart.drivers.find((d) => d.driverId === rowId) : null;
  if (!mine || ownRow?.status === "DNS") return null;
  const laps = mine.points.map((p) => ({ lap: p.lap, position: p.position, timeMs: null, slow: false }));
  const positions = laps.map((l) => l.position).filter((p) => p != null);
  const bestPosition = positions.length ? Math.min(...positions) : null;
  let bestRun = null;
  if (bestPosition != null) {
    let s = null;
    for (const l of laps) {
      if (l.position === bestPosition) {
        if (s == null) s = l.lap;
        if (!bestRun || l.lap - s > bestRun.to - bestRun.from) bestRun = { from: s, to: l.lap };
      } else s = null;
    }
  }
  // Tyres: the classification row's stored stints (the same result file), read
  // the way raceInsightsFor segments them: one stint per compound change, 5+
  // laps. The degradation slope needs lap times, which are not public.
  const stints = [];
  for (const st of ownRow.stints || []) {
    const last = stints[stints.length - 1];
    if (last && last.tyre === st.tyre) last.laps += st.laps;
    else stints.push({ tyre: st.tyre, laps: st.laps });
  }
  return {
    paceMs: null,
    paceRank: null,
    paceField: null,
    gapToBestPaceMs: null,
    lap1Pos: laps.length >= 5 ? laps[0]?.position ?? null : null,
    offPaceMs: null,
    bestPosition,
    bestRun,
    bestLapAt: null,
    stints: stints.filter((s) => s.laps >= 5).map((s) => ({ ...s, degMsPerLap: null })),
    laps,
    paceTable: null,
  };
}
const story = storyFromChart();

// --- careerFor: every stored result of the person's rows in THIS series,
// from the public career record (one row per classification).
const groupKey = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function careerFor() {
  if (!ownRow) return null;
  const all = careerApi.races.filter((r) => r.seriesSlug === SERIES_SLUG && !r.sprint && r.raceId !== race.id);
  const thisSeasonNumber = seasonRow.number;
  const before = all.filter((r) => r.seasonNumber < thisSeasonNumber || (r.seasonNumber === thisSeasonNumber && r.round != null && r.round < race.number));
  const started = before.filter((r) => r.status !== "DNS");
  const fin = before.filter((r) => r.status === "FINISHED" && r.position != null);
  const bestBefore = fin.length ? Math.min(...fin.map((r) => r.position)) : null;
  const pos = ownRow.status === "FINISHED" ? ownRow.position : null;
  const firsts = [];
  if (pos != null) {
    if (started.length === 0) firsts.push({ key: "first-start", text: "Your first race in the league." });
    if (pos === 1 && !fin.some((r) => r.position === 1)) firsts.push({ key: "first-win", text: "Your first win." });
    else if (pos <= 3 && !fin.some((r) => r.position <= 3)) firsts.push({ key: "first-podium", text: "Your first podium." });
    else if (bestBefore != null && pos < bestBefore) firsts.push({ key: "best-ever", text: `Your best finish in ${started.length + 1} starts.` });
    else if (bestBefore != null && pos === bestBefore && pos > 3) firsts.push({ key: "equal-best", text: `Level with your best finish, P${pos}.` });
  }
  const key = groupKey(race.track);
  const here = before.filter((r) => groupKey(r.track) === key);
  const lapsHere = here.map((r) => r.bestLapMs).filter((ms) => ms != null && ms > 0 && ms <= 1_800_000);
  const recordBefore = lapsHere.length ? Math.min(...lapsHere) : null;
  const recordRow = recordBefore != null ? here.find((r) => r.bestLapMs === recordBefore) : null;
  const finishesHere = here.filter((r) => r.status === "FINISHED" && r.position != null);
  const track = {
    visits: here.length,
    recordBeforeMs: recordBefore,
    recordSeason: recordRow ? recordRow.seasonNumber ?? null : null,
    newRecord: recordBefore != null && ownRow.bestLapMs != null && ownRow.bestLapMs > 0 && ownRow.bestLapMs < recordBefore,
    bestFinishBefore: finishesHere.length ? Math.min(...finishesHere.map((r) => r.position)) : null,
  };
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
  let projection = null;
  if (season?.rounds?.length) {
    const run = season.rounds.filter((r) => r.run);
    const total = run.reduce((s, r) => s + (r.points || 0), 0);
    const left = season.rounds.length - run.length;
    if (run.length && left > 0) projection = { perRound: Math.round((total / run.length) * 10) / 10, total: Math.round(total + (total / run.length) * left), roundsLeft: left };
  }
  return {
    starts: started.length + (ownRow.status !== "DNS" ? 1 : 0),
    wins: fin.filter((r) => r.position === 1).length + (pos === 1 ? 1 : 0),
    podiums: fin.filter((r) => r.position <= 3).length + (pos != null && pos <= 3 ? 1 : 0),
    bestBefore,
    firsts,
    track,
    pointsRun,
    finishRun,
    projection,
  };
}
const career = careerFor();

// --- cardFor: the season's frozen card (public) and the driver's card look
// (public profile).
const pd = profile.driver;
const cardTeam = ownRow?.effectiveTeam || ownRow?.team || pd.team;
const card = seasonRow.cardsEnabled && cardRating?.ratings
  ? {
      driver: {
        id: pd.id,
        name: ownRow?.name || pd.name,
        number: pd.number ?? null,
        country: pd.country || null,
        photoUrl: localUrl(pd.photoUrl),
        cardPhotoUrl: localUrl(pd.cardPhotoUrl),
        photoFallbacks: [], // the Discord avatar fallback is left out: nothing is loaded from elsewhere
        photoPos: pd.photoPos ?? null,
        cardStyle: pd.cardStyle ?? null,
        cardAnim: pd.cardAnim ?? null,
        tier: pd.tier,
        role: pd.role ?? null,
        seasonNumber: seasonRow.number,
        team: cardTeam ? { id: cardTeam.id, name: cardTeam.name, color: cardTeam.color, logoUrl: cardTeam.logoUrl } : null,
      },
      rating: cardRating,
    }
  : null;

const recap = {
  race: {
    ...race,
    seasonNumber: seasonRow.number,
    seasonName: seasonRow.name,
    seriesSlug: series.slug,
    seriesName: series.name,
    fieldSize: rows.length,
    starters: rows.filter((r) => r.status !== "DNS").length,
    finishers: finished.length,
    heroImageUrl: null, // the round has no photo of its own; the season's picture is not shown by this page
  },
  card,
  results: rows,
  quali: detail.quali,
  you,
  story,
  incidents: null, // archived file only
  sprint: null,
  weekend,
  career,
  season,
  teammates,
  standings,
  team: teamCard,
  rating: null, // private: /api/me/rating/history
  points: null, // private: the member's NABS Tokens ledger
};

const laps = { [race.id]: lapChart };
const out = `// GENERATED by mock/build-real.mjs from the live site's public API (api-cache/): do not edit by hand.
// ${seasonRow.name} (${series.name}), Round ${race.number}, ${race.track}, ${race.date.slice(0, 10)}: ${you.name}, P${you.grid} on the grid, classified ${you.status === "FINISHED" ? "P" + you.position : you.status}.
// \`recap\` follows backend/src/lib/raceRecap.js buildRaceRecap; \`laps\` is GET /api/races/:id/laps as served.
// Not public, so null as the real payload has it when there is nothing: rating, points, incidents, and the
// lap-time half of story (pace, pace table, best-lap lap, time off pace, stint degradation).

export const SERIES = ${JSON.stringify(seriesList.map((s) => ({ id: s.id, slug: s.slug, name: s.name, shortName: null, isActive: s.isActive, isPrivate: !s.isPublic, accentColor: s.accentColor })), null, 2)};

export const recap = ${JSON.stringify(recap, null, 2)};

export const laps = ${JSON.stringify(laps)};
`;
writeFileSync(join(HERE, "real-recap.js"), out);

console.log(`mock/real-recap.js: ${race.track} R${race.number}, ${you.name} P${you.grid} -> ${you.position} (raw P${you.rawPosition}), +${you.points}`);
console.log("standings", JSON.stringify(standings.before), "->", JSON.stringify(standings.after), "team", JSON.stringify(teamCard.before), "->", JSON.stringify(teamCard.after));
console.log("career", JSON.stringify(career));
console.log("story", JSON.stringify({ ...story, laps: story.laps.length }));
console.log("teammates", JSON.stringify(teammates));
console.log("beatTeams", JSON.stringify(you.beatTeams), "cleanRace", you.cleanRace);
