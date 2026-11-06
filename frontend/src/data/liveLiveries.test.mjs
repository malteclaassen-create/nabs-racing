import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countryFor } from "./driverCountries.js";
import { liveryLabel, makeDriverMatcher, withLiveries } from "./liveTiming.js";

describe("countryFor on a row id", () => {
  it("finds the baseline flag behind every way a row id is spelled", () => {
    for (const id of ["rashford", "rashford_s8", "rashford_2", "rashford_s1_s2_s3", "s4_rashford", "rashford_s8_ab12"]) {
      assert.equal(countryFor(id), "pl");
    }
  });

  it("still lets the row's own country win", () => {
    assert.equal(countryFor("rashford_2", "gb"), "gb");
  });
});

describe("liveryLabel", () => {
  it("uses the name the sign-up page gives the car's own skins", () => {
    assert.equal(liveryLabel("light_hyperion_67", "Hyperion 2020"), "Light");
  });

  it("makes a folder name readable", () => {
    assert.equal(liveryLabel("Gears-of-War-Special", "Hyperion 2020"), "Gears of War Special");
    assert.equal(liveryLabel("SHR-14_Rush", "Hyperion 2020"), "SHR 14 Rush");
    assert.equal(liveryLabel("whatsapp", "Hyperion 2020"), "Whatsapp");
    assert.equal(liveryLabel("No. 48 Alex Bowman", "Hyperion 2020"), "No. 48 Alex Bowman");
  });
});

describe("withLiveries", () => {
  const roster = [{ name: "Reserve", color: "#64748b", drivers: [{ id: "pizd_2", name: "Pizd", country: "gb" }] }];
  const car = { name: "Pizd", driverIds: ["pizd_2"], carModel: "hyperion", carName: "Hyperion 2020", carSkin: "No. 48 Alex Bowman" };
  const colors = { "hyperion/No. 48 Alex Bowman": "#8a29b8" };
  const imageOf = (c, s) => `/img/${c}/${s}`;
  const match = withLiveries(makeDriverMatcher(roster), colors, imageOf);

  it("puts the car where the team was and leaves the person alone", () => {
    const m = match(car);
    assert.equal(m.teamColor, "#8a29b8");
    assert.equal(m.teamName, "No. 48 Alex Bowman");
    assert.equal(m.liveryImage, "/img/hyperion/No. 48 Alex Bowman");
    assert.equal(m.nabsName, "Pizd");
    assert.equal(m.country, "gb");
  });

  it("hands out the same object every time, or every snapshot would look like a change", () => {
    assert.equal(match(car), match({ ...car }));
  });

  it("dresses a guest who is not on the roster", () => {
    const m = match({ ...car, name: "Somebody Else", driverIds: [] });
    assert.equal(m.teamColor, "#8a29b8");
    assert.equal(m.nabsName, undefined);
  });

  it("drops the word Reserve even before the colours are in", () => {
    const m = withLiveries(makeDriverMatcher(roster), {}, imageOf)(car);
    assert.equal(m.teamName, "No. 48 Alex Bowman");
    assert.equal(m.teamColor, "#64748b");
    assert.equal(m.liveryImage, null);
  });

  it("leaves the pace car and a bare name as the roster has them", () => {
    assert.equal(match({ ...car, isSafetyCar: true }).teamName, "Reserve");
    assert.equal(match("Pizd").teamName, "Reserve");
  });
});
