import * as THREE from 'three';
import type { GridSettings, PitSettings, TimingSettings } from '../types';
import type { MeshDef } from './road';
import { frameAtDistance, pathLength, type Frame } from './spline';
import { PIT_NUMBER_TILES } from './textures';

/**
 * The painted start boxes -- the white C the cars line up in on the grid.
 *
 * A grid slot used to be an invisible thing: AC_START_7 is an empty in the
 * model, so on screen there was nothing to see and on the exported circuit the
 * grid was bare tarmac. The paint is what makes a starting grid look like one,
 * and it is also the only way to see where the slots actually landed before
 * loading the track in the game.
 *
 * Pure geometry: frames and settings in, meshes out, no editor state, so it
 * can be checked headlessly like the rest of core/.
 */

/**
 * Formula 1 grid box, metres.
 *
 * `width` is the clear space between the two side lines. The FIA widened it
 * twice as the cars grew -- 2.3 m in 2022, 2.5 m early in 2023, 2.7 m from the
 * Australian GP of that year onwards, which is where it stands.
 *
 * `line` is the paint itself at the 15 cm every circuit marking is drawn at.
 *
 * `length` is the one number the FIA does not publish. Six metres is the box
 * as it reads off a grid photograph: a hair longer than the 5.6 m car it has
 * to hold. It is a slider, so a different answer is one drag away.
 */
export const F1_GRID_BOX = {
  width: 2.7,
  length: 6,
  line: 0.15,
} as const;

/**
 * Width of the yellow line and how far it sits behind the white one.
 *
 * The yellow bar across the front of the box is where the front wheels belong
 * -- the mark a driver is actually aiming at, since from inside a modern
 * cockpit the white lines beside the car cannot be seen at all.
 */
const FRONT_LINE_W = 0.15;
const FRONT_LINE_GAP = 0.3;

/**
 * The yellow line does not stop at the box: it runs on INBOARD, out of the
 * slot and across the tarmac to the centre of the circuit.
 *
 * That is what makes it usable. A driver sitting in a modern car cannot see
 * the ground beside the front wheel at all, so a mark that only exists inside
 * the box is a mark nobody can aim at; the line carries on into the middle of
 * the road, where it is still in view over the nose. On a staggered grid the
 * two columns' lines meet at the centre line and read as one bar across the
 * track.
 *
 * It is drawn a further 2 mm up, because it crosses the white side line on
 * its way out. Two coplanar quads is a z-fight; paint over paint is what the
 * circuit does anyway, the yellow going down after the white.
 */
const FRONT_LINE_OVER = 0.002;

/**
 * How far the paint floats over the tarmac.
 *
 * The same 8 mm the pit limiter line uses, and for the same reason: laid on
 * the road rather than cut out of it, because a box sits ACROSS the cross
 * sections and cutting it out would mean splitting every one it lands between.
 * Far enough off the surface to stay out of the depth buffer's way, far too
 * little for a wheel to notice -- and it carries no physics surface anyway.
 */
const LIFT = 0.008;

/** One sampled cross section of a box: where it is and how the road lies there. */
interface Cross {
  pos: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

/** Lifts a cross section a little further off the road. */
function raise(c: Cross, by: number): Cross {
  return { pos: c.pos.clone().addScaledVector(c.up, by), right: c.right, up: c.up };
}

/** Cross sections along the length of one box, so it bends with the circuit. */
const SIDE_SAMPLES = 4;

/**
 * Collects flat quads into one indexed geometry.
 *
 * Small enough to allocate outright -- twenty boxes are sixty quads, against
 * the road's tens of thousands -- so this does none of the buffer reuse the
 * road builder needs.
 */
class Paint {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];

  get empty() {
    return this.idx.length === 0;
  }

