import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RoadSettings } from '../types';
import type { MaterialKey, MeshDef } from './road';
import { frameAtFraction, type Frame } from './spline';

/**
 * The start gantry: the steel bridge over the start/finish line, and the five
 * pairs of lights hanging off it.
 *
 * It is BUILT, not placed. A gantry does not stand somewhere anyone chooses --
 * it stands over the timing line, spans whatever the circuit is wide there,
 * and moves when the line moves. That is the same argument as the marshalling
 * panels on the barrier (see the note in library.ts): the only decision left
 * is whether the circuit has one, and that is a checkbox rather than a drag.
 *
 * The palette keeps a `start_gantry` object all the same, built from the very
 * same parts at a fixed span, because a circuit can want a second bridge over
 * the pit exit or across a straight and that one IS a placement.
 */

/* ------------------------------------------------------------------ */
/* Dimensions                                                          */
/* ------------------------------------------------------------------ */

/**
 * Underside of the truss above the road, metres.
 *
 * Not a round 7: the FIA minimum over a circuit is 7 m and nobody builds to
 * exactly the minimum, so 7.4 is both legal and what the photographs show --
 * high enough that a crane can get a car out from under it.
 */
const CLEAR = 7.4;
/** Depth of the main truss: how tall it is, and how thick along the track. */
const BEAM_H = 1.8;
const BEAM_D = 1.5;
/** The legs are square lattice towers this far across. */
const LEG = 1.25;
/** Thickness of a lattice member. Everything here is angle steel of one size. */
const T = 0.13;
/** Bay length in the lattice, both in the legs and along the beam. */
const BAY = 1.6;
/** Metres of beam to one repeat of the chequered band. */
const BANNER_TILE = 2.4;

/**
 * How far outside the tarmac edge a leg stands, at most.
 *
 * A gantry leg goes behind the barrier, which is where the run off ends -- but
 * a modern circuit's run off can be twenty metres of asphalt, and a bridge
 * spanning fifty metres is not a gantry, it is a viaduct. Past this the legs
 * stop following the run off and stand at a width that still reads as a
 * circuit, with the run off carrying on behind them.
 */
const MAX_BEYOND = 9;
/** And it never crowds the tarmac either, however narrow the verge is. */
const MIN_BEYOND = 2.4;

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** A box about its own centre. Local axes: +X left, +Y up, +Z driving. */
function bx(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

const FWD = new THREE.Vector3(0, 0, 1);
const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchQ = new THREE.Quaternion();

/**
 * A member running from a to b, square in section.
 *
 * This is what makes a lattice a lattice rather than a ladder: the diagonals
 * have to actually reach the corners they brace, and their length falls out of
 * the bay rather than being typed in beside it.
 */
function strut(
  ax: number, ay: number, az: number,
  bxx: number, by: number, bz: number,
  t = T,
): THREE.BufferGeometry {
  scratchA.set(bxx - ax, by - ay, bz - az);
  const len = scratchA.length();
  const g = new THREE.BoxGeometry(t, t, len);
  scratchQ.setFromUnitVectors(FWD, scratchB.copy(scratchA).normalize());
  g.applyQuaternion(scratchQ);
  g.translate((ax + bxx) / 2, (ay + by) / 2, (az + bz) / 2);
  return g;
}

/**
 * A lamp lens: a flat plate facing the cars, with the round part in the paint.
 *
 * A disc of geometry is the obvious way to make a round lamp and it is the
 * wrong one here. Ten of them at twelve segments apiece is most of a thousand
 * triangles spent on an outline that the lens texture already draws -- the
 * canvas is a disc on black, and black is what the emissive pass leaves unlit.
 * So the glowing shape is round while the mesh behind it is twelve triangles,
 * and the corners it wastes are unlit corners against a black housing.
 */
function lens(r: number, x: number, y: number, z: number, thick = 0.06): THREE.BufferGeometry {
  return bx(r * 2, r * 2, thick, x, y, z);
}

/** Repeat a box's texture along its own X instead of stretching one tile. */
function tileU(g: THREE.BufferGeometry, repeat: number): THREE.BufferGeometry {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeat, uv.getY(i));
  uv.needsUpdate = true;
  return g;
}

