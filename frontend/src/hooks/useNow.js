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
//
// And it is the BOARD's clock, not the browser's. Every lap time on the live
// page is "now minus when this driver crossed the line", where the crossing is
// stamped by the race server and `now` used to come from the viewer's own PC.
// Two unrelated clocks, and a PC that is a couple of seconds out (which is
// ordinary) made the current-lap clock read a couple of seconds out with it.
// That was visible: the running sector counts from the lap clock minus the
// splits already banked, so a slow clock meant sector two sat blank until the
// lap clock caught up with a split the server had already handed out.
//
// So every board frame carries the time it was built, and the offset between
// that and this browser's clock is what `useNow` adds. The offset is taken as
// the LARGEST recent sample rather than the latest: a frame can only ever
// arrive later than it was built, so each sample under-reads by that frame's
// travel time, and the biggest one is the one that travelled fastest.
// ---------------------------------------------------------------------------

const TICK_MS = 100;

// Enough samples to cover a bad minute and cheap to scan: at ~1.4 frames a
// second this is roughly the last three quarters of a minute.
const SKEW_SAMPLES = 64;

const skewSamples = [];
let skew = 0;

// Called with `updatedAt` off each board frame, the moment it arrives.
export function noteBoardClock(builtAt) {
  if (!builtAt) return;
  const sample = builtAt - Date.now();
  // A frame from a clock that is minutes out is not a clock offset, it is a
  // frozen board or a machine with the wrong date; correcting by it would make
  // every lap time absurd, so it is left alone.
  if (!Number.isFinite(sample) || Math.abs(sample) > 60_000) return;
  skewSamples.push(sample);
  if (skewSamples.length > SKEW_SAMPLES) skewSamples.shift();
  skew = Math.max(...skewSamples);
}

// The board's clock, for anything that has to compare against a time the board
// gave it. Same value `useNow` ticks on, for code that needs it once.
export function boardNow() {
  return Date.now() + skew;
}

// Test seam: a fresh page has no samples.
export function __resetBoardClock() {
  skewSamples.length = 0;
  skew = 0;
}

const listeners = new Set();
let timer = null;
let now = 0;

function start() {
  if (timer) return;
  timer = setInterval(() => {
    now = boardNow();
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
  const [value, setValue] = useState(() => boardNow());

  useEffect(() => {
    if (!active) return undefined;
    // Take the current instant on subscribe rather than waiting up to a tick
    // for the first one; otherwise a row that just appeared shows a stale time
    // for a tenth of a second.
    setValue(boardNow());
    listeners.add(setValue);
    start();
    return () => {
      listeners.delete(setValue);
      if (!listeners.size) stop();
    };
  }, [active]);

  return value;
}
