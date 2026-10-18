import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import {
  checksumPathsFor,
  sessionContentOf,
  sessionIdInfo,
  sessionSkinsOf,
  parseDirListing,
  kn5FilesOfModelsIni,
  classifyTrackFile,
} from "../lib/acServerContent.js";
import {
  getContentCheck,
  getFullContentCheck,
  getServerFullContentCheck,
  invalidateContentCheckCache,
} from "./contentCheckService.js";

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

function mk({ status = 200, text = "", json = null, buffer = null, contentLength = null }) {
  const bytes = new TextEncoder().encode(buffer || "");
  return {
    ok: status < 400,
    status,
    // Real fetch always carries headers, and the reader checks content-length
    // before pulling a body into memory.
    headers: new Headers(buffer != null ? { "content-length": String(contentLength ?? bytes.length) } : {}),
    text: async () => text,
    json: async () => json,
    arrayBuffer: async () => bytes.buffer,
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

  it("refuses a file the server declares as huge instead of buffering it", async () => {
    vi.stubGlobal("fetch", async (url) => {
      const path = new URL(url).pathname.replace(/^\//, "");
      if (path === "results") return mk({ text: '<a href="/results/2026_9_16_22_10_PRACTICE">x</a>' });
      if (path === "results/download/2026_9_16_22_10_PRACTICE.json") {
        return mk({ json: { TrackName: "monza", TrackConfig: "", Cars: [{ Model: "huge_car" }] } });
      }
      return mk({ buffer: "small body, enormous claim", contentLength: 999 * 1024 * 1024 });
    });
    const out = await getContentCheck("nabs1");
    expect(out.files.every((f) => f.md5 === null)).toBe(true);
    expect(out.files[0].error).toMatch(/too large/i);
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

// --- the full check (the Windows tool's list) --------------------------------

describe("parseDirListing", () => {
  it("reads the manager's index page: files, folders, encoded names", () => {
    const html = `<pre>
<a href="data.acd">data.acd</a>
<a href="skins/">skins/</a>
<a href="NCB%20RaceTech%20-%20Kalervo77/">NCB RaceTech - Kalervo77/</a>
</pre>`;
    expect(parseDirListing(html)).toEqual([
      { name: "data.acd", dir: false },
      { name: "skins", dir: true },
      { name: "NCB RaceTech - Kalervo77", dir: true },
    ]);
  });

  it("drops anything that is not a plain name in this folder", () => {
    const html = '<a href="../">..</a><a href="/content/">x</a><a href="a%2Fb">x</a><a href="?C=N;O=D">sort</a><a href="ok.ini">ok</a>';
    expect(parseDirListing(html)).toEqual([{ name: "ok.ini", dir: false }]);
  });
});

describe("kn5FilesOfModelsIni", () => {
  it("lists every model a layout loads, sub-folders included", () => {
    const ini = "[MODEL_0]\nFILE=magny_cours.kn5\nPOSITION=0,0,0\n\n[MODEL_1]\nFILE=nabs_mc_42\\extension\\nabs_mc_42.kn5\n[DYNAMIC_OBJECT_0]\nFILE=12.kn5\n";
    expect(kn5FilesOfModelsIni(ini)).toEqual(["magny_cours.kn5", "nabs_mc_42/extension/nabs_mc_42.kn5", "12.kn5"]);
  });

  it("ignores a FILE= that would leave the track folder", () => {
    expect(kn5FilesOfModelsIni("FILE=../../system/x.kn5\nFILE=C:/x.kn5")).toEqual([]);
  });
});

describe("classifyTrackFile", () => {
  it("knows which differences kick, which change the race and which only look", () => {
    expect(classifyTrackFile("nabs_mc_42/data/surfaces.ini").level).toBe("kick");
    expect(classifyTrackFile("nabs_mc_42/data/drs_zones.ini").level).toBe("problem");
    expect(classifyTrackFile("nabs_mc_42/ai/pit_lane.ai").level).toBe("problem");
    expect(classifyTrackFile("nabs_mc_42/data/map.ini").level).toBe("cosmetic");
  });

  it("leaves out what the manager generates or Content Manager rewrites", () => {
    expect(classifyTrackFile("nabs_mc_42/map.png")).toBeNull();
    expect(classifyTrackFile("nabs_mc_42/ai/server-manager.ai.gob")).toBeNull();
    expect(classifyTrackFile("nabs_mc_42/ai/fast_lane_payloads.bin")).toBeNull();
    expect(classifyTrackFile("ui/nabs_mc_42/ui_track.json")).toBeNull();
  });
});

describe("sessionSkinsOf", () => {
  it("collects each car's liveries on the grid, once", () => {
    const json = { Cars: [{ Model: "f", Skin: "b" }, { Model: "f", Skin: "a" }, { Model: "f", Skin: "a" }, { Model: "g" }] };
    expect(sessionSkinsOf(json)).toEqual({ f: ["a", "b"] });
  });
});

describe("getFullContentCheck", () => {
  const LISTINGS = {
    "content/cars/formula_2010/skins": '<a href="red/">red/</a><a href="blue/">blue/</a>',
    "content/tracks/baku_2022/nabs_baku": '<a href="data/">data/</a><a href="ai/">ai/</a><a href="map.png">map.png</a>',
    "content/tracks/baku_2022/nabs_baku/data": '<a href="surfaces.ini">s</a><a href="drs_zones.ini">d</a>',
    "content/tracks/baku_2022/nabs_baku/ai": '<a href="fast_lane.ai">f</a><a href="server-manager.ai.gob">g</a>',
  };
  const FILES = {
    "content/cars/formula_2010/data.acd": "acd",
    "content/tracks/baku_2022/nabs_baku/data/surfaces.ini": "surfaces",
    "content/tracks/baku_2022/nabs_baku/data/drs_zones.ini": "drs",
    "content/tracks/baku_2022/nabs_baku/ai/fast_lane.ai": "line",
    "content/tracks/baku_2022/models_nabs_baku.ini": "[MODEL_0]\nFILE=baku.kn5\n[MODEL_1]\nFILE=nabs_baku/extension/extra.kn5\n",
  };

  function stubFull() {
    vi.stubGlobal("fetch", async (url) => {
      const path = decodeURIComponent(new URL(url).pathname).replace(/^\//, "");
      if (path === "results") return mk({ text: '<a href="/results/2026_9_16_22_10_PRACTICE">x</a>' });
      if (path === "results/download/2026_9_16_22_10_PRACTICE.json") {
        return mk({
          json: {
            TrackName: "baku_2022",
            TrackConfig: "nabs_baku",
            Cars: [{ Model: "formula_2010", Skin: "red" }, { Model: "formula_2010", Skin: "gone_from_server" }],
          },
        });
      }
      const dir = path.replace(/\/$/, "");
      if (path.endsWith("/") && LISTINGS[dir]) return mk({ text: LISTINGS[dir] });
      if (FILES[path] !== undefined) return mk({ buffer: FILES[path], text: FILES[path] });
      return mk({ status: 404 });
    });
  }

  it("hashes every data file of the layout, judged by what a difference does", async () => {
    stubFull();
    const out = await getFullContentCheck("nabs1");
    const byPath = Object.fromEntries(out.files.map((f) => [f.path, f]));
    expect(byPath["content/cars/formula_2010/data.acd"]).toMatchObject({ level: "kick", md5: md5("acd"), group: "car formula_2010" });
    expect(byPath["content/tracks/baku_2022/nabs_baku/data/surfaces.ini"]).toMatchObject({ level: "kick", md5: md5("surfaces") });
    expect(byPath["content/tracks/baku_2022/nabs_baku/data/drs_zones.ini"].level).toBe("problem");
    expect(byPath["content/tracks/baku_2022/nabs_baku/ai/fast_lane.ai"].level).toBe("problem");
    expect(byPath["content/tracks/baku_2022/models_nabs_baku.ini"].level).toBe("problem");
    // Pictures and the manager's own files are no part of the comparison.
    expect(Object.keys(byPath).some((p) => p.endsWith(".png") || p.endsWith(".gob"))).toBe(false);
  });

  it("lists the models the layout loads and the grid's liveries as things that must exist", async () => {
    stubFull();
    const out = await getFullContentCheck("nabs1");
    const present = out.present.map((p) => [p.path, p.type]);
    expect(present).toContainEqual(["content/tracks/baku_2022/baku.kn5", "file"]);
    expect(present).toContainEqual(["content/tracks/baku_2022/nabs_baku/extension/extra.kn5", "file"]);
    expect(present).toContainEqual(["content/tracks/baku_2022/nabs_baku", "dir"]);
    expect(present).toContainEqual(["content/cars/formula_2010", "anyKn5"]);
    expect(present).toContainEqual(["content/cars/formula_2010/skins/red", "dir"]);
    // A livery the server itself lacks is not the driver's problem.
    expect(present.some(([p]) => p.endsWith("gone_from_server"))).toBe(false);
    expect(out.absent.map((a) => a.path)).toEqual(["content/cars/formula_2010/data"]);
  });

  it("is cached apart from the short list the page uses", async () => {
    stubFull();
    const full = await getServerFullContentCheck("nabs1");
    const short = await getContentCheck("nabs1");
    expect(full).not.toBe(short);
    expect(short.present).toBeUndefined();
    expect(await getServerFullContentCheck("nabs1")).toBe(full);
  });

  it("merges the reference installs in fresh on every call, without touching the cache", async () => {
    stubFull();
    const merged = await getFullContentCheck("nabs1");
    const cachedOne = await getServerFullContentCheck("nabs1");
    expect(merged).not.toBe(cachedOne);
    expect(merged.references).toEqual([]);
    expect(cachedOne.references).toBeUndefined();
  });
});
