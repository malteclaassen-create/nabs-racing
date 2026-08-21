// The ingest, driven through a real express app.
//
// Every branch in this router is a dead end from the outside: the script logs a
// status code to a console nobody has open and carries on. So the thing worth
// testing is not the status codes — it is that each branch WRITES DOWN which
// one it took, because that record is now the only way anybody finds out why an
// evening produced no laps.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import { rmSync } from "fs";

const KEY = "f00dcafef00dcafef00dcafef00dcafe";

vi.mock("../lib/prisma.js", () => ({
  default: {
    setting: { findUnique: vi.fn(async ({ where }) => (where.key === "telemetry_ingest_key" ? { value: KEY } : null)) },
    driver: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("../services/seasonService.js", () => ({ resolveSeason: vi.fn(async () => ({ number: 8 })) }));
vi.mock("../lib/trackMaps.js", () => ({ ensureTrackMap: vi.fn(async () => null) }));
vi.mock("../lib/persons.js", () => ({ getNameOverrides: vi.fn(async () => new Map()) }));
// Who may READ is tested next door (lib/telemetryAccess.test.js); here it would
// only stand between the test and the routes it is about.
vi.mock("../lib/telemetryAccess.js", () => ({ telemetryReadGate: () => (req, res, next) => next() }));

const { default: router } = await import("./telemetryLaps.js");
const { readTelemetryActivity, resetTelemetryActivity } = await import("../lib/telemetryIngestLog.js");
const { TELEMETRY_LAPS_DIR } = await import("../lib/telemetryLaps.js");

let base;
let server;

// A lap the parser accepts: channels sampled by track position, time moving
// forward through it. Small n on purpose — the store accepts 50 to 1500 so the
// in-game script can change without a lockstep deploy.
function lapPayload(overrides = {}) {
  const n = 60;
  const arr = (fn) => Array.from({ length: n }, (_, i) => fn(i));
  return {
    v: 1,
    steamId: "76561198000000001",
    name: "Rashford",
    car: "formula_hybrid_2024",
    track: "fr_redbullring",
    layout: "austria_f1_2024",
    lapTimeMs: 62279,
    n,
    t: arr((i) => Math.round((i / (n - 1)) * 62279)),
    speed: arr(() => 210),
    gas: arr(() => 100),
    brake: arr(() => 0),
    steer: arr(() => 0),
    gear: arr(() => 6),
    x: arr((i) => i * 100),
    z: arr(() => 0),
    ...overrides,
  };
}

const post = (query, body) =>
  fetch(`${base}/api/telemetry-laps/ingest${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

beforeAll(async () => {
  // DATA_DIR points at a throwaway directory for the whole suite (vitest
  // .config.js), but it survives between RUNS — and a lap left there by the
  // last one would make the first "stored" assertion below fail as a duplicate.
  rmSync(TELEMETRY_LAPS_DIR, { recursive: true, force: true });
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api/telemetry-laps", router);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server?.close());
beforeEach(() => resetTelemetryActivity());

describe("handing the script to a car", () => {
  it("serves it with the ingest address baked in, and counts it", async () => {
    const res = await fetch(`${base}/api/telemetry-laps/app.lua?key=${KEY}`);
    const src = await res.text();
    expect(res.status).toBe(200);
    expect(src).toContain(`/api/telemetry-laps/ingest?key=${KEY}`);
    // The placeholder appears in the template's own header comment too; a
    // .replace() instead of .replaceAll() once left that one behind.
    expect(src).not.toContain("__INGEST_URL__");
    expect(readTelemetryActivity().scriptsServed).toBe(1);
  });

  it("refuses a wrong key with a 404 that says nothing — and records the refusal", async () => {
    const res = await fetch(`${base}/api/telemetry-laps/app.lua?key=deadbeefdeadbeefdeadbeefdeadbeef`);
    expect(res.status).toBe(404);
    const a = readTelemetryActivity();
    expect(a.scriptsServed).toBe(0);
    expect(a.outcomes["script-refused"].count).toBe(1);
  });
});

describe("a lap arriving", () => {
  it("stores it and records the driver, track and time", async () => {
    const res = await post(`?key=${KEY}`, lapPayload());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, kept: true });
    const [event] = readTelemetryActivity().events;
    expect(event.outcome).toBe("lap-kept");
    expect(event.name).toBe("Rashford");
    // The slugged key, not the game's spelling: it is a path segment.
    expect(event.track).toBe("fr-redbullring--austria-f1-2024");
    expect(event.lapTimeMs).toBe(62279);
  });

  it("counts a lap it does not store as ARRIVED — the distinction the panel is built on", async () => {
    // The same time again: already held, so nothing is written. The car still
    // posted, and reading that as a failure is what sent us hunting a server
    // problem that did not exist.
    const res = await post(`?key=${KEY}`, lapPayload());
    expect(await res.json()).toMatchObject({ kept: false });
    const a = readTelemetryActivity();
    expect(a.lapsArrived).toBe(1);
    expect(a.outcomes["lap-slower"].count).toBe(1);
  });

  it("records WHY a malformed lap was refused, verbatim", async () => {
    const res = await post(`?key=${KEY}`, lapPayload({ lapTimeMs: 12 }));
    expect(res.status).toBe(400);
    const [event] = readTelemetryActivity().events;
    expect(event.outcome).toBe("lap-refused");
    expect(event.detail).toBe("Implausible lap time");
  });
});

describe("the recorder's own voice", () => {
  // Both beacons ride the query string alone — the script sends them without
  // JSON on purpose, so the site must not need a body to understand them.
  it("records the recorder saying hello from a car, facts included", async () => {
    const info = "steam yes, json yes, spline 0.312, csp 3898";
    const res = await post(
      `?key=${KEY}&hello=1&name=TheFakeTB&track=most&info=${encodeURIComponent(info)}`,
      {}
    );
    expect(await res.json()).toMatchObject({ ok: true });
    const a = readTelemetryActivity();
    const [event] = a.events;
    expect(event.outcome).toBe("car-alive");
    expect(event.name).toBe("TheFakeTB");
    expect(event.track).toBe("most");
    expect(event.detail).toBe(info);
    // A hello is not a lap: the split the card is built on stays honest.
    expect(a.lapsArrived).toBe(0);
  });

  it("records a lap the car held back, with the reason and the time", async () => {
    const res = await post(
      `?key=${KEY}&diag=${encodeURIComponent("pit lane")}&name=TheFakeTB&track=most&lapms=59800`,
      {}
    );
    expect(await res.json()).toMatchObject({ ok: true });
    const a = readTelemetryActivity();
    const [event] = a.events;
    expect(event.outcome).toBe("car-skipped");
    expect(event.detail).toBe("pit lane");
    expect(event.lapTimeMs).toBe(59800);
    expect(a.lapsArrived).toBe(0);
  });

  it("turns a beacon with a wrong key away like anything else", async () => {
    const res = await post("?key=deadbeefdeadbeefdeadbeefdeadbeef&hello=1", {});
    expect(res.status).toBe(401);
    expect(readTelemetryActivity().outcomes["car-alive"].count).toBe(0);
  });
});

describe("the ways in that are not laps", () => {
  it("answers the connection test without inventing a lap", async () => {
    const res = await post(`?key=${KEY}&ping=1`, {});
    expect(await res.json()).toMatchObject({ ok: true, pong: true });
    const a = readTelemetryActivity();
    expect(a.outcomes.ping.count).toBe(1);
    expect(a.lapsArrived).toBe(0);
  });

  it("turns a wrong key away and says so", async () => {
    const res = await post("?key=deadbeefdeadbeefdeadbeefdeadbeef", lapPayload());
    expect(res.status).toBe(401);
    expect(readTelemetryActivity().outcomes["bad-key"].count).toBe(1);
  });
});
