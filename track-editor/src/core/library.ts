import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SurfaceKey } from '../types';
import { assetBox, assetIdOf } from '../io/assetCache';
import type { MaterialKey } from './road';
import { startGantryParts } from './gantry';
import { SIGN_DISTANCES, TREE_CARDS, TREE_CARD_INSET, TREE_SHEET_TILES, type TreeCardName } from './textures';

/**
 * Procedural prop library. Every object is built from primitives so the whole
 * editor stays a single self contained bundle with no asset downloads.
 * Each prop is authored with its origin on the ground and +Z facing forward.
 */

/**
 * Which part of an object defines where its edge is.
 *
 * 'body' is the solid you would touch if you walked into it: the walls, the
 * crash barrier rail, the slab. 'trim' is everything that hangs off it -- roof
 * eaves, signage, glazing, a canopy. Tiling and edge snapping measure the body
 * only, because two buildings are flush when their WALLS meet; measuring the
 * roof instead puts them a full overhang apart, which is exactly the gap that
 * used to run through the middle of every pit complex.
 */
export type PartRole = 'body' | 'trim';

export interface PropPart {
  geometry: THREE.BufferGeometry;
  material: MaterialKey;
  role: PartRole;
}

export interface PropDef {
  key: string;
  label: string;
  category: 'Nature' | 'Barriers' | 'Buildings' | 'Track furniture' | 'Ground' | 'Vehicles';
  /** Physical surface for the exported mesh. null = decoration only. */
  surface: SurfaceKey | null;
  /**
   * Superseded: still built, so projects that already hold one keep it, but
   * not offered in the palette any more. Deleting the entry outright would
   * turn every copy in an existing track into an invisible nothing.
   */
  hidden?: boolean;
  build: () => PropPart[];
}

/* --- primitive helpers ---------------------------------------------- */

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry {
  if (ry !== 0) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0) =>
  place(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, ry);

const cyl = (r: number, h: number, x = 0, y = 0, z = 0, seg = 12) =>
  place(new THREE.CylinderGeometry(r, r, h, seg), x, y + h / 2, z);

/**
 * A tyre: a short cylinder with the hole showing through it.
 *
 * Eight segments, not fourteen. A tyre wall is twenty one of these in one 6 m
 * module and gets placed in runs down the whole outside of a chicane, which
 * made it by far the most expensive thing in the library -- 1764 triangles a
 * module against 624 for a whole tree. At tyre size the two are indistinguish-
 * able from a car; from a helicopter you would not be looking at the tyres.
 */
const tube = (rOuter: number, rInner: number, h: number, x = 0, y = 0, z = 0) => {
  const g = new THREE.CylinderGeometry(rOuter, rOuter, h, 8, 1, false);
  const inner = new THREE.CylinderGeometry(rInner, rInner, h * 1.02, 8, 1, true);
  const merged = mergeGeometries([g, inner], false)!;
  return place(merged, x, y + h / 2, z);
};

const cone = (r: number, h: number, x = 0, y = 0, z = 0, seg = 12) =>
  place(new THREE.ConeGeometry(r, h, seg), x, y + h / 2, z);

/** A tapered column, for masts and turbine towers. */
const taper = (rBottom: number, rTop: number, h: number, x = 0, y = 0, z = 0, seg = 10) =>
  place(new THREE.CylinderGeometry(rTop, rBottom, h, seg), x, y + h / 2, z);

/**
 * A road wheel: a disc lying on its side, its bottom on the ground.
 *
 * Eight segments rather than the usual twelve. A car is placed by the dozen in
 * a car park and four wheels are most of its triangle count, so this is where
 * the saving is; at wheel size nobody can tell the two apart.
 */
const wheel = (x: number, z: number, r = 0.33, w = 0.24) => {
  const g = new THREE.CylinderGeometry(r, r, w, 8);
  g.rotateZ(Math.PI / 2);
  g.translate(x, r, z);
  return g;
};

/**
 * Repeat a geometry's texture instead of stretching one tile over it.
 *
 * The chain link tile is authored for four metres of fence; laid once over an
 * 8 m panel the wire comes out twice as thick as on the generated barrier
 * beside it, and the two read as different fences. Box UVs run 0..1 per face,
 * so scaling them is all it takes.
 */
const tileUv = (g: THREE.BufferGeometry, repeatU: number, repeatV: number) => {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeatU, uv.getY(i) * repeatV);
  uv.needsUpdate = true;
  return g;
};

/**
 * One ribbon of the catch fence cross section, 8 m long: quads strung between
 * the given (x, y, u) stations, exactly the way the run generator strips its
 * barrier -- U up the profile, V along the run in FENCE_UV metres, normals
 * facing the track side (-X).
 *
 * `both` adds a second, back-facing copy for pieces whose material is culled
 * one-sided in the game (the armco steel): the run generator gets away with
 * one side because its barrier is only ever seen from the circuit, a placed
 * module has no wrong side to hide. The copy sits half a centimetre behind
 * the front rather than exactly on it, because two coincident faces fight
 * over the depth buffer.
 *
 * The WINDING has to agree with the normal, and that is the whole trick here:
 * the run generator never has to think about it because it takes its normals
 * from the face it just wound (StripBuilder.accumulate), while these are
 * written out by hand. Wound the other way, a renderer showing both sides
 * flips the normal on every fragment that is really looking at the back of
 * the triangle -- so the track side of the barrier, the one side that has to
 * look right, was the side that got lit from behind and came out dark.
 */
const wallStrip = (
  stations: ReadonlyArray<readonly [number, number, number]>,
  both: boolean,
): THREE.BufferGeometry => {
  const HZ = 4.0;
  const UV = 4;
  const GAP = 0.005;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const quad = (
    x0: number, y0: number, u0: number,
    x1: number, y1: number, u1: number,
    back: boolean,
  ) => {
    const at = pos.length / 3;
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const s = back ? 1 : -1;
    const nx = (s * (y1 - y0)) / len;
    const ny = (-s * (x1 - x0)) / len;
    const off = back ? GAP : 0;
    pos.push(
      x0 + nx * off, y0 + ny * off, -HZ,
      x0 + nx * off, y0 + ny * off, HZ,
      x1 + nx * off, y1 + ny * off, HZ,
      x1 + nx * off, y1 + ny * off, -HZ,
    );
    for (let i = 0; i < 4; i++) nrm.push(nx, ny, 0);
    uv.push(u0, -HZ / UV, u0, HZ / UV, u1, HZ / UV, u1, -HZ / UV);
    // Corners run (x0,-HZ) (x0,+HZ) (x1,+HZ) (x1,-HZ), so 0-1-2 turns the way
    // that puts the face on the same side as `nx, ny` above, and 0-2-1 the
    // other way. Which is which is not something to take on trust: the four
    // corners are laid out in the push above, and the cross product of
    // (v1-v0) with (v2-v0) is what these two orders disagree about.
    if (back) idx.push(at, at + 2, at + 1, at, at + 3, at + 2);
    else idx.push(at, at + 1, at + 2, at, at + 2, at + 3);
  };
  for (let k = 0; k + 1 < stations.length; k++) {
    const [x0, y0, u0] = stations[k];
    const [x1, y1, u1] = stations[k + 1];
    quad(x0, y0, u0, x1, y1, u1, false);
    if (both) quad(x0, y0, u0, x1, y1, u1, true);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
};

/**
 * The folded W-beam armco stack of the generated barrier, as one 8 m module.
 *
 * Copied fold for fold from road.ts (GUARDRAIL_FOLD, GUARDRAIL_OUT, three
 * beams over the 1 m base, one texture tile per beam): the module and the
 * painted run have to be the SAME steel, and the flat boxes this replaces
 * were a different product with the same paint.
 */
const armcoW = (): THREE.BufferGeometry => {
  const FOLD = [
    [0.0, 0.0],
    [0.09, 1.0],
    [0.91, 1.0],
    [1.0, 0.0],
  ] as const;
  const OUT = 0.07;
  const RAILS = 3;
  const RH = 1.0 / RAILS;
  const rails: THREE.BufferGeometry[] = [];
  for (let r = 0; r < RAILS; r++) {
    rails.push(wallStrip(
      FOLD.map(([f, d]) => [-d * OUT, (r + f) * RH, r + f] as const),
      true,
    ));
  }
  const merged = mergeGeometries(rails, false)!;
  for (const g of rails) g.dispose();
  return merged;
};

/**
 * A slab leaned about its long axis, for the angled top of a catch fence.
 *
 * Takes the CENTRE of the finished piece, not the ground contact `box` takes:
 * once a thing is tilted, "how high does it start" is not a number anyone can
 * work out in their head anyway.
 */
const leaned = (
  w: number, h: number, d: number, deg: number, x: number, y: number, z = 0,
): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateZ(THREE.MathUtils.degToRad(deg));
  g.translate(x, y, z);
  return g;
};

/**
 * A slab pitched about its long axis running in Z, for a gangway up a bank.
 *
 * The same idea as `leaned` turned ninety degrees: takes the CENTRE of the
 * finished piece, and a positive angle lifts the +Z end.
 *
 * The sign is flipped on the way in, and that is not a detail to tidy away: a
 * rotation about +X carries +Z towards -Y, so the obvious `rotateX(deg)` tips
 * the far end DOWN. Written the obvious way it put both gangways of the main
 * grandstand across the slope of their own bank instead of along it -- the same
 * mistake, in the other axis, as the handrails that leaned into their stairs.
 */
const pitched = (
  w: number, h: number, d: number, deg: number, x: number, y: number, z = 0,
): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(THREE.MathUtils.degToRad(-deg));
  g.translate(x, y, z);
  return g;
};

