import { useEffect, useRef } from "react";

// A repeating fetch that only ticks while the page is actually on screen.
//
// A background tab keeps polling forever otherwise: three of these across the
// site added up to thousands of requests a day per open tab, for numbers nobody
// was looking at. Pausing them is only allowed to be invisible, so the rule is
// "never later than it would have been anyway":
//   - the first call still happens on mount, hidden or not;
//   - while hidden, no timer runs at all;
//   - coming back refetches straight away.
// Straight away is not instant, and the honest version of that: for the one
// roundtrip after the switch the old number is still on screen, where a
// background poll would already have corrected it. All three call sites update
// a number in place, so what that costs is a value that settles a moment later,
// not a spinner or a gap. Anything that would show a loading state instead does
// not belong on this hook.
//
// `load` is called with an `alive()` predicate — the same guard the call sites
// used to keep in their own effect, so a response that lands after unmount can
// still be dropped instead of setting state.
//
// Deliberately NOT for sockets: a WebSocket must stay open in a hidden tab,
// otherwise reconnecting on return leaves a hole in what it missed.

// A tab flick (or a browser that fires visibilitychange more than once for the
// same switch) must not turn into a burst of requests. Two seconds is short
// enough that it never feels like a delay and long enough to swallow that.
const MIN_GAP_MS = 2000;

// `resetKey` restarts the poll when what it is polling FOR changes, not just
// how often. The live page's server switch is the case: the projection has to
// be refetched the moment the viewer moves to the other board, and waiting out
// the interval would leave the old server's standings sitting under the new
// server's timing for up to twelve seconds. Anything stable (a string, a
// number, null) works; leave it out and nothing changes for the callers that
// were here first.
export function useVisiblePoll(load, intervalMs, enabled = true, resetKey = null) {
  // The callback is a fresh closure on every render. Keeping it in a ref means
  // the timer is never restarted for that reason — restarting it on each render
  // would mean the interval never gets to run out on a busy page.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer = null;
    let lastRun = 0;

    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const run = () => {
      lastRun = Date.now();
      loadRef.current(() => alive);
    };
    // A chained timeout rather than setInterval: pausing and resuming means the
    // gap has to be computed, and one mechanism for both is one thing to get
    // wrong instead of two.
    const tick = () => {
      run();
      timer = setTimeout(tick, intervalMs);
    };
    const arm = (delay) => {
      stop();
      timer = setTimeout(tick, delay);
    };

    const onVisibility = () => {
      if (!alive) return;
      if (document.hidden) return stop();
      if (timer) return; // already ticking, so this switch changes nothing
      const since = Date.now() - lastRun;
      // Catch up immediately unless the last call was seconds ago, in which
      // case wait out the anti-burst window — still far sooner than the regular
      // interval would have come round.
      if (since >= MIN_GAP_MS) tick();
      else arm(MIN_GAP_MS - since);
    };

    run(); // first load happens even in a hidden tab, exactly as before
    if (!document.hidden) arm(intervalMs);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, resetKey]);
}
