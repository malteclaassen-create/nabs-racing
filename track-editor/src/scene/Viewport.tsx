import { memo, Profiler, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Line, OrbitControls, Sky, TransformControls, useCursor } from '@react-three/drei';

import { QUALITY_DPR, useEditor } from '../store/store';
import { useDerived, type Derived } from '../store/derived';
import { EMPTY_GRASS3D, GRASS3D_STRIDE, grass3dFor, grass3dOnGrass } from '../core/grass3d';
import { ALPHA_TESTED, EMISSIVE, EMISSIVE_TINT, getTexture, MATERIAL_COLORS } from '../core/textures';
import {
  barrierHandleHeight,
  barrierHandles,
  kerbHandles,
  type MaterialKey,
  type MeshDef,
} from '../core/road';
import {
  distAtT,
  eraseKerbRange,
  insertKerbSpan,
  makeKerbSpan,
  moveKerbSpan,
  spanExtent,
  spanMetres,
  tAtDist,
} from '../core/kerbs';
import { GROUND_KINDS, makeTerrainRaycast, sampleHeights, type GroundRect } from '../core/terrain';

/* Alt while painting the ground rubs it out. Not the same as painting grass:
   grass is a material laid over whatever was there, the eraser hands the patch
   back to the ground, which under the run off is the road's own surface. */
const GROUND_ERASE = -1;
import { propMatrix, propPosition, writePropMatrix } from '../core/props';

/** Reused by every instanced batch: they all fill it and hand it straight on. */
const matrixScratch = new THREE.Matrix4();

/** Stable references, so switching tools swaps one function for the other. */
const NO_RAYCAST = () => null;
const INSTANCED_RAYCAST = THREE.InstancedMesh.prototype.raycast;

/** A box dragged out on the ground to mark everything standing in it. */
interface MarqueeBox {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Metres a marquee has to reach before it stops being a click. */
const MIN_MARQUEE = 1.5;
import { GRASS_KINDS, isGroundPad, LIBRARY_BY_KEY, PAD_SIZE, propParts, propTileBox } from '../core/library';
import {
  clearanceAt,
  padScale,
  rectFromDrag,
  resolvePlacement,
  snapCornerToPads,
  type PadRect,
  type Placement,
  type Scale2,
} from '../core/propSnap';
import { noteGroundPoint } from '../store/placement';
import { instantiatePrefab, prefabOf } from '../core/prefabs';
import { segmentStartId, type Frame } from '../core/spline';
import { applyDrawHeight, FREEHAND_SPACING, planDraw, type DrawMode } from '../core/draw';
import { runLength } from '../core/barrierRun';
import { PointIndex } from '../core/spatial';
import { sectionIndices, sectionNodes, translateSection } from '../core/section';
import type { Marker } from '../core/markers';
import type {
  KerbSpan,
  KerbStyle,
  PathId,
  Project,
  PropInstance,
  Selection,
  TerrainSettings,
  TrackNode,
} from '../types';
import { assetIdOf, assetVersion, getAsset, isAssetKind, onAssetsChanged } from '../io/assetCache';
import { setRenderer } from '../io/screenshot';
import { FpsProbe } from './FpsMeter';
import { AcLayer } from './AcLayer';
import { acGroupCentre, acMeshCentre, applyMarkerEdits } from '../ac/acScene';
import { partKey, pathDataOf, pathLabelOf, roadIdOf } from '../types';
import { attachRenderer, noteEffect, noteRender, SCENE_ID, timeEffect } from './stallLog';

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** The three tools that put spline points down with a click. */
function isDrawTool(tool: string): boolean {
  return tool === 'drawTrack' || tool === 'drawPit' || tool === 'drawRoad';
}

/**
 * Which path a draw click lands on. For the Road tool that is the active deco
 * road -- created on the spot when there is none yet, so the first click of a
 * fresh road just works.
 */
function drawTargetPath(tool: string): PathId {
  if (tool === 'drawTrack') return 'track';
  if (tool === 'drawPit') return 'pit';
  const s = useEditor.getState();
  const id = s.activeDeco ?? s.addDecoRoad(s.decoSurface);
  return `road:${id}`;
}

/** The same, for previews: never creates anything. */
function drawPreviewPath(tool: string): PathId | null {
  if (tool === 'drawTrack') return 'track';
  if (tool === 'drawPit') return 'pit';
  const id = useEditor.getState().activeDeco;
  return id ? `road:${id}` : null;
}

/**
 * Thin out a polyline for display. drei's Line rebuilds and re-uploads its
 * whole geometry whenever the point array changes, and while dragging a control
 * point that happens every single frame. The AI line alone can be a couple of
 * thousand points, none of which are distinguishable on screen.
 */
function decimate<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out: T[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Shortest gap between two live rebuilds while dragging or sculpting. */
const MIN_UPDATE_INTERVAL = 1 / 62;

/**
 * Shared geometry and materials for the little markers.
 *
 * Declaring `<sphereGeometry args={...}>` inside a loop gives every control
 * point its own geometry, and `<meshBasicMaterial>` gives it its own material.
 * A 26 point track with a full grid was carrying over a hundred of each, all
 * identical apart from a radius or a colour. One shape, scaled per mesh, and
 * one material per colour.
 */
const UNIT_SPHERE = new THREE.SphereGeometry(1, 14, 10);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
const UNIT_CIRCLE = new THREE.CircleGeometry(1, 12);

const basicCache = new Map<string, THREE.MeshBasicMaterial>();

function basicMaterial(color: string, opacity = 1, depthTest = true): THREE.MeshBasicMaterial {
  const id = `${color}|${opacity}|${depthTest}`;
  let m = basicCache.get(id);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest });
    basicCache.set(id, m);
  }
  return m;
}

const spriteCache = new Map<THREE.Texture, THREE.SpriteMaterial>();

function spriteMaterial(map: THREE.Texture): THREE.SpriteMaterial {
  let m = spriteCache.get(map);
  if (!m) {
    m = new THREE.SpriteMaterial({ map, transparent: true, depthTest: false });
    spriteCache.set(map, m);
  }
  return m;
}

const labelCache = new Map<string, THREE.CanvasTexture>();

function labelTexture(text: string, color = '#e9edf2'): THREE.CanvasTexture {
  const key = `${text}|${color}`;
  const hit = labelCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = 'bold 74px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, 64, 68);
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(key, t);
  return t;
}

function Label({ text, position, color, size = 6 }: { text: string; position: THREE.Vector3; color?: string; size?: number }) {
  const material = useMemo(() => spriteMaterial(labelTexture(text, color)), [text, color]);
  return <sprite position={position} scale={[size, size, size]} renderOrder={10} material={material} />;
}

/* ------------------------------------------------------------------ */
/* Road, pit and terrain surfaces                                      */
/* ------------------------------------------------------------------ */

/**
 * One material per look, shared by every mesh that uses it.
 *
 * Declaring the material as a JSX child gives every single mesh its own
 * instance, so a track with a fragmented barrier ends up with dozens of
 * identical materials, all recreated whenever the mesh list changes.
 */
const materialCache = new Map<string, THREE.Material>();

function surfaceMaterial(
  key: MaterialKey,
  cheap: boolean,
  wireframe: boolean,
  sink = false,
): THREE.Material {
  const id = `${key}|${cheap ? 'l' : 's'}|${wireframe ? 'w' : ''}|${sink ? 'o' : ''}`;
  let m = materialCache.get(id);
  if (!m) {
    const common = {
      map: getTexture(key),
      side: THREE.DoubleSide,
      wireframe,
      // Belt and braces against z-fighting under the road: the geometry already
      // tucks the ground below it, this nudges it back in the depth buffer too.
      polygonOffset: sink,
      polygonOffsetFactor: sink ? 2 : 0,
      polygonOffsetUnits: sink ? 4 : 0,
      // Alpha TESTED, not blended, matching what the kn5 asks AC for: the
      // fence stays in the opaque pass, so it needs no depth sorting against
      // the scenery behind it and the preview cannot disagree with the export.
      alphaTest: ALPHA_TESTED.has(key) ? 0.5 : 0,
      /*
       * A screen on a barrier lights itself, so it is drawn at full brightness
       * whatever the sun is doing: the texture again as the emissive map, which
       * lets the lamps carry their own light while the black between them stays
       * black. The tint is the colour the flag condition puts out for a running
       * race -- the state the panel is in for all but a few seconds of a
       * session, and the one worth previewing.
       */
      emissive: new THREE.Color(EMISSIVE.has(key) ? (EMISSIVE_TINT[key] ?? '#ffffff') : '#000000'),
      emissiveMap: EMISSIVE.has(key) ? getTexture(key) : null,
    };
    m = cheap
      ? new THREE.MeshLambertMaterial(common)
      : new THREE.MeshStandardMaterial({ ...common, roughness: 0.94, metalness: 0 });
    materialCache.set(id, m);
  }
  return m;
}

function SurfaceMesh({ def, wireframe, cheap }: { def: MeshDef; wireframe: boolean; cheap: boolean }) {
  const material = surfaceMaterial(def.material as MaterialKey, cheap, wireframe);
  return <mesh geometry={def.geometry} material={material} raycast={() => null} />;
}

function TrackSurfaces({ derived }: { derived: Derived }) {
  const view = useEditor((s) => s.view);
  const quality = useEditor((s) => s.quality);
  if (!view.road) return null;
  const cheap = quality !== 'high';
  return (
    <group>
      {derived.roadMeshes.map((d) => (
        <SurfaceMesh key={d.name} def={d} wireframe={view.wireframe} cheap={cheap} />
      ))}
      {derived.pitMeshes.map((d) => (
        <SurfaceMesh key={d.name} def={d} wireframe={view.wireframe} cheap={cheap} />
      ))}
      {derived.decoMeshes.map((d) => (
        <SurfaceMesh key={d.name} def={d} wireframe={view.wireframe} cheap={cheap} />
      ))}
      {derived.gridMeshes.map((d) => (
        <SurfaceMesh key={d.name} def={d} wireframe={view.wireframe} cheap={cheap} />
      ))}
      {derived.gantryMeshes.map((d) => (
        <SurfaceMesh key={d.name} def={d} wireframe={view.wireframe} cheap={cheap} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Terrain, which is also the interaction surface                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Placing objects                                                     */
/* ------------------------------------------------------------------ */

interface PlacementPose {
  pos: THREE.Vector3;
  rotY: number;
  /** Which rule decided the position, so the preview can say so. */
  rule: Placement['rule'];
  /** Per axis scale it will be stored at -- ground patches are sized in metres. */
  scale: [number, number, number];
}

/** How big the next ground patch is, as a scale of the 10 m square. */
function placementScale(): Scale2 {
  const s = useEditor.getState();
  return padScale(s.placeKind, s.padSize.w, s.padSize.l);
}

/** A ground patch being pulled out with the pointer. */
interface PadDrag {
  /** The frame the rectangle is measured in, degrees. */
  rotY: number;
  rect: PadRect;
  /** A corner locked onto a neighbouring patch's edge. */
  onEdge: boolean;
}

/** Below this the drag is a click that wobbled, not a rectangle. */
const MIN_DRAG_SIDE = 1;

/**
 * A corner of a ground shape, on the snap grid unless it is switched off.
 *
 * Deliberately NOT `padCorner`: that one latches onto the edges of patches
 * already placed, which is right for a slab meeting its neighbour and wrong
 * here, where the neighbour is the ground itself and has no edges to find.
 */
function groundPoint(x: number, z: number): { x: number; z: number } {
  const snap = useEditor.getState().snap;
  if (snap <= 0) return { x, z };
  return { x: Math.round(x / snap) * snap, z: Math.round(z / snap) * snap };
}

/**
 * How near the first corner counts as clicking it again.
 *
 * Scaled off the brush radius rather than fixed, because "near" on a circuit
 * two kilometres across is not the same distance as "near" on a paddock, and
 * the radius is the one number in the panel that says what scale the user is
 * working at.
 */
function closeReach(radius: number): number {
  return Math.max(3, radius * 0.5);
}

/** Heading steps the straight mode locks to, degrees. Alt turns it off. */
const ANGLE_STEP = 15;

/**
 * One corner of a patch being dragged out.
 *
 * The edges of the patches already there come first, because that is what
 * closes the seam between two areas of concrete; the world grid only gets a say
 * on a corner that found no edge to latch onto, since it knows nothing about
 * where the neighbour ends. Alt turns both off, as everywhere else.
 */
function padCorner(x: number, z: number, exact: boolean): { x: number; z: number; onEdge: boolean } {
  const s = useEditor.getState();
  if (exact) return { x, z, onEdge: false };
  const corner = snapCornerToPads(x, z, s.placeRotation, s.project.props);
  if (corner.onEdgeX || corner.onEdgeZ) return { x: corner.x, z: corner.z, onEdge: true };
  if (s.snap > 0) {
    return {
      x: Math.round(corner.x / s.snap) * s.snap,
      z: Math.round(corner.z / s.snap) * s.snap,
      onEdge: false,
    };
  }
  return { x: corner.x, z: corner.z, onEdge: false };
}

/** The rectangle an anchor and the pointer describe, in the aimed frame. */
function padDragFrom(
  anchor: { x: number; z: number; onEdge: boolean },
  bx: number,
  bz: number,
  exact: boolean,
): PadDrag {
  const rotY = useEditor.getState().placeRotation;
  const far = padCorner(bx, bz, exact);
  return {
    rotY,
    rect: rectFromDrag(anchor.x, anchor.z, far.x, far.z, rotY),
    onEdge: anchor.onEdge || far.onEdge,
  };
}

/**
 * Where the place tool would drop the next object, given a point on the ground.
 *
 * The preview and the click that follows it both come through here. Two
 * separate copies of "and then it snaps like this" is how a ghost ends up
 * hovering somewhere the object does not actually land.
 *
 * Alt means "exactly where I am pointing" and switches every kind of snapping
 * off, which is the escape hatch for the one spot the rules get wrong.
 */
function resolvePlacementPose(point: THREE.Vector3, exact: boolean): PlacementPose {
  const s = useEditor.getState();
  // The patch's real size goes in, not a bare 1. Asking the snapper about an
  // unstretched 10 m square while the user is dropping a 40 x 25 m one is why
  // two patches never met: the slot it offered was measured off a shape that
  // was never placed.
  const scale = placementScale();
  const hit = resolvePlacement({
    kind: s.placeKind,
    x: point.x,
    z: point.z,
    rotY: s.placeRotation,
    props: s.project.props,
    snap: s.snap,
    scale,
    exact,
  });
  const pos = point.clone();
  pos.x = hit.x;
  pos.z = hit.z;
  return { pos, rotY: hit.rotY, rule: hit.rule, scale: [scale.x, 1, scale.z] };
}

/**
 * One translucent material for the whole preview, whatever it is made of.
 * The ghost is redrawn on every mouse move, so it must not be creating
 * materials as it goes.
 */
const GHOST_MATERIAL = new THREE.MeshBasicMaterial({
  color: '#8ad4ff',
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
});

/** Latched onto a neighbour: green, so a successful snap is visible up front. */
const GHOST_FLUSH_MATERIAL = new THREE.MeshBasicMaterial({
  color: '#7ee08a',
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
});

/** Shared, so an unstretched preview allocates no array per frame. */
const UNIT_GHOST_SCALE: [number, number, number] = [1, 1, 1];

const ghostCache = new Map<string, THREE.Material>();

/**
 * The ghost of one part.
 *
 * A solid object is recognisable from its geometry alone, so it gets the plain
 * tinted material and nothing more. An alpha tested part is NOT: its geometry
 * is a bare rectangle and the entire shape lives in the texture. The ghost of
 * a tree card was therefore two blank panes crossed at the cursor -- it showed
 * where the card was going, which is not a thing anybody wants to know, and
 * said nothing about where the tree was going. So those carry the texture and
 * the same cut the real material uses.
 *
 * The threshold is scaled by the ghost's opacity, and that is not a nicety:
 * three.js tests the FINAL alpha, which here is the ghost's opacity times the
 * texture's. A 0.5 cut against a 0.45 opaque ghost discards every pixel on the
 * card and the preview disappears completely.
 */
function ghostMaterial(key: MaterialKey, flush: boolean): THREE.Material {
  const base = flush ? GHOST_FLUSH_MATERIAL : GHOST_MATERIAL;
  if (!ALPHA_TESTED.has(key)) return base;
  const id = `${key}|${flush ? 'flush' : 'free'}`;
  let m = ghostCache.get(id);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      /*
       * Lighter than the solid ghost's tint, and further apart from each other.
       *
       * A tint on a textured ghost MULTIPLIES rather than replaces, so both
       * effects have to be paid for. The solid ghost's colours come out as a
       * near black tree over grass, hence lighter; and the two of them come out
       * nearly identical once the dark green of the leaves has had its say,
       * hence the flush one being unmistakably green rather than a shade of the
       * free one. Latching onto a neighbour has to be visible before the drop,
       * which is the entire job of the second colour.
       */
      color: new THREE.Color(flush ? '#a6ffb0' : '#d6efff'),
      map: getTexture(key),
      transparent: true,
      opacity: base.opacity,
      alphaTest: base.opacity * 0.5,
      depthWrite: false,
    });
    ghostCache.set(id, m);
  }
  return m;
}

/** One object -- library or imported -- drawn as a see through preview. */
function GhostPiece({
  kind,
  x,
  z,
  rotY,
  terrain,
  heights,
  flush = false,
  scale = UNIT_GHOST_SCALE,
}: {
  kind: string;
  x: number;
  z: number;
  rotY: number;
  terrain: TerrainSettings;
  heights: Float32Array;
  flush?: boolean;
  scale?: [number, number, number];
}) {
  const assetId = assetIdOf(kind);
  const parts = useMemo(() => (assetId === null ? propParts(kind) : []), [kind, assetId]);
  // Snapping moves the object sideways, so the ground under it is not the
  // ground the cursor is over.
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(x, sampleHeights(terrain, heights, x, z), z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(rotY), 0)),
    new THREE.Vector3(scale[0], scale[1], scale[2]),
  );
  // An imported model has no library material to look up, so it keeps the
  // plain tint; a library object is drawn part by part, because whether the
  // shape is in the geometry or in the texture is decided per part.
  if (assetId !== null) {
    return (
      <AssetGhost
        id={assetId}
        matrix={matrix}
        material={flush ? GHOST_FLUSH_MATERIAL : GHOST_MATERIAL}
      />
    );
  }
  if (parts.length === 0) return null;
  return (
    <group matrixAutoUpdate={false} matrix={matrix}>
      {parts.map((p, i) => (
        <mesh
          key={i}
          geometry={p.geometry}
          material={ghostMaterial(p.material, flush)}
          raycast={() => null}
        />
      ))}
    </group>
  );
}

/**
 * The preview of an imported model.
 *
 * Its shape is not in the library, so the preview has to come from the parsed
 * model itself -- which is why the place tool used to draw nothing at all for
 * an imported model and left you aiming blind. The clone is shallow in the
 * ways that matter (geometry is shared) and is only rebuilt when the model or
 * the ghost colour changes, not per mouse move.
 */
function AssetGhost({
  id,
  matrix,
  material,
}: {
  id: string;
  matrix: THREE.Matrix4;
  material: THREE.Material;
}) {
  const version = useSyncExternalStore(onAssetsChanged, assetVersion);
  const group = useMemo(() => {
    void version;
    const source = getAsset(id);
    if (!source) return null;
    const g = source.clone(true);
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = material;
      mesh.raycast = NO_RAYCAST;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
    return g;
  }, [id, version, material]);

  if (!group) return null;
  return <primitive object={group} matrixAutoUpdate={false} matrix={matrix} />;
}

/** What the place tool is about to drop, drawn where it would land. */
function GhostProp({
  point,
  exact,
  terrain,
  heights,
  drag,
}: {
  point: THREE.Vector3;
  exact: boolean;
  terrain: TerrainSettings;
  heights: Float32Array;
  /** A patch being pulled out right now, which overrides everything below. */
  drag?: PadDrag | null;
}) {
  const placeKind = useEditor((s) => s.placeKind);
  // One subscription per input the resolver reads, so the preview redraws the
  // moment any of them changes. The values themselves are read back out of the
  // store inside the resolver, which is the single path a real click takes.
  useEditor((s) => s.placeRotation);
  useEditor((s) => s.snap);
  useEditor((s) => s.padSize);
  useEditor((s) => s.project.props);

  // While a patch is being dragged out the rectangle IS the preview: it is
  // built by the same function that commits it on release, so the shape the
  // pointer is describing and the shape that lands cannot drift apart.
  if (drag) {
    return (
      <GhostPiece
        kind={placeKind}
        x={drag.rect.x}
        z={drag.rect.z}
        rotY={drag.rotY}
        terrain={terrain}
        heights={heights}
        flush={drag.onEdge}
        scale={[drag.rect.w / PAD_SIZE, 1, drag.rect.l / PAD_SIZE]}
      />
    );
  }

  const pose = resolvePlacementPose(point, exact);
  const prefab = prefabOf(placeKind);

  if (prefab) {
    // Built through the same function that places it, so what you see really is
    // where every piece ends up.
    const pieces = instantiatePrefab(
      prefab,
      { x: pose.pos.x, y: 0, z: pose.pos.z },
      pose.rotY,
      (i) => String(i),
    );
    return (
      <group>
        {pieces.map((inst) => (
          <GhostPiece
            key={inst.id}
            kind={inst.kind}
            x={inst.p[0]}
            z={inst.p[2]}
            rotY={inst.r[1]}
            terrain={terrain}
            heights={heights}
            flush={pose.rule === 'flush'}
          />
        ))}
      </group>
    );
  }

  return (
    <GhostPiece
      kind={placeKind}
      x={pose.pos.x}
      z={pose.pos.z}
      rotY={pose.rotY}
      terrain={terrain}
      heights={heights}
      flush={pose.rule === 'flush'}
      scale={pose.scale}
    />
  );
}

