import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { carState, publicCar, carFileName, carFilePath, renameCarFile, removeCarFile, COVERED } from "./carUnveil.js";

describe("car unveil", () => {
  it("reads the three states", () => {
    expect(carState(null)).toEqual({ covered: false, unveiledAt: null, unveilAt: null });
    expect(carState(COVERED)).toEqual({ covered: true, unveiledAt: null, unveilAt: null });
    expect(carState("2026-11-07T19:35:00.000Z").unveiledAt).toBe("2026-11-07T19:35:00.000Z");
    expect(carState("nonsense")).toEqual({ covered: false, unveiledAt: null, unveilAt: null });
  });

  it("stays covered after the countdown ends, until an admin unveils it", () => {
    const at = "2026-11-07T18:30:00.000Z";
    expect(carState(COVERED, at)).toEqual({ covered: true, unveiledAt: null, unveilAt: at });
    expect(carState("2026-11-07T18:40:00.000Z", at)).toEqual({
      covered: false,
      unveiledAt: "2026-11-07T18:40:00.000Z",
      unveilAt: null,
    });
  });

  it("hides the picture while covered and the film until it is released", () => {
    const row = {
      carImageUrl: "/api/uploads/seasons/s9-car-ab.jpg",
      carVideoUrl: "/f.mp4",
      carCoverUrl: "/cover.jpg",
      carUnveil: COVERED,
      carUnveilAt: null,
      carFilmAt: "2026-11-07T18:00:00.000Z", // a stale release does not count while covered
    };
    expect(publicCar(row)).toEqual({
      carImageUrl: null,
      carCovered: true,
      carUnveiledAt: null,
      carUnveilAt: null,
      carCoverUrl: "/cover.jpg",
      carHasFilm: true,
      carFilmAt: null,
      carVideoUrl: null,
    });
    const out = publicCar({ ...row, carUnveil: "2026-11-07T19:35:00.000Z", carFilmAt: null });
    expect(out.carImageUrl).toBe(row.carImageUrl);
    expect(out.carVideoUrl).toBe(null);
    const film = publicCar({ ...row, carUnveil: "2026-11-07T19:35:00.000Z", carFilmAt: "2026-11-07T19:40:00.000Z" });
    expect(film.carVideoUrl).toBe("/f.mp4");
    expect(film.carFilmAt).toBe("2026-11-07T19:40:00.000Z");
  });

  it("names uploads so they cannot be guessed", () => {
    const a = carFileName("s9", ".png");
    expect(a).toMatch(/^s9-car-[0-9a-f]{16}\.png$/);
    expect(carFileName("s9", ".png")).not.toBe(a);
    expect(carFileName("s9", ".mp4", "carfilm")).toMatch(/^s9-carfilm-[0-9a-f]{16}\.mp4$/);
  });

  it("moves the file when the cover goes on, so an old address stops working", () => {
    const dir = mkdtempSync(join(tmpdir(), "car-"));
    writeFileSync(join(dir, "s9-car.jpg"), "x");
    const url = renameCarFile(dir, "s9", "/api/uploads/seasons/s9-car.jpg?v=1");
    expect(url).toMatch(/^\/api\/uploads\/seasons\/s9-car-[0-9a-f]{16}\.jpg\?v=\d+$/);
    expect(existsSync(join(dir, "s9-car.jpg"))).toBe(false);
    expect(existsSync(carFilePath(dir, url))).toBe(true);
    removeCarFile(dir, url);
    expect(existsSync(carFilePath(dir, url))).toBe(false);
  });

  it("only touches files under the seasons upload folder", () => {
    expect(carFilePath("/d", "/cars/s9.jpg")).toBe(null);
    expect(carFilePath("/d", "/api/uploads/seasons/..%2F..%2Fetc%2Fpasswd")).toBe("/d/passwd");
  });
});
