import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PitSettings } from '../types';
import type { SurfaceKey } from '../types';
import type { MaterialKey, MeshDef } from './road';
import { frameAtDistance, pathLength, type Frame } from './spline';
import { EDGE_SINK, PIT_APRON_DROP } from './road';

/**
 * The pit complex: the garages the boxes stand in front of, the floor over
 * them, the canopy over the working lane, the pit wall stands across the lane
 * and the lane's own furniture.
 *
 * It is BUILT along the lane, not placed: a garage belongs behind its box and
 * nowhere else, one per box at the box pitch, so the row follows the boxes
 * however many there are, however far apart, and moves with them. It used to
 * be a handful of 8 m modules dropped roughly behind a 9 m box run, and the
 * doors never lined up with the stalls painted in front of them.
 *
 * Everything is measured off the lane's own three numbers -- the fast lane's
 * half width, the concrete apron and where the box stands on it -- so the
 * building front sits at the back edge of the apron whatever those are set
 * to, the way the stall paint already does.
 */

/* ------------------------------------------------------------------ */
/* Dimensions, metres                                                  */
/* ------------------------------------------------------------------ */

/** The building's front stands this far behind the edge of the concrete. */
const THRESHOLD = 0.3;
/**
 * How far the outer edge of the concrete lies under the lane's centre line:
 * the apron falls away across its width and bevels down to the ground at
 * its edge (see buildPitMeshes). Everything here stands at THAT height, so
 * a garage floor meets the concrete flush and a car rolls in over no lip.
 */
const APRON_EDGE_DROP = PIT_APRON_DROP + EDGE_SINK;
/** How deep a garage goes. Room for the car, the tool walls and a rear door. */
const GARAGE_DEPTH = 14;
/** Ground floor: the garage opening and the lintel over it. */
const DOOR_H = 4.3;
const FLOOR_1 = 5.0;
/** The first floor and the roof over it. */
const FLOOR_2 = 8.7;
const ROOF_T = 0.45;
/** Widest a garage door gets; the rest of the pitch is pillar. */
const DOOR_MAX = 7.0;
/** Narrowest pillar between two doors. */
const PILLAR_MIN = 1.6;
/** How thick the front pillars and the outer walls are. */
const WALL_T = 0.4;
/** The upper floor stands back from the garage line behind its balcony. */
const SETBACK = 1.4;
/** The canopy reaches this fraction of the apron out over the working lane. */
const CANOPY_REACH = 0.7;
/** Rail heights on the balcony and the roof terrace. */
const RAIL_H = 1.1;
/**
 * The pit wall: not a wall on the concrete but a raised kerb of concrete
 * along the track side of the apron, the way every real pit lane has it,
 * with the barrier wall on its outer edge and the teams' gantries standing on
 * top. The deck is high enough that the engineers look over the wall and low
 * enough that a set of three steps gets you up; the steps are cut into its
 * lane-side edge between every two stands, so nothing pokes out into the
 * working lane and nothing floats.
 */
const PLINTH_H = 0.75;
const PLINTH_D_MAX = 2.6;
const PLINTH_D_MIN = 1.8;
/** The barrier on the deck's outer edge, measured from the ground. */
const PIT_WALL_T = 0.35;
const PIT_WALL_H = 1.4;
/** The steps: three treads up to the deck, in a strip along the lane edge. */
const STAIR_STEPS = 3;
const STAIR_TREAD = 0.32;
const STAIR_W = 1.1;
/** The landing at the foot of the steps: room to stand before the first tread. */
const STAIR_LANDING = 0.9;
/**
 * The team stand on the deck, one per two boxes: a mat with the desk, the
 * monitors and the seats, a sunroof over it on four slim posts.
 */
const STAND_EVERY = 2;
const STAND_W = 5.0;
const STAND_D = 1.7;
const STAND_ROOF_H = 3.3;
/** The pit exit light: the pole its panel sits on. */
const LIGHT_POLE_H = 3.2;

/* ------------------------------------------------------------------ */
/* Building                                                            */
/* ------------------------------------------------------------------ */

type Bucket = Map<MaterialKey, THREE.BufferGeometry[]>;

/**
 * The boxes of one bay, all in the bay's own frame: X out from the lane
 * towards the garages, Y up, Z along the lane in the driving direction, the
 * origin on the lane's centre line at the box station, at lane height.
 */
