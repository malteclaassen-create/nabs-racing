/**
 * A circuit drawn by the editor rather than by hand.
 *
 * Four things make the difference between a generated shape and something that
 * reads as a race track, and this does all four:
 *
 *   The plan. A closed polar curve -- a base radius with harmonics laid over it
 *   and the whole thing stretched along one axis, the way almost every real
 *   circuit is longer than it is wide. One radius per angle means the lap
 *   always closes and can never cross itself, and the angles are checked before
 *   the shape is accepted, so no corner is tighter than a car can take.
 *
 *   The length. Real circuits run 4 to 7 km, not the kilometre and a half a
 *   plausible looking radius gives you. The plan is scaled to hit the length
 *   asked for, which leaves every heading change exactly as it was -- a scaled
 *   curve is the same curve -- so the corners open out rather than turning into
 *   a longer version of the same hairpin.
 *
 *   The ground. The landscape is generated first, as long, low waves, and the
 *   circuit is then laid ON it and smoothed along its length. That is how a
 *   real track gets its elevation: the road follows the country, cutting into
 *   the hills and riding over the dips rather than ignoring them. The terrain
 *   blend under the road turns what is left into cuttings and embankments.
 *
 *   The start/finish. A genuinely straight straight, level along its length,
 *   with the timing line in the MIDDLE of it and the pit lane alongside --
 *   entry before the line, exit after it, both glued onto the edge of the
 *   tarmac by the same code the Attach button uses.
 */
import * as THREE from 'three';
import { computeFrames, frameAtDistance, makeNode, pathLength, type Frame } from './spline';
import { attachPitLane } from './pitLink';
import { cellSize, createHeights, sampleHeights } from './terrain';
import { PointIndex } from './spatial';
import { PREFABS_BY_KEY, instantiatePrefab } from './prefabs';
import { propTileBox } from './library';
import { createPaint, createPaintEdge, paintGroundRect, paintValue, GROUND_KINDS } from './terrain';
import type { PitSettings, PropInstance, TerrainSettings, TrackNode } from '../types';

export type CircuitSize = 'short' | 'medium' | 'long';

/** Lap length aimed for, metres. The range real circuits actually occupy. */
const TARGET_LENGTH: Record<CircuitSize, number> = { short: 4000, medium: 5500, long: 7000 };

/** Metres between control points. Close to what a hand drawn lap ends up with. */
const POINT_SPACING = 170;

/**
 * Height between the lowest and highest point of the LANDSCAPE, metres.
 *
 * The circuit picks up a fraction of it -- it crosses the country, it does not
 * visit every summit -- so a 70 m landscape gives a 7 km lap something like 25
 * to 35 m of climb, which is Spa's neighbourhood rather than Silverstone's.
 */
const RELIEF: Record<CircuitSize, number> = { short: 35, medium: 50, long: 60 };

/** Metres per terrain cell aimed for, and the grid the editor will not exceed. */
const TERRAIN_CELL = 10;
const MAX_TERRAIN_RES = 321;

/**
 * Harmonics: [wave number, largest share of the radius it may take].
 *
 * Two and three make the long sweeps that give a lap its overall shape; four
 * through seven are the corners inside them. Without the high ones a 7 km lap
 * scaled up from a smooth curve is one enormous circle with a kink in it --
 * the length is right and there is nothing to drive.
 */
const HARMONICS: Array<[number, number]> = [
  [2, 0.15],
  [3, 0.12],
  [4, 0.09],
  [5, 0.07],
  [6, 0.05],
  [7, 0.035],
];

/**
 * The sharpest corner the generator will hand over.
 *
 * Measured as the heading change from one control point to the next. Much past
 * this and the spline through them starts to loop rather than turn, which is a
 * shape no amount of dragging rescues.
 */
const MAX_TURN = (55 * Math.PI) / 180;

/** How much longer than wide the plan is stretched. */
const STRETCH = 1.35;

/**
 * How hard corners are pulled in and straights pushed out.
 *
 * A sum of harmonics curves everywhere and is straight nowhere, which is what
 * makes a generated lap read as a wobbly circle: real circuits are straights
 * joined by corners. Each pass moves every control point along the line
 * between its neighbours -- towards it where the road is nearly straight
 * already, away from it where it is turning -- so the flat parts flatten into
 * straights and the bends tighten into corners, at constant length.
 */
const SHARPEN = 0.42;

/** Below this share of MAX_TURN a point counts as straight and is flattened. */
const STRAIGHT_BELOW = 0.35;

/*
 * Real corners.
 *
 * The plan above can only bend MAX_TURN per point, and the points are 170 m
 * apart, so nothing it draws is ever tighter than a ~180 m radius -- which a
 * modern car takes flat. That is why a generated lap felt like corners you
 * never brake for: they were all fast sweepers by construction.
 *
 * So after the shape is settled, every run of consecutive turning points is
 * REBUILT as a proper corner: a circular arc of a radius picked for how much
 * the road turns there, laid tangent to the straight in and the straight out.
 * The heading into and out of the corner is untouched, so the lap still
 * closes; the distance the old sweeper wasted becomes straight, which is
 * where the braking zone comes from.
 */
/** A run of points turning at least this much each belongs to a corner. */
const CORNER_POINT_TURN = (10 * Math.PI) / 180;
/** Corners turning less than this in total stay as the fast kinks they are. */
const CORNER_TURN_MIN = (38 * Math.PI) / 180;
/** Arc sampling: one control point about every this much of bend. */
const ARC_STEP = (26 * Math.PI) / 180;
/** Chance a lesser corner is left as the fast sweeper the plan drew. */
const KEEP_SWEEPER = 0.25;

interface CornerGroup {
  /** First and last turning point, inclusive. Never wraps: the ring is rotated first. */
  from: number;
  to: number;
  /** Signed total turn over the group, radians. */
  turn: number;
}

