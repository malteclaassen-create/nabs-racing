import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEditor } from '../store/store';
import {
  acPieceWorldPoints, applyMarkerEdits, meshPartition, pickAcMesh, rawMeshOf, sceneMeshGeometry,
  type AcMarkerRef, type AcScene, type AcSceneMesh, type AcSceneModel,
} from '../ac/acScene';
import { isSplittable, partGeometry } from '../ac/meshParts';
import {
  placeRibbonPoint, projectPoints, ribbonBounds, ribbonSideOf, ribbonSpanOf, toRibbon, trimSpan,
  type RibbonBounds, type RibbonResize,
} from '../ac/ribbon';
import { useDerived } from '../store/derived';
import { markerGroup } from '../ac/patchKn5';
import { parsePartKey, partKey, type AcMeshRef, type AcMeshTransform } from '../types';

/**
 * The imported Assetto Corsa track, on screen.
 *
 * Two very different things, drawn together:
 *
 *   THE GEOMETRY is somebody else's finished circuit. It is not editable by
 *   dragging, it is enormous, and it never changes while the camera moves --
 *   so it is drawn as plainly as possible: the merged-by-material groups the
 *   scene loader already built, mounted once, with no per frame React work and
 *   no raycasting. Around a hundred and fifty draw calls for a whole track.
 *
 *   THE MARKERS are the pit boxes, grid slots and timing gates, and those the
 *   user does drag. There can be three hundred and fifty of them, so they are
 *   one instanced mesh per family with instance picking, the same shape the
 *   rest of this editor uses for anything numerous and clickable.
 */

/** Colours per marker family, matching the ones the editor's own markers use. */
const MARKER_COLOURS: Record<string, string> = {
  AC_PIT: '#ffb02e',
  AC_START: '#4dd07a',
  AC_TIME: '#5aa9ff',
  AC_HOTLAP_START: '#a06bff',
  AC_AB_START: '#a06bff',
  AC_AB_FINISH: '#a06bff',
};

const DEFAULT_COLOUR = '#c9d2e0';

/** A car sized slot, so a pit box reads as somewhere a car goes. */
const SLOT = new THREE.PlaneGeometry(2.0, 4.6).rotateX(-Math.PI / 2);
/** A nose marker, so which way it faces is visible at a glance. */
const NOSE = new THREE.ConeGeometry(0.45, 1.1, 3).rotateX(Math.PI / 2);

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

function AcModels({ scene, wireframe }: { scene: AcScene; wireframe: boolean }) {
  const transforms = useEditor((s) => s.project.acImport?.edits.transforms);
  const selection = useEditor((s) => s.selection);
  const marked = useEditor((s) => s.acMarked);

  useEffect(() => {
    // Materials are owned by the scene, which disposes them when the import is
    // closed or reloaded; only the wireframe flag is ours to set.
    for (const model of scene.models) {
      for (const g of model.groups) {
        (g.material as THREE.MeshLambertMaterial).wireframe = wireframe;
      }
      for (const l of model.loose) {
        (l.material as THREE.MeshLambertMaterial).wireframe = wireframe;
      }
    }
  }, [scene, wireframe]);

  /*
   * Everything picked is outlined, not just the last one clicked.
   *
   * This was reported as "shift-click does not work, I can still only select
   * one thing" -- and the picking was fine all along. What was wrong is that
   * only the newest member was highlighted, so adding a second piece looked
   * exactly like replacing the first.
   */
  const selectedName = selection?.kind === 'acMesh' ? selection.name : null;
  const selectedPart = selection?.kind === 'acMesh' ? selection.part : undefined;
  const markedByMesh = useMemo(() => {
    const map = new Map<string, AcMeshRef[]>();
    for (const ref of marked) {
      const key = `${ref.model}#${ref.name}`;
      const list = map.get(key);
      if (list) list.push(ref);
      else map.set(key, [ref]);
    }
    // The one the panel is talking about counts as picked too, so a single
    // click still highlights before anything has been added to a group.
    if (selectedName && selection?.kind === 'acMesh') {
      const key = `${selection.model}#${selectedName}`;
      if (!map.has(key)) map.set(key, [{ model: selection.model, name: selectedName, part: selectedPart }]);
    }
    return map;
  }, [marked, selection, selectedName, selectedPart]);

  return (
    <group>
      {scene.models.map((model) => (
        <group key={model.path}>
          {model.groups.map((g, i) => (
            <mesh
              key={`g${i}`}
              geometry={g.geometry}
              material={g.material}
              // Nothing here is clickable through R3F. An imported circuit is a
              // million triangles, and a pointer handler on it would raycast
              // all of them on every mouse move -- the exact cost that had to
              // be taken off the props. Clicks are resolved against the per
              // mesh bounding boxes instead, on the click. See AcPicker.
              raycast={NO_RAYCAST}
              frustumCulled
            />
          ))}
          <ModelCopies model={model} />
          {model.loose.map((l) => (
            <LooseMesh
              key={`l${l.mesh.name}`}
              model={model}
              entry={l}
              moves={transforms?.[model.path]}
              marked={markedByMesh.get(`${model.path}#${l.mesh.name}`) ?? EMPTY_REFS}
            />
          ))}
        </group>
      ))}
    </group>
  );
}

