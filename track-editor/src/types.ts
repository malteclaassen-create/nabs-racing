/**
 * The complete data model of a track project.
 *
 * Everything the editor knows lives in `Project`. It is plain JSON friendly
 * (the one exception, the terrain height field, is converted to/from base64
 * in src/io/project.ts) so a project can be saved, mailed around and reopened.
 *
 * Units are METRES and DEGREES throughout, matching Assetto Corsa.
 * Coordinate system is the same as three.js AND Assetto Corsa:
 *   +X right, +Y up, +Z towards the viewer, right handed.
 * That means no axis conversion is needed anywhere in the export.
 */

export type Vec3 = [number, number, number];

/** A control point of a spline path (the track centre line or the pit lane). */
export interface TrackNode {
  id: string;
  /** World position of the centre line at this node. */
  p: Vec3;
  /** Half width of the drivable road to the left of the centre line. */
  widthL: number;
  /** Half width of the drivable road to the right of the centre line. */
  widthR: number;
  /** Banking in degrees. Positive raises the RIGHT hand edge. */
  bank: number;
  /** Barrier present on the left / right edge in the section starting here. */
  wallL: boolean;
  wallR: boolean;
  /**
   * How far the barrier stands from the outer edge of the run off, in metres.
   * Positive pushes it further out, negative pulls it back over the run off.
   * 0 leaves it exactly on the edge, which is where it used to be fixed.
   */
  wallGapL: number;
  wallGapR: number;
  /** Run off width per side as a factor of the global width. 0 removes it. */
  runoffL: number;
  runoffR: number;
  /** Lateral offset of the AI racing line from the centre line, in metres. */
  aiOffset: number;
}

export interface PathData {
  closed: boolean;
  nodes: TrackNode[];
}

/** Surface keys we emit into data/surfaces.ini and use as mesh name prefixes. */
export type SurfaceKey =
  | 'ROAD'
  | 'KERB'
  | 'GRASS'
  | 'SAND'
  | 'CONCRETE'
  | 'WALL'
  | 'PIT';

/**
 * What a stretch of kerb is made of.
 *
 *   'ramp'    the ordinary grand prix kerb: a chamfer up off the tarmac and a
 *             flat top. This is what most of a circuit has.
 *   'wave'    the same thing with the top rippled across, so it rattles the car
 *             without launching it. Corner exits.
 *   'sausage' separate raised bumps sitting on a low base, the ones put down to
 *             stop a chicane being straightlined.
 *   'flat'    a low, gently tilted strip. Cheap and kind.
 *   'none'    no kerb at all -- the span is only there for its coloured tarmac
 *             strip, which every span can carry.
 */
export type KerbStyle = 'ramp' | 'wave' | 'sausage' | 'flat' | 'none';

/** Colour of the tarmac strip a kerb span can put outside itself. */
export type ApronColour = 'grey' | 'green' | 'blue' | 'red';

/**
 * One stretch of kerb along one edge of the track.
 *
 * Kerbs used to be a boolean per control point, which meant a kerb could only
 * begin and end where somebody had happened to click a point -- and it began at
 * full width and height, which is not how a real one is built. A span says
 * where the kerb starts and stops in its own right, and both ends run out as a
 * wedge over `taper` metres.
 *
 * `from` and `to` are curve parameters, 0..1, the very number the cross
 * sections carry as `t`. Metres would drift: they are measured from the start
 * of the lap, so moving one control point would slide every kerb behind it.
 * On a closed circuit `from > to` is legal and means the span runs across the
 * start/finish seam.
 */
export interface KerbSpan {
  id: string;
  /** Which edge it sits on. -1 = left, 1 = right. */
  side: -1 | 1;
  from: number;
  to: number;
  style: KerbStyle;
  /** Width and height of the kerb itself, metres. */
  width: number;
  height: number;
  /** Length of the wedge at each end, metres. 0 gives a square cut end. */
  taper: number;
  /** Width of the coloured tarmac strip outside the kerb, metres. 0 = none. */
  apron: number;
}

