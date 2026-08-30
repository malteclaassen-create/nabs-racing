import * as THREE from 'three';
import { DDSLoader } from 'three/examples/jsm/loaders/DDSLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import {
  parsePartKey, partKey,
  type AcImport, type AcMarkerEdit, type AcMeshTransform, type AcPieceCopy,
} from '../types';
import { readAiLane, type AiLane } from './aiRead';
import { fetchTrackFile } from './bridge';
import {
  collectMeshes, decodeMesh, kn5Safety, walkKn5,
  type Kn5Dummy, type Kn5File, type Kn5Mesh,
} from './kn5Read';
import { isSplittable, partGeometry, partitionMesh, type MeshPartition } from './meshParts';
import { recoverPathFromLane, type RecoveredPath } from './recoverPath';
import { ribbonBounds, resizeAlongPath } from './ribbon';
import type { Frame } from '../core/spline';
import {
  loadModel, loadTrackFolder,
  type AcSurface, type AcTrackFolder, type LoadedModel,
} from './trackFolder';

/**
 * An imported Assetto Corsa track, ready to look at and edit.
 *
 * Lives in editor state, never in the project file: it is hundreds of
 * megabytes and it is all reconstructible from the installation. What goes in
 * the project is the reference to the folder and the list of edits.
 *
 * The two jobs here are showing the track and understanding it:
 *
 *   SHOWING -- kn5 meshes are merged by material into a handful of draw calls.
 *   The reference track's chosen layout has around 800 individual meshes and
 *   drawing them one by one costs more in React and in draw calls than it is
 *   worth for something the user cannot move. A per mesh index is kept beside
 *   it for hiding and for picking, and the merge is redone only when the
 *   hidden set changes, which is a click, not a frame.
 *
 *   UNDERSTANDING -- which meshes are drivable road, where the pit boxes are,
 *   where the centre line runs. That is what turns a pile of triangles into
 *   something the editor's tools can work on.
 */

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

/**
 * The surface a mesh belongs to, from its name.
 *
 * AC's rule: strip the LEADING DIGITS -- a priority number of any length --
 * then match a surfaces.ini KEY as a case-insensitive PREFIX of what is left.
 * No separator required, and the author may put whatever they like after it.
 *
 * Every clause of that cost a wrong version first, and each one was found by
 * measuring against the installed content rather than by reading a spec:
 *
 *   Key + underscore + capitals -- the way this editor writes its OWN tracks
 *   -- classified exactly ZERO meshes on the first real circuit tried. That
 *   track's road is `1road_astro`, its kerbs `1kerb04`, its gravel `1sand`.
 *
 *   ONE leading digit then classified zero meshes on all three Kunos tracks
 *   checked next, because Kunos number their priorities to two digits:
 *   `01KERB0051`, `22TARMSIL_A_007`, `15PIT-SILV`.
 *
 *   A separator may sit BETWEEN the priority and the key: `1_roada`,
 *   `1_curba`, `1_pitlane` on a circuit whose surfaces.ini declares exactly
 *   ROADA, CURBA and PITLANE.
 *
 *   And the key itself may CONTAIN the digit: one mod declares `KEY=1ROAD` and
 *   `KEY=1TRACK` in one layout and plain `KEY=ROAD` in another layout of the
 *   same track.
 *
 * Longest key wins, which matters more than it sounds: Silverstone's
 * surfaces.ini defines KERB, KURB and CURB, and TARMSIL_A_ alongside
 * TARMSIL_B_.
 *
 * Measured over the installed content after all four: 90 of 98 tracks find
 * their road and 81 find their kerbs. Of the rest, three have a main model too
 * large to open, and the others are a drag strip, a drift map and two hill
 * climbs -- none of which have kerbs to find.
 */
export function surfaceOfMesh(name: string, keys: readonly string[]): string | null {
  let at = 0;
  while (at < name.length && name[at] >= '0' && name[at] <= '9') at += 1;
  // No priority digits at all means it is not in the physics namespace.
  if (at === 0 || at >= name.length) return null;

  const stripped = name.slice(at).toLowerCase();
  // The priority is sometimes separated from the key: `1_roada`, `1_curba`,
  // `1_pitlane` on one installed circuit, whose surfaces.ini declares exactly
  // ROADA, CURBA and PITLANE. Without allowing for the underscore that track
  // classifies nothing at all.
  const afterSeparator = /^[_\-. ]/.test(stripped) ? stripped.slice(1) : null;
  // And some authors put the priority digit INSIDE the key: one installed mod
  // has `KEY=1ROAD` and `KEY=1TRACK` in one layout's surfaces.ini and plain
  // `KEY=ROAD` in another layout of the same track.
  const whole = name.toLowerCase();

  let best: string | null = null;
  for (const key of keys) {
    if (key.length === 0) continue;
    const lower = key.toLowerCase();
    const hit = stripped.startsWith(lower)
      || whole.startsWith(lower)
      || (afterSeparator !== null && afterSeparator.startsWith(lower));
    if (!hit) continue;
    if (!best || key.length > best.length) best = key;
  }
  if (best) return best;

  // WALL is AC's own, and is not declared in surfaces.ini -- a track can have
  // `03WALL02` colliders with no WALL entry anywhere, and one installed track
  // does exactly that.
  return stripped.startsWith('wall') || (afterSeparator?.startsWith('wall') ?? false) ? 'WALL' : null;
}

/**
 * Fallback for a track with no surfaces.ini, where there are no keys to match
 * against. These are AC's standard ones.
 */
export const STANDARD_SURFACE_KEYS: readonly string[] = [
  'PITLANE', 'ROAD', 'CURB', 'KERB', 'GRASS', 'SAND', 'DIRT', 'CONCRETE', 'ASPHALT', 'WALL', 'OLD',
];

/**
 * Whether a surface is somewhere a car races, according to the track itself.
 *
 * Read off surfaces.ini rather than guessed from the key's spelling, because
 * the keys are the author's invention: the reference track has an `OUTER` for
 * its run off tarmac, which no list of ours would ever have contained, and it
 * is marked IS_VALID_TRACK exactly like the road. Guessing would have thrown
 * away a fifth of the circuit's drivable area.
 */
export function isDrivableSurface(key: string | null, surfaces: readonly AcSurface[]): boolean {
  if (key === null) return false;
  const def = surfaces.find((s) => s.key === key);
  if (def) return def.isValidTrack;
  // No entry: fall back to the name, which is all there is to go on.
  return /^(ROAD|CURB|KERB|PIT|PITLANE|ASPHALT|CONCRETE)/i.test(key);
}

