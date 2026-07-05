// Generates frontend/src/data/circuits.js with REAL circuit outlines.
//
// Sources:
//   * F1 circuits -> bacinger/f1-circuits (MIT), derived from OpenStreetMap.
//   * Most (cz)   -> OpenStreetMap way "Autodrom Most" (id 60905520), vendored.
//   * 6 non-F1 tracks (Fuji, Road America, Zolder, Daytona, Bathurst, Le Mans)
//     -> raw Overpass responses vendored in frontend/scripts/osm/. These circuits
//     are mapped in OSM as many named corner/straight segments (or a route
//     relation), so we stitch the segments end-to-end into one ring (see stitch()).
//
// Geometry is © OpenStreetMap contributors (ODbL). The outlines below are
// projected + normalized copies of that data — attribution is shown in the app.
//
// We include the WHOLE f1-circuits set (not just the tracks we currently race)
// so any circuit an admin schedules — now or in a future season — already has an
// outline. The resolver at the bottom (circuitFor / canonicalTrack) then maps the
// many ways a track gets named (country name, ALL-CAPS, Assetto Corsa id, a
// "… 2.5" layout suffix) onto the right entry, so archive seasons resolve too.
//
// Re-run:  node frontend/scripts/generate-circuits.mjs
// (Needs the f1-circuits geojson + the vendored most-osm.json next to this file.)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "src", "data", "circuits.js");

// Source data. The f1-circuits geojson is large; point this at a local clone
// of github.com/bacinger/f1-circuits (override with F1_GEOJSON env var).
// The Most circuit is vendored in-repo (one-off Overpass query) for reproducibility.
const F1_GEOJSON = process.env.F1_GEOJSON || "C:/Users/malte/Downloads/f1-circuits-master/f1-circuits.geojson";
const MOST_OVERPASS = path.join(__dirname, "most-osm.json");
const OSM_DIR = path.join(__dirname, "osm");

