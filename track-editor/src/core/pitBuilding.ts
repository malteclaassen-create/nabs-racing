import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PitSettings } from '../types';
import type { SurfaceKey } from '../types';
import type { MaterialKey, MeshDef } from './road';
import { frameAtDistance, pathLength, type Frame } from './spline';

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
/** The pit wall stand: every second box gets one. */
const STAND_EVERY = 2;
const STAND_W = 3.0;
const STAND_D = 1.5;
const STAND_H = 1.0;

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
  private buckets: Bucket;
  constructor(buckets: Bucket, f: Frame, side: -1 | 1) {
    this.buckets = buckets;
    const x = new THREE.Vector3(f.right.x, 0, f.right.z).normalize().multiplyScalar(side);
    const y = new THREE.Vector3(0, 1, 0);
    const z = new THREE.Vector3().crossVectors(y, x).normalize();
    // (x, y, z) has to be right handed or every box comes out inside out.
    if (new THREE.Vector3().crossVectors(x, y).dot(z) < 0) z.negate();
    this.m.makeBasis(x, y, z).setPosition(f.pos.x, f.pos.y, f.pos.z);
  }
  /** A box `w` across X, `h` tall from `y` up, `d` along Z, centred on (x, z). */
  box(mat: MaterialKey, w: number, h: number, d: number, x: number, y: number, z: number) {
    if (w <= 0 || h <= 0 || d <= 0) return;
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z);
    g.applyMatrix4(this.m);
    let list = this.buckets.get(mat);
    if (!list) {
      list = [];
      this.buckets.set(mat, list);
    }
    list.push(g);
  }
  cyl(mat: MaterialKey, r: number, h: number, x: number, y: number, z: number) {
    const g = new THREE.CylinderGeometry(r, r, h, 8);
    g.translate(x, y + h / 2, z);
    g.applyMatrix4(this.m);
    let list = this.buckets.get(mat);
    if (!list) {
      list = [];
      this.buckets.set(mat, list);
    }
    list.push(g);
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

  const walls: Bucket = new Map();
  const deco: Bucket = new Map();
  const floors: Bucket = new Map();

  for (let i = 0; i < n; i++) {
    const s = first + i * pitch;
    const f = frameAtDistance(pitFrames, pitClosed, s);
    const W = new Local(walls, f, side);
    const O = new Local(deco, f, side);
    const G = new Local(floors, f, side);

    /* --- the garage: floor, side walls, back wall, ceiling ------------- */
    // A real garage floor is a step up from the apron, painted and swept.
    G.box('concrete', D + THRESHOLD, 0.06, pitch, F - THRESHOLD + (D + THRESHOLD) / 2, 0.0, 0);
    // The party wall on the bay's near side; the last bay closes the far side.
    W.box('prop_white', D, FLOOR_1 - 0.1, 0.25, F + D / 2, 0.06, -pitch / 2);
    if (i === n - 1) W.box('prop_white', D, FLOOR_1 - 0.1, 0.25, F + D / 2, 0.06, pitch / 2);
    // Back wall, with the personnel door out to the paddock.
    W.box('prop_white', WALL_T, FLOOR_1 - 0.1, pitch, F + D - WALL_T / 2, 0.06, 0);
    O.box('prop_dark', 0.08, 2.1, 1.0, F + D - WALL_T - 0.04, 0.06, pitch / 2 - 1.4);
    // Ceiling, dark: the services and the lighting rails hang under it.
    O.box('prop_dark', D, 0.3, pitch, F + D / 2, DOOR_H + 0.2, 0);
    // Tool wall along the back: the cabinets every garage has.
    O.box('prop_metal', 0.7, 1.9, Math.max(1, pitch - 3.0), F + D - WALL_T - 0.35, 0.06, -0.6);
    O.box('prop_dark', 0.5, 0.9, Math.max(1, pitch - 3.0), F + D - WALL_T - 0.25, 1.96, -0.6);
    // Two tyre racks against the party wall.
    O.box('prop_metal', 1.6, 1.8, 0.45, F + 4.0, 0.06, -pitch / 2 + 0.36);
    O.box('prop_metal', 1.6, 1.8, 0.45, F + 6.2, 0.06, -pitch / 2 + 0.36);

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

    /* --- the canopy over the working lane and the balcony -------------- */
    // One slab from the canopy's front edge back to the upper floor's face.
    O.box('prop_light', canopy + F + SETBACK, 0.35, pitch, (F + SETBACK - canopy) / 2, FLOOR_1, 0);
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

    /* --- the pit wall stand across the lane ---------------------------- */
    // On the track side of the lane, against the wall, every second box: a
    // steel platform with the desk and the monitors the engineers sit at.
    if (i % STAND_EVERY === 0) {
      const x = -(apronEdge - STAND_D / 2 - 0.3);
      O.box('prop_metal', STAND_D, 0.12, STAND_W, x, STAND_H, 0);
      for (const dz of [-STAND_W / 2 + 0.1, STAND_W / 2 - 0.1]) {
        O.box('prop_metal', 0.08, STAND_H, 0.08, x - STAND_D / 2 + 0.06, 0, dz);
        O.box('prop_metal', 0.08, STAND_H, 0.08, x + STAND_D / 2 - 0.06, 0, dz);
      }
      // The desk along the wall side, the monitors on it, the rail behind.
      O.box('prop_dark', 0.5, 0.75, STAND_W - 0.2, x - STAND_D / 2 + 0.3, STAND_H + 0.12, 0);
      O.box('prop_dark', 0.06, 0.45, 0.7, x - STAND_D / 2 + 0.2, STAND_H + 0.95, -0.8);
      O.box('prop_dark', 0.06, 0.45, 0.7, x - STAND_D / 2 + 0.2, STAND_H + 0.95, 0.8);
      O.box('prop_metal', 0.05, RAIL_H, STAND_W, x + STAND_D / 2 - 0.03, STAND_H + 0.12, 0);
      // The steps up, on the lane side.
      O.box('prop_metal', 0.9, 0.5, 0.8, x + STAND_D / 2 + 0.45, 0, STAND_W / 2 - 0.5);
    }
  }

  /* --- the end walls of the row -------------------------------------- */
  for (const [s, dz] of [
    [first, -pitch / 2],
    [last, pitch / 2],
  ] as Array<[number, number]>) {
    const f = frameAtDistance(pitFrames, pitClosed, s);
    const W = new Local(walls, f, side);
    W.box('prop_light', D + SETBACK, FLOOR_2 + ROOF_T, WALL_T, F + (D - SETBACK) / 2 + SETBACK, 0, dz + (dz < 0 ? -WALL_T / 2 : WALL_T / 2));
  }

  /* --- the lane's furniture ------------------------------------------ */
  // The speed limit board where the limiter comes on, on the box side.
  if (cfg.limitStart > 2 && cfg.limitStart < total) {
    const f = frameAtDistance(pitFrames, pitClosed, cfg.limitStart);
    const O = new Local(deco, f, side);
    const x = cfg.width + 0.6;
    O.cyl('prop_metal', 0.04, 2.3, x, 0, 0);
    O.box('prop_white', 0.06, 0.8, 0.8, x, 2.3, 0);
    O.box('prop_red', 0.07, 0.1, 0.8, x, 2.3, 0);
    O.box('prop_red', 0.07, 0.1, 0.8, x, 3.0, 0);
    O.box('prop_red', 0.07, 0.8, 0.1, x, 2.3, -0.35);
    O.box('prop_red', 0.07, 0.8, 0.1, x, 2.3, 0.35);
  }
  // The exit light at the end of the lane, on the same side.
  const exitAt = total - cfg.limitEnd;
  if (exitAt > last + pitch && exitAt < total) {
    const f = frameAtDistance(pitFrames, pitClosed, exitAt);
    const O = new Local(deco, f, side);
    const x = cfg.width + 0.6;
    O.cyl('prop_metal', 0.06, 4.0, x, 0, 0);
    O.box('prop_dark', 0.3, 1.0, 0.4, x, 4.0, 0);
    O.box('prop_red', 0.32, 0.3, 0.3, x, 4.6, 0);
    O.box('prop_green', 0.32, 0.3, 0.3, x, 4.15, 0);
  }

  return [
    ...drain(walls, (m) => `1WALL_pit_garages_${m}`, () => 'WALL'),
    ...drain(floors, () => '1CONCRETE_pit_garage_floor', () => 'CONCRETE'),
    ...drain(deco, (m) => `OBJ_pit_complex_${m}`, () => null),
  ];
}
