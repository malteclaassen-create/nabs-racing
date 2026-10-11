import { describe, it, expect, vi, beforeEach } from "vitest";

// The widget is assembled from the site's own services; those are mocked here
// and covered by their own tests. What is pinned here is the shape the
// Scriptable widget reads, and that each figure follows the page it mirrors.
vi.mock("./series.js", () => ({ resolveSeries: vi.fn() }));
vi.mock("../services/seasonService.js", () => ({ getActiveSeason: vi.fn() }));
vi.mock("../services/standingsService.js", () => ({
  getDriverStandings: vi.fn(),
  getT1ConstructorStandings: vi.fn(),
  getT2ConstructorStandings: vi.fn(),
}));
vi.mock("../services/raceDetailService.js", () => ({ raceDetailPayload: vi.fn() }));
vi.mock("../services/cardRatingService.js", () => ({ getCardRating: vi.fn() }));
vi.mock("../services/liveTiming.js", () => ({ getBoard: vi.fn() }));
vi.mock("./liveServers.js", () => ({ resolveServerKey: vi.fn(async () => "nabs1") }));
vi.mock("./sprintRaces.js", () => ({ readParentIds: vi.fn(async () => new Map([["sprint9", "r9"]])) }));
vi.mock("./raceTypes.js", () => ({ readRaceTypes: vi.fn(async () => new Map([["t1", "TRAINING"]])) }));
vi.mock("./raceCountries.js", () => ({
  readRaceCountries: vi.fn(async () => new Map()),
  staticCountryFor: vi.fn((track) => ({ Singapore: "sg", Silverstone: "gb" })[track] || null),
}));
vi.mock("./waitlist.js", () => ({ seatsFor: vi.fn() }));
vi.mock("./attendanceGate.js", () => ({
  attendanceGate: vi.fn(() => ({ open: true, opensAt: null, forced: null, closedForStart: false })),
  readAttendanceOverrides: vi.fn(async () => ({})),
}));
vi.mock("./attendanceHidden.js", () => ({ readHiddenRaceIds: vi.fn(async () => new Set()) }));
vi.mock("./notifications.js", () => ({ readNotifySettings: vi.fn(async () => ({})) }));
vi.mock("./persons.js", () => ({
  getNameOverrides: vi.fn(async () => new Map()),
  getIdentityOverrides: vi.fn(async () => new Map()),
  getLinkedDriverIds: vi.fn(async (_prisma, id) => [id]),
}));
vi.mock("./driverRoles.js", () => ({ readDriverRoles: vi.fn(async () => new Map()) }));
vi.mock("./widgetAvatar.js", () => ({
  avatarUrlFor: vi.fn(async (_prisma, id, origin) => `${origin}/api/widget/avatar/${id}?v=abc`),
}));

const { resolveSeries } = await import("./series.js");
const { getActiveSeason } = await import("../services/seasonService.js");
const standingsService = await import("../services/standingsService.js");
const { raceDetailPayload } = await import("../services/raceDetailService.js");
const { getCardRating } = await import("../services/cardRatingService.js");
const { getBoard } = await import("../services/liveTiming.js");
const { seatsFor } = await import("./waitlist.js");
const { duelStats } = await import("./widget.js");
const { attendanceGate } = await import("./attendanceGate.js");
const {
  buildWidget,
  pickRaces,
  seasonLabel,
  seriesInfo,
  leagueIso,
  resultRows,
  standingsView,
  liveBlock,
  outlineFor,
  findDriverRow,
  attendanceBlock,
} = await import("./widget.js");

const race = (o) => ({ isSpecialEvent: false, isCompleted: false, date: null, ...o });
const team = (id, name, color, tier = 1) => ({ id, name, color, tier });

describe("leagueIso", () => {
  it("writes league time with the summer offset", () => {
    expect(leagueIso(new Date("2026-10-16T17:30:00Z"))).toBe("2026-10-16T19:30:00+02:00");
  });

  it("follows the clocks back in late October", () => {
    expect(leagueIso(new Date("2026-10-30T18:30:00Z"))).toBe("2026-10-30T19:30:00+01:00");
  });

  it("is null without a usable date", () => {
    expect(leagueIso(null)).toBe(null);
    expect(leagueIso("nonsense")).toBe(null);
  });
});