// Our track key -> { geojson Name to match (or vendored osm way), country meta }.
// Keys are the canonical, tidy names; the resolver maps everything else onto them.
// The first 12 keys are the ones the live seasons use — keep their names stable.
const TRACKS = {
  // --- circuits the current/recent seasons race on -------------------------
  Melbourne:   { match: "Albert Park Circuit",                     country: "au", countryName: "Australia",            circuit: "Albert Park" },
  Mugello:     { match: "Autodromo Internazionale del Mugello",    country: "it", countryName: "Italy",                circuit: "Mugello" },
  Most:        { osm: 60905520,                                    country: "cz", countryName: "Czechia",              circuit: "Autodrom Most" },
  Bahrain:     { match: "Bahrain International Circuit",            country: "bh", countryName: "Bahrain",              circuit: "Sakhir" },
  Monza:       { match: "Autodromo Nazionale Monza",               country: "it", countryName: "Italy",                circuit: "Autodromo di Monza" },
  Jeddah:      { match: "Jeddah Corniche Circuit",                 country: "sa", countryName: "Saudi Arabia",         circuit: "Jeddah Corniche" },
  Nurburgring: { match: "Nürburgring",                             country: "de", countryName: "Germany",              circuit: "Nürburgring" },
  Spa:         { match: "Circuit de Spa-Francorchamps",            country: "be", countryName: "Belgium",              circuit: "Spa-Francorchamps" },
  Imola:       { match: "Autodromo Enzo e Dino Ferrari",           country: "it", countryName: "Italy",                circuit: "Imola" },
  Turkey:      { match: "Intercity Istanbul Park",                 country: "tr", countryName: "Türkiye",              circuit: "Istanbul Park" },
  COTA:        { match: "Circuit of the Americas",                 country: "us", countryName: "United States",        circuit: "Circuit of the Americas" },
  Interlagos:  { match: "Autódromo José Carlos Pace - Interlagos", country: "br", countryName: "Brazil",               circuit: "Interlagos" },

  // --- the rest of the f1-circuits set (archive seasons + future-proofing) --
  RedBullRing: { match: "Red Bull Ring",                          country: "at", countryName: "Austria",              circuit: "Red Bull Ring" },
  Baku:        { match: "Baku City Circuit",                      country: "az", countryName: "Azerbaijan",           circuit: "Baku City" },
  Barcelona:   { match: "Circuit de Barcelona-Catalunya",         country: "es", countryName: "Spain",                circuit: "Barcelona-Catalunya" },
  Montreal:    { match: "Circuit Gilles-Villeneuve",              country: "ca", countryName: "Canada",               circuit: "Gilles-Villeneuve" },
  Monaco:      { match: "Circuit de Monaco",                      country: "mc", countryName: "Monaco",               circuit: "Monaco" },
  MagnyCours:  { match: "Circuit de Nevers Magny-Cours",          country: "fr", countryName: "France",               circuit: "Magny-Cours" },
  PaulRicard:  { match: "Circuit Paul Ricard",                    country: "fr", countryName: "France",               circuit: "Paul Ricard" },
  Zandvoort:   { match: "Circuit Zandvoort",                      country: "nl", countryName: "Netherlands",          circuit: "Zandvoort" },
  Hockenheim:  { match: "Hockenheimring",                         country: "de", countryName: "Germany",              circuit: "Hockenheimring" },
  Hungaroring: { match: "Hungaroring",                            country: "hu", countryName: "Hungary",              circuit: "Hungaroring" },
  Silverstone: { match: "Silverstone Circuit",                    country: "gb", countryName: "United Kingdom",       circuit: "Silverstone" },
  Suzuka:      { match: "Suzuka International Racing Course",      country: "jp", countryName: "Japan",                circuit: "Suzuka" },
  Sepang:      { match: "Sepang International Circuit",           country: "my", countryName: "Malaysia",             circuit: "Sepang" },
  Singapore:   { match: "Marina Bay Street Circuit",             country: "sg", countryName: "Singapore",            circuit: "Marina Bay" },
  Shanghai:    { match: "Shanghai International Circuit",         country: "cn", countryName: "China",                circuit: "Shanghai" },
  Sochi:       { match: "Sochi Autodrom",                        country: "ru", countryName: "Russia",               circuit: "Sochi" },
  Kyalami:     { match: "Kyalami Grand Prix Circuit",            country: "za", countryName: "South Africa",         circuit: "Kyalami" },
  Miami:       { match: "Miami International Autodrome",         country: "us", countryName: "United States",        circuit: "Miami" },
  LasVegas:    { match: "Las Vegas Street Circuit",             country: "us", countryName: "United States",        circuit: "Las Vegas" },
  Indianapolis:{ match: "Indianapolis Motor Speedway",         country: "us", countryName: "United States",        circuit: "Indianapolis" },
  WatkinsGlen: { match: "Watkins Glen International",           country: "us", countryName: "United States",        circuit: "Watkins Glen" },
  Mexico:      { match: "Autódromo Hermanos Rodríguez",        country: "mx", countryName: "Mexico",               circuit: "Hermanos Rodríguez" },
  Losail:      { match: "Losail International Circuit",         country: "qa", countryName: "Qatar",                circuit: "Lusail" },
  YasMarina:   { match: "Yas Marina Circuit",                  country: "ae", countryName: "United Arab Emirates", circuit: "Yas Marina" },
  Portimao:    { match: "Autódromo Internacional do Algarve",  country: "pt", countryName: "Portugal",             circuit: "Algarve" },
  Estoril:     { match: "Autódromo do Estoril",               country: "pt", countryName: "Portugal",             circuit: "Estoril" },
  BuenosAires: { match: "Autódromo Oscar y Juan Gálvez",      country: "ar", countryName: "Argentina",            circuit: "Buenos Aires" },
  Jacarepagua: { match: "Autódromo Internacional Nelson Piquet", country: "br", countryName: "Brazil",            circuit: "Jacarepaguá" },
  Madrid:      { match: "Circuito de Madring",                country: "es", countryName: "Spain",                circuit: "Madring" },
};