/* ------------------------------------------------------------------ */
/* The object                                                          */
/* ------------------------------------------------------------------ */

export interface GantryPart {
  geometry: THREE.BufferGeometry;
  material: MaterialKey;
  /**
   * A name of its own for the exported mesh, where sharing a material with
   * another part is not enough.
   *
   * Only the lamps use it, and for the one reason: the five columns have to
   * come on ONE AT A TIME, so they cannot arrive in the game as a single mesh.
   * The track script finds them by these names -- see startLightsLua() in
   * export/ini.ts, which is the other half of this and has to agree.
   */
  group?: string;
}

/** The mesh name of one column of lamps, counting from the left. */
export function startLightMesh(column: number): string {
  return `OBJ_startgantry_light_${column}`;
}

/** Columns of lamps on the gantry. Five, and the reason is in the code below. */
export const START_LIGHT_COLUMNS = 5;

/**
 * How much of the bridge is actually modelled.
 *
 * `full` is the one the circuit builds over its own timing line: braced legs,
 * a trussed beam, a walkway with a rail on it and the camera pods. There is
 * exactly one of these on a track, so it can afford to be a structure.
 *
 * `plain` is the same bridge with the bracing, the hoods and the pods left
 * off, for the palette copy. A placed object can end up on a circuit twenty
 * times over, and the library holds itself to about a thousand triangles an
 * object for that reason -- see the budget check in verify-scene. It is the
 * same silhouette, the same lights, a third of the members.
 *
 * `sink` is the other difference and it matters more than it sounds. The
 * built one puts its footings well under the road plane, because the ground
 * beside a circuit falls away from the tarmac and a leg cut off dead at zero
 * floats on one side and is buried on the other. A placed object is dropped on
 * ground the editor already knows the height of, so it stands ON it.
 */
export interface GantryOptions {
  detail?: 'full' | 'plain';
  sink?: boolean;
}

/**
 * The gantry in its own frame: origin on the road surface under the middle of
 * the beam, +Z the driving direction, +X the left of it, lights facing -Z at
 * the oncoming cars.
 *
 * `leftOut` and `rightOut` are how far each leg stands from the centre line,
 * measured the way the road measures its own sides, so an asymmetric circuit --
 * pit wall one side, run off the other -- gets a bridge that reaches both.
 *
 * The LEFT leg is the one at +X, and that is not a slip. A right handed basis
 * with +Z along the driving direction and +Y up has its +X on the left of the
 * road -- there is no other choice available, and it is the same convention
 * the AC_* dummies are built on (see frameQuat in core/markers.ts). Built the
 * other way round the whole bridge came out mirrored, which nobody can see on
 * a symmetrical circuit and which puts the legs on the wrong sides the moment
 * one side of the road is wider than the other.
 */