function TerrainLayer({ derived }: { derived: Derived }) {
  const project = useEditor((s) => s.project);
  const view = useEditor((s) => s.view);
  const tool = useEditor((s) => s.tool);
  const brush = useEditor((s) => s.brush);
  const scatter = useEditor((s) => s.scatter);
  const placeKind = useEditor((s) => s.placeKind);
  const snap = useEditor((s) => s.snap);
  const drawMode = useEditor((s) => s.drawMode);
  const drawCfg = useEditor((s) => s.drawCfg);
  // Subscribed here so the Road tool's preview follows the active road.
  useEditor((s) => s.activeDeco);
  const barrierMode = useEditor((s) => s.barrierMode);
  const barrierDraft = useEditor((s) => s.barrierDraft);
  const eraseRadius = useEditor((s) => s.eraseRadius);
  const ground = useEditor((s) => s.ground);
  const groundDraft = useEditor((s) => s.groundDraft);
  /** The first corner of a ground rectangle being pulled out, world XZ. */
  const groundAnchor = useRef<{ x: number; z: number } | null>(null);
  /*
   * The rectangle lives in a ref AND in state, for the same reason the ground
   * patch drag does: the state is what draws the preview, and the ref is what
   * the pointer-up reads. A handler closes over the state as it was at the last
   * RENDER, and a drag on a busy frame moves the pointer several times between
   * two of those -- which is how a rectangle dragged out to 270 by 90 metres
   * gets painted as the 270 by 5 it was two moves ago.
   */
  const groundRectRef = useRef<GroundRect | null>(null);
  const [groundRect, setGroundRectState] = useState<GroundRect | null>(null);
  const setGroundRect = (r: GroundRect | null) => {
    groundRectRef.current = r;
    setGroundRectState(r);
  };
  const { pushHistory, addProp, select, setStatus } = useEditor.getState();

  const quality = useEditor((s) => s.quality);
  const sculpting = useRef(false);
  const flattenTarget = useRef(0);
  const down = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursorState] = useState<THREE.Vector3 | null>(null);

  /*
   * The cursor drives a preview -- the brush ring, the ghost object, the draw
   * line -- and a preview needs to be right once per FRAME, not once per mouse
   * event. A high polling rate mouse sends them far faster than that: a
   * recorded trace has eighteen pointer moves inside a single 5.6 ms frame, and
   * each one was a React state change and its own render pass. Coalescing them
   * onto the frame turns eighteen renders into one and costs nothing visible.
   */
  const pendingCursor = useRef<THREE.Vector3 | null>(null);
  const cursorFrame = useRef(0);
  const setCursor = useCallback((p: THREE.Vector3 | null) => {
    pendingCursor.current = p;
    if (cursorFrame.current) return;
    cursorFrame.current = requestAnimationFrame(() => {
      cursorFrame.current = 0;
      setCursorState(pendingCursor.current);
    });
  }, []);
  useEffect(() => () => {
    if (cursorFrame.current) cancelAnimationFrame(cursorFrame.current);
  }, []);
  /** Alt under the cursor right now, so the ghost previews the exact drop. */
  const [placeExact, setPlaceExact] = useState(false);
  /* The corner a ground patch is being pulled out from, and the rectangle it
     currently describes. The rectangle is held twice on purpose: the state
     draws the preview, the ref is what the release reads, so a commit can
     never act on a value a batched render has not caught up with yet. */
  const padAnchor = useRef<{ x: number; z: number; onEdge: boolean } | null>(null);
  const padDragRef = useRef<PadDrag | null>(null);
  const [padDrag, setPadDrag] = useState<PadDrag | null>(null);
  const brushAt = useRef<{ x: number; z: number } | null>(null);
  const brushMode = useRef(brush.mode);
  /* The marquee, held twice for the same reason the pad drag is: the ref is
     what the release reads, the state is what draws it. */
  const marquee = useRef<MarqueeBox | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeBox | null>(null);
  /* Whether Select is mid drag. Only then does it want pointer moves: a move
     handler on the ground is a ray test per mouse event whether it does
     anything or not, and Select is the tool the camera is flown around in. */
  const [boxing, setBoxing] = useState(false);
  /** The freehand stroke in progress, and where its last point went down. */
  const freehand = useRef<{ path: PathId; last: THREE.Vector3 } | null>(null);

  useEffect(() => {
    const up = () => {
      sculpting.current = false;
      brushAt.current = null;
      // Released off the ground: drop a marquee rather than leaving the tool
      // listening to every mouse move for the rest of the session.
      if (marquee.current) {
        marquee.current = null;
        setMarqueeRect(null);
        setBoxing(false);
      }
      if (freehand.current) {
        freehand.current = null;
        setTimeout(() => useEditor.setState({ interacting: false }), 0);
      }
      // Released off the ground: the mesh's own handler never fired, so drop
      // the drag rather than leaving a rectangle stuck to the pointer.
      padAnchor.current = null;
      padDragRef.current = null;
      setPadDrag(null);
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  /**
   * Sculpting runs once per animation frame, not once per pointer event.
   * A high polling rate mouse fires several moves per frame, and every one of
   * them used to rebuild the whole terrain mesh, so the work queued up faster
   * than it could be drawn and the page froze for seconds at a time.
   * Running from the frame loop also means holding the brush still keeps
   * working, which is what you expect from a brush.
   */
  // Started on pointer down and stopped on release, rather than spinning for
  // the whole session. A frame callback that wakes up 180 times a second to
  // decide it has nothing to do is not free, and it never stopped.
  const brushLoop = useRef(0);
  const startBrushLoop = () => {
    if (brushLoop.current) return;
    let last = 0;
    const loop = (now: number) => {
      const at = brushAt.current;
      if (!sculpting.current || !at) {
        brushLoop.current = 0;
        return;
      }
      brushLoop.current = requestAnimationFrame(loop);
      // Cap at roughly 60 updates a second. On a 180 Hz display there is no
      // visible benefit to rebuilding the ground three times as often, and
      // every rebuild is a few hundred kilobytes of short lived memory.
      const dt = (now - last) / 1000;
      if (dt < MIN_UPDATE_INTERVAL) return;
      last = now;
      const step = Math.min(dt, 0.1);
      const active = useEditor.getState().tool;
      if (active === 'scatter') {
        scatterStep(at.x, at.z, step);
        return;
      }
      if (active === 'erase') {
        const s = useEditor.getState();
        const gone = s.eraseProps(at.x, at.z, s.eraseRadius);
        if (gone > 0) s.setStatus(`Erased ${gone} object${gone === 1 ? '' : 's'}`);
        return;
      }
      if (active === 'ground') {
        const s = useEditor.getState();
        // Alt paints grass, which is the only way back: there is no layer to
        // take away, only another material to put down.
        const kind = erasing.current ? GROUND_ERASE : s.ground.kind;
        s.paintGround(at.x, at.z, kind);
        return;
      }
      useEditor.getState().sculpt(at.x, at.z, brushMode.current, step, flattenTarget.current);
    };
    brushLoop.current = requestAnimationFrame(loop);
  };

  /* --- the vegetation brush ---------------------------------------- */

  const erasing = useRef(false);
  const MAX_PER_STROKE = 400;

  const trackIndex = useMemo(
    () => new PointIndex(derived.trackFrames.map((f) => f.pos), 50),
    [derived.trackFrames],
  );
  const pitIndex = useMemo(
    () => new PointIndex(derived.pitFrames.map((f) => f.pos), 50),
    [derived.pitFrames],
  );

  const scatterStep = (x: number, z: number, dt: number) => {
    const s = useEditor.getState();
    const cfg = s.scatter;

    if (erasing.current) {
      const gone = s.scatterErase(x, z, cfg.radius);
      if (gone > 0) s.setStatus(`Cleared ${gone}`);
      return;
    }

    const left = MAX_PER_STROKE - s.scatterPlanted();
    if (left <= 0) {
      s.setStatus(`Stroke limit reached (${MAX_PER_STROKE}) - release and start a new one`);
      return;
    }
    // Roughly 150 a second, so a stroke feels like a brush rather than a stamp.
    const budget = Math.min(left, Math.max(1, Math.ceil(150 * dt)));

    // Keep off the built surface, using the profile that was actually
    // computed rather than the settings it came from. The spacing is the
    // store's own business, so a dab guarantees it whoever calls.
    const made = s.scatterDab(x, z, budget, (px, pz) =>
      clearanceAt(
        px, pz,
        derived.trackFrames, trackIndex, derived.profile,
        derived.pitFrames, pitIndex,
        cfg.keepOff + 40,
        !cfg.overRunoff,
      ) >= cfg.keepOff,
    );

    if (made > 0) s.setStatus(`Planted ${s.scatterPlanted()} / ${MAX_PER_STROKE}`);
  };

  useEffect(() => () => {
    if (brushLoop.current) cancelAnimationFrame(brushLoop.current);
  }, []);

  // Pointer picking against the height grid rather than every triangle in it.
  const pick = useMemo(
    () => makeTerrainRaycast(project.terrain, derived.terrainHeights),
    [project.terrain, derived.terrainHeights],
  );

  /**
   * A clicked ground point, rounded onto the grid.
   *
   * The height is re-sampled AFTER the rounding. Carrying the raycast height
   * through meant the stored point belonged to a different x/z than the one it
   * was stored at, so on any slope a snapped node ended up hovering above the
   * ground or buried in it. Props escape this because `ground: true` re-samples
   * at draw time; a spline node has no such flag and keeps whatever it was
   * given.
   */
  const snapped = (p: THREE.Vector3, exact = false) => {
    if (snap <= 0 || exact) return p;
    const x = Math.round(p.x / snap) * snap;
    const z = Math.round(p.z / snap) * snap;
    return new THREE.Vector3(x, sampleHeights(project.terrain, derived.terrainHeights, x, z), z);
  };

  /** The terrain under a point, which is what the height modes are relative to. */
  const groundAt = useCallback(
    (x: number, z: number) => sampleHeights(project.terrain, derived.terrainHeights, x, z),
    [project.terrain, derived.terrainHeights],
  );
  /** One point, lifted onto whatever height the draw tool is set to. */
  const atDrawHeight = (p: THREE.Vector3) => applyDrawHeight([p], drawCfg, groundAt)[0];

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    down.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
    // A ground patch is sized by pulling it out, not by two sliders after the
    // fact. Everything else the place tool drops has a size of its own.
    if (tool === 'place' && e.button === 0 && isGroundPad(placeKind)) {
      e.stopPropagation();
      padAnchor.current = padCorner(e.point.x, e.point.z, e.nativeEvent.altKey);
      padDragRef.current = null;
      setPadDrag(null);
      return;
    }
    if (tool === 'scatter' && e.button === 0) {
      e.stopPropagation();
      sculpting.current = true;
      brushAt.current = { x: e.point.x, z: e.point.z };
      erasing.current = e.nativeEvent.altKey;
      useEditor.getState().scatterBegin();
      // One entry for the whole stroke, exactly like sculpting.
      pushHistory();
      startBrushLoop();
      return;
    }
    /* Select: pressing on empty ground starts a marquee. It only becomes one
       once the pointer has actually travelled, so a plain click on the ground
       still means "deselect" and nothing here changes what a click does. */
    if (tool === 'select' && e.button === 0) {
      marquee.current = { x0: e.point.x, z0: e.point.z, x1: e.point.x, z1: e.point.z };
      setMarqueeRect(null);
      setBoxing(true);
      return;
    }
    /* The eraser rides the same brush loop as sculpting and planting: press,
       sweep, and the whole sweep is one undo entry. */
    if (tool === 'erase' && e.button === 0) {
      e.stopPropagation();
      sculpting.current = true;
      brushAt.current = { x: e.point.x, z: e.point.z };
      pushHistory();
      startBrushLoop();
      return;
    }
    if (tool === 'ground' && e.button === 0) {
      e.stopPropagation();
      // Alt means grass in every one of the three modes, rather than meaning
      // "grass" for the brush and "ignore the snap" for the other two. The snap
      // is off by default and a material is one click away; a modifier that
      // means two different things inside one tool is not worth the escape
      // hatch.
      erasing.current = e.nativeEvent.altKey;

      /* A rectangle is pulled out corner to corner, and only becomes ground
         when the button comes up: until then it is a preview that can still be
         made bigger, smaller or thrown away by dragging back to nothing. */
      if (ground.mode === 'rect') {
        groundAnchor.current = groundPoint(e.point.x, e.point.z);
        setGroundRect(null);
        return;
      }

      /* An outline goes down a corner per click, the way the track tool puts
         down control points. Clicking the first corner again closes it, which
         is what every drawing program does and what the shape looks like it
         wants. */
      if (ground.mode === 'polygon') {
        const at = groundPoint(e.point.x, e.point.z);
        const s = useEditor.getState();
        const draft = s.groundDraft;
        const first = draft[0];
        const closing = draft.length >= 3 && first
          && Math.hypot(at.x - first[0], at.z - first[1]) < closeReach(ground.radius);
        if (closing) {
          const painted = s.paintGroundPolygon(
            draft.map(([x, z]) => ({ x, z })),
            e.nativeEvent.altKey ? GROUND_ERASE : s.ground.kind,
          );
          s.setGroundDraft([]);
          setStatus(painted ? 'Ground area painted' : 'That outline covered nothing');
          return;
        }
        s.setGroundDraft([...draft, [at.x, at.z]]);
        setStatus(
          draft.length === 0
            ? 'Corner down. Click the next one; clicking the first again, or Enter, closes it.'
            : `${draft.length + 1} corners · Enter closes it, Esc drops it`,
        );
        return;
      }

      // The brush rides the sculpt loop: press, sweep, one undo entry for the
      // whole sweep.
      sculpting.current = true;
      brushAt.current = { x: e.point.x, z: e.point.z };
      pushHistory();
      startBrushLoop();
      return;
    }
    if (tool === 'terrain' && e.button === 0) {
      e.stopPropagation();
      sculpting.current = true;
      flattenTarget.current = e.point.y;
      brushAt.current = { x: e.point.x, z: e.point.z };
      brushMode.current = brush.mode;
      pushHistory();
      startBrushLoop();
    }
    /* Freehand: hold the button and steer. Points go down every so many
       metres, and the whole stroke is one undo step. */
    if (isDrawTool(tool) && drawMode === 'freehand' && e.button === 0) {
      e.stopPropagation();
      const path = drawTargetPath(tool);
      const at = atDrawHeight(snapped(e.point.clone(), e.nativeEvent.altKey));
      pushHistory();
      useEditor.getState().appendNodeLive(path, at);
      freehand.current = { path, last: at };
      useEditor.setState({ interacting: true });
    }
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (tool === 'place') {
      // The only thing the place tool needs from a move is where to draw the
      // preview, and whether Alt is switching the snapping off.
      setCursor(e.point.clone());
      setPlaceExact(e.nativeEvent.altKey);
      // Remembered for "align with the track", which has no pointer of its own.
      noteGroundPoint(e.point.x, e.point.z);
      const anchor = padAnchor.current;
      if (anchor) {
        const drag = padDragFrom(anchor, e.point.x, e.point.z, e.nativeEvent.altKey);
        const real = drag.rect.w >= MIN_DRAG_SIDE && drag.rect.l >= MIN_DRAG_SIDE ? drag : null;
        padDragRef.current = real;
        setPadDrag(real);
      }
      return;
    }
    if (tool === 'scatter') {
      setCursor(e.point.clone());
      brushAt.current = { x: e.point.x, z: e.point.z };
      // Alt is a live modifier, the way Shift already inverts raise and lower.
      erasing.current = e.nativeEvent.altKey;
      return;
    }
    if (tool === 'erase') {
      setCursor(e.point.clone());
      brushAt.current = { x: e.point.x, z: e.point.z };
      return;
    }
    if (tool === 'ground') {
      setCursor(e.point.clone());
      brushAt.current = { x: e.point.x, z: e.point.z };
      // A live modifier, the same way it is for the plant brush: let go of Alt
      // mid sweep and the rest of the sweep is the material again.
      erasing.current = e.nativeEvent.altKey;
      const anchor = groundAnchor.current;
      if (anchor) {
        const far = groundPoint(e.point.x, e.point.z);
        const rect = {
          x: (anchor.x + far.x) / 2,
          z: (anchor.z + far.z) / 2,
          w: Math.abs(far.x - anchor.x),
          l: Math.abs(far.z - anchor.z),
          rotY: 0,
        };
        setGroundRect(rect.w >= MIN_DRAG_SIDE && rect.l >= MIN_DRAG_SIDE ? rect : null);
      }
      return;
    }
    if (tool === 'select') {
      const m = marquee.current;
      if (!m) return;
      m.x1 = e.point.x;
      m.z1 = e.point.z;
      // Below the threshold this is still a click that has not decided yet.
      setMarqueeRect(
        Math.abs(m.x1 - m.x0) > MIN_MARQUEE && Math.abs(m.z1 - m.z0) > MIN_MARQUEE
          ? { ...m }
          : null,
      );
      return;
    }
    if (isDrawTool(tool)) {
      const stroke = freehand.current;
      if (stroke) {
        // A control point every so many metres: dropping one per pointer event
        // would put a hundred of them in a corner and make the spline lumpy.
        const at = atDrawHeight(snapped(e.point.clone(), e.nativeEvent.altKey));
        if (Math.hypot(at.x - stroke.last.x, at.z - stroke.last.z) >= FREEHAND_SPACING) {
          useEditor.getState().markBusy();
          useEditor.getState().appendNodeLive(stroke.path, at);
          stroke.last = at;
        }
        return;
      }
      // Everything else needs the cursor for the preview line.
      setCursor(e.point.clone());
      setPlaceExact(e.nativeEvent.altKey);
      return;
    }
    /*
     * The free barrier tool draws a line, so it needs the cursor for exactly
     * the same reason the track tool does. This was missing: the preview was
     * built and wired up, and then never had a cursor to draw itself from, so
     * there was no way to see where a run would go before committing to it.
     */
    if (tool === 'barrier') {
      if (barrierMode !== 'free') return;
      setCursor(e.point.clone());
      setPlaceExact(e.nativeEvent.altKey);
      return;
    }
    if (tool !== 'terrain') return;
    setCursor(e.point.clone());
    brushAt.current = { x: e.point.x, z: e.point.z };
    const inverted = e.nativeEvent.shiftKey;
    brushMode.current = inverted
      ? brush.mode === 'raise'
        ? 'lower'
        : brush.mode === 'lower'
          ? 'raise'
          : brush.mode
      : brush.mode;
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = down.current;
    down.current = null;
    sculpting.current = false;
    brushAt.current = null;

    /* A rectangle of ground becomes ground here, once, as one undo step. A
       drag that never grew past a metre was a click that wobbled and paints
       nothing at all -- there is no "default size" for a rectangle the way
       there is for a patch, because the whole point of it is the size. */
    if (groundAnchor.current) {
      const rect = groundRectRef.current;
      groundAnchor.current = null;
      setGroundRect(null);
      if (rect) {
        const kind = erasing.current ? GROUND_ERASE : ground.kind;
        const painted = useEditor.getState().paintGroundRect(rect, kind);
        setStatus(
          painted
            ? `${kind < 0 ? 'Erased' : GROUND_KINDS[kind].label} ${rect.w.toFixed(0)} x ${rect.l.toFixed(0)} m`
            : 'That rectangle changed nothing',
        );
      }
      return;
    }
    if (freehand.current) {
      const count =
        pathDataOf(useEditor.getState().project, freehand.current.path)?.nodes.length ?? 0;
      freehand.current = null;
      setTimeout(() => useEditor.setState({ interacting: false }), 0);
      setStatus(`Freehand: ${count} points on the path`);
      return;
    }
    /* A marquee that grew big enough marks everything standing inside it and
       swallows the click, so letting go over empty ground does not immediately
       clear what was just picked out. */
    const box = marquee.current;
    marquee.current = null;
    if (box) {
      setMarqueeRect(null);
      setBoxing(false);
      if (Math.abs(box.x1 - box.x0) > MIN_MARQUEE && Math.abs(box.z1 - box.z0) > MIN_MARQUEE) {
        const xa = Math.min(box.x0, box.x1);
        const xb = Math.max(box.x0, box.x1);
        const za = Math.min(box.z0, box.z1);
        const zb = Math.max(box.z0, box.z1);
        const hits = useEditor.getState().project.props.filter(
          (p) => p.p[0] >= xa && p.p[0] <= xb && p.p[2] >= za && p.p[2] <= zb,
        );
        useEditor.getState().setMarked(hits.map((p) => p.id));
        select(null);
        setStatus(
          hits.length === 0
            ? 'Nothing inside the box'
            : `${hits.length} objects marked — Delete removes them`,
        );
        return;
      }
    }
    const drag = padDragRef.current;
    const dragging = padAnchor.current !== null;
    padAnchor.current = null;
    padDragRef.current = null;
    if (dragging) setPadDrag(null);
    if (!d) return;
    const moved = Math.hypot(e.nativeEvent.clientX - d.x, e.nativeEvent.clientY - d.y);

    // A patch that was pulled out: the drag decided its size and its heading,
    // so it does not go through the click path below at all. A drag that never
    // grew past a metre falls through and drops one at the size in the panel,
    // which is what a plain click on a patch means.
    if (drag && e.button === 0) {
      const { x, z, w, l } = drag.rect;
      const y = sampleHeights(project.terrain, derived.terrainHeights, x, z);
      addProp(placeKind, new THREE.Vector3(x, y, z), drag.rotY, [w / PAD_SIZE, 1, l / PAD_SIZE]);
      // Remembered, so clicking to drop a second one the same size just works.
      useEditor.getState().setPadSize(w, l);
      setStatus(
        `Placed ${LIBRARY_BY_KEY.get(placeKind)?.label ?? placeKind} ${w.toFixed(1)} x ${l.toFixed(1)} m`
          + (drag.onEdge ? ', flush against its neighbour' : ''),
      );
      return;
    }

    if (moved > 5 || e.button !== 0) return;

    // Alt means "exactly where I am pointing" for the draw tools too, matching
    // the place tool's escape hatch.
    const point = snapped(e.point.clone(), e.nativeEvent.altKey);
    const where = snap > 0 && !e.nativeEvent.altKey ? ` (grid ${snap} m)` : '';
    if (tool === 'scatter') {
      // A click that never moved: plant one clump rather than doing nothing.
      scatterStep(e.point.x, e.point.z, 0.2);
    } else if (tool === 'drawRoad' && useEditor.getState().roundaboutArm) {
      // Armed from the Roads panel: this click IS the roundabout's centre.
      useEditor.getState().addRoundabout({ x: point.x, y: point.y, z: point.z });
      setStatus('Roundabout laid down. Roads drawn from here dock onto its edge.');
    } else if (isDrawTool(tool)) {
      const path = drawTargetPath(tool);
      // Freehand puts its points down while the pointer moves, so a plain
      // click in that mode is just a single point like the free mode.
      const mode = drawMode === 'freehand' ? 'free' : drawMode;
      const nodes = pathDataOf(useEditor.getState().project, path)?.nodes ?? [];
      const plan = planDraw(mode, nodes, point, ANGLE_STEP, snap);
      // After the plan, not before it: an arc interpolates the height of its
      // intermediate points, and in 'offset' mode each of them has to sample
      // the ground it actually passes over.
      applyDrawHeight(plan.points, drawCfg, groundAt);
      useEditor.getState().addNodes(path, plan.points);
      const what = tool === 'drawTrack' ? 'Track' : tool === 'drawPit' ? 'Pit lane' : 'Road';
      setStatus(
        plan.radius > 0
          ? `${what}: ${plan.length.toFixed(0)} m bend, radius ${plan.radius.toFixed(0)} m`
          : plan.points.length === 1 && plan.length > 0
            ? `${what}: ${plan.length.toFixed(0)} m at ${plan.heading.toFixed(0)}°${where}`
            : `${what} point added${where}`,
      );
    } else if (tool === 'place') {
      const pose = resolvePlacementPose(e.point, e.nativeEvent.altKey);
      const prefab = prefabOf(placeKind);
      // Say which rule decided the position. A snap that failed to catch used
      // to look exactly like one that worked, so the only way to find out was
      // to fly down to ground level and look along the seam.
      const how =
        pose.rule === 'flush' ? 'flush against its neighbour'
          : pose.rule === 'grid' ? `on the ${snap} m grid`
            : 'freely';
      if (prefab) {
        useEditor.getState().placePrefab(prefab.key, pose.pos, pose.rotY);
        setStatus(`Placed ${prefab.label} ${how}`);
      } else {
        addProp(placeKind, pose.pos, pose.rotY);
        setStatus(`Placed ${LIBRARY_BY_KEY.get(placeKind)?.label ?? placeKind} ${how}`);
      }
    } else if (tool === 'barrier' && barrierMode === 'free') {
      /*
       * Drawing a free barrier, one leg per click: the first click sets where
       * the run starts, every click after it lays modules from there to here
       * and becomes the new start. That is the same rhythm as the track tool,
       * which is what "like drawing the track" has to mean to be worth having.
       */
      const s = useEditor.getState();
      const draft = s.barrierDraft;
      // Clicked near the generated barrier, the click means THAT line: the run
      // starts or ends exactly where the trackside barrier stands, so the two
      // join instead of nearly joining.
      const snappedWall = snapToWallLine(point, derived, s.project.road.wallCuts ?? []);
      if (snappedWall) point.copy(snappedWall);
      const here: [number, number, number] = [point.x, point.y, point.z];
      if (draft.length === 0) {
        s.setBarrierDraft([here]);
        setStatus(snappedWall
          ? 'Barrier started on the trackside barrier. Click again to run it there; Esc ends the run.'
          : 'Barrier started. Click again to run it there; Esc ends the run.');
        return;
      }
      // A leg aimed at the wall line must LAND on it: the heading and length
      // steps would round the endpoint back off the very line it snapped to.
      const exact = e.nativeEvent.altKey || snappedWall !== null;
      const plan = planBarrierLeg(draft, point, drawMode, exact ? 0 : ANGLE_STEP,
        exact ? 0 : snap);
      const last = draft[draft.length - 1];
      /*
       * A leg that ENDS on the barrier has to arrive at the barrier's height,
       * not at the ground's. Every planned point took the terrain, snapped
       * endpoint included, which threw the join away again the moment it was
       * made -- the barrier's foot stands on the road's shoulder and that is
       * metres above the ground beside it on any circuit with relief.
       */
      const legPts = plan.map((p, k) => ({
        x: p.x,
        y: snappedWall && k === plan.length - 1 ? point.y : groundAt(p.x, p.z),
        z: p.z,
      }));
      const line = densifyRun([{ x: last[0], y: last[1], z: last[2] }, ...legPts], groundAt);
      // Anything standing clear of the ground was put there on purpose -- a
      // join to the barrier at either end -- and must not be sat back down on
      // the terrain the next time it is sculpted.
      const lifted = snappedWall !== null
        || Math.abs(last[1] - groundAt(last[0], last[2])) > 0.1;
      const n = s.addBarrierRun(line, !lifted);
      s.setBarrierDraft([...draft, ...line.slice(1).map((p) => [p.x, p.y, p.z] as [number, number, number])]);
      setStatus(
        n === 0
          ? 'Too short for even one module'
          : `${n} x ${LIBRARY_BY_KEY.get(s.barrierKind)?.label ?? s.barrierKind} over ${runLength(line).toFixed(0)} m`,
      );
    } else if (tool === 'select') {
      select(null);
      useEditor.getState().setMarked([]);
    }
  };

  const geo = view.terrain ? derived.terrainDef?.geometry : undefined;

  /*
   * One material per painted ground material, in the order the mesh was cut.
   *
   * Where the user has painted gravel there is no grass triangle underneath it
   * to shine through or fight for the depth buffer -- the same triangle is
   * simply drawn as gravel. Unpainted, this stays the single material the
   * ground has always had and the mesh is drawn in one call.
   */
  const cheapGround = quality !== 'high';
  const terrainMaterial = useMemo(() => {
    const parts = derived.terrainDef?.groups;
    if (!parts) return surfaceMaterial('terrain', cheapGround, view.wireframe, true);
    return parts.map((p) => surfaceMaterial(p.material, cheapGround, view.wireframe, true));
  }, [derived.terrainDef, cheapGround, view.wireframe]);

  // Move and leave handlers only exist while the sculpt tool is active.
  // react-three-fiber raycasts on every pointermove for any object carrying a
  // move handler, and builds a copy of the native event for each hit. With the
  // ground permanently subscribed, simply orbiting the camera was running a ray
  // test and allocating tens of kilobytes on every frame, for a brush ring that
  // is not even drawn unless you are sculpting.
  // The place tool opts in as well, because a preview that does not follow the
  // cursor is no preview at all.
  // The draw tools opt in too: the line showing what the next click will add
  // has to follow the pointer, and freehand puts its points down from a move.
  // The free barrier tool needs the cursor for the same reason the draw tools
  // do: it is drawing a line, and a line you cannot see before you commit to it
  // is a guess.
  // The eraser is a brush like the other two, so it needs the ring under the
  // pointer; Select needs the moves to rubber band a marquee out.
  const freeBarrier = tool === 'barrier' && barrierMode === 'free';
  const handlers =
    tool === 'terrain' || tool === 'ground' || tool === 'place' || tool === 'scatter'
    || isDrawTool(tool) || tool === 'erase' || freeBarrier
    || (tool === 'select' && boxing)
      ? { onPointerDown, onPointerUp, onPointerMove, onPointerLeave: () => setCursor(null) }
      : { onPointerDown, onPointerUp };

  const previewPath = isDrawTool(tool) ? drawPreviewPath(tool) : null;
  const drawPreview = previewPath && cursor && (
    <DrawPreview
      path={previewPath}
      cursor={cursor}
      exact={placeExact}
      groundAt={groundAt}
    />
  );

  const barrierPreview = freeBarrier && cursor && barrierDraft && (
    <BarrierRunPreview from={barrierDraft} cursor={cursor} exact={placeExact} derived={derived} />
  );

  const ghost = tool === 'place' && cursor && (
    <GhostProp
      point={cursor}
      exact={placeExact}
      terrain={project.terrain}
      heights={derived.terrainHeights}
      drag={padDrag}
    />
  );

  /* What the ground tool is about to paint, in the colour it will paint it.
     A shape you cannot see before you commit to it is a guess, and this one
     covers ground rather than standing on it, so the outline follows the
     terrain instead of floating over it. */
  const groundPreview = tool === 'ground' && (
    <GroundShapePreview
      rect={groundRect}
      draft={ground.mode === 'polygon' ? groundDraft : []}
      cursor={cursor}
      colour={erasing.current ? '#ff6b6b' : MATERIAL_COLORS[GROUND_KINDS[ground.kind].material] ?? '#ffb02e'}
      groundAt={groundAt}
    />
  );

  // Without the ground there is nothing for the pointer to land on, so drawing
  // and placing would silently do nothing. A flat plane stands in for it.
  if (!geo) {
    return (
      <group>
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, project.terrain.base, 0]}
          material={surfaceMaterial('terrain', true, view.wireframe)}
          {...handlers}
        >
          <planeGeometry args={[Math.max(4000, project.terrain.size * 3), Math.max(4000, project.terrain.size * 3)]} />
        </mesh>
        {ghost}
      </group>
    );
  }

  return (
    <group>
      {/* The ground covers more pixels than anything else in the scene, so it
          is the first thing worth shading cheaply below High. */}
      <mesh
        geometry={geo}
        material={terrainMaterial}
        raycast={pick}
        {...handlers}
      />

      {ghost}
      {drawPreview}
      {barrierPreview}
      {marqueeRect && <MarqueeBoxMesh box={marqueeRect} groundAt={groundAt} />}
      <MarkedProps terrain={project.terrain} heights={derived.terrainHeights} />

      {groundPreview}

      {(tool === 'terrain' || tool === 'scatter' || tool === 'erase'
        || (tool === 'ground' && ground.mode === 'brush')) && cursor && (
        <mesh
          position={[cursor.x, cursor.y + 0.2, cursor.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={
            tool === 'scatter' ? scatter.radius
              : tool === 'erase' ? eraseRadius
                : tool === 'ground' ? ground.radius
                  : brush.radius
          }
          // Red for anything that takes things away, amber for anything that
          // adds or shapes: the eraser and the Alt-held plant brush are the
          // same gesture with the same consequence, so they read the same.
          material={basicMaterial(
            tool === 'erase' || (tool === 'scatter' && erasing.current) ? '#ff6b6b' : '#ffb02e',
            0.75,
            false,
          )}
          raycast={() => null}
        >
          <ringGeometry args={[0.94, 1, 48]} />
        </mesh>
      )}
    </group>
  );
}

/** The rubber band itself: an outline lying on the ground. */
function MarqueeBoxMesh({
  box,
  groundAt,
}: {
  box: MarqueeBox;
  groundAt: (x: number, z: number) => number;
}) {
  const points = useMemo(() => {
    const xa = Math.min(box.x0, box.x1);
    const xb = Math.max(box.x0, box.x1);
    const za = Math.min(box.z0, box.z1);
    const zb = Math.max(box.z0, box.z1);
    const corners: Array<[number, number]> = [[xa, za], [xb, za], [xb, zb], [xa, zb], [xa, za]];
    // Sampled along each edge, not just at the corners: on a hillside a box
    // drawn between two corner heights cuts through the ground in the middle.
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[i + 1];
      for (let k = 0; k < 8; k++) {
        const t = k / 8;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        out.push(new THREE.Vector3(x, groundAt(x, z) + 0.4, z));
      }
    }
    out.push(out[0].clone());
    return out;
  }, [box, groundAt]);

  return <Line points={points} color="#f4afc6" lineWidth={2} dashed={false} raycast={() => null} />;
}

