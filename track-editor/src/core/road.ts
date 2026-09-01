import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ApronColour, DecoSurface, KerbSpan, KerbStyle, RoadSettings, SurfaceKey } from '../types';
import { INNER_LIMIT, pathLength, type Frame } from './spline';
import { spanExtent, spanMetres, spanPieces, type Piece } from './kerbs';
import { PointIndex } from './spatial';
import { PIT_APRON, type PitClip, type PitTrackLine } from './pitLink';

/**
 * A single named mesh, ready for both the viewport and the exporter.
 * Geometry is always in WORLD space, which keeps the FBX flat and removes a
 * whole class of transform bugs in the ksEditor import.
 */
export interface MeshDef {
  /** Final mesh name, already AC conform, e.g. "1ROAD_track". */
  name: string;
  /** Material name, becomes an FBX material and a texture reference. */
  material: MaterialKey;
  /** Physical surface, or null for a purely visual mesh. */
  surface: SurfaceKey | null;
  geometry: THREE.BufferGeometry;
  /** Default true. Flat ground patches switch it off to avoid shadow acne. */
  castShadows?: boolean;
  /**
   * One entry per `geometry.groups` entry, when the mesh is drawn in several
   * passes with a material each. The painted terrain is the only thing that
   * does this: one geometry, one run of triangles per ground material. The
   * exporter splits it back into a mesh per entry, because Assetto Corsa reads
   * the surface off the name.
   */
  groups?: Array<{ name: string; material: MaterialKey; surface: SurfaceKey }>;
}

export type MaterialKey =
  /* textured track materials */
  | 'asphalt'
  | 'kerb'
  | 'grass'
  | 'sand'
  | 'concrete'
  /* Armco: the stacked steel beams a barrier is really made of */
  | 'guardrail'
  /* The same beams painted safety orange: the tips either side of a gate */
  | 'guardrail_orange'
  | 'terrain'
  /* flat colour materials used by the prop library */
  | 'prop_dark'
  | 'prop_light'
  | 'prop_metal'
  | 'prop_red'
  | 'prop_white'
  | 'prop_green'
  | 'prop_darkgreen'
  | 'prop_wood'
  | 'prop_glass'
  | 'prop_yellow'
  | 'prop_blue'
  /* The one texture with holes in it: alpha tested, so you can see through it */
  | 'chainlink'
  /* Blades of grass on a clear background, for the scattered tufts */
  | 'grass_blades'
  /* Four cut out trees on one sheet, picked between by UV. See TREE_CARDS. */
  | 'tree_card'
  /* Four braking boards on one sheet, picked between by UV. See signTile(). */
  | 'sign_board'
  /* The lamp wall of a marshalling panel, colourless: Custom Shaders Patch
     paints it from the session flag. See extConfigIni() in export/ini.ts. */
  | 'led_flag'
  /* The lenses of the start lights. Lit red, and put out by the green flag --
     again through the patch, see extConfigIni(). */
  | 'led_start'
  /* The chequered band along the start gantry's beam. */
  | 'start_banner'
  /* Track markings and the coloured tarmac at the edge of a circuit */
  | 'line_white'
  /* The same paint in dashes, for the stretch where the pit lane merges */
  | 'line_dashed'
  /* The yellow bar across the front of a start box */
  | 'line_yellow'
  | 'pit_number'
  | 'asphalt_green'
  | 'asphalt_blue'
  | 'asphalt_red';

/** Which material a kerb span's coloured strip is drawn with. */
export const APRON_MATERIAL: Record<ApronColour, MaterialKey> = {
  grey: 'concrete',
  green: 'asphalt_green',
  blue: 'asphalt_blue',
  red: 'asphalt_red',
};

/**
 * Metres of circuit per dash-and-gap of the merge line.
 *
 * The dashes come from the texture, not from cutting the strip into pieces:
 * one tile of line_dashed is one dash plus one gap, so this is simply the V
 * scale. Real geometry could not do it -- the road is drawn from the track's
 * own cross sections, and on a five kilometre lap those are fourteen metres
 * apart, which is longer than a whole dash.
 */
const PIT_DASH = 6;

/**
 * The edge-line dashes stop this far short of each end of a junction mouth:
 * at the handover there is still concrete beside the lane, and the last
 * metres of the wedge are a hairline sliver, so dashes over the full span
 * read as starting before the pit asphalt and ending after it.
 */
const MOUTH_DASH_TRIM = 6;

/**
 * The pit exit's boundary line on the racing surface, metres: how far it
 * leans in from the edge, how far it then runs, and the width of the lane it
 * marks off. It starts where the exit wedge has fully merged.
 */
const EXIT_LINE_RAMP = 30;
const EXIT_LINE_RUN = 110;
const EXIT_LINE_LANE = 4;

const DOWN = new THREE.Vector3(0, -1, 0);
/** Hoisted: this used to be an array literal built once per cross section. */
const SIDES = [-1, 1] as const;

const KERB_REPEAT = 4; // metres per red/white texture cycle

/**
 * Working arrays for one road rebuild, kept between calls.
 *
 * Building the road allocated several arrays of vectors and numbers per cross
 * section every time, and it is rebuilt on every frame of a drag. Reusing them
 * is safe because a rebuild is synchronous and never re-entered, and it takes a
 * few hundred kilobytes per frame out of the garbage collector's way.
 */
const scratch = {
  size: 0,
  left: [] as THREE.Vector3[],
  right: [] as THREE.Vector3[],
  top: [] as THREE.Vector3[],
  edgeL: [] as THREE.Vector3[],
  edgeR: [] as THREE.Vector3[],
  apronEL: [] as THREE.Vector3[],
  apronER: [] as THREE.Vector3[],
  outerL: [] as THREE.Vector3[],
  outerR: [] as THREE.Vector3[],
  lineL: [] as THREE.Vector3[],
  lineR: [] as THREE.Vector3[],
  wallBase: [] as THREE.Vector3[],
  wallMid: [] as THREE.Vector3[],
  wallTip: [] as THREE.Vector3[],
  /* The same four rings again for the length of barrier standing BEHIND an
     access gate. Its own set because both runs exist at the same cross
     sections -- that overlap is the whole point of a gate. */
  gateBase: [] as THREE.Vector3[],
  gateMid: [] as THREE.Vector3[],
  gateTop: [] as THREE.Vector3[],
  gateTip: [] as THREE.Vector3[],
  /** Where the set-back run's sections are moving to, before any is moved:
      each one is interpolated from the ring the write would overwrite. */
  gateTmp: [] as THREE.Vector3[],
  /** Along-the-run texture coordinate of the set-back barrier, which is its
      own: two of its cross sections stand somewhere else than the front run's
      do, so they cannot share one ring of numbers. */
  gateV: [] as number[],
  /* The two rings of a single fold of the guardrail, refilled per fold. */
  wallLo: [] as THREE.Vector3[],
  wallHi: [] as THREE.Vector3[],
  v: [] as number[],
  zeros: [] as number[],
  ones: [] as number[],
  uA: [] as number[],
  uB: [] as number[],
  awL: [] as number[],
  /** Drawn width of the lane surface itself, per cross section. */
  lane: [] as number[],
  /** Width of the painted pit line on each side, per cross section. */
  lineWL: [] as number[],
  lineWR: [] as number[],
  /* The band the pit junction's paint takes out of the road surface. Its own
     buffers: computeEdges hands its results back as references into this same
     scratch, so borrowing the kerb apron's arrays here quietly rewrote the
     apron -- which then drew itself across the middle of the circuit. */
  cutA: [] as THREE.Vector3[],
  cutB: [] as THREE.Vector3[],
  uCutA: [] as number[],
  uCutB: [] as number[],
  paint: [] as number[],
  dash: [] as number[],
  vDash: [] as number[],
  awR: [] as number[],
};

function takeScratch(n: number) {
  if (scratch.size < n) {
    for (const key of ['left', 'right', 'top', 'edgeL', 'edgeR', 'apronEL', 'apronER', 'outerL', 'outerR', 'lineL', 'lineR', 'cutA', 'cutB', 'wallBase', 'wallMid', 'wallTip', 'gateBase', 'gateMid', 'gateTop', 'gateTip', 'gateTmp', 'wallLo', 'wallHi'] as const) {
      const arr = scratch[key];
      while (arr.length < n) arr.push(new THREE.Vector3());
    }
    for (const key of ['v', 'gateV', 'zeros', 'ones', 'uA', 'uB', 'uCutA', 'uCutB', 'awL', 'awR', 'lane', 'lineWL', 'lineWR', 'paint', 'dash', 'vDash'] as const) {
      const arr = scratch[key];
      while (arr.length < n) arr.push(0);
    }
    scratch.size = n;
  }
  for (let i = 0; i < n; i++) {
    scratch.zeros[i] = 0;
    scratch.ones[i] = 1;
  }
  return scratch;
}

/*
 * The run off strip's own scratch, sized by its STATIONS rather than by the
 * cross sections: the strip is subdivided along the track wherever the paint
 * is finer than the plates, so its rings can outnumber every other ring in
 * this file. Kept apart from the main scratch so growing it does not grow two
 * dozen arrays nothing else needs at that length.
 */
const runoffScratch = {
  size: 0,
  /* The inner and outer edge of one band across the run off, refilled per
     band. The strip is split across its width so the ground brush can change
     what it is made of part way over, not only from one station to the next. */
  bandI: [] as THREE.Vector3[],
  bandO: [] as THREE.Vector3[],
  v: [] as number[],
  uA: [] as number[],
  uB: [] as number[],
  /** Interpolated run off width at each station. */
  w: [] as number[],
};

function takeRunoffScratch(m: number) {
  if (runoffScratch.size < m) {
    for (const key of ['bandI', 'bandO'] as const) {
      const arr = runoffScratch[key];
      while (arr.length < m) arr.push(new THREE.Vector3());
    }
    for (const key of ['v', 'uA', 'uB', 'w'] as const) {
      const arr = runoffScratch[key];
      while (arr.length < m) arr.push(0);
    }
    runoffScratch.size = m;
  }
  return runoffScratch;
}

/* Station interpolation temporaries, so laying a band allocates nothing. */
const tmpBandIn = new THREE.Vector3();
const tmpBandOut = new THREE.Vector3();

/* The four corner nodes of one cut cell, and the ring being fanned out of it.
   Preallocated: cut cells are visited once per material on every rebuild of a
   drag, and a ring is never more than six points. */
const cutC0 = new THREE.Vector3();
const cutC1 = new THREE.Vector3();
const cutC2 = new THREE.Vector3();
const cutC3 = new THREE.Vector3();
const fanX = new Array<number>(8).fill(0);
const fanY = new Array<number>(8).fill(0);
const fanZ = new Array<number>(8).fill(0);
const fanU = new Array<number>(8).fill(0);
const fanV = new Array<number>(8).fill(0);

/** Repeats the first frame at the end so closed loops have no visible seam. */
function expand(frames: Frame[], closed: boolean): Frame[] {
  if (!closed || frames.length < 3) return frames;
  const first = frames[0];
  const last = frames[frames.length - 1];
  const total = last.dist + last.pos.distanceTo(first.pos);
  return [...frames, { ...first, dist: total }];
}

/**
 * Builds one merged strip mesh, writing straight into the buffers of the
 * geometry it is replacing.
 *
 * The road is rebuilt on every frame of a drag. Building it out of temporary
 * per stretch geometries and then copying those into the real one allocated a
 * couple of hundred kilobytes each time and threw it away again, which on this
 * hot a path is enough on its own to keep the browser collecting garbage
 * several times a second. Given the previous geometry, this writes into it and
 * allocates nothing at all.
 */
class StripBuilder {
  private geo: THREE.BufferGeometry | null = null;
  private wanted: THREE.BufferGeometry | undefined;
  private maxVerts: number;
  reused = false;
  private pos!: Float32Array;
  private nor!: Float32Array;
  private uv!: Float32Array;
  private idx!: Uint16Array | Uint32Array;
  private capacity = 0;
  private v = 0;
  private i = 0;

  /*
   * Nothing is allocated until the first strip actually arrives.
   *
   * Most of these come out empty on any given rebuild -- the kerb on a side
   * that has none, the coloured strip nobody asked for, the run off squeezed to
   * nothing beside the pit lane -- and allocating their full capacity only to
   * throw it away was three buffers of a hundred kilobytes or so per rebuild,
   * sixty times a second during a drag. Garbage on that scale is what a major
   * collection is made of, and a major collection is what a freeze is made of.
   */
  constructor(existing: THREE.BufferGeometry | undefined, capacityVerts: number) {
    this.wanted = existing;
    this.maxVerts = Math.max(2, capacityVerts);
  }

  /** The geometry, allocated on demand. Only ever called once anything is drawn. */
  private ensure() {
    if (this.geo) return;
    const existing = this.wanted;
    const maxVerts = this.maxVerts;
    const maxIndices = Math.max(6, (maxVerts / 2 - 1) * 6);
    const fits =
      existing &&
      existing.getAttribute('position')?.count === maxVerts &&
      existing.getIndex()?.count === maxIndices;

    if (fits && existing) {
      this.geo = existing;
      this.reused = true;
      this.pos = existing.getAttribute('position').array as Float32Array;
      this.nor = existing.getAttribute('normal').array as Float32Array;
      this.uv = existing.getAttribute('uv').array as Float32Array;
      this.idx = existing.getIndex()!.array as Uint16Array | Uint32Array;
    } else {
      const g = new THREE.BufferGeometry();
      this.geo = g;
      this.reused = false;
      this.pos = new Float32Array(maxVerts * 3);
      this.nor = new Float32Array(maxVerts * 3);
      this.uv = new Float32Array(maxVerts * 2);
      this.idx = maxVerts > 65535 ? new Uint32Array(maxIndices) : new Uint16Array(maxIndices);
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
      g.setIndex(new THREE.BufferAttribute(this.idx, 1));
    }
    this.capacity = maxVerts;
    this.nor.fill(0);
  }

  /**
   * Append one stretch. Winding is chosen so the face normal points up for a
   * horizontal strip where `left` is on the -right side of the road.
   *
   * `cols` cuts the strip lengthwise into that many quads side by side, all of
   * them on the straight line between the two rails, so the surface is exactly
   * the one a single quad spans -- only resolved across as well as along. It
   * is what a twisted plate needs: see `twistColumns`. At 1, which is what
   * every flat strip asks for, this writes byte for byte what it always did.
   */
  addStrip(
    left: THREE.Vector3[],
    right: THREE.Vector3[],
    uLeft: number[],
    uRight: number[],
    v: number[],
    // Always explicit: the arrays handed in are shared scratch buffers that can
    // be longer than the number of cross sections, so their length means nothing.
    from: number,
    to: number,
    cols = 1,
  ) {
    const n = Math.min(to, left.length - 1, right.length - 1) - from + 1;
    if (n < 2) return;
    this.ensure();
    const c = Math.max(1, cols);
    if (this.v + n * 2 * c > this.capacity) return;

    for (let col = 0; col < c; col++) {
      // Neighbouring columns repeat the rail between them rather than sharing
      // it. The two copies are computed from the same two ends by the same
      // expression, so they are the same float and the seam cannot open; a
      // shared column would save a vertex per station and cost the strip its
      // one flat index layout.
      const t0 = col / c;
      const t1 = (col + 1) / c;
      /* The outermost rails are COPIED, never interpolated. `l + (r - l) * 1`
         is not `r` in floating point, and this strip's outer rail is the one
         the kerb beside it, or the strip before it, was built from: a rail
         that misses by an ulp is a hairline crack that runs the length of the
         circuit. Only the rails invented in between may be computed. */
      const atL = col === 0;
      const atR = col === c - 1;
      const base = this.v;
      for (let k = 0; k < n; k++) {
        const s = from + k;
        const l = left[s];
        const r = right[s];
        const a = (base + k * 2) * 3;
        this.pos[a + 0] = atL ? l.x : l.x + (r.x - l.x) * t0;
        this.pos[a + 1] = atL ? l.y : l.y + (r.y - l.y) * t0;
        this.pos[a + 2] = atL ? l.z : l.z + (r.z - l.z) * t0;
        this.pos[a + 3] = atR ? r.x : l.x + (r.x - l.x) * t1;
        this.pos[a + 4] = atR ? r.y : l.y + (r.y - l.y) * t1;
        this.pos[a + 5] = atR ? r.z : l.z + (r.z - l.z) * t1;
        const b = (base + k * 2) * 2;
        this.uv[b + 0] = atL ? uLeft[s] : uLeft[s] + (uRight[s] - uLeft[s]) * t0;
        this.uv[b + 1] = v[s];
        this.uv[b + 2] = atR ? uRight[s] : uLeft[s] + (uRight[s] - uLeft[s]) * t1;
        this.uv[b + 3] = v[s];
      }

      for (let k = 0; k < n - 1; k++) {
        const a = base + k * 2;
        this.idx[this.i++] = a;
        this.idx[this.i++] = a + 1;
        this.idx[this.i++] = a + 2;
        this.idx[this.i++] = a + 1;
        this.idx[this.i++] = a + 3;
        this.idx[this.i++] = a + 2;
        this.accumulate(a, a + 1, a + 2);
        this.accumulate(a + 1, a + 3, a + 2);
      }
      this.v += n * 2;
    }
  }

  /**
   * One convex polygon, fanned from its first point.
   *
   * For the pieces a cut cell of the run off keeps: they are rings, not pairs
   * of rails, so addStrip cannot draw them. Winding is fixed here by the ring's
   * signed area in the ground plane, because the cutter hands rings back in
   * its own parameter order and which way that faces in the world depends on
   * which side of the road the strip is on.
   */
  addFan(
    px: number[],
    py: number[],
    pz: number[],
    us: number[],
    vs: number[],
    count: number,
  ) {
    if (count < 3) return;
    this.ensure();
    if (this.v + count > this.capacity) return;
    if (this.i + (count - 2) * 3 > this.idx.length) return;

    // Shoelace in the ground plane: positive means the computed face normal
    // would point down, so the ring is written reversed.
    let area = 0;
    for (let k = 0; k < count; k++) {
      const j = (k + 1) % count;
      area += px[k] * pz[j] - px[j] * pz[k];
    }
    const flip = area > 0;

    const base = this.v;
    for (let k = 0; k < count; k++) {
      const s = flip ? count - 1 - k : k;
      const a = (base + k) * 3;
      this.pos[a + 0] = px[s];
      this.pos[a + 1] = py[s];
      this.pos[a + 2] = pz[s];
      const b = (base + k) * 2;
      this.uv[b + 0] = us[s];
      this.uv[b + 1] = vs[s];
    }
    for (let k = 1; k < count - 1; k++) {
      this.idx[this.i++] = base;
      this.idx[this.i++] = base + k;
      this.idx[this.i++] = base + k + 1;
      this.accumulate(base, base + k, base + k + 1);
    }
    this.v += count;
  }

  /** Face normal of one triangle, added to each of its three vertices. */
  private accumulate(ia: number, ib: number, ic: number) {
    const p = this.pos;
    const ax = p[ia * 3], ay = p[ia * 3 + 1], az = p[ia * 3 + 2];
    const bx = p[ib * 3] - ax, by = p[ib * 3 + 1] - ay, bz = p[ib * 3 + 2] - az;
    const cx = p[ic * 3] - ax, cy = p[ic * 3 + 1] - ay, cz = p[ic * 3 + 2] - az;
    const nx = by * cz - bz * cy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cy - by * cx;
    const n = this.nor;
    n[ia * 3] += nx; n[ia * 3 + 1] += ny; n[ia * 3 + 2] += nz;
    n[ib * 3] += nx; n[ib * 3 + 1] += ny; n[ib * 3 + 2] += nz;
    n[ic * 3] += nx; n[ic * 3 + 1] += ny; n[ic * 3 + 2] += nz;
  }

  get empty() {
    return this.v === 0;
  }

  /**
   * Nothing was drawn. Free whatever was taken -- which, thanks to the lazy
   * allocation above, is usually nothing at all.
   */
  discard() {
    if (this.geo && !this.reused) this.geo.dispose();
    this.geo = null;
  }

  finish(): THREE.BufferGeometry {
    this.ensure();
    for (let k = 0; k < this.v; k++) {
      const a = k * 3;
      const len = Math.hypot(this.nor[a], this.nor[a + 1], this.nor[a + 2]);
      if (len > 1e-9) {
        this.nor[a] /= len;
        this.nor[a + 1] /= len;
        this.nor[a + 2] /= len;
      } else {
        this.nor[a] = 0;
        this.nor[a + 1] = 1;
        this.nor[a + 2] = 0;
      }
    }
    // Park spare vertices on a used one so they cannot stretch the bounds, and
    // blank the spare indices so nothing stale is ever drawn.
    for (let k = this.v; k < this.capacity; k++) {
      this.pos[k * 3] = this.pos[0];
      this.pos[k * 3 + 1] = this.pos[1];
      this.pos[k * 3 + 2] = this.pos[2];
      this.nor[k * 3 + 1] = 1;
    }
    for (let k = this.i; k < this.idx.length; k++) this.idx[k] = 0;

    const g = this.geo!;
    g.setDrawRange(0, this.i);
    if (this.reused) {
      (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
      g.getIndex()!.needsUpdate = true;
    }
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Catch fence proportions, metres.
 *
 * Taken off the prop of the same name so the generated barrier and a hand
 * placed `fence` module read as the same thing: a solid base you could touch,
 * mesh above it, and the top angled back over the circuit. The lean is what
 * makes the silhouette recognisable -- without it a tall barrier is just a
 * wall, which is exactly what it used to be.
 */
const FENCE_BASE = 1.0;
const FENCE_LEAN_OUT = 0.8;
const FENCE_LEAN_UP = 1.2;

/**
 * The cross section of ONE rail of that base: [fraction of the rail, how much
 * of the full depth]. Metres out come from GUARDRAIL_OUT.
 *
 * The base is not a wall. What stands at the foot of a catch fence -- and what
 * a plain barrier at a circuit is on its own -- is armco: W section steel
 * beams stacked one above the other on posts behind them. The flat slab this
 * used to be read as a concrete kerb with a fence on top, which is a different
 * piece of circuit furniture altogether.
 *
 * Out is towards the TRACK, so the foot stays exactly where the old slab's did
 * -- the barrier tool paints a line and switching the style must not move it --
 * and the beams stand proud of it the way they hang off the front of a post.
 * The two ends come back to the post line, so consecutive rails meet in a
 * notch: that dark line between the beams is most of what says "three of them"
 * from a distance.
 *
 * Three folds a rail and no more. The crease along the middle of each beam is
 * painted into the `guardrail` tile rather than folded, because a barrier is
 * built for the whole lap on both sides and every fold here is another few
 * thousand triangles. Sharp edges come free -- each fold is its own pair of
 * vertex rows, so no normal is ever averaged across one.
 */
const GUARDRAIL_FOLD: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [0.09, 1.0],
  [0.91, 1.0],
  [1.0, 0.0],
];

/** How far a beam stands out from the post line, metres. */
const GUARDRAIL_OUT = 0.07;

/**
 * Height of one W beam, metres, and the most that may be stacked.
 *
 * A real beam is about a third of a metre, which is why the 1 m base of a
 * catch fence comes out as exactly the three everyone recognises. The count is
 * rounded from the height rather than fixed, so a low barrier is one or two
 * beams instead of three squashed ones -- and the cap is there because the
 * height slider goes to 3 m and thirty folds a side is a lot of triangles for
 * a barrier nobody builds that tall.
 */
const RAIL_HEIGHT = 0.33;
const RAIL_MAX = 6;

/** How many beams a base of `h` metres is stacked out of. */
export function railCount(h: number): number {
  return Math.max(1, Math.min(RAIL_MAX, Math.round(h / RAIL_HEIGHT)));
}

/** Metres of barrier per texture repeat, the same on both axes. */
const FENCE_UV = 4;

/**
 * Metres between two fence posts, matching the hand placed `fence` module's
 * five posts per 8 m. The generated fence used to be mesh alone -- a curtain
 * hanging on nothing -- while the module beside it had posts and leaning
 * arms, and the two never read as the same product until both got them.
 */
const FENCE_POST_SPACING = 1.97;

/** Least clear ground a barrier needs beside the road before it is dropped. */
const MIN_WALL_ROOM = 0.8;

/**
 * Shortest run of barrier worth building beside an opening, metres.
 *
 * Half a module. Below that it is not a barrier, it is a piece of one left
 * behind between two gaps.
 */
const MIN_BARRIER_PIECE = 4;

/**
 * A cut's curve parameters as one or two plain ranges.
 *
 * A span whose `from` is past its `to` runs across the start/finish seam, the
 * same convention a kerb span uses, and that is two ranges rather than one.
 */
export function cutRanges(from: number, to: number, closed: boolean): Array<[number, number]> {
  const a = Math.max(0, Math.min(1, from));
  const b = Math.max(0, Math.min(1, to));
  if (a <= b) return b - a > 1e-6 ? [[a, b]] : [];
  return closed ? [[a, 1], [0, b]] : [[b, a]];
}

/**
 * Metres of lap at a curve parameter, read off the cross sections.
 *
 * The seam needs care. `expand` closes a loop by repeating its FIRST cross
 * section at the end, carrying the full lap length as its distance and the
 * first one's curve parameter -- zero. So `t` climbs to nearly one across the
 * ring and then drops back to zero on the very last entry, and a search that
 * takes the array at its word concludes that every parameter is past the end
 * and answers "the whole lap". Every cut then came out as an empty range and
 * did nothing at all, which is exactly what the geometry showed. Reading that
 * last entry as one is the whole fix.
 */
export function distanceAtT(fr: Frame[], t: number, closed: boolean): number {
  const n = fr.length;
  if (n === 0) return 0;
  const tAt = (i: number) => (closed && i === n - 1 ? 1 : fr[i].t);
  const want = Math.max(0, Math.min(1, t));
  if (want <= tAt(0)) return fr[0].dist;
  if (want >= tAt(n - 1)) return fr[n - 1].dist;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tAt(mid) <= want) lo = mid;
    else hi = mid - 1;
  }
  const j = Math.min(n - 2, lo);
  const span = tAt(j + 1) - tAt(j);
  const k = span > 1e-9 ? (want - tAt(j)) / span : 0;
  return fr[j].dist + (fr[j + 1].dist - fr[j].dist) * k;
}