/** Signed heading change at point i of a closed ring, radians. */
function signedTurnAt(pts: Pt[], i: number): number {
  const n = pts.length;
  const prev = pts[(i - 1 + n) % n];
  const cur = pts[i];
  const next = pts[(i + 1) % n];
  let d = Math.atan2(next.z - cur.z, next.x - cur.x) - Math.atan2(cur.z - prev.z, cur.x - prev.x);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * A corner radius for a total heading change, metres.
 *
 * The tiers are what circuits are actually built with: a hairpin is 25 to 50 m
 * (Monaco's is 15, La Source about 35), a second-to-third gear corner 40 to 80,
 * and anything gentler opens out from there. Tighter turns get tighter radii,
 * which is the difference between a corner and a curve in the road.
 */
function cornerRadius(totalTurn: number, rng: () => number): number {
  const deg = (Math.abs(totalTurn) * 180) / Math.PI;
  if (deg >= 110) return 28 + rng() * 22;
  if (deg >= 70) return 42 + rng() * 35;
  return 65 + rng() * 60;
}

/**
 * Build one corner: the arc of radius `R` tangent to the straight into the
 * group and the straight out of it. Returns the points that replace indices
 * `g.from..g.to`, or null when no arc of a sensible radius fits there.
 */
function filletCorner(pts: Pt[], g: CornerGroup, radius: number): Pt[] | null {
  const n = pts.length;
  const aPrev = pts[(g.from - 2 + n) % n];
  const A = pts[(g.from - 1 + n) % n];
  const B = pts[(g.to + 1) % n];
  const bNext = pts[(g.to + 2) % n];

  const lenA = Math.hypot(A.x - aPrev.x, A.z - aPrev.z) || 1;
  const dA = { x: (A.x - aPrev.x) / lenA, z: (A.z - aPrev.z) / lenA };
  const lenB = Math.hypot(bNext.x - B.x, bNext.z - B.z) || 1;
  const dB = { x: (bNext.x - B.x) / lenB, z: (bNext.z - B.z) / lenB };

  const sign = Math.sign(g.turn) || 1;
  // Towards the centre of the turn: the right-hand perpendicular for a right
  // turn (positive), the left-hand one for a left.
  const nA = { x: -dA.z * sign, z: dA.x * sign };
  const nB = { x: -dB.z * sign, z: dB.x * sign };

  for (let R = radius, attempt = 0; attempt < 4; attempt++, R *= 0.72) {
    /*
     * The centre sits at distance R from both straights, on the inside of the
     * turn: the crossing of the two lines offset inwards by R. Solving the
     * offset lines directly (rather than the textbook tangent-length formula)
     * is what keeps a hairpin working -- two nearly opposite straights never
     * meet at a corner point, but their offsets still cross while the gap
     * between them is more than 2R.
     */
    const wx = B.x + nB.x * R - (A.x + nA.x * R);
    const wz = B.z + nB.z * R - (A.z + nA.z * R);
    const det = dB.x * dA.z - dA.x * dB.z;
    if (Math.abs(det) < 1e-4) continue;
    const s = (-dB.z * wx + dB.x * wz) / det;
    const u = (-dA.z * wx + dA.x * wz) / det;
    const C = { x: A.x + nA.x * R + dA.x * s, z: A.z + nA.z * R + dA.z * s };
    const T1 = { x: C.x - nA.x * R, z: C.z - nA.z * R };
    const T2 = { x: C.x - nB.x * R, z: C.z - nB.z * R };

    // The arc has to begin after the entry point and end before the exit one,
    // or it would be rebuilding the straights rather than the corner.
    if (s < 4 || u > -4) continue;
    if (s > 600 || u < -600) continue;

    const a1 = Math.atan2(T1.z - C.z, T1.x - C.x);
    const a2 = Math.atan2(T2.z - C.z, T2.x - C.x);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    // The position angle turns the same way the heading does; a sweep read off
    // the wrong side of the circle is the long way round.
    if (Math.sign(sweep) !== sign) sweep += sign * Math.PI * 2;
    // Past 175 degrees an arc curls back across its own entry tangent -- the
    // line the segment before the corner lies on -- and pinches the lap into
    // a loop a crossing test only catches on a good day.
    if (Math.abs(sweep) > (175 * Math.PI) / 180) continue;

    /*
     * Sampled two centimetres INSIDE the tangent circle. The tangent points
     * lie exactly on the lines through the anchors -- that is what tangent
     * means -- so the spliced ring contains collinear triples, and a strict
     * crossing test over collinear segments is decided by float noise: the
     * same lap "crossed" or not depending on the scale it was measured at.
     * Two centimetres is invisible on a road and puts every arc point
     * honestly on one side of the line.
     */
    const Rd = R - 0.02;
    const steps = Math.max(1, Math.round(Math.abs(sweep) / ARC_STEP));
    const out: Pt[] = [];
    for (let k = 0; k <= steps; k++) {
      const a = a1 + (sweep * k) / steps;
      out.push({ x: C.x + Math.cos(a) * Rd, z: C.z + Math.sin(a) * Rd });
    }
    return out;
  }
  return null;
}

/**
 * Replace every real corner of the ring with a tangent arc of a driving
 * radius. The two biggest corners are always rebuilt -- every lap gets its
 * slow corners -- and each lesser one has a chance of staying a sweeper, so
 * the lap keeps some variety of speed. Returns the original ring untouched if
 * the rebuilt one would cross itself, which the caller's scale pass forgives.
 */
function graftCorners(pts: Pt[], rng: () => number): Pt[] {
  const n = pts.length;

  // Called with the start/finish straight already at index 0, so a corner
  // group never wraps the seam and the splices below stay simple index
  // ranges. Just as important the other way round: grafting does not move
  // index 0 or the straight, which the timing line and the pit lane hang off.
  const ring = pts;

  const groups: CornerGroup[] = [];
  for (let i = 1; i < n; ) {
    if (Math.abs(signedTurnAt(ring, i)) < CORNER_POINT_TURN) {
      i++;
      continue;
    }
    let j = i;
    let turn = 0;
    while (j < n && Math.abs(signedTurnAt(ring, j)) >= CORNER_POINT_TURN) {
      turn += signedTurnAt(ring, j);
      j++;
    }
    // Needs its anchors: a group reaching the seam has no straight beyond it.
    if (j < n - 1 && Math.abs(turn) >= CORNER_TURN_MIN && j - i <= n / 3) {
      groups.push({ from: i, to: j - 1, turn });
    }
    i = j;
  }
  if (groups.length === 0) return pts;

  // The two biggest corners are always built; the rest draw lots. Decided
  // before splicing so the rng stream does not depend on splice order.
  const bySize = [...groups].sort((a, b) => Math.abs(b.turn) - Math.abs(a.turn));
  const build = new Set<CornerGroup>();
  bySize.forEach((g, rank) => {
    if (rank < 2 || rng() >= KEEP_SWEEPER) build.add(g);
  });
  const radii = new Map<CornerGroup, number>();
  for (const g of groups) radii.set(g, cornerRadius(g.turn, rng));

  // Back to front, so earlier indices survive each splice. Every arc has to
  // keep real clearance from the rest of the lap, not merely avoid crossing
  // it: an arc that grazes a neighbouring straight by centimetres passes a
  // crossing test and still pinches the road into itself. A corner that
  // cannot keep its distance stays the sweeper it was.
  let out = ring;
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const g = groups[gi];
    if (!build.has(g)) continue;
    const arc = filletCorner(out, g, radii.get(g)!);
    if (!arc) continue;
    if (!arcClears(out, g, arc)) continue;
    out = [...out.slice(0, g.from), ...arc, ...out.slice(g.to + 1)];
  }

  return selfCrosses(out) ? pts : out;
}

/** Room a grafted corner must keep from every unrelated part of the lap. */
const ARC_CLEARANCE = 20;

/**
 * Whether an arc replacing `g.from..g.to` of `ring` stays `ARC_CLEARANCE`
 * clear of every segment it is not joined to.
 */
function arcClears(ring: Pt[], g: CornerGroup, arc: Pt[]): boolean {
  const n = ring.length;
  const c2 = ARC_CLEARANCE * ARC_CLEARANCE;
  for (let si = 0; si < n; si++) {
    // Segments inside or touching the replaced span are the arc's own
    // neighbourhood: it connects to them by construction.
    const rel = ((si - g.from) % n + n) % n;
    const span = g.to - g.from;
    if (rel <= span + 1 || rel >= n - 2) continue;
    const a = ring[si];
    const b = ring[(si + 1) % n];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1e-9;
    for (const p of arc) {
      const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
      const dx = p.x - (a.x + abx * t);
      const dz = p.z - (a.z + abz * t);
      if (dx * dx + dz * dz < c2) return false;
    }
  }
  return true;
}

/**
 * Control points the start/finish straight and the pit lane run beside.
 *
 * Six at ~170 m apart is a 600-800 m straight once the ends have been led into
 * it: Monza's is 1.1 km, most are 500 to 900, and the pit lane alongside needs
 * room for a dozen boxes plus its entry and exit.
 */
const PIT_SPAN = 6;

/**
 * The concrete either side of a generated pit lane, metres.
 *
 * Five metres of working lane on each side of an 8 m fast lane is about
 * eighteen metres from the pit wall to the garage doors, which is what a modern
 * pit complex measures. Everything else about the paddock is measured off it:
 * where the boxes stand, where the garages stand behind them, and how far out
 * the lane has to run for the circuit's own run off to still fit beside it.
 */
export const PIT_APRON_WIDTH = 5;

/** Where a pit box sits across the working lane, from the lane's centre line. */
export const PIT_BOX_OFFSET = PIT_APRON_WIDTH + 2;

/**
 * How far outside the centre line the pit lane runs, metres.
 *
 * Added up rather than dialled in, so it stays right when a piece of it moves:
 * 7 m of road half width, 12 m of run off, the 3 m the barrier and the pit wall
 * stand in, PIT_APRON_WIDTH of working lane, and the lane's own 4 m half width.
 * It was 26 when the concrete beside the lane was a fixed 2.5 m; the concrete is
 * now the working lane of a real pit complex and the straight has to make room
 * for it, or the run off is squeezed out between the two.
 */
export const PIT_OFFSET = 7 + 12 + 3 + PIT_APRON_WIDTH + 4;

/**
 * The least start/finish straight the layout hands over, metres, measured
 * before the final length correction shaves its few percent. Sized from what
 * lives on it: a 40-box lane is ~630 m with its tapers, the lane may take 92%
 * of the straight, and the lap-length scale can take another ~7% off the top.
 */
const PIT_MIN_STRAIGHT = 780;

/**
 * The steepest the road is allowed to run, as a gradient.
 *
 * Eau Rouge is about 17%, but that is one famous corner on one circuit; a lap
 * that averages anything like it is a rollercoaster. 6% is a long climb you
 * notice in the car and never a wall.
 */
const MAX_GRADIENT = 0.06;

interface Pt {
  x: number;
  z: number;
}

interface Wave {
  k: number;
  amp: number;
  phase: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
};

function drawWaves(rng: () => number): Wave[] {
  return HARMONICS.map(([k, max]) => ({
    k,
    // Half the range at minimum, so a harmonic that is drawn is actually felt.
    amp: max * (0.5 + rng() * 0.5),
    phase: rng() * Math.PI * 2,
  }));
}

/** Heading change at point i of a closed ring, radians. */
function turnAt(pts: Pt[], i: number): number {
  const n = pts.length;
  const prev = pts[(i - 1 + n) % n];
  const cur = pts[i];
  const next = pts[(i + 1) % n];
  let d = Math.atan2(next.z - cur.z, next.x - cur.x) - Math.atan2(cur.z - prev.z, cur.x - prev.x);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/**
 * Where the start/finish straight goes: the flattest run of `span` points.
 *
 * Flat in both senses. Straight in plan, because the grid and the pit lane sit
 * along it -- and level in the ground under it, because the straight is levelled
 * afterwards and every metre of difference becomes a cutting or an embankment
 * the terrain blend has to dig. Picking the run over flat country instead of
 * levelling a hillside is what a circuit designer would do, and it is free.
 *
 * One radian of bend and one metre of height are weighed the same, which lands
 * about right: 10 m of fall along a straight is as bad as a 57 degree kink.
 */
function straightestRun(pts: Pt[], span: number, ys?: number[]): number {
  let best = 0;
  let bestCost = Infinity;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    let cost = 0;
    for (let j = 0; j < span; j++) cost += turnAt(pts, (i + j) % n);
    // The approaches count too, at half weight: the straightening pass hands
    // the run's curvature to the points just outside it, and a run picked
    // right beside a hairpin turns that hand-off into a kink behind the grid.
    cost += 0.5 * (turnAt(pts, (i - 1 + n) % n) + turnAt(pts, (i + span) % n));
    if (ys) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = 0; j < span; j++) {
        const y = ys[(i + j) % ys.length];
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      cost += hi - lo;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  }
  return best;
}

/**
 * Pull the corners in and push the straights flat, without crossing the lap.
 *
 * The polar curve cannot cross itself; this can, so every pass is checked and
 * backed out if it did. Cheap enough to brute force: a lap has a few dozen
 * control points.
 */
function sharpen(pts: Pt[], strength: number): Pt[] {
  const n = pts.length;
  const out = pts.map((p) => ({ ...p }));
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const midX = (prev.x + next.x) / 2;
    const midZ = (prev.z + next.z) / 2;
    const t = turnAt(pts, i) / MAX_TURN;
    // Negative pulls the point onto the line between its neighbours (straight),
    // positive pushes it off (corner).
    const k = t < STRAIGHT_BELOW ? -strength : strength * Math.min(1, t);
    out[i] = { x: pts[i].x + (pts[i].x - midX) * k, z: pts[i].z + (pts[i].z - midZ) * k };
  }
  return out;
}

