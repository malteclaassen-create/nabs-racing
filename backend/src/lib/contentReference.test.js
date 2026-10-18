import { describe, it, expect } from "vitest";
import {
  parseReferenceUpload,
  conflictsWithServer,
  classifyCarFile,
  classifyReferenceTrackFile,
  referenceEntriesFor,
} from "./contentReference.js";

// ---------------------------------------------------------------------------
// Reference installs: an admin's install that matches the server, used to
// compare what the server never hands out (3D models, livery textures). What
// must hold: an upload is checked hard, the server's own hashes always win,
// a reference that disagrees with the server is set aside, and only files of
// the session in play are compared.
// ---------------------------------------------------------------------------

const MD5 = (c) => c.repeat(32);

// A full manifest the way services/contentCheckService.js builds it.
const MANIFEST = {
  session: { id: "2026_9_16_22_10_PRACTICE" },
  track: "baku_2022",
  config: "nabs_baku",
  files: [
    { group: "car formula_2010", path: "content/cars/formula_2010/data.acd", md5: MD5("a"), level: "kick" },
    { group: "track baku_2022 (nabs_baku)", path: "content/tracks/baku_2022/nabs_baku/data/surfaces.ini", md5: MD5("b"), level: "kick" },
    { group: "track baku_2022 (nabs_baku)", path: "content/tracks/baku_2022/models_nabs_baku.ini", md5: MD5("c"), level: "problem" },
  ],
  present: [{ group: "car formula_2010", path: "content/cars/formula_2010/skins/red", type: "dir" }],
};

const CAR_REF = {
  v: 1,
  kind: "car",
  name: "formula_2010",
  by: "Malte",
  at: "2026-10-18T15:00:00.000Z",
  files: [
    { p: "data.acd", s: 10, m: MD5("a") },
    { p: "formula_2010.kn5", s: 20, m: MD5("d") },
    { p: "collider.kn5", s: 5, m: MD5("e") },
    { p: "skins/red/car.dds", s: 30, m: MD5("f") },
    { p: "skins/red/preview.jpg", s: 3, m: MD5("1") },
    { p: "skins/blue/car.dds", s: 30, m: MD5("2") },
    { p: "ui/ui_car.json", s: 1, m: MD5("3") },
  ],
};

const TRACK_REF = {
  v: 1,
  kind: "track",
  name: "baku_2022",
  by: "Malte",
  at: "2026-10-18T15:00:00.000Z",
  files: [
    { p: "nabs_baku/data/surfaces.ini", s: 1, m: MD5("b") },
    { p: "models_nabs_baku.ini", s: 1, m: MD5("c") },
    { p: "models_other.ini", s: 1, m: MD5("4") },
    { p: "baku.kn5", s: 100, m: MD5("5") },
    { p: "road.kn5", s: 100, m: MD5("6") },
    { p: "other/data/surfaces.ini", s: 1, m: MD5("7") },
    { p: "data/surfaces.ini", s: 1, m: MD5("8") },
  ],
};

const reader = (recs) => (kind, name) => recs.find((r) => r.kind === kind && r.name === name) || null;

describe("parseReferenceUpload", () => {
  it("takes a well-formed upload and normalises paths", () => {
    const out = parseReferenceUpload({
      by: "  Malte ",
      groups: [{ kind: "car", name: "formula_2010", files: [{ p: "skins\\red\\car.dds", s: 3, m: MD5("A") }] }],
    });
    expect(out.by).toBe("Malte");
    expect(out.groups[0].files).toEqual([{ p: "skins/red/car.dds", s: 3, m: MD5("a") }]);
  });

  it("refuses paths that leave the folder, bad checksums and unknown kinds", () => {
    const bad = (files, kind = "car", name = "formula_2010") => parseReferenceUpload({ groups: [{ kind, name, files }] }).error;
    expect(bad([{ p: "../../system/x.ini", s: 1, m: MD5("a") }])).toBeTruthy();
    expect(bad([{ p: "C:/x.kn5", s: 1, m: MD5("a") }])).toBeTruthy();
    expect(bad([{ p: "x.kn5", s: 1, m: "nope" }])).toBeTruthy();
    expect(bad([{ p: "x.kn5", s: -1, m: MD5("a") }])).toBeTruthy();
    expect(bad([{ p: "x.kn5", s: 1, m: MD5("a") }], "weather")).toBeTruthy();
    expect(bad([{ p: "x.kn5", s: 1, m: MD5("a") }], "car", "../cars")).toBeTruthy();
    expect(parseReferenceUpload({ groups: [] }).error).toBeTruthy();
  });
});