describe("seasonLabel and seriesInfo", () => {
  it("adds the car era to the season's name", () => {
    expect(seasonLabel({ name: "Season 8", game: "F1 2010" })).toBe("Season 8 · F1 2010");
    expect(seasonLabel({ name: "Season 7", game: "F1 2007 · Assetto Corsa" })).toBe("Season 7 · F1 2007");
    expect(seasonLabel({ name: "Season 1", game: null })).toBe("Season 1");
  });

  it("gives the series' accent, or the site's pink", () => {
    expect(seriesInfo({ slug: "friday-f1", name: "F1 Friday", accentColor: null })).toEqual({
      slug: "friday-f1",
      name: "F1 Friday",
      accent: "#F4AFC6",
    });
    expect(seriesInfo({ slug: "sunday", name: "Sunday", accentColor: "#00ccff" }).accent).toBe("#00CCFF");
  });
});

describe("pickRaces", () => {
  it("takes the last completed championship round and the next race by date", () => {
    const races = [
      race({ id: "t1", number: null, type: "TRAINING", isSpecialEvent: true, isCompleted: true }),
      race({ id: "r8", number: 8, isCompleted: true }),
      race({ id: "r9", number: 9, isCompleted: true }),
      race({ id: "x", number: null, type: "SPECIAL", isSpecialEvent: true, date: "2026-10-12T17:00:00Z" }),
      race({ id: "r10", number: 10, date: "2026-10-16T17:30:00Z" }),
    ];
    const { lastRace, nextRace, champRaces } = pickRaces(races);
    expect(lastRace.id).toBe("r9");
    // A special event never takes the countdown card, even when it is sooner.
    expect(nextRace.id).toBe("r10");
    expect(champRaces.map((r) => r.id)).toEqual(["r8", "r9", "r10"]);
  });

  it("counts an upcoming training as the next race, like the Home page", () => {
    const races = [
      race({ id: "r1", number: 1, date: "2026-08-07T17:30:00Z" }),
      race({ id: "t1", number: null, type: "TRAINING", isSpecialEvent: true, date: "2026-07-31T00:00:00Z" }),
    ];
    expect(pickRaces(races).nextRace.id).toBe("t1");
  });

  it("is empty before the opener and after the finale", () => {
    expect(pickRaces([race({ id: "r1", number: 1 })]).lastRace).toBe(null);
    expect(pickRaces([race({ id: "r1", number: 1, isCompleted: true })]).nextRace).toBe(null);
  });
});

