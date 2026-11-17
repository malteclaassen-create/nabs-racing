import { describe, it, expect, vi, beforeEach } from "vitest";

// The card service only ORCHESTRATES: which season's numbers land on which
// driver's card. The rating maths itself (driverRatingsService) and the window
// resolution (careerRatingService) are stubbed, so these tests are about the
// carry-over rule alone.
vi.mock("./driverRatingsService.js", () => ({ getDriverRatings: vi.fn() }));
vi.mock("./careerRatingService.js", () => ({ getRatingWindow: vi.fn() }));
vi.mock("../lib/persons.js", () => ({ getPersonGroups: vi.fn() }));

const { getCardRatings, invalidateCardRatingCache } = await import("./cardRatingService.js");
const { getDriverRatings } = await import("./driverRatingsService.js");
const { getRatingWindow } = await import("./careerRatingService.js");
const { getPersonGroups } = await import("../lib/persons.js");

const team = (id) => ({ id, name: id.toUpperCase(), color: "#fff", tier: 1 });
const ratingRow = (driverId, overall, extra = {}) => ({
  driverId,
  name: `row ${driverId}`,
  tier: 1,
  team: team("old"),
  starts: 10,
  wins: 1,
  podiums: 3,
  provisional: false,
  ratings: { overall, exp: overall, pac: overall, rac: overall, aha: overall },
  ...extra,
});

// Season 8 is being raced; 7 and 6 are finished. Anna raced 7 (and 8), Ben is a
// rookie, Cara last raced in 6, Dan has never been rated anywhere.
const SEASONS = {
  s8: { id: "s8", number: 8 },
};
const DRIVERS = {
  s8: [
    { id: "d8anna", name: "Anna", tier: 1, team: team("alfa") },
    { id: "d8ben", name: "Ben", tier: 2, team: team("bull") },
    { id: "d8cara", name: "Cara", tier: 1, team: team("cat") },
    { id: "d8dan", name: "Dan", tier: 2, team: team("dart") },
  ],
};
const FIELDS = {
  s8: [ratingRow("d8anna", 70), ratingRow("d8ben", 61), ratingRow("d8cara", 66)],
  s7: [ratingRow("d7anna", 88)],
  s6: [ratingRow("d6cara", 75)],
};

// Season 8 has 12 rounds; `doneRounds` of them are completed.
let doneRounds = 3;
const prisma = {
  season: { findUnique: async ({ where }) => SEASONS[where.id] || null },
  driver: { findMany: async ({ where }) => DRIVERS[where.seasonId] || [] },
  race: {
    findMany: async () =>
      Array.from({ length: 12 }, (_, i) => ({ number: i + 1, isCompleted: i < doneRounds })),
  },
};

beforeEach(() => {
  invalidateCardRatingCache();
  vi.clearAllMocks();
  doneRounds = 3;
  getRatingWindow.mockResolvedValue([
    { id: "s7", number: 7 },
    { id: "s6", number: 6 },
  ]);
  getPersonGroups.mockResolvedValue({
    byDriver: new Map([
      ["d8anna", "pAnna"],
      ["d7anna", "pAnna"],
      ["d8cara", "pCara"],
      ["d6cara", "pCara"],
    ]),
    byPerson: new Map([
      ["pAnna", ["d8anna", "d7anna"]],
      ["pCara", ["d8cara", "d6cara"]],
    ]),
  });
  getDriverRatings.mockImplementation(async (_p, seasonId) => FIELDS[seasonId] || []);
});