/**
 * A hand rail up the side of a raked bank of seating.
 *
 * It follows the NOSE line -- the front edge of every tread -- rather than a
 * chord from the front row to the back one. On the noses it clears every step
 * by the same 15 cm; on a chord it floats most of a metre off the front row
 * before it finally meets the top one. A LEVEL rail, which is what both stands
 * here used to have, is worse again: a metre in the air at one end of the bank
 * and swallowed whole by the steps at the other.
 *
 * The numbers come from the same row count, rise and depth the steps are built
 * from, so reshaping a stand cannot leave its rails behind.
 */
const rakeRail = (
  x: number,
  thick: number,
  high: number,
  rows: number,
  rowRise: number,
  rowDepth: number,
): THREE.BufferGeometry => {
  const run = rowDepth * (rows - 1);
  const rise = rowRise * (rows - 1);
  const depth = rowDepth * rows;
  const cos = run / Math.hypot(run, rise);
  const y = rowRise + (depth / 2) * (rise / run) + 0.15 + high / 2 / cos;
  return pitched(thick, high, depth / cos, THREE.MathUtils.radToDeg(Math.atan2(rise, run)), x, y);
};

/**
 * Point every face of a geometry at one tile of a grid texture.
 *
 * Two things share a sheet this way, for the same reason. The braking boards
 * are four numbers on one image, so a board is a box whose UVs have been
 * squeezed into its own quarter; every face gets the same tile, back included,
 * because a real board is printed both sides and the 8 cm edges are too thin
 * for anyone to notice what is stretched across them. The tree cards are four
 * species on one image, so a wood of mixed trees is still ONE material.
 *
 * Index counts across then down from the top left of the image, which is how
 * anyone reading the sheet would number it -- texture V runs the other way and
 * is flipped here rather than in the caller's head.
 */
const atlasTile = (g: THREE.BufferGeometry, index: number, cols = 2, rows = 2) => {
  const col = index % cols;
  const row = (index / cols) | 0;
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    // Texture V runs up from the bottom, the tile grid reads down from the top.
    uv.setXY(i, (col + uv.getX(i)) / cols, (rows - 1 - row + uv.getY(i)) / rows);
  }
  uv.needsUpdate = true;
  return g;
};

/** Board size, metres. Wide enough to read at 200 m, low enough to be legal. */
const SIGN_W = 1.5;
const SIGN_H = 1.25;

/**
 * A double sided card standing on the ground, for grass and anything else that
 * is a picture rather than a solid.
 *
 * Two triangles would be invisible from behind -- AC culls back faces, and half
 * the time you drive past a tuft you are looking at the wrong side of it. So
 * the card is built twice, the second copy mirrored, which flips its winding
 * and therefore which way it faces. Four triangles for something that reads as
 * a hundred blades of grass is the whole point of the technique.
 */
const card = (w: number, h: number, ry = 0, x = 0, z = 0): THREE.BufferGeometry => {
  const front = new THREE.PlaneGeometry(w, h);
  front.translate(0, h / 2, 0);
  const back = front.clone().scale(-1, 1, 1);
  back.computeVertexNormals();
  const both = mergeGeometries([front, back], false)!;
  if (ry !== 0) both.rotateY(ry);
  both.translate(x, 0, z);
  return both;
};

const sphere = (r: number, x = 0, y = 0, z = 0) =>
  place(new THREE.SphereGeometry(r, 12, 9), x, y, z);

/**
 * A four sided pitched roof that covers exactly w by d.
 *
 * A four segment cone is the obvious way to get a pyramid, but its base is a
 * diamond inscribed in the radius, so its corners stick out along the diagonals
 * and the "roof" of a house ends up a good six metres wider than the walls.
 * Turning it 45° first puts the corners on the axes, which makes the base a
 * square of half side r/√2; with r = √½ that is exactly 1 x 1, so scaling by
 * the wall size gives a roof flush with the walls and no overhang to invent.
 */
const pyramid = (w: number, d: number, h: number, y = 0, x = 0, z = 0) => {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
  g.rotateY(Math.PI / 4);
  g.scale(w, h, d);
  return place(g, x, y + h / 2, z);
};

type GroupEntry =
  | [THREE.BufferGeometry[], MaterialKey]
  | [THREE.BufferGeometry[], MaterialKey, PartRole];

/**
 * Merge each material's geometry into one part.
 *
 * The first entry is the body unless it says otherwise, because every object
 * here is authored walls-first. Anything after it is trim. Say the role
 * explicitly wherever that reading would be wrong.
 */
function group(parts: GroupEntry[]): PropPart[] {
  const out: PropPart[] = [];
  parts.forEach(([geos, material, role], i) => {
    if (geos.length === 0) return;
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (merged) out.push({ geometry: merged, material, role: role ?? (i === 0 ? 'body' : 'trim') });
  });
  return out;
}

/* --- the library ----------------------------------------------------- */

/** Edge length of an unscaled pad, so scale 1 means PAD_SIZE metres. */
export const PAD_SIZE = 10;

/**
 * A flat ground patch: paddock tarmac, a concrete apron, a gravel bed.
 *
 * The slab reaches well below its origin and only 4 cm above it. The top face
 * therefore clears the terrain (no z-fighting) while the buried part keeps the
 * pad from showing daylight underneath on a gentle slope. It stays a closed
 * box so the physics duplicate the exporter derives from it is solid.
 */
const pad = (material: MaterialKey): PropPart[] =>
  group([[[box(PAD_SIZE, 0.3, PAD_SIZE, 0, -0.26)], material]]);

/**
 * Painted parking bays: the white lines only, no tarmac of their own.
 *
 * Laid over whatever ground is already there -- a pad, the paddock, plain
 * grass if somebody insists -- which is what makes them composable: the user
 * decides the pavement, these are just the paint. One separator per bay
 * boundary at the real-world 2.5 m pitch, and a continuous line along the
 * back edge where the bays end.
 *
 * 2.5 m, not the prefab car park's 2.8: four bays are then exactly 10 m and
 * eight exactly 20 -- whole metres, which the tiling check demands so grid
 * snapping stays sane, and the same 10 m module the ground pads tile by. The
 * two outer separators are tucked half a line width inward so the footprint
 * IS that round number rather than a line width over it.
 *
 * The lines float 4.5 cm over the origin: five millimetres clear of a pad's
 * top face (which is 4 cm up), so they neither z-fight with it nor drown in
 * it, and low enough that on bare ground the hover is invisible. The same
 * trick the grid boxes and the limiter line use.
 */
const PARK_PITCH = 2.5;
const PARK_DEPTH = 5;
const PARK_LINE = 0.12;

const parkBays = (count: number): PropPart[] => {
  const lines: THREE.BufferGeometry[] = [];
  const half = (count * PARK_PITCH) / 2;
  for (let i = 0; i <= count; i++) {
    const x = Math.max(
      -half + PARK_LINE / 2,
      Math.min(half - PARK_LINE / 2, -half + i * PARK_PITCH),
    );
    lines.push(box(PARK_LINE, 0.02, PARK_DEPTH, x, 0.045));
  }
  // The closed line along the back of the bays. The front stays open: that is
  // the aisle the cars drive in from.
  lines.push(box(count * PARK_PITCH, 0.02, PARK_LINE, 0, 0.045, -PARK_DEPTH / 2 + PARK_LINE / 2));
  return group([[lines, 'prop_white']]);
};

/**
 * Light a card like a ball of leaves instead of like a fence panel.
 *
 * A card's own normals point out of its face, which is correct for a wall and
 * wrong for everything a tree does with light. Two crossed panels then take
 * the sun at two different angles, so a tree is bright down one half and dark
 * down the other with a hard seam between them -- and every tree on the track
 * has its seam facing the same way, because the sun is in one place. It is the
 * single loudest tell that a tree is two planes.
 *
 * So the normal is bent towards two things a real crown has: OUT from the
 * middle of the crown, which shades the underside and lights the top the way a
 * mass of leaves is shaded, and UP, which is where a canopy gets most of its
 * light from. A little of the face normal is left in, so the side turned to
 * the sun still comes out warmer than the side turned away and the tree does
 * not go flat.
 *
 * The exported kn5 carries these normals, so the game lights them the same way
 * the editor does, which is the whole point of doing it in the geometry rather
 * than in the preview material.
 */