/**
 * A ring around everything the marquee picked out.
 *
 * Not a highlight on the objects themselves: they are drawn in shared instanced
 * batches, so tinting one instance means either a second material and a second
 * draw call per marked object, or an instance colour attribute rebuilt on every
 * change. A ring on the ground says the same thing for one draw call however
 * many are marked -- and it stays visible when the object is behind something.
 */
function MarkedProps({
  terrain,
  heights,
}: {
  terrain: TerrainSettings;
  heights: Float32Array;
}) {
  const marked = useEditor((s) => s.marked);
  const props = useEditor((s) => s.project.props);
  const ref = useRef<THREE.InstancedMesh>(null);

  const list = useMemo(() => {
    if (marked.length === 0) return [];
    const want = new Set(marked);
    return props.filter((p) => want.has(p.id));
  }, [marked, props]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh || list.length === 0) return;
    const m = matrixScratch;
    for (let i = 0; i < list.length; i++) {
      const inst = list[i];
      const box = propTileBox(inst.kind);
      const r = Math.max(1, Math.hypot(box.hx * inst.s[0], box.hz * inst.s[2]));
      const y = sampleHeights(terrain, heights, inst.p[0], inst.p[2]);
      m.makeRotationX(-Math.PI / 2);
      m.scale(new THREE.Vector3(r, r, 1));
      m.setPosition(inst.p[0], y + 0.25, inst.p[2]);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [list, terrain, heights]);

  if (list.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, list.length]}
      frustumCulled={false}
      raycast={NO_RAYCAST}
      material={basicMaterial('#f4afc6', 0.9, false)}
    >
      <ringGeometry args={[0.86, 1, 24]} />
    </instancedMesh>
  );
}

/**
 * What the next click of the free barrier tool would add.
 *
 * The drawn run is not a spline -- it is a list of clicked points -- but the
 * modes that decide where a click LANDS are exactly the ones the track tool
 * uses, so `planDraw` does the work. It wants control points, and the run's
 * points are the only part of one it reads.
 */
function planBarrierLeg(
  draft: Array<[number, number, number]>,
  target: THREE.Vector3,
  mode: DrawMode,
  angleStep: number,
  lengthStep: number,
): THREE.Vector3[] {
  const nodes = draft.map((p) => ({ p }) as unknown as TrackNode);
  return planDraw(mode === 'freehand' ? 'free' : mode, nodes, target, angleStep, lengthStep).points;
}

/**
 * How close a free barrier click has to land to the generated barrier's line
 * before it is taken to MEAN that line. Handed the exact line, the run drawn
 * away from a corner carries straight on from the trackside fence instead of
 * starting a hand's width off it with a slit of daylight between the two.
 */
const WALL_SNAP_REACH = 3;

/**
 * How much further an END of the barrier reaches than the middle of a run.
 *
 * Drawing a fence up to a barrier almost always means joining the END of one:
 * where the trackside barrier stops -- at a gate, where the painted run runs
 * out, or where a stretch has been taken out by hand -- and carrying on from
 * exactly there. A plain nearest-point search cannot express that, because the
 * middle of the run is nearer from almost everywhere. So an end gets a wider
 * catch and wins ties against the line it belongs to.
 */
const WALL_END_REACH = 7;

/** Where the barrier stands at a cross section, or null if it does not. */
function wallPointAt(
  derived: Derived,
  side: -1 | 1,
  i: number,
  out: THREE.Vector3,
): THREE.Vector3 | null {
  const f = derived.trackFrames[i];
  const p = derived.profile;
  if (!f) return null;
  const off = side < 0
    ? f.widthL + p.kerbWL[i] + p.apronL[i] + p.runoffL[i] + p.wallGapL[i]
    : f.widthR + p.kerbWR[i] + p.apronR[i] + p.runoffR[i] + p.wallGapR[i];
  const rx = f.right.x;
  const rz = f.right.z;
  const len = Math.hypot(rx, rz) || 1;
  return out.set(
    f.pos.x + (rx / len) * side * off,
    f.pos.y,
    f.pos.z + (rz / len) * side * off,
  );
}

/**
 * The point on the generated barrier a free run should start or finish at.
 *
 * Knows about the stretches taken out by hand: there is nothing to join in the
 * middle of an opening, and the two places a drawn fence most wants to meet
 * are its edges. Without that the tool cheerfully snapped a run onto barrier
 * that is not there any more, and a fence drawn to close a gap started in
 * mid-air a metre inside it.
 */
function snapToWallLine(
  point: THREE.Vector3,
  derived: Derived,
  cuts: ReadonlyArray<{ side: -1 | 1; from: number; to: number }>,
): THREE.Vector3 | null {
  const frames = derived.trackFrames;
  const p = derived.profile;
  if (!frames || frames.length === 0 || !p) return null;

  const inCut = (side: -1 | 1, t: number) =>
    cuts.some((c) => c.side === side
      && (c.from <= c.to ? t >= c.from && t <= c.to : t >= c.from || t <= c.to));

  let best: THREE.Vector3 | null = null;
  // Scored, not measured: an end within WALL_END_REACH beats a mid-run point
  // that happens to be a little nearer, which is what "join it up" means.
  let bestScore = 1;
  const here = new THREE.Vector3();

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    // Cheap gate first: the barrier is never further from the centre line than
    // the edge plus its gap, so a frame 60 m away cannot win and need not
    // build a vector.
    if (Math.hypot(f.pos.x - point.x, f.pos.z - point.z) > WALL_END_REACH + 40) continue;
    for (const side of [-1, 1] as const) {
      const flags = side < 0 ? p.wallL : p.wallR;
      if (flags[i] !== 1 || inCut(side, f.t)) continue;
      if (!wallPointAt(derived, side, i, here)) continue;
      const d = Math.hypot(here.x - point.x, here.z - point.z);

      /* An end is a standing cross section whose neighbour is not one --
         because the painted run stops, or because a cut begins there. */
      const standing = (j: number) => {
        const k = j < 0 || j >= frames.length ? -1 : j;
        if (k < 0) return false;
        return flags[k] === 1 && !inCut(side, frames[k].t);
      };
      const isEnd = !standing(i - 1) || !standing(i + 1);

      const reach = isEnd ? WALL_END_REACH : WALL_SNAP_REACH;
      if (d >= reach) continue;
      const score = d / reach;
      if (score < bestScore) {
        bestScore = score;
        best = (best ?? new THREE.Vector3()).copy(here);
      }
    }
  }
  return best;
}

/**
 * Put a ground-sampled point every few metres along a drawn leg.
 *
 * The clicks only say where a leg starts and ends, so a straight leg over a
 * hill used to be one straight module chain THROUGH the hill. Sampling the
 * ground along the way gives the run the profile of the land it stands on,
 * which the modules then follow piece by piece.
 *
 * The ends keep whatever height they were given, and the difference between
 * that and the ground under them is carried across the leg rather than
 * dropped at the first sample. That is what lets a run START on the trackside
 * barrier: its foot stands on the outer edge of the run off, which is part of
 * the ROAD and not of the terrain -- measured on a generated circuit, an
 * average of 2.7 m above the ground beside it and as much as 15 m on an
 * embankment. Sampled straight, the first module dived to the terrain and the
 * join was a cliff; carried, the fence leaves the barrier at its own height
 * and settles onto the ground over the length of the leg.
 */
function densifyRun(
  line: Array<{ x: number; y: number; z: number }>,
  groundAt: (x: number, z: number) => number,
  step = 4,
): Array<{ x: number; y: number; z: number }> {
  const out: Array<{ x: number; y: number; z: number }> = [];
  const lift = line.map((p) => p.y - groundAt(p.x, p.z));
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    out.push(a);
    const parts = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step);
    for (let k = 1; k < parts; k++) {
      const t = k / parts;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      out.push({ x, y: groundAt(x, z) + lift[i] + (lift[i + 1] - lift[i]) * t, z });
    }
  }
  out.push(line[line.length - 1]);
  return out;
}

/**
 * The outline of the ground shape about to be painted.
 *
 * It is draped over the terrain rather than drawn as a flat ring: this shape
 * becomes ground, and an outline that cuts through a hill on its way across
 * says nothing about where the gravel will actually end up. Every edge is
 * walked in short steps and each step put on the ground under it.
 */
