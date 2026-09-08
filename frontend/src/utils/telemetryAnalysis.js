// ---------------------------------------------------------------------------
// The arithmetic behind the lap comparison, kept away from the React so it
// can be read and tested on its own.
//
// Every channel of a recorded lap is sampled by TRACK POSITION: slice i sits
// i/(n-1) of the way round. Two laps therefore line up slice for slice, and
// "how far behind is B here" is one subtraction of the two time channels.
// Everything below is built on that one fact.
// ---------------------------------------------------------------------------

const G = 9.81;

// Centred moving average, for every signal that gets eyeballed or thresholded:
// raw 60fps samples wobble, and both the corner detector and the map colouring
// would flicker on the noise.
export function smoothSeries(arr, w = 9) {
  const half = Math.floor(w / 2);
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) { sum += arr[j]; cnt++; }
    out[i] = sum / cnt;
  }
  return out;
}

// The SLOW PARTS of a lap: everywhere the car went below 80% of that lap's own
// top speed, merged across short gaps and trimmed of anything too brief.
//
// These are not the circuit's corners and this file cannot know those. A corner
// taken flat never drops below the line and is invisible here; a lift for
// traffic or a mistake looks exactly like one; a chicane counts once; and the
// threshold moves with the lap's own top speed, so a slipstreamed lap finds a
// different set. They are numbered in lap order for pointing at ("section 4"),
// and every place that shows the number also says how far into the lap it is,
// which is measured rather than guessed.
export function detectCorners(speedRaw) {
  const speed = smoothSeries(speedRaw, 9);
  const vmax = Math.max(...speed);
  const thr = vmax * 0.8;
  const regions = [];
  let cur = null;
  for (let i = 0; i < speed.length; i++) {
    if (speed[i] < thr) {
      if (!cur) cur = { start: i, end: i };
      cur.end = i;
    } else if (cur) {
      regions.push(cur);
      cur = null;
    }
  }
  if (cur) regions.push(cur);
  const merged = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < 12) last.end = r.end;
    else merged.push({ ...r });
  }
  // A slow stretch that runs across the start/finish line shows up twice: as
  // the last section of the lap and again as a "section" at 0%, which is
  // only the exit of the same corner. Keep the one with the braking in it.
  if (merged.length > 1 && merged[0].start === 0 && merged[merged.length - 1].end === speed.length - 1) merged.shift();
  return merged
    .filter((r) => r.end - r.start >= 4)
    .slice(0, 15)
    .map((r) => {
      let apex = r.start;
      for (let i = r.start; i <= r.end; i++) if (speed[i] < speed[apex]) apex = i;
      return { ...r, apex };
    });
}

// Metres driven up to each slice, from the recorded world position (stored in
// decimetres). What turns "brakes 6 slices later" into "brakes 14 m later".
// null when the lap predates positions.
export function cumulativeDist(x, z, n) {
  if (!x || !z) return null;
  const d = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const dx = (x[i] - x[i - 1]) / 10, dz = (z[i] - z[i - 1]) / 10;
    d[i] = d[i - 1] + Math.hypot(dx, dz);
  }
  return d;
}

// First slice in [from, to] where a channel reaches a level; null if it never
// does. Brake points and throttle-on points are both this question.
export function firstAtOrAbove(series, from, to, threshold) {
  for (let i = Math.max(0, from); i <= to; i++) if (series[i] >= threshold) return i;
  return null;
}

export const BRAKE_ON = 30; // % pedal that counts as "braking has started"
export const FULL_THROTTLE = 90; // % pedal that counts as "back on it"

// Where the braking for a corner began: the braking run that leads into the
// apex, found by walking back from the hardest pedal in the approach to where
// the pedal came on. The first slice over 30% would do for most laps, but a
// dab and release well before the corner (a bump, a lift for traffic) would
// then read as a brake point a hundred metres early.
export function brakePoint(lap, from, apex, threshold = BRAKE_ON) {
  let peak = -1, peakAt = null;
  for (let i = Math.max(0, from); i <= apex; i++) if (lap.brake[i] > peak) { peak = lap.brake[i]; peakAt = i; }
  if (peak < threshold) return null;
  let i = peakAt;
  while (i > from && lap.brake[i - 1] >= threshold / 2) i--;
  return i;
}

