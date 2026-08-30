import * as THREE from 'three';
import type { Project } from '../types';
import type { Derived } from '../store/derived';
import type { MeshDef, MaterialKey } from '../core/road';
import { ALPHA_TESTED, EMISSIVE, textureFileName, texturePngBytes } from '../core/textures';
import { missingAssetProps, propMeshes, trimToDrawRange, physicsNameFor } from '../export/buildExport';
import { buildKn5, type Kn5MaterialInput, type Kn5MeshInput } from '../export/kn5';
import type { AcScene } from './acScene';
import { groundMeshes, tarmacMeshes } from './acScene';
import { drapeGeometry } from './conform';
import { SurfaceProbe } from './surfaceProbe';

/**
 * Everything this editor adds to an imported track, baked into a model of its
 * own.
 *
 * A separate .kn5, listed in models.ini beside the originals, is the whole
 * safety argument for editing somebody else's circuit: kerbs, painted lines
 * and braking boards CANNOT damage the original geometry, because they are not
 * in the same file as it. Undoing the lot is deleting one file and one ini
 * section.
 *
 * Two things have to be got right for the result to sit on the track rather
 * than near it:
 *
 *   HEIGHT. The centre line is pinned onto the real surface at import (see
 *   conform.ts), which is most of the answer: kerbs generated on it land a
 *   measured 0.037 m from the tarmac on average. What still needs help is
 *   PAINT, which has no thickness and must not z-fight, so lines and coloured
 *   strips are flattened onto the surface afterwards. Kerbs are left alone --
 *   flattening something with a shape of its own destroys it.
 *
 *   SURFACE NAMES. AC decides physics from a mesh's name matching a KEY in the
 *   track's own surfaces.ini, and those keys are the original author's. This
 *   editor calls its kerbs KERB; the reference track calls them CURB and also
 *   has a KERB, while another track may have neither. So our names are
 *   translated into the keys the track being edited actually defines, and
 *   anything with no home becomes plain scenery rather than a surface AC does
 *   not know.
 */

/**
 * A mesh that must not become a physics surface.
 *
 * A painted line is paint. Given a name AC recognises it would become a
 * drivable surface a centimetre above the road, which is a step, and a step
 * across the racing line is exactly the bug this project spent a week on when
 * the pit lane did it. Stripping the leading digit and the key leaves geometry
 * AC draws and never collides with.
 */
function asDecoration(name: string): string {
  return `edit_${name.replace(/^\d+/, '').replace(/^[A-Z]+_/, '')}`;
}

/**
 * Translate one of our surface keys into a key the imported track defines.
 *
 * Falls back through sensible neighbours -- our KERB is their CURB -- and
 * gives up rather than inventing: a name matching no key at all is scenery,
 * which is safe, where a name matching the WRONG key is a gravel trap in the
 * middle of the straight.
 */
export function mapSurfaceKey(ours: string, available: readonly string[]): string | null {
  const has = (k: string) => available.find((a) => a.toUpperCase() === k);
  const chain: Record<string, string[]> = {
    KERB: ['KERB', 'CURB', 'ROAD'],
    ROAD: ['ROAD', 'ASPHALT'],
    PIT: ['PITLANE', 'PIT', 'ROAD'],
    WALL: ['WALL'],
    GRASS: ['GRASS'],
    SAND: ['SAND', 'GRAVEL'],
    CONCRETE: ['CONCRETE', 'ROAD'],
  };
  for (const candidate of chain[ours.toUpperCase()] ?? [ours.toUpperCase()]) {
    const hit = has(candidate);
    if (hit) return hit;
  }
  return null;
}

/** Rename a generated mesh into the imported track's surface namespace. */
function overlayName(def: MeshDef, available: readonly string[]): string {
  if (/^1ROAD_line_/.test(def.name) || /^1ROAD_apron_/.test(def.name)) {
    return asDecoration(def.name);
  }
  if (!def.surface) return asDecoration(def.name);
  const key = mapSurfaceKey(def.surface, available);
  if (!key) return asDecoration(def.name);
  // Prefix matching means `1CURB_edit_left` resolves to CURB, and the `edit_`
  // makes a collision with one of the track's own mesh names impossible.
  return `1${key}_edit_${def.name.replace(/^\d+[A-Z]*_/, '')}`;
}