/** Whether any two non-adjacent segments of the closed ring cross. */
function selfCrosses(pts: Pt[]): boolean {
  const n = pts.length;
  const side = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];
      const d1 = side(a1, a2, b1);
      const d2 = side(a1, a2, b2);
      const d3 = side(b1, b2, a1);
      const d4 = side(b1, b2, a2);
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
    }
  }
  return false;
}

const worstTurn = (pts: Pt[]) => pts.reduce((w, _, i) => Math.max(w, turnAt(pts, i)), 0);

/**
 * Fold bays into the plan.
 *
 * A polar curve keeps one radius per angle, so it can never fold back on
 * itself: whatever the harmonics draw, the result is a wobbly ring, and a ring
 * reads as a test oval however good its corners are. Real laps fold --
 * Interlagos wraps around its own infield, Austin's esses swing out and come
 * back. Pulling a short window of the ring in towards the middle puts that
 * fold in: the lap dives inward, turns, and comes back out, which is a corner
 * complex the harmonics cannot draw by construction. Guarded like every other
 * shaping pass: a dent that crosses the lap or bends it past MAX_TURN is
 * softened, and dropped if softening does not save it.
 */
const DENT_CHANCE = 0.55;

function dentPlan(pts: Pt[], rng: () => number): Pt[] {
  const n = pts.length;
  let out = pts;
  const dents = 1 + (rng() < DENT_CHANCE ? 1 : 0);
  for (let d = 0; d < dents; d++) {
    const centre = Math.floor(rng() * n);
    const halfW = 2 + Math.floor(rng() * 3);
    let depth = 0.22 + rng() * 0.16;
    for (let attempt = 0; attempt < 3; attempt++, depth *= 0.6) {
      const next = out.map((p, i) => {
        let rel = Math.abs(i - centre);
        rel = Math.min(rel, n - rel);
        if (rel > halfW) return p;
        // Raised cosine: full depth at the centre, feathered to nothing at the
        // window's edge, so the bay joins the lap without a kink at its rim.
        const k = depth * (0.5 + 0.5 * Math.cos((rel / halfW) * Math.PI));
        // Towards the middle of the plan, which the polar draw centres on 0.
        return { x: p.x * (1 - k), z: p.z * (1 - k) };
      });
      if (!selfCrosses(next) && worstTurn(next) <= MAX_TURN) {
        out = next;
        break;
      }
    }
  }
  return out;
}

/*
 * Chicanes.
 *
 * Grafting a corner leaves long tangent segments either side of the arc, and a
 * lap of sweepers joined by slow corners still misses the one feature nearly
 * every modern circuit has: a chicane dropped into a straight that was getting
 * too fast. So one is spliced into the longest such segment away from the
 * start/finish run -- a flick in, fifty metres held offset, and a flick back
 * out, which is a braking point and an overtaking spot rather than decoration.
 */
const CHICANE_MIN_SEG = 280;
const CHICANE_CLEARANCE = 20;

/** Whether the jog stays clear of every segment its straight is not joined to. */
function jogClears(ring: Pt[], seg: number, jog: Pt[]): boolean {
  const n = ring.length;
  const c2 = CHICANE_CLEARANCE * CHICANE_CLEARANCE;
  for (let si = 0; si < n; si++) {
    const rel = (((si - seg) % n) + n) % n;
    if (rel <= 1 || rel >= n - 1) continue;
    const a = ring[si];
    const b = ring[(si + 1) % n];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1e-9;
    for (const p of jog) {
      const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
      const dx = p.x - (a.x + abx * t);
      const dz = p.z - (a.z + abz * t);
      if (dx * dx + dz * dz < c2) return false;
    }
  }
  return true;
}

