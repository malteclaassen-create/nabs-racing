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

export function isValidServerKey(key) {
  return LIVE_SERVERS.some((s) => s.key === key);
}

const SETTING_KEY = "live_server_map";

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
  // Only keep valid assignments; a series mapped to the default needs no entry.
  const clean = {};
  for (const [slug, key] of Object.entries(map || {})) {
    if (slug && isValidServerKey(key) && key !== DEFAULT_SERVER_KEY) clean[slug] = key;
  }
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
  return clean;
}

// Which server a series' live page follows (by series SLUG). Unknown series
// or unassigned -> the first server, exactly the pre-multi-server behaviour.
export async function serverKeyForSeries(prisma, seriesSlug) {
  if (!seriesSlug) return DEFAULT_SERVER_KEY;
  const map = await readLiveServerMap(prisma);
  const key = map[String(seriesSlug)];
  return isValidServerKey(key) ? key : DEFAULT_SERVER_KEY;
}