/**
 * The hard racing surface, as opposed to anything valid to be on.
 *
 * This is the narrower question the geometry tools ask -- where does the
 * TARMAC end, so a kerb can be laid along its edge. A gravel trap is a valid
 * track surface and is not somewhere to paint a line.
 */
export function isTarmacSurface(key: string | null): boolean {
  return key !== null && /^(ROAD|CURB|KERB|PIT|PITLANE|ASPHALT|OUTER)/i.test(key);
}

/* ------------------------------------------------------------------ */
/* Scene pieces                                                        */
/* ------------------------------------------------------------------ */

export interface AcSceneMesh {
  /** Mesh name inside the kn5, which is also its identity for edits. */
  name: string;
  /** Which model file it lives in. */
  model: string;
  materialId: number;
  materialName: string;
  /** surfaces.ini KEY it belongs to, or null for pure decoration. */
  surface: string | null;
  triangles: number;
  /** Axis aligned bounds in world space, for picking and for the object list. */
  box: THREE.Box3;
  /**
   * Kept only for meshes AC gives a physics surface to -- road, kerb, grass,
   * gravel. Those are the ground the editor's additions are placed on. Pure
   * scenery is drawn and then let go, which on the reference track is 596 of
   * 630 meshes and most of the memory.
   */
  geometry: THREE.BufferGeometry | null;
  renderable: boolean;
  /**
   * The world transform this mesh sits under, from its parent dummies and
   * models.ini. Kept so its geometry can be rebuilt on demand -- see
   * `sceneMeshGeometry` -- without holding a copy for all 630 of them.
   */
  matrix: THREE.Matrix4;
}

export interface AcSceneModel {
  path: string;
  loaded: LoadedModel;
  editable: boolean;
  /** Why not, when it is not. */
  readOnlyReason: string | null;
  meshes: AcSceneMesh[];
  /** One draw call per material, built from the visible meshes. */
  groups: Array<{ material: THREE.Material; geometry: THREE.BufferGeometry; name: string }>;
  /**
   * Meshes drawn on their own instead of inside a merged group.
   *
   * A mesh the user is moving cannot stay merged: it would mean rebuilding a
   * whole material's geometry on every frame of a drag. Pulled out, it is one
   * extra draw call and its transform is just an Object3D's, which costs
   * nothing to change. The merge is redone only when this SET changes, which
   * is a click.
   */
  loose: Array<{ mesh: AcSceneMesh; geometry: THREE.BufferGeometry; material: THREE.Material }>;
  /** The loose set this model was last built with, so a change is detectable. */
  looseNames: string[];
  triangles: number;
}

export interface AcMarkerRef {
  name: string;
  /** Model file it lives in, which is the file an edit has to patch. */
  model: string;
  pos: THREE.Vector3;
  /** Heading about Y in degrees, taken from the marker's own matrix. */
  rot: number;
  /** The original matrix, so an untouched marker is written back exactly. */
  matrix: Float32Array;
}

export interface AcScene {
  folder: AcTrackFolder;
  models: AcSceneModel[];
  markers: AcMarkerRef[];
  /** Recovered from ai/fast_lane.ai. Null when the track ships none. */
  track: RecoveredPath | null;
  trackLane: AiLane | null;
  /** Recovered from ai/pit_lane.ai. */
  pit: RecoveredPath | null;
  pitLane: AiLane | null;
  /** Bytes actually held in the tab, so the interface can be honest about it. */
  bytes: number;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

const ddsLoader = new DDSLoader();

function textureFrom(data: Uint8Array, name: string): THREE.Texture | null {
  if (data.length < 4) return null;
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  try {
    if (magic === 'DDS ') {
      // Compressed straight to the GPU: a 111 MB texture set stays 111 MB of
      // DXT instead of becoming half a gigabyte of decoded RGBA.
      const parsed = ddsLoader.parse(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
        true,
      );
      const tex = new THREE.CompressedTexture(
        parsed.mipmaps as unknown as ImageData[],
        parsed.width, parsed.height,
        parsed.format as THREE.CompressedPixelFormat,
      );
      tex.mipmaps = parsed.mipmaps as never;
      tex.minFilter = parsed.mipmapCount > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.name = name;
      tex.needsUpdate = true;
      return tex;
    }
  } catch {
    // A texture that will not decode is not worth failing an import over.
    return null;
  }
  return null;
}

/**
 * Whether a material should be alpha tested, from its shader name.
 *
 * The same rule the export side uses, read off the file instead of decided by
 * us: AC's *AT shaders are the alpha tested ones, and ksTree and ksGrass are
 * alpha tested by nature. Without this every tree in the imported track is a
 * solid green rectangle.
 */
function shaderIsAlphaTested(shader: string): boolean {
  return /AT($|_)/.test(shader) || shader === 'ksTree' || shader === 'ksGrass';
}

/* ------------------------------------------------------------------ */
/* Building one model                                                  */
/* ------------------------------------------------------------------ */

/** A stable, readable colour per material, for when there is no texture. */
function fallbackColour(name: string): THREE.Color {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const lower = name.toLowerCase();
  if (/asphalt|road|tarmac|track/.test(lower)) return new THREE.Color(0x3a3d42);
  if (/grass|erba/.test(lower)) return new THREE.Color(0x4a6b35);
  if (/sand|gravel|ghiaia/.test(lower)) return new THREE.Color(0xb09a6a);
  if (/kerb|curb|cordolo/.test(lower)) return new THREE.Color(0xb04a44);
  if (/tree|foglia|leaf/.test(lower)) return new THREE.Color(0x39592c);
  if (/wall|barrier|guard/.test(lower)) return new THREE.Color(0x9aa0a8);
  // Muted, and stable per name so the scene does not flicker between loads.
  return new THREE.Color().setHSL(((h % 360) / 360), 0.12, 0.42 + ((h >> 9) % 20) / 100);
}

function geometryOf(mesh: Kn5Mesh): THREE.BufferGeometry {
  const d = decodeMesh(mesh);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  return g;
}

/**
 * The world transform a mesh sits under.
 *
 * kn5 dummies carry matrices and meshes inherit them, so a model whose author
 * grouped things under a moved node needs the chain applied or half the track
 * lands at the origin. models.ini can move a whole model as well, which is how
 * the reference track puts its helicopters in the sky.
 */
function worldMatrices(file: Kn5File, base: THREE.Matrix4): Map<Kn5Mesh, THREE.Matrix4> {
  const out = new Map<Kn5Mesh, THREE.Matrix4>();
  const walk = (node: Kn5File['root'], parent: THREE.Matrix4) => {
    let here = parent;
    if (node.kind === 'dummy') {
      const local = new THREE.Matrix4().fromArray(node.matrix);
      here = new THREE.Matrix4().multiplyMatrices(parent, local);
    } else {
      out.set(node, parent);
    }
    for (const c of node.children) walk(c, here);
  };
  walk(file.root, base);
  return out;
}

function modelBaseMatrix(loaded: LoadedModel): THREE.Matrix4 {
  const [px, py, pz] = loaded.ref.position;
  const [rx, ry, rz] = loaded.ref.rotation;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(rx),
        THREE.MathUtils.degToRad(ry),
        THREE.MathUtils.degToRad(rz),
      ),
    ),
    new THREE.Vector3(1, 1, 1),
  );
}

