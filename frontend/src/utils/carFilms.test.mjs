import { test } from "node:test";
import assert from "node:assert/strict";

// carFilms.js reads the manifest with fetch and resolves its folder against
// the page; both stood in for here.
globalThis.window = { location: { href: "https://nabsracing.com/s/friday-f1/wrapped/x" } };
const MANIFEST = {
  seasons: { 8: "formula_2010" },
  cars: {
    formula_2010: {
      dir: "formula_2010/",
      liveries: [
        { key: "mclaren", teams: ["mclaren_s8"], drivers: [] },
        { key: "skoda", teams: ["skoda_s8"], drivers: ["Laluch"] },
        { key: "skoda-35", teams: [], drivers: ["Endriu"], films: "skoda" },
        { key: "axn-69", teams: [], drivers: ["Justyn"] },
      ],
    },
  },
};
let asked = 0;
globalThis.fetch = async (url) => {
  asked += 1;
  return { ok: String(url).endsWith("/cars/index.json"), json: async () => MANIFEST };
};
const { carFilmsFor } = await import("./carFilms.js");

test("a team's driver gets the team's films", async () => {
  const films = await carFilmsFor({ season: 8, team: "mclaren_s8", driver: "Siggsta" });
  assert.equal(films.intro, "https://nabsracing.com/cars/formula_2010/mclaren/intro.mp4");
  assert.equal(films.climb, "https://nabsracing.com/cars/formula_2010/mclaren/climb.mp4");
  assert.equal(films.podium, "https://nabsracing.com/cars/formula_2010/mclaren/podium.mp4");
  assert.equal(films.grid, "https://nabsracing.com/cars/formula_2010/mclaren/grid.mp4");
  assert.equal(films.still, "https://nabsracing.com/cars/formula_2010/mclaren/still.png");
});

test("a driver with a livery of their own gets it, matched by name, or their team's films", async () => {
  const own = await carFilmsFor({ season: 8, team: "axn_s8", driver: "justyn" });
  assert.equal(own.intro, "https://nabsracing.com/cars/formula_2010/axn-69/intro.mp4");
  const team = await carFilmsFor({ season: 8, team: "skoda_s8", driver: " endriu " });
  assert.equal(team.intro, "https://nabsracing.com/cars/formula_2010/skoda/intro.mp4");
});

test("none for a season or team that has none, and the manifest is read once", async () => {
  assert.equal(await carFilmsFor({ season: 7, team: "mclaren", driver: "Siggsta" }), null);
  assert.equal(await carFilmsFor({ season: 8, team: "nobody_s8", driver: "Someone" }), null);
  assert.equal(asked, 1);
  assert.equal(await carFilmsFor({ season: 8, team: "mclaren_s8" }, "/missing.json"), null);
});