function addChicanes(pts: Pt[], rng: () => number): Pt[] {
  const n = pts.length;
  // Off the start/finish straight and clear of the seam, for the same reason
  // graftCorners keeps away from both: the grid, the timing line and the pit
  // lane all hang off indices 0..PIT_SPAN-1 and must not shift.
  const cands: Array<{ i: number; len: number }> = [];
  for (let i = PIT_SPAN + 1; i < n - 2; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
    if (len >= CHICANE_MIN_SEG) cands.push({ i, len });
  }
  cands.sort((a, b) => b.len - a.len);
  const chosen: Array<{ i: number }> = [];
  if (cands.length > 0 && rng() < 0.85) chosen.push(cands[0]);
  if (cands.length > 1 && rng() < 0.35) chosen.push(cands[1]);

  let out = pts;
  // Back to front, so the earlier splice does not shift the later index.
  for (const c of chosen.sort((a, b) => b.i - a.i)) {
    const side = rng() < 0.5 ? 1 : -1;
    const w = (11 + rng() * 6) * side;
    const a = out[c.i];
    const b = out[c.i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / L;
    const dz = (b.z - a.z) / L;
    const m = L / 2;
    // In, across, and back out: ~20 degree flicks fifty metres apart. The two
    // outer points sit two centimetres OFF the old line, not on it, for the
    // reason spelled out on the arc sampling above: collinear triples hand the
    // crossing test to float noise.
    const jog = [
      [m - 70, side * 0.02],
      [m - 25, w],
      [m + 25, w],
      [m + 70, side * 0.02],
    ].map(([s, o]) => ({ x: a.x + dx * s - dz * o, z: a.z + dz * s + dx * o }));
    if (!jogClears(out, c.i, jog)) continue;
    const next = [...out.slice(0, c.i + 1), ...jog, ...out.slice(c.i + 1)];
    if (selfCrosses(next)) continue;
    out = next;
  }
  return out;
}

const ringLength = (pts: Pt[]) =>
  pts.reduce((s, p, i) => s + Math.hypot(pts[(i + 1) % pts.length].x - p.x, pts[(i + 1) % pts.length].z - p.z), 0);

/* ------------------------------------------------------------------ */
/* The ground the circuit is laid on                                    */
/* ------------------------------------------------------------------ */

interface Hill {
  /** Wave vector, radians per metre. */
  kx: number;
  kz: number;
  phase: number;
  amp: number;
}

/**
 * Long, low waves rather than noise.
 *
 * Four wavelengths between 400 m and 1.4 km give a landscape with a shape to it
 * -- a ridge, a valley, a couple of rises -- at a scale a circuit is laid
 * through rather than over. Anything shorter reads as a bumpy field and forces
 * the road into a gradient every hundred metres.
 */
function drawHills(rng: () => number, relief: number): Hill[] {
  const hills: Hill[] = [];
  const weights = [1, 0.6, 0.35, 0.2];
  for (let i = 0; i < weights.length; i++) {
    const wavelength = 1400 - i * 300 + (rng() - 0.5) * 200;
    const dir = rng() * Math.PI * 2;
    const k = (Math.PI * 2) / wavelength;
    hills.push({
      kx: Math.cos(dir) * k,
      kz: Math.sin(dir) * k,
      phase: rng() * Math.PI * 2,
      amp: weights[i],
    });
  }
  // Normalise so the sum of the amplitudes spans the relief asked for.
  const total = hills.reduce((s, h) => s + h.amp, 0) * 2;
  for (const h of hills) h.amp = (h.amp / total) * relief;
  return hills;
}

const hillHeight = (hills: Hill[], x: number, z: number) =>
  hills.reduce((h, w) => h + w.amp * Math.sin(w.kx * x + w.kz * z + w.phase), 0);

/** Fill a terrain height field from the hills. */
function groundFrom(t: TerrainSettings, hills: Hill[]): Float32Array {
  const heights = createHeights(t.res, 0);
  const cs = cellSize(t);
  for (let iz = 0; iz < t.res; iz++) {
    for (let ix = 0; ix < t.res; ix++) {
      heights[iz * t.res + ix] = hillHeight(hills, t.originX + ix * cs, t.originZ + iz * cs);
    }
  }
  return heights;
}

/**
 * The same rolling country the generator lays its circuits over, for a blank
 * project: an empty field does not have to mean a snooker table. The track
 * tool puts its points on the ground wherever it is, and the corridor blend
 * cuts the road bed regardless, so a line drawn over these hills gets its
 * elevation the same way a generated lap does -- from the landscape.
 */
export function rollingHeights(
  t: TerrainSettings,
  relief: number,
  rng: () => number = Math.random,
): Float32Array {
  return groundFrom(t, drawHills(rng, relief));
}

/* ------------------------------------------------------------------ */

export interface GeneratedLayout {
  track: TrackNode[];
  pit: TrackNode[];
  terrain: TerrainSettings;
  /** Where the timing line goes, as a fraction of the lap. */
  startS: number;
  /** Lap length through the spline, metres. */
  length: number;
  /**
   * Pit settings sized to the lane that was actually built: how many boxes,
   * where box 0 sits, where the limiter comes on. The defaults were written
   * for the hand drawn demo oval and put every box at the mouth of a lane ten
   * times too long for them.
   */
  pitCfg: Pick<PitSettings, 'boxCount' | 'boxSpacing' | 'boxSide' | 'startDist' | 'limitStart' | 'limitEnd' | 'apron' | 'boxOffset'>;
  /** The country planted, if it was asked for. Empty otherwise. */
  props: PropInstance[];
}

/* ------------------------------------------------------------------ */
/* The country beside the road                                         */
/* ------------------------------------------------------------------ */

/**
 * The forest belt, metres. Trees line real circuits in a band behind the run
 * off -- close enough to read as walls of green from the car, thinning out
 * into open country beyond -- and clearings break the band so it reads as a
 * landscape rather than a hedge.
 */
const TREE_KEEP_OFF = 30;
const TREE_BAND = 175;
const TREE_SPACING = 10.5;
const MAX_TREES = 2600;

/**
 * The open country beyond the belt, planted to the edge of the field.
 *
 * The belt used to be ALL the vegetation, which put a green ring around the
 * lap and left the other five square kilometres of the field as a shaved lawn
 * running to the horizon. Out here the woods are the landscape rather than the
 * trackside: whole forests where the clearing wave runs high, open meadows
 * between them, on a wider grid than the belt -- the belt is what you see from
 * the car at speed, this is what you see across the valley. Its own budget,
 * thinned separately, so a big field never starves the trackside of trees.
 */
const FAR_SPACING = 17;
const MAX_FAR_TREES = 2600;

/** Card trees: hundreds of them seen at speed is exactly what cards are for. */
const TREE_KINDS = ['tree_pine_2d', 'tree_round_2d', 'tree_poplar_2d', 'tree_scrub_2d'] as const;

interface Paddock {
  ax: number;
  az: number;
  dirX: number;
  dirZ: number;
  rightX: number;
  rightZ: number;
  length: number;
  /**
   * How far the clearing reaches on the OTHER side of the straight, as a
   * lateral offset (negative = away from the pit lane). Wide when the
   * grandstands and the car park stand there, narrow when they do not.
   */
  latMin: number;
}

/**
 * The buildings of a start/finish complex: garages and race control along the
 * pit lane, grandstands and a car park across the straight from them.
 *
 * Everything is the prefabs the Place tool already offers, dropped where a
 * circuit actually builds them, so the result is editable piece by piece
 * afterwards like anything else placed by hand. Positions are measured from
 * the prefabs' own footprints -- a reshaped model moves the row with it.
 */
function buildPaddock(
  trackFrames: Frame[],
  pad: Paddock,
  laneOffset: number,
  y: number,
): PropInstance[] {
  const idx = new PointIndex(trackFrames.map((f) => f.pos), 50);
  const trackPts = trackFrames.map((f) => f.pos);
  const out: PropInstance[] = [];
  let serial = 0;

  /** Heading that turns a prefab's local +Z onto the world direction (dx, dz). */
  const headingTo = (dx: number, dz: number) => (Math.atan2(dx, dz) * 180) / Math.PI;

  /**
   * Drop one prefab at (along, lateral) in the straight's frame, its front
   * pointing across the straight: `face` -1 looks towards the track from the
   * pit side, +1 looks towards the track from the far side.
   */
  const place = (key: string, along: number, lateral: number, face: 1 | -1) => {
    const def = PREFABS_BY_KEY.get(key);
    if (!def) return;
    const at = {
      x: pad.ax + pad.dirX * along + pad.rightX * lateral,
      y,
      z: pad.az + pad.dirZ * along + pad.rightZ * lateral,
    };
    serial += 1;
    const mine = serial;
    const parts = instantiatePrefab(def, at, headingTo(pad.rightX * face, pad.rightZ * face), (i) => `genpad_${mine}_${i}`);
    // Nothing may stand on or beside the racing surface. On most laps the
    // country across the straight is open; on a tight one another stretch of
    // track can fold back past it, and then the prefab simply stays unbuilt.
    for (const part of parts) {
      const ti = idx.nearest(part.p[0], part.p[2], 80);
      if (ti >= 0) {
        const tp = trackPts[ti];
        /* 26 m: the racing surface is 7, the run off 12, the fence line 22 --
           a building may stand no closer than a walkway's width behind the
           fence. It was 22, which let a garage stand exactly ON the fence
           line where the next corner swings the circuit towards the row. */
        if (Math.hypot(tp.x - part.p[0], tp.z - part.p[2]) < 26) return;
      }
    }
    out.push(...parts);
  };

  const mid = pad.length / 2;
  /* Garage doors open onto the working lane, at the far edge of the concrete
     and a metre back for a threshold. Measured off the concrete rather than
     guessed: it used to be a flat 9 m, which was a couple of metres behind
     where the box markers stood back when the working lane was 2.5 m wide.
     Widen the lane and that same 9 m puts the buildings ON the concrete, with
     the cars parked inside them. */
  const front = laneOffset + 4 + PIT_APRON_WIDTH + 1;

  // Race control and the main garages on the timing line, plainer garage rows
  // carrying the building line on either side of them.
  // Measured to the front of the BAYS, which are the front of the complex now
  // that they stand on the lane side of the building rather than behind it.
  place(
    'pit_complex_tower',
    mid,
    front + propTileBox('pit_building').hz + propTileBox('garage_bay').hz * 2,
    -1,
  );
  place('garage_row', mid - 46, front + propTileBox('garage_bay').hz, -1);
  place('garage_row', mid + 52, front + propTileBox('garage_bay').hz, -1);
  // And the line carried on down the lane: forty boxes span ~350 m of it, and
  // a building line a hundred metres long beside that read as a village hall
  // next to an airfield. Rows every 26 m -- the 24 m prefab and a walkway --
  // roughly cover the box run without the wall-to-wall monotony of one
  // continuous shed.
  for (let k = 1; k <= 4; k++) {
    place('garage_row', mid - 46 - k * 26, front + propTileBox('garage_bay').hz, -1);
    place('garage_row', mid + 52 + k * 26, front + propTileBox('garage_bay').hz, -1);
  }

  // The stands across the straight, looking at the pit fight, and the car
  // park that serves them tucked in behind. A stand's seating CLIMBS towards
  // its local +Z -- the audience looks out of -Z -- so from this side of the
  // track it faces the racing with the same heading the pit buildings use,
  // not the mirrored one.
  const standLat = -(19 + 6 + propTileBox('grandstand').hz);
  place('grandstand_block', mid, standLat, -1);
  place('grandstand_pair', mid - 76, standLat, -1);
  place('car_park', mid + 55, standLat - propTileBox('grandstand').hz - 16, -1);

  return out;
}

/**
 * Plant the country around the circuit.
 *
 * A jittered grid over the field, in two regimes. A belt along the track: off
 * the road and its run off, dense just behind them, thinning with distance,
 * with clearings cut by long noise waves so there are meadows as well as
 * woods. And the open country beyond the belt, planted to the edge of the
 * field on a wider grid -- whole woods where the clearing waves run high,
 * open ground between them -- so the landscape is wooded everywhere the field
 * reaches, not just in a ring around the lap. Species come from a second,
 * longer wave, so the pines stand in pine woods and the broadleaves in
 * broadleaf woods instead of shuffled per tree, and the wave runs through
 * both regimes, so a wood that starts in the belt keeps its species as it
 * runs out into the country.
 *
 * Everything is a 2D card: this is the wood behind the barrier, seen from a
 * car at speed, which is the job cards exist for. All of it is `ground: true`,
 * so the trees ride the terrain through every later sculpt.
 */
function plantForest(
  rng: () => number,
  terrain: TerrainSettings,
  trackFrames: Frame[],
  pitNodes: TrackNode[],
  paddock: Paddock,
): PropInstance[] {
  const trackIdx = new PointIndex(trackFrames.map((f) => f.pos), 50);
  const trackPts = trackFrames.map((f) => f.pos);

  // The lane resampled to ~15 m, so "distance to the pit lane" does not
  // overshoot by half a node spacing between two of its control points.
  const pitPts: THREE.Vector3[] = [];
  for (let i = 0; i + 1 < pitNodes.length; i++) {
    const a = pitNodes[i].p;
    const b = pitNodes[i + 1].p;
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const steps = Math.max(1, Math.ceil(len / 15));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      pitPts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, 0, a[2] + (b[2] - a[2]) * t));
    }
  }
  const pitIdx = new PointIndex(pitPts, 30);

  // Clearings: two long waves, woods where their sum runs high. The species
  // wave is longer still, so a grove is one species across.
  const wave = () => ({
    kx: Math.cos(rng() * Math.PI * 2) * ((Math.PI * 2) / (260 + rng() * 340)),
    kz: Math.sin(rng() * Math.PI * 2) * ((Math.PI * 2) / (260 + rng() * 340)),
    phase: rng() * Math.PI * 2,
  });
  const clearA = wave();
  const clearB = wave();
  const species = {
    kx: Math.cos(rng() * Math.PI * 2) * ((Math.PI * 2) / 700),
    kz: Math.sin(rng() * Math.PI * 2) * ((Math.PI * 2) / 700),
    phase: rng() * Math.PI * 2,
  };
  const waveAt = (w: { kx: number; kz: number; phase: number }, x: number, z: number) =>
    Math.sin(w.kx * x + w.kz * z + w.phase);

  const out: PropInstance[] = [];
  let serial = 0;
  const x1 = terrain.originX + terrain.size;
  const z1 = terrain.originZ + terrain.size;
  for (let z = terrain.originZ + TREE_SPACING / 2; z < z1; z += TREE_SPACING) {
    for (let x = terrain.originX + TREE_SPACING / 2; x < x1; x += TREE_SPACING) {
      const px = x + (rng() - 0.5) * TREE_SPACING * 0.9;
      const pz = z + (rng() - 0.5) * TREE_SPACING * 0.9;

      const ti = trackIdx.nearest(px, pz, TREE_BAND + 20);
      if (ti < 0) continue;
      const tp = trackPts[ti];
      const d = Math.hypot(tp.x - px, tp.z - pz);
      if (d < TREE_KEEP_OFF || d > TREE_BAND) continue;

      const pi = pitIdx.nearest(px, pz, 30);
      if (pi >= 0) {
        const pp = pitPts[pi];
        if (Math.hypot(pp.x - px, pp.z - pz) < 26) continue;
      }

      // The paddock: the pit side of the start/finish straight stays open --
      // that is where the boxes, the cranes and the trucks live -- and so
      // does whatever stands across from it, stands and car park included.
      {
        const ox = px - paddock.ax;
        const oz = pz - paddock.az;
        const along = ox * paddock.dirX + oz * paddock.dirZ;
        const lat = ox * paddock.rightX + oz * paddock.rightZ;
        if (along > -80 && along < paddock.length + 80 && lat > paddock.latMin && lat < 110) continue;
      }

      // Woods and meadows, an edge that fades in, and a belt that thins out.
      const clearing = waveAt(clearA, px, pz) + 0.75 * waveAt(clearB, px, pz);
      const mask = clearing > 0.15 ? 1 : clearing > -0.25 ? 0.22 : 0;
      if (mask === 0) continue;
      const edge = smoothstep(TREE_KEEP_OFF, TREE_KEEP_OFF + 12, d);
      const fade = 1 - 0.68 * smoothstep(85, TREE_BAND, d);
      if (rng() >= mask * edge * fade * 0.92) continue;

      serial += 1;
      let kind: string;
      if (d < TREE_KEEP_OFF + 16 && rng() < 0.12) {
        // Something low right at the edge of the belt, so the wood has an
        // understorey instead of ending in bare trunks.
        kind = 'tree_scrub_2d';
      } else {
        const v = waveAt(species, px, pz) * 1.4 + (rng() - 0.5) * 0.8;
        kind = v < -0.5 ? TREE_KINDS[0] : v < 0.55 ? TREE_KINDS[1] : v < 1.05 ? TREE_KINDS[2] : TREE_KINDS[3];
      }
      const s = 0.8 + rng() * 0.5;
      out.push({
        id: `gentree_${serial}`,
        kind,
        name: `${kind}_${serial}`,
        p: [px, 0, pz],
        r: [0, rng() * 360, 0],
        s: [s, s, s],
        ground: true,
      });
    }
  }

  /*
   * The open country: everything further than the belt reaches, out to the
   * edge of the field. No keep-offs needed beyond the belt test itself -- the
   * road, the pit lane and the whole paddock all live within TREE_BAND of the
   * track, which is exactly the ground this pass skips. The clearing threshold
   * is harder than the belt's on purpose: out here half-density scatter reads
   * as mange, so the wave either makes a wood or leaves a meadow.
   */
  const far: PropInstance[] = [];
  for (let z = terrain.originZ + FAR_SPACING / 2; z < z1; z += FAR_SPACING) {
    for (let x = terrain.originX + FAR_SPACING / 2; x < x1; x += FAR_SPACING) {
      const px = x + (rng() - 0.5) * FAR_SPACING * 0.9;
      const pz = z + (rng() - 0.5) * FAR_SPACING * 0.9;

      const ti = trackIdx.nearest(px, pz, TREE_BAND + 20);
      if (ti >= 0) {
        const tp = trackPts[ti];
        if (Math.hypot(tp.x - px, tp.z - pz) <= TREE_BAND) continue;
      }

      const clearing = waveAt(clearA, px, pz) + 0.75 * waveAt(clearB, px, pz);
      const mask = smoothstep(0.3, 0.75, clearing);
      if (mask === 0) continue;
      if (rng() >= mask * 0.92) continue;

      serial += 1;
      const v = waveAt(species, px, pz) * 1.4 + (rng() - 0.5) * 0.8;
      const kind =
        v < -0.5 ? TREE_KINDS[0] : v < 0.55 ? TREE_KINDS[1] : v < 1.05 ? TREE_KINDS[2] : TREE_KINDS[3];
      const s = 0.8 + rng() * 0.5;
      far.push({
        id: `gentree_${serial}`,
        kind,
        name: `${kind}_${serial}`,
        p: [px, 0, pz],
        r: [0, rng() * 360, 0],
        s: [s, s, s],
        ground: true,
      });
    }
  }

  // A hard ceiling per regime, thinned at random rather than truncated, so
  // running out of budget costs density everywhere instead of leaving one
  // corner bare -- and a big field's country never starves the trackside belt.
  const thin = (list: PropInstance[], cap: number) =>
    list.length > cap ? list.filter(() => rng() < cap / list.length) : list;
  return [...thin(out, MAX_TREES), ...thin(far, MAX_FAR_TREES)];
}