/**
 * One of the track's own meshes, drawn on its own so its PIECES can be moved.
 *
 * The mesh is split into the connected things it really is (see meshParts.ts),
 * and each piece that has been moved is drawn with its own offset while the
 * rest stays put. Splitting once here rather than in the scene loader keeps it
 * off the import path -- a mesh is only ever split when somebody clicks it.
 */
function LooseMesh({
  model,
  entry,
  moves,
  marked,
}: {
  model: AcSceneModel;
  entry: { mesh: AcSceneMesh; geometry: THREE.BufferGeometry; material: THREE.Material };
  moves?: Record<string, AcMeshTransform>;
  /** Which pieces of THIS mesh are currently picked. */
  marked: readonly AcMeshRef[];
}) {
  const name = entry.mesh.name;
  const wholeMarked = marked.some((r) => r.part === undefined);

  // Every piece of this mesh that has a transform on it or is picked. Both,
  // because a picked piece has to be drawn separately to be outlined, and a
  // moved one has to be drawn separately to be somewhere else.
  const movedParts = useMemo(() => {
    const out = new Set<number>();
    for (const key of Object.keys(moves ?? {})) {
      const parsed = parsePartKey(key);
      if (parsed.mesh === name && parsed.part !== undefined) out.add(parsed.part);
    }
    for (const ref of marked) if (ref.part !== undefined) out.add(ref.part);
    return [...out].sort((a, b) => a - b);
  }, [moves, name, marked]);
  const markedParts = useMemo(
    () => new Set(marked.filter((r) => r.part !== undefined).map((r) => r.part as number)),
    [marked],
  );

  const split = useMemo(() => {
    if (movedParts.length === 0) return null;
    const partition = meshPartition(model, name);
    const raw = rawMeshOf(model, name);
    if (!partition || !raw || !isSplittable(partition)) return null;
    const wanted = new Set(movedParts);
    const rest: number[] = [];
    for (let t = 0; t < partition.ofTriangle.length; t++) {
      if (!wanted.has(partition.ofTriangle[t])) rest.push(t);
    }
    const empty = { triangles: new Int32Array(0), vertices: new Int32Array(0), box: new THREE.Box3() };
    return {
      pieces: movedParts.map((id) => ({
        id,
        geometry: partGeometry(raw, partition.parts[id]).applyMatrix4(entry.mesh.matrix),
        centre: partition.parts[id].box.clone().applyMatrix4(entry.mesh.matrix).getCenter(new THREE.Vector3()),
      })),
      rest: partGeometry(raw, { ...empty, triangles: Int32Array.from(rest) })
        .applyMatrix4(entry.mesh.matrix),
    };
  }, [model, name, movedParts, entry.mesh.matrix]);

  useEffect(() => () => {
    if (!split) return;
    for (const p of split.pieces) p.geometry.dispose();
    split.rest.dispose();
  }, [split]);

  const transformOf = (part?: number): AcMeshTransform =>
    moves?.[partKey(name, part)] ?? { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };

  // Not split: the whole mesh moves as one.
  if (!split) {
    return (
      <Placed
        geometry={entry.geometry}
        material={entry.material}
        centre={entry.mesh.box.getCenter(new THREE.Vector3())}
        t={transformOf(undefined)}
        outline={wholeMarked}
      />
    );
  }

  return (
    <group>
      <mesh geometry={split.rest} material={entry.material} raycast={NO_RAYCAST} />
      {split.pieces.map((p) => (
        <Placed
          key={p.id}
          geometry={p.geometry}
          material={entry.material}
          centre={p.centre}
          t={transformOf(p.id)}
          outline={markedParts.has(p.id)}
        />
      ))}
    </group>
  );
}

/**
 * The copies laid down in one model.
 *
 * Drawn from the source piece's geometry with the copy's own offset, so a
 * duplicated kerb section keeps the original's texture and profile exactly --
 * which is the point of copying rather than stretching.
 */
