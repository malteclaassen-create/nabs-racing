// The search snippet for the season landing page, and the one fact in it that
// could ever go stale: the race night.
//
// The page turns up under a wide spread of searches (F1 league, Assetto Corsa
// league, online sim racing), so the snippet is deliberately broad and says
// nothing about the season in progress. What it does claim, it has to be able to
// back up, which is what most of these tests are about: the league races Friday
// evenings today and may not always, so the day is read off the calendar and
// dropped entirely whenever the calendar does not clearly support one.
import { describe, it, expect } from "vitest";
import {
  seasonDescription,
  raceNight,
  themeColorOf,
  applyThemeColor,
  pageThemeColor,
  DEFAULT_THEME_COLOR,
} from "./pageMeta.js";
import { disciplineOf } from "./seo.js";

// Real Fridays and Sundays in league time, stored the way the app stores them.
const FRIDAYS = ["2026-05-01", "2026-05-08", "2026-05-15", "2026-05-22", "2026-05-29"];
const SUNDAYS = ["2026-05-03", "2026-05-10", "2026-05-17", "2026-05-24"];
const SATURDAYS = ["2026-05-02", "2026-05-09", "2026-05-16", "2026-05-23"];
// 17:00 UTC is 19:00 in Berlin in May, the league's usual start.
const at = (days, time = "T17:00:00.000Z") => days.map((d) => ({ date: `${d}${time}` }));

describe("raceNight", () => {
  it("names the night the calendar settles on", () => {
    expect(raceNight(at(FRIDAYS))).toBe("Friday night");
    expect(raceNight(at(SUNDAYS))).toBe("Sunday night");
  });

  it("follows a move to another day without anything being edited", () => {
    expect(raceNight(at(SATURDAYS))).toBe("Saturday night");
  });

  it("names no day when the calendar is split between two", () => {
    expect(raceNight([...at(FRIDAYS.slice(0, 3)), ...at(SATURDAYS.slice(0, 3))])).toBe(null);
  });

  it("still names the day when a single round falls outside the pattern", () => {
    expect(raceNight([...at(FRIDAYS), ...at(SATURDAYS.slice(0, 1))])).toBe("Friday night");
  });

  it("leaves out 'night' for an afternoon series", () => {
    expect(raceNight(at(SUNDAYS, "T13:00:00.000Z"))).toBe("Sunday");
  });

  it("treats a date with no time as the league's usual 19:00", () => {
    // The archive holds date-only rows; raceKickoff supplies the evening.
    expect(raceNight(at(FRIDAYS, "T00:00:00.000Z"))).toBe("Friday night");
  });

  it("names nothing when no race carries a date", () => {
    expect(raceNight([{ date: null }, { date: null }])).toBe(null);
    expect(raceNight([])).toBe(null);
  });
});

