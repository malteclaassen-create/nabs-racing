import { describe, it, expect, vi } from "vitest";

// The widget is assembled from the site's own services; those are mocked here
// and covered by their own tests. What is pinned here is the shape the
// Scriptable widget reads, and that the picks match the Home page's.
vi.mock("../services/seasonService.js", () => ({ resolveSeason: vi.fn() }));
vi.mock("../services/standingsService.js", () => ({ getDriverStandings: vi.fn() }));
vi.mock("../services/raceDetailService.js", () => ({ raceDetailPayload: vi.fn() }));
vi.mock("./sprintRaces.js", () => ({ readParentIds: vi.fn(async () => new Map([["sprint9", "r9"]])) }));
vi.mock("./raceTypes.js", () => ({
  readRaceTypes: vi.fn(async () => new Map([["t1", "TRAINING"]])),
}));

const { resolveSeason } = await import("../services/seasonService.js");
const { getDriverStandings } = await import("../services/standingsService.js");
const { raceDetailPayload } = await import("../services/raceDetailService.js");
const { buildWidget, pickRaces, seasonLabel, leagueIso, widgetPayload } = await import("./widget.js");

const race = (o) => ({ isSpecialEvent: false, isCompleted: false, date: null, ...o });

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

describe("seasonLabel", () => {
  it("adds the car era to the season's name", () => {
    expect(seasonLabel({ name: "Season 8", game: "F1 2010" })).toBe("Season 8 · F1 2010");
    expect(seasonLabel({ name: "Season 7", game: "F1 2007 · Assetto Corsa" })).toBe("Season 7 · F1 2007");
  });

  it("is just the name when no game is set", () => {
    expect(seasonLabel({ name: "Season 1", game: null })).toBe("Season 1");
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
      race({ id: "r11", number: 11, date: "2026-10-23T17:30:00Z" }),
    ];
    const { lastRace, nextRace } = pickRaces(races);
    expect(lastRace.id).toBe("r9");
    // A special event never takes the countdown card, even when it is sooner.
    expect(nextRace.id).toBe("r10");
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

describe("widgetPayload", () => {
  const result = (position, name, team, points, extra = {}) => ({ position, name, team: { name: team }, points, ...extra });

  it("answers in the widget's shape", () => {
    const body = widgetPayload({
      season: { name: "Season 8", game: "F1 2010" },
      nextRace: { number: 10, track: "Silverstone", date: new Date("2026-10-16T17:30:00Z") },
      lastRace: { number: 9, track: "Singapore" },
      lastResults: {
        results: [
          result(2, "Steve", "Brawn GP", 30),
          result(1, "Siggsta", "McLaren", 35),
          result(4, "Manro45GT", "Sauber", 22),
          result(3, "Anxo Gonzalez", "Reserve", 25, { isSub: true, subForTeam: { name: "Red Bull" } }),
          result(null, "Krisp", "SKODA", 0, { status: "DNF" }),
        ],
      },
      standings: [
        { position: 1, name: "Siggsta", team: { name: "McLaren" }, total: 191 },
        { position: 2, name: "mtimmis", team: { name: "Renault" }, total: 168 },
        { position: 3, name: "13bot", team: { name: "Renault" }, total: 165 },
        { position: 4, name: "Steve", team: { name: "Brawn GP" }, total: 154 },
        { position: 5, name: "Pizd", team: { name: "Williams" }, total: 132 },
        { position: 6, name: "Rashford", team: { name: "McLaren" }, total: 129 },
      ],
      now: new Date("2026-10-11T07:30:00.456Z"),
    });
    expect(body).toEqual({
      season: "Season 8 · F1 2010",
      nextRace: { round: 10, track: "Silverstone", date: "2026-10-16T19:30:00+02:00" },
      lastRace: {
        round: 9,
        track: "Singapore",
        podium: [
          { pos: 1, driver: "Siggsta", team: "McLaren", points: 35 },
          { pos: 2, driver: "Steve", team: "Brawn GP", points: 30 },
          { pos: 3, driver: "Anxo Gonzalez", team: "Reserve", points: 25 },
        ],
      },
      standings: [
        { pos: 1, driver: "Siggsta", team: "McLaren", points: 191 },
        { pos: 2, driver: "mtimmis", team: "Renault", points: 168 },
        { pos: 3, driver: "13bot", team: "Renault", points: 165 },
        { pos: 4, driver: "Steve", team: "Brawn GP", points: 154 },
        { pos: 5, driver: "Pizd", team: "Williams", points: 132 },
      ],
      updatedAt: "2026-10-11T07:30:00Z",
    });
  });

  it("names the league's usual start for a round saved without a time", () => {
    const body = widgetPayload({
      season: { name: "Season 8" },
      nextRace: { number: 1, track: "Hockenheim", date: new Date("2026-08-07T00:00:00Z") },
      lastRace: null,
      lastResults: null,
      standings: [],
    });
    expect(body.nextRace.date).toBe("2026-08-07T19:00:00+02:00");
    expect(body.lastRace).toBe(null);
  });

  it("has no next race once the season is over", () => {
    const body = widgetPayload({
      season: { name: "Season 8" },
      nextRace: null,
      lastRace: { number: 12, track: "Abu Dhabi" },
      lastResults: { results: [] },
      standings: [],
    });
    expect(body.nextRace).toBe(null);
    expect(body.lastRace).toEqual({ round: 12, track: "Abu Dhabi", podium: [] });
  });
});

describe("buildWidget", () => {
  const prisma = {
    race: {
      findMany: vi.fn(async () => [
        race({ id: "t1", number: null, isSpecialEvent: true, isCompleted: true }),
        race({ id: "sprint9", number: null, isSpecialEvent: true, isCompleted: true }),
        race({ id: "r9", number: 9, track: "Singapore", isCompleted: true }),
        race({ id: "r10", number: 10, track: "Silverstone", date: new Date("2026-10-16T17:30:00Z") }),
      ]),
    },
  };

  it("never lets a private season through, even for an admin", async () => {
    resolveSeason.mockResolvedValueOnce(null);
    expect(await buildWidget(prisma, "nope")).toBe(null);
    expect(resolveSeason).toHaveBeenLastCalledWith(prisma, null, { includePrivate: false, series: "nope" });
  });

  it("reads the last round's classification and the season's table", async () => {
    resolveSeason.mockResolvedValueOnce({ id: "s8", name: "Season 8", game: "F1 2010" });
    raceDetailPayload.mockResolvedValueOnce({ results: [{ position: 1, name: "Siggsta", team: { name: "McLaren" }, points: 35 }] });
    getDriverStandings.mockResolvedValueOnce({ standings: [{ position: 1, name: "Siggsta", team: { name: "McLaren" }, total: 191 }] });
    const body = await buildWidget(prisma, undefined);
    expect(raceDetailPayload).toHaveBeenLastCalledWith(prisma, expect.objectContaining({ id: "r9" }));
    expect(getDriverStandings).toHaveBeenLastCalledWith(prisma, "s8");
    expect(body.nextRace).toEqual({ round: 10, track: "Silverstone", date: "2026-10-16T19:30:00+02:00" });
    expect(body.lastRace.podium).toEqual([{ pos: 1, driver: "Siggsta", team: "McLaren", points: 35 }]);
    expect(body.standings).toEqual([{ pos: 1, driver: "Siggsta", team: "McLaren", points: 191 }]);
  });
});