export interface BuildModelOptions {
  surfaceKeys: readonly string[];
  /** The track's own surfaces.ini, which decides what counts as drivable. */
  surfaces: readonly AcSurface[];
  /** Mesh names the user hid. */
  hidden: ReadonlySet<string>;
  /** Mesh name -> replacement name, so the object list shows the new surface. */
  renamed: ReadonlyMap<string, string>;
  /** Meshes to draw individually rather than merged, so they can be moved. */
  loose?: ReadonlySet<string>;
  withTextures: boolean;
}

export function buildSceneModel(loaded: LoadedModel, opts: BuildModelOptions): AcSceneModel {
  const meshes: AcSceneMesh[] = [];
  const groups: AcSceneModel['groups'] = [];
  let triangles = 0;

  if (!loaded.file) {
    return {
      path: loaded.path, loaded, editable: false,
      readOnlyReason: loaded.error ?? 'this model could not be read',
      meshes, groups, loose: [], looseNames: [], triangles: 0,
    };
  }

  const safety = kn5Safety(loaded.file);
  const base = modelBaseMatrix(loaded);
  const transforms = worldMatrices(loaded.file, base);

  // Textures once per material, shared by every mesh that uses it.
  const textures = new Map<string, THREE.Texture | null>();
  const textureFor = (fileName: string): THREE.Texture | null => {
    if (!opts.withTextures) return null;
    if (textures.has(fileName)) return textures.get(fileName) ?? null;
    const entry = loaded.file!.textures.find((t) => t.name === fileName);
    const tex = entry && entry.data.length > 0 ? textureFrom(entry.data, fileName) : null;
    textures.set(fileName, tex);
    return tex;
  };

  const byMaterial = new Map<number, THREE.BufferGeometry[]>();
  const loose: AcSceneModel['loose'] = [];
  const looseSet = opts.loose ?? EMPTY_SET;

  // Materials are shared between the merged groups and the loose meshes, so a
  // mesh pulled out for dragging draws with exactly the same shading it had a
  // moment ago -- otherwise selecting something would change how it looks.
  const materialCache = new Map<number, THREE.Material>();
  const materialFor = (materialId: number): THREE.Material => {
    const cached = materialCache.get(materialId);
    if (cached) return cached;
    const def = loaded.file!.materials[materialId];
    const name = def?.name ?? `material ${materialId}`;
    const diffuse = def?.slots.find((sl) => sl.sampler === 'txDiffuse')?.texture ?? '';
    const map = diffuse ? textureFor(diffuse) : null;
    const alphaTested = def ? (def.alphaTested !== 0 || shaderIsAlphaTested(def.shader)) : false;
    const made = new THREE.MeshLambertMaterial({
      color: map ? 0xffffff : fallbackColour(name),
      map,
      // Alpha TEST, never blend: a tested material stays in the opaque pass,
      // so a fence or a tree has no draw order to get wrong.
      alphaTest: alphaTested ? 0.5 : 0,
      transparent: false,
      side: alphaTested ? THREE.DoubleSide : THREE.FrontSide,
    });
    materialCache.set(materialId, made);
    return made;
  };

  for (const mesh of collectMeshes(loaded.file.root)) {
    const shown = opts.renamed.get(mesh.name) ?? mesh.name;
    const material = loaded.file.materials[mesh.materialId];
    const surface = surfaceOfMesh(shown, opts.surfaceKeys);
    const tris = mesh.indexCount / 3;
    triangles += tris;

    const matrix = transforms.get(mesh) ?? base;
    const geo = geometryOf(mesh);
    geo.applyMatrix4(matrix);
    geo.computeBoundingBox();
    const box = geo.boundingBox?.clone() ?? new THREE.Box3();

    // Geometry is kept for anything AC treats as a surface, not just what is
    // drivable: the ground under a braking board is grass, and something has
    // to know where it is.
    const isGround = surface !== null;
    meshes.push({
      name: mesh.name,
      model: loaded.path,
      materialId: mesh.materialId,
      materialName: material?.name ?? `material ${mesh.materialId}`,
      surface,
      triangles: tris,
      box,
      // Kept only where it is needed later, so a whole circuit's worth of
      // scenery triangles is not held twice. On the reference track that is
      // 34 meshes of 630.
      geometry: isGround ? geo : null,
      renderable: mesh.renderable !== 0,
      matrix,
    });

    // An invisible physics twin is not drawn, and neither is a hidden mesh.
    if (mesh.renderable === 0 || opts.hidden.has(mesh.name)) {
      if (!isGround) geo.dispose();
      continue;
    }
    if (looseSet.has(mesh.name)) {
      loose.push({
        mesh: meshes[meshes.length - 1],
        geometry: isGround ? geo.clone() : geo,
        material: materialFor(mesh.materialId),
      });
      continue;
    }
    const list = byMaterial.get(mesh.materialId);
    if (list) list.push(isGround ? geo.clone() : geo);
    else byMaterial.set(mesh.materialId, [isGround ? geo.clone() : geo]);
  }

  for (const [materialId, geos] of byMaterial) {
    const def = loaded.file.materials[materialId];
    const name = def?.name ?? `material ${materialId}`;
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) { for (const g of geos) g.dispose(); continue; }
    if (merged !== geos[0]) for (const g of geos) g.dispose();
    groups.push({ name, geometry: merged, material: materialFor(materialId) });
  }

  return {
    path: loaded.path,
    loaded,
    editable: safety.editable,
    readOnlyReason: safety.reason,
    meshes, groups, loose, looseNames: [...looseSet].sort(), triangles,
  };
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * One mesh's geometry, built on demand.
 *
 * Not kept for every mesh: the reference track's chosen layout is 630 of them
 * and the merged groups already hold the same triangles. But the raw vertex
 * blocks are still in memory (the reader detached them from the download), so
 * rebuilding one is a decode, not a re-read.
 */