export interface RoadSettings {
  /** Geometry resolution: how many cross sections per spline segment. */
  samplesPerSegment: number;
  /** Size a newly drawn kerb span starts at. Each span then owns its own. */
  kerbWidth: number;
  kerbHeight: number;
  /** Every stretch of kerb on the circuit, in no particular order. */
  kerbs: KerbSpan[];
  /**
   * The painted line along the edge of the tarmac.
   *
   * Cut out of the road surface rather than laid on top of it, so it is exactly
   * flush: a strip floating a few millimetres above the road z-fights with it
   * from a distance, and one at the same height needs a second physics surface.
   */
  edgeLine: boolean;
  edgeLineWidth: number;
  /** Colour of every kerb span's tarmac strip. The width is per span. */
  apronColour: ApronColour;
  runoffWidth: number;
  /** How far the outer edge of the run off drops below the road edge. */
  runoffDrop: number;
  runoffSurface: 'GRASS' | 'SAND' | 'CONCRETE';
  wall: boolean;
  wallHeight: number;
  /**
   * What the barrier is, where the barrier tool says there is one.
   *
   * 'wall' is armco on its own: W section steel beams stacked on posts, as
   * many as the height takes. 'fence' is what a modern circuit has where it
   * needs to stop debris as well as cars -- the same armco for its first
   * metre, catch fencing above it, and the top metre angled back over the
   * track so anything thrown at it drops back inside. Both follow the same run
   * off edge and the same per point gaps -- this only decides the cross
   * section, so switching it changes the whole circuit at once instead of
   * asking for the run to be painted again. The key is still 'wall' because
   * every project ever saved has it written in it.
   */
  wallStyle: 'wall' | 'fence';
  /**
   * Automatically pull the run off back and open the barrier wherever the pit
   * lane runs alongside the track, so the two never grow into each other.
   */
  pitClearance: boolean;
  /** Gap kept between the edge of the road side and the pit lane. */
  pitGap: number;
  /** Metres of world space per texture repeat, along the track / across it. */
  uvLength: number;
  uvWidth: number;
}

export interface PitSettings {
  /** Half width of the pit lane road. */
  width: number;
  boxCount: number;
  /** Distance between two pit boxes along the pit lane. */
  boxSpacing: number;
  /** Which side of the pit lane the boxes sit on. -1 = left, 1 = right. */
  boxSide: -1 | 1;
  /** Lateral distance from the pit lane centre to the box centre. */
  boxOffset: number;
  /** Distance along the pit lane where box 0 sits. */
  startDist: number;
  /**
   * Where the speed limiter comes on, as a distance along the pit lane from
   * its start. Everything before this is exported as road surface, so a car
   * rolling in is still free; from here on it is pit lane and the limiter is
   * on. It has to be less than `startDist`, or the first boxes are reached
   * without a limiter.
   */
  limitStart: number;
  /** The same at the other end, measured back from the end of the lane. */
  limitEnd: number;
  /** Manual per box overrides, keyed by box index. */
  overrides: Record<number, { p: Vec3; rot: number }>;
}

export interface GridSettings {
  count: number;
  /** Distance BEFORE the start/finish line where pole position sits. */
  poleBack: number;
  /** Distance between two grid rows. */
  rowSpacing: number;
  /** Lateral distance of a grid slot from the centre line. */
  lateralOffset: number;
  /** Alternate left/right like a real F1 grid. */
  stagger: boolean;
  /** Paint a start box on the tarmac at every slot. */
  boxes: boolean;
  /** Clear width between the two side lines of a box, metres. */
  boxWidth: number;
  /** How far a box's side lines run back from its front line, metres. */
  boxLength: number;
  /** The yellow bar inside the box that the front wheels line up on. */
  boxFrontLine: boolean;
  overrides: Record<number, { p: Vec3; rot: number }>;
}

