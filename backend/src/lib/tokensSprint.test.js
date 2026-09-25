import { describe, it, expect } from "vitest";
import { oneFinishPerWeekend } from "./tokens.js";

// F3 runs a sprint and a main race on one evening. That is one round's pay.
describe("a sprint weekend pays one finish", () => {
  const sprint = { raceId: "s1", parentRaceId: "f1", driverId: "d", date: 1 };
  const feature = { raceId: "f1", parentRaceId: null, driverId: "d", date: 1 };

  it("pays the main race when both were finished", () => {
    const out = oneFinishPerWeekend([sprint, feature]);
    expect(out).toHaveLength(1);
    expect(out[0].parentRaceId).toBe(null);
    expect(out[0].raceId).toBe("f1");
  });

  it("pays the sprint, filed under the main race, when that is the only finish", () => {
    const out = oneFinishPerWeekend([sprint]);
    expect(out).toHaveLength(1);
    expect(out[0].raceId).toBe("f1");
  });

  it("leaves ordinary rounds alone", () => {
    const a = { raceId: "a", parentRaceId: null };
    const b = { raceId: "b", parentRaceId: null };
    expect(oneFinishPerWeekend([a, b]).map((r) => r.raceId)).toEqual(["a", "b"]);
  });
});