function GroundShapePreview({
  rect,
  draft,
  cursor,
  colour,
  groundAt,
}: {
  rect: GroundRect | null;
  draft: Array<[number, number]>;
  cursor: THREE.Vector3 | null;
  colour: string;
  groundAt: (x: number, z: number) => number;
}) {
  const points = useMemo(() => {
    const ring: Array<{ x: number; z: number }> = [];
    if (rect) {
      const hx = rect.w / 2;
      const hz = rect.l / 2;
      ring.push(
        { x: rect.x - hx, z: rect.z - hz },
        { x: rect.x + hx, z: rect.z - hz },
        { x: rect.x + hx, z: rect.z + hz },
        { x: rect.x - hx, z: rect.z + hz },
        { x: rect.x - hx, z: rect.z - hz },
      );
    } else if (draft.length > 0) {
      for (const [x, z] of draft) ring.push({ x, z });
      if (cursor) ring.push(groundPoint(cursor.x, cursor.z));
      // Shown closed from three corners on, because that is the shape that
      // would be painted if it were closed right now.
      if (ring.length >= 3) ring.push(ring[0]);
    }
    if (ring.length < 2) return null;

    const out: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 8));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        out.push(new THREE.Vector3(x, groundAt(x, z) + 0.3, z));
      }
    }
    const last = ring[ring.length - 1];
    out.push(new THREE.Vector3(last.x, groundAt(last.x, last.z) + 0.3, last.z));
    return out;
  }, [rect, draft, cursor, groundAt]);

  if (!points) return null;
  const first = draft[0];
  return (
    <>
      <Line points={points} color={colour} lineWidth={3} raycast={() => null} />
      {/* The corner that closes the outline, so it is clear which one to
          click again rather than having to remember where it was. */}
      {!rect && first && draft.length >= 3 && (
        <mesh
          position={[first[0], groundAt(first[0], first[1]) + 0.35, first[1]]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={closeReach(useEditor.getState().ground.radius)}
          material={basicMaterial(colour, 0.85, false)}
          raycast={() => null}
        >
          <ringGeometry args={[0.85, 1, 24]} />
        </mesh>
      )}
    </>
  );
}

function BarrierRunPreview({
  from,
  cursor,
  exact,
  derived,
}: {
  from: Array<[number, number, number]>;
  cursor: THREE.Vector3;
  exact: boolean;
  derived: Derived;
}) {
  const drawMode = useEditor((s) => s.drawMode);
  const snap = useEditor((s) => s.snap);
  const cuts = useEditor((s) => s.project.road.wallCuts);
  const points = useMemo(() => {
    if (from.length === 0) return null;
    const target = cursor.clone();
    // The same wall snap the click applies, so the preview shows the join the
    // click is about to make rather than the near miss the cursor is on.
    const onWall = snapToWallLine(target, derived, cuts ?? []);
    if (onWall) target.copy(onWall);
    else if (snap > 0 && !exact) {
      target.x = Math.round(target.x / snap) * snap;
      target.z = Math.round(target.z / snap) * snap;
    }
    const free = exact || onWall !== null;
    const leg = planBarrierLeg(from, target, drawMode, free ? 0 : ANGLE_STEP, free ? 0 : snap);
    const last = from[from.length - 1];
    return [new THREE.Vector3(last[0], last[1], last[2]), ...leg].map(
      (p) => new THREE.Vector3(p.x, p.y + 0.6, p.z),
    );
  }, [from, cursor, drawMode, snap, exact, derived, cuts]);

  if (!points || points.length < 2) return null;
  // Green rather than the track tool's yellow: this line becomes a barrier, and
  // green is what the barrier handles already use for "there is one here".
  return <Line points={points} color="#5ad07a" lineWidth={3} dashed={false} raycast={() => null} />;
}

/**
 * The line the next click would draw.
 *
 * Straight and curve modes both move the click somewhere else -- onto a locked
 * heading, or around an arc that leaves the last point tangentially -- and a
 * tool that quietly puts a point somewhere other than where you clicked has to
 * show you where before you commit to it. Free mode shows the plain rubber band
 * to the last point, which is worth having on its own.
 */
/** Stable empty list, so the selector above keeps its identity. */
const EMPTY_NODES: TrackNode[] = [];

function DrawPreview({
  path,
  cursor,
  exact,
  groundAt,
}: {
  path: PathId;
  cursor: THREE.Vector3;
  exact: boolean;
  groundAt: (x: number, z: number) => number;
}) {
  const nodes = useEditor((s) => pathDataOf(s.project, path)?.nodes ?? EMPTY_NODES);
  const drawMode = useEditor((s) => s.drawMode);
  const drawCfg = useEditor((s) => s.drawCfg);
  const snap = useEditor((s) => s.snap);

  const points = useMemo(() => {
    if (nodes.length === 0) return null;
    const last = nodes[nodes.length - 1];
    const target = cursor.clone();
    if (snap > 0 && !exact) {
      target.x = Math.round(target.x / snap) * snap;
      target.z = Math.round(target.z / snap) * snap;
    }
    const mode = drawMode === 'freehand' ? 'free' : drawMode;
    const plan = planDraw(mode, nodes, target, exact ? 0 : ANGLE_STEP, exact ? 0 : snap);
    // The preview has to show the height the click will actually store, or a
    // track drawn at a fixed level looks like it is following the hillside
    // right up until it is placed somewhere else.
    applyDrawHeight(plan.points, drawCfg, groundAt);
    const start = new THREE.Vector3(last.p[0], last.p[1], last.p[2]);
    // Lifted clear of the ground so it is not half buried in a slope.
    return [start, ...plan.points].map((p) => new THREE.Vector3(p.x, p.y + 0.6, p.z));
  }, [nodes, cursor, drawMode, drawCfg, snap, exact, groundAt]);

  if (!points || points.length < 2) return null;
  return (
    <>
      <Line points={points} color="#ffd34d" lineWidth={2} dashed={false} raycast={() => null} />
      <mesh position={points[points.length - 1]} raycast={() => null} material={basicMaterial('#ffd34d', 0.9, false)}>
        <sphereGeometry args={[1.4, 10, 8]} />
      </mesh>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Spline control points                                               */
/* ------------------------------------------------------------------ */

/**
 * drei's Line rebuilds its geometry whenever the points array changes identity,
 * so the array has to be memoised or every single render re-uploads the line.
 *
 * With the select tool active it carries a second, invisible copy of itself
 * that is wide enough to hit: Alt+clicking it inserts a control point right
 * there, which is the only way to add a point in the middle of a track.
 */
function CentreLine({
  pathId,
  frames,
  closed,
  color,
  pickable,
}: {
  pathId: PathId;
  frames: Frame[];
  closed: boolean;
  color: string;
  pickable: boolean;
}) {
  const points = useMemo(() => {
    const pts = decimate(frames, 300).map(
      (f) => [f.pos.x, f.pos.y + 0.12, f.pos.z] as [number, number, number],
    );
    if (closed && pts.length > 0) pts.push(pts[0]);
    return pts;
  }, [frames, closed]);

  /*
   * The lookup is built when a click arrives, not per render. `frames` is a new
   * array on every frame of a drag, so memoising it here would rebuild a
   * spatial index sixty times a second for something nothing reads until
   * somebody Alt+clicks.
   */
  const index = useRef<{ frames: Frame[]; lookup: PointIndex } | null>(null);
  const nearestFrame = (x: number, z: number): Frame | null => {
    if (index.current?.frames !== frames) {
      index.current = { frames, lookup: new PointIndex(frames.map((f) => f.pos), 25) };
    }
    const i = index.current.lookup.nearest(x, z);
    return i >= 0 ? frames[i] : null;
  };

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    // Without Alt the click is let through on purpose: it lands on the ground
    // underneath and clears the selection, which is what it always did.
    if (!e.nativeEvent.altKey || e.button !== 0) return;
    e.stopPropagation();

    const s = useEditor.getState();
    // Pick the full frame nearest the hit rather than the hit itself, so the
    // new point sits on the centre line and at the height of the road.
    const frame = nearestFrame(e.point.x, e.point.z);
    if (!frame) return;

    const path = pathDataOf(s.project, pathId);
    if (!path) return;
    const at = frame.pos.clone();
    if (s.snap > 0) {
      at.x = Math.round(at.x / s.snap) * s.snap;
      at.z = Math.round(at.z / s.snap) * s.snap;
    }
    const id = s.addNode(pathId, at, segmentStartId(path, frame) ?? undefined);
    s.select({ kind: 'node', path: pathId, id });
    s.setStatus(`Point inserted into the ${pathLabelOf(s.project, pathId)}`);
  };

  if (points.length < 2) return null;
  return (
    <>
      <Line points={points} color={color} lineWidth={1.6} transparent opacity={0.85} depthTest={false} />
      {pickable && (
        // Fully transparent rather than invisible: an invisible object is not
        // raycast at all, and this one exists purely to be hit. No move handler
        // either, a wide line is expensive to test against on every mouse move.
        <Line
          points={points}
          color={color}
          lineWidth={14}
          transparent
          opacity={0}
          depthTest={false}
          depthWrite={false}
          onPointerDown={onPointerDown}
        />
      )}
    </>
  );
}

/** Which point a shift click should measure the new section from. */
function anchorFor(selection: Selection | null, path: PathId): string | null {
  if (!selection) return null;
  if (selection.kind === 'node' && selection.path === path) return selection.id;
  if (selection.kind === 'section' && selection.path === path) return selection.fromId;
  return null;
}

function sectionIds(project: Project, selection: Selection): Set<string> {
  if (selection.kind !== 'section') return new Set();
  const path = pathDataOf(project, selection.path);
  if (!path) return new Set();
  return new Set(sectionNodes(path, selection.fromId, selection.toId).map((n) => n.id));
}

/** The sampled centre line a PathId is drawn with, for handles and highlights. */
function framesOfPath(derived: Derived, path: PathId): Frame[] {
  if (path === 'track') return derived.trackFrames;
  if (path === 'pit') return derived.pitFrames;
  const id = roadIdOf(path);
  return derived.decoLines.find((l) => l.id === id)?.frames ?? [];
}

/* Scratch for the section drag, so a pointer move allocates nothing. */
const dragPlane = new THREE.Plane();
const dragHit = new THREE.Vector3();
const dragNormal = new THREE.Vector3();
const GROUND_UP = new THREE.Vector3(0, 1, 0);

interface SectionDrag {
  pointerId: number;
  path: PathId;
  fromId: string;
  toId: string;
  /** Shift at grab time means "up and down" instead of "across the ground". */
  vertical: boolean;
  /** Where the ray met the drag plane when the section was grabbed. */
  grab: THREE.Vector3;
  /** Total offset the pointer is asking for, after snapping. */
  want: THREE.Vector3;
  /** Total offset already written into the project. */
  applied: THREE.Vector3;
}

/**
 * Highlight the stretch of road a section selection covers, and let it be
 * dragged straight from the viewport.
 *
 * Moving a run of points used to mean typing numbers into the panel. Grabbing
 * the yellow line and pulling is the obvious gesture, so it does that: across
 * the ground normally, up and down with Shift held when you grab.
 */
function SectionHighlight({ derived }: { derived: Derived }) {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const [hover, setHover] = useState(false);
  const drag = useRef<SectionDrag | null>(null);
  useCursor(hover, 'grab');

  /* Write at most once per ~60 Hz tick, exactly like the gizmo does: every
     write rebuilds the road, and the pointer fires far more often than that. */
  const queued = useRef(false);
  const lastWrite = useRef(0);

  const flush = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    const dx = d.want.x - d.applied.x;
    const dy = d.want.y - d.applied.y;
    const dz = d.want.z - d.applied.z;
    if (dx === 0 && dy === 0 && dz === 0) return;
    d.applied.copy(d.want);
    // Self arming, so the heavy derived work sits the drag out even if no
    // other code path happened to mark the editor busy.
    useEditor.getState().markBusy();
    useEditor.getState().live((p) => {
      const data = pathDataOf(p, d.path);
      if (data) translateSection(data, d.fromId, d.toId, dx, dy, dz);
    });
  }, []);

  const queueFlush = useCallback(() => {
    if (queued.current) return;
    queued.current = true;
    requestAnimationFrame((now) => {
      queued.current = false;
      if ((now - lastWrite.current) / 1000 < MIN_UPDATE_INTERVAL) return;
      lastWrite.current = now;
      flush();
    });
  }, [flush]);

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    flush();
    drag.current = null;
    if (controls) controls.enabled = true;
    // Let the last live edit land before the expensive rebuild is allowed back.
    setTimeout(() => useEditor.setState({ interacting: false }), 0);
  }, [controls, flush]);

  // Unmounting mid drag (Escape clears the selection) must not leave the orbit
  // controls switched off for good.
  useEffect(
    () => () => {
      if (drag.current && controls) controls.enabled = true;
    },
    [controls],
  );

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    const sel = useEditor.getState().selection;
    if (e.button !== 0 || sel?.kind !== 'section' || drag.current) return;
    e.stopPropagation();
    (e.target as unknown as Element | null)?.setPointerCapture?.(e.pointerId);

    const vertical = e.nativeEvent.shiftKey;
    if (vertical) {
      // A plane facing the camera, so pulling up the screen means up in the
      // world no matter which way the camera is pointing.
      dragNormal.set(0, 0, -1).applyQuaternion(camera.quaternion);
      dragNormal.y = 0;
      if (dragNormal.lengthSq() < 1e-8) dragNormal.set(0, 0, 1);
      dragPlane.setFromNormalAndCoplanarPoint(dragNormal.normalize(), e.point);
    } else {
      // The ground at the height it was grabbed at, so the run keeps its level.
      dragPlane.setFromNormalAndCoplanarPoint(GROUND_UP, e.point);
    }
    if (!e.ray.intersectPlane(dragPlane, dragHit)) return;

    drag.current = {
      pointerId: e.pointerId,
      path: sel.path,
      fromId: sel.fromId,
      toId: sel.toId,
      vertical,
      grab: dragHit.clone(),
      want: new THREE.Vector3(),
      applied: new THREE.Vector3(),
    };
    useEditor.getState().pushHistory();
    useEditor.setState({ interacting: true });
    if (controls) controls.enabled = false;
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    if (!e.ray.intersectPlane(dragPlane, dragHit)) return;

    const snap = useEditor.getState().snap;
    if (d.vertical) {
      // Height is never snapped: the grid is a ground plan, not a lift shaft.
      d.want.set(0, dragHit.y - d.grab.y, 0);
    } else {
      let dx = dragHit.x - d.grab.x;
      let dz = dragHit.z - d.grab.z;
      if (snap > 0) {
        dx = Math.round(dx / snap) * snap;
        dz = Math.round(dz / snap) * snap;
      }
      d.want.set(dx, 0, dz);
    }
    queueFlush();
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    (e.target as unknown as Element | null)?.releasePointerCapture?.(e.pointerId);
    endDrag();
  };

  const points = useMemo(() => {
    if (selection?.kind !== 'section') return [];
    const path = pathDataOf(project, selection.path);
    if (!path) return [];
    const frames = framesOfPath(derived, selection.path);
    const idx = sectionIndices(path, selection.fromId, selection.toId);
    if (idx.length < 2 || frames.length === 0 || path.nodes.length === 0) return [];

    const spp = frames.length / (path.closed ? path.nodes.length : path.nodes.length - 1);
    const out: [number, number, number][] = [];
    for (let k = 0; k < idx.length - 1; k++) {
      const from = Math.round(idx[k] * spp);
      const steps = Math.round(spp);
      for (let s = 0; s <= steps; s++) {
        const f = frames[(from + s) % frames.length];
        if (f) out.push([f.pos.x, f.pos.y + 0.3, f.pos.z]);
      }
    }
    return out;
  }, [selection, project, derived]);

  if (points.length < 2) return null;
  return (
    <>
      <Line
        points={points}
        color={hover ? '#fff0a8' : '#ffd54a'}
        lineWidth={hover ? 6.5 : 5}
        depthTest={false}
        raycast={() => null}
      />
      {/* The grab target. drei's Line is raycast in screen space, so five
          pixels of visible line is a frustrating thing to aim at; this one is
          wide enough to catch and fully transparent rather than invisible,
          because an invisible object is never tested at all. */}
      <Line
        points={points}
        color="#ffd54a"
        lineWidth={16}
        transparent
        opacity={0}
        depthTest={false}
        depthWrite={false}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
      />
    </>
  );
}

function PathNodes({ derived }: { derived: Derived }) {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const select = useEditor((s) => s.select);

  const paths: Array<{ id: PathId; nodes: TrackNode[]; color: string; frames: Frame[]; closed: boolean }> = [
    { id: 'track', nodes: project.track.nodes, color: '#4da3ff', frames: derived.trackFrames, closed: project.track.closed },
    { id: 'pit', nodes: project.pit.nodes, color: '#ff9f43', frames: derived.pitFrames, closed: project.pit.closed },
    ...project.decoRoads.map((r) => ({
      id: `road:${r.id}` as PathId,
      nodes: r.path.nodes,
      color: '#7bd88f',
      frames: derived.decoLines.find((l) => l.id === r.id)?.frames ?? [],
      closed: r.path.closed,
    })),
  ];

  /*
   * On an imported track the control points are a GUIDE, not the geometry.
   *
   * A hand drawn circuit has a dozen of them and they are the thing being
   * edited, so the select tool shows them. A recovered one has four hundred and
   * six -- one every twelve metres -- and at 1.7 m across they cover the track
   * they are supposed to describe and swallow every click meant for the
   * circuit's own objects. So while a track is imported they only appear for
   * the tools that actually move them.
   */
  const drawing = isDrawTool(tool);
  const visible = drawing || (tool === 'select' && !project.acImport);

  // Once per render, not once per control point. This used to build a fresh Set
  // inside the loop for every single node.
  const selectedIds = useMemo(
    () => (selection?.kind === 'section' ? sectionIds(project, selection) : null),
    [selection, project],
  );

  return (
    <group>
      {paths.map((path) => (
        <group key={path.id}>
          <CentreLine
            pathId={path.id}
            frames={path.frames}
            closed={path.closed}
            color={path.color}
            pickable={tool === 'select'}
          />
          {visible &&
            path.nodes.map((n, i) => {
              const sel = selection?.kind === 'node' && selection.path === path.id && selection.id === n.id;
              const inSection =
                selectedIds !== null &&
                selection?.kind === 'section' &&
                selection.path === path.id &&
                selectedIds.has(n.id);
              const isEnd =
                selection?.kind === 'section' &&
                selection.path === path.id &&
                (selection.fromId === n.id || selection.toId === n.id);
              const radius = sel || isEnd ? 2.4 : inSection ? 2.0 : 1.7;
              const colour = sel || isEnd ? '#ffffff' : inSection ? '#ffd54a' : path.color;
              return (
                <group key={n.id} position={[n.p[0], n.p[1] + 0.6, n.p[2]]}>
                  <mesh
                    geometry={UNIT_SPHERE}
                    material={basicMaterial(colour)}
                    scale={radius}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      // Shift extends the current pick into a run of points.
                      const anchor = anchorFor(useEditor.getState().selection, path.id);
                      if (e.nativeEvent.shiftKey && anchor && anchor !== n.id) {
                        select({ kind: 'section', path: path.id, fromId: anchor, toId: n.id });
                      } else {
                        select({ kind: 'node', path: path.id, id: n.id });
                      }
                    }}
                  />
                  {(sel || isEnd) && <Label text={String(i + 1)} position={new THREE.Vector3(0, 6, 0)} size={5} />}
                </group>
              );
            })}
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

function LibraryProp({
  kind,
  matrix,
  selected,
  cheap,
}: {
  kind: string;
  matrix: THREE.Matrix4;
  selected: boolean;
  cheap: boolean;
}) {
  const parts = useMemo(() => propParts(kind), [kind]);
  return (
    <group matrixAutoUpdate={false} matrix={matrix}>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geometry} material={propMaterial(p.material, cheap, selected)} />
      ))}
    </group>
  );
}

/** The tint a selected object glows in, library or imported. */
const SELECTED_EMISSIVE = '#4251a8';

/** Shared prop materials, one per look rather than one per placed object. */
const propMaterialCache = new Map<string, THREE.Material>();

function propMaterial(key: MaterialKey, cheap: boolean, selected: boolean): THREE.Material {
  const id = `${key}|${cheap ? 'l' : 's'}|${selected ? 'sel' : ''}`;
  let m = propMaterialCache.get(id);
  if (!m) {
    /*
     * A screen lights itself, so it is drawn at full brightness whatever the
     * sun is doing: the texture again as the emissive map, which lets the
     * lamps carry their own light while the black between them stays black.
     * Without that the panel is a painted board that goes grey in a shadow,
     * and the one thing an LED panel has to look like is lit.
     *
     * Selected still wins. One look for "this is the object you clicked",
     * whether or not the object glows on its own.
     */
    const glow = EMISSIVE.has(key) && !selected;
    const emissive = new THREE.Color(
      selected ? SELECTED_EMISSIVE : glow ? (EMISSIVE_TINT[key] ?? '#ffffff') : '#000000',
    );
    const emissiveMap = glow ? getTexture(key) : null;
    /*
     * The same alpha test the road surfaces get, and for the same reason: the
     * grass cards and the fence panels are pictures with holes in them, and the
     * kn5 asks AC to test them. Without it here the editor showed a solid green
     * slab where the game shows blades of grass, which is the preview lying
     * about the thing it exists to preview.
     */
    const alphaTest = ALPHA_TESTED.has(key) ? 0.5 : 0;
    m = cheap
      ? new THREE.MeshLambertMaterial({ map: getTexture(key), emissive, emissiveMap, alphaTest })
      : new THREE.MeshStandardMaterial({
          map: getTexture(key),
          roughness: 0.85,
          metalness: 0,
          emissive,
          emissiveMap,
          emissiveIntensity: selected ? 0.6 : glow ? 1 : 0,
          alphaTest,
        });
    propMaterialCache.set(id, m);
  }
  return m;
}

