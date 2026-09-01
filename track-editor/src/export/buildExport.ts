import * as THREE from 'three';
import { zipSync, type Zippable } from 'fflate';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { Project, ProjectImage, PropInstance, SurfaceKey, TerrainSettings } from '../types';
import { bannerQuad, canCarryBanner } from '../core/banner';
import { camerasIni } from '../core/cameras';
import type { Derived } from '../store/derived';
import type { MaterialKey, MeshDef } from '../core/road';
import { isGroundPad, propParts, propTileBox, LIBRARY_BY_KEY } from '../core/library';
import { propMatrix } from '../core/props';
import { sampleHeights, splitByGroups } from '../core/terrain';
import { grass3dBlockers, grass3dFor, grass3dOnGrass, grass3dOnPad } from '../core/grass3d';
import { ALL_MATERIALS, ALPHA_TESTED, EMISSIVE, MATERIAL_COLORS, textureFileName, texturePngBytes, texturePngBytesFlipped } from '../core/textures';
import { assetError, assetIdOf, base64ToArrayBuffer, getAsset } from '../io/assetCache';
import { captureCanvas } from '../io/screenshot';
import { buildFbx, hexToRgb, type FbxMaterialInput, type FbxMeshInput, type FbxNullInput } from './fbx';
import { buildKn5, type Kn5MaterialInput, type Kn5MeshInput, type Kn5NullInput } from './kn5';
import { buildAiFile, estimateLapTimeMs } from './aiLine';
import { extConfigIni, mapIni, START_LIGHTS_LUA, startLightsLua, surfacesIni, uiTrackJson } from './ini';
import { buildMapImage, buildOutlineImage, buildPreviewImage } from './mapImage';
import { BLENDER_SCRIPT, buildReadme, type ReadmeStats } from './readme';
import { FIX_KN5_SCRIPT } from './fixKn5Script';

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

/**
 * Edge length of a merge tile, metres.
 *
 * A single mesh holding every tree on the track would be one draw call, but AC
 * culls per mesh, so it would also be drawn in full while you stare at a wall.
 * Kunos split Magione's trees into 22 meshes for exactly that reason. A few
 * hundred metres is about how far ahead you see on a circuit, so a tile of that
 * order keeps the count low without making the culling useless.
 */
const MERGE_TILE = 250;

/** Tile coordinate as something that survives an AC object name. */
function tileTag(n: number): string {
  return n < 0 ? `m${-n}` : `${n}`;
}

/**
 * Bake every placed prop into world space meshes with AC conform names.
 *
 * Objects are merged by material, surface and locality rather than exported one
 * node per part. Two thousand trees came out as four thousand meshes, and AC
 * pays per mesh: Magione -- a Kunos track with something like five times the
 * vegetation -- is 959 meshes in total, all of its trees living in 31 of them.
 * The editor still holds every object separately; this is purely how they are
 * handed over.
 *
 * The grouping key is exactly what a single kn5 node can carry: one material,
 * one surface (so the invisible physics twin below covers the whole group), one
 * shadow setting. Imported models stay on their own -- there are few of them
 * and their names are the user's, not ours.
 */
/**
 * Bake the automatic 3D grass into world space meshes.
 *
 * The same merge-by-tile scheme the props use, and for the same reason: one
 * mesh per tuft would be tens of thousands of meshes, one mesh for the lot
 * would defeat AC's per-mesh culling. Within a tile the tufts are further
 * chunked so a merged mesh stays under the 16-bit vertex limit the kn5 needs.
 * All of it is scenery: no leading digit, no surface, no shadows -- ankle-high cards
 * casting thirty thousand shadows is a frame budget spent on nothing.
 */
/*
 * Scenery carries NO leading digit, and that is the whole of what keeps it out
 * of the physics.
 *
 * It was all called 1OBJ_, on the theory that a mesh is physical only when its
 * name past the first character matches a surfaces.ini KEY -- which is what
 * this editor's own surfaces.ini says, and which is wrong. The leading digit
 * is what hands a mesh to the physics; the key only says which surface it then
 * is. The grid boxes and the pit limiter line were both caught by this and
 * both fixed; the scenery was not, and the 3D grass made it impossible to miss
 * -- blades of it stand at the very edge of the tarmac, so the first wheel put
 * a hair wide hit them. Trees, fence posts, flag panels and the gantry were
 * all equally solid and simply further from the racing line.
 *
 * See the note on the grid boxes in gridBoxes.ts: across two installed Kunos
 * tracks, every overlay lying on the road starts with a letter and every mesh
 * that starts with a digit is a surface.
 */