describe("resultRows", () => {
  const row = (o) => ({
    status: "FINISHED",
    team: team("own", "Own", "#111111"),
    effectiveTeam: null,
    isSub: false,
    subForTeam: null,
    laps: 20,
    penaltySeconds: 0,
    ...o,
  });

  it("reads like the race results table", () => {
    const rows = resultRows({
      race: { fastestLapDriverId: null },
      results: [
        row({ driverId: "a", name: "Alpha", country: "gb", position: 1, grid: 3, points: 35, totalTimeMs: 1_800_000, bestLapMs: 90_500 }),
        row({
          driverId: "b",
          name: "Bravo",
          country: null,
          position: 2,
          grid: 1,
          points: 30,
          totalTimeMs: 1_800_312,
          bestLapMs: 90_400,
          // A reserve standing in: the car's team, marked as the sub.
          team: team("res", "Reserve", "#64748b", 0),
          effectiveTeam: team("rb", "Red Bull", "#1E41FF"),
          isSub: true,
          subForTeam: team("rb", "Red Bull", "#1E41FF"),
        }),
        // Stewards' seconds count; a lapped car reads in laps.
        row({ driverId: "c", name: "Charlie", country: "nl", position: 3, grid: 3, points: 25, totalTimeMs: 1_790_000, penaltySeconds: 15 }),
        row({ driverId: "d", name: "Delta", country: "de", position: 4, grid: 4, points: 22, totalTimeMs: 1_850_000, laps: 19 }),
        // Out of the classification, but its lap still counts for the honour.
        row({ driverId: "e", name: "Echo", position: 5, status: "DNF", points: 0, bestLapMs: 89_000 }),
      ],
    });
    expect(rows).toEqual([
      { pos: 1, driver: "Alpha", country: "GB", team: "Own", teamColor: "#111111", points: 35, gained: 2, gap: null, fastestLap: false },
      { pos: 2, driver: "Bravo", country: null, team: "Red Bull (sub)", teamColor: "#1E41FF", points: 30, gained: -1, gap: "+0.312", fastestLap: false },
      { pos: 3, driver: "Charlie", country: "NL", team: "Own", teamColor: "#111111", points: 25, gained: 0, gap: "+5.000", fastestLap: false },
      { pos: 4, driver: "Delta", country: "DE", team: "Own", teamColor: "#111111", points: 22, gained: 0, gap: "+1 lap", fastestLap: false },
    ]);
  });

  it("marks the fastest lap the way the table does", () => {
    const results = [
      row({ driverId: "a", name: "A", position: 1, bestLapMs: 91_000 }),
      row({ driverId: "b", name: "B", position: 2, bestLapMs: 90_000 }),
    ];
    expect(resultRows({ race: {}, results }).map((r) => r.fastestLap)).toEqual([false, true]);
    // The admin-recorded holder wins over the stored laps.
    expect(resultRows({ race: { fastestLapDriverId: "a" }, results }).map((r) => r.fastestLap)).toEqual([true, false]);
  });

  it("stops at ten", () => {
    const results = Array.from({ length: 14 }, (_, i) => row({ driverId: `d${i}`, name: `D${i}`, position: i + 1 }));
    expect(resultRows({ race: {}, results })).toHaveLength(10);
  });
});