/** Cheap value comparison, because every edit clones the project. */
function sameInstance(a: PropInstance, b: PropInstance): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.ground === b.ground &&
    a.p[0] === b.p[0] && a.p[1] === b.p[1] && a.p[2] === b.p[2] &&
    a.r[0] === b.r[0] && a.r[1] === b.r[1] && a.r[2] === b.r[2] &&
    a.s[0] === b.s[0] && a.s[1] === b.s[1] && a.s[2] === b.s[2]
  );
}

interface PropItemProps {
  inst: PropInstance;
  terrain: TerrainSettings;
  heights: Float32Array;
  selected: boolean;
  cheap: boolean;
  assetVersion: number;
  /** Whether the current tool has any use for clicking an object. */
  pickable: boolean;
  onSelect: (id: string) => void;
}

/**
 * One placed object.
 *
 * Memoised on the values rather than on object identity: an edit clones the
 * whole project, so every prop object is new every time even when nothing about
 * it changed. Without this, nudging one tree re-rendered every tree on the map.
 */
const PropItem = memo(
  function PropItem({ inst, terrain, heights, selected, cheap, assetVersion, pickable, onSelect }: PropItemProps) {
    const matrix = propMatrix(inst, terrain, heights);
    return (
      <group
        onPointerDown={
          pickable
            ? (e) => {
                e.stopPropagation();
                onSelect(inst.id);
              }
            : undefined
        }
      >
        {isAssetKind(inst.kind) ? (
          <AssetProp
            assetId={assetIdOf(inst.kind)!}
            matrix={matrix}
            version={assetVersion}
            selected={selected}
          />
        ) : (
          <LibraryProp kind={inst.kind} matrix={matrix} selected={selected} cheap={cheap} />
        )}
      </group>
    );
  },
  (a, b) =>
    a.selected === b.selected &&
    a.cheap === b.cheap &&
    a.pickable === b.pickable &&
    a.assetVersion === b.assetVersion &&
    a.heights === b.heights &&
    a.terrain.res === b.terrain.res &&
    a.terrain.size === b.terrain.size &&
    a.terrain.originX === b.terrain.originX &&
    a.terrain.originZ === b.terrain.originZ &&
    sameInstance(a.inst, b.inst),
);

function AssetProp({
  assetId,
  matrix,
  version,
  selected,
}: {
  assetId: string;
  matrix: THREE.Matrix4;
  version: number;
  selected: boolean;
}) {
  const group = useMemo(() => {
    void version;
    const g = getAsset(assetId);
    return g ? g.clone(true) : null;
  }, [assetId, version]);

  /*
   * Selection has to show on an imported model too.
   *
   * A library object lights up through its shared material, which an imported
   * model has none of -- it brings its own, and `clone` shares them with the
   * cached model and with every other copy on the map. So tinting in place
   * would light up all of them. The selected copy gets its own materials for
   * as long as it is selected, and hands them back afterwards.
   */
  useEffect(() => {
    if (!group || !selected) return;
    const restore: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      restore.push([mesh, mesh.material]);
      const lit = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
        const copy = m.clone() as THREE.Material & { emissive?: THREE.Color; emissiveIntensity?: number };
        if (copy.emissive) {
          copy.emissive.set(SELECTED_EMISSIVE);
          copy.emissiveIntensity = 0.6;
        }
        return copy;
      });
      mesh.material = Array.isArray(mesh.material) ? lit : lit[0];
    });
    return () => {
      for (const [mesh, original] of restore) {
        const used = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.material = original;
        for (const m of used) m.dispose();
      }
    };
  }, [group, selected]);

  if (!group) return null;
  return <primitive object={group} matrixAutoUpdate={false} matrix={matrix} />;
}

/**
 * Every placed object of one kind and one part, drawn in a single call.
 *
 * The obvious layout -- a group per object, a mesh per part -- costs a draw
 * call per part and, worse, puts every one of those groups in react-three-
 * fiber's interaction list, which is walked on every native pointermove rather
 * than once a frame. A few dozen hand placed objects never showed it; a brush
 * that plants hundreds of trees would have made it the whole frame budget.
 */
/**
 * The automatic 3D grass, straight from the derived transforms.
 *
 * One instanced mesh for the lot: the tufts share one geometry and one
 * material, so thirty thousand of them are a single draw call. They are not
 * props -- nothing to select, nothing to erase, no pointer handlers -- which
 * is exactly why they bypass PropsLayer and its per-object bookkeeping.
 */
function Grass3DLayer({ derived }: { derived: Derived }) {
  const quality = useEditor((s) => s.quality);
  const view = useEditor((s) => s.view);
  const terrain = useEditor((s) => s.project.terrain);
  const road = useEditor((s) => s.project.road);
  const trackClosed = useEditor((s) => s.project.track.closed);
  const acImport = useEditor((s) => s.project.acImport);

  /*
   * Grown a beat AFTER the shape settles, never during an editing frame.
   *
   * Everything else derived is computed synchronously in getDerived, but a
   * lawn is thirty thousand placements and the one consumer that cares about
   * it being instant is nobody: while a node is being dragged the old grass
   * is fine, and when the drag ends it can catch up a heartbeat later. Keeping
   * it out of getDerived keeps every editing frame at its budget.
   */
  const [data, setData] = useState<Float32Array>(EMPTY_GRASS3D);
  useEffect(() => {
    if (!terrain.enabled || !terrain.grass3d || acImport) {
      setData(EMPTY_GRASS3D);
      return;
    }
    const timer = window.setTimeout(() => {
      setData(
        grass3dFor(
          terrain,
          derived.terrainHeights,
          road,
          derived.trackFrames,
          trackClosed,
          derived.profile,
          derived.pitDrawFrames,
          derived.pitApron,
          derived.pitClip,
        ),
      );
    }, 150);
    return () => window.clearTimeout(timer);
  }, [terrain, road, trackClosed, acImport, derived.trackFrames, derived.profile, derived.pitDrawFrames]);

  const heights = derived.terrainHeights;
  const count = data.length / GRASS3D_STRIDE;
  const part = useMemo(() => propParts('grass_tuft')[0], []);
  const ref = useRef<THREE.InstancedMesh>(null);

  // The tufts carry no height of their own; they are dropped onto whatever
  // the ground is right now, so sculpting moves the grass with the dirt.
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = matrixScratch;
    const q = quatScratch;
    const p = vecScratchA;
    const s = vecScratchB;
    let wi = 0;
    for (let i = 0; i < count; i++) {
      const o = i * GRASS3D_STRIDE;
      // Tufts standing on ground painted to something other than grass are
      // simply not drawn; the generator does not know about the paint.
      if (!grass3dOnGrass(terrain, data[o], data[o + 1])) continue;
      q.setFromAxisAngle(UP_AXIS, data[o + 2]);
      p.set(data[o], sampleHeights(terrain, heights, data[o], data[o + 1]) + data[o + 4], data[o + 1]);
      const sc = data[o + 3];
      s.set(sc, sc, sc);
      mesh.setMatrixAt(wi, m.compose(p, q, s));
      wi += 1;
    }
    mesh.count = wi;
    mesh.instanceMatrix.needsUpdate = true;
  }, [data, count, terrain, heights]);

  if (!view.props || count === 0 || !part) return null;
  return (
    <instancedMesh
      key={count}
      ref={ref}
      args={[part.geometry, propMaterial(part.material, quality !== 'high', false), count]}
      frustumCulled={false}
    />
  );
}

// UP_AXIS lives further down, next to the other shared scratch values.
const quatScratch = new THREE.Quaternion();
const vecScratchA = new THREE.Vector3();
const vecScratchB = new THREE.Vector3();

function PropInstances({
  geometry,
  material,
  list,
  terrain,
  heights,
  pickable,
  onSelect,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  list: PropInstance[];
  terrain: TerrainSettings;
  heights: Float32Array;
  /** Whether the current tool has any use for clicking an object. */
  pickable: boolean;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    timeEffect('prop matrices', () => {
      const mesh = ref.current;
      if (!mesh) return;
      // One matrix for the whole loop. See writePropMatrix: the allocating
      // version cost seventy thousand short lived objects per brush frame here.
      const m = matrixScratch;
      for (let i = 0; i < list.length; i++) {
        mesh.setMatrixAt(i, writePropMatrix(list[i], terrain, heights, m));
      }
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      // The bounding sphere is only read by frustum culling, which is off here,
      // and by raycasting, which only happens when the objects are pickable.
      // Recomputing it per brush frame is work nobody asks for.
      if (pickable) mesh.computeBoundingSphere();
    });
  }, [list, terrain, heights, pickable]);

  /*
   * Pickable only where picking is the point.
   *
   * react-three-fiber ray tests every object carrying a pointer handler on
   * every native pointermove, and an InstancedMesh tests EVERY instance against
   * the ray, geometry and all. With a few thousand objects that is milliseconds
   * per mouse event, and a gaming mouse sends them faster than they can be
   * answered: a recorded trace showed eighteen moves inside a single 5.6 ms
   * frame, each costing 1.7 ms to raycast. The backlog then grows for as long
   * as the pointer keeps moving and drains when it stops -- which is exactly
   * what a four second freeze at the end of a brush stroke is.
   *
   * Nothing but the Select tool ever picks an object, so everywhere else they
   * come out of the interaction list entirely. `raycast` is turned off as well
   * as the handler: the handler is what puts an object in the list, but this
   * way an object that is in it can still never be tested.
   */
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, Math.max(1, list.length)]}
      frustumCulled={false}
      /*
       * Spelled out both ways round rather than handing back `undefined` for
       * the pickable case. Passing undefined asks react-three-fiber to restore
       * the class default, which is a round trip through its own bookkeeping
       * for a method -- and if it does not, the object stays unpickable for the
       * rest of its life even after the tool changes. Naming the prototype
       * method is the same thing with none of the doubt.
       */
      raycast={pickable ? INSTANCED_RAYCAST : NO_RAYCAST}
      onPointerDown={
        pickable
          ? (e) => {
              if (e.instanceId === undefined) return;
              const hit = list[e.instanceId];
              if (!hit) return;
              e.stopPropagation();
              onSelect(hit.id);
            }
          : undefined
      }
    />
  );
}

function PropsLayer({ derived }: { derived: Derived }) {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const view = useEditor((s) => s.view);
  const quality = useEditor((s) => s.quality);
  const tool = useEditor((s) => s.tool);
  const version = useSyncExternalStore(onAssetsChanged, assetVersion);
  // Only the Select tool picks objects. Everywhere else they are scenery, and
  // scenery has no business being ray tested on every mouse move.
  const pickable = tool === 'select';

  // Stable, so the memo on each item is not defeated by a new function.
  const onSelect = useCallback((id: string) => useEditor.getState().select({ kind: 'prop', id }), []);

  const selectedId = selection?.kind === 'prop' ? selection.id : null;
  const cheap = quality !== 'high';

  /* Imported models and whichever object is selected keep the one-mesh-each
     path: an imported model has no shared geometry to instance, and the
     selected one needs its own material to light up and its own group for the
     transform gizmo to hang off. Everything else batches. */
  const { groups, singles } = useMemo(() => {
    const byPart = new Map<string, { geometry: THREE.BufferGeometry; material: MaterialKey; list: PropInstance[] }>();
    const loose: PropInstance[] = [];
    for (const inst of project.props) {
      if (inst.id === selectedId || isAssetKind(inst.kind)) {
        loose.push(inst);
        continue;
      }
      const parts = propParts(inst.kind);
      if (parts.length === 0) continue;
      parts.forEach((part, i) => {
        const key = `${inst.kind}|${i}`;
        let g = byPart.get(key);
        if (!g) {
          g = { geometry: part.geometry, material: part.material, list: [] };
          byPart.set(key, g);
        }
        g.list.push(inst);
      });
    }
    return { groups: [...byPart.entries()], singles: loose };
  }, [project.props, selectedId]);

  if (!view.props) return null;

  return (
    <group>
      {groups.map(([key, g]) => (
        <PropInstances
          key={key}
          geometry={g.geometry}
          material={propMaterial(g.material, cheap, false)}
          list={g.list}
          terrain={project.terrain}
          heights={derived.terrainHeights}
          /*
           * Ground cover never catches the pointer.
           *
           * There are thousands of tufts and they are ankle high, so every one
           * of them is something between the cursor and what is actually being
           * aimed at -- a control point, a kerb, the ground itself. It is the
           * editor's own version of a collision, and it is the last thing grass
           * should have. It is planted and rubbed out with the brush that made
           * it, and the eraser takes it as well, so nothing is lost by making
           * it transparent to clicks.
           */
          pickable={pickable && !GRASS_KINDS.includes(g.list[0].kind)}
          onSelect={onSelect}
        />
      ))}
      {singles.map((inst) => (
        <PropItem
          key={inst.id}
          inst={inst}
          terrain={project.terrain}
          heights={derived.terrainHeights}
          selected={selectedId === inst.id}
          cheap={cheap}
          assetVersion={version}
          pickable={pickable}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Race markers                                                        */
/* ------------------------------------------------------------------ */

const CAR_L = 4.6;
const CAR_W = 1.95;

/** Lays a plane flat, matching the old `rotation={[-Math.PI / 2, 0, 0]}`. */
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

/**
 * Module constants, not literals in the render body: these arrays sit in the
 * `useLayoutEffect` dependency list of MarkerInstances, and a fresh array per
 * render meant recomposing every instance matrix on every render.
 */
const SLOT_SCALE: [number, number, number] = [CAR_W, CAR_L, 1];
const NOSE_SCALE: [number, number, number] = [0.42, 0.42, 1];

/**
 * Draw a whole set of identical markers in one call.
 *
 * Every grid slot and pit box used to be three draw calls of its own. Firefox
 * runs WebGL in a separate process and ships each draw call across that
 * boundary, so a track with a full grid was sending well over a hundred of them
 * per frame for a handful of little rectangles. One instanced mesh per group
 * sends one.
 */
function MarkerInstances({
  markers,
  colour,
  selected,
  onSelect,
  lift,
  scale,
  geometry,
  nose,
}: {
  markers: Marker[];
  colour: string;
  selected: number | null;
  onSelect?: (index: number) => void;
  lift: number;
  scale: [number, number, number];
  geometry: THREE.BufferGeometry;
  nose?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: nose ? 0.9 : 0.55, depthTest: false }),
    [nose],
  );

  useLayoutEffect(() => timeEffect('marker instances', () => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(...scale);
    const offset = new THREE.Vector3();
    const tint = new THREE.Color();

    markers.forEach((mk, i) => {
      q.copy(mk.quat).multiply(FLAT);
      offset.set(0, lift, nose ? CAR_L / 2 + 0.5 : 0).applyQuaternion(mk.quat);
      p.copy(mk.pos).add(offset);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      tint.set(mk.index === selected ? '#ffffff' : colour);
      mesh.setColorAt(i, tint);
    });

    mesh.count = markers.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }), [markers, selected, colour, lift, scale, nose]);

  if (markers.length === 0) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, markers.length]}
      frustumCulled={false}
      raycast={onSelect ? undefined : () => null}
      onPointerDown={
        onSelect
          ? (e) => {
              e.stopPropagation();
              if (e.instanceId !== undefined) onSelect(markers[e.instanceId].index);
            }
          : undefined
      }
    />
  );
}

/**
 * The little number plates only make sense when you are close enough to read
 * them. Zoomed out to see a two kilometre circuit they are a few unreadable
 * pixels each, and one draw call each.
 */
function useLabelsVisible(): boolean {
  const [visible, setVisible] = useState(true);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3 } | null;

  useFrame(() => {
    const target = controls?.target;
    const d = target ? camera.position.distanceTo(target) : camera.position.length();
    // Hysteresis, so hovering right on the threshold does not flicker.
    if (visible && d > 620) setVisible(false);
    else if (!visible && d < 520) setVisible(true);
  });

  return visible;
}

/* ------------------------------------------------------------------ */
/* Keyboard camera                                                     */
/* ------------------------------------------------------------------ */

type CameraDir = 'forward' | 'back' | 'left' | 'right';

/** Both the letters and the arrow keys, so either hand works. */
const CAMERA_KEYS: Record<string, CameraDir> = {
  w: 'forward',
  a: 'left',
  s: 'back',
  d: 'right',
  arrowup: 'forward',
  arrowleft: 'left',
  arrowdown: 'back',
  arrowright: 'right',
};

/**
 * Scratch vectors on the module, not in the frame callback.
 *
 * This runs on every frame a key is held, and three fresh Vector3s per frame is
 * exactly the kind of steady garbage that shows up as a stutter every few
 * seconds once the collector catches up with it.
 */
const camFwd = new THREE.Vector3();
const camRight = new THREE.Vector3();
const camStep = new THREE.Vector3();

/**
 * WASD flies the camera across the ground.
 *
 * Movement is screen relative and stays in the horizontal plane, and the orbit
 * target travels with the camera, so the orbit centre stays under the mouse and
 * damping is left completely alone. Zoom stays on the wheel.
 */
function CameraKeys() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3 } | null;
  const held = useRef<Set<CameraDir>>(new Set());

  useEffect(() => {
    const keys = held.current;
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      const dir = CAMERA_KEYS[e.key.toLowerCase()];
      if (!dir) return;
      if (typing(e.target)) return;
      // Ctrl+S and friends are shortcuts, not movement, and the browser often
      // eats the matching keyup, which would leave the camera drifting forever.
      if (e.ctrlKey || e.metaKey || e.altKey) {
        keys.delete(dir);
        return;
      }
      keys.add(dir);
    };
    const onUp = (e: KeyboardEvent) => {
      const dir = CAMERA_KEYS[e.key.toLowerCase()];
      if (dir) keys.delete(dir);
    };
    // Alt+Tab away mid-stride and the keyup lands in the other window.
    const clear = () => keys.clear();

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
      keys.clear();
    };
  }, []);

  useFrame((_, delta) => {
    const keys = held.current;
    if (keys.size === 0) return;
    // Never fight a drag for the scene: a gizmo drag owns the camera.
    if (useEditor.getState().interacting) return;
    const target = controls?.target;
    if (!target) return;

    // Forward as seen on screen, flattened onto the ground. Looking straight
    // down leaves nothing to flatten, so the screen up direction stands in.
    camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    camFwd.y = 0;
    if (camFwd.lengthSq() < 1e-8) {
      camFwd.set(0, 1, 0).applyQuaternion(camera.quaternion);
      camFwd.y = 0;
      if (camFwd.lengthSq() < 1e-8) camFwd.set(0, 0, -1);
    }
    camFwd.normalize();
    // right = forward x up for a forward that lies in the ground plane.
    camRight.set(-camFwd.z, 0, camFwd.x);

    camStep.set(0, 0, 0);
    if (keys.has('forward')) camStep.add(camFwd);
    if (keys.has('back')) camStep.sub(camFwd);
    if (keys.has('right')) camStep.add(camRight);
    if (keys.has('left')) camStep.sub(camRight);
    if (camStep.lengthSq() < 1e-8) return;
    camStep.normalize();

    // Zoomed out onto a whole circuit you want to cross hundreds of metres,
    // zoomed in on a kerb you want centimetres. Tie the speed to how far away
    // the camera is looking and both feel the same.
    const distance = THREE.MathUtils.clamp(camera.position.distanceTo(target), 20, 4000);
    // A long frame (a rebuild, a tab switch) must not teleport the camera.
    camStep.multiplyScalar(distance * 0.75 * Math.min(delta, 0.1));

    camera.position.add(camStep);
    target.add(camStep);
  });

  return null;
}

