// ---------------------------------------------------------------------------
// What kind of circuit a track is, and what its corners are called.
//
// Two small things the site cannot measure on its own, kept with the rest of
// the per-circuit extras in the track info blob (lib/trackInfo.js):
//
//   types    Up to three of the six kinds below. They are what the driver
//            profile's track strengths are grouped by: a driver's results at
//            every "high-speed" circuit, against the ones at every "street"
//            circuit. null = never set by an admin, and the circuit then
//            carries the league's default reading of it (DEFAULT_TYPES), so
//            the feature works on day one; an admin's pick replaces it, and an
//            empty pick means "no type" on purpose.
//
//   corners  Named corners, each at a position in the lap (percent of the lap
//            from the start/finish line, the same figure the lap comparison
//            shows for a slow section). The driving tips put the name on the
//            section that sits there ("T4 Roggia" instead of "section 3").
//            null = never set, and the circuit carries its default names
//            (DEFAULT_CORNERS, measured on the circuit outlines) where the
//            site knows them; an admin's list replaces them.
// ---------------------------------------------------------------------------

export const TRACK_TYPES = [
  { key: "highspeed", label: "High-speed", hint: "fast corners taken at full commitment" },
  { key: "braking", label: "Heavy braking", hint: "big stops into slow corners" },
  { key: "power", label: "Power", hint: "long straights, top speed and traction" },
  { key: "flowing", label: "Flowing", hint: "one corner running into the next, elevation" },
  { key: "technical", label: "Technical", hint: "slow and medium corners in sequence" },
  { key: "street", label: "Street", hint: "walls close by, little run-off" },
];
const TYPE_KEYS = new Set(TRACK_TYPES.map((t) => t.key));
export const MAX_TYPES = 3;

// The default reading of every circuit the site knows by name (the keys of
// lib/trackKeys.js). A starting point, not a verdict: the admin Tracks tab
// replaces it per circuit.
export const DEFAULT_TYPES = {
  Melbourne: ["street", "flowing"],
  Mugello: ["highspeed", "flowing"],
  Most: ["technical"],
  Bahrain: ["braking", "power"],
  Monza: ["power", "braking"],
  Jeddah: ["street", "highspeed"],
  Nurburgring: ["technical"],
  Spa: ["highspeed", "flowing"],
  Imola: ["flowing", "technical"],
  Turkey: ["highspeed", "flowing"],
  COTA: ["technical", "flowing"],
  Interlagos: ["flowing"],
  RedBullRing: ["power", "braking"],
  Baku: ["street", "power"],
  Barcelona: ["technical", "highspeed"],
  Montreal: ["braking", "power"],
  Monaco: ["street", "technical"],
  MagnyCours: ["braking", "technical"],
  PaulRicard: ["highspeed", "power"],
  Zandvoort: ["flowing", "technical"],
  Hockenheim: ["braking", "power"],
  Hungaroring: ["technical"],
  Silverstone: ["highspeed"],
  Suzuka: ["highspeed", "flowing"],
  Sepang: ["highspeed", "braking"],
  Singapore: ["street", "technical"],
  Shanghai: ["technical", "braking"],
  Sochi: ["street", "braking"],
  Kyalami: ["flowing", "highspeed"],
  Miami: ["street", "braking"],
  LasVegas: ["street", "power"],
  Indianapolis: ["power", "technical"],
  WatkinsGlen: ["highspeed", "flowing"],
  Mexico: ["power", "braking"],
  Losail: ["highspeed", "flowing"],
  YasMarina: ["technical", "braking"],
  Portimao: ["flowing"],
  Estoril: ["technical", "flowing"],
  BuenosAires: ["technical"],
  Jacarepagua: ["technical"],
  Madrid: ["street", "technical"],
  Fuji: ["power", "technical"],
  RoadAmerica: ["power", "highspeed"],
  Zolder: ["braking", "technical"],
  Bathurst: ["flowing", "power"],
  LeMans: ["power", "highspeed"],
  Daytona: ["power", "braking"],
  Poznan: ["technical"],
};