export interface TimingSettings {
  /** Arc length fraction (0..1) of the start/finish line = AC_TIME_0. */
  startS: number;
  /** Arc length fractions of the additional sector gates, ascending. */
  sectors: number[];
  /** How far behind the start/finish line AC_HOTLAP_START_0 is placed. */
  hotlapBack: number;
  /**
   * Build the start gantry over the line.
   *
   * Not a placed object: it follows `startS`, spans whatever the circuit is
   * wide there, and appears as soon as the track is a closed lap. See
   * core/gantry.ts. Off for a circuit that has a bridge of its own, or a club
   * track that never had one.
   */
  gantry: boolean;
}

export interface PropInstance {
  id: string;
  /** Either a key from the built in library or 'asset:<assetId>'. */
  kind: string;
  name: string;
  p: Vec3;
  /** Euler rotation in degrees, XYZ order. */
  r: Vec3;
  s: Vec3;
  /** Keep the prop glued to the terrain height when the terrain changes. */
  ground: boolean;
}

/** A user imported 3D model, stored inside the project file as base64. */
export interface AssetFile {
  id: string;
  name: string;
  ext: 'glb' | 'gltf' | 'obj' | 'fbx';
  /** base64 without a data: prefix. */
  data: string;
}

export interface TerrainSettings {
  enabled: boolean;
  /** Vertices per side of the height grid. */
  res: number;
  /** Side length of the terrain square in metres. */
  size: number;
  /** World position of the grid corner with the lowest X and Z. */
  originX: number;
  originZ: number;
  /** Height the terrain starts at. */
  base: number;
  /** How wide the blend from road level out into free terrain is. */
  blend: number;
  /** res * res height values. Held as a Float32Array at runtime. */
  heights: Float32Array;
  /**
   * What the ground is made of, one byte per paint cell: an index into
   * GROUND_KINDS, 0 for grass. Null until something is painted, which is what
   * an untouched project and every project saved before this existed look like.
   *
   * The grid is finer than the height grid -- see `paintSub` -- and is laid out
   * the same way, row of increasing X first. Painting does not add a surface on
   * top of the ground, it decides which material the ground's own triangles are
   * drawn and exported with, so there is never anything underneath it.
   */
  paint: Uint8Array | null;
}

export interface ExportSettings {
  /** Export AC_* markers as tiny meshes instead of FBX null nodes. */
  markerAsMesh: boolean;
  /** Which local axis of a marker points in the driving direction. */
  markerForward: '+Z' | '-Z' | '+X' | '-X';
  /** Distance between two AI line points in metres. */
  aiSpacing: number;
  /** Write procedurally generated textures next to the FBX. */
  writeTextures: boolean;
  /**
   * Also write the FBX and glTF fallback models into `source/`.
   *
   * Off by default, and that is not a small detail: the editor writes the .kn5
   * itself now, so those two are only there for the manual ksEditor route
   * nobody needs any more. Building them means holding a second and a third
   * complete copy of the track in memory beside the kn5 and the zip, which on a
   * large circuit is what makes the browser tab run out of memory and die
   * mid-export.
   */
  sourceFiles: boolean;
}

export interface ProjectMeta {
  name: string;
  /** Folder name inside content/tracks. Lowercase, no spaces. */
  slug: string;
  author: string;
  country: string;
  city: string;
  description: string;
  version: string;
  /** 'clockwise' | 'counterclockwise', shown in Content Manager. */
  run: 'clockwise' | 'counterclockwise';
}

/* ------------------------------------------------------------------ */
/* Imported Assetto Corsa tracks                                       */
/* ------------------------------------------------------------------ */

/** Position and heading of one AC_* marker. Heading in degrees about Y. */
export interface AcMarkerPose {
  p: Vec3;
  rot: number;
}

/**
 * One change to the markers an imported track already has.
 *
 * Deliberately a list of small operations against the ORIGINAL names rather
 * than a replacement list: a move then keeps every marker it did not touch
 * bit for bit, including any pitch and roll a pit box on a slope was built
 * with, which a rewritten list would flatten. Numbering is repaired on the way
 * out -- AC wants AC_PIT_0 upwards with no gaps -- so deleting the sixth pit
 * box of twenty seven is one entry here, not a renumbering of the other
 * twenty six.
 */