describe("getCardRatings", () => {
  it("carries the previous season's numbers onto this season's card", async () => {
    const { rows, fromSeasonNumber } = await getCardRatings(prisma, "s8");
    const anna = rows.find((r) => r.driverId === "d8anna");
    expect(fromSeasonNumber).toBe(7);
    expect(anna.ratings.overall).toBe(88); // NOT the live 70
    expect(anna.card).toMatchObject({ locked: true, source: "carried", fromSeasonNumber: 7, seasonNumber: 8 });
  });

  it("keeps the CURRENT season's identity on the carried card", async () => {
    const { rows } = await getCardRatings(prisma, "s8");
    const anna = rows.find((r) => r.driverId === "d8anna");
    expect(anna.name).toBe("Anna");
    expect(anna.team.id).toBe("alfa");
  });

  it("reaches further back for a driver who sat a season out", async () => {
    const { rows } = await getCardRatings(prisma, "s8");
    const cara = rows.find((r) => r.driverId === "d8cara");
    expect(cara.ratings.overall).toBe(75);
    expect(cara.card).toMatchObject({ locked: true, fromSeasonNumber: 6 });
  });

  it("gives a rookie a live card instead of no card", async () => {
    const { rows } = await getCardRatings(prisma, "s8");
    const ben = rows.find((r) => r.driverId === "d8ben");
    expect(ben.ratings.overall).toBe(61);
    expect(ben.card).toMatchObject({ locked: false, source: "live", fromSeasonNumber: 8 });
  });

  it("leaves a never-rated driver without a card", async () => {
    const { rows } = await getCardRatings(prisma, "s8");
    expect(rows.find((r) => r.driverId === "d8dan")).toBeUndefined();
  });

  it("rates each earlier season at most once and caches the season", async () => {
    await getCardRatings(prisma, "s8");
    const seasonsRated = getDriverRatings.mock.calls.map((c) => c[1]);
    expect(seasonsRated.filter((s) => s === "s7")).toHaveLength(1);
    expect(seasonsRated.filter((s) => s === "s6")).toHaveLength(1);
    await getCardRatings(prisma, "s8");
    expect(getDriverRatings.mock.calls).toHaveLength(seasonsRated.length);
  });

  it("reprints the card at half-time with this season's numbers as of the middle round", async () => {
    doneRounds = 6;
    getDriverRatings.mockImplementation(async (_p, seasonId, opts) => {
      if (seasonId === "s8" && opts?.upToRaceNumber === 6) return [ratingRow("d8anna", 79)];
      return FIELDS[seasonId] || [];
    });
    const { rows, update } = await getCardRatings(prisma, "s8");
    expect(update).toEqual({ stage: "mid-season", round: 6 });
    const anna = rows.find((r) => r.driverId === "d8anna");
    expect(anna.ratings.overall).toBe(79);
    expect(anna.name).toBe("Anna");
    expect(anna.card).toMatchObject({ locked: true, source: "mid-season", fromSeasonNumber: 8, asOfRound: 6 });
    // No half-time row (sat the first half out): keeps the older card.
    const cara = rows.find((r) => r.driverId === "d8cara");
    expect(cara.card).toMatchObject({ source: "carried", fromSeasonNumber: 6 });
  });

  it("does not reprint before half-time", async () => {
    doneRounds = 5;
    const { update } = await getCardRatings(prisma, "s8");
    expect(update).toBeNull();
    expect(getDriverRatings.mock.calls.some((c) => c[2]?.upToRaceNumber != null)).toBe(false);
  });

  it("reprints with the final numbers once every round is done", async () => {
    doneRounds = 12;
    const { rows, update } = await getCardRatings(prisma, "s8");
    expect(update).toEqual({ stage: "season-end", round: 12 });
    const anna = rows.find((r) => r.driverId === "d8anna");
    expect(anna.ratings.overall).toBe(70);
    expect(anna.card).toMatchObject({ locked: true, source: "season-end", fromSeasonNumber: 8 });
  });
});

describe("cardUpdate", () => {
  const rounds = (n, done) => Array.from({ length: n }, (_, i) => ({ number: i + 1, isCompleted: i < done }));
  it("puts half-time at round 6 of 12 and round 6 of 11", async () => {
    const { cardUpdate } = await import("./cardRatingService.js");
    expect(cardUpdate(rounds(12, 6))).toEqual({ stage: "mid-season", round: 6 });
    expect(cardUpdate(rounds(11, 5))).toBeNull();
    expect(cardUpdate(rounds(11, 6))).toEqual({ stage: "mid-season", round: 6 });
    expect(cardUpdate(rounds(11, 11))).toEqual({ stage: "season-end", round: 11 });
  });
});
