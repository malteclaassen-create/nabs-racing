import * as THREE from 'three';
import type { GridSettings, PitSettings, Project, TimingSettings } from '../types';
import type { Frame } from './spline';
import { frameAtDistance, frameAtFraction, pathLength, resampleByDistance } from './spline';

/**
 * All the AC_* marker objects. These are what turn a pretty mesh into a track
 * the game can actually run a session on.
 */
export interface Marker {
  /** Exact object name written into the FBX, e.g. "AC_START_3". */
  name: string;
  pos: THREE.Vector3;
  /** Rotation with local +Z pointing in the driving direction, local +Y up. */
  quat: THREE.Quaternion;
  kind: 'start' | 'pit' | 'time' | 'hotlap';
  index: number;
}

const Y = new THREE.Vector3(0, 1, 0);

/**
 * Rotation whose local +Z is the driving direction and local +Y is the road
 * normal. Confirmed convention for AC_START / AC_PIT dummies.
 */
export function frameQuat(f: Frame): THREE.Quaternion {
  const z = f.fwd.clone().normalize();
  const y = f.up.clone().normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** Flat version, used where banking should not tilt a marker. */
export function flatQuat(f: Frame): THREE.Quaternion {
  const z = new THREE.Vector3(f.fwd.x, 0, f.fwd.z);
  if (z.lengthSq() < 1e-9) z.set(0, 0, 1);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(Y, z).normalize();
  const m = new THREE.Matrix4().makeBasis(x, Y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function applyOverride(
  base: { pos: THREE.Vector3; quat: THREE.Quaternion },
  ov?: { p: [number, number, number]; rot: number },
) {
  if (!ov) return base;
  return {
    pos: new THREE.Vector3(ov.p[0], ov.p[1], ov.p[2]),
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(ov.rot), 0)),
  };
}

/* ------------------------------------------------------------------ */
/* Starting grid                                                       */
/* ------------------------------------------------------------------ */

export function buildGridMarkers(
  frames: Frame[],
  closed: boolean,
  timing: TimingSettings,
  grid: GridSettings,
): Marker[] {
  if (frames.length < 2 || grid.count < 1) return [];
  const total = pathLength(frames, closed);
  const lineDist = timing.startS * total;
  const out: Marker[] = [];

  for (let i = 0; i < grid.count; i++) {
    const back = grid.poleBack + i * grid.rowSpacing;
    const f = frameAtDistance(frames, closed, lineDist - back);
    const side = grid.stagger ? (i % 2 === 0 ? -1 : 1) : 0;
    const pos = f.pos.clone().addScaledVector(f.right, side * grid.lateralOffset);
    const base = { pos, quat: flatQuat(f) };
    const fin = applyOverride(base, grid.overrides[i]);
    out.push({ name: `AC_START_${i}`, pos: fin.pos, quat: fin.quat, kind: 'start', index: i });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pit boxes                                                           */
/* ------------------------------------------------------------------ */

export function buildPitMarkers(
  pitFrames: Frame[],
  pitClosed: boolean,
  cfg: PitSettings,
): Marker[] {
  if (cfg.boxCount < 1) return [];
  const out: Marker[] = [];

  if (pitFrames.length < 2) {
    // No pit lane drawn yet, but overrides may still hold placed boxes.
    for (let i = 0; i < cfg.boxCount; i++) {
      const ov = cfg.overrides[i];
      if (!ov) continue;
      out.push({
        name: `AC_PIT_${i}`,
        pos: new THREE.Vector3(ov.p[0], ov.p[1], ov.p[2]),
        quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(ov.rot), 0)),
        kind: 'pit',
        index: i,
      });
    }
    return out;
  }

  for (let i = 0; i < cfg.boxCount; i++) {
    const f = frameAtDistance(pitFrames, pitClosed, cfg.startDist + i * cfg.boxSpacing);
    const pos = f.pos.clone().addScaledVector(f.right, cfg.boxSide * cfg.boxOffset);
    const base = { pos, quat: flatQuat(f) };
    const fin = applyOverride(base, cfg.overrides[i]);
    out.push({ name: `AC_PIT_${i}`, pos: fin.pos, quat: fin.quat, kind: 'pit', index: i });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Timing gates                                                        */
/* ------------------------------------------------------------------ */

export interface Gate {
  index: number;
  left: THREE.Vector3;
  right: THREE.Vector3;
  frame: Frame;
}

export function gateFractions(timing: TimingSettings): number[] {
  return [timing.startS, ...[...timing.sectors].sort((a, b) => a - b)];
}

export function buildGates(frames: Frame[], closed: boolean, timing: TimingSettings): Gate[] {
  const out: Gate[] = [];
  gateFractions(timing).forEach((s, i) => {
    const f = frameAtFraction(frames, closed, s);
    if (!f) return;
    // A little wider than the road so the trigger definitely spans it.
    out.push({
      index: i,
      left: f.pos.clone().addScaledVector(f.right, -(f.widthL + 2)),
      right: f.pos.clone().addScaledVector(f.right, f.widthR + 2),
      frame: f,
    });
  });
  return out;
}

export function gateMarkers(gates: Gate[]): Marker[] {
  const out: Marker[] = [];
  for (const g of gates) {
    const q = flatQuat(g.frame);
    out.push({ name: `AC_TIME_${g.index}_L`, pos: g.left.clone(), quat: q, kind: 'time', index: g.index });
    out.push({ name: `AC_TIME_${g.index}_R`, pos: g.right.clone(), quat: q, kind: 'time', index: g.index });
  }
  return out;
}

export function hotlapMarker(frames: Frame[], closed: boolean, timing: TimingSettings): Marker[] {
  if (frames.length < 2) return [];
  const total = pathLength(frames, closed);
  const f = frameAtDistance(frames, closed, timing.startS * total - timing.hotlapBack);
  return [{ name: 'AC_HOTLAP_START_0', pos: f.pos.clone(), quat: flatQuat(f), kind: 'hotlap', index: 0 }];
}

/* ------------------------------------------------------------------ */
/* AI line                                                             */
/* ------------------------------------------------------------------ */

export interface AiPoint {
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  normal: THREE.Vector3;
  /** Distance from the AI point to the left / right track edge. */
  sideLeft: number;
  sideRight: number;
  /** Signed curvature radius in metres, large when nearly straight. */
  radius: number;
  camber: number;
  /** Arc length from the first point. */
  dist: number;
}

export function buildAiLine(frames: Frame[], closed: boolean, spacing: number): AiPoint[] {
  const s = resampleByDistance(frames, closed, spacing);
  if (s.length < 3) return [];

  const pts = s.map((f) => ({
    f,
    pos: f.pos.clone().addScaledVector(f.right, f.aiOffset),
  }));

  const n = pts.length;
  const out: AiPoint[] = [];
  let dist = 0;

  for (let i = 0; i < n; i++) {
    const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const cur = pts[i];
    const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];

    if (i > 0) dist += cur.pos.distanceTo(pts[i - 1].pos);

    const fwd = next.pos.clone().sub(prev.pos);
    if (fwd.lengthSq() < 1e-9) fwd.copy(cur.f.fwd);
    fwd.normalize();

    // Menger curvature of the three consecutive points.
    const a = prev.pos.distanceTo(cur.pos);
    const b = cur.pos.distanceTo(next.pos);
    const c = prev.pos.distanceTo(next.pos);
    const area2 = Math.abs(
      (cur.pos.x - prev.pos.x) * (next.pos.z - prev.pos.z) -
        (next.pos.x - prev.pos.x) * (cur.pos.z - prev.pos.z),
    );
    const radius = area2 > 1e-6 ? (a * b * c) / (2 * area2) : 10000;

    const off = cur.f.aiOffset;
    out.push({
      pos: cur.pos,
      fwd,
      normal: cur.f.up.clone(),
      sideLeft: Math.max(0.5, cur.f.widthL + off),
      sideRight: Math.max(0.5, cur.f.widthR - off),
      radius: Math.min(radius, 10000),
      camber: Math.asin(Math.min(1, Math.max(-1, cur.f.right.y))),
      dist,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Everything at once                                                  */
/* ------------------------------------------------------------------ */

export interface MarkerSet {
  grid: Marker[];
  pits: Marker[];
  gates: Gate[];
  gateMarkers: Marker[];
  hotlap: Marker[];
  all: Marker[];
}

export function buildAllMarkers(
  project: Project,
  trackFrames: Frame[],
  pitFrames: Frame[],
): MarkerSet {
  const closed = project.track.closed;
  const grid = buildGridMarkers(trackFrames, closed, project.timing, project.grid);
  const pits = buildPitMarkers(pitFrames, project.pit.closed, project.pitCfg);
  const gates = buildGates(trackFrames, closed, project.timing);
  const gm = gateMarkers(gates);
  const hot = hotlapMarker(trackFrames, closed, project.timing);
  return { grid, pits, gates, gateMarkers: gm, hotlap: hot, all: [...grid, ...pits, ...gm, ...hot] };
}
