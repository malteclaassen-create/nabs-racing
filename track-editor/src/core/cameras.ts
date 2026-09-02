import * as THREE from 'three';
import type { TrackCamera } from '../types';
import { frameAtDistance, pathLength, type Frame } from './spline';
import {
  CAMERA_WINDOW_BOTTOM,
  CAMERA_WINDOW_MAX_GAP,
  CAMERA_WINDOW_TOP,
  cameraWindowStations,
  type CameraWindow,
  type SideProfile,
} from './road';

/**
 * Replay cameras: where the TV cameras stand and which stretch of the lap
 * each one covers.
 *
 * Assetto Corsa reads them from data/cameras.ini. Every camera is a fixed
 * position with a zoom range; the game aims it at the car for as long as the
 * car is between the camera's IN_POINT and OUT_POINT, which are fractions of
 * the AI spline. Our spline starts at the first track control point, so a
 * fraction here is simply distance along the lap over its length.
 *
 * The cameras live IN the fence, the way they do on a real circuit: the
 * catch fence has a square window cut into its mesh at every corner and
 * along the long straights (see cameraWindowStations in road.ts), and the
 * operator on the far side films through it. So the automatic set puts one camera at every
 * window, on the side the action is on, with its lens in the middle of the
 * opening. There is no model: the window is the camera position.
 */

/** Zoom range a fixed trackside camera is usually given. */
export const CAMERA_FOV_MIN = 8;
export const CAMERA_FOV_MAX = 40;

/** How far behind the fence line the lens sits: the tripod on the far side. */
const BEHIND_FENCE = 0.8;
/** Lens height above the barrier's foot: the middle of the window. */
export const LENS_HEIGHT = (CAMERA_WINDOW_BOTTOM + CAMERA_WINDOW_TOP) / 2;
/** Where a camera goes on a side with no barrier: beside the run off. */
const OPEN_STAND_OFF = 4;
/** Straighter than this and a station has no "outside"; sides alternate. */
const STRAIGHT = 1 / 600;

/** Fraction of the lap for a distance along it, wrapped into 0..1. */
export function lapFraction(dist: number, total: number): number {
  if (total <= 0) return 0;
  const s = dist / total;
  return s - Math.floor(s);
}

/** Length of a camera's stretch as a fraction, seam aware. */
export function coverage(cam: { inS: number; outS: number }): number {
  const d = cam.outS - cam.inS;
  return d >= 0 ? d : d + 1;
}

/** Whether lap fraction `s` lies inside the camera's stretch, seam aware. */
export function covers(cam: { inS: number; outS: number }, s: number): boolean {
  if (cam.inS <= cam.outS) return s >= cam.inS && s <= cam.outS;
  return s >= cam.inS || s <= cam.outS;
}

/**
 * The point on the lap the camera is aimed at when the file is written: the
 * middle of its stretch. The game swings the camera onto the car from there,
 * so this only has to be roughly right, and the middle always is.
 */
export function cameraTarget(cam: TrackCamera, frames: Frame[], closed: boolean): THREE.Vector3 {
  const total = pathLength(frames, closed);
  const mid = lapFraction(cam.inS + coverage(cam) / 2, 1);
  return frameAtDistance(frames, closed, mid * total).pos.clone();
}

/** Unit vector from the lens to the target. */
export function cameraForward(cam: TrackCamera, frames: Frame[], closed: boolean): THREE.Vector3 {
  const t = cameraTarget(cam, frames, closed);
  const f = t.sub(new THREE.Vector3(cam.p[0], cam.p[1], cam.p[2]));
  return f.lengthSq() > 1e-9 ? f.normalize() : new THREE.Vector3(0, 0, 1);
}

/**
 * A stretch around a lap position for a camera dropped by hand: from a good
 * way before it to a little past it, which is how a real TV camera is used --
 * it watches the car approach, not leave.
 */
