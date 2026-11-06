import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { carState, publicCar, carFileName, carFilePath, renameCarFile, removeCarFile, COVERED } from "./carUnveil.js";

describe("car unveil", () => {
  it("reads the three states", () => {
    expect(carState(null)).toEqual({ covered: false, unveiledAt: null });
    expect(carState(COVERED)).toEqual({ covered: true, unveiledAt: null });
    expect(carState("2026-11-07T19:35:00.000Z")).toEqual({ covered: false, unveiledAt: "2026-11-07T19:35:00.000Z" });
    expect(carState("nonsense")).toEqual({ covered: false, unveiledAt: null });
  });

  it("hands out no picture while the car is covered", () => {
    expect(publicCar("/api/uploads/seasons/s9-car-ab.jpg", COVERED)).toEqual({
      carImageUrl: null,
      carCovered: true,
      carUnveiledAt: null,
    });
    expect(publicCar("/x.jpg", "2026-11-07T19:35:00.000Z").carImageUrl).toBe("/x.jpg");
    expect(publicCar("/x.jpg", null)).toEqual({ carImageUrl: "/x.jpg", carCovered: false, carUnveiledAt: null });
  });

  it("names uploads so they cannot be guessed", () => {
    const a = carFileName("s9", ".png");
    expect(a).toMatch(/^s9-car-[0-9a-f]{16}\.png$/);
    expect(carFileName("s9", ".png")).not.toBe(a);
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