export function grass3dMeshes(
  data: Float32Array,
  terrain: TerrainSettings,
  heights: Float32Array,
  props: readonly PropInstance[] = [],
): MeshDef[] {
  const blockers = grass3dBlockers(props, isGroundPad, propTileBox);
  if (data.length === 0) return [];
  const part = propParts('grass_tuft')[0];
  if (!part) return [];

  // Vertices per tuft decide how many fit under 65535 in one merged mesh.
  const perTuft = part.geometry.getAttribute('position').count;
  const chunkMax = Math.max(1, Math.floor(60000 / perTuft));

  const tiles = new Map<string, { tx: number; tz: number; geos: THREE.BufferGeometry[] }>();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < data.length; i += 5) {
    if (!grass3dOnGrass(terrain, data[i], data[i + 1])) continue;
    if (grass3dOnPad(blockers, data[i], data[i + 1])) continue;
    q.setFromAxisAngle(up, data[i + 2]);
    p.set(data[i], sampleHeights(terrain, heights, data[i], data[i + 1]) + data[i + 4], data[i + 1]);
    sc.setScalar(data[i + 3]);
    m.compose(p, q, sc);
    const tx = Math.floor(data[i] / MERGE_TILE);
    const tz = Math.floor(data[i + 1] / MERGE_TILE);
    const key = `${tx}|${tz}`;
    let t = tiles.get(key);
    if (!t) {
      t = { tx, tz, geos: [] };
      tiles.set(key, t);
    }
    t.geos.push(part.geometry.clone().applyMatrix4(m));
  }

  const out: MeshDef[] = [];
  for (const key of [...tiles.keys()].sort()) {
    const t = tiles.get(key)!;
    for (let c = 0; c * chunkMax < t.geos.length; c++) {
      const slice = t.geos.slice(c * chunkMax, (c + 1) * chunkMax);
      const merged = slice.length === 1 ? slice[0] : mergeGeometries(slice, false);
      if (!merged) continue;
      out.push({
        name: `OBJ_grass3d_x${tileTag(t.tx)}_z${tileTag(t.tz)}${c > 0 ? `_${c}` : ''}`,
        material: 'grass_blades',
        surface: null,
        geometry: merged,
        castShadows: false,
      });
    }
    // Let the clones go tile by tile, for the same memory cliff propMeshes
    // steps around above.
    t.geos.length = 0;
  }
  return out;
}

/**
 * Placed imported models that will not make it into the export, and why.
 *
 * `propMeshes` can only bake a model it has in hand. One that failed to parse,
 * or that is still being parsed when the button is pressed, was skipped in
 * silence -- the track came out missing objects that are visible in the
 * palette and sitting in the project file, with nothing anywhere saying so.
 */
export function missingAssetProps(project: Project): string[] {
  const out: string[] = [];
  for (const inst of project.props) {
    const id = assetIdOf(inst.kind);
    if (id === null || getAsset(id)) continue;
    const why = assetError(id) ?? 'still loading';
    out.push(`${inst.name} (${why})`);
  }
  return out;
}

