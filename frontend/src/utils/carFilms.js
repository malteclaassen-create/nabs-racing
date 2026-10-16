// ---------------------------------------------------------------------------
// The films of the league's real car a driver's Season Wrapped plays: the car
// in their livery, rendered beforehand from the mod (tools/car-renders), for
// the intro, the climb and the final table (on the podium, or on the grid),
// plus a still of it for the share picture. public/cars/index.json says, per
// season, which car the league raced and, per livery, which teams (and which
// drivers, where a livery is one driver's own) ran it:
//
//   { "seasons": { "8": "formula_2010" },
//     "cars": { "formula_2010": {
//       "dir": "formula_2010/",
//       "liveries": [ { "key": "mclaren", "teams": ["mclaren_s8"], "drivers": [] },
//                     { "key": "skoda-35", "drivers": ["Endriu"], "films": "skoda" } ] } } }
//
// and the files are <dir><key>/intro.mp4, climb.mp4, podium.mp4, grid.mp4
// and still.png. A season or team that is not there gets null, and the
// story keeps its own 3D scenes.
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

export const FILMS = ["intro", "climb", "podium", "grid"];

// { intro, climb, podium, grid, still } as URLs, or null.
export async function carFilmsFor({ season, team, driver }, url = "/cars/index.json") {
  const m = await manifest(url);
  const model = m?.seasons?.[String(season)];
  const car = model && m.cars?.[model];
  if (!car?.liveries?.length) return null;
  const own =
    car.liveries.find((l) => (l.drivers || []).some((d) => norm(d) === norm(driver))) ||
    car.liveries.find((l) => (l.teams || []).includes(team));
  if (!own) return null;
  // A driver's own livery may play its team's films (`films`: that key).
  const base = new URL(`${car.dir}${own.films || own.key}/`, new URL(url, window.location.href));
  const out = { still: new URL("still.png", base).href };
  for (const f of FILMS) out[f] = new URL(`${f}.mp4`, base).href;
  return out;
}
