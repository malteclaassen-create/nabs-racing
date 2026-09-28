import { describe, it, expect, beforeEach, vi } from "vitest";

const calls = [];
vi.mock("../lib/prisma.js", () => ({
  default: {
    $executeRawUnsafe: vi.fn(async (sql, ...args) => {
      calls.push({ sql, args });
      return 1;
    }),
    $queryRawUnsafe: vi.fn(async () => []),
    setting: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
  },
}));

const inc = await import("./liveIncidents.js");
const { onSession, onTelemetry, onCollision, stoppedNow, __testing } = inc;

const S = "t";
const inserts = () => calls.filter((c) => c.sql.includes("INSERT"));
const typeOf = (c) => c.args[5];

function session() {
  onSession(S, {
    sessionKey: "monza|0|Race",
    sessionType: 3,
    startedAt: 1_000_000,
    drivers: { a: { CarInfo: { DriverName: "Alice" } }, b: { CarInfo: { DriverName: "Bob" } } },
  });
}

// One car driving along x, `kmh` fast, at time t.
function tick(t, kmh, { x = 0, inPits = false, guid = "a" } = {}) {
  onTelemetry(S, { guid, carId: 0, kmh, pos: { X: x, Z: 0 }, spline: 0.5, inPits, now: t });
}

beforeEach(() => {
  calls.length = 0;
  __testing.states.clear();
  __testing.resetMinKmhCache();
  session();
});

describe("stopped cars", () => {
  it("a car on the grid that never moved is not reported", () => {
    for (let t = 0; t < 10_000; t += 500) tick(t, 0);
    expect(inserts()).toHaveLength(0);
    expect(stoppedNow(S)).toHaveLength(0);
  });

  it("stopping for 3 s after being quick is one incident, and moving again closes it", () => {
    tick(0, 120);
    for (let t = 500; t <= 3000; t += 500) tick(t, 2);
    expect(inserts()).toHaveLength(0); // 2.5 s so far
    tick(3500, 1);
    expect(inserts()).toHaveLength(1);
    expect(typeOf(inserts()[0])).toBe("stopped");
    expect(stoppedNow(S).map((s) => s.guid)).toEqual(["a"]);
    for (let t = 4000; t < 8000; t += 500) tick(t, 3);
    expect(inserts()).toHaveLength(1); // still the same stop
    for (let t = 8000; t <= 11_500; t += 500) tick(t, 60);
    expect(stoppedNow(S)).toHaveLength(0);
    expect(calls.some((c) => c.sql.includes(`"endedAt"`))).toBe(true);
  });

  it("the pit lane never counts", () => {
    tick(0, 120);
    for (let t = 500; t <= 6000; t += 500) tick(t, 0, { inPits: true });
    expect(inserts()).toHaveLength(0);
  });

  it("a teleport resets the watch", () => {
    tick(0, 120);
    tick(500, 2);
    tick(1000, 2);
    tick(1500, 2, { x: 500 }); // back to the pits, say
    tick(3600, 2, { x: 500 });
    expect(inserts()).toHaveLength(0);
  });
});

describe("collisions", () => {
  it("drops contacts under the threshold", async () => {
    await onCollision(S, { ID: "1", Type: "with other car", Speed: 9, DriverGUID: "a", OtherDriverGUID: "b" }, { now: 2_000_000 });
    expect(inserts()).toHaveLength(0);
  });

  it("records a car contact with both names, speed and position", async () => {
    await onCollision(
      S,
      { ID: "1", Type: "with other car", Speed: 42.37, DriverGUID: "a", OtherDriverGUID: "b", OtherDriverName: "Bob", WorldPos: { X: 10.04, Y: 1, Z: -5.64 } },
      { now: 2_000_000 }
    );
    const [row] = inserts();
    expect(typeOf(row)).toBe("car");
    const a = row.args;
    expect(a[7]).toBe("Alice");
    expect(a[10]).toBe("Bob");
    expect(a[13]).toBe(1_000_000); // race ms since the start
    expect([a[14], a[15]]).toEqual([10, -5.6]);
    expect(a[17]).toBe(42.4);
  });

  it("the same contact reported by both cars is one incident", async () => {
    await onCollision(S, { ID: "1", Type: "with other car", Speed: 30, DriverGUID: "a", OtherDriverGUID: "b" }, { now: 2_000_000 });
    await onCollision(S, { ID: "2", Type: "with other car", Speed: 35, DriverGUID: "b", OtherDriverGUID: "a" }, { now: 2_000_300 });
    expect(inserts()).toHaveLength(1);
    expect(calls.some((c) => c.sql.includes(`SET "speedKmh"`) && c.args[0] === 35)).toBe(true);
  });

  it("a wall hit is its own type and repeats of the same id are ignored", async () => {
    const m = { ID: "9", Type: "with environment", Speed: 80, DriverGUID: "a" };
    await onCollision(S, m, { now: 2_000_000 });
    await onCollision(S, m, { now: 2_010_000 });
    expect(inserts()).toHaveLength(1);
    expect(typeOf(inserts()[0])).toBe("env");
  });
});

describe("one crash along a wall", () => {
  it("hits five seconds apart stay one incident, a new one after ten quiet seconds does not", async () => {
    const hit = (id, t, kmh) => onCollision(S, { ID: id, Type: "with environment", Speed: kmh, DriverGUID: "a" }, { now: t });
    await hit("1", 2_000_000, 82);
    await hit("2", 2_005_000, 45);
    await hit("3", 2_010_000, 36);
    expect(inserts()).toHaveLength(1);
    await hit("4", 2_025_000, 50);
    expect(inserts()).toHaveLength(2);
  });
});