  /**
   * One quad, `a` to `b` along the paint and `0` to `1` across it.
   *
   * The winding is chosen from the normal it comes out with rather than
   * assumed: a side line runs along the road and the bar across the front runs
   * at right angles to it, and one order of corners cannot face upwards for
   * both.
   */
  quad(a0: THREE.Vector3, a1: THREE.Vector3, b0: THREE.Vector3, b1: THREE.Vector3, up: THREE.Vector3, vA: number, vB: number) {
    const n = new THREE.Vector3()
      .subVectors(a1, a0)
      .cross(new THREE.Vector3().subVectors(b0, a0));
    const flip = n.dot(up) < 0;
    const c0 = flip ? a1 : a0;
    const c1 = flip ? a0 : a1;
    const c2 = flip ? b1 : b0;
    const c3 = flip ? b0 : b1;

    const base = this.pos.length / 3;
    for (const [p, u, v] of [
      [c0, 0, vA],
      [c1, 1, vA],
      [c2, 0, vB],
      [c3, 1, vB],
    ] as Array<[THREE.Vector3, number, number]>) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(up.x, up.y, up.z);
      this.uv.push(u, v);
    }
    this.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  /**
   * One quad off a texture sheet, its corners carrying their own coordinates.
   *
   * `quad` above hands u = 0 to whichever corner ends up first, and the
   * winding flip can swap which one that is. On a line nobody can tell; on a
   * digit it is the difference between a 2 and a mirrored one, so here the
   * coordinates travel WITH their corners through the flip.
   */
  sheet(
    a0: THREE.Vector3,
    a1: THREE.Vector3,
    b0: THREE.Vector3,
    b1: THREE.Vector3,
    up: THREE.Vector3,
    uv: Array<[number, number]>,
  ) {
    const n = new THREE.Vector3()
      .subVectors(a1, a0)
      .cross(new THREE.Vector3().subVectors(b0, a0));
    const corners = [a0, a1, b0, b1];
    const order = n.dot(up) < 0 ? [1, 0, 3, 2] : [0, 1, 2, 3];
    const base = this.pos.length / 3;
    for (const k of order) {
      const p = corners[k];
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(up.x, up.y, up.z);
      this.uv.push(uv[k][0], uv[k][1]);
    }
    this.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  /** A ribbon of paint running along `crosses`, `halfWidth` either side of `x`. */
  ribbon(crosses: Cross[], x: number, halfWidth: number, vScale: number) {
    for (let i = 0; i < crosses.length - 1; i++) {
      const a = crosses[i];
      const b = crosses[i + 1];
      this.quad(
        a.pos.clone().addScaledVector(a.right, x - halfWidth),
        a.pos.clone().addScaledVector(a.right, x + halfWidth),
        b.pos.clone().addScaledVector(b.right, x - halfWidth),
        b.pos.clone().addScaledVector(b.right, x + halfWidth),
        a.up,
        (i * vScale) / (crosses.length - 1),
        ((i + 1) * vScale) / (crosses.length - 1),
      );
    }
  }

  /** A bar across the box, between two cross sections, `x0` to `x1` wide. */
  bar(a: Cross, b: Cross, x0: number, x1: number) {
    this.quad(
      a.pos.clone().addScaledVector(a.right, x0),
      b.pos.clone().addScaledVector(b.right, x0),
      a.pos.clone().addScaledVector(a.right, x1),
      b.pos.clone().addScaledVector(b.right, x1),
      a.up,
      0,
      1,
    );
  }

  finish(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const Y = new THREE.Vector3(0, 1, 0);

/**
 * Where one box's cross section `z` metres ahead of the slot sits.
 *
 * A slot that has not been moved by hand is read off the circuit itself, so
 * the paint banks and bends with the road the same way the kerbs do. One that
 * HAS been moved has no arc length any more -- it is a point and a heading --
 * so its box is flat and straight, which is what a hand placed slot is.
 */
function crossFn(
  frames: Frame[],
  closed: boolean,
  slotDist: number,
  lateral: number,
  override: { p: [number, number, number]; rot: number } | undefined,
): (z: number) => Cross {
  if (override) {
    const yaw = THREE.MathUtils.degToRad(override.rot);
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3().crossVectors(fwd, Y).normalize();
    const origin = new THREE.Vector3(override.p[0], override.p[1] + LIFT, override.p[2]);
    return (z) => ({
      pos: origin.clone().addScaledVector(fwd, z),
      right: right.clone(),
      up: Y.clone(),
    });
  }
  return (z) => {
    const f = frameAtDistance(frames, closed, slotDist + z);
    return {
      pos: f.pos.clone().addScaledVector(f.right, lateral).addScaledVector(f.up, LIFT),
      right: f.right.clone(),
      up: f.up.clone(),
    };
  };
}

/**
 * The white boxes and, when asked for, the yellow front wheel bars.
 *
 * Two meshes rather than one per slot: the whole grid is a few hundred
 * triangles and a mesh apiece would be forty draw calls and forty objects in
 * the exported model for something a driver reads as one marking.
 *
 * Named with NO LEADING DIGIT, and that is the whole of what keeps it out of
 * the physics.
 *
 * These were called 1OBJ_grid_box, on the theory that a mesh is physical only
 * when its name past the first character matches a surfaces.ini KEY -- which
 * is what this editor's own surfaces.ini says, and which is wrong. They were
 * felt through the wheel driving over them: two strips of solid geometry 8 and
 * 10 mm proud of the racing line, laid across the grid where every car of the
 * field crosses them off the lights.
 *
 * What real tracks do, read out of their kn5s: magione floats its racing
 * groove 10 to 25 mm over the tarmac -- HIGHER than this paint ever was -- and
 * calls the meshes `groove`, `groove2`, `groove3`. fn_imola's road paint is
 * `imola-Object76412`. Across both tracks every overlay lying on the road
 * starts with a letter, and every mesh that starts with a digit is a surface.
 * The height was never the problem; the digit was.
 */
export function buildGridBoxes(
  frames: Frame[],
  closed: boolean,
  timing: TimingSettings,
  grid: GridSettings,
): MeshDef[] {
  if (!grid.boxes || grid.count < 1) return [];
  if (frames.length < 2 && Object.keys(grid.overrides).length === 0) return [];

  const width = Math.max(0.5, grid.boxWidth);
  const length = Math.max(1, grid.boxLength);
  const line = F1_GRID_BOX.line;
  const total = frames.length >= 2 ? pathLength(frames, closed) : 0;
  const lineDist = timing.startS * total;

  const white = new Paint();
  const yellow = new Paint();

  for (let i = 0; i < grid.count; i++) {
    const override = grid.overrides[i];
    if (!override && frames.length < 2) continue;
    const back = grid.poleBack + i * grid.rowSpacing;
    const side = grid.stagger ? (i % 2 === 0 ? -1 : 1) : 0;
    const at = crossFn(frames, closed, lineDist - back, side * grid.lateralOffset, override);

    const front = length / 2;
    const rear = -length / 2;
    // The side lines sit OUTSIDE the clear width, so the box measures 2.7 m
    // between the paint rather than across it -- the way a parking bay does,
    // and the way the number a driver is given has to be read.
    const edge = width / 2 + line / 2;

    const crosses: Cross[] = [];
    for (let k = 0; k <= SIDE_SAMPLES; k++) {
      crosses.push(at(rear + (length * k) / SIDE_SAMPLES));
    }
    white.ribbon(crosses, -edge, line / 2, length / 2);
    white.ribbon(crosses, edge, line / 2, length / 2);

    // The bar across the front, corner to corner of the side lines. The rear
    // stays open: a real grid box is a C, so a car can be rolled into it.
    white.bar(at(front - line), at(front), -(edge + line / 2), edge + line / 2);

    if (grid.boxFrontLine) {
      const y1 = front - line - FRONT_LINE_GAP;
      const y0 = y1 - FRONT_LINE_W;
      /* Across the slot, and on out to the centre of the circuit.
         The slot sits `lateral` metres off the centre line, so in the box's
         own frame the centre line is at minus that -- and on a grid that is
         not staggered it falls inside the box, where there is nothing to
         reach for and the bar is simply the width of the slot. */
      const centre = -side * grid.lateralOffset;
      const half = width / 2;
      const x0 = Math.min(-half, centre);
      const x1 = Math.max(half, centre);
      if (y0 > rear) {
        yellow.bar(raise(at(y0), FRONT_LINE_OVER), raise(at(y1), FRONT_LINE_OVER), x0, x1);
      }
    }
  }

  const out: MeshDef[] = [];
  if (!white.empty) {
    out.push({ name: 'OBJ_grid_box', material: 'line_white', surface: null, geometry: white.finish(), castShadows: false });
  }
  if (!yellow.empty) {
    out.push({ name: 'OBJ_grid_front_line', material: 'line_yellow', surface: null, geometry: yellow.finish(), castShadows: false });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The pit stalls                                                      */
/* ------------------------------------------------------------------ */

/**
 * The paint in front of each garage, and how it differs from a grid box.
 *
 * A grid box is a slot a car lines up IN: 2.7 m of clear width, six metres
 * long, pointing down the road, and open at the back so the car can be rolled
 * into it. A pit stall is the opposite shape. It is the working area in front
 * of one garage, so it is as wide as the garage frontage -- the spacing
 * between two boxes -- and only as deep as the working lane, and it lies
 * ACROSS the lane rather than along it.
 *
 * It is open towards the fast lane, which is what a real one does. The lane's
 * own edge line is already painted along that side, and a second line laid on
 * top of it would be two coplanar quads fighting over the same pixels; on the
 * circuits this is drawn off, the boundary a driver reads on that side IS the
 * lane line. So the stall is drawn as its two dividers and the line along the
 * back of it, and the fast lane closes the shape.
 */
export const PIT_BOX = {
  /** Pit lane markings are drawn thinner than the 15 cm of a grid box. */
  line: 0.12,
  /** Bare concrete left between two stalls, metres. */
  gap: 1.2,
  /** A stall may not come out shallower than this across the lane. */
  minDepth: 3,
  /**
   * Painted number: how tall one digit stands, metres.
   *
   * Sized to fit BEHIND the car rather than under it. The stall is only as
   * deep as the working lane, a car is 1.9 m wide across the middle of it, and
   * what is left between the car and the line along the back is about a metre:
   * a taller digit reads better right up to the moment a car parks on it,
   * which is the moment somebody wants to read the number.
   */
  digit: 0.7,
  /** And how wide it is. Narrower than it is tall, the way a road number is. */
  digitWidth: 0.44,
  /** Clear concrete between the number and the line along the back. */
  digitInset: 0.15,
} as const;

/**
 * The painted stalls, one mesh for the whole pit lane.
 *
 * Named with NO LEADING DIGIT, the same as the grid paint and for the same
 * reason: the digit is what hands a mesh to the physics, and this is paint. A
 * car stops on it every time it comes in.
 */
export function buildPitBoxes(
  pitFrames: Frame[],
  pitClosed: boolean,
  cfg: PitSettings,
): MeshDef[] {
  if (cfg.boxPaint === false || cfg.boxCount < 1) return [];
  if (pitFrames.length < 2 && Object.keys(cfg.overrides).length === 0) return [];

  const line = PIT_BOX.line;
  // As wide as the garage it stands in front of, less the gap that keeps two
  // neighbouring stalls from reading as one long rectangle.
  const length = Math.min(Math.max(cfg.boxSpacing - PIT_BOX.gap, PIT_BOX.minDepth), 16);
  const dir = cfg.boxSide;
  /* Across the working lane, measured from the box centre the car stops on:
     the near edge is where the fast lane ends, the far edge is where the
     concrete does. Both fall out of the lane's own three numbers, so a wider
     apron or a box moved further out repaints itself. */
  const lane = dir * (cfg.width - cfg.boxOffset);
  const garage = dir * (cfg.width + cfg.apron - cfg.boxOffset);
  const short = Math.max(0, PIT_BOX.minDepth - Math.abs(garage - lane)) / 2;
  const near = lane - Math.sign(lane - garage) * short;
  const far = garage + Math.sign(garage - lane) * short;
  const lo = Math.min(near, far);
  const hi = Math.max(near, far);
  /* The line along the back is laid just INSIDE the edge it marks, not
     centred on it. Centred, half of it hangs over the end of the concrete and
     lies on grass -- 6 cm of it, the length of the pit lane. */
  const back = far - Math.sign(far - near) * (line / 2);

  const white = new Paint();
  const numbers = new Paint();
  for (let i = 0; i < cfg.boxCount; i++) {
    const override = cfg.overrides[i];
    if (!override && pitFrames.length < 2) continue;
    const at = crossFn(
      pitFrames,
      pitClosed,
      cfg.startDist + i * cfg.boxSpacing,
      dir * cfg.boxOffset,
      override,
    );
    const front = length / 2;
    const rear = -length / 2;

    // The two dividers between this stall and its neighbours, edge to edge of
    // the working lane. They reach the line along the back, which lies inside
    // them, so all three corners close.
    white.bar(at(rear), at(rear + line), lo, hi);
    white.bar(at(front - line), at(front), lo, hi);

    // The line along the back of the stall, sampled so it bends with the lane.
    const crosses: Cross[] = [];
    for (let k = 0; k <= SIDE_SAMPLES; k++) {
      crosses.push(at(rear + (length * k) / SIDE_SAMPLES));
    }
    white.ribbon(crosses, back, line / 2, length / 2);

    /*
     * The number, painted at the back of the stall.
     *
     * At the BACK, against the garage, because that is the one part of the
     * box a car does not stand on: painted in the middle it would be under
     * the floor of the car it belongs to for the whole of a pit stop, which
     * is exactly when somebody needs to read it.
     *
     * Laid to be read from the fast lane looking in, so the tops of the
     * digits point at the garage. Drawn off one flat frame rather than
     * followed round the lane: a number is a metre long and no pit lane bends
     * enough over a metre for it to matter, and a digit that bends is a digit
     * that reads as broken.
     */
    const label = String(i + 1);
    const mid = at(0);
    const toGarage = mid.right.clone().multiplyScalar(dir);
    // Reading direction, for someone standing in the lane facing the garage.
    const read = new THREE.Vector3().crossVectors(toGarage, mid.up).normalize();
    const depthOut = cfg.width + cfg.apron - cfg.boxOffset + short;
    const centre = mid.pos
      .clone()
      .addScaledVector(toGarage, depthOut - line - PIT_BOX.digitInset - PIT_BOX.digit / 2);
    const w = PIT_BOX.digitWidth;
    const h = PIT_BOX.digit;
    for (let k = 0; k < label.length; k++) {
      const d = label.charCodeAt(k) - 48;
      const col = d % PIT_NUMBER_TILES;
      const row = (d / PIT_NUMBER_TILES) | 0;
      const u0 = col / PIT_NUMBER_TILES;
      const u1 = (col + 1) / PIT_NUMBER_TILES;
      // V runs up from the bottom of the texture, the tile grid reads down
      // from the top -- the same flip the sign boards do.
      const v0 = (PIT_NUMBER_TILES - 1 - row) / PIT_NUMBER_TILES;
      const v1 = (PIT_NUMBER_TILES - row) / PIT_NUMBER_TILES;
      const x = (k - (label.length - 1) / 2) * w;
      const at2 = (dx: number, dy: number) =>
        centre.clone().addScaledVector(read, x + dx).addScaledVector(toGarage, dy);
      numbers.sheet(
        at2(-w / 2, -h / 2),
        at2(w / 2, -h / 2),
        at2(-w / 2, h / 2),
        at2(w / 2, h / 2),
        mid.up,
        [[u0, v0], [u1, v0], [u0, v1], [u1, v1]],
      );
    }
  }

  const out: MeshDef[] = [];
  if (!white.empty) {
    out.push({
      name: 'OBJ_pit_box',
      material: 'line_white',
      surface: null,
      geometry: white.finish(),
      castShadows: false,
    });
  }
  if (!numbers.empty) {
    out.push({
      name: 'OBJ_pit_box_number',
      material: 'pit_number',
      surface: null,
      geometry: numbers.finish(),
      castShadows: false,
    });
  }
  return out;
}