class Local {
  private m = new THREE.Matrix4();
  /**
   * Which way the basis' Z runs against the lane: +1 along the driving
   * direction, -1 against it. A right handed basis with X pointing out
   * towards the boxes has Z along the lane on one side and against it on
   * the other, and every box used to be placed in whichever it was -- so
   * the "end wall" of the first bay stood inside the building on one side.
   * All the Z figures given to box() and friends are in the driving
   * direction; this flips them into the basis.
   */
  private dir: 1 | -1;
  private buckets: Bucket;
  /**
   * The fall of the lane either side of the station, metres per metre in
   * the driving direction. Everything a bay builds is sheared to it, so a
   * bay on a sloping lane meets its neighbours at the seam instead of
   * standing a step above or below them; the ends of the row use one slope.
   */
  private slopeBefore: number;
  private slopeAfter: number;
  constructor(buckets: Bucket, f: Frame, side: -1 | 1, y0 = f.pos.y, slopeBefore = 0, slopeAfter = slopeBefore) {
    this.buckets = buckets;
    this.slopeBefore = slopeBefore;
    this.slopeAfter = slopeAfter;
    const x = new THREE.Vector3(f.right.x, 0, f.right.z).normalize().multiplyScalar(side);
    const y = new THREE.Vector3(0, 1, 0);
    const z = new THREE.Vector3().crossVectors(y, x).normalize();
    // (x, y, z) has to be right handed or every box comes out inside out.
    if (new THREE.Vector3().crossVectors(x, y).dot(z) < 0) z.negate();
    const fwd = new THREE.Vector3(f.fwd.x, 0, f.fwd.z);
    this.dir = z.dot(fwd) >= 0 ? 1 : -1;
    this.m.makeBasis(x, y, z).setPosition(f.pos.x, y0, f.pos.z);
  }
  private keep(mat: MaterialKey, g: THREE.BufferGeometry) {
    if (this.slopeBefore !== 0 || this.slopeAfter !== 0) {
      const a = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) {
        const along = a.getZ(i) * this.dir;
        a.setY(i, a.getY(i) + along * (along > 0 ? this.slopeAfter : this.slopeBefore));
      }
    }
    g.applyMatrix4(this.m);
    let list = this.buckets.get(mat);
    if (!list) {
      list = [];
      this.buckets.set(mat, list);
    }
    list.push(g);
  }
  /** A box `w` across X, `h` tall from `y` up, `d` along Z, centred on (x, z). */
  box(mat: MaterialKey, w: number, h: number, d: number, x: number, y: number, z: number) {
    if (w <= 0 || h <= 0 || d <= 0) return;
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z * this.dir);
    this.keep(mat, g);
  }
  /** An upright cylinder, `h` tall from `y` up. */
  cyl(mat: MaterialKey, r: number, h: number, x: number, y: number, z: number) {
    const g = new THREE.CylinderGeometry(r, r, h, 8);
    g.translate(x, y + h / 2, z * this.dir);
    this.keep(mat, g);
  }
  /** A disc lying across the lane, `len` thick along Z, centred on (x, y, z). */
  disc(mat: MaterialKey, r: number, len: number, x: number, y: number, z: number) {
    const g = new THREE.CylinderGeometry(r, r, len, 16);
    g.rotateX(Math.PI / 2);
    g.translate(x, y, z * this.dir);
    this.keep(mat, g);
  }
  /**
   * A board facing along the lane: a thin box whose two big faces carry the
   * whole texture and whose edges are pushed onto its blank corner, so the
   * printed side does not smear round the rim.
   */
  board(mat: MaterialKey, w: number, h: number, t: number, x: number, y: number, z: number) {
    const g = new THREE.BoxGeometry(w, h, t);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    // Faces in BoxGeometry order: +X, -X, +Y, -Y, +Z, -Z, four corners each.
    for (let i = 0; i < 16; i++) uv.setXY(i, 0.02, 0.98);
    uv.needsUpdate = true;
    g.translate(x, y + h / 2, z * this.dir);
    this.keep(mat, g);
  }
}

function drain(
  buckets: Bucket,
  name: (mat: MaterialKey) => string,
  surface: (mat: MaterialKey) => SurfaceKey | null,
): MeshDef[] {
  const out: MeshDef[] = [];
  for (const [mat, geos] of buckets) {
    if (geos.length === 0) continue;
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    if (geos.length > 1) for (const g of geos) g.dispose();
    merged.computeBoundingSphere();
    out.push({ name: name(mat), material: mat, surface: surface(mat), geometry: merged });
  }
  return out;
}

