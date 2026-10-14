// ---------------------------------------------------------------------------
// Which pictures of the real car a driver's Season Wrapped gets
// (utils/carImposter.js draws them). public/cars/index.json says, per
// season, which car the league raced and, per livery, which teams (and
// which drivers, where a livery is one driver's own) ran it:
//
//   { "seasons": { "8": "formula_2010" },
//     "cars": { "formula_2010": {
//       "dir": "formula_2010/", "scale": 0.94,
//       "hero": { cellW, cellH, boxW, boxH, cy, yaws, pitches, cols, rows },
//       "field": { "file": "field.webp", ...the same },
//       "liveries": [ { "key": "mclaren", "teams": ["mclaren_s8"], "drivers": [], "row": 4 } ] } } }
//
// A season or team that is not there gets null, and the scenes keep their
// own 3D car.
// ---------------------------------------------------------------------------
const manifests = new Map(); // url -> Promise<manifest | null>

function manifest(url) {
  if (!manifests.has(url)) {
    manifests.set(
      url,
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    );
  }
  return manifests.get(url);
}

const norm = (s) => String(s || "").trim().toLowerCase();

// The pictures for one driver: { hero, field (URLs), heroLayout, fieldLayout,
// livery (their row in the field atlas), others (rows for the rest of the
// grid), scale }, or null.
export async function carArtFor({ season, team, driver }, url = "/cars/index.json") {
  const m = await manifest(url);
  const model = m?.seasons?.[String(season)];
  const car = model && m.cars?.[model];
  if (!car?.liveries?.length) return null;
  const own =
    car.liveries.find((l) => (l.drivers || []).some((d) => norm(d) === norm(driver))) ||
    car.liveries.find((l) => (l.teams || []).includes(team));
  if (!own) return null;
  const base = new URL(car.dir, new URL(url, window.location.href));
  const rows = [...new Set(car.liveries.map((l) => l.row).filter((r) => Number.isInteger(r)))];
  return {
    hero: new URL(`${own.key}.hero.webp`, base).href,
    field: new URL(car.field.file, base).href,
    heroLayout: car.hero,
    fieldLayout: car.field,
    livery: own.row,
    others: rows.filter((r) => r !== own.row),
    scale: car.scale || 1,
  };
}
