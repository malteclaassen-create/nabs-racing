import { useMemo } from 'react';
import type * as THREE from 'three';
import { useEditor } from './store';
import { computeFrames, pathLength, type Frame } from '../core/spline';
import {
  buildDecoRoadMeshes,
  buildPitMeshes,
  buildRoadMeshes,
  sideProfile,
  type MeshDef,
  type SideProfile,
} from '../core/road';
import {
  applyCorridorMask,
  buildCorridorMask,
  heightsDelta,
  pitCorridor,
  roadCorridor,
  terrainMesh,
  GROUND_KINDS,
  createPaint,
  createPaintEdge,
  cutSubCell,
  paintCellSize,
  paintGroundPath,
  paintGroundPolygon,
  paintValue,
  sampleGroundValueSmooth,
  sampleHeights,
  paintKind,
  shapeOutline,
  type Corridor,
  type CorridorMask,
} from '../core/terrain';
import { buildAiLine, buildAllMarkers, type AiPoint, type MarkerSet } from '../core/markers';
import { buildGridBoxes } from '../core/gridBoxes';
import { buildStartGantry } from '../core/gantry';
import {
  attachRoadEnds,
  attachRoadToPads,
  mergePitFrames,
  pitLead,
  type PadRect,
  pitApronWidths,
  pitRoadClip,
  pitTrackLines,
  roadEndGap,
  type PitClip,
  type PitLead,
  type PitMerge,
  type PitTrackLine,
} from '../core/pitLink';
import { isGroundPad, PAD_SIZE } from '../core/library';
import { hash, memoSlot, memoSlotReusing, type Hasher } from '../core/hash';
import type { PathData, Project, RoadSettings, TerrainSettings } from '../types';

/**
 * Everything that is computed from the project. One place, so the viewport and
 * the exporter can never disagree about what the track looks like.
 *
 * Each stage is memoised on a signature of the values it actually depends on,
 * not on object identity. Editing the track name, dragging a prop or moving a
 * grid slot therefore does not touch the terrain, which is by far the most
 * expensive thing here.
 */
export interface Derived {
  trackFrames: Frame[];
  pitFrames: Frame[];
  roadMeshes: MeshDef[];
  pitMeshes: MeshDef[];
  /**
   * The paint on the starting grid. Its own list rather than part of the road:
   * it hangs off the grid settings, not off the shape of the circuit, so
   * widening a box must not cost a road rebuild.
   */
  gridMeshes: MeshDef[];
  /**
   * The bridge over the start/finish line. Its own list for the same reason as
   * the grid paint: it follows the timing line and the width of the circuit
   * under it, and dragging the line along the lap must not rebuild the road.
   */
  gantryMeshes: MeshDef[];
  terrainHeights: Float32Array;
  /**
   * The terrain with the ground shapes rendered into its paint. What anything
   * reading the PAINT has to use -- the stored terrain only carries the hand
   * raster. Identical to project.terrain while there are no shapes.
   */
  paintTerrain: TerrainSettings;
  terrainDef: MeshDef | null;
  markers: MarkerSet;
  ai: AiPoint[];
  trackLength: number;
  pitLength: number;
  /**
   * The pit lane exactly as `buildPitMeshes` draws it, and its arc length.
   *
   * NOT the same ribbon as `pitFrames`: the drawn one is carried on past both
   * ends into the junction with the circuit, and it is along THAT one that the
   * limiter distances are measured -- `band(limitStart)` in road.ts walks these
   * frames' `dist`. Anything that has to line up with the painted limiter line,
   * the handles in the viewport above all, has to walk the same set; built on
   * `pitFrames` the grips sit metres off the line they are supposed to hold.
   */
  pitDrawFrames: Frame[];
  pitDrawLength: number;
  /**
   * Concrete shoulder width per pitDrawFrames cross section -- wider along
   * the boxes, tapering through the lead wedges. The 3D grass keeps off the
   * pit band with exactly these widths, so it never stands on the concrete.
   */
  pitApron: Float32Array;
  /**
   * What is REALLY drawn of the pit band, per pitDrawFrames cross section: a
   * lateral interval, clipped where the band runs onto the circuit's tarmac.
   * The 3D grass reads it so its keep-off ends exactly where the concrete
   * does -- a keep-off built from widths alone left bald corners at both ends
   * of the lane, on ground the clip had already handed back to the grass.
   */
  pitClip: PitClip;
  /** Side of the track the pit lane runs on. -1 left, 1 right, 0 none. */
  pitSide: -1 | 0 | 1;
  /**
   * Effective width of everything beside the tarmac, per cross section. The
   * barrier tool draws its handles along the same edge the barrier stands on,
   * so it has to read the widths the road actually settled on rather than the
   * ones that were asked for.
   */
  profile: SideProfile;
  /** Lowest point of the ground, so the reference grid can sit below it. */
  terrainMinY: number;
  /** The decorative roads, drawn and glued to the circuit where they meet it. */
  decoMeshes: MeshDef[];
  /** The drawn centre line of each deco road, for the viewport's handles. */
  decoLines: Array<{ id: string; frames: Frame[]; closed: boolean }>;
}

/* ------------------------------------------------------------------ */
/* Signatures                                                          */
/* ------------------------------------------------------------------ */

