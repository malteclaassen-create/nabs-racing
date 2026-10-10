import { describe, it, expect } from "vitest";
import { sanitizeRaceInfo } from "./raceInfo.js";

describe("sanitizeRaceInfo: the New here? hint", () => {
  it("keeps the hint the admin wrote", () => {
    const out = sanitizeRaceInfo({ subtitle: "Hi", newHere: "  **New here?** Read 01 first.  " });
    expect(out.newHere).toBe("**New here?** Read 01 first.");
  });

  it("keeps an empty hint, which hides it on the page", () => {
    expect(sanitizeRaceInfo({ newHere: "" }).newHere).toBe("");
  });

  it("leaves the key out of content saved before the hint was editable", () => {
    const out = sanitizeRaceInfo({ subtitle: "Hi" });
    expect("newHere" in out).toBe(false);
  });

  it("caps the length", () => {
    expect(sanitizeRaceInfo({ newHere: "x".repeat(1000) }).newHere).toHaveLength(400);
  });
});
