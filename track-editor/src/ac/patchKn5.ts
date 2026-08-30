import * as THREE from 'three';
import {
  isIdentityTransform, parsePartKey,
  type AcMarkerEdit, type AcMeshTransform, type AcPieceCopy, type Vec3,
} from '../types';
import { partitionMesh, uvRates } from './meshParts';
import { ribbonBounds, resizeAlongPath } from './ribbon';
import type { Frame } from '../core/spline';
import type { Kn5Dummy, Kn5File, Kn5Mesh, Kn5Node } from './kn5Read';

/**
 * Surgery on a model somebody else built.
 *
 * Everything here works on a file that was read seconds earlier and will be
 * written straight back out, and everything it does NOT touch comes through
 * byte for byte -- that is guaranteed by the reader and writer and proved over
 * a whole installation in tools/verify-kn5io.mjs. So the rule for this file is
 * to change the smallest possible thing:
 *
 *   hiding a mesh   removes exactly that node
 *   renaming one    changes exactly that string
 *   moving a marker rewrites exactly that matrix
 *
 * No re-derivation, no normalising, no tidying up. A modder's 55 materials on
 * eleven different shaders are none of our business.
 */

/* ------------------------------------------------------------------ */
/* Meshes                                                              */
/* ------------------------------------------------------------------ */

export interface MeshPatch {
  /** Mesh names to take out of the model entirely. */
  hidden: ReadonlySet<string>;
  /** Old name -> new name. Renaming is how a physics surface is changed. */
  renamed: ReadonlyMap<string, string>;
}

/**
 * Remove and rename meshes.
 *
 * Hiding removes the node rather than clearing its `visible` byte, and that is
 * deliberate: a mesh in AC's surface namespace is PHYSICS as well as pixels,
 * so a kerb switched off by its visible flag would still be a kerb to drive
 * over. Removing it is the only thing that means what the user asked for.
 * Children of a removed node are kept and handed to its parent, so a mesh that
 * somebody used as a group does not take a wing of the grandstand with it.
 */
export function patchMeshes(file: Kn5File, patch: MeshPatch): { hidden: number; renamed: number } {
  let hidden = 0;
  let renamed = 0;

  const walk = (node: Kn5Node) => {
    const kept: Kn5Node[] = [];
    for (const child of node.children) {
      if (child.kind === 'mesh' && patch.hidden.has(child.name)) {
        hidden += 1;
        // Keep whatever hung off it.
        for (const grandchild of child.children) kept.push(grandchild);
        continue;
      }
      kept.push(child);
    }
    node.children = kept;

    for (const child of node.children) {
      if (child.kind === 'mesh') {
        const next = patch.renamed.get(child.name);
        if (next !== undefined && next !== child.name) {
          child.name = next;
          renamed += 1;
        }
      }
      walk(child);
    }
  };

  walk(file.root);
  return { hidden, renamed };
}

/* ------------------------------------------------------------------ */
/* Moving the track's own meshes                                       */
/* ------------------------------------------------------------------ */

/**
 * World transform of every mesh, from its parent dummies.
 *
 * kn5 meshes carry no transform of their own; they inherit one from the chain
 * of dummies above them. A mesh grouped under a moved node therefore is not
 * where its vertices say it is, and moving it by its vertices needs that
 * chain accounted for.
 */
function meshWorldMatrices(file: Kn5File): Map<Kn5Node, THREE.Matrix4> {
  const out = new Map<Kn5Node, THREE.Matrix4>();
  const walk = (node: Kn5Node, parent: THREE.Matrix4) => {
    let here = parent;
    if (node.kind === 'dummy') {
      here = new THREE.Matrix4().multiplyMatrices(parent, new THREE.Matrix4().fromArray(node.matrix));
    } else {
      out.set(node, parent);
    }
    for (const c of node.children) walk(c, here);
  };
  walk(file.root, new THREE.Matrix4());
  return out;
}

const VERTEX_STRIDE = 44;

/**
 * Bake a move, a turn or a resize into a mesh's vertices.
 *
 * Baked rather than expressed as a new parent dummy, and that is a deliberate
 * choice: a dummy would be smaller and reversible, but it relies on Assetto
 * Corsa applying node transforms to PHYSICS meshes as well as to visible ones,
 * and that is an assumption nobody here can check. Moving the vertices is
 * unambiguous -- the mesh is simply somewhere else.
 *
 * The user drags in world space and the vertices are in the mesh's own space,
 * so the world transform is conjugated by the mesh's inherited matrix. Normals
 * and tangents are rotated too, or a moved barrier would be lit as if it were
 * still facing the other way.
 */
