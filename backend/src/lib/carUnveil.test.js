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

  it("comes off by itself at the set time", () => {
    const at = "2026-11-07T18:30:00.000Z";
    const before = Date.parse(at) - 1000;
    const after = Date.parse(at) + 1000;
    expect(carState(COVERED, at, before)).toEqual({ covered: true, unveiledAt: null, unveilAt: at });
    expect(carState(COVERED, at, after)).toEqual({ covered: false, unveiledAt: at, unveilAt: null });
    // "Unveil now" before the time wins
    expect(carState("2026-11-07T18:00:00.000Z", at, before).covered).toBe(false);
  });

  it("hands out no picture and no film while the car is covered", () => {
    const row = { carImageUrl: "/api/uploads/seasons/s9-car-ab.jpg", carVideoUrl: "/f.mp4", carUnveil: COVERED, carUnveilAt: null };
    expect(publicCar(row)).toEqual({ carImageUrl: null, carVideoUrl: null, carCovered: true, carUnveiledAt: null, carUnveilAt: null });
    const open = publicCar({ ...row, carUnveil: "2026-11-07T19:35:00.000Z" });
    expect(open.carImageUrl).toBe(row.carImageUrl);
    expect(open.carVideoUrl).toBe("/f.mp4");
    expect(publicCar({ carImageUrl: "/x.jpg" })).toEqual({ carImageUrl: "/x.jpg", carVideoUrl: null, carCovered: false, carUnveiledAt: null, carUnveilAt: null });
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
