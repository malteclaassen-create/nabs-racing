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
//            Positions are the admin's to type: the site has no corner map of
//            its own, and a wrong name would be worse than a number.
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

// Named corners, cleaned: a position between 0 and 100 (one decimal), a name
// or a turn number (at least one of the two), sorted round the lap. Two
// corners at the same spot are one too many; the first one stays.
export function sanitizeCorners(input) {
  if (!Array.isArray(input)) return [];
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