// A slow section widened into the window the comparison looks at: the
// approach (where the braking happens) and the exit (where the throttle goes
// back on). Positions in lap A's grid.
export function sectionWindows(corners, dist, n) {
  return corners.map((c, k) => {
    const start = Math.max(0, c.start - 30);
    const end = Math.min(n - 1, c.end + 12);
    return {
      n: k + 1,
      start,
      end,
      apex: c.apex,
      // Where this is in the lap, which is a fact — unlike a corner number,
      // which this file is in no position to know (see detectCorners).
      atM: dist ? Math.round(dist[c.apex]) : null,
      atPct: Math.round((c.apex / (n - 1)) * 100),
    };
  });
}

// The per-section story in numbers: who gains how much through it, who brakes
// later (metres, when positions were recorded), who carries more mid-corner
// speed, who exits faster, who is back on full throttle first. Numbers,
// deliberately not coaching prose — "brake earlier next time" would be the
// site guessing at causality.
export function cornerInsights(lapA, lapB, corners, dist, n) {
  return sectionWindows(corners, dist, n).map((s) => {
    // + = B lost time across the section = A gained.
    const gainMs = (lapB.t[s.end] - lapA.t[s.end]) - (lapB.t[s.start] - lapA.t[s.start]);
    const brakeA = brakePoint(lapA, s.start, s.apex);
    const brakeB = brakePoint(lapB, s.start, s.apex);
    const gasA = firstAtOrAbove(lapA.gas, s.apex, s.end, FULL_THROTTLE);
    const gasB = firstAtOrAbove(lapB.gas, s.apex, s.end, FULL_THROTTLE);
    const minA = Math.min(...lapA.speed.slice(s.apex - (s.apex - s.start) / 2, s.end + 1));
    const minB = Math.min(...lapB.speed.slice(s.apex - (s.apex - s.start) / 2, s.end + 1));
    const metres = (a, b) => (a != null && b != null && dist ? Math.round(dist[b] - dist[a]) : null);
    return {
      ...s,
      gainMs,
      brakeA,
      brakeB,
      gasA,
      gasB,
      // + = B brakes later than A.
      brakeDeltaM: metres(brakeA, brakeB),
      // + = B is back on full throttle later than A.
      throttleDeltaM: metres(gasA, gasB),
      minA,
      minB,
      midDelta: minB - minA, // + = B carries more mid-corner speed
      exitA: lapA.speed[s.end],
      exitB: lapB.speed[s.end],
      exitDelta: lapB.speed[s.end] - lapA.speed[s.end], // + = B exits faster
    };
  });
}

// One lap's brake points and throttle-on points, as slice indices, one of
// each per slow section where the pedal actually did that. Drawn on the map.
export function lapMarkers(lap, corners, n) {
  const brake = [], gas = [];
  for (const s of sectionWindows(corners, null, n)) {
    const b = brakePoint(lap, s.start, s.apex);
    if (b != null) brake.push(b);
    const g = firstAtOrAbove(lap.gas, s.apex, s.end, FULL_THROTTLE);
    if (g != null) gas.push(g);
  }
  return { brake, gas };
}

// The lap in `count` sectors of equal distance (equal slice count without
// positions), each with B's time loss against A across it. The three add up
// to the finish-line gap exactly.
export function sectorDeltas(lapA, lapB, dist, n, count = 3) {
  const total = dist ? dist[n - 1] : n - 1;
  const bounds = [0];
  for (let s = 1; s < count; s++) {
    const target = (total * s) / count;
    let i = 0;
    if (dist) while (i < n - 2 && dist[i] < target) i++;
    else i = Math.round(target);
    bounds.push(i);
  }
  bounds.push(n - 1);
  return Array.from({ length: count }, (_, s) => {
    const from = bounds[s], to = bounds[s + 1];
    return {
      n: s + 1,
      from,
      to,
      deltaMs: (lapB.t[to] - lapA.t[to]) - (lapB.t[from] - lapA.t[from]),
      timeA: lapA.t[to] - lapA.t[from],
      timeB: lapB.t[to] - lapB.t[from],
    };
  });
}