const leafNormals = (g: THREE.BufferGeometry, h: number): THREE.BufferGeometry => {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  // Not the middle of the card: a crown sits in its upper two thirds, and
  // measuring from the centre shades the trunk end of it as if it were sky.
  const cy = h * 0.62;
  const v = new THREE.Vector3();
  for (let i = 0; i < nrm.count; i++) {
    v.set(pos.getX(i), pos.getY(i) - cy, pos.getZ(i)).normalize();
    /*
     * The upward part is floored rather than merely biased. Below the middle
     * of the crown the outward direction points DOWN, and 0.7 of down beats
     * the 0.55 of up: the two corners where the card meets the ground came out
     * with normals under the horizon, so the foot of every tree -- which is
     * the trunk, the part nothing else is covering -- rendered black under a
     * sun that is above it. Leaves on the underside of a crown really are
     * turned downwards; the texture is already painted darker there, and that
     * is the right place for it.
     */
    v.set(
      v.x * 0.7 + nrm.getX(i) * 0.5,
      Math.max(0.4, v.y * 0.7 + 0.55),
      v.z * 0.7 + nrm.getZ(i) * 0.5,
    );
    v.normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  nrm.needsUpdate = true;
  return g;
};

/**
 * A tree the way Assetto Corsa builds one.
 *
 * Two alpha tested cards crossed at ninety degrees, with the whole tree --
 * trunk, limbs and the sky through the crown -- living in the texture rather
 * than in geometry. It is not a shortcut, it is what the game does: magione's
 * trees are cards on ksPerPixelAT, and the modelled pine and broadleaf above
 * are the thing that is unusual here, not this.
 *
 * Eight triangles against 624 for the modelled broadleaf, and that ratio is
 * the entire reason the technique exists. A wood is thousands of trees; at 624
 * apiece there is no wood, only a copse the frame rate can afford.
 *
 * Both cards read the same tile of the shared sheet (see TREE_CARDS in
 * textures.ts) and quote its metres, so four species still cost ONE material
 * and nothing is stretched.
 *
 * There is no third card at sixty degrees. Two is what Kunos use and what the
 * silhouette needs; the third one is only ever visible from directly overhead,
 * where a card tree has already given itself away.
 */
const treeCard = (name: TreeCardName): PropPart[] => {
  const { tile, w, h } = TREE_CARDS[name];
  // The drawing keeps a margin off its tile so the mips do not bleed one
  // species into the next (TREE_CARD_INSET in textures.ts). The card samples
  // inside that margin, not the whole tile: mapped edge to edge, the empty
  // margin counts as tree and the painted trunk starts half a metre up the
  // card -- every tree in the wood hovers that far above the ground.
  const inTile = (g: THREE.BufferGeometry) => {
    const uv = g.getAttribute('uv');
    const span = 1 - 2 * TREE_CARD_INSET;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(
        i,
        TREE_CARD_INSET + uv.getX(i) * span,
        TREE_CARD_INSET + uv.getY(i) * span,
      );
    }
    return atlasTile(g, tile, TREE_SHEET_TILES, TREE_SHEET_TILES);
  };
  return group([
    [
      [
        leafNormals(inTile(card(w, h)), h),
        leafNormals(inTile(card(w, h, Math.PI / 2)), h),
      ],
      'tree_card',
    ],
  ]);
};

