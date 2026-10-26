import prisma from "../db.js";

// Every setting the admin can change, with the value used until they do.
export const DEFAULTS = {
  leagueName: "Rain Racers",
  tagline: "Sim racing league on Assetto Corsa",
  accentColor: "#38bdf8",
  logoUrl: null,
  discordInvite: "",
  // Race Info page. Plain text; lines starting with "# " are headings,
  // "- " are list items.
  rules: "# Rules\n- Be respectful on and off track.\n- Join the Discord for briefings and stewarding.",
  // Points for P1, P2, ... Anything past the end of the list scores nothing.
  pointsTable: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
  // Extra point for the fastest lap, only for a finisher inside the top N.
  fastestLapPoints: 1,
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
      case "pointsTable": {
        const list = (Array.isArray(value) ? value : String(value).split(/[\s,;]+/))
          .map(Number)
          .filter((n) => Number.isFinite(n) && n >= 0)
          .slice(0, 60);
        out[key] = list;
        break;
      }
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