export function sceneMeshGeometry(
  model: AcSceneModel,
  name: string,
): THREE.BufferGeometry | null {
  const entry = model.meshes.find((m) => m.name === name);
  if (!entry || !model.loaded.file) return null;
  if (entry.geometry) return entry.geometry.clone();
  const raw = collectMeshes(model.loaded.file.root).find((m) => m.name === name);
  if (!raw) return null;
  const geo = geometryOf(raw);
  geo.applyMatrix4(entry.matrix);
  return geo;
}

/**
 * Decoded geometry kept around for picking.
 *
 * Picking has to test real triangles, and decoding a fifty thousand triangle
 * mesh takes long enough to feel: measured at 78 ms for an average click and
 * 180 ms for the worst. But a user clicks around the SAME few objects, so a
 * small cache turns every click after the first into nothing. Small on purpose
 * -- two dozen meshes is a few megabytes, where caching the whole track would
 * be the hundred megabytes deliberately not held in the first place.
 */
const PICK_CACHE_LIMIT = 24;
const pickCache = new Map<string, THREE.BufferGeometry>();

export function clearPickCache() {
  for (const g of pickCache.values()) g.dispose();
  pickCache.clear();
  partitionCache.clear();
}

/**
 * The connected pieces of one mesh, worked out once and kept.
 *
 * Splitting a fourteen thousand triangle kerb costs about 37 ms, so it happens
 * when a mesh is first clicked rather than at import -- doing all 630 up front
 * would be twenty seconds of work for meshes nobody touches.
 */
const partitionCache = new Map<string, MeshPartition>();

export function meshPartition(model: AcSceneModel, name: string): MeshPartition | null {
  const key = `${model.path}#${name}`;
  const hit = partitionCache.get(key);
  if (hit) return hit;
  if (!model.loaded.file) return null;
  const raw = collectMeshes(model.loaded.file.root).find((m) => m.name === name);
  if (!raw) return null;
  const made = partitionMesh(raw);
  partitionCache.set(key, made);
  return made;
}

/**
 * The point a piece turns and grows about, in world space.
 *
 * One shared answer for the gizmo, the write-back and the drawing, because
 * three different anchors would mean the handles, the preview and the exported
 * result each put the object somewhere else.
 */
export function acMeshCentre(
  model: AcSceneModel,
  mesh: AcSceneMesh,
  part?: number,
): THREE.Vector3 {
  if (part !== undefined) {
    const partition = meshPartition(model, mesh.name);
    const p = partition?.parts[part];
    if (p) return p.box.clone().applyMatrix4(mesh.matrix).getCenter(new THREE.Vector3());
  }
  return mesh.box.getCenter(new THREE.Vector3());
}

/** The bounds of a piece (or of the whole mesh) in world space. */
export function acMeshBox(
  model: AcSceneModel,
  mesh: AcSceneMesh,
  part?: number,
): THREE.Box3 {
  if (part !== undefined) {
    const partition = meshPartition(model, mesh.name);
    const p = partition?.parts[part];
    if (p) return p.box.clone().applyMatrix4(mesh.matrix);
  }
  return mesh.box.clone();
}

/**
 * Every vertex of a piece (or a whole mesh) as world points, as the modder
 * left them. This is what anything measuring along the track starts from:
 * the ribbon panel, the end grips, and a copy laid a section further on.
 */
export function acPieceWorldPoints(
  model: AcSceneModel,
  meshName: string,
  part?: number,
): THREE.Vector3[] | null {
  const mesh = model.meshes.find((m) => m.name === meshName);
  if (!mesh) return null;
  const geo = part !== undefined
    ? (() => {
        const partition = meshPartition(model, meshName);
        const raw = rawMeshOf(model, meshName);
        const p = partition?.parts[part];
        return raw && p ? partGeometry(raw, p).applyMatrix4(mesh.matrix) : null;
      })()
    : sceneMeshGeometry(model, meshName);
  if (!geo) return null;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    points.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  geo.dispose();
  return points.length > 0 ? points : null;
}

/**
 * The middle of a whole selection, in world space.
 *
 * With `transforms` given it is the middle of where the pieces are NOW; with an
 * empty map, of where they started. A group drag needs both: the handles belong
 * at the current middle, and the offset it produces is measured from the
 * original one, or the group would walk away from the cursor as it is dragged.
 */
export function acGroupCentre(
  scene: AcScene,
  refs: readonly { model: string; name: string; part?: number }[],
  transforms: Readonly<Record<string, Record<string, AcMeshTransform>>>,
): THREE.Vector3 | null {
  const sum = new THREE.Vector3();
  let n = 0;
  for (const ref of refs) {
    const model = scene.models.find((m) => m.path === ref.model);
    const mesh = model?.meshes.find((m) => m.name === ref.name);
    if (!model || !mesh) continue;
    const c = acMeshCentre(model, mesh, ref.part);
    const t = transforms[ref.model]?.[partKey(ref.name, ref.part)];
    if (t) c.add(new THREE.Vector3(t.p[0], t.p[1], t.p[2]));
    sum.add(c);
    n += 1;
  }
  return n > 0 ? sum.multiplyScalar(1 / n) : null;
}

/** The raw kn5 mesh behind a scene mesh, for geometry work. */
export function rawMeshOf(model: AcSceneModel, name: string): Kn5Mesh | null {
  if (!model.loaded.file) return null;
  return collectMeshes(model.loaded.file.root).find((m) => m.name === name) ?? null;
}

/**
 * Which of the track's own meshes a click landed on.
 *
 * Boxes FIRST, then triangles -- and the second half is not optional. Bounding
 * boxes alone got this wrong on the very first try: a ray dropped straight onto
 * a kerb returned a piece of scenery instead, because a long thin object like a
 * treeline or a run of fencing has a box that covers half the circuit while its
 * triangles cover almost none of it. Box picking answers "whose bounds did the
 * ray enter", which is a different question from "what did the ray hit".
 *
 * So the boxes are used for what they are good at: throwing away the 600 meshes
 * that cannot possibly be it, and ordering the handful that might. Those are
 * then decoded and tested properly, nearest box first, stopping as soon as a
 * real hit is closer than the next candidate's box -- so a click normally costs
 * one or two decodes, not six hundred.
 */
export interface AcPick {
  mesh: AcSceneMesh;
  model: AcSceneModel;
  /** Which connected piece was hit, when the mesh has more than one. */
  part?: number;
  /** Set when the thing hit is a copy the user placed rather than an original. */
  copyId?: string;
}

/**
 * The world transform an edit puts on a piece.
 *
 * The same rule the drawing and the exporter use: turn and grow about `about`
 * if the edit carries one -- a group move does -- otherwise about the piece's
 * own centre.
 */
