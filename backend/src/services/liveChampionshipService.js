// ---------------------------------------------------------------------------
// Live championship projection ("if the race ends like this").
//
// While a league RACE is running on the AC server, this builds the driver and
// constructor standings AS IF the race finished in the current running order,
// by injecting a hypothetical result set into the real standings pipeline
// (standingsService `extraResults`) — so the season's own points table, drop
// rules and tier re-ranking all apply exactly as they will after the import.
//
// It fails CLOSED. The projection only activates when every check passes:
//   * the live session is a Race (not practice/quali),
//   * the ACTIVE season's calendar has a championship race scheduled TODAY
//     (league time) that isn't completed and has no stored results yet,
//   * the cars on the server actually map to this season's drivers (at least
//     3 matched AND at least half the field) — a random public lobby that
//     happens to run a race never produces a table.
// Anything short of that returns { active: false, reason } and the frontend
// simply shows nothing.
//
// TEST/TRAINING RACES (isSpecialEvent) get a STANDALONE variant: they aren't
// scored, so instead of projecting the championship the table shows this race
// alone — live order priced with the season's normal points table, nothing
// added to anyone's season total. A championship race scheduled the same day
// always wins over a test race.
// ---------------------------------------------------------------------------
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "./standingsService.js";
import { getActiveSeason, getSeasonScoring } from "./seasonService.js";
import { DEFAULT_POINTS_TABLE, getPointsForPosition } from "./pointsCalculator.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// The league runs on German time: "a race today" means today's date in Berlin.
function dayKey(date) {
  return new Date(date).toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
}

// The projection recomputes four full standings tables; cache the payload so a
// page full of viewers polling every ~20s costs one computation, not dozens.
const CACHE_MS = 10_000;
let cache = { at: 0, payload: null };

// Strip a standings row down to what the projection table needs.
function driverRow(r) {
  return {
    driverId: r.driverId,
    name: r.name,
    country: r.country,
    photoUrl: r.photoUrl || null,
    team: r.team,
    position: r.position,
    total: r.total,
  };
}
function teamRow(r) {
  return { teamId: r.teamId, name: r.name, color: r.color, logoUrl: r.logoUrl, position: r.position, total: r.total };
}

// Join projected rows with the current table: every row carries where the
// competitor stands NOW, where they'd stand IF, and the points they'd gain.
function withDeltas(projected, current, idKey) {
  const curById = new Map(current.map((r) => [r[idKey], r]));
  return projected.map((p) => {
    const cur = curById.get(p[idKey]);
    return {
      ...p,
      currentPosition: cur?.position ?? null,
      currentTotal: cur?.total ?? 0,
      gained: p.total - (cur?.total ?? 0),
      move: cur ? cur.position - p.position : 0,
    };
  });
}

