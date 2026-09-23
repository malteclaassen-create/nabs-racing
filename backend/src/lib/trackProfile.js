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

// The corners of the circuits the site has official data for, as
// (percent of the lap, turn number, name). Every official corner is here,
// numbered as Formula 1 numbers it, and placed where F1's own timing data puts
// it: the distance along a real lap from the timing line to the corner, over
// that lap's length — the same "percent of the lap" the in-game recorder
// measures from the start/finish line. Taken from the F1 live-timing circuit
// data (as MultiViewer serves it), latest layout raced there. Names are only
// given where the link from the official number to the name is certain;
// every other corner is "T7" and nothing more.
//
// Circuits without official data (Mugello, Magny-Cours, Sepang, Watkins Glen,
// …) have no defaults on purpose: positions guessed off an outline were a few
// percent off where the line really is, which is enough to put the wrong name
// on a corner. An admin can name them in the Tracks tab.
//
// They fit the layout F1 raced last. A sim track built on an older layout (a
// chicane since removed) can be off in places; the admin list replaces them.
const C = (at, turn, name = "") => ({ at, turn, name });
export const DEFAULT_CORNERS = {
  Melbourne: [
    C(6.8, 1), C(8.3, 2), C(20.6, 3), C(23.5, 4), C(27.3, 5), C(35.5, 6), C(37.6, 7), C(41.5, 8), C(62.6, 9),
    C(64.8, 10), C(78.2, 11), C(83.2, 12), C(87.9, 13), C(91.0, 14),
  ],
  Interlagos: [
    C(8.2, 1, "S do Senna"), C(10.5, 2, "S do Senna"), C(15.0, 3, "Curva do Sol"), C(32.9, 4, "Descida do Lago"),
    C(36.8, 5, "Descida do Lago"), C(47.2, 6, "Ferradura"), C(50.5, 7, "Ferradura"), C(54.3, 8, "Laranjinha"),
    C(57.3, 9, "Pinheirinho"), C(64.2, 10, "Bico de Pato"), C(69.2, 11, "Mergulho"), C(76.1, 12, "Junção"),
    C(78.8, 13), C(84.9, 14), C(94.4, 15),
  ],
  Baku: [
    C(5.0, 1), C(10.6, 2), C(25.1, 3), C(28.9, 4), C(34.5, 5), C(35.4, 6), C(41.9, 7), C(45.2, 8, "Castle"),
    C(45.7, 9, "Castle"), C(46.2, 10, "Castle"), C(47.0, 11), C(47.9, 12), C(54.7, 13), C(58.5, 14), C(62.2, 15),
    C(68.2, 16), C(71.4, 17), C(75.4, 18), C(78.0, 19), C(83.2, 20),
  ],
  Portimao: [
    C(14.3, 1), C(17.8, 2), C(21.1, 3), C(24.3, 4), C(36.8, 5), C(41.8, 6), C(46.8, 7), C(50.3, 8), C(57.6, 9),
    C(63.2, 10), C(64.6, 11), C(69.3, 12), C(73.5, 13), C(78.5, 14), C(88.3, 15),
  ],
  Jeddah: [
    C(7.9, 1), C(8.9, 2), C(11.2, 3), C(16.1, 4), C(17.9, 5), C(20.4, 6), C(22.3, 7), C(23.5, 8), C(26.1, 9),
    C(27.7, 10), C(29.4, 11), C(30.8, 12), C(39.5, 13), C(44.7, 14), C(48.0, 15), C(50.2, 16), C(51.8, 17),
    C(55.5, 18), C(58.7, 19), C(62.1, 20), C(65.4, 21), C(69.4, 22), C(70.8, 23), C(73.2, 24), C(77.9, 25),
    C(83.8, 26), C(90.2, 27),
  ],
  Barcelona: [
    C(17.7, 1, "Elf"), C(19.4, 2), C(24.9, 3, "Renault"), C(37.2, 4, "Repsol"), C(46.7, 5, "Seat"), C(50.8, 6),
    C(54.5, 7), C(56.4, 8), C(62.3, 9, "Campsa"), C(75.2, 10, "La Caixa"), C(78.4, 11), C(80.7, 12), C(86.8, 13),
    C(93.5, 14),
  ],
  Losail: [
    C(14.8, 1), C(20.2, 2), C(24.4, 3), C(32.2, 4), C(35.1, 5), C(40.9, 6), C(48.3, 7), C(51.8, 8), C(54.1, 9),
    C(58.4, 10), C(64.2, 11), C(69.9, 12), C(73.6, 13), C(77.4, 14), C(82.9, 15), C(91.7, 16),
  ],
  Miami: [
    C(7.1, 1), C(9.0, 2), C(10.7, 3), C(21.3, 4), C(23.9, 5), C(26.7, 6), C(29.2, 7), C(31.1, 8), C(40.9, 9),
    C(46.2, 10), C(58.1, 11), C(60.2, 12), C(62.6, 13), C(64.0, 14), C(64.4, 15), C(66.1, 16), C(90.7, 17),
    C(93.3, 18), C(97.2, 19),
  ],
  LasVegas: [
    C(4.5, 1), C(6.1, 2), C(9.2, 3), C(11.2, 4), C(25.1, 5), C(29.4, 6), C(33.0, 7), C(33.9, 8), C(35.9, 9),
    C(43.9, 10), C(48.2, 11), C(52.0, 12), C(64.4, 13), C(83.6, 14), C(84.6, 15), C(85.5, 16), C(97.8, 17),
  ],
  RedBullRing: [
    C(10.0, 1, "Niki Lauda"), C(24.9, 2), C(31.9, 3, "Remus"), C(50.8, 4, "Schlossgold"), C(55.2, 5), C(62.9, 6),
    C(70.3, 7), C(75.0, 8), C(87.5, 9), C(91.9, 10),
  ],
  Silverstone: [
    C(7.8, 1, "Abbey"), C(10.5, 2, "Farm"), C(14.9, 3, "Village"), C(17.8, 4, "The Loop"), C(21.1, 5, "Aintree"),
    C(33.6, 6, "Brooklands"), C(37.4, 7, "Luffield"), C(43.3, 8, "Woodcote"), C(52.3, 9, "Copse"),
    C(61.8, 10, "Maggotts"), C(63.3, 11, "Maggotts"), C(65.8, 12, "Becketts"), C(68.2, 13, "Becketts"),
    C(70.7, 14, "Chapel"), C(85.5, 15, "Stowe"), C(93.2, 16, "Vale"), C(94.8, 17, "Club"), C(97.3, 18, "Club"),
  ],
  Monaco: [
    C(5.9, 1, "Sainte Dévote"), C(17.9, 2, "Beau Rivage"), C(22.9, 3, "Massenet"), C(26.7, 4, "Casino"),
    C(33.7, 5, "Mirabeau Haute"), C(37.3, 6, "Grand Hotel Hairpin"), C(39.7, 7, "Mirabeau Bas"),
    C(42.4, 8, "Portier"), C(52.5, 9, "Tunnel"), C(62.5, 10, "Nouvelle Chicane"), C(64.1, 11, "Nouvelle Chicane"),
    C(71.1, 12, "Tabac"), C(75.8, 13, "Piscine"), C(76.7, 14, "Piscine"), C(80.8, 15, "Piscine"),
    C(81.4, 16, "Piscine"), C(83.7, 17), C(87.3, 18, "La Rascasse"), C(90.0, 19, "Anthony Noghes"),
  ],
  Montreal: [
    C(5.2, 1, "Virage Senna"), C(7.6, 2, "Virage Senna"), C(16.3, 3), C(17.6, 4), C(22.8, 5), C(27.9, 6), C(29.9, 7),
    C(45.7, 8), C(47.6, 9), C(61.4, 10, "L'Epingle"), C(63.8, 11), C(72.3, 12), C(88.9, 13, "Final chicane"),
    C(89.7, 14, "Final chicane"),
  ],
  PaulRicard: [
    C(7.4, 1), C(9.1, 2), C(19.0, 3), C(20.7, 4), C(22.6, 5), C(24.9, 6), C(28.7, 7), C(47.5, 8, "Mistral chicane"),
    C(48.9, 9, "Mistral chicane"), C(63.4, 10, "Signes"), C(72.3, 11, "Beausset"), C(79.8, 12), C(83.5, 13),
    C(87.8, 14), C(90.7, 15),
  ],
  Hockenheim: [
    C(5.8, 1, "Nordkurve"), C(18.4, 2), C(19.7, 3), C(21.3, 4), C(32.7, 5), C(46.0, 6, "Haarnadel"), C(56.0, 7),
    C(61.7, 8), C(64.1, 9), C(65.6, 10), C(67.5, 11), C(75.7, 12), C(83.3, 13, "Sachs"), C(86.6, 14), C(88.1, 15),
    C(90.8, 16, "Südkurve"), C(93.8, 17, "Südkurve"),
  ],
  Monza: [
    C(15.7, 1, "Rettifilo"), C(16.7, 2, "Rettifilo"), C(25.6, 3, "Curva Grande"), C(36.9, 4, "Roggia"),
    C(37.8, 5, "Roggia"), C(44.0, 6, "Lesmo 1"), C(49.5, 7, "Lesmo 2"), C(68.1, 8, "Ascari"), C(69.7, 9, "Ascari"),
    C(71.4, 10, "Ascari"), C(90.3, 11, "Parabolica"),
  ],
  Hungaroring: [
    C(14.8, 1), C(19.1, null, "T1A"), C(26.3, 2), C(30.5, 3), C(41.5, 4), C(47.0, 5), C(54.7, 6), C(55.7, 7),
    C(59.6, 8), C(62.8, 9), C(67.3, 10), C(71.8, 11), C(80.9, 12), C(83.8, null, "T12A"), C(87.0, 13), C(93.7, 14),
  ],
  Suzuka: [
    C(12.2, 1), C(14.2, 2), C(18.5, 3, "S Curves"), C(20.8, 4, "S Curves"), C(23.4, 5, "S Curves"),
    C(26.3, 6, "S Curves"), C(32.0, 7, "Dunlop"), C(39.2, 8, "Degner 1"), C(41.9, 9, "Degner 2"), C(47.4, 10),
    C(50.1, 11, "Hairpin"), C(54.4, 12), C(65.5, 13, "Spoon"), C(68.2, 14, "Spoon"), C(86.2, 15, "130R"),
    C(93.0, 16, "Casio Triangle"), C(94.3, 17, "Casio Triangle"), C(97.1, 18),
  ],
  Shanghai: [
    C(10.6, 1), C(13.9, 2), C(16.7, 3), C(19.2, 4), C(24.8, 5), C(29.4, 6), C(37.9, 7), C(43.4, 8), C(46.9, 9),
    C(49.0, 10), C(57.8, 11), C(59.4, 12), C(63.1, 13), C(88.2, 14), C(89.7, 15), C(95.2, 16),
  ],
  Zandvoort: [
    C(8.6, 1, "Tarzan"), C(15.8, 2), C(19.7, 3, "Hugenholtz"), C(24.8, 4), C(29.1, 5), C(32.9, 6),
    C(40.1, 7, "Scheivlak"), C(47.6, 8), C(52.8, 9), C(58.9, 10), C(72.7, 11, "Hans Ernst"),
    C(74.7, 12, "Hans Ernst"), C(82.0, 13), C(88.6, 14, "Arie Luyendijk"),
  ],
  Turkey: [
    C(8.6, 1), C(15.0, 2), C(22.3, 3), C(24.9, 4), C(27.8, 5), C(29.6, 6), C(39.5, 7), C(51.1, 8), C(65.4, 9),
    C(67.0, 10), C(77.0, 11), C(91.3, 12), C(93.4, 13), C(95.0, 14),
  ],
  Imola: [
    C(5.2, 1), C(18.2, 2, "Tamburello"), C(19.4, 3, "Tamburello"), C(22.3, 4, "Tamburello"), C(31.2, 5, "Villeneuve"),
    C(33.2, 6, "Villeneuve"), C(38.9, 7, "Tosa"), C(47.1, 8), C(52.2, 9, "Piratella"), C(54.9, 10),
    C(60.1, 11, "Acque Minerali"), C(62.0, 12, "Acque Minerali"), C(63.7, 13), C(72.2, 14, "Variante Alta"),
    C(73.2, 15, "Variante Alta"), C(84.5, 16), C(88.5, 17, "Rivazza"), C(91.4, 18, "Rivazza"), C(97.8, 19),
  ],
  Singapore: [
    C(8.2, 1), C(9.6, 2), C(11.1, 3), C(14.2, 4), C(19.7, 5), C(28.5, 6), C(36.2, 7), C(40.9, 8), C(44.8, 9),
    C(53.5, 10), C(56.8, 11), C(58.4, 12), C(61.9, 13), C(73.4, 14), C(78.0, 15), C(88.1, 16), C(89.6, 17),
    C(95.1, 18), C(97.5, 19),
  ],
  Bahrain: [
    C(13.2, 1), C(15.0, 2), C(17.1, 3), C(28.0, 4), C(33.0, 5), C(34.8, 6), C(36.5, 7), C(41.3, 8), C(48.1, 9),
    C(49.8, 10), C(64.3, 11), C(71.7, 12), C(75.8, 13), C(90.9, 14), C(92.4, 15),
  ],
  Mexico: [
    C(28.4, 1), C(30.1, 2), C(31.5, 3), C(47.9, 4), C(49.6, 5), C(52.8, 6), C(60.6, 7), C(63.3, 8), C(65.1, 9),
    C(69.5, 10), C(71.9, 11), C(85.0, 12), C(89.2, 13), C(90.7, 14), C(91.8, 15), C(93.3, 16), C(96.2, 17),
  ],
  Spa: [
    C(5.5, 1, "La Source"), C(15.2, 2, "Eau Rouge"), C(16.9, 3, "Raidillon"), C(18.3, 4), C(34.6, 5, "Les Combes"),
    C(35.7, 6, "Les Combes"), C(38.1, 7, "Malmedy"), C(43.7, 8, "Bruxelles"), C(47.2, 9), C(54.6, 10, "Pouhon"),
    C(58.1, 11, "Pouhon"), C(64.2, 12, "Fagnes"), C(66.5, 13, "Fagnes"), C(70.7, 14, "Stavelot"), C(74.3, 15),
    C(84.6, 16), C(88.6, 17), C(96.3, 18, "Bus Stop"), C(97.3, 19, "Bus Stop"),
  ],
  YasMarina: [
    C(7.4, 1), C(12.1, 2), C(16.1, 3), C(19.7, 4), C(27.2, 5), C(50.2, 6), C(51.3, 7), C(55.2, 8), C(70.8, 9),
    C(77.3, 10), C(80.3, 11), C(82.8, 12), C(84.9, 13), C(87.2, 14), C(92.3, 15), C(96.7, 16),
  ],
  Nurburgring: [
    C(12.3, 1), C(16.1, 2), C(21.0, 3), C(23.0, 4), C(32.9, 5), C(35.9, 6), C(47.7, 7, "Dunlop-Kehre"), C(55.7, 8),
    C(58.0, 9), C(66.2, 10), C(70.2, 11), C(78.7, 12), C(87.6, 13, "Veedol-Schikane"), C(88.3, 14, "Veedol-Schikane"),
    C(94.2, 15, "Coca-Cola-Kurve"),
  ],
  Sochi: [
    C(7.3, 1), C(20.6, 2), C(28.3, 3), C(35.3, 4), C(42.9, 5), C(47.4, 6), C(50.3, 7), C(55.2, 8), C(57.4, 9),
    C(61.8, 10), C(69.5, 11), C(77.4, 12), C(81.2, 13), C(83.3, 14), C(87.8, 15), C(89.6, 16), C(95.6, 17),
    C(98.5, 18),
  ],
  COTA: [
    C(11.8, 1), C(16.3, 2), C(21.1, 3), C(22.7, 4), C(24.6, 5), C(27.0, 6), C(31.2, 7), C(34.0, 8), C(35.7, 9),
    C(39.6, 10), C(46.6, 11), C(68.6, 12), C(72.9, 13), C(74.2, 14), C(77.9, 15), C(81.4, 16), C(83.8, 17),
    C(86.4, 18), C(91.6, 19), C(97.2, 20),
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
