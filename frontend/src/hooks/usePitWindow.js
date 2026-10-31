import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "./useAuth.js";
import { DEFAULT_LOSS_MS, MIN_LOSS_MS, MAX_LOSS_MS } from "../utils/pitWindow.mjs";

// The board ids of the signed-in member's own cars, so the pit window opens
// on their car without a click. The ids are a per-process pseudonym on the
// backend, so a backend restart changes them: while none of ours is on the
// board and cars are, ask again every so often. Cheap: a couple of reads.
const REASK_MS = 90000;
export function useOwnLiveGuids(cars, enabled = true) {
  const { isLoggedIn: signedIn } = useAuth();
  const isLoggedIn = signedIn && enabled;
  const [guids, setGuids] = useState([]);
  const askedAt = useRef(0);
  const ask = useCallback(() => {
    askedAt.current = Date.now();
    api
      .liveMe()
      .then((res) => setGuids(Array.isArray(res?.guids) ? res.guids : []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!isLoggedIn) {
      setGuids([]);
      return;
    }
    ask();
  }, [isLoggedIn, ask]);
  const onBoard = (cars || []).some((c) => guids.includes(c.guid));
  const anyCars = (cars || []).length > 0;
  useEffect(() => {
    if (!isLoggedIn || !anyCars || onBoard) return undefined;
    const t = setTimeout(ask, Math.max(0, REASK_MS - (Date.now() - askedAt.current)));
    return () => clearTimeout(t);
  }, [isLoggedIn, anyCars, onBoard, ask, guids]);
  return guids;
}

const keyFor = (track) => `nabs_pit_loss:${track || "?"}`;

function readSaved(track) {
  try {
    const v = Number(localStorage.getItem(keyFor(track)));
    return Number.isFinite(v) && v >= MIN_LOSS_MS && v <= MAX_LOSS_MS ? v : null;
  } catch {
    return null;
  }
}

// The stop cost the pit window uses: the viewer's own number for this
// circuit when they set one, else what the race has taught the board so far,
// else a plain default. Remembered per circuit in this browser.
export function usePitLoss(track, learned) {
  const [saved, setSaved] = useState(() => readSaved(track));
  useEffect(() => setSaved(readSaved(track)), [track]);
  const set = useCallback(
    (ms) => {
      const v = ms == null ? null : Math.min(MAX_LOSS_MS, Math.max(MIN_LOSS_MS, Math.round(ms / 100) * 100));
      setSaved(v);
      try {
        if (v == null) localStorage.removeItem(keyFor(track));
        else localStorage.setItem(keyFor(track), String(v));
      } catch {
        /* private window: the number holds for this visit */
      }
    },
    [track]
  );
  const learnedMs = learned?.ms > 0 ? learned.ms : null;
  const source = saved != null ? "yours" : learnedMs != null ? "learned" : "default";
  const ms = saved ?? learnedMs ?? DEFAULT_LOSS_MS;
  return { ms, source, learnedMs, learnedStops: learned?.stops || 0, set };
}

// Shown or put away, per browser.
const OFF_KEY = "nabs_pit_window_off";
export function usePitWindowShown() {
  const [off, setOff] = useState(() => {
    try {
      return localStorage.getItem(OFF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = useCallback((shown) => {
    setOff(!shown);
    try {
      if (shown) localStorage.removeItem(OFF_KEY);
      else localStorage.setItem(OFF_KEY, "1");
    } catch {
      /* fine for this visit */
    }
  }, []);
  return [!off, set];
}