// Accelerations the car felt, in g, derived rather than recorded.
//
// Longitudinal from the speed trace against time (dv/dt), which every lap has.
// Lateral from the recorded line: the path's curvature times speed squared —
// which needs positions, so it is null for laps that predate them. Both are
// smoothed, because a derivative of integer km/h at 60fps is mostly noise.
export function gForces(lap, n) {
  const v = smoothSeries(lap.speed.slice(0, n).map((k) => k / 3.6), 5);
  const long = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const dt = (lap.t[i + 1] - lap.t[i - 1]) / 1000;
    long[i] = dt > 0 ? (v[i + 1] - v[i - 1]) / dt / G : 0;
  }
  long[0] = long[1];
  long[n - 1] = long[n - 2];
  let lat = null;
  if (lap.x && lap.z) {
    const dist = cumulativeDist(lap.x, lap.z, n);
    const step = 2;
    const heading = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - step), b = Math.min(n - 1, i + step);
      heading[i] = Math.atan2(lap.z[b] - lap.z[a], lap.x[b] - lap.x[a]);
    }
    const kappa = new Array(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      let dh = heading[i + 1] - heading[i - 1];
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      const ds = dist[i + 1] - dist[i - 1];
      kappa[i] = ds > 0.5 ? dh / ds : 0;
    }
    const k = smoothSeries(kappa, 9);
    lat = k.map((kk, i) => (v[i] * v[i] * kk) / G);
  }
  return { long: smoothSeries(long, 5), lat };
}

// Put a lap on another lap's grid.
//
// Every channel is sampled at i/(n-1) of the way round the track, so two laps
// only line up slice-for-slice while they share n. The store deliberately
// accepts 50 to 1500 samples so the in-game script can be tweaked without a
// lockstep deploy — which means the day that number changes, one lap in a
// comparison has 800 slices and the other 1000, and index 400 is a different
// CORNER in each. Nothing would have said so: the delta, the corner list and
// the map colours would all have been quietly wrong.
//
// Linear interpolation between the neighbouring slices, which is exact enough
// for channels already smoothed over a car length.
export function resampleLap(lap, n) {
  if (!lap || lap.n === n) return lap;
  const keys = ["t", "speed", "gas", "brake", "steer", "gear", "x", "z"];
  const out = { ...lap, n, resampledFrom: lap.n };
  for (const k of keys) {
    const src = lap[k];
    if (!Array.isArray(src) || src.length < 2) continue;
    const dst = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = (i / (n - 1)) * (src.length - 1);
      const lo = Math.floor(p);
      const hi = Math.min(src.length - 1, lo + 1);
      dst[i] = k === "gear" ? src[lo] : src[lo] + (src[hi] - src[lo]) * (p - lo);
    }
    out[k] = dst;
  }
  return out;
}

// Where a lap had got to after `ms`. The channels are sampled by track
// POSITION, so this is the one place that has to think in time: it walks the
// lap's own time channel, from a hint index, because playback only ever moves
// forward and rescanning 800 slices sixty times a second for two laps is work
// nobody needs.
export function indexAtTime(lap, ms, n, hint = 0) {
  let i = Math.max(0, Math.min(hint, n - 1));
  while (i < n - 1 && lap.t[i] < ms) i++;
  return i;
}

// How the gap moved over the last `back` slices: + = B lost ground (A
// gaining). The dashboard's "who is gaining right now".
export function deltaTrend(lapA, lapB, at, back = 20) {
  const i = Math.max(0, Math.min(lapA.t.length - 1, at));
  const j = Math.max(0, i - back);
  return (lapB.t[i] - lapA.t[i]) - (lapB.t[j] - lapA.t[j]);
}

// The section the cursor is in, if any.
export function sectionAt(sections, at) {
  return sections.find((s) => at >= s.start && at <= s.end) || null;
}

// The next section apex after the cursor (dir > 0) or the previous one before
// it; null at either end.
export function neighbourSection(sections, at, dir) {
  if (dir > 0) return sections.find((s) => s.apex > at + 2) || null;
  for (let i = sections.length - 1; i >= 0; i--) if (sections[i].apex < at - 2) return sections[i];
  return null;
}

export function formatLapTime(ms) {
  const v = Math.max(0, Number(ms) || 0);
  return `${Math.floor(v / 60000)}:${((v % 60000) / 1000).toFixed(3).padStart(6, "0")}`;
}
