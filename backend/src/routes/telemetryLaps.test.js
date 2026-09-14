// The ingest, driven through a real express app.
//
// Every branch in this router is a dead end from the outside: the script logs a
// status code to a console nobody has open and carries on. So the thing worth
// testing is not the status codes — it is that each branch WRITES DOWN which
// one it took, because that record is now the only way anybody finds out why an
// evening produced no laps.
//
// And, since the second league got its own race server, WHICH LEAGUE each
// branch was about: the key names the series, the lap lands in that series'
// store, and the other league's page never sees it.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import { rmSync } from "fs";

const KEY = "f00dcafef00dcafef00dcafef00dcafe"; // the Friday league's
const KEY2 = "0123456789abcdef0123456789abcdef"; // the Sunday league's

// The pause flag rides on globalThis because vi.mock factories are hoisted
// above any local variable this file could share with them.
vi.mock("../lib/prisma.js", () => ({
  default: {
    setting: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async ({ where }) => {
        if (globalThis.__telemetryNoKeys) return [];
        const rows = [
          { key: "telemetry_ingest_key:friday-f1", value: KEY },
          { key: "telemetry_ingest_key:sunday-gt", value: KEY2 },
        ];
        if (globalThis.__telemetryPaused) rows.push({ key: "telemetry_ingest_off:friday-f1", value: "1" });
        return rows.filter((r) => where.key.in.includes(r.key));
      }),
    },
    driver: { findMany: vi.fn(async () => []) },
  },
}));
const SERIES = [
  { id: "f1", slug: "friday-f1", name: "NABS Racing League", isActive: true, isPublic: true },
  { id: "gt", slug: "sunday-gt", name: "Sunday GT", isActive: false, isPublic: true },
];
vi.mock("../lib/series.js", () => ({
  dbListSeries: vi.fn(async () => SERIES),
  resolveSeries: vi.fn(async (p, slug) =>
    slug == null || slug === "" ? SERIES[0] : SERIES.find((s) => s.slug === String(slug)) || null
  ),
}));
// Each league is in its own season: the F1 league's 8th, the GT league's 1st.
vi.mock("../services/seasonService.js", () => ({
  resolveSeason: vi.fn(async (p, n, opts) => (opts?.series === "sunday-gt" ? { id: "g1", number: 1 } : { id: "s8", number: 8 })),
}));
vi.mock("../lib/trackMaps.js", () => ({ ensureTrackMap: vi.fn(async () => null), ensureTrackRoad: vi.fn(async () => null) }));
vi.mock("../lib/persons.js", () => ({ getNameOverrides: vi.fn(async () => new Map()) }));
// Who may READ is tested next door (lib/telemetryAccess.test.js); here it would
// only stand between the test and the routes it is about.
vi.mock("../lib/telemetryAccess.js", () => ({ telemetryReadGate: () => (req, res, next) => next() }));

const { default: router } = await import("./telemetryLaps.js");
const { readTelemetryActivity, resetTelemetryActivity } = await import("../lib/telemetryIngestLog.js");
const { TELEMETRY_LAPS_DIR } = await import("../lib/telemetryLaps.js");
const { invalidateTelemetryKeys } = await import("../lib/telemetryKeys.js");
const { default: prisma } = await import("../lib/prisma.js");

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
beforeEach(() => {
  resetTelemetryActivity();
  // The key lookup answers from a short cache; a test that flips a flag on
  // the mock must not be answered with the previous test's world.
  invalidateTelemetryKeys();
});