/* ------------------------------------------------------------------ */
/* What a barrier carries: marshalling panels and access gates          */
/* ------------------------------------------------------------------ */

/**
 * Metres between the lit panels on one side, and how far the other side's are
 * shifted along from them.
 *
 * A real circuit posts marshals about every quarter of a kilometre -- close
 * enough that a yellow is in sight from wherever the incident is, far enough
 * apart that they are not reading each other's flags. Staggering the two sides
 * by half a spacing means you are never passing two at once, and there is
 * always one coming up: on a 5 km lap that is forty panels, one every 125 m.
 * The spacing is a target, not a rule: the lap is divided into whole steps as
 * near to it as they can be, so the seam gets no leftover half-step, and the
 * other side starts half a step in.
 */
const PANEL_SPACING = 250;

/** The screen and the case around it, metres. */
const PANEL_W = 1.6;
const PANEL_H = 0.9;

/** How far the screen stands in front of the barrier line, towards the track. */
const PANEL_PROUD = 0.14;
/**
 * How far a panel is yawed to face UP the road, degrees. Mounted flat on the
 * fence a screen is edge-on to the one person it exists for -- the driver
 * coming towards it. Angled about a third of the way round it reads from the
 * cockpit long before the car is level with it, the way real ones hang.
 */
const PANEL_YAW = 32;
/**
 * Where the top of a panel sits when the barrier itself offers no perch: the
 * height of the default catch fence's knee. Switching a circuit from fence
 * to armco must not drop the boards to ankle height -- the drivers look for
 * them in the same place either way -- so on a low barrier they keep this
 * height and stand on their own posts instead.
 */
const PANEL_MOUNT_TOP = 3.6;

/**
 * The access gates: where a barrier opens so a stranded car can be pushed off
 * the circuit.
 *
 * A real one is not a hole, and it is not open both ways either. The run
 * stops, and a second length of the same barrier stands close behind: it
 * reaches well past the opening's REAR edge, and at the FORWARD edge it
 * angles in and joins the run. So the slot between the two opens backwards
 * only -- a marshal walks out against the direction of travel -- and a car
 * sliding along the wall with the traffic is guided into the sealed wedge
 * instead of finding a corridor straight through the barrier, which is what
 * an opening must never offer a crash.
 *
 * The opening is ten metres wherever it lands -- room to walk a car through
 * without threading a needle. It is NOT rounded off to the nearest cross
 * section: how far apart those are is the author's sampling setting, so on a
 * coarsely sampled circuit that rounding is the difference between a gate
 * and a thirty metre hole in the armco. The opening's exact edges are
 * interpolated instead (see the gates block in buildRoadMeshes).
 */
export const GATE_SPACING = 400;
const GATE_WIDTH = 10;
/**
 * The width of the SLOT between the two runs: a car and change, so a
 * stranded one fits through the gate -- in through the opening, backwards
 * along the slot, out behind the barrier. The forward end is sealed
 * regardless, so nothing arrives through here at speed.
 */
export const GATE_SET_BACK = 2.2;
/** How far past the opening's REAR edge the set-back piece reaches. Its
    forward end does not reach past anything: it angles in and joins the run
    at the opening's forward edge, so the slot only opens backwards. */
const GATE_OVERLAP = 4.5;
/** Metres over which the set-back piece angles in to meet the run. */
const GATE_JOIN = 4;
/** How far the barrier must carry on past both sides of an opening. */
const GATE_GUARD = 25;
/**
 * The painted tips. The last metres of the front run either side of an
 * opening are safety orange, the way a real circuit paints them, so drivers
 * and marshals can find the way in against a kilometre of grey rail.
 */
const GATE_MARK = 3;

/**
 * Where the barrier opens, as distances into the lap.
 *
 * A gate belongs to the circuit rather than to one barrier, so this is worked
 * out once and both sides open at the same place -- which is also what a
 * marshalling post looks like: a gate on the outside, the post behind it.
 */
export function gateStations(lap: number): number[] {
  const out: number[] = [];
  for (let k = 0; (k + 0.5) * GATE_SPACING < lap; k++) out.push((k + 0.5) * GATE_SPACING);
  return out;
}

/*
 * Camera windows.
 *
 * A catch fence on a real circuit has square openings cut into its mesh at
 * intervals: the TV positions, where a camera on the far side films through
 * the fence instead of over it. They are cut into the mesh band only -- the
 * armco below and the lean above stay as they are -- and the replay cameras
 * the editor writes stand at exactly these openings (see core/cameras.ts).
 *
 * The rhythm is like the gates', but on its own grid and offset from it, so
 * a window never lands in a gate's opening.
 */
export const CAMERA_WINDOW_SPACING = 500;
export const CAMERA_WINDOW_WIDTH = 2.0;
/** Bottom and top of the opening, metres above the barrier's foot. */
export const CAMERA_WINDOW_BOTTOM = 1.4;
export const CAMERA_WINDOW_TOP = 2.6;

/** Where the fence opens a camera window, as distances into the lap. */
export function cameraWindowStations(lap: number): number[] {
  const out: number[] = [];
  for (let k = 0; (k + 0.5) * CAMERA_WINDOW_SPACING < lap; k++) out.push((k + 0.5) * CAMERA_WINDOW_SPACING);
  return out;
}

/**
 * How far the run off carries the camber of the road before it levels out.
 *
 * The run off used to continue the banking for its whole width, because it was
 * offset along the frame's tilted `right` vector like everything else. On a
 * flat circuit that is invisible -- `right` is horizontal, so it changes
 * nothing. Put 10° of banking on a corner and a 23 m run off, and the outer
 * edge is 4 m below the road on one side and 4 m above it on the other, taking
 * the barrier standing on it along for the ride. That is not a run off, it is a
 * cliff, and it is what the barriers "well below the track" turned out to be.
 *
 * A real one flattens out: full camber at the tarmac edge, easing off over the
 * first few metres of grass, level after that. The tilt is faded linearly to
 * zero across this distance, so the height is its integral -- continuous, and
 * with no crease where the fade ends.
 */
export const RUNOFF_BANK_RUN = 8;

/**
 * The height a point `across` metres outside the hard edge gains from banking.
 *
 * `rightY` is the vertical component of the frame's right vector, i.e. the sine
 * of the bank angle. The result is for the RIGHT hand side; negate it for the
 * left. Shared with the terrain blend, which has to raise the ground to exactly
 * the same surface or the grass cuts through the run off.
 */
export function runoffBankRise(rightY: number, across: number): number {
  if (rightY === 0 || across <= 0) return 0;
  const e = Math.min(across, RUNOFF_BANK_RUN);
  return rightY * (e - (e * e) / (2 * RUNOFF_BANK_RUN));
}

/**
 * How far the concrete beside the pit lane falls across its own width.
 *
 * Enough to drain and far too little to feel, and it scales with the width the
 * same way every other shoulder does, so widening the apron makes it flatter
 * rather than steeper.
 */
export const PIT_APRON_DROP = 0.05;

/**
 * The gap the ground keeps under the outer edge of a road mesh.
 *
 * The road, its kerbs, its run off and the concrete beside the pit lane are
 * meshes lying on the terrain, so the terrain is sunk underneath them: two
 * coplanar surfaces leave the depth buffer to guess, and what that looks like
 * is grass flickering through tarmac. Deep under the middle of the road, eased
 * back to this much by the outer edge, where the ground becomes the surface
 * you actually see.
 *
 * It lives here rather than in terrain.ts because BOTH sides need it. The
 * ground stops this far below the mesh edge, and the mesh edge is therefore
 * dropped by the same amount to come down and meet it -- otherwise every
 * ribbon ends in a four centimetre lip standing along its outer edge, which on
 * the concrete beside a pit lane is a step a car drives over.
 */
export const EDGE_SINK = 0.04;

/**
 * The steepest fold the two triangles of one plate may make, radians.
 *
 * A plate of BANKED road is not flat. Its far cross section is rolled a little
 * further than its near one, so the four corners do not share a plane, and a
 * quad whose corners do not share a plane is drawn as two triangles that meet
 * along the diagonal at an angle. Consecutive plates cut the diagonal the same
 * way, so what a tyre rides over is a saw: up the first triangle, down the
 * second, once per plate. The car feels it as force feedback -- on the demo
 * oval, 4 degrees of surface tilt flicking back and forth at 30 Hz -- and no
 * amount of Detail removes it: shortening the plate shortens the tooth and
 * raises its pitch, but the ANGLE of the fold is the width of the road times
 * the rate the banking turns at, and neither of those changes.
 *
 * What does remove it is cutting the plate ACROSS. Ten centimetres of fold
 * spread over a 14 m plate is a ridge; the same plate in eight columns folds
 * an eighth as much over an eighth of the width, and the tilt drops with it.
 *
 * Three tenths of a degree is about what the plate joints of a banked corner
 * make anyway -- the road really is turning there, and that part is honest, so
 * there is nothing to gain by pushing the fold below it.
 */
const TWIST_FOLD = (0.3 * Math.PI) / 180;

/**
 * Never split a plate finer than this, whatever the twist.
 *
 * Eight columns take the demo oval's worst fold from 3.8 degrees to 0.7, which
 * is already inside what the corner's own plate joints do. Sixteen would reach
 * 0.5 for twice the road mesh, and the rest of the way is not the diagonal's
 * fault: it is the plate's own twist, and only shorter plates take that out.
 */
const MAX_TWIST_COLUMNS = 8;

/** The angle two triangles of a `plate` x `width` quad make at `off` of twist. */
function foldAngle(off: number, plate: number, width: number): number {
  // The far corner stands `off` off the plane of the other three, and it turns
  // about the diagonal it does not touch. Its distance from that diagonal is
  // the quad's area over the diagonal's length.
  const lever = (plate * width) / Math.hypot(plate, width);
  return lever < 1e-9 ? Math.PI / 2 : Math.atan2(off, lever);
}

/**
 * How many quads across a drivable ribbon needs so its plates stop folding.
 *
 * Counted from the geometry itself rather than from the banking angle: it is
 * the distance of one corner of each plate from the plane of the other three
 * that matters, and that is zero for everything but twist. A flat road returns
 * 1. So does a corner banked at a CONSTANT angle -- its cross sections all
 * point at the same apex, so consecutive ones share a plane and the quads
 * between them are flat. Only the stretch where the banking is winding on or
 * off pays, which is exactly the stretch that needs it.
 *
 * Powers of two, so that a control point dragged about a banked corner changes
 * the answer as rarely as possible: the vertex count decides whether the road's
 * buffers can be reused on the next frame, and one that keeps changing is a
 * full reallocation per frame of the drag.
 */
export function twistColumns(fr: Frame[], closed: boolean): number {
  const n = fr.length;
  if (n < 2) return 1;
  const last = closed ? n : n - 1;
  const l0 = new THREE.Vector3();
  const r0 = new THREE.Vector3();
  const l1 = new THREE.Vector3();
  const r1 = new THREE.Vector3();
  const edge = new THREE.Vector3();
  const along = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  let cols = 1;
  for (let i = 0; i < last && cols < MAX_TWIST_COLUMNS; i++) {
    const a = fr[i];
    const b = fr[(i + 1) % n];
    l0.copy(a.pos).addScaledVector(a.right, -a.widthL);
    r0.copy(a.pos).addScaledVector(a.right, a.widthR);
    l1.copy(b.pos).addScaledVector(b.right, -b.widthL);
    r1.copy(b.pos).addScaledVector(b.right, b.widthR);
    edge.subVectors(r0, l0);
    along.subVectors(l1, l0);
    nrm.crossVectors(edge, along);
    const area = nrm.length();
    if (area < 1e-9) continue;
    const off = Math.abs(r1.sub(l0).dot(nrm)) / area;
    const width = a.widthL + a.widthR;
    const plate = a.pos.distanceTo(b.pos);
    if (off < 1e-6 || width < 1e-3 || plate < 1e-6) continue;
    /* Stop once the quads are about as wide as they are long, whatever the
       fold still is. Past that point the diagonal is the short way across and
       splitting again barely moves the angle -- on the demo oval the last
       doubling buys a sixth of a degree for twice the road mesh -- while what
       is left is the plate's own twist, which only shorter plates can take
       out. */
    while (
      cols < MAX_TWIST_COLUMNS &&
      width / cols > plate &&
      foldAngle(off / cols, plate, width / cols) > TWIST_FOLD
    ) {
      cols *= 2;
    }
  }
  return cols;
}

/**
 * How far the outer edge of a shoulder `w` metres wide sits below the road.
 *
 * The drop used to reach its full value once the shoulder was 2 m wide, which
 * makes it a step rather than a slope: where a clearance rule pinches the run
 * off out over a couple of metres of track, the edge -- and the barrier on it
 * -- fell the whole `runoffDrop` in that distance. A 75 cm cliff, repeated
 * wherever the pit lane or the track passed close to itself, which is what
 * "hügelig" was.
 *
 * Scaling it by the width instead keeps the CROSS SLOPE constant: a shoulder
 * half as wide falls half as far, so a shoulder tapering away flattens out
 * smoothly instead of dropping off the end. `full` is the width the setting was
 * dialled in for, so the setting still means what it says at full width.
 */
export function shoulderDrop(drop: number, w: number, full: number): number {
  if (w <= 0 || drop === 0) return 0;
  return drop * Math.min(1, w / Math.max(1e-6, full));
}

/**
 * Metres of width a shoulder may lose per metre of track.
 *
 * Every rule that narrows the run off -- the pit lane clearance, the corridor
 * clearance, a run off switched off at one control point -- clamps a single
 * cross section without looking at its neighbours, and the pit one flips from
 * one side of the track to the other when the nearest pit cross section does.
 * The result was a 23 m shoulder collapsing to nothing and back over two cross
 * sections a metre and a half apart: a wall of grass, and a barrier that jumped
 * 74 cm up and down with it. Nothing is ever widened here, so no clearance the
 * rules established can be undone -- the width is only ever pulled DOWN towards
 * its neighbours, which turns a cliff into a wedge.
 *
 * A metre per metre is a 45 degree wedge, and that turned out to be the whole
 * of the "barrier squashes together at the apex" problem. Inside a tight bend
 * the width rules narrow the shoulder hard and then let it straight back out:
 * measured on a 13 m corner, 12.7 m of run off down to 3.1 m and back up to
 * 14.7 m inside ten metres of track. At 45 degrees the shoulder edge is
 * allowed to do exactly that, and the barrier standing on it runs out to a
 * point and turns around -- the sharp V on the inside of the corner. The
 * width at the apex was never the problem; the RATE was.
 *
 * A real run off is tapered like a slip road, not chamfered like the corner of
 * a table. One in three is the compromise measured here: it costs a tenth of a
 * metre of mean shoulder on a tight circuit, where one in six costs half a
 * metre and starts pulling the barrier in a good way short of the corner.
 */
const SHOULDER_TAPER = 1 / 3;

/** Lipschitz limit a width array in place: no step bigger than the gap. */
function limitTaper(width: Float32Array, frames: Frame[], closed: boolean, slope = SHOULDER_TAPER) {
  const n = width.length;
  if (n < 2) return;
  const step = (a: number, b: number) => frames[a].pos.distanceTo(frames[b].pos) * slope;
  // Two passes on a ring: the constraint has to be able to travel across the
  // seam in both directions, exactly like the corridor clearance above.
  for (let pass = 0; pass < (closed ? 2 : 1); pass++) {
    for (let i = 1; i < n; i++) width[i] = Math.min(width[i], width[i - 1] + step(i - 1, i));
    if (closed) width[0] = Math.min(width[0], width[n - 1] + step(n - 1, 0));
    for (let i = n - 2; i >= 0; i--) width[i] = Math.min(width[i], width[i + 1] + step(i, i + 1));
    if (closed) width[n - 1] = Math.min(width[n - 1], width[0] + step(n - 1, 0));
  }
}

/* ------------------------------------------------------------------ */
/* What each kind of kerb looks like across                             */
/* ------------------------------------------------------------------ */

/**
 * The cross section of a kerb, as columns from the tarmac outwards.
 *
 * `u` is the fraction of the kerb's width, `h` the fraction of its height. Two
 * columns give the plain wedge the editor used to draw; three give a real kerb,
 * where the rise off the tarmac is a short chamfer and the rest is a flat top
 * you can put two wheels on. That flat top is the whole difference between a
 * kerb and a ramp, and it is what decides how the car behaves on it.
 */
const KERB_COLUMNS: Record<KerbStyle, ReadonlyArray<{ u: number; h: number }>> = {
  flat: [
    { u: 0, h: 0 },
    { u: 1, h: 1 },
  ],
  ramp: [
    { u: 0, h: 0 },
    { u: 0.3, h: 1 },
    { u: 1, h: 1 },
  ],
  wave: [
    { u: 0, h: 0 },
    { u: 0.3, h: 1 },
    { u: 1, h: 1 },
  ],
  // The strip a sausage sits on is a low kerb in its own right, so driving
  // between two bumps still tells you that you have left the track.
  sausage: [
    { u: 0, h: 0 },
    { u: 0.15, h: 1 },
    { u: 1, h: 1 },
  ],
  none: [],
};

/** How tall the continuous strip is, as a fraction of the span's height. */
const KERB_STRIP_HEIGHT: Record<KerbStyle, number> = {
  flat: 1,
  ramp: 1,
  wave: 1,
  sausage: 0.3,
  none: 0,
};

/**
 * Longitudinal subdivision per cross section.
 *
 * Only the rippled kerb needs it: everything else is flat between two cross
 * sections, and interpolating a straight line adds vertices without adding
 * shape. The ripple is a real profile in metres, so it has to be sampled far
 * more finely than the road is -- at the default detail a plate of road is
 * several metres long, and a wave sampled once per plate is not a wave.
 */
const WAVE_STEPS = 6;
/** Wanted distance between two ripples, metres. */
const WAVE_PERIOD = 1.6;
/**
 * Vertex rings across each wedge at the end of a span.
 *
 * The road is sampled every several metres and a wedge is a few metres long, so
 * without rings of its own the triangular end falls between two cross sections
 * and the kerb starts as a step -- correct in the numbers, wrong on the screen.
 */
const TAPER_RINGS = 4;
/** Sausage bumps: how long each is, and the clear gap to the next. */
const BUMP_LENGTH = 2.4;
const BUMP_GAP = 1.6;
/** How much of a bump's length is the slope up onto it. */
const BUMP_RAMP = 0.35;
/** Lateral profile of a bump: fraction of the kerb width, and of its height. */
const BUMP_COLUMNS: ReadonlyArray<{ u: number; h: number }> = [
  { u: 0.08, h: 0 },
  { u: 0.3, h: 1 },
  { u: 0.78, h: 1 },
  { u: 0.96, h: 0 },
];

/** Working buffers for the kerb columns. Same reasoning as `scratch` above. */
const kerbScratch = {
  size: 0,
  cols: [[], [], [], []] as THREE.Vector3[][],
  us: [[], [], [], []] as number[][],
  v: [] as number[],
};

function takeKerbScratch(n: number) {
  if (kerbScratch.size < n) {
    for (const col of kerbScratch.cols) while (col.length < n) col.push(new THREE.Vector3());
    for (const arr of kerbScratch.us) while (arr.length < n) arr.push(0);
    while (kerbScratch.v.length < n) kerbScratch.v.push(0);
    kerbScratch.size = n;
  }
  return kerbScratch;
}

const kerbOut = new THREE.Vector3();
const kerbUp = new THREE.Vector3();
const kerbInner = new THREE.Vector3();
const kerbSample = { w: 0, h: 0, dist: 0 };

/** One buildable stretch of one span: cross sections `a`..`z` inclusive. */
interface KerbGroup {
  a: number;
  z: number;
  run: KerbRun;
}

interface KerbSide {
  fr: Frame[];
  side: -1 | 1;
  /** The tarmac edge on this side, per cross section. The kerb starts here. */
  inner: THREE.Vector3[];
  width: Float32Array;
  height: Float32Array;
  spanOf: Int32Array;
  layout: KerbLayout;
}

/** The stretches of this side that actually have a kerb on them. */
function kerbGroups(k: KerbSide): KerbGroup[] {
  const n = k.fr.length;
  const out: KerbGroup[] = [];
  for (const run of k.layout.runs) {
    if (run.span.side !== k.side || run.span.style === 'none') continue;
    for (const [a, z] of runs(n, (i) => k.spanOf[i] === run.index && k.width[i] > 0.01)) {
      out.push({ a, z, run });
    }
  }
  return out;
}

/**
 * Upper bound on the vertices a side's kerbs need, so the buffer can be reused.
 *
 * Rounded up to a block, and that rounding is the point. A buffer is only
 * reused when the capacity matches EXACTLY, and dragging the end of a kerb
 * changes how many cross sections it covers on almost every frame -- so an
 * exact figure meant a fresh pair of geometries, and a fresh pair of GPU
 * buffers, sixty times a second for as long as the drag lasted. Rounding to
 * blocks of a thousand vertices costs a few kilobytes of slack and turns that
 * into one allocation per few hundred metres of dragging.
 */
const CAPACITY_BLOCK = 1024;

function kerbCapacity(groups: KerbGroup[], fr: Frame[]): number {
  let verts = 0;
  for (const g of groups) {
    const style = g.run.span.style;
    const cols = KERB_COLUMNS[style].length;
    const sub = style === 'wave' ? WAVE_STEPS : 1;
    // Cross sections, the two ends of the span, and the rings across each wedge.
    const rings = g.z - g.a + 1 + 2 * TAPER_RINGS;
    verts += ((rings - 1) * sub + 1) * 2 * Math.max(1, cols - 1);
    if (style === 'sausage') {
      const len = Math.max(0, fr[g.z].dist - fr[g.a].dist);
      const bumps = Math.floor((len + BUMP_GAP) / (BUMP_LENGTH + BUMP_GAP)) + 1;
      verts += bumps * 4 * 2 * (BUMP_COLUMNS.length - 1);
    }
  }
  return Math.max(2, Math.ceil(verts / CAPACITY_BLOCK) * CAPACITY_BLOCK);
}

const lerpN = (a: number, b: number, w: number) => a + (b - a) * w;

/**
 * The frame at a fractional cross section index, into the module scratch.
 *
 * Everything a kerb vertex sits on comes from here: where the tarmac edge is,
 * which way is out, which way is up, and how far along the lap it is. Between
 * two cross sections the road is a flat plate, so straight interpolation is not
 * an approximation, it is exact.
 *
 * The SIZE of the kerb deliberately does not come from here -- see `kerbSizeAt`.
 */
function sampleKerb(k: KerbSide, x: number) {
  const last = k.fr.length - 1;
  const i0 = Math.min(Math.max(Math.floor(x), 0), last);
  const i1 = Math.min(i0 + 1, last);
  const w = x - i0;
  kerbInner.copy(k.inner[i0]).lerp(k.inner[i1], w);
  kerbOut.copy(k.fr[i0].right).lerp(k.fr[i1].right, w).normalize().multiplyScalar(k.side);
  kerbUp.copy(k.fr[i0].up).lerp(k.fr[i1].up, w).normalize();
  kerbSample.dist = lerpN(k.fr[i0].dist, k.fr[i1].dist, w);
}

/**
 * How much of its asked for width a cross section actually got, 0..1.
 *
 * The side profile hands back one number per cross section, already carrying
 * both the wedge at the ends and every clamp -- tight bends, the pit lane, the
 * corridor sweep. A kerb needs to be sampled far more finely than that: the
 * wedge is a few metres long and cross sections are eight metres apart on an
 * ordinary track, so reading widths off the profile alone skipped the wedge
 * entirely and the kerb still began as a step. Dividing the profile by what was
 * asked for separates the two: this factor is what the CLAMPS did, it changes
 * slowly, and it interpolates honestly between cross sections. The wedge is
 * then evaluated per vertex, in metres, where it belongs.
 */
function clampFactors(k: KerbSide, g: KerbGroup): Float32Array {
  const out = new Float32Array(g.z - g.a + 1);
  for (let i = g.a; i <= g.z; i++) {
    const want =
      g.run.span.width * k.layout.wedge(g.run, k.layout.along(g.run, k.fr[i].dist));
    out[i - g.a] = want > 1e-4 ? Math.min(1, k.width[i] / want) : k.width[i] > 1e-4 ? 1 : 0;
  }
  return out;
}

/** Width and height of the kerb at a fractional index, in metres. */
function kerbSizeAt(k: KerbSide, g: KerbGroup, cl: Float32Array, x: number, dist: number) {
  const xc = Math.min(Math.max(x, g.a), g.z);
  const i0 = Math.floor(xc);
  const i1 = Math.min(i0 + 1, g.z);
  const c = lerpN(cl[i0 - g.a], cl[i1 - g.a], xc - i0);
  const wedge = k.layout.wedge(g.run, k.layout.along(g.run, dist));
  kerbSample.w = g.run.span.width * wedge * c;
  kerbSample.h = g.run.span.height * wedge * c;
}

/**
 * Where a stretch of kerb needs a vertex ring, as fractional cross sections.
 *
 * Always the road's own cross sections, so the kerb sits on exactly the plates
 * the tarmac is made of, plus the two ends of the span itself and a few rings
 * across each wedge -- that is what makes the triangular end a triangle rather
 * than a step that happens to land between two samples.
 */
