import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { parseAcResult } from "../src/lib/acResult.js";

const race = JSON.parse(fs.readFileSync(new URL("./fixtures/race.json", import.meta.url), "utf8"));

describe("parseAcResult", () => {
  it("reads the finishing order, laps, times and teams", () => {
    const { type, track, rows } = parseAcResult(race);
    expect(type).toBe("RACE");
    expect(track).toBe("spa");
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ position: 1, name: "Alex Storm", guid: "76561190000000001", team: "Thunder Racing", laps: 20, status: "FIN", bestLapMs: 118076 });
    expect(rows[6]).toMatchObject({ name: "Ben Fog", laps: 14, status: "DNF" });
    expect(rows[7]).toMatchObject({ name: "Nora Sleet", laps: 0, status: "DNS", bestLapMs: null });
  });

  it("classifies against the share of the winner's laps", () => {
    const { rows } = parseAcResult(race, { classifiedLapShare: 0.7 });
    expect(rows[6].status).toBe("FIN");
  });

  it("drops duplicate rows and empty entry-list slots", () => {
    const copy = structuredClone(race);
    copy.Result.push({ ...copy.Result[2] });
    copy.Result.push({ DriverName: "", DriverGuid: "", CarId: 9 });
    expect(parseAcResult(copy).rows).toHaveLength(8);
  });

  it("puts disqualified drivers behind the classified ones", () => {
    const copy = structuredClone(race);
    copy.Result[0].Disqualified = true;
    const { rows } = parseAcResult(copy);
    expect(rows[0].name).toBe("Mia Drizzle");
    expect(rows.find((r) => r.name === "Alex Storm")).toMatchObject({ status: "DSQ", position: 7 });
  });

  it("refuses something that is not a result file", () => {
    expect(() => parseAcResult({ hello: 1 })).toThrow(/not an Assetto Corsa result/);
  });
});