function feedPath(h: Hasher, path: PathData) {
  h.bool(path.closed).num(path.nodes.length);
  for (const n of path.nodes) {
    h.vec3(n.p)
      .num(n.widthL)
      .num(n.widthR)
      .num(n.bank)
      .bool(n.wallL)
      .bool(n.wallR)
      .num(n.runoffL)
      .num(n.runoffR)
      .num(n.wallGapL)
      .num(n.wallGapR)
      .num(n.aiOffset);
  }
}

/**
 * Only what decides how WIDE things are beside the road.
 *
 * Split out from the full road signature because the two are wanted at
 * different rates. The side profile is the single most expensive step of a
 * rebuild -- nine milliseconds on a long circuit -- and the terrain corridor
 * hangs off it as well, but a kerb's STYLE, its colour, the texture scale or
 * whether the edge line is painted change none of the widths: they change what
 * gets drawn on ground the profile has already settled. Keyed on the whole lot,
 * switching a kerb from plain to rippled paid for the profile, the corridor and
 * a terrain rebuild to draw the same shape in a different pattern.
 */
function feedRoadShape(h: Hasher, r: RoadSettings) {
  h.num(r.kerbWidth)
    .num(r.runoffWidth)
    .num(r.runoffDrop)
    .bool(r.wall)
    .bool(r.pitClearance)
    .num(r.pitGap)
    .num(r.kerbs.length);
  for (const k of r.kerbs) {
    h.str(k.side < 0 ? 'L' : 'R')
      .num(k.from)
      .num(k.to)
      // Not the style itself -- only whether it is the one style that has no
      // kerb at all, which is the only way the style touches a width.
      .bool(k.style === 'none')
      .num(k.width)
      .num(k.height)
      .num(k.taper)
      .num(k.apron);
  }
}

/** Everything the road MESHES depend on, the shape included. */
function feedRoad(h: Hasher, r: RoadSettings) {
  feedRoadShape(h, r);
  h.num(r.kerbHeight)
    .bool(r.edgeLine)
    .num(r.edgeLineWidth)
    .str(r.apronColour)
    .str(r.runoffSurface)
    .num(r.wallHeight)
    .str(r.wallStyle)
    .num(r.uvLength)
    .num(r.uvWidth);
  /* Where the barrier has been opened. In the MESH key and deliberately not in
     feedRoadShape: a cut moves no width, so it owes the side profile and the
     terrain corridor nothing -- but it is the whole of what the barrier mesh
     looks like, and without it here the memo handed back the barrier as it was
     and the viewport only caught up when something else forced a rebuild. */
  h.num(r.wallCuts?.length ?? 0);
  for (const c of r.wallCuts ?? []) h.str(c.side < 0 ? 'L' : 'R').num(c.from).num(c.to);
  for (const k of r.kerbs) h.str(k.style);
}

function feedTerrainMeta(h: Hasher, t: TerrainSettings) {
  h.bool(t.enabled).num(t.res).num(t.size).num(t.originX).num(t.originZ).num(t.base).num(t.blend);
}

/* ------------------------------------------------------------------ */
/* Memo slots                                                          */
/* ------------------------------------------------------------------ */

const slotTrackFrames = memoSlot<Frame[]>();
const slotPitFrames = memoSlot<Frame[]>();
const slotPitMerge = memoSlot<PitMerge>();
const slotPitClip = memoSlot<PitClip>();
const slotPitLines = memoSlot<PitTrackLine[]>();
/**
 * The frames the pit MESHES are drawn from: the lane plus a lead-out at each
 * end that carries the ribbon on to the circuit. Kept apart from `pitFrames`
 * on purpose -- the AI line, the pit boxes and the ground corridor all measure
 * the lane the author drew, and a junction wedge is not part of it.
 */
interface PitDraw {
  frames: Frame[];
  /** How strongly each cross section is glued to the road, from mergePitFrames. */
  weight: Float32Array;
  from: number;
  to: number;
  length: number;
  /** The lead exactly as pitLead returned it, for the line handover below. */
  raw: PitLead;
}
const slotPitDraw = memoSlot<PitDraw>();
const slotRoadMeshes = memoSlot<MeshDef[]>();
/**
 * Every deco road together: meshes, ground corridors and centre lines. One
 * slot for the lot -- a single road is a few hundred cross sections, so
 * rebuilding all of them when one moves costs less than the bookkeeping of a
 * slot per road would.
 */
interface DecoBuild {
  meshes: MeshDef[];
  corridors: Corridor[];
  lines: Array<{ id: string; frames: Frame[]; closed: boolean }>;
}
const slotDeco = memoSlot<DecoBuild>();
const slotPitMeshes = memoSlot<MeshDef[]>();
const slotPitApron = memoSlot<Float32Array>();
const slotProfile = memoSlot<SideProfile>();
const slotMask = memoSlot<CorridorMask>();
const slotHeights = memoSlot<Float32Array>();
const slotTerrainDef = memoSlotReusing<MeshDef | null>();
const slotPaintFx = memoSlot<TerrainSettings>();
const slotMarkers = memoSlot<MarkerSet>();
const slotGridMeshes = memoSlot<MeshDef[]>();
const slotGantryMeshes = memoSlot<MeshDef[]>();
const slotAi = memoSlot<AiPoint[]>();
/** Full-grid min scan, so typing in the name field does not pay for it. */
const slotMinY = memoSlot<number>();

