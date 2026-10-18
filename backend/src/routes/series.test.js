import { describe, it, expect } from "vitest";
import { eventDateOf, eventRaceOf } from "./series.js";
import { parseKind, parsePromoTagline, PROMO_TAGLINE_MAX, parsePromoCaptions } from "../lib/series.js";

const NOW = Date.parse("2026-10-17T12:00:00Z");

describe("eventDateOf", () => {
  it("is null while no race has a date", () => {
    expect(eventDateOf([], NOW)).toBe(null);
    expect(eventDateOf([{ date: null, isCompleted: false }], NOW)).toBe(null);
  });

  it("picks the first race still to come", () => {
    const races = [
      { date: "2026-11-13T17:30:00Z", isCompleted: false },
      { date: "2026-11-06T17:30:00Z", isCompleted: false },
      { date: "2026-10-01T17:30:00Z", isCompleted: true },
    ];
    expect(eventDateOf(races, NOW)).toBe("2026-11-06T17:30:00.000Z");
  });

  it("keeps tonight's race until it is marked done or a day has gone", () => {
    const races = [{ date: "2026-10-17T08:00:00Z", isCompleted: false }];
    expect(eventDateOf(races, NOW)).toBe("2026-10-17T08:00:00.000Z");
  });

  it("falls back to the last race once it is all over", () => {
    const races = [
      { date: "2026-09-01T17:30:00Z", isCompleted: true },
      { date: "2026-10-01T17:30:00Z", isCompleted: true },
    ];
    expect(eventDateOf(races, NOW)).toBe("2026-10-01T17:30:00.000Z");
  });
});

describe("parseKind", () => {
  it("stores a championship as null and an event as 'event'", () => {
    expect(parseKind("championship")).toEqual({ ok: true, value: null });
    expect(parseKind("Event")).toEqual({ ok: true, value: "event" });
    expect(parseKind("")).toEqual({ ok: true, value: null });
    expect(parseKind(undefined)).toEqual({ ok: true, skip: true });
  });

  it("rejects anything else", () => {
    expect(parseKind("cup").ok).toBe(false);
  });
});

describe("parsePromoTagline", () => {
  it("keeps one tidy line, blank meaning none", () => {
    expect(parsePromoTagline("  Ready for some\n  Oval Action? ")).toEqual({ ok: true, value: "Ready for some Oval Action?" });
    expect(parsePromoTagline("   ")).toEqual({ ok: true, value: null });
    expect(parsePromoTagline(null)).toEqual({ ok: true, value: null });
  });

  it("rejects a headline longer than the card can carry", () => {
    expect(parsePromoTagline("x".repeat(PROMO_TAGLINE_MAX)).ok).toBe(true);
    expect(parsePromoTagline("x".repeat(PROMO_TAGLINE_MAX + 1)).ok).toBe(false);
  });
});

describe("parsePromoCaptions", () => {
  // The shape the Talladega film came with.
  const file = {
    about: "Captions of the Talladega promo film",
    intro: {
      lines: [
        { text: "NABS RACING LEAGUE", size: 0.0315, letterSpacing: 0.35 },
        { text: "PRESENTS", size: 0.0185, letterSpacing: 0.45 },
      ],
      font: "Archivo",
      weight: 600,
      color: "#FFFFFF",
      start: 2.6,
      fadeIn: 0.9,
      end: 8.04,
      fadeOut: 0.5,
    },
    captions: [
      { text: "Special event", start: 10.27, end: 12, size: 0.0315, weight: 900, font: "Montserrat", color: "#FFD800", line: "above" },
      { text: "Talladega", start: 10.42, end: 12, size: 0.085, weight: 900, font: "Montserrat", color: "#FFFFFF", line: "main" },
    ],
  };

  it("keeps what the page draws, from an object or the JSON text", () => {
    for (const input of [file, JSON.stringify(file)]) {
      const { ok, value } = parsePromoCaptions(input);
      expect(ok).toBe(true);
      expect(value.intro.lines.map((l) => l.text)).toEqual(["NABS RACING LEAGUE", "PRESENTS"]);
      expect(value.intro.font).toBe("Archivo");
      expect(value.captions).toHaveLength(2);
      expect(value.captions[0]).toEqual({
        text: "Special event", start: 10.27, end: 12, size: 0.0315, weight: 900, font: "Montserrat", color: "#FFD800", line: "above",
      });
      expect(value).not.toHaveProperty("about");
    }
  });

  it("drops what it cannot use and bounds the rest", () => {
    const { value } = parsePromoCaptions({
      captions: [
        { text: "ok", start: 1, end: 2, size: 9, font: "Comic Sans", color: "red", weight: 1234 },
        { text: "", start: 1, end: 2 },
        { text: "backwards", start: 5, end: 4 },
      ],
    });
    expect(value.captions).toEqual([
      { text: "ok", start: 1, end: 2, size: 0.085, weight: 900, font: "Montserrat", color: "#FFFFFF", line: "main" },
    ]);
  });

  it("says why a file is refused, and clears on empty", () => {
    expect(parsePromoCaptions("not json").ok).toBe(false);
    expect(parsePromoCaptions({ captions: [] }).ok).toBe(false);
    expect(parsePromoCaptions(null)).toEqual({ ok: true, value: null });
    expect(parsePromoCaptions("")).toEqual({ ok: true, value: null });
  });
});

describe("eventRaceOf", () => {
  it("returns the race itself, so the promo page can show its laps and grid", () => {
    const next = { id: "b", date: "2026-11-06T17:30:00Z", isCompleted: false };
    const races = [{ id: "a", date: "2026-10-01T17:30:00Z", isCompleted: true }, next];
    expect(eventRaceOf(races, NOW)).toBe(next);
    expect(eventRaceOf([], NOW)).toBe(null);
  });
});
