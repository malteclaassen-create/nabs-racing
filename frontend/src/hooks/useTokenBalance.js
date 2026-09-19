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

function load() {
  if (!inflight) {
    inflight = api
      .tokenBalance()
      .then((r) => {
        cached = r?.enabled ? Number(r.balance) || 0 : null;
        if (r?.enabled && r.gain?.gained > 0) pendingGain = r.gain;
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
  const [balance, setBalance] = useState(cached === undefined ? null : cached);

  useEffect(() => {
    if (!isLoggedIn) {
      cached = undefined;
      pendingGain = null;
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