export function startGantryParts(
  leftOut: number,
  rightOut: number,
  opts: GantryOptions = {},
): GantryPart[] {
  const full = opts.detail !== 'plain';
  const sink = opts.sink !== false;
  const steel: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const footing: THREE.BufferGeometry[] = [];
  /** One entry per column of lamps, so each column can be its own mesh. */
  const lamps: THREE.BufferGeometry[][] = [];
  const banner: THREE.BufferGeometry[] = [];

  const top = CLEAR + BEAM_H;

  /* --- the legs ----------------------------------------------------- */
  /*
   * A lattice tower, not a post. The four corner uprights carry the load, the
   * rungs hold them apart and the diagonals stop the square folding into a
   * rhombus -- which is what the thing is FOR, and reading that off it at a
   * glance is most of why a gantry looks like a gantry.
   *
   * The feet run a little below the road plane and stand on a concrete block
   * whose top is just above it. The ground beside a circuit is never exactly
   * at road height -- the run off drops away from the tarmac -- so a leg cut
   * off dead at zero floats on one side of the track and is buried on the
   * other. A block deep enough to cover the drop hides both.
   */
  const legFoot = sink ? -0.5 : 0.18;
  for (const side of [-1, 1] as const) {
    const cx = side < 0 ? leftOut : -rightOut;
    const h = LEG / 2;
    const corners: Array<[number, number]> = [
      [cx - h, -BEAM_D / 2 + T], [cx + h, -BEAM_D / 2 + T],
      [cx + h, BEAM_D / 2 - T], [cx - h, BEAM_D / 2 - T],
    ];
    for (const [x, z] of corners) {
      steel.push(bx(T * 1.4, top - legFoot, T * 1.4, x, (top + legFoot) / 2, z));
    }
    const bays = Math.max(3, Math.round((top - legFoot) / BAY));
    const step = (top - legFoot) / bays;
    // The plain tower keeps a rung at the foot, the waist and the head. That
    // is a third of them, and it still reads as a tower, because what says so
    // is the four uprights and how far apart they stand.
    const rung = full ? 1 : 3;
    for (let b = 0; b <= bays; b += rung) {
      const y = legFoot + b * step;
      for (let i = 0; i < 4; i++) {
        const [x0, z0] = corners[i];
        const [x1, z1] = corners[(i + 1) % 4];
        steel.push(strut(x0, y, z0, x1, y, z1));
      }
    }
    if (full) {
      for (let b = 0; b < bays; b++) {
        const y0 = legFoot + b * step;
        const y1 = y0 + step;
        for (let i = 0; i < 4; i++) {
          const [x0, z0] = corners[i];
          const [x1, z1] = corners[(i + 1) % 4];
          // Alternating, so the bracing zig-zags up the tower the way a real
          // one does rather than leaning the same way all the way to the top.
          if ((b + i) % 2 === 0) steel.push(strut(x0, y0, z0, x1, y1, z1));
          else steel.push(strut(x1, y0, z1, x0, y1, z0));
        }
      }
    }
    footing.push(
      sink
        ? bx(LEG + 1.0, 1.8, LEG + 1.0, cx, -0.8, 0)
        : bx(LEG + 1.0, 0.4, LEG + 1.0, cx, 0.2, 0),
    );
  }

  /* --- the beam ----------------------------------------------------- */
  /*
   * Two plate girders one BEAM_D apart, braced between the chords. Built from
   * the actual span so a wide circuit gets more bays rather than longer ones.
   */
  const span = leftOut + rightOut;
  const x0 = -rightOut;
  const bays = Math.max(4, Math.round(span / BAY));
  const step = span / bays;
  for (const z of [-BEAM_D / 2 + T, BEAM_D / 2 - T]) {
    steel.push(bx(span + LEG, T * 1.6, T * 1.6, (leftOut - rightOut) / 2, CLEAR + T, z));
    steel.push(bx(span + LEG, T * 1.6, T * 1.6, (leftOut - rightOut) / 2, top - T, z));
    for (let b = 0; b <= bays; b += full ? 1 : 2) {
      const x = x0 + b * step;
      steel.push(strut(x, CLEAR, z, x, top, z));
      if (full && b < bays) {
        const xn = x0 + (b + 1) * step;
        steel.push(strut(x, CLEAR, z, xn, top, z));
      }
    }
  }
  // Cross bracing between the two girders, along the underside, so the bridge
  // is a box and not two ladders standing next to each other.
  if (full) {
    for (let b = 0; b < bays; b++) {
      const xa = x0 + b * step;
      const xbb = xa + step;
      steel.push(strut(xa, CLEAR + T, -BEAM_D / 2 + T, xbb, CLEAR + T, BEAM_D / 2 - T));
    }
  }

  /* --- the walkway -------------------------------------------------- */
  const deckY = top + 0.06;
  steel.push(bx(span + LEG, 0.08, BEAM_D + 0.5, (leftOut - rightOut) / 2, deckY, 0));
  const posts = Math.max(4, Math.round(span / 2.6));
  for (const z of [-(BEAM_D + 0.5) / 2 + 0.06, (BEAM_D + 0.5) / 2 - 0.06]) {
    steel.push(bx(span + LEG, 0.07, 0.07, (leftOut - rightOut) / 2, deckY + 1.05, z));
    if (!full) continue;
    steel.push(bx(span + LEG, 0.06, 0.06, (leftOut - rightOut) / 2, deckY + 0.55, z));
    for (let i = 0; i <= posts; i++) {
      const x = x0 + (span * i) / posts;
      steel.push(bx(0.07, 1.1, 0.07, x, deckY + 0.55, z));
    }
  }

  /* --- the band along the beam -------------------------------------- */
  /*
   * On the face the cars see, and on the back as well: the same board is read
   * from both directions on every circuit that has one, and a bridge that is
   * blank from behind reads as scenery with a front painted on it.
   *
   * A band across the lower half of the beam rather than cladding over the
   * whole of it. Boarding the truss in is what a hoarding contractor does and
   * it turns the bridge into a rectangle -- the diagonals are the single thing
   * that says this is a structure holding itself up over a road.
   */
  const bandH = 0.85;
  for (const z of [-BEAM_D / 2 - 0.06, BEAM_D / 2 + 0.06]) {
    banner.push(
      tileU(
        bx(span + LEG, bandH, 0.1, (leftOut - rightOut) / 2, CLEAR + 0.16 + bandH / 2, z),
        Math.max(2, Math.round((span + LEG) / BANNER_TILE)),
      ),
    );
  }

  /* --- the lights --------------------------------------------------- */
  /*
   * Five columns of two, hung under the middle of the beam. Five is not a
   * stylistic choice: the sequence is five lights coming on one a second and
   * all five going out together, so a gantry with four or six of them is a
   * gantry nobody can read.
   */
  const COLS = START_LIGHT_COLUMNS;
  const PITCH = 1.15;
  const rackW = COLS * PITCH + 0.3;
  const rackH = 1.5;
  const rackD = 0.42;
  const rackY = CLEAR - 0.12 - rackH / 2;
  const front = -rackD / 2;

  // Hung off the beam rather than glued to it: two straps, which is what
  // carries the weight and what you see against the sky from below.
  for (const x of [-rackW / 2 + 0.35, rackW / 2 - 0.35]) {
    dark.push(bx(0.14, 0.4, 0.3, x, CLEAR - 0.06, 0));
  }
  dark.push(bx(rackW, rackH, rackD, 0, rackY, 0));
  // Dividers between the columns and a lip round the face, so the housing
  // reads as five fittings bolted together instead of one black slab. The
  // plain copy keeps the two ends, which is what gives the rack its edge.
  for (let i = 0; i <= COLS; i++) {
    if (!full && i > 0 && i < COLS) continue;
    dark.push(bx(0.08, rackH + 0.12, rackD + 0.12, (i - COLS / 2) * PITCH, rackY, 0));
  }
  dark.push(bx(rackW + 0.16, 0.1, rackD + 0.12, 0, rackY + rackH / 2 + 0.05, 0));
  dark.push(bx(rackW + 0.16, 0.1, rackD + 0.12, 0, rackY - rackH / 2 - 0.05, 0));

  for (let col = 0; col < COLS; col++) {
    const x = (col - (COLS - 1) / 2) * PITCH;
    // A bucket per column, because each one has to be switchable on its own.
    const lamp: THREE.BufferGeometry[] = [];
    lamps.push(lamp);
    for (const dy of [0.36, -0.36]) {
      const y = rackY + dy;
      // The bezel first, then the lens standing a little proud of it, then the
      // hood over the top -- without a hood a lens takes the sun square on and
      // the whole rack lights up at midday whether or not it is switched on.
      dark.push(lens(0.29, x, y, front - 0.03, 0.08));
      lamp.push(lens(0.235, x, y, front - 0.08, 0.06));
      if (!full) continue;
      // Pitched forward and down over the lens, which is the whole job of a
      // hood: it has to shade the glass from a sun that is above and behind
      // the gantry, and a flat shelf does not.
      const hood = new THREE.BoxGeometry(0.62, 0.05, 0.34);
      hood.rotateX(THREE.MathUtils.degToRad(-14));
      hood.translate(x, y + 0.32, front - 0.17);
      dark.push(hood);
      dark.push(bx(0.05, 0.32, 0.3, x - 0.285, y + 0.16, front - 0.16));
      dark.push(bx(0.05, 0.32, 0.3, x + 0.285, y + 0.16, front - 0.16));
    }
  }

  /* --- the cameras -------------------------------------------------- */
  // Two pods on the walkway, off centre the way the real ones are: this is the
  // shot every start is filmed from, and their silhouette is half of what says
  // "start/finish" about a bridge seen from a hundred metres back.
  if (full) {
    for (const x of [-rackW / 2 - 2.2, rackW / 2 + 2.2]) {
      dark.push(bx(0.5, 0.34, 0.44, x, deckY + 0.32, 0.1));
      // On the nose of the pod, not out in the air in front of it: the pod
      // sits at z = 0.1 and is 0.44 deep, so its face is at -0.12.
      dark.push(bx(0.24, 0.24, 0.16, x, deckY + 0.32, -0.18));
      steel.push(bx(0.1, 0.3, 0.1, x, deckY + 0.15, 0.1));
    }
  }

  const out: GantryPart[] = [];
  const push = (geos: THREE.BufferGeometry[], material: MaterialKey, group?: string) => {
    if (geos.length === 0) return;
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) return;
    if (geos.length > 1) for (const g of geos) g.dispose();
    out.push({ geometry: merged, material, group });
  };
  push(footing, 'concrete');
  push(steel, 'prop_metal');
  push(dark, 'prop_dark');
  push(banner, 'start_banner');
  // Numbered left to right AS THE DRIVER SEES THEM, which is the order they
  // come on in. The columns were built from -X, so the count runs backwards:
  // +X is the left of the road, and the driver is looking down the -Z face.
  lamps.forEach((column, i) =>
    push(column, 'led_start', startLightMesh(START_LIGHT_COLUMNS - i)),
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* Over the timing line                                                */
/* ------------------------------------------------------------------ */

/**
 * How far out from the centre line a leg stands on one side.
 *
 * It follows the road: tarmac, kerb, run off and the barrier's own gap, which
 * puts the leg just behind the barrier where a real one is. Clamped at both
 * ends so a hairpin-narrow verge does not put a leg on the racing surface and
 * a stadium-sized run off does not turn the bridge into a motorway sign.
 */
function legOffset(f: Frame, road: RoadSettings, side: -1 | 1): number {
  const width = side < 0 ? f.widthL : f.widthR;
  const runoff = (side < 0 ? f.runoffL : f.runoffR) * road.runoffWidth;
  const gap = side < 0 ? f.wallGapL : f.wallGapR;
  const beyond = road.kerbWidth + runoff + gap + 1.4;
  return width + Math.min(MAX_BEYOND, Math.max(MIN_BEYOND, beyond));
}

/**
 * The gantry standing over the start/finish line, in world space.
 *
 * Placed on a LEVEL frame -- the driving direction flattened, world up for up.
 * A gantry is built plumb whatever the road under it is doing; taking the
 * banked normal would lean the whole bridge over on a cambered start straight,
 * and a leaning gantry is far more obviously wrong than a leg that meets the
 * verge a few centimetres out.
 */
/**
 * The gantry in its own frame, kept between rebuilds.
 *
 * Dragging a control point moves the whole spline, so the start/finish frame
 * moves on every frame of the drag -- but the bridge STANDING there does not
 * change at all unless the road changes width under it. Building three hundred
 * primitives and merging them sixty times a second to watch the same object
 * slide sideways is pure waste, and it showed up as exactly that: a node drag
 * two milliseconds over its budget.
 *
 * So the shape is built once per (leftOut, rightOut), to the centimetre, and
 * what a rebuild actually does is write the transformed vertices into last
 * frame's buffers -- see `place` below.
 */
let localGantry: { key: string; parts: GantryPart[] } | null = null;

function localParts(leftOut: number, rightOut: number): GantryPart[] {
  const key = `${leftOut.toFixed(2)}|${rightOut.toFixed(2)}`;
  if (localGantry?.key === key) return localGantry.parts;
  if (localGantry) for (const p of localGantry.parts) p.geometry.dispose();
  localGantry = { key, parts: startGantryParts(leftOut, rightOut) };
  return localGantry.parts;
}

const scratchN = new THREE.Matrix3();
const scratchV = new THREE.Vector3();

/**
 * `src` transformed by `m`, written into `dst` if it fits and cloned if not.
 *
 * The rotation is rigid, so the normals take the plain upper 3x3 and stay unit
 * length -- no inverse transpose, and nothing to renormalise.
 */
function place(src: THREE.BufferGeometry, m: THREE.Matrix4, dst?: THREE.BufferGeometry) {
  const sp = src.getAttribute('position');
  if (!dst || dst.getAttribute('position').count !== sp.count) {
    const g = src.clone();
    g.applyMatrix4(m);
    return g;
  }
  scratchN.setFromMatrix4(m);
  const dp = dst.getAttribute('position');
  for (let i = 0; i < sp.count; i++) {
    scratchV.fromBufferAttribute(sp, i).applyMatrix4(m);
    dp.setXYZ(i, scratchV.x, scratchV.y, scratchV.z);
  }
  dp.needsUpdate = true;
  const sn = src.getAttribute('normal');
  const dn = dst.getAttribute('normal');
  if (sn && dn) {
    for (let i = 0; i < sn.count; i++) {
      scratchV.fromBufferAttribute(sn, i).applyMatrix3(scratchN);
      dn.setXYZ(i, scratchV.x, scratchV.y, scratchV.z);
    }
    dn.needsUpdate = true;
  }
  dst.computeBoundingSphere();
  dst.computeBoundingBox();
  return dst;
}

export function buildStartGantry(
  frames: Frame[],
  closed: boolean,
  road: RoadSettings,
  startS: number,
  /** Last rebuild's meshes by name, so this one can write into their buffers. */
  reuse?: Map<string, THREE.BufferGeometry>,
): MeshDef[] {
  if (frames.length < 2) return [];
  const f = frameAtFraction(frames, closed, startS);
  if (!f) return [];

  const parts = localParts(legOffset(f, road, -1), legOffset(f, road, 1));
  if (parts.length === 0) return [];

  const fwd = new THREE.Vector3(f.fwd.x, 0, f.fwd.z);
  if (fwd.lengthSq() < 1e-9) fwd.set(0, 0, 1);
  fwd.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
  const m = new THREE.Matrix4().makeBasis(right, up, fwd).setPosition(f.pos);

  return parts.map(({ geometry, material, group }) => {
    // No leading digit, so Assetto Corsa treats it as scenery and not as
    // something to drive into. See buildExport's note on the prefix.
    // The barrier in front of the legs is what a car actually hits.
    const name = group ?? `OBJ_startgantry_${material}`;
    return { name, material, surface: null, geometry: place(geometry, m, reuse?.get(name)) };
  });
}