export function editMatrix(t: AcMeshTransform, centre: THREE.Vector3): THREE.Matrix4 {
  const pivot = t.about ? new THREE.Vector3(t.about[0], t.about[1], t.about[2]) : centre;
  return new THREE.Matrix4()
    .makeTranslation(t.p[0], t.p[1], t.p[2])
    .multiply(new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z))
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(t.r[0]),
      THREE.MathUtils.degToRad(t.r[1]),
      THREE.MathUtils.degToRad(t.r[2]),
      'XYZ',
    )))
    .multiply(new THREE.Matrix4().makeScale(t.s[0], t.s[1], t.s[2]))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

/** What the picker considers: a lump of geometry somewhere in the world. */
interface PickTarget {
  model: AcSceneModel;
  mesh: AcSceneMesh;
  part?: number;
  copyId?: string;
  /** Cache key for its geometry. */
  key: string;
  /** Where it is now. null when it has not been moved. */
  delta: THREE.Matrix4 | null;
  /** Its bounds AFTER the move. */
  box: THREE.Box3;
  triangles: number;
}

export interface PickOptions {
  hidden?: Readonly<Record<string, readonly string[]>>;
  /** Model -> piece key -> where the user put it. */
  transforms?: Readonly<Record<string, Record<string, AcMeshTransform>>>;
  /** Model -> copies the user laid down. */
  copies?: Readonly<Record<string, readonly AcPieceCopy[]>>;
  /**
   * The centre line, for edits that follow the corner. Without it a
   * ribbon-resized piece is picked where it USED to be -- the exact phantom
   * this picker was once rebuilt to kill.
   */
  frames?: readonly Frame[];
}

/**
 * Which of the track's own meshes a click landed on.
 *
 * Boxes FIRST, then triangles -- and the second half is not optional. Bounding
 * boxes alone got this wrong on the very first try: a ray dropped straight onto
 * a kerb returned a piece of scenery instead, because a long thin object like a
 * treeline or a run of fencing has a box that covers half the circuit while its
 * triangles cover almost none of it. Box picking answers "whose bounds did the
 * ray enter", which is a different question from "what did the ray hit".
 *
 * It also has to look for things WHERE THEY ARE NOW. Testing the original
 * positions meant an object that had been moved stopped existing for the mouse
 * -- unclickable at its new place, and still clickable at the old one. So a
 * piece that has been moved is tested with the ray pushed back through its own
 * transform, which is cheaper than transforming the geometry and gives the same
 * answer, and the copies the user laid down are candidates in their own right.
 */
export function pickAcMesh(
  scene: AcScene,
  ray: THREE.Ray,
  options: PickOptions | Readonly<Record<string, readonly string[]>> = {},
): AcPick | null {
  // Older callers passed the hidden map directly.
  const opts: PickOptions = 'hidden' in options || 'transforms' in options || 'copies' in options
    ? options as PickOptions
    : { hidden: options as Readonly<Record<string, readonly string[]>> };
  const hidden = opts.hidden ?? {};
  const transforms = opts.transforms ?? {};
  const copies = opts.copies ?? {};
  const frames = opts.frames && opts.frames.length > 1 ? opts.frames : undefined;

  const targets: PickTarget[] = [];

  for (const model of scene.models) {
    const gone = hidden[model.path];
    const moves = transforms[model.path];

    for (const mesh of model.meshes) {
      if (!mesh.renderable) continue;
      if (gone && gone.includes(mesh.name)) continue;

      // Which pieces of this mesh have been moved.
      const movedParts = new Map<number, AcMeshTransform>();
      let wholeMove: AcMeshTransform | null = null;
      if (moves) {
        for (const [key, t] of Object.entries(moves)) {
          const parsed = parsePartKey(key);
          if (parsed.mesh !== mesh.name) continue;
          if (parsed.part === undefined) wholeMove = t;
          else movedParts.set(parsed.part, t);
        }
      }

      if (wholeMove) {
        const rt = ribbonPickTarget(model, mesh, undefined, undefined, wholeMove, frames);
        if (rt) { targets.push(rt); continue; }
        const delta = editMatrix(wholeMove, mesh.box.getCenter(new THREE.Vector3()));
        targets.push({
          model, mesh, key: `${model.path}#${mesh.name}`, delta,
          box: mesh.box.clone().applyMatrix4(delta), triangles: mesh.triangles,
        });
        continue;
      }

      if (movedParts.size === 0) {
        targets.push({
          model, mesh, key: `${model.path}#${mesh.name}`, delta: null,
          box: mesh.box.clone(), triangles: mesh.triangles,
        });
        continue;
      }

      // Some pieces moved: the rest stays where it is, and each moved piece is
      // hunted at its new place.
      const partition = meshPartition(model, mesh.name);
      if (!partition) {
        targets.push({
          model, mesh, key: `${model.path}#${mesh.name}`, delta: null,
          box: mesh.box.clone(), triangles: mesh.triangles,
        });
        continue;
      }
      targets.push({
        model, mesh, key: `${model.path}#${mesh.name}#rest:${[...movedParts.keys()].sort().join(',')}`,
        delta: null, box: mesh.box.clone(), triangles: mesh.triangles,
      });
      for (const [part, t] of movedParts) {
        const piece = partition.parts[part];
        if (!piece) continue;
        const rt = ribbonPickTarget(model, mesh, part, undefined, t, frames);
        if (rt) { targets.push(rt); continue; }
        const box = piece.box.clone().applyMatrix4(mesh.matrix);
        const delta = editMatrix(t, box.getCenter(new THREE.Vector3()));
        targets.push({
          model, mesh, part, key: `${model.path}#${mesh.name}#${part}`, delta,
          box: box.applyMatrix4(delta), triangles: piece.triangles.length,
        });
      }
    }

    // Copies the user laid down are objects too, and were not pickable at all.
    for (const copy of copies[model.path] ?? []) {
      const mesh = model.meshes.find((m) => m.name === copy.mesh);
      if (!mesh) continue;
      const partition = copy.part !== undefined ? meshPartition(model, copy.mesh) : null;
      const piece = copy.part !== undefined ? partition?.parts[copy.part] : undefined;
      if (copy.part !== undefined && !piece) continue;
      const rt = ribbonPickTarget(model, mesh, copy.part, copy.id, copy.t, frames);
      if (rt) { targets.push(rt); continue; }
      const box = piece
        ? piece.box.clone().applyMatrix4(mesh.matrix)
        : mesh.box.clone();
      const delta = editMatrix(copy.t, box.getCenter(new THREE.Vector3()));
      targets.push({
        model, mesh, part: copy.part, copyId: copy.id,
        key: `${model.path}#${copy.mesh}#${copy.part ?? 'all'}`,
        delta, box: box.applyMatrix4(delta),
        triangles: piece ? piece.triangles.length : mesh.triangles,
      });
    }
  }

  /*
   * Nearest box first, and among boxes the ray STARTS inside -- which is most
   * of the ground meshes, since they are hundreds of metres across -- the
   * smaller one first.
   *
   * That ordering is what makes the budget below safe: the thing the user
   * aimed at is nearly always a smaller object than the field it is standing
   * in, so it gets tested before the expensive ones and the search can stop.
   */
  const entry = new THREE.Vector3();
  const ordered: Array<{ t: PickTarget; near: number }> = [];
  for (const t of targets) {
    if (!ray.intersectBox(t.box, entry)) continue;
    ordered.push({ t, near: ray.origin.distanceTo(entry) });
  }
  ordered.sort((a, b) => (a.near - b.near) || (boxVolume(a.t.box) - boxVolume(b.t.box)));

  const caster = new THREE.Raycaster();
  caster.far = Infinity;
  const carrier = new THREE.Mesh();
  const results: THREE.Intersection[] = [];
  const localRay = new THREE.Ray();
  const hitPoint = new THREE.Vector3();

  let best: AcPick | null = null;
  let bestDistance = Infinity;
  /*
   * A ceiling on how much geometry one click may test.
   *
   * A ray aimed across a circuit enters the bounding box of every large ground
   * mesh before it reaches anything, so "the box is further away than the hit
   * already found" prunes far less than it looks like it should, and a click
   * costs around 130 ms with a worst case near 200. This bounds it.
   *
   * Four hundred thousand triangles, not less: tried at 120,000 and a click on
   * a catch fence started returning the groove strip underneath it instead,
   * because the budget ran out before the fence was reached. Twenty
   * milliseconds is not worth picking the wrong object.
   */
  let budget = 400_000;

  for (const { t, near } of ordered) {
    // Everything left starts further away than the hit already found.
    if (near > bestDistance) break;
    if (budget <= 0 && best) break;
    budget -= t.triangles;

    const geo = pickGeometryFor(t);
    if (!geo) continue;

    // The ray is pushed back through the transform rather than the geometry
    // being pushed forward through it: one ray against many triangles.
    if (t.delta) {
      localRay.copy(ray).applyMatrix4(t.delta.clone().invert());
      caster.ray.copy(localRay);
    } else {
      caster.ray.copy(ray);
    }
    carrier.geometry = geo;
    carrier.material = PICK_MATERIAL;
    carrier.matrixWorld.identity();
    results.length = 0;
    carrier.raycast(caster, results);

    for (const r of results) {
      // Distance has to be measured in WORLD space: a scaled piece shortens or
      // stretches the ray, so a local distance is not comparable.
      hitPoint.copy(r.point);
      if (t.delta) hitPoint.applyMatrix4(t.delta);
      const d = ray.origin.distanceTo(hitPoint);
      if (d >= bestDistance) continue;
      bestDistance = d;

      let part = t.part;
      if (part === undefined && !t.copyId && r.faceIndex !== undefined && r.faceIndex !== null) {
        // Which PIECE of it: a mesh is usually every kerb, every barrier
        // segment or every tree of its kind at once, and the click meant one.
        const partition = meshPartition(t.model, t.mesh.name);
        if (partition && isSplittable(partition) && r.faceIndex < partition.ofTriangle.length) {
          part = partition.ofTriangle[r.faceIndex];
        }
      }
      best = { mesh: t.mesh, model: t.model, part, copyId: t.copyId };
    }
  }
  return best;
}

