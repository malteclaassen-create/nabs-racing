import { describe, it, expect } from "vitest";
import {
  createPitFilter,
  speedKmhOf,
  PIT_CONFIRM_MS,
  PIT_RELEASE_MS,
  PIT_MAX_SPEED_KMH,
} from "./pitFlag.js";

// A clock the test drives, so nothing here waits on a real timer.
const at = (t) => 1_000_000 + t;

describe("speedKmhOf", () => {
  it("converts an ET53 velocity vector to km/h", () => {
    // 10 m/s straight down the X axis is 36 km/h.
    expect(speedKmhOf({ Velocity: { X: 10, Y: 0, Z: 0 } })).toBeCloseTo(36, 6);
    // The magnitude, not one component: 3-4-5 in the ground plane.
    expect(speedKmhOf({ Velocity: { X: 30, Y: 0, Z: 40 } })).toBeCloseTo(180, 6);
  });

  it("says nothing rather than zero when there is no velocity", () => {
    // A garaged car sends no vector, and "no reading" must not be read as
    // "stationary" — that would confirm a pit stop instead of leaving it open.
    expect(speedKmhOf({})).toBe(null);
    expect(speedKmhOf(null)).toBe(null);
  });
});

describe("the pit filter", () => {
  it("takes the first sight of a car at face value", () => {
    // Somebody opening the page mid-session sees who is in the pits now, not
    // after a delay that only exists to filter flicker.
    const f = createPitFilter();
    expect(f.read("a", true, 0, at(0))).toBe(true);
    expect(createPitFilter().read("b", false, 200, at(0))).toBe(false);
  });

  it("ignores the flag entirely on a car at racing speed", () => {
    // The bug this was written for: IsInPits going true through the last
    // corners at Most, at 250 km/h.
    const f = createPitFilter();
    f.read("a", false, 250, at(0));
    for (let t = 100; t <= 20000; t += 100) {
      expect(f.read("a", true, 250, at(t))).toBe(false);
    }
  });

  it("waits for the flag to hold before saying somebody pitted", () => {
    const f = createPitFilter();
    f.read("a", false, 200, at(0));
    // Slowing down and the flag comes on at t=500: believable, but the wait
    // runs from the transition, not from when the car was first seen.
    expect(f.read("a", true, 60, at(500))).toBe(false);
    expect(f.read("a", true, 40, at(500 + PIT_CONFIRM_MS - 1))).toBe(false);
    expect(f.read("a", true, 0, at(500 + PIT_CONFIRM_MS))).toBe(true);
  });

  it("drops a flicker that ends before the wait is up", () => {
    const f = createPitFilter();
    f.read("a", false, 200, at(0));
    f.read("a", true, 90, at(500)); // a flicker at pit-lane-ish speed
    f.read("a", true, 95, at(1200));
    expect(f.read("a", false, 120, at(1600))).toBe(false);
    // ...and the timer starts again from scratch, so a later flicker of the
    // same length is not allowed to add up to a confirmation.
    f.read("a", true, 90, at(2000));
    expect(f.read("a", true, 90, at(3000))).toBe(false);
  });

  it("releases quickly once the car is out again", () => {
    const f = createPitFilter();
    f.read("a", false, 200, at(0));
    f.read("a", true, 0, at(100));
    const inAt = 100 + PIT_CONFIRM_MS;
    expect(f.read("a", true, 0, at(inAt))).toBe(true);
    // Out again at pit-lane speed, so only the timer can release it, and it
    // runs from the frame the flag dropped on.
    const outAt = inAt + 10;
    expect(f.read("a", false, 30, at(outAt))).toBe(true);
    expect(f.read("a", false, 30, at(outAt + PIT_RELEASE_MS - 1))).toBe(true);
    expect(f.read("a", false, 30, at(outAt + PIT_RELEASE_MS))).toBe(false);
  });

  it("lets speed release a car immediately, without waiting out the timer", () => {
    // Speed is proof, not a hint: a car reading 200 km/h is on the circuit.
    const f = createPitFilter();
    f.read("a", true, 0, at(0)); // starts in the pits
    expect(f.peek("a")).toBe(true);
    f.read("a", true, PIT_MAX_SPEED_KMH + 1, at(100));
    expect(f.read("a", true, 220, at(100 + PIT_RELEASE_MS))).toBe(false);
  });

  it("keeps a real stop through the whole visit", () => {
    const f = createPitFilter();
    f.read("a", false, 200, at(0));
    for (let t = 1000; t <= 60000; t += 250) {
      f.read("a", true, t < 4000 ? 60 : 0, at(t));
    }
    expect(f.peek("a")).toBe(true);
    // And back out, at pit-lane speed, so only the timer can release it.
    f.read("a", false, 70, at(61000));
    expect(f.read("a", false, 70, at(61000 + PIT_RELEASE_MS))).toBe(false);
  });

  it("keeps cars apart and forgets them all on a new session", () => {
    const f = createPitFilter();
    f.read("a", true, 0, at(0));
    f.read("b", false, 200, at(0));
    expect(f.peek("a")).toBe(true);
    expect(f.peek("b")).toBe(false);
    f.clear();
    // Cleared means unknown, not "in the pits".
    expect(f.peek("a")).toBe(false);
  });

  it("treats a missing speed reading as no evidence either way", () => {
    // No velocity in the frame: the timer alone decides, which is the old
    // behaviour and the safe one.
    const f = createPitFilter();
    f.read("a", false, null, at(0));
    f.read("a", true, null, at(100));
    expect(f.read("a", true, null, at(100 + PIT_CONFIRM_MS - 1))).toBe(false);
    expect(f.read("a", true, null, at(100 + PIT_CONFIRM_MS))).toBe(true);
  });
});
