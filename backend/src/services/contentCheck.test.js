import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { checksumPathsFor, sessionContentOf, sessionIdInfo } from "../lib/acServerContent.js";
import { getContentCheck, invalidateContentCheckCache } from "./contentCheckService.js";

// ---------------------------------------------------------------------------
// The "Checksum failed" check. Two halves worth pinning down:
//
//   * WHICH files AC checksums for a session — get that list wrong and the
//     page either misses the broken file or accuses a good one. The layout
//     case is the trap: a track carries a surfaces.ini at its root AND one per
//     layout, they are not the same file, and only the layout's counts.
//   * that the manifest carries the RACE SERVER's own hashes, read off the
//     server rather than from anything stored here.
// ---------------------------------------------------------------------------

describe("checksumPathsFor", () => {
  it("lists each car's data.acd once, sorted, with its unpacked-data trap", () => {
    const out = checksumPathsFor({ cars: ["ferrari_f2007", "bmw_m3", "ferrari_f2007"], track: "monza" });
    const cars = out.filter((f) => f.kind === "car");
    expect(cars.map((f) => f.path)).toEqual([
      "content/cars/bmw_m3/data.acd",
      "content/cars/ferrari_f2007/data.acd",
    ]);
    expect(cars[0].unpackedDir).toBe("content/cars/bmw_m3/data");
    expect(cars.every((f) => f.inPlay)).toBe(true);
  });

  it("puts the LAYOUT's surfaces.ini in play and carries the track root beside it", () => {
    const out = checksumPathsFor({ cars: [], track: "baku_2022", config: "nabs_baku" });
    expect(out.map((f) => [f.path, f.inPlay])).toEqual([
      ["content/tracks/baku_2022/nabs_baku/data/surfaces.ini", true],
      ["content/tracks/baku_2022/data/surfaces.ini", false],
    ]);
  });

  it("uses the track root when the track has no layouts", () => {
    const out = checksumPathsFor({ cars: [], track: "monza", config: "" });
    expect(out.map((f) => [f.path, f.inPlay])).toEqual([["content/tracks/monza/data/surfaces.ini", true]]);
  });

  it("has nothing to check without a track", () => {
    expect(checksumPathsFor({ cars: [], track: null })).toEqual([]);
  });
});

describe("sessionContentOf", () => {
  it("takes the track, the layout and one entry per car model", () => {
    expect(
      sessionContentOf({
        TrackName: "spa",
        TrackConfig: "Spa_EuroRacers_2025",
        Cars: [{ Model: "formula_2010" }, { Model: "formula_2010" }, { Model: "mercedes_sls_gt3" }, {}],
      })
    ).toEqual({ track: "spa", config: "Spa_EuroRacers_2025", cars: ["formula_2010", "mercedes_sls_gt3"] });
  });

  it("reads a track without layouts as an empty config, not a missing one", () => {
    expect(sessionContentOf({ TrackName: "monza", TrackConfig: "", Cars: [] }).config).toBe("");
  });
});

describe("sessionIdInfo", () => {
  it("reads the session's own timestamp and type out of its id", () => {
    const s = sessionIdInfo("2026_9_11_19_33_RACE");
    expect(s.type).toBe("RACE");
    expect(s.date).toBe("2026-09-11T19:33:00.000Z");
  });

  it("leaves a nonsense id without a timestamp instead of inventing one", () => {
    expect(sessionIdInfo("not_a_session").ts).toBeNull();
  });
});

// --- the manifest, end to end against a stubbed race server ------------------

const md5 = (s) => createHash("md5").update(Buffer.from(s)).digest("hex");

const SERVER_FILES = {
  "content/cars/formula_2010/data.acd": "acd-bytes-of-formula-2010",
  "content/tracks/baku_2022/nabs_baku/data/surfaces.ini": "layout surfaces",
  "content/tracks/baku_2022/data/surfaces.ini": "root surfaces",
};

function stubRaceServer({ fail = null } = {}) {
  vi.stubGlobal("fetch", async (url) => {
    const path = new URL(url).pathname.replace(/^\//, "");
    if (path === "results") {
      return mk({ text: '<a href="/results/2026_9_16_22_10_PRACTICE">x</a><a href="/results/2026_9_11_19_33_RACE">y</a>' });
    }
    if (path === "results/download/2026_9_16_22_10_PRACTICE.json") {
      return mk({
        json: { TrackName: "baku_2022", TrackConfig: "nabs_baku", Cars: [{ Model: "formula_2010" }, { Model: "missing_car" }] },
      });
    }
    if (path === fail) return mk({ status: 500 });
    if (SERVER_FILES[path] !== undefined) return mk({ buffer: SERVER_FILES[path] });
    return mk({ status: 404 });
  });
}

function mk({ status = 200, text = "", json = null, buffer = null }) {
  return {
    ok: status < 400,
    status,
    text: async () => text,
    json: async () => json,
    arrayBuffer: async () => new TextEncoder().encode(buffer || "").buffer,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  invalidateContentCheckCache();
});

describe("getContentCheck", () => {
  it("builds the session's file list with the server's own hashes", async () => {
    stubRaceServer();
    const out = await getContentCheck("nabs1");
    // The newest session wins, and its track/layout drive the list.
    expect(out.session.id).toBe("2026_9_16_22_10_PRACTICE");
    expect(out.track).toBe("baku_2022");
    expect(out.config).toBe("nabs_baku");
    const byPath = Object.fromEntries(out.files.map((f) => [f.path, f]));
    expect(byPath["content/cars/formula_2010/data.acd"].md5).toBe(md5(SERVER_FILES["content/cars/formula_2010/data.acd"]));
    expect(byPath["content/tracks/baku_2022/nabs_baku/data/surfaces.ini"].inPlay).toBe(true);
    // The two surfaces.ini of a layout track are different files, and the
    // manifest must not confuse them.
    expect(byPath["content/tracks/baku_2022/data/surfaces.ini"].md5).not.toBe(
      byPath["content/tracks/baku_2022/nabs_baku/data/surfaces.ini"].md5
    );
  });

  it("marks a file the server does not serve instead of dropping it", async () => {
    stubRaceServer();
    const out = await getContentCheck("nabs1");
    const car = out.files.find((f) => f.path === "content/cars/missing_car/data.acd");
    expect(car.md5).toBeNull();
    expect(car.missingOnServer).toBe(true);
    expect(car.error).toBeNull();
  });

  it("keeps the rest of the manifest when one file errors", async () => {
    stubRaceServer({ fail: "content/cars/formula_2010/data.acd" });
    const out = await getContentCheck("nabs1");
    const car = out.files.find((f) => f.path === "content/cars/formula_2010/data.acd");
    expect(car.md5).toBeNull();
    expect(car.error).toBeTruthy();
    expect(out.files.find((f) => f.inPlay && f.kind === "track").md5).toBeTruthy();
  });

  it("serves the same build from cache instead of walking the race server again", async () => {
    stubRaceServer();
    const first = await getContentCheck("nabs1");
    const calls = fetch.mock?.calls?.length;
    const second = await getContentCheck("nabs1");
    expect(second).toBe(first);
    if (calls != null) expect(fetch.mock.calls.length).toBe(calls);
  });
});