export function transformMeshes(
  file: Kn5File,
  transforms: Readonly<Record<string, AcMeshTransform>>,
  /**
   * The track's cross sections, needed only for edits that resize along the
   * track. Without them such an edit is skipped and reported rather than
   * silently falling back to an axis scale, which is the thing it exists to
   * avoid.
   */
  frames?: readonly Frame[],
): { moved: number; skippedRibbon: number } {
  /*
   * A transform that asks for nothing is skipped entirely, not applied as an
   * identity.
   *
   * `W⁻¹ · I · W` is not exactly the identity in floating point, and every
   * vertex would be rewritten a bit-or-two different -- so "I moved it and put
   * it back" would leave a model that is no longer byte identical to the one
   * it came from. Skipping makes the guarantee structural instead of lucky.
   */
  // Piece keys grouped by the mesh they belong to, identities dropped.
  const byMesh = new Map<string, Array<{ part?: number; t: AcMeshTransform }>>();
  for (const [key, t] of Object.entries(transforms)) {
    if (isIdentityTransform(t)) continue;
    const { mesh, part } = parsePartKey(key);
    const list = byMesh.get(mesh);
    if (list) list.push({ part, t });
    else byMesh.set(mesh, [{ part, t }]);
  }
  if (byMesh.size === 0) return { moved: 0, skippedRibbon: 0 };

  const worlds = meshWorldMatrices(file);
  let moved = 0;
  let skippedRibbon = 0;

  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();

  const walk = (node: Kn5Node) => {
    const jobs = node.kind === 'mesh' ? byMesh.get(node.name) : undefined;
    if (node.kind === 'mesh' && jobs && node.meshType === 2) {
      const world = worlds.get(node) ?? new THREE.Matrix4();
      const inverse = world.clone().invert();

      /*
       * Write into a COPY of the vertex block, never the one the reader handed
       * out.
       *
       * The reader gives zero-copy views into the bytes it was given -- that is
       * what keeps a 116 MB model from being held twice. Transforming in place
       * therefore edits the CALLER'S buffer, and a caller that reads one file
       * and patches it twice gets the second patch applied on top of the first.
       * Which is exactly what happened: a test that moved a mesh and then
       * separately resized the same original found the resize had inherited the
       * move.
       */
      node.vertices = node.vertices.slice();
      const view = new DataView(
        node.vertices.buffer, node.vertices.byteOffset, node.vertices.byteLength,
      );

      /*
       * Which vertices each job moves.
       *
       * A mesh is normally every kerb, barrier segment or tree of its kind at
       * once, so a job usually addresses ONE connected piece of it. The pieces
       * are worked out with exactly the code the editor uses, so the piece
       * numbered 7 here is the one that was numbered 7 on screen.
       */
      const partition = jobs.some((j) => j.part !== undefined) ? partitionMesh(node) : null;

      for (const job of jobs) {
      const t = job.t;
      const piece = job.part !== undefined ? partition?.parts[job.part] : undefined;
      if (job.part !== undefined && !piece) continue;

      /* --- resizing along the track ------------------------------------- */
      if (t.ribbon) {
        if (!frames || frames.length < 2) { skippedRibbon += 1; continue; }
        const indices = piece ? piece.vertices : null;
        const visit = (fn: (i: number) => void) => {
          if (indices) { for (let k = 0; k < indices.length; k++) fn(indices[k]); }
          else { for (let i = 0; i < node.vertexCount; i++) fn(i); }
        };

        node.vertices = node.vertices.slice();
        const rv = new DataView(
          node.vertices.buffer, node.vertices.byteOffset, node.vertices.byteLength,
        );
        const world = worlds.get(node) ?? new THREE.Matrix4();
        const toLocal = world.clone().invert();

        // Measured in world space, where the track coordinates live.
        const points: THREE.Vector3[] = [];
        visit((i) => {
          const o = i * VERTEX_STRIDE;
          points.push(new THREE.Vector3(
            rv.getFloat32(o, true), rv.getFloat32(o + 4, true), rv.getFloat32(o + 8, true),
          ).applyMatrix4(world));
        });
        const bounds = ribbonBounds(frames, points, t.ribbon.edge);
        if (!bounds) { skippedRibbon += 1; continue; }

        const resize = {
          length: t.ribbon.length,
          width: t.ribbon.width,
          height: t.ribbon.height,
          anchor: (t.ribbon.anchor ?? [0.5, 0, 0.5]) as [number, number, number],
          move: [t.p[0], t.p[1], t.p[2]] as [number, number, number],
          edgeSide: t.ribbon.edge,
        };
        const moved3 = new THREE.Vector3();
        let at = 0;
        visit((i) => {
          const o = i * VERTEX_STRIDE;
          const placed = resizeAlongPath(frames, bounds, resize, points[at], moved3);
          at += 1;
          if (!placed) return;
          const local = placed.clone().applyMatrix4(toLocal);
          rv.setFloat32(o, local.x, true);
          rv.setFloat32(o + 4, local.y, true);
          rv.setFloat32(o + 8, local.z, true);
        });

        // The bounding sphere has to cover wherever it went.
        if (node.boundingSphere) {
          const grow = Math.max(t.ribbon.length, t.ribbon.width, t.ribbon.height, 1);
          node.boundingSphere[3] = node.boundingSphere[3] * grow
            + Math.hypot(t.p[0], t.p[1], t.p[2]);
        }
        moved += 1;
        continue;
      }
      // null means every vertex of the mesh.
      const indices = piece ? piece.vertices : null;
      const each = (fn: (i: number) => void) => {
        if (indices) { for (let k = 0; k < indices.length; k++) fn(indices[k]); }
        else { for (let i = 0; i < node.vertexCount; i++) fn(i); }
      };

      // Centre IN WORLD SPACE of whatever is being moved -- the piece if there
      // is one, the whole mesh otherwise. The same anchor the gizmo used.
      const min = new THREE.Vector3(Infinity, Infinity, Infinity);
      const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      each((i) => {
        const o = i * VERTEX_STRIDE;
        pos.set(view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true));
        pos.applyMatrix4(world);
        min.min(pos);
        max.max(pos);
      });
      /*
       * The point this turns and grows about.
       *
       * Its own centre normally. For a piece that was moved as part of a GROUP
       * the transform carries the group's shared centre instead, and using the
       * piece's own would spin it on the spot rather than swinging it round
       * with the others -- the preview and the exported track would then
       * disagree, which is the one thing that must never happen here.
       */
      const centre = t.about
        ? new THREE.Vector3(t.about[0], t.about[1], t.about[2])
        : min.add(max).multiplyScalar(0.5);

      const worldDelta = new THREE.Matrix4()
        .makeTranslation(t.p[0], t.p[1], t.p[2])
        .multiply(new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z))
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(t.r[0]),
          THREE.MathUtils.degToRad(t.r[1]),
          THREE.MathUtils.degToRad(t.r[2]),
          'XYZ',
        )))
        .multiply(new THREE.Matrix4().makeScale(t.s[0], t.s[1], t.s[2]))
        .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));

      const local = inverse.clone().multiply(worldDelta).multiply(world);
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(local);

      /*
       * Keep what is printed on it the same size.
       *
       * Only along axes that actually repeat: a piece using less than one tile
       * is a slice of an atlas, and growing its UVs would drag in the image
       * next door. Measured on a real kerb, the mapping is unambiguous -- 0.97
       * u per metre across and 0.21 v per metre along -- so which UV axis a
       * world axis drives can be read off rather than assumed.
       */
      let uvScale: [number, number] | null = null;
      let uvCentre: [number, number] = [0, 0];
      if (t.keepTexture && (t.s[0] !== 1 || t.s[1] !== 1 || t.s[2] !== 1)) {
        const rates = uvRates(node, undefined, piece?.triangles);
        const su: number[] = [], sv: number[] = [];
        const axisScale = [t.s[0], t.s[1], t.s[2]];
        (['x', 'y', 'z'] as const).forEach((axis, k) => {
          const [du, dv] = rates[axis];
          if (du > dv * 2 && rates.spanU > 1) su.push(axisScale[k]);
          if (dv > du * 2 && rates.spanV > 1) sv.push(axisScale[k]);
        });
        const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 1);
        const s0 = mean(su), s1 = mean(sv);
        if (s0 !== 1 || s1 !== 1) {
          uvScale = [s0, s1];
          // About the piece's own middle, so the pattern stays put there and
          // grows outwards rather than sliding along.
          let u = 0, v = 0, n = 0;
          each((i) => {
            const o = i * VERTEX_STRIDE;
            u += view.getFloat32(o + 24, true);
            v += view.getFloat32(o + 28, true);
            n += 1;
          });
          uvCentre = [u / Math.max(1, n), v / Math.max(1, n)];
        }
      }

      each((i) => {
        const o = i * VERTEX_STRIDE;
        if (uvScale) {
          const u = view.getFloat32(o + 24, true);
          const v = view.getFloat32(o + 28, true);
          view.setFloat32(o + 24, uvCentre[0] + (u - uvCentre[0]) * uvScale[0], true);
          view.setFloat32(o + 28, uvCentre[1] + (v - uvCentre[1]) * uvScale[1], true);
        }
        pos.set(view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true));
        pos.applyMatrix4(local);
        view.setFloat32(o, pos.x, true);
        view.setFloat32(o + 4, pos.y, true);
        view.setFloat32(o + 8, pos.z, true);

        for (const at of [12, 32] as const) {          // normal, then tangent
          dir.set(view.getFloat32(o + at, true), view.getFloat32(o + at + 4, true),
            view.getFloat32(o + at + 8, true));
          dir.applyMatrix3(normalMatrix);
          if (dir.lengthSq() > 1e-12) dir.normalize();
          view.setFloat32(o + at, dir.x, true);
          view.setFloat32(o + at + 4, dir.y, true);
          view.setFloat32(o + at + 8, dir.z, true);
        }
      });
      moved += 1;
      }

      /*
       * Widen the bounding sphere rather than move it.
       *
       * It is what AC culls against, and a piece that moved outside it would
       * vanish whenever the camera looked away from where it used to be. With
       * several pieces of one mesh moving different ways there is no single new
       * centre, so the radius grows to cover the furthest of them.
       */
      if (node.boundingSphere) {
        let reach = 0;
        for (const job of jobs) {
          const span = Math.hypot(job.t.p[0], job.t.p[1], job.t.p[2]);
          const grow = Math.max(Math.abs(job.t.s[0]), Math.abs(job.t.s[1]), Math.abs(job.t.s[2]));
          reach = Math.max(reach, span + node.boundingSphere[3] * Math.max(0, grow - 1));
        }
        node.boundingSphere[3] += reach;
      }
    }
    for (const c of node.children) walk(c);
  };

  walk(file.root);
  return { moved, skippedRibbon };
}

