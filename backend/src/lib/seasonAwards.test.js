import { describe, it, expect } from "vitest";
import { sanitizeAwardInput, orderIds, shapeAward, isAwardId, AWARD_LIMITS } from "./seasonAwards.js";

describe("sanitizeAwardInput", () => {
  it("takes a driver award", () => {
    const r = sanitizeAwardInput({ title: "  Best   Rookie ", kind: "driver", winnerId: "drv_1", note: "Three podiums" });
    expect(r.value).toEqual({
      title: "Best Rookie", note: "Three podiums", driverId: "drv_1", teamId: null, raceId: null, winnerText: null,
    });
  });

  it("takes a team, a race and a typed name", () => {
    expect(sanitizeAwardInput({ title: "Best T2 team", kind: "team", winnerId: "t1" }).value.teamId).toBe("t1");
    expect(sanitizeAwardInput({ title: "Race of the season", kind: "race", winnerId: "r9" }).value.raceId).toBe("r9");
    expect(sanitizeAwardInput({ title: "Best Rookie", kind: "text", winnerText: "Max and Tom" }).value.winnerText).toBe(
      "Max and Tom"
    );
  });

  it("refuses an award without a name or a winner", () => {
    expect(sanitizeAwardInput({ kind: "driver", winnerId: "x" }).error).toBeTruthy();
    expect(sanitizeAwardInput({ title: "Best Rookie", kind: "driver" }).error).toBeTruthy();
    expect(sanitizeAwardInput({ title: "Best Rookie", kind: "text", winnerText: "  " }).error).toBeTruthy();
    expect(sanitizeAwardInput({ title: "Best Rookie", kind: "nobody" }).error).toBeTruthy();
    expect(sanitizeAwardInput({ title: "Best Rookie", kind: "driver", winnerId: "a b" }).error).toBeTruthy();
    expect(sanitizeAwardInput(null).error).toBeTruthy();
  });

  it("cuts long text and strips control characters", () => {
    const r = sanitizeAwardInput({ title: "x".repeat(200), kind: "text", winnerText: "A\u0000B", note: "" });
    expect(r.value.title).toHaveLength(AWARD_LIMITS.title);
    expect(r.value.winnerText).toBe("A B");
    expect(r.value.note).toBe(null);
  });
});

describe("orderIds", () => {
  it("puts the wanted ids first and keeps the rest", () => {
    expect(orderIds(["a", "b", "c", "d"], ["c", "a"])).toEqual(["c", "a", "b", "d"]);
  });
  it("ignores unknown and repeated ids", () => {
    expect(orderIds(["a", "b"], ["x", "b", "b"])).toEqual(["b", "a"]);
    expect(orderIds(["a", "b"], "nonsense")).toEqual(["a", "b"]);
  });
});

describe("shapeAward", () => {
  const row = { id: "aw1", title: "Best Rookie", note: null, driverId: "d1", teamId: null, raceId: null, winnerText: null };

  it("hands out the driver", () => {
    const a = shapeAward(row, { driver: { id: "d1", name: "Max", photoUrl: null, discordAvatar: "av", country: "DE", tier: 1, team: null } });
    expect(a.kind).toBe("driver");
    expect(a.driver).toMatchObject({ driverId: "d1", name: "Max", photoUrl: "av", tier: 1 });
  });

  it("falls back to the typed name, or drops the award, when the winner is gone", () => {
    expect(shapeAward({ ...row, winnerText: "Max" }, {})).toMatchObject({ kind: "text", winnerText: "Max" });
    expect(shapeAward(row, {})).toBe(null);
  });
});

describe("isAwardId", () => {
  it("takes uuids and refuses odd input", () => {
    expect(isAwardId("2f1c8f9e-1a2b-4c3d-9e8f-001122334455")).toBe(true);
    expect(isAwardId("../x")).toBe(false);
    expect(isAwardId("")).toBe(false);
  });
});