/**
 * Hand each new mesh the buffers of the equally shaped one it replaces, so a
 * rebuild overwrites numbers instead of allocating a fresh set of GPU buffers
 * every frame. Anything left over is freed once React has committed.
 */
/** Name to geometry, so a rebuild can write straight into last frame's buffers. */
function reuseMap(previous: MeshDef[]): Map<string, THREE.BufferGeometry> {
  const m = new Map<string, THREE.BufferGeometry>();
  for (const def of previous) m.set(def.name, def.geometry);
  return m;
}

/** Free anything the rebuild did not take over. */
function retire(previous: MeshDef[], next: MeshDef[]) {
  const keep = new Set<THREE.BufferGeometry>(next.map((m) => m.geometry));
  const dead = previous.filter((m) => !keep.has(m.geometry)).map((m) => m.geometry);
  if (dead.length > 0) setTimeout(() => dead.forEach((g) => g.dispose()), 200);
}

let lastRoad: MeshDef[] = [];
let lastPit: MeshDef[] = [];
let lastDeco: MeshDef[] = [];
let lastGrid: MeshDef[] = [];
let lastGantry: MeshDef[] = [];

/**
 * The last full result, so an interactive drag can borrow the expensive parts
 * of it instead of redoing them dozens of times a second.
 */
let lastMask: CorridorMask | null = null;
let lastAi: AiPoint[] | null = null;

/**
 * What the current terrain geometry was built from: which sculpted height
 * field and which corridor mask. Needed to decide whether the brush's "I only
 * painted here" note still applies to the buffers on the GPU.
 */
let lastTerrainBuild: { sculpted: Float32Array; mask: CorridorMask } | null = null;

/**
 * What of the editor's own road output belongs on an IMPORTED track.
 *
 * The circuit already has a road, a run off and a pit lane. Drawing ours on top
 * of them puts two surfaces at the same height in the same place, and the depth
 * buffer then picks a winner per pixel per frame -- which on screen is the
 * chaotic light/dark patchwork across the tarmac that this was reported as. In
 * the exported model it would be worse than ugly: a second physics surface a
 * centimetre above the racing line.
 *
 * So only what is DRAWN ON the road comes through: kerbs, painted lines,
 * coloured strips, and a barrier if the user asked for one.
 */
function belongsOnImport(name: string): boolean {
  return /^1KERB_/.test(name)
    || /^1ROAD_line_/.test(name)
    || /^1ROAD_apron_/.test(name)
    || /^1WALL_/.test(name);
}

/** Nothing to draw, kept as one object so an empty result keeps its identity. */
const EMPTY_MESHES: MeshDef[] = [];

/** No markers of our own, for a track that came with its own. */
const EMPTY_MARKERS: MarkerSet = {
  grid: [], pits: [], gates: [], gateMarkers: [], hotlap: [], all: [],
};

/** Used when the terrain is switched off: nothing is pulled anywhere. */
const EMPTY_MASK: CorridorMask = {
  indices: new Int32Array(0),
  weight: new Float32Array(0),
  shift: new Float32Array(0),
};