export type AcMarkerEdit =
  | { op: 'move'; name: string; p: Vec3; rot: number }
  | { op: 'delete'; name: string }
  | { op: 'add'; name: string; p: Vec3; rot: number };

/**
 * Moving, turning or resizing one of the track's own meshes.
 *
 * Stored as an offset from where the mesh already is, not as an absolute
 * placement: a kerb that is nudged 20 cm outwards should stay 20 cm outwards
 * however the rest of the file is read, and an offset of zero is provably no
 * change at all.
 *
 * Rotation and scale act about the mesh's own centre, which is the only
 * anchor that makes turning a kerb or making a barrier taller behave the way
 * it looks like it should.
 */
export interface AcMeshTransform {
  /** Metres. */
  p: Vec3;
  /** Degrees, XYZ order. */
  r: Vec3;
  /** Multipliers. */
  s: Vec3;
  /**
   * World point the rotation and the resize happen about.
   *
   * Absent means "my own centre", which is what a single object wants: a kerb
   * made taller grows upward from where it is. Present, it is the shared
   * centre of a MULTIPLE selection -- turning six cars as a group has to swing
   * them around one point, not spin each of them where it stands. Without
   * this, a group rotation is not expressible at all.
   */
  about?: Vec3;
  /**
   * Grow the texture with the geometry instead of stretching it.
   *
   * Resizing a mesh moves its vertices and leaves its UVs alone, so whatever is
   * printed on it stretches by the same amount -- a kerb made 8% wider gets 8%
   * wider chequers, which stops matching the kerb next to it. With this on, the
   * UVs are scaled to match, so the pattern keeps its real world size and there
   * is simply more of it.
   *
   * Only applied along axes where the texture actually repeats. Where a piece
   * uses less than one full tile -- a slice of an atlas, which is how most
   * kerbs are mapped across their width -- growing the UVs would pull in
   * whatever the modder put next to it in the image.
   */
  keepTexture?: boolean;
  /**
   * Resize ALONG THE TRACK instead of along the world axes.
   *
   * The only correct way to change the size of something that follows a corner.
   * Scaling a curved kerb on an axis turns its arc into an ellipse: measured on
   * Hockenheim's turn 8, making one two percent longer that way walked its far
   * end 1.41 METRES off the tarmac, and even the straighter pieces went 60 cm.
   * Resizing in the track's own coordinates -- arc length, distance to the
   * side, height -- brings that to under 1.2 cm, because the curve is never
   * left in the first place.
   *
   * Multipliers, like `s`, but meaning [across, up, along]. When this is set it
   * replaces `s` and `r`; and `p` is reinterpreted IN TRACK COORDINATES too --
   * [sideways, up, along the lap], metres -- which is what the drawing, the
   * picker and the exporter all do with it. (It used to claim world space
   * here, while every consumer already treated it as track space.)
   */
  ribbon?: {
    length: number;
    width: number;
    height: number;
    /** Which end stays put, 0..1, as [across, up, along]. */
    anchor?: Vec3;
    /**
     * Measure "sideways" from THIS edge of the tarmac (-1 left, 1 right)
     * instead of from the centre line. The road is not a constant width, so a
     * kerb slid along the lap with a centre-line lateral drifts onto the
     * tarmac where it widens; pinned to the edge it stays a kerb. Set when
     * the ribbon is created and NEVER changed afterwards -- the stored
     * lateral offsets are only meaningful against the datum they were made
     * with.
     */
    edge?: -1 | 1;
  };
}

/** How a piece is addressed inside a model's transform map. */
export function partKey(mesh: string, part?: number): string {
  return part === undefined ? mesh : `${mesh}#${part}`;
}