export interface OverlayStats {
  meshes: number;
  triangles: number;
  /** Vertices that found the imported surface, of those that were draped. */
  draped: number;
  drapeTotal: number;
  /** Objects that were put on the imported ground, of those asking for it. */
  groundedProps: number;
  totalProps: number;
  probeTriangles: number;
  bytes: number;
  warnings: string[];
}

export interface OverlayResult {
  fileName: string;
  bytes: Uint8Array;
  stats: OverlayStats;
}

/**
 * How far above the surface each kind of addition sits.
 *
 * Paint goes as close as the depth buffer allows without flickering; a kerb
 * sits ON the road with its own shape kept.
 */
const LIFT_PAINT = 0.012;

/** Paint: no thickness of its own, so it is flattened onto the surface. */
function isPaint(name: string): boolean {
  return /^1ROAD_(line|apron)_/.test(name);
}

export async function buildOverlayModel(
  project: Project,
  derived: Derived,
  scene: AcScene,
  fileNameBase: string,
): Promise<OverlayResult | null> {
  const warnings: string[] = [];
  const available = scene.folder.surfaces.map((s) => s.key);

  /* --- what is there to add? --------------------------------------- */
  // Already filtered: `derived` holds back the generated road surfaces on an
  // imported track, so the viewport and this build from the same list.
  const roadParts = [...derived.roadMeshes, ...derived.pitMeshes, ...derived.decoMeshes];
  if (roadParts.length === 0 && project.props.length === 0) return null;

  /* --- the surface everything is pinned to -------------------------- */
  const probe = new SurfaceProbe(tarmacMeshes(scene));

  /*
   * Objects are put on the ground BEFORE they are baked, one at a time.
   *
   * `propMeshes` merges objects by material and 250 metre tile, which is what
   * keeps a few thousand trees down to a handful of draw calls. That merging
   * is also why the correction cannot be applied afterwards: a tile holds
   * every braking board within 250 metres of undulating circuit, and shifting
   * that one merged mesh by a single amount left boards up to 0.63 m off the
   * ground on average. So each object is moved first, and the merge then
   * happens on geometry that is already right.
   *
   * `ground` is the object's own "keep me on the terrain" flag. On an imported
   * track there is no editor terrain -- it is switched off, and a flag meaning
   * "follow the ground" pointing at a flat plane at zero is worse than useless:
   * `propPosition` IGNORES the object's own height while it is set. So the
   * height is read off the imported surface and the flag is cleared, which is
   * the only way the number survives as far as the geometry.
   */
  const groundProbe = project.props.length > 0
    ? new SurfaceProbe(groundMeshes(scene))
    : probe;
  let groundedProps = 0;
  const placedProps = groundProbe.triangleCount === 0
    ? project.props
    : project.props.map((inst) => {
        if (!inst.ground) return inst;
        const h = groundProbe.heightAt(inst.p[0], inst.p[2], inst.p[1], 40);
        if (h === null) return { ...inst, ground: false };
        groundedProps += 1;
        return { ...inst, ground: false, p: [inst.p[0], h, inst.p[2]] as [number, number, number] };
      });
  const props = propMeshes({ ...project, props: placedProps }, derived.terrainHeights);
  const missingModels = missingAssetProps(project);
  if (missingModels.length > 0) {
    warnings.push(
      `${missingModels.length} imported model${missingModels.length === 1 ? '' : 's'} could not be `
      + `built and ${missingModels.length === 1 ? 'is' : 'are'} missing from the additions: `
      + missingModels.join(', '),
    );
  }
  if (probe.triangleCount === 0) {
    warnings.push(
      'no tarmac was found in the imported models, so nothing could be draped onto it; '
      + 'the additions keep the heights the editor gave them',
    );
  }

  /* --- geometry ----------------------------------------------------- */
  let draped = 0;
  let drapeTotal = 0;
  const parts: Array<{ name: string; material: MaterialKey; surface: string | null; geometry: THREE.BufferGeometry }> = [];

  for (const def of roadParts) {
    // A fresh copy: the road geometries are cached and reused between frames
    // and must never be written into.
    const geo = trimToDrawRange(def.geometry).clone();
    /*
     * Only the flat things are draped.
     *
     * Paint has no thickness and has to be a hair above the tarmac everywhere,
     * so it is flattened onto the surface. A kerb has a shape of its own and
     * needs no help: because the centre line was conformed to the surface at
     * import, the kerbs the generator produces already sit a measured 0.037 m
     * from the real tarmac on average and 0.15 m at worst. Flattening them
     * would destroy them, and the earlier attempt to flatten-while-keeping-
     * relief lifted the far side of the lap by the track's whole elevation
     * change.
     */
    if (probe.triangleCount > 0 && isPaint(def.name)) {
      const r = drapeGeometry(geo, probe, { lift: LIFT_PAINT });
      draped += r.placed;
      drapeTotal += r.total;
    }
    parts.push({
      name: overlayName(def, available),
      material: def.material as MaterialKey,
      surface: def.surface,
      geometry: geo,
    });
  }

  /*
   * Objects are never draped.
   *
   * A braking board is a solid thing: putting each of its vertices onto the
   * ground individually would fold it flat. It was moved as a whole, above,
   * before anything was merged.
   */
  for (const def of props) {
    // Already on the ground: the objects were moved individually above, which
    // is the only place it can be done correctly once they are merged.
    const geo = trimToDrawRange(def.geometry).clone();
    parts.push({
      name: overlayName(def, available),
      material: def.material as MaterialKey,
      surface: def.surface,
      geometry: geo,
    });
  }

  if (parts.length === 0) return null;

  /* --- materials ---------------------------------------------------- */
  const keys = [...new Set(parts.map((p) => p.material))];
  const materials: Kn5MaterialInput[] = [];
  for (const key of keys) {
    materials.push({
      name: key,
      textureName: textureFileName(key),
      textureBytes: await texturePngBytes(key),
      alphaTested: ALPHA_TESTED.has(key),
      emissive: EMISSIVE.has(key),
    });
  }

  /* --- meshes ------------------------------------------------------- */
  const meshes: Kn5MeshInput[] = [];
  let triangles = 0;
  for (const part of parts) {
    const index = part.geometry.getIndex();
    const tris = index ? index.count / 3 : part.geometry.getAttribute('position').count / 3;
    if (tris < 1) { part.geometry.dispose(); continue; }
    triangles += tris;
    const material = Math.max(0, keys.indexOf(part.material));
    meshes.push({ name: part.name, geometry: part.geometry, material });

    // Visible props stay out of the physics namespace and get an invisible
    // twin instead -- the Kunos pattern, and the fix for vanilla AC's culling
    // bug on renderable surface-named meshes.
    const twin = physicsNameFor(part.name, part.surface as never);
    if (twin) {
      const key = part.surface ? mapSurfaceKey(part.surface, available) : null;
      if (key) {
        meshes.push({
          name: twin.replace(/^1[A-Z]+_/, `1${key}_`),
          geometry: part.geometry,
          material,
          renderable: false,
        });
      }
    }
  }

  if (meshes.length === 0) return null;

  const bytes = buildKn5({
    rootName: `${fileNameBase}_edit`,
    materials,
    meshes,
    // Markers are never put here: an imported track already has its own, and
    // they are edited in place in the model that owns them.
    nulls: [],
  });

  return {
    fileName: `${fileNameBase}_edit.kn5`,
    bytes,
    stats: {
      meshes: meshes.length,
      triangles: Math.round(triangles),
      draped,
      drapeTotal,
      groundedProps,
      totalProps: project.props.length,
      probeTriangles: probe.triangleCount,
      bytes: bytes.length,
      warnings,
    },
  };
}
