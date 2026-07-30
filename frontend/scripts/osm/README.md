# Vendored OpenStreetMap circuit data

Raw [Overpass API](https://overpass-api.de/) responses for 7 circuits that are
**not** in the `bacinger/f1-circuits` dataset (they're only raced in the archive
seasons / special events). `generate-circuits.mjs` reads these, stitches the
segments into one ring, and writes the outline into `src/data/circuits.js`.

Geometry © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/).
Attribution is shown in the site footer (`App.jsx`).

## How each file was fetched

These are one-off queries (like `most-osm.json`). Re-fetch only if a circuit's
mapping changes. `kind` matches the `EXTRA_TRACKS` config in the generator.

| file               | kind | Overpass query |
|--------------------|------|----------------|
| `fuji.json`        | way  | `way["highway"="raceway"](around:1600,35.3714754,138.9316382);out geom;` |
| `roadamerica.json` | way  | `way["highway"="raceway"](around:1600,43.7986,-87.9897);out geom;` |
| `zolder.json`      | way  | `way["highway"="raceway"](around:1200,50.9902369,5.2576657);out geom;` |
| `daytona.json`     | way  | `way["highway"="raceway"](around:1800,29.1840074,-81.0703186);out geom;` (tri-oval only: `embankment=yes` ways) |
| `bathurst.json`    | rel  | `rel(6942508);out geom;` — relation "Mount Panorama Circuit" (public-road circuit) |
| `lemans.json`      | rel  | `rel(2126739);out geom;` — relation "Circuit des 24 Heures du Mans" |
| `poznan.json`      | way  | `way["highway"="raceway"](52.40,16.77,52.44,16.84);out geom;`, then hand-filtered to the 24 ways of the main loop (see below) |

Poznań is the one file that is **not** the raw response: the site also holds a
karting track, a motocross course, two raceway *areas* and a paddock road named
"Depot" (the pit lane — the generator's `/pit/i` name filter doesn't catch it),
and any of those joining the chain would bend the outline. The file therefore
keeps only ways 215071407, 215071408, 172188975, 215071414, 215071437,
215071415, 215071429, 215071416, 215071417, 215071489, 215071418, 215071472,
215071419, 215071420, 215071488, 215071421, 215071450, 215071409, 215071461,
215071410, 215071411, 215071412, 215071490, 215071413 — start/finish straight,
the 14 named corners and the unnamed links between them. Every endpoint in that
set has exactly two ways on it, so the stitch closes cleanly.

`way` = a flat list of raceway segments (pit lane dropped by name). `rel` = a
route/circuit relation whose member ways are stitched (pit-lane roles dropped).

To fetch: `curl -s https://overpass-api.de/api/interpreter --data-urlencode 'data=[out:json][timeout:90];<query>' -o <file>`
then re-run `node frontend/scripts/generate-circuits.mjs`.
