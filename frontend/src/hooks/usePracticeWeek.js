import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "./useAuth.js";
import { useSeries } from "../context/SeriesContext.jsx";
import { TOKENS_CHANGED_EVENT } from "./useTokenBalance.js";

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
let lastReached = null; // training milestones reached at the last answer

function milestonesReached(week) {
  if (!week) return 0;
  const weeks = week.weeks?.length ? week.weeks : [week];
  let n = 0;
  for (const w of weeks) for (const t of w.tiers || []) if ((w.laps || 0) >= t.laps) n += 1;
  return n;
}
let cachedFor; // the series the answer was asked for
let inflight = null;
const subs = new Map(); // setter -> how often that subscriber wants it, in ms
let timer = null;
let lastAsk = 0;

function load(series) {
  if (!inflight) {
    cachedFor = series;
    inflight = api
      .tokenPractice(series)
      .then((r) => {
        cached = r?.enabled ? r.practice || null : null;
        // A training milestone just paid: tell the nav bar to ask for the
        // balance, so the green run and the "+10" happen while you watch.
        const reached = milestonesReached(cached);
        if (lastReached != null && reached > lastReached) window.dispatchEvent(new Event(TOKENS_CHANGED_EVENT));
        lastReached = reached;
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

// `force` is for a caller that knows something changed. Otherwise an answer
// from a moment ago is good enough: the cue, the points page and the live
// card all mount at once, and three of them landing in the same second is one
// question asked three times.
function ask({ force = false, series = null } = {}) {
  if (!force && cached !== undefined && cachedFor === series && Date.now() - lastAsk < 1500) return;
  lastAsk = Date.now();
  load(series).then((week) => {
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
    if (document.visibilityState === "visible") ask({ series: cachedFor });
  }, Math.min(...wanted));
}

// After something that could have changed the laps (nothing does today, but a
// page that pays out would want to say so).
export function refreshPracticeWeek() {
  ask({ force: true });
}

export function usePracticeWeek(everyMs = 5 * 60 * 1000) {
  const { isLoggedIn } = useAuth();
  // Which series the site is showing. The answer leads with that one's week
  // and carries every other series' week beside it: the points themselves are
  // the site's, not a series'.
  const { slug, active } = useSeries();
  const series = slug || active?.slug || null;
  const [week, setWeek] = useState(() => (cached === undefined ? null : cached));

  useEffect(() => {
    if (!isLoggedIn) {
      cached = undefined; // somebody else may use this browser next
      setWeek(null);
      return undefined;
    }
    subs.set(setWeek, everyMs);
    retime();
    if (cached === undefined || cachedFor !== series) ask({ series });
    else setWeek(cached);

    // Coming back to a tab that was left open on the live page all evening.
    const MIN_GAP = 30_000;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastAsk < MIN_GAP) return;
      ask({ series });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      subs.delete(setWeek);
      retime();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [isLoggedIn, everyMs, series]);

  return week;
}
