import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// One clock for the whole page.
//
// Several things on the live board tick: the current-lap clock on every
// on-track driver, and the sector a driver is in right now. Written the obvious
// way that is one setInterval PER ROW, and a full grid is 38 of them, all
// firing ten times a second and each re-rendering its own subtree. They also
// drift apart, so the digits across the board change at 38 slightly different
// moments, which reads as jitter rather than as a clock.
//
// So the interval lives here, module level, shared. It starts when the first
// component subscribes and stops when the last one leaves, which matters on a
// page that is mostly NOT a live session: no session, no subscribers, no timer.
// Everyone reading it also gets the same instant, so the whole board ticks
// together.
// ---------------------------------------------------------------------------

const TICK_MS = 100;

const listeners = new Set();
let timer = null;
let now = Date.now();

function start() {
  if (timer) return;
  timer = setInterval(() => {
    now = Date.now();
    for (const notify of listeners) notify(now);
  }, TICK_MS);
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

// `active` is what a paused row passes: a driver in the pits has no running
// sector, and a component that unsubscribes while hidden lets the timer stop
// altogether once nothing on screen needs it.
export function useNow(active = true) {
  const [value, setValue] = useState(now);

  useEffect(() => {
    if (!active) return undefined;
    // Take the current instant on subscribe rather than waiting up to a tick
    // for the first one; otherwise a row that just appeared shows a stale time
    // for a tenth of a second.
    setValue(Date.now());
    listeners.add(setValue);
    start();
    return () => {
      listeners.delete(setValue);
      if (!listeners.size) stop();
    };
  }, [active]);

  return value;
}