describe("handing the script to a car", () => {
  it("serves it with the ingest address and version baked in, and counts it", async () => {
    const res = await fetch(`${base}/api/telemetry-laps/app.lua?key=${KEY}`);
    const src = await res.text();
    expect(res.status).toBe(200);
    expect(src).toContain(`/api/telemetry-laps/ingest?key=${KEY}`);
    // The placeholder appears in the template's own header comment too; a
    // .replace() instead of .replaceAll() once left that one behind.
    expect(src).not.toContain("__INGEST_URL__");
    expect(src).not.toContain("__SCRIPT_VERSION__");
    // The script must never be cacheable: CSP keeps a downloaded script on
    // the driver's disk by URL, and an ETag would let a revalidation answer
    // 304 — "keep the old copy" — while looking like a serve here.
    expect(res.headers.get("etag")).toBeNull();
    expect(res.headers.get("cache-control")).toContain("no-store");
    const a = readTelemetryActivity();
    expect(a.scriptsServed).toBe(1);
    // WHO fetched rides along as the detail — the row "Script sent" once had
    // to carry a diagnosis alone, and a browser refresh and a joining car
    // looked identical.
    expect(a.events[0].detail).toBeTruthy();
    // And WHOSE server handed it out.
    expect(a.events[0].series).toBe("friday-f1");
  });

  it("marks a fetch that asked for a version, and one that was revalidating", async () => {
    const res = await fetch(`${base}/api/telemetry-laps/app.lua?key=${KEY}&v=abc123`, {
      headers: { "If-None-Match": 'W/"stale"' },
    });
    // A conditional request still gets the full script, never a 304.
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(1000);
    const [event] = readTelemetryActivity().events;
    expect(event.detail).toContain("v=abc123");
    expect(event.detail).toContain("revalidating");
  });

  it("refuses a wrong key with a 404 that says nothing — and records the refusal", async () => {
    const res = await fetch(`${base}/api/telemetry-laps/app.lua?key=deadbeefdeadbeefdeadbeefdeadbeef`);
    expect(res.status).toBe(404);
    const a = readTelemetryActivity();
    expect(a.scriptsServed).toBe(0);
    expect(a.outcomes["script-refused"].count).toBe(1);
  });

  it("bakes the second league's key into the script its server hands out", async () => {
    const res = await fetch(`${base}/api/telemetry-laps/app.lua?key=${KEY2}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`/api/telemetry-laps/ingest?key=${KEY2}`);
    expect(readTelemetryActivity().events[0].series).toBe("sunday-gt");
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
    expect(event.series).toBe("friday-f1");
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

describe("two leagues, two keys", () => {
  it("files a lap posted with the second league's key in the second league's store, in ITS season", async () => {
    // Same driver, same time, a different circuit — posted with the Sunday key.
    const res = await post(`?key=${KEY2}`, lapPayload({ track: "spa", layout: "" }));
    expect(await res.json()).toMatchObject({ ok: true, kept: true });
    expect(readTelemetryActivity().events[0].series).toBe("sunday-gt");

    const sunday = await (await fetch(`${base}/api/telemetry-laps?series=sunday-gt`)).json();
    expect(sunday).toMatchObject({ series: "sunday-gt", seriesName: "Sunday GT", season: 1 });
    expect(sunday.tracks.map((t) => t.trackKey)).toEqual(["spa"]);

    // The Friday page — the default when nobody names a series — is untouched.
    const friday = await (await fetch(`${base}/api/telemetry-laps`)).json();
    expect(friday).toMatchObject({ series: "friday-f1", season: 8 });
    expect(friday.tracks.map((t) => t.trackKey)).toEqual(["fr-redbullring--austria-f1-2024"]);
  });

  it("answers one league's card with that league's evening and not the other's", async () => {
    await post(`?key=${KEY}`, lapPayload({ lapTimeMs: 61000 }));
    await post(`?key=${KEY2}`, lapPayload({ track: "spa", layout: "", lapTimeMs: 125000 }));
    await post("?key=deadbeefdeadbeefdeadbeefdeadbeef", lapPayload()); // names nobody: both cards show it
    const f1 = readTelemetryActivity("friday-f1");
    const gt = readTelemetryActivity("sunday-gt");
    expect(f1.lapsArrived).toBe(1);
    expect(gt.lapsArrived).toBe(1);
    expect(f1.events.map((e) => e.outcome)).toEqual(["bad-key", "lap-kept"]);
    expect(gt.events.map((e) => e.outcome)).toEqual(["bad-key", "lap-kept"]);
    expect(f1.events[1].lapTimeMs).toBe(61000);
    expect(gt.events[1].lapTimeMs).toBe(125000);
    expect(readTelemetryActivity().lapsArrived).toBe(2);
  });

  it("does not answer for a series that does not exist", async () => {
    expect((await fetch(`${base}/api/telemetry-laps?series=no-such-league`)).status).toBe(404);
    expect((await fetch(`${base}/api/telemetry-laps/spa?series=no-such-league`)).status).toBe(404);
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
    expect(event.series).toBe("friday-f1");
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

  it("reads as switched off, not as a wrong key, while no league has a key at all", async () => {
    globalThis.__telemetryNoKeys = true;
    try {
      const res = await post(`?key=${KEY}`, lapPayload());
      expect(res.status).toBe(503);
      expect(readTelemetryActivity().outcomes.off.count).toBe(1);
      expect(readTelemetryActivity().outcomes["bad-key"].count).toBe(0);
    } finally {
      globalThis.__telemetryNoKeys = false;
    }
  });

  // The league's key is permanent (routes/admin.js): "off" is a flag beside
  // it, not its deletion. While the flag is set the recorder must go fully
  // dark — no script, no laps — with the key itself untouched underneath.
  it("goes dark while paused, without the key having changed — and only for that league", async () => {
    globalThis.__telemetryPaused = true;
    try {
      const lap = await post(`?key=${KEY}`, lapPayload());
      expect(lap.status).toBe(503);
      const script = await fetch(`${base}/api/telemetry-laps/app.lua?key=${KEY}`);
      expect(script.status).toBe(404);
      const a = readTelemetryActivity();
      expect(a.outcomes.off.count).toBe(1);
      expect(a.outcomes["script-refused"].count).toBe(1);
      // The refusals are the Friday league's to see, not the Sunday league's.
      expect(readTelemetryActivity("friday-f1").outcomes.off.count).toBe(1);
      expect(readTelemetryActivity("sunday-gt").outcomes.off.count).toBe(0);
      // The other league's server keeps working through the Friday pause.
      const other = await post(`?key=${KEY2}&ping=1`, {});
      expect(await other.json()).toMatchObject({ ok: true, pong: true });
    } finally {
      globalThis.__telemetryPaused = false;
      invalidateTelemetryKeys();
    }
    // The same key answers again the moment the pause lifts.
    const res = await post(`?key=${KEY}&ping=1`, {});
    expect(await res.json()).toMatchObject({ ok: true, pong: true });
  });
});

describe('team identity when reading a lap', () => {
  it('returns the same season team with both the selector metadata and full channels', async () => {
    await post(`?key=${KEY}`, lapPayload());
    const team = {id:'ferrari',name:'Ferrari',color:'#ef4444',logoUrl:'/teams/ferrari.png'};
    const driver = {id:'driver-s8',steamId:lapPayload().steamId,name:'League name',team};
    const track = 'fr-redbullring--austria-f1-2024';
    prisma.driver.findMany.mockResolvedValueOnce([driver]);
    const listResponse = await fetch(`${base}/api/telemetry-laps/${track}?season=8`);
    expect(listResponse.status).toBe(200);
    const {laps} = await listResponse.json();
    expect(laps[0]).toMatchObject({name:'League name',driverId:'driver-s8',team});
    prisma.driver.findMany.mockResolvedValueOnce([driver]);
    const lapResponse = await fetch(`${base}/api/telemetry-laps/${track}/${driver.steamId}?season=8`);
    expect(lapResponse.status).toBe(200);
    expect(await lapResponse.json()).toMatchObject({name:'League name',team,n:60});
    expect(prisma.driver.findMany.mock.lastCall[0].where.seasonId).toBe('s8');
  });

  it('keeps the recorded name and no team for an unregistered driver', async () => {
    await post(`?key=${KEY}`, lapPayload());
    const response = await fetch(`${base}/api/telemetry-laps/fr-redbullring--austria-f1-2024/${lapPayload().steamId}?season=8`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({name:'Rashford',driverId:null,team:null});
  });
});
