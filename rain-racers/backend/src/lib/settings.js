import prisma from "../db.js";

// Every setting the admin can change, with the value used until they do.
export const DEFAULTS = {
  leagueName: "Rain Racers",
  // The league's own words (YouTube channel, Discord server description).
  tagline: "Series where all kinds of racing are welcome. Interesting series, close racing and waffling from our commentators.",
  // White, like the logo. Text on it turns black or white on its own.
  accentColor: "#ffffff",
  logoUrl: null,
  discordInvite: "https://discord.gg/jSNmpV72xF",
  youtubeUrl: "https://www.youtube.com/@rainracers",
  // Race Info page. Plain text; lines starting with "# " are headings,
  // "- " are list items.
  rules: "# Rules\n- Be respectful on and off track.\n- Join the Discord for briefings and stewarding.",
  // Points for P1, P2, ... of a race (the league's usual table, down to
  // P30). Anything past the end of the list scores nothing. A season can set
  // its own tables, a round its own.
  pointsTable: [50, 40, 35, 32, 30, 28, 26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 5, 5, 5, 5, 5],
  // Extra points for the fastest lap of a race, only for a finisher inside
  // the top N. 0 = none.
  fastestLapPoints: 0,
  fastestLapTopN: 10,
  // Share of the winner's laps a driver needs to be classified at the import.
  // Below it they are marked DNF (the admin can still change it).
  classifiedLapShare: 0.9,
  // Whether a DNF still scores the points of its classified position.
  dnfScores: false,
  // AC Server Manager live data, e.g. wss://<server-manager>/api/race-control
  // with the origin https://<server-manager>. Empty = no live timing.
  liveWsUrl: "",
  liveOrigin: "",
};

const PUBLIC_KEYS = [
  "leagueName",
  "tagline",
  "accentColor",
  "logoUrl",
  "discordInvite",
  "youtubeUrl",
  "rules",
  "pointsTable",
  "fastestLapPoints",
  "fastestLapTopN",
  "dnfScores",
];

let cache = null;

export async function getSettings() {
  if (cache) return cache;
  const rows = await prisma.setting.findMany();
  const out = { ...DEFAULTS };
  for (const row of rows) {
    if (!(row.key in DEFAULTS)) continue;
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      // a broken row falls back to the default
    }
  }
  cache = out;
  return out;
}

export async function publicSettings() {
  const all = await getSettings();
  return Object.fromEntries(PUBLIC_KEYS.map((k) => [k, all[k]]));
}

// "25, 18, 15" (or a list) -> [25, 18, 15]. Also used for the season and
// round tables.
export function parsePointsList(value) {
  return (Array.isArray(value) ? value : String(value ?? "").split(/[\s,;]+/))
    .filter((v) => v !== "")
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .slice(0, 60);
}

// Checks and normalises what the admin sends. Unknown keys are dropped.
export function cleanSettings(input) {
  const out = {};
  const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
  for (const [key, value] of Object.entries(input || {})) {
    switch (key) {
      case "leagueName":
        out[key] = str(value, 60) || DEFAULTS.leagueName;
        break;
      case "tagline":
      case "liveOrigin":
        out[key] = str(value);
        break;
      case "discordInvite":
      case "youtubeUrl":
        out[key] = /^https:\/\//.test(str(value)) ? str(value) : "";
        break;
      case "liveWsUrl":
        out[key] = /^wss?:\/\//.test(str(value)) ? str(value, 300) : "";
        break;
      case "rules":
        out[key] = String(value ?? "").slice(0, 50000);
        break;
      case "accentColor":
        out[key] = /^#[0-9a-fA-F]{6}$/.test(str(value)) ? str(value).toLowerCase() : DEFAULTS.accentColor;
        break;
      case "logoUrl":
        out[key] = value ? str(value, 300) : null;
        break;
      case "pointsTable":
        out[key] = parsePointsList(value);
        break;
      case "fastestLapPoints":
      case "fastestLapTopN": {
        const n = Number(value);
        out[key] = Number.isFinite(n) && n >= 0 ? n : DEFAULTS[key];
        break;
      }
      case "classifiedLapShare": {
        const n = Number(value);
        out[key] = Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULTS[key];
        break;
      }
      case "dnfScores":
        out[key] = !!value;
        break;
      default:
        break;
    }
  }
  return out;
}

export async function saveSettings(input) {
  const clean = cleanSettings(input);
  await prisma.$transaction(
    Object.entries(clean).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) },
      }),
    ),
  );
  cache = null;
  return getSettings();
}
