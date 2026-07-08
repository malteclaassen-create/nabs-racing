// ---------------------------------------------------------------------------
// Backend track-name resolver. Mirrors the matching logic of the frontend's
// frontend/src/data/circuits.js circuitFor()/canonicalTrack() — WITHOUT the SVG
// paths — so the server can group races run at the same circuit across seasons
// however the track happened to be named (country, ALL-CAPS, AC id, "… 2.5"
// suffix). The key list and alias table below are copied from that file (the
// source of truth for outlines); regenerate if a circuit is added there.
// ---------------------------------------------------------------------------

// { key -> { circuit (display name), country (ISO alpha-2) } }.
const CIRCUITS = {
  Melbourne: { circuit: "Albert Park", country: "au" },
  Mugello: { circuit: "Mugello", country: "it" },
  Most: { circuit: "Autodrom Most", country: "cz" },
  Bahrain: { circuit: "Sakhir", country: "bh" },
  Monza: { circuit: "Autodromo di Monza", country: "it" },
  Jeddah: { circuit: "Jeddah Corniche", country: "sa" },
  Nurburgring: { circuit: "Nürburgring", country: "de" },
  Spa: { circuit: "Spa-Francorchamps", country: "be" },
  Imola: { circuit: "Imola", country: "it" },
  Turkey: { circuit: "Istanbul Park", country: "tr" },
  COTA: { circuit: "Circuit of the Americas", country: "us" },
  Interlagos: { circuit: "Interlagos", country: "br" },
  RedBullRing: { circuit: "Red Bull Ring", country: "at" },
  Baku: { circuit: "Baku City", country: "az" },
  Barcelona: { circuit: "Barcelona-Catalunya", country: "es" },
  Montreal: { circuit: "Gilles-Villeneuve", country: "ca" },
  Monaco: { circuit: "Monaco", country: "mc" },
  MagnyCours: { circuit: "Magny-Cours", country: "fr" },
  PaulRicard: { circuit: "Paul Ricard", country: "fr" },
  Zandvoort: { circuit: "Zandvoort", country: "nl" },
  Hockenheim: { circuit: "Hockenheimring", country: "de" },
  Hungaroring: { circuit: "Hungaroring", country: "hu" },
  Silverstone: { circuit: "Silverstone", country: "gb" },
  Suzuka: { circuit: "Suzuka", country: "jp" },
  Sepang: { circuit: "Sepang", country: "my" },
  Singapore: { circuit: "Marina Bay", country: "sg" },
  Shanghai: { circuit: "Shanghai", country: "cn" },
  Sochi: { circuit: "Sochi", country: "ru" },
  Kyalami: { circuit: "Kyalami", country: "za" },
  Miami: { circuit: "Miami", country: "us" },
  LasVegas: { circuit: "Las Vegas", country: "us" },
  Indianapolis: { circuit: "Indianapolis", country: "us" },
  WatkinsGlen: { circuit: "Watkins Glen", country: "us" },
  Mexico: { circuit: "Hermanos Rodríguez", country: "mx" },
  Losail: { circuit: "Lusail", country: "qa" },
  YasMarina: { circuit: "Yas Marina", country: "ae" },
  Portimao: { circuit: "Algarve", country: "pt" },
  Estoril: { circuit: "Estoril", country: "pt" },
  BuenosAires: { circuit: "Buenos Aires", country: "ar" },
  Jacarepagua: { circuit: "Jacarepaguá", country: "br" },
  Madrid: { circuit: "Madring", country: "es" },
  Fuji: { circuit: "Fuji Speedway", country: "jp" },
  RoadAmerica: { circuit: "Road America", country: "us" },
  Zolder: { circuit: "Zolder", country: "be" },
  Bathurst: { circuit: "Mount Panorama", country: "au" },
  LeMans: { circuit: "Circuit de la Sarthe", country: "fr" },
  Daytona: { circuit: "Daytona", country: "us" },
};

// Raw track strings (AC ids, country names, alternate spellings) -> CIRCUITS key.
const TRACK_ALIASES = {
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
  italy: "Monza",
  "united states": "COTA",
  usa: "COTA",
  america: "COTA",
  mexico: "Mexico",
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
  // AC track ids seen in the S5/S6 archive result files (prefixed / year-suffixed
  // variants the generic matcher can't reach). Keeps track-history grouping and
  // the S6 calendar names correct.
  acu_cota_2021: "COTA",
  fn_barcelona: "Barcelona",
  rt_autodrom_most: "Most",
  vhe_interlagos: "Interlagos",
  vhe_hockenheim: "Hockenheim",
  canada_2021: "Montreal",
  lilski_watkins_glen: "WatkinsGlen",
  acu_mexico_2021: "Mexico",
  rt_suzuka: "Suzuka",
  lilski_road_america: "RoadAmerica",
  baku_2022: "Baku",
};

export function normKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const NORM_ALIASES = {};
for (const k in TRACK_ALIASES) NORM_ALIASES[normKey(k)] = TRACK_ALIASES[k];

// Circuit keys longest-first so a startsWith test prefers the most specific.
const NORM_KEYS = Object.keys(CIRCUITS)
  .map((key) => ({ key, nk: normKey(key), cnk: normKey(CIRCUITS[key].circuit) }))
  .sort((a, b) => b.nk.length - a.nk.length);

// Canonical circuit key for a raw track string, or null when unknown.
export function trackKeyFor(track) {
  if (!track) return null;
  if (CIRCUITS[track]) return track;
  const n = normKey(track);
  const alias = TRACK_ALIASES[track] || TRACK_ALIASES[String(track).toLowerCase()] || NORM_ALIASES[n];
  if (alias && CIRCUITS[alias]) return alias;
  for (const c of NORM_KEYS) if (c.nk === n || c.cnk === n) return c.key;
  for (const c of NORM_KEYS) if (c.nk.length >= 5 && (n.startsWith(c.nk) || n.startsWith(c.cnk))) return c.key;
  return null;
}

// Stable grouping key: the canonical key when known, else the normalized string
// (so two identical unknown track names still group together).
export function groupKeyFor(track) {
  return trackKeyFor(track) || normKey(track);
}

// Human display name for a canonical key (falls back to the key itself).
export function displayNameFor(key) {
  return CIRCUITS[key]?.circuit || key;
}

// ISO country code for a raw track string (or null).
export function countryFor(track) {
  const key = trackKeyFor(track);
  return key ? CIRCUITS[key].country : null;
}
