import { test } from "node:test";
import assert from "node:assert/strict";

// carArt.js reads the manifest with fetch and resolves its folder against the
// page; both stood in for here.
globalThis.window = { location: { href: "https://nabsracing.com/s/friday-f1/wrapped/x" } };
const MANIFEST = {
  seasons: { 8: "formula_2010" },
  cars: {
    formula_2010: {
      dir: "formula_2010/",
      scale: 0.94,
      hero: { yaws: 79 },
      field: { file: "field.webp", yaws: 16 },
      liveries: [
        { key: "mclaren", teams: ["mclaren_s8"], drivers: [], row: 0 },
        { key: "skoda", teams: ["skoda_s8"], drivers: ["Laluch"], row: 1 },
        { key: "skoda-35", teams: [], drivers: ["Endriu"], row: 1 },
        { key: "ferrari", teams: ["ferrari_s8"], drivers: [], row: 2 },
      ],
    },
  },
};
let asked = 0;
globalThis.fetch = async (url) => {
  asked += 1;
  return { ok: String(url).endsWith("/cars/index.json"), json: async () => MANIFEST };
};
const { carArtFor } = await import("./carArt.js");

test("a team's driver gets the team's livery, the grid the other teams'", async () => {
  const art = await carArtFor({ season: 8, team: "mclaren_s8", driver: "Siggsta" });
  assert.equal(art.hero, "https://nabsracing.com/cars/formula_2010/mclaren.hero.webp");
  assert.equal(art.field, "https://nabsracing.com/cars/formula_2010/field.webp");
  assert.equal(art.livery, 0);
  assert.deepEqual(art.others, [1, 2]);
  assert.equal(art.scale, 0.94);
});

test("a driver with a livery of their own gets it, matched by name", async () => {
  const art = await carArtFor({ season: 8, team: "skoda_s8", driver: " endriu " });
  assert.equal(art.hero, "https://nabsracing.com/cars/formula_2010/skoda-35.hero.webp");
  assert.equal(art.livery, 1);
  assert.deepEqual(art.others, [0, 2]);
});

test("no pictures for a season or team that has none, and the manifest is read once", async () => {
  assert.equal(await carArtFor({ season: 7, team: "mclaren", driver: "Siggsta" }), null);
  assert.equal(await carArtFor({ season: 8, team: "nobody_s8", driver: "Someone" }), null);
  assert.equal(asked, 1);
  assert.equal(await carArtFor({ season: 8, team: "mclaren_s8" }, "/missing.json"), null);
});