const BOX_SCRATCH = new THREE.Vector3();
function boxVolume(box: THREE.Box3): number {
  const s = box.getSize(BOX_SCRATCH);
  return Math.max(1e-6, s.x * s.y * s.z);
}

/** Geometry for one pick target, cached. */
function pickGeometryFor(t: PickTarget): THREE.BufferGeometry | null {
  const hit = pickCache.get(t.key);
  if (hit) {
    pickCache.delete(t.key);
    pickCache.set(t.key, hit);
    return hit;
  }

  let geo: THREE.BufferGeometry | null = null;
  if (t.part !== undefined) {
    const partition = meshPartition(t.model, t.mesh.name);
    const raw = rawMeshOf(t.model, t.mesh.name);
    const piece = partition?.parts[t.part];
    if (raw && piece) geo = partGeometry(raw, piece).applyMatrix4(t.mesh.matrix);
  } else if (t.key.includes('#rest:')) {
    // The part of a split mesh that stayed put.
    const partition = meshPartition(t.model, t.mesh.name);
    const raw = rawMeshOf(t.model, t.mesh.name);
    if (partition && raw) {
      const movedParts = new Set(
        t.key.slice(t.key.indexOf('#rest:') + 6).split(',').filter(Boolean).map(Number),
      );
      const rest: number[] = [];
      for (let i = 0; i < partition.ofTriangle.length; i++) {
        if (!movedParts.has(partition.ofTriangle[i])) rest.push(i);
      }
      geo = partGeometry(raw, {
        triangles: Int32Array.from(rest), vertices: new Int32Array(0), box: new THREE.Box3(),
      }).applyMatrix4(t.mesh.matrix);
    }
  } else {
    geo = sceneMeshGeometry(t.model, t.mesh.name);
  }
  if (!geo) return null;

  pickCache.set(t.key, geo);
  while (pickCache.size > PICK_CACHE_LIMIT) {
    const oldest = pickCache.keys().next().value as string;
    pickCache.get(oldest)?.dispose();
    pickCache.delete(oldest);
  }
  return geo;
}

/** Both sides: a tree card and a fence panel are single sided in the file. */
const PICK_MATERIAL = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

/**
 * A pick target whose edit follows the corner.
 *
 * A ribbon resize is a deformation, not a matrix: every vertex went somewhere
 * different, so the ray cannot be pushed back through it. Instead the geometry
 * itself is deformed once -- the same maths the drawing and the exporter use --
 * cached like any other pick geometry, and tested with the world ray directly.
 * Returns null when the edit is not a ribbon one (or the centre line is
 * missing), and the caller falls back to the matrix path.
 */