/** Whether a project wants the built complex. Undefined counts as yes. */
export function wantsPitBuilding(cfg: PitSettings): boolean {
  return cfg.building !== false;
}

/**
 * How far the built complex reaches out from the lane's centre line, metres:
 * the back wall of the garages. The generator grades and paints the paddock
 * out to this.
 */
export function pitBuildingDepth(cfg: PitSettings): number {
  return cfg.width + cfg.apron + THRESHOLD + GARAGE_DEPTH + WALL_T;
}

export function buildPitBuilding(
  pitFrames: Frame[],
  pitClosed: boolean,
  cfg: PitSettings,
): MeshDef[] {
  if (!wantsPitBuilding(cfg) || cfg.boxCount < 1 || pitFrames.length < 2) return [];
  const total = pathLength(pitFrames, pitClosed);
  const side = cfg.boxSide;
  const pitch = cfg.boxSpacing;
  const n = cfg.boxCount;
  // The whole row has to fit on the lane; a box run past its end is a box
  // run past its end, and the garages stop where the lane does.
  const first = cfg.startDist;
  const last = cfg.startDist + (n - 1) * pitch;
  if (first - pitch / 2 < 0 || last + pitch / 2 > total) return [];

  const apronEdge = cfg.width + cfg.apron;
  const F = apronEdge + THRESHOLD;
  const D = GARAGE_DEPTH;
  const door = Math.min(DOOR_MAX, pitch - PILLAR_MIN);
  const pillar = pitch - door;
  const canopy = cfg.apron * CANOPY_REACH;
  // The deck takes half the apron on the track side, within reason: the
  // rest is the walkway between it and the working lane.
  const plinthD = Math.min(PLINTH_D_MAX, Math.max(PLINTH_D_MIN, cfg.apron * 0.52));

  const walls: Bucket = new Map();
  const deco: Bucket = new Map();
  const floors: Bucket = new Map();

  // The lane's height at every station, and the fall between neighbours:
  // the whole row follows the lane's grade continuously, with every bay
  // sheared to meet the next at the seam. The row stands at the height of
  // the concrete's OUTER edge, which is where a garage floor has to be.
  const frames: Frame[] = [];
  const level: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = frameAtDistance(pitFrames, pitClosed, first + i * pitch);
    frames.push(f);
    level.push(f.pos.y - APRON_EDGE_DROP);
  }
  const slope = (i: number) => (i < 0 || i >= n - 1 ? 0 : (level[i + 1] - level[i]) / pitch);
  const slopes = (i: number): [number, number] => {
    const before = i > 0 ? slope(i - 1) : slope(i);
    const after = i < n - 1 ? slope(i) : slope(i - 1);
    return [before, after];
  };

  for (let i = 0; i < n; i++) {
    const f = frames[i];
    const [sb, sa] = slopes(i);
    const W = new Local(walls, f, side, level[i], sb, sa);
    const O = new Local(deco, f, side, level[i], sb, sa);
    const G = new Local(floors, f, side, level[i], sb, sa);

    /* --- the garage: floor, side walls, back wall, ceiling ------------- */
    // Flush with the concrete outside it: the slab's top is the apron's
    // edge height, and it goes DOWN from there, so a car rolls in over no
    // lip. It used to be a 6 cm step up.
    G.box('concrete', D + THRESHOLD, 0.12, pitch, F - THRESHOLD + (D + THRESHOLD) / 2, -0.12, 0);
    // The party wall on the bay's near side; the last bay closes the far side.
    W.box('prop_white', D, FLOOR_1 - 0.1, 0.25, F + D / 2, 0, -pitch / 2);
    if (i === n - 1) W.box('prop_white', D, FLOOR_1 - 0.1, 0.25, F + D / 2, 0, pitch / 2);
    // Back wall, with the personnel door out to the paddock.
    W.box('prop_white', WALL_T, FLOOR_1 - 0.1, pitch, F + D - WALL_T / 2, 0, 0);
    O.box('prop_dark', 0.08, 2.1, 1.0, F + D - WALL_T - 0.04, 0, pitch / 2 - 1.4);
    // Ceiling, dark: the services and the lighting rails hang under it.
    // Inside the walls, short of the back wall and the party walls, so it
    // never shares a face with them.
    O.box('prop_dark', D - WALL_T - 0.1, 0.3, pitch - 0.3, F + (D - WALL_T - 0.1) / 2, DOOR_H + 0.2, 0);
    // Tool wall along the back: the cabinets every garage has.
    O.box('prop_metal', 0.7, 1.9, Math.max(1, pitch - 3.0), F + D - WALL_T - 0.35, 0, -0.6);
    O.box('prop_dark', 0.5, 0.9, Math.max(1, pitch - 3.0), F + D - WALL_T - 0.25, 1.96, -0.6);
    // Two tyre racks against the party wall.
    O.box('prop_metal', 1.6, 1.8, 0.45, F + 4.0, 0, -pitch / 2 + 0.36);
    O.box('prop_metal', 1.6, 1.8, 0.45, F + 6.2, 0, -pitch / 2 + 0.36);

    /* --- the front: pillars, lintel, roller shutter box ---------------- */
    // The pillars straddle the bay edge: half on this bay, half on the next.
    // Emitted once per edge, centred on it, so the row has no double walls;
    // the last bay closes its far edge too.
    W.box('prop_light', WALL_T, DOOR_H, pillar, F + WALL_T / 2, 0, -pitch / 2);
    if (i === n - 1) W.box('prop_light', WALL_T, DOOR_H, pillar, F + WALL_T / 2, 0, pitch / 2);
    // The lintel over the opening: the dark band the team's name goes on.
    W.box('prop_dark', WALL_T + 0.1, FLOOR_1 - DOOR_H, pitch, F + WALL_T / 2, DOOR_H, 0);
    // The shutter, rolled up under the lintel: a drum just inside the opening.
    O.box('prop_metal', 0.5, 0.42, door, F + WALL_T + 0.25, DOOR_H - 0.42, 0);

    /* --- the first floor slab: canopy, balcony and floor in one --------- */
    // From the canopy's front edge over the working lane all the way to the
    // back wall: the same slab is the canopy, the balcony and the floor of
    // the storey above, and it closes the joint between the two storeys on
    // every side. It used to start at the lane's centre line by mistake.
    O.box('prop_light', canopy + D + 0.3, 0.35, pitch, F - canopy + (canopy + D + 0.3) / 2, FLOOR_1, 0);
    // The fascia on its front edge, dark, the advertising band.
    O.box('prop_dark', 0.25, 0.9, pitch, -canopy + F + 0.125, FLOOR_1 - 0.1, 0);
    // The balcony rail, on the front edge of the slab above the doors.
    O.box('prop_metal', 0.05, RAIL_H, pitch, F + 0.1, FLOOR_1 + 0.35, 0);
    O.box('prop_metal', 0.05, RAIL_H, 0.05, F + 0.1, FLOOR_1 + 0.35, -pitch / 2);

    /* --- the first floor: glazed hospitality, and the roof ------------- */
    W.box('prop_light', D - SETBACK, FLOOR_2 - FLOOR_1 - 0.35, pitch, F + SETBACK + (D - SETBACK) / 2, FLOOR_1 + 0.35, 0);
    // Glass across most of the bay, a mullion at the edge.
    O.box('prop_glass', 0.08, 2.4, pitch - 0.7, F + SETBACK - 0.06, FLOOR_1 + 0.9, 0);
    O.box('prop_dark', 0.12, 2.6, 0.7, F + SETBACK - 0.08, FLOOR_1 + 0.8, -pitch / 2 + 0.35);
    // Roof slab, and the terrace rail along its front and back.
    O.box('prop_dark', D - SETBACK + 0.6, ROOF_T, pitch, F + SETBACK - 0.3 + (D - SETBACK + 0.6) / 2, FLOOR_2, 0);
    O.box('prop_metal', 0.05, RAIL_H, pitch, F + SETBACK - 0.25, FLOOR_2 + ROOF_T, 0);
    O.box('prop_metal', 0.05, RAIL_H, pitch, F + D + 0.25, FLOOR_2 + ROOF_T, 0);
    O.box('prop_metal', 0.05, RAIL_H, 0.05, F + SETBACK - 0.25, FLOOR_2 + ROOF_T, -pitch / 2);
    // Plant on the roof: the air handling unit every second bay carries.
    if (i % 2 === 1) O.box('prop_metal', 2.2, 1.3, 1.6, F + D - 3.5, FLOOR_2 + ROOF_T, 0);

    /* --- the pit wall: the deck, the barrier, the steps, the stands ---- */
    // The deck runs the whole box run along the track side of the concrete,
    // the barrier on its outer edge with the advertising band every pit
    // wall in the world carries. Both collide: a car does not drive up a
    // kerb of concrete or through the wall behind it.
    {
      const xOut = -(apronEdge - 0.05);
      const xIn = xOut + plinthD;
      // The barrier stands on the deck, set 15 cm in from its outer edge so
      // the concrete shows as a ledge under it: two faces a few centimetres
      // apart used to flicker into each other from down the lane.
      const xw = xOut + 0.15 + PIT_WALL_T / 2;
      W.box('prop_light', PIT_WALL_T, PIT_WALL_H - PLINTH_H + 0.05, pitch, xw, PLINTH_H - 0.05, 0);
      O.box('prop_red', PIT_WALL_T + 0.04, 0.45, pitch, xw, PIT_WALL_H - 0.55, 0);
      const stairs = i % STAND_EVERY === 1 && i < n - 1;
      const run = STAIR_STEPS * STAIR_TREAD;
      // The cut in the deck: a landing at ground level, then the steps.
      const notch = STAIR_LANDING + run;
      if (!stairs) {
        W.box('concrete', plinthD, PLINTH_H, pitch, (xOut + xIn) / 2, 0, 0);
      } else {
        // The wall side of the deck is solid; the lane side is cut away
        // for the landing and the steps, which rise along the lane.
        const back = plinthD - STAIR_W;
        W.box('concrete', back, PLINTH_H, pitch, xOut + back / 2, 0, 0);
        const xs = xIn - STAIR_W / 2;
        const rest = pitch / 2 - notch / 2;
        W.box('concrete', STAIR_W, PLINTH_H, rest, xs, 0, -(notch / 2 + rest / 2));
        W.box('concrete', STAIR_W, PLINTH_H, rest, xs, 0, notch / 2 + rest / 2);
        const rise = PLINTH_H / (STAIR_STEPS + 1);
        for (let k = 0; k < STAIR_STEPS; k++) {
          W.box('concrete', STAIR_W, rise * (k + 1), STAIR_TREAD, xs, 0, -notch / 2 + STAIR_LANDING + STAIR_TREAD * (k + 0.5));
        }
      }
      // The handrail along the lane edge of the deck, broken at the steps.
      const xr = xIn - 0.05;
      const spans: Array<[number, number]> = stairs
        ? [[-pitch / 2, -notch / 2 - 0.2], [notch / 2 + 0.2, pitch / 2]]
        : [[-pitch / 2, pitch / 2]];
      for (const [z0, z1] of spans) {
        O.box('prop_metal', 0.04, 0.04, z1 - z0, xr, PLINTH_H + RAIL_H - 0.04, (z0 + z1) / 2);
        const posts = Math.max(1, Math.round((z1 - z0) / 1.8));
        for (let k = 0; k <= posts; k++) {
          const z = z0 + ((z1 - z0) * k) / posts;
          // The post on the bay edge belongs to the next bay, except at the end.
          if (k === posts && z1 === pitch / 2 && i < n - 1) continue;
          O.box('prop_metal', 0.04, RAIL_H, 0.04, xr, PLINTH_H, z);
        }
      }
    }
    if (i % STAND_EVERY === 0) {
      // The stand on the deck, against the wall: a mat, the desk with its
      // shelf of monitors and the timing screen above, three seats.
      const standD = Math.min(STAND_D, plinthD - PIT_WALL_T - 0.4);
      const x = -(apronEdge - PIT_WALL_T - 0.1 - standD / 2);
      const xWall = x - standD / 2;
      const xLane = x + standD / 2;
      const deck = PLINTH_H + 0.03;
      O.box('prop_dark', standD, 0.03, STAND_W, x, PLINTH_H, 0);
      // The back of the stand, wall side, up to the roof: the monitors hang
      // on it rather than in the air over the barrier.
      O.box('prop_dark', 0.06, STAND_ROOF_H - PLINTH_H, STAND_W, xWall + 0.03, PLINTH_H, 0);
      O.box('prop_dark', 0.55, 0.72, STAND_W - 0.3, xWall + 0.3, deck, 0);
      O.box('prop_light', 0.6, 0.04, STAND_W - 0.3, xWall + 0.3, deck + 0.72, 0);
      for (let k = 0; k < 4; k++) {
        const dz = -STAND_W / 2 + 0.85 + k * ((STAND_W - 1.7) / 3);
        O.box('prop_dark', 0.05, 0.42, 0.7, xWall + 0.12, deck + 0.79, dz);
        O.box('prop_blue', 0.02, 0.36, 0.64, xWall + 0.15, deck + 0.82, dz);
      }
      O.box('prop_dark', 0.05, 0.36, 1.4, xWall + 0.1, deck + 1.42, 0);
      O.box('prop_blue', 0.02, 0.3, 1.34, xWall + 0.13, deck + 1.45, 0);
      // Three seats facing the track.
      for (const dz of [-1.5, 0, 1.5]) {
        O.box('prop_dark', 0.5, 0.06, 0.5, xWall + 1.05, deck + 0.45, dz);
        O.box('prop_dark', 0.08, 0.5, 0.5, xWall + 1.3, deck + 0.47, dz);
        O.box('prop_metal', 0.06, 0.45, 0.06, xWall + 1.05, deck, dz);
      }
      // The sunroof on four slim posts, its fascia dark for the team's name.
      for (const dz of [-STAND_W / 2 + 0.15, STAND_W / 2 - 0.15]) {
        O.box('prop_metal', 0.06, STAND_ROOF_H - PLINTH_H, 0.06, xWall + 0.1, PLINTH_H, dz);
        O.box('prop_metal', 0.06, STAND_ROOF_H - PLINTH_H, 0.06, xLane - 0.1, PLINTH_H, dz);
      }
      O.box('prop_light', standD + 0.6, 0.08, STAND_W + 0.4, x, STAND_ROOF_H, 0);
      O.box('prop_dark', 0.06, 0.3, STAND_W + 0.4, xLane + 0.3, STAND_ROOF_H - 0.3, 0);
    }
  }

  /* --- the end walls of the row -------------------------------------- */
  // Two walls at each end, one per storey, each exactly as deep as its
  // storey: the ground floor from the garage line to the back wall, the
  // upper floor from its set back face to the back wall. One wall the full
  // depth of both used to stick out past the back of the building.
  for (const [i, dz] of [
    [0, -pitch / 2],
    [n - 1, pitch / 2],
  ] as Array<[number, number]>) {
    const f = frames[i];
    const [sb, sa] = slopes(i);
    const W = new Local(walls, f, side, level[i], sb, sa);
    const z = dz + (dz < 0 ? -WALL_T / 2 : WALL_T / 2);
    W.box('prop_light', D, FLOOR_1, WALL_T, F + D / 2, 0, z);
    W.box('prop_light', D - SETBACK, FLOOR_2 - FLOOR_1, WALL_T, F + SETBACK + (D - SETBACK) / 2, FLOOR_1, z);
  }

  /* --- the lane's furniture ------------------------------------------ */
  // The speed limit where the limiter comes on: a small board either side
  // of the lane, standing on the concrete, the limit printed on it. Real
  // ones are exactly that -- knee high, one each side, nothing overhead.
  if (cfg.limitStart > 2 && cfg.limitStart < total) {
    const f = frameAtDistance(pitFrames, pitClosed, cfg.limitStart);
    const O = new Local(deco, f, side);
    for (const x of [cfg.width + 0.7, -(cfg.width + 0.7)]) {
      O.cyl('prop_metal', 0.025, 0.55, x, 0, -0.26);
      O.cyl('prop_metal', 0.025, 0.55, x, 0, 0.26);
      O.board('sign_speed', 0.72, 0.8, 0.05, x, 0.5, 0);
    }
  }
  // The exit light at the end of the lane, on the box side: a panel on a
  // pole, its lamps hooded and facing the car that is about to leave.
  const exitAt = total - cfg.limitEnd;
  if (exitAt > last + pitch && exitAt < total) {
    const f = frameAtDistance(pitFrames, pitClosed, exitAt);
    const O = new Local(deco, f, side);
    const x = cfg.width + 0.6;
    O.cyl('prop_metal', 0.06, LIGHT_POLE_H, x, 0, 0);
    O.box('prop_metal', 0.5, 0.06, 0.5, x, 0, 0);
    const top = LIGHT_POLE_H;
    O.box('prop_dark', 0.5, 1.35, 0.3, x, top, 0);
    for (const [mat, y] of [
      ['prop_red', top + 0.98],
      ['prop_green', top + 0.4],
    ] as Array<[MaterialKey, number]>) {
      O.disc('prop_dark', 0.2, 0.04, x, y, -0.16);
      O.disc(mat, 0.16, 0.08, x, y, -0.19);
      O.box('prop_dark', 0.44, 0.04, 0.3, x, y + 0.2, -0.3);
    }
  }

  return [
    ...drain(walls, (m) => `1WALL_pit_garages_${m}`, () => 'WALL'),
    ...drain(floors, () => '1CONCRETE_pit_garage_floor', () => 'CONCRETE'),
    ...drain(deco, (m) => `OBJ_pit_complex_${m}`, () => null),
  ];
}
