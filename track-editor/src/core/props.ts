import * as THREE from 'three';
import type { PropInstance, TerrainSettings } from '../types';
import { sampleHeights } from './terrain';

/**
 * Props that are marked "snap to ground" follow the terrain instead of storing
 * a fixed height. The viewport and the exporter both go through here so a tree
 * never sits at a different height in the game than it does in the editor.
 */

export function propPosition(
  inst: PropInstance,
  terrain: TerrainSettings,
  heights: Float32Array,
): THREE.Vector3 {
  const y = inst.ground ? sampleHeights(terrain, heights, inst.p[0], inst.p[2]) : inst.p[1];
  return new THREE.Vector3(inst.p[0], y, inst.p[2]);
}

export function propQuaternion(inst: PropInstance): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(inst.r[0]),
      THREE.MathUtils.degToRad(inst.r[1]),
      THREE.MathUtils.degToRad(inst.r[2]),
      'XYZ',
    ),
  );
}

/*
 * Scratch for the matrix builder below. Not a micro-optimisation: the viewport
 * rebuilds the matrix of EVERY placed object whenever the ground moves, which
 * is every frame of a brush stroke. On a track with a few thousand objects that
 * is tens of thousands of calls a frame, and the allocating version below made
 * five objects each -- around seventy thousand per brush frame, four million a
 * second. None of them live longer than the loop, but they still have to be
 * collected, and a major collection on a heap that size is measured in seconds.
 * That is what a four second freeze after a single click turned out to be.
 */
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpScale = new THREE.Vector3();

/**
 * The object's transform, written into a matrix the caller owns.
 *
 * The allocation free path. Anything looping over many objects should use this
 * one and hand in a single matrix it reuses.
 */
export function writePropMatrix(
  inst: PropInstance,
  terrain: TerrainSettings,
  heights: Float32Array,
  out: THREE.Matrix4,
): THREE.Matrix4 {
  const y = inst.ground ? sampleHeights(terrain, heights, inst.p[0], inst.p[2]) : inst.p[1];
  tmpPos.set(inst.p[0], y, inst.p[2]);
  tmpEuler.set(
    THREE.MathUtils.degToRad(inst.r[0]),
    THREE.MathUtils.degToRad(inst.r[1]),
    THREE.MathUtils.degToRad(inst.r[2]),
    'XYZ',
  );
  tmpQuat.setFromEuler(tmpEuler);
  tmpScale.set(inst.s[0], inst.s[1], inst.s[2]);
  return out.compose(tmpPos, tmpQuat, tmpScale);
}

/** The same, in a fresh matrix, for the callers that keep the result. */
export function propMatrix(
  inst: PropInstance,
  terrain: TerrainSettings,
  heights: Float32Array,
): THREE.Matrix4 {
  return writePropMatrix(inst, terrain, heights, new THREE.Matrix4());
}