// Non-F1 circuits raced only in the archive / special events. Not in f1-circuits,
// so we vendor a raw Overpass response per track (frontend/scripts/osm/<key>.json)
// and stitch its segments into a ring. `kind`: "way" = a flat list of raceway ways
// (drop pit lane by name); "rel" = a route/circuit relation (drop pit-lane roles).
// `keep` optionally narrows the segments (Daytona: the banked tri-oval only).
const EXTRA_TRACKS = {
  Fuji:        { file: "fuji.json",        kind: "way", country: "jp", countryName: "Japan",         circuit: "Fuji Speedway" },
  RoadAmerica: { file: "roadamerica.json", kind: "way", country: "us", countryName: "United States", circuit: "Road America" },
  Zolder:      { file: "zolder.json",      kind: "way", country: "be", countryName: "Belgium",       circuit: "Zolder" },
  Bathurst:    { file: "bathurst.json",    kind: "rel", country: "au", countryName: "Australia",     circuit: "Mount Panorama" },
  LeMans:      { file: "lemans.json",      kind: "rel", country: "fr", countryName: "France",        circuit: "Circuit de la Sarthe" },
  // Daytona is an oval + an intertwined road course; use the iconic banked tri-oval.
  Daytona:     { file: "daytona.json",     kind: "way", country: "us", countryName: "United States", circuit: "Daytona",
                 keep: (w) => w.tags.embankment === "yes" },
};

// Extra spellings a stored track name might use, mapped onto a canonical key.
// This is what lets archive seasons resolve — they name rounds by COUNTRY or in
// ALL-CAPS. Keys here are matched case-insensitively AND after normalization
// (lowercased, non-alphanumerics stripped), so "United States" and "united_states"
// both hit. Only list what normalization + the "startsWith" fallback can't do on
// their own (mainly country names, and disambiguating a country with several tracks).
const ALIASES = {
  // country name -> the track that country raced (archive rounds named by country)
  australia: "Melbourne",
  austria: "RedBullRing",
  "red bull ring": "RedBullRing",
  azerbaijan: "Baku",
  spain: "Barcelona",
  japan: "Suzuka",
  malaysia: "Sepang",
  canada: "Montreal",
  netherlands: "Zandvoort",
  holland: "Zandvoort",
  dutch: "Zandvoort",
  china: "Shanghai",
  hungary: "Hungaroring",
  qatar: "Losail",
  "abu dhabi": "YasMarina",
  "saudi arabia": "Jeddah",
  belgium: "Spa",
  brazil: "Interlagos",
  "south africa": "Kyalami",
  russia: "Sochi",
  argentina: "BuenosAires",
  portugal: "Portimao",
  britain: "Silverstone",
  "great britain": "Silverstone",
  england: "Silverstone",
  uk: "Silverstone",
  // Ambiguous countries with several tracks -> pick the iconic/most-used venue.
  italy: "Monza",
  "united states": "COTA",
  usa: "COTA",
  america: "COTA",
  mexico: "Mexico",
  // common Assetto Corsa ids / alternate spellings
  istanbul_park: "Turkey",
  istanbul: "Turkey",
  fn_imola: "Imola",
  ks_imola: "Imola",
  ks_barcelona: "Barcelona",
  ks_silverstone: "Silverstone",
  ks_nurburgring: "Nurburgring",
  ks_red_bull_ring: "RedBullRing",
  rbr: "RedBullRing",
  marina_bay: "Singapore",
  gilles_villeneuve: "Montreal",
  baku_city: "Baku",
  sarthe: "LeMans",
  "circuit de la sarthe": "LeMans",
  "mount panorama": "Bathurst",
  "fuji speedway": "Fuji",
};

// --- helpers ---------------------------------------------------------------

// Project [lon,lat] degrees -> planar metres-ish (equirectangular, lat-corrected),
// then normalize into a viewBox whose largest side is ~100 with padding.
function toPath(coords) {
  const meanLat = (coords.reduce((a, c) => a + c[1], 0) / coords.length) * (Math.PI / 180);
  const k = Math.cos(meanLat);
  const pts = coords.map(([lon, lat]) => [lon * k, lat]);

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1e-9;
  const spanY = maxY - minY || 1e-9;

  const D = 100, pad = 6;
  const scale = (D - 2 * pad) / Math.max(spanX, spanY);
  const W = +(spanX * scale + 2 * pad).toFixed(1);
  const H = +(spanY * scale + 2 * pad).toFixed(1);

  let d = "";
  let prev = null;
  for (const [x, y] of pts) {
    const px = +(pad + (x - minX) * scale).toFixed(1);
    const py = +(pad + (maxY - y) * scale).toFixed(1); // flip Y for SVG
    if (prev && prev[0] === px && prev[1] === py) continue; // drop dupes
    d += (d ? " L" : "M") + px + "," + py;
    prev = [px, py];
  }
  d += " Z";
  return { d, box: `0 0 ${W} ${H}` };
}

