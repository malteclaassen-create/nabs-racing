import { create } from 'zustand';
import * as THREE from 'three';
import { produce, setAutoFreeze } from 'immer';
import type {
  AcMarkerEdit,
  BrushSettings,
  DecoRoad,
  KerbSpan,
  KerbStyle,
  PathId,
  Project,
  PropInstance,
  ScatterSettings,
  Selection,
  TerrainSettings,
  Tool,
  TrackNode,
} from '../types';
import {
  emptyAcEdits, isIdentityTransform, parsePartKey, partKey, pathDataOf, sameAcMeshRef,
  type AcMeshRef, type AcMeshTransform, type DecoSurface,
} from '../types';
import {
  acMeshBox, acPieceWorldPoints, disposeAcScene, loadAcScene, rebuildSceneModel, tarmacMeshes,
  type AcScene, type LoadSceneOptions,
} from '../ac/acScene';
import { ribbonBounds, ribbonSideOf } from '../ac/ribbon';
import { conformPathToSurface, type ConformReport } from '../ac/conform';
import { SurfaceProbe } from '../ac/surfaceProbe';
import {
  applyBrush,
  applyBrushToPath,
  createHeights,
  createPaint,
  createPaintEdge,
  heightsDelta,
  paintValue,
  paintGroundDisc as discPaint,
  paintGroundPath as pathPaint,
  paintGroundPolygon as polygonPaint,
  paintGroundRect as rectPaint,
  roundOutline,
  smoothOutline,
  type GroundRect,
} from '../core/terrain';
import { makeNode, type Frame } from '../core/spline';
import { STYLE_HEIGHT } from '../core/kerbs';
import { F1_GRID_BOX } from '../core/gridBoxes';
import { generateCircuit, rollingHeights, PIT_APRON_WIDTH, PIT_BOX_OFFSET, PIT_OFFSET, type CircuitSize } from '../core/generate';
import { DEFAULT_DRAW_CFG, drawHeightOf, drawWidths, type DrawCfg, type DrawMode } from '../core/draw';
import { layBarrierRun } from '../core/barrierRun';
import {
  BRAKE_MARKER_KINDS,
  DEFAULT_BRAKE_CFG,
  type BrakeMarker,
  type BrakeMarkerCfg,
} from '../core/brakeMarkers';
import { LIBRARY_BY_KEY, PAD_SIZE, propTileBox } from '../core/library';
import { tileBoxOf, tileRuleOf } from '../core/propSnap';
import { instantiatePrefab, PREFABS_BY_KEY } from '../core/prefabs';

// The store hands out drafts of the previous state and shares everything the
// edit did not touch. Freezing every state object on top of that would make
// each edit walk the whole project, which is exactly the per-frame cost this
// is here to remove.
setAutoFreeze(false);

/* ------------------------------------------------------------------ */
/* Default project                                                     */
/* ------------------------------------------------------------------ */

/*
 * The ground a new project gets: two kilometres square.
 *
 * 900 m was enough for the demo oval and nothing else -- a circuit of ordinary
 * length did not fit on the field it was supposed to be built on, and the first
 * thing anyone drawing one had to do was work out that the terrain has a size
 * setting. 2 km square holds a 4-5 km lap with room round it for a paddock.
 *
 * The resolution goes up with it, but not in proportion: 257 keeps the cell at
 * 7.8 m and the vertex count inside what the sculpt brush can rebuild per
 * frame. Both are settings; this is only where they start.
 */
const TERRAIN_SIZE = 2000;
const TERRAIN_RES = 257;

/** The demo circuit: a plain oval, so there is something to look at on day one. */
const OVAL_RX = 230;
const OVAL_RZ = 140;

const ovalPoint = (a: number) => ({ x: Math.sin(a) * OVAL_RX, z: -Math.cos(a) * OVAL_RZ });

/** Unit vector pointing to the right of the driving direction at angle a. */
function ovalRight(a: number) {
  const tx = Math.cos(a) * OVAL_RX;
  const tz = Math.sin(a) * OVAL_RZ;
  const len = Math.hypot(tx, tz) || 1;
  // right = forward x up, which for forward (tx, 0, tz) is (-tz, 0, tx).
  return { x: -tz / len, z: tx / len };
}

function ovalNodes(): TrackNode[] {
  const nodes: TrackNode[] = [];
  const count = 12;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const p = ovalPoint(a);
    nodes.push(makeNode({ x: p.x, y: 0, z: p.z }, { widthL: 7, widthR: 7 }));
  }
  return nodes;
}

/**
 * The demo pit lane, built as a true offset of the track along the main
 * straight. Drawing it as fixed coordinates looked fine at the middle of the
 * straight and then ran straight through the tarmac where the oval curved away.
 */
function pitNodes(): TrackNode[] {
  const nodes: TrackNode[] = [];
  const count = 7;
  const from = -0.62;
  const to = 0.62;
  /* The same distance out a generated circuit puts its lane, and for the same
     reason: an 18 m pit complex needs the room, and a lane any closer squeezes
     the circuit's own run off out between the two. It was 24, which was enough
     when the concrete beside the lane was a fixed 2.5 m and is not now. */
  const offset = PIT_OFFSET;
  for (let i = 0; i < count; i++) {
    const a = from + ((to - from) * i) / (count - 1);
    const p = ovalPoint(a);
    const r = ovalRight(a);
    nodes.push(
      makeNode(
        { x: p.x + r.x * offset, y: 0, z: p.z + r.z * offset },
        { widthL: 4, widthR: 4, wallL: false, wallR: false },
      ),
    );
  }
  return nodes;
}

/**
 * Everything a project is apart from the lines drawn on it.
 *
 * The three ways to start -- empty, generated, the demo oval -- differ only in
 * the track and pit nodes handed in, so they share this and cannot drift apart.
 */
function baseProject(track: TrackNode[], pit: TrackNode[]): Project {
  const res = TERRAIN_RES;
  return {
    formatVersion: 1,
    acImport: null,
    meta: {
      name: 'My Circuit',
      slug: 'my_circuit',
      author: '',
      country: 'Germany',
      city: '',
      description: 'Built with AC Track Editor',
      version: '1.0',
      run: 'clockwise',
    },
    track: { closed: true, nodes: track },
    pit: { closed: false, nodes: pit },
    decoRoads: [],
    road: {
      // Editing detail only: dragging rebuilds every cross section per frame,
      // so the default keeps the editor fluid. The export ignores this and
      // always builds the circuit at full 80x detail (see ExportDialog).
      samplesPerSegment: 12,
      kerbWidth: 1.2,
      kerbHeight: 0.07,
      // No kerbs to begin with.
      //
      // A lap kerbed end to end is not what any circuit looks like -- kerbs
      // belong at the corners the drivers actually cut -- and starting with the
      // lot of them means the first thing the Kerb tool is used for is taking
      // them away again. Drawing them where they belong is the shorter job.
      kerbs: [],
      edgeLine: true,
      edgeLineWidth: 0.14,
      apronColour: 'grey',
      runoffWidth: 12,
      /*
       * Level with the tarmac, not below it.
       *
       * A shoulder that falls away puts the barrier standing on its outer edge
       * below the surrounding ground, so the road reads as a causeway with a
       * trench round it and the barrier sunk into the trench. Real circuits do
       * drain away from the tarmac, but at a slope nobody sees; the visible
       * version of it was 28 cm over 12 m. The setting is still there for
       * anyone who wants the camber back.
       */
      runoffDrop: 0,
      runoffSurface: 'GRASS',
      // The run off follows the ground brush wherever it has been. Off, it is
      // one material for the whole circuit and the brush cannot reach it.
      runoffPaint: true,
      wall: true,
      wallHeight: 1.1,
      wallStyle: 'wall',
      wallCuts: [],
      pitClearance: true,
      pitGap: 3,
      uvLength: 14,
      uvWidth: 12,
    },
    pitCfg: {
      width: 4,
      /*
       * Five metres of concrete either side, which is what makes it read as a
       * pit lane rather than a wide bit of road.
       *
       * It used to be a fixed 2.5 m, and with the boxes at 5.5 m from the
       * centre that put every car half on the concrete and half hanging off
       * the edge of it, with nothing behind for anyone to work in. A modern
       * pit complex is about 18 m from the wall to the garage doors: an 8 m
       * fast lane with a working lane either side of it, which is what these
       * three numbers together now come to.
       */
      apron: PIT_APRON_WIDTH,
      boxCount: 12,
      boxSpacing: 9,
      boxSide: 1,
      // Out of the fast lane and into the working lane, where a car being
      // worked on belongs and where there is now room for one.
      boxOffset: PIT_BOX_OFFSET,
      startDist: 25,
      // On as soon as the lane has left the tarmac, off just before it
      // rejoins -- the same place a real limiter line sits.
      limitStart: 12,
      limitEnd: 12,
      overrides: {},
    },
    grid: {
      count: 20,
      poleBack: 12,
      rowSpacing: 8,
      lateralOffset: 3.2,
      stagger: true,
      // Formula 1's own box: 2.7 m of clear width, painted at 15 cm, with the
      // yellow front wheel bar inside it. See F1_GRID_BOX.
      boxes: true,
      boxWidth: F1_GRID_BOX.width,
      boxLength: F1_GRID_BOX.length,
      boxFrontLine: true,
      overrides: {},
    },
    timing: { startS: 0, sectors: [0.34, 0.67], hotlapBack: 60, gantry: true },
    props: [],
    assets: [],
    terrain: {
      enabled: true,
      res,
      size: TERRAIN_SIZE,
      originX: -TERRAIN_SIZE / 2,
      originZ: -TERRAIN_SIZE / 2,
      // Zero, and not a centimetre either side of it.
      //
      // The ground used to start at -0.6 so the demo oval sat on a low
      // embankment. What that actually meant was that every track drawn on a
      // fresh project began 60 cm below sea level, because a click puts a point
      // where the ground is -- so every height typed in anywhere afterwards was
      // measured from a datum nobody chose and nothing showed. The terrain is
      // blended down under the road regardless, so there is nothing to gain
      // from the offset and a datum to lose.
      base: 0,
      blend: 22,
      grass3d: true,
      heights: createHeights(res, 0),
      // All grass until the ground brush says otherwise, and no field at all
      // until then either.
      paint: null,
      paintEdge: null,
    },
    exportCfg: {
      markerAsMesh: false,
      markerForward: '+Z',
      aiSpacing: 2,
      writeTextures: true,
      sourceFiles: false,
    },
  };
}

/** The demo oval, kept as one of the ways to start. */
export function defaultProject(): Project {
  return baseProject(ovalNodes(), pitNodes());
}