/* ------------------------------------------------------------------ */
/* Copies                                                             */
/* ------------------------------------------------------------------ */

/**
 * Append copies of the track's own pieces as new meshes.
 *
 * This is the honest way to make a kerb longer. Scaling one to twice its length
 * stretches the texture and the ripples with it -- a smeared kerb, not a longer
 * one. Laying down another SECTION keeps the pattern, the profile and the
 * texture scale exactly as they were drawn, which is also how a real one is
 * built.
 *
 * A copy is a new node beside the original, sharing its material, its flags and
 * its parent. The original's own bytes are not touched at all, and the name
 * keeps the source's surface prefix -- AC matches surfaces by prefix, so a copy
 * of `1kerb01` called `1kerb01_copy_c3f` is still a kerb to drive over.
 */
export function appendPieceCopies(
  file: Kn5File,
  copies: readonly AcPieceCopy[],
  frames?: readonly Frame[],
): { added: number; skipped: string[] } {
  const skipped: string[] = [];
  if (copies.length === 0) return { added: 0, skipped };

  const worlds = meshWorldMatrices(file);
  const parents = new Map<Kn5Node, Kn5Node>();
  const walkParents = (node: Kn5Node) => {
    for (const c of node.children) { parents.set(c, node); walkParents(c); }
  };
  walkParents(file.root);

  const byName = new Map<string, Kn5Node>();
  const collect = (node: Kn5Node) => {
    if (node.kind === 'mesh') byName.set(node.name, node);
    for (const c of node.children) collect(c);
  };
  collect(file.root);

  const taken = new Set(byName.keys());
  let added = 0;

  for (const copy of copies) {
    const source = byName.get(copy.mesh);
    if (!source || source.kind !== 'mesh' || source.meshType !== 2) {
      skipped.push(`${copy.mesh}: not a static mesh in this model`);
      continue;
    }
    const world = worlds.get(source) ?? new THREE.Matrix4();
    const partition = copy.part !== undefined ? partitionMesh(source) : null;
    const piece = copy.part !== undefined ? partition?.parts[copy.part] : undefined;
    if (copy.part !== undefined && !piece) {
      skipped.push(`${copy.mesh}: piece ${copy.part} is no longer there`);
      continue;
    }

    // A copy that follows the corner cannot be built without the centre line
    // -- and quietly falling back to a world offset would put it somewhere
    // else than the preview showed. Same rule as transformMeshes.
    if (copy.t.ribbon && (!frames || frames.length < 2)) {
      skipped.push(`${copy.mesh}: follows the corner, and the centre line was not available`);
      continue;
    }

    const built = buildCopyMesh(source, world, piece ?? null, copy.t, frames);
    if (!built) { skipped.push(`${copy.mesh}: nothing to copy`); continue; }

    let name = `${copy.mesh}_copy_${copy.id}`;
    while (taken.has(name)) name += '_';
    taken.add(name);
    built.name = name;

    const parent = parents.get(source) ?? file.root;
    parent.children.push(built);
    added += 1;
  }

  return { added, skipped };
}