export const LIBRARY: PropDef[] = [
  {
    key: 'pad_asphalt',
    label: 'Asphalt patch',
    category: 'Ground',
    surface: 'ROAD',
    build: () => pad('asphalt'),
  },
  {
    key: 'pad_concrete',
    label: 'Concrete apron',
    category: 'Ground',
    surface: 'CONCRETE',
    build: () => pad('concrete'),
  },
  {
    key: 'pad_gravel',
    label: 'Gravel bed',
    category: 'Ground',
    surface: 'SAND',
    build: () => pad('sand'),
  },
  {
    key: 'pad_grass',
    label: 'Grass patch',
    category: 'Ground',
    surface: 'GRASS',
    build: () => pad('grass'),
  },
  /*
   * The modelled trees, superseded by the cards further down.
   *
   * All three are still BUILT, and that is the whole point of hiding rather
   * than deleting: a project autosaved last week may hold two hundred of them,
   * and dropping the entry would turn every one into an invisible nothing. They
   * are only no longer offered. A card is what AC itself puts on a circuit, and
   * one modelled broadleaf costs what seventy eight of them do -- which is the
   * difference between a wood and a copse the frame rate can afford.
   */
  {
    key: 'tree_pine',
    label: 'Pine tree',
    category: 'Nature',
    surface: null,
    hidden: true,
    build: () =>
      group([
        [[cyl(0.22, 3.2)], 'prop_wood'],
        [[cone(1.9, 3.2, 0, 2.2), cone(1.5, 2.8, 0, 4.0), cone(1.0, 2.4, 0, 5.6)], 'prop_darkgreen'],
      ]),
  },
  {
    key: 'tree_round',
    label: 'Broadleaf tree',
    category: 'Nature',
    surface: null,
    hidden: true, // see the note above tree_pine
    build: () =>
      group([
        [[cyl(0.3, 3.0)], 'prop_wood'],
        [[sphere(2.2, 0, 4.6, 0), sphere(1.5, 1.3, 3.9, 0.6), sphere(1.4, -1.2, 4.1, -0.5)], 'prop_green'],
      ]),
  },
  {
    key: 'bush',
    label: 'Bush',
    category: 'Nature',
    surface: null,
    hidden: true, // see the note above tree_pine
    build: () =>
      group([
        [[sphere(0.9, 0, 0.7, 0), sphere(0.7, 0.8, 0.5, 0.3), sphere(0.6, -0.7, 0.5, -0.3)], 'prop_darkgreen'],
      ]),
  },
  /*
   * The same three trees again, as cards.
   *
   * Both kinds are kept, and that is deliberate rather than indecision. A card
   * is right for the wood behind the barrier -- hundreds of them, seen from a
   * car doing 200 -- and wrong for the six trees inside a hairpin that a replay
   * camera orbits, where the crossed planes turn edge on and show themselves.
   * Mixing the two is what a real track does. Plant these, place those.
   */
  {
    key: 'tree_pine_2d',
    label: 'Pine (2D)',
    category: 'Nature',
    surface: null,
    build: () => treeCard('pine'),
  },
  {
    key: 'tree_round_2d',
    label: 'Broadleaf (2D)',
    category: 'Nature',
    surface: null,
    build: () => treeCard('broadleaf'),
  },
  {
    key: 'tree_poplar_2d',
    label: 'Poplar (2D)',
    category: 'Nature',
    surface: null,
    build: () => treeCard('poplar'),
  },
  {
    key: 'tree_scrub_2d',
    label: 'Scrub tree (2D)',
    category: 'Nature',
    surface: null,
    build: () => treeCard('scrub'),
  },
  {
    key: 'tree_birch_2d',
    label: 'Birch (2D)',
    category: 'Nature',
    surface: null,
    build: () => treeCard('birch'),
  },
  {
    key: 'tree_willow_2d',
    label: 'Willow (2D)',
    category: 'Nature',
    surface: null,
    build: () => treeCard('willow'),
  },
  {
    key: 'tree_autumn_2d',
    label: 'Autumn broadleaf (2D)',
    category: 'Nature',
    surface: null,
    build: () => treeCard('autumn'),
  },
  {
    key: 'tree_cypress_2d',
    label: 'Cypress (2D)',
    category: 'Nature',
    surface: null,
    build: () => treeCard('cypress'),
  },
  {
    key: 'tree_fir_2d',
    label: 'Fir (2D)',
    category: 'Nature',
    surface: null,
    build: () => treeCard('fir'),
  },
  /*
   * Real grass, as opposed to a picture of grass painted on the ground.
   *
   * Crossed alpha tested cards, which is what every racing game uses and what
   * Kunos use on their own circuits. Four triangles a card, so a verge can have
   * thousands of them: paint them on with the Plant brush (N) the same way as
   * trees. No physics surface -- grass a car bounces off would be worse than no
   * grass at all.
   */
  {
    key: 'grass_tuft',
    label: 'Grass tuft',
    category: 'Nature',
    surface: null,
    build: () =>
      group([
        [[card(0.6, 0.34), card(0.6, 0.34, Math.PI / 2)], 'grass_blades'],
      ]),
  },
  {
    key: 'grass_clump',
    label: 'Long grass',
    category: 'Nature',
    surface: null,
    build: () =>
      group([
        [
          [
            card(1.3, 0.75),
            card(1.3, 0.75, Math.PI / 3),
            card(1.3, 0.75, (Math.PI * 2) / 3),
            // A lower, offset pair fills the middle, so a clump is not three
            // cards through one point with daylight around them.
            card(0.8, 0.45, Math.PI / 5, 0.35, 0.2),
            card(0.8, 0.45, -Math.PI / 4, -0.3, -0.25),
          ],
          'grass_blades',
        ],
      ]),
  },
  {
    key: 'rock',
    label: 'Rock',
    category: 'Nature',
    surface: 'WALL',
    build: () =>
      group([[[sphere(1.1, 0, 0.55, 0), sphere(0.7, 0.9, 0.35, 0.4)], 'prop_light']]),
  },
  {
    key: 'tyre_stack',
    label: 'Tyre stack',
    category: 'Barriers',
    surface: 'WALL',
    build: () =>
      group([
        [[tube(0.42, 0.18, 0.24, 0, 0, 0), tube(0.42, 0.18, 0.24, 0, 0.24, 0), tube(0.42, 0.18, 0.24, 0, 0.48, 0)], 'prop_dark'],
      ]),
  },
  {
    key: 'tyre_wall',
    label: 'Tyre wall (6 m)',
    category: 'Barriers',
    surface: 'WALL',
    build: () => {
      // Spaced so the stack spans exactly the 6 m the label promises: on a
      // 1.0 m pitch the end tyres bulged out to +-3.42 and the wall tiled
      // 6.84 m apart.
      const geos: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 7; i++) {
        const z = -2.58 + i * 0.86;
        for (let l = 0; l < 3; l++) geos.push(tube(0.42, 0.18, 0.24, 0, l * 0.24, z));
      }
      return group([[geos, 'prop_dark']]);
    },
  },
  {
    key: 'armco',
    label: 'Armco barrier (8 m)',
    category: 'Barriers',
    surface: 'WALL',
    build: () => {
      // The end posts are pulled in by half their own thickness so the module
      // is exactly the 8 m it says on the label. Sitting on +-4 they stuck out
      // to +-4.06, and a run of them tiled 8.12 m apart -- a pitch no snap
      // step divides and a seam nothing lines up with.
      const posts: THREE.BufferGeometry[] = [];
      for (let i = 0; i <= 4; i++) posts.push(box(0.12, 0.9, 0.12, 0, 0, -3.94 + i * 1.97));
      return group([
        [posts, 'prop_metal'],
        // Centred on the post line rather than hung off one face, so the
        // module's body is symmetric about its own origin.
        [[box(0.08, 0.35, 8.0, 0, 0.55, 0), box(0.08, 0.12, 8.0, 0, 0.9, 0)], 'prop_metal', 'body'],
      ]);
    },
  },
  {
    key: 'concrete_barrier',
    label: 'Concrete barrier (3 m)',
    category: 'Barriers',
    surface: 'WALL',
    build: () =>
      group([
        [[box(0.6, 0.25, 3.0), box(0.34, 0.7, 3.0, 0, 0.25)], 'prop_light'],
      ]),
  },
  {
    key: 'tecpro',
    label: 'TecPro barrier (4 m)',
    category: 'Barriers',
    surface: 'WALL',
    /*
     * What every fast corner of a modern circuit is lined with, and the one
     * barrier this library had no answer for: armco is what you hit at a
     * shallow angle, tyres are what you hit at the end of an escape road,
     * and TecPro is what stands where the impact is square and quick.
     *
     * Built the way the real thing is: interlocking blocks of blue foam-filled
     * plastic, banded together by two horizontal straps that run the length of
     * the module. Four metres, so a run of them divides the same 8 m the armco
     * and the fence modules tile at.
     */
    build: () => {
      const blocks: THREE.BufferGeometry[] = [];
      /* Six blocks with a finger's gap, so the seams read from a car -- and
         the OUTER faces land on exactly +-2.0, because the body box is what a
         run tiles by (measure(), bodyOnly). Sitting on a round pitch instead
         put them at +-1.97 and a run tiled 3.945 m apart: a pitch no snap
         step divides and a seam nothing lines up with. */
      for (let i = 0; i < 6; i++) blocks.push(box(0.9, 1.0, 0.62, 0, 0, -1.69 + i * 0.676));
      return group([
        [blocks, 'prop_blue'],
        // The straps, proud of the blocks so they catch the light along the run.
        [
          [box(0.94, 0.07, 4.0, 0, 0.26), box(0.94, 0.07, 4.0, 0, 0.66)],
          'prop_white',
        ],
      ]);
    },
  },
  {
    key: 'tecpro_low',
    label: 'TecPro barrier, low (4 m)',
    category: 'Barriers',
    surface: 'WALL',
    // The half height run, for where a barrier has to be seen over: pit exits,
    // the inside of a hairpin, anywhere a marshal post looks past it.
    build: () => {
      const blocks: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) blocks.push(box(0.9, 0.6, 0.62, 0, 0, -1.69 + i * 0.676));
      return group([
        [blocks, 'prop_blue'],
        [[box(0.94, 0.07, 4.0, 0, 0.4)], 'prop_white'],
      ]);
    },
  },
  {
    key: 'bridge',
    label: 'Bridge over the track (26 m)',
    category: 'Track furniture',
    surface: 'WALL',
    /*
     * A footbridge across the circuit: the thing spectators cross between the
     * infield and the outside, and from the car the landmark that says which
     * corner is coming. Spans 26 m -- a 14 m road, a verge either side and a
     * leg standing clear of both -- and the deck sits at 5.5 m, which is above
     * anything that can leave the ground on four wheels.
     *
     * WALL like every other structure: the legs are what a car can reach, and
     * they have to stop it. The deck is out of reach, so its surface costs
     * nothing either way.
     */
    build: () => {
      const legs: THREE.BufferGeometry[] = [];
      const rails: THREE.BufferGeometry[] = [];
      for (const side of [-1, 1]) {
        // Two columns per side, braced, standing 12.5 m off the centre.
        legs.push(box(0.7, 5.5, 0.7, 0, 0, side * 12.4));
        legs.push(box(0.7, 5.5, 0.7, 0, 0, side * 11.0));
        legs.push(box(0.5, 0.4, 1.4, 0, 5.1, side * 11.7));
        // The parapet along the deck, one rail per side of the walkway.
        rails.push(box(0.1, 1.1, 26, 1.5, 5.9));
        rails.push(box(0.1, 1.1, 26, -1.5, 5.9));
      }
      return group([
        [legs, 'prop_light'],
        // The deck: 3.4 m of walkway, thick enough to read as a structure.
        [[box(3.4, 0.4, 26, 0, 5.5)], 'prop_light'],
        [rails, 'prop_metal'],
      ]);
    },
  },
  /*
   * The road bridge kit: a bridge you can actually drive over.
   *
   * Three pieces. The DECK is a 12 m span with an asphalt roadway on top and a
   * guardrail either side -- lay several end to end for any length; they latch
   * flush like the pads do. The RAMP climbs from the ground to deck level over
   * 44 m (12.5%, a real overpass grade) with its supports built in. The PIER
   * is a separate portal frame to stand under the deck joints wherever there
   * is ground to stand on -- deliberately not part of the deck, because a
   * deck crossing the circuit must not bring a column onto the tarmac.
   *
   * Deck level is 5.5 m: the same clearance the footbridge keeps, above
   * anything that can pass underneath on four wheels. All three carry their
   * exact footprint as the body part and everything else as trim, so they
   * tile on whole metres (8 wide; 12, 44 and 2 long) about their own origin.
   *
   * The ramp's slab is a SHEARED box: y' = y + z * slope. Unlike a rotated
   * box, a sheared one keeps its exact ground footprint, so the tiling stays
   * on the metre grid and the ends stay vertical where the next piece butts
   * against them. Low end at -Z, high end at +Z.
   */
  ...(() => {
    const DECK_TOP = 5.5;
    const ASPHALT = 0.06;
    const STRUCT = 0.5;
    const RAMP_LEN = 44;
    const SLOPE = DECK_TOP / RAMP_LEN;
    const RAIL_H = 1.0;
    // y' = y + z * slope, spelled out row by row: makeShear's argument order
    // is easy to hold the wrong way round, and holding it the wrong way round
    // sheared z by y -- the ramp grew LONGER instead of higher.
    const shear = new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, 1, SLOPE, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    const sheared = (g: THREE.BufferGeometry) => {
      g.applyMatrix4(shear);
      g.computeVertexNormals();
      return g;
    };
    return [
      {
        key: 'bridge_road_deck',
        label: 'Road bridge deck (12 m)',
        category: 'Track furniture' as const,
        surface: 'ROAD' as const,
        build: () =>
          group([
            // The body: the concrete span, exactly 8 x 12 so the tiling is
            // honest. Top at 5.44, with the asphalt wearing course on it.
            [[box(8, STRUCT, 12, 0, DECK_TOP - ASPHALT - STRUCT)], 'concrete'],
            [[box(7.6, ASPHALT, 12, 0, DECK_TOP - ASPHALT)], 'asphalt'],
            [
              [
                box(0.12, RAIL_H, 12, -3.94, DECK_TOP),
                box(0.12, RAIL_H, 12, 3.94, DECK_TOP),
              ],
              'guardrail',
            ],
          ]),
      },
      {
        key: 'bridge_road_ramp',
        label: 'Road bridge ramp (44 m)',
        category: 'Track furniture' as const,
        surface: 'ROAD' as const,
        build: () => {
          const supports: THREE.BufferGeometry[] = [];
          for (const z of [-11, 0, 11, 18]) {
            // Column tops follow the slab's underside down the slope.
            const h = DECK_TOP - ASPHALT - STRUCT + SLOPE * z;
            if (h < 0.4) continue;
            supports.push(box(0.7, h, 0.7, -2.6, 0, z));
            supports.push(box(0.7, h, 0.7, 2.6, 0, z));
          }
          return group([
            // The body: the sheared slab, 8 x 44 on the ground exactly.
            [[sheared(box(8, STRUCT + ASPHALT, RAMP_LEN, 0, DECK_TOP / 2 - STRUCT - ASPHALT))], 'asphalt'],
            [supports, 'concrete'],
            [
              [
                sheared(box(0.12, RAIL_H, RAMP_LEN, -3.94, DECK_TOP / 2)),
                sheared(box(0.12, RAIL_H, RAMP_LEN, 3.94, DECK_TOP / 2)),
              ],
              'guardrail',
            ],
          ]);
        },
      },
      {
        key: 'bridge_road_pier',
        label: 'Road bridge pier',
        category: 'Track furniture' as const,
        surface: 'WALL' as const,
        build: () =>
          group([
            // The body: the crossbeam, 8 x 2, whose top carries the deck.
            [[box(8, STRUCT, 2, 0, DECK_TOP - ASPHALT - STRUCT * 2)], 'concrete'],
            [
              [
                box(0.9, DECK_TOP - ASPHALT - STRUCT * 2, 0.9, -3.4, 0, 0),
                box(0.9, DECK_TOP - ASPHALT - STRUCT * 2, 0.9, 3.4, 0, 0),
              ],
              'concrete',
            ],
          ]),
      },
    ];
  })(),

  {
    key: 'fence',
    label: 'Debris fence (8 m)',
    category: 'Barriers',
    surface: 'WALL',
    build: () => {
      /*
       * The generated trackside catch fence, cut into an 8 m module -- the
       * SAME cross section, so a placed run and the painted barrier read as
       * one product: 1 m of folded W-beam armco, chain link from there to
       * 3.6 m, and the top leaning 0.8 m back over the circuit while rising
       * another 1.2 (FENCE_BASE / FENCE_LEAN_* in road.ts). What the module
       * carries that the run generator leaves out are the gates and the
       * marshalling panels, which is exactly what a hand placed piece is for.
       *
       * +Z is the run, so the fence lies in the YZ plane and the lean is a
       * rotation about Z. The track side is -X.
       */
      const LEAN_OUT = 0.8;
      const LEAN_UP = 1.2;
      const LEAN_LEN = Math.hypot(LEAN_OUT, LEAN_UP);
      const LEAN_DEG = THREE.MathUtils.radToDeg(Math.atan2(LEAN_OUT, LEAN_UP));
      // The posts and their leaning arms, at the same 1.97 m rhythm and the
      // same sizes the generated fence grows them at. The end pair sits 6 cm
      // inside the module, so a free standing run ends on a post instead of
      // on a torn edge of mesh.
      const posts: THREE.BufferGeometry[] = [];
      const arms: THREE.BufferGeometry[] = [];
      const ARM_LEN = LEAN_LEN + 0.3;
      const armCx = 0.06 - (LEAN_OUT / LEAN_LEN) * (ARM_LEN / 2 - 0.16);
      const armCy = 3.6 - 0.1 + (LEAN_UP / LEAN_LEN) * (ARM_LEN / 2 - 0.16);
      for (let i = 0; i <= 4; i++) {
        const z = -3.94 + i * 1.97;
        posts.push(box(0.14, 3.6, 0.14, 0.06, 0, z));
        arms.push(leaned(0.12, ARM_LEN, 0.12, LEAN_DEG, armCx, armCy, z));
      }
      return group([
        // The mesh is the body: the plane the barrier occupies, exactly 8 m
        // so a run tiles with no seam. ONE plane, like the generated strip --
        // it used to be a 3 cm box, and the second layer of wire on its far
        // face read as a denser, darker fence than the barrier beside it. It
        // runs from the top of the armco to 3.6 m and on up the lean in one
        // unbroken texture, the same panel-metres UV the run generator uses.
        [[wallStrip([[0, 1.0, 0], [0, 3.6, 2.6 / 4]], false)], 'chainlink', 'body'],
        [posts, 'prop_light'],
        [arms, 'prop_light'],
        [[armcoW()], 'guardrail'],
        [[wallStrip([[0, 3.6, 2.6 / 4], [-LEAN_OUT, 3.6 + LEAN_UP, (2.6 + LEAN_LEN) / 4]], false)], 'chainlink'],
      ]);
    },
  },
  {
    key: 'fence_mesh',
    label: 'Boundary fence (8 m)',
    category: 'Barriers',
    surface: 'WALL',
    build: () => {
      // The plain chain link that closes a paddock or a spectator bank off.
      // No lean, half the height: it keeps people out, not wheels in.
      const posts: THREE.BufferGeometry[] = [];
      for (let i = 0; i <= 4; i++) posts.push(box(0.09, 2.0, 0.09, 0, 0, -3.955 + i * 1.9775));
      return group([
        [[tileUv(box(0.03, 1.85, 8.0, 0, 0.1), 2, 1.85 / 4)], 'chainlink', 'body'],
        [posts, 'prop_metal'],
        [[box(0.07, 0.07, 8.0, 0, 1.98)], 'prop_metal'],
      ]);
    },
  },
  {
    key: 'pit_wall',
    label: 'Pit wall (4 m)',
    category: 'Barriers',
    surface: 'WALL',
    build: () =>
      group([
        [[box(0.5, 0.3, 4.0), box(0.34, 0.75, 4.0, 0, 0.3)], 'prop_light'],
        // The advertising band every pit wall in the world carries.
        [[box(0.38, 0.45, 4.0, 0, 0.6)], 'prop_red'],
      ]),
  },
  {
    key: 'cone',
    label: 'Traffic cone',
    category: 'Track furniture',
    surface: null,
    build: () =>
      group([
        [[box(0.36, 0.04, 0.36), cone(0.16, 0.6, 0, 0.04)], 'prop_red'],
      ]),
  },
  /*
   * The braking boards.
   *
   * A board is a rectangle standing on the ground with a number printed on it,
   * and that is the whole object -- no posts, no legs. That is what a real one
   * is: anything sticking out of the ground beside a circuit is something for a
   * car to catch, so the board is a slab held by its own base. The old one had
   * two metal legs and a blank white panel, which read as a bus stop sign.
   *
   * `marker_board` keeps its key so projects that already have some do not lose
   * them -- it is now the 50 m board rather than a nondescript sign.
   */
  ...SIGN_DISTANCES.map((d, i) => ({
    key: i === 0 ? 'marker_board' : `brake_${d}`,
    label: `Braking board ${d} m`,
    category: 'Track furniture' as const,
    surface: null,
    build: () => group([[[atlasTile(box(SIGN_W, SIGN_H, 0.09), i)], 'sign_board' as MaterialKey]]),
  })),
  /*
   * There is no marshalling panel in this list on purpose. A panel is not a
   * thing you decide to put somewhere -- every circuit has them at fixed
   * intervals all the way round, on the barrier, facing the cars. So the
   * barrier grows its own, and the only decision left is where the barrier
   * goes. See flagPanels() in road.ts.
   */
  /*
   * Parking bay markings, in a short and a long row. Lines only: the pavement
   * underneath is whatever the user laid there, usually an asphalt patch.
   * `surface: null` -- paint is not something a car collides with.
   */
  {
    key: 'park_bays_4',
    label: 'Parking bays (4)',
    category: 'Track furniture',
    surface: null,
    build: () => parkBays(4),
  },
  {
    key: 'park_bays_8',
    label: 'Parking bays (8)',
    category: 'Track furniture',
    surface: null,
    build: () => parkBays(8),
  },
  {
    key: 'ad_board',
    label: 'Advertising board',
    category: 'Track furniture',
    surface: 'WALL',
    build: () =>
      group([
        [[cyl(0.08, 1.0, -1.6), cyl(0.08, 1.0, 1.6)], 'prop_metal'],
        // No quarter turn. The posts stand 3.2 m apart along X, so a board
        // rotated into the YZ plane ran across them edge on: from the track you
        // saw a 10 cm stripe floating between two legs it was not attached to.
        // Facing +Z also matches every other object here, which is what makes
        // the heading control point the thing where you expect.
        [[box(4.0, 1.1, 0.1, 0, 0.9)], 'prop_blue'],
      ]),
  },
  {
    key: 'floodlight',
    label: 'Floodlight mast',
    category: 'Track furniture',
    surface: 'WALL',
    build: () =>
      group([
        [[box(0.8, 0.3, 0.8), cyl(0.16, 11.0, 0, 0.3)], 'prop_metal'],
        [[box(2.2, 0.9, 0.4, 0, 11.0)], 'prop_light'],
        [[box(2.0, 0.7, 0.1, 0, 11.1, 0.22)], 'prop_yellow'],
      ]),
  },
  {
    key: 'start_gantry',
    label: 'Start gantry',
    category: 'Track furniture',
    surface: null,
    /*
     * The same bridge the circuit builds over its own timing line, at a fixed
     * 11 m half span -- see core/gantry.ts, which owns the model.
     *
     * The one over the start/finish line is not placed at all: it follows the
     * line and spans whatever the road is wide there. This entry is for the
     * second bridge a circuit sometimes has -- over the pit exit, or across a
     * back straight for the sector board -- and that one IS a placement.
     *
     * Turned to face +Z, because every object in this library is authored
     * facing +Z and the gantry is authored facing the oncoming cars, which is
     * the other way. Decoration rather than WALL: it is a lattice of a couple
     * of hundred members, and a collision hull of that is a great deal of
     * physics for a thing that stands behind a barrier.
     */
    build: () => {
      const parts = startGantryParts(9, 9, { detail: 'plain', sink: false });
      for (const p of parts) p.geometry.rotateY(Math.PI);
      return parts.map((p, i) => ({
        geometry: p.geometry,
        material: p.material,
        role: (i === 0 ? 'body' : 'trim') as PartRole,
      }));
    },
  },
  {
    key: 'windmill',
    label: 'Wind turbine',
    category: 'Track furniture',
    surface: 'WALL',
    build: () => {
      // Rotor in the XY plane, facing +Z, so the heading control aims it into
      // the wind the same way it aims everything else.
      const hubY = 42.6;
      const hubZ = 3.6;
      const blades: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 3; i++) {
        const g = new THREE.BoxGeometry(1.5, 20, 0.35);
        g.translate(0, 11.4, 0);
        g.rotateZ((i * Math.PI * 2) / 3);
        g.translate(0, hubY, hubZ);
        blades.push(g);
      }
      const hub = new THREE.CylinderGeometry(1.1, 1.1, 1.6, 10);
      hub.rotateX(Math.PI / 2);
      hub.translate(0, hubY, hubZ + 0.6);
      return group([
        [[taper(1.9, 1.0, 41.4), box(4.0, 0.6, 4.0)], 'prop_light'],
        [[box(2.6, 2.4, 6.2, 0, 41.4, 1.0)], 'prop_light'],
        [[hub, ...blades], 'prop_white'],
      ]);
    },
  },
  {
    key: 'big_screen',
    label: 'Big screen',
    category: 'Track furniture',
    surface: 'WALL',
    build: () =>
      group([
        [[box(0.7, 5.2, 0.7, -3.6), box(0.7, 5.2, 0.7, 3.6), box(8.6, 0.5, 1.2, 0, 5.2)], 'prop_metal'],
        [[box(8.6, 4.8, 0.6, 0, 5.7)], 'prop_dark'],
        [[box(8.0, 4.3, 0.1, 0, 5.95, 0.33)], 'prop_blue'],
      ]),
  },
  {
    key: 'flag_poles',
    label: 'Flag poles',
    category: 'Track furniture',
    surface: null,
    build: () =>
      group([
        [[box(1.6, 0.25, 1.6)], 'prop_light'],
        [[cyl(0.08, 9.0, -1.4, 0.25, 0, 8), cyl(0.08, 9.0, 0, 0.25, 0, 8), cyl(0.08, 9.0, 1.4, 0.25, 0, 8)], 'prop_metal'],
        [[box(0.06, 1.1, 1.7, -1.4, 8.0, 0.9)], 'prop_red'],
        [[box(0.06, 1.1, 1.7, 0, 8.0, 0.9)], 'prop_white'],
        [[box(0.06, 1.1, 1.7, 1.4, 8.0, 0.9)], 'prop_yellow'],
      ]),
  },
  {
    key: 'grandstand',
    label: 'Grandstand, open',
    category: 'Buildings',
    surface: 'WALL',
    build: () => {
      /*
       * The UNCOVERED stand, and it has to actually look uncovered.
       *
       * This one used to carry a 24 x 11 m slab at 6.6 m on two posts, which is
       * a roof however it was labelled -- so the palette offered "Grandstand"
       * and "Grandstand, covered" and both of them were covered. What tells the
       * two apart now is the only thing that ever did: this one is open to the
       * sky, and the next one along has a roof over it.
       */
      // 8 steps of 1.25 m make the stand exactly 24 x 10 m, so it tiles on
      // whole metres instead of landing on a 9.6 m pitch nothing divides.
      const steps: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 8; i++) steps.push(box(24, 0.55 * (i + 1), 1.25, 0, 0, -4.375 + i * 1.25));
      return group([
        [steps, 'prop_light'],
        // A back wall behind the top row -- an open bank still has a back --
        // and it stops well short of anything a roof would need.
        [[box(24, 1.9, 0.35, 0, 4.4, 5.175)], 'prop_light'],
        // Rails up both sides, following the rake, and one along the front so
        // the first row is not a drop onto the track side.
        [
          [
            rakeRail(-11.94, 0.12, 1.1, 8, 0.55, 1.25),
            rakeRail(11.94, 0.12, 1.1, 8, 0.55, 1.25),
            box(24, 0.9, 0.1, 0, 0.55, -4.95),
          ],
          'prop_metal',
        ],
      ]);
    },
  },
  {
    key: 'grandstand_roof',
    label: 'Grandstand, covered',
    category: 'Buildings',
    surface: 'WALL',
    build: () => {
      // The same 24 x 10 m bank as the open stand, so a row can mix the two
      // and they still line up: a covered centre block between open wings is
      // what most circuits actually have.
      const steps: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 8; i++) steps.push(box(24, 0.55 * (i + 1), 1.25, 0, 0, -4.375 + i * 1.25));
      return group([
        [steps, 'prop_light'],
        // Up to the roof, not to 7.6 m: stopping short of the underside left a
        // 0.8 m slot of daylight running the whole width of the back wall.
        [[box(24, 8.4, 0.4, 0, 0, 5.2)], 'prop_light'],
        [
          [
            cyl(0.22, 8.4, -11.2, 0, 4.8, 8),
            cyl(0.22, 8.4, 0, 0, 4.8, 8),
            cyl(0.22, 8.4, 11.2, 0, 4.8, 8),
          ],
          'prop_metal',
        ],
        // Flush with the bank along X so covered stands tile; the overhang is
        // forward, over the seats, which is where a roof is any use.
        [[box(24, 0.35, 11.4, 0, 8.4, -0.3)], 'prop_dark'],
        [[box(24, 0.5, 0.12, 0, 8.0, -5.9)], 'prop_red'],
      ]);
    },
  },
  {
    key: 'grandstand_small',
    label: 'Grandstand, small',
    category: 'Buildings',
    surface: 'WALL',
    build: () => {
      // 12 x 6 m: the club circuit stand, and short enough to follow a corner
      // in two or three separate blocks instead of cutting the arc off.
      const steps: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 5; i++) steps.push(box(12, 0.5 * (i + 1), 1.2, 0, 0, -2.4 + i * 1.2));
      return group([
        [steps, 'prop_light'],
        [[box(12, 1.0, 0.1, 0, 2.5, 3.0)], 'prop_metal'],
        // Was a flat panel from 1.4 m to 2.5 m down both sides, which floated
        // 0.9 m above the front row and was buried in the back one.
        [
          [rakeRail(-5.95, 0.1, 1.0, 5, 0.5, 1.2), rakeRail(5.95, 0.1, 1.0, 5, 0.5, 1.2)],
          'prop_metal',
        ],
      ]);
    },
  },
  {
    key: 'grandstand_main',
    label: 'Main grandstand',
    category: 'Buildings',
    surface: 'WALL',
    build: () => {
      /*
       * Two tiers, 36 m wide. Both banks of seating go in one part, so the box
       * the tiling and the edge snapping measure is the whole thing a spectator
       * stands on -- measuring only the lower tier would let the next stand
       * along be pushed into the back of this one's upper deck.
       */
      // 36 x 20 m exactly, and centred on its own origin: both tiers are one
      // part, so the box everything snaps to is the whole thing a spectator
      // stands on rather than just the front bank.
      const seats: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 8; i++) seats.push(box(36, 0.5 * (i + 1), 1.25, 0, 0, -9.375 + i * 1.25));
      for (let i = 0; i < 8; i++) seats.push(box(36, 0.55 * (i + 1), 1.25, 0, 8.4, 0.625 + i * 1.25));

      /*
       * The back of the stand: doors, piers and the gallery along the top.
       *
       * Two open flights of stairs used to climb the outside of it, 17 treads
       * each, sticking 15 m out into whatever was behind the stand. They were
       * the biggest thing on the model and they fought every attempt to put the
       * stand against a fence, a bank or a car park -- so they are gone, and the
       * way up to the gallery is inside the block like it is on a real one.
       */
      const TOP = 12.8; // the top row of the upper tier, and the gallery

      const pilasters: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 5; i++) pilasters.push(box(0.7, 8.4, 0.6, -14 + i * 7, 0, 10.2));
      const doors: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 4; i++) doors.push(box(2.2, 3.2, 0.25, -10.5 + i * 7, 0, 10.15));

      return group([
        [seats, 'prop_light'],
        // The deck the upper tier stands on, the stairs, the gallery they climb
        // to, and the piers between the entrances. One part: one draw call.
        [
          [
            box(36, 8.4, 10, 0, 0, 5),
            ...pilasters,
            box(36, 0.4, 2.0, 0, TOP - 0.4, 11.0),
          ],
          'prop_light',
        ],
        /*
         * The gangways, and the way in at the front.
         *
         * Without them both banks are solid: you arrive at the top row off the
         * gallery, or at the front row off the ground, and then there is
         * nowhere to walk. Two aisles per tier, plus a step down to the apron
         * at the foot of each one, which is the door into the lower bank.
         *
         * Each aisle is ONE pitched slab rather than a tread per row. A row is
         * half a metre, so a slab lying on the noses of the steps stands proud
         * of every tread along its whole length and reads as the gangway it is
         * -- for twelve triangles instead of the hundred a modelled staircase
         * would cost, on an object that has a budget like everything else.
         */
        [
         [
           box(36, 0.4, 10.4, 0, 8.4, 5),
           ...([-11, 11] as const).flatMap((x) => [
             pitched(1.8, 0.6, 10.2, 21.8, x, 2.25, -5.0),
             pitched(1.8, 0.6, 10.2, 23.75, x, 10.875, 5.0),
             box(1.8, 0.28, 0.9, x, 0, -10.4),
           ]),
           box(36, 0.14, 2.2, 0, 0, -11.4),
         ],
         'prop_dark',
        ],
        [[box(35, 2.6, 0.25, 0, 4.6, 0.1)], 'prop_glass'],
        [doors, 'prop_dark'],
        // Square columns rather than round: eight sided cylinders cost a third
        // of this model's triangle budget between them, and at 28 cm nobody has
        // ever told the two apart.
        [
          [
            box(0.5, 15.2, 0.5, -17.2, 0, 10.2),
            box(0.5, 15.2, 0.5, -5.7, 0, 10.2),
            box(0.5, 15.2, 0.5, 5.7, 0, 10.2),
            box(0.5, 15.2, 0.5, 17.2, 0, 10.2),
          ],
          'prop_metal',
        ],
        [[box(36, 0.4, 22, 0, 15.2, 0.5)], 'prop_dark'],
        /*
         * A guard rail along the OUTER edge of the gallery only. The seating
         * side is deliberately open: that edge is the way in to the top row.
         */
        [[box(36, 1.0, 0.12, 0, TOP, 11.94)], 'prop_metal'],
        [[box(36, 0.9, 0.14, 0, 14.6, -10.3), box(11, 1.2, 0.22, 0, 5.9, 10.3)], 'prop_white'],
      ]);
    },
  },
  /*
   * The pit building. One of them, sized to the circuit rather than picked from
   * a list of fixed lengths.
   *
   * There used to be two, at 40 m each, and neither was the length of anybody's
   * pit lane: a club circuit wants 40, a grand prix one wants two hundred, and
   * the answer was to drop five copies and hope the seams did not show. So this
   * one is built to be STRETCHED -- type the length you want into the inspector
   * and it grows, exactly the way a ground patch already does.
   *
   * Which is why nothing on it has a rhythm along X. No pilasters, no window
   * mullions, no bay divisions: every one of those turns into a buttress the
   * moment the building is pulled out to 160 m. What runs the length instead is
   * what really does run the length of a pit building -- the garage door band,
   * the canopy over the lane, the glazing above it, the roof and its terrace
   * rail. Stretch those and they stay right at any size.
   *
   * The bay rhythm is still available, and in the right place: `garage_bay` is
   * an 8 m module made to be tiled along the front of this.
   */
  {
    key: 'pit_building',
    label: 'Pit building',
    category: 'Buildings',
    surface: 'WALL',
    build: () =>
      group([
        // 40 x 12 m and two storeys to start with, which is a real one at a
        // small circuit. The pit lane is +Z.
        [[box(40, 9.0, 12)], 'prop_light'],
        // Flush with the walls along X, the axis a row of them tiles on, so
        // two abutted buildings read as one. The overhang is front and back.
        [[box(40, 0.45, 13.4, 0, 9.0, -0.4)], 'prop_dark'],
        // The garage fronts: one continuous shuttered band at ground level, and
        // dark, because what you see down a pit lane is a row of openings. In
        // the wall colour it read as a moulding rather than as garages.
        [[box(40, 3.4, 0.3, 0, 0.4, 6.0)], 'prop_dark'],
        // The canopy over the lane, and the rail round the roof terrace.
        [[box(40, 0.3, 2.4, 0, 4.3, 7.1), box(40, 0.9, 0.15, 0, 9.45, 6.15)], 'prop_metal'],
        // Timing boxes over the lane, offices behind.
        [[box(40, 2.4, 0.25, 0, 5.4, 6.0), box(40, 1.6, 0.25, 0, 5.6, -6.02)], 'prop_glass'],
      ]),
  },
  {
    key: 'pit_building_modern',
    label: 'Pit building, modern',
    category: 'Buildings',
    surface: 'WALL',
    // Superseded by the stretchable `pit_building` above, which is this model
    // without the three pilasters that made it unstretchable.
    hidden: true,
    build: () =>
      group([
        [[box(40, 9.0, 12)], 'prop_light'],
        [[box(40, 0.45, 13.4, 0, 9.0, -0.4)], 'prop_dark'],
        // Glazing on both floors, and the VIP boxes set back under the roof.
        [[box(39, 2.6, 0.25, 0, 1.1, 6.1), box(39, 2.4, 0.25, 0, 5.3, 6.1)], 'prop_glass'],
        [[box(40, 0.9, 0.15, 0, 9.45, -6.2)], 'prop_metal'],
        [
          [
            box(1.2, 9.0, 0.6, -13.5, 0, 6.2),
            box(1.2, 9.0, 0.6, 0, 0, 6.2),
            box(1.2, 9.0, 0.6, 13.5, 0, 6.2),
          ],
          'prop_dark',
        ],
      ]),
  },
  {
    key: 'control_tower',
    label: 'Race control tower',
    category: 'Buildings',
    surface: 'WALL',
    build: () =>
      group([
        [[box(8, 13, 8)], 'prop_light'],
        // The control room itself, glazed and overhanging on all four sides so
        // the whole start straight can be seen out of it.
        [[box(9.6, 3.2, 9.6, 0, 13)], 'prop_dark'],
        [[box(9.0, 2.2, 9.8, 0, 13.5), box(9.8, 2.2, 9.0, 0, 13.5)], 'prop_glass'],
        [[box(10.2, 0.4, 10.2, 0, 16.2)], 'prop_dark'],
        [[cyl(0.09, 4.5, 3.6, 16.6, 3.6, 6)], 'prop_metal'],
        [[box(2.4, 0.7, 0.12, 0, 10.6, 4.05)], 'prop_yellow'],
      ]),
  },
  {
    key: 'garage',
    label: 'Garage block',
    category: 'Buildings',
    surface: 'WALL',
    build: () =>
      group([
        [[box(12, 4.5, 8)], 'prop_light'],
        [[box(12, 0.4, 8.6, 0, 4.5)], 'prop_dark'],
        [[box(3.4, 3.0, 0.15, -3.4, 0, 4.1), box(3.4, 3.0, 0.15, 3.4, 0, 4.1)], 'prop_metal'],
      ]),
  },
  {
    key: 'garage_bay',
    label: 'Pit garage bay (8 m)',
    category: 'Buildings',
    surface: 'WALL',
    build: () =>
      group([
        [[box(8, 4.2, 7)], 'prop_light'],
        // Flush with the walls on both sides, not the usual overhanging lip:
        // bays are meant to be tiled, and two overhangs would collide before
        // the walls ever met.
        [[box(8, 0.35, 7.6, 0, 4.2, 0.3)], 'prop_dark'],
        // Proud of the wall face at 3.5, not centred on it: centred, half the
        // door was inside the building and it z-fought the wall along its whole
        // outline. Every other door in the library already clears its wall.
        [[box(5.6, 3.2, 0.14, 0, 0, 3.55)], 'prop_metal'],
        [[box(1.4, 0.5, 0.08, -2.9, 3.4, 3.58)], 'prop_yellow'],
      ]),
  },
  {
    key: 'house',
    label: 'House',
    category: 'Buildings',
    surface: 'WALL',
    build: () =>
      group([
        [[box(8, 5, 7)], 'prop_white'],
        // 0.4 m of eaves rather than the 13 m diagonal a four sided cone of
        // radius 6.6 was throwing across the garden. Flush along X so a
        // terrace has no daylight between the houses.
        [[pyramid(8, 7.8, 2.8, 5)], 'prop_red'],
        [[box(1.1, 2.1, 0.12, 0, 0, 3.55)], 'prop_wood'],
        [[box(1.3, 1.1, 0.1, -2.4, 1.6, 3.52), box(1.3, 1.1, 0.1, 2.4, 1.6, 3.52)], 'prop_glass'],
      ]),
  },
  {
    key: 'house_3',
    label: 'Cottage',
    category: 'Buildings',
    surface: 'WALL',
    build: () =>
      group([
        [[box(6, 3.4, 5)], 'prop_white'],
        [[pyramid(6, 5.6, 2.1, 3.4)], 'prop_red'],
        [[box(0.95, 2.0, 0.12, 0, 0, 2.55)], 'prop_wood'],
        [[box(1.0, 0.9, 0.1, -1.8, 1.3, 2.52), box(1.0, 0.9, 0.1, 1.8, 1.3, 2.52)], 'prop_glass'],
      ]),
  },
  {
    key: 'marshal_post',
    label: 'Marshal post',
    category: 'Buildings',
    surface: 'WALL',
    build: () =>
      group([
        [[box(2.0, 2.4, 2.0)], 'prop_light'],
        [[box(2.4, 0.25, 2.4, 0, 2.4)], 'prop_dark'],
        [[box(2.0, 0.9, 0.12, 0, 1.2, 1.02)], 'prop_glass'],
      ]),
  },
  {
    key: 'barn',
    label: 'Barn',
    category: 'Buildings',
    surface: 'WALL',
    build: () =>
      group([
        [[box(14, 5, 9)], 'prop_red'],
        [[pyramid(14, 9.8, 3.4, 5)], 'prop_dark'],
        [[box(4.0, 4.0, 0.15, 0, 0, 4.55)], 'prop_wood'],
      ]),
  },
  {
    key: 'industrial_hall',
    label: 'Industrial hall',
    category: 'Buildings',
    surface: 'WALL',
    build: () =>
      group([
        [[box(30, 8, 18)], 'prop_light'],
        // Flush along X, the axis these tile on, so a row reads as one shed.
        [[box(30, 0.5, 18.8, 0, 8)], 'prop_metal'],
        [[box(5.0, 5.0, 0.15, -7, 0, 9.05), box(5.0, 5.0, 0.15, 7, 0, 9.05)], 'prop_metal'],
        [[box(28, 1.0, 0.12, 0, 5.6, 9.02)], 'prop_glass'],
      ]),
  },
  {
    key: 'apartment',
    label: 'Apartment block',
    category: 'Buildings',
    surface: 'WALL',
    build: () => {
      // Five storeys of window band, so the height reads as floors rather than
      // as one tall box with a stripe on it.
      /*
       * `box` takes the CENTRE of a band, not its near face. The back rows were
       * written as -(6.02 + 0.12), which put them from -6.20 to -6.08 -- a
       * panel hanging 8 cm clear of a wall that ends at -6.00, with daylight
       * behind every window on the back of the building. Mirroring the front
       * centre is all it ever needed.
       *
       * All four walls, not two. Windows on the long sides only left the ends
       * blank, and a block is nearly always seen off a corner: two lit faces
       * and two dead ones is the one angle that reads as a game asset.
       */
      const bands: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 5; i++) {
        const y = 1.1 + i * 2.8;
        bands.push(box(16.4, 1.4, 0.12, 0, y, 6.02));
        bands.push(box(16.4, 1.4, 0.12, 0, y, -6.02));
        bands.push(box(0.12, 1.4, 10.4, 9.02, y));
        bands.push(box(0.12, 1.4, 10.4, -9.02, y));
      }
      return group([
        [[box(18, 15, 12)], 'prop_light'],
        [[box(18, 0.6, 12.8, 0, 15)], 'prop_dark'],
        [bands, 'prop_glass'],
      ]);
    },
  },
  {
    key: 'office',
    label: 'Office block',
    category: 'Buildings',
    surface: 'WALL',
    build: () => {
      const bands: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 4; i++) {
        // The same off-by-a-thickness as the apartment block: -7.16 hung the
        // back glazing 9 cm off a wall that ends at -7.00. And the ends get
        // their windows too, so the block is glazed from every angle.
        const y = 1.0 + i * 3.0;
        bands.push(box(18.6, 2.0, 0.14, 0, y, 7.02));
        bands.push(box(18.6, 2.0, 0.14, 0, y, -7.02));
        bands.push(box(0.14, 2.0, 12.6, 10.02, y));
        bands.push(box(0.14, 2.0, 12.6, -10.02, y));
      }
      return group([
        [[box(20, 12, 14)], 'prop_dark'],
        [[box(20, 0.5, 14.6, 0, 12)], 'prop_metal'],
        [bands, 'prop_glass'],
      ]);
    },
  },
  /*
   * Vehicles.
   *
   * Their own category rather than more track furniture, because a car park is
   * a thing you go looking for. They tile by no rule: parked cars sit on bay
   * markings, not on a metre grid, so the `car_park` prefab does the spacing.
   */
  {
    key: 'car_small',
    label: 'Hatchback',
    category: 'Vehicles',
    surface: 'WALL',
    build: () =>
      group([
        [[box(1.72, 0.8, 4.0, 0, 0.32)], 'prop_red'],
        [[box(1.58, 0.62, 2.1, 0, 1.12, -0.25)], 'prop_glass'],
        [[wheel(-0.8, 1.28), wheel(0.8, 1.28), wheel(-0.8, -1.28), wheel(0.8, -1.28)], 'prop_dark'],
      ]),
  },
  {
    key: 'car_estate',
    label: 'Estate car',
    category: 'Vehicles',
    surface: 'WALL',
    build: () =>
      group([
        [[box(1.82, 0.86, 4.8, 0, 0.34)], 'prop_blue'],
        [[box(1.66, 0.66, 2.9, 0, 1.2, -0.5)], 'prop_glass'],
        [[wheel(-0.84, 1.5), wheel(0.84, 1.5), wheel(-0.84, -1.5), wheel(0.84, -1.5)], 'prop_dark'],
      ]),
  },
  {
    key: 'van',
    label: 'Van',
    category: 'Vehicles',
    surface: 'WALL',
    build: () =>
      group([
        [[box(2.0, 1.4, 5.4, 0, 0.4)], 'prop_white'],
        [[box(1.94, 0.95, 2.0, 0, 1.8, -0.9)], 'prop_white'],
        [[box(1.86, 0.8, 0.12, 0, 1.35, 2.62)], 'prop_glass'],
        [[wheel(-0.92, 1.7, 0.38), wheel(0.92, 1.7, 0.38), wheel(-0.92, -1.7, 0.38), wheel(0.92, -1.7, 0.38)], 'prop_dark'],
      ]),
  },
  {
    key: 'camper',
    label: 'Camper van',
    category: 'Vehicles',
    surface: 'WALL',
    build: () =>
      group([
        [[box(2.2, 2.2, 6.2, 0, 0.44)], 'prop_light'],
        [[box(2.0, 0.5, 3.6, 0, 2.64, -0.6)], 'prop_white'],
        [[box(2.1, 0.9, 0.12, 0, 1.5, 3.02)], 'prop_glass'],
        [[box(0.1, 0.9, 1.4, -1.12, 1.5, -0.6)], 'prop_glass'],
        [[wheel(-1.0, 2.0, 0.4), wheel(1.0, 2.0, 0.4), wheel(-1.0, -2.0, 0.4), wheel(1.0, -2.0, 0.4)], 'prop_dark'],
      ]),
  },
  {
    key: 'truck',
    label: 'Box truck',
    category: 'Vehicles',
    surface: 'WALL',
    build: () =>
      group([
        [[box(2.5, 3.0, 8.6, 0, 1.0, -1.4)], 'prop_white'],
        [[box(2.4, 2.2, 2.6, 0, 0.85, 4.0)], 'prop_blue'],
        [[box(2.3, 0.85, 0.12, 0, 1.95, 5.24)], 'prop_glass'],
        // Chassis rail, kept just inside the bodywork so the truck measures the
        // 11 m it looks rather than sticking a bare beam out past the tail.
        [[box(2.4, 0.9, 10.6, 0, 0.1, -0.2)], 'prop_dark'],
        [
          [wheel(-1.15, 4.0, 0.5), wheel(1.15, 4.0, 0.5),
            wheel(-1.15, -3.0, 0.5), wheel(1.15, -3.0, 0.5),
            wheel(-1.15, -4.3, 0.5), wheel(1.15, -4.3, 0.5)],
          'prop_dark',
        ],
      ]),
  },
];