function MarkersLayer({ derived }: { derived: Derived }) {
  const view = useEditor((s) => s.view);
  const selection = useEditor((s) => s.selection);
  const labels = useLabelsVisible();
  const pickGrid = useCallback((index: number) => useEditor.getState().select({ kind: 'grid', index }), []);
  const pickPit = useCallback((index: number) => useEditor.getState().select({ kind: 'pitbox', index }), []);
  if (!view.markers) return null;

  const gridSel = selection?.kind === 'grid' ? selection.index : null;
  const pitSel = selection?.kind === 'pitbox' ? selection.index : null;

  return (
    <group>
      <MarkerInstances markers={derived.markers.grid} colour="#4dd07a" selected={gridSel} onSelect={pickGrid} lift={0.09} scale={SLOT_SCALE} geometry={UNIT_PLANE} />
      <MarkerInstances markers={derived.markers.grid} colour="#ffffff" selected={null} lift={0.12} scale={NOSE_SCALE} geometry={UNIT_CIRCLE} nose />
      <MarkerInstances markers={derived.markers.pits} colour="#ffb02e" selected={pitSel} onSelect={pickPit} lift={0.09} scale={SLOT_SCALE} geometry={UNIT_PLANE} />
      <MarkerInstances markers={derived.markers.pits} colour="#ffffff" selected={null} lift={0.12} scale={NOSE_SCALE} geometry={UNIT_CIRCLE} nose />
      <MarkerInstances markers={derived.markers.hotlap} colour="#a06bff" selected={null} lift={0.1} scale={SLOT_SCALE} geometry={UNIT_PLANE} />

      {labels &&
        derived.markers.grid.map((m) => (
          <Label key={m.name} text={String(m.index + 1)} position={m.pos.clone().setY(m.pos.y + 3.4)} size={4.4} />
        ))}
      {labels &&
        derived.markers.pits.map((m) => (
          <Label key={m.name} text={`P${m.index + 1}`} position={m.pos.clone().setY(m.pos.y + 3.4)} size={4.4} />
        ))}
      {labels &&
        derived.markers.hotlap.map((m) => (
          <Label key={m.name} text="HL" position={m.pos.clone().setY(m.pos.y + 3.4)} color="#c9a8ff" size={4.4} />
        ))}

      {derived.markers.gates.map((g) => (
        <group key={`gate${g.index}`}>
          <Line
            points={[
              [g.left.x, g.left.y + 0.14, g.left.z],
              [g.right.x, g.right.y + 0.14, g.right.z],
            ]}
            color={g.index === 0 ? '#ffffff' : '#ffd54a'}
            lineWidth={g.index === 0 ? 5 : 3}
            depthTest={false}
          />
          <Label
            text={g.index === 0 ? 'S/F' : `S${g.index}`}
            position={new THREE.Vector3(g.left.x, g.left.y + 5, g.left.z)}
            color={g.index === 0 ? '#ffffff' : '#ffd54a'}
            size={7}
          />
        </group>
      ))}

    </group>
  );
}

function AiLayer({ derived }: { derived: Derived }) {
  const view = useEditor((s) => s.view);
  const quality = useEditor((s) => s.quality);
  const points = useMemo(() => {
    const pts = decimate(derived.ai, 400).map(
      (p) => [p.pos.x, p.pos.y + 0.18, p.pos.z] as [number, number, number],
    );
    if (pts.length > 0) pts.push(pts[0]);
    return pts;
  }, [derived.ai]);
  if (!view.aiLine || quality === 'draft' || points.length < 2) return null;
  return <Line points={points} color="#ff4d6d" lineWidth={2.4} transparent opacity={0.9} />;
}

/* ------------------------------------------------------------------ */
/* Barrier painting                                                    */
/* ------------------------------------------------------------------ */

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UP_AXIS = new THREE.Vector3(0, 1, 0);

/** Handle thickness and how far above the ground it floats, in metres. */
const BARRIER_HANDLE_THICK = 0.5;

/**
 * Paint the barrier on and off by dragging along the edge of the road.
 *
 * The barrier is stored per control point as `wallL` / `wallR`, so a stretch
 * of it is whatever lies between two points. Those flags were only reachable
 * through checkboxes in the properties panel, which means finding the right
 * point in a list first and never seeing what you are about to change. Here
 * every stretch gets a handle standing where its barrier stands, or would
 * stand, and clicking it flips the flag behind it.
 *
 * One instanced mesh rather than a mesh per stretch: a long track is hundreds
 * of them, and Firefox ships every draw call across a process boundary.
 */
function BarrierLayer({ derived }: { derived: Derived }) {
  const nodes = useEditor((s) => s.project.track.nodes);
  const closed = useEditor((s) => s.project.track.closed);
  const wallHeight = useEditor((s) => s.project.road.wallHeight);
  const ref = useRef<THREE.InstancedMesh>(null);

  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthTest: false }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  const layout = useMemo(
    () =>
      barrierHandles(
        derived.trackFrames,
        derived.profile,
        nodes.length,
        closed,
        barrierHandleHeight(wallHeight),
        BARRIER_HANDLE_THICK,
      ),
    [derived, nodes.length, closed, wallHeight],
  );

  // Colour follows the control point flags, which is what a click writes to.
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh || !layout) return;
    const m = new THREE.Matrix4();
    const tint = new THREE.Color();
    for (let k = 0; k < layout.count; k++) {
      m.fromArray(layout.matrices, k * 16);
      mesh.setMatrixAt(k, m);
      const node = nodes[layout.nodeOf[k]];
      const on = node ? (layout.sideOf[k] < 0 ? node.wallL : node.wallR) : false;
      tint.set(on ? '#4dd07a' : '#6b7683');
      mesh.setColorAt(k, tint);
    }
    mesh.count = layout.count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [layout, nodes]);

  // While dragging, every handle the pointer touches gets the same value the
  // first one was given, so a stroke never flips things back and forth.
  const painting = useRef<boolean | null>(null);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  /** Set while Shift-dragging a handle sideways to move the barrier. */
  const moving = useRef<{ node: number; side: number; frame: number } | null>(null);

  useEffect(() => {
    const stop = () => {
      painting.current = null;
      if (moving.current) {
        moving.current = null;
        if (controls) controls.enabled = true;
        setTimeout(() => useEditor.setState({ interacting: false }), 0);
      }
    };
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      // Never leave the camera locked if the tool goes away mid drag.
      if (moving.current && controls) controls.enabled = true;
    };
  }, [controls]);

  /**
   * Shift-drag moves the barrier in and out instead of switching it on and
   * off. The pointer ray is met with the horizontal plane the handle stands
   * on, and how far out that lands decides the gap.
   */
  const movePlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hitPoint = useMemo(() => new THREE.Vector3(), []);

  const moveTo = (e: ThreeEvent<PointerEvent>) => {
    const grab = moving.current;
    if (!grab) return;
    const f = derived.trackFrames[grab.frame];
    if (!f) return;
    movePlane.set(UP_AXIS, -f.pos.y);
    if (!e.ray.intersectPlane(movePlane, hitPoint)) return;

    const lateral =
      (hitPoint.x - f.pos.x) * f.right.x + (hitPoint.z - f.pos.z) * f.right.z;
    const { runoffL, runoffR, kerbWL, kerbWR } = derived.profile;
    const i = grab.frame;
    const edge =
      grab.side < 0 ? f.widthL + kerbWL[i] + runoffL[i] : f.widthR + kerbWR[i] + runoffR[i];
    // Out from the centre line on this side, then take off what the road and
    // its run off already occupy: the remainder is the gap.
    const outward = grab.side * lateral;
    const gap = Math.max(-edge + 0.5, Math.min(60, outward - edge));

    useEditor.getState().markBusy();
    useEditor.getState().live((p) => {
      const n = p.track.nodes[grab.node];
      if (!n) return;
      if (grab.side < 0) n.wallGapL = gap;
      else n.wallGapR = gap;
    });
    useEditor.getState().setStatus(`Barrier ${gap >= 0 ? 'out' : 'in'} ${Math.abs(gap).toFixed(1)} m`);
  };

  const paint = (instanceId: number | undefined, starting: boolean) => {
    if (instanceId === undefined || !layout || instanceId >= layout.count) return;
    const index = layout.nodeOf[instanceId];
    const side = layout.sideOf[instanceId];
    const store = useEditor.getState();
    const node = store.project.track.nodes[index];
    if (!node) return;

    if (starting) {
      // One undo step for the whole stroke, like every other drag.
      store.pushHistory();
      painting.current = !(side < 0 ? node.wallL : node.wallR);
    }
    const value = painting.current;
    if (value === null) return;
    if ((side < 0 ? node.wallL : node.wallR) === value) return;

    store.live((p) => {
      const n = p.track.nodes[index];
      if (!n) return;
      if (side < 0) n.wallL = value;
      else n.wallR = value;
    });
    store.setStatus(`Barrier ${value ? 'added' : 'removed'} on the ${side < 0 ? 'left' : 'right'}`);
  };

  if (!layout) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[UNIT_BOX, material, layout.count]}
      frustumCulled={false}
      renderOrder={9}
      onPointerDown={(e) => {
        if (e.button !== 0 || !layout || e.instanceId === undefined) return;
        e.stopPropagation();
        if (e.nativeEvent.shiftKey) {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          moving.current = {
            node: layout.nodeOf[e.instanceId],
            side: layout.sideOf[e.instanceId],
            frame: e.instanceId >> 1,
          };
          useEditor.getState().pushHistory();
          useEditor.setState({ interacting: true });
          if (controls) controls.enabled = false;
          moveTo(e);
        } else {
          paint(e.instanceId, true);
        }
      }}
      onPointerMove={(e) => {
        if (moving.current) {
          e.stopPropagation();
          moveTo(e);
          return;
        }
        if (painting.current === null) return;
        e.stopPropagation();
        paint(e.instanceId, false);
      }}
    />
  );
}

/**
 * Take a short stretch of the generated barrier back out.
 *
 * The painter above writes the per control point flags, so the shortest thing
 * it can say is "no barrier between these two points" -- and on a fast sweeper
 * drawn with points a hundred metres apart, that is a hundred metres of hole
 * to remove ten metres of bad barrier. This works in metres of lap instead:
 * where the pointer lands decides the middle of the gap and the panel decides
 * how long it is, so the same click can take out eight metres or forty. See
 * BarrierCut for what it leaves behind.
 *
 * The same handle band the painter uses, so there is nothing new to aim at,
 * and clicking a stretch that is already open closes it again.
 */
function BarrierCutLayer({ derived }: { derived: Derived }) {
  const nodes = useEditor((s) => s.project.track.nodes);
  const closed = useEditor((s) => s.project.track.closed);
  const wallHeight = useEditor((s) => s.project.road.wallHeight);
  const cutLength = useEditor((s) => s.cutLength);
  const ref = useRef<THREE.InstancedMesh>(null);

  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthTest: false }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  const layout = useMemo(
    () =>
      barrierHandles(
        derived.trackFrames,
        derived.profile,
        nodes.length,
        closed,
        barrierHandleHeight(wallHeight),
        BARRIER_HANDLE_THICK,
      ),
    [derived, nodes.length, closed, wallHeight],
  );

  const cuts = useEditor((s) => s.project.road.wallCuts);

  /* Amber where the barrier still stands, dark where it has been opened, so
     what the next click will do is visible before making it. */
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh || !layout) return;
    const m = new THREE.Matrix4();
    const tint = new THREE.Color();
    const frames = derived.trackFrames;
    for (let k = 0; k < layout.count; k++) {
      m.fromArray(layout.matrices, k * 16);
      mesh.setMatrixAt(k, m);
      const node = nodes[layout.nodeOf[k]];
      const side = layout.sideOf[k] < 0 ? -1 : 1;
      const on = node ? (side < 0 ? node.wallL : node.wallR) : false;
      const t = frames[Math.min(frames.length - 1, k >> 1)]?.t ?? 0;
      const open = cuts.some((c) => c.side === side
        && (c.from <= c.to ? t >= c.from && t <= c.to : t >= c.from || t <= c.to));
      tint.set(!on ? '#3b4149' : open ? '#8a4b2a' : '#e0a33c');
      mesh.setColorAt(k, tint);
    }
    mesh.count = layout.count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [layout, nodes, cuts, derived]);

  if (!layout) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[UNIT_BOX, material, layout.count]}
      frustumCulled={false}
      renderOrder={9}
      onPointerDown={(e) => {
        if (e.button !== 0 || !layout || e.instanceId === undefined) return;
        e.stopPropagation();
        const frames = derived.trackFrames;
        const side = layout.sideOf[e.instanceId] < 0 ? -1 : 1;
        /* Which cross section was hit, not which control point: that is the
           whole point of this tool. The handles run two per section. */
        const i = Math.min(frames.length - 1, e.instanceId >> 1);
        const lap = frames[frames.length - 1].dist;
        const store = useEditor.getState();
        const what = store.cutBarrierAt(side, frames[i].t, cutLength, lap);
        store.setStatus(
          what === 'restored'
            ? `Barrier back on the ${side < 0 ? 'left' : 'right'}`
            : `${cutLength} m of barrier removed on the ${side < 0 ? 'left' : 'right'}`,
        );
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Rows of objects along the edge                                      */
/* ------------------------------------------------------------------ */

/**
 * Lay a row of objects along the edge of the road by dragging over it.
 *
 * The free barrier tool can draw a run anywhere, but the commonest run by far
 * is "tyres along the outside of THIS corner" -- and drawing that freehand
 * against the roadside means eyeballing by hand the very curve the editor
 * already knows exactly. So the same handle band the barrier painter uses
 * doubles as a ruler here: press where the row should start, drag to where it
 * ends, and modules are laid along the edge line at the chosen gap,
 * chord-aligned so their ends meet round a bend (layBarrierRun). What it
 * leaves behind is ordinary objects, movable one by one afterwards.
 */
function EdgeRowLayer({ derived }: { derived: Derived }) {
  const nodes = useEditor((s) => s.project.track.nodes);
  const closed = useEditor((s) => s.project.track.closed);
  const rowGap = useEditor((s) => s.rowGap);
  const ref = useRef<THREE.InstancedMesh>(null);

  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthTest: false }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  const layout = useMemo(
    () =>
      barrierHandles(
        derived.trackFrames,
        derived.profile,
        nodes.length,
        closed,
        0.9,
        BARRIER_HANDLE_THICK,
      ),
    [derived, nodes.length, closed],
  );

  /** The drag in progress: which side, and the stretch it started on. */
  const drag = useRef<{ side: number; first: number } | null>(null);
  /* Held twice like the pad drag: the state draws the highlight, the ref is
     what the release reads -- a state updater must not carry the side effect,
     StrictMode calls updaters twice and would lay the row twice. */
  const rangeRef = useRef<{ side: number; from: number; count: number } | null>(null);
  const [range, setRange] = useState<{ side: number; from: number; count: number } | null>(null);
  const layRowRef = useRef<(r: { side: number; from: number; count: number }) => void>(() => {});

  useEffect(() => {
    const stop = () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const r = rangeRef.current;
      rangeRef.current = null;
      setRange(null);
      if (r) layRowRef.current(r);
    };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  /** The stretches a drag from `first` to `to` covers, the SHORT way round. */
  const rangeTo = (first: number, to: number): { from: number; count: number } => {
    const stretches = layout ? layout.count / 2 : 0;
    let delta = (to >> 1) - (first >> 1);
    if (closed && stretches > 0) {
      if (delta > stretches / 2) delta -= stretches;
      else if (delta < -stretches / 2) delta += stretches;
    }
    const a = delta >= 0 ? first >> 1 : ((to >> 1) % stretches + stretches) % stretches;
    return { from: a, count: Math.abs(delta) + 1 };
  };

  /** Turn the covered stretches into a line along the edge and lay the row. */
  const layRow = (r: { side: number; from: number; count: number }) => {
    const frames = derived.trackFrames;
    const { runoffL, runoffR, kerbWL, kerbWR, apronL, apronR } = derived.profile;
    const n = frames.length;
    if (n < 2) return;
    const pts: Array<{ x: number; y: number; z: number }> = [];
    // One point per covered cross section, plus the far end of the last
    // stretch: quads live BETWEEN cross sections, and so do rows.
    for (let k = 0; k <= r.count; k++) {
      const i = closed ? (r.from + k) % n : Math.min(n - 1, r.from + k);
      const f = frames[i];
      const edge = r.side < 0
        ? f.widthL + kerbWL[i] + apronL[i] + runoffL[i]
        : f.widthR + kerbWR[i] + apronR[i] + runoffR[i];
      const off = edge + rowGap;
      // Along the HORIZONTAL part of the cross axis: on a banked corner the
      // full right vector points into the ground, and a row laid along it
      // would climb the banking's underside.
      const rx = f.right.x;
      const rz = f.right.z;
      const len = Math.hypot(rx, rz) || 1;
      pts.push({
        x: f.pos.x + (rx / len) * r.side * off,
        y: f.pos.y,
        z: f.pos.z + (rz / len) * r.side * off,
      });
    }
    const store = useEditor.getState();
    const laid = store.addBarrierRun(pts);
    store.setStatus(
      laid === 0
        ? 'Too short for even one module'
        : `${laid} x ${LIBRARY_BY_KEY.get(store.barrierKind)?.label ?? store.barrierKind} along the edge`,
    );
  };
  layRowRef.current = layRow;

  // Paint the covered stretches so the drag can be seen while it happens.
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh || !layout) return;
    const m = new THREE.Matrix4();
    const tint = new THREE.Color();
    const stretches = layout.count / 2;
    const inRange = (k: number): boolean => {
      if (!range) return false;
      if (layout.sideOf[k] !== range.side) return false;
      const s = k >> 1;
      let d = s - range.from;
      if (closed) d = ((d % stretches) + stretches) % stretches;
      return d >= 0 && d < range.count;
    };
    for (let k = 0; k < layout.count; k++) {
      m.fromArray(layout.matrices, k * 16);
      mesh.setMatrixAt(k, m);
      tint.set(inRange(k) ? '#f4afc6' : '#6b7683');
      mesh.setColorAt(k, tint);
    }
    mesh.count = layout.count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [layout, range, closed]);

  if (!layout) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[UNIT_BOX, material, layout.count]}
      frustumCulled={false}
      renderOrder={9}
      onPointerDown={(e) => {
        if (e.button !== 0 || e.instanceId === undefined) return;
        e.stopPropagation();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        const side = layout.sideOf[e.instanceId];
        drag.current = { side, first: e.instanceId };
        rangeRef.current = { side, from: e.instanceId >> 1, count: 1 };
        setRange(rangeRef.current);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || e.instanceId === undefined) return;
        if (layout.sideOf[e.instanceId] !== d.side) return;
        e.stopPropagation();
        const r = rangeTo(d.first, e.instanceId);
        rangeRef.current = { side: d.side, ...r };
        setRange(rangeRef.current);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Kerbs                                                               */
/* ------------------------------------------------------------------ */

/** What each style of kerb looks like on the handles. */
const KERB_TINT: Record<KerbStyle, string> = {
  ramp: '#d8443c',
  wave: '#e2892b',
  sausage: '#e0c13c',
  flat: '#c96bb2',
  none: '#4b93d8',
};
const KERB_TINT_NONE = '#59616b';
const WHITE = new THREE.Color('#ffffff');

/** Shortest kerb a drag is allowed to leave behind, metres. */
const KERB_MIN_LENGTH = 2;
/** How far the end grips stand above the road, and how big they are. */
const GRIP_SIZE = 1.1;

/** The cross section nearest a curve parameter. Frames are evenly spaced in t. */
function frameIndexAtT(count: number, closed: boolean, t: number): number {
  const steps = closed ? count : count - 1;
  return Math.min(count - 1, Math.max(0, Math.round(t * steps)));
}

/* ------------------------------------------------------------------ */
/* Pit speed limiter                                                   */
/* ------------------------------------------------------------------ */

/** The post standing on a limiter line, as something to grab. */
const LIMIT_GRIP_H = 2.6;
const LIMIT_GRIP_W = 0.5;

/**
 * The stretch of pit lane the speed limiter applies to, as something you can
 * take hold of.
 *
 * The two numbers behind it, `limitStart` and `limitEnd`, were only ever
 * reachable as metres typed into two boxes on the Race tab -- and metres along
 * a lane are not a thing anybody can picture. The white bands painted across
 * the lane did already follow the settings, but finding where they had gone
 * meant flying down the lane hunting for them.
 *
 * So the limited stretch is drawn as a line down the middle of the lane from
 * one band to the other, with a post at each end to drag. The posts write
 * straight back into the same two settings and nothing here keeps a copy of
 * the geometry: the bands, the PIT surface under them and the numbers on the
 * right are all rebuilt from `pitCfg`, so they cannot drift apart.
 *
 * Measured along `pitDrawFrames`, which is the ribbon `buildPitMeshes` lays
 * the bands on -- see the note on it in derived.ts. Built on `pitFrames`
 * instead, the posts sit metres away from the lines they are holding.
 */
function PitLimitLayer({ derived }: { derived: Derived }) {
  const pitCfg = useEditor((s) => s.project.pitCfg);
  const { camera, gl } = useThree();
  const frames = derived.pitDrawFrames;
  const length = derived.pitDrawLength;

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#e6e6e2',
        transparent: true,
        opacity: 0.9,
        // Like every other handle in here: findable from outside the lane and
        // through whatever scenery has been built along it.
        depthTest: false,
      }),
    [],
  );
  const geometry = useMemo(
    () => new THREE.BoxGeometry(LIMIT_GRIP_W, LIMIT_GRIP_H, LIMIT_GRIP_W),
    [],
  );
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );

  const index = useMemo(() => new PointIndex(frames.map((f) => f.pos), 30), [frames]);

  /** A point on the lane's centre line, `d` metres along the drawn ribbon. */
  const atDist = useCallback(
    (d: number) => {
      const n = frames.length;
      if (n < 2) return null;
      let i = 0;
      while (i < n - 2 && frames[i + 1].dist < d) i += 1;
      const span = frames[i + 1].dist - frames[i].dist;
      const t = span > 1e-6 ? Math.min(1, Math.max(0, (d - frames[i].dist) / span)) : 0;
      return frames[i].pos.clone().lerp(frames[i + 1].pos, t);
    },
    [frames],
  );

  // The same expression road.ts uses, so the posts stand on the bands rather
  // than near them: the limiter can never end before it starts.
  const laneEnd = Math.max(pitCfg.limitStart, length - pitCfg.limitEnd);

  const ends = useMemo(() => {
    const a = atDist(pitCfg.limitStart);
    const b = atDist(laneEnd);
    return a && b ? [a, b] : null;
  }, [atDist, pitCfg.limitStart, laneEnd]);

  /** The limited stretch, sampled so the line follows the lane round its bends. */
  const path = useMemo(() => {
    if (!ends) return null;
    const out: [number, number, number][] = [[ends[0].x, ends[0].y + 0.12, ends[0].z]];
    for (const f of frames) {
      if (f.dist <= pitCfg.limitStart || f.dist >= laneEnd) continue;
      out.push([f.pos.x, f.pos.y + 0.12, f.pos.z]);
    }
    out.push([ends[1].x, ends[1].y + 0.12, ends[1].z]);
    return out.length >= 2 ? out : null;
  }, [ends, frames, pitCfg.limitStart, laneEnd]);

  const drag = useRef<{ which: 'in' | 'out'; planeY: number; moved: boolean } | null>(null);
  /* What the window level handler needs, without re-registering it every time
     the lane is rebuilt -- which during a drag is every frame. */
  const ctx = useRef({ frames, length, index, camera, gl });
  ctx.current = { frames, length, index, camera, gl };

  useEffect(() => {
    const ndc = new THREE.Vector2();
    const caster = new THREE.Raycaster();
    const plane = new THREE.Plane(UP_AXIS, 0);
    const hit = new THREE.Vector3();

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const { frames: fr, length: len, index: idx, camera: cam, gl: renderer } = ctx.current;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      caster.setFromCamera(ndc, cam);
      plane.set(UP_AXIS, -d.planeY);
      if (!caster.ray.intersectPlane(plane, hit)) return;
      // The nearest cross section, which is the resolution the bands are drawn
      // at: the post lands on a plate rather than between two of them.
      const i = idx.nearest(hit.x, hit.z, 400);
      if (i < 0) return;
      const at = fr[i].dist;

      const store = useEditor.getState();
      // One history entry for the whole drag, taken on the first frame that
      // actually moves something.
      if (!d.moved) {
        store.pushHistory();
        d.moved = true;
      }
      store.markBusy();
      const cfg = store.project.pitCfg;
      if (d.which === 'in') {
        /* Never past the other end. Two bands that cross over describe a
           limited stretch of negative length, which road.ts clamps away to
           nothing -- the limiter would silently stop existing. */
        const v = Math.min(Math.max(0, at), Math.max(0, len - cfg.limitEnd));
        store.live((p) => {
          p.pitCfg.limitStart = Math.round(v * 10) / 10;
        });
        store.setStatus(`Limiter on ${v.toFixed(0)} m into the lane`);
      } else {
        const v = Math.min(Math.max(0, len - at), Math.max(0, len - cfg.limitStart));
        store.live((p) => {
          p.pitCfg.limitEnd = Math.round(v * 10) / 10;
        });
        store.setStatus(`Limiter off ${v.toFixed(0)} m before the lane ends`);
      }
    };

    const stop = () => {
      const d = drag.current;
      drag.current = null;
      if (d) setTimeout(() => useEditor.setState({ interacting: false }), 0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
    };
  }, []);

  if (!ends || !path || length <= 0) return null;

  const grab = (which: 'in' | 'out', y: number) => (e: ThreeEvent<PointerEvent>) => {
    // The lane underneath is selectable, and a press on the post is for the
    // post: without this the click also picks whatever it is standing on.
    e.stopPropagation();
    drag.current = { which, planeY: y, moved: false };
    useEditor.setState({ interacting: true });
  };

  return (
    <group>
      <Line points={path} color="#e6e6e2" lineWidth={2} depthTest={false} />
      {ends.map((p, i) => (
        <mesh
          key={i}
          geometry={geometry}
          material={material}
          position={[p.x, p.y + LIMIT_GRIP_H / 2, p.z]}
          renderOrder={4}
          onPointerDown={grab(i === 0 ? 'in' : 'out', p.y)}
        />
      ))}
    </group>
  );
}

