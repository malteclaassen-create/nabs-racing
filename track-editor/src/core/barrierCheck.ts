import * as THREE from 'three';
import type { Frame } from './spline';
import type { SideProfile } from './road';

/**
 * Finding the stretches of barrier that came out wrong.
 *
 * The barrier is not placed, it is DERIVED: an offset of the centre line by
 * whatever the road, the kerb, the shoulder and the gap add up to. That works
 * everywhere a circuit is drawn at a sane scale and misbehaves in a handful of
 * ways where it is not, and no amount of tuning the offset rules has made all
 * of them go away -- a corner tight enough will always find one.
 *
 * So rather than promise the geometry is perfect, this says WHERE it is not,
 * in the same currency the editor can act on: stretches of lap. What the
 * editor then does with them is the author's business -- see BarrierCut.
 *
 * Every test here is a measurement of the built line, never of the rules that
 * built it. A rule that believes itself is exactly how the wrong ones survived
 * this long.
 */

export type FaultKind = 'fold' | 'pinch' | 'squeeze' | 'collide';

export interface BarrierFault {
  side: -1 | 1;
  /** Curve parameters, the datum a BarrierCut is stored in. */
  from: number;
  to: number;
  kind: FaultKind;
  /** Metres of lap, for saying how long it is. */
  metres: number;
}

/**
 * Tightest arc the barrier may be bent into before it reads as a hook rather
 * than a curve. Below about this the run of armco is visibly wound around the
 * inside of the corner instead of following it.
 */
const MIN_ARC = 6;

/** Least clear ground between tarmac and barrier before it is "on the kerb". */
const MIN_CLEAR = 0.6;

/** How near two stretches of barrier may pass before they are through each other. */
const COLLIDE = 1.2;

/**
 * Faults shorter than this are not worth acting on.
 *
 * Metres of lap, not cross sections: the sampling gets denser in METRES as a
 * circuit is drawn tighter, so a count of sections would quietly raise the bar
 * on exactly the corners this exists for. It was three, and a hook a metre and
 * a half long -- perfectly visible, and the whole of the fault on a very tight
 * apex -- fell straight through it.
 */
const MIN_RUN = 1.5;

/** Lap metres either side of a fault that come out with it, so ends are clean. */
const PAD = 2;

const REASON: Record<FaultKind, string> = {
  fold: 'doubles back on itself',
  pinch: 'wound into a hook at the apex',
  squeeze: 'standing on the edge of the tarmac',
  collide: 'laid through another stretch of barrier',
};

export function faultReason(kind: FaultKind): string {
  return REASON[kind];
}

/**
 * Where the barrier line stands, per cross section, on one side.
 *
 * The same sum the mesh builder makes, kept here rather than reached for from
 * it: this has to be able to say the mesh is wrong, which it cannot do if it
 * asks the mesh where it is.
 */
function barrierLine(frames: Frame[], profile: SideProfile, side: -1 | 1): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const away = side;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const off = offsetAt(frames, profile, side, i);
    const rx = f.right.x;
    const rz = f.right.z;
    const len = Math.hypot(rx, rz) || 1;
    out.push(new THREE.Vector3(
      f.pos.x + (rx / len) * away * off,
      f.pos.y,
      f.pos.z + (rz / len) * away * off,
    ));
  }
  return out;
}

/** How far the barrier stands from the centre line at one cross section. */
function offsetAt(frames: Frame[], p: SideProfile, side: -1 | 1, i: number): number {
  const f = frames[i];
  return side < 0
    ? f.widthL + p.kerbWL[i] + p.apronL[i] + p.runoffL[i] + p.wallGapL[i]
    : f.widthR + p.kerbWR[i] + p.apronR[i] + p.runoffR[i] + p.wallGapR[i];
}

/**
 * Every stretch of barrier that came out wrong, worst first.
 *
 * Cheap enough to run on a button press over a five kilometre circuit: one
 * pass per side for the local tests, and a grid for the one test that is about
 * two places at once.
 */