/** The mesh and piece a key refers to. */
export function parsePartKey(key: string): { mesh: string; part?: number } {
  const at = key.lastIndexOf('#');
  if (at < 0) return { mesh: key };
  const part = Number(key.slice(at + 1));
  if (!Number.isInteger(part) || part < 0) return { mesh: key };
  return { mesh: key.slice(0, at), part };
}

export function identityMeshTransform(): AcMeshTransform {
  return { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
}

export function isIdentityTransform(t: AcMeshTransform): boolean {
  // The ribbon counts. It is a resize in its own right and it leaves p, r and s
  // at their neutral values, so checking only those threw every
  // along-the-track resize away as "no change" before it ever reached the
  // geometry.
  if (t.ribbon && (t.ribbon.length !== 1 || t.ribbon.width !== 1 || t.ribbon.height !== 1)) {
    return false;
  }
  return t.p.every((v) => v === 0) && t.r.every((v) => v === 0) && t.s.every((v) => v === 1);
}

/** One piece of one mesh of one model: what a selection points at. */
export interface AcMeshRef {
  model: string;
  name: string;
  part?: number;
}

export function sameAcMeshRef(a: AcMeshRef, b: AcMeshRef): boolean {
  return a.model === b.model && a.name === b.name && a.part === b.part;
}

/**
 * Everything the user changed about an imported track.
 *
 * Small, plain JSON, and saved inside the project file. The track's own
 * hundreds of megabytes are never in here: at export time each file that needs
 * changing is read again from disk and these edits are applied to a fresh
 * copy. That is what lets a 700 MB circuit be edited in a browser tab, and it
 * is also why an edit can never corrupt the source -- the editor only ever
 * reads it.
 */
/**
 * A copy of one of the track's own pieces, placed somewhere else.
 *
 * This is how a kerb gets LONGER without being stretched. Scaling a kerb to
 * twice the length stretches its texture and its ripples with it, which reads
 * as a smeared kerb rather than a longer one; a real one is built by laying
 * another section down. So the editor duplicates the section and moves the
 * copy instead, which keeps the pattern, the profile and the texture scale
 * exactly as the modder drew them.
 *
 * The copy is a NEW mesh appended to the model. The original is not touched.
 */
export interface AcPieceCopy {
  /** Stable id, so a project file keeps pointing at the same copy. */
  id: string;
  /** Mesh it was copied from, and which piece of it. */
  mesh: string;
  part?: number;
  t: AcMeshTransform;
}

export interface AcEdits {
  /** Model file -> copies of its pieces, placed by the user. */
  copies: Record<string, AcPieceCopy[]>;
  /**
   * Model file -> piece key -> where it has been moved to.
   *
   * The piece key is the mesh name, or `name#index` for one connected piece of
   * it. Modders merge: one mesh holds every kerb of its kind on the circuit,
   * every barrier segment, every tree. Moving one of them means addressing the
   * piece, and a mesh can have several pieces moved independently -- which is
   * why this is keyed by piece and not by mesh.
   */
  transforms: Record<string, Record<string, AcMeshTransform>>;
  /** Model file -> mesh names that should stop being drawn. */
  hidden: Record<string, string[]>;
  /**
   * Model file -> old mesh name -> new one.
   *
   * This is how a surface is reassigned: a mesh called `1GRASS_apron_3` that
   * should be tarmac becomes `1ROAD_apron_3`, and AC's physics follow the
   * name. Renaming is the whole mechanism, which is why it is worth having.
   */
  renamed: Record<string, Record<string, string>>;
  /** Model file -> marker changes in that file. */
  markers: Record<string, AcMarkerEdit[]>;
  /**
   * Whether the geometry the editor itself generates -- kerbs, painted lines,
   * braking boards, placed objects -- is baked into an extra model beside the
   * original ones.
   */
  addGenerated: boolean;
}

export function emptyAcEdits(): AcEdits {
  return { transforms: {}, copies: {}, hidden: {}, renamed: {}, markers: {}, addGenerated: true };
}

/** A track taken from an Assetto Corsa installation and edited here. */
export interface AcImport {
  /** Folder under content/tracks it came from. Read only, always. */
  slug: string;
  /** Which layout of a multi layout track. '' when it has only one. */
  layout: string;
  /** Display name out of ui_track.json, for the interface. */
  name: string;
  /**
   * Folder the export writes to.
   *
   * Never the same as `slug` unless the user insists: overwriting the original
   * would destroy the only copy of somebody else's work, and there is no undo
   * for that.
   */
  targetSlug: string;
  edits: AcEdits;
}

export interface Project {
  formatVersion: 1;
  meta: ProjectMeta;
  /**
   * The imported track this project is built on top of, if any.
   *
   * Null for a track drawn from scratch, which is what the editor did before
   * and still does. When it is set, the project's own track/pit paths are a
   * recovered centre line used to place things ON the imported circuit, and
   * the road and terrain generators are held back -- see `AcEdits`.
   */
  acImport: AcImport | null;
  track: PathData;
  pit: PathData;
  road: RoadSettings;
  pitCfg: PitSettings;
  grid: GridSettings;
  timing: TimingSettings;
  props: PropInstance[];
  assets: AssetFile[];
  terrain: TerrainSettings;
  exportCfg: ExportSettings;
}

/* ------------------------------------------------------------------ */
/* Editor only state                                                   */
/* ------------------------------------------------------------------ */

export type PathId = 'track' | 'pit';

export type Selection =
  | { kind: 'node'; path: PathId; id: string }
  /** A run of control points, from `fromId` forwards along the path to `toId`. */
  | { kind: 'section'; path: PathId; fromId: string; toId: string }
  | { kind: 'kerb'; id: string }
  | { kind: 'prop'; id: string }
  | { kind: 'grid'; index: number }
  | { kind: 'pitbox'; index: number }
  | { kind: 'gate'; index: number }
  /**
   * One AC_* marker of an imported track -- a pit box, a grid slot, a timing
   * gate post. Identified by its NAME rather than an index, because the
   * numbering is repaired on export and an index would point at a different
   * box afterwards.
   */
  | { kind: 'acMarker'; name: string; model: string }
  /**
   * One of the imported track's own meshes: a kerb, a barrier, a tree.
   *
   * `part` names one connected piece of it -- one corner's kerb out of the
   * thirty one in the same mesh. Undefined means the whole mesh.
   */
  | { kind: 'acMesh'; name: string; model: string; part?: number }
  /** A copy of one of the track's pieces, laid down by the user. */
  | { kind: 'acCopy'; model: string; id: string };

export type Tool =
  | 'select'
  | 'drawTrack'
  | 'drawPit'
  | 'place'
  | 'terrain'
  | 'ground'
  | 'scatter'
  | 'barrier'
  | 'kerb'
  | 'erase';

export type BrushMode = 'raise' | 'lower' | 'smooth' | 'flatten';

export interface BrushSettings {
  mode: BrushMode;
  radius: number;
  strength: number;
}

/**
 * The vegetation brush. Separate from BrushSettings on purpose: that one is
 * handed to the terrain sculpt straight through, and its mode is a BrushMode.
 */
export interface ScatterSettings {
  /** Library keys to pick from, one per plant. */
  kinds: string[];
  radius: number;
  /** Smallest gap between two scattered plants, metres. This is the density. */
  spacing: number;
  /** 0..1, half width of the random size range. */
  scaleJitter: number;
  /** Metres of clearance beyond the built edge before anything is planted. */
  keepOff: number;
  /**
   * Whether the run off counts as plantable ground.
   *
   * Off, `keepOff` is measured from the OUTER edge of the run off, which is
   * what a tree wants: a gravel trap or a grass verge is somewhere a car goes
   * at speed. On, it is measured from the edge of the tarmac and its kerb
   * instead, which is what grass wants -- a verge with no grass on it because
   * the grass was kept off the verge is not a verge.
   */
  overRunoff: boolean;
}