/**
 * Bare ground: the Track tool draws the first line.
 *
 * Flat by default, or the generator's rolling country on request -- the same
 * long, low waves a generated circuit is laid over, just without the circuit.
 * ~35 m of relief over the 2 km field is the generator's own proportion, and
 * a line drawn across it picks its elevation off the ground exactly the way
 * clicks always have.
 */
export function emptyProject(opts: { hills?: boolean } = {}): Project {
  const p = baseProject([], []);
  if (opts.hills) p.terrain.heights = rollingHeights(p.terrain, 35);
  return p;
}

/**
 * A circuit the generator drew, on ground of its own.
 *
 * The terrain comes with it rather than being the default field: a 7 km lap
 * does not fit on 2 km of ground, and the elevation the circuit was laid on
 * only means anything if the landscape it came from is underneath it.
 */
export function generatedProject(
  size: CircuitSize = 'medium',
  opts: { trees?: boolean; paddock?: boolean } = {},
  /** Source of randomness, so a test can hand in a seeded one. */
  rng?: () => number,
): Project {
  const layout = generateCircuit(size, DEFAULT_DRAW_CFG.trackWidthL, undefined, undefined, rng, {
    trees: opts.trees ?? true,
    paddock: opts.paddock ?? true,
  });
  const p = baseProject(layout.track, layout.pit);
  p.terrain = layout.terrain;
  p.timing = { ...p.timing, startS: layout.startS };
  // The lane was sized by the generator, so the boxes and the limiter have to
  // come from the same place -- the demo oval's defaults put every box at the
  // mouth of the lane.
  p.pitCfg = { ...p.pitCfg, ...layout.pitCfg };
  // A grid the size of the pit lane: AC caps an online field at the number of
  // pit boxes, so a generated circuit starts with the full forty of both
  // rather than a twenty-car grid in front of a forty-box lane.
  p.grid = { ...p.grid, count: layout.pitCfg.boxCount };
  p.props = layout.props;
  /*
   * A generated circuit comes fenced, all the way round, on both sides.
   *
   * A track drawn by hand starts bare on purpose -- the barrier goes where the
   * person drawing it decides, and painting one on every stretch first is the
   * longer job. The generator is the other button entirely: it is "give me a
   * whole circuit", and a whole circuit is fenced. Left bare it produced a lap
   * with nothing beside it, and the first thing anyone did with it was open
   * the barrier tool and press the same button on every point.
   *
   * The catch fence rather than plain armco, because that is what a circuit of
   * this kind has, and 3.6 m because at the 1.1 m the plain style defaults to
   * a catch fence is armco with a lip on it.
   */
  for (const n of p.track.nodes) {
    n.wallL = true;
    n.wallR = true;
  }
  p.road = { ...p.road, wall: true, wallStyle: 'fence', wallHeight: 3.6 };
  return p;
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

const HISTORY_LIMIT = 50;

/** Serial for deco road ids, like propCounter for objects. */
let decoCounter = 0;

/* Stroke state for the vegetation brush. Module level rather than store state:
   it changes many times per frame and nothing renders from it. */
const strokeCells = new Set<string>();
let strokePlanted = 0;

export type RightTab = 'scene' | 'properties' | 'track' | 'race' | 'ac' | 'export';

/**
 * Which job the editor is doing.
 *
 * The two are genuinely different tools that happen to share a viewport.
 *
 *   'build'  a circuit of this editor's own -- draw the centre line, sculpt the
 *            ground, generate the road. Everything is a parameter and nothing
 *            is fixed.
 *
 *   'edit'   somebody else's finished track out of Assetto Corsa, almost always
 *            modelled in Blender. Nothing is a parameter: the ground, the road
 *            and the scenery are baked triangles, and the work is picking them
 *            up and putting them somewhere better. Sculpting a terrain that is
 *            switched off, or redrawing a centre line that only exists as a
 *            guide, are not just useless here -- they are misleading.
 *
 * Switching is automatic on import and on closing one, and can be forced.
 */
export type EditorMode = 'build' | 'edit';

/** The kerb tool's settings, which every span it draws starts life with. */
export interface KerbCfg {
  style: KerbStyle;
  width: number;
  height: number;
  taper: number;
  apron: number;
}

/**
 * The ground brush.
 *
 * `kind` indexes GROUND_KINDS, so 0 is grass and painting with it is the
 * eraser -- there is no separate "remove" mode because there is nothing to
 * remove: the ground is always made of something.
 */
export interface GroundBrush {
  kind: number;
  radius: number;
  /**
   * How the material is put down.
   *
   *   'brush'    sweep a circle, the freehand way. Verges, the shape of a
   *              gravel trap, anything with no straight line in it.
   *   'rect'     pull a rectangle out. A paddock, an apron, a service road --
   *              the things that ARE rectangles, and that a circle can only
   *              approximate by going round the edge of one twice.
   *   'polygon'  click the corners of an outline and close it. The shape that
   *              is neither round nor square, which on a circuit is most of
   *              them.
   *   'path'     click points along a line and paint a stroke of `pathWidth`
   *              along it. The precise way to lay a service road or a painted
   *              band: dead straight between the points, or one continuous
   *              curve through them with `curve` on.
   */
  mode: 'brush' | 'rect' | 'polygon' | 'path';
  /** Width of a painted line, metres. */
  pathWidth: number;
  /**
   * Corner radius for the rectangle and the outline, metres. 0 keeps every
   * corner square; anything above rounds the corner into a circular fillet
   * while the sides stay dead straight -- the way a real run off area is
   * poured. A radius too big for a side shrinks to what fits.
   */
  cornerRadius: number;
  /**
   * Bend the clicked points into a Catmull-Rom curve THROUGH them, for the
   * path and the polygon alike. Off, every segment is exactly the straight
   * line between two clicks -- which is its own kind of precision.
   */
  curve: boolean;
}

/**
 * How hard the viewport is allowed to work. Pixel count is what usually costs
 * the frame rate on a big monitor, not the geometry, so this mostly controls
 * render resolution and how expensive the surface shading is.
 */
export type Quality = 'high' | 'balanced' | 'fast' | 'draft';

export const QUALITY_DPR: Record<Quality, [number, number]> = {
  high: [1, 2],
  balanced: [1, 1.5],
  fast: [0.75, 1],
  draft: [0.5, 0.75],
};

export interface ViewFlags {
  grid: boolean;
  terrain: boolean;
  road: boolean;
  props: boolean;
  markers: boolean;
  aiLine: boolean;
  wireframe: boolean;
  /** Daylight sky dome instead of the flat panel-dark backdrop. */
  sky: boolean;
}

export interface EditorState {
  project: Project;
  selection: Selection | null;
  tool: Tool;
  brush: BrushSettings;
  /** The ground brush: which material it paints into the terrain, and how wide. */
  ground: GroundBrush;
  /** Library key of the prop the place tool will drop. */
  placeKind: string;
  /** Heading in degrees the place tool drops the next object at. Y axis only. */
  placeRotation: number;
  /**
   * Size of the next ground patch, in metres. Kept here rather than being read
   * back off the last one placed, so dragging one out and then clicking to drop
   * another the same size does what it looks like it should.
   */
  padSize: { w: number; l: number };
  gizmo: 'translate' | 'rotate' | 'scale';
  view: ViewFlags;
  snap: number;
  /** Which tab the right hand panel shows. */
  rightTab: RightTab;
  quality: Quality;
  past: Project[];
  future: Project[];
  status: string;

  commit: (mutate: (p: Project) => void) => void;
  live: (mutate: (p: Project) => void) => void;
  /**
   * Run an edit that comes from a control being dragged.
   *
   * A slider fires on every pixel of mouse travel. Left alone that is a full
   * rebuild and a fresh undo entry per pixel, which is what turned nudging the
   * pit lane into a five second freeze. Everything inside `fn` is coalesced to
   * one rebuild per frame and folded into a single undo step per drag, and the
   * editor is marked busy so the expensive derived work can sit it out.
   */
  tweakRun: (fn: () => void) => void;
  /** Mark the editor as being dragged, self clearing shortly after. */
  markBusy: () => void;
  /** True while a control is being dragged. */
  interacting: boolean;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  replaceProject: (p: Project) => void;

  /**
   * Ticks whenever the viewport should put the whole circuit back in frame.
   *
   * The camera cannot be state -- it moves sixty times a second and nothing
   * renders from it -- so this is a counter the viewport watches instead. It
   * goes up when the project underneath the camera is replaced, which is the
   * one moment the old view is meaningless: a 3 km circuit generated under a
   * camera framed on a 900 m oval is off screen before it is drawn.
   */
  frameEpoch: number;
  /** Ask the viewport to frame everything. */
  frameView: () => void;

  setTool: (t: Tool) => void;
  select: (s: Selection | null) => void;
  setBrush: (b: Partial<BrushSettings>) => void;
  setPlaceKind: (k: string) => void;
  setPlaceRotation: (deg: number) => void;
  setPadSize: (w: number, l: number) => void;
  setGizmo: (g: 'translate' | 'rotate' | 'scale') => void;
  setView: (v: Partial<ViewFlags>) => void;
  setSnap: (n: number) => void;
  setStatus: (s: string) => void;
  setRightTab: (t: RightTab) => void;
  setQuality: (q: Quality) => void;

  /** One dab of the sculpt brush. No history entry, call pushHistory first. */
  sculpt: (x: number, z: number, mode: BrushSettings['mode'], dt: number, flattenTarget: number) => void;
  /**
   * Whether the sculpt brush carries the track and the pit lane with it.
   *
   * On, a stroke over the road moves the control points' heights by the same
   * brush, and the ground under the tarmac -- which is slaved to the road --
   * moves with them: ground, road and lane deform as one surface. Off, the
   * brush shapes only the free landscape and the road holds its line.
   */
  brushRoad: boolean;
  setBrushRoad: (v: boolean) => void;

  setGround: (g: Partial<GroundBrush>) => void;
  /**
   * One dab of the ground brush. No history entry, call pushHistory first.
   * Returns whether the ground actually changed.
   *
   * `kind` is an index into GROUND_KINDS, or -1 to rub the paint out and hand
   * the ground back to whatever it would be unpainted. Those two are not the
   * same as each other: grass is a material you can lay over a gravel run off,
   * and the eraser is how you take a patch off again.
   */
  paintGround: (x: number, z: number, kind: number) => boolean;
  /** A rectangle of ground, in one undo step. */
  paintGroundRect: (rect: GroundRect, kind: number) => boolean;
  /** The inside of an outline, in one undo step. Bent through the points when
      the ground tool's curve toggle is on. */
  paintGroundPolygon: (points: ReadonlyArray<{ x: number; z: number }>, kind: number) => boolean;
  /** A stroke of `ground.pathWidth` along the points, in one undo step.
      `closed` joins the last point back to the first, so a ring is one line. */
  paintGroundPath: (
    points: ReadonlyArray<{ x: number; z: number }>,
    kind: number,
    closed?: boolean,
  ) => boolean;
  /** The whole field at once. -1 empties the paint field rather than filling it. */
  fillGround: (kind: number) => void;
  /**
   * The outline the polygon mode is collecting, in world XZ. Empty when none is
   * being drawn. Kept here rather than in the viewport so the panel can show how
   * many corners are down and offer to finish or drop it.
   */
  groundDraft: Array<[number, number]>;
  setGroundDraft: (points: Array<[number, number]>) => void;
  /** Back to grass everywhere. */
  clearGroundPaint: () => void;

  /* --- imported Assetto Corsa track ------------------------------- */
  /**
   * The loaded track, held here and NOT in the project.
   *
   * It is hundreds of megabytes of somebody else's geometry and it is entirely
   * reconstructible from the installation, so putting it in the project would
   * mean autosaving it into localStorage every few seconds. What the project
   * carries is `acImport`: the folder name and the list of edits.
   */
  acScene: AcScene | null;
  /** Progress of an import in flight, null when nothing is loading. */
  acLoading: { message: string; fraction: number } | null;
  /** Read a track out of the installation and build the project around it. */
  importAcTrack: (slug: string, layout: string, opts?: LoadSceneOptions) => Promise<void>;
  /** Reload the geometry after a change that affects what is drawn. */
  reloadAcScene: (opts?: LoadSceneOptions) => Promise<void>;
  /** Forget the imported track. The edits go with it. */
  closeAcImport: () => void;
  /** Stop drawing one of the imported meshes, or draw it again. */
  setAcMeshHidden: (model: string, mesh: string, hidden: boolean) => void;
  /** Rename an imported mesh, which is how its physics surface is changed. */
  renameAcMesh: (model: string, mesh: string, name: string | null) => void;
  /**
   * Move, turn or resize one of the imported track's own meshes.
   *
   * `null` puts it back exactly where the modder left it. Stored as an OFFSET
   * from the original, so "no change" is provably no change.
   */
  setAcMeshTransform: (model: string, key: string, t: AcMeshTransform | null) => void;
  /**
   * Rebuild the drawing so the meshes being edited can move on their own.
   *
   * The track is drawn merged by material -- a few hundred draw calls instead
   * of hundreds of individual meshes -- and a merged mesh cannot be moved
   * without rebuilding its whole material. So anything the user is moving, or
   * has moved, is pulled OUT of the merge and drawn separately, where its
   * transform costs nothing. This works out which meshes those are and rebuilds
   * only the models whose set actually changed, on a click rather than a frame.
   */
  /** Which job the editor is doing. See EditorMode. */
  mode: EditorMode;
  setMode: (m: EditorMode) => void;
  refreshAcLoose: () => void;
  /**
   * Everything picked out of the imported track, for moving as a group.
   *
   * Separate from `selection`, which stays a single thing and drives the
   * properties panel -- the same split the prop marquee already uses. A plain
   * click replaces this list; shift-click adds to it. A car is four or five
   * meshes and a row of barriers is a dozen pieces, and moving those one at a
   * time is not editing, it is data entry.
   */
  acMarked: AcMeshRef[];
  /** Pick one piece. `add` extends the group instead of replacing it. */
  markAcMesh: (ref: AcMeshRef, add: boolean) => void;
  clearAcMarks: () => void;
  /**
   * Lay down another copy of a piece, one section further along.
   *
   * The answer to "make this kerb longer" that does not stretch it. With the
   * centre line given, "further along" means further along THE TRACK: the copy
   * is a ribbon deformation shifted by one arc length per copy, so sections
   * land end to end round a bend instead of running off it on a tangent.
   * Without frames it falls back to the piece's longest horizontal axis.
   * Returns the new copy's id.
   */
  duplicateAcPiece: (ref: AcMeshRef, frames?: readonly Frame[]) => string | null;
  /**
   * Lay several copies of a piece at once, one undo step.
   *
   * This is what Alt-dragging a ribbon end grip commits: the dragged distance
   * filled with seamless continuations. The transforms come in ready-made --
   * the caller knows the piece's current mapping, this only records them.
   */
  placeAcCopies: (ref: AcMeshRef, list: readonly AcMeshTransform[]) => number;
  /** Move a placed copy. */
  setAcCopyTransform: (model: string, id: string, t: AcMeshTransform | null) => void;
  /** Take a copy away again. */
  removeAcCopy: (model: string, id: string) => void;
  /** Record one change to the imported track's AC_* markers. */
  editAcMarker: (model: string, edit: AcMarkerEdit) => void;
  /** Drop every recorded change to one model's markers. */
  resetAcMarkers: (model: string) => void;

  /**
   * What the kerb tool draws with. Editor state, not project state: it is the
   * setting of a tool, exactly like the brush radius, and every span keeps its
   * own copy of these numbers the moment it is created.
   */
  kerbCfg: KerbCfg;
  setKerbCfg: (c: Partial<KerbCfg>) => void;
  /** Replace the whole list of kerb spans. One undo step. */
  applyKerbs: (fn: (list: KerbSpan[]) => KerbSpan[]) => void;
  /** The same during a drag: no history entry, `pushHistory` first. */
  liveKerbs: (list: KerbSpan[]) => void;
  updateKerb: (id: string, patch: Partial<KerbSpan>) => void;
  deleteKerb: (id: string) => void;

  /** How a click on the ground turns into track points. */
  drawMode: DrawMode;
  setDrawMode: (m: DrawMode) => void;
  /** Width and height a newly drawn point starts with. Tool state, like kerbCfg. */
  drawCfg: DrawCfg;
  setDrawCfg: (c: Partial<DrawCfg>) => void;
  /** Push the configured width onto every point of a path. One undo step. */
  applyDrawWidth: (path: PathId) => number;
  /** The same for the height. Does nothing in 'ground' mode -- see drawHeightOf. */
  applyDrawLevel: (path: PathId, groundAt: (x: number, z: number) => number) => number;

  /** Adds a control point and returns its id, so the caller can select it. */
  addNode: (path: PathId, at: THREE.Vector3, afterId?: string) => string;
  /**
   * Append several points as ONE undo step. A curve is a handful of control
   * points describing a single bend, and pressing undo five times to take back
   * one click is not undo.
   */
  addNodes: (path: PathId, points: THREE.Vector3[]) => string;
  /** Append one point with no history entry, for a freehand stroke. */
  appendNodeLive: (path: PathId, at: THREE.Vector3) => void;
  deleteNode: (path: PathId, id: string) => void;
  /**
   * Which deco road the Road tool is currently extending. Null means the next
   * click starts a new one.
   */
  activeDeco: string | null;
  setActiveDeco: (id: string | null) => void;
  /** Surface the NEXT deco road starts with. Tool state, like drawCfg. */
  decoSurface: DecoSurface;
  setDecoSurface: (s: DecoSurface) => void;
  /** Create an empty deco road, make it the active one, return its id. */
  addDecoRoad: (surface: DecoSurface) => string;
  /** Armed: the next click on the ground drops a roundabout there. */
  roundaboutArm: boolean;
  setRoundaboutArm: (on: boolean) => void;
  /** Centre-line radius of the next roundabout, metres. */
  roundaboutRadius: number;
  setRoundaboutRadius: (r: number) => void;
  addRoundabout: (at: { x: number; y: number; z: number }) => string;
  deleteDecoRoad: (id: string) => void;
  updateDecoRoad: (id: string, patch: Partial<Pick<DecoRoad, 'name' | 'surface' | 'line'>>) => void;
  /** `scale` is per axis, for the ground patches that are sized in metres. */
  addProp: (kind: string, at: THREE.Vector3, rotY?: number, scale?: [number, number, number]) => void;
  /** Move terrain, track, pit lane and every object up or down together. */
  shiftDatum: (delta: number) => number;
  /** Settings the automatic braking boards are worked out with. */
  brakeCfg: BrakeMarkerCfg;
  setBrakeCfg: (c: Partial<BrakeMarkerCfg>) => void;
  /**
   * The barrier tool's two jobs: painting the generated barrier onto the edge
   * of the track, and drawing a free standing run of modules anywhere.
   */
  barrierMode: 'track' | 'free' | 'edge' | 'cut';
  setBarrierMode: (m: 'track' | 'free' | 'edge' | 'cut') => void;
  /** How long a stretch the cut tool takes out, metres. */
  cutLength: number;
  setCutLength: (m: number) => void;
  /**
   * Open the barrier over `cutLength` metres centred on a point of the lap.
   *
   * Takes metres of lap and stores curve parameters: what the pointer knows is
   * where on the ground it is, and what survives a control point being moved
   * later is the parameter. Clicking a stretch that is already open closes it
   * again, so the one tool both makes and unmakes a gap.
   */
  cutBarrierAt: (side: -1 | 1, t: number, metres: number, lapLength: number) => 'cut' | 'restored';
  removeWallCut: (id: string) => void;
  clearWallCuts: () => number;
  /** Open the barrier over every stretch the check found. Returns how many. */
  openBarrierFaults: (faults: Array<{ side: -1 | 1; from: number; to: number }>) => number;
  /**
   * Sideways offset of an edge row from the outer edge of the built-up
   * roadside (road + kerb + strip + run off), metres. Negative moves it onto
   * the run off.
   */
  rowGap: number;
  setRowGap: (g: number) => void;
  /** Which module a drawn run is made of. */
  barrierKind: string;
  setBarrierKind: (k: string) => void;
  /**
   * The run being drawn, as the points clicked so far.
   *
   * The whole line rather than just its end, because a curve has to leave the
   * run in the direction it was already going -- exactly like the track tool,
   * which needs two points before it can bend.
   */
  barrierDraft: Array<[number, number, number]>;
  setBarrierDraft: (p: Array<[number, number, number]>) => void;
  /** Lay modules along a drawn line. Returns how many went down. */
  /**
   * Lay a run of modules along a drawn line.
   *
   * `glue` off keeps the modules at the heights they were given instead of
   * sitting them back on the terrain whenever it is sculpted -- what a run
   * that joins the trackside barrier needs, since that barrier stands on the
   * road's own shoulder rather than on the ground.
   */
  addBarrierRun: (points: Array<{ x: number; y: number; z: number }>, glue?: boolean) => number;
  /** Put down a planned set of boards, replacing every board already there. */
  applyBrakeMarkers: (markers: BrakeMarker[]) => number;
  /** Take them all away again. Returns how many went. */
  clearBrakeMarkers: () => number;
  scatter: ScatterSettings;
  setScatter: (s: Partial<ScatterSettings>) => void;
  /** Start a stroke: clears the spacing grid and the per stroke counter. */
  scatterBegin: () => void;
  /** How many plants the current stroke has put down. */
  scatterPlanted: () => number;
  /** One brush dab. No history entry, call pushHistory first. Returns the count. */
  scatterDab: (x: number, z: number, budget: number, accept: (x: number, z: number) => boolean) => number;
  /** Rub out nearby vegetation. No history entry either. Returns the count. */
  scatterErase: (x: number, z: number, radius: number) => number;
  /** Radius of the object eraser, metres. */
  eraseRadius: number;
  setEraseRadius: (r: number) => void;
  /**
   * Rub out ANY object under the brush, not just vegetation. No history entry:
   * a stroke calls `pushHistory` once and then this many times, so the whole
   * sweep undoes in one go the way a brush stroke should.
   */
  eraseProps: (x: number, z: number, radius: number) => number;
  /**
   * Objects picked out with the marquee, by id.
   *
   * Deliberately NOT the `selection`, which is one thing at a time and drives
   * the gizmo and the properties panel. This is a set to act on -- delete it,
   * count it -- and keeping the two apart means the marquee cannot break
   * anything that reads a selection.
   */
  marked: string[];
  setMarked: (ids: string[]) => void;
  /** Delete every marked object as one undo step. Returns how many went. */
  deleteMarked: () => number;
  /** Drop a whole prefab as one undo step. `key` is the bare prefab key. */
  placePrefab: (key: string, at: THREE.Vector3, rotY?: number) => void;
  deleteProp: (id: string) => void;
  duplicateProp: (id: string) => void;
}

/**
 * The next immutable state: the previous one with `mutate` applied, copying
 * only the objects along the paths that actually changed.
 *
 * This used to be `structuredClone` of the whole project. That made every
 * subobject a new reference on every edit, so every narrow selector in the UI
 * (`s.project.road`, `s.project.terrain`, ...) fired on every keystroke and
 * every drag frame, and the whole interface re-rendered sixty times a second.
 * With structural sharing the untouched branches keep their identity and those
 * selectors work as intended. History entries share the untouched branches too,
 * which also removes the per-edit clone garbage the collector had to chase.
 *
 * Large leaves ride along for free: `assets` and `terrain.heights` are only
 * ever REPLACED, never written into (`sculpt` copies the height field first),
 * so sharing them by reference stays sound exactly as before.
 */
function apply(p: Project, mutate: (p: Project) => void): Project {
  return produce(p, (draft) => {
    mutate(draft as Project);
  });
}

let propCounter = 0;

/** The same, for the stretches of barrier taken back out. */
let cutCounter = 0;

/** Headings are compared and stepped through, so keep them in 0..360. */
function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/* State for `tweak`, kept outside the store because it is pure plumbing. */
const TWEAK_BURST_GAP = 350;
let lastTweakAt = -Infinity;
let pendingTweaks: Array<() => void> = [];
let tweakFrame = 0;
let tweakIdle = 0;
let suppressHistory = false;

/**
 * The shared body of every way of painting the ground.
 *
 * Whatever the shape, the sequence is the same, and two of the steps are the
 * reason the brush does not stutter:
 *
 * The shape is first ASKED whether it would change anything, against the field
 * that is already there. During a sweep the pointer spends most of its time
 * inside the patch it painted two frames ago, and without this every one of
 * those frames would copy a megabyte and cut the whole ground mesh again to
 * arrive back at the picture already on screen.
 *
 * And the copy is made before the write, never written into in place: history
 * entries and the derived cache hold the previous field by reference, exactly
 * as they hold the previous height field.
 */
function applyGroundPaint(
  run: (t: TerrainSettings, paint: Uint8Array, edge: Int8Array | null, probe: boolean) => boolean,
  kind: number,
  history: 'live' | 'commit',
): boolean {
  const s = useEditor.getState();
  const t = s.project.terrain;
  if (!t.enabled) return false;
  const current = t.paint;
  if (current && !run(t, current, null, true)) return false;
  // Nothing to take away from a field that has never been painted on.
  if (!current && kind < 0) return false;

  const next = current ? new Uint8Array(current) : createPaint(t.res);
  /* The edge distances travel with the paint and are copied on write with it,
     so a history entry holds the pair it was taken with. A project from before
     they existed starts an empty one here rather than going without: the shape
     being drawn right now can be cut properly even if the ones under it cannot. */
  const nextEdge =
    t.paintEdge && t.paintEdge.length === next.length
      ? new Int8Array(t.paintEdge)
      : createPaintEdge(t.res);
  if (!run(t, next, nextEdge, false)) return false;
  const write = (p: Project) => {
    p.terrain.paint = next;
    p.terrain.paintEdge = nextEdge;
  };
  if (history === 'live') s.live(write);
  else s.commit(write);
  return true;
}

export const useEditor = create<EditorState>((set, get) => ({
  /*
   * Bare ground until the start dialog says otherwise.
   *
   * The editor used to boot with the demo oval on the field, which made the
   * sample circuit look like part of the tool -- and left anyone drawing their
   * own with twelve control points and a pit lane to delete first.
   */
  project: emptyProject(),
  selection: null,
  tool: 'select',
  brush: { mode: 'raise', radius: 30, strength: 8 },
  // The brush moves the road with the ground by default: the ground under the
  // tarmac follows the road, so a brush that left the road behind left a
  // rigid causeway standing across every valley it dug.
  brushRoad: true,
  // Asphalt at 12 m: a paddock or an access road, which is what this is for.
  // The line is 6 m wide -- a single-track service road. Curve starts OFF:
  // straight between the clicks is the predictable answer, and an outline
  // drawn before the toggle existed must keep coming out with its corners.
  ground: { kind: 1, radius: 12, mode: 'brush', pathWidth: 6, curve: false, cornerRadius: 0 },
  // Two species rather than one, because a single tree repeated reads as a
  // plantation; 7 m is real forestry spacing and keeps the count sane.
  scatter: {
    kinds: ['tree_pine_2d', 'tree_round_2d'],
    radius: 25,
    spacing: 7,
    scaleJitter: 0.2,
    keepOff: 6,
    // Trees, by default, so the run off stays the empty space it is meant to be.
    overRunoff: false,
  },
  placeKind: 'tree_pine_2d',
  placeRotation: 0,
  padSize: { w: PAD_SIZE, l: PAD_SIZE },
  gizmo: 'translate',
  view: { grid: true, terrain: true, road: true, props: true, markers: true, aiLine: true, wireframe: false, sky: true },
  snap: 0,
  rightTab: 'properties',
  quality: 'balanced',
  past: [],
  future: [],
  status: 'Ready',

  commit: (mutate) => {
    // Inside a drag the history entry was already taken once for the whole
    // burst, so this behaves like a live change.
    if (suppressHistory) {
      get().live(mutate);
      return;
    }
    const cur = get().project;
    const next = apply(cur, mutate);
    set((s) => ({
      project: next,
      past: [...s.past, cur].slice(-HISTORY_LIMIT),
      future: [],
    }));
  },

  /** Change the project without creating a history entry (drag in progress). */
  live: (mutate) => {
    set({ project: apply(get().project, mutate) });
  },

  interacting: false,

  /**
   * Mark the editor busy for the next few hundred milliseconds.
   *
   * Called from every route that drags something, rather than relying on a
   * library's mouse-down callback firing. If this flag is missed, the heavy
   * derived work is not deferred and every frame of a drag rebuilds the whole
   * corridor and re-uploads the terrain, which is exactly the failure this is
   * meant to prevent. Making it self-arming removes that dependency.
   */
  markBusy: () => {
    if (!get().interacting) set({ interacting: true });
    clearTimeout(tweakIdle);
    tweakIdle = setTimeout(() => set({ interacting: false }), TWEAK_BURST_GAP) as unknown as number;
  },

  tweakRun: (fn) => {
    const now = performance.now();
    // A fresh burst: one undo step for the whole drag, not one per pixel.
    if (now - lastTweakAt > TWEAK_BURST_GAP) {
      get().pushHistory();
      set({ interacting: true });
    }
    lastTweakAt = now;
    pendingTweaks.push(fn);

    if (!tweakFrame) {
      tweakFrame = requestAnimationFrame(() => {
        tweakFrame = 0;
        const batch = pendingTweaks;
        pendingTweaks = [];
        // History was already taken for this burst, so the commits inside run
        // without adding their own entries.
        suppressHistory = true;
        try {
          for (const f of batch) f();
        } finally {
          suppressHistory = false;
        }
      });
    }

    clearTimeout(tweakIdle);
    tweakIdle = setTimeout(() => set({ interacting: false }), TWEAK_BURST_GAP) as unknown as number;
  },

  /** Call once when a drag starts so a single undo reverts the whole drag. */
  pushHistory: () => {
    // States are never mutated after they leave `apply`, so the entry can be
    // the current object itself; edits build fresh copies on top of it.
    const cur = get().project;
    set((s) => ({ past: [...s.past, cur].slice(-HISTORY_LIMIT), future: [] }));
  },

  undo: () => {
    const { past, project, future } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      project: prev,
      past: past.slice(0, -1),
      future: [project, ...future].slice(0, HISTORY_LIMIT),
      status: 'Undo',
    });
  },

  redo: () => {
    const { future, project, past } = get();
    if (future.length === 0) return;
    set({
      project: future[0],
      future: future.slice(1),
      past: [...past, project].slice(-HISTORY_LIMIT),
      status: 'Redo',
    });
  },

  frameEpoch: 0,
  frameView: () => set((s) => ({ frameEpoch: s.frameEpoch + 1 })),

  replaceProject: (p) =>
    set((s) => ({
      project: p,
      past: [],
      future: [],
      selection: null,
      status: 'Project loaded',
      frameEpoch: s.frameEpoch + 1,
    })),

  setTool: (t) => set({ tool: t, selection: t === 'select' ? get().selection : null }),
  select: (s) => set({ selection: s }),
  setBrush: (b) => set((s) => ({ brush: { ...s.brush, ...b } })),
  setBrushRoad: (v) => set({ brushRoad: v }),
  setPlaceKind: (k) => set({ placeKind: k }),
  setPlaceRotation: (deg) => set({ placeRotation: normalizeDeg(deg) }),
  // A patch with no area at all is invisible and cannot be picked again, so a
  // drag that never left the spot it started at is floored rather than stored.
  setPadSize: (w, l) => set({ padSize: { w: Math.max(1, w), l: Math.max(1, l) } }),
  setGizmo: (g) => set({ gizmo: g }),
  setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
  setSnap: (n) => set({ snap: n }),
  setStatus: (status) => set({ status }),
  setRightTab: (rightTab) => set({ rightTab }),
  setQuality: (quality) => set({ quality }),

  sculpt: (x, z, mode, dt, flattenTarget) => {
    const brush = { ...get().brush, mode };
    const carryRoad = get().brushRoad;
    get().live((p) => {
      // Copy on write: history entries and the derived cache share this array.
      const prev = p.terrain.heights;
      const next = new Float32Array(prev);
      const box = applyBrush(p.terrain, next, x, z, brush, dt, flattenTarget);
      // Remember where this dab painted, so the mesh update can patch just
      // those cells instead of comparing the whole grid.
      // Weakly: see heightsDelta. A strong reference here chains every height
      // field of the session together and never lets any of them go.
      heightsDelta.set(next, { prev: new WeakRef(prev), box });
      p.terrain.heights = next;
      // The road is the height source the ground under it is slaved to, so a
      // brush that should move everything has to move the control points too.
      // Not on an imported circuit: its road is somebody else's mesh, and
      // moving our recovered centre line would shear the overlays off it.
      if (carryRoad && !p.acImport) {
        applyBrushToPath(p.track, x, z, brush, dt, flattenTarget);
        applyBrushToPath(p.pit, x, z, brush, dt, flattenTarget);
      }
    });
  },

  setGround: (g) => set((s) => ({ ground: { ...s.ground, ...g } })),

  paintGround: (x, z, kind) =>
    applyGroundPaint(
      (t, arr, edge, probe) =>
        discPaint(t, arr, edge, x, z, get().ground.radius, paintValue(kind), probe),
      kind,
      // A dab is one frame of a sweep, and the sweep is one undo step, taken
      // when the button went down.
      'live',
    ),

  paintGroundRect: (rect, kind) => {
    // The tool's corner radius rides along unless the rect brought its own.
    const r = rect.r ?? get().ground.cornerRadius;
    return applyGroundPaint(
      (t, arr, edge, probe) => rectPaint(t, arr, edge, { ...rect, r }, paintValue(kind), probe),
      kind,
      'commit',
    );
  },

  paintGroundPolygon: (points, kind) => {
    // Bent through the corners when the tool says so, or the corners rounded
    // into fillets while the sides stay straight. The shaped outline is
    // computed once, not per probe.
    const g = get().ground;
    const shaped = g.curve
      ? smoothOutline(points, true)
      : g.cornerRadius > 0
        ? roundOutline(points, g.cornerRadius, true)
        : points;
    return applyGroundPaint(
      (t, arr, edge, probe) => polygonPaint(t, arr, edge, shaped, paintValue(kind), probe),
      kind,
      'commit',
    );
  },

  paintGroundPath: (points, kind, closed = false) => {
    const g = get().ground;
    const shaped = g.curve ? smoothOutline(points, closed) : points;
    return applyGroundPaint(
      (t, arr, edge, probe) =>
        pathPaint(t, arr, edge, shaped, g.pathWidth, paintValue(kind), probe, closed),
      kind,
      'commit',
    );
  },

  fillGround: (kind) => {
    const t = get().project.terrain;
    if (!t.enabled) return;
    if (kind < 0) {
      get().clearGroundPaint();
      return;
    }
    const next = createPaint(t.res);
    next.fill(paintValue(kind));
    get().commit((p) => {
      p.terrain.paint = next;
      // One material edge to edge has no boundary anywhere, so there is
      // nothing for the cuts to place and the old distances are stale.
      p.terrain.paintEdge = null;
    });
  },

  groundDraft: [],
  setGroundDraft: (groundDraft) => set({ groundDraft }),

  clearGroundPaint: () => {
    if (!get().project.terrain.paint) return;
    get().commit((p) => {
      p.terrain.paint = null;
      p.terrain.paintEdge = null;
    });
  },

  /* --- imported Assetto Corsa track ------------------------------- */

  acScene: null,
  acLoading: null,

  importAcTrack: async (slug, layout, opts) => {
    const edits = emptyAcEdits();
    set({ acLoading: { message: 'starting', fraction: 0 } });
    try {
      const scene = await loadAcScene(slug, layout, edits, {
        ...opts,
        onProgress: (message, fraction) => set({ acLoading: { message, fraction } }),
      });

      const previous = get().acScene;
      if (previous) disposeAcScene(previous);

      /*
       * Pin the recovered centre line onto the circuit that is actually there.
       *
       * What comes out of the AI file is the right shape in roughly the right
       * place -- half a metre out sideways, and its height interpolated across
       * twelve metre gaps. Good enough to say where a corner is, useless for
       * deciding where a painted line goes. So the model itself is asked, once,
       * at import: how high is the road at each control point and how far does
       * it reach either side.
       */
      const probe = new SurfaceProbe(tarmacMeshes(scene));
      let track = scene.track?.path ?? null;
      let conform: ConformReport | null = null;
      if (track && probe.triangleCount > 0) {
        const fitted = conformPathToSurface(track, probe);
        track = fitted.path;
        conform = fitted.report;
        scene.warnings.push(...fitted.report.warnings);
      }
      let pit = scene.pit?.path ?? null;
      if (pit && probe.triangleCount > 0) {
        // The pit lane's own AI file records no widths at all, so measuring it
        // off the mesh is not a refinement here, it is the only source.
        pit = conformPathToSurface(pit, probe, { maxHalfWidth: 12 }).path;
      }
      void conform;

      // The project is rebuilt around the import rather than merged into the
      // one that was open: the demo oval, its terrain and its markers all
      // belong to a different circuit, and leaving them switched on would draw
      // a second track through the middle of the imported one.
      const base = defaultProject();
      const project: Project = {
        ...base,
        acImport: {
          slug,
          layout,
          name: scene.folder.name,
          // Never the source folder. Writing back over the original would
          // destroy the only copy of somebody else's work.
          targetSlug: `${slug}_edit`,
          edits,
        },
        meta: {
          ...base.meta,
          name: scene.folder.name,
          slug: `${slug}_edit`,
          description: `Based on ${scene.folder.name}`,
        },
        track: track ?? base.track,
        pit: pit ?? { closed: false, nodes: [] },
        // The imported track brings its own ground, kerbs and barriers.
        // Everything the editor would GENERATE beside the road starts off, so
        // what is on screen is the real circuit and nothing else.
        road: {
          ...base.road,
          samplesPerSegment: 2,
          kerbs: [],
          edgeLine: false,
          wall: false,
          runoffWidth: 0,
          pitClearance: false,
        },
        terrain: { ...base.terrain, enabled: false },
        grid: { ...base.grid, count: 0 },
      };

      set({
        acScene: scene,
        project,
        past: [],
        future: [],
        selection: null,
        acLoading: null,
        mode: 'edit',
        status: scene.warnings.length > 0
          ? `Imported ${scene.folder.name} with ${scene.warnings.length} note(s)`
          : `Imported ${scene.folder.name}`,
      });
    } catch (e) {
      set({ acLoading: null, status: `Import failed: ${(e as Error).message}` });
      throw e;
    }
  },

  reloadAcScene: async (opts) => {
    const imported = get().project.acImport;
    if (!imported) return;
    set({ acLoading: { message: 'reloading', fraction: 0 } });
    try {
      const scene = await loadAcScene(imported.slug, imported.layout, imported.edits, {
        ...opts,
        onProgress: (message, fraction) => set({ acLoading: { message, fraction } }),
      });
      const previous = get().acScene;
      if (previous) disposeAcScene(previous);
      set({ acScene: scene, acLoading: null });
    } catch (e) {
      set({ acLoading: null, status: `Reload failed: ${(e as Error).message}` });
    }
  },

  closeAcImport: () => {
    const previous = get().acScene;
    if (previous) disposeAcScene(previous);
    set({ acScene: null, acMarked: [], mode: 'build' });
    get().commit((p) => { p.acImport = null; });
  },

  setAcMeshHidden: (model, mesh, hidden) => {
    get().commit((p) => {
      if (!p.acImport) return;
      const list = p.acImport.edits.hidden[model] ?? [];
      const next = hidden
        ? (list.includes(mesh) ? list : [...list, mesh])
        : list.filter((n) => n !== mesh);
      if (next.length > 0) p.acImport.edits.hidden[model] = next;
      else delete p.acImport.edits.hidden[model];
    });
  },

  renameAcMesh: (model, mesh, name) => {
    get().commit((p) => {
      if (!p.acImport) return;
      const map = { ...(p.acImport.edits.renamed[model] ?? {}) };
      if (name === null || name === mesh) delete map[mesh];
      else map[mesh] = name;
      if (Object.keys(map).length > 0) p.acImport.edits.renamed[model] = map;
      else delete p.acImport.edits.renamed[model];
    });
  },

  setAcMeshTransform: (model, key, t) => {
    get().live((p) => {
      if (!p.acImport) return;
      const map = { ...(p.acImport.edits.transforms[model] ?? {}) };
      if (t === null || isIdentityTransform(t)) delete map[key];
      else map[key] = t;
      if (Object.keys(map).length > 0) p.acImport.edits.transforms[model] = map;
      else delete p.acImport.edits.transforms[model];
    });
  },

  mode: 'build',
  setMode: (m) => set({ mode: m, tool: 'select' }),

  acMarked: [],

  markAcMesh: (ref, add) => {
    const current = get().acMarked;
    const already = current.findIndex((r) => sameAcMeshRef(r, ref));
    let next: AcMeshRef[];
    if (!add) next = [ref];
    else if (already >= 0) next = current.filter((_, i) => i !== already);
    else next = [...current, ref];
    set({
      acMarked: next,
      // The last one picked is the one the panel talks about.
      selection: next.length > 0
        ? { kind: 'acMesh', name: ref.name, model: ref.model, part: ref.part }
        : null,
    });
    get().refreshAcLoose();
  },

  clearAcMarks: () => {
    set({ acMarked: [] });
    get().refreshAcLoose();
  },

  refreshAcLoose: () => {
    const { acScene, project, selection } = get();
    if (!acScene || !project.acImport) return;
    const edits = project.acImport.edits;
    const keys = acScene.folder.surfaces.map((x) => x.key);

    const wanted = new Map<string, Set<string>>();
    for (const [model, map] of Object.entries(edits.transforms)) {
      // Keys address PIECES (`name#3`); what has to come out of the merge is
      // the mesh they belong to.
      wanted.set(model, new Set(Object.keys(map).map((k) => parsePartKey(k).mesh)));
    }
    for (const ref of get().acMarked) {
      const list = wanted.get(ref.model) ?? new Set<string>();
      list.add(ref.name);
      wanted.set(ref.model, list);
    }
    if (selection?.kind === 'acMesh') {
      const list = wanted.get(selection.model) ?? new Set<string>();
      list.add(selection.name);
      wanted.set(selection.model, list);
    }

    let changed = false;
    const models = acScene.models.map((m) => {
      const set = wanted.get(m.path) ?? new Set<string>();
      const next = [...set].sort();
      if (next.join(' ') === m.looseNames.join(' ')) return m;
      changed = true;
      return rebuildSceneModel(m, {
        surfaceKeys: keys,
        surfaces: acScene.folder.surfaces,
        hidden: new Set(edits.hidden[m.path] ?? []),
        renamed: new Map(Object.entries(edits.renamed[m.path] ?? {})),
        loose: set,
        withTextures: true,
      });
    });
    if (changed) set({ acScene: { ...acScene, models } });
  },

  duplicateAcPiece: (ref, frames) => {
    const { acScene } = get();
    if (!acScene) return null;
    const model = acScene.models.find((m) => m.path === ref.model);
    const mesh = model?.meshes.find((m) => m.name === ref.name);
    if (!model || !mesh) return null;

    /*
     * Where the copy starts: one whole length further along, counted -- so
     * pressing the button three times gives three sections in a row. It used
     * to hand out the same offset every time, and they stacked in one place.
     */
    const existing = (get().project.acImport?.edits.copies[ref.model] ?? [])
      .filter((c) => c.mesh === ref.name && c.part === ref.part).length;
    const step = existing + 1;

    /*
     * "Further along" means further along THE TRACK when there is one.
     *
     * The old world-axis offset laid copies on a tangent: in a corner the
     * second section already stood off the kerb line and the third left the
     * tarmac -- copies of the very things that follow the corner. So the copy
     * carries a ribbon transform shifted by one arc length per copy, which
     * lays sections end to end round the bend. The straight fallback stays
     * for things the centre line cannot measure (or a missing line).
     */
    let t: AcMeshTransform | null = null;
    if (frames && frames.length > 1) {
      const points = acPieceWorldPoints(model, ref.name, ref.part);
      const bounds = points ? ribbonBounds(frames, points) : null;
      const arc = bounds ? bounds.maxS - bounds.minS : 0;
      if (bounds && arc > 0.5) {
        const stored = get().project.acImport?.edits
          .transforms[ref.model]?.[partKey(ref.name, ref.part)];
        if (stored?.ribbon) {
          /*
           * The source has already been reshaped, so "another one" continues
           * from where it ENDS NOW: same mapping, shifted by what it covers.
           * Continuing from the original band instead would overlap the
           * stretched end -- and moving the original to make room would give
           * up the hole the modder cut for it in the ground.
           */
          const covered = arc * stored.ribbon.length;
          t = { ...stored, p: [stored.p[0], stored.p[1], stored.p[2] + covered * step] };
        } else {
          // The copy measures sideways from the same datum the source does --
          // the edge of the tarmac it hugs -- so a section laid round a bend
          // that widens stays a kerb rather than becoming road.
          const edge = ribbonSideOf(bounds);
          t = {
            p: [0, 0, arc * step], r: [0, 0, 0], s: [1, 1, 1],
            ribbon: {
              length: 1, width: 1, height: 1, anchor: [0.5, 0, 0.5],
              ...(edge ? { edge } : {}),
            },
          };
        }
      }
    }
    if (!t) {
      const box = acMeshBox(model, mesh, ref.part);
      const size = box.getSize(new THREE.Vector3());
      const offset: [number, number, number] = size.x >= size.z
        ? [size.x * step, 0, 0]
        : [0, 0, size.z * step];
      t = { p: offset, r: [0, 0, 0], s: [1, 1, 1] };
    }

    const id = `c${Date.now().toString(36)}${Math.floor(performance.now() % 1000).toString(36)}`;
    get().commit((p) => {
      if (!p.acImport) return;
      const list = [...(p.acImport.edits.copies[ref.model] ?? [])];
      list.push({ id, mesh: ref.name, part: ref.part, t: t! });
      p.acImport.edits.copies[ref.model] = list;
    });
    set({ selection: { kind: 'acCopy', model: ref.model, id } });
    get().refreshAcLoose();
    return id;
  },

  placeAcCopies: (ref, list) => {
    if (list.length === 0) return 0;
    const stamp = Date.now().toString(36);
    get().commit((p) => {
      if (!p.acImport) return;
      const existing = [...(p.acImport.edits.copies[ref.model] ?? [])];
      list.forEach((t, i) => {
        existing.push({ id: `c${stamp}${i.toString(36)}`, mesh: ref.name, part: ref.part, t });
      });
      p.acImport.edits.copies[ref.model] = existing;
    });
    get().refreshAcLoose();
    return list.length;
  },

  setAcCopyTransform: (model, id, t) => {
    get().live((p) => {
      if (!p.acImport) return;
      const list = p.acImport.edits.copies[model];
      if (!list) return;
      const hit = list.find((c) => c.id === id);
      if (hit && t) hit.t = t;
    });
  },

  removeAcCopy: (model, id) => {
    get().commit((p) => {
      if (!p.acImport) return;
      const list = (p.acImport.edits.copies[model] ?? []).filter((c) => c.id !== id);
      if (list.length > 0) p.acImport.edits.copies[model] = list;
      else delete p.acImport.edits.copies[model];
    });
    set({ selection: null });
    get().refreshAcLoose();
  },

  editAcMarker: (model, edit) => {
    get().commit((p) => {
      if (!p.acImport) return;
      const list = p.acImport.edits.markers[model] ?? [];
      // A second move of the same marker replaces the first: the list is a set
      // of final states per marker, not a log, or dragging one box across the
      // pit lane would leave a hundred entries behind it.
      const kept = edit.op === 'add'
        ? list
        : list.filter((e) => !(e.name === edit.name && e.op === edit.op));
      p.acImport.edits.markers[model] = [...kept, edit];
    });
  },

  resetAcMarkers: (model) => {
    get().commit((p) => {
      if (!p.acImport) return;
      delete p.acImport.edits.markers[model];
    });
  },

  kerbCfg: { style: 'ramp', width: 1.2, height: STYLE_HEIGHT.ramp, taper: 3, apron: 0 },
  setKerbCfg: (c) =>
    set((s) => {
      const next = { ...s.kerbCfg, ...c };
      // Switching style moves the height with it unless the height was the very
      // thing being set: a 13 cm sausage carried over to a flat kerb is a kerb
      // twice as tall as any real one.
      if (c.style && c.height === undefined) next.height = STYLE_HEIGHT[c.style];
      return { kerbCfg: next };
    }),

  applyKerbs: (fn) => {
    get().commit((p) => {
      p.road.kerbs = fn(p.road.kerbs);
    });
  },

  liveKerbs: (list) => {
    get().live((p) => {
      p.road.kerbs = list;
    });
  },

  updateKerb: (id, patch) => {
    get().commit((p) => {
      const s = p.road.kerbs.find((x) => x.id === id);
      if (s) Object.assign(s, patch);
    });
  },

  deleteKerb: (id) => {
    get().commit((p) => {
      p.road.kerbs = p.road.kerbs.filter((x) => x.id !== id);
    });
    if (get().selection?.kind === 'kerb') set({ selection: null });
  },

  drawMode: 'free',
  setDrawMode: (drawMode) => set({ drawMode }),

  drawCfg: { ...DEFAULT_DRAW_CFG },
  setDrawCfg: (c) => set((s) => ({ drawCfg: { ...s.drawCfg, ...c } })),

  applyDrawWidth: (path) => {
    const { widthL, widthR } = drawWidths(get().drawCfg, path);
    let n = 0;
    get().commit((p) => {
      for (const node of pathDataOf(p, path)?.nodes ?? []) {
        node.widthL = widthL;
        node.widthR = widthR;
        n += 1;
      }
    });
    return n;
  },

  applyDrawLevel: (path, groundAt) => {
    const cfg = get().drawCfg;
    if (cfg.heightMode === 'ground') return 0;
    let n = 0;
    get().commit((p) => {
      for (const node of pathDataOf(p, path)?.nodes ?? []) {
        node.p[1] = drawHeightOf(cfg, groundAt(node.p[0], node.p[2]));
        n += 1;
      }
    });
    return n;
  },

  /**
   * The width comes from the tool, everything else from the point before it:
   * barriers, run off and banking are properties of the stretch being extended,
   * the width is what the panel is currently set to.
   */
  addNodes: (path, points) => {
    let last = '';
    if (points.length === 0) return last;
    const widths = drawWidths(get().drawCfg, path);
    get().commit((p) => {
      const list = pathDataOf(p, path)?.nodes;
      if (!list) return;
      for (const at of points) {
        const prev = list.length > 0 ? list[list.length - 1] : undefined;
        const node = makeNode(at, { ...prev, ...widths });
        list.push(node);
        last = node.id;
      }
    });
    return last;
  },

  appendNodeLive: (path, at) => {
    const widths = drawWidths(get().drawCfg, path);
    get().live((p) => {
      const list = pathDataOf(p, path)?.nodes;
      if (!list) return;
      const prev = list.length > 0 ? list[list.length - 1] : undefined;
      list.push(makeNode(at, { ...prev, ...widths }));
    });
  },

  addNode: (path, at, afterId) => {
    let created = '';
    get().commit((p) => {
      const list = pathDataOf(p, path)?.nodes;
      if (!list) return;
      // An id that is no longer in the list means the caller is working from a
      // stale copy. Appending is the honest answer; splicing at findIndex + 1
      // put the point at the very front of the track instead.
      const i = afterId ? list.findIndex((n) => n.id === afterId) : -1;
      // The new point copies the stretch it is being inserted into, not
      // whatever happens to sit at the end of the list: dropping a point into
      // the middle of a wide corner should come out wide.
      const template = i >= 0 ? list[i] : list.length > 0 ? list[list.length - 1] : undefined;
      const node = makeNode(at, template);
      created = node.id;
      if (i >= 0) list.splice(i + 1, 0, node);
      else list.push(node);
    });
    return created;
  },

  deleteNode: (path, id) => {
    get().commit((p) => {
      const list = pathDataOf(p, path)?.nodes;
      if (!list) return;
      const i = list.findIndex((n) => n.id === id);
      // A deco road may shrink below two points; the track and pit keep their
      // minimum so the splines they anchor never collapse.
      const min = path === 'track' || path === 'pit' ? 3 : 1;
      if (i >= 0 && list.length >= min) list.splice(i, 1);
    });
    set({ selection: null });
  },

  activeDeco: null,
  setActiveDeco: (activeDeco) => set({ activeDeco }),
  decoSurface: 'asphalt',
  setDecoSurface: (decoSurface) => set({ decoSurface }),

  addDecoRoad: (surface) => {
    decoCounter += 1;
    const id = `dr${Date.now().toString(36)}${decoCounter.toString(36)}`;
    let count = 0;
    get().commit((p) => {
      count = p.decoRoads.length;
      p.decoRoads.push({
        id,
        name: `Road ${count + 1}`,
        surface,
        // A public road carries its centre line; a concrete service path does
        // not. Both are a checkbox afterwards.
        line: surface === 'asphalt',
        path: { closed: false, nodes: [] },
      });
    });
    set({ activeDeco: id });
    return id;
  },

  roundaboutArm: false,
  setRoundaboutArm: (roundaboutArm) => set({ roundaboutArm }),
  roundaboutRadius: 14,
  setRoundaboutRadius: (roundaboutRadius) =>
    set({ roundaboutRadius: Math.min(30, Math.max(8, roundaboutRadius)) }),

  addRoundabout: (at) => {
    decoCounter += 1;
    const id = `dr${Date.now().toString(36)}${decoCounter.toString(36)}`;
    const r = get().roundaboutRadius;
    /* A closed ring of eight points. Eight is enough for the spline to come
       out circular to the eye, and few enough that reshaping it by hand -- an
       oval, a teardrop -- is dragging a handful of handles, not surgery. The
       ring is an ordinary road in every other way: approach roads drawn
       AFTER it dock onto its edge exactly as they dock onto the circuit. */
    const nodes = [] as import('../types').TrackNode[];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      decoCounter += 1;
      nodes.push({
        id: `rb${Date.now().toString(36)}${decoCounter.toString(36)}`,
        p: [at.x + Math.cos(a) * r, at.y, at.z + Math.sin(a) * r],
        widthL: 3.2,
        widthR: 3.2,
        bank: 0,
        wallL: false,
        wallR: false,
        runoffL: 0,
        runoffR: 0,
        wallGapL: 0,
        wallGapR: 0,
        aiOffset: 0,
      });
    }
    let count = 0;
    get().commit((p) => {
      count = p.decoRoads.length;
      p.decoRoads.push({
        id,
        name: `Roundabout ${count + 1}`,
        surface: 'asphalt',
        // No centre line on the ring itself: a roundabout's carriageway is
        // one-way, the line would claim two-way traffic.
        line: false,
        path: { closed: true, nodes },
      });
    });
    set({ roundaboutArm: false, activeDeco: null });
    return id;
  },

  deleteDecoRoad: (id) => {
    get().commit((p) => {
      p.decoRoads = p.decoRoads.filter((r) => r.id !== id);
    });
    const s = get();
    if (s.activeDeco === id) set({ activeDeco: null });
    const sel = s.selection;
    if (
      sel &&
      (sel.kind === 'node' || sel.kind === 'section') &&
      sel.path === `road:${id}`
    ) {
      set({ selection: null });
    }
  },

  updateDecoRoad: (id, patch) => {
    get().commit((p) => {
      const r = p.decoRoads.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    });
  },

  addProp: (kind, at, rotY, scale) => {
    propCounter += 1;
    const id = `p${Date.now().toString(36)}${propCounter.toString(36)}`;
    // A row of identical trees all facing the same way looks planted by a
    // machine, so nature keeps its random spin. Everything man made goes down
    // exactly the way it was aimed, because that is the whole point of being
    // able to aim it.
    const heading =
      LIBRARY_BY_KEY.get(kind)?.category === 'Nature'
        ? Math.random() * 360
        : normalizeDeg(rotY ?? get().placeRotation);
    // A patch dropped with a plain click comes out at the size the panel shows,
    // so what the ghost promised is what lands.
    const pad = get().padSize;
    const s: [number, number, number] =
      scale ??
      (LIBRARY_BY_KEY.get(kind)?.category === 'Ground'
        ? [pad.w / PAD_SIZE, 1, pad.l / PAD_SIZE]
        : [1, 1, 1]);
    const inst: PropInstance = {
      id,
      kind,
      name: `${kind}_${propCounter}`,
      p: [at.x, at.y, at.z],
      r: [0, heading, 0],
      s,
      ground: true,
    };
    get().commit((p) => {
      p.props.push(inst);
    });
    set({ selection: { kind: 'prop', id } });
  },

  deleteProp: (id) => {
    get().commit((p) => {
      p.props = p.props.filter((x) => x.id !== id);
    });
    set({ selection: null });
  },

  /*
   * Move the whole project up or down together.
   *
   * A project saved before the ground started at zero carries its old datum
   * inside it, so its terrain sits at -0.6 and everything built on it with it.
   * Shifting only the ground would drop the track into a trench; shifting
   * EVERYTHING keeps the circuit exactly as it was and only changes what the
   * numbers are measured from -- which is the whole point of a datum.
   */
  shiftDatum: (delta) => {
    if (Math.abs(delta) < 1e-9) return 0;
    get().commit((p) => {
      p.terrain.base += delta;
      const h = p.terrain.heights;
      const moved = new Float32Array(h.length);
      for (let i = 0; i < h.length; i++) moved[i] = h[i] + delta;
      p.terrain.heights = moved;
      for (const n of p.track.nodes) n.p[1] += delta;
      for (const n of p.pit.nodes) n.p[1] += delta;
      for (const r of p.decoRoads) for (const n of r.path.nodes) n.p[1] += delta;
      for (const prop of p.props) prop.p[1] += delta;
      // The hand placed grid slots and pit boxes are absolute positions too.
      for (const o of Object.values(p.grid.overrides)) o.p[1] += delta;
      for (const o of Object.values(p.pitCfg.overrides)) o.p[1] += delta;
    });
    return delta;
  },

  brakeCfg: { ...DEFAULT_BRAKE_CFG },
  setBrakeCfg: (c) => set((s) => ({ brakeCfg: { ...s.brakeCfg, ...c } })),

  barrierMode: 'track',
  setBarrierMode: (barrierMode) => set({ barrierMode, barrierDraft: [] }),
  cutLength: 12,
  setCutLength: (cutLength) => set({ cutLength }),

  cutBarrierAt: (side, t, metres, lapLength) => {
    const half = lapLength > 0 ? metres / 2 / lapLength : 0.005;
    const closed = get().project.track.closed;
    // Already open here? Then the click means "put it back", which is the only
    // way to undo a cut without hunting for it in a list.
    const hit = get().project.road.wallCuts.find((c) => {
      if (c.side !== side) return false;
      return c.from <= c.to
        ? t >= c.from && t <= c.to
        : t >= c.from || t <= c.to;
    });
    if (hit) {
      get().commit((p) => {
        p.road.wallCuts = p.road.wallCuts.filter((c) => c.id !== hit.id);
      });
      return 'restored';
    }
    let from = t - half;
    let to = t + half;
    if (closed) {
      from = (from + 1) % 1;
      to = (to + 1) % 1;
    } else {
      from = Math.max(0, from);
      to = Math.min(1, to);
    }
    /*
     * Swallow the neighbours instead of lining up beside them.
     *
     * Clicking along a stretch to take out forty metres of barrier means three
     * or four clicks, and unless they land exactly a length apart each pair
     * leaves a slice of barrier standing between them -- a two metre island of
     * fence in the middle of a gap, which is worse than what was there before.
     * Anything this cut touches, or comes within a few metres of, is absorbed
     * into it, so a run of clicks grows ONE opening.
     */
    const near = half * 0.5 + 0.002;
    const overlaps = (a0: number, a1: number, b0: number, b1: number) => {
      const spans = (x0: number, x1: number): Array<[number, number]> =>
        x0 <= x1 ? [[x0, x1]] : [[x0, 1], [0, x1]];
      for (const [p0, p1] of spans(a0, a1)) {
        for (const [q0, q1] of spans(b0, b1)) {
          if (p0 - near <= q1 && q0 - near <= p1) return true;
        }
      }
      return false;
    };
    const merged = get().project.road.wallCuts.filter(
      (c) => c.side === side && overlaps(from, to, c.from, c.to),
    );
    for (const c of merged) {
      // Union on the ring: keep whichever end reaches further out each way.
      const ext = (x: number, edge: number, forward: boolean) => {
        const d = forward ? (x - edge + 1) % 1 : (edge - x + 1) % 1;
        return d < 0.5;
      };
      if (ext(c.from, from, false)) from = c.from;
      if (ext(c.to, to, true)) to = c.to;
    }
    cutCounter += 1;
    const gone = new Set(merged.map((c) => c.id));
    get().commit((p) => {
      p.road.wallCuts = p.road.wallCuts.filter((c) => !gone.has(c.id));
      p.road.wallCuts.push({ id: `wc${Date.now().toString(36)}${cutCounter.toString(36)}`, side, from, to });
    });
    return 'cut';
  },

  removeWallCut: (id) => {
    get().commit((p) => {
      p.road.wallCuts = p.road.wallCuts.filter((c) => c.id !== id);
    });
  },

  clearWallCuts: () => {
    const had = get().project.road.wallCuts.length;
    if (had === 0) return 0;
    get().commit((p) => { p.road.wallCuts = []; });
    return had;
  },

  openBarrierFaults: (faults) => {
    if (faults.length === 0) return 0;
    get().commit((p) => {
      for (const f of faults) {
        cutCounter += 1;
        p.road.wallCuts.push({
          id: `wc${Date.now().toString(36)}${cutCounter.toString(36)}`,
          side: f.side,
          from: f.from,
          to: f.to,
        });
      }
    });
    return faults.length;
  },

  barrierKind: 'armco',
  setBarrierKind: (barrierKind) => set({ barrierKind }),
  rowGap: 1,
  setRowGap: (rowGap) => set({ rowGap }),
  barrierDraft: [],
  setBarrierDraft: (barrierDraft) => set({ barrierDraft }),

  /*
   * One click of the free barrier tool: a whole run of modules, one undo step.
   *
   * The module length comes from the TILE box, not the visual one -- the same
   * measurement the edge snapping uses. An armco rail is 8 m of rail with posts
   * inside it; measuring the posts would leave a gap at every joint.
   */
  addBarrierRun: (points, glue = true) => {
    const kind = get().barrierKind;
    const box = propTileBox(kind);
    const pieces = layBarrierRun(points, Math.max(0.5, box.hz * 2));
    if (pieces.length === 0) return 0;
    get().commit((p) => {
      for (const piece of pieces) {
        propCounter += 1;
        p.props.push({
          id: `p${Date.now().toString(36)}${propCounter.toString(36)}`,
          kind,
          name: `${kind}_${propCounter}`,
          p: [...piece.p],
          r: [...piece.rot],
          // Stretched along its own run so its ends land exactly on the next
          // module's: what closes the gaps a curve used to open up.
          s: [1, 1, piece.sz],
          /* A run joined to the trackside barrier must NOT be re-glued to the
             terrain: its foot stands on the outer edge of the run off, which
             belongs to the road, and the ground beside it can be metres lower.
             Gluing it would tear the join apart the next time anyone sculpts. */
          ground: glue,
        });
      }
    });
    return pieces.length;
  },

  /*
   * Replace every braking board on the circuit in one step.
   *
   * Replace rather than add: the boards are worked out from the shape of the
   * track, so pressing the button again after moving a corner has to produce
   * the set that belongs to the track as it is now -- adding would leave the
   * old ones stranded where the corner used to be, and there is no way for
   * anyone to tell which is which afterwards.
   */
  applyBrakeMarkers: (markers) => {
    get().commit((p) => {
      p.props = p.props.filter((x) => !BRAKE_MARKER_KINDS.includes(x.kind));
      for (const m of markers) {
        propCounter += 1;
        p.props.push({
          id: `p${Date.now().toString(36)}${propCounter.toString(36)}`,
          kind: m.kind,
          name: `Braking ${m.distance} m`,
          p: [...m.p],
          r: [0, m.rotY, 0],
          s: [1, 1, 1],
          ground: true,
        });
      }
    });
    set({ selection: null });
    return markers.length;
  },

  clearBrakeMarkers: () => {
    let gone = 0;
    get().commit((p) => {
      const before = p.props.length;
      p.props = p.props.filter((x) => !BRAKE_MARKER_KINDS.includes(x.kind));
      gone = before - p.props.length;
    });
    set({ selection: null });
    return gone;
  },

  setScatter: (s) => set((st) => ({ scatter: { ...st.scatter, ...s } })),

  scatterBegin: () => {
    strokeCells.clear();
    strokePlanted = 0;
  },

  /**
   * Plant one dab of the vegetation brush.
   *
   * Follows the sculpt brush's contract exactly: it goes through `live`, never
   * `commit`, and takes no history entry of its own, so a whole stroke is one
   * undo. Going through `addProp` per tree would push one entry each and blow
   * the 50 deep history away after fifty of them.
   *
   * `accept` is the caller's veto -- it knows where the road is.
   */
  scatterDab: (x, z, budget, accept) => {
    const cfg = get().scatter;
    const kinds = cfg.kinds.filter((k) => LIBRARY_BY_KEY.has(k));
    if (kinds.length === 0 || budget <= 0) return 0;

    const made: PropInstance[] = [];
    const cell = Math.max(0.5, cfg.spacing);
    // Enough tries to fill a fresh disc without spinning when it is already
    // full: every rejection is cheap, and the stroke thins out by itself.
    for (let tries = 0; tries < budget * 6 && made.length < budget; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = cfg.radius * Math.sqrt(Math.random());
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      // Thin towards the rim, the same falloff the sculpt brush uses, so a
      // stroke fades into the ground instead of ending in a shaved disc.
      const t = r / Math.max(1e-6, cfg.radius);
      if (Math.random() < t * t * (3 - 2 * t)) continue;
      if (!accept(px, pz)) continue;

      /* The minimum gap, kept here rather than by the caller so it is part of
         what a dab guarantees. The brush loop keeps firing while the pointer
         stands still, so without it a pause plants a pile on one spot. */
      const cx = Math.floor(px / cell);
      const cz = Math.floor(pz / cell);
      let crowded = false;
      for (let a2 = -1; a2 <= 1 && !crowded; a2++) {
        for (let b = -1; b <= 1; b++) if (strokeCells.has(`${cx + a2}:${cz + b}`)) { crowded = true; break; }
      }
      if (crowded) continue;
      strokeCells.add(`${cx}:${cz}`);

      propCounter += 1;
      const kind = kinds[(Math.random() * kinds.length) | 0];
      const s = 1 + (Math.random() * 2 - 1) * cfg.scaleJitter;
      made.push({
        id: `p${Date.now().toString(36)}${propCounter.toString(36)}`,
        kind,
        name: `${kind}_${propCounter}`,
        p: [px, 0, pz],
        r: [0, Math.random() * 360, 0],
        s: [s, s, s],
        // Re-sampled against the terrain when drawn, so a stroke over a hill
        // does not have to know the height.
        ground: true,
      });
    }
    if (made.length === 0) return 0;
    strokePlanted += made.length;
    // One immer pass for the whole frame's worth, not one per plant.
    get().live((p) => {
      p.props.push(...made);
    });
    return made.length;
  },

  scatterPlanted: () => strokePlanted,

  /**
   * Rub out scattered plants. Only ever vegetation, whatever is selected in
   * the palette, so the brush physically cannot delete a grandstand.
   */
  scatterErase: (x, z, radius) => {
    const r2 = radius * radius;
    let removed = 0;
    get().live((p) => {
      p.props = p.props.filter((inst) => {
        if (LIBRARY_BY_KEY.get(inst.kind)?.category !== 'Nature') return true;
        const dx = inst.p[0] - x;
        const dz = inst.p[2] - z;
        if (dx * dx + dz * dz > r2) return true;
        removed += 1;
        return false;
      });
    });
    if (removed > 0) {
      const sel = get().selection;
      if (sel?.kind === 'prop' && !get().project.props.some((x2) => x2.id === sel.id)) {
        set({ selection: null });
      }
    }
    return removed;
  },

  eraseRadius: 12,
  setEraseRadius: (eraseRadius) => set({ eraseRadius }),

  /*
   * The same shape as scatterErase, without the "only plants" rule.
   *
   * Deleting a hundred cones one click at a time is not a thing anybody should
   * have to do, and the vegetation brush could only ever take back its own
   * work. What is measured is the object's ORIGIN, not its footprint: a
   * grandstand whose centre is outside the circle survives, which is the only
   * behaviour that lets you rub out the tyres in front of it without taking
   * the stand with them.
   */
  eraseProps: (x, z, radius) => {
    const r2 = radius * radius;
    let removed = 0;
    get().live((p) => {
      p.props = p.props.filter((inst) => {
        const dx = inst.p[0] - x;
        const dz = inst.p[2] - z;
        if (dx * dx + dz * dz > r2) return true;
        removed += 1;
        return false;
      });
    });
    if (removed > 0) {
      const sel = get().selection;
      if (sel?.kind === 'prop' && !get().project.props.some((x2) => x2.id === sel.id)) {
        set({ selection: null });
      }
      const live = new Set(get().project.props.map((p) => p.id));
      const marked = get().marked.filter((id) => live.has(id));
      if (marked.length !== get().marked.length) set({ marked });
    }
    return removed;
  },

  marked: [],
  setMarked: (marked) => set({ marked }),

  deleteMarked: () => {
    const ids = new Set(get().marked);
    if (ids.size === 0) return 0;
    let gone = 0;
    get().commit((p) => {
      const before = p.props.length;
      p.props = p.props.filter((x) => !ids.has(x.id));
      gone = before - p.props.length;
    });
    set({ marked: [], selection: null });
    return gone;
  },

  placePrefab: (key, at, rotY) => {
    const def = PREFABS_BY_KEY.get(key);
    if (!def) return;
    const instances = instantiatePrefab(def, at, normalizeDeg(rotY ?? get().placeRotation), () => {
      propCounter += 1;
      return `p${Date.now().toString(36)}${propCounter.toString(36)}`;
    });
    if (instances.length === 0) return;
    // One commit for the whole arrangement: dropping a pit complex and then
    // pressing undo a dozen times to take it back is not undo, it is penance.
    get().commit((p) => {
      for (const inst of instances) p.props.push(inst);
    });
    set({ selection: { kind: 'prop', id: instances[0].id }, status: `Placed ${def.label}` });
  },

  duplicateProp: (id) => {
    const src = get().project.props.find((x) => x.id === id);
    if (!src) return;
    propCounter += 1;
    const nid = `p${Date.now().toString(36)}${propCounter.toString(36)}`;

    // Where the copy goes depends on what it is. A building extends the terrace
    // sideways, a barrier carries the run on past its own end, and anything
    // else just steps clear of the original so the copy is visible at all.
    const rule = tileRuleOf(src.kind);
    const f = tileBoxOf(src.kind);
    // Free placing objects step clear of the original rather than tiling with
    // it. Four metres is enough for a cone or a tree; for an imported model it
    // is not -- a 60 m hall duplicated 4 m to the side lands inside itself, and
    // the copy looks like nothing happened. So the step is at least the width
    // of the thing being copied.
    const clearX = Math.max(4, 2 * f.hx * src.s[0]);
    const clearZ = Math.max(4, 2 * f.hz * src.s[2]);
    const localX = rule === 'grid' ? 2 * f.hx * src.s[0] : rule === 'row' ? 0 : clearX;
    const localZ = rule === 'row' ? 2 * f.hz * src.s[2] : rule === 'grid' ? 0 : clearZ;
    const a = THREE.MathUtils.degToRad(src.r[1]);
    const cos = Math.cos(a);
    const sin = Math.sin(a);

    get().commit((p) => {
      p.props.push({
        ...src,
        id: nid,
        name: `${src.name}_copy`,
        p: [src.p[0] + localX * cos + localZ * sin, src.p[1], src.p[2] - localX * sin + localZ * cos],
        // Fresh arrays: the spread shares them with the original, and immer
        // hands out live objects rather than frozen ones here.
        r: [src.r[0], src.r[1], src.r[2]],
        s: [src.s[0], src.s[1], src.s[2]],
      });
    });
    set({ selection: { kind: 'prop', id: nid } });
  },
}));