// An admin's pick, cleaned: known keys only, each once, in the order of
// TRACK_TYPES, at most MAX_TYPES. Anything that is not a list (undefined,
// null, a stray string) is "not set" and stays null, which is different from
// an empty list — see the note at the top.
export function sanitizeTypes(input) {
  if (!Array.isArray(input)) return null;
  const picked = new Set(input.filter((k) => typeof k === "string" && TYPE_KEYS.has(k)));
  return TRACK_TYPES.map((t) => t.key).filter((k) => picked.has(k)).slice(0, MAX_TYPES);
}

// The types a circuit carries: the admin's pick when there is one, else the
// default for a circuit the site knows, else none. `source` says which, so the
// admin page can say "default" beside a pick nobody made.
export function effectiveTypes(info, key) {
  if (Array.isArray(info?.types)) return { types: info.types, source: "admin" };
  const def = key ? DEFAULT_TYPES[key] : null;
  if (def) return { types: def.slice(0, MAX_TYPES), source: "default" };
  return { types: [], source: null };
}

export const MAX_CORNERS = 30;
const MAX_CORNER_NAME = 40;

// The corners of every circuit the site knows well enough to name, as
// [percent of the lap, turn number or null, name]. Positions were measured on
// the circuit outlines in frontend/src/data/circuits.js (distance along the
// line from the start/finish line to the corner's apex, over the lap) and
// checked against each layout's order of left and right turns, so they sit
// where the lap comparison finds the slow sections. They are the Grand Prix
// layouts: a circuit raced on a shorter layout gets none (layoutHasDefaults).
// Only corners worth naming are here — the braking zones and the famous
// ones; a flat-out kink never shows up as a slow section anyway. A turn number
// is only given where the official numbering is certain; a circuit missing
// from the list simply keeps "Section 3" until an admin names its corners.
const C = (at, turn, name = "") => ({ at, turn, name });
export const DEFAULT_CORNERS = {
  Melbourne: [C(5.9, 1, "Jones"), C(8.5, 2, "Brabham"), C(20.1, 3, "Sports Centre")],
  Mugello: [
    C(14, 1, "San Donato"), C(18.5, 2, "Luco"), C(21.1, 3, "Poggio Secco"), C(28.8, 4, "Materassi"),
    C(30.7, 5, "Borgo San Lorenzo"), C(37.3, 6, "Casanova"), C(40.4, 7, "Savelli"), C(46.4, 8, "Arrabbiata 1"),
    C(51, 9, "Arrabbiata 2"), C(58.2, 10, "Scarperia"), C(60.6, 11, "Palagio"), C(69.3, 12, "Correntaio"),
    C(75.4, 13, "Biondetti"), C(86.3, 15, "Bucine"),
  ],
  Bahrain: [C(10.7, 1), C(12.5, 2), C(14.4, 3), C(25.4, 4), C(39.1, 8), C(47.3, 10), C(61.2, 11), C(68.1, 12), C(73.3, 13), C(87.9, 14)],
  Monza: [C(11, 1, "Rettifilo"), C(32, 4, "Roggia"), C(38.8, 6, "Lesmo 1"), C(44.4, 7, "Lesmo 2"), C(64.4, 8, "Ascari"), C(84.2, 11, "Parabolica")],
  Jeddah: [C(6.7, 1), C(8.4, 2), C(38.4, 13), C(89.5, 27)],
  Nurburgring: [C(12.5, 1), C(48.2, null, "Dunlop-Kehre"), C(88.2, null, "Veedol-Schikane"), C(94.4, null, "Coca-Cola-Kurve")],
  Spa: [
    C(3.4, 1, "La Source"), C(33.8, null, "Les Combes"), C(41.6, null, "Bruxelles"), C(54, null, "Pouhon"),
    C(63.5, null, "Fagnes"), C(70.1, null, "Stavelot"), C(94.6, null, "Bus Stop"),
  ],
  Imola: [
    C(15.5, null, "Tamburello"), C(27.9, null, "Villeneuve"), C(34.8, null, "Tosa"), C(47.6, null, "Piratella"),
    C(56.9, null, "Acque Minerali"), C(68.6, null, "Variante Alta"), C(85.7, null, "Rivazza"),
  ],
  Turkey: [C(4.6, 1), C(46.8, 8), C(87.6, 12)],
  COTA: [C(5.9, 1), C(41, 11), C(62.5, 12), C(71.8, 15), C(91.2, 20)],
  Interlagos: [
    C(8.5, 1, "S do Senna"), C(33, 4, "Descida do Lago"), C(47.7, 6, "Ferradura"), C(53.6, 8, "Laranjinha"),
    C(56.7, 9, "Pinheirinho"), C(63.3, 10, "Bico de Pato"), C(68, 11, "Mergulho"), C(74.9, 12, "Junção"),
  ],
  RedBullRing: [C(7.4, 1, "Niki Lauda"), C(29.4, 3, "Remus"), C(48.3, 4, "Schlossgold"), C(84.5, 9, "Rindt"), C(89.8, 10)],
  Baku: [C(3.1, 1), C(8.6, 2), C(23.2, 3), C(27, 4), C(43.8, null, "Castle"), C(66.3, 16)],
  Barcelona: [
    C(15.4, 1, "Elf"), C(21.8, 3, "Renault"), C(34.3, 4, "Repsol"), C(43.1, 5, "Seat"), C(59.3, 9, "Campsa"),
    C(72.5, 10, "La Caixa"),
  ],
  Montreal: [C(11.3, 1, "Virage Senna"), C(22, 3), C(34.2, 6), C(51.2, 8), C(66.5, 10, "L'Epingle"), C(94.5, 13, "Final chicane")],
  MagnyCours: [
    C(4.9, 1, "Grande Courbe"), C(13, null, "Estoril"), C(37.2, null, "Adelaide"), C(57.1, null, "180°"),
    C(72.2, null, "Imola"), C(78, null, "Château d'Eau"), C(92.5, null, "Lycée"),
  ],
  Zandvoort: [C(10, 1, "Tarzan"), C(21.3, 3, "Hugenholtz"), C(49.5, 7, "Scheivlak"), C(75.2, 11, "Hans Ernst"), C(90, 14, "Arie Luyendijk")],
  Hockenheim: [C(6, 1, "Nordkurve"), C(18.6, 2), C(46, 6, "Haarnadel"), C(62.1, 8), C(83, 12, "Sachs"), C(92, 16, "Südkurve")],
  Hungaroring: [C(8.2, 1), C(19.6, 2), C(24, 3), C(35.1, 4), C(40.8, 5), C(48.7, 6), C(74.4, 12), C(80.7, 13), C(87, 14)],
  Silverstone: [
    C(4.6, 1, "Abbey"), C(15.2, 3, "Village"), C(17.6, 4, "The Loop"), C(45.4, 6, "Brooklands"), C(48.5, 7, "Luffield"),
    C(59, 9, "Copse"), C(66, null, "Maggotts-Becketts"), C(85.4, 16, "Vale"), C(88.6, 17, "Club"),
  ],
  Suzuka: [
    C(7.9, 1), C(10.7, 2), C(19.8, null, "S Curves"), C(35.9, 8, "Degner 1"), C(38.1, 9, "Degner 2"),
    C(46.4, 11, "Hairpin"), C(63.2, 13, "Spoon"), C(81.9, 15, "130R"), C(89.2, 16, "Casio Triangle"),
  ],
  Sepang: [C(6.7, 1), C(9, 2), C(23.4, 4), C(52, 9), C(70.8, 14), C(87.8, 15)],
  Shanghai: [C(6.9, 1), C(22.1, 6), C(50.3, 11), C(54.8, 13), C(81, 14), C(87.5, 16)],
  Sochi: [C(16.3, 2), C(24, 3), C(31.5, 4), C(39, 5), C(77.2, 13)],
  Mexico: [C(26.8, 1), C(46.2, 4), C(51.5, 6), C(83.4, 12), C(87.7, null, "Foro Sol")],
  Losail: [C(10, 1), C(35.7, 6), C(53.7, 10), C(87.1, 16)],
  YasMarina: [C(5.1, 1), C(24.9, 5), C(48.4, 6), C(67.3, 9), C(94.2, 16)],
  WatkinsGlen: [C(6.5, 1, "The 90"), C(15, null, "Esses"), C(42.5, null, "Bus Stop"), C(60.3, null, "The Toe"), C(73.4, null, "The Heel"), C(92.8, 11)],
  Indianapolis: [C(16.2, 1), C(18.5, 2)],
  LasVegas: [C(2.5, 1)],
  Portimao: [C(8.7, 1), C(31.3, 5)],
  Estoril: [C(10.5, 1), C(22.7, 3), C(81, null, "Parabólica Ayrton Senna")],
  Bathurst: [
    C(7.5, 1, "Hell Corner"), C(25.9, 2, "Griffins Bend"), C(33.7, 3, "The Cutting"), C(50, null, "McPhillamy Park"),
    C(54.6, null, "Skyline"), C(59.6, null, "The Esses"), C(64.4, null, "Forrest's Elbow"), C(91, null, "The Chase"),
    C(99.5, null, "Murray's Corner"),
  ],
  LeMans: [
    C(7.7, null, "Dunlop"), C(24.4, null, "Tertre Rouge"), C(66, null, "Mulsanne"), C(81.7, null, "Indianapolis"),
    C(83.8, null, "Arnage"), C(93.7, null, "Porsche Curves"), C(97.6, null, "Ford Chicane"),
  ],
};