export const LIBRARY_BY_KEY = new Map(LIBRARY.map((d) => [d.key, d]));

const partsCache = new Map<string, PropPart[]>();

export function propParts(key: string): PropPart[] {
  let p = partsCache.get(key);
  if (!p) {
    const def = LIBRARY_BY_KEY.get(key);
    p = def ? def.build() : [];
    partsCache.set(key, p);
  }
  return p;
}

/** Ground plan of a library object, in its own local frame, metres. */
export interface PropFootprint {
  /** Centre of the footprint. Rarely zero: a roof can overhang to one side. */
  cx: number;
  cz: number;
  /** Half extents. A module 8 m long has hz = 4. */
  hx: number;
  hz: number;
}

const footprintCache = new Map<string, PropFootprint>();
const tileBoxCache = new Map<string, PropFootprint>();

function measure(key: string, bodyOnly: boolean): PropFootprint {
  const box = new THREE.Box3();
  for (const part of propParts(key)) {
    if (bodyOnly && part.role !== 'body') continue;
    part.geometry.computeBoundingBox();
    if (part.geometry.boundingBox) box.union(part.geometry.boundingBox);
  }
  if (box.isEmpty()) return { cx: 0, cz: 0, hx: 0, hz: 0 };
  return {
    cx: (box.min.x + box.max.x) / 2,
    cz: (box.min.z + box.max.z) / 2,
    hx: (box.max.x - box.min.x) / 2,
    hz: (box.max.z - box.min.z) / 2,
  };
}