/* ------------------------------------------------------------------ */
/* Surviving a hot reload                                              */
/* ------------------------------------------------------------------ */

/*
 * The dev server swaps modules in place while the page keeps running. This
 * module both defines the store and creates it, so a hot update used to build
 * a brand new store seeded with `defaultProject()` -- editing anything in here
 * threw away whatever the user had open, with no warning and no undo.
 *
 * So the data is handed across the swap: the outgoing module parks it, the
 * incoming one adopts it. Only the data, never the actions -- those are
 * closures over the store that is going away, and reinstating them would leave
 * every edit writing into a store nothing renders from.
 *
 * Development only. Vite strips `import.meta.hot` from a production build.
 */
const hot = (import.meta as { hot?: {
  data: Record<string, unknown>;
  dispose: (cb: () => void) => void;
  accept: () => void;
} }).hot;

// The store on the console, development only: `__editor.getState()` is how a
// selection or an action can be exercised without aiming at a 3 px sphere.
// Optional, because only Vite defines import.meta.env: the verify tools load
// this module under plain node, where the bare read threw and took the whole
// suite down with it.
if (import.meta.env?.DEV) {
  (globalThis as Record<string, unknown>).__editor = useEditor;
}

if (hot) {
  const carried = hot.data.editorState as Partial<EditorState> | undefined;
  if (carried) useEditor.setState(carried);

  hot.dispose(() => {
    const state = useEditor.getState() as unknown as Record<string, unknown>;
    hot.data.editorState = Object.fromEntries(
      Object.entries(state).filter(([, v]) => typeof v !== 'function'),
    );
  });
  // Take the update here rather than letting it climb to the app root, which
  // Vite answers with a full page reload -- and a full reload is the other way
  // to lose the session.
  hot.accept();
}
