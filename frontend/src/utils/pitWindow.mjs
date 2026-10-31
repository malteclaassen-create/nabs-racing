// The pit window on the live map: if this car boxed right now, where on the
// track would it come back out, and among whom?
//
// A stop costs a fixed amount of time (`lossMs`: the drive through the lane
// plus the standstill, compared with staying out). After it the car runs that
// much behind where it would otherwise have been, so the spot it rejoins at is
// the spot it was at `lossMs` ago. That is read straight off the car's own
// recent path when the page has watched it for long enough (its real line,
// slow corners and all), and worked out from its lap time when it has not.
//
// Everything is in "progress": laps completed plus the share of the current
// lap, so a car a lap down compares correctly with one in front of it on the
// road. The board's lap counter lags the spline at the line (it waits for the
// next full snapshot), so progress is carried forward from the spline's own
// movement and only re-anchored to the counter when the two clearly disagree.

export const DEFAULT_LOSS_MS = 20000;
export const MIN_LOSS_MS = 5000;
export const MAX_LOSS_MS = 90000;
export const HISTORY_MS = MAX_LOSS_MS + 30000;
// Closer than this to another car when rejoining: the circle says traffic.
export const TRAFFIC_MS = 1500;

const frac = (v) => (((Number(v) || 0) % 1) + 1) % 1;
// A share of a lap folded into [-0.5, 0.5): the short way round.
const fold = (d) => ((((d + 0.5) % 1) + 1) % 1) - 0.5;

export function createProgressTracker() {
  const cars = new Map(); // guid -> { prog, spline, samples: [{ t, prog, x, z }] }

  function update(entries, now) {
    const seen = new Set();
    for (const e of entries || []) {
      if (!e?.guid || !e.onTrack) continue;
      seen.add(e.guid);
      const spline = frac(e.spline);
      const target = (e.lapCount || 0) + spline;
      let st = cars.get(e.guid);
      let prog = target;
      if (st) {
        prog = st.prog + fold(spline - st.spline);
        // Expected: level with the counter, or one lap ahead of it while the
        // counter catches up after the line. Anything else is a new session,
        // a rejoin or a first reading taken during that lag: start over.
        const k = prog - target;
        if (k < -0.5 || k > 1.5) {
          prog = target;
          st.samples.length = 0;
        }
      } else {
        st = { samples: [] };
        cars.set(e.guid, st);
      }
      st.prog = prog;
      st.spline = spline;
      const last = st.samples[st.samples.length - 1];
      if (!last || now > last.t) st.samples.push({ t: now, prog, x: e.pos?.x ?? null, z: e.pos?.z ?? null });
      while (st.samples.length && st.samples[0].t < now - HISTORY_MS) st.samples.shift();
    }
    for (const g of [...cars.keys()]) if (!seen.has(g)) cars.delete(g);
  }

  return {
    update,
    prog: (guid) => cars.get(guid)?.prog ?? null,
    samples: (guid) => cars.get(guid)?.samples || [],
    all: () => cars,
    clear: () => cars.clear(),
  };
}

// The car's own lap time to scale progress into seconds: its last lap when
// that was a normal one, else its best with a little added for a race lap.
export function lapRefMs(car) {
  const best = Number(car?.bestLapMs) || null;
  const last = Number(car?.lastLapMs) || null;
  if (last && (!best || (last >= best * 0.98 && last <= best * 1.25))) return last;
  return best ? Math.round(best * 1.03) : null;
}

// Where the car was `ms` ago, from what the page saw of it. Null when it has
// not been watched that long, or when that stretch does not hang together
// (a reset in between).
function pastPoint(samples, at, progNow) {
  if (!samples.length || samples[0].t > at) return null;
  let i = samples.length - 1;
  while (i > 0 && samples[i - 1].t > at) i--;
  const b = samples[i];
  const a = samples[i - 1] || b;
  const span = b.t - a.t;
  const f = span > 0 ? Math.min(1, Math.max(0, (at - a.t) / span)) : 1;
  const prog = a.prog + (b.prog - a.prog) * f;
  if (!(prog < progNow)) return null;
  // A position only when both ends have one and are close in time: across a
  // longer gap a straight line between them would cut a corner.
  let pos = null;
  if (a.x != null && b.x != null && span <= 3000) pos = { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
  else if (b.x != null && Math.abs(b.t - at) <= 800) pos = { x: b.x, z: b.z };
  return { prog, pos };
}

// A real position on track at this share of the lap, borrowed from any car
// that drove past it recently. Null when nobody did (close enough).
export function positionAtSpline(tracker, spline, tolerance = 0.004) {
  let best = null;
  let bestD = tolerance;
  for (const st of tracker.all().values()) {
    for (const s of st.samples) {
      if (s.x == null) continue;
      const d = Math.abs(fold(frac(s.prog) - spline));
      if (d < bestD) {
        bestD = d;
        best = { x: s.x, z: s.z };
      }
    }
  }
  return best;
}

// The whole answer for one car. Null when there is nothing to say (car not
// on track, no lap time to work with); { inLane: true } while it is in the
// pit lane already.
export function computePitWindow({ cars, subjectGuid, lossMs, tracker, now }) {
  const subject = (cars || []).find((c) => c.guid === subjectGuid);
  if (!subject || !subject.onTrack || subject.isSafetyCar) return null;
  if (subject.inPits) return { inLane: true };
  const progNow = tracker.prog(subject.guid);
  const lap = lapRefMs(subject);
  if (progNow == null || !lap) return null;

  const past = pastPoint(tracker.samples(subject.guid), now - lossMs, progNow);
  const prog = past ? past.prog : progNow - lossMs / lap;
  const spline = frac(prog);

  const others = (cars || [])
    .filter((c) => c.guid !== subject.guid && c.onTrack && !c.isSafetyCar)
    .map((c) => ({ car: c, prog: tracker.prog(c.guid) }))
    .filter((o) => o.prog != null);

  // Running order after the stop: everyone further round than the rejoin.
  const position = 1 + others.filter((o) => o.prog > prog).length;
  const positionNow = 1 + others.filter((o) => o.prog > progNow).length;

  // Who is next to the circle on the ROAD, whatever lap they are on.
  let ahead = null;
  let behind = null;
  for (const o of others) {
    const d = fold(o.prog - prog);
    const laps = Math.round(o.prog - prog - d);
    if (d >= 0 && (!ahead || d < ahead.d)) ahead = { d, laps, car: o.car };
    if (d < 0 && (!behind || d > behind.d)) behind = { d, laps, car: o.car };
  }
  const near = (n) => (n ? { guid: n.car.guid, name: n.car.name, ms: Math.round(Math.abs(n.d) * lap), laps: n.laps } : null);
  const aheadOut = near(ahead);
  const behindOut = near(behind);
  const traffic = [aheadOut, behindOut].some((n) => n && n.ms <= TRAFFIC_MS);

  return {
    inLane: false,
    prog,
    spline,
    pos: past?.pos || null,
    source: past ? "path" : "pace",
    position,
    positionNow,
    ahead: aheadOut,
    behind: behindOut,
    traffic,
  };
}