export function stretchAround(dist: number, total: number): { inS: number; outS: number } {
  const before = Math.min(180, total * 0.12);
  const after = Math.min(60, total * 0.04);
  return {
    inS: lapFraction(dist - before, total),
    outS: lapFraction(dist + after, total),
  };
}

/**
 * Where a camera stands beside the lap at `dist` on `side`: at the fence's
 * camera window if the side is fenced, the lens just behind the mesh in the
 * middle of the opening, and beside the run off if the side is open. Heights
 * are above the barrier's foot, which is at road-edge height because the
 * run off goes out level.
 */
export function cameraStand(
  frames: Frame[],
  closed: boolean,
  profile: SideProfile,
  dist: number,
  side: -1 | 1,
): { p: [number, number, number]; onBarrier: boolean } {
  const total = pathLength(frames, closed);
  const f = frameAtDistance(frames, closed, dist);
  const n = frames.length;
  const i = Math.max(0, Math.min(n - 1, Math.round(lapFraction(dist, total) * n) % n));
  const hard =
    side < 0
      ? f.widthL + profile.kerbWL[i] + profile.apronL[i] + profile.runoffL[i]
      : f.widthR + profile.kerbWR[i] + profile.apronR[i] + profile.runoffR[i];
  const hasWall = (side < 0 ? profile.wallL[i] : profile.wallR[i]) === 1;
  const gap = side < 0 ? profile.wallGapL[i] : profile.wallGapR[i];
  const lateral = hard + (hasWall ? gap + BEHIND_FENCE : OPEN_STAND_OFF);
  // Out along the flattened right vector: a banked bend must not tip the
  // camera into the ground or the sky.
  const rx = f.right.x;
  const rz = f.right.z;
  const len = Math.hypot(rx, rz) || 1;
  return {
    p: [
      f.pos.x + (rx / len) * lateral * side,
      f.pos.y + LENS_HEIGHT,
      f.pos.z + (rz / len) * lateral * side,
    ],
    onBarrier: hasWall,
  };
}

/**
 * The lap's camera positions: one at every camera window in the fence,
 * which is one per corner and one every CAMERA_WINDOW_MAX_GAP metres of
 * straight -- where a real circuit's TV positions are. The side is the
 * outside of the bend at that point,
 * where the cars come towards the lens; on a straight the sides alternate,
 * so a long straight is covered from both banks in turn.
 */
export function cameraSpots(
  frames: Frame[],
  closed: boolean,
  profile: SideProfile,
  /**
   * The windows the fence was actually cut with. A station can be fenced on
   * paper and still have no window -- the run is broken by a gate, a pit
   * junction or a cut the author made -- and a camera belongs where the
   * opening is. Without the list the sides are judged from the profile alone.
   */
  windows?: readonly CameraWindow[],
): Array<{ dist: number; side: -1 | 1 }> {
  if (frames.length < 8) return [];
  const total = pathLength(frames, closed);
  const n = frames.length;
  const stations = cameraWindowStations(frames, closed);
  const out: Array<{ dist: number; side: -1 | 1 }> = [];
  let flip: -1 | 1 = -1;
  for (const dist of stations) {
    const f = frameAtDistance(frames, closed, dist);
    const k = f.curvature ?? 0;
    let side: -1 | 1;
    if (Math.abs(k) > STRAIGHT) {
      // Positive curvature bends right, so its outside is the left.
      side = k > 0 ? -1 : 1;
    } else {
      side = flip;
      flip = flip < 0 ? 1 : -1;
    }
    /*
     * A side with no fence has no window to film through -- and along the
     * pit straight it is the side the pit lane runs on, where a camera
     * beside the run off would stand on the working lane. Take the other
     * side when that one is fenced; only a circuit fenced on neither side
     * keeps the camera on the open bank.
     */
    const i = Math.round(lapFraction(dist, total) * n) % n;
    const walled = (sd: -1 | 1) => (sd < 0 ? profile.wallL[i] : profile.wallR[i]) === 1;
    if (!walled(side) && walled(-side as -1 | 1)) side = -side as -1 | 1;
    if (windows) {
      const open = (sd: -1 | 1) => windows.some((w) => w.side === sd && Math.abs(w.dist - dist) < 1);
      if (!open(side) && open(-side as -1 | 1)) side = -side as -1 | 1;
    }
    out.push({ dist, side });
  }
  return out;
}