function ribbonPickTarget(
  model: AcSceneModel,
  mesh: AcSceneMesh,
  part: number | undefined,
  copyId: string | undefined,
  t: AcMeshTransform,
  frames: readonly Frame[] | undefined,
): PickTarget | null {
  if (!t.ribbon || !frames) return null;
  const rib = t.ribbon;
  const anchor = (rib.anchor ?? [0.5, 0, 0.5]) as [number, number, number];
  const last = frames[frames.length - 1];
  const key = `${model.path}#${mesh.name}#${part ?? 'all'}`
    + `|rib:${rib.length},${rib.width},${rib.height}|e:${rib.edge ?? 0}`
    + `|a:${anchor.join(',')}|p:${t.p.join(',')}|f:${frames.length}:${last.dist.toFixed(1)}`;

  let geo = pickCache.get(key);
  if (!geo) {
    const base = pickGeometryFor({
      model, mesh, part,
      key: part !== undefined ? `${model.path}#${mesh.name}#${part}` : `${model.path}#${mesh.name}`,
      delta: null, box: mesh.box, triangles: 0,
    });
    if (!base) return null;
    const pos = base.getAttribute('position') as THREE.BufferAttribute;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
      points.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
    const bounds = ribbonBounds(frames, points, rib.edge);
    if (!bounds) return null;
    const resize = {
      length: rib.length, width: rib.width, height: rib.height,
      anchor,
      move: [t.p[0], t.p[1], t.p[2]] as [number, number, number],
      edgeSide: rib.edge,
    };
    const g = base.clone();
    const gpos = g.getAttribute('position') as THREE.BufferAttribute;
    const out = new THREE.Vector3();
    for (let i = 0; i < points.length; i++) {
      const placed = resizeAlongPath(frames, bounds, resize, points[i], out);
      if (placed) gpos.setXYZ(i, placed.x, placed.y, placed.z);
    }
    gpos.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    pickCache.set(key, g);
    while (pickCache.size > PICK_CACHE_LIMIT) {
      const oldest = pickCache.keys().next().value as string;
      pickCache.get(oldest)?.dispose();
      pickCache.delete(oldest);
    }
    geo = g;
  }

  const triangles = part !== undefined
    ? (meshPartition(model, mesh.name)?.parts[part]?.triangles.length ?? mesh.triangles)
    : mesh.triangles;
  return {
    model, mesh, part, copyId, key, delta: null,
    box: geo.boundingBox ? geo.boundingBox.clone() : mesh.box.clone(),
    triangles,
  };
}


/**
 * Rebuild one model's drawing with a different set of loose meshes.
 *
 * Only the model that owns the mesh is redone, not the whole track: on the
 * reference circuit that is 73 meshes instead of 630, and it happens on a
 * selection change rather than on a frame.
 */
export function rebuildSceneModel(
  model: AcSceneModel,
  opts: BuildModelOptions,
): AcSceneModel {
  disposeSceneModel(model);
  return buildSceneModel(model.loaded, opts);
}

export function disposeSceneModel(model: AcSceneModel) {
  // Materials are shared between groups and loose meshes, so each is disposed
  // once rather than once per user.
  const seen = new Set<THREE.Material>();
  const drop = (mat: THREE.Material) => {
    if (seen.has(mat)) return;
    seen.add(mat);
    (mat as THREE.MeshLambertMaterial).map?.dispose();
    mat.dispose();
  };
  for (const g of model.groups) { g.geometry.dispose(); drop(g.material); }
  for (const l of model.loose) { l.geometry.dispose(); drop(l.material); }
  model.groups.length = 0;
  model.loose.length = 0;
  for (const m of model.meshes) m.geometry?.dispose();
}

/* ------------------------------------------------------------------ */
/* Markers                                                             */
/* ------------------------------------------------------------------ */

/** Heading in degrees about Y, from a marker's own matrix. */
function headingOf(m: Float32Array): number {
  // The marker's local +Z is the driving direction, which after the column
  // major layout is elements [8..10].
  const zx = m[8], zz = m[10];
  if (Math.abs(zx) < 1e-6 && Math.abs(zz) < 1e-6) return 0;
  return THREE.MathUtils.radToDeg(Math.atan2(zx, zz));
}

export function markersOf(loaded: LoadedModel): AcMarkerRef[] {
  const out: AcMarkerRef[] = [];
  if (!loaded.file) return out;
  const base = modelBaseMatrix(loaded);
  const walk = (node: Kn5File['root'], parent: THREE.Matrix4) => {
    let here = parent;
    if (node.kind === 'dummy') {
      const local = new THREE.Matrix4().fromArray(node.matrix);
      here = new THREE.Matrix4().multiplyMatrices(parent, local);
      if (node.name.startsWith('AC_')) {
        const pos = new THREE.Vector3().setFromMatrixPosition(here);
        out.push({
          name: node.name,
          model: loaded.path,
          pos,
          rot: headingOf((node as Kn5Dummy).matrix),
          matrix: node.matrix,
        });
      }
    }
    for (const c of node.children) walk(c, here);
  };
  walk(loaded.file.root, base);
  return out;
}

/** Group a marker name into its family, e.g. `AC_TIME_1_L` -> `AC_TIME`. */
export function markerGroupOf(name: string): string {
  const m = /^(AC_[A-Z_]*?)_?\d+(_[LR])?$/.exec(name);
  return m ? m[1] : name;
}

/** Markers after the project's edits have been applied, for display. */
export function applyMarkerEdits(
  markers: readonly AcMarkerRef[],
  edits: Record<string, AcMarkerEdit[]>,
): AcMarkerRef[] {
  const moved = new Map<string, { p: [number, number, number]; rot: number }>();
  const deleted = new Set<string>();
  const added: AcMarkerRef[] = [];

  for (const [model, list] of Object.entries(edits)) {
    for (const e of list) {
      if (e.op === 'move') moved.set(e.name, { p: e.p, rot: e.rot });
      else if (e.op === 'delete') deleted.add(e.name);
      else {
        added.push({
          name: e.name, model,
          pos: new THREE.Vector3(e.p[0], e.p[1], e.p[2]),
          rot: e.rot,
          matrix: new Float32Array(16),
        });
      }
    }
  }

  const out: AcMarkerRef[] = [];
  for (const m of markers) {
    if (deleted.has(m.name)) continue;
    const mv = moved.get(m.name);
    if (!mv) { out.push(m); continue; }
    out.push({ ...m, pos: new THREE.Vector3(mv.p[0], mv.p[1], mv.p[2]), rot: mv.rot });
  }
  return [...out, ...added];
}

/* ------------------------------------------------------------------ */
/* Loading a whole track                                               */
/* ------------------------------------------------------------------ */