function compute(project: Project, interacting: boolean): Derived {
  const spp = project.road.samplesPerSegment;

  const sigTrack = hash((h) => feedPath(h, project.track));
  const sigPit = hash((h) => feedPath(h, project.pit));
  const sigShape = hash((h) => feedRoadShape(h, project.road));
  const sigRoad = hash((h) => feedRoad(h, project.road));
  const sigTerrain = hash((h) => feedTerrainMeta(h, project.terrain));

  const trackFrames = slotTrackFrames(`${sigTrack}|${spp}`, () => computeFrames(project.track, spp));
  const pitFramesRaw = slotPitFrames(`${sigPit}|${spp}`, () => computeFrames(project.pit, spp));

  // Where the pit lane runs onto the tarmac, its surface is glued flush onto
  // the road plane. Everything below - the meshes, the terrain corridor, the
  // markers, the export - uses the merged frames, so they all agree.
  const pitMerge = slotPitMerge(`${sigTrack}|${sigPit}|${spp}|${project.road.pitGap}|${project.pitCfg.apron}`, () =>
    mergePitFrames(pitFramesRaw, trackFrames, project.road.pitGap, project.pitCfg.apron),
  );
  const pitFrames = pitMerge.frames;
  /* The concrete either side of the lane. It decides how far the ribbon
     reaches, so it belongs in the key of everything that measures against the
     ribbon: where the junction is, where the lane has to stop, how much room
     the run off is left and how far the ground is pulled down. */
  const apron = project.pitCfg.apron;

  /* Carried on past both ends, so the junction is a wedge rather than a square
     cut with a triangle of grass beside it. The lead-out runs onto the tarmac
     by construction; the clip below is what shapes it. */
  const pitDraw = slotPitDraw(`${sigTrack}|${sigPit}|${spp}|${project.road.pitGap}|${apron}`, () => {
    const lead = pitLead(pitFramesRaw, trackFrames, project.pit.closed, project.track.closed, apron);
    if (lead.frames === pitFramesRaw) {
      return { frames: pitFrames, weight: pitMerge.weight, raw: lead, from: lead.from, to: lead.to, length: lead.length };
    }
    // The lead-out sits on the road surface, so it wants the same height glue
    // the lane got. Same function, one array longer. The weight travels with
    // the frames: the apron reads it to lie flush where the lane is glued.
    const merged = mergePitFrames(lead.frames, trackFrames, project.road.pitGap, apron, lead);
    return { frames: merged.frames, weight: merged.weight, raw: lead, from: lead.from, to: lead.to, length: lead.length };
  });

  // How wide the run off actually is and where the barrier stands, after the
  // pit lane has had its say. Shared with the terrain so both agree.
  //
  // Measured against the DRAWN ribbon -- lane plus its lead-out wedges -- not
  // the bare lane. The wedge is exactly as much pit surface as the lane is,
  // and a clearance that could not see it left the run off running straight
  // across it: two surfaces in the same place, decided per pixel by the depth
  // buffer, which is the flicker at the junction this fixes.
  /* The concrete either side of the lane, cross section by cross section: full
     width along the lane and faded out over the lead-out at each end, so the
     clip, the run off clearance, the mesh and the ground all measure against
     the same ribbon. */
  const pitApron = slotPitApron(
    `${sigPit}|${spp}|${apron}|${pitDraw.frames.length}|${pitDraw.from}|${pitDraw.to}|${pitDraw.raw.apronTip}`,
    () => pitApronWidths(
      pitDraw.frames.length,
      { from: pitDraw.from, to: pitDraw.to, apronTip: pitDraw.raw.apronTip },
      apron,
    ),
  );

  /* Where the lane has to stop so the circuit stays intact. BEFORE the
     profile, which measures its clearance against the band this leaves -- the
     surface that is really drawn -- rather than against raw widths that
     overstate the ribbon by exactly the tucked-under part. The kerb arguments
     stay empty for it: the profile zeroes every kerb the lane comes near
     anyway, so the tarmac edge is the edge that matters here, and handing the
     clip the profile's kerbs would chain each to the other's answer. */
  const pitClip = slotPitClip(`${sigTrack}|${sigPit}|${spp}|${sigShape}|${apron}`, () =>
    pitRoadClip(
      pitDraw.frames,
      trackFrames,
      project.track.closed,
      undefined,
      undefined,
      pitApron,
      { from: pitDraw.from, to: pitDraw.to },
    ),
  );

  const profile = slotProfile(`${sigTrack}|${sigPit}|${spp}|${sigShape}|${project.road.pitGap}|${apron}`, () =>
    sideProfile(trackFrames, project.road, pitDraw.frames, project.track.closed, pitApron, pitClip),
  );

  /* Where the lane's own edge line hands over to the paint on the circuit.
     After the clip, because the handover is the cross section at which the
     circuit has taken the last of the concrete beside the lane. */
  const pitLines = slotPitLines(`${sigTrack}|${sigPit}|${spp}|${sigShape}|${apron}`, () =>
    pitTrackLines(pitDraw.raw, pitClip, trackFrames, project.track.closed, apron),
  );

  /*
   * The ground SHAPES rendered over the hand-painted field.
   *
   * Shapes are the editable half of the painted ground: their points can be
   * moved and reshaped afterwards, so they cannot be baked into the stored
   * paint the way a brush stroke is. Instead the effective field is composed
   * here on every change -- the raster the brush made, with every shape drawn
   * on top of it in order -- and EVERYTHING downstream reads this composed
   * terrain: the mesh, the run off strip, the 3D grass. Without shapes it IS
   * the stored terrain, identity and all, so nothing pays for the feature
   * while it is unused.
   */
  const shapes = project.groundShapes;
  const sigShapes = hash((h) => {
    h.num(shapes.length);
    for (const s of shapes) {
      h.str(s.id).str(s.type).num(s.kind).num(s.width).num(s.cornerRadius).bool(s.closed);
      h.num(s.points.length);
      for (const p of s.points) h.num(p.x).num(p.z).bool(p.smooth);
    }
  });
  const basePaintId = project.terrain.paint ? idOf(project.terrain.paint) : 0;
  const baseEdgeId = project.terrain.paintEdge ? idOf(project.terrain.paintEdge) : 0;
  const paintTerrain =
    shapes.length === 0 || !project.terrain.enabled
      ? project.terrain
      : slotPaintFx(`${basePaintId}|${baseEdgeId}|${sigShapes}|${sigTerrain}`, () => {
          const t = project.terrain;
          const paint = t.paint ? new Uint8Array(t.paint) : createPaint(t.res);
          const edge =
            t.paintEdge && t.paintEdge.length === paint.length
              ? new Int8Array(t.paintEdge)
              : createPaintEdge(t.res);
          for (const s of shapes) {
            const outline = shapeOutline(s.points, s.type === 'area' ? true : s.closed, s.cornerRadius);
            const value = paintValue(s.kind);
            if (s.type === 'area') {
              paintGroundPolygon(t, paint, edge, outline, value);
            } else {
              paintGroundPath(t, paint, edge, outline, s.width, value, false, s.closed);
            }
          }
          return { ...t, paint, paintEdge: edge };
        });

  // The paint field is shared by reference and copied on write, exactly like
  // the height field, so its identity is a sound cache key too.
  const paintId = paintTerrain.paint ? idOf(paintTerrain.paint) : 0;

  /*
   * The ground brush's say over the run off, or nothing at all.
   *
   * Nothing when the terrain is off, when no one has painted, or when the
   * setting is off -- and that is the point of checking all three: a circuit
   * that has never been near the ground brush builds exactly the run off it
   * always did, out of one material, in one mesh per side.
   */
  const runoffGround =
    project.road.runoffPaint && project.terrain.enabled && paintTerrain.paint
      ? {
          kinds: GROUND_KINDS,
          // The edge-aware sampler, so the strip sees the boundary where the
          // shape actually drew it -- the same line the terrain mesh cuts
          // along -- rather than the nearest-sample staircase.
          at: (x: number, z: number) => {
            const v = sampleGroundValueSmooth(
              paintTerrain,
              paintTerrain.paint,
              paintTerrain.paintEdge,
              x,
              z,
            );
            return v === 0 ? -1 : paintKind(v);
          },
          // The paint's own sample spacing, so the strip is split exactly as
          // finely as the paint can answer -- no finer, and no coarser.
          cell: paintCellSize(project.terrain),
          // Handed through rather than imported: terrain.ts already reads
          // road.ts, so road.ts cannot read it back.
          cutCell: cutSubCell,
        }
      : undefined;

  const roadMeshes = slotRoadMeshes(
    `${sigTrack}|${sigPit}|${spp}|${sigRoad}|${runoffGround ? paintId : 0}`,
    () => {
    const next = buildRoadMeshes(
      trackFrames,
      project.track.closed,
      project.road,
      pitFrames,
      reuseMap(lastRoad),
      profile,
      pitLines,
      runoffGround,
    );
    retire(lastRoad, next);
    lastRoad = next;
    return next;
  },
  );
  /*
   * The speed limiter is an INPUT to these meshes, so it belongs in the key.
   *
   * It decides two things inside buildPitMeshes: which cross sections carry
   * the PIT surface rather than ROAD, and where the two white bands are
   * painted across the lane. Both were passed to the builder and neither was
   * in the signature, so the memo handed back the meshes it already had and
   * moving either slider changed nothing whatsoever -- not the bands you can
   * see, and not the surface under them, which is the half that decides where
   * the game actually turns the limiter on.
   *
   * Keyed on the track as well: the merge glues the lane onto the road
   * surface, so moving the road reshapes the pit meshes near the junction.
   */
  const sigLimit = `${project.pitCfg.limitStart}|${project.pitCfg.limitEnd}|${apron}`;
  const pitMeshes = slotPitMeshes(`${sigTrack}|${sigPit}|${spp}|${sigRoad}|${sigLimit}`, () => {
    const next = buildPitMeshes(
      pitDraw.frames,
      project.pit.closed,
      project.road,
      reuseMap(lastPit),
      pitClip,
      project.pitCfg.limitStart,
      project.pitCfg.limitEnd,
      pitDraw.from,
      pitDraw.to,
      pitDraw.length,
      pitApron,
      pitDraw.weight,
    );
    retire(lastPit, next);
    lastPit = next;
    return next;
  });

  /*
   * The decorative roads. Each one runs through the same junction machinery
   * the pit lane does: ends near the circuit are snapped onto its edge
   * (attachRoadEnds), the ribbon is carried on over the tarmac as a wedge
   * (pitLead), glued onto the road plane (mergePitFrames) and cut back against
   * the tarmac's real edge (pitRoadClip). A road that never comes near the
   * circuit passes through all four untouched.
   */
  /*
   * The paved pads a road may end at: every Ground pad in the scene, whether
   * placed on its own or as the tarmac of a car park prefab. Height is read
   * off the SCULPTED field on purpose: the blended one is downstream of the
   * roads' own corridors, and reading it back here would make the attach a
   * moving target.
   */
  const pads: PadRect[] = project.props
    .filter((pr) => isGroundPad(pr.kind))
    .map((pr) => ({
      x: pr.p[0],
      z: pr.p[2],
      rotY: pr.r[1],
      hx: (PAD_SIZE / 2) * pr.s[0],
      hz: (PAD_SIZE / 2) * pr.s[2],
      y: pr.ground
        ? sampleHeights(project.terrain, project.terrain.heights, pr.p[0], pr.p[2])
        : pr.p[1],
    }));

  const sigDeco = hash((h) => {
    h.num(project.decoRoads.length);
    for (const r of project.decoRoads) {
      h.str(r.id).str(r.surface).bool(r.line ?? false);
      feedPath(h, r.path);
    }
    h.num(pads.length);
    for (const pad of pads) {
      h.num(pad.x).num(pad.z).num(pad.rotY).num(pad.hx).num(pad.hz).num(pad.y);
    }
  });
  const deco = slotDeco(
    `${sigTrack}|${spp}|${sigDeco}|${project.road.uvLength}|${project.road.uvWidth}`,
    () => {
      const meshes: MeshDef[] = [];
      const corridors: Corridor[] = [];
      const lines: DecoBuild['lines'] = [];
      const reuse = reuseMap(lastDeco);
      /* Every road as DRAWN, before anything is glued to anything: each one
         attached to the circuit alone, which is a decision that cannot depend
         on the other roads. This is what lets an end dock onto a road drawn
         LATER than itself -- a roundabout dropped after its approaches is the
         same roundabout, and having to lay it down first was a rule nobody
         could see and everybody broke. */
      const drawnRaw = project.decoRoads.map((r) =>
        r.path.nodes.length < 2 ? null : computeFrames(attachRoadEnds(r.path, trackFrames), spp),
      );

      /* Built so far, in draw order, for the passes where order is real: who
         cuts whom where two roads cross. */
      const built: Array<{ frames: Frame[]; closed: boolean }> = [];
      project.decoRoads.forEach((r, ri) => {
        if (r.path.nodes.length < 2) {
          lines.push({ id: r.id, frames: [], closed: r.path.closed });
          return;
        }
        /* Each end is glued to ONE surface: whichever it is really nearest,
           the circuit or another road. Gluing it to each in turn -- which is
           what this did -- means the LAST one wins rather than the nearest,
           so an end that clearly pointed at the roundabout was yanked onto
           whatever else happened to lie within thirty metres of it, and which
           that was depended on draw order. It looked like the attach working
           sometimes and not others, and sometimes onto the far side. */
        const targets: Array<{ frames: Frame[]; open: boolean }> = [
          { frames: trackFrames, open: !project.track.closed },
        ];
        drawnRaw.forEach((fr, j) => {
          if (j !== ri && fr && fr.length >= 2) {
            // An open road offers its two ends to butt onto; a closed ring's
            // terminal frames are the seam of the loop, not an end.
            targets.push({ frames: fr, open: !project.decoRoads[j].path.closed });
          }
        });
        let attached = r.path;
        if (!r.path.closed) {
          for (const which of ['first', 'last'] as const) {
            const nodeIdx = which === 'first' ? 0 : attached.nodes.length - 1;
            const at = attached.nodes[nodeIdx].p;
            let best: { frames: Frame[]; open: boolean } | null = null;
            let bestGap = Infinity;
            for (const t of targets) {
              const g = roadEndGap(t.frames, at);
              if (g < bestGap) { bestGap = g; best = t; }
            }
            if (best) attached = attachRoadEnds(attached, best.frames, which, best.open);
          }
        }
        // Pads come last: an end the circuit or another road has claimed --
        // its position moved above -- is not up for parking. Attaching copies
        // every node, so "claimed" is a value comparison, not identity.
        const movedEnd = (i: number) => {
          const a = attached.nodes[i].p;
          const b = r.path.nodes[i].p;
          return a[0] !== b[0] || a[2] !== b[2];
        };
        attached = attachRoadToPads(attached, pads, {
          first: movedEnd(0),
          last: movedEnd(attached.nodes.length - 1),
        });
        const raw = computeFrames(attached, spp);

        /* Leads first (they change the frame count), circuit before roads. */
        let lead = pitLead(raw, trackFrames, r.path.closed, project.track.closed, 0);
        let frames = lead.frames;
        let from = lead.from;
        let to = lead.to;
        for (const prev of built) {
          const l2 = pitLead(frames, prev.frames, r.path.closed, prev.closed, 0);
          if (l2.frames === frames) continue;
          from += l2.from;
          to += l2.from;
          frames = l2.frames;
        }

        /* Then the same-length passes: glue onto every surface it overlaps,
           and cut it back against each one's real edge. */
        let merged = mergePitFrames(frames, trackFrames, 1.5, 0, { from, to });
        frames = merged.frames;
        const weight = merged.weight.slice();
        // keepCrossings: a deco road running ACROSS the circuit or another
        // road is an intersection, not a merge -- only its ends make wedges.
        const clip = pitRoadClip(frames, trackFrames, project.track.closed, undefined, undefined, 0, { from, to }, true);
        for (const prev of built) {
          const m2 = mergePitFrames(frames, prev.frames, 1.5, 0, { from, to });
          frames = m2.frames;
          for (let i = 0; i < weight.length; i++) {
            if (m2.weight[i] > weight[i]) weight[i] = m2.weight[i];
          }
          const c2 = pitRoadClip(frames, prev.frames, prev.closed, undefined, undefined, 0, { from, to }, true);
          for (let i = 0; i < clip.lo.length; i++) {
            if (c2.lo[i] > clip.lo[i]) clip.lo[i] = c2.lo[i];
            if (c2.hi[i] < clip.hi[i]) clip.hi[i] = c2.hi[i];
          }
        }

        meshes.push(
          ...buildDecoRoadMeshes(
            frames,
            r.path.closed,
            project.road,
            r.surface,
            `deco_${ri}`,
            reuse,
            clip,
            r.line ?? false,
          ),
        );
        corridors.push(pitCorridor(frames, 0.9, clip, weight));
        lines.push({ id: r.id, frames: frames.slice(from, to + 1), closed: r.path.closed });
        built.push({ frames, closed: r.path.closed });
      });
      retire(lastDeco, meshes);
      lastDeco = meshes;
      return { meshes, corridors, lines };
    },
  );

  // Where the road pulls the ground, and how hard. Independent of what the user
  // sculpts, so a brush stroke never pays for it.
  //
  // While a control is being dragged the corridor mask is reused as it is,
  // even though the track has moved. Rebuilding it is by far the most
  // expensive thing here and it grows with the length of the track, so paying
  // for it on every frame of a drag is what made long tracks unusable. The
  // ground catches up the moment you let go. Sculpting is unaffected: the mask
  // does not depend on the sculpted heights, so its key does not change.
  //
  // The shape, not the whole road: the ground has to meet the tarmac, and it
  // does not care what pattern is painted on it.
  const maskKey = `${sigTrack}|${sigPit}|${spp}|${sigShape}|${sigTerrain}|${project.road.pitGap}|${apron}|${sigDeco}`;
  const mask = !project.terrain.enabled
    ? EMPTY_MASK
    : interacting && lastMask
      ? lastMask
      : slotMask(maskKey, () =>
          {
            stats.maskBuilds += 1;
            // The drawn ribbon again, so the ground is pulled down under the
            // lead-out wedge exactly as it is under the lane itself.
            return buildCorridorMask(project.terrain, [
              roadCorridor(trackFrames, project.road, profile, project.track.closed),
              pitCorridor(pitDraw.frames, pitApron, pitClip, pitDraw.weight),
              // The deco roads bed into the ground exactly like the pit lane.
              ...deco.corridors,
            ]);
          },
        );
  if (project.terrain.enabled) lastMask = mask;

  // The sculpted height field is shared by reference between project copies,
  // so its identity is a sound cache key: it only changes when it is edited.
  const terrainHeights = !project.terrain.enabled
    ? project.terrain.heights
    : slotHeights(`${idOf(project.terrain.heights)}|${idOf(mask)}`, () =>
        applyCorridorMask(project.terrain.heights, mask),
      );

  const terrainDef = !project.terrain.enabled
    ? null
    : slotTerrainDef(`${idOf(terrainHeights)}|${sigTerrain}|${paintId}`, (previous) => {
        // Counted so the diagnostics can say whether a stall coincided with the
        // one genuinely expensive thing in here.
        stats.terrainBuilds += 1;
        // The brush notes which cells it painted. If the geometry still holds
        // the blend of exactly the height field that dab replaced, under the
        // same corridor mask, then only those cells can differ and the update
        // can skip comparing all res² vertices.
        const delta = heightsDelta.get(project.terrain.heights);
        const patch =
          previous &&
          delta &&
          lastTerrainBuild &&
          delta.prev.deref() === lastTerrainBuild.sculpted &&
          mask === lastTerrainBuild.mask
            ? delta.box
            : undefined;
        lastTerrainBuild = { sculpted: project.terrain.heights, mask };
        return terrainMesh(
          paintTerrain,
          terrainHeights,
          paintTerrain.paint,
          previous?.geometry,
          patch,
        );
      });

  const sigMarkers = hash((h) => {
    const { timing, grid, pitCfg } = project;
    h.num(timing.startS).num(timing.hotlapBack).num(timing.sectors.length);
    timing.sectors.forEach((s) => h.num(s));
    h.num(grid.count).num(grid.poleBack).num(grid.rowSpacing).num(grid.lateralOffset).bool(grid.stagger);
    h.num(pitCfg.boxCount).num(pitCfg.boxSpacing).num(pitCfg.boxSide).num(pitCfg.boxOffset).num(pitCfg.startDist);
    for (const [k, v] of Object.entries(grid.overrides)) h.str(k).vec3(v.p).num(v.rot);
    for (const [k, v] of Object.entries(pitCfg.overrides)) h.str(k).vec3(v.p).num(v.rot);
  });

  /*
   * An imported track brings its own AC_* markers, and they are the real ones.
   *
   * Generating a second set beside them put twelve editor pit boxes on top of
   * Hockenheim's twenty eight, plus a grid and timing gates that belong to a
   * circuit nobody is editing. Two sets of pit boxes on one track is not a
   * display quirk, it is a straight contradiction about where the pits are.
   */
  const markers = project.acImport
    ? EMPTY_MARKERS
    : slotMarkers(`${sigTrack}|${sigPit}|${spp}|${sigMarkers}`, () =>
        buildAllMarkers(project, trackFrames, pitFrames),
      );

  /* The paint on the grid, keyed apart from the markers themselves: widening a
     box repaints the grid and moves no marker, and moving a slot repaints the
     grid without anything else having to know. An imported circuit has its own
     grid and its own paint, so it gets none of ours -- the same rule its
     markers follow. */
  const sigGridBox = hash((h) => {
    const { grid } = project;
    h.bool(grid.boxes).num(grid.boxWidth).num(grid.boxLength).bool(grid.boxFrontLine);
  });
  const gridMeshes = project.acImport
    ? EMPTY_MESHES
    : slotGridMeshes(`${sigTrack}|${spp}|${sigMarkers}|${sigGridBox}`, () => {
        const next = buildGridBoxes(trackFrames, project.track.closed, project.timing, project.grid);
        retire(lastGrid, next);
        lastGrid = next;
        return next;
      });

  /*
   * The start gantry, built over the timing line rather than placed near it.
   *
   * Only on a closed lap: on a line that is still being drawn there is no
   * start/finish to bridge yet, and a gantry that appears over the second
   * control point and then jumps every time another one is added is noise in
   * the middle of the one job the track tool has. Closing the loop is the
   * moment the circuit acquires a start line, so it is the moment it acquires
   * the bridge over it.
   *
   * Keyed on the shape signature because the legs stand behind the barrier,
   * which is as far out as the kerb, the run off and the wall gap put it.
   */
  const wantGantry =
    project.timing.gantry && !project.acImport && project.track.closed && project.track.nodes.length >= 3;
  const gantryMeshes = !wantGantry
    ? EMPTY_MESHES
    : interacting && lastGantry.length > 0
      ? // Held as it is through a drag, exactly like the corridor mask and the
        // AI line. Rebuilding three thousand triangles of steel every frame to
        // watch it slide along with the control point is the sort of thing
        // that makes a long circuit unusable; it catches up on the mouse up.
        lastGantry
      : slotGantryMeshes(`${sigTrack}|${spp}|${sigShape}|${project.timing.startS}`, () => {
        const next = buildStartGantry(
          trackFrames,
          project.track.closed,
          project.road,
          project.timing.startS,
          reuseMap(lastGantry),
        );
        retire(lastGantry, next);
        lastGantry = next;
        return next;
      });

  // The AI line is a display aid while editing, and resampling it allocates a
  // few thousand short lived objects. It can wait out a drag too.
  const ai =
    interacting && lastAi
      ? lastAi
      : slotAi(`${sigTrack}|${spp}|${project.exportCfg.aiSpacing}`, () =>
          buildAiLine(trackFrames, project.track.closed, project.exportCfg.aiSpacing),
        );
  lastAi = ai;

  return {
    trackFrames,
    pitFrames,
    // On an imported track the generated surfaces are held back -- see
    // belongsOnImport. One filter, so the viewport and the exporter can never
    // disagree about what is being added.
    roadMeshes: project.acImport ? roadMeshes.filter((m) => belongsOnImport(m.name)) : roadMeshes,
    pitMeshes: project.acImport ? pitMeshes.filter((m) => belongsOnImport(m.name)) : pitMeshes,
    gridMeshes,
    gantryMeshes,
    terrainHeights,
    paintTerrain,
    terrainDef,
    markers,
    ai,
    trackLength: pathLength(trackFrames, project.track.closed),
    pitLength: pathLength(pitFrames, project.pit.closed),
    pitDrawFrames: pitDraw.frames,
    pitDrawLength: pitDraw.length,
    pitApron,
    pitClip,
    // A deco road drawn on an imported circuit is an addition of the user's
    // own, so unlike our generated road it is not held back there.
    decoMeshes: deco.meshes,
    decoLines: deco.lines,
    // Falls out of the side profile for free, no second sweep needed.
    pitSide: profile.pitSide,
    profile,
    terrainMinY: slotMinY(String(idOf(terrainHeights)), () => minOf(terrainHeights)),
  };
}