/** One copied piece as a standalone mesh node, already transformed. */
function buildCopyMesh(
  source: Kn5Mesh,
  world: THREE.Matrix4,
  piece: { triangles: Int32Array; vertices: Int32Array } | null,
  t: AcMeshTransform,
  frames?: readonly Frame[],
): Kn5Mesh | null {
  const stride = VERTEX_STRIDE;
  const view = new DataView(
    source.vertices.buffer, source.vertices.byteOffset, source.vertices.byteLength,
  );
  const idx = new DataView(
    source.indices.buffer, source.indices.byteOffset, source.indices.byteLength,
  );

  const triangles = piece
    ? Array.from(piece.triangles)
    : Array.from({ length: source.indexCount / 3 }, (_, i) => i);
  if (triangles.length === 0) return null;

  // Re-index: a copy holds only its own vertices, so it stays inside the
  // uint16 limit even when the source mesh is near it.
  const remap = new Map<number, number>();
  const order: number[] = [];
  const indices: number[] = [];
  for (const tri of triangles) {
    for (let k = 0; k < 3; k++) {
      const v = idx.getUint16((tri * 3 + k) * 2, true);
      let local = remap.get(v);
      if (local === undefined) { local = order.length; remap.set(v, local); order.push(v); }
      indices.push(local);
    }
  }
  if (order.length > 65535) return null;

  // Same anchor rule as a move: the group's shared centre if it has one,
  // otherwise the copy's own middle.
  const pos = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const worldPoints: THREE.Vector3[] = [];
  for (const v of order) {
    const o = v * stride;
    pos.set(view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true));
    pos.applyMatrix4(world);
    min.min(pos);
    max.max(pos);
    worldPoints.push(pos.clone());
  }
  const centre = t.about
    ? new THREE.Vector3(t.about[0], t.about[1], t.about[2])
    : min.clone().add(max).multiplyScalar(0.5);

  /*
   * A copy that follows the corner is a ribbon DEFORMATION of the source, the
   * same maths the preview draws with -- so a section laid a bend further on
   * exports exactly where it was shown. Normals are copied unchanged, as the
   * ribbon path in transformMeshes does: a shift along the arc barely turns
   * them, and re-deriving them per vertex is not worth the disagreement.
   */
  const rib = t.ribbon && frames && frames.length > 1
    ? (() => {
        const bounds = ribbonBounds(frames, worldPoints, t.ribbon!.edge);
        if (!bounds) return null;
        return {
          bounds,
          resize: {
            length: t.ribbon!.length, width: t.ribbon!.width, height: t.ribbon!.height,
            anchor: (t.ribbon!.anchor ?? [0.5, 0, 0.5]) as [number, number, number],
            move: [t.p[0], t.p[1], t.p[2]] as [number, number, number],
            edgeSide: t.ribbon!.edge,
          },
        };
      })()
    : null;
  if (t.ribbon && !rib) return null;

  const worldDelta = new THREE.Matrix4()
    .makeTranslation(t.p[0], t.p[1], t.p[2])
    .multiply(new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z))
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(t.r[0]),
      THREE.MathUtils.degToRad(t.r[1]),
      THREE.MathUtils.degToRad(t.r[2]),
      'XYZ',
    )))
    .multiply(new THREE.Matrix4().makeScale(t.s[0], t.s[1], t.s[2]))
    .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
  const local = world.clone().invert().multiply(worldDelta).multiply(world);
  const worldInv = world.clone().invert();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(local);

  const vertices = new Uint8Array(order.length * stride);
  const out = new DataView(vertices.buffer);
  const dir = new THREE.Vector3();
  const placed = new THREE.Vector3();
  const sphereCentre = new THREE.Vector3();

  order.forEach((v, i) => {
    const from = v * stride;
    const to = i * stride;
    vertices.set(source.vertices.subarray(from, from + stride), to);

    if (rib) {
      const moved = resizeAlongPath(frames!, rib.bounds, rib.resize, worldPoints[i], placed);
      pos.copy(moved ?? worldPoints[i]).applyMatrix4(worldInv);
    } else {
      pos.set(out.getFloat32(to, true), out.getFloat32(to + 4, true), out.getFloat32(to + 8, true));
      pos.applyMatrix4(local);
    }
    out.setFloat32(to, pos.x, true);
    out.setFloat32(to + 4, pos.y, true);
    out.setFloat32(to + 8, pos.z, true);
    sphereCentre.add(pos);

    if (!rib) {
      for (const at of [12, 32] as const) {
        dir.set(out.getFloat32(to + at, true), out.getFloat32(to + at + 4, true),
          out.getFloat32(to + at + 8, true));
        dir.applyMatrix3(normalMatrix);
        if (dir.lengthSq() > 1e-12) dir.normalize();
        out.setFloat32(to + at, dir.x, true);
        out.setFloat32(to + at + 4, dir.y, true);
        out.setFloat32(to + at + 8, dir.z, true);
      }
    }
  });
  sphereCentre.multiplyScalar(1 / order.length);

  const indexBytes = new Uint8Array(indices.length * 2);
  const iout = new DataView(indexBytes.buffer);
  indices.forEach((v, i) => iout.setUint16(i * 2, v, true));

  // Its own bounding sphere, or AC culls it against the original's.
  let radius = 0;
  order.forEach((_, i) => {
    const to = i * stride;
    const d = sphereCentre.distanceToSquared(new THREE.Vector3(
      out.getFloat32(to, true), out.getFloat32(to + 4, true), out.getFloat32(to + 8, true),
    ));
    if (d > radius) radius = d;
  });

  return {
    kind: 'mesh',
    name: `${source.name}_copy`,
    active: source.active,
    children: [],
    meshType: 2,
    castShadows: source.castShadows,
    visible: source.visible,
    transparent: source.transparent,
    bones: [],
    vertexCount: order.length,
    vertices,
    indexCount: indices.length,
    indices: indexBytes,
    materialId: source.materialId,
    layer: source.layer,
    lodIn: source.lodIn,
    lodOut: source.lodOut,
    boundingSphere: new Float32Array([
      sphereCentre.x, sphereCentre.y, sphereCentre.z, Math.sqrt(radius) * 1.001,
    ]),
    renderable: source.renderable,
  };
}