describe("standingsView", () => {
  const sRow = (driverId, total, o = {}) => ({
    driverId,
    name: driverId,
    tier: 1,
    total,
    team: team("t", "Team", "#123456"),
    perRace: { 1: { points: total }, 2: { points: 0 } },
    ...o,
  });

  it("leaves out the reserves who never drove and ranks the rest 1..n", () => {
    const view = standingsView({
      raceNumbers: [1, 2],
      standings: [
        sRow("a", 50, { position: 1 }),
        sRow("idle", 0, { position: 2, tier: 0, perRace: {} }),
        sRow("b", 40, { position: 3 }),
      ],
    });
    expect(view.map((r) => [r.driverId, r.position])).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("moves the arrow like the Standings page, and drops it once the title is decided", () => {
    const data = {
      raceNumbers: [1, 2],
      standings: [
        sRow("a", 50, { position: 1, prevPosition: 2 }),
        sRow("b", 40, { position: 2, prevPosition: 1 }),
        // Nobody to move from: their first start was the last round.
        sRow("new", 30, { position: 3, prevPosition: 3, perRace: { 2: { points: 30 } } }),
      ],
    };
    expect(standingsView(data).map((r) => r.change)).toEqual([1, -1, null]);
    expect(standingsView(data, { decided: true }).map((r) => r.change)).toEqual([null, null, null]);
  });
});

describe("liveBlock", () => {
  const teams = [
    { name: "Reserve", color: "#64748b", tier: 0, drivers: [{ id: "s1", name: "Steffan", discordName: "steff", country: "gr" }] },
    { name: "Toro Rosso", color: "#7A0A0A", tier: 2, drivers: [{ id: "a1", name: "aliveaxe", discordName: "axe", country: "rs" }] },
  ];
  const board = (o = {}) => ({
    ok: true,
    stale: false,
    session: {
      type: "Practice",
      trackName: "NABS Silverstone",
      track: "ks_silverstone",
      sessionIndex: 0,
      sessionCount: 3,
      remainingMs: 60_000,
    },
    entries: [
      { name: "STEFFAN", bestLapMs: 90_330, carName: "Formula 2010", onTrack: true },
      { name: "aliveaxe", bestLapMs: 90_536, carName: "Formula 2010", onTrack: false },
      { name: "Stranger", bestLapMs: 90_600, carName: "F1 2010 - Lotus" },
      { name: "NoLapYet", bestLapMs: null },
    ],
    ...o,
  });

  it("heads and lists the session like the Live page", () => {
    const now = Date.parse("2026-10-18T03:09:00Z");
    expect(liveBlock(board(), teams, now)).toEqual({
      active: true,
      onTrack: 1,
      name: "NABS Silverstone",
      track: "Silverstone",
      session: "Practice 1/3",
      endsAt: "2026-10-18T05:10:00+02:00",
      best: [
        { pos: 1, driver: "STEFFAN", country: "GR", team: "Reserve", teamColor: "#64748b", time: "1:30.330", gap: null },
        { pos: 2, driver: "ALIVEAXE", country: "RS", team: "Toro Rosso", teamColor: "#7A0A0A", time: "1:30.536", gap: "+0.206" },
        // Nobody the roster knows: the car stands where the team would.
        { pos: 3, driver: "STRANGER", country: null, team: "Lotus", teamColor: null, time: "1:30.600", gap: "+0.270" },
      ],
      timed: 3,
      me: null,
    });
  });

  it("keeps only one tier's drivers when asked, counting positions inside it", () => {
    const now = Date.parse("2026-10-18T03:09:00Z");
    const block = liveBlock(board(), teams, now, { tier: 2 });
    expect(block.best.map((r) => [r.pos, r.driver])).toEqual([[1, "ALIVEAXE"]]);
    expect(block.timed).toBe(1);
  });

  it("keeps the session's best times when nobody is driving", () => {
    const now = Date.parse("2026-10-18T03:09:00Z");
    const empty = board();
    empty.entries = empty.entries.map((e) => ({ ...e, onTrack: false }));
    const idle = liveBlock(empty, teams, now);
    expect(idle).toMatchObject({ active: false, onTrack: 0, endsAt: "2026-10-18T05:10:00+02:00" });
    expect(idle.best).toHaveLength(3);
  });

  it("is null without a session, and has no end time once the data stops", () => {
    expect(liveBlock({ ok: false, session: null, entries: [] }, teams)).toBe(null);
    const quiet = liveBlock(board({ stale: true }), teams);
    expect(quiet.endsAt).toBe(null);
    expect(quiet.best).toHaveLength(3);
  });
});

describe("outlineFor", () => {
  it("fits the site's circuit outline into a 100 × 70 box", () => {
    const pts = outlineFor("Most")
      .split(" ")
      .map((p) => p.split(",").map(Number));
    expect(pts.length).toBeGreaterThan(50);
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(100);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(70);
    expect(outlineFor("Poznan")).toMatch(/^[\d.]+,[\d.]+( [\d.]+,[\d.]+)+$/);
  });

  it("has none for a track the site does not draw", () => {
    expect(outlineFor("Nowhere Raceway")).toBe(null);
    expect(outlineFor(null)).toBe(null);
  });
});

describe("findDriverRow", () => {
  const rows = [
    { driverId: "x", name: "Racer One", discordName: "r1", position: 3 },
    { driverId: "y", name: "Other", discordName: "racer one", position: 9 },
  ];
  it("matches the name in any case, the table's row first", () => {
    expect(findDriverRow(rows, "RACER ONE").driverId).toBe("x");
    expect(findDriverRow(rows, "r1").driverId).toBe("x");
    expect(findDriverRow(rows, "nobody")).toBe(null);
    expect(findDriverRow(rows, "")).toBe(null);
  });
});

describe("attendanceBlock", () => {
  const rounds = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `r${n}`, number: n, isCompleted: n <= 4 }));

  it("gives every round a status, the run of starts and the next round", () => {
    const started = new Map([
      ["r1", "FINISHED"],
      ["r2", "DNS"],
      ["r3", "DNF"],
      ["r4", "FINISHED"],
    ]);
    const answers = new Map([["r5", "ACCEPTED"]]);
    expect(attendanceBlock(rounds, started, answers, new Set())).toEqual({
      driven: 3,
      total: 4,
      streak: 2,
      next: "signed",
      rounds: [
        { round: 1, status: "attended" },
        { round: 2, status: "missed" },
        { round: 3, status: "attended" },
        { round: 4, status: "attended" },
        { round: 5, status: "signed" },
        { round: 6, status: "future" },
      ],
    });
  });

  it("calls the next round and any open sign-up pending", () => {
    const block = attendanceBlock(rounds, new Map(), new Map([["r5", "TENTATIVE"]]), new Set(["r6"]));
    expect(block.next).toBe("pending");
    expect(block.rounds.slice(4)).toEqual([
      { round: 5, status: "pending" },
      { round: 6, status: "pending" },
    ]);
    expect(block.streak).toBe(0);
  });
});