export function propMeshes(project: Project, heights: Float32Array): MeshDef[] {
  const out: MeshDef[] = [];

  interface Group {
    material: MaterialKey;
    surface: SurfaceKey | null;
    castShadows: boolean;
    tx: number;
    tz: number;
    geos: THREE.BufferGeometry[];
  }
  const groups = new Map<string, Group>();

  for (const inst of project.props) {
    const m = propMatrix(inst, project.terrain, heights);
    const safe = inst.name.replace(/[^A-Za-z0-9_]/g, '_');

    const assetId = assetIdOf(inst.kind);
    if (assetId !== null) {
      // Nothing to bake if the model never parsed. That it is missing is said
      // out loud by `missingAssetProps` rather than here, so the caller can put
      // it in front of the user instead of exporting a track with a hole in it.
      const group = getAsset(assetId);
      if (!group) continue;
      group.updateMatrixWorld(true);
      let i = 0;
      group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const geo = mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld);
        geo.applyMatrix4(m);
        if (!geo.getAttribute('uv')) {
          const count = geo.getAttribute('position').count;
          geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
        }
        if (!geo.getAttribute('normal')) geo.computeVertexNormals();
        out.push({ name: `OBJ_${safe}_${i}`, material: 'prop_light', surface: null, geometry: geo });
        i += 1;
      });
      continue;
    }

    const def = LIBRARY_BY_KEY.get(inst.kind);
    const surface = def?.surface ?? null;
    const castShadows = def?.category !== 'Ground';
    const tx = Math.floor(inst.p[0] / MERGE_TILE);
    const tz = Math.floor(inst.p[2] / MERGE_TILE);

    for (const part of propParts(inst.kind)) {
      const geo = part.geometry.clone();
      geo.applyMatrix4(m);
      const key = `${part.material}|${surface ?? ''}|${castShadows ? 1 : 0}|${tx}|${tz}`;
      let g = groups.get(key);
      if (!g) {
        g = { material: part.material, surface, castShadows, tx, tz, geos: [] };
        groups.set(key, g);
      }
      g.geos.push(geo);
    }
  }

  // Sorted, so the same project always exports the same file.
  for (const key of [...groups.keys()].sort()) {
    const g = groups.get(key)!;
    // Props are deliberately NOT exported into the surface namespace
    // (1WALL_..., 1ROAD_...): vanilla AC routes renderable surface-named
    // meshes through its physics bookkeeping, whose culling drops small
    // objects depending on the view direction (grandstands and garages
    // popping in and out). Kunos tracks never render surface-named meshes;
    // their physics meshes are invisible duplicates. So the visible mesh
    // carries the surface in its name without being IN the namespace, and
    // the kn5 writer (or fix_kn5.py on the fallback route) derives the
    // invisible 1<SURFACE>_ collision copy from it.
    const prefix = g.surface ? `1PROP_${g.surface}` : 'OBJ';
    const name = `${prefix}_${g.material}_x${tileTag(g.tx)}_z${tileTag(g.tz)}`;
    const merged = g.geos.length === 1 ? g.geos[0] : mergeGeometries(g.geos, false);
    if (!merged) {
      // Attributes that would not line up. One mesh each is worse but correct,
      // and silently dropping a group would lose objects with no sign of it.
      g.geos.forEach((geo, i) => {
        out.push({ name: `${name}_${i}`, material: g.material, surface: g.surface, geometry: geo, castShadows: g.castShadows });
      });
      continue;
    }
    if (merged !== g.geos[0]) for (const geo of g.geos) geo.dispose();
    /*
     * Let the parts go the moment they have been merged.
     *
     * `dispose()` frees the GPU side, which these clones never had; what holds
     * the memory is this array still pointing at their typed arrays. Held to
     * the end of the loop, an export peaks at every part of every object AND
     * every merged result at once -- on a track with thousands of objects that
     * is where a browser tab runs out of memory and dies mid-export. Dropping
     * the references here means only one group's worth is ever live beside the
     * output.
     */
    g.geos.length = 0;
    out.push({ name, material: g.material, surface: g.surface, geometry: merged, castShadows: g.castShadows });
  }

  return out;
}

/**
 * A geometry carrying only the part of itself that is actually drawn.
 *
 * The road is built into preallocated buffers and published with a DRAW RANGE:
 * `StripBuilder.finish` zeroes the indices it did not use, and a zeroed index
 * triple is a degenerate triangle, not nothing at all. Every exporter here read
 * the whole index buffer, so those faces were shipped -- 6,524 of them on a
 * circuit whose barrier only runs half way round, and the triangle count in the
 * README was overstated by the same amount.
 *
 * Trimmed once here rather than in each of the three writers: the draw range is
 * a convention of the builder, and one place that knows about it is enough. The
 * road geometries are cached and reused between frames, so this never writes
 * into them -- an untrimmed geometry is handed straight back, a trimmed one is
 * a fresh copy that lives only as long as the export.
 */