// Whether the default corners fit the layout a lap was driven on. They were
// measured on the Grand Prix layouts, so anything the name says is shorter,
// longer or different (a national loop, the bike layout, an oval) goes
// without: a corner name at the wrong place is worse than a number. No
// layout at all is the circuit's main one.
const OTHER_LAYOUT = /(national|short|club|moto|bike|junior|oval|indy|international|sprint|reverse|east|west|north|south|kart|drift|school|historic|classic|old|19[0-9]{2})/i;
export function layoutHasDefaults(layout) {
  const l = String(layout || "").trim();
  return !l || !OTHER_LAYOUT.test(l);
}

// The corners a circuit carries: the admin's list when there is one (an
// empty list included: "no names here"), else the default for a circuit the
// site knows, on its main layout. `source` as for the types.
export function effectiveCorners(info, key, layout = "") {
  if (Array.isArray(info?.corners)) return { corners: info.corners, source: "admin" };
  const def = key ? DEFAULT_CORNERS[key] : null;
  if (def && layoutHasDefaults(layout)) return { corners: def, source: "default" };
  return { corners: [], source: null };
}

// Named corners, cleaned: a position between 0 and 100 (one decimal), a name
// or a turn number (at least one of the two), sorted round the lap. Two
// corners at the same spot are one too many; the first one stays. Anything
// that is not a list is "never set" (null), like the types.
export function sanitizeCorners(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  const seen = new Set();
  for (const c of input) {
    const at = Number(c?.at);
    if (!Number.isFinite(at) || at < 0 || at > 100) continue;
    const turnRaw = c?.turn === "" || c?.turn == null ? null : Number(c.turn);
    const turn = Number.isInteger(turnRaw) && turnRaw >= 1 && turnRaw <= 99 ? turnRaw : null;
    const name = typeof c?.name === "string" ? c.name.trim().slice(0, MAX_CORNER_NAME) : "";
    if (!name && turn == null) continue;
    const pos = Math.round(at * 10) / 10;
    if (seen.has(pos)) continue;
    seen.add(pos);
    out.push({ at: pos, turn, name });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, MAX_CORNERS);
}