// Stitch OSM raceway segments into one ordered ring. A circuit is mapped as many
// short ways (one per corner/straight) that share endpoint coordinates; we chain
// them by matching those endpoints, flipping orientation as needed, and keep the
// longest chain (the main loop). `kind` "rel" pulls member ways from a relation.
function endpointKey(p) { return p.lat.toFixed(7) + "," + p.lon.toFixed(7); }

function loadWays(file, kind) {
  const j = JSON.parse(fs.readFileSync(path.join(OSM_DIR, file), "utf8"));
  if (kind === "rel") {
    const rel = j.elements.find((e) => e.type === "relation");
    return rel.members
      .filter((m) => m.type === "way" && m.geometry)
      .map((m) => ({ geometry: m.geometry, tags: {}, role: m.role || "" }));
  }
  return j.elements
    .filter((e) => e.type === "way" && e.geometry)
    .map((e) => ({ geometry: e.geometry, tags: e.tags || {}, role: "" }));
}

function stitch(ways) {
  const segs = ways.map((w) => w.geometry.map((g) => ({ lat: g.lat, lon: g.lon })));
  const endpoints = new Map();
  segs.forEach((s, i) => {
    for (const p of [s[0], s[s.length - 1]]) {
      const k = endpointKey(p);
      if (!endpoints.has(k)) endpoints.set(k, []);
      endpoints.get(k).push(i);
    }
  });
  const used = new Array(segs.length).fill(false);
  const next = (k) => (endpoints.get(k) || []).filter((i) => !used[i]);

  function walk(start) {
    const chain = segs[start].slice();
    used[start] = true;
    for (let ext = true; ext; ) {
      ext = false;
      const tail = chain[chain.length - 1];
      const c = next(endpointKey(tail));
      if (c.length) {
        const s = segs[(used[c[0]] = true, c[0])];
        chain.push(...(endpointKey(s[0]) === endpointKey(tail) ? s.slice(1) : s.slice(0, -1).reverse()));
        ext = true;
      }
    }
    for (let ext = true; ext; ) {
      ext = false;
      const head = chain[0];
      const c = next(endpointKey(head));
      if (c.length) {
        const s = segs[(used[c[0]] = true, c[0])];
        chain.unshift(...(endpointKey(s[s.length - 1]) === endpointKey(head) ? s.slice(0, -1) : s.slice(1).reverse()));
        ext = true;
      }
    }
    return chain;
  }

  let best = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const c = walk(i);
    if (c.length > best.length) best = c;
  }
  return best.map((p) => [p.lon, p.lat]);
}

// --- load sources ----------------------------------------------------------

const f1 = JSON.parse(fs.readFileSync(F1_GEOJSON, "utf8"));
const byName = new Map();
for (const f of f1.features) {
  const name = f.properties?.Name || f.properties?.name;
  if (name && f.geometry?.type === "LineString") byName.set(name, f.geometry.coordinates);
}

let mostCoords = null;
if (fs.existsSync(MOST_OVERPASS)) {
  const o = JSON.parse(fs.readFileSync(MOST_OVERPASS, "utf8"));
  const w = o.elements.find((e) => e.type === "way" && e.id === 60905520);
  if (w) mostCoords = w.geometry.map((g) => [g.lon, g.lat]);
}

// --- build -----------------------------------------------------------------

const out = {};
for (const [key, t] of Object.entries(TRACKS)) {
  let coords;
  if (t.osm) coords = mostCoords;
  else coords = byName.get(t.match);
  if (!coords) {
    console.warn("MISSING geometry for", key, t.match || t.osm);
    continue;
  }
  const { d, box } = toPath(coords);
  out[key] = { country: t.country, countryName: t.countryName, circuit: t.circuit, box, path: d };
}

// stitched non-F1 circuits (vendored Overpass responses)
for (const [key, t] of Object.entries(EXTRA_TRACKS)) {
  const src = path.join(OSM_DIR, t.file);
  if (!fs.existsSync(src)) {
    console.warn("MISSING osm file for", key, t.file);
    continue;
  }
  let ways = loadWays(t.file, t.kind);
  ways = ways.filter((w) => !/pit/i.test(w.tags.name || w.role || "")); // drop pit lane
  if (t.keep) ways = ways.filter(t.keep);
  const coords = stitch(ways);
  if (coords.length < 4) {
    console.warn("EMPTY stitch for", key);
    continue;
  }
  const { d, box } = toPath(coords);
  out[key] = { country: t.country, countryName: t.countryName, circuit: t.circuit, box, path: d };
}

