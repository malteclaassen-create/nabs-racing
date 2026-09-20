import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "./useAuth.js";

// ---------------------------------------------------------------------------
// This member's training week: laps done on the practice server since the last
// race, and which milestones they have reached (backend/src/lib/practiceTokens
// .js).
//
// One store for the whole site rather than a fetch per component. Three places
// want the same answer at the same time — the card on the points page, the
// panel on the live page and the cue at the bottom of every page — and they
// must be one request, not three.
//
// Each caller says how often IT needs the answer; the timer runs at the
// shortest of them and only while the tab is visible. The cue that sits on
// every page asks for no clock at all (0), so an ordinary page costs one
// request when it loads; opening the panel on the live page puts a real
// interval on the same store for as long as it is open.
// ---------------------------------------------------------------------------

let cached; // undefined = never asked, null = nothing to show
let inflight = null;
const subs = new Map(); // setter -> how often that subscriber wants it, in ms
let timer = null;
let lastAsk = 0;

function load() {
  if (!inflight) {
    inflight = api
      .tokenPractice()
      .then((r) => {
        cached = r?.enabled ? r.practice || null : null;
        return cached;
      })
      .catch(() => {
        // Keep whatever we had: a dropped request is not "you have no laps".
        if (cached === undefined) cached = null;
        return cached;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function ask() {
  lastAsk = Date.now();
  load().then((week) => {
    for (const set of subs.keys()) set(week);
  });
}

function retime() {
  if (timer) clearInterval(timer);
  timer = null;
  // A subscriber that asks for 0 wants no clock at all: it is happy with what
  // arrives on a page load and when the tab comes back (the cue at the bottom
  // of the site is one, and it sits on every page of it).
  const wanted = [...subs.values()].filter((ms) => ms > 0);
  if (!wanted.length) return;
  timer = setInterval(() => {
    if (document.visibilityState === "visible") ask();
  }, Math.min(...wanted));
}

// After something that could have changed the laps (nothing does today, but a
// page that pays out would want to say so).
export function refreshPracticeWeek() {
  ask();
}

export function usePracticeWeek(everyMs = 5 * 60 * 1000) {
  const { isLoggedIn } = useAuth();
  const [week, setWeek] = useState(() => (cached === undefined ? null : cached));

  useEffect(() => {
    if (!isLoggedIn) {
      cached = undefined; // somebody else may use this browser next
      setWeek(null);
      return undefined;
    }
    subs.set(setWeek, everyMs);
    retime();
    if (cached === undefined) ask();
    else setWeek(cached);

    // Coming back to a tab that was left open on the live page all evening.
    const MIN_GAP = 30_000;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastAsk < MIN_GAP) return;
      ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      subs.delete(setWeek);
      retime();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [isLoggedIn, everyMs]);

  return week;
}