function kerbStations(k: KerbSide, g: KerbGroup, sub: number): number[] {
  const run = g.run;
  const spacingBefore = g.a > 0 ? k.fr[g.a].dist - k.fr[g.a - 1].dist : Infinity;
  const spacingAfter = g.z + 1 < k.fr.length ? k.fr[g.z + 1].dist - k.fr[g.z].dist : Infinity;
  const sA = k.layout.along(run, k.fr[g.a].dist);
  const sZ = k.layout.along(run, k.fr[g.z].dist);
  /*
   * Whether this end of the group is an end of the SPAN, or just where the
   * cross sections happened to be cut in two by the seam.
   *
   * With slack, and the slack matters. A group only holds cross sections
   * whose kerb is wider than a centimetre, and a cross section standing a few
   * centimetres inside the wedge is narrower than that -- so it is left out,
   * and the first cross section IN the group then sits one full spacing plus
   * those few centimetres past the start. Against a micrometre of tolerance
   * that read as "cut by the seam": no start station, no wedge rings, and the
   * kerb began as a square cut a whole cross section late. Seen on the
   * showcase circuit's banked bend, where a span starts 3 cm short of a cross
   * section. Half a metre is more than any sub-centimetre wedge can reach and
   * far less than a cross section, so it cannot mistake a seam for an end.
   */
  const END_SLACK = 0.5;
  const startIsEnd = run.ends && sA <= spacingBefore + END_SLACK;
  const endIsEnd = run.ends && run.length - sZ <= spacingAfter + END_SLACK;

  const xs: number[] = [];
  if (startIsEnd) xs.push(indexAtDist(k.fr, Math.max(0, g.a - 1), g.z, run.start));
  for (let i = g.a; i <= g.z; i++) xs.push(i);
  if (endIsEnd) {
    xs.push(indexAtDist(k.fr, g.a, Math.min(k.fr.length - 1, g.z + 1), run.start + run.length));
  }

  // Rings across each wedge, so it reads as the taper it is.
  const reach = Math.min(run.span.taper, run.length / 2);
  if (run.ends && reach > 0.2) {
    for (let step = 1; step < TAPER_RINGS; step++) {
      const s = (reach * step) / TAPER_RINGS;
      if (startIsEnd) xs.push(indexAtDist(k.fr, Math.max(0, g.a - 1), g.z, run.start + s));
      if (endIsEnd) {
        xs.push(
          indexAtDist(k.fr, g.a, Math.min(k.fr.length - 1, g.z + 1), run.start + run.length - s),
        );
      }
    }
  }

  xs.sort((p, q) => p - q);
  const dedup: number[] = [];
  for (const x of xs) if (dedup.length === 0 || x - dedup[dedup.length - 1] > 1e-4) dedup.push(x);
  if (sub <= 1) return dedup;

  const fine: number[] = [];
  for (let i = 0; i < dedup.length - 1; i++) {
    for (let s = 0; s < sub; s++) fine.push(lerpN(dedup[i], dedup[i + 1], s / sub));
  }
  fine.push(dedup[dedup.length - 1]);
  return fine;
}

/** Fractional cross section index at an arc length, searched inside a group. */
function indexAtDist(fr: Frame[], a: number, z: number, d: number): number {
  let i = a;
  while (i < z && fr[i + 1].dist <= d) i++;
  if (i >= z) return z;
  const span = fr[i + 1].dist - fr[i].dist;
  return span > 1e-9 ? i + (d - fr[i].dist) / span : i;
}

/** The continuous strip: everything but a sausage's bumps. */
function buildKerbStrip(b: StripBuilder, k: KerbSide, g: KerbGroup) {
  const style = g.run.span.style;
  const cols = KERB_COLUMNS[style];
  if (cols.length < 2) return;
  const xs = kerbStations(k, g, style === 'wave' ? WAVE_STEPS : 1);
  const count = xs.length;
  if (count < 2) return;
  const cl = clampFactors(k, g);
  const s = takeKerbScratch(count);

  // A ripple shorter than three samples is not a ripple, it is noise: the
  // sampling would alias it into a slow wobble that has nothing to do with the
  // shape asked for. So the wave lengthens rather than lies.
  let period = WAVE_PERIOD;
  if (style === 'wave') {
    const spacing = Math.abs(k.fr[g.z].dist - k.fr[g.a].dist) / Math.max(1, count - 1);
    period = Math.max(WAVE_PERIOD, spacing * 3);
  }

  for (let c = 0; c < cols.length; c++) {
    for (let j = 0; j < count; j++) s.us[c][j] = cols[c].u;
  }

  for (let j = 0; j < count; j++) {
    sampleKerb(k, xs[j]);
    kerbSizeAt(k, g, cl, xs[j], kerbSample.dist);
    let h = kerbSample.h * KERB_STRIP_HEIGHT[style];
    if (style === 'wave') {
      const along = k.layout.along(g.run, kerbSample.dist);
      h *= 0.68 + 0.32 * Math.sin((along / period) * Math.PI * 2);
    }
    for (let c = 0; c < cols.length; c++) {
      s.cols[c][j]
        .copy(kerbInner)
        .addScaledVector(kerbOut, cols[c].u * kerbSample.w)
        .addScaledVector(kerbUp, cols[c].h * h);
    }
    s.v[j] = kerbSample.dist / KERB_REPEAT;
  }

  for (let c = 0; c < cols.length - 1; c++) {
    // Winding: on the left the kerb grows towards -right, so the outer column
    // is the one `addStrip` has to be handed as its left hand edge.
    if (k.side < 0) b.addStrip(s.cols[c + 1], s.cols[c], s.us[c + 1], s.us[c], s.v, 0, count - 1);
    else b.addStrip(s.cols[c], s.cols[c + 1], s.us[c], s.us[c + 1], s.v, 0, count - 1);
  }
}

/**
 * The bumps of a sausage kerb.
 *
 * Placed by the metre rather than by cross section: a bump is a real object
 * about two and a half metres long, and hanging it off the road's own sampling
 * would make it three times that on a coarse setting and change size whenever
 * the detail slider moved. They are laid out centred in their stretch, so a run
 * of them does not end in a stub.
 */
function buildBumps(b: StripBuilder, k: KerbSide, g: KerbGroup) {
  const d0 = k.fr[g.a].dist;
  const len = k.fr[g.z].dist - d0;
  const period = BUMP_LENGTH + BUMP_GAP;
  if (len < BUMP_LENGTH) return;
  const count = Math.max(1, Math.floor((len + BUMP_GAP) / period));
  const used = count * period - BUMP_GAP;
  const cols = BUMP_COLUMNS;
  const s = takeKerbScratch(4);
  const base = KERB_STRIP_HEIGHT.sausage;
  const cl = clampFactors(k, g);

  for (let n = 0; n < count; n++) {
    const start = d0 + (len - used) / 2 + n * period;
    const stations = [start, start + BUMP_RAMP, start + BUMP_LENGTH - BUMP_RAMP, start + BUMP_LENGTH];
    const rise = [0, 1, 1, 0];
    for (let j = 0; j < 4; j++) {
      const x = indexAtDist(k.fr, g.a, g.z, stations[j]);
      sampleKerb(k, x);
      kerbSizeAt(k, g, cl, x, kerbSample.dist);
      for (let c = 0; c < cols.length; c++) {
        const h = kerbSample.h * (base + (1 - base) * rise[j] * cols[c].h);
        s.cols[c][j]
          .copy(kerbInner)
          .addScaledVector(kerbOut, cols[c].u * kerbSample.w)
          .addScaledVector(kerbUp, h);
        s.us[c][j] = cols[c].u;
      }
      s.v[j] = stations[j] / KERB_REPEAT;
    }
    for (let c = 0; c < cols.length - 1; c++) {
      if (k.side < 0) b.addStrip(s.cols[c + 1], s.cols[c], s.us[c + 1], s.us[c], s.v, 0, 3);
      else b.addStrip(s.cols[c], s.cols[c + 1], s.us[c], s.us[c + 1], s.v, 0, 3);
    }
  }
}

/**
 * Contiguous index ranges where `pred` holds, used for optional kerbs.
 *
 * A range of one cross section cannot make a quad -- a strip needs two -- and
 * this used to answer that by throwing the range away. Silently: the surface
 * simply was not there, with nothing anywhere to say so, and it took a
 * screenshot of a hole in the pit apron to find it. Wherever a wanted stretch
 * is a single cross section long, it is widened to two instead, so the surface
 * exists. One cross section of overhang is a few centimetres of concrete or
 * kerb reaching further than asked; a hole is a hole.
 */