/* ------------------------------------------------------------------ */
/* Markers                                                             */
/* ------------------------------------------------------------------ */

/** `AC_TIME_1_L` -> `AC_TIME`, `AC_PIT_12` -> `AC_PIT`. */
export function markerGroup(name: string): string | null {
  const m = /^(AC_[A-Z0-9_]*?)_(\d+)(_[LR])?$/.exec(name);
  return m ? m[1] : null;
}

function markerIndex(name: string): number {
  const m = /^AC_[A-Z0-9_]*?_(\d+)(_[LR])?$/.exec(name);
  return m ? Number(m[1]) : 0;
}

function markerSide(name: string): string {
  const m = /_(L|R)$/.exec(name);
  return m ? `_${m[1]}` : '';
}

/** A dummy's matrix for a position and a heading about Y. */
export function markerMatrix(p: Vec3, rotDeg: number): Float32Array {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(p[0], p[1], p[2]),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, THREE.MathUtils.degToRad(rotDeg), 0),
    ),
    new THREE.Vector3(1, 1, 1),
  );
  // THREE stores elements in the same order the kn5 matrix uses, translation
  // at [12..14], so this is a straight copy.
  return new Float32Array(m.elements);
}

/* ------------------------------------------------------------------ */
/* Planning, across every model of the layout                          */
/* ------------------------------------------------------------------ */

