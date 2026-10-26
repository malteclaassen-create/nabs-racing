import { describe, it, expect } from "vitest";
import { slugify, sanitizeArticleInput, checkCoverUrl, readingMinutes } from "./news.js";
import { composeRaceReport } from "./newsRaceReport.js";

describe("slugify", () => {
  it("makes a readable address out of a title", () => {
    expect(slugify("Munti conquers Spa-Francorchamps!")).toBe("munti-conquers-spa-francorchamps");
    expect(slugify("Grüße aus Nürburgring")).toBe("grusse-aus-nurburgring");
    expect(slugify("   ")).toBe("article");
  });
});

describe("checkCoverUrl", () => {
  it("takes uploads and https addresses only", () => {
    expect(checkCoverUrl("/api/uploads/news/a1-b2.jpg").url).toBe("/api/uploads/news/a1-b2.jpg");
    expect(checkCoverUrl("https://example.com/x.png").url).toBe("https://example.com/x.png");
    expect(checkCoverUrl("").url).toBe(null);
    expect(checkCoverUrl("javascript:alert(1)").error).toBeTruthy();
    expect(checkCoverUrl("http://example.com/x.png").error).toBeTruthy();
    expect(checkCoverUrl("/api/uploads/../secret").error).toBeTruthy();
  });
});

describe("sanitizeArticleInput", () => {
  it("needs a title", () => {
    expect(sanitizeArticleInput({ title: " " }).error).toBeTruthy();
  });

  it("cleans and defaults the fields", () => {
    const { article } = sanitizeArticleInput({
      title: "  Big   news\n",
      body: "Line one\r\nLine two​",
      category: "transfers",
      status: "published",
    });
    expect(article).toMatchObject({
      title: "Big news",
      body: "Line one\nLine two",
      category: "TRANSFERS",
      status: "PUBLISHED",
      coverUrl: null,
      summary: null,
    });
  });

  it("falls back to safe values for unknown category and status", () => {
    const { article } = sanitizeArticleInput({ title: "Hello", category: "nope", status: "LIVE" });
    expect(article.category).toBe("RACES");
    expect(article.status).toBe("DRAFT");
  });

  it("leaves out what a partial update does not send", () => {
    const { article } = sanitizeArticleInput({ status: "PUBLISHED" }, { partial: true });
    expect(article).toEqual({ status: "PUBLISHED" });
  });

  it("ties a Races article to a round, and no other kind", () => {
    expect(sanitizeArticleInput({ title: "Spa", raceId: "cmabc12345" }).article.raceId).toBe("cmabc12345");
    expect(sanitizeArticleInput({ title: "Spa", raceId: "" }).article.raceId).toBe(null);
    expect(sanitizeArticleInput({ title: "Move", category: "TRANSFERS", raceId: "cmabc12345" }).article.raceId).toBe(null);
    expect(sanitizeArticleInput({ title: "Spa", raceId: "x'; DROP" }).error).toBeTruthy();
    expect(sanitizeArticleInput({ raceId: "cmabc12345" }, { partial: true }).article).toEqual({ raceId: "cmabc12345" });
  });
});

describe("readingMinutes", () => {
  it("is never zero", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("word ".repeat(660))).toBe(3);
  });
});

const team = (name) => ({ name });
const row = (driverId, name, position, extra = {}) => ({
  driverId,
  name,
  position,
  status: "FINISHED",
  grid: null,
  totalTimeMs: null,
  bestLapMs: null,
  penaltySeconds: 0,
  team: team(`${name} Racing`),
  ...extra,
});

describe("composeRaceReport", () => {
  const race = { id: "r1", number: 5, track: "spa" };
  const results = [
    row("a", "Munti", 1, { grid: 4, totalTimeMs: 3_600_000, bestLapMs: 138_853 }),
    row("b", "Dieguiosk", 2, { grid: 1, totalTimeMs: 3_600_400 }),
    row("c", "Dericcc", 3, { grid: 9, totalTimeMs: 3_620_000 }),
    row("d", "Zeronik", null, { status: "DNF", grid: 2 }),
  ];
  const standingsAfter = [
    { driverId: "b", name: "Dieguiosk", total: 120 },
    { driverId: "a", name: "Munti", total: 110 },
  ];

  it("writes the facts of the round", () => {
    const a = composeRaceReport({ race, results, standingsAfter, poleDriverId: "b", link: "/s/nabs/races?race=r1", draft: true });
    expect(a.category).toBe("RACES");
    expect(a.title).toContain("Munti");
    expect(a.summary).toContain("Munti beat Dieguiosk and Dericcc at Spa");
    expect(a.summary).toContain("Dieguiosk leads the championship by 10 points");
    expect(a.body).toContain("from P4");
    expect(a.body).toContain("0.400 seconds");
    expect(a.body).toContain("Pole sitter Dieguiosk finished P2");
    expect(a.body).toContain("Mover of the day: Dericcc went from P9 to P3");
    expect(a.body).toContain("Fastest lap: Munti, 2:18.853");
    expect(a.body).toContain("Retirement: Zeronik");
    expect(a.body).toContain("[Full classification](/s/nabs/races?race=r1)");
    expect(a.body).toContain("Writer's corner");
  });

  it("leaves the writer's note out when it publishes itself", () => {
    const a = composeRaceReport({ race, results, standingsAfter, draft: false });
    expect(a.body).not.toContain("Writer's corner");
  });

  it("is stable for the same round", () => {
    expect(composeRaceReport({ race, results }).title).toBe(composeRaceReport({ race, results }).title);
  });

  it("says nothing without a finisher", () => {
    expect(composeRaceReport({ race, results: [row("d", "Zeronik", null, { status: "DNF" })] })).toBe(null);
  });

  it("spots a new championship leader", () => {
    const a = composeRaceReport({
      race,
      results,
      standingsAfter,
      standingsBefore: [{ driverId: "a", name: "Munti", total: 90 }],
    });
    expect(a.body).toContain("new championship leader: Dieguiosk takes over from Munti");
  });
});