function runs(count: number, pred: (i: number) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  const close = (endExclusive: number) => {
    if (start < 0) return;
    let a = start;
    let z = endExclusive - 1;
    if (z === a) {
      // Grow into whichever neighbour exists, preferring to reach forwards.
      if (z + 1 < count) z += 1;
      else if (a > 0) a -= 1;
      else return; // a path of one cross section has no surface at all
    }
    out.push([a, z]);
    start = -1;
  };
  for (let i = 0; i < count; i++) {
    if (pred(i)) {
      if (start < 0) start = i;
    } else {
      close(i);
    }
  }
  close(count);

  /* Close single cross section gaps.
   *
   * A strip is quads BETWEEN cross sections, so one missing cross section
   * takes out the quad before it AND the quad after it -- a slot two plates
   * wide through the middle of an otherwise solid shoulder. Nothing wants a
   * gap that narrow: it is a width sliding across its visibility threshold and
   * back, not an author asking for a hole. Two ranges a single cross section
   * apart are therefore joined.
   */
  for (let i = out.length - 1; i > 0; i--) {
    if (out[i][0] - out[i - 1][1] <= 2) {
      out[i - 1][1] = out[i][1];
      out.splice(i, 1);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Side profile: how wide the run off is and where the barrier stands   */
/* ------------------------------------------------------------------ */

/**
 * Effective run off width and barrier presence, per cross section and side.
 *
 * Three things feed into it, in this order:
 *   1. the global run off width from the road settings,
 *   2. the per control point factor, so a section can be narrowed by hand,
 *   3. the pit lane clearance, which pulls the run off back and opens the
 *      barrier wherever the pit lane runs alongside. Without that the barrier
 *      would stand in the middle of the pit lane and the grass would grow
 *      straight through it.
 *
 * The road mesh and the terrain both read this, so they can never disagree
 * about where the edge of the track is.
 */
export interface SideProfile {
  runoffL: Float32Array;
  runoffR: Float32Array;
  /** Kerb width per side, narrowed where a bend is too tight for the full one. */
  kerbWL: Float32Array;
  kerbWR: Float32Array;
  /**
   * Kerb height per side, already carrying both the wedge at the ends of a span
   * and whatever the width had to give up. Height follows width: a kerb
   * squeezed to a third of its width is a third as tall, so a tight bend never
   * leaves a thin vertical lip standing on the tarmac.
   */
  kerbHL: Float32Array;
  kerbHR: Float32Array;
  /** Index of the span this cross section belongs to, or -1. Carries the style. */
  kerbSpanL: Int32Array;
  kerbSpanR: Int32Array;
  /** Width of the coloured tarmac strip outside the kerb, per side. */
  apronL: Float32Array;
  apronR: Float32Array;
  wallL: Uint8Array;
  wallR: Uint8Array;
  /** How far the barrier stands beyond the outer edge of the run off. */
  wallGapL: Float32Array;
  wallGapR: Float32Array;
  /** Side the pit lane was found on. -1 left, 1 right, 0 no pit lane nearby. */
  pitSide: -1 | 0 | 1;
}

function innerRoom(f: Frame, side: -1 | 1): number {
  const kappa = f.curvature;
  if (!Number.isFinite(kappa) || Math.abs(kappa) < 1e-6) return Infinity;
  // Positive curvature bends towards the right, so the right is the inside.
  const inside = kappa > 0 ? 1 : -1;
  if (side !== inside) return Infinity;
  return (1 / Math.abs(kappa)) * INNER_LIMIT;
}

/**
 * How much of the ground INSIDE a bend the shoulder may take.
 *
 * `innerRoom` above asks the wrong question on a tight corner. It only forbids
 * reaching past the centre of the turn, so a twelve metre run off inside a
 * bend whose infield is fifteen metres across is allowed: it eats twelve of
 * them, and the barrier is left as a three metre ring wound round what is
 * left. That is the "barrier squashes together at the apex and walks in
 * towards the track" -- and it is not a fold, which is why every test for
 * folding said the geometry was fine. The clearance from the tarmac is
 * honestly twelve metres all the way round; there simply is not enough
 * infield for it to mean anything.
 *
 * What a circuit does instead is narrow the shoulder on the inside. So the
 * rule is stated against the thing that is actually scarce -- the infield --
 * rather than against the radius: the shoulder may take a SHARE of the ground
 * inside the tarmac and no more, which leaves the barrier a curve of its own
 * with the rest of the infield behind it. On anything but a tight corner the
 * infield is enormous and this never binds.
 */
const INFIELD_SHARE = 0.5;

function infieldRoom(f: Frame, side: -1 | 1): number {
  const kappa = f.curvature;
  if (!Number.isFinite(kappa) || Math.abs(kappa) < 1e-6) return Infinity;
  const inside = kappa > 0 ? 1 : -1;
  if (side !== inside) return Infinity;
  const half = side < 0 ? f.widthL : f.widthR;
  // Radius of the tarmac's own inner edge: what there is to share.
  const infield = Math.max(0, 1 / Math.abs(kappa) - half);
  return half + infield * INFIELD_SHARE;
}

/*
 * A note on what does NOT work here, so it is not tried a third time.
 *
 * The pointwise limit above misses the fold at a corner ENTRY: the barrier
 * there is held by the tight bend a few metres ahead, not by the gentle one
 * beneath it. The obvious repair -- govern each cross section by the tightest
 * radius within reach of its own offset -- is far too blunt to ship. Curvature
 * is measured per sample and is noisy, so ONE spike poisons the whole window
 * either side of it, and a run off that should narrow only at the apex
 * collapses onto the tarmac over forty metres of track. Tried on 2026-08-31
 * and reverted the same day: on a hand drawn S bend the barriers ended up
 * standing on the kerb.
 *
 * Anything attempted here has to be measured against BOTH halves of the
 * problem: no fold, AND the run off still the width it was asked for wherever
 * there is honestly room for it.
 */
/* ------------------------------------------------------------------ */
/* Corridor clearance: where the lap runs back past itself              */
/* ------------------------------------------------------------------ */

/** How far the grass stops short of somebody else's tarmac. */
const CLEARANCE_MARGIN = 0.4;

/**
 * Least arc-to-chord ratio a pair of cross sections needs before they are
 * treated as two different pieces of track rather than one. Half a circle is
 * π/2; the margin below that is for tracks that are not circles.
 */
const NEIGHBOUR_RATIO_SQ = 1.4 * 1.4;

/**
 * Working buffers for the clearance sweep, kept between calls for the same
 * reason as the strip scratch above: this runs on every frame of a drag.
 */
const clearance = {
  size: 0,
  left: new Float64Array(0),
  right: new Float64Array(0),
  /** Centre line and both tarmac edges, flattened. */
  px: new Float64Array(0),
  pz: new Float64Array(0),
  lx: new Float64Array(0),
  lz: new Float64Array(0),
  rx: new Float64Array(0),
  rz: new Float64Array(0),
};

function takeClearance(n: number) {
  if (clearance.size < n) {
    clearance.size = n;
    clearance.left = new Float64Array(n);
    clearance.right = new Float64Array(n);
    clearance.px = new Float64Array(n);
    clearance.pz = new Float64Array(n);
    clearance.lx = new Float64Array(n);
    clearance.lz = new Float64Array(n);
    clearance.rx = new Float64Array(n);
    clearance.rz = new Float64Array(n);
  }
  clearance.left.fill(Infinity, 0, n);
  clearance.right.fill(Infinity, 0, n);
  return clearance;
}

/**
 * Narrow the kerb and the run off where the track doubles back past itself.
 *
 * A hairpin, or any corner drawn tighter than the corridor is wide, puts two
 * stretches of tarmac within a few metres of each other while the bend at each
 * individual cross section stays gentle. The curvature limit above therefore
 * never sees it — measured at the cross sections either side of a spike the
 * radius runs into the hundreds of metres — so both stretches claim their full
 * width, and the grass, the kerb and the barrier get drawn straight across the
 * other one's racing line.
 *
 * So the requirement is stated directly instead of inferred from the bend:
 * walk the offset ray out from each cross section and stop it where it first
 * crosses INTO another piece of tarmac. On an ordinary corner that never
 * happens. The inward offset of a circular arc keeps its full distance from
 * the centre line by construction, so the test cannot fire, and a normal track
 * comes out of here untouched.
 */
function applyCorridorClearance(
  frames: Frame[],
  closed: boolean,
  kerbWL: Float32Array,
  kerbWR: Float32Array,
  apronL: Float32Array,
  apronR: Float32Array,
  runoffL: Float32Array,
  runoffR: Float32Array,
) {
  const n = frames.length;
  if (n < 4) return;

  const lapLength = pathLength(frames, closed);
  const { left, right, px, pz, lx, lz, rx, rz } = takeClearance(n);

  // Both tarmac edges, up front. The sweep below looks at each cross section
  // from about twenty others, and rebuilding its edge points every time was
  // most of the cost.
  let maxHalf = 0;
  let maxStep = 0;
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    px[i] = f.pos.x;
    pz[i] = f.pos.z;
    lx[i] = f.pos.x - f.widthL * f.right.x;
    lz[i] = f.pos.z - f.widthL * f.right.z;
    rx[i] = f.pos.x + f.widthR * f.right.x;
    rz[i] = f.pos.z + f.widthR * f.right.z;
    if (f.widthL > maxHalf) maxHalf = f.widthL;
    if (f.widthR > maxHalf) maxHalf = f.widthR;
  }
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : 0;
    const step = Math.hypot(px[j] - px[i], pz[j] - pz[i]);
    if (step > maxStep) maxStep = step;
  }

  const index = new PointIndex(frames.map((f) => f.pos), 30);

  // Hoisted out of the loop: a fresh closure per cross section would be an
  // allocation per frame of every drag.
  let curI = 0;
  let curDist = 0;
  let curLeft = 0;
  let curRight = 0;
  let fx = 0;
  let fz = 0;
  let dlx = 0;
  let dlz = 0;

  const visit = (j: number, chordSq: number) => {
    const next = j + 1 < n ? j + 1 : 0;
    if (next === 0 && !closed) return;

    /*
     * Skip the track's own neighbourhood.
     *
     * At a fine sampling a cross section has dozens of its own neighbours
     * inside the query radius -- at 1.5 m spacing and a 23 m run off, about
     * forty of them -- and each one costs four ray tests to conclude what was
     * obvious: that is the same ribbon of tarmac a moment earlier or later, not
     * a second one to keep clear of.
     *
     * The test is the ratio of the way ROUND to the way ACROSS. Two points that
     * face each other have to have turned at least half a circle to get there,
     * and half a circle is π/2 ≈ 1.57 times as long as the line across it. A
     * pair whose arc is barely longer than its chord has not turned enough to
     * be facing anything. Corners in between are the curvature clamp's job:
     * nothing may be offset past 0.85 of the radius, so an inside ray cannot
     * reach the far side of a bend it has not doubled back on.
     */
    const arc = Math.abs(frames[j].dist - curDist);
    const gap = closed ? Math.min(arc, lapLength - arc) : arc;
    // Squared, so neither a square root nor a second distance is needed.
    if (chordSq < 1e-12 || gap * gap < chordSq * NEIGHBOUR_RATIO_SQ) return;

    for (let s = 0; s < 2; s++) {
      const ax = s === 0 ? lx[j] : rx[j];
      const az = s === 0 ? lz[j] : rz[j];
      const ex = (s === 0 ? lx[next] : rx[next]) - ax;
      const ez = (s === 0 ? lz[next] : rz[next]) - az;

      // Normal of this tarmac edge, turned to face away from the centre line.
      let nx = ez;
      let nz = -ex;
      if (nx * (ax - px[j]) + nz * (az - pz[j]) < 0) {
        nx = -nx;
        nz = -nz;
      }

      const qx = ax - fx;
      const qz = az - fz;

      for (let k = 0; k < 2; k++) {
        const dx = k === 0 ? -dlx : dlx;
        const dz = k === 0 ? -dlz : dlz;
        const limit = k === 0 ? curLeft : curRight;
        if (limit <= 0) continue;
        // Leaving a piece of tarmac is normal; only going into one is a clash.
        if (dx * nx + dz * nz >= 0) continue;

        const den = dx * ez - dz * ex;
        if (den > -1e-12 && den < 1e-12) continue;
        const t = (qx * ez - qz * ex) / den;
        /*
         * Twice the claim, not once.
         *
         * Stopping at `limit` asks "does my run off reach their ROAD", and
         * the answer is almost always no while the two are still laid through
         * each other: what is coming the other way is not their tarmac, it is
         * their run off, and that reaches as far towards me as mine does
         * towards them. Two ribbons thirty metres apart with nineteen metres
         * of claim apiece overlap by eight, and neither ray gets anywhere
         * near the other's asphalt to notice.
         *
         * The two meet halfway, so their tarmac has to be visible out to
         * twice my claim for the halving below to see the pairs that matter.
         * Beyond that the split lands outside my claim anyway and nothing is
         * taken away.
         */
        if (t <= 0.05 || t >= limit * 2) continue;
        const u = (qx * dz - qz * dx) / den;
        if (u < 0 || u > 1) continue;

        if (k === 0) {
          if (t < left[curI]) left[curI] = t;
        } else if (t < right[curI]) right[curI] = t;
      }
    }
  };

  for (let i = 0; i < n; i++) {
    const f = frames[i];
    curI = i;
    curDist = f.dist;
    curLeft = f.widthL + kerbWL[i] + apronL[i] + runoffL[i];
    curRight = f.widthR + kerbWR[i] + apronR[i] + runoffR[i];
    const reach = Math.max(curLeft, curRight);
    if (reach <= 0) continue;
    fx = px[i];
    fz = pz[i];
    dlx = f.right.x;
    dlz = f.right.z;
    // A segment runs a step past its own cross section and its far edge sits a
    // half width out, so both have to be inside the query to be seen -- and
    // out to TWICE the claim, because what has to be found is the tarmac
    // behind the run off coming the other way, not the run off itself.
    index.within(fx, fz, reach * 2 + maxHalf + maxStep, visit);
  }

  // The allowance may not shrink faster than a metre per metre of track.
  // Without this the run off drops from full width to nothing between two
  // cross sections, and the edge doubles back on itself — a knot of its own,
  // just a tidier looking one.
  for (const [room, isLeft] of [[left, true], [right, false]] as const) {
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(room[i])) continue;
      /*
       * Share the corridor; do not take all of it.
       *
       * The ray stops at the other ribbon's TARMAC, and that is the right
       * place to stop asking -- but the other ribbon is asking the same
       * question in the opposite direction and stopping at MY tarmac. Granted
       * the whole gap each, the two run offs and the two barriers standing on
       * them are laid straight through one another. Measured on a paperclip
       * whose straights ran thirty metres apart: nineteen metres of claim from
       * each side, eight metres of barrier inside the other's.
       *
       * Halving what lies BETWEEN the two tarmac edges makes the two claims
       * come to exactly the separation, whatever the widths are: mine is
       * (myHalf + t)/2, theirs is (theirHalf + t')/2, and with t = D - theirHalf
       * and t' = D - myHalf those add to D. So the two meet and neither
       * crosses. The margin then opens the seam by a hand's width.
       */
      const half = isLeft ? frames[i].widthL : frames[i].widthR;
      room[i] = half + (room[i] - half) / 2;
      room[i] -= CLEARANCE_MARGIN;
    }
    const step = (a: number, b: number) => Math.hypot(px[b] - px[a], pz[b] - pz[a]);
    for (let pass = 0; pass < (closed ? 2 : 1); pass++) {
      for (let i = 1; i < n; i++) room[i] = Math.min(room[i], room[i - 1] + step(i - 1, i));
      if (closed) room[0] = Math.min(room[0], room[n - 1] + step(n - 1, 0));
      for (let i = n - 2; i >= 0; i--) room[i] = Math.min(room[i], room[i + 1] + step(i, i + 1));
      if (closed) room[n - 1] = Math.min(room[n - 1], room[0] + step(n - 1, 0));
    }
  }

  for (let i = 0; i < n; i++) {
    const f = frames[i];
    // Innermost first: the kerb keeps what room there is, then the tarmac
    // strip, and the grass takes whatever is left. Losing the kerb to keep the
    // grass would be the wrong way round -- the kerb is the bit you drive on.
    if (Number.isFinite(left[i])) {
      const kerbRoom = Math.max(0, left[i] - f.widthL);
      if (kerbWL[i] > kerbRoom) kerbWL[i] = kerbRoom;
      const apronRoom = Math.max(0, left[i] - f.widthL - kerbWL[i]);
      if (apronL[i] > apronRoom) apronL[i] = apronRoom;
      const shoulder = Math.max(0, apronRoom - apronL[i]);
      if (runoffL[i] > shoulder) runoffL[i] = shoulder;
    }
    if (Number.isFinite(right[i])) {
      const kerbRoom = Math.max(0, right[i] - f.widthR);
      if (kerbWR[i] > kerbRoom) kerbWR[i] = kerbRoom;
      const apronRoom = Math.max(0, right[i] - f.widthR - kerbWR[i]);
      if (apronR[i] > apronRoom) apronR[i] = apronRoom;
      const shoulder = Math.max(0, apronRoom - apronR[i]);
      if (runoffR[i] > shoulder) runoffR[i] = shoulder;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Kerb spans laid onto the cross sections                              */
/* ------------------------------------------------------------------ */

/** Where one span sits on this set of cross sections, in metres. */
export interface KerbRun {
  span: KerbSpan;
  /** Index in road.kerbs, so a cross section can point back at it. */
  index: number;
  pieces: Piece[];
  /** Arc length of the start of the span, and how long it is. */
  start: number;
  length: number;
  /**
   * Whether the span has ends at all. A kerb round the entire lap has none, and
   * tapering it would put a wedge at the start/finish line -- the one place the
   * author never drew an end.
   */
  ends: boolean;
}

export interface KerbLayout {
  runs: KerbRun[];
  total: number;
  /** Metres from the start of the span at this arc length, wrapping the seam. */
  along(run: KerbRun, dist: number): number;
  /** How much of its full size the kerb is at `s` metres into the span, 0..1. */
  wedge(run: KerbRun, s: number): number;
  /** Fill in span index, width, height and apron for one cross section. */
  at(
    i: number,
    side: -1 | 1,
    spanOut: Int32Array,
    widthOut: Float32Array,
    heightOut: Float32Array,
    apronOut: Float32Array,
  ): void;
}

/**
 * Work out, once per rebuild, where every kerb span lands on the cross sections.
 *
 * Both the side profile and the mesh builder need the same answer, and they
 * must not be able to disagree: the profile decides how wide the kerb is and
 * the mesh draws it, so a millimetre of daylight between the two rules shows up
 * as the run off starting somewhere other than where the kerb stops.
 */
export function kerbLayout(frames: Frame[], spans: readonly KerbSpan[], closed: boolean): KerbLayout {
  const total = pathLength(frames, closed);
  const runs: KerbRun[] = [];
  spans.forEach((span, index) => {
    const pieces = spanPieces(span, closed);
    if (pieces.length === 0) return;
    const extent = spanExtent(span, closed);
    const m = spanMetres(span, frames, closed, total);
    runs.push({
      span,
      index,
      pieces,
      start: m.start,
      length: m.length,
      ends: extent < 1 - 1e-6,
    });
  });

  const along = (run: KerbRun, dist: number) => {
    let s = dist - run.start;
    if (s < -1e-6) s += total;
    return s;
  };

  const wedge = (run: KerbRun, s: number) => {
    if (!run.ends || run.span.taper <= 1e-6 || run.length <= 1e-6) return 1;
    const reach = Math.min(run.span.taper, run.length / 2);
    if (reach <= 1e-6) return 1;
    const edge = Math.min(s, run.length - s);
    return Math.max(0, Math.min(1, edge / reach));
  };

  // Indexed rather than destructured: this is called twice per cross section,
  // and `for (const [a, b] of ...)` builds an iterator and a pair of bindings
  // every time round.
  const covers = (run: KerbRun, t: number) => {
    for (let k = 0; k < run.pieces.length; k++) {
      const p = run.pieces[k];
      if (t >= p[0] - 1e-6 && t <= p[1] + 1e-6) return true;
    }
    return false;
  };

  /*
   * The span each side was on last time. Callers walk the cross sections in
   * order and a span covers a run of them, so the answer is almost always the
   * previous one -- checking it first turns a scan of every span on the
   * circuit, at every one of a couple of thousand cross sections, into two
   * comparisons.
   */
  const lastRun: [number, number] = [-1, -1];

  const apply = (run: KerbRun, i: number, spanOut: Int32Array, widthOut: Float32Array, heightOut: Float32Array, apronOut: Float32Array) => {
    const w = wedge(run, along(run, frames[i].dist));
    spanOut[i] = run.index;
    widthOut[i] = run.span.style === 'none' ? 0 : run.span.width * w;
    heightOut[i] = run.span.style === 'none' ? 0 : run.span.height * w;
    apronOut[i] = run.span.apron * w;
  };

  const at: KerbLayout['at'] = (i, side, spanOut, widthOut, heightOut, apronOut) => {
    const t = frames[i].t;
    const slot = side < 0 ? 0 : 1;
    const cached = lastRun[slot];
    if (cached >= 0 && covers(runs[cached], t)) {
      apply(runs[cached], i, spanOut, widthOut, heightOut, apronOut);
      return;
    }
    for (let k = 0; k < runs.length; k++) {
      const run = runs[k];
      if (run.span.side !== side || !covers(run, t)) continue;
      lastRun[slot] = k;
      apply(run, i, spanOut, widthOut, heightOut, apronOut);
      return;
    }
    lastRun[slot] = -1;
  };

  return { runs, total, along, wedge, at };
}

export function sideProfile(
  frames: Frame[],
  road: RoadSettings,
  pitFrames: Frame[] = [],
  /** Whether `frames` form a ring, so the clearance sweep wraps at the seam. */
  closed = false,
  /**
   * Width of the concrete beside the pit lane, which the run off keeps off:
   * one width, or the tapered run pitApronWidths gives for `pitFrames`. It has
   * to be the same figure the ribbon is actually drawn at, or the run off stops
   * short of concrete that is not there and what shows between them is bare
   * ground at the very edge of the racing line.
   */
  pitApron: number | Float32Array = PIT_APRON,
  /**
   * Where the circuit has already taken the lane back: the drawn band per pit
   * cross section, from pitRoadClip. With it, the clearance measures against
   * the surface that is REALLY drawn -- so past the wedge tip, where the clip
   * has taken the whole band, there is nothing left to keep off and the run
   * off comes back. Without it (the tools, and old callers) the raw widths
   * stand in, which overstate the ribbon by exactly the tucked-under part.
   */
  pitClip?: PitClip,
): SideProfile {
  const n = frames.length;
  const runoffL = new Float32Array(n);
  const runoffR = new Float32Array(n);
  const kerbWL = new Float32Array(n);
  const kerbWR = new Float32Array(n);
  const kerbHL = new Float32Array(n);
  const kerbHR = new Float32Array(n);
  const kerbSpanL = new Int32Array(n).fill(-1);
  const kerbSpanR = new Int32Array(n).fill(-1);
  const apronL = new Float32Array(n);
  const apronR = new Float32Array(n);
  const wallL = new Uint8Array(n);
  const wallR = new Uint8Array(n);
  const wallGapL = new Float32Array(n);
  const wallGapR = new Float32Array(n);
  // Which cross sections the pit clearance actually cut: see the steadying
  // pass at the end of the loop.
  const pitCut = new Uint8Array(n);
  // What was asked for before any of the clamps below had their say, so the
  // height can be brought down by the same fraction the width was.
  const wantL = new Float32Array(n);
  const wantR = new Float32Array(n);

  const kerbs = kerbLayout(frames, road.kerbs, closed);

  const usePit = pitFrames.length >= 2;
  const index = usePit ? new PointIndex(pitFrames.map((f) => f.pos), 30) : null;
  let sideVotes = 0;

  // How far the pit lane can possibly reach into the road's side.
  let maxSide = 0;
  for (const f of frames) maxSide = Math.max(maxSide, f.widthL, f.widthR);
  let maxPitHalf = 0;
  for (const f of pitFrames) maxPitHalf = Math.max(maxPitHalf, f.widthL, f.widthR);
  /*
   * The box the pit lane lives in, so most cross sections never touch the
   * spatial index at all. The search radius below is tens of metres wide, and a
   * query that big walks a good many buckets: on a circuit whose pit lane is a
   * few hundred metres of a three kilometre lap, nine tenths of the cross
   * sections cannot possibly be near it and can be answered with four
   * comparisons instead.
   */
  let pitMinX = Infinity;
  let pitMaxX = -Infinity;
  let pitMinZ = Infinity;
  let pitMaxZ = -Infinity;
  for (const f of pitFrames) {
    if (f.pos.x < pitMinX) pitMinX = f.pos.x;
    if (f.pos.x > pitMaxX) pitMaxX = f.pos.x;
    if (f.pos.z < pitMinZ) pitMinZ = f.pos.z;
    if (f.pos.z > pitMaxZ) pitMaxZ = f.pos.z;
  }

  for (let i = 0; i < n; i++) {
    const f = frames[i];
    runoffL[i] = road.runoffWidth * f.runoffL;
    runoffR[i] = road.runoffWidth * f.runoffR;
    kerbs.at(i, -1, kerbSpanL, kerbWL, kerbHL, apronL);
    kerbs.at(i, 1, kerbSpanR, kerbWR, kerbHR, apronR);
    wantL[i] = kerbWL[i];
    wantR[i] = kerbWR[i];
    wallL[i] = road.wall && f.wallL ? 1 : 0;
    wallR[i] = road.wall && f.wallR ? 1 : 0;
    wallGapL[i] = f.wallGapL;
    wallGapR[i] = f.wallGapR;

    // Tight bends first: nothing on the inside may reach past the centre of
    // the turn, or the strip folds back over the track -- and nothing may take
    // more than its share of the infield either, or the barrier ends up wound
    // into a knot at the apex with the run off filling the corner.
    for (const side of SIDES) {
      const room = Math.min(innerRoom(f, side), infieldRoom(f, side));
      if (!Number.isFinite(room)) continue;
      const half = side < 0 ? f.widthL : f.widthR;
      const kerbRoom = Math.max(0, room - half);
      if (side < 0) {
        if (kerbWL[i] > kerbRoom) kerbWL[i] = kerbRoom;
        const apronRoom = Math.max(0, room - half - kerbWL[i]);
        if (apronL[i] > apronRoom) apronL[i] = apronRoom;
        const shoulderRoom = Math.max(0, apronRoom - apronL[i]);
        if (runoffL[i] > shoulderRoom) runoffL[i] = shoulderRoom;
      } else {
        if (kerbWR[i] > kerbRoom) kerbWR[i] = kerbRoom;
        const apronRoom = Math.max(0, room - half - kerbWR[i]);
        if (apronR[i] > apronRoom) apronR[i] = apronRoom;
        const shoulderRoom = Math.max(0, apronRoom - apronR[i]);
        if (runoffR[i] > shoulderRoom) runoffR[i] = shoulderRoom;
      }
    }

    if (!index) continue;

    /*
     * How far away the pit lane could still matter AT THIS CROSS SECTION.
     *
     * It used to be one worst case radius for the whole track: the widest road
     * plus twice the run off setting plus the widest point of the lane. On a
     * circuit with a wide run off that is seventy metres, four times the area
     * that actually matters, and it was paid for at every one of a couple of
     * thousand cross sections. The clamps below can only bite inside this
     * distance, so anything beyond it is a query for an answer nobody reads.
     */
    const reach =
      Math.max(f.widthL, f.widthR) +
      Math.max(kerbWL[i] + apronL[i], kerbWR[i] + apronR[i]) +
      Math.max(runoffL[i], runoffR[i]) +
      maxPitHalf +
      road.pitGap +
      1;
    const bx = Math.max(pitMinX - f.pos.x, 0, f.pos.x - pitMaxX);
    const bz = Math.max(pitMinZ - f.pos.z, 0, f.pos.z - pitMaxZ);
    if (bx * bx + bz * bz > reach * reach) continue;

    const pi = index.nearest(f.pos.x, f.pos.z, reach);
    if (pi < 0) continue;

    const pf = pitFrames[pi];
    const dx = pf.pos.x - f.pos.x;
    const dz = pf.pos.z - f.pos.z;
    // Signed distance to the pit lane centre, measured across the road.
    const lateral = dx * f.right.x + dz * f.right.z;
    const side = lateral < 0 ? -1 : 1;
    const pitHalf = side < 0 ? pf.widthR : pf.widthL;

    sideVotes += side;

    /*
     * Where the lane's asphalt actually begins BESIDE THIS CROSS SECTION.
     *
     * The nearest frame is not it: the lead-out wedge runs diagonally at the
     * junction, so the nearest pit CENTRE often belongs to a slice metres
     * further in or out than what lies alongside here -- measured on the demo
     * circuit, the run off cut to nothing while the ribbon it was cut for was
     * still a metre and a half away, and the strip between them was bare
     * ground. So the edge is taken over every pit slice that is actually
     * abreast of this cross section, at its nearest.
     */
    let nearLat = Infinity;
    /* The concrete beside the cross section of the lane that is actually
       nearest, not the widest the setting allows: the apron fades out across
       the lead-out, and a clearance measured off the full width leaves the run
       off stopping a metre short of concrete that ends before it. */
    let nearApron = typeof pitApron === 'number' ? pitApron : 0;
    /* How far the lane reaches on its FAR side, away from the circuit.
       The near edge above says where the pit surface starts; this says whether
       there is any of it left out here at all once the tarmac has taken its
       share. See `clear` below, which is the only thing that reads it. */
    let farLat = -Infinity;
    index.within(f.pos.x, f.pos.z, reach, (j) => {
      const qf = pitFrames[j];
      const qdx = qf.pos.x - f.pos.x;
      const qdz = qf.pos.z - f.pos.z;
      const alongQ = qdx * f.fwd.x + qdz * f.fwd.z;
      if (Math.abs(alongQ) > 6) return;
      const latQ = qdx * f.right.x + qdz * f.right.z;
      if (latQ < 0 !== side < 0) return;
      const apronQ = typeof pitApron === 'number' ? pitApron : (pitApron[j] ?? 0);
      let nl: number;
      let fl: number;
      if (pitClip) {
        /* The drawn band, projected onto this cross section's own axis. Its
           offsets live along the PIT frame's right vector, so the projection
           scales by how parallel the two ribbons run; head-on the band
           collapses to a point at the lane's centre, which is the honest
           answer. The band already contains the concrete, so there is no
           apron left to subtract. */
        const bLo = pitClip.lo[j];
        const bHi = pitClip.hi[j];
        if (bHi - bLo <= 1e-3) return; // nothing drawn here: nothing to keep off
        const dotQ = qf.right.x * f.right.x + qf.right.z * f.right.z;
        const e1 = Math.abs(latQ + bLo * dotQ);
        const e2 = Math.abs(latQ + bHi * dotQ);
        nl = Math.min(e1, e2);
        fl = Math.max(e1, e2);
        if (nl < nearLat) {
          nearLat = nl;
          nearApron = 0;
        }
      } else {
        nl = Math.abs(latQ) - (side < 0 ? qf.widthR : qf.widthL);
        if (nl < nearLat) {
          nearLat = nl;
          nearApron = apronQ;
        }
        fl = Math.abs(latQ) + (side < 0 ? qf.widthL : qf.widthR) + apronQ;
      }
      if (fl > farLat) farLat = fl;
    });
    // Nothing abreast (the lane only passes at a distance): the old estimate.
    if (!Number.isFinite(nearLat)) nearLat = Math.abs(lateral) - pitHalf;
    if (!Number.isFinite(farLat)) {
      farLat = Math.abs(lateral) + (side < 0 ? pf.widthL : pf.widthR) + nearApron;
    }

    /*
     * Free space between the road centre and the near edge of the pit lane --
     * which is the edge of its CONCRETE, not of its tarmac.
     *
     * This used to measure to the tarmac, so the run off was allowed to reach
     * to within the gap of it and ran straight across the concrete beside it.
     * With 2.5 m of concrete and a 3 m gap that happened to come out half a
     * metre short and nobody saw it; widen the concrete past the gap and the
     * run off lies on top of it, two drivable surfaces in the same place
     * decided per pixel by the depth buffer.
     */
    const nearEdge = nearLat - nearApron;
    const free = nearEdge - road.pitGap;

    // Where the pit ribbon physically reaches into the kerb strip, drop the
    // kerb entirely: the pit surface replaces it there. A kerb carrying on
    // across the pit entry pokes up through the lane, which was the visible
    // mess at the junction. Independent of the clearance toggle, because two
    // meshes through the same space are wrong no matter the setting.
    const roadHalf = side < 0 ? f.widthL : f.widthR;
    const kerbW = side < 0 ? kerbWL[i] : kerbWR[i];
    // Measured on the concrete too: a kerb standing up through the apron beside
    // the lane is exactly as wrong as one standing up through its tarmac.
    if (kerbW > 0 && nearEdge < roadHalf + kerbW + 0.1) {
      if (side < 0) {
        kerbWL[i] = 0;
        apronL[i] = 0;
      } else {
        kerbWR[i] = 0;
        apronR[i] = 0;
      }
    }

    if (!road.pitClearance) continue;

    const kerb = (side < 0 ? kerbWL[i] + apronL[i] : kerbWR[i] + apronR[i]);
    const allowed = Math.max(0, free - roadHalf - kerb);

    /* The barrier squeezes rather than disappears.
     *
     * It used to be deleted outright wherever the pit lane came within a run
     * off width, which is most of the entry and exit -- so the one stretch
     * that most wants a pit wall was the one stretch that could not have one,
     * and switching it back on in the barrier tool did nothing. The run off
     * above has already been narrowed to whatever room there is, so leaving
     * the barrier alone simply stands it at that edge, between the track and
     * the lane, which is where a pit wall belongs.
     *
     * It still goes when there is genuinely nowhere to stand: with the lane
     * hard against the tarmac, the only place left would be the racing line.
     */
    const room = allowed >= MIN_WALL_ROOM;
    /*
     * Nothing to clear where the ribbon has gone under the tarmac.
     *
     * At a junction the lane runs onto the circuit, and pitRoadClip takes away
     * every part of it that lands there -- so where the whole ribbon has gone
     * under, a run off narrowed to keep off it is keeping off nothing. What
     * that leaves instead is bare ground straight off the racing line, with
     * the concrete it was avoiding clipped away metres inside the tarmac.
     *
     * Which is decided on the lane's FAR edge, not its near one. Measured on
     * the near edge this read "gone under" from the moment the lane's own
     * centre line crossed the tarmac, which is most of the entry and the exit
     * -- and at those cross sections the clip does not empty the band, it
     * moves it: what survives is the wedge lying BESIDE the track, running out
     * to twenty metres and more. Switching the clearance off there let the run
     * off keep its full width and draw straight across that wedge, two
     * surfaces in the same place along the whole of both junctions, which is
     * the same fault as concrete under a run off and looks the same in the
     * viewport: the pit lane torn along its edges by the ground beside the
     * track. Measured on the demo oval, 32 cross sections with 12 m of overlap
     * apiece; on a generated circuit, 26.
     *
     * The far edge says what the clip really leaves. Reaching a good way past
     * the circuit, there is a wedge to keep off, and the rules below narrow
     * the run off to nothing against it -- which is right, because the wedge
     * is what covers that ground instead. Inboard and the ribbon is genuinely
     * gone, and the run off carries on over the top of where it used to be.
     *
     * A metre, not nothing, because the wedge tapers out rather than stopping.
     * On its last cross sections it is a few centimetres wide, and a run off
     * pulled to nothing against THAT covers nothing: measured on a lane
     * dragged in by hand, 2 cm of wedge and 80 cm of bare ground behind it,
     * straight off the racing line, which is the trench again. Under a metre
     * the wedge is worth less than the surface is, so the run off runs on over
     * it -- the same trade, and the same metre, as the slot rule below.
     */
    const clear = farLat - roadHalf - kerb >= 1;
    /* Where there is no room for the gap there is no room for a gap at all.
     *
     * The run off is meant to stop short of the lane, and it does. But once
     * the lane is closer than the gap itself, stopping short means stopping
     * at nothing: the surface simply ends at the tarmac and what shows beside
     * the racing line is bare ground, pulled down under the road by the
     * corridor, which reads as a trench. Measured on the demo circuit beside
     * the junction: half a metre of it, straight off the edge.
     *
     * So in that case the run off fills what is actually there, up to the
     * concrete beside the lane. The BARRIER still keeps its full clearance --
     * that is what the gap is for, and it is dropped outright below
     * MIN_WALL_ROOM either way.
     */
    const tight = Math.max(0, nearEdge - roadHalf - kerb);
    /*
     * Under a metre is not a run off, it is a slot.
     *
     * The first branch leaves the gap the pit wall stands in, which is right
     * while there is room for both. Squeeze it and the two want opposite
     * things: what is left of the run off shrinks towards nothing while the
     * gap keeps its full width, so the surface beside the racing line ends a
     * hand's width off the tarmac and the next three metres are bare ground --
     * ground the corridor has pulled down under the road, so what shows is a
     * dark slot at the edge of the circuit. Below a metre the run off is worth
     * less than the gap is, and it runs on to the concrete instead.
     */
    let surface = allowed > 1 ? allowed : Math.min(tight, road.pitGap);
    /* A sliver of bare ground less than a metre wide is not a paddock, it is
       a trench: the ground under it is pulled down below the road, and what
       shows beside the racing line is a dark slot. Where the run off would
       stop that close to the concrete anyway, it runs on and closes onto it. */
    if (tight > surface && tight - surface < 1) surface = tight;
    if (side < 0) {
      if (clear && surface < runoffL[i]) { runoffL[i] = surface; pitCut[i] = 1; }
      if (!room) wallL[i] = 0;
    } else {
      if (clear && surface < runoffR[i]) { runoffR[i] = surface; pitCut[i] = 1; }
      if (!room) wallR[i] = 0;
    }
  }

  /* The clearance, steadied along the track.
   *
   * Every number it is cut from -- the near edge of the drawn band, the width
   * of the concrete abreast -- is read off SAMPLED cross sections through a
   * six metre window, and which samples fall in the window changes from one
   * track section to the next. Along a stretch where the lane runs parallel,
   * the run off it left came out half a metre to three metres wide by turns,
   * section against section: a sawtooth of grass strip against bare pad,
   * read in the viewport as a row of clipped triangles beside the pit entry.
   *
   * A short MIN window takes the spikes of width out and leaves the cuts in:
   * it can only ever pull the run off further off the concrete, so the one
   * guarantee this clearance makes -- keep off the drawn band -- survives by
   * construction. Two sections either side is seven metres, the scale of the
   * jitter and well under the scale of a real mouth.
   */
  for (const arr of [runoffL, runoffR]) {
    const raw = arr.slice();
    for (let i = 0; i < n; i++) {
      /* Only the open-strip regime. Under about a metre the width is the slot
         rule's carefully chosen answer -- run on to the concrete, or exactly
         fill what is there -- and dragging a neighbour's smaller figure over
         it reopened the very slots it exists to close, a metre of bare ground
         off the tarmac at both mouths. Those sections keep their own answer,
         and they do not drag the open strip beside them down either. */
      if (raw[i] <= 1.2) continue;
      let near = false;
      for (let k = -2; k <= 2 && !near; k++) {
        const j = closed ? (i + k + n) % n : Math.min(n - 1, Math.max(0, i + k));
        if (pitCut[j]) near = true;
      }
      if (!near) continue;
      let v = raw[i];
      for (let k = -2; k <= 2; k++) {
        const j = closed ? (i + k + n) % n : Math.min(n - 1, Math.max(0, i + k));
        if (raw[j] > 1.2 && raw[j] < v) v = raw[j];
      }
      arr[i] = v;
    }
  }

  // Last, so it sees the widths the rules above settled on and can only ever
  // take more away.
  applyCorridorClearance(frames, closed, kerbWL, kerbWR, apronL, apronR, runoffL, runoffR);

  // ... and after even that, so a shoulder any of them cut runs out as a wedge
  // rather than a step. See SHOULDER_TAPER: this only ever narrows.
  limitTaper(runoffL, frames, closed);
  limitTaper(runoffR, frames, closed);

  /* Height follows width.
   *
   * Everything above narrows a kerb without knowing anything about how tall it
   * is. Left alone that leaves a kerb squeezed to 10 cm of width still standing
   * its full height: a vertical lip along the edge of the tarmac, which is both
   * ugly and a wheel breaker. Bringing the height down by the same fraction
   * turns the squeeze into the kerb quietly running out instead.
   */
  for (let i = 0; i < n; i++) {
    if (wantL[i] > 1e-4) kerbHL[i] *= Math.min(1, kerbWL[i] / wantL[i]);
    else if (kerbWL[i] <= 1e-4) kerbHL[i] = 0;
    if (wantR[i] > 1e-4) kerbHR[i] *= Math.min(1, kerbWR[i] / wantR[i]);
    else if (kerbWR[i] <= 1e-4) kerbHR[i] = 0;
  }

  return {
    runoffL,
    runoffR,
    kerbWL,
    kerbWR,
    kerbHL,
    kerbHR,
    kerbSpanL,
    kerbSpanR,
    apronL,
    apronR,
    wallL,
    wallR,
    wallGapL,
    wallGapR,
    pitSide: sideVotes === 0 ? 0 : sideVotes < 0 ? -1 : 1,
  };
}

/**
 * Stretch a profile computed on the raw frames to the ring `expand` builds.
 * The appended seam frame is a copy of frame 0, so its profile row is row 0.
 * Copying six small arrays is far cheaper than running `sideProfile` again,
 * which was the single most expensive step of a road rebuild done twice.
 */
function extendProfile(p: SideProfile, n: number): SideProfile {
  const grow = (a: Float32Array) => {
    const b = new Float32Array(n);
    b.set(a);
    b[n - 1] = a[0];
    return b;
  };
  const growFlags = (a: Uint8Array) => {
    const b = new Uint8Array(n);
    b.set(a);
    b[n - 1] = a[0];
    return b;
  };
  const growIdx = (a: Int32Array) => {
    const b = new Int32Array(n);
    b.set(a);
    b[n - 1] = a[0];
    return b;
  };
  return {
    runoffL: grow(p.runoffL),
    runoffR: grow(p.runoffR),
    kerbWL: grow(p.kerbWL),
    kerbWR: grow(p.kerbWR),
    kerbHL: grow(p.kerbHL),
    kerbHR: grow(p.kerbHR),
    kerbSpanL: growIdx(p.kerbSpanL),
    kerbSpanR: growIdx(p.kerbSpanR),
    apronL: grow(p.apronL),
    apronR: grow(p.apronR),
    wallL: growFlags(p.wallL),
    wallR: growFlags(p.wallR),
    wallGapL: grow(p.wallGapL),
    wallGapR: grow(p.wallGapR),
    pitSide: p.pitSide,
  };
}

export interface RoadEdges {
  /** Outer edge of the run off area, per frame. Left and right. */
  outerL: THREE.Vector3[];
  outerR: THREE.Vector3[];
  /** Outer edge of the tarmac + kerb, per frame. */
  edgeL: THREE.Vector3[];
  edgeR: THREE.Vector3[];
  /** Outer edge of the coloured tarmac strip. Equals `edge` where there is none. */
  apronEL: THREE.Vector3[];
  apronER: THREE.Vector3[];
  frames: Frame[];
}

/** How far the outside of the coloured strip sits below the road plane. */
const APRON_DROP = 0.02;

/** Precompute all the edge lines once, everything else derives from them. */
const tmpL = new THREE.Vector3();
const tmpR = new THREE.Vector3();
const tmpFlat = new THREE.Vector3();

export function computeEdges(fr: Frame[], road: RoadSettings, profile: SideProfile): RoadEdges {
  const s = takeScratch(fr.length);
  const outerL = s.outerL;
  const outerR = s.outerR;
  const edgeL = s.edgeL;
  const edgeR = s.edgeR;
  const apronEL = s.apronEL;
  const apronER = s.apronER;

  fr.forEach((f, i) => {
    const roadL = tmpL.copy(f.pos).addScaledVector(f.right, -f.widthL);
    const roadR = tmpR.copy(f.pos).addScaledVector(f.right, f.widthR);

    const kL = profile.kerbWL[i];
    const kR = profile.kerbWR[i];
    // Heights come from the profile, which has already brought them down in
    // step with whatever the width had to give up.
    const eL = edgeL[i].copy(roadL);
    if (kL > 0.01) eL.addScaledVector(f.right, -kL).addScaledVector(f.up, profile.kerbHL[i]);
    const eR = edgeR[i].copy(roadR);
    if (kR > 0.01) eR.addScaledVector(f.right, kR).addScaledVector(f.up, profile.kerbHR[i]);

    /* The coloured tarmac strip.
     *
     * It comes off the top of the kerb and returns to the road plane, ending a
     * couple of centimetres below it. That slope is what keeps it drivable:
     * dropping the full kerb height in one vertical face would be a step to
     * catch a wheel on, and staying up at kerb height would leave the same step
     * where the grass begins.
     */
    const aL = profile.apronL[i];
    const aR = profile.apronR[i];
    const pL = apronEL[i].copy(eL);
    if (aL > 0.01) {
      pL.addScaledVector(f.right, -aL)
        .addScaledVector(f.up, -profile.kerbHL[i])
        .addScaledVector(DOWN, APRON_DROP);
    }
    const pR = apronER[i].copy(eR);
    if (aR > 0.01) {
      pR.addScaledVector(f.right, aR)
        .addScaledVector(f.up, -profile.kerbHR[i])
        .addScaledVector(DOWN, APRON_DROP);
    }

    /*
     * The run off goes out FLAT, not along the tilted frame.
     *
     * Offsetting along `f.right` continues the camber for the whole width of
     * the shoulder, which on a banked corner drops its outer edge -- and the
     * barrier standing there -- several metres below the road. The lateral step
     * is taken along the horizontal part of `right`, and the height it should
     * gain from the banking is added back separately, fading out over the first
     * few metres. On a flat circuit `right.y` is 0 and this is exactly what it
     * always did.
     */
    const wL = profile.runoffL[i];
    const wR = profile.runoffR[i];
    const flat = tmpFlat.set(f.right.x, 0, f.right.z);
    const flatLen = flat.length();
    if (flatLen > 1e-6) flat.multiplyScalar(1 / flatLen);
    else flat.set(0, 0, 0);

    /* And the last of the run off goes down by EDGE_SINK, exactly as the pit
       apron's outer edge does: the terrain is deliberately kept that far under
       every road mesh, and at the outer edge, where the mesh stops and the
       ground becomes the surface you see, that gap has nothing left to hide
       behind. Without the bevel it stood along every run off edge as a step
       of a few centimetres of bare cut earth -- the crease that made every
       grass verge look torn. The corridor eases the ground up to exactly
       EDGE_SINK under this edge, so the two now meet. */
    outerL[i]
      .copy(pL)
      .addScaledVector(flat, -wL)
      .addScaledVector(
        DOWN,
        runoffBankRise(f.right.y, wL)
          + shoulderDrop(road.runoffDrop, wL, road.runoffWidth)
          + EDGE_SINK * (wL > THIN ? 1 : 0),
      );
    outerR[i]
      .copy(pR)
      .addScaledVector(flat, wR)
      .addScaledVector(
        DOWN,
        -runoffBankRise(f.right.y, wR)
          + shoulderDrop(road.runoffDrop, wR, road.runoffWidth)
          + EDGE_SINK * (wR > THIN ? 1 : 0),
      );
  });

  return { outerL, outerR, edgeL, edgeR, apronEL, apronER, frames: fr };
}

/**
 * What the ground brush has painted where the run off is, so the strip between
 * the circuit and the barrier can be made of it.
 *
 * Handed in as a lookup rather than the paint field itself, because the field
 * lives in terrain.ts and terrain.ts already reads this module: the shape of
 * the run off is what the ground is blended up to meet. A callback keeps the
 * dependency one way round.
 */
export interface RunoffGround {
  /** The materials the run off may be built from, by index. */
  kinds: ReadonlyArray<{ surface: SurfaceKey; material: MaterialKey }>;
  /** Which of them the ground is at a point, or -1 where nobody has painted. */
  at: (x: number, z: number) => number;
  /**
   * Spacing of the paint samples in metres, so the strip can be split as
   * finely as the paint can actually answer. Optional so a caller without a
   * paint field to measure gets the old coarse split.
   */
  cell?: number;
  /**
   * The terrain's sub-cell cutter: given the materials at the four corners of
   * one cell, hands back the ring(s) each material keeps, on the half-step
   * lattice terrain.ts documents (0 and 2 are corners, 1 a crossing point).
   * Handed in as a callback because terrain.ts already imports this module,
   * so this module cannot import it back. Without it a mixed cell falls to
   * the material of its low corner, which is the old blocky behaviour.
   */
  cutCell?: (
    m0: number,
    m1: number,
    m2: number,
    m3: number,
    emit: (kind: number, ring: number[]) => void,
  ) => void;
}

/**
 * Build every mesh of the main road corridor.
 *
 * Mesh names follow the AC convention: a leading digit that the engine skips,
 * then the surface KEY from surfaces.ini, then a free description.
 */
export function buildRoadMeshes(
  frames: Frame[],
  closed: boolean,
  road: RoadSettings,
  pitFrames: Frame[] = [],
  reuse?: Map<string, THREE.BufferGeometry>,
  /** Profile already computed on `frames`; passed in so it is not computed twice. */
  precomputedProfile?: SideProfile,
  /**
   * Paint the pit junction leaves ON the circuit: the line a car coming out of
   * the pits has to stay behind, and its mirror image at the entry.
   */
  pitLines: PitTrackLine[] = [],
  /** The ground brush's say over the run off. Undefined leaves it one material. */
  ground?: RunoffGround,
): MeshDef[] {
  if (frames.length < 2) return [];
  const fr = expand(frames, closed);
  const profile = precomputedProfile
    ? fr === frames
      ? precomputedProfile
      : extendProfile(precomputedProfile, fr.length)
    : sideProfile(fr, road, pitFrames);
  const e = computeEdges(fr, road, profile);
  // Built on the raw frames, not the ring: `expand` appends a copy of the first
  // cross section whose `t` is 0 again, and a layout needs `t` to run forwards.
  // The seam row of the profile points at the same span either way, and the
  // appended frame's own arc length is the full lap, so the phase of a ripple
  // or a row of bumps carries across the seam correctly.
  const layout = kerbLayout(frames, road.kerbs, closed);
  const n = fr.length;
  const out: MeshDef[] = [];

  const scratch = takeScratch(n);
  const v = scratch.v;
  const zeros = scratch.zeros;
  const ones = scratch.ones;
  const uA = scratch.uA;
  const uB = scratch.uB;
  for (let i = 0; i < n; i++) v[i] = fr[i].dist / road.uvLength;

  const emit = (
    name: string,
    material: MaterialKey,
    surface: SurfaceKey,
    fill: (b: StripBuilder) => void,
    capacity = n * 2,
  ) => {
    const b = new StripBuilder(reuse?.get(name), capacity);
    fill(b);
    if (b.empty) {
      b.discard();
      return;
    }
    out.push({ name, material, surface, geometry: b.finish() });
  };

  /* --- tarmac and the painted edge line -------------------------------- */
  const roadL = scratch.left;
  const roadR = scratch.right;
  const lineL = scratch.lineL;
  const lineR = scratch.lineR;
  /*
   * The line is cut OUT of the tarmac rather than laid on top of it. A strip
   * floating above the road z-fights with it at distance; one at exactly the
   * same height needs its own physics surface over the road's, which is the
   * pit lane seam bug all over again. Taking the outermost 14 cm of the road
   * mesh and painting it white costs nothing and cannot come apart.
   */
  const lineWidth = road.edgeLine ? Math.max(0, road.edgeLineWidth) : 0;
  let hasLine = false;
  for (let i = 0; i < n; i++) {
    roadL[i].copy(fr[i].pos).addScaledVector(fr[i].right, -fr[i].widthL);
    roadR[i].copy(fr[i].pos).addScaledVector(fr[i].right, fr[i].widthR);
    uB[i] = (fr[i].widthL + fr[i].widthR) / road.uvWidth;
    // Never more than a third of the lane: on a road narrowed to nothing at the
    // apex of an impossibly tight bend, a fixed width line would be the road.
    const wl = Math.min(lineWidth, fr[i].widthL / 3);
    const wr = Math.min(lineWidth, fr[i].widthR / 3);
    lineL[i].copy(roadL[i]).addScaledVector(fr[i].right, wl);
    lineR[i].copy(roadR[i]).addScaledVector(fr[i].right, -wr);
    if (wl > 0.005 || wr > 0.005) hasLine = true;
  }
  const tarmacL = hasLine ? lineL : roadL;
  const tarmacR = hasLine ? lineR : roadR;

  /* --- the pit junction on the edge line ---------------------------------
   *
   * What a real circuit does at a junction is redraw the EDGE line itself: it
   * keeps running along the tarmac edge -- the seam between the circuit and
   * the pit surface lying beside it -- and exactly where the pit asphalt
   * crosses it, it is dashed instead of solid. That is the mouth, trimmed a
   * few metres at each end: the handover point still has concrete beside the
   * lane, and the last metres of the wedge are a hairline sliver, so dashes
   * running the full span read as starting before the asphalt and ending
   * after it.
   */
  const dashL = scratch.paint;
  const dashR = scratch.dash;
  const vDash = scratch.vDash;
  const total = fr[n - 1].dist;
  /** Signed arc distance from `at` in the line's direction. Wraps on a lap. */
  const along = (d: number, at: number, dir: 1 | -1): number => {
    let rel = (d - at) * dir;
    if (closed && total > 0) {
      rel = ((rel % total) + total) % total;
      if (rel > total / 2) rel -= total;
    }
    return rel;
  };
  let hasDash = false;
  for (let i = 0; i < n; i++) {
    dashL[i] = 0;
    dashR[i] = 0;
    vDash[i] = fr[i].dist / PIT_DASH;
    for (const line of pitLines) {
      const rel = along(fr[i].dist, line.junction, line.dir);
      const trim = Math.min(MOUTH_DASH_TRIM, line.mouth * 0.2);
      if (rel < trim || rel > line.mouth - trim) continue;
      if (line.side < 0) dashL[i] = 1;
      else dashR[i] = 1;
      hasDash = true;
    }
  }

  /* --- the pit exit's boundary line on the racing surface ----------------
   *
   * A car leaving the pits joins the circuit at the tip of the exit wedge and
   * then has to stay out of the racing line until it is up to speed: real
   * circuits paint a solid line from the merge point on down the road, and a
   * driver may not cross it. So from the far end of the exit mouth the line
   * peels off the edge line, leans in to about a car's width, and runs solid
   * until it stops. The ENTRY gets nothing: peeling off into the pits needs
   * no boundary, and the leaning line it used to have read as paint smeared
   * across the track.
   *
   * It runs metres INSIDE the tarmac, so it cannot be a strip along the edge
   * and must not be a strip laid on top -- a surface floating above the road
   * z-fights at distance. The road is therefore drawn in three bands wherever
   * the line runs -- inside it, the line itself, outside it -- and in one
   * band everywhere else. `cutA` and `cutB` collapse onto the right hand edge
   * where there is no line, so the inner band alone covers the full width
   * there and the other two are degenerate.
   */
  const cutA = scratch.cutA;
  const cutB = scratch.cutB;
  const exitPaint = scratch.lane;
  const uCutA = scratch.uCutA;
  const uCutB = scratch.uCutB;
  for (let i = 0; i < n; i++) {
    exitPaint[i] = 0;
    cutA[i].copy(tarmacR[i]);
    cutB[i].copy(tarmacR[i]);
    uCutA[i] = uB[i];
    uCutB[i] = uB[i];
    for (const line of pitLines) {
      if (line.kind !== 'exit') continue;
      // Anchored at the START of the mouth, where the lane's own edge line
      // hands over: the boundary runs BESIDE the merging wedge -- solid on
      // the inside while the seam next to it is dashed -- and carries on
      // down the road after the wedge has run out. Starting it at the far
      // end instead put the whole line after the merge, where the car it is
      // meant to hold back had already joined the traffic.
      //
      // It reaches ONE cross section short of the junction at FULL width,
      // lying against the inside of the edge line, so it visibly grows out
      // of that line instead of appearing mid-tarmac. (It used to close to a
      // zero-width point there, but a plate that fades from nothing over ten
      // metres reads as the line thinning out at the one spot everybody
      // looks at.) A strip that simply starts at the first section past the
      // junction left a gap of a few metres before the paint appeared.
      const rel = along(fr[i].dist, line.junction, line.dir);
      const secLen = total / Math.max(1, n - 1);
      if (rel < -1.5 * secLen || rel > EXIT_LINE_RAMP + EXIT_LINE_RUN) continue;
      const f = fr[i];
      const half = line.side < 0 ? f.widthL : f.widthR;
      const width = Math.min(lineWidth > 0 ? lineWidth : 0.14, half / 3);
      // Leaning in from flush against the INSIDE of the road's own edge line,
      // so the paint looks like it peels off the edge of the circuit -- at a
      // ramp short enough to read as a line CROSSING onto the road. Leant
      // over the whole mouth it was so shallow it read as a second edge line.
      const t = Math.min(1, Math.max(0, rel) / EXIT_LINE_RAMP);
      const lane = Math.min(EXIT_LINE_LANE, half * 0.55);
      if (!(lane > 0.5)) continue;
      const inset = 2 * width + Math.max(0, lane - 2 * width) * t;
      const inner = Math.max(0, half - inset);
      // Offsets from the road centre, always ordered left to right.
      const a = line.side < 0 ? -inner - width : inner;
      const bOff = a + width;
      cutA[i].copy(f.pos).addScaledVector(f.right, a);
      cutB[i].copy(f.pos).addScaledVector(f.right, bOff);
      uCutA[i] = (a + f.widthL) / road.uvWidth;
      uCutB[i] = (bOff + f.widthL) / road.uvWidth;
      exitPaint[i] = 1;
      break;
    }
  }
  let hasExitLine = false;
  for (let i = 0; i < n; i++) if (exitPaint[i] > 0) { hasExitLine = true; break; }
  const exitSpans = hasExitLine ? runs(n, (i) => exitPaint[i] > 0) : [];

  /* The tarmac is the one surface a car is on at speed for a whole lap, so it
     is the one that has to be cut across where the banking winds on and off.
     Everything else of the ribbon -- the edge lines, the kerbs, the shoulder --
     is narrow enough that its own plates barely fold at all. */
  // `fr` is the expanded ring, so the closing plate is already in it.
  const cols = road.crossCut ? twistColumns(fr, false) : 1;
  emit('1ROAD_track', 'asphalt', 'ROAD', (b) => {
    b.addStrip(tarmacL, cutA, zeros, uCutA, v, 0, n - 1, cols);
    for (const [a, z] of exitSpans) {
      b.addStrip(cutB, tarmacR, uCutB, uB, v, Math.max(0, a - 1), Math.min(n - 1, z + 1), cols);
      /* The plate where the line begins and the one where it ends belong to
         the road, not to the line. The band collapses onto the tarmac edge
         either side of the painted stretch, so handing those two plates to
         the white would draw the line as a wedge growing out of the kerb
         instead of a line that starts. */
      if (a > 0) b.addStrip(cutA, cutB, uCutA, uCutB, v, a - 1, a);
      if (z < n - 1) b.addStrip(cutA, cutB, uCutA, uCutB, v, z, z + 1);
    }
  }, n * 4 * cols);
  if (hasExitLine) {
    emit('1ROAD_line_pit_exit', 'line_white', 'ROAD', (b) => {
      for (const [a, z] of exitSpans) b.addStrip(cutA, cutB, zeros, ones, v, a, z);
    });
  }

  if (hasLine) {
    emit('1ROAD_line_left', 'line_white', 'ROAD', (b) => {
      for (const [a, z] of runs(n, (i) => dashL[i] === 0)) b.addStrip(roadL, lineL, zeros, ones, v, a, z);
    });
    emit('1ROAD_line_right', 'line_white', 'ROAD', (b) => {
      for (const [a, z] of runs(n, (i) => dashR[i] === 0)) b.addStrip(lineR, roadR, zeros, ones, v, a, z);
    });
    if (hasDash) {
      /* The same band the solid line occupies, with the dashed texture. Each
         run reaches one cross section into the solid stretch either side:
         a solid run's last quad is inside itself, so the quad at the
         changeover would otherwise belong to nobody and the line would break
         for a plate at every mouth. */
      emit('1ROAD_line_pit_merge', 'line_dashed', 'ROAD', (b) => {
        for (const [a, z] of runs(n, (i) => dashL[i] > 0)) {
          b.addStrip(roadL, lineL, zeros, ones, vDash, Math.max(0, a - 1), Math.min(n - 1, z + 1));
        }
        for (const [a, z] of runs(n, (i) => dashR[i] > 0)) {
          b.addStrip(lineR, roadR, zeros, ones, vDash, Math.max(0, a - 1), Math.min(n - 1, z + 1));
        }
      });
    }
  }

  /* --- kerbs ---------------------------------------------------------- */
  // Built per span, so each stretch gets the cross section it was given -- a
  // plain kerb, a rippled one, or a low strip with bumps standing on it.
  for (const side of [-1, 1] as const) {
    const k: KerbSide = {
      fr,
      side,
      inner: side < 0 ? roadL : roadR,
      width: side < 0 ? profile.kerbWL : profile.kerbWR,
      height: side < 0 ? profile.kerbHL : profile.kerbHR,
      spanOf: side < 0 ? profile.kerbSpanL : profile.kerbSpanR,
      layout,
    };
    const groups = kerbGroups(k);
    if (groups.length === 0) continue;
    emit(
      `1KERB_${side < 0 ? 'left' : 'right'}`,
      'kerb',
      'KERB',
      (b) => {
        for (const g of groups) {
          buildKerbStrip(b, k, g);
          if (g.run.span.style === 'sausage') buildBumps(b, k, g);
        }
      },
      kerbCapacity(groups, fr),
    );
  }

  /* --- coloured tarmac strip outside the kerb -------------------------- */
  for (const side of ['L', 'R'] as const) {
    const width = side === 'L' ? profile.apronL : profile.apronR;
    const inner = side === 'L' ? e.edgeL : e.edgeR;
    const outer = side === 'L' ? e.apronEL : e.apronER;
    for (let i = 0; i < n; i++) {
      v[i] = fr[i].dist / road.uvLength;
      uA[i] = width[i] / road.uvWidth;
    }
    emit(
      `1ROAD_apron_${side === 'L' ? 'left' : 'right'}`,
      APRON_MATERIAL[road.apronColour],
      'ROAD',
      (b) => {
        for (const [a, z] of runs(n, (i) => width[i] > 0.02)) {
          if (side === 'L') b.addStrip(outer, inner, uA, zeros, v, a, z);
          else b.addStrip(inner, outer, zeros, uA, v, a, z);
        }
      },
    );
  }

  /* --- run off -------------------------------------------------------- */
  /*
   * The strip between the edge of the circuit and the barrier.
   *
   * Built in runs so a stretch where the run off is squeezed to nothing, next
   * to the pit lane for instance, produces no degenerate triangles at all.
   *
   * And built in BANDS across when the ground brush has a say, because half of
   * what this strip is on a real circuit changes across it rather than along
   * it: gravel at the outside of the corner with a metre of grass behind it,
   * tarmac at the exit fading to grass at the barrier. One material per cross
   * section could not draw either. The bands are a few metres wide, which is
   * about what the paint itself can resolve, and every band shares its edge
   * rings with its neighbours so the strip stays one continuous surface.
   */
  {
    let maxRunoff = 0;
    for (let i = 0; i < n; i++) {
      maxRunoff = Math.max(maxRunoff, profile.runoffL[i], profile.runoffR[i]);
    }
    /*
     * How many bands: one per paint cell across the widest run off, so the
     * strip resolves everything the paint field can actually say. The old
     * fixed split -- six bands of four metres or more -- was COARSER than the
     * paint (about two metres a sample at the default grid), so a stroke of
     * the ground brush came out as blocks twice the size of what was painted,
     * and there was no way to change the strip any finer than that. Capped
     * all the same, because a very wide run off on a very fine grid must not
     * turn the strip into thousands of quads per cross section.
     */
    const bandStep = ground ? Math.max(1, ground.cell ?? 4) : maxRunoff;
    const bands = ground ? Math.max(1, Math.min(16, Math.round(maxRunoff / bandStep))) : 1;
    // The material the run off falls back to: what the road settings say, for
    // every band of every cross section the brush has never been over.
    // Every run off surface is also a ground material, so this always finds
    // one; grass is the safe answer if a future one ever does not.
    const fallback = ground
      ? Math.max(0, ground.kinds.findIndex((k) => k.surface === road.runoffSurface))
      : -1;
    /*
     * ALONG the track the same rule, so the strip has its own stations: the
     * material could only ever change from one cross section to the next, and
     * a section is however long the road setting makes its plates -- often
     * four to eight metres, against a two metre paint cell. Painting a fine
     * edge onto that stepped in whole plates. The sections are subdivided
     * until a station step is no coarser than a paint cell; the subdivided
     * points lie on the plates' own chords, so the surface is geometrically
     * the same one as before -- only the places where the material may change
     * get denser. Without the brush in play sub is 1 and the stations ARE the
     * cross sections, exactly as always.
     */
    const plateLen = n > 1 ? (fr[n - 1].dist - fr[0].dist) / (n - 1) : 0;
    const sub = ground ? Math.max(1, Math.min(4, Math.round(plateLen / bandStep))) : 1;
    const m = (n - 1) * sub + 1;
    const rs = takeRunoffScratch(m);
    const bandI = rs.bandI;
    const bandO = rs.bandO;
    const vS = rs.v;
    const uAS = rs.uA;
    const uBS = rs.uB;
    const wS = rs.w;
    /** Station s sits t of the way from section (s / sub | 0) to the next. */
    const secOf = (s: number) => Math.min(n - 2, (s / sub) | 0);
    const fracOf = (s: number, i: number) => (s - i * sub) / sub;

    for (const side of ['L', 'R'] as const) {
      const width = side === 'L' ? profile.runoffL : profile.runoffR;
      const inner = side === 'L' ? e.apronEL : e.apronER;
      const outer = side === 'L' ? e.outerL : e.outerR;

      for (let s = 0; s < m; s++) {
        const i = secOf(s);
        const t = fracOf(s, i);
        wS[s] = width[i] + (width[i + 1] - width[i]) * t;
        vS[s] = (fr[i].dist + (fr[i + 1].dist - fr[i].dist) * t) / 8;
      }
      const wide = (s: number) => wS[s] > 0.05;

      /*
       * The material at every NODE of the strip's grid: (bands + 1) rows of
       * stations, the rows lying on the band edges rather than through their
       * middles. Nodes rather than midpoints because the grid is now cut like
       * the terrain's: a cell whose four corners agree is that material, and a
       * cell they disagree over is split along the real boundary instead of
       * being handed whole to whichever material its midpoint sampled.
       *
       * Worked out once: it is read by the run finder once per material as
       * well as by the classifier, and the road is rebuilt on every frame of
       * a drag -- asking the paint field again each time is a hundred
       * thousand lookups a frame for an answer that cannot have changed since
       * the top of the function.
       */
      const rows = bands + 1;
      const nodeK = ground ? new Int8Array(rows * m) : null;
      if (ground && nodeK) {
        for (let r = 0; r < rows; r++) {
          const tb = r / bands;
          for (let s = 0; s < m; s++) {
            const i = secOf(s);
            const t = fracOf(s, i);
            const ix = inner[i].x + (inner[i + 1].x - inner[i].x) * t;
            const iz = inner[i].z + (inner[i + 1].z - inner[i].z) * t;
            const ox = outer[i].x + (outer[i + 1].x - outer[i].x) * t;
            const oz = outer[i].z + (outer[i + 1].z - outer[i].z) * t;
            const k = ground.at(ix + (ox - ix) * tb, iz + (oz - iz) * tb);
            nodeK[r * m + s] = k < 0 ? fallback : k;
          }
        }
      }

      /*
       * Fill the two edge rings and the two u coordinates of one band.
       *
       * The last band's outer ring comes down by EDGE_SINK, because that ring
       * is where the run off stops and the ground takes over. The ground is
       * deliberately held that far under every road mesh -- two coplanar
       * surfaces leave the depth buffer to guess -- and at the outer edge the
       * gap has nothing left to hide under: it stands there as a four
       * centimetre lip running the length of the circuit. Bringing the edge
       * down to meet the ground costs 4 cm over the width of a run off, which
       * is a slope of two in a thousand, and removes the step.
       */
      const layBand = (b: number) => {
        const t0 = b / bands;
        const t1 = (b + 1) / bands;
        const last = b === bands - 1;
        for (let s = 0; s < m; s++) {
          const i = secOf(s);
          const t = fracOf(s, i);
          tmpBandIn.copy(inner[i]).lerp(inner[i + 1], t);
          tmpBandOut.copy(outer[i]).lerp(outer[i + 1], t);
          bandI[s].copy(tmpBandIn).lerp(tmpBandOut, t0);
          bandO[s].copy(tmpBandIn).lerp(tmpBandOut, t1);
          if (last && wide(s)) bandO[s].y -= EDGE_SINK;
          uAS[s] = (wS[s] * t0) / 8;
          uBS[s] = (wS[s] * t1) / 8;
        }
      };

      /*
       * One stretch of one band, as stations [from, to].
       *
       * Two stations in a row can be made of different things, and the plate
       * BETWEEN them belongs to the one before: every run therefore reaches
       * one station forward, and only the last of them stops short. Without
       * that the transition from gravel to grass is a gap you can see the sky
       * through.
       *
       * The same reach backwards, but only into a station with no run off at
       * all. Beside the pit lane the strip is squeezed to nothing, and a run
       * that stopped on its last wide station left the plate between that one
       * and the empty one next to it belonging to nobody -- measured on the
       * demo circuit as 2.6 m of bare ground straight off the racing surface,
       * at both pit junctions.
       */
      const strip = (b: StripBuilder, from: number, to: number) => {
        if (side === 'L') b.addStrip(bandO, bandI, uBS, uAS, vS, from, to);
        else b.addStrip(bandI, bandO, uAS, uBS, vS, from, to);
      };

      if (!ground) {
        const material: MaterialKey =
          road.runoffSurface === 'SAND' ? 'sand'
            : road.runoffSurface === 'CONCRETE' ? 'concrete' : 'grass';
        // Through the same one band, so the outer edge gets the same bevel
        // whether or not the ground brush has anything to say about it.
        layBand(0);
        emit(
          `1${road.runoffSurface}_runoff_${side === 'L' ? 'left' : 'right'}`,
          material,
          road.runoffSurface,
          (b) => {
            for (const [a, z] of runs(m, wide)) {
              strip(b, Math.max(0, a - 1), Math.min(m - 1, z + 1));
            }
          },
        );
        continue;
      }

      const K = nodeK!;

      /*
       * Classify every CELL of the grid: uniform cells belong to their
       * material and are laid as strips, exactly as before. A cell whose
       * corners disagree has the boundary running through it, and is CUT
       * along it -- the same construction the terrain mesh uses, which is
       * what makes a painted edge one straight line where it leaves the
       * terrain and crosses the strip, instead of a staircase of bands.
       *
       * A mixed cell that is pinched to nothing (neither station wide) falls
       * to its low corner's material: there is no visible ground there to
       * cut, and a sliver polygon is a crack waiting to happen.
       */
      const CUT = -2;
      const cellCount = m - 1;
      const cellK = new Int8Array(bands * cellCount);
      let cuts = 0;
      for (let b = 0; b < bands; b++) {
        for (let cs = 0; cs < cellCount; cs++) {
          const k0 = K[b * m + cs];
          const k1 = K[b * m + cs + 1];
          const k2 = K[(b + 1) * m + cs + 1];
          const k3 = K[(b + 1) * m + cs];
          let k = k0;
          if ((k0 !== k1 || k1 !== k2 || k2 !== k3) && ground.cutCell && wide(cs) && wide(cs + 1)) {
            k = CUT;
            cuts += 1;
          }
          cellK[b * cellCount + cs] = k;
        }
      }

      // Which materials actually turn up, so nothing is built for the three
      // the circuit does not use.
      const used = new Set<number>();
      for (let b = 0; b < bands; b++) {
        for (let cs = 0; cs < cellCount; cs++) {
          if (!wide(cs) && !wide(cs + 1)) continue;
          const k = cellK[b * cellCount + cs];
          if (k !== CUT) {
            used.add(k);
            continue;
          }
          used.add(K[b * m + cs]);
          used.add(K[b * m + cs + 1]);
          used.add(K[(b + 1) * m + cs + 1]);
          used.add(K[(b + 1) * m + cs]);
        }
      }
      used.delete(-1);

      /** One node of the grid, in the world, matching layBand exactly. */
      const nodeAt = (r: number, s: number, out: THREE.Vector3) => {
        const i = secOf(s);
        const t = fracOf(s, i);
        tmpBandIn.copy(inner[i]).lerp(inner[i + 1], t);
        tmpBandOut.copy(outer[i]).lerp(outer[i + 1], t);
        out.copy(tmpBandIn).lerp(tmpBandOut, r / bands);
        if (r === bands && wide(s)) out.y -= EDGE_SINK;
        return out;
      };

      const kindAtXZ = (x: number, z: number) => {
        const k = ground.at(x, z);
        return k < 0 ? fallback : k;
      };

      /*
       * Where the boundary crosses the segment between two nodes of different
       * materials, as a fraction from the first. A short bisection against
       * the sampler, which is edge-aware, so this converges onto the line the
       * shape actually drew. Nudged off the ends the same way the terrain's
       * crossings are: a cut exactly on a corner is a triangle of no area.
       */
      const crossOn = (a: THREE.Vector3, ka: number, b: THREE.Vector3): number => {
        let lo = 0;
        let hi = 1;
        for (let it = 0; it < 7; it++) {
          const mid = (lo + hi) / 2;
          if (kindAtXZ(a.x + (b.x - a.x) * mid, a.z + (b.z - a.z) * mid) === ka) lo = mid;
          else hi = mid;
        }
        const f = (lo + hi) / 2;
        return f < 0.04 ? 0.04 : f > 0.96 ? 0.96 : f;
      };

      /**
       * The pieces one cut cell hands to `want`, as fans.
       *
       * Corner order and the half-step ring lattice are cutCell's own (see
       * terrain.ts): corners at even coordinates, crossing points at the odd
       * ones, which are moved onto the measured crossings here. The two axes
       * are the band direction (rows b and b + 1) and the station direction
       * (stations cs and cs + 1); a ring point is bilinearly placed between
       * the four corner nodes, so a cut cell's border agrees with the strips
       * beside it to the last bit and the mesh stays crack free.
       */
      const emitCutCell = (sb: StripBuilder, want: number, b: number, cs: number) => {
        const k0 = K[b * m + cs];
        const k1 = K[b * m + cs + 1];
        const k2 = K[(b + 1) * m + cs + 1];
        const k3 = K[(b + 1) * m + cs];
        if (want !== k0 && want !== k1 && want !== k2 && want !== k3) return;
        nodeAt(b, cs, cutC0);
        nodeAt(b, cs + 1, cutC1);
        nodeAt(b + 1, cs + 1, cutC2);
        nodeAt(b + 1, cs, cutC3);
        const f0 = k0 !== k1 ? crossOn(cutC0, k0, cutC1) : 0.5;
        const f1 = k1 !== k2 ? crossOn(cutC1, k1, cutC2) : 0.5;
        const f2 = k3 !== k2 ? crossOn(cutC3, k3, cutC2) : 0.5;
        const f3 = k0 !== k3 ? crossOn(cutC0, k0, cutC3) : 0.5;
        ground.cutCell!(k0, k1, k2, k3, (kind, ring) => {
          if (kind !== want) return;
          const cnt = ring.length / 2;
          for (let p = 0; p < cnt; p++) {
            const hb = ring[p * 2];
            const hs = ring[p * 2 + 1];
            const tb = hb === 1 ? (hs === 0 ? f3 : hs === 2 ? f1 : 0.5) : hb / 2;
            const u = hs === 1 ? (hb === 0 ? f0 : hb === 2 ? f2 : 0.5) : hs / 2;
            const lx = cutC0.x + (cutC1.x - cutC0.x) * u;
            const ly = cutC0.y + (cutC1.y - cutC0.y) * u;
            const lz = cutC0.z + (cutC1.z - cutC0.z) * u;
            const ux = cutC3.x + (cutC2.x - cutC3.x) * u;
            const uy = cutC3.y + (cutC2.y - cutC3.y) * u;
            const uz = cutC3.z + (cutC2.z - cutC3.z) * u;
            fanX[p] = lx + (ux - lx) * tb;
            fanY[p] = ly + (uy - ly) * tb;
            fanZ[p] = lz + (uz - lz) * tb;
            const w = wS[cs] + (wS[cs + 1] - wS[cs]) * u;
            fanU[p] = (w * ((b + tb) / bands)) / 8;
            fanV[p] = vS[cs] + (vS[cs + 1] - vS[cs]) * u;
          }
          sb.addFan(fanX, fanY, fanZ, fanU, fanV, cnt);
        });
      };

      for (const k of used) {
        const kind = ground.kinds[k];
        if (!kind) continue;
        emit(
          `1${kind.surface}_runoff_${side === 'L' ? 'left' : 'right'}`,
          kind.material,
          kind.surface,
          (sb) => {
            for (let b = 0; b < bands; b++) {
              let laid = false;
              /* Runs of whole cells of this material. A run of one cell is
                 two stations and therefore already a drawable strip, so no
                 widening -- growing into a neighbour here would lay this
                 material over a cut cell that is already drawing its own
                 pieces. */
              let cs = 0;
              while (cs < cellCount) {
                const mine =
                  cellK[b * cellCount + cs] === k && (wide(cs) || wide(cs + 1));
                if (!mine) {
                  cs += 1;
                  continue;
                }
                let z = cs;
                while (
                  z + 1 < cellCount &&
                  cellK[b * cellCount + z + 1] === k &&
                  (wide(z + 1) || wide(z + 2))
                ) {
                  z += 1;
                }
                if (!laid) {
                  layBand(b);
                  laid = true;
                }
                strip(sb, cs, z + 1);
                cs = z + 1;
              }
              for (let c2 = 0; c2 < cellCount; c2++) {
                if (cellK[b * cellCount + c2] === CUT) emitCutCell(sb, k, b, c2);
              }
            }
          },
          m * 2 * bands + cuts * 12,
        );
      }
    }
  }

  /* --- barriers ------------------------------------------------------- */
  if (road.wallHeight > 0.05) {
    const fence = road.wallStyle === 'fence';
    const gates = gateStations(fr[n - 1].dist);

    /** Last cross section at or before `s`. */
    const sectionBefore = (s: number) => {
      let lo = 0;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (fr[mid].dist <= s) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    for (const side of ['L', 'R'] as const) {
      const flags = side === 'L' ? profile.wallL : profile.wallR;
      const outer = side === 'L' ? e.outerL : e.outerR;
      const gap = side === 'L' ? profile.wallGapL : profile.wallGapR;
      const away = side === 'L' ? -1 : 1;
      const long = side === 'L' ? 'left' : 'right';
      // The barrier normally stands on the outer edge of the run off, but each
      // control point can push it further out or pull it back in over the
      // grass. Its own array, so the run off keeps the edge it was built with.
      const base = scratch.wallBase;
      // A catch fence keeps its solid base whatever the total height is: that
      // part is the armco or the concrete, and it does not grow with the mesh
      // above it. On a short setting the base simply takes the whole height.
      const solid = fence ? Math.min(FENCE_BASE, road.wallHeight) : road.wallHeight;
      for (let i = 0; i < n; i++) {
        base[i].copy(outer[i]).addScaledVector(fr[i].right, away * gap[i]);
      }

      /*
       * The whole barrier layout is worked out in METRES OF LAP, never in
       * section indices.
       *
       * Every previous version of the gates edited the section ring -- sliding
       * points onto opening edges, cutting index ranges, re-spreading samples
       * -- and every one of them had a way of smearing a section across fifty
       * metres of countryside when a gate fell awkwardly against the author's
       * sampling. So now: where the barrier STANDS is a list of arc-length
       * intervals; a gate SUBTRACTS its five metres from them and adds one
       * set-back interval of its own; and a single sampler turns any interval
       * into geometry, walking the ring read-only and interpolating the exact
       * endpoints. There is no index bookkeeping left to get wrong.
       *
       * The set-back piece overlaps its opening at BOTH ends, the way the
       * spare armco behind a real gate does: nothing can be driven through in
       * either direction, and whoever comes through the gap on foot can only
       * leave around the back of it.
       */
      const intervals: Array<[number, number]> = [];
      for (const [a, z] of runs(n, (i) => flags[i] === 1)) {
        if (fr[z].dist - fr[a].dist > 1) intervals.push([fr[a].dist, fr[z].dist]);
      }

      const cut = (list: Array<[number, number]>, c0: number, c1: number) =>
        list.flatMap(([lo, hi]): Array<[number, number]> => {
          if (c1 <= lo || c0 >= hi) return [[lo, hi]];
          const kept: Array<[number, number]> = [];
          if (c0 > lo) kept.push([lo, c0]);
          if (c1 < hi) kept.push([c1, hi]);
          return kept;
        });

      /*
       * The stretches the author took back out.
       *
       * Applied before the gates and through the same `cut`, so a hand made
       * opening behaves exactly like one the gate machinery made: the runs
       * either side keep their own clean ends, the fence posts follow the
       * runs, and nothing else in here has to know about it. See BarrierCut
       * for why they are held as curve parameters rather than metres.
       */
      let front = intervals;
      // Defensive: settings built by hand in a test, or a project older than
      // the feature, simply have none.
      const mine = (road.wallCuts ?? []).filter((c) => c.side === (side === 'L' ? -1 : 1));
      for (const c of mine) {
        for (const [t0, t1] of cutRanges(c.from, c.to, closed)) {
          front = cut(front, distanceAtT(fr, t0, closed), distanceAtT(fr, t1, closed));
        }
      }
      /*
       * A slice of barrier left between two openings is not barrier.
       *
       * Two cuts that very nearly meet leave a couple of metres of fence
       * standing on its own in the middle of the gap, which reads as debris
       * rather than as a barrier -- and it is what the author was trying to
       * get rid of in the first place. The cuts themselves are merged as they
       * are made, so this is the backstop for the ways a sliver can turn up
       * anyway: two openings made from opposite ends, or one landing against
       * the end of a painted run.
       */
      if (mine.length > 0) front = front.filter(([lo, hi]) => hi - lo >= MIN_BARRIER_PIECE);

      const rearPieces: Array<[number, number]> = [];
      const openings: number[] = [];
      for (const station of gates) {
        const g0 = station - GATE_WIDTH / 2;
        const g1 = station + GATE_WIDTH / 2;
        // Only where the barrier carries on well past both sides: a gate cut
        // where the run ends a few metres later anyway is a gap next to open
        // grass, and it reads as the barrier falling apart.
        if (!front.some(([lo, hi]) => g0 - GATE_GUARD >= lo && g1 + GATE_GUARD <= hi)) continue;
        front = cut(front, g0, g1);
        /*
         * The piece behind the opening runs from well BEFORE it to exactly
         * its forward edge, where it angles in and JOINS the run -- see the
         * set-back profile below. So the slot between the two runs is open at
         * ONE end only, the rear: a marshal walks out backwards, against the
         * direction of travel, and a car sliding along the wall with the
         * traffic is guided into the closed wedge instead of finding a mouth
         * it can pass through. Open at both ends it was a corridor straight
         * through the barrier, which is exactly what a gate must never be.
         */
        rearPieces.push([g0 - GATE_OVERLAP, g1]);
        openings.push(station);
      }

      /*
       * The painted tip. The FRONT run wears GATE_MARK metres of orange on
       * its CUT end only -- the rear edge of the opening, the free end you
       * drive in past. The forward side is not painted: the set-back piece
       * merges back into the run there, so that end is not an end at all,
       * and painting it would signpost the sealed side of the slot. The mark
       * is cut out of the plain armco and rebuilt over its own material;
       * under a catch fence the mesh above runs across it unbroken, only the
       * steel changes colour. GATE_GUARD has already promised the run
       * carries on well past the opening, so the mark always fits.
       */
      let rail = front;
      const marks: Array<[number, number]> = [];
      for (const station of openings) {
        const g0 = station - GATE_WIDTH / 2;
        rail = cut(rail, g0 - GATE_MARK, g0);
        marks.push([g0 - GATE_MARK, g0]);
      }

      /*
       * The sampler. Every piece of barrier -- the runs in front, the pieces
       * behind the gates -- is one chain of samples appended to the same
       * arrays: the exact start, every ring section strictly inside, the
       * exact end. Position, outward normal, fence stack and V coordinate are
       * all derived per sample, so a piece is correct wherever its ends fall.
       */
      const cPos = scratch.gateBase;
      const cRight = scratch.gateTmp;
      const cMid = scratch.gateMid;
      const cTop = scratch.gateTop;
      const cTip = scratch.gateTip;
      const cV = scratch.gateV;
      // The fence chains and the rail chains each walk the whole ring, so the
      // sections are counted twice; the marks are short but have ends of their
      // own.
      const need =
        2 * n + (front.length + rail.length + marks.length + rearPieces.length) * 2 + rearPieces.length * 16 + 8;
      while (cPos.length < need) {
        cPos.push(new THREE.Vector3());
        cRight.push(new THREE.Vector3());
        cMid.push(new THREE.Vector3());
        cTop.push(new THREE.Vector3());
        cTip.push(new THREE.Vector3());
        scratch.wallLo.push(new THREE.Vector3());
        scratch.wallHi.push(new THREE.Vector3());
      }
      while (cV.length < need) cV.push(0);
      while (scratch.uA.length < need) scratch.uA.push(0);
      while (scratch.uB.length < need) scratch.uB.push(0);
      let cAt = 0;
      const put = (s: number, setBack: number) => {
        const j = Math.min(n - 2, Math.max(0, sectionBefore(s)));
        const plate = fr[j + 1].dist - fr[j].dist;
        const t = plate > 1e-6 ? Math.min(1, Math.max(0, (s - fr[j].dist) / plate)) : 0;
        cRight[cAt].lerpVectors(fr[j].right, fr[j + 1].right, t).normalize();
        cPos[cAt].lerpVectors(base[j], base[j + 1], t);
        if (setBack > 0) cPos[cAt].addScaledVector(cRight[cAt], away * setBack);
        cMid[cAt].copy(cPos[cAt]);
        cMid[cAt].y += solid;
        cTop[cAt].copy(cPos[cAt]);
        cTop[cAt].y += road.wallHeight;
        // The lean goes INWARD, over the circuit, which is the whole point of
        // it -- angled the other way it would throw debris at the spectators.
        cTip[cAt].copy(cTop[cAt]).addScaledVector(cRight[cAt], -away * FENCE_LEAN_OUT);
        cTip[cAt].y += FENCE_LEAN_UP;
        cV[cAt] = s / FENCE_UV;
        cAt += 1;
      };
      const addRun = (
        lo: number,
        hi: number,
        setBackAt: (s: number) => number,
        breaks?: number[],
      ): [number, number] | null => {
        if (hi - lo < 0.3) return null;
        const between = sectionBefore(Math.max(lo, hi - 0.01)) - sectionBefore(lo);
        if (cAt + between + 3 + (breaks?.length ?? 0) > cPos.length) return null;
        const from = cAt;
        const stops: number[] = [];
        for (let j = sectionBefore(lo) + 1; j < n && fr[j].dist < hi - 0.01; j++) {
          if (fr[j].dist > lo + 0.01) stops.push(fr[j].dist);
        }
        if (breaks) for (const s of breaks) if (s > lo + 0.01 && s < hi - 0.01) stops.push(s);
        stops.sort((a, b) => a - b);
        put(lo, setBackAt(lo));
        for (const s of stops) put(s, setBackAt(s));
        put(hi, setBackAt(hi));
        return [from, cAt - 1];
      };
      /*
       * The camera windows: only where the fence is continuous well past
       * both sides of the opening, and only in a catch fence tall enough to
       * have a mesh band to cut them from. Their edges are breaks in the
       * front chain, so a ring sits exactly on each edge and the window is
       * a clean rectangle rather than something sampled to the nearest
       * cross section.
       */
      const windows: Array<[number, number]> = [];
      // Both heights are measured from the barrier's foot, so the fence only
      // has to reach past the top of the window itself.
      if (fence && road.wallHeight > CAMERA_WINDOW_TOP + 0.05) {
        for (const station of cameraWindowStations(fr[n - 1].dist)) {
          const w0 = station - CAMERA_WINDOW_WIDTH / 2;
          const w1 = station + CAMERA_WINDOW_WIDTH / 2;
          if (front.some(([lo, hi]) => w0 - 2 >= lo && w1 + 2 <= hi)) windows.push([w0, w1]);
        }
      }
      const windowEdges = windows.flatMap(([w0, w1]) => [w0, w1]);
      const frontSpans: Array<[number, number]> = [];
      for (const [lo, hi] of front) {
        const span = addRun(lo, hi, () => 0, windowEdges);
        if (span) frontSpans.push(span);
      }
      // The same run again, minus the painted tips: what the plain armco is
      // built over. Its own chains, so the fence above can stay unbroken.
      const railSpans: Array<[number, number]> = [];
      for (const [lo, hi] of rail) {
        const span = addRun(lo, hi, () => 0);
        if (span) railSpans.push(span);
      }
      const markSpans: Array<[number, number]> = [];
      for (const [lo, hi] of marks) {
        const span = addRun(lo, hi, () => 0);
        if (span) markSpans.push(span);
      }
      const rearSpans: Array<[number, number]> = [];
      for (const [lo, hi] of rearPieces) {
        /*
         * Full set-back along the slot, then angled IN over the last metres
         * to land a hand's width behind the run at the opening's forward
         * edge: the slot is sealed at that end. Not to zero -- two runs
         * meeting exactly would fight over the depth buffer at the join.
         */
        const join = hi - GATE_JOIN;
        const span = addRun(
          lo,
          hi,
          (s) => (s <= join ? GATE_SET_BACK : Math.max(0.06, (GATE_SET_BACK * (hi - s)) / GATE_JOIN)),
          [join],
        );
        if (span) rearSpans.push(span);
      }
      /*
       * The mesh runs on up the leaning top rather than starting over at it.
       * Left to the default 0..1 across every strip, a 2.6 m panel and the
       * 1.4 m of lean above it get the same number of wires and the pattern
       * visibly steps at the joint. Measuring the texture in metres on BOTH
       * axes keeps the diamonds square and the joint invisible.
       */
      /*
       * The mesh runs on up the leaning top rather than starting over at it.
       * Left to the default 0..1 across every strip, a 2.6 m panel and the
       * 1.4 m of lean above it get the same number of wires and the pattern
       * visibly steps at the joint. Measuring the texture in metres on BOTH
       * axes keeps the diamonds square and the joint invisible.
       */
      const uLo = scratch.uA;
      const uHi = scratch.uB;
      const strip = (
        name: string,
        material: MaterialKey,
        lower: THREE.Vector3[],
        upper: THREE.Vector3[],
        fromHeight: number,
        toHeight: number,
        spans: Array<[number, number]>,
      ) => {
        for (let i = 0; i < cAt; i++) {
          uLo[i] = fromHeight;
          uHi[i] = toHeight;
        }
        emit(name, material, 'WALL', (b) => {
          for (const [a, z] of spans) {
            // Winding: on the left the outward direction is -right, so the two
            // sides take the pair the other way round to keep the faces out.
            if (side === 'L') b.addStrip(upper, lower, uHi, uLo, cV, a, z);
            else b.addStrip(lower, upper, uLo, uHi, cV, a, z);
          }
        }, need * 2);
      };

      /*
       * The armco, in both styles: on its own it IS the barrier, under a catch
       * fence it is the solid part the mesh stands on. One mesh per run, the
       * rails folded out of the base plane a fold at a time -- `lo` and `hi`
       * are refilled per fold rather than kept one chain each, so the whole
       * stack costs two scratch arrays however many beams it comes to.
       */
      const armco = (name: string, spans: Array<[number, number]>, material: MaterialKey = 'guardrail') => {
        const lo = scratch.wallLo;
        const hi = scratch.wallHi;
        const rails = railCount(solid);
        const rh = solid / rails;
        emit(
          name,
          material,
          'WALL',
          (b) => {
            for (let r = 0; r < rails; r++) {
              for (let k = 0; k < GUARDRAIL_FOLD.length - 1; k++) {
                const [fA, dA] = GUARDRAIL_FOLD[k];
                const [fB, dB] = GUARDRAIL_FOLD[k + 1];
                for (let i = 0; i < cAt; i++) {
                  lo[i].copy(cPos[i]).addScaledVector(cRight[i], -away * dA * GUARDRAIL_OUT);
                  lo[i].y = cPos[i].y + (r + fA) * rh;
                  hi[i].copy(cPos[i]).addScaledVector(cRight[i], -away * dB * GUARDRAIL_OUT);
                  hi[i].y = cPos[i].y + (r + fB) * rh;
                  // U runs UP the barrier and one tile of the texture is one
                  // beam, so the rail index is the whole part of it: every
                  // beam gets the same tile however many are stacked.
                  uLo[i] = r + fA;
                  uHi[i] = r + fB;
                }
                for (const [a, z] of spans) {
                  if (side === 'L') b.addStrip(hi, lo, uHi, uLo, cV, a, z);
                  else b.addStrip(lo, hi, uLo, uHi, cV, a, z);
                }
              }
            }
          },
          need * 2 * (GUARDRAIL_FOLD.length - 1) * rails,
        );
      };

      /** One complete barrier: the armco, and the catch fence over it. The
          fence may run over MORE than the steel does -- across the painted
          tips, which are their own armco mesh -- so it takes its own spans. */
      const barrier = (
        suffix: string,
        armcoSpans: Array<[number, number]>,
        spans = armcoSpans,
        /** Camera windows to leave open in the mesh band, as lap metres. */
        holes: Array<[number, number]> = [],
      ) => {
        if (spans.length === 0) return;
        armco(`1WALL_${long}${suffix}`, armcoSpans);
        if (fence && road.wallHeight > solid + 0.05) {
          const panel = (road.wallHeight - solid) / FENCE_UV;
          const lean = Math.hypot(FENCE_LEAN_OUT, FENCE_LEAN_UP) / FENCE_UV;
          // Its own meshes and the one material with holes in it, so the fence
          // is fencing rather than a four metre slab of concrete: you see the
          // circuit through it, which is the whole difference between a catch
          // fence and a wall.
          if (holes.length === 0) {
            strip(`1WALL_${long}${suffix}_mesh`, 'chainlink', cMid, cTop, 0, panel, spans);
          } else {
            /*
             * Three bands instead of one: below the windows, the band the
             * windows are cut from, and above them. The middle band's spans
             * stop at every window's edges, and those edges are rings of the
             * chain (see windowEdges), so the opening is the exact rectangle
             * asked for. The armco and the lean are untouched: a camera
             * window is a hole in the mesh, not a gap in the barrier.
             */
            const h1 = (CAMERA_WINDOW_BOTTOM - solid) / (road.wallHeight - solid);
            const h2 = (CAMERA_WINDOW_TOP - solid) / (road.wallHeight - solid);
            const w1 = scratch.wallLo;
            const w2 = scratch.wallHi;
            for (let i = 0; i < cAt; i++) {
              w1[i].lerpVectors(cMid[i], cTop[i], h1);
              w2[i].lerpVectors(cMid[i], cTop[i], h2);
            }
            const inHole = (s: number) => holes.some(([a, z]) => s > a + 1e-4 && s < z - 1e-4);
            const cut: Array<[number, number]> = [];
            for (const [a, z] of spans) {
              let start = a;
              for (let i = a; i <= z; i++) {
                const s = cV[i] * FENCE_UV;
                const sNext = i < z ? cV[i + 1] * FENCE_UV : s;
                // The plate from ring i to i+1 lies inside a window: close the
                // run at i and reopen it at i+1.
                if (i < z && inHole((s + sNext) / 2)) {
                  if (i > start) cut.push([start, i]);
                  start = i + 1;
                }
              }
              if (z > start) cut.push([start, z]);
            }
            strip(`1WALL_${long}${suffix}_mesh`, 'chainlink', cMid, w1, 0, panel * h1, spans);
            strip(`1WALL_${long}${suffix}_mesh_mid`, 'chainlink', w1, w2, panel * h1, panel * h2, cut);
            strip(`1WALL_${long}${suffix}_mesh_top`, 'chainlink', w2, cTop, panel * h2, panel, spans);
          }
          strip(`1WALL_${long}${suffix}_lean`, 'chainlink', cTop, cTip, panel, panel + lean, spans);
        }
      };

      barrier('', railSpans, frontSpans, windows);
      barrier('_gate', rearSpans);
      if (markSpans.length > 0) armco(`1WALL_${long}_mark`, markSpans, 'guardrail_orange');

      /* --- the fence posts ------------------------------------------------ */
      /*
       * A catch fence is mesh STRUNG ON something: posts on the far side from
       * the track, each with the leaning arm that carries the top over the
       * circuit. The hand placed `fence` module always had them; the generated
       * fence was the mesh alone, and next to a placed run -- or anywhere the
       * camera got close -- it read as a different, cheaper barrier. Grown
       * here the way the marshalling panels are: worked out from the same
       * arc-length intervals, merged into one mesh per side.
       */
      if (fence && road.wallHeight > solid + 0.05) {
        const mats: THREE.Matrix4[] = [];
        const m = new THREE.Matrix4();
        const ax = new THREE.Vector3();
        const ay = new THREE.Vector3(0, 1, 0);
        const az = new THREE.Vector3();
        const at = new THREE.Vector3();
        const leanY = new THREE.Vector3();
        const armLen = Math.hypot(FENCE_LEAN_OUT, FENCE_LEAN_UP) + 0.3;
        /** Where the post at `s` metres of lap stands, into `ax` and `at`. */
        const footAt = (s: number, setBack: number) => {
          const j = Math.min(n - 2, Math.max(0, sectionBefore(s)));
          const plate = fr[j + 1].dist - fr[j].dist;
          const t = plate > 1e-6 ? Math.min(1, Math.max(0, (s - fr[j].dist) / plate)) : 0;
          ax.lerpVectors(fr[j].right, fr[j + 1].right, t);
          ax.y = 0;
          ax.normalize();
          at.lerpVectors(base[j], base[j + 1], t);
          // Behind the mesh plane, away from the track, where a real post
          // stands so a glancing car meets wire and not steel.
          if (setBack > 0) at.addScaledVector(ax, away * setBack);
          at.addScaledVector(ax, away * 0.06);
        };
        const postAt = (s: number, setBack: number) => {
          footAt(s, setBack);
          az.crossVectors(ax, ay).normalize();
          m.makeBasis(ax, ay, az);
          m.setPosition(at.x, at.y + road.wallHeight / 2, at.z);
          mats.push(m.clone());
          // The arm: from the top of the post along the lean, carrying the
          // top of the mesh back over the circuit -- the same 34 degrees the
          // strip above folds to, because it is the same member.
          leanY.copy(ax).multiplyScalar(-away * FENCE_LEAN_OUT).setY(FENCE_LEAN_UP).normalize();
          // The third axis is the horizontal along-track direction, which is
          // perpendicular to the lean; the first is rebuilt from the two so
          // the basis stays orthogonal and the arm is not sheared.
          az.crossVectors(ay, ax).normalize();
          ax.crossVectors(leanY, az).normalize();
          m.makeBasis(ax, leanY, az);
          m.setPosition(
            at.x + leanY.x * (armLen / 2 - 0.16),
            at.y + road.wallHeight - 0.1 + leanY.y * (armLen / 2 - 0.16),
            at.z + leanY.z * (armLen / 2 - 0.16),
          );
          mats.push(m.clone());
        };
        const posted: Array<{ lo: number; hi: number; sb: (s: number) => number }> = [
          ...front.map(([lo, hi]) => ({ lo, hi, sb: () => 0 })),
          ...rearPieces.map(([lo, hi]) => ({
            lo,
            hi,
            sb: (s: number) =>
              s <= hi - GATE_JOIN
                ? GATE_SET_BACK
                : Math.max(0.06, (GATE_SET_BACK * (hi - s)) / GATE_JOIN),
          })),
        ];
        /*
         * Posts are spaced along the BARRIER, not along the lap.
         *
         * An inward offset is shorter than the line it came from -- that is
         * what makes it an inward offset -- so on the inside of a bend a step
         * of lap metres buys far less barrier than it does on a straight.
         * Stepped in lap metres the posts therefore crowd together exactly
         * where the corner is tightest: measured on a 12 m run off, posts
         * asked for 1.97 m apart came out 0.19 m apart, and a post is 0.14 m
         * thick, so they stood inside one another. Walking the run's own
         * length puts every post the same distance from the last one and
         * simply asks for fewer of them around the inside of a corner.
         */
        const probe = new THREE.Vector3();
        const prevFoot = new THREE.Vector3();
        for (const run of posted) {
          if (run.hi - run.lo < 0.3) continue;
          // Lap distance against barrier length, close enough to interpolate.
          const laps: number[] = [];
          const lens: number[] = [];
          const steps = Math.max(2, Math.ceil((run.hi - run.lo)));
          let acc = 0;
          for (let k = 0; k <= steps; k++) {
            const s = run.lo + ((run.hi - run.lo) * k) / steps;
            footAt(s, run.sb(s));
            probe.copy(at);
            if (k > 0) acc += probe.distanceTo(prevFoot);
            prevFoot.copy(probe);
            laps.push(s);
            lens.push(acc);
          }
          if (acc < 0.3) continue;
          const count = Math.max(1, Math.round(acc / FENCE_POST_SPACING));
          let cursor = 0;
          for (let k = 0; k <= count; k++) {
            const want = (acc * k) / count;
            while (cursor + 2 < lens.length && lens[cursor + 1] < want) cursor += 1;
            const span = lens[cursor + 1] - lens[cursor];
            const t = span > 1e-9 ? (want - lens[cursor]) / span : 0;
            const s = laps[cursor] + (laps[cursor + 1] - laps[cursor]) * t;
            postAt(s, run.sb(s));
          }
        }
        /*
         * Baked into ONE geometry by hand rather than merged from thousands
         * of little boxes: this runs again on every committed edit of the
         * track, and a lap of catch fence is a few thousand posts. The two
         * templates are transformed vertex by vertex into one pre-sized
         * buffer, which is the same work mergeGeometries does minus the few
         * thousand allocations.
         */
        if (mats.length > 0) {
          const tPost = new THREE.BoxGeometry(0.14, road.wallHeight, 0.14);
          const tArm = new THREE.BoxGeometry(0.12, armLen, 0.12);
          const templates = [tPost, tArm];
          const vPer = templates.map((t) => t.getAttribute('position').count);
          const iPer = templates.map((t) => t.getIndex()!.count);
          const pairs = mats.length / 2;
          const vTotal = pairs * (vPer[0] + vPer[1]);
          const iTotal = pairs * (iPer[0] + iPer[1]);
          const pos = new Float32Array(vTotal * 3);
          const nrm = new Float32Array(vTotal * 3);
          const uv = new Float32Array(vTotal * 2);
          const index = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
          const v = new THREE.Vector3();
          let vAt = 0;
          let iAt = 0;
          for (let k = 0; k < mats.length; k++) {
            const t = templates[k % 2];
            const tm = mats[k];
            const tp = t.getAttribute('position');
            const tn = t.getAttribute('normal');
            const tu = t.getAttribute('uv');
            const ti = t.getIndex()!;
            for (let j = 0; j < ti.count; j++) index[iAt++] = ti.getX(j) + vAt;
            for (let j = 0; j < tp.count; j++) {
              v.fromBufferAttribute(tp, j).applyMatrix4(tm);
              pos[(vAt + j) * 3] = v.x;
              pos[(vAt + j) * 3 + 1] = v.y;
              pos[(vAt + j) * 3 + 2] = v.z;
              // The basis is orthonormal -- rotation only -- so the normals
              // go through the same matrix without a normal matrix of their own.
              v.fromBufferAttribute(tn, j).transformDirection(tm);
              nrm[(vAt + j) * 3] = v.x;
              nrm[(vAt + j) * 3 + 1] = v.y;
              nrm[(vAt + j) * 3 + 2] = v.z;
              uv[(vAt + j) * 2] = tu.getX(j);
              uv[(vAt + j) * 2 + 1] = tu.getY(j);
            }
            vAt += tp.count;
          }
          tPost.dispose();
          tArm.dispose();
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
          g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
          g.setIndex(new THREE.BufferAttribute(index, 1));
          g.computeBoundingSphere();
          out.push({ name: `OBJ_fencepost_${long}`, material: 'prop_light', surface: null, geometry: g });
        }
      }

      /* --- the marshalling panels ---------------------------------------- */
      /*
       * Grown on the barrier rather than placed: every circuit has these all
       * the way round, at a spacing nobody chooses per panel. Both meshes are
       * merged into one apiece per side, so a lap of twenty panels is two draw
       * calls and not forty.
       *
       * The screen faces the CARS, so its forward axis is the inward normal of
       * the barrier it sits on, and it stands a little proud of the line so a
       * catch fence does not draw through the middle of the picture.
       */
      {
        const cases: THREE.BufferGeometry[] = [];
        const screens: THREE.BufferGeometry[] = [];
        const lap = fr[n - 1].dist;
        const m = new THREE.Matrix4();
        const ax = new THREE.Vector3();
        const ay = new THREE.Vector3(0, 1, 0);
        const az = new THREE.Vector3();
        const at = new THREE.Vector3();
        let i = 0;
        /*
         * Spread evenly over the lap rather than stepped a fixed 250 m with
         * the remainder dumped at the seam: on a closed circuit the fixed
         * step leaves its last panel wherever the lap happens to end, which
         * put two of them nose to tail across the start line every time the
         * lap was not a clean multiple of the spacing. Dividing the lap into
         * whole steps keeps the spacing as close to the asked-for figure as
         * it can be AND identical between the last panel and the first.
         */
        const step = lap / Math.max(1, Math.round(lap / PANEL_SPACING));
        for (let s = side === 'L' ? 0 : step / 2; s < lap - step / 2; s += step) {
          while (i + 1 < n && fr[i + 1].dist < s) i++;
          // Nothing to hang it on where the barrier is open or absent. The
          // clearance is measured in metres, like the opening itself: a panel
          // half over a gate would hang off the end of the armco.
          if (flags[i] !== 1) continue;
          // Nor anywhere the author has opened the barrier: a lit panel hung
          // in the middle of a gap is standing on nothing at all.
          if (!front.some(([lo, hi]) => s >= lo - PANEL_W && s <= hi + PANEL_W)) continue;
          // Measured against where the openings ACTUALLY are, not against the
          // 400 m marks they were asked for: an opening is centred in the
          // plate it falls in, which can be half a plate off the mark.
          if (openings.some((c) => Math.abs(s - c) < GATE_WIDTH / 2 + PANEL_W)) continue;
          // Up at the knee of the fence, where the vertical mesh folds into
          // the lean: eye height for a following car. On a barrier too low to
          // reach up there -- plain armco, or a fence wound right down -- the
          // panel keeps the same height anyway and gets posts of its own
          // below, so switching the barrier style never moves the boards.
          const panelMid = Math.max(
            solid + PANEL_H / 2 + 0.08,
            (fence ? road.wallHeight : PANEL_MOUNT_TOP) - PANEL_H / 2 - 0.06,
          );
          const mounted = panelMid - PANEL_H / 2 > road.wallHeight - 0.2;

          // The unrotated inward normal, kept for standing the panel clear of
          // the barrier; the screen itself is then yawed to face up the road,
          // against the traffic, so a driver reads it on the approach.
          az.copy(fr[i].right).multiplyScalar(-away).normalize();
          const yaw = THREE.MathUtils.degToRad(PANEL_YAW);
          // Hung on the fence it stands a whisker proud of the mesh, on the
          // track side like the real thing. On its own posts it goes BEHIND
          // the barrier instead -- a scaffold on the racing side of an armco
          // is a thing to crash into. Either way the clearance grows with the
          // yaw, so the swung wing never pokes through the barrier.
          const wing = Math.sin(yaw) * (PANEL_W / 2 + 0.1);
          at.copy(base[i]).addScaledVector(az, mounted ? -(0.4 + wing) : PANEL_PROUD + wing);
          az.multiplyScalar(Math.cos(yaw)).addScaledVector(fr[i].fwd, -Math.sin(yaw)).normalize();
          ax.crossVectors(ay, az).normalize();
          at.y += panelMid;
          m.makeBasis(ax, ay, az);
          m.setPosition(at);
          const shell = new THREE.BoxGeometry(PANEL_W + 0.14, PANEL_H + 0.14, 0.12);
          shell.translate(0, 0, -0.07);
          cases.push(shell.applyMatrix4(m));
          const face = new THREE.BoxGeometry(PANEL_W, PANEL_H, 0.03);
          face.translate(0, 0, 0.01);
          screens.push(face.applyMatrix4(m));
          // The mounting. A board floating above a knee-high rail hangs on
          // nothing; two posts from the ground to its top corners carry it,
          // exactly where a scaffold would stand.
          if (mounted) {
            const h = panelMid + PANEL_H / 2;
            for (const sx of [-1, 1]) {
              const post = new THREE.BoxGeometry(0.09, h, 0.09);
              post.translate(sx * (PANEL_W / 2 - 0.12), h / 2 - panelMid, -0.15);
              cases.push(post.applyMatrix4(m));
            }
          }
        }
        if (screens.length > 0) {
          const shells = mergeGeometries(cases, false);
          const faces = mergeGeometries(screens, false);
          for (const g of cases) g.dispose();
          for (const g of screens) g.dispose();
          if (shells) {
            out.push({ name: `OBJ_flagpanel_${long}_case`, material: 'prop_dark', surface: null, geometry: shells });
          }
          if (faces) {
            out.push({ name: `OBJ_flagpanel_${long}`, material: 'led_flag', surface: null, geometry: faces });
          }
        }
      }
    }
  }

  return out;
}

/**
 * The pit lane is built with the same maths but simpler: tarmac plus a thin
 * concrete apron, tagged with the PIT surface so AC enables the speed limiter.
 */
/**
 * The hairline a fully covered cross section keeps, metres. Not zero: a strip
 * of exactly no width is a row of degenerate triangles with no normal. Applies
 * to the drawn lane only -- the lead-out at either end is meant to run out.
 */
const MIN_PIT_WIDTH = 0.04;

/** Below this a band is not worth a row of triangles. */
const THIN = 1e-3;

export function buildPitMeshes(
  frames: Frame[],
  closed: boolean,
  road: RoadSettings,
  reuse?: Map<string, THREE.BufferGeometry>,
  /**
   * The band of each cross section that may be drawn, after the circuit has
   * taken back whatever the lane was lying on. Everything here -- tarmac and
   * both shoulders -- lives inside it.
   */
  clip?: PitClip,
  /** Distance along the lane where the speed limiter comes on. */
  limitStart = 0,
  /** The same measured back from the end of the lane. */
  limitEnd = 0,
  /** First and last cross section that is really the lane, not a lead-out. */
  laneFrom = 0,
  laneTo = frames.length - 1,
  /** Arc length of the lane itself, so the limiter window keeps its meaning. */
  laneLength = frames.length ? frames[frames.length - 1].dist : 0,
  /**
   * Width of the concrete either side of the lane: one width, or the tapered
   * run pitApronWidths gives for `frames`.
   */
  apronWidth: number | Float32Array = PIT_APRON,
  /**
   * How strongly each cross section is glued onto the road surface, 0..1,
   * from mergePitFrames. Where the lane rides on the road plane its concrete
   * has to lie flush with the tarmac beside it: the apron kept its full 5 cm
   * of shoulder fall plus the 4 cm edge bevel right through the junction, so
   * the wedge a car crosses entering the pits lay up to 9 cm below the
   * circuit with a clean edge along the seam. The drop fades out as the glue
   * takes hold, and comes back as the lane becomes its own surface again.
   */
  mergeWeight?: Float32Array,
): MeshDef[] {
  if (frames.length < 2) return [];
  const fr = expand(frames, closed);
  const n = fr.length;
  const out: MeshDef[] = [];
  const s = takeScratch(n);
  /* The widest the concrete ever gets, which is what the cross slope of the
     shoulder is dialled in for: a stretch where it has tapered to half falls
     half as far, so the taper flattens out rather than dropping off the end. */
  let apron = 0;
  if (typeof apronWidth === 'number') apron = Math.max(0, apronWidth);
  else for (let i = 0; i < apronWidth.length; i++) apron = Math.max(apron, apronWidth[i]);
  const apronAt = (i: number) =>
    typeof apronWidth === 'number' ? apron : (apronWidth[i < apronWidth.length ? i : 0] ?? 0);
  // The seam frame a closed loop appends is a copy of frame 0.
  const bandAt = (a: Float32Array | undefined, i: number, fallback: number) =>
    (a && a.length > 0 ? a[i < a.length ? i : 0] : fallback);

  const outL = s.edgeL;
  const lineL = s.lineL;
  const left = s.left;
  const rightE = s.right;
  const lineR = s.lineR;
  const outR = s.edgeR;
  /* The lines along the lane, where its asphalt meets the concrete beside it.
   *
   * Cut OUT of the asphalt, never laid on top of it, for the same reason the
   * track's own edge line is: a strip floating above z-fights at distance, and
   * one at exactly the same height needs a second physics surface over the
   * first.
   *
   * They run the whole length of the lane -- that is what a pit lane looks
   * like -- and they stop on the side the circuit has taken the concrete away
   * from. Past that point the lane's asphalt and the circuit's are one
   * surface, a line along the seam would be marking nothing, and the paint
   * that carries on is the one on the road (see pitTrackLines). That is the
   * handover: same place, same distance out, one line. */
  const lineWidth = road.edgeLine ? Math.max(0, road.edgeLineWidth) : 0;
  /*
   * A cross section is a band, not a pair of half widths.
   *
   * Beside the circuit the band is the whole ribbon and the lane sits in the
   * middle of it, which is the ordinary case. At the junction the centre line
   * has already run onto the tarmac, and what is left to draw is the wedge
   * lying to ONE side of it -- the acute side of the crossing, which carries on
   * until it reaches the edge too. A pair of half widths cannot say that, which
   * is why the junction used to be cut off square with a triangle of grass
   * left between the lane and the circuit.
   *
   * The band is then divided the same way every time: shoulder, lane, shoulder.
   * Any of the three may come out empty, and where the lane's own share is
   * empty the wedge is simply concrete, which is what it looks like on a real
   * circuit.
   */
  for (let i = 0; i < n; i++) {
    const f = fr[i];
    let lo = bandAt(clip?.lo, i, -(f.widthL + apronAt(i)));
    let hi = bandAt(clip?.hi, i, f.widthR + apronAt(i));
    // The drawn lane never breaks, even if it has been dragged onto the
    // circuit: a gap in the middle of a pit lane is worse than a hairline of
    // it under the tarmac. The lead-out is exempt -- running out is its job.
    if (i >= laneFrom && i <= laneTo && hi - lo < MIN_PIT_WIDTH) hi = lo + MIN_PIT_WIDTH;

    const laneLo = Math.min(Math.max(-f.widthL, lo), hi);
    const laneHi = Math.min(Math.max(f.widthR, lo), hi);
    const awL = laneLo - lo;
    const awR = hi - laneHi;
    /* A line only where there is still concrete beside the lane to separate it
       from. Where the circuit has taken that concrete the lane's edge IS the
       tarmac edge, tucked under it, and a line there would be half buried and
       marking a seam that is not a boundary any more.

       At FULL width to the very end. It used to narrow with the last of the
       concrete, which read as the paint thinning out on its way to the
       junction -- a line does not do that. The run closing onto the next
       cross section (see toPoint) already ends it on a sharp point where the
       concrete runs out, which is where the paint on the circuit takes over. */
    const room = Math.min(lineWidth, (laneHi - laneLo) / 3);
    const wL = awL > THIN ? room : 0;
    const wR = awR > THIN ? room : 0;
    s.lineWL[i] = wL;
    s.lineWR[i] = wR;

    outL[i].copy(f.pos).addScaledVector(f.right, lo);
    left[i].copy(f.pos).addScaledVector(f.right, laneLo);
    lineL[i].copy(f.pos).addScaledVector(f.right, laneLo + wL);
    lineR[i].copy(f.pos).addScaledVector(f.right, laneHi - wR);
    rightE[i].copy(f.pos).addScaledVector(f.right, laneHi);
    outR[i].copy(f.pos).addScaledVector(f.right, hi);
    /* The shoulder falls away over its full width. Held as a slope rather than
       a fixed drop, or a shoulder tapering to nothing at the junction would end
       in a cliff standing along the tarmac edge.
   
       And the last of it goes down by EDGE_SINK as well, so the concrete meets
       the ground instead of standing on it. The terrain is deliberately kept
       that far under every road mesh; at the outer edge, where the mesh stops
       and the ground takes over, the gap has nothing left to hide behind and
       stands there as a step -- which beside a pit lane is a step a car drives
       over on its way into the box. Bringing the edge down to the ground is the
       same bevel a real concrete apron has where it meets what is beside it. */
    // See mergeWeight above: flush against the road where glued, falling to
    // the ground where free. Only the DROP fades with the glue -- the bevel is
    // what meets the ground, and the ground is held EDGE_SINK under this edge
    // whether the concrete above it is glued or not.
    //
    // Neither applies to an edge the CLIP has cut: that edge lies against or
    // under the tarmac, not against the ground. Dropped anyway, the concrete
    // leaned on the racing line 6 cm below it -- a cliff along the seam where
    // a car crosses into the pits -- because the lane's glue is measured
    // between the two tarmacs and fades out over exactly the gap the 5 m of
    // concrete still spans.
    // `fr` appends at most one seam copy of frame 0.
    const glue = mergeWeight ? Math.min(1, mergeWeight[i < mergeWeight.length ? i : 0] ?? 0) : 0;
    const cutL = clip !== undefined && lo > -(f.widthL + apronAt(i)) + 0.05;
    const cutR = clip !== undefined && hi < f.widthR + apronAt(i) - 0.05;
    outL[i].y -= cutL ? 0 : shoulderDrop(PIT_APRON_DROP, awL, apron) * (1 - glue) + EDGE_SINK * (awL > THIN ? 1 : 0);
    outR[i].y -= cutR ? 0 : shoulderDrop(PIT_APRON_DROP, awR, apron) * (1 - glue) + EDGE_SINK * (awR > THIN ? 1 : 0);
    s.awL[i] = awL;
    s.awR[i] = awR;
    s.uB[i] = (laneHi - wR - (laneLo + wL)) / road.uvWidth;
    s.lane[i] = laneHi - laneLo;
  }

  const emit = (
    name: string,
    material: MaterialKey,
    surface: SurfaceKey | null,
    fill: (b: StripBuilder) => void,
    /**
     * Vertices to make room for. One strip the length of the ribbon needs
     * n * 2; a mesh that carries BOTH edge lines needs twice that.
     *
     * Not a detail: addStrip returns without a word when it would overflow the
     * buffer (see its capacity guard), so a mesh asked to hold more than it
     * was sized for simply loses the rest -- silently, with the geometry it
     * did manage looking perfectly correct. That is what left the right hand
     * edge line missing along the whole lane while the left one was there.
     */
    capacity = n * 2,
  ) => {
    const b = new StripBuilder(reuse?.get(name), capacity);
    fill(b);
    if (b.empty) {
      b.discard();
      return;
    }
    out.push({ name, material, surface, geometry: b.finish() });
  };

  for (let i = 0; i < n; i++) s.v[i] = fr[i].dist / road.uvLength;
  /* Which stretch the speed limiter applies to.
   *
   * Where the surface is a pit lane is the author's decision, not a
   * consequence of the geometry: the entry ramp is normal road until the
   * limiter line, and so is the exit past it. Everything drawn outside that
   * window is ROAD, so the limiter cannot come on where nobody put a line --
   * and that includes the whole lead-out, which is the junction with the
   * circuit and nobody's pit lane.
   */
  const laneEnd = Math.max(limitStart, laneLength - limitEnd);
  const hasLane = (i: number) => s.lane[i] > THIN;
  /* Carried one cross section past the last one with any width, where the
     strip has already narrowed to nothing. A run that stops on its last full
     cross section leaves the plate between that one and the empty one next to
     it belonging to nobody, and it is simply not drawn -- which at a junction
     is a wedge of bare ground metres long. Reaching onto the empty cross
     section turns that plate into a triangle closing on a point.

     Used by every optional strip of the ribbon: both edge lines and both
     concrete shoulders. */
  const toPoint = (span: [number, number]): [number, number] => [
    span[0] > 0 && hasLane(span[0] - 1) ? span[0] - 1 : span[0],
    span[1] < n - 1 && hasLane(span[1] + 1) ? span[1] + 1 : span[1],
  ];
  const inLimit = (i: number) =>
    i >= laneFrom && i <= laneTo && fr[i].dist >= limitStart && fr[i].dist <= laneEnd;

  /* The ribbon is drawn end to end with no gaps.
   *
   * The two surfaces SHARE their boundary cross section rather than each
   * taking the range it owns. A strip is quads between cross sections, so two
   * ranges that merely abut -- one ending at k, the next starting at k+1 --
   * leave the quad from k to k+1 belonging to neither, and it is simply never
   * drawn. That is one missing plate exactly at the limiter line, which is
   * what the hole at pit s = 12 m turned out to be. Sharing k puts the quad
   * before it in the first range and the quad after it in the second: no gap,
   * and no overlap either, so no two drivable surfaces on top of each other.
   */
  const reachOver = (span: [number, number]): [number, number] => {
    const [a, z] = span;
    return [
      a > 0 && hasLane(a - 1) ? a - 1 : a,
      z < n - 1 && hasLane(z + 1) ? z + 1 : z,
    ];
  };

  // Same as the circuit's tarmac: a lane that leaves a banked corner twists,
  // and the fold in its plates is felt at pit speed as much as at racing speed.
  const cols = road.crossCut ? twistColumns(fr, false) : 1;
  emit('1PIT_lane', 'asphalt', 'PIT', (b) => {
    for (const [a, z] of runs(n, (i) => hasLane(i) && inLimit(i))) {
      b.addStrip(lineL, lineR, s.zeros, s.uB, s.v, a, z, cols);
    }
  }, n * 2 * cols);
  emit('1ROAD_pit_entry', 'asphalt', 'ROAD', (b) => {
    for (const span of runs(n, (i) => hasLane(i) && !inLimit(i))) {
      const [a, z] = reachOver(span);
      b.addStrip(lineL, lineR, s.zeros, s.uB, s.v, a, z, cols);
    }
  }, n * 2 * cols);

  for (let i = 0; i < n; i++) s.v[i] = fr[i].dist / 8;
  /* The shoulder is drawn wherever it has any width at all, and simply runs
     out where the circuit takes the room. The old threshold was 5 cm, which on
     its own is nothing -- but it was a threshold on a width that swung with
     the merge weight, so it switched whole stretches on and off. */
  /* Carried one cross section past the last one that has any width, the same
     way the lines are. Where the circuit eats the concrete away, one cross
     section still has half a metre of it and the next has none -- and the
     plate between those two belongs to neither run, so it was simply not
     drawn: a 0.22 m wedge of bare ground at the junction, on the demo circuit
     at pit s=228. Reaching onto the empty cross section makes that plate a
     triangle that closes on the point where the concrete runs out. */
  /*
   * The concrete is PIT LANE where the lane is.
   *
   * It used to be CONCRETE from end to end, and concrete is not a pit lane as
   * far as the game is concerned: a car with two wheels on it -- which is every
   * car pulling into a box, because that is where the box is -- had no speed
   * limiter. The strip is the working lane of a real pit complex, not a verge,
   * so inside the limiter window it carries the same surface the tarmac does
   * and only outside it, along the entry and the exit, is it plain concrete.
   *
   * Split with reachOver rather than toPoint, for the same reason the tarmac
   * is: two ranges that merely abut leave the plate between them belonging to
   * neither, and that hole would sit exactly on the limiter line.
   */
  const apronSide = (
    side: 'left' | 'right',
    width: number[],
    /** The two edges of the strip, in the winding that faces up. */
    edgeA: THREE.Vector3[],
    edgeB: THREE.Vector3[],
  ) => {
    const has = (i: number) => width[i] > THIN;
    /*
     * Every run reaches one cross section FORWARD, and back only into one with
     * no concrete on it at all.
     *
     * Forward covers both things that can be on the other side of the end of a
     * run. Where the concrete carries on but the surface changes -- the limiter
     * line -- the plate between the two belongs to the run before it, and
     * without that it belongs to neither and is simply not drawn: a hole across
     * the apron, exactly where the limiter comes on. Where the concrete stops
     * instead, the same reach turns that last plate into the triangle closing
     * on a point that the taper wants. Backwards there is nothing to collect:
     * the run before has already drawn the plate, and reaching back would draw
     * it twice -- two drivable surfaces in the same place.
     */
    const spread = (span: [number, number]): [number, number] => [
      span[0] > 0 && !has(span[0] - 1) ? span[0] - 1 : span[0],
      span[1] < n - 1 ? span[1] + 1 : span[1],
    ];
    const lay = (b: StripBuilder, a: number, z: number) =>
      b.addStrip(edgeA, edgeB, s.zeros, s.uA, s.v, a, z);
    const both = (name: string, surface: SurfaceKey, keep: (i: number) => boolean) => {
      emit(name, 'concrete', surface, (b) => {
        for (let i = 0; i < n; i++) s.uA[i] = width[i] / 8;
        for (const span of runs(n, (i) => has(i) && keep(i))) {
          const [a, z] = spread(span);
          lay(b, a, z);
        }
      });
    };
    both(`1PIT_apron_${side}`, 'PIT', inLimit);
    both(`1CONCRETE_pit_apron_${side}`, 'CONCRETE', (i) => !inLimit(i));
  };
  apronSide('left', s.awL, outL, left);
  apronSide('right', s.awR, rightE, outR);

  /* The line itself, tagged the same way the surface beside it is: pit lane
     inside the limiter window, plain road outside it. One 14 cm strip of the
     wrong surface running the length of the lane is enough to give a car a
     wheel on the road where the limiter should be on. */
  const lineRun = (i: number) => s.lineWL[i] > THIN || s.lineWR[i] > THIN;
  const paint = (name: string, surface: SurfaceKey, keep: (i: number) => boolean) => {
    emit(name, 'line_white', surface, (b) => {
      for (const span of runs(n, (i) => s.lineWL[i] > THIN && keep(i))) {
        const [a, z] = toPoint(span);
        b.addStrip(left, lineL, s.zeros, s.ones, s.v, a, z);
      }
      for (const span of runs(n, (i) => s.lineWR[i] > THIN && keep(i))) {
        const [a, z] = toPoint(span);
        b.addStrip(lineR, rightE, s.zeros, s.ones, s.v, a, z);
      }
    }, n * 4);
  };
  if (lineWidth > 0) {
    paint('1PIT_line', 'PIT', (i) => lineRun(i) && inLimit(i));
    paint('1ROAD_line_pit', 'ROAD', (i) => lineRun(i) && !inLimit(i));
  }

  /* The limiter line: the solid white band painted ACROSS the lane where the
   * speed limit starts and where it ends.
   *
   * Every real pit lane has one and the editor had nowhere to see the setting
   * -- limitStart and limitEnd changed which triangles carried the PIT surface
   * and nothing else, so the one thing the author is choosing was invisible.
   *
   * Laid on the lane rather than cut out of it, which the road's own edge line
   * is careful not to do: a strip along the ribbon can be cut out because it
   * runs WITH the cross sections, and one across it cannot without splitting
   * every cross section it lands between. It rides high enough above the
   * tarmac to keep out of the depth buffer's way and far too low for a wheel
   * to notice.
   *
   * It is named OUT of the physics namespace, and that is the part that
   * matters. AC classifies a mesh by its NAME, not by anything the exporter
   * writes about it -- see ini.ts, "a mesh is physical when its name, ignoring
   * the first character, starts with one of the KEY values". Called
   * 1ROAD_line_pit_limit_in it was a second drivable ROAD surface floating
   * exactly 8 mm over the lane, measured over every one of 306 sample points:
   * the step across the racing line this file warns about elsewhere, built by
   * the warning's own author.
   *
   * Renaming it 1OBJ_ was only half a cure, and the half that did nothing: the
   * leading digit is what hands a mesh to the physics, not the key that
   * follows it. Kunos' own road overlays carry no digit at all -- magione's
   * racing groove sits 10 to 25 mm over the tarmac and is called `groove`.
   * So does this one now. See the note on the grid boxes in gridBoxes.ts.
   */
  const LIMIT_LINE = 0.3;
  const LIMIT_LIFT = 0.008;
  const edgeAt = (arr: THREE.Vector3[], d: number, into: THREE.Vector3) => {
    let i = 0;
    while (i < n - 2 && fr[i + 1].dist < d) i += 1;
    const span = fr[i + 1].dist - fr[i].dist;
    const t = span > 1e-6 ? Math.min(1, Math.max(0, (d - fr[i].dist) / span)) : 0;
    into.copy(arr[i]).lerp(arr[i + 1], t);
    into.y += LIMIT_LIFT;
  };
  const band = (at: number, name: string) => {
    if (!(at > fr[0].dist + LIMIT_LINE) || !(at < fr[n - 1].dist - LIMIT_LINE)) return;
    const lower = [new THREE.Vector3(), new THREE.Vector3()];
    const upper = [new THREE.Vector3(), new THREE.Vector3()];
    edgeAt(left, at - LIMIT_LINE / 2, lower[0]);
    edgeAt(left, at + LIMIT_LINE / 2, lower[1]);
    edgeAt(rightE, at - LIMIT_LINE / 2, upper[0]);
    edgeAt(rightE, at + LIMIT_LINE / 2, upper[1]);
    // Edge to edge of the lane, lines included: on a real circuit the limiter
    // line runs the full width and butts up against the kerb either side.
    if (lower[0].distanceTo(upper[0]) < 0.5) return;
    emit(name, 'line_white', null, (b) => b.addStrip(lower, upper, [0, 0], [1, 1], [0, 1], 0, 1));
  };
  band(limitStart, 'OBJ_pit_limit_in');
  band(laneEnd, 'OBJ_pit_limit_out');

  return out;
}

/**
 * What a deco road's surface choice means: the material it is drawn with and
 * the physics surface its mesh name carries. Both existing keys, so the
 * exporter's surfaces.ini already knows every one of them and the road is
 * drivable in the game with no new plumbing.
 */
const DECO_LOOK: Record<DecoSurface, { material: MaterialKey; surface: SurfaceKey; prefix: string }> = {
  asphalt: { material: 'asphalt', surface: 'ROAD', prefix: '1ROAD' },
  concrete: { material: 'concrete', surface: 'CONCRETE', prefix: '1CONCRETE' },
};

/** How far the outer edge of a deco road falls to meet the ground. */
const DECO_EDGE_DROP = 0.04;

/** Width of an access road's dashed centre line, metres. */
const DECO_LINE_WIDTH = 0.12;

/** Metres of road per dash-and-gap of its centre line (see PIT_DASH). */
const DECO_DASH = 6;

/**
 * One decorative road, as a ribbon of its chosen surface.
 *
 * The same shape the pit lane's tarmac has, without the pit complex around it:
 * a flat lane between the two half widths, and a short bevel either side that
 * takes the edge down to the ground the way the pit apron's outer edge does --
 * the terrain corridor holds the ground EDGE_SINK under every road mesh, and
 * without the bevel that gap stands along both edges as a step.
 *
 * `clip` and `mergeWeight` come from the same pit-junction machinery the lane
 * uses: where an end has been brought up to the circuit, the ribbon is carried
 * on as a wedge over the tarmac (pitLead), glued onto the road plane
 * (mergePitFrames) and cut back against the tarmac's real edge (pitRoadClip),
 * so the junction is a seam and not a pile of surfaces.
 */
export function buildDecoRoadMeshes(
  frames: Frame[],
  closed: boolean,
  road: RoadSettings,
  surface: DecoSurface,
  /** Mesh name suffix, unique per road. */
  key: string,
  reuse?: Map<string, THREE.BufferGeometry>,
  clip?: PitClip,
  /**
   * Paint the dashed centre line an ordinary public road carries. It runs
   * where the road is whole and wide enough to be two-way, and stops wherever
   * the clip has taken a bite -- a junction is exactly where a real centre
   * line stops -- so it never runs onto the circuit or across a crossing.
   */
  centreLine = false,
): MeshDef[] {
  if (frames.length < 2) return [];
  const fr = expand(frames, closed);
  const n = fr.length;
  const s = takeScratch(n);
  const look = DECO_LOOK[surface];

  const outL = s.edgeL;
  const left = s.left;
  const rightE = s.right;
  const outR = s.edgeR;
  /* The two edges of the centre line band. Scratch has no spare Vector3
     arrays, so these borrow the line arrays the circuit's edge lines use. */
  const lineL = s.lineL;
  const lineR = s.lineR;
  const lineOn = s.paint;
  const bandAt = (a: Float32Array | undefined, i: number, fallback: number) =>
    (a && a.length > 0 ? a[i < a.length ? i : 0] : fallback);

  for (let i = 0; i < n; i++) {
    const f = fr[i];
    // The bevel lives INSIDE the drawn width, so the drivable middle is what
    // is left of the band once both edges have taken their share.
    const bevel = Math.min(0.5, (f.widthL + f.widthR) * 0.12);
    let lo = bandAt(clip?.lo, i, -f.widthL);
    let hi = bandAt(clip?.hi, i, f.widthR);
    if (hi < lo) hi = lo;
    const laneLo = Math.min(lo + bevel, hi);
    const laneHi = Math.max(hi - bevel, laneLo);
    const cutL = clip !== undefined && lo > -f.widthL + 0.05;
    const cutR = clip !== undefined && hi < f.widthR - 0.05;

    outL[i].copy(f.pos).addScaledVector(f.right, lo);
    left[i].copy(f.pos).addScaledVector(f.right, laneLo);
    rightE[i].copy(f.pos).addScaledVector(f.right, laneHi);
    outR[i].copy(f.pos).addScaledVector(f.right, hi);
    // An edge the clip has cut lies against the circuit's tarmac, not against
    // the ground, and must stay on the road plane.
    outL[i].y -= cutL ? 0 : DECO_EDGE_DROP + EDGE_SINK;
    outR[i].y -= cutR ? 0 : DECO_EDGE_DROP + EDGE_SINK;
    s.awL[i] = laneLo - lo;
    s.awR[i] = hi - laneHi;
    s.lane[i] = laneHi - laneLo;
    s.uA[i] = (laneLo - lo) / road.uvWidth;
    s.uB[i] = (laneHi - laneLo) / road.uvWidth;
    s.v[i] = f.dist / road.uvLength;
    s.vDash[i] = fr[i].dist / DECO_DASH;

    /* The centre line's band: 12 cm astride the middle of what is actually
       drawn. Off wherever the clip has been at either edge (that is a
       junction or a crossing), and off below two-way width -- a 4 m service
       path with a centre line reads as a toy. */
    const mid = (laneLo + laneHi) / 2;
    const want = centreLine && !cutL && !cutR && s.lane[i] > 4.5;
    const half = want ? DECO_LINE_WIDTH / 2 : 0;
    lineOn[i] = want ? 1 : 0;
    lineL[i].copy(f.pos).addScaledVector(f.right, mid - half);
    lineR[i].copy(f.pos).addScaledVector(f.right, mid + half);
  }

  const cols = road.crossCut ? twistColumns(fr, false) : 1;
  const b = new StripBuilder(reuse?.get(`${look.prefix}_${key}`), n * (4 + 4 * cols));
  const hasLane = (i: number) => s.lane[i] > THIN;
  const reachOver = (span: [number, number]): [number, number] => [
    span[0] > 0 && hasLane(span[0] - 1) ? span[0] - 1 : span[0],
    span[1] < n - 1 && hasLane(span[1] + 1) ? span[1] + 1 : span[1],
  ];
  /* Where the line runs, the lane is drawn in two halves either side of it,
     exactly the way the circuit's own plate parts around its pit-exit line:
     a strip laid on top would z-fight at distance. */
  for (const span of runs(n, hasLane)) {
    const [a, z] = reachOver(span);
    b.addStrip(left, lineL, s.zeros, s.uB, s.v, a, z, cols);
    b.addStrip(lineR, rightE, s.zeros, s.uB, s.v, a, z, cols);
  }
  for (const span of runs(n, (i) => s.awL[i] > THIN)) {
    const [a, z] = reachOver(span);
    b.addStrip(outL, left, s.zeros, s.uA, s.v, a, z);
  }
  for (const span of runs(n, (i) => s.awR[i] > THIN)) {
    const [a, z] = reachOver(span);
    b.addStrip(rightE, outR, s.zeros, s.uA, s.v, a, z);
  }
  if (b.empty) {
    b.discard();
    return [];
  }
  const out: MeshDef[] = [
    { name: `${look.prefix}_${key}`, material: look.material, surface: look.surface, geometry: b.finish() },
  ];

  let anyLine = false;
  for (let i = 0; i < n; i++) if (lineOn[i] > 0) { anyLine = true; break; }
  if (anyLine) {
    const lb = new StripBuilder(reuse?.get(`${look.prefix}_line_${key}`), n * 2);
    for (const [a, z] of runs(n, (i) => lineOn[i] > 0)) {
      lb.addStrip(lineL, lineR, s.zeros, s.ones, s.vDash, a, z);
    }
    if (lb.empty) lb.discard();
    else {
      out.push({
        name: `${look.prefix}_line_${key}`,
        material: 'line_dashed',
        surface: look.surface,
        geometry: lb.finish(),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Barrier handles                                                     */
/* ------------------------------------------------------------------ */

/**
 * How tall the grab handle for a barrier of `wallHeight` should be.
 *
 * The handle used to be built at the full barrier height. Harmless while a
 * barrier was a 1.1 m wall; useless the moment it could be a 3.6 m catch
 * fence, because the handles are drawn with the depth test off so they can be
 * found behind scenery -- a full height one paints itself straight over the
 * barrier it belongs to. Switching the style then changed nothing anyone could
 * see: the fence was there the whole time, behind a wall of green.
 *
 * Knee height leaves a target big enough to hit and the barrier itself on show
 * above it. Lives here rather than in the viewport so the rule can be tested
 * without a canvas.
 */
export function barrierHandleHeight(wallHeight: number): number {
  return Math.min(1.2, Math.max(0.8, wallHeight));
}

export interface BarrierHandles {
  count: number;
  /** Flat 4x4 matrices, laid out for an InstancedMesh. */
  matrices: Float32Array;
  /** The control point whose wall flag each handle writes to. */
  nodeOf: Int32Array;
  /** Which side of the road each handle stands on. -1 left, 1 right. */
  sideOf: Int8Array;
}

/**
 * One grab handle per stretch of roadside, standing where the barrier stands.
 *
 * The barrier is stored per control point, so a stretch of it is whatever lies
 * between two of them. A handle therefore has to know which point it writes
 * to, and that mapping has to be exactly the one `computeFrames` used when it
 * handed the flags to the cross sections, or clicking a handle would toggle a
 * barrier somewhere else. Both derive it from the curve parameter, which is
 * why the frames carry `t`.
 */
export function barrierHandles(
  frames: Frame[],
  profile: SideProfile,
  nodeCount: number,
  closed: boolean,
  height: number,
  thickness = 0.5,
): BarrierHandles | null {
  const n = frames.length;
  const segCount = closed ? nodeCount : nodeCount - 1;
  if (n < 2 || segCount < 1) return null;

  const spans = closed ? n : n - 1;
  const count = spans * 2;
  const matrices = new Float32Array(count * 16);
  const nodeOf = new Int32Array(count);
  const sideOf = new Int8Array(count);

  const m = new THREE.Matrix4();
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const centre = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();

  let k = 0;
  for (let i = 0; i < spans; i++) {
    const a = frames[i];
    const ib = (i + 1) % n;
    const b = frames[ib];

    let owner = Math.floor(a.t * segCount);
    owner = closed
      ? ((owner % segCount) + segCount) % segCount
      : Math.min(Math.max(owner, 0), segCount - 1);

    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const outA =
        side < 0
          ? a.widthL + profile.kerbWL[i] + profile.apronL[i] + profile.runoffL[i] + profile.wallGapL[i]
          : a.widthR + profile.kerbWR[i] + profile.apronR[i] + profile.runoffR[i] + profile.wallGapR[i];
      const outB =
        side < 0
          ? b.widthL + profile.kerbWL[ib] + profile.apronL[ib] + profile.runoffL[ib] + profile.wallGapL[ib]
          : b.widthR + profile.kerbWR[ib] + profile.apronR[ib] + profile.runoffR[ib] + profile.wallGapR[ib];
      edgeA.copy(a.pos).addScaledVector(a.right, side * outA);
      edgeB.copy(b.pos).addScaledVector(b.right, side * outB);

      zAxis.subVectors(edgeB, edgeA);
      const length = zAxis.length();
      if (length < 1e-4) {
        // Two cross sections on top of each other. Collapse the handle rather
        // than divide by nothing and fill the buffer with NaNs.
        m.makeScale(0, 0, 0);
      } else {
        zAxis.multiplyScalar(1 / length);
        xAxis.crossVectors(up, zAxis);
        if (xAxis.lengthSq() < 1e-9) xAxis.set(1, 0, 0);
        xAxis.normalize().multiplyScalar(thickness);
        yAxis.set(0, height, 0);
        zAxis.multiplyScalar(length);
        centre.addVectors(edgeA, edgeB).multiplyScalar(0.5);
        centre.y += height / 2;
        // makeBasis wants the columns already scaled, so each axis carries the
        // handle's thickness, its height and the length of this stretch.
        m.makeBasis(xAxis, yAxis, zAxis);
        m.setPosition(centre);
      }
      m.toArray(matrices, k * 16);
      nodeOf[k] = owner;
      sideOf[k] = side;
      k++;
    }
  }

  return { count, matrices, nodeOf, sideOf };
}

/* ------------------------------------------------------------------ */
/* Handles for the kerb tool                                            */
/* ------------------------------------------------------------------ */

/** How tall a kerb handle stands. Low on purpose -- see below. */
export const KERB_HANDLE_HEIGHT = 0.3;
/** Narrowest a handle gets, so a hairline kerb is still something to hit. */
const KERB_HANDLE_MIN_WIDTH = 0.9;

export interface KerbHandles {
  count: number;
  matrices: Float32Array;
  /** Curve parameter at the two ends of the stretch each handle covers. */
  fromT: Float32Array;
  toT: Float32Array;
  sideOf: Int8Array;
  /** Index into road.kerbs of the span covering it, or -1 for bare roadside. */
  spanOf: Int32Array;
}

/**
 * One grab handle per stretch of roadside and side, lying where a kerb goes.
 *
 * Unlike the barrier's, these do not point at a control point: a span starts
 * and ends at a curve parameter of its own, so a handle carries the parameters
 * of the stretch it covers and the tool builds a span out of the first and last
 * it was dragged across. That is the whole reason kerbs stopped being flags on
 * the control points -- being able to start one halfway into a corner.
 *
 * They lie flat and only 30 cm tall, and their material draws over everything.
 * A tall handle would hide the very kerb it is there to edit, which is exactly
 * what made the catch fence look like the barrier switch did nothing.
 */
export function kerbHandles(
  frames: Frame[],
  profile: SideProfile,
  road: RoadSettings,
  closed: boolean,
): KerbHandles | null {
  const n = frames.length;
  if (n < 2) return null;
  const spans = closed ? n : n - 1;
  const count = spans * 2;
  const matrices = new Float32Array(count * 16);
  const fromT = new Float32Array(count);
  const toT = new Float32Array(count);
  const sideOf = new Int8Array(count);
  const spanOf = new Int32Array(count);

  const m = new THREE.Matrix4();
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const centre = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();

  let k = 0;
  for (let i = 0; i < spans; i++) {
    const a = frames[i];
    const ib = (i + 1) % n;
    const b = frames[ib];
    // The end of the last stretch of a loop is the start of the lap again.
    const tA = a.t;
    const tB = ib === 0 ? 1 : b.t;

    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const idx = side < 0 ? profile.kerbSpanL[i] : profile.kerbSpanR[i];
      const span = idx >= 0 ? road.kerbs[idx] : undefined;
      const want = Math.max(KERB_HANDLE_MIN_WIDTH, span ? span.width : road.kerbWidth);
      const halfA = side < 0 ? a.widthL : a.widthR;
      const halfB = side < 0 ? b.widthL : b.widthR;
      // Sitting just outside the tarmac edge, where the kerb itself would be.
      edgeA.copy(a.pos).addScaledVector(a.right, side * (halfA + want / 2));
      edgeB.copy(b.pos).addScaledVector(b.right, side * (halfB + want / 2));

      zAxis.subVectors(edgeB, edgeA);
      const length = zAxis.length();
      if (length < 1e-4) {
        m.makeScale(0, 0, 0);
      } else {
        zAxis.multiplyScalar(1 / length);
        xAxis.crossVectors(up, zAxis);
        if (xAxis.lengthSq() < 1e-9) xAxis.set(1, 0, 0);
        xAxis.normalize().multiplyScalar(want);
        yAxis.set(0, KERB_HANDLE_HEIGHT, 0);
        zAxis.multiplyScalar(length);
        centre.addVectors(edgeA, edgeB).multiplyScalar(0.5);
        centre.y += KERB_HANDLE_HEIGHT / 2;
        m.makeBasis(xAxis, yAxis, zAxis);
        m.setPosition(centre);
      }
      m.toArray(matrices, k * 16);
      fromT[k] = tA;
      toT[k] = tB;
      sideOf[k] = side;
      spanOf[k] = idx;
      k++;
    }
  }

  return { count, matrices, fromT, toT, sideOf, spanOf };
}

/** Merge all meshes of one material into a single geometry for fast preview. */
export function mergeForPreview(defs: MeshDef[]): Map<MaterialKey, THREE.BufferGeometry[]> {
  const byMat = new Map<MaterialKey, THREE.BufferGeometry[]>();
  for (const d of defs) {
    const list = byMat.get(d.material) ?? [];
    list.push(d.geometry);
    byMat.set(d.material, list);
  }
  return byMat;
}
