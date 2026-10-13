import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "./useAuth.js";
import { useSeries } from "../context/SeriesContext.jsx";
import { useVisiblePoll } from "./useVisiblePoll.js";
import { fmtLap, fmtLapDelta } from "../utils/format.js";

// ---------------------------------------------------------------------------
// The live page's Telemetry button, and whether it should light up.
//
// The league asked for the telemetry to be findable from live timing, and then
// for the button to notice you: it lights up when a lap of yours lands in the
// lap store, and opens the comparison that lap asks for. Your first lap at a
// track on its own; a new best against the best it beat ("see how you
// improved"); any other lap that made your top three against your best. The
// backend picks the pair (lib/telemetryLaps.js latestLapOf).
//
// It stops glowing once you have opened it, or after FRESH_MS: a lap from last
// week is not news. Which lap you last opened is kept in the browser, so the
// glow does not come back on every visit.
//
// `open` is whether the league has opened the telemetry at all; without it
// there is no button. Signed out, or without a linked Steam account, it is the
// plain button and nothing is polled.
// ---------------------------------------------------------------------------

const SEEN_KEY = "nabs_tel_seen";
// A lap is posted the moment it is driven; thirty seconds is soon enough to
// see it on the way back to the pits without a page full of members polling
// hard.
const POLL_MS = 30_000;
const FRESH_MS = 12 * 3600_000;

const TITLE = "Your recorded laps against the field's";
const PLAIN = { href: "/tools", lit: false, short: "Telemetry", long: "Telemetry · your laps against the field", title: TITLE };

function readSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) || "";
  } catch {
    return "";
  }
}

export function useTelemetryNews(open) {
  const { isLoggedIn } = useAuth();
  const { slug, active } = useSeries();
  const series = slug || active?.slug || null;
  const [mine, setMine] = useState(null);
  const [seen, setSeen] = useState(readSeen);

  const load = useCallback(
    async (alive) => {
      try {
        const r = await api.telemetryMyLatest(series);
        if (alive()) setMine(r);
      } catch {
        /* the plain button stays */
      }
    },
    [series]
  );
  useVisiblePoll(load, POLL_MS, !!open && isLoggedIn, series);

  if (!open) return null;
  const lap = mine?.latest;
  const me = mine?.steamId;
  if (!lap || !me || !isLoggedIn) return PLAIN;

  const link = [lap.trackKey, `${me}.${lap.lap.lapId}`, lap.against ? `${me}.${lap.against.lapId}` : null].filter(Boolean).join("_");
  const href = `/tools?tel=${encodeURIComponent(link)}&series=${encodeURIComponent(mine.series)}#telemetry`;
  const key = `${mine.series}:${lap.trackKey}:${lap.lap.lapId}`;
  const fresh = Date.now() - Date.parse(lap.lap.storedAt) < FRESH_MS;
  if (!fresh) return PLAIN;

  const onOpen = () => {
    try {
      localStorage.setItem(SEEN_KEY, key);
    } catch {
      /* then it glows until it goes stale */
    }
    setSeen(key);
  };
  // Opened already: the newest lap is still one click away, without the glow.
  if (seen === key) return { ...PLAIN, href, onOpen };

  const where = lap.name || lap.track || "this track";
  const delta = lap.against ? fmtLapDelta(lap.lap.lapTimeMs - lap.against.lapTimeMs) : null;
  const time = fmtLap(lap.lap.lapTimeMs);
  if (lap.kind === "improved") {
    return { href, onOpen, lit: true, short: `New PB ${delta}`, long: `New PB ${delta} · see how you improved`, title: `Your new best at ${where}, ${time}, against the one it beat` };
  }
  if (lap.kind === "lap") {
    return { href, onOpen, lit: true, short: `New lap ${delta}`, long: `New lap, ${delta} to your best · compare`, title: `Your new lap at ${where}, ${time}, against your best` };
  }
  return { href, onOpen, lit: true, short: "First lap in", long: `First lap in · ${time} · watch it`, title: `Your first recorded lap at ${where}, ${time}` };
}
