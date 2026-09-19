import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "./useAuth.js";

// ---------------------------------------------------------------------------
// The token count for the nav bar, and the news that comes with it.
//
// Its own hook rather than a fetch inside the bar, for two reasons: the bar is
// on every page and must ask ONCE per session rather than once per render, and
// spending tokens on the Personal Area has to move the number up there without
// a page reload. The page fires TOKENS_CHANGED_EVENT after a purchase and the
// bar asks again.
//
// Besides the number, the answer may carry a `gain`: what the member has earned
// since the bar last told them their balance (see unseenGain in
// backend/src/lib/tokens.js). The bar plays that once and then says it has been
// seen, which is what stops the same race being celebrated every page load.
//
// It is measured against what the member was last SHOWN, not against a clock,
// so it does not matter when the points were written. A round is paid the night
// the league office imports it; whoever was not looking gets the "+50" the next
// time they open the site, or when they come back to a tab they left open.
//
// While the trial is switched off the endpoint answers { enabled: false } and
// this returns null, which is what makes the pill disappear from the bar
// entirely rather than sitting there showing a zero.
// ---------------------------------------------------------------------------
export const TOKENS_CHANGED_EVENT = "nabs-tokens-changed";

// Shared across mounts: the bar renders twice on a phone (the strip and the
// open menu), and those two must not be two requests.
let cached = undefined; // undefined = not asked yet, null = not available
let inflight = null;
// The news belongs to the SESSION, not to a component: whichever copy of the
// pill plays it, the other must not play it again.
let pendingGain = null;

// The number this member saw last time, kept across page loads.
//
// The pill is only in the bar once the answer is in, so on every cold load the
// identity capsule was built without it and grew a moment later — the bar
// visibly resizing on a page nobody had touched. The count is the member's own
// and a round trip away from being confirmed, so last time's number is the
// honest thing to put there while it is asked for. A member who has never had
// a pill still gets none, and a trial that has been switched off takes it away
// the moment the answer lands.
const LAST_KEY = "nabs_token_last";

function readLast() {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null; // private mode: the pill simply arrives with the answer
  }
}

function writeLast(value) {
  try {
    if (value == null) localStorage.removeItem(LAST_KEY);
    else localStorage.setItem(LAST_KEY, String(value));
  } catch {
    /* nothing to remember it with; the number on screen is right either way */
  }
}

function load() {
  if (!inflight) {
    inflight = api
      .tokenBalance()
      .then((r) => {
        cached = r?.enabled ? Number(r.balance) || 0 : null;
        if (r?.enabled && r.gain?.gained > 0) pendingGain = r.gain;
        // The total, news or no news. A tab closed mid-celebration comes back
        // to the right number, and the "+100" is still waiting to be played
        // (the server is only told once it has been).
        writeLast(cached);
        return cached;
      })
      .catch(() => {
        cached = null;
        return null;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

// Hand the waiting news to ONE caller. Whoever takes it owns it, and is
// expected to tell the server it has been shown (api.markTokensSeen).
export function takeTokenGain() {
  const gain = pendingGain;
  pendingGain = null;
  return gain;
}

export function useTokenBalance() {
  const { isLoggedIn } = useAuth();
  const [balance, setBalance] = useState(() =>
    cached !== undefined ? cached : isLoggedIn ? readLast() : null
  );

  useEffect(() => {
    if (!isLoggedIn) {
      cached = undefined;
      pendingGain = null;
      writeLast(null); // somebody else may use this browser next
      setBalance(null);
      return;
    }
    let gone = false;
    const ask = () => {
      cached = undefined;
      load().then((b) => {
        if (!gone) setBalance(b);
      });
    };
    if (cached === undefined) ask();
    else setBalance(cached);
    window.addEventListener(TOKENS_CHANGED_EVENT, ask);

    // Coming back to a tab that was left open. A round is paid the moment the
    // league office imports it, and plenty of people have the site sitting in a
    // background tab on a Friday night: without this they would keep looking at
    // the old number until they reloaded, and the "+50" would be saved up for
    // some page load days later. Throttled, because switching tabs is something
    // people do all day.
    const MIN_GAP = 60_000;
    let lastAsk = Date.now();
    const askAgain = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastAsk < MIN_GAP) return;
      lastAsk = Date.now();
      ask();
    };
    document.addEventListener("visibilitychange", askAgain);
    window.addEventListener("focus", askAgain);

    return () => {
      gone = true;
      window.removeEventListener(TOKENS_CHANGED_EVENT, ask);
      document.removeEventListener("visibilitychange", askAgain);
      window.removeEventListener("focus", askAgain);
    };
  }, [isLoggedIn]);

  return balance;
}