describe("seasonDescription", () => {
  it("leads with the discipline and the game", () => {
    const text = seasonDescription({ discipline: "Formula 1", night: "Friday night" });
    expect(text.startsWith("Formula 1 sim racing league on Assetto Corsa.")).toBe(true);
    expect(text).toContain("Online F1 championship");
    expect(text).toContain("Friday night races");
    expect(text).toContain("standings");
    expect(text).toContain("sign-ups");
    expect(text.length).toBeLessThanOrEqual(160);
  });

  it("reads correctly with no race night at all", () => {
    const text = seasonDescription({ discipline: "Formula 1", night: null });
    expect(text).not.toContain("races,");
    expect(text).toContain("Online F1 championship with driver and team standings");
    expect(text.length).toBeLessThanOrEqual(160);
  });

  it("takes whatever night it is given, including a daytime one", () => {
    expect(seasonDescription({ discipline: "Formula 1", night: "Sunday" })).toContain("Sunday races,");
  });

  it("claims no Formula 1 for a series that is not", () => {
    const text = seasonDescription({ discipline: null, night: "Sunday night" });
    expect(text).toContain("Online sim racing league on Assetto Corsa.");
    expect(text).not.toContain("F1");
    expect(text).not.toContain("Formula");
    expect(text.length).toBeLessThanOrEqual(160);
  });

  it("names the Sunday F3 league as F3, not F1", () => {
    const text = seasonDescription({ discipline: "Formula 3", night: "Sunday night" });
    expect(text.startsWith("Formula 3 sim racing league on Assetto Corsa.")).toBe(true);
    expect(text).toContain("F3 championship");
    expect(text).not.toContain("F1");
  });

  it("says nothing that would date the snippet", () => {
    const text = seasonDescription({ discipline: "Formula 1", night: "Friday night" });
    for (const dated of ["Season", "Round", "leads", "won", "points"]) {
      expect(text).not.toContain(dated);
    }
  });

  it("never ends mid-sentence, whatever it had to drop", () => {
    for (const night of ["Friday night", "Wednesday", null]) {
      for (const discipline of ["Formula 1", null]) {
        const text = seasonDescription({ discipline, night });
        expect(text.length).toBeLessThanOrEqual(160);
        expect(text.endsWith(".")).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The theme colour: what the phone's status bar is painted in. The installed
// app takes it from the document it loaded, so the server has to put the
// series' colour into the HTML rather than leave it to the page's JavaScript.
// ---------------------------------------------------------------------------
describe("theme colour (the phone's status bar)", () => {
  const HTML = '<html><head><meta name="theme-color" content="#F4AFC6" /></head><body></body></html>';

  it("a series with an accent colour paints the bar in it", () => {
    expect(themeColorOf({ accentColor: "#00CCFF" })).toBe("#00ccff");
  });

  it("no accent, a blank one or a broken one falls back to the default pink", () => {
    expect(themeColorOf(null)).toBe(DEFAULT_THEME_COLOR);
    expect(themeColorOf({ accentColor: "" })).toBe(DEFAULT_THEME_COLOR);
    expect(themeColorOf({ accentColor: "blue" })).toBe(DEFAULT_THEME_COLOR);
  });

  it("rewrites the shipped tag, or adds one to a page without it", () => {
    const out = applyThemeColor(HTML, "#00ccff");
    expect(out).toContain('<meta name="theme-color" content="#00ccff" />');
    expect(out).not.toContain("#F4AFC6");
    const bare = "<html><head><title>x</title></head><body></body></html>";
    expect(applyThemeColor(bare, "#00ccff")).toMatch(/<meta name="theme-color" content="#00ccff" \/>\s*<\/head>/);
  });

  it("leaves the page alone for a colour that is not one", () => {
    expect(applyThemeColor(HTML, null)).toBe(HTML);
    expect(applyThemeColor(HTML, "cyan")).toBe(HTML);
  });

  it("answers the series the address belongs to", async () => {
    const rows = [
      { id: "a", name: "F1 Friday", slug: "friday-f1", order: 0, isActive: 1, isPublic: 1, accentColor: null },
      // Unpublished on purpose: the colour is not a secret, and the admin
      // previewing the series in the app should see its bar.
      { id: "b", name: "Sunday Championship", slug: "sunday-championship", order: 1, isActive: 0, isPublic: 0, accentColor: "#00ccff" },
    ];
    const prisma = { $queryRawUnsafe: async () => rows };
    expect(await pageThemeColor(prisma, "/")).toBe(DEFAULT_THEME_COLOR); // the primary series, no accent
    expect(await pageThemeColor(prisma, "/join")).toBe(DEFAULT_THEME_COLOR);
    expect(await pageThemeColor(prisma, "/s/sunday-championship")).toBe("#00ccff");
    expect(await pageThemeColor(prisma, "/s/sunday-championship/drivers/abc")).toBe("#00ccff");
    expect(await pageThemeColor(prisma, "/s/nope/drivers")).toBe(DEFAULT_THEME_COLOR);
    expect(await pageThemeColor(prisma, "/downloads")).toBe(DEFAULT_THEME_COLOR);
  });

  it("a failing database answers the default rather than failing the page", async () => {
    const prisma = {
      $queryRawUnsafe: async () => {
        throw new Error("down");
      },
    };
    expect(await pageThemeColor(prisma, "/s/sunday-championship")).toBe(DEFAULT_THEME_COLOR);
  });
});

describe("disciplineOf", () => {
  it("reads the formula class off the game", () => {
    expect(disciplineOf("F1 2010 · Assetto Corsa")).toBe("Formula 1");
    expect(disciplineOf("Formula 3 / Assetto Corsa")).toBe("Formula 3");
    expect(disciplineOf("F2 2024")).toBe("Formula 2");
  });
  it("sells nothing else as a formula", () => {
    expect(disciplineOf("GT3 · Assetto Corsa")).toBe(null);
    expect(disciplineOf("LMP2")).toBe(null);
    expect(disciplineOf("IndyCar")).toBe(null);
  });
  it("only falls back to the series name when the game is empty", () => {
    expect(disciplineOf("", "F1 Friday")).toBe("Formula 1");
    expect(disciplineOf("Formula 3 / Assetto Corsa", "F1 Friday")).toBe("Formula 3");
  });
});
