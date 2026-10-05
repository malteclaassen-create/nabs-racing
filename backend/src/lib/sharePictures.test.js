import { describe, it, expect } from "vitest";
import { drawnPageOf } from "./sharePictures.js";

describe("drawnPageOf", () => {
  it("knows the landing page under all its addresses", () => {
    expect(drawnPageOf("/")).toEqual({ page: "home", slug: null });
    expect(drawnPageOf("/join")).toEqual({ page: "home", slug: null });
    expect(drawnPageOf("/s/friday-f1")).toEqual({ page: "home", slug: "friday-f1" });
    expect(drawnPageOf("/s/friday-f1/")).toEqual({ page: "home", slug: "friday-f1" });
  });

  it("folds the second names of a page onto the first", () => {
    expect(drawnPageOf("/s/friday-f1/results")).toEqual({ page: "races", slug: "friday-f1" });
    expect(drawnPageOf("/s/friday-f1/calendar")).toEqual({ page: "races", slug: "friday-f1" });
    expect(drawnPageOf("/s/friday-f1/teams")).toEqual({ page: "constructors", slug: "friday-f1" });
    expect(drawnPageOf("/s/friday-f1/live")).toEqual({ page: "live", slug: "friday-f1" });
  });

  it("leaves a driver's or a team's own page, and site-wide pages, alone", () => {
    expect(drawnPageOf("/s/friday-f1/drivers/13bot")).toBeNull();
    expect(drawnPageOf("/s/friday-f1/teams/renault")).toBeNull();
    expect(drawnPageOf("/s/friday-f1/nonsense")).toBeNull();
    expect(drawnPageOf("/downloads")).toBeNull();
    expect(drawnPageOf("/admin")).toBeNull();
  });
});