export function trimToDrawRange(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = geo.getIndex();
  if (!index) return geo;
  const { start, count } = geo.drawRange;
  const drawn = Math.min(index.count - start, count === Infinity ? index.count : count);
  if (start === 0 && drawn === index.count) return geo;

  const idx = new Uint32Array(Math.max(0, drawn));
  let maxVert = -1;
  for (let i = 0; i < idx.length; i++) {
    const v = index.getX(start + i);
    idx[i] = v;
    if (v > maxVert) maxVert = v;
  }
  // Vertices are appended in order, so the used ones are exactly [0, max].
  const keep = maxVert + 1;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = geo.getAttribute(name);
    if (!a) continue;
    const src = a.array as Float32Array;
    out.setAttribute(name, new THREE.BufferAttribute(src.slice(0, keep * a.itemSize), a.itemSize));
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * Name of the invisible physics twin for a visible prop mesh, or null when the
 * mesh needs none. `1PROP_WALL_shed_0` becomes `1WALL_shed_0`, so the surface
 * travels in the visible name and both the kn5 writer and the fallback
 * fix_kn5.py can derive the same twin without extra bookkeeping.
 */
export function physicsNameFor(name: string, surface: SurfaceKey | null): string | null {
  if (!surface) return null;
  const prefix = `1PROP_${surface}_`;
  if (!name.startsWith(prefix)) return null;
  return `1${surface}_${name.slice(prefix.length)}`;
}

/* ------------------------------------------------------------------ */
/* Sponsor banners                                                     */
/* ------------------------------------------------------------------ */

/** File name a banner picture is recorded under in the kn5. */
export function bannerFileName(img: ProjectImage): string {
  const ext = img.mime === 'image/jpeg' ? 'jpg' : img.mime === 'image/webp' ? 'webp' : 'png';
  return `${img.id}.${ext}`;
}

/**
 * The sponsor banners, baked to world space quads -- the same quads the
 * viewport draws (core/banner.ts). Scenery with no digit prefix, so AC gives
 * them no collision: the parapet behind them already carries the wall.
 *
 * Each distinct picture becomes one material named `banner_<imageId>`; the
 * material loops below recognise the prefix and embed the user's own bytes
 * instead of a generated texture.
 */
function bannerMeshes(project: Project, heights: Float32Array): {
  meshes: MeshDef[];
  images: Map<string, ProjectImage>;
} {
  const meshes: MeshDef[] = [];
  const images = new Map<string, ProjectImage>();
  let n = 0;
  for (const inst of project.props) {
    if (!inst.banner || !canCarryBanner(inst.kind)) continue;
    const img = project.images.find((i) => i.id === inst.banner);
    if (!img) continue;
    images.set(img.id, img);
    const m = propMatrix(inst, project.terrain, heights);
    for (const side of [1, -1] as const) {
      const g = bannerQuad(side);
      g.applyMatrix4(m);
      // Rotated by the deck, so the normals turn with it.
      g.computeVertexNormals();
      n += 1;
      meshes.push({
        name: `banner_${n}`,
        material: `banner_${img.id}` as MaterialKey,
        surface: null,
        geometry: g,
      });
    }
  }
  return { meshes, images };
}

/* ------------------------------------------------------------------ */
/* Markers                                                             */
/* ------------------------------------------------------------------ */

const FORWARD_AXIS: Record<Project['exportCfg']['markerForward'], THREE.Vector3> = {
  '+Z': new THREE.Vector3(0, 0, 1),
  '-Z': new THREE.Vector3(0, 0, -1),
  '+X': new THREE.Vector3(1, 0, 0),
  '-X': new THREE.Vector3(-1, 0, 0),
};

/**
 * Our markers are built with local +Z as the driving direction. If the user
 * picks another axis, rotate the marker so that axis ends up pointing forward.
 */
function markerQuat(q: THREE.Quaternion, axis: Project['exportCfg']['markerForward']): THREE.Quaternion {
  const corrected = q.clone();
  if (axis !== '+Z') {
    const fix = new THREE.Quaternion().setFromUnitVectors(FORWARD_AXIS[axis], new THREE.Vector3(0, 0, 1));
    corrected.multiply(fix);
  }
  return corrected;
}

function markerEuler(q: THREE.Quaternion, axis: Project['exportCfg']['markerForward']): [number, number, number] {
  const e = new THREE.Euler().setFromQuaternion(markerQuat(q, axis), 'XYZ');
  return [
    THREE.MathUtils.radToDeg(e.x),
    THREE.MathUtils.radToDeg(e.y),
    THREE.MathUtils.radToDeg(e.z),
  ];
}

/** A flat arrow so a marker is visible and survives any converter. */
function markerGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 0.02, 2.0,
    -0.7, 0.02, -0.9,
    0.7, 0.02, -0.9,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0.5, 1, 0, 0, 1, 0]), 2));
  g.setIndex([0, 1, 2]);
  return g;
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export interface ExportResult {
  zip: Uint8Array;
  fileName: string;
  stats: ReadmeStats;
  warnings: string[];
}