/**
 * Lay a full set of cameras around the lap the way a broadcast would: one
 * at every camera window in the fence, the stretches joined end to end so
 * the director never has a gap. Each camera cuts in half way back to the
 * previous one and hands over half way on to the next.
 */
export function autoCameras(
  frames: Frame[],
  closed: boolean,
  profile: SideProfile,
  idFor: (i: number) => string,
  windows?: readonly CameraWindow[],
): TrackCamera[] {
  const total = pathLength(frames, closed);
  if (frames.length < 8 || total <= 0) return [];
  const spots = cameraSpots(frames, closed, profile, windows);
  const out: TrackCamera[] = [];
  const n = spots.length;
  for (let k = 0; k < n; k++) {
    const spot = spots[k];
    const prev = spots[(k - 1 + n) % n];
    const next = spots[(k + 1) % n];
    const gapBack = ((spot.dist - prev.dist) % total + total) % total || total;
    const gapOn = ((next.dist - spot.dist) % total + total) % total || total;
    const inS = lapFraction(spot.dist - gapBack / 2, total);
    const outS = lapFraction(spot.dist + gapOn / 2, total);
    const stand = cameraStand(frames, closed, profile, spot.dist, spot.side);
    out.push({
      id: idFor(k),
      name: `Camera ${k + 1}`,
      p: stand.p,
      inS,
      outS,
      fovMin: CAMERA_FOV_MIN,
      fovMax: CAMERA_FOV_MAX,
    });
  }
  return out;
}

/**
 * data/cameras.ini, in the layout Kunos' own tracks use.
 *
 * Cameras are written in lap order of their IN_POINT so the game's director
 * walks them the way the cars do. The exposure and depth of field fields are
 * left at the values the stock tracks carry; they are not something a track
 * author reaches for.
 */
export function camerasIni(cameras: readonly TrackCamera[], frames: Frame[], closed: boolean): string {
  const list = [...cameras].sort((a, b) => a.inS - b.inS);
  const f = (v: number) => (Math.round(v * 1000) / 1000).toString();
  const lines: string[] = [
    '[HEADER]',
    'VERSION=2',
    `CAMERA_COUNT=${list.length}`,
    'SET_NAME=Track',
    '',
  ];
  list.forEach((cam, i) => {
    const fwd = cameraForward(cam, frames, closed);
    lines.push(
      `[CAMERA_${i}]`,
      `NAME=${cam.name.replace(/[\r\n]/g, ' ')}`,
      `POSITION=${f(cam.p[0])},${f(cam.p[1])},${f(cam.p[2])}`,
      `FORWARD=${f(fwd.x)},${f(fwd.y)},${f(fwd.z)}`,
      'UP=0,1,0',
      `MIN_FOV=${f(cam.fovMin)}`,
      `MAX_FOV=${f(cam.fovMax)}`,
      `IN_POINT=${f(cam.inS)}`,
      `OUT_POINT=${f(cam.outS)}`,
      'SHADOW_SPLIT0=5',
      'SHADOW_SPLIT1=30',
      'SHADOW_SPLIT2=100',
      'NEAR_PLANE=0.7',
      'FAR_PLANE=5000',
      'MIN_EXPOSURE=0.4',
      'MAX_EXPOSURE=0.4',
      'DOF_FACTOR=0',
      'DOF_RANGE=0',
      'DOF_FOCUS=0',
      'DOF_MANUAL=0',
      'SPLINE=0',
      'IS_FIXED=1',
      '',
    );
  });
  return lines.join('\n');
}

/** The longest stretch without a window, re-exported for the panel's wording. */
export const CAMERA_SPACING = CAMERA_WINDOW_MAX_GAP;
