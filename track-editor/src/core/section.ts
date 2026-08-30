import * as THREE from 'three';
import type { PathData, TrackNode } from '../types';
import { makeNode } from './spline';

/**
 * Editing a whole run of control points at once.
 *
 * Setting a width or a banking angle one point at a time is fine for a detail,
 * but useless for "make this corner wider" or "no barrier along the pit
 * straight". A section is the run of points from one selected point forwards
 * along the track to another, and every operation here works on that run.
 */

/**
 * Indices of the points from `fromId` forwards to `toId`.
 * On a closed loop the run wraps around, so picking the two points in the other
 * order selects the other way round the circuit. That is deliberate: it is how
 * you choose which of the two arcs you meant.
 */
export function sectionIndices(path: PathData, fromId: string, toId: string): number[] {
  const a = path.nodes.findIndex((n) => n.id === fromId);
  const b = path.nodes.findIndex((n) => n.id === toId);
  if (a < 0 || b < 0) return [];
  const n = path.nodes.length;

  const out: number[] = [];
  if (path.closed) {
    let i = a;
    for (let guard = 0; guard <= n; guard++) {
      out.push(i);
      if (i === b) break;
      i = (i + 1) % n;
    }
  } else {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let i = lo; i <= hi; i++) out.push(i);
  }
  return out;
}

export function sectionNodes(path: PathData, fromId: string, toId: string): TrackNode[] {
  return sectionIndices(path, fromId, toId).map((i) => path.nodes[i]);
}

/** Average of a numeric field across the section, for showing in the panel. */
export function sectionAverage(nodes: TrackNode[], pick: (n: TrackNode) => number): number {
  if (nodes.length === 0) return 0;
  return nodes.reduce((sum, n) => sum + pick(n), 0) / nodes.length;
}

/** True when every point in the section agrees. Used for the tri state boxes. */
export function sectionAll(nodes: TrackNode[], pick: (n: TrackNode) => boolean): boolean {
  return nodes.length > 0 && nodes.every(pick);
}

export function sectionAny(nodes: TrackNode[], pick: (n: TrackNode) => boolean): boolean {
  return nodes.some(pick);
}

/* ------------------------------------------------------------------ */
/* Operations. All of them mutate the nodes of the given path in place. */
/* ------------------------------------------------------------------ */

export function applyToSection(
  path: PathData,
  fromId: string,
  toId: string,
  fn: (n: TrackNode, u: number, k: number, count: number) => void,
) {
  const idx = sectionIndices(path, fromId, toId);
  const count = idx.length;
  idx.forEach((i, k) => fn(path.nodes[i], count > 1 ? k / (count - 1) : 0, k, count));
}

/**
 * Move the whole section by an offset, keeping its internal shape exactly.
 *
 * Every point gets the SAME offset. Snapping belongs on the offset, never on
 * the resulting positions: rounding each point to the grid individually would
 * pull the run into a staircase and destroy the shape of the corner.
 */
export function translateSection(
  path: PathData,
  fromId: string,
  toId: string,
  dx: number,
  dy: number,
  dz: number,
) {
  applyToSection(path, fromId, toId, (n) => {
    n.p[0] += dx;
    n.p[1] += dy;
    n.p[2] += dz;
  });
}

/** Shift the whole section up or down, keeping its internal shape. */
export function raiseSection(path: PathData, fromId: string, toId: string, delta: number) {
  applyToSection(path, fromId, toId, (n) => {
    n.p[1] += delta;
  });
}

/**
 * Ease the height of the section into a straight ramp between its two ends, so
 * a bumpy stretch becomes a clean climb or descent.
 */
export function rampSection(path: PathData, fromId: string, toId: string) {
  const idx = sectionIndices(path, fromId, toId);
  if (idx.length < 2) return;
  const startY = path.nodes[idx[0]].p[1];
  const endY = path.nodes[idx[idx.length - 1]].p[1];
  idx.forEach((i, k) => {
    const u = k / (idx.length - 1);
    path.nodes[i].p[1] = startY + (endY - startY) * u;
  });
}

/** Pull the height of every point towards the average of its neighbours. */
export function smoothSection(path: PathData, fromId: string, toId: string, strength = 0.6) {
  const idx = sectionIndices(path, fromId, toId);
  if (idx.length < 3) return;
  const before = idx.map((i) => path.nodes[i].p[1]);
  for (let k = 1; k < idx.length - 1; k++) {
    const avg = (before[k - 1] + before[k] + before[k + 1]) / 3;
    const n = path.nodes[idx[k]];
    n.p[1] = n.p[1] + (avg - n.p[1]) * strength;
  }
}

/**
 * Pull the section onto the straight line between its two ends. Handy for
 * turning a wobbly stretch into a proper straight.
 */
export function straightenSection(path: PathData, fromId: string, toId: string, strength = 1) {
  const idx = sectionIndices(path, fromId, toId);
  if (idx.length < 3) return;
  const a = path.nodes[idx[0]];
  const b = path.nodes[idx[idx.length - 1]];
  const pa = new THREE.Vector3(...a.p);
  const pb = new THREE.Vector3(...b.p);
  for (let k = 1; k < idx.length - 1; k++) {
    const u = k / (idx.length - 1);
    const target = pa.clone().lerp(pb, u);
    const n = path.nodes[idx[k]];
    n.p[0] += (target.x - n.p[0]) * strength;
    n.p[1] += (target.y - n.p[1]) * strength;
    n.p[2] += (target.z - n.p[2]) * strength;
  }
}

/** Put an extra control point between every pair, for finer shaping. */
export function subdivideSection(path: PathData, fromId: string, toId: string): string[] {
  const idx = sectionIndices(path, fromId, toId);
  if (idx.length < 2) return [];
  const created: string[] = [];

  // Walk backwards so the earlier indices stay valid while inserting.
  for (let k = idx.length - 1; k > 0; k--) {
    const i = idx[k];
    const prev = idx[k - 1];
    const a = path.nodes[prev];
    const b = path.nodes[i];
    const mid = makeNode(
      {
        x: (a.p[0] + b.p[0]) / 2,
        y: (a.p[1] + b.p[1]) / 2,
        z: (a.p[2] + b.p[2]) / 2,
      },
      a,
    );
    mid.widthL = (a.widthL + b.widthL) / 2;
    mid.widthR = (a.widthR + b.widthR) / 2;
    mid.bank = (a.bank + b.bank) / 2;
    mid.runoffL = (a.runoffL + b.runoffL) / 2;
    mid.runoffR = (a.runoffR + b.runoffR) / 2;
    mid.aiOffset = (a.aiOffset + b.aiOffset) / 2;
    // Insert after `prev`, which is at index `prev` unless the run wrapped.
    const at = prev + 1;
    path.nodes.splice(at, 0, mid);
    created.push(mid.id);
  }
  return created;
}

/** Remove the points inside the section, keeping the two ends. */
export function deleteSectionInterior(path: PathData, fromId: string, toId: string) {
  const idx = sectionIndices(path, fromId, toId);
  if (idx.length < 3) return;
  const doomed = new Set(idx.slice(1, -1).map((i) => path.nodes[i].id));
  if (path.nodes.length - doomed.size < 3) return;
  path.nodes = path.nodes.filter((n) => !doomed.has(n.id));
}