export async function buildLiveChampionship(prisma, board, { simulate = false } = {}) {
  const off = (reason) => ({ active: false, reason });

  if (!simulate && cache.payload && Date.now() - cache.at < CACHE_MS) return cache.payload;

  const season = await getActiveSeason(prisma);
  if (!season) return off("no-season");

  // Calendar cross-check: the projection needs a race of the ACTIVE season
  // scheduled for today that hasn't been run/imported yet. A championship
  // round beats a test/training race on the same day; the simulate demo takes
  // today's race first, then the next open round of either kind.
  const candidates = await prisma.race.findMany({
    where: { seasonId: season.id, isCompleted: false },
    orderBy: { number: "asc" },
    include: { _count: { select: { results: true } } },
  });
  const championship = candidates.filter((r) => !r.isSpecialEvent);
  const specials = candidates.filter((r) => r.isSpecialEvent);
  const today = (list) => list.find((r) => r.date && dayKey(r.date) === dayKey(new Date()));
  const race = simulate
    ? today(championship) || today(specials) || championship[0] || specials[0]
    : today(championship) || today(specials);
  if (!race) return off("no-race-today");
  // Results already being entered (a re-opened round, or the import landing
  // mid-evening): the real numbers win, the projection steps aside.
  if (race._count.results > 0) return off("results-exist");
  // Test/training race: standalone table (this race only), not a championship
  // projection.
  const standalone = !!race.isSpecialEvent;

  const drivers = await prisma.driver.findMany({
    where: { seasonId: season.id },
    select: {
      id: true,
      name: true,
      discordName: true,
      country: true,
      photoUrl: true,
      discordAvatar: true,
      team: { select: { id: true, name: true, color: true, logoUrl: true } },
    },
  });

  // Running order + retirements, matched to this season's drivers.
  let runningIds = []; // driver ids in live race order (P1 first)
  let retiredIds = []; // matched drivers who left the server mid-race
  let unmatched = []; // in-sim names we couldn't map (guests)
  let sessionInfo = null;

  if (simulate) {
    // Admin demo (?simulate=1, admin token): current top of the championship,
    // reshuffled once so the table visibly differs from the real standings.
    // On top of that, a FEW adjacent swaps that change every 30s — small,
    // local "overtakes" like a real race, so the frontend's glide animation
    // shows without the whole field jumping around. Identical pipeline as
    // the real thing.
    const cur = await getDriverStandings(prisma, season.id);
    const top = cur.standings.filter((r) => r.total > 0).slice(0, 14);
    if (top.length < 3) return off("not-enough-data");
    runningIds = top.map((_, i) => top[(i + 2) % top.length].driverId);
    const window30s = Math.floor(Date.now() / 30_000);
    for (let k = 0; k < 3; k++) {
      const i = (window30s * (k + 3) + k * 5) % (runningIds.length - 1);
      [runningIds[i], runningIds[i + 1]] = [runningIds[i + 1], runningIds[i]];
    }
  } else {
    if (!board?.ok || !board.session) return off("no-session");
    if (board.session.type !== "Race") return off("not-a-race");
    if (board.stale || !board.connected) return off("stale");

    const entries = (board.entries || []).filter((e) => (e.lapCount || 0) > 0);
    if (entries.length === 0) return off("not-started");

    // Live race order: telemetry RacePosition for cars still on the server;
    // cars without one (telemetry not seen yet) fall back behind, by laps.
    const running = entries.filter((e) => e.onTrack);
    const retired = entries.filter((e) => !e.onTrack);
    running.sort((a, b) => {
      if (a.racePosition != null && b.racePosition != null) return a.racePosition - b.racePosition;
      if (a.racePosition != null) return -1;
      if (b.racePosition != null) return 1;
      return (b.lapCount || 0) - (a.lapCount || 0) || (b.spline || 0) - (a.spline || 0);
    });

    // Map in-sim names to season drivers (name or Discord handle, normalised).
    const index = new Map();
    for (const d of drivers) {
      for (const key of [d.name, d.discordName]) {
        const k = norm(key);
        if (k && !index.has(k)) index.set(k, d.id);
      }
    }
    const seen = new Set();
    const resolve = (e) => {
      const id = index.get(norm(e.name));
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return id;
    };
    for (const e of running) {
      const id = resolve(e);
      if (id) runningIds.push(id);
      else unmatched.push(e.name);
    }
    for (const e of retired) {
      const id = resolve(e);
      if (id) retiredIds.push(id);
      else unmatched.push(e.name);
    }

    // Roster check: a league race is full of league drivers. Too few matches
    // means this is NOT our race — show nothing rather than nonsense.
    const matchedCount = runningIds.length + retiredIds.length;
    if (matchedCount < 3 || matchedCount * 2 < entries.length) return off("field-not-matched");

    sessionInfo = {
      track: board.session.trackName || board.session.track || "",
      lapsLeader: Math.max(0, ...entries.map((e) => e.lapCount || 0)),
    };
  }

  // Standalone (test/training race): no championship math at all. The live
  // order priced with the season's normal points table IS the table — DNFs
  // classify behind the runners with zero points, exactly what the race would
  // pay if it were scored, but nothing is added to any season total.
  if (standalone) {
    const { pointsTable } = await getSeasonScoring(prisma, season);
    const table = pointsTable || DEFAULT_POINTS_TABLE;
    const byId = new Map(drivers.map((d) => [d.id, d]));
    const row = (driverId, position, { dnf } = {}) => {
      const d = byId.get(driverId);
      return {
        driverId,
        name: d?.name || "?",
        country: d?.country || null,
        photoUrl: d?.photoUrl || d?.discordAvatar || null,
        team: d?.team
          ? { id: d.team.id, name: d.team.name, color: d.team.color, logoUrl: d.team.logoUrl || null }
          : { id: null, name: "", color: "#888", logoUrl: null },
        position,
        total: dnf ? 0 : getPointsForPosition(position, table),
        livePosition: dnf ? null : position,
        dnf: !!dnf,
        // Delta fields exist for shape parity; a one-off race has no "current"
        // table to move against.
        currentPosition: null,
        currentTotal: 0,
        gained: 0,
        move: 0,
      };
    };
    const payload = {
      active: true,
      simulated: !!simulate,
      standalone: true,
      updatedAt: Date.now(),
      season: { number: season.number, name: season.name },
      race: { id: race.id, number: race.number, track: race.track },
      session: sessionInfo,
      matched: runningIds.length + retiredIds.length,
      unmatched: unmatched.length,
      drivers: [
        ...runningIds.map((id, i) => row(id, i + 1)),
        ...retiredIds.map((id, j) => row(id, runningIds.length + j + 1, { dnf: true })),
      ],
      t1: [],
      t2: [],
    };
    if (!simulate) cache = { at: Date.now(), payload };
    return payload;
  }

  // The hypothetical result set: running matched drivers classify P1..Pn in
  // live order (guests hold no slot — same contiguous-classification rule as
  // the real import); matched drivers who left the server count as DNF.
  const extraResults = [
    ...runningIds.map((driverId, i) => ({
      driverId,
      raceId: race.id,
      position: i + 1,
      status: "FINISHED",
      points: null,
      penaltySeconds: 0,
      totalTimeMs: 0,
      subForTeamId: null,
    })),
    ...retiredIds.map((driverId) => ({
      driverId,
      raceId: race.id,
      position: null,
      status: "DNF",
      points: null,
      penaltySeconds: 0,
      totalTimeMs: 0,
      subForTeamId: null,
    })),
  ];

  // Current vs projected, all four tables through the one real pipeline.
  const [curD, projD, curT1, projT1, curT2, projT2] = await Promise.all([
    getDriverStandings(prisma, season.id),
    getDriverStandings(prisma, season.id, { extraResults }),
    getT1ConstructorStandings(prisma, season.id),
    getT1ConstructorStandings(prisma, season.id, { extraResults }),
    getT2ConstructorStandings(prisma, season.id),
    getT2ConstructorStandings(prisma, season.id, { extraResults }),
  ]);

  const livePosById = new Map(runningIds.map((id, i) => [id, i + 1]));
  const dnfIds = new Set(retiredIds);

  const payload = {
    active: true,
    simulated: !!simulate,
    standalone: false,
    updatedAt: Date.now(),
    season: { number: season.number, name: season.name },
    race: { id: race.id, number: race.number, track: race.track },
    session: sessionInfo,
    matched: runningIds.length + retiredIds.length,
    unmatched: unmatched.length,
    drivers: withDeltas(projD.standings.map(driverRow), curD.standings, "driverId").map((r) => ({
      ...r,
      livePosition: livePosById.get(r.driverId) ?? null,
      dnf: dnfIds.has(r.driverId),
    })),
    t1: withDeltas(projT1.standings.map(teamRow), curT1.standings, "teamId"),
    t2: withDeltas(projT2.standings.map(teamRow), curT2.standings, "teamId"),
  };

  if (!simulate) cache = { at: Date.now(), payload };
  return payload;
}
