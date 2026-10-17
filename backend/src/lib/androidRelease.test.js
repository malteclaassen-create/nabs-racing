import { describe, it, expect } from "vitest";
import { parseRelease, androidRelease } from "./androidRelease.js";

describe("parseRelease", () => {
  it("reads the version the app is built with", () => {
    expect(parseRelease('{ "versionCode": 3, "versionName": "1.2" }')).toEqual({ versionCode: 3, versionName: "1.2" });
  });

  it("says nothing rather than something wrong", () => {
    expect(parseRelease("")).toBe(null);
    expect(parseRelease("{")).toBe(null);
    expect(parseRelease('{ "versionCode": 0, "versionName": "1.0" }')).toBe(null);
    expect(parseRelease('{ "versionCode": 1.5, "versionName": "1.0" }')).toBe(null);
    expect(parseRelease('{ "versionCode": 2 }')).toBe(null);
  });
});

describe("androidRelease", () => {
  it("reads android/release.json from the repository", () => {
    const r = androidRelease();
    expect(r.versionCode).toBeGreaterThanOrEqual(1);
    expect(r.url).toMatch(/nabs-racing\.apk$/);
  });
});