/**
 * Draw kerbs by dragging along the edge of the road.
 *
 * A kerb is a span with a start and an end of its own, so this is the tool that
 * gives it them: press on the roadside, drag as far as the kerb should go, let
 * go. Every stretch between two cross sections has a handle, which is roughly
 * every few metres rather than every control point -- the whole complaint about
 * the old checkboxes was that a kerb could only begin where somebody had once
 * clicked a point.
 *
 * A kerb stays selected after it is drawn, and a selected one can be reshaped
 * rather than thrown away and drawn again: drag it along the track to move it,
 * or drag either end grip to make it longer or shorter. Its style and size are
 * on the left, on the tool's own panel, so the thing just drawn can be changed
 * without letting go of the tool. Alt turns any drag into a rubber.
 */
function KerbLayer({ derived }: { derived: Derived }) {
  const road = useEditor((s) => s.project.road);
  const closed = useEditor((s) => s.project.track.closed);
  const selection = useEditor((s) => s.selection);
  const ref = useRef<THREE.InstancedMesh>(null);
  const gripRef = useRef<THREE.InstancedMesh>(null);
  const { camera, gl } = useThree();

  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthTest: false }),
    [],
  );
  const gripMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#f4f1e6', transparent: true, opacity: 0.9, depthTest: false }),
    [],
  );
  useEffect(() => () => {
    material.dispose();
    gripMaterial.dispose();
  }, [material, gripMaterial]);

  const layout = useMemo(
    () => kerbHandles(derived.trackFrames, derived.profile, road, closed),
    [derived, road, closed],
  );

  const selectedId = selection?.kind === 'kerb' ? selection.id : null;
  const selected = selectedId ? road.kerbs.find((s) => s.id === selectedId) ?? null : null;
  const selectedIndex = selected ? road.kerbs.indexOf(selected) : -1;

  const frames = derived.trackFrames;
  const total = derived.trackLength;
  const trackIndex = useMemo(() => new PointIndex(frames.map((f) => f.pos), 30), [frames]);

  /* Everything the window level drag handler needs, without re-registering it
     on every rebuild -- which during a drag is every frame. */
  const ctx = useRef({ frames, closed, total, trackIndex, camera, gl });
  ctx.current = { frames, closed, total, trackIndex, camera, gl };

  /**
   * The two ends of the selected kerb, as something to grab.
   *
   * Only for a kerb that has ends: one running round the whole lap has both in
   * the same place, and two grips on top of each other at the start/finish line
   * would be a puzzle rather than a control.
   */
  const grips = useMemo(() => {
    if (!selected || frames.length < 2 || total <= 0) return null;
    if (spanExtent(selected, closed) >= 1 - 1e-6) return null;
    const m = spanMetres(selected, frames, closed, total);
    return [m.start, m.start + m.length].map((d) => {
      const t = tAtDist(frames, closed, total, d);
      const f = frames[frameIndexAtT(frames.length, closed, t)];
      const half = selected.side < 0 ? f.widthL : f.widthR;
      const p = f.pos
        .clone()
        .addScaledVector(f.right, selected.side * (half + Math.max(0.9, selected.width) / 2));
      p.y += GRIP_SIZE / 2;
      return p;
    });
  }, [selected, frames, closed, total]);

  useLayoutEffect(() => {
    const mesh = gripRef.current;
    if (!mesh || !grips) return;
    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3(0.7, GRIP_SIZE, 0.7);
    const q = new THREE.Quaternion();
    grips.forEach((p, i) => {
      m.compose(p, q, scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = grips.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [grips]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh || !layout) return;
    const m = new THREE.Matrix4();
    const tint = new THREE.Color();
    for (let k = 0; k < layout.count; k++) {
      m.fromArray(layout.matrices, k * 16);
      mesh.setMatrixAt(k, m);
      const span = layout.spanOf[k] >= 0 ? road.kerbs[layout.spanOf[k]] : undefined;
      tint.set(span ? KERB_TINT[span.style] : KERB_TINT_NONE);
      // The selected span glows, so a number typed on the right can be seen to
      // belong to the stretch highlighted out in the world.
      if (span && span.id === selectedId) tint.lerp(WHITE, 0.55);
      mesh.setColorAt(k, tint);
    }
    mesh.count = layout.count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [layout, road.kerbs, selectedId]);

  /**
   * The drag in progress. `base` is the list as it was before it started, so a
   * drag that grows and then shrinks again does not eat the neighbour it
   * briefly covered: every frame is recomputed from the same starting point.
   */
  const drag = useRef<{
    mode: 'draw' | 'move' | 'trimFrom' | 'trimTo';
    side: -1 | 1;
    first: number;
    base: KerbSpan[];
    erase: boolean;
    id: string;
    moved: boolean;
    /** Arc length under the pointer when a move started, and the plane to read it on. */
    grabDist: number;
    planeY: number;
  } | null>(null);

  /**
   * Reshape the selected kerb from a pointer position.
   *
   * The pointer is met with the horizontal plane the kerb sits on and the
   * nearest cross section decides how far along the lap that is -- the same
   * resolution the kerb itself is built at, so the ends land on the plates they
   * will be drawn on rather than somewhere between them.
   */
  const editTo = (dist: number) => {
    const d = drag.current;
    if (!d || d.mode === 'draw') return;
    const { frames: fr, closed: cl, total: len } = ctx.current;
    const span = d.base.find((s) => s.id === d.id);
    if (!span || len <= 0) return;
    const m = spanMetres(span, fr, cl, len);

    // Signed shortest way round, so grabbing an end and pulling it back across
    // the start/finish line shortens the kerb instead of wrapping it.
    const signed = (v: number) => {
      let x = ((v % len) + len) % len;
      if (x > len / 2) x -= len;
      return x;
    };

    let start = m.start;
    let length = m.length;
    if (d.mode === 'move') {
      start = m.start + signed(dist - d.grabDist);
    } else if (d.mode === 'trimFrom') {
      const next = Math.max(KERB_MIN_LENGTH, Math.min(len, length - signed(dist - m.start)));
      start = m.start + (length - next); // the far end stays where it is
      length = next;
    } else {
      length = Math.max(KERB_MIN_LENGTH, Math.min(len, length + signed(dist - (m.start + m.length))));
    }

    if (!cl) {
      start = Math.min(Math.max(start, 0), Math.max(0, len - KERB_MIN_LENGTH));
      length = Math.min(length, len - start);
    }

    const store = useEditor.getState();
    if (!d.moved) {
      store.pushHistory();
      d.moved = true;
    }
    store.markBusy();
    store.liveKerbs(moveKerbSpan(d.base, span, start, length, fr, cl, len));
    store.setStatus(
      d.mode === 'move'
        ? `Kerb moved to ${start.toFixed(0)} m`
        : `Kerb ${length.toFixed(0)} m, from ${start.toFixed(0)} m`,
    );
  };

  /* Dragging a kerb about follows the pointer wherever it goes, not just over
     the handles: you steer a kerb along the road, and the band of handles is
     barely a metre wide. */
  useEffect(() => {
    const ndc = new THREE.Vector2();
    const caster = new THREE.Raycaster();
    const plane = new THREE.Plane(UP_AXIS, 0);
    const hit = new THREE.Vector3();

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.mode === 'draw') return;
      const { trackIndex: index, frames: fr, camera: cam, gl: renderer } = ctx.current;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      caster.setFromCamera(ndc, cam);
      plane.set(UP_AXIS, -d.planeY);
      if (!caster.ray.intersectPlane(plane, hit)) return;
      const i = index.nearest(hit.x, hit.z, 400);
      if (i < 0) return;
      editTo(fr[i].dist);
    };

    const stop = () => {
      const d = drag.current;
      drag.current = null;
      if (d) setTimeout(() => useEditor.setState({ interacting: false }), 0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
    };
  }, []);

  /** The span the drag currently describes, and the list it produces. */
  const strokeTo = (to: number | undefined) => {
    const d = drag.current;
    if (!d || !layout || to === undefined || to >= layout.count) return;
    if (layout.sideOf[to] !== d.side) return;

    // Handles run in pairs along the track, so the stretch index is the handle
    // index halved. Which way round the two ends go is decided by the SHORTER
    // way round, or dragging a metre backwards over the start/finish line would
    // draw a kerb round the entire rest of the lap.
    const stretches = layout.count / 2;
    let delta = (to >> 1) - (d.first >> 1);
    if (closed) {
      if (delta > stretches / 2) delta -= stretches;
      else if (delta < -stretches / 2) delta += stretches;
    }
    const a = delta >= 0 ? d.first : to;
    const b = delta >= 0 ? to : d.first;
    const fromT = layout.fromT[a];
    const toT = layout.toT[b];

    const store = useEditor.getState();
    const cfg = store.kerbCfg;
    const list = d.erase
      ? eraseKerbRange(d.base, d.side, fromT, toT, closed)
      : insertKerbSpan(
          d.base,
          { ...makeKerbSpan(d.side, fromT, toT, cfg), id: d.id },
          closed,
        );
    store.markBusy();
    store.liveKerbs(list);
    const metres = derived.trackLength * Math.max(0, toT >= fromT ? toT - fromT : 1 - fromT + toT);
    store.setStatus(
      `${d.erase ? 'Kerb removed' : 'Kerb'} ${metres.toFixed(0)} m on the ${d.side < 0 ? 'left' : 'right'}`,
    );
  };

  if (!layout) return null;

  /** Where along the lap a handle sits, for a move to measure itself against. */
  const distOfHandle = (k: number) => distAtT(frames, closed, total, layout.fromT[k]);

  return (
    <>
      <instancedMesh
        ref={ref}
        args={[UNIT_BOX, material, layout.count]}
        frustumCulled={false}
        renderOrder={9}
        onPointerDown={(e) => {
          if (e.button !== 0 || e.instanceId === undefined) return;
          e.stopPropagation();
          (e.target as Element).setPointerCapture?.(e.pointerId);
          const alt = e.nativeEvent.altKey;
          // Pressing on the kerb that is already selected picks it up instead
          // of drawing over it: reshaping the one you just made is the common
          // case, and drawing a second kerb inside the first is not.
          const onSelected =
            !alt && selectedIndex >= 0 && layout.spanOf[e.instanceId] === selectedIndex && grips !== null;
          drag.current = {
            mode: onSelected ? 'move' : 'draw',
            side: layout.sideOf[e.instanceId] < 0 ? -1 : 1,
            first: e.instanceId,
            base: useEditor.getState().project.road.kerbs,
            erase: alt,
            id: onSelected && selected ? selected.id : makeKerbSpan(1, 0, 0).id,
            moved: false,
            grabDist: distOfHandle(e.instanceId),
            planeY: e.point.y,
          };
          useEditor.setState({ interacting: true });
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.mode !== 'draw' || e.instanceId === undefined || e.instanceId === d.first) return;
          e.stopPropagation();
          // History is taken on the first change, not on the press: pressing to
          // select a kerb and letting go must not leave an empty undo step.
          if (!d.moved) {
            useEditor.getState().pushHistory();
            d.moved = true;
          }
          strokeTo(e.instanceId);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d) return;
          e.stopPropagation();
          const store = useEditor.getState();
          if (d.moved) {
            // The live list is already the wanted one; only the selection is left.
            if (!d.erase) store.select({ kind: 'kerb', id: d.id });
          } else if (d.mode === 'draw') {
            const idx = layout.spanOf[d.first];
            const existing = idx >= 0 ? store.project.road.kerbs[idx] : undefined;
            if (d.erase) {
              if (existing) {
                store.applyKerbs((list) =>
                  eraseKerbRange(list, d.side, layout.fromT[d.first], layout.toT[d.first], closed),
                );
                store.setStatus('Kerb removed');
              }
            } else if (existing) {
              store.select({ kind: 'kerb', id: existing.id });
            } else {
              const span = {
                ...makeKerbSpan(d.side, layout.fromT[d.first], layout.toT[d.first], store.kerbCfg),
                id: d.id,
              };
              store.applyKerbs((list) => insertKerbSpan(list, span, closed));
              store.select({ kind: 'kerb', id: d.id });
            }
          }
          drag.current = null;
          setTimeout(() => useEditor.setState({ interacting: false }), 0);
        }}
      />

      {grips && selected && (
        <instancedMesh
          ref={gripRef}
          args={[UNIT_BOX, gripMaterial, 2]}
          frustumCulled={false}
          renderOrder={11}
          onPointerDown={(e) => {
            if (e.button !== 0 || e.instanceId === undefined) return;
            e.stopPropagation();
            (e.target as Element).setPointerCapture?.(e.pointerId);
            drag.current = {
              mode: e.instanceId === 0 ? 'trimFrom' : 'trimTo',
              side: selected.side,
              first: 0,
              base: useEditor.getState().project.road.kerbs,
              erase: false,
              id: selected.id,
              moved: false,
              grabDist: 0,
              planeY: e.point.y,
            };
            useEditor.setState({ interacting: true });
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Transform gizmo                                                     */
/* ------------------------------------------------------------------ */

/**
 * TransformControls that actually cleans up after itself.
 *
 * drei creates the three-stdlib TransformControls instance but never calls its
 * `dispose()` on unmount, and the gizmo owns a set of ~17 geometries and
 * materials. The gizmo unmounts every time the selection is cleared, so every
 * select-deselect cycle left a full set of gizmo geometries on the GPU: in a
 * recorded session the live geometry count climbed from 22 to 138 in under a
 * minute of ordinary editing, one +17 step per re-selection.
 */
function DisposingTransformControls(props: ComponentProps<typeof TransformControls>) {
  const instance = useRef<{ dispose: () => void } | null>(null);
  const pendingDispose = useRef(0);
  // Keep the latest instance; the callback also fires with null on unmount,
  // which must not wipe the reference before cleanup ran.
  const grab = useCallback((c: unknown) => {
    if (c) instance.current = c as { dispose: () => void };
  }, []);
  useEffect(() => {
    // Disposing must wait a tick: under StrictMode, React runs this cleanup
    // once right after mount as a probe, with the controls still live on
    // screen. `dispose()` removes the pointer listeners from the canvas for
    // good, which left a gizmo that rendered but ignored every click. If the
    // effect runs again immediately, it was only the probe - keep the
    // instance; if not, the component is really gone and the timer fires.
    clearTimeout(pendingDispose.current);
    return () => {
      const doomed = instance.current;
      pendingDispose.current = window.setTimeout(() => {
        doomed?.dispose();
        if (instance.current === doomed) instance.current = null;
      }, 0);
    };
  }, []);
  return <TransformControls ref={grab as never} {...props} />;
}

/**
 * Whether Alt is held down right now.
 *
 * The gizmo reports "the object moved" with no event attached, so watching the
 * key is the only way to let Alt switch the neighbour snapping off mid drag.
 */
function useAltHeld() {
  const held = useRef(false);
  useEffect(() => {
    const sync = (e: KeyboardEvent) => {
      held.current = e.altKey;
    };
    // Alt+Tab takes the keyup with it, which would leave snapping off for good.
    const clear = () => {
      held.current = false;
    };
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return held;
}

function GizmoLayer({ derived }: { derived: Derived }) {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const gizmo = useEditor((s) => s.gizmo);
  const snap = useEditor((s) => s.snap);
  const proxy = useRef<THREE.Object3D>(new THREE.Object3D());
  const dragging = useRef(false);
  const altHeld = useAltHeld();

  const target = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'node') {
      const list = pathDataOf(project, selection.path)?.nodes ?? [];
      const n = list.find((x) => x.id === selection.id);
      return n ? { pos: new THREE.Vector3(n.p[0], n.p[1], n.p[2]), quat: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) } : null;
    }
    if (selection.kind === 'prop') {
      const inst = project.props.find((x) => x.id === selection.id);
      if (!inst) return null;
      return {
        pos: propPosition(inst, project.terrain, derived.terrainHeights),
        quat: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            THREE.MathUtils.degToRad(inst.r[0]),
            THREE.MathUtils.degToRad(inst.r[1]),
            THREE.MathUtils.degToRad(inst.r[2]),
            'XYZ',
          ),
        ),
        scale: new THREE.Vector3(inst.s[0], inst.s[1], inst.s[2]),
      };
    }
    if (selection.kind === 'grid') {
      const m = derived.markers.grid.find((x) => x.index === selection.index);
      return m ? { pos: m.pos.clone(), quat: m.quat.clone(), scale: new THREE.Vector3(1, 1, 1) } : null;
    }
    if (selection.kind === 'pitbox') {
      const m = derived.markers.pits.find((x) => x.index === selection.index);
      return m ? { pos: m.pos.clone(), quat: m.quat.clone(), scale: new THREE.Vector3(1, 1, 1) } : null;
    }
    if (selection.kind === 'acCopy') {
      const scene = useEditor.getState().acScene;
      const copy = project.acImport?.edits.copies[selection.model]
        ?.find((c) => c.id === selection.id);
      const model = scene?.models.find((m) => m.path === selection.model);
      const mesh = model?.meshes.find((m) => m.name === copy?.mesh);
      if (!copy || !model || !mesh) return null;
      // Following the corner: the ribbon handles own this one. World-axis
      // arrows on a deformation would lie about what a drag does.
      if (copy.t.ribbon) return null;
      const centre = acMeshCentre(model, mesh, copy.part);
      return {
        pos: centre.add(new THREE.Vector3(copy.t.p[0], copy.t.p[1], copy.t.p[2])),
        quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(copy.t.r[0]),
          THREE.MathUtils.degToRad(copy.t.r[1]),
          THREE.MathUtils.degToRad(copy.t.r[2]),
          'XYZ',
        )),
        scale: new THREE.Vector3(copy.t.s[0], copy.t.s[1], copy.t.s[2]),
      };
    }
    if (selection.kind === 'acMesh') {
      const scene = useEditor.getState().acScene;
      if (!scene) return null;
      const marked = useEditor.getState().acMarked;
      if (marked.length > 1) {
        // With several picked, the handles sit at the middle of the lot and
        // start from neutral: what a drag produces is a DELTA applied to every
        // member, not one shared pose.
        const group = acGroupCentre(scene, marked, project.acImport?.edits.transforms ?? {});
        if (!group) return null;
        return { pos: group, quat: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) };
      }
      const model = scene.models.find((m) => m.path === selection.model);
      const mesh = model?.meshes.find((m) => m.name === selection.name);
      if (!mesh || !model) return null;
      const t = project.acImport?.edits
        .transforms[selection.model]?.[partKey(selection.name, selection.part)];
      // Following the corner: the ribbon handles own this one. The gizmo's
      // world axes and a resize measured along the track cannot both be true.
      if (t?.ribbon) return null;
      // The gizmo sits on the PIECE's own centre -- one corner's kerb, not the
      // bounding box of every kerb on the circuit, which would put the handles
      // half a lap away from what is being dragged.
      const centre = acMeshCentre(model, mesh, selection.part);
      return {
        pos: centre.add(new THREE.Vector3(...(t?.p ?? [0, 0, 0]))),
        quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(t?.r[0] ?? 0),
          THREE.MathUtils.degToRad(t?.r[1] ?? 0),
          THREE.MathUtils.degToRad(t?.r[2] ?? 0),
          'XYZ',
        )),
        scale: new THREE.Vector3(...(t?.s ?? [1, 1, 1])),
      };
    }
    if (selection.kind === 'acMarker') {
      const scene = useEditor.getState().acScene;
      if (!scene) return null;
      const live = applyMarkerEdits(scene.markers, project.acImport?.edits.markers ?? {});
      const m = live.find((x) => x.name === selection.name);
      if (!m) return null;
      return {
        pos: m.pos.clone(),
        quat: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, THREE.MathUtils.degToRad(m.rot), 0),
        ),
        scale: new THREE.Vector3(1, 1, 1),
      };
    }
    return null;
  }, [selection, project, derived]);

  useLayoutEffect(() => {
    if (!target || dragging.current) return;
    proxy.current.position.copy(target.pos);
    proxy.current.quaternion.copy(target.quat);
    proxy.current.scale.copy(target.scale);
    proxy.current.updateMatrixWorld();
  }, [target]);

  const writeBack = () => {
    const sel = useEditor.getState().selection;
    if (!sel) return;
    // Self arming, so deferring the heavy work never depends on a library
    // callback firing. If this were missed, every frame of a drag would rebuild
    // the whole corridor and re-upload the terrain.
    useEditor.getState().markBusy();
    const o = proxy.current;
    const pos = o.position.clone();
    const euler = new THREE.Euler().setFromQuaternion(o.quaternion, 'XYZ');
    const deg = (r: number) => THREE.MathUtils.radToDeg(r);

    // A building dragged next to another one latches flush against it, exactly
    // as it would when placed -- one resolver, so a drag and a click cannot
    // disagree about where the same object belongs. Alt switches it off.
    // Resolved out here against the committed project rather than inside
    // `live`, so the edit does not have to draft every prop in the scene just
    // to read their positions.
    //
    // Every gizmo mode that can move the object goes through this. Guarding on
    // 'translate' alone meant a nudge under the rotate gizmo stored an
    // unsnapped position and quietly took the object off the grid.
    let rotY = deg(euler.y);
    if (sel.kind === 'prop') {
      const props = useEditor.getState().project.props;
      const inst = props.find((x) => x.id === sel.id);
      if (inst) {
        const hit = resolvePlacement({
          kind: inst.kind,
          x: pos.x,
          z: pos.z,
          rotY,
          // Both axes: a patch stretched to 40 x 25 m dragged next to another
          // one has to be measured as the rectangle it is, not as a square.
          scale: { x: o.scale.x, z: o.scale.z },
          props,
          snap,
          exact: altHeld.current,
          excludeId: inst.id,
        });
        pos.x = hit.x;
        pos.z = hit.z;
        rotY = hit.rotY;
      }
    } else if (snap > 0 && !altHeld.current) {
      pos.x = Math.round(pos.x / snap) * snap;
      pos.z = Math.round(pos.z / snap) * snap;
    }

    useEditor.getState().live((p) => {
      if (sel.kind === 'node') {
        const list = pathDataOf(p, sel.path)?.nodes ?? [];
        const n = list.find((x) => x.id === sel.id);
        if (n) n.p = [pos.x, pos.y, pos.z];
      } else if (sel.kind === 'prop') {
        const inst = p.props.find((x) => x.id === sel.id);
        if (inst) {
          // Dragging a grounded prop upwards is a clear "I want it here",
          // so detach it from the terrain. Sliding it sideways is not.
          const groundY = propPosition(inst, p.terrain, derived.terrainHeights).y;
          if (inst.ground && Math.abs(pos.y - groundY) > 0.05) inst.ground = false;
          inst.p = [pos.x, pos.y, pos.z];
          inst.r = [deg(euler.x), rotY, deg(euler.z)];
          inst.s = [o.scale.x, o.scale.y, o.scale.z];
        }
      } else if (sel.kind === 'grid') {
        p.grid.overrides[sel.index] = { p: [pos.x, pos.y, pos.z], rot: deg(euler.y) };
      } else if (sel.kind === 'pitbox') {
        p.pitCfg.overrides[sel.index] = { p: [pos.x, pos.y, pos.z], rot: deg(euler.y) };
      } else if (sel.kind === 'acCopy' && p.acImport) {
        const scene = useEditor.getState().acScene;
        const list = p.acImport.edits.copies[sel.model];
        const copy = list?.find((c) => c.id === sel.id);
        const model = scene?.models.find((m) => m.path === sel.model);
        const mesh = model?.meshes.find((m) => m.name === copy?.mesh);
        if (copy && model && mesh) {
          const centre = acMeshCentre(model, mesh, copy.part);
          // On top of what the copy already carries: replacing the whole
          // transform here silently threw away `keepTexture` and the pivot.
          copy.t = {
            ...copy.t,
            p: [pos.x - centre.x, pos.y - centre.y, pos.z - centre.z],
            r: [deg(euler.x), deg(euler.y), deg(euler.z)],
            s: [o.scale.x, o.scale.y, o.scale.z],
          };
        }
      } else if (sel.kind === 'acMesh' && p.acImport) {
        const scene = useEditor.getState().acScene;
        const marked = useEditor.getState().acMarked;
        if (scene && marked.length > 1) {
          /*
           * A group drag: the gizmo started neutral at the group's centre, so
           * what it reads now IS the delta. Every member gets the same one, and
           * they all turn and grow about that shared point -- which is what
           * `about` is for. Rotating each about its own centre instead would
           * spin six cars on the spot rather than swinging them round together.
           */
          const base = acGroupCentre(scene, marked, {});
          if (!base) return;
          const dp: [number, number, number] = [pos.x - base.x, pos.y - base.y, pos.z - base.z];
          for (const ref of marked) {
            const map = { ...(p.acImport.edits.transforms[ref.model] ?? {}) };
            map[partKey(ref.name, ref.part)] = {
              p: dp,
              r: [deg(euler.x), deg(euler.y), deg(euler.z)],
              s: [o.scale.x, o.scale.y, o.scale.z],
              about: [base.x, base.y, base.z],
            };
            p.acImport.edits.transforms[ref.model] = map;
          }
          return;
        }
        const model = scene?.models.find((m) => m.path === sel.model);
        const mesh = model?.meshes.find((m) => m.name === sel.name);
        if (mesh && model) {
          // Stored as an OFFSET from where the modder left it, so an untouched
          // piece is provably untouched and "put it back" is exact.
          const centre = acMeshCentre(model, mesh, sel.part);
          const map = { ...(p.acImport.edits.transforms[sel.model] ?? {}) };
          const key = partKey(sel.name, sel.part);
          // On top of what is already stored: replacing the whole transform
          // silently threw away `keepTexture`, the growth pivot and the
          // ribbon flag on the first nudge of the gizmo.
          map[key] = {
            ...map[key],
            p: [pos.x - centre.x, pos.y - centre.y, pos.z - centre.z],
            r: [deg(euler.x), deg(euler.y), deg(euler.z)],
            s: [o.scale.x, o.scale.y, o.scale.z],
          };
          p.acImport.edits.transforms[sel.model] = map;
        }
      } else if (sel.kind === 'acMarker' && p.acImport) {
        // Recorded against the marker's original NAME, so it survives the
        // renumbering the export does. A second move of the same marker
        // replaces the first rather than piling up -- a drag fires this sixty
        // times a second.
        const list = (p.acImport.edits.markers[sel.model] ?? [])
          .filter((e) => !(e.op === 'move' && e.name === sel.name));
        p.acImport.edits.markers[sel.model] = [
          ...list,
          { op: 'move', name: sel.name, p: [pos.x, pos.y, pos.z], rot: deg(euler.y) },
        ];
      }
    });
  };

  // Coalesce to at most one store write per ~60 Hz tick. The gizmo fires
  // objectChange on every pointer event, and each write rebuilds the road and
  // the terrain, which is both work and short lived memory.
  const queued = useRef(false);
  const lastWrite = useRef(0);
  const queueWriteBack = () => {
    if (queued.current) return;
    queued.current = true;
    requestAnimationFrame((now) => {
      queued.current = false;
      if ((now - lastWrite.current) / 1000 < MIN_UPDATE_INTERVAL) return;
      lastWrite.current = now;
      writeBack();
    });
  };

  if (!target) return null;

  return (
    <>
      <primitive object={proxy.current} />
      <DisposingTransformControls
        object={proxy.current}
        mode={gizmo}
        size={0.85}
        // With the grid on, turning things lands on the same 15° steps the
        // place tool uses, so a building dragged into a row stays square to it.
        rotationSnap={snap > 0 ? Math.PI / 12 : undefined}
        onMouseDown={() => {
          dragging.current = true;
          useEditor.getState().pushHistory();
          useEditor.setState({ interacting: true });
        }}
        onMouseUp={() => {
          dragging.current = false;
          writeBack();
          // Back to full quality, and the deferred terrain catches up here.
          setTimeout(() => useEditor.setState({ interacting: false }), 0);
        }}
        onObjectChange={queueWriteBack}
      />
    </>
  );
}