/**
 * The ground plan of an imported model, or null if `key` is a library object.
 *
 * Measured off the parsed model, so it is only known once the parse has
 * finished; until then the honest answer is a point, and it must not be cached
 * or the model would stay sizeless for the rest of the session.
 */
function assetFootprint(key: string): PropFootprint | null {
  const id = assetIdOf(key);
  if (id === null) return null;
  const box = assetBox(id);
  if (!box || box.isEmpty()) return { cx: 0, cz: 0, hx: 0, hz: 0 };
  return {
    cx: (box.min.x + box.max.x) / 2,
    cz: (box.min.z + box.max.z) / 2,
    hx: (box.max.x - box.min.x) / 2,
    hz: (box.max.z - box.min.z) / 2,
  };
}

/**
 * Everything the object visually reaches, roof and signage included. Use it to
 * frame or select an object -- NOT to place one against another.
 */
export function propFootprint(key: string): PropFootprint {
  const imported = assetFootprint(key);
  if (imported) return imported;
  let f = footprintCache.get(key);
  if (!f) {
    f = measure(key, false);
    footprintCache.set(key, f);
  }
  return f;
}

/**
 * The box an object tiles by: its solid body, without the overhangs.
 *
 * This is the number every placement rule has to use -- prefab spacing, edge
 * snapping, duplicate-in-a-row. Both boxes are measured from the geometry
 * rather than typed in, so neither can go stale when a model is reshaped;
 * the author only decides which parts count as the body (see PartRole).
 */