export async function buildExport(project: Project, derived: Derived): Promise<ExportResult> {
  const warnings: string[] = [];
  const slug = (project.meta.slug || 'my_track').replace(/[^a-z0-9_]/gi, '_').toLowerCase();

  /* --- collect geometry ------------------------------------------- */
  const banners = bannerMeshes(project, derived.terrainHeights);

  const meshes: MeshDef[] = [
    ...banners.meshes,
    ...derived.roadMeshes,
    ...derived.pitMeshes,
    // The decorative roads, drivable like everything else: they carry ROAD or
    // CONCRETE surfaces, so surfaces.ini already knows them.
    ...derived.decoMeshes,
    // The paint on the starting grid. Visual only, like the limiter line: it
    // is named out of the physics namespace so AC gives it no collision.
    ...derived.gridMeshes,
    // The bridge over the line. Scenery too: the barrier in front of its legs
    // is what a car can actually reach, so it carries no surface of its own.
    ...derived.gantryMeshes,
    // Painted ground is one geometry with a run of triangles per material in
    // the viewport; here it becomes a mesh per material, because that is how
    // Assetto Corsa is told what a car is driving on.
    ...(derived.terrainDef ? splitByGroups(derived.terrainDef) : []),
    ...propMeshes(project, derived.terrainHeights),
    // The automatic 3D grass, baked exactly as the viewport draws it. No digit,
    // so AC treats it as scenery: grass a car bounces off would be worse than
    // no grass at all.
    ...grass3dMeshes(
      project.terrain.enabled && project.terrain.grass3d && !project.acImport
        ? grass3dFor(
            project.terrain,
            derived.terrainHeights,
            project.road,
            derived.trackFrames,
            project.track.closed,
            derived.profile,
            derived.pitDrawFrames,
            derived.pitApron,
            derived.pitClip,
          )
        : new Float32Array(0),
      // The SHAPE-rendered paint, not the stored one: the viewport filters its
      // tufts against derived.paintTerrain, and an export filtering against
      // project.terrain shipped grass standing on every gravel bed drawn with
      // the shape tool -- clean in the editor, wrong in the game.
      derived.paintTerrain,
      derived.terrainHeights,
      project.props,
    ),
    // Everything below reads plain index buffers, so the draw range the road
    // builder publishes is resolved here, once, for all three writers.
  ].map((m) => ({ ...m, geometry: trimToDrawRange(m.geometry) }));

  if (meshes.length === 0) warnings.push('No geometry to export. Draw a track first.');
  const missing = missingAssetProps(project);
  if (missing.length > 0) {
    warnings.push(
      `${missing.length} imported model${missing.length === 1 ? '' : 's'} could not be built and `
      + `${missing.length === 1 ? 'is' : 'are'} missing from the track: ${missing.join(', ')}.`,
    );
  }
  if (derived.markers.grid.length === 0) warnings.push('No AC_START markers: nobody can start a race.');
  if (derived.markers.pits.length === 0) warnings.push('No AC_PIT markers: AC needs at least one pit box.');
  if (derived.markers.gates.length === 0) warnings.push('No AC_TIME gates: lap timing will not work.');
  if (project.pit.nodes.length < 2) warnings.push('No pit lane drawn, pit_lane.ai will be skipped.');

  let triangles = 0;
  for (const m of meshes) {
    const idx = m.geometry.getIndex();
    triangles += idx ? idx.count / 3 : m.geometry.getAttribute('position').count / 3;
  }

  /* --- materials --------------------------------------------------- */
  const usedMaterials = new Set<MaterialKey>(meshes.map((m) => m.material as MaterialKey));
  const materials: FbxMaterialInput[] = [...usedMaterials].map((key) => {
    const img = key.startsWith('banner_') ? banners.images.get(key.slice(7)) : undefined;
    return {
      name: key,
      color: hexToRgb(MATERIAL_COLORS[key] ?? '#cccccc'),
      texture: project.exportCfg.writeTextures
        ? `textures/${img ? bannerFileName(img) : textureFileName(key)}`
        : undefined,
    };
  });

  /* --- markers ----------------------------------------------------- */
  const markerList = derived.markers.all;
  const nulls: FbxNullInput[] = [];
  const markerMeshes: MeshDef[] = [];
  const arrow = markerGeometry();

  for (const mk of markerList) {
    const rot = markerEuler(mk.quat, project.exportCfg.markerForward);
    if (project.exportCfg.markerAsMesh) {
      const geo = arrow.clone();
      const m = new THREE.Matrix4().compose(mk.pos, mk.quat, new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(m);
      markerMeshes.push({ name: mk.name, material: 'prop_white', surface: null, geometry: geo });
    } else {
      nulls.push({ name: mk.name, pos: [mk.pos.x, mk.pos.y, mk.pos.z], rot });
    }
  }
  if (project.exportCfg.markerAsMesh && !usedMaterials.has('prop_white')) {
    materials.push({
      name: 'prop_white',
      color: hexToRgb(MATERIAL_COLORS.prop_white),
      texture: project.exportCfg.writeTextures ? `textures/${textureFileName('prop_white')}` : undefined,
    });
  }

  /* --- FBX and glTF, only if they were asked for -------------------- */
  /*
   * Both are fallbacks for a route nobody takes any more: the editor writes the
   * .kn5 itself. Building them anyway meant a second and a third complete copy
   * of the track sitting in memory next to the kn5 and the zip that holds all
   * three -- four copies of a circuit with several thousand objects on it. That
   * is what killed the tab with "Out of Memory" halfway through an export.
   *
   * The mesh LIST is still built either way: it is cheap, and the readme's
   * mesh count is quoted from it.
   */
  const fbxMeshes: FbxMeshInput[] = [...meshes, ...markerMeshes].map((m) => ({
    name: m.name,
    geometry: m.geometry,
    material: m.material,
  }));
  const wantSource = project.exportCfg.sourceFiles;
  const fbx = wantSource
    ? buildFbx({ meshes: fbxMeshes, nulls, materials, creator: 'AC Track Editor 1.0' })
    : null;
  const glb = wantSource
    ? await buildGlb(meshes, markerList.map((mk) => ({ name: mk.name, pos: mk.pos, quat: mk.quat })), arrow)
    : null;

  /* --- KN5 (the ready-to-drive model) ------------------------------ */
  // Written directly -- no ksEditor pass needed. Physics for the props
  // follows the Kunos pattern: the visible 1PROP_ mesh stays purely visual
  // and an invisible 1WALL_ duplicate (renderable=0) carries the collision.
  const kn5MaterialKeys = [...usedMaterials];
  const kn5Materials: Kn5MaterialInput[] = [];
  for (const key of kn5MaterialKeys) {
    const img = key.startsWith('banner_') ? banners.images.get(key.slice(7)) : undefined;
    if (img) {
      /* The user's own picture, embedded as-is. The quad's V axis is authored
         upside down (see core/banner.ts), which against unflipped bytes is
         exactly what AC's texture orientation wants -- the same net result as
         the flip every generated texture goes through below. */
      kn5Materials.push({
        name: key,
        textureName: bannerFileName(img),
        textureBytes: new Uint8Array(base64ToArrayBuffer(img.data)),
      });
      continue;
    }
    kn5Materials.push({
      name: key,
      textureName: textureFileName(key),
      // Flipped for the kn5 and ONLY for the kn5: AC samples V=0 at the top
      // row where the viewport samples it at the bottom, so the unflipped
      // bytes stood every tree in the game on its head. The copies in
      // source/ stay as they are -- that route goes through Blender and
      // ksEditor, which apply the old modding pipeline's own conventions.
      textureBytes: await texturePngBytesFlipped(key),
      alphaTested: ALPHA_TESTED.has(key),
      emissive: EMISSIVE.has(key),
    });
  }
  /*
   * The back of a barrier. AC culls back faces, so a single-sided barrier
   * strip simply is not there when seen from the field side -- walk behind
   * the catch fence in the game and the circuit has no fence. The fix is the
   * one every Kunos track uses: a second copy of the geometry with its
   * winding reversed (and its normals turned round, so the far side is lit
   * as a surface and not as a silhouette). The copy is purely visual: its
   * name is kept OUT of the physics namespace so it grows no collision twin
   * of its own -- the front copy already carries the wall.
   */
  const flipped = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
    const c = g.clone();
    const idx = c.getIndex();
    if (idx) {
      for (let t = 0; t + 2 < idx.count; t += 3) {
        const a = idx.getX(t);
        idx.setX(t, idx.getX(t + 2));
        idx.setX(t + 2, a);
      }
      idx.needsUpdate = true;
    }
    const nor = c.getAttribute('normal');
    if (nor) {
      for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
      nor.needsUpdate = true;
    }
    return c;
  };
  const kn5Meshes: Kn5MeshInput[] = [];
  for (const m of meshes) {
    const material = Math.max(0, kn5MaterialKeys.indexOf(m.material as MaterialKey));
    kn5Meshes.push({
      name: m.name,
      geometry: m.geometry,
      material,
      castShadows: m.castShadows,
    });
    if (m.name.startsWith('1WALL_')) {
      kn5Meshes.push({
        name: m.name.replace('1WALL_', 'WALLBACK_'),
        geometry: flipped(m.geometry),
        material,
        castShadows: false,
      });
    }
    // A prop named 1PROP_<SURFACE>_... is visible but has no physics. Give it
    // an invisible twin inside the surface namespace so cars collide with a
    // wall and drive on an asphalt patch, without the visible mesh ever
    // entering AC's physics bookkeeping (see propMeshes for why).
    const physics = physicsNameFor(m.name, m.surface);
    if (physics) {
      kn5Meshes.push({ name: physics, geometry: m.geometry, material, renderable: false });
    }
  }
  const kn5Nulls: Kn5NullInput[] = markerList.map((mk) => ({
    name: mk.name,
    pos: [mk.pos.x, mk.pos.y, mk.pos.z],
    quat: markerQuat(mk.quat, project.exportCfg.markerForward),
  }));
  const kn5 = buildKn5({ rootName: slug, materials: kn5Materials, meshes: kn5Meshes, nulls: kn5Nulls });

  /* --- images ------------------------------------------------------ */
  const closed = project.track.closed;
  const map = await buildMapImage(derived.trackFrames, closed);
  const outline = await buildOutlineImage(derived.trackFrames, closed);
  const preview = await buildPreviewImage(captureCanvas(), derived.trackFrames, closed);

  /* --- AI ---------------------------------------------------------- */
  const fastLane = buildAiFile(derived.ai, { lapTimeMs: estimateLapTimeMs(derived.ai) });
  const pitAi = derived.pitFrames.length >= 3
    ? buildAiFile(
        derived.pitFrames.map((f) => ({
          pos: f.pos,
          fwd: f.fwd,
          normal: f.up,
          sideLeft: f.widthL,
          sideRight: f.widthR,
          radius: 400,
          camber: 0,
          dist: f.dist,
        })),
      )
    : new Uint8Array(0);

  /* --- assemble the zip -------------------------------------------- */
  const enc = new TextEncoder();
  const files: Zippable = {};
  const track = `content/tracks/${slug}/`;

  const avgWidth =
    derived.trackFrames.length > 0
      ? derived.trackFrames.reduce((a, f) => a + f.widthL + f.widthR, 0) / derived.trackFrames.length
      : 12;

  const stats: ReadmeStats = {
    trackLength: derived.trackLength,
    pitLength: derived.pitLength,
    gridSlots: derived.markers.grid.length,
    pitBoxes: derived.markers.pits.length,
    gates: derived.markers.gates.length,
    aiPoints: derived.ai.length,
    meshCount: fbxMeshes.length,
    triangles: Math.round(triangles),
  };

  files['README.txt'] = enc.encode(buildReadme(project, stats));
  if (fbx && glb) {
    files[`source/${slug}.fbx`] = fbx;
    files[`source/${slug}.glb`] = new Uint8Array(glb);
    files['source/blender_to_fbx.py'] = enc.encode(BLENDER_SCRIPT);
    files['source/fix_kn5.py'] = enc.encode(FIX_KN5_SCRIPT);
  }

  if (project.exportCfg.writeTextures && wantSource) {
    for (const key of ALL_MATERIALS) {
      if (!usedMaterials.has(key) && !(project.exportCfg.markerAsMesh && key === 'prop_white')) continue;
      files[`source/textures/${textureFileName(key)}`] = [await texturePngBytes(key), { level: 0 }];
    }
  }

  files[`${track}${slug}.kn5`] = [kn5, { level: 0 }];
  files[`${track}data/surfaces.ini`] = enc.encode(surfacesIni());
  // Only when the author placed cameras: without the file AC falls back to
  // its own generic ones, which beat an empty set.
  if (project.cameras.length > 0) {
    files[`${track}data/cameras.ini`] = enc.encode(
      camerasIni(project.cameras, derived.trackFrames, project.track.closed),
    );
  }
  // Only when something on the track is actually wired to the session. An
  // extension folder on a track that has nothing to extend is a file for the
  // reader to wonder about.
  const flagPanels = usedMaterials.has('led_flag');
  const startLights = usedMaterials.has('led_start');
  if (flagPanels || startLights) {
    files[`${track}extension/ext_config.ini`] = enc.encode(extConfigIni({ flagPanels, startLights }));
  }
  // The countdown itself, which no ini can express. Loaded by a [SCRIPT_...]
  // section of the config above, from beside it.
  if (startLights) {
    files[`${track}extension/${START_LIGHTS_LUA}`] = enc.encode(startLightsLua());
  }
  files[`${track}ui/ui_track.json`] = enc.encode(
    uiTrackJson(project, derived.trackLength, avgWidth, Math.max(1, derived.markers.pits.length)),
  );

  if (map) {
    // map.png at the track root, map.ini one level down in data/ -- not side
    // by side, however much they look like a pair. Every installed track is
    // built that way (magione/map.png + magione/data/map.ini), and a map.ini
    // left at the root is simply never read: the game finds no scaling for the
    // image and the minimap comes out unusable.
    files[`${track}map.png`] = [map.png, { level: 0 }];
    files[`${track}data/map.ini`] = enc.encode(mapIni(map.params));
  }
  if (outline) files[`${track}ui/outline.png`] = [outline, { level: 0 }];
  if (preview) files[`${track}ui/preview.png`] = [preview, { level: 0 }];
  if (fastLane.length > 0) files[`${track}ai/fast_lane.ai`] = fastLane;
  if (pitAi.length > 0) files[`${track}ai/pit_lane.ai`] = pitAi;

  const zip = zipSync(files, { level: 6 });
  arrow.dispose();

  return { zip, fileName: `${slug}_ac_track.zip`, stats, warnings };
}