describe("conflictsWithServer", () => {
  it("is empty when every file the server hashes matches", () => {
    expect(conflictsWithServer(MANIFEST, "car", "formula_2010", CAR_REF.files)).toEqual([]);
    expect(conflictsWithServer(MANIFEST, "track", "baku_2022", TRACK_REF.files)).toEqual([]);
  });

  it("names a server file the reference has in another version, or lacks", () => {
    const changed = CAR_REF.files.map((f) => (f.p === "data.acd" ? { ...f, m: MD5("9") } : f));
    expect(conflictsWithServer(MANIFEST, "car", "formula_2010", changed)).toEqual(["data.acd"]);
    const lacking = TRACK_REF.files.filter((f) => f.p !== "models_nabs_baku.ini");
    expect(conflictsWithServer(MANIFEST, "track", "baku_2022", lacking)).toEqual(["models_nabs_baku.ini"]);
  });

  it("does not mind the case of a path, like Windows", () => {
    const upper = CAR_REF.files.map((f) => (f.p === "data.acd" ? { ...f, p: "DATA.acd" } : f));
    expect(conflictsWithServer(MANIFEST, "car", "formula_2010", upper)).toEqual([]);
  });
});

describe("classifyCarFile / classifyReferenceTrackFile", () => {
  it("compares the car's models, its collider apart, and the grid's liveries only", () => {
    const grid = new Set(["red"]);
    expect(classifyCarFile("formula_2010.kn5", grid).level).toBe("problem");
    expect(classifyCarFile("collider.kn5", grid).what).toMatch(/contact/);
    expect(classifyCarFile("skins/red/car.dds", grid).level).toBe("cosmetic");
    expect(classifyCarFile("skins/blue/car.dds", grid)).toBeNull();
    expect(classifyCarFile("skins/red/preview.jpg", grid)).toBeNull();
    expect(classifyCarFile("data.acd", grid)).toBeNull();
    expect(classifyCarFile("ui/ui_car.json", grid)).toBeNull();
  });

  it("leaves out other layouts and the root data of a layout track", () => {
    const layouts = new Set(["nabs_baku", "other"]);
    expect(classifyReferenceTrackFile("baku.kn5", "nabs_baku", layouts).level).toBe("problem");
    expect(classifyReferenceTrackFile("road.kn5", "nabs_baku", layouts).what).toMatch(/grip/);
    expect(classifyReferenceTrackFile("other/data/surfaces.ini", "nabs_baku", layouts)).toBeNull();
    expect(classifyReferenceTrackFile("models_other.ini", "nabs_baku", layouts)).toBeNull();
    expect(classifyReferenceTrackFile("data/surfaces.ini", "nabs_baku", layouts)).toBeNull();
  });
});

describe("referenceEntriesFor", () => {
  it("adds what only the reference knows, and leaves the server's own files to the server", () => {
    const { entries, references } = referenceEntriesFor(MANIFEST, { read: reader([CAR_REF, TRACK_REF]) });
    expect(entries.map((e) => e.path).sort()).toEqual([
      "content/cars/formula_2010/collider.kn5",
      "content/cars/formula_2010/formula_2010.kn5",
      "content/cars/formula_2010/skins/red/car.dds",
      "content/tracks/baku_2022/baku.kn5",
      "content/tracks/baku_2022/road.kn5",
    ]);
    expect(entries.every((e) => e.source === "reference" && e.md5 && e.size != null)).toBe(true);
    expect(entries.find((e) => e.path.endsWith("baku.kn5")).group).toBe("track baku_2022 (nabs_baku)");
    expect(references.map((r) => [r.kind, r.by, r.stale, r.count])).toEqual([
      ["car", "Malte", false, 3],
      ["track", "Malte", false, 2],
    ]);
  });

  it("sets a reference aside the moment the server's copy changes", () => {
    const newerServer = {
      ...MANIFEST,
      files: MANIFEST.files.map((f) => (f.path.endsWith("data.acd") ? { ...f, md5: MD5("9") } : f)),
    };
    const { entries, references } = referenceEntriesFor(newerServer, { read: reader([CAR_REF]) });
    expect(entries).toEqual([]);
    expect(references[0].stale).toBe(true);
  });

  it("has nothing to add without a reference", () => {
    expect(referenceEntriesFor(MANIFEST, { read: () => null })).toEqual({ entries: [], references: [] });
  });

  it("leaves the cached manifest untouched", () => {
    const before = JSON.stringify(MANIFEST);
    referenceEntriesFor(MANIFEST, { read: reader([CAR_REF, TRACK_REF]) });
    expect(JSON.stringify(MANIFEST)).toBe(before);
  });
});

describe("the reference code (middleware/auth.js)", async () => {
  const { signReferenceCode, requireReferenceAccess, requireAdmin } = await import("../middleware/auth.js");
  const call = async (mw, token) => {
    let status = null;
    let passed = false;
    const res = {
      status(c) {
        status = c;
        return this;
      },
      json() {
        return this;
      },
    };
    await mw({ headers: { authorization: token ? `Bearer ${token}` : "" } }, res, () => {
      passed = true;
    });
    return { passed, status };
  };

  it("lets a code save a reference", async () => {
    expect((await call(requireReferenceAccess, signReferenceCode())).passed).toBe(true);
  });

  it("opens no other admin door", async () => {
    expect(await call(requireAdmin, signReferenceCode())).toEqual({ passed: false, status: 401 });
  });

  it("refuses a made-up code and no code at all", async () => {
    expect(await call(requireReferenceAccess, "x.y.z")).toEqual({ passed: false, status: 401 });
    expect(await call(requireReferenceAccess, null)).toEqual({ passed: false, status: 401 });
  });
});