function minOf(a: Float32Array): number {
  let m = Infinity;
  for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i];
  return Number.isFinite(m) ? m : 0;
}

/* Stable ids for typed arrays, so identity can be used inside a string key. */
const ids = new WeakMap<object, number>();
let idSeq = 0;
function idOf(o: object): number {
  let id = ids.get(o);
  if (id === undefined) {
    idSeq += 1;
    id = idSeq;
    ids.set(o, id);
  }
  return id;
}
/* ------------------------------------------------------------------ */

/**
 * How many times the derived geometry has actually been rebuilt.
 *
 * Read by the frame rate meter: if a long frame happens with this number
 * unchanged, then nothing in this editor ran during it, and the pause came from
 * the browser itself. That single fact separates "our bug" from "not our bug",
 * which is otherwise very hard to tell apart from the outside.
 */
/**
 * Counters the diagnostics read, so a stall can be attributed to the two
 * genuinely expensive steps rather than guessed at.
 */
export const stats = { computes: 0, projectChanges: 0, maskBuilds: 0, terrainBuilds: 0 };

let cacheKey: Project | null = null;
let cacheInteracting = false;
let cacheValue: Derived | null = null;

export function getDerived(project: Project, interacting = false): Derived {
  if (cacheKey === project && cacheInteracting === interacting && cacheValue) return cacheValue;
  if (cacheKey !== project) stats.projectChanges += 1;
  stats.computes += 1;
  cacheValue = compute(project, interacting);
  cacheKey = project;
  cacheInteracting = interacting;
  return cacheValue;
}

// Beside the store's `__editor`: `__derived(__editor.getState().project)` on
// the console reads the exact geometry the viewport is showing.
// Optional chain, because only Vite defines import.meta.env: the verify tools
// load this module under plain node, where it is undefined.
if (import.meta.env?.DEV) {
  (globalThis as Record<string, unknown>).__derived = getDerived;
}

export function useDerived(): Derived {
  const project = useEditor((s) => s.project);
  const interacting = useEditor((s) => s.interacting);
  return useMemo(() => getDerived(project, interacting), [project, interacting]);
}
