import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { AssetFile } from '../types';

/**
 * Imported models live in the project file as base64. This module turns them
 * into three.js objects once and keeps them around, so placing 200 copies of
 * the same tree costs one parse.
 *
 * It is also the only place that knows how big an imported model is. The
 * built in objects are measured out of the procedural library; an imported one
 * has no library entry, and everything that asked the library for its size --
 * the ghost preview, snapping, duplicate-in-a-row, the inspector -- was told it
 * was a point at the origin. So the measurements live here, beside the object
 * they are taken from, and `core/library` forwards to them.
 */

const cache = new Map<string, THREE.Group>();
const pending = new Map<string, Promise<THREE.Group | null>>();
const boxes = new Map<string, THREE.Box3>();
const errors = new Map<string, string>();
const listeners = new Set<() => void>();

/** The place tool's key for an imported model, so one field can hold either. */
export const ASSET_PREFIX = 'asset:';

/**
 * The biggest model that can be imported, and the biggest one the browser's
 * own autosave can carry.
 *
 * Two different numbers because two different things break. The project FILE
 * takes whatever you give it -- it is a download, there is no quota on it. The
 * autosave is localStorage, about five megabytes for the whole origin, and a
 * model goes in as base64, a third bigger than the file on disk. So a model of
 * a few megabytes is perfectly usable and simply means the project has to be
 * saved by hand; the hard limit is about memory instead, since base64 plus the
 * JSON around it plus the blob written out is several copies of the file at
 * once.
 *
 * The hard limit used to be 40 MB and refused anything over it with "that will
 * not fit in a project file", which was both wrong and invisible: it was said
 * in the status strip, which the next mouse move overwrites.
 */
export const MODEL_LIMIT_MB = 120;
export const AUTOSAVE_SAFE_MB = 3;

export function isAssetKind(kind: string): boolean {
  return kind.startsWith(ASSET_PREFIX);
}

/** The asset id inside a place key, or null for a built in object. */
export function assetIdOf(kind: string): string | null {
  return kind.startsWith(ASSET_PREFIX) ? kind.slice(ASSET_PREFIX.length) : null;
}

/*
 * Bumped whenever a model finishes parsing OR fails to.
 *
 * A failure has to count: the palette card says why it is dead and the import
 * button reports it, and neither can redraw for something it never hears about.
 */
let version = 0;

/** Snapshot for `useSyncExternalStore`. */
export function assetVersion(): number {
  return version;
}

export function onAssetsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify() {
  version += 1;
  for (const fn of listeners) fn();
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Put an imported model into the editor's world: metres, feet on the ground,
 * centred on its own origin.
 *
 * `unitScale` is the file's own answer to "how big is one of my units in
 * metres", or 1 when it does not say. Only FBX does say, and three's loader
 * records the number without ever applying it -- so a model exported from
 * Blender or Max in centimetres, which is the default in both, arrived a
 * hundred times too big. The scale slider stops at 5x, so there was no way
 * back from that inside the editor.
 */
function normalize(group: THREE.Object3D, unitScale = 1): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.add(group);
  if (unitScale > 0 && Math.abs(unitScale - 1) > 1e-6) group.scale.multiplyScalar(unitScale);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return wrapper;
  // Put the model's feet on y = 0 and centre it horizontally. The offsets are
  // in the wrapper's frame, which is the scaled one, so they are applied after
  // the unit scale rather than before it.
  const min = box.min;
  const max = box.max;
  group.position.x -= (min.x + max.x) / 2;
  group.position.z -= (min.z + max.z) / 2;
  group.position.y -= min.y;
  wrapper.updateMatrixWorld(true);
  return wrapper;
}

/**
 * FBX states its unit in `GlobalSettings.UnitScaleFactor`: centimetres per
 * unit, so 1 is a centimetre file and 100 is a metre file. three's FBXLoader
 * parks it in `userData` and leaves the geometry in file units.
 */
function fbxUnitScale(root: THREE.Object3D): number {
  const factor = (root.userData as { unitScaleFactor?: unknown }).unitScaleFactor;
  return typeof factor === 'number' && factor > 0 ? factor / 100 : 1;
}

async function parse(asset: AssetFile): Promise<THREE.Group> {
  const buf = base64ToArrayBuffer(asset.data);
  if (asset.ext === 'glb' || asset.ext === 'gltf') {
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(
      asset.ext === 'glb' ? buf : new TextDecoder().decode(buf),
      '',
    );
    return normalize(gltf.scene);
  }
  if (asset.ext === 'obj') {
    return normalize(new OBJLoader().parse(new TextDecoder().decode(buf)));
  }
  if (asset.ext === 'fbx') {
    const obj = new FBXLoader().parse(buf, '');
    return normalize(obj, fbxUnitScale(obj));
  }
  throw new Error(`unsupported file type .${asset.ext}`);
}

export function getAsset(id: string): THREE.Group | null {
  return cache.get(id) ?? null;
}

/**
 * Why a model is not in the cache, or null if there is nothing wrong with it.
 *
 * A file that will not parse used to fail into `console.error` alone: the
 * palette still offered the card, clicking it still added an object to the
 * project, and the object rendered as nothing. Now the reason is kept and the
 * UI can say it.
 */
export function assetError(id: string): string | null {
  return errors.get(id) ?? null;
}

/**
 * The model's bounds in metres, feet on y = 0 and centred, or null while it is
 * still parsing (or if it never will).
 */
export function assetBox(id: string): THREE.Box3 | null {
  const group = cache.get(id);
  if (!group) return null;
  let box = boxes.get(id);
  if (!box) {
    box = new THREE.Box3().setFromObject(group);
    boxes.set(id, box);
  }
  return box;
}

/**
 * Parse a model if it is not already in hand, and hand back what it parsed to.
 *
 * The promise is shared, so the import button can wait for the same parse the
 * viewport is waiting for rather than starting a second one.
 */
export function ensureAsset(asset: AssetFile): Promise<THREE.Group | null> {
  const held = cache.get(asset.id);
  if (held) return Promise.resolve(held);
  const already = pending.get(asset.id);
  if (already) return already;

  const p = parse(asset).then(
    (g) => {
      cache.set(asset.id, g);
      boxes.delete(asset.id);
      errors.delete(asset.id);
      pending.delete(asset.id);
      notify();
      return g;
    },
    (err: unknown) => {
      const why = err instanceof Error ? err.message : String(err);
      console.error(`Failed to parse ${asset.name}`, err);
      errors.set(asset.id, why);
      pending.delete(asset.id);
      notify();
      return null;
    },
  );
  pending.set(asset.id, p);
  return p;
}

export function ensureAssets(assets: AssetFile[]): void {
  for (const a of assets) void ensureAsset(a);
}

export function forgetAsset(id: string): void {
  cache.delete(id);
  pending.delete(id);
  boxes.delete(id);
  errors.delete(id);
}

export function extOf(fileName: string): AssetFile['ext'] | null {
  const m = fileName.toLowerCase().match(/\.(glb|gltf|obj|fbx)$/);
  return m ? (m[1] as AssetFile['ext']) : null;
}
