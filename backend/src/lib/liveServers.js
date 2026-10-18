// ---------------------------------------------------------------------------
// The league's race servers (AC Server Manager instances) and which one each
// SERIES' live page follows. The assignment lives in the Setting table as a
// JSON blob { seriesSlug: serverKey }; a series without an entry follows the
// first server. Managed in the admin Live tab.
// ---------------------------------------------------------------------------

export const LIVE_SERVERS = [
  {
    key: "nabs1",
    name: "NABS Server 1",
    origin: process.env.LIVE_TIMING_ORIGIN || "https://nabs1.emperorservers.com",
    ws: process.env.LIVE_TIMING_WS || "wss://nabs1.emperorservers.com/api/race-control",
  },
  {
    key: "nabs2",
    name: "NABS Server 2",
    origin: process.env.LIVE_TIMING2_ORIGIN || "https://nabs2.emperorservers.com",
    ws: process.env.LIVE_TIMING2_WS || "wss://nabs2.emperorservers.com/api/race-control",
  },
];

export const DEFAULT_SERVER_KEY = LIVE_SERVERS[0].key;

// A series that races on no server of ours (a special event run elsewhere):
// its Live page shows no board, and no server's training times, resets or
// practice laps are filed under it. Stored as this word instead of a key.
export const NO_SERVER = "off";

export function isValidServerKey(key) {
  return LIVE_SERVERS.some((s) => s.key === key);
}

const SETTING_KEY = "live_server_map";

// What a series' entry in the blob means.
//
// Two shapes, because the blob predates the second half of the idea: a bare
// server key (every row written before this) or { key, only }. `only` says the
// Live page of that series shows THAT board and nothing else — no switch to the
// other server, because for a league that races on one of them the other one is
// not an alternative view, it is somebody else's race.
//
// A third: NO_SERVER, or { off: true }, for a series on no server at all.
// `key` then still names the first server, so a form has something to show,
// and `off` is what every reader has to look at.
export function serverAssignment(map, slug) {
  const raw = slug ? map?.[String(slug)] : null;
  if (raw === NO_SERVER || (raw && typeof raw === "object" && raw.off)) {
    return { key: DEFAULT_SERVER_KEY, only: false, off: true };
  }
  if (typeof raw === "string") {
    return { key: isValidServerKey(raw) ? raw : DEFAULT_SERVER_KEY, only: false, off: false };
  }
  if (raw && typeof raw === "object") {
    return { key: isValidServerKey(raw.key) ? raw.key : DEFAULT_SERVER_KEY, only: !!raw.only, off: false };
  }
  return { key: DEFAULT_SERVER_KEY, only: false, off: false };
}

export async function readLiveServerMap(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    const map = row?.value ? JSON.parse(row.value) : {};
    return map && typeof map === "object" && !Array.isArray(map) ? map : {};
  } catch {
    return {};
  }
}

export async function writeLiveServerMap(prisma, map) {
  // Only keep valid assignments. A series on the default server with the switch
  // left alone needs no entry at all; one that hides the switch does, even on
  // the default, or the instruction would have nowhere to live. Rows without
  // that flag stay bare strings, which is what every older row already is.
  const clean = {};
  for (const [slug, value] of Object.entries(map || {})) {
    if (!slug) continue;
    const { key, only, off } = serverAssignment({ [slug]: value }, slug);
    if (off) {
      clean[slug] = NO_SERVER;
      continue;
    }
    if (!isValidServerKey(key)) continue;
    if (only) clean[slug] = { key, only: true };
    else if (key !== DEFAULT_SERVER_KEY) clean[slug] = key;
  }
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
  return clean;
}

// The server a request is about: the one the viewer explicitly asked for, or
// otherwise the series' own.
//
// The explicit key is the Live page's server switch. It only ever OVERRIDES,
// never persists: the admin assignment below stays the default every viewer
// arrives on, so a member opening the page on race night lands on the board
// the league is actually racing on, whatever anyone clicked last week.
//
// An unknown or malformed key falls through to the series rather than erroring.
// This is decoration on a public page; a stale link with a server that no
// longer exists should show the normal board, not a failure.
export async function resolveServerKey(prisma, { series, server } = {}) {
  if (isValidServerKey(server)) return server;
  return serverKeyForSeries(prisma, series);
}

// Which server a series' live page follows (by series SLUG). Unknown series
// or unassigned -> the first server, exactly the pre-multi-server behaviour.
// A series on no server -> NO_SERVER, which the board reads answer with an
// empty board (services/liveTiming.js getBoard).
export async function serverKeyForSeries(prisma, seriesSlug) {
  const { key, off } = await serverConfigForSeries(prisma, seriesSlug);
  return off ? NO_SERVER : key;
}

// The same answer with the switch's fate attached: { key, only, off }.
export async function serverConfigForSeries(prisma, seriesSlug) {
  if (!seriesSlug) return { key: DEFAULT_SERVER_KEY, only: false, off: false };
  const map = await readLiveServerMap(prisma);
  return serverAssignment(map, seriesSlug);
}