export function findBarrierFaults(
  frames: Frame[],
  profile: SideProfile,
  closed: boolean,
  /*
   * Stretches already taken out. Skipped rather than reported: the check reads
   * the offsets, which do not know a cut has been made, so without this the
   * button would go on naming the very faults it was just used to remove and
   * there would be no way to tell a dealt-with circuit from an untouched one.
   */
  cuts: ReadonlyArray<{ side: -1 | 1; from: number; to: number }> = [],
): BarrierFault[] {
  const n = frames.length;
  const faults: BarrierFault[] = [];
  if (n < 4) return faults;

  const alreadyOpen = (side: -1 | 1, t: number) =>
    cuts.some((c) => c.side === side
      && (c.from <= c.to ? t >= c.from && t <= c.to : t >= c.from || t <= c.to));

  for (const side of [-1, 1] as const) {
    const flags = side < 0 ? profile.wallL : profile.wallR;
    const line = barrierLine(frames, profile, side);
    const bad = new Uint8Array(n);
    const why: FaultKind[] = new Array(n);

    const mark = (i: number, kind: FaultKind) => {
      // Worse diagnoses win, so a stretch that is both is named by the one
      // that says most about it.
      const rank: Record<FaultKind, number> = { squeeze: 0, pinch: 1, fold: 2, collide: 3 };
      if (!bad[i] || rank[kind] > rank[why[i]]) why[i] = kind;
      bad[i] = 1;
    };

    for (let i = 0; i < n; i++) {
      if (!flags[i] || alreadyOpen(side, frames[i].t)) continue;
      const f = frames[i];
      const off = offsetAt(frames, profile, side, i);

      // Standing on the tarmac: nothing between the road and the barrier.
      const clear = off - (side < 0 ? f.widthL : f.widthR);
      if (clear < MIN_CLEAR) mark(i, 'squeeze');

      // Wound into a hook: an inward offset of `off` from a line of radius R
      // is an arc of radius R - off, and below a few metres that is a hook.
      const kappa = f.curvature;
      if (Number.isFinite(kappa) && Math.abs(kappa) > 1e-6) {
        const inside = kappa > 0 ? 1 : -1;
        if (side === inside) {
          const arc = 1 / Math.abs(kappa) - off;
          if (arc < MIN_ARC) mark(i, 'pinch');
        }
      }

      // Doubling back: the line runs against the direction of travel.
      const j = i + 1 < n ? i + 1 : (closed ? 0 : i);
      if (j !== i && flags[j]) {
        const dx = line[j].x - line[i].x;
        const dz = line[j].z - line[i].z;
        const len = Math.hypot(dx, dz);
        // Steps under a centimetre carry no direction worth reading.
        if (len > 0.01 && (dx * f.fwd.x + dz * f.fwd.z) / len < 0) mark(i, 'fold');
      }
    }

    /*
     * Two stretches laid through each other.
     *
     * Not a neighbour test: what collides is a barrier with one from a wholly
     * different part of the lap, so the pair has to be far apart ALONG the
     * track and close together on the ground. A coarse grid keeps it to a
     * handful of comparisons per cross section instead of all of them.
     */
    const cell = Math.max(2, COLLIDE * 2);
    const buckets = new Map<string, number[]>();
    const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    for (let i = 0; i < n; i++) {
      if (!flags[i] || alreadyOpen(side, frames[i].t)) continue;
      const k = key(line[i].x, line[i].z);
      const list = buckets.get(k);
      if (list) list.push(i);
      else buckets.set(k, [i]);
    }
    const lap = frames[n - 1].dist;
    for (let i = 0; i < n; i++) {
      if (!flags[i] || alreadyOpen(side, frames[i].t)) continue;
      const cx = Math.floor(line[i].x / cell);
      const cz = Math.floor(line[i].z / cell);
      for (let ox = -1; ox <= 1 && !bad[i]; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const list = buckets.get(`${cx + ox},${cz + oz}`);
          if (!list) continue;
          for (const j of list) {
            let along = Math.abs(frames[j].dist - frames[i].dist);
            if (closed) along = Math.min(along, lap - along);
            // Its own neighbourhood is the same barrier a moment later.
            if (along < 25) continue;
            if (line[i].distanceTo(line[j]) < COLLIDE) {
              mark(i, 'collide');
              mark(j, 'collide');
              break;
            }
          }
        }
      }
    }

    /* Runs of marked cross sections become one fault apiece. */
    let i = 0;
    while (i < n) {
      if (!bad[i]) { i += 1; continue; }
      let z = i;
      while (z + 1 < n && bad[z + 1]) z += 1;
      const metres = frames[z].dist - frames[i].dist;
      if (metres >= MIN_RUN) {
        const padT = (m: number) => {
          const lapLen = frames[n - 1].dist || 1;
          return m / lapLen;
        };
        faults.push({
          side,
          from: Math.max(0, frames[i].t - padT(PAD)),
          to: Math.min(1, frames[z].t + padT(PAD)),
          kind: why[i],
          metres,
        });
      }
      i = z + 1;
    }
  }

  return faults.sort((a, b) => b.metres - a.metres);
}
