import { describe, it, expect } from "vitest";
import { buildRaceCalendar, icsEscape, foldLine, icsStamp } from "./ics.js";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const OPTS = { origin: "https://nabsracing.com", now: NOW, linkFor: (r) => `/races?race=${r.id}` };

const race = (over = {}) => ({
  id: "r1",
  number: 5,
  track: "Silverstone",
  date: "2026-09-04T17:00:00.000Z",
  isCompleted: false,
  type: "CHAMPIONSHIP",
  qualiMinutes: null,
  raceLaps: null,
  info: null,
  ...over,
});

// Split a folded feed back into logical lines, which is what a calendar parser
// does: unfold first, then read. Tests assert on the logical content.
const unfold = (s) => s.replace(/\r\n /g, "").split("\r\n");

describe("icsEscape", () => {
  it("escapes the structural characters", () => {
    expect(icsEscape("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
  });
  it("turns a newline into its escape, not a raw break", () => {
    expect(icsEscape("one\ntwo")).toBe("one\\ntwo");
    expect(icsEscape("one\r\ntwo")).toBe("one\\ntwo");
  });
  it("survives null and undefined", () => {
    expect(icsEscape(null)).toBe("");
    expect(icsEscape(undefined)).toBe("");
  });
});

describe("foldLine", () => {
  it("leaves a short line alone", () => {
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds at 75 octets with a leading space on each continuation", () => {
    const long = "SUMMARY:" + "x".repeat(200);
    const folded = foldLine(long);
    for (const line of folded.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    for (const line of folded.split("\r\n").slice(1)) expect(line.startsWith(" ")).toBe(true);
    // Unfolding must give back exactly what went in.
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });

  it("counts octets, not characters, and never splits one", () => {
    // Each "ä" is two octets in UTF-8, so a 60-character line is 120 octets and
    // has to fold even though its length is under the limit.
    const long = "LOCATION:" + "ä".repeat(60);
    const folded = foldLine(long);
    expect(folded).toContain("\r\n ");
    for (const line of folded.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    // A split inside a multi-byte character shows up as a replacement char.
    expect(folded).not.toContain("�");
  });
});

describe("icsStamp", () => {
  it("writes a UTC basic-format timestamp", () => {
    expect(icsStamp("2026-09-04T17:00:00.000Z")).toBe("20260904T170000Z");
  });
  it("returns null for a date it cannot read", () => {
    expect(icsStamp("not a date")).toBe(null);
  });
});

describe("buildRaceCalendar", () => {
  it("wraps the events in one VCALENDAR and ends with CRLF", () => {
    const out = buildRaceCalendar([race()], OPTS);
    expect(out.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(out.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const lines = unfold(out);
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines.filter((l) => l === "END:VEVENT")).toHaveLength(1);
  });

  it("uses the race id for the UID, so a moved round edits instead of duplicating", () => {
    const before = unfold(buildRaceCalendar([race()], OPTS)).find((l) => l.startsWith("UID:"));
    const after = unfold(
      buildRaceCalendar([race({ date: "2026-09-11T17:00:00.000Z", track: "Monza" })], OPTS)
    ).find((l) => l.startsWith("UID:"));
    expect(before).toBe("UID:race-r1@nabsracing.com");
    expect(after).toBe(before);
  });

  it("blocks out two hours from the kickoff", () => {
    const lines = unfold(buildRaceCalendar([race()], OPTS));
    expect(lines).toContain("DTSTART:20260904T170000Z");
    expect(lines).toContain("DTEND:20260904T190000Z");
  });

  it("falls back to the league's 19:00 for a date-only round", () => {
    // Stored as UTC midnight = no time entered. September is CEST (UTC+2), so
    // the league's 19:00 is 17:00Z.
    const lines = unfold(buildRaceCalendar([race({ date: "2026-09-04T00:00:00.000Z" })], OPTS));
    expect(lines).toContain("DTSTART:20260904T170000Z");
  });

  it("skips a round that has no date at all", () => {
    const out = buildRaceCalendar([race({ date: null }), race({ id: "r2" })], OPTS);
    expect(unfold(out).filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(out).toContain("UID:race-r2@nabsracing.com");
  });

  it("names the session type in the summary", () => {
    const sum = (over) =>
      unfold(buildRaceCalendar([race(over)], OPTS)).find((l) => l.startsWith("SUMMARY:"));
    expect(sum({})).toBe("SUMMARY:NABS Round 5: Silverstone");
    expect(sum({ type: "TRAINING", number: null })).toBe("SUMMARY:NABS Training: Silverstone");
    expect(sum({ type: "SPECIAL", number: null })).toBe("SUMMARY:NABS Special: Silverstone");
  });

  it("tidies a shouted archive track name", () => {
    const lines = unfold(buildRaceCalendar([race({ track: "KYALAMI" })], OPTS));
    expect(lines).toContain("LOCATION:Kyalami");
  });

  it("puts the session format and a link in the description", () => {
    const desc = unfold(
      buildRaceCalendar([race({ qualiMinutes: 15, raceLaps: 28 })], OPTS)
    ).find((l) => l.startsWith("DESCRIPTION:"));
    expect(desc).toContain("Qualifying 15 min\\, Race 28 laps");
    expect(desc).toContain("https://nabsracing.com/races?race=r1");
  });

  it("alarms only on rounds still ahead", () => {
    const upcoming = unfold(buildRaceCalendar([race()], OPTS));
    expect(upcoming).toContain("TRIGGER:-PT60M");
    const done = unfold(buildRaceCalendar([race({ isCompleted: true })], OPTS));
    expect(done).not.toContain("TRIGGER:-PT60M");
    expect(done).toContain("TRANSP:TRANSPARENT");
  });

  it("carries the subscription hints a calendar app reads", () => {
    const lines = unfold(buildRaceCalendar([race()], { ...OPTS, calName: "NABS · F1 Friday" }));
    expect(lines).toContain("X-WR-CALNAME:NABS · F1 Friday");
    expect(lines).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT12H");
    expect(lines).toContain("X-PUBLISHED-TTL:PT12H");
  });

  it("is still a valid empty calendar when the season has no dated races", () => {
    const out = buildRaceCalendar([], OPTS);
    expect(unfold(out)).not.toContain("BEGIN:VEVENT");
    expect(out.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(out.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("escapes a comma in the admin's race info instead of ending the value", () => {
    const out = buildRaceCalendar([race({ info: "Mandatory pit stop, mediums only" })], OPTS);
    expect(out).toContain("Mandatory pit stop\\, mediums only");
  });
});
