// Generates frontend/src/data/circuits.js with REAL circuit outlines.
//
// Sources:
//   * 11 circuits  -> bacinger/f1-circuits (MIT), derived from OpenStreetMap.
//   * Most (cz)    -> OpenStreetMap way "Autodrom Most" (id 60905520).
//
// Geometry is © OpenStreetMap contributors (ODbL). The outlines below are
// projected + normalized copies of that data — attribution is shown in the app.
//
// Re-run:  node frontend/scripts/generate-circuits.mjs
// (Needs the f1-circuits geojson + an Overpass response for Most; paths below.)

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

// Our track key -> { geojson Name to match, country meta }.
const TRACKS = {
  Melbourne:   { match: "Albert Park Circuit",                    country: "au", countryName: "Australia",     circuit: "Albert Park" },
  Mugello:     { match: "Autodromo Internazionale del Mugello",   country: "it", countryName: "Italy",         circuit: "Mugello" },
  Most:        { osm: 60905520,                                   country: "cz", countryName: "Czechia",       circuit: "Autodrom Most" },
  Bahrain:     { match: "Bahrain International Circuit",           country: "bh", countryName: "Bahrain",       circuit: "Sakhir" },
  Monza:       { match: "Autodromo Nazionale Monza",              country: "it", countryName: "Italy",         circuit: "Autodromo di Monza" },
  Jeddah:      { match: "Jeddah Corniche Circuit",                country: "sa", countryName: "Saudi Arabia",  circuit: "Jeddah Corniche" },
  Nurburgring: { match: "Nürburgring",                            country: "de", countryName: "Germany",       circuit: "Nürburgring" },
  Spa:         { match: "Circuit de Spa-Francorchamps",           country: "be", countryName: "Belgium",       circuit: "Spa-Francorchamps" },
  Imola:       { match: "Autodromo Enzo e Dino Ferrari",          country: "it", countryName: "Italy",         circuit: "Imola" },
  Turkey:      { match: "Intercity Istanbul Park",                country: "tr", countryName: "Türkiye",       circuit: "Istanbul Park" },
  COTA:        { match: "Circuit of the Americas",                country: "us", countryName: "United States", circuit: "Circuit of the Americas" },
  Interlagos:  { match: "Autódromo José Carlos Pace - Interlagos", country: "br", countryName: "Brazil",       circuit: "Interlagos" },
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

// --- write -----------------------------------------------------------------

const header = `// REAL circuit outlines — DO NOT EDIT BY HAND.
// Generated by frontend/scripts/generate-circuits.mjs
// Geometry © OpenStreetMap contributors (ODbL); 11 circuits via bacinger/f1-circuits (MIT).
// Keyed by the seed \`track\` string (backend/prisma/seed.js).
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
body += "};\n\nexport function circuitFor(track) {\n  if (!track) return null;\n  return CIRCUITS[track] || null;\n}\n";

fs.writeFileSync(OUT, header + "\n" + body);
console.log("Wrote", Object.keys(out).length, "circuits ->", OUT);