/**
 * Marker numbering is a property of the TRACK, not of a file.
 *
 * This was very nearly a track-destroying bug. AC reads AC_PIT_0 upwards until
 * one is missing, so deleting a box means closing the gap -- but the boxes are
 * regularly SPLIT ACROSS MODELS. Measured over an installation: 612 marker
 * groups in 216 models do not start at zero, because that is how extra pit
 * boxes are shipped. `zfr41pits.kn5` holds AC_PIT_25 to 40 while the main
 * model holds 0 to 24, and the two together are contiguous.
 *
 * Renumbering one file on its own would have turned that model's 25..40 into
 * 0..15, on top of the fifteen boxes already called that. So the plan is made
 * once, from every marker on the track, and each file is then told only what
 * changes in it.
 */
export interface MarkerRef {
  model: string;
  name: string;
}

export interface ModelMarkerPlan {
  deletes: Set<string>;
  moves: Map<string, { p: Vec3; rot: number }>;
  adds: Array<{ name: string; p: Vec3; rot: number }>;
  /** Old name -> new name, from closing the gaps. */
  renames: Map<string, string>;
}

export interface MarkerPlan {
  byModel: Map<string, ModelMarkerPlan>;
  /** Group -> how many markers the track ends up with. */
  counts: Record<string, number>;
  /** Models that need writing only because something in them was renumbered. */
  renumberedOnly: string[];
}