/* ------------------------------------------------------------------ */
/* Scene root                                                          */
/* ------------------------------------------------------------------ */

/** Hands the 3D subtree's render time to the flight recorder, which also counts them. */
const reportSceneRender = (id: string, _phase: string, actualDuration: number) => {
  noteRender(id, actualDuration);
};

function SceneRoot() {
  /*
   * A span across the WHOLE 3D subtree: from the moment this component starts
   * rendering to the moment its own layout effect runs, which React does after
   * every descendant has rendered and every descendant's layout effect has run.
   * Nothing inside can hide from it -- which is the point, because the last
   * trace had five seconds that none of the narrower instruments could see.
   */
  const startedAt = performance.now();
  const layoutDoneAt = useRef(0);
  useLayoutEffect(() => {
    layoutDoneAt.current = performance.now();
    noteEffect('3D render + layout effects', layoutDoneAt.current - startedAt);
  });
  /*
   * And the passive effects, which are the last thing in the accounting that
   * nothing has ever measured. React runs them AFTER the layout effects, in the
   * same scheduler task the browser blames for five seconds -- so a span that
   * stops at the layout effects, as the one above does, sees eleven
   * milliseconds of a task that took nearly five thousand. Parent effects run
   * after every child's, so this closes the last gap.
   */
  useEffect(() => {
    if (layoutDoneAt.current) noteEffect('3D passive effects', performance.now() - layoutDoneAt.current);
  });

  const derived = useDerived();
  const project = useEditor((s) => s.project);
  const rightTab = useEditor((s) => s.rightTab);
  const view = useEditor((s) => s.view);
  const quality = useEditor((s) => s.quality);
  const snap = useEditor((s) => s.snap);
  const tool = useEditor((s) => s.tool);
  const barrierMode = useEditor((s) => s.barrierMode);
  const { gl, scene, camera } = useThree();

  // What one drawn cell is worth. See the Grid below for why it is floored.
  const gridCell = snap > 0 ? Math.max(snap, 5) : 25;

  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.15;
    setRenderer(gl, () => gl.render(scene, camera));
    attachRenderer(gl);
  }, [gl, scene, camera]);

  return (
    <>
      {/* Two backdrops, one switch. Sky on: a daylight dome whose sun sits
          where the key light already is, so the shading and the sky agree
          about the time of day, with fog the colour of its horizon. Sky off:
          the same tone the panels sit on, so the 3D view belongs to the page
          rather than being a differently coloured hole in it -- matches
          `.viewwrap` in styles.css, change the two together. */}
      {view.sky ? (
        <>
          <color attach="background" args={['#b6c8d9']} />
          {/* Starts further out than the dark theme's fog: against a bright
              horizon the same 1400 m start turned the whole midfield milky,
              and haze that reads as depth on black reads as murk on white.
              The far end still swallows the terrain's square edge. */}
          <fog attach="fog" args={['#c3d2df', 2400, 7500]} />
          {/* The dome must fit inside the camera's 12000 m far plane; the
              default distance would put it beyond and clip it away. */}
          <Sky
            distance={10000}
            sunPosition={[400, 700, 260]}
            turbidity={6}
            rayleigh={1.1}
            mieCoefficient={0.004}
            mieDirectionalG={0.85}
          />
        </>
      ) : (
        <>
          <color attach="background" args={['#060a12']} />
          <fog attach="fog" args={['#060a12', 1400, 5000]} />
        </>
      )}
      {/* Daylight, not a floodlit stage. The old values added up to well over
          1.0 on every surface, so the grass burned out to a sandy beige and the
          tarmac lost its contrast. */}
      <hemisphereLight args={['#bcd6f5', '#38402f', 0.65]} />
      <directionalLight position={[400, 700, 260]} intensity={1.15} color="#fff6e8" />
      <directionalLight position={[-300, 250, -400]} intensity={0.22} color="#8fb4dd" />

      {view.grid && quality !== 'fast' && quality !== 'draft' && (
        <Grid
          args={[4000, 4000]}
          // The drawn cell IS the snap step, so a corner you can see is a
          // position you can hit. They used to be unrelated constants -- a
          // fixed 25 m cell against snap steps of 1 / 5 / 10 m -- which made
          // "put the point on that corner" arithmetically impossible: 25 is
          // not a multiple of 10, so at 10 m half the visible corners were
          // unreachable and at 1 m only every 25th step landed on one.
          //
          // The floor is what the old constant was really about: a 1 m grid
          // seen almost edge on across hundreds of metres turns into a
          // shimmering moire, because there are more lines than pixels to draw
          // them in. Below 5 m the fine grid is drawn as sections instead, so
          // the step is still readable where the cursor is without papering
          // the whole plane with lines.
          cellSize={gridCell}
          cellThickness={0.5}
          cellColor="#232a31"
          sectionSize={gridCell * 10}
          sectionThickness={1}
          sectionColor="#39434e"
          fadeDistance={Math.max(600, gridCell * 64)}
          fadeStrength={2}
          followCamera={false}
          infiniteGrid
          // A hand's width ABOVE the terrain's base level, not below the
          // lowest point in the whole height field. Sunk under the ground it
          // was invisible -- the terrain is opaque -- so the lines people were
          // actually aiming at were the terrain wireframe at 4.6875 m, which
          // no snap step divides. 5 cm is far enough not to fight the ground
          // for the depth buffer and close enough to read as lying on it.
          position={[0, project.terrain.base + 0.05, 0]}
        />
      )}

      <FpsProbe />
      <CameraKeys />
      {/* Only in the mode that uses them: the handles sit over the roadside and
          would swallow the clicks a free run is drawn with. */}
      {tool === 'barrier' && barrierMode === 'track' && <BarrierLayer derived={derived} />}
      {tool === 'barrier' && barrierMode === 'cut' && <BarrierCutLayer derived={derived} />}
      {tool === 'barrier' && barrierMode === 'edge' && <EdgeRowLayer derived={derived} />}
      {tool === 'kerb' && <KerbLayer derived={derived} />}
      {/* On the tab the two limiter boxes live on, so the posts are there to */}
      {/* drag while the numbers beside them are being read. */}
      {rightTab === 'race' && <PitLimitLayer derived={derived} />}
      {/* The imported circuit, under everything the editor draws on top of it. */}
      <AcLayer />
      <TerrainLayer derived={derived} />
      <TrackSurfaces derived={derived} />
      <PropsLayer derived={derived} />
      <Grass3DLayer derived={derived} />
      <PathNodes derived={derived} />
      <SectionHighlight derived={derived} />
      <MarkersLayer derived={derived} />
      <AiLayer derived={derived} />
      <GizmoLayer derived={derived} />

      <FrameOnLoad />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.02}
        minDistance={5}
        maxDistance={4000}
        // The left button belongs to the tools, never to the camera.
        // OrbitControls listens on the canvas itself, so a tool cannot take the
        // button back by stopping propagation: sculpting or painting with the
        // left button also swung the camera, and the stroke went wherever the
        // view had drifted to. Leaving LEFT unbound is the only way to make
        // that impossible rather than merely unlikely.
        //
        // Rotate therefore moves to the middle button, pan stays on the right,
        // and the wheel keeps zooming (enableZoom, on by default).
        mouseButtons={{
          MIDDLE: THREE.MOUSE.ROTATE,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
    </>
  );
}

/**
 * Puts the whole circuit back in frame when the project is replaced.
 *
 * Opening a 3 km generated lap under a camera that was parked on a 900 m oval
 * shows a piece of kerb and a lot of grass, and the way out of it -- fly the
 * camera up and back until the track appears -- is not obvious to anybody who
 * has just opened the editor for the first time.
 *
 * The camera is moved directly rather than through state: it changes sixty
 * times a second under the mouse and nothing renders from it.
 */
function FrameOnLoad() {
  const epoch = useEditor((s) => s.frameEpoch);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | { target?: THREE.Vector3; update?: () => void }
    | null;

  useEffect(() => {
    const p = useEditor.getState().project;
    const pts = [...p.track.nodes, ...p.pit.nodes].map((n) => n.p);
    let cx = 0;
    let cz = 0;
    let cy = p.terrain.base;
    // Nothing drawn yet: frame a workable patch of the field rather than all
    // two kilometres of it, which from far enough away is a green rectangle.
    let radius = 260;
    if (pts.length > 0) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      let sumY = 0;
      for (const q of pts) {
        minX = Math.min(minX, q[0]);
        maxX = Math.max(maxX, q[0]);
        minZ = Math.min(minZ, q[2]);
        maxZ = Math.max(maxZ, q[2]);
        sumY += q[1];
      }
      cx = (minX + maxX) / 2;
      cz = (minZ + maxZ) / 2;
      cy = sumY / pts.length;
      radius = Math.max(80, Math.max(maxX - minX, maxZ - minZ) / 2);
    }

    const persp = camera as THREE.PerspectiveCamera;
    const fov = ((persp.fov ?? 45) * Math.PI) / 180;
    // 1.35 rather than 1: the horizontal field is the narrow one on a portrait
    // shaped viewport, and a lap that exactly fills the frame has no air in it.
    const dist = Math.max(140, (radius * 1.35) / Math.tan(fov / 2));
    const dir = new THREE.Vector3(0.45, 0.62, 0.65).normalize();
    camera.position.set(cx + dir.x * dist, cy + dir.y * dist, cz + dir.z * dist);
    camera.lookAt(cx, cy, cz);
    camera.updateProjectionMatrix();
    if (controls?.target) {
      controls.target.set(cx, cy, cz);
      controls.update?.();
    }
  }, [epoch, camera, controls]);

  return null;
}

export function Viewport() {
  const quality = useEditor((s) => s.quality);
  return (
    <Canvas
      shadows={false}
      // Render resolution is the single biggest lever on a large monitor: at
      // device pixel ratio 2 a full screen viewport is four times the pixels of
      // ratio 1, and every one of them is shaded.
      dpr={QUALITY_DPR[quality]}
      // No preserveDrawingBuffer. It makes the browser keep a copy of every
      // frame, which costs frame rate permanently. The export grabs its
      // screenshot synchronously right after a draw instead.
      gl={{ antialias: quality !== 'fast' }}
      camera={{ position: [300, 260, 380], fov: 45, near: 0.5, far: 12000 }}
    >
      {/*
        Inside the canvas, not outside it.
        react-three-fiber runs its own React root with its own reconciler, so a
        Profiler on the DOM side sees the <Canvas> element and nothing within
        it. A recorded trace had React's scheduler busy for five seconds while
        every Profiler outside reported single digits -- the work was in here,
        behind a wall the instruments could not see through.
      */}
      <Profiler id={SCENE_ID} onRender={reportSceneRender}>
        <SceneRoot />
      </Profiler>
    </Canvas>
  );
}

/** Utility used by the inspector to read the ground height under a point. */
export function groundHeight(
  terrain: { res: number; size: number; originX: number; originZ: number },
  heights: Float32Array,
  x: number,
  z: number,
): number {
  return sampleHeights(terrain as never, heights, x, z);
}