// --- write -----------------------------------------------------------------

const header = `// REAL circuit outlines — DO NOT EDIT BY HAND.
// Generated by frontend/scripts/generate-circuits.mjs
// Geometry © OpenStreetMap contributors (ODbL); F1 circuits via bacinger/f1-circuits (MIT).
// Keyed by a tidy canonical name; circuitFor() below resolves the many ways a
// stored track gets named (country, ALL-CAPS, AC id, "… 2.5" suffix) onto a key.
`;

let body = "export const CIRCUITS = {\n";
for (const [key, c] of Object.entries(out)) {
  body += `  ${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: {\n`;
  body += `    country: ${JSON.stringify(c.country)},\n`;
  body += `    countryName: ${JSON.stringify(c.countryName)},\n`;
  body += `    circuit: ${JSON.stringify(c.circuit)},\n`;
  body += `    box: ${JSON.stringify(c.box)},\n`;
  body += `    path: ${JSON.stringify(c.path)},\n`;
  body += `  },\n`;
}
body += "};\n";

// Resolver — emitted here so it survives regeneration (previously it was a
// trivial lookup that got hand-patched and clobbered on every re-run).
const resolver = `
// Raw track strings (Assetto Corsa ids, country names, alternate spellings) ->
// canonical CIRCUITS key. Matched case-insensitively and after normalization.
const TRACK_ALIASES = ${JSON.stringify(ALIASES, null, 2)};

// lowercase + strip everything that isn't a letter or digit, so "United States",
// "united_states" and "UNITED STATES" all collapse to the same token.
function normKey(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Alias table normalized once, so "red bull ring" also matches "RED BULL RING".
const NORM_ALIASES = {};
for (const k in TRACK_ALIASES) NORM_ALIASES[normKey(k)] = TRACK_ALIASES[k];

// Circuit keys sorted longest-first, so a "startsWith" test prefers the most
// specific match (e.g. "watkinsglen25" -> WatkinsGlen, never a shorter key).
const NORM_KEYS = Object.keys(CIRCUITS)
  .map((key) => ({ key, nk: normKey(key), cnk: normKey(CIRCUITS[key].circuit) }))
  .sort((a, b) => b.nk.length - a.nk.length);

export function circuitFor(track) {
  if (!track) return null;
  if (CIRCUITS[track]) return CIRCUITS[track];

  const n = normKey(track);

  // explicit alias (country name / AC id / alt spelling)
  const alias = TRACK_ALIASES[track] || TRACK_ALIASES[String(track).toLowerCase()] || NORM_ALIASES[n];
  if (alias && CIRCUITS[alias]) return CIRCUITS[alias];

  // exact normalized match against a key or the circuit's real name
  for (const c of NORM_KEYS) {
    if (c.nk === n || c.cnk === n) return CIRCUITS[c.key];
  }

  // layout-suffix match: "Watkins Glen 2.5", "Monza GP", "Suzuka East" all begin
  // with the circuit token. Guard on length >= 5 so short keys (Spa, Most, COTA)
  // can't swallow unrelated names ("spain" must not become "Spa").
  for (const c of NORM_KEYS) {
    if (c.nk.length >= 5 && (n.startsWith(c.nk) || n.startsWith(c.cnk))) return CIRCUITS[c.key];
  }
  return null;
}

// Resolve a raw track string to its clean canonical name ("istanbul_park" ->
// "Turkey"). Used at import time so stored race names stay tidy. Unknown tracks
// are returned unchanged for the admin to edit.
export function canonicalTrack(track) {
  if (!track) return track;
  if (CIRCUITS[track]) return track;
  const n = normKey(track);
  const alias = TRACK_ALIASES[track] || TRACK_ALIASES[String(track).toLowerCase()] || NORM_ALIASES[n];
  if (alias && CIRCUITS[alias]) return alias;
  for (const c of NORM_KEYS) {
    if (c.nk === n || c.cnk === n) return c.key;
  }
  for (const c of NORM_KEYS) {
    if (c.nk.length >= 5 && (n.startsWith(c.nk) || n.startsWith(c.cnk))) return c.key;
  }
  return track;
}
`;

fs.writeFileSync(OUT, header + "\n" + body + resolver);
console.log("Wrote", Object.keys(out).length, "circuits ->", OUT);