function emptyModelPlan(): ModelMarkerPlan {
  return { deletes: new Set(), moves: new Map(), adds: [], renames: new Map() };
}

export function planMarkerEdits(
  inventory: readonly MarkerRef[],
  edits: Readonly<Record<string, readonly AcMarkerEdit[]>>,
): MarkerPlan {
  const byModel = new Map<string, ModelMarkerPlan>();
  const plan = (model: string) => {
    let p = byModel.get(model);
    if (!p) { p = emptyModelPlan(); byModel.set(model, p); }
    return p;
  };

  const deleted = new Set<string>();
  const added: MarkerRef[] = [];
  for (const [model, list] of Object.entries(edits)) {
    for (const e of list) {
      const p = plan(model);
      if (e.op === 'delete') { p.deletes.add(e.name); deleted.add(e.name); }
      else if (e.op === 'move') p.moves.set(e.name, { p: e.p, rot: e.rot });
      else { p.adds.push({ name: e.name, p: e.p, rot: e.rot }); added.push({ model, name: e.name }); }
    }
  }

  /* --- who is left, across the whole track -------------------------- */
  const live: MarkerRef[] = [
    ...inventory.filter((m) => !deleted.has(m.name)),
    ...added,
  ];

  const groups = new Map<string, MarkerRef[]>();
  for (const m of live) {
    const g = markerGroup(m.name);
    if (!g) continue;
    const list = groups.get(g);
    if (list) list.push(m);
    else groups.set(g, [m]);
  }

  const counts: Record<string, number> = {};
  for (const [group, members] of groups) {
    // By the number they carry. Ties -- a left and a right post of the same
    // gate -- keep their side order so a pair stays a pair.
    members.sort((a, b) => markerIndex(a.name) - markerIndex(b.name)
      || markerSide(a.name).localeCompare(markerSide(b.name)));

    // Gates come in left/right pairs that must keep ONE number between them.
    const slots: MarkerRef[][] = [];
    let currentIndex: number | null = null;
    for (const m of members) {
      const idx = markerIndex(m.name);
      const side = markerSide(m.name);
      if (side !== '' && currentIndex === idx && slots.length > 0) {
        slots[slots.length - 1].push(m);
      } else {
        slots.push([m]);
        currentIndex = idx;
      }
    }

    slots.forEach((slot, i) => {
      for (const m of slot) {
        const next = `${group}_${i}${markerSide(m.name)}`;
        if (next !== m.name) plan(m.model).renames.set(m.name, next);
      }
    });
    counts[group] = slots.length;
  }

  const renumberedOnly: string[] = [];
  for (const [model, p] of byModel) {
    if (p.renames.size > 0 && p.deletes.size === 0 && p.moves.size === 0 && p.adds.length === 0) {
      renumberedOnly.push(model);
    }
  }

  return { byModel, counts, renumberedOnly };
}