function ModelCopies({ model }: { model: AcSceneModel }) {
  const copies = useEditor((s) => s.project.acImport?.edits.copies[model.path]);
  const selection = useEditor((s) => s.selection);

  const built = useMemo(() => {
    if (!copies || copies.length === 0) return [];
    const out: Array<{ id: string; geometry: THREE.BufferGeometry; material: THREE.Material;
      centre: THREE.Vector3; t: AcMeshTransform }> = [];
    for (const c of copies) {
      const mesh = model.meshes.find((m) => m.name === c.mesh);
      const raw = rawMeshOf(model, c.mesh);
      if (!mesh || !raw) continue;
      const material = model.groups.find((g) => g.name === mesh.materialName)?.material
        ?? model.loose.find((l) => l.mesh.name === c.mesh)?.material;
      if (!material) continue;
      let geometry: THREE.BufferGeometry;
      let centre: THREE.Vector3;
      if (c.part !== undefined) {
        const partition = meshPartition(model, c.mesh);
        const piece = partition?.parts[c.part];
        if (!piece) continue;
        geometry = partGeometry(raw, piece).applyMatrix4(mesh.matrix);
        centre = piece.box.clone().applyMatrix4(mesh.matrix).getCenter(new THREE.Vector3());
      } else {
        const whole = sceneMeshGeometry(model, c.mesh);
        if (!whole) continue;
        geometry = whole;
        centre = mesh.box.getCenter(new THREE.Vector3());
      }
      out.push({ id: c.id, geometry, material, centre, t: c.t });
    }
    return out;
  }, [copies, model]);

  useEffect(() => () => { for (const b of built) b.geometry.dispose(); }, [built]);
  if (built.length === 0) return null;

  return (
    <group>
      {built.map((b) => (
        <Placed
          key={b.id}
          geometry={b.geometry}
          material={b.material}
          centre={b.centre}
          t={b.t}
          outline={selection?.kind === 'acCopy' && selection.id === b.id}
        />
      ))}
    </group>
  );
}

/**
 * Geometry with an offset applied about a given centre.
 *
 * The three nested groups are the anchor: shift to the centre, turn and scale
 * there, shift back, then move. That is what makes a kerb made taller grow
 * upward from where it is instead of sliding away.
 */