export interface LoadSceneOptions {
  /** Called with a short message and a 0..1 fraction. */
  onProgress?: (message: string, fraction: number) => void;
  /**
   * Which models to keep textures for. Default: all of them.
   *
   * This used to default to the first model only, to save memory, and that was
   * a bad trade dressed up as a good one. Every alpha tested material on the
   * track lives OUTSIDE the main model -- the trees are `ksTree` in
   * obj_trees.kn5, the grandstand fencing and the catch fences are alpha
   * tested in obj_buildings.kn5 -- and a mesh with no texture cannot be seen
   * through. So the whole circuit's vegetation and fencing rendered as solid
   * untextured slabs, which is exactly what it looked like.
   *
   * The bill on the reference track is 256 MB of textures against 83 MB of
   * everything else, and they go to the GPU still compressed.
   */
  textureModels?: ReadonlySet<string>;
  /** Skip models entirely, for the ones the user turned off. */
  skip?: ReadonlySet<string>;
}

export async function loadAcScene(
  slug: string,
  layoutId: string,
  edits: AcImport['edits'],
  opts: LoadSceneOptions = {},
): Promise<AcScene> {
  const report = opts.onProgress ?? (() => {});
  report('reading the track folder', 0);
  const folder = await loadTrackFolder(slug, layoutId);
  const warnings: string[] = [];

  let surfaceKeys = folder.surfaces.map((s) => s.key);
  if (surfaceKeys.length === 0) {
    surfaceKeys = [...STANDARD_SURFACE_KEYS];
    warnings.push(
      'this layout has no surfaces.ini, so the standard AC surface names are assumed',
    );
  }

  const sizeOf = new Map(folder.files.map((f) => [f.path, f.size] as const));
  const wanted = folder.models.filter((m) => !m.dynamic && !opts.skip?.has(m.path));
  const textureModels = opts.textureModels ?? new Set(wanted.map((m) => m.path));

  const models: AcSceneModel[] = [];
  const markers: AcMarkerRef[] = [];
  let bytes = 0;

  for (let i = 0; i < wanted.length; i++) {
    const ref = wanted[i];
    const size = sizeOf.get(ref.path) ?? 0;
    const withTextures = textureModels.has(ref.path);
    const share = (n: number) => (i + n) / (wanted.length + 1);
    report(`loading ${ref.path}`, share(0));

    const loaded = await loadModel(slug, ref, size, {
      textures: withTextures,
      onProgress: (done, total) => {
        if (total > 0) report(`loading ${ref.path}`, share(done / total));
      },
    });
    if (loaded.error) warnings.push(`${ref.path}: ${loaded.error}`);
    // Without textures only the geometry is kept, which on a real track is
    // about a tenth of the file.
    bytes += withTextures ? loaded.size : Math.round(loaded.size * 0.1);

    models.push(buildSceneModel(loaded, {
      surfaceKeys,
      surfaces: folder.surfaces,
      hidden: new Set(edits.hidden[ref.path] ?? []),
      renamed: new Map(Object.entries(edits.renamed[ref.path] ?? {})),
      withTextures,
    }));
    markers.push(...markersOf(loaded));
  }

  /* --- the centre line --------------------------------------------- */
  report('rebuilding the centre line', (wanted.length + 0.5) / (wanted.length + 1));
  let track: RecoveredPath | null = null;
  let trackLane: AiLane | null = null;
  let pit: RecoveredPath | null = null;
  let pitLane: AiLane | null = null;

  if (folder.layout.aiDir) {
    try {
      trackLane = readAiLane(await fetchTrackFile(slug, `${folder.layout.aiDir}/fast_lane.ai`));
      track = recoverPathFromLane(trackLane);
      warnings.push(...track.notes);
    } catch (e) {
      warnings.push(`could not read fast_lane.ai: ${(e as Error).message}`);
    }
    try {
      pitLane = readAiLane(await fetchTrackFile(slug, `${folder.layout.aiDir}/pit_lane.ai`));
      // A pit lane is never a loop, and its file records no widths, so it gets
      // the lane width from the boxes rather than a guess of six metres.
      pit = recoverPathFromLane(pitLane, { fallbackHalfWidth: 4, spacing: 10 });
    } catch {
      // Plenty of tracks have no pit lane AI at all. Not worth a warning.
    }
  } else {
    warnings.push('this layout has no ai folder, so the centre line could not be rebuilt');
  }

  report('ready', 1);
  return { folder, models, markers, track, trackLane, pit, pitLane, bytes, warnings };
}

export function disposeAcScene(scene: AcScene) {
  for (const m of scene.models) disposeSceneModel(m);
  // The pick cache holds geometry belonging to the scene being thrown away.
  clearPickCache();
}

/** Total triangles on screen, for the status line. */
export function sceneTriangles(scene: AcScene): number {
  return scene.models.reduce((a, m) => a + m.triangles, 0);
}

/** Every mesh across every model, for the object browser. */
export function allSceneMeshes(scene: AcScene): AcSceneMesh[] {
  const out: AcSceneMesh[] = [];
  for (const m of scene.models) out.push(...m.meshes);
  return out;
}

export function findMarker(scene: AcScene, name: string): AcMarkerRef | null {
  return scene.markers.find((m) => m.name === name) ?? null;
}

/** Meshes a car can drive on, which is what generated edits are draped onto. */
export function drivableMeshes(scene: AcScene): AcSceneMesh[] {
  const out: AcSceneMesh[] = [];
  for (const model of scene.models) {
    for (const mesh of model.meshes) {
      if (mesh.geometry && isDrivableSurface(mesh.surface, scene.folder.surfaces)) out.push(mesh);
    }
  }
  return out;
}

/**
 * Everything that is GROUND: any mesh AC gives a physics surface to.
 *
 * Wider than `tarmacMeshes` on purpose. A braking board stands on the verge,
 * not on the road, and a probe that only knows about tarmac finds nothing
 * under it -- measured, fourteen of twenty two boards on the reference circuit
 * landed over grass and gravel. Grass and sand are ground too.
 */
export function groundMeshes(scene: AcScene): AcSceneMesh[] {
  const out: AcSceneMesh[] = [];
  for (const model of scene.models) {
    for (const mesh of model.meshes) {
      if (mesh.geometry && mesh.surface !== null) out.push(mesh);
    }
  }
  return out;
}

/** Just the hard racing surface: what a kerb or a painted line sits on. */
export function tarmacMeshes(scene: AcScene): AcSceneMesh[] {
  const out: AcSceneMesh[] = [];
  for (const model of scene.models) {
    for (const mesh of model.meshes) {
      if (mesh.geometry && isTarmacSurface(mesh.surface)) out.push(mesh);
    }
  }
  return out;
}

void walkKn5;