interface MarkerSite {
  node: Kn5Dummy;
  parent: Kn5Node;
}

function collectMarkers(file: Kn5File): MarkerSite[] {
  const out: MarkerSite[] = [];
  const walk = (node: Kn5Node) => {
    for (const child of node.children) {
      if (child.kind === 'dummy' && child.name.startsWith('AC_')) {
        out.push({ node: child, parent: node });
      }
      walk(child);
    }
  };
  walk(file.root);
  return out;
}

export interface MarkerPatchResult {
  moved: number;
  deleted: number;
  added: number;
  renamed: number;
}

/**
 * Apply one model's share of a marker plan.
 *
 * The plan comes from `planMarkerEdits`, which sees the whole track. This only
 * carries it out, so it can never renumber a file into another file's numbers.
 *
 * Markers nobody touched keep their original matrix, byte for byte, so a pit
 * box built on a slope keeps the pitch and roll its author gave it. A rename
 * takes the marker's own child meshes with it: every AC_ dummy in the
 * reference track has a twelve triangle plate under it with the same name, and
 * leaving those behind would make the file say two different things about
 * which box is which.
 */
export function patchMarkers(file: Kn5File, plan: ModelMarkerPlan): MarkerPatchResult {
  const result: MarkerPatchResult = { moved: 0, deleted: 0, added: 0, renamed: 0 };
  if (plan.deletes.size === 0 && plan.moves.size === 0
      && plan.adds.length === 0 && plan.renames.size === 0) {
    return result;
  }

  const sites = collectMarkers(file);
  const byName = new Map(sites.map((s) => [s.node.name, s] as const));

  /* --- deletes ------------------------------------------------------ */
  for (const name of plan.deletes) {
    const site = byName.get(name);
    if (!site) continue;
    // The dummy goes and its own visual plate goes with it. Anything else
    // hanging off it -- nothing does in practice -- is handed to its parent
    // rather than silently thrown away.
    const keep = site.node.children.filter((c) => c.name !== name);
    site.parent.children = site.parent.children
      .filter((c) => c !== site.node)
      .concat(keep);
    byName.delete(name);
    result.deleted += 1;
  }

  /* --- moves -------------------------------------------------------- */
  for (const [name, pose] of plan.moves) {
    const site = byName.get(name);
    if (!site) continue;
    // Written into the SAME Float32Array the writer copies bytes out of, so
    // nothing else about the node changes.
    site.node.matrix.set(markerMatrix(pose.p, pose.rot));
    result.moved += 1;
  }

  /* --- adds --------------------------------------------------------- */
  for (const add of plan.adds) {
    const group = markerGroup(add.name);
    const sibling = group
      ? sites.find((s) => markerGroup(s.node.name) === group && !plan.deletes.has(s.node.name))
      : undefined;
    const parent = sibling?.parent ?? file.root;
    const node: Kn5Dummy = {
      kind: 'dummy',
      name: add.name,
      active: 1,
      children: [],
      matrix: markerMatrix(add.p, add.rot),
    };
    parent.children.push(node);
    byName.set(add.name, { node, parent });
    result.added += 1;
  }

  /* --- renames ------------------------------------------------------ */
  // Collected first, then applied, so a rename chain (5 -> 4 while 6 -> 5)
  // cannot rename the same node twice.
  const pending: Array<{ node: Kn5Node; to: string }> = [];
  for (const [from, to] of plan.renames) {
    const site = byName.get(from);
    if (!site) continue;
    pending.push({ node: site.node, to });
    for (const child of site.node.children) {
      if (child.name === from) pending.push({ node: child, to });
    }
  }
  for (const { node, to } of pending) {
    node.name = to;
    result.renamed += 1;
  }

  return result;
}

/** Every AC_* marker name currently in a model, in file order. */
export function markerNames(file: Kn5File): string[] {
  return collectMarkers(file).map((s) => s.node.name);
}
