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

describe("off track", () => {
  const drive = (t, offM, extra = {}) =>
    onTelemetry(S, { guid: "a", carId: 0, kmh: 150, pos: { X: 0, Z: 0 }, spline: 0.5, inPits: false, offM, now: t, ...extra });

  it("a moment over the line is not off track, staying out is", () => {
    drive(0, 0);
    drive(100, 4);
    drive(500, 0.5); // just a kerb
    drive(900, 0);
    expect(inc.offTrackNow(S)).toHaveLength(0);
    drive(1000, 5);
    drive(1500, 6);
    drive(1900, 6);
    expect(inc.offTrackNow(S).map((o) => o.guid)).toEqual(["a"]);
    expect(inc.offTrackNow(S)[0].metres).toBe(6);
  });

  it("comes back on after a second on the tarmac", () => {
    drive(0, 5);
    drive(1000, 5);
    expect(inc.offTrackNow(S)).toHaveLength(1);
    drive(1200, 0.4);
    drive(1800, 0.2);
    expect(inc.offTrackNow(S)).toHaveLength(1);
    drive(2300, 0);
    expect(inc.offTrackNow(S)).toHaveLength(0);
  });

  it("the pit lane and a missing map never count", () => {
    drive(0, 8, { inPits: true });
    drive(2000, 8, { inPits: true });
    drive(2100, null);
    drive(4000, null);
    expect(inc.offTrackNow(S)).toHaveLength(0);
  });
});

describe("the collision feed", () => {
  it("hands a new collision to a waiting app at once, with the car's server number", async () => {
    const start = inc.feedCursor();
    const waiting = inc.waitForFeed(start, 5000);
    await onCollision(
      S,
      { ID: "f1", Type: "with other car", Speed: 50, DriverGUID: "a", OtherDriverGUID: "b", WorldPos: { X: 1, Y: 2, Z: 3 } },
      { now: 2_000_000, carIdForGuid: (g) => (g === "a" ? 4 : 9) }
    );
    const events = await waiting;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "car", carId: 4, otherCarId: 9, driver: "Alice", other: "Bob", kmh: 50, pos: { x: 1, y: 2, z: 3 } });
    expect(inc.feedAfter(events[0].seq)).toHaveLength(0);
  });

  it("gives up empty-handed after the wait, and merged repeats are not sent twice", async () => {
    const start = inc.feedCursor();
    await onCollision(S, { ID: "w1", Type: "with environment", Speed: 60, DriverGUID: "a" }, { now: 2_000_000 });
    await onCollision(S, { ID: "w2", Type: "with environment", Speed: 70, DriverGUID: "a" }, { now: 2_001_000 });
    expect(inc.feedAfter(start)).toHaveLength(1);
    const t = Date.now();
    expect(await inc.waitForFeed(inc.feedCursor(), 50)).toEqual([]);
    expect(Date.now() - t).toBeGreaterThanOrEqual(40);
  });
});

describe("off track on the feed", () => {
  it("going off and coming back each put one event out, with the car's server slot", () => {
    const start = inc.feedCursor();
    const drive = (t, offM) => onTelemetry(S, { guid: "a", carId: 4, kmh: 150, pos: { X: 1, Y: 0, Z: 2 }, spline: 0.5, inPits: false, offM, now: t });
    drive(0, 5);
    drive(1000, 7);
    drive(1500, 7);
    drive(2000, 0);
    drive(3200, 0);
    const events = inc.feedAfter(start).filter((e) => e.kind === "offtrack");
    expect(events.map((e) => e.ended)).toEqual([false, true]);
    expect(events[0]).toMatchObject({ carId: 4, driver: "Alice", metres: 7 });
  });
});