/* ------------------------------------------------------------------ */
/* GLB                                                                 */
/* ------------------------------------------------------------------ */

async function buildGlb(
  meshes: MeshDef[],
  markers: Array<{ name: string; pos: THREE.Vector3; quat: THREE.Quaternion }>,
  arrow: THREE.BufferGeometry,
): Promise<ArrayBuffer> {
  const scene = new THREE.Scene();
  const matCache = new Map<string, THREE.MeshStandardMaterial>();

  const material = (key: string) => {
    let m = matCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        name: key,
        color: new THREE.Color(MATERIAL_COLORS[key as MaterialKey] ?? '#cccccc'),
        roughness: 0.9,
        metalness: 0,
      });
      matCache.set(key, m);
    }
    return m;
  };

  for (const def of meshes) {
    const mesh = new THREE.Mesh(def.geometry, material(def.material));
    mesh.name = def.name;
    scene.add(mesh);
  }

  // glTF has no null nodes, so markers travel as tiny meshes. The Blender
  // helper script turns them back into empties on the way to FBX.
  const markerMat = material('prop_white');
  for (const mk of markers) {
    const mesh = new THREE.Mesh(arrow, markerMat);
    mesh.name = mk.name;
    mesh.position.copy(mk.pos);
    mesh.quaternion.copy(mk.quat);
    scene.add(mesh);
  }

  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true, onlyVisible: false });
  for (const m of matCache.values()) m.dispose();
  return result as ArrayBuffer;
}

export function downloadBytes(bytes: Uint8Array, fileName: string, mime = 'application/octet-stream') {
  const view = new Uint8Array(bytes);
  const blob = new Blob([view.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