export function propTileBox(key: string): PropFootprint {
  // An imported model has no authored body/trim split, so the one box it has
  // is the box it tiles by.
  const imported = assetFootprint(key);
  if (imported) return imported;
  let f = tileBoxCache.get(key);
  if (!f) {
    f = measure(key, true);
    // An object built entirely from trim still has to tile by something.
    if (f.hx <= 0 && f.hz <= 0) f = propFootprint(key);
    tileBoxCache.set(key, f);
  }
  return f;
}

const sizeCache = new Map<string, THREE.Vector3>();

/**
 * How big an object is in its own frame, metres, everything it visually
 * reaches included.
 *
 * The inspector sizes buildings in metres rather than in multipliers, the same
 * way the AC tab already sizes an imported mesh: nobody looks at a pit building
 * and thinks "3.4 times longer", they think "a hundred and forty metres".
 */
export function propSize(key: string): THREE.Vector3 {
  const id = assetIdOf(key);
  if (id !== null) {
    // Not cached, and not the 1 x 1 x 1 the fallback used to hand back: the
    // inspector sizes an imported model in metres off this, and a made up
    // metre would silently rescale the model the first time it was touched.
    const box = assetBox(id);
    return box && !box.isEmpty() ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1);
  }
  let v = sizeCache.get(key);
  if (!v) {
    const box = new THREE.Box3();
    for (const part of propParts(key)) {
      part.geometry.computeBoundingBox();
      if (part.geometry.boundingBox) box.union(part.geometry.boundingBox);
    }
    v = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
    sizeCache.set(key, v);
  }
  return v;
}

export const CATEGORIES: Array<PropDef['category']> = [
  'Ground',
  'Nature',
  'Barriers',
  'Buildings',
  'Vehicles',
  'Track furniture',
];

/**
 * Ground cover: the things that belong ON the verge rather than beside it.
 *
 * The scatter brush keeps clear of the run off by default, which is right for
 * anything a car could hit and wrong for the grass the run off is made of.
 */
export const GRASS_KINDS: readonly string[] = ['grass_tuft', 'grass_clump'];

/** Ground pads are flat, so they get sized in metres and cast no shadow. */
export function isGroundPad(kind: string): boolean {
  return LIBRARY_BY_KEY.get(kind)?.category === 'Ground';
}