/**
 * Build a circuit, the ground under it and a pit lane attached to it.
 *
 * `rng` is injectable so the verify harness can ask for the same track twice;
 * the editor passes nothing and gets a different one every time.
 */
export function generateCircuit(
  size: CircuitSize = 'medium',
  halfWidth = 7,
  maxRes = MAX_TERRAIN_RES,
  samplesPerSegment = 12,
  rng: () => number = Math.random,
  opts: { trees?: boolean; paddock?: boolean } = {},
): GeneratedLayout {
  const target = TARGET_LENGTH[size];

  /* --- the plan ----------------------------------------------------- */

  // Enough control points for the length, rounded to something even so the
  // straight lands cleanly. The radius is a starting guess; the scale below is
  // what actually sets the length.
  const count = Math.max(16, Math.round(target / POINT_SPACING / 2) * 2);
  let pts: Pt[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    const waves = drawWaves(rng);
    // Later attempts ask for less, so a run of bad luck still terminates.
    const damp = 1 - attempt * 0.07;
    const base = target / (Math.PI * 2);
    pts = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = waves.reduce((acc, w) => acc + base * w.amp * damp * Math.cos(w.k * a + w.phase), base);
      // Stretched along x: a circuit that is longer than it is wide fits more
      // lap into the same field, and is what almost all of them look like.
      pts.push({ x: Math.sin(a) * r * STRETCH, z: (-Math.cos(a) * r) / STRETCH });
    }
    if (worstTurn(pts) <= MAX_TURN) break;
  }

  // Fold a bay or two into the ring before anything is built on it, so the
  // plan stops being star-shaped: the one look no set of harmonics escapes.
  pts = dentPlan(pts, rng);

  // Corners and straights. Each pass is kept only if the lap still does not
  // cross itself and no corner went past what a car can take.
  for (let pass = 0; pass < 2; pass++) {
    let strength = SHARPEN;
    for (let tryIt = 0; tryIt < 3; tryIt++) {
      const next = sharpen(pts, strength);
      if (!selfCrosses(next) && worstTurn(next) <= MAX_TURN) {
        pts = next;
        break;
      }
      strength /= 2;
    }
  }

  // Scale to the length asked for. Scaling leaves every heading change exactly
  // as it was, so a lap that was drivable stays drivable.
  {
    const scale = target / Math.max(1, ringLength(pts));
    pts = pts.map((p) => ({ x: p.x * scale, z: p.z * scale }));
  }


  /* --- the ground --------------------------------------------------- */

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  // 400 m of country outside the track on every side: run off, paddock, and
  // somewhere for the landscape to keep going.
  const margin = 400;
  const fieldSize = Math.ceil((Math.max(maxX - minX, maxZ - minZ) + margin * 2) / 100) * 100;
  const hills = drawHills(rng, RELIEF[size]);
  // The grid follows the field rather than staying at whatever the default
  // project uses: 257 vertices over 3.8 km is a 15 m cell, which is too coarse
  // to sculpt a corner with. Capped, because every vertex is rebuilt per frame
  // under the sculpt brush.
  const res = Math.max(129, Math.min(maxRes, Math.round(fieldSize / TERRAIN_CELL / 2) * 2 + 1));
  const terrain: TerrainSettings = {
    enabled: true,
    res,
    size: fieldSize,
    originX: (minX + maxX) / 2 - fieldSize / 2,
    originZ: (minZ + maxZ) / 2 - fieldSize / 2,
    base: 0,
    // Wider than the default: with real elevation the road cuts into hillsides,
    // and a 22 m blend turns a 10 m cutting into a bank you could ski down.
    blend: 40,
    heights: createHeights(res, 0),
    paint: null,
    paintEdge: null,
  };
  terrain.heights = groundFrom(terrain, hills);

  /* --- the road on the ground --------------------------------------- */

  let ys = pts.map((p) => sampleHeights(terrain, terrain.heights, p.x, p.z));

  // Rotate the ring so point 0 opens the run start/finish, the grid and the pit
  // lane hang off -- chosen now, with the ground known, so the straight lands
  // on level country rather than across a hillside.
  {
    const start = straightestRun(pts, PIT_SPAN, ys);
    pts = pts.map((_, i) => pts[(start + i) % pts.length]);
    ys = ys.map((_, i) => ys[(start + i) % ys.length]);
  }

  /*
   * Straighten that run, and lead the corners either side into it.
   *
   * Projecting the middle points onto the chord between two fixed ends makes a
   * perfect straight and hands its old curvature to the points at its ends, as
   * one corner each: measured at 88 degrees on a lap whose sharpest real corner
   * was 55 -- a hairpin nobody drew, exactly where the cars are quickest.
   * Smoothing the neighbourhood instead only shrinks it, which is what Laplace
   * smoothing does to any closed loop, and the lap came out a fifth short.
   *
   * So the points outside are moved ONTO THE LINE ITSELF, each keeping its
   * distance from the end it hangs off, with the pull fading as it goes. The
   * straight extends into the corner rather than starting out of nowhere, no
   * point moves closer to its neighbour, and the length is untouched.
   *
   * The run is also pulled out to pit length when the plan drew it short. The
   * points are not evenly spaced by the time the ring gets here -- a dent or a
   * hard sharpen bunches them -- and a straight of six bunched points came out
   * 500 m: too short for the forty boxes, their tapers and the grid in front
   * of them. Stretching about the midpoint keeps the levelling, the timing
   * line and the paddock exactly where they were going anyway; the length
   * correction below absorbs the added metres like it absorbs the grafting's.
   * Backed out if the longer straight pinched the lap into itself, in which
   * case the box clamp downstream sizes the lane honestly for what fits.
   */
  {
    const straighten = (ring: Pt[], extend: number): Pt[] => {
      const n = ring.length;
      const out = ring.map((p) => ({ ...p }));
      const oldA = ring[0];
      const oldB = ring[PIT_SPAN - 1];
      const chord = Math.hypot(oldB.x - oldA.x, oldB.z - oldA.z) || 1;
      const dx = (oldB.x - oldA.x) / chord;
      const dz = (oldB.z - oldA.z) / chord;
      const a0 = { x: oldA.x - dx * extend, z: oldA.z - dz * extend };
      const b0 = { x: oldB.x + dx * extend, z: oldB.z + dz * extend };

      for (let i = 0; i < PIT_SPAN; i++) {
        const t = i / (PIT_SPAN - 1);
        out[i] = { x: a0.x + (b0.x - a0.x) * t, z: a0.z + (b0.z - a0.z) * t };
      }

      // Wider when the straight was pulled out: the extension's curvature has
      // further to go, and three points of ease was measured handing it over
      // as one 79 degree kink right behind the grid.
      const ease = 3 + Math.min(3, Math.floor(extend / 50));
      for (let j = 1; j <= ease; j++) {
        const w = 0.8 * (1 - (j - 1) / ease);
        // Behind the start of the straight, along the line running backwards.
        // Distances measured from the OLD end: an extended end can swallow its
        // first neighbour, and a point measured from the new end then lands a
        // few metres behind it -- bunched against neighbours that stayed put,
        // which is where the kink came from. From the old end, every eased
        // point keeps its spacing and the whole chain shifts out together.
        const back = ((-j % n) + n) % n;
        const dBack = Math.hypot(out[back].x - oldA.x, out[back].z - oldA.z);
        out[back] = {
          x: out[back].x * (1 - w) + (a0.x - dx * dBack) * w,
          z: out[back].z * (1 - w) + (a0.z - dz * dBack) * w,
        };
        // And past its end, along the line running on.
        const fwd = (PIT_SPAN - 1 + j) % n;
        const dFwd = Math.hypot(out[fwd].x - oldB.x, out[fwd].z - oldB.z);
        out[fwd] = {
          x: out[fwd].x * (1 - w) + (b0.x + dx * dFwd) * w,
          z: out[fwd].z * (1 - w) + (b0.z + dz * dFwd) * w,
        };
      }
      return out;
    };

    // The extension is a wish, not a law: each candidate is shrunk until it
    // neither crosses the lap nor kinks harder than the relaxation pass below
    // can still repair. The bar is deliberately looser than the baseline's
    // own turns -- that pass exists exactly to absorb what the hand-over
    // leaves behind -- because every degree given up here is boxes given up:
    // held to the baseline, one lap in three came out short of its forty.
    // The box clamp downstream sizes the lane for whatever straight survives.
    const chord = Math.hypot(
      pts[PIT_SPAN - 1].x - pts[0].x,
      pts[PIT_SPAN - 1].z - pts[0].z,
    );
    const base = straighten(pts, 0);
    const limit = Math.max(worstTurn(base), MAX_TURN) + (25 * Math.PI) / 180;
    let next = base;
    for (let extend = Math.max(0, (PIT_MIN_STRAIGHT - chord) / 2); extend >= 10; extend *= 0.75) {
      const cand = straighten(pts, extend);
      if (!selfCrosses(cand) && worstTurn(cand) <= limit) {
        next = cand;
        break;
      }
    }
    pts = next;
  }

  /*
   * Cap how hard any single point turns before the corners are rebuilt.
   *
   * The straightening hands the run's curvature to the points either side of
   * it, and on a lap that approaches its straight at a bad angle the ease
   * cannot spread it far enough: one point behind the grid was measured
   * turning 79 degrees, which the spline answers with a 3 m loop. Everything
   * DRAWN tight stays: a grafted arc turns ARC_STEP per point and the dents
   * are capped at MAX_TURN, both well under this bar, so the only points it
   * ever touches are the straightening's kinks. Each is relaxed towards the
   * line between its neighbours until it behaves; the corner rebuild below
   * then turns what remains into a proper arc.
   */
  {
    const cap = (60 * Math.PI) / 180;
    const n2 = pts.length;
    for (let pass = 0; pass < 12; pass++) {
      let worstI = -1;
      let worstD = cap;
      // The straight itself is fixed; everything from its last point on may
      // give a little.
      for (let i = PIT_SPAN; i < n2; i++) {
        const d = turnAt(pts, i);
        if (d > worstD) {
          worstD = d;
          worstI = i;
        }
      }
      if (worstI < 0) break;
      const prev = pts[(worstI - 1 + n2) % n2];
      const next = pts[(worstI + 1) % n2];
      const relaxed = {
        x: pts[worstI].x * 0.5 + (prev.x + next.x) * 0.25,
        z: pts[worstI].z * 0.5 + (prev.z + next.z) * 0.25,
      };
      const trial = pts.map((p, i) => (i === worstI ? relaxed : p));
      if (selfCrosses(trial)) break;
      pts = trial;
    }
  }

  // With the straight settled and nothing left to disturb the geometry,
  // rebuild the corners at driving radii: hairpins, slow corners, braking
  // zones. (Any earlier, and the straight's own smoothing pass would grab the
  // closely spaced arc points and fold them into kinks.) Cutting the sweepers
  // shortens the lap; the scale pass below corrects it, and a corner radius
  // rides the few percent unharmed.
  pts = graftCorners(pts, rng);

  // And a chicane into the longest straight the grafting left behind, away
  // from the start/finish run. Same rule as everything above: checked, and
  // dropped rather than forced where the country is too tight for it.
  pts = addChicanes(pts, rng);

  /*
   * Correct the length once the straight is in.
   *
   * Leading the corners into the straight moves points, and moved points are a
   * slightly different lap length -- 6% out at worst, which on a circuit sold
   * as 7 km is 400 m. Scaling is heading neutral, so this cannot undo any of
   * the shaping above; the ground has to be re-laid around the new bounds,
   * from the same hills, so the landscape is the same landscape.
   */
  {
    const scale = target / Math.max(1, ringLength(pts));
    if (Math.abs(scale - 1) > 0.002) {
      pts = pts.map((p) => ({ x: p.x * scale, z: p.z * scale }));
      let nx0 = Infinity;
      let nx1 = -Infinity;
      let nz0 = Infinity;
      let nz1 = -Infinity;
      for (const p of pts) {
        nx0 = Math.min(nx0, p.x);
        nx1 = Math.max(nx1, p.x);
        nz0 = Math.min(nz0, p.z);
        nz1 = Math.max(nz1, p.z);
      }
      terrain.size = Math.ceil((Math.max(nx1 - nx0, nz1 - nz0) + margin * 2) / 100) * 100;
      terrain.originX = (nx0 + nx1) / 2 - terrain.size / 2;
      terrain.originZ = (nz0 + nz1) / 2 - terrain.size / 2;
      terrain.heights = groundFrom(terrain, hills);
    }
  }

  // Heights come from the ground the points ended up over, not the ones they
  // started on.
  ys = pts.map((p) => sampleHeights(terrain, terrain.heights, p.x, p.z));

  // Smooth along the lap: the road cuts through what the country does over a
  // hundred metres rather than following every metre of it. Two passes, not
  // four -- smoothed harder, the road stops following the landscape at all and
  // every rise becomes a cutting to be dug out of the terrain blend.
  //
  // Weighted by segment length, because the points are no longer evenly
  // spaced: a grafted hairpin is half a dozen points twenty metres apart, and
  // the plain average barely smooths them -- the corner then keeps every
  // metre-scale wrinkle of the hillside it sits on.
  for (let pass = 0; pass < 2; pass++) {
    const prev = [...ys];
    for (let i = 0; i < ys.length; i++) {
      const im = (i - 1 + ys.length) % ys.length;
      const ip = (i + 1) % ys.length;
      const dPrev = Math.max(1, Math.hypot(pts[i].x - pts[im].x, pts[i].z - pts[im].z));
      const dNext = Math.max(1, Math.hypot(pts[ip].x - pts[i].x, pts[ip].z - pts[i].z));
      // The height the straight line between the two neighbours would have
      // here; with even spacing this is the plain (a + b) / 2 it used to be.
      const mid = (prev[im] * dNext + prev[ip] * dPrev) / (dPrev + dNext);
      ys[i] = prev[i] * 0.5 + mid * 0.5;
    }
  }

  // Level the start/finish straight, easing back into the lap either side of
  // it: the grid, the pit boxes and the timing line all sit along here.
  {
    let sum = 0;
    for (let i = 0; i < PIT_SPAN; i++) sum += ys[i];
    const level = sum / PIT_SPAN;
    for (let i = 0; i < PIT_SPAN; i++) ys[i] = level;
    const ease = 3;
    for (let j = 1; j <= ease; j++) {
      const w = smoothstep(0, 1, j / (ease + 1));
      const after = PIT_SPAN - 1 + j;
      const before = (ys.length - j) % ys.length;
      ys[after] = level + (ys[after] - level) * w;
      ys[before] = level + (ys[before] - level) * w;
    }
  }

  // Hold the gradient.
  //
  // Repaired LOCALLY first: each segment over the limit gives half its excess
  // to each end, over and over, which diffuses a steep spot into its
  // neighbourhood the way a road builder grades a crest. Points can be twenty
  // metres apart inside a grafted corner now, and one steep short segment
  // there used to be answered by scaling the WHOLE profile down -- a lap with
  // thirty metres of honest climb came out almost flat because one arc
  // crossed a bank. The straight is left untouched: it was just levelled, and
  // its ends push their share onto the open lap instead.
  {
    const n2 = pts.length;
    const runs = pts.map((p, i) => {
      const q = pts[(i + 1) % n2];
      return Math.max(1, Math.hypot(q.x - p.x, q.z - p.z));
    });
    const onStraight = (i: number) => i < PIT_SPAN;
    for (let pass = 0; pass < 60; pass++) {
      let fixed = false;
      for (let i = 0; i < n2; i++) {
        const j = (i + 1) % n2;
        const dy = ys[j] - ys[i];
        const lim = MAX_GRADIENT * runs[i];
        if (Math.abs(dy) <= lim) continue;
        const excess = (Math.abs(dy) - lim) * Math.sign(dy);
        if (onStraight(i) && onStraight(j)) continue;
        if (onStraight(i)) ys[j] -= excess;
        else if (onStraight(j)) ys[i] += excess;
        else {
          ys[i] += excess / 2;
          ys[j] -= excess / 2;
        }
        fixed = true;
      }
      if (!fixed) break;
    }

    // The global scale stays as the backstop, for a profile the local repair
    // could not settle. Scaling keeps the shape and only flattens the amount.
    let steepest = 0;
    for (let i = 0; i < n2; i++) {
      const j = (i + 1) % n2;
      if (runs[i] > 1) steepest = Math.max(steepest, Math.abs(ys[j] - ys[i]) / runs[i]);
    }
    if (steepest > MAX_GRADIENT) {
      const mean = ys.reduce((s, y) => s + y, 0) / ys.length;
      const k = MAX_GRADIENT / steepest;
      for (let i = 0; i < ys.length; i++) ys[i] = mean + (ys[i] - mean) * k;
    }
  }

  const track = pts.map((p, i) =>
    makeNode({ x: p.x, y: ys[i], z: p.z }, { widthL: halfWidth, widthR: halfWidth }),
  );

  /* --- start/finish and the pit lane -------------------------------- */

  const trackPath = { closed: true, nodes: track };
  const frames = computeFrames(trackPath, samplesPerSegment);
  const total = pathLength(frames, true);

  // The timing line goes in the MIDDLE of the straight, so the pit entry is
  // before it and the exit after it, the way a real circuit is laid out.
  const mid = new THREE.Vector3(
    (pts[0].x + pts[PIT_SPAN - 1].x) / 2,
    0,
    (pts[0].z + pts[PIT_SPAN - 1].z) / 2,
  );
  let startDist = 0;
  let nearest = Infinity;
  for (const f of frames) {
    const d = (f.pos.x - mid.x) ** 2 + (f.pos.z - mid.z) ** 2;
    if (d < nearest) {
      nearest = d;
      startDist = f.dist;
    }
  }

  /*
   * The pit lane, sized from what lives on it rather than from the straight it
   * runs beside.
   *
   * It used to span the whole straight: the better part of a kilometre of lane
   * for a dozen boxes, with the boxes bunched at the mouth of it because the
   * default box distance was written for the little demo oval. A real lane is
   * an entry taper, a parallel run just long enough for the boxes with room at
   * the limiter line, and an exit taper, centred on the timing line so the
   * entry is before the line and the exit after it.
   *
   * Forty boxes, not twelve: a generated circuit is somewhere people race a
   * full online grid, and AC fills the grid from the pit boxes -- fewer boxes
   * than grid slots and the server quietly caps the field. Forty at 9 m is a
   * ~420 m box run, which the ~830 m straight carries with its tapers to
   * spare; the clamp below is for safety, not for the layouts the plan
   * actually draws.
   */
  const pitBoxSpacing = 9;
  // A short run ALONG the tarmac edge at each end, then the taper out. The
  // attach glues the first two points onto the edge anyway; building them
  // there in the first place means it barely moves them, and the spline into
  // the junction stays smooth instead of dipping half a metre onto the
  // racing surface between a moved point and an unmoved one.
  // Exactly the attach's own lead-in distance: it re-glues the second point
  // that far along the track, and a second point built anywhere else gives
  // the junction spline a kink to smooth out -- over the racing surface.
  const pitEdgeRun = 25;
  const pitTaper = 80;
  const aStart = pts[0];
  const bEnd = pts[PIT_SPAN - 1];
  const straightLen = Math.hypot(bEnd.x - aStart.x, bEnd.z - aStart.z) || 1;
  const dirX = (bEnd.x - aStart.x) / straightLen;
  const dirZ = (bEnd.z - aStart.z) / straightLen;
  // Right of the direction of travel, which is the side the lane sits on.
  const rX = -dirZ;
  const rZ = dirX;
  // How many boxes the straight can actually hold: the lane may take 92% of
  // it, the tapers and edge runs take their share, and the box run keeps its
  // 40 m lead-in and 30 m tail inside the parallel section.
  const maxBoxes = Math.floor((straightLen * 0.92 - (pitEdgeRun + pitTaper) * 2 - 70) / pitBoxSpacing) + 1;
  const pitBoxes = Math.max(8, Math.min(40, maxBoxes));
  const parallel = 40 + (pitBoxes - 1) * pitBoxSpacing + 30;
  const laneLen = Math.min(parallel + (pitEdgeRun + pitTaper) * 2, straightLen * 0.92);
  const lane0 = straightLen / 2 - laneLen / 2;

  // One point per feature of the profile, not an even spread: both ends of
  // each edge run, a point per taper half, and the box run's centre -- and
  // not one more, because every point here is a handle somebody has to drag
  // around later. The 12 m point matters more than it looks: the attach
  // re-glues the SECOND point of the lane onto the tarmac edge as far along
  // as it used to be, so the second point is built exactly where that lands
  // and the junction spline never has a kink to smooth out over the racing
  // surface.
  const taperSis = [0.5, 1].map((t) => pitEdgeRun + pitTaper * t);
  const sis = [
    0,
    12,
    pitEdgeRun,
    ...taperSis,
    laneLen / 2,
    ...taperSis.map((s) => laneLen - s).reverse(),
    laneLen - pitEdgeRun,
    laneLen - 12,
    laneLen,
  ];
  const pit: TrackNode[] = [];
  for (const si of sis) {
    const shape = Math.min(
      smoothstep(pitEdgeRun, pitEdgeRun + pitTaper, si),
      smoothstep(laneLen - pitEdgeRun, laneLen - pitEdgeRun - pitTaper, si),
    );
    // Half a metre of slack over the attach's own edge distance everywhere the
    // attach does not overwrite the point: the spline between the glued edge
    // points and the taper sags a few decimetres inwards, and the slack keeps
    // that sag off the racing surface.
    const slack = si <= pitEdgeRun || si >= laneLen - pitEdgeRun ? 0 : 0.5;
    const offset = halfWidth + 4 + slack + (PIT_OFFSET - halfWidth - 4 - slack) * shape;
    // Offset from the road the frames actually describe, not from the ideal
    // chord: towards the ends of the straight the corners are already leading
    // in, and a lane measured off the chord there drifts onto the tarmac.
    const f = frameAtDistance(frames, true, startDist - straightLen / 2 + lane0 + si);
    pit.push(
      makeNode(
        { x: f.pos.x + f.right.x * offset, y: ys[0], z: f.pos.z + f.right.z * offset },
        { widthL: 4, widthR: 4, wallL: false, wallR: false },
      ),
    );
  }

  const linked = attachPitLane({ closed: false, nodes: pit }, frames, true);
  const pitNodes = linked ? linked.nodes : pit;

  const paddock: Paddock = {
    ax: aStart.x,
    az: aStart.z,
    dirX,
    dirZ,
    rightX: rX,
    rightZ: rZ,
    length: straightLen,
    latMin: opts.paddock === false ? -20 : -80,
  };
  /* The ground under the whole complex is GRADED before anything stands on
   * it, the way a real circuit cuts its paddock into the country: one level
   * pad at the straight's height, from just past the circuit's own edge to
   * behind the garage rows, eased back into the landscape over a wide skirt.
   *
   * Without it the complex stood on whatever the hills happened to do there,
   * and every surface that rides the LANE's plane fought the ground that
   * rides the TERRAIN: wherever the two crossed between height samples, a
   * wedge of grass stood up through the concrete -- in the editor and in the
   * game alike, worst along the entry where the hillside runs across the
   * tapers. A flat pad and the fight is over: there is nothing left to poke
   * through.
   */
  if (opts.paddock !== false) {
    const cs2 = terrain.size / (terrain.res - 1);
    const padY = ys[0];
    const alongMin = lane0 - 30;
    const alongMax = lane0 + laneLen + 30;
    const latMin = halfWidth + 1;
    const latMax =
      PIT_OFFSET + 4 + PIT_APRON_WIDTH + 1
      + propTileBox('pit_building').hz + propTileBox('garage_bay').hz * 2 + 20;
    const skirt = 45;
    const ease = (d: number) => {
      const t = Math.min(1, Math.max(0, d / skirt));
      return t * t * (3 - 2 * t);
    };
    for (let iz = 0; iz < terrain.res; iz++) {
      for (let ix = 0; ix < terrain.res; ix++) {
        const wx = terrain.originX + ix * cs2;
        const wz = terrain.originZ + iz * cs2;
        // Distance along/across from where the straight and its frames really
        // run, not from the chord: the pad has to follow the same bend the
        // lane does or its corner juts out past the exit into the field.
        const f = frameAtDistance(
          frames,
          true,
          startDist - straightLen / 2
            + Math.min(alongMax, Math.max(alongMin,
              (wx - paddock.ax) * paddock.dirX + (wz - paddock.az) * paddock.dirZ)),
        );
        const lat = (wx - f.pos.x) * f.right.x + (wz - f.pos.z) * f.right.z;
        const along = (wx - paddock.ax) * paddock.dirX + (wz - paddock.az) * paddock.dirZ;
        const dLat = lat < latMin ? latMin - lat : lat > latMax ? lat - latMax : 0;
        const dAlong = along < alongMin ? alongMin - along : along > alongMax ? along - alongMax : 0;
        const outside = Math.hypot(dLat, dAlong);
        if (outside >= skirt) continue;
        const w = 1 - ease(outside);
        const i = iz * terrain.res + ix;
        terrain.heights[i] += (padY - terrain.heights[i]) * w;
      }
    }
    // The lane's own points ride the pad, not the hills they were sampled on.
    for (const node of pitNodes) node.p[1] = padY;
  }

  const props: PropInstance[] = [];
  if (opts.paddock !== false) props.push(...buildPaddock(frames, paddock, PIT_OFFSET, ys[0]));

  /* The open ends of the pit wall get closed.
   *
   * Between the circuit's fence line and the lane's concrete runs the pit
   * wall, and a wall has two ends -- each of them, left open, a steel edge
   * pointing straight up the road for anyone who misses the entry. A real
   * circuit closes the mouth with tyres, so a tyre wall stands ACROSS the
   * gap at both ends of the box run, from the fence to the concrete: hit it
   * and you stop against rubber, square on, instead of finding the end of a
   * barrier edge-first. Placed as ordinary props, so they can be dragged
   * about or deleted like anything else the generator builds.
   */
  if (opts.paddock !== false) {
    const wallLat = halfWidth + 13.5;
    const mouths = [
      lane0 + pitEdgeRun + pitTaper + 2,
      lane0 + laneLen - pitEdgeRun - pitTaper - 2,
    ];
    mouths.forEach((along, k) => {
      /* Measured off the frames the road actually describes, exactly as the
         lane's own points are: towards the ends of the straight the corners
         are already leading in, and a stack placed off the chord stood ten
         metres out in the country. */
      const f = frameAtDistance(frames, true, startDist - straightLen / 2 + along);
      props.push({
        id: `genpit_tyres_${k}`,
        kind: 'tyre_wall',
        name: `pit_wall_end_${k}`,
        p: [f.pos.x + f.right.x * wallLat, ys[0], f.pos.z + f.right.z * wallLat],
        r: [0, (Math.atan2(f.right.x, f.right.z) * 180) / Math.PI, 0],
        s: [1, 1, 1],
        ground: true,
      });
    });
  }

  /* And the paddock stands on concrete, not on a lawn.
   *
   * Everything between the working lane and the back of the garage rows is
   * ground people walk and push cars across all weekend, and on a real
   * circuit it is one poured apron. The ground brush's concrete is painted
   * over that whole rectangle -- the light one, same as painting it by hand
   * with the Ground tool, so it exports as CONCRETE and can be repainted or
   * rubbed out afterwards like any other patch. It reaches a metre onto the
   * drawn working lane so the two surfaces meet under the concrete rather
   * than leaving a thread of grass between them, and it stops short of the
   * strip towards the circuit, which stays what it is: run off.
   */
  if (opts.paddock !== false) {
    const concrete = GROUND_KINDS.findIndex((k) => k.label === 'Concrete');
    if (concrete >= 0) {
      if (!terrain.paint) terrain.paint = createPaint(terrain.res);
      if (!terrain.paintEdge) terrain.paintEdge = createPaintEdge(terrain.res);
      const latNear = PIT_OFFSET + 4 + PIT_APRON_WIDTH - 1;
      const latFar =
        PIT_OFFSET + 4 + PIT_APRON_WIDTH + 1
        + propTileBox('pit_building').hz + propTileBox('garage_bay').hz * 2 + 14;
      /* Only the box run. Carried past it, the rectangle's far corner stood
         out in the field beyond the exit taper -- a grey tongue pointing the
         wrong way where the circuit had already begun to bend. The tapers
         keep their grass verge, exactly as a real entry ramp does. */
      const alongA = lane0 + pitEdgeRun + pitTaper;
      const alongB = lane0 + laneLen - pitEdgeRun - pitTaper;
      const mid = (alongA + alongB) / 2;
      paintGroundRect(
        terrain,
        terrain.paint,
        terrain.paintEdge,
        {
          x: paddock.ax + paddock.dirX * mid + paddock.rightX * ((latNear + latFar) / 2),
          z: paddock.az + paddock.dirZ * mid + paddock.rightZ * ((latNear + latFar) / 2),
          w: latFar - latNear,
          l: alongB - alongA,
          rotY: -(Math.atan2(paddock.dirX, paddock.dirZ) * 180) / Math.PI,
        },
        paintValue(concrete),
      );
    }
  }

  if (opts.trees) props.push(...plantForest(rng, terrain, frames, pitNodes, paddock));

  return {
    track,
    pit: pitNodes,
    terrain,
    startS: total > 0 ? startDist / total : 0,
    length: total,
    pitCfg: {
      boxCount: pitBoxes,
      boxSpacing: pitBoxSpacing,
      /* Said out loud rather than left to the project defaults: the whole
         paddock is laid out around these two -- how far out the lane runs, how
         much run off is left beside the circuit, where the garages stand --
         so a generated circuit that took them from somewhere else would have
         its buildings in the wrong place the moment a default changed. */
      apron: PIT_APRON_WIDTH,
      boxOffset: PIT_BOX_OFFSET,
      // The lane sits to the right of the track, so away from the track is
      // further right still: garages outside, working lane inside.
      boxSide: 1,
      // The limiter comes on exactly where the tapers end and the lane
      // straightens out -- the painted line across the lane then stands at
      // the visible start and end of the pit lane proper, not somewhere in
      // the middle of a curving ramp. Box 0 sits a respectful way past it.
      startDist: pitEdgeRun + pitTaper + 40,
      limitStart: pitEdgeRun + pitTaper,
      limitEnd: pitEdgeRun + pitTaper,
    },
    props,
  };
}
