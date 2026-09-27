import { describe, it, expect } from "vitest";
import { compareWithRoom, setBriefingRoom, getBriefingRoom, inBriefingWindow } from "./briefingRoom.js";

const d = (name, discordUserId) => ({ driverId: name, name, discordUserId });

describe("compareWithRoom", () => {
  it("splits the grid into there, missing and can't check", () => {
    const grid = [d("anna", "111111"), d("ben", "222222"), d("carl", null)];
    const room = [{ discordId: "111111", name: "Anna" }, { discordId: "999999", name: "Steward" }];
    const out = compareWithRoom(grid, room);
    expect(out.present.map((x) => x.name)).toEqual(["anna"]);
    expect(out.missing.map((x) => x.name)).toEqual(["ben"]);
    expect(out.unlinked.map((x) => x.name)).toEqual(["carl"]);
    expect(out.extras).toEqual([{ discordId: "999999", name: "Steward" }]);
  });

  it("an empty room has everyone with an id missing", () => {
    const out = compareWithRoom([d("anna", "111111")], []);
    expect(out.missing).toHaveLength(1);
    expect(out.extras).toEqual([]);
  });
});

describe("setBriefingRoom", () => {
  it("keeps only members with a real id", () => {
    setBriefingRoom(
      { channelId: "5", channelName: "Briefing", members: [{ discordId: "123456789", name: "A" }, { discordId: "x" }, null] },
      1000
    );
    expect(getBriefingRoom()).toEqual({
      watching: true,
      channelId: "5",
      channelName: "Briefing",
      members: [{ discordId: "123456789", name: "A" }],
      at: 1000,
    });
  });
});

describe("inBriefingWindow", () => {
  const start = "2026-10-02T17:30:00.000Z";
  const at = (min) => Date.parse(start) + min * 60_000;
  it("opens 5 min before the start and closes an hour after", () => {
    expect(inBriefingWindow([start], at(-6))).toBe(false);
    expect(inBriefingWindow([start], at(-5))).toBe(true);
    expect(inBriefingWindow([start], at(60))).toBe(true);
    expect(inBriefingWindow([start], at(61))).toBe(false);
  });
  it("any of the races will do, junk is ignored", () => {
    expect(inBriefingWindow([null, "nope", start], at(0))).toBe(true);
    expect(inBriefingWindow([], at(0))).toBe(false);
  });
});