describe("buildWidget", () => {
  const calendar = [
    race({ id: "t1", number: null, isSpecialEvent: true, isCompleted: true, track: "Spa" }),
    race({ id: "sprint9", number: null, isSpecialEvent: true, isCompleted: true }),
    race({ id: "r9", number: 9, track: "Singapore", isCompleted: true, date: new Date("2026-10-09T17:30:00Z") }),
    race({ id: "r10", number: 10, track: "Silverstone", date: new Date("2026-10-16T17:30:00Z") }),
  ];
  const prisma = {
    race: { findMany: vi.fn(async () => calendar) },
    raceResult: { findMany: vi.fn(async () => [{ raceId: "r9", status: "FINISHED" }]) },
    driver: { findUnique: vi.fn(async () => ({ number: 69 })) },
    team: { findMany: vi.fn(async () => []) },
    $queryRawUnsafe: vi.fn(async () => [{ cardsEnabled: 1 }]),
  };
  const standing = (driverId, name, position, total, teamId = "w") => ({
    driverId,
    name,
    discordName: name.toLowerCase(),
    position,
    total,
    tier: 1,
    country: "de",
    team: team(teamId, teamId === "w" ? "Williams" : "McLaren", "#1E6FE0"),
    perRace: { 9: { points: 10, status: "FINISHED", position } },
  });

  beforeEach(() => {
    resolveSeries.mockResolvedValue({ id: "f1", slug: "friday-f1", name: "F1 Friday", accentColor: null });
    getActiveSeason.mockResolvedValue({ id: "s8", name: "Season 8", game: "F1 2010" });
    raceDetailPayload.mockResolvedValue({
      race: {},
      results: [
        { driverId: "lead", name: "Leader", position: 1, status: "FINISHED", points: 35, team: team("m", "McLaren", "#FF8000") },
        { driverId: "me", name: "Racer", position: 2, status: "FINISHED", points: 30, team: team("w", "Williams", "#1E6FE0") },
      ],
    });
    standingsService.getDriverStandings.mockResolvedValue({
      raceNumbers: [9, 10],
      standings: [
        standing("lead", "Leader", 1, 150, "m"),
        standing("mate", "Mate", 2, 132),
        standing("me", "Racer", 3, 96),
        standing("back", "Back", 4, 86, "m"),
      ],
    });
    standingsService.getT1ConstructorStandings.mockResolvedValue({
      standings: [{ position: 1, name: "McLaren", color: "#FF8000", total: 342 }],
    });
    standingsService.getT2ConstructorStandings.mockResolvedValue({ standings: [] });
    getCardRating.mockResolvedValue({ ratings: { overall: 86, exp: 76, rac: 82, aha: 89, pac: 93 } });
    getBoard.mockReturnValue({ ok: false, session: null, entries: [] });
    seatsFor.mockResolvedValue({ accepted: 18, capacity: 40, waiting: 2, mine: "ACCEPTED" });
  });

  it("is null for a series nobody may see", async () => {
    resolveSeries.mockResolvedValueOnce(null);
    expect(await buildWidget(prisma, { series: "nope" })).toBe(null);
    expect(resolveSeries).toHaveBeenLastCalledWith(prisma, "nope", { includePrivate: false });
  });

  it("keeps every field version 1 sent", async () => {
    const body = await buildWidget(prisma, {});
    expect(body.season).toBe("Season 8 · F1 2010");
    expect(body.nextRace).toMatchObject({ round: 10, track: "Silverstone", date: "2026-10-16T19:30:00+02:00" });
    expect(body.lastRace.round).toBe(9);
    expect(body.lastRace.track).toBe("Singapore");
    expect(body.lastRace.podium).toEqual([
      { pos: 1, driver: "Leader", team: "McLaren", points: 35 },
      { pos: 2, driver: "Racer", team: "Williams", points: 30 },
    ]);
    expect(body.standings[0]).toMatchObject({ pos: 1, driver: "Leader", team: "McLaren", points: 150 });
    expect(body.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it("adds the new fields", async () => {
    const body = await buildWidget(prisma, {});
    expect(body.series).toEqual({ slug: "friday-f1", name: "F1 Friday", accent: "#F4AFC6" });
    expect(body.nextRace).toEqual({
      round: 10,
      totalRounds: 2,
      track: "Silverstone",
      circuit: "Silverstone",
      country: "GB",
      date: "2026-10-16T19:30:00+02:00",
      outline: expect.stringMatching(/^[\d.]+,[\d.]+ /),
      signedUp: 18,
      maxGrid: 40,
      waiting: 2,
    });
    expect(body.lastRace).toMatchObject({ circuit: "Marina Bay", country: "SG", date: "2026-10-09T19:30:00+02:00" });
    expect(body.lastRace.results).toHaveLength(2);
    expect(body.standings[1]).toMatchObject({ gap: -18, change: null });
    expect(body.constructors).toEqual({
      tier1: [{ pos: 1, team: "McLaren", teamColor: "#FF8000", points: 342 }],
      tier2: [],
    });
    expect(body.live).toBe(null);
    expect(body.me).toBe(null);
  });

  it("leaves the sign-up count out until the sign-up opens", async () => {
    attendanceGate.mockReturnValueOnce({ open: false, opensAt: new Date(Date.now() + 86_400_000), forced: null, closedForStart: false });
    const next = (await buildWidget(prisma, {})).nextRace;
    expect(next.signedUp).toBe(null);
    expect(next.maxGrid).toBe(null);
    expect(next.waiting).toBe(null);
  });

  it("fills `me` for a driver who asks, and only then", async () => {
    const body = await buildWidget(prisma, { driver: "racer", origin: "https://nabsracing.com" });
    expect(body.me).toEqual({
      driver: "Racer",
      number: 69,
      avatar: "https://nabsracing.com/api/widget/avatar/me?v=abc",
      country: "DE",
      team: "Williams",
      teamColor: "#1E6FE0",
      tier: 1,
      pos: 3,
      points: 96,
      gapAhead: -36,
      gapBehind: 10,
      gapLeader: -54,
      ahead: "Mate",
      aheadTeam: "Williams",
      aheadColor: "#1E6FE0",
      behind: "Back",
      behindTeam: "McLaren",
      behindColor: "#1E6FE0",
      rating: { rtg: 86, exp: 76, rac: 82, awa: 89, pac: 93 },
      lastResult: { round: 9, track: "Singapore", pos: 2, points: 30 },
      form: [{ round: 9, track: "Singapore", pos: 3 }],
      stats: { wins: 0, podiums: 1, bestFinish: 3, avgFinish: 3, poles: 0, bestGrid: null, avgGrid: null },
      teammate: {
        driver: "Mate",
        pos: 2,
        points: 132,
        stats: { wins: 0, podiums: 1, bestFinish: 2, avgFinish: 2, poles: 0, bestGrid: null, avgGrid: null },
      },
      attendance: { driven: 1, total: 1, streak: 1, next: "signed", rounds: [
        { round: 9, status: "attended" },
        { round: 10, status: "signed" },
      ] },
    });
  });

  it("gives a reserve no tier", async () => {
    const data = await standingsService.getDriverStandings();
    standingsService.getDriverStandings.mockResolvedValueOnce({
      ...data,
      standings: data.standings.map((r) => (r.driverId === "me" ? { ...r, tier: 0 } : r)),
    });
    expect((await buildWidget(prisma, { driver: "racer" })).me.tier).toBe(null);
  });

  it("counts everything inside the driver's own tier with scope=tier", async () => {
    const data = await standingsService.getDriverStandings();
    standingsService.getDriverStandings.mockResolvedValueOnce({
      ...data,
      standings: data.standings.map((r) => (r.driverId === "me" || r.driverId === "back" ? { ...r, tier: 2 } : r)),
    });
    const body = await buildWidget(prisma, { driver: "racer", scope: "tier" });
    expect(body.scope).toEqual({ tier: 2 });
    expect(body.standings.map((r) => [r.pos, r.driver])).toEqual([[1, "Racer"], [2, "Back"]]);
    expect(body.me).toMatchObject({ pos: 1, gapAhead: null, behind: "Back", gapBehind: 10 });
    // without the switch nothing changes
    expect((await buildWidget(prisma, { driver: "racer" })).scope).toBe(null);
  });

  it("answers normally when the driver is unknown", async () => {
    const body = await buildWidget(prisma, { driver: "nobody" });
    expect(body.me).toBe(null);
    expect(body.standings).toHaveLength(4);
  });

  it("gives null for a part that fails instead of failing the widget", async () => {
    getBoard.mockImplementationOnce(() => {
      throw new Error("relay down");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = await buildWidget(prisma, {});
    spy.mockRestore();
    expect(body.live).toBe(null);
    expect(body.standings.length).toBeGreaterThan(0);
  });
});

describe("duelStats", () => {
  it("counts the head-to-head numbers the way the profile does", () => {
    const row = {
      perRace: {
        1: { status: "FINISHED", position: 1, grid: 1 },
        2: { status: "FINISHED", position: 4, grid: 3, sprint: { status: "FINISHED", position: 2 } },
        3: { status: "DNF", position: null, grid: 6 },
        4: { status: "FINISHED", position: 7, grid: null },
      },
    };
    expect(duelStats(row)).toEqual({
      wins: 1, // the sprint's P2 counts for podiums, not for wins
      podiums: 2,
      bestFinish: 1,
      avgFinish: 4,
      poles: 1,
      bestGrid: 1,
      avgGrid: 3.3,
    });
  });

  it("leaves everything empty for a driver without results", () => {
    expect(duelStats({ perRace: {} })).toEqual({ wins: 0, podiums: 0, bestFinish: null, avgFinish: null, poles: 0, bestGrid: null, avgGrid: null });
    expect(duelStats(null).bestFinish).toBe(null);
  });
});

describe("liveBlock size", () => {
  it("lists the twelve fastest drivers, quickest first", () => {
    const entries = Array.from({ length: 21 }, (_, i) => ({ name: "driver" + i, bestLapMs: 100_000 - i * 100, carName: "Formula 2010", onTrack: i === 0 }));
    const block = liveBlock({ ok: true, stale: false, session: { trackName: "Silverstone", type: "Practice", sessionCount: 1, sessionIndex: 0, remainingMs: 600_000 }, entries }, []);
    expect(block.best).toHaveLength(12);
    expect(block.best[0]).toMatchObject({ pos: 1, driver: "DRIVER20", gap: null });
    expect(block.best[11].pos).toBe(12);
    expect(block.onTrack).toBe(1);
  });

  it("adds the asking driver's own line when they are slower than the twelfth", () => {
    const session = { trackName: "Silverstone", type: "Practice", sessionCount: 1, sessionIndex: 0, remainingMs: 600_000 };
    const names = ["Zed Quinn", "Amy Lane"];
    const entries = Array.from({ length: 21 }, (_, i) => ({
      name: i === 15 ? names[0] : i === 2 ? names[1] : "pilot" + String.fromCharCode(97 + i) + "x",
      bestLapMs: 100_000 + i * 100,
      carName: "Formula 2010",
    }));
    const roster = [{ name: "Test", color: "#fff", tier: 1, drivers: [
      { id: "d15", name: "Zed Quinn", discordName: "zedq" },
      { id: "d2", name: "Amy Lane", discordName: "amyl" },
    ] }];
    const board = { ok: true, stale: false, session, entries };
    const slow = liveBlock(board, roster, Date.now(), { driver: "zed quinn" });
    expect(slow.best).toHaveLength(12);
    expect(slow.timed).toBe(21);
    expect(slow.me).toMatchObject({ pos: 16, driver: "ZED QUINN", time: "1:41.500" });
    // somebody inside the list needs no extra line
    expect(liveBlock(board, roster, Date.now(), { driver: "Amy Lane" }).me).toBe(null);
  });
});
