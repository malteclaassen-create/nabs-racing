// ---------------------------------------------------------------------------
// Is this car in the pit lane, really?
//
// The upstream's IsInPits is a live telemetry flag, and it lies for a moment at
// a time. On Most it goes true while a driver is plainly on the circuit through
// the last corners, and again for some drivers as they cross the line onto a
// new lap; two quick laps in a row seem to bring it on more often. On the board
// that showed up as "In pit" flashing on a car doing 250 km/h, which is worse
// than useless: it is the one field a viewer reads to know why somebody's lap
// time stopped.
//
// Two independent guards, because the flag is wrong in two different ways:
//
//   SPEED   a car at racing speed is not in the pit lane, whatever the flag
//           says. AC's pit limiter is far below this, so a genuine pit lane
//           never trips it, and a flicker at racing speed is killed on the
//           spot rather than after a wait.
//   TIME    a flicker is short and a pit stop is not, so the flag has to hold
//           before the board repeats it. Entering costs a couple of seconds of
//           delay (nobody is reading a lap time in that window anyway) and
//           leaving is quicker, because a car that has rejoined is news.
//
// Deliberately not a spline/position check: the pit lane's position is not in
// the data the relay gets, and guessing it from the track map would be a second
// thing to get wrong per circuit.
// ---------------------------------------------------------------------------

// A genuine pit lane is under 80 km/h (AC's limiter), so this leaves a wide
// margin for a car rolling in before the limiter catches and still rejects
// anything that is actually racing.
export const PIT_MAX_SPEED_KMH = 110;

// How long the flag has to hold before the board says "in the pits". Every
// flicker seen so far is a fraction of this; the shortest real pit visit is
// many times it.
export const PIT_CONFIRM_MS = 2500;

// And how long before it takes it back. Shorter than the confirm on purpose: a
// car rejoining is the interesting direction, and the speed guard has usually
// answered it already.
export const PIT_RELEASE_MS = 800;

// km/h from an ET53 velocity vector (m/s components), or null when the frame
// carries no velocity — a parked car in the garage sends none, and "no reading"
// must not read as "stationary" (that would confirm a pit stop rather than
// leave the question to the timer).
export function speedKmhOf(live) {
  const v = live?.Velocity;
  if (!v) return null;
  return Math.hypot(v.X || 0, v.Y || 0, v.Z || 0) * 3.6;
}

// One filter per race server. Keyed by whatever the caller uses for a driver;
// the relay uses the upstream GUID.
export function createPitFilter() {
  // key -> { raw, since, shown }
  //   raw   what the flag says now, after the speed guard
  //   since when raw last changed
  //   shown what the board is being told
  const byKey = new Map();

  return {
    // Feed one observation and get the answer to publish. Safe to call from
    // more than one place at different rates (the board build and the telemetry
    // handler both do): it advances on wall-clock time, not on frame counts, so
    // an extra call is a no-op and a missed one only delays a transition.
    read(key, rawFlag, speedKmh, now = Date.now()) {
      const raw = !!rawFlag && !(speedKmh != null && speedKmh > PIT_MAX_SPEED_KMH);
      let st = byKey.get(key);
      if (!st) {
        // First sight of this car. Whatever it says now is taken at face value:
        // somebody opening the page mid-session must see who is in the pits
        // straight away, not after a wait that only exists to filter flicker.
        st = { raw, since: now, shown: raw };
        byKey.set(key, st);
        return st.shown;
      }
      if (raw !== st.raw) {
        st.raw = raw;
        st.since = now;
      }
      const held = now - st.since;
      if (raw && !st.shown && held >= PIT_CONFIRM_MS) st.shown = true;
      if (!raw && st.shown && held >= PIT_RELEASE_MS) st.shown = false;
      return st.shown;
    },

    // What was last published for this car, without advancing anything. For a
    // caller that has no fresh observation to offer.
    peek(key) {
      return byKey.get(key)?.shown ?? false;
    },

    // When the flag itself last changed, which for a car in the pits is when it
    // crossed onto pit road. Deliberately the RAW transition rather than the
    // moment the board repeated it: the confirm delay above exists to filter
    // flicker, not to knock two and a half seconds off the clock that times the
    // stop.
    since(key) {
      return byKey.get(key)?.since ?? null;
    },

    // A new session is a new set of cars.
    clear() {
      byKey.clear();
    },
  };
}