function Placed({
  geometry,
  material,
  centre,
  t,
  outline,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  centre: THREE.Vector3;
  t: AcMeshTransform;
  outline: boolean;
}) {
  const frames = useDerived().trackFrames;

  /*
   * Resizing along the track is a DEFORMATION, not a transform.
   *
   * Every vertex moves a different way -- that is the whole point, it is what
   * keeps a kerb on its corner -- so it cannot be expressed as a position and a
   * scale on a group. The geometry is rebuilt instead.
   *
   * In two steps, because the end grips drag this every frame: the projection
   * into track coordinates (every vertex against every segment) never changes
   * while a handle moves, so it is computed once per geometry, and the drag
   * re-evaluates only the cheap half.
   */
  const wantRibbon = !!t.ribbon && frames.length >= 2;
  const edge = t.ribbon?.edge;
  const proj = useMemo(() => {
    if (!wantRibbon) return null;
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
      points.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
    return projectPoints(frames, points, edge);
  }, [geometry, frames, wantRibbon, edge]);

  const shaped = useMemo(() => {
    if (!t.ribbon || !proj) return null;
    const g = geometry.clone();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const resize = {
      length: t.ribbon.length, width: t.ribbon.width, height: t.ribbon.height,
      anchor: (t.ribbon.anchor ?? [0.5, 0, 0.5]) as [number, number, number],
      move: [t.p[0], t.p[1], t.p[2]] as [number, number, number],
      edgeSide: t.ribbon.edge,
    };
    const out = new THREE.Vector3();
    for (let i = 0; i < proj.coords.length; i++) {
      const placed = placeRibbonPoint(frames, proj.bounds, resize, proj.coords[i], out);
      if (placed) pos.setXYZ(i, placed.x, placed.y, placed.z);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }, [geometry, t, frames, proj]);

  useEffect(() => () => { shaped?.dispose(); }, [shaped]);

  if (shaped) {
    // Already in world space: the deformation put it exactly where it goes.
    return (
      <group>
        <mesh geometry={shaped} material={material} raycast={NO_RAYCAST} />
        {outline && (
          <mesh geometry={shaped} raycast={NO_RAYCAST}>
            <meshBasicMaterial color="#f4afc6" wireframe transparent opacity={0.6} depthTest={false} />
          </mesh>
        )}
      </group>
    );
  }

  // A group move carries the group's shared centre; on its own, a piece turns
  // about itself. One rule, and it is the same one the exporter applies.
  const pivot = t.about ? new THREE.Vector3(t.about[0], t.about[1], t.about[2]) : centre;
  return (
    <group position={[t.p[0], t.p[1], t.p[2]]}>
      <group position={pivot}>
        <group
          rotation={[
            THREE.MathUtils.degToRad(t.r[0]),
            THREE.MathUtils.degToRad(t.r[1]),
            THREE.MathUtils.degToRad(t.r[2]),
          ]}
          scale={[t.s[0], t.s[1], t.s[2]]}
        >
          <group position={pivot.clone().negate()}>
            <mesh geometry={geometry} material={material} raycast={NO_RAYCAST} />
            {outline && (
              <mesh geometry={geometry} raycast={NO_RAYCAST}>
                <meshBasicMaterial color="#f4afc6" wireframe transparent opacity={0.6} depthTest={false} />
              </mesh>
            )}
          </group>
        </group>
      </group>
    </group>
  );
}

/**
 * Clicking one of the track's own meshes.
 *
 * A single invisible plane would not do -- the click has to hit whatever is
 * under the cursor in a scene of a million triangles. So the ray is tested
 * against the per mesh bounding boxes, which are already kept for the object
 * list, and only when the pointer actually goes down.
 */
function AcPicker({ scene }: { scene: AcScene }) {
  const { camera, gl } = useThree();
  const tool = useEditor((s) => s.tool);
  const edits = useEditor((s) => s.project.acImport?.edits);
  // For pieces resized along the track: their deformation needs the centre
  // line, or they would be picked where they USED to be.
  const frames = useDerived().trackFrames;

  useEffect(() => {
    if (tool !== 'select') return;
    const canvas = gl.domElement;
    const ray = new THREE.Raycaster();
    const point = new THREE.Vector2();
    let downAt: { x: number; y: number } | null = null;

    const onDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      // A drag is the camera or a marquee, not a pick.
      if (moved > 4 || e.button !== 0) return;
      // Something nearer already took it -- a marker, a control point, a prop.
      if (useEditor.getState().selection?.kind === 'acMarker') return;
      // A handle drag in progress (the ribbon grips set `interacting` on the
      // press) must not end with the click re-picking whatever is under it.
      if (useEditor.getState().interacting) return;

      const rect = canvas.getBoundingClientRect();
      point.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      point.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(point, camera);
      /*
       * Told where everything IS, not where it started.
       *
       * Without the transforms an object that had been moved stopped existing
       * for the mouse: unclickable at its new place and still clickable at the
       * old one. The copies are in here for the same reason -- they were not
       * candidates at all before.
       */
      const hit = pickAcMesh(scene, ray.ray, {
        hidden: edits?.hidden,
        transforms: edits?.transforms,
        copies: edits?.copies,
        frames,
      });
      // Shift or Ctrl adds to the group; a plain click starts a new one.
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (hit?.copyId) {
        // A copy the user laid down has its own kind of selection.
        useEditor.getState().clearAcMarks();
        useEditor.getState().select({ kind: 'acCopy', model: hit.mesh.model, id: hit.copyId });
      } else if (hit) {
        useEditor.getState().markAcMesh(
          { model: hit.mesh.model, name: hit.mesh.name, part: hit.part },
          add,
        );
      } else if (!add) {
        useEditor.getState().clearAcMarks();
        useEditor.getState().select(null);
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [scene, camera, gl, tool, edits, frames]);

  return null;
}

/** An explicit no-op, never `undefined`: see the note in PropsLayer. */
const NO_RAYCAST: THREE.Object3D['raycast'] = () => null;

/** Shared empty list, so an unpicked mesh does not get a new array each render. */
const EMPTY_REFS: readonly AcMeshRef[] = [];

/* ------------------------------------------------------------------ */
/* Markers                                                             */
/* ------------------------------------------------------------------ */

function MarkerFamily({
  markers,
  colour,
  geometry,
  lift,
  selected,
  onPick,
}: {
  markers: AcMarkerRef[];
  colour: string;
  geometry: THREE.BufferGeometry;
  lift: number;
  selected: string | null;
  onPick?: (m: AcMarkerRef) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    markers.forEach((mk, i) => {
      p.set(mk.pos.x, mk.pos.y + lift, mk.pos.z);
      q.setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(mk.rot), 0));
      m.compose(p, q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = markers.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [markers, lift]);

  if (markers.length === 0) return null;

  return (
    <>
      <instancedMesh
        ref={ref}
        args={[geometry, undefined, Math.max(1, markers.length)]}
        frustumCulled={false}
        onPointerDown={
          onPick
            ? (e) => {
                if (e.instanceId === undefined) return;
                e.stopPropagation();
                onPick(markers[e.instanceId]);
              }
            : undefined
        }
      >
        <meshBasicMaterial
          color={colour}
          transparent
          opacity={0.55}
          depthTest={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      {selected !== null && (() => {
        const hit = markers.find((m) => m.name === selected);
        if (!hit) return null;
        return (
          <mesh
            geometry={geometry}
            position={[hit.pos.x, hit.pos.y + lift + 0.02, hit.pos.z]}
            rotation={[0, THREE.MathUtils.degToRad(hit.rot), 0]}
            raycast={NO_RAYCAST}
          >
            <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthTest={false} side={THREE.DoubleSide} />
          </mesh>
        );
      })()}
    </>
  );
}

function AcMarkers({ scene }: { scene: AcScene }) {
  const edits = useEditor((s) => s.project.acImport?.edits.markers);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const tool = useEditor((s) => s.tool);

  const families = useMemo(() => {
    const live = applyMarkerEdits(scene.markers, edits ?? {});
    const byGroup = new Map<string, AcMarkerRef[]>();
    for (const m of live) {
      const g = markerGroup(m.name) ?? m.name;
      const list = byGroup.get(g);
      if (list) list.push(m);
      else byGroup.set(g, [m]);
    }
    return [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [scene.markers, edits]);

  const selectedName = selection?.kind === 'acMarker' ? selection.name : null;
  // Only the select tool picks them up, so painting or placing over a pit box
  // does not get swallowed by it.
  const pickable = tool === 'select';

  return (
    <group>
      {families.map(([group, markers]) => (
        <group key={group}>
          <MarkerFamily
            markers={markers}
            colour={MARKER_COLOURS[group] ?? DEFAULT_COLOUR}
            geometry={SLOT}
            lift={0.06}
            selected={selectedName}
            onPick={
              pickable
                ? (m) => select({ kind: 'acMarker', name: m.name, model: m.model })
                : undefined
            }
          />
          <MarkerFamily
            markers={markers}
            colour="#ffffff"
            geometry={NOSE}
            lift={0.12}
            selected={null}
          />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The recovered centre line                                           */
/* ------------------------------------------------------------------ */

function RecoveredLine({ scene }: { scene: AcScene }) {
  const geometry = useMemo(() => {
    const lane = scene.trackLane;
    if (!lane || lane.points.length < 2) return null;
    const g = new THREE.BufferGeometry();
    const pts = new Float32Array(lane.points.length * 3);
    lane.points.forEach((p, i) => {
      pts[i * 3] = p.pos[0];
      pts[i * 3 + 1] = p.pos[1] + 0.08;
      pts[i * 3 + 2] = p.pos[2];
    });
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    return g;
  }, [scene.trackLane]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;

  return (
    <line>
      <primitive object={geometry} attach="geometry" />
      <lineBasicMaterial color="#f4afc6" transparent opacity={0.55} depthTest={false} />
    </line>
  );
}

/* ------------------------------------------------------------------ */
/* Handles for pieces that follow the corner                           */
/* ------------------------------------------------------------------ */

/** Shortest stretch of arc a trim may leave behind, metres. */
const RIBBON_MIN_LENGTH = 0.5;
/** Grips only make sense on something that actually runs along the track. */
const RIBBON_MIN_EXTENT = 1.0;

const UP = new THREE.Vector3(0, 1, 0);
const HANDLE_BOX = new THREE.BoxGeometry(1, 1, 1);

interface RibbonDrag {
  mode: 'slide' | 'trimFrom' | 'trimTo';
  /** The transform as it was when the handle was grabbed. */
  t0: AcMeshTransform;
  bounds: RibbonBounds;
  /** The datum the bounds were projected with -- every read must match it. */
  edgeSide: -1 | 1 | undefined;
  write: (t: AcMeshTransform) => void;
  /** Arc length / lateral under the pointer at the grab. */
  grabS: number;
  grabLat: number;
  planeY: number;
  /** Shift at the press: the drag slides sideways instead of along. */
  lateral: boolean;
  moved: boolean;
  /**
   * Alt at the press on a grip: do not stretch, FILL the dragged distance
   * with seamless copies instead. Stretching a stitched kerb walks it off the
   * hole the modder cut for it in the ground; a copy lands on intact ground
   * and the original never moves.
   */
  copies: boolean;
  copyCount: number;
  ref: { model: string; name: string; part?: number };
  /** How much arc the piece covers right now -- the length of one copy. */
  covered: number;
}

function resizeOf(t: AcMeshTransform): RibbonResize {
  return {
    length: t.ribbon!.length, width: t.ribbon!.width, height: t.ribbon!.height,
    anchor: (t.ribbon!.anchor ?? [0.5, 0, 0.5]) as [number, number, number],
    move: [t.p[0], t.p[1], t.p[2]],
    edgeSide: t.ribbon!.edge,
  };
}

/**
 * Direct manipulation for a piece resized along the track.
 *
 * The whole "follow the corner" machinery was only reachable through three
 * number fields, which is no way to steer a kerb round a bend. This puts the
 * same interaction on it that the editor's own kerbs already have: a bar along
 * the piece to drag it along the lap (Shift slides it sideways instead), and a
 * grip at either end to cover more or less of the corner. The numbers written
 * are exactly the ones the panel edits -- `ribbon.length` and the move -- so
 * panel, viewport, picker and exporter all keep telling the same story.
 */
function RibbonHandles() {
  const selection = useEditor((s) => s.selection);
  const marked = useEditor((s) => s.acMarked);
  const scene = useEditor((s) => s.acScene);
  const transforms = useEditor((s) => s.project.acImport?.edits.transforms);
  const copies = useEditor((s) => s.project.acImport?.edits.copies);
  const frames = useDerived().trackFrames;
  const { camera, gl } = useThree();

  const barRef = useRef<THREE.InstancedMesh>(null);
  const gripRef = useRef<THREE.InstancedMesh>(null);
  const drag = useRef<RibbonDrag | null>(null);

  const barMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#f4afc6', transparent: true, opacity: 0.4, depthTest: false }),
    [],
  );
  const gripMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#f4f1e6', transparent: true, opacity: 0.9, depthTest: false }),
    [],
  );
  useEffect(() => () => { barMaterial.dispose(); gripMaterial.dispose(); }, [barMaterial, gripMaterial]);

  /** What is selected and what transform it already carries, if any. */
  const picked = useMemo(() => {
    if (!scene || frames.length < 2) return null;
    if (selection?.kind === 'acMesh' && marked.length <= 1) {
      const key = partKey(selection.name, selection.part);
      const stored = transforms?.[selection.model]?.[key];
      const model = scene.models.find((m) => m.path === selection.model);
      const mesh = model?.meshes.find((m) => m.name === selection.name);
      if (!mesh) return null;
      /*
       * A kerb gets its handles the moment it is selected, before any edit
       * exists: the implied transform is the identity, and the first drag is
       * what writes it. Only for UNTOUCHED pieces -- something already moved
       * in world space has a `p` that means world metres, and reinterpreting
       * that as track coordinates would teleport it.
       */
      const implicit = !stored && mesh.surface === 'KERB';
      if (!stored?.ribbon && !implicit) return null;
      return {
        model: selection.model, name: selection.name, part: selection.part,
        stored: stored ?? null,
        implicit: !stored?.ribbon,
        write: (next: AcMeshTransform) => {
          useEditor.getState().setAcMeshTransform(selection.model, key, next);
          useEditor.getState().refreshAcLoose();
        },
      };
    }
    if (selection?.kind === 'acCopy') {
      const copy = copies?.[selection.model]?.find((c) => c.id === selection.id);
      if (!copy?.t.ribbon) return null;
      return {
        model: selection.model, name: copy.mesh, part: copy.part,
        stored: copy.t, implicit: false,
        write: (next: AcMeshTransform) =>
          useEditor.getState().setAcCopyTransform(selection.model, selection.id, next),
      };
    }
    return null;
  }, [selection, marked, scene, transforms, copies, frames]);

  /*
   * The piece's ORIGINAL extent in track coordinates: the fixed end of every
   * mapping a drag writes. Keyed on names, not on `picked` -- that object
   * changes on every frame of a drag, and this projection is the expensive
   * part that must not run per frame.
   *
   * Two projections when a datum has to be chosen: the centre-based one says
   * which side of the road the piece sits on, the edge-based one is then the
   * yardstick everything else measures against. An existing ribbon brings its
   * own datum and must keep it -- its stored offsets mean nothing against any
   * other.
   */
  const pickedModel = picked?.model ?? null;
  const pickedName = picked?.name ?? null;
  const pickedPart = picked?.part;
  const storedEdge = picked?.stored?.ribbon?.edge;
  const pickedImplicit = picked?.implicit ?? false;
  const boundsInfo = useMemo(() => {
    if (!pickedModel || !pickedName || !scene) return null;
    const model = scene.models.find((m) => m.path === pickedModel);
    if (!model) return null;
    const points = acPieceWorldPoints(model, pickedName, pickedPart);
    if (!points) return null;
    const centre = ribbonBounds(frames, points);
    if (!centre) return null;
    const edge = pickedImplicit ? ribbonSideOf(centre) : storedEdge;
    const bounds = edge ? ribbonBounds(frames, points, edge) : centre;
    return bounds ? { bounds, edge } : null;
  }, [pickedModel, pickedName, pickedPart, scene, frames, storedEdge, pickedImplicit]);
  const bounds = boundsInfo?.bounds ?? null;

  /** The transform the handles act on: the stored one, or the implied identity. */
  const active = useMemo<AcMeshTransform | null>(() => {
    if (!picked) return null;
    if (picked.stored?.ribbon) return picked.stored;
    if (!boundsInfo) return null;
    return {
      p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1],
      ribbon: {
        length: 1, width: 1, height: 1, anchor: [0.5, 0, 0.5],
        ...(boundsInfo.edge ? { edge: boundsInfo.edge } : {}),
      },
    };
  }, [picked, boundsInfo]);

  /** Where the bar and the grips stand right now. */
  const layout = useMemo(() => {
    if (!active?.ribbon || !bounds) return null;
    if (bounds.maxS - bounds.minS < RIBBON_MIN_EXTENT) return null;
    const resize = resizeOf(active);
    const latMid = (bounds.minLateral + bounds.maxLateral) / 2;
    const top = bounds.maxHeight;
    const span = ribbonSpanOf(bounds, resize);
    const covered = Math.abs(span.to - span.from);
    const n = Math.max(8, Math.min(64, Math.round(covered / 3)));
    const samples: THREE.Vector3[] = [];
    const scratch = { s: 0, lateral: latMid, height: top };
    for (let i = 0; i <= n; i++) {
      scratch.s = bounds.minS + ((bounds.maxS - bounds.minS) * i) / n;
      const p = placeRibbonPoint(frames, bounds, resize, scratch, new THREE.Vector3());
      if (p) { p.y += 0.35; samples.push(p); }
    }
    if (samples.length < 2) return null;
    return { samples, covered };
  }, [active, bounds, frames]);

  /* The bar: one thin box per pair of samples, turned along its own piece. */
  useLayoutEffect(() => {
    const mesh = barRef.current;
    if (!mesh || !layout) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (let i = 0; i < layout.samples.length - 1; i++) {
      const a = layout.samples[i];
      const b = layout.samples[i + 1];
      mid.addVectors(a, b).multiplyScalar(0.5);
      dir.subVectors(b, a);
      const len = dir.length();
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
      scale.set(0.9, 0.3, len + 0.05);
      m.compose(mid, q, scale);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = layout.samples.length - 1;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [layout]);

  /* The grips: a taller block standing on each end. */
  useLayoutEffect(() => {
    const mesh = gripRef.current;
    if (!mesh || !layout) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3(1.0, 1.4, 1.0);
    const p = new THREE.Vector3();
    [layout.samples[0], layout.samples[layout.samples.length - 1]].forEach((end, i) => {
      p.copy(end);
      p.y += 0.55;
      m.compose(p, q, scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = 2;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [layout]);

  /* Everything the window-level drag needs without re-registering per frame. */
  const ctx = useRef({ frames, camera, gl });
  ctx.current = { frames, camera, gl };

  useEffect(() => {
    const ndc = new THREE.Vector2();
    const caster = new THREE.Raycaster();
    const plane = new THREE.Plane(UP, 0);
    const hit = new THREE.Vector3();

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const { frames: fr, camera: cam, gl: renderer } = ctx.current;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      caster.setFromCamera(ndc, cam);
      plane.set(UP, -d.planeY);
      if (!caster.ray.intersectPlane(plane, hit)) return;
      // Read the pointer against the SAME datum the bounds were made with:
      // a centre-based cursor against edge-based bounds would jump the piece
      // by half the road's width on the first move.
      const r = toRibbon(fr, hit, d.edgeSide);
      if (!r) return;

      const store = useEditor.getState();

      if (d.copies) {
        // Nothing is written while the pointer moves: the copies are laid in
        // one committed step on release, so this is only the arithmetic and
        // the running commentary.
        const span0 = ribbonSpanOf(d.bounds, resizeOf(d.t0));
        const past = d.mode === 'trimTo' ? r.s - span0.to : span0.from - r.s;
        d.copyCount = Math.max(0, Math.min(40, Math.round(past / Math.max(0.5, d.covered))));
        store.setStatus(d.copyCount === 0
          ? 'Alt-drag past the end to lay more sections'
          : `${d.copyCount} more section(s), ${(d.copyCount * d.covered).toFixed(0)} m, release to lay them`);
        return;
      }

      if (!d.moved) {
        // History on the first change, not on the press: grabbing a grip and
        // letting go must not leave an empty undo step.
        store.pushHistory();
        d.moved = true;
      }
      store.markBusy();

      const t0 = d.t0;
      const rib0 = t0.ribbon!;
      const b = d.bounds;
      if (d.mode === 'slide') {
        const ds = d.lateral ? 0 : r.s - d.grabS;
        const dl = d.lateral ? r.lateral - d.grabLat : 0;
        d.write({ ...t0, p: [t0.p[0] + dl, t0.p[1], t0.p[2] + ds] });
        store.setStatus(d.lateral
          ? `Moved ${dl >= 0 ? 'outward' : 'inward'} ${Math.abs(dl).toFixed(2)} m`
          : `Slid ${Math.abs(ds).toFixed(1)} m along the track`);
      } else {
        const extent = b.maxS - b.minS;
        const { length, along } = trimSpan(
          b, resizeOf(t0), d.mode === 'trimTo' ? 'to' : 'from', r.s, RIBBON_MIN_LENGTH,
        );
        d.write({ ...t0, ribbon: { ...rib0, length }, p: [t0.p[0], t0.p[1], along] });
        store.setStatus(`Covers ${(length * extent).toFixed(1)} m of the corner (was ${extent.toFixed(1)} m)`);
      }
    };

    const stop = () => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      if (d.copies && d.copyCount > 0) {
        // One committed step for the whole run: the store's commit takes the
        // history entry, so Ctrl+Z removes every section at once.
        const sign = d.mode === 'trimTo' ? 1 : -1;
        const list: AcMeshTransform[] = [];
        for (let k = 1; k <= d.copyCount; k++) {
          list.push({
            ...d.t0,
            p: [d.t0.p[0], d.t0.p[1], d.t0.p[2] + sign * k * d.covered],
          });
        }
        const laid = useEditor.getState().placeAcCopies(d.ref, list);
        useEditor.getState().setStatus(
          `${laid} section(s) laid ${d.mode === 'trimTo' ? 'onward' : 'back'} along the corner`,
        );
      }
      setTimeout(() => useEditor.setState({ interacting: false }), 0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
    };
  }, []);

  if (!picked || !active || !bounds || !layout) return null;

  const begin = (e: ThreeEvent<PointerEvent>, mode: RibbonDrag['mode']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const r = toRibbon(frames, e.point, boundsInfo?.edge);
    if (!r) return;
    drag.current = {
      mode,
      // For an untouched kerb this is the implied identity: the first frame
      // of the drag is what writes a real transform into the project.
      t0: active,
      bounds,
      edgeSide: boundsInfo?.edge,
      write: picked.write,
      grabS: r.s,
      grabLat: r.lateral,
      planeY: e.point.y,
      lateral: e.nativeEvent.shiftKey,
      moved: false,
      copies: mode !== 'slide' && e.nativeEvent.altKey,
      copyCount: 0,
      ref: { model: picked.model, name: picked.name, part: picked.part },
      covered: (bounds.maxS - bounds.minS) * (active.ribbon?.length ?? 1),
    };
    useEditor.setState({ interacting: true });
  };

  return (
    <group>
      {/* Fixed capacity: the sample count changes as the piece is trimmed,
          and new args would tear down and rebuild the mesh mid drag. */}
      <instancedMesh
        ref={barRef}
        args={[HANDLE_BOX, barMaterial, 64]}
        frustumCulled={false}
        renderOrder={10}
        onPointerDown={(e) => begin(e, 'slide')}
      />
      <instancedMesh
        ref={gripRef}
        args={[HANDLE_BOX, gripMaterial, 2]}
        frustumCulled={false}
        renderOrder={11}
        onPointerDown={(e) => begin(e, e.instanceId === 0 ? 'trimFrom' : 'trimTo')}
      />
    </group>
  );
}

/* ------------------------------------------------------------------ */

export function AcLayer() {
  const scene = useEditor((s) => s.acScene);
  const view = useEditor((s) => s.view);
  if (!scene) return null;

  return (
    <group>
      {view.road && <AcModels scene={scene} wireframe={view.wireframe} />}
      <AcPicker scene={scene} />
      <RibbonHandles />
      {view.markers && <AcMarkers scene={scene} />}
      {view.aiLine && <RecoveredLine scene={scene} />}
    </group>
  );
}
