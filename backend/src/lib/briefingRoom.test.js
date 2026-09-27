import { describe, it, expect } from "vitest";
import { compareWithRoom, setBriefingRoom, getBriefingRoom } from "./briefingRoom.js";

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
      channelId: "5",
      channelName: "Briefing",
      members: [{ discordId: "123456789", name: "A" }],
      at: 1000,
    });
  });
});
