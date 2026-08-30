import * as THREE from 'three';
import type { MaterialKey } from './road';

/**
 * Procedural textures. The very same canvases are used for the live preview
 * and written into the export as PNG, so what you see is what ksEditor gets.
 */

const SIZE = 512;

function canvas(px = SIZE): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

/** Deterministic value noise so a project always looks identical. */
function noise(ctx: CanvasRenderingContext2D, amount: number, seed: number, px = SIZE) {
  const img = ctx.getImageData(0, 0, px, px);
  const d = img.data;
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] = Math.min(255, Math.max(0, d[i] + n));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(ctx: CanvasRenderingContext2D, color: string, count: number, rMin: number, rMax: number, seed: number) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const r = rMin + rnd() * (rMax - rMin);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function makeAsphalt(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  ctx.fillStyle = '#3a3c3f';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalAlpha = 0.12;
  blotches(ctx, '#4a4d51', 900, 2, 9, 7);
  blotches(ctx, '#2c2e31', 700, 2, 7, 19);
  ctx.globalAlpha = 1;
  noise(ctx, 26, 1337);
  return c;
}

function makeKerb(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  // One full texture tile = one red + one white stripe pair.
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#c22030';
  ctx.fillRect(0, 0, SIZE, SIZE / 2);
  ctx.globalAlpha = 0.25;
  blotches(ctx, '#000000', 200, 1, 4, 55);
  ctx.globalAlpha = 1;
  noise(ctx, 14, 99);
  return c;
}

/**
 * Coloured tarmac, for the strip at the edge of a modern circuit.
 *
 * The same asphalt underneath with paint over it rather than a flat colour:
 * painted tarmac still reads as tarmac, and it is the grain showing through
 * that says so. Everything is drawn from the asphalt tile, so a green strip
 * and the road it borders never look like two different materials.
 */
function makePaintedAsphalt(color: string, seed: number) {
  return (): HTMLCanvasElement => {
    const [c, ctx] = canvas();
    ctx.fillStyle = '#3a3c3f';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalAlpha = 0.12;
    blotches(ctx, '#4a4d51', 900, 2, 9, 7);
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalAlpha = 0.16;
    blotches(ctx, '#000000', 500, 2, 10, seed);
    ctx.globalAlpha = 1;
    noise(ctx, 20, seed);
    return c;
  };
}

/** The painted line along the edge of the tarmac. Worn, not showroom white. */
function makeLine(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  ctx.fillStyle = '#e6e6e2';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalAlpha = 0.14;
  blotches(ctx, '#8d8d88', 400, 2, 14, 61);
  ctx.globalAlpha = 1;
  noise(ctx, 12, 313);
  return c;
}

/** The grid's front wheel bar. The same worn paint, in yellow. */
function makeYellowLine(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  ctx.fillStyle = '#e8c53c';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalAlpha = 0.16;
  blotches(ctx, '#9a8330', 400, 2, 14, 67);
  ctx.globalAlpha = 1;
  noise(ctx, 12, 317);
  return c;
}

/**
 * The same paint, broken into dashes along the V axis.
 *
 * The gaps are asphalt rather than transparent on purpose. The line is CUT OUT
 * of the surface it runs on -- that is what keeps it out of the depth buffer's
 * way -- so a transparent gap would be a hole straight through the road with
 * the ground showing through it. Filling the gap with the road's own colour
 * gives the same picture with no alpha channel, no second surface and no hole:
 * fourteen centimetres of flat grey against a texture that is flat grey.
 *
 * One tile is one dash plus one gap, so the period is set entirely by the V
 * coordinate the strip is given -- see PIT_DASH.
 */
function makeDashedLine(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  ctx.fillStyle = '#3a3c3f';
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Dash three fifths, gap two fifths, which is about what a merge line looks
  // like on a real circuit.
  ctx.fillStyle = '#e6e6e2';
  ctx.fillRect(0, 0, SIZE, Math.round(SIZE * 0.6));
  ctx.globalAlpha = 0.14;
  blotches(ctx, '#8d8d88', 240, 2, 12, 61);
  ctx.globalAlpha = 1;
  noise(ctx, 12, 907);
  return c;
}

/* ---------------- grass ---------------- */

/**
 * The grass tile is drawn bigger than the rest, and laid smaller on the ground.
 *
 * Both numbers come off real circuits rather than out of the air. Reading the
 * kn5s of imola, magione and the fn_imola mod: grass sits between 100 and 200
 * pixels to the world metre (fn_imola's `grass` is a 1024 sheet over 5.8 m,
 * its alpha tested verge card 512 over 2.6 m), where this editor's terrain was
 * laying a 512 tile over 12 m -- 43 px/m, a quarter of what the game expects,
 * which is most of why the ground read as green paint.
 *
 * 1024 over 8 m is 128 px/m, inside that band, and 8 m is the figure road.ts
 * already uses for the tarmac (`dist / 8`), so a gravel or asphalt patch
 * painted into the ground has exactly the grain of the road beside it.
 */
const GRASS_SIZE = 1024;

/** `#rrggbb` to `rgba(...)`, so a mark can fade out to nothing at its edge. */
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Mix two `#rrggbb`; t = 0 gives the first. */
function mix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (sh: number) =>
    Math.round(((x >> sh) & 255) + (((y >> sh) & 255) - ((x >> sh) & 255)) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/**
 * Run `draw` at every wrapped position of a mark of radius `r`.
 *
 * A tile is laid edge to edge, so anything drawn near a border has to come
 * back in on the opposite one or the join is a straight line across the whole
 * map -- which is what the old blotches left, every twelve metres, both ways.
 */
function wrapped(px: number, x: number, y: number, r: number, draw: (x: number, y: number) => void) {
  for (let dx = -px; dx <= px; dx += px) {
    for (let dy = -px; dy <= px; dy += px) {
      if (x + dx < -r || x + dx > px + r) continue;
      if (y + dy < -r || y + dy > px + r) continue;
      draw(x + dx, y + dy);
    }
  }
}

/** A blob with no edge to it, for the shading between the tufts. */
function patch(
  ctx: CanvasRenderingContext2D,
  px: number,
  x: number,
  y: number,
  r: number,
  color: string,
  a: number,
) {
  wrapped(px, x, y, r, (qx, qy) => {
    const g = ctx.createRadialGradient(qx, qy, 0, qx, qy, r);
    g.addColorStop(0, rgba(color, a));
    g.addColorStop(0.6, rgba(color, a * 0.45));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(qx - r, qy - r, r * 2, r * 2);
  });
}

/**
 * Grass from above, drawn to match what Assetto Corsa's own tracks ship.
 *
 * The old tile was a flat green with soft round dabs on it and heavy uniform
 * noise over the top. Measured against the real thing -- grass9.dds out of
 * magione, grass-detail18.dds and Grass0151_A.dds out of imola and the
 * fn_imola mod -- it was wrong in three ways at once, and each is worth naming
 * because they are the three things that separate grass from a green surface:
 *
 *   1. RANGE. Those textures run from very nearly black to pale straw, and a
 *      third of their pixels sit in deep shadow. Grass is a layer of blades
 *      with gaps between them, and what you see down the gaps is unlit ground.
 *      A tile with no black in it can only ever read as paint.
 *   2. DEAD MATTER. A third of the pixels are straw rather than leaf: dry
 *      stems, seed heads, last year's cuttings. Verges are not lawns.
 *   3. SCALE. All of the variation is fine. There is no feature a metre wide
 *      anywhere in them -- the tile is laid down again and again, and anything
 *      big enough to recognise is something you will recognise repeating.
 *
 * So this is built as a mat rather than a picture: dark ground, then sixty
 * thousand tapered blades in six passes from dark to light, each pass sitting
 * on top of the last so the gaps between them stay dark, and two of the passes
 * straw rather than green. Then shading at the size of a tuft, a third of a
 * metre, and nothing larger than that anywhere.
 *
 * The numbers in `PASSES` were tuned against the histograms of the three real
 * textures: mean around #4e5633, 30-35% of pixels below 55 luma, 33-40% straw.
 * tools/grass-preview.html (open it on the dev server) prints the same figures for this tile.
 *
 * Blades are batched into Path2D by colour and each path filled once. Sixty
 * thousand separate fills would be seconds of the main thread.
 */
const PASSES: [number, string, string, number, number, number, number][] = [
  // count, dark end, light end, min length, max length, half width, alpha
  [17000, '#223013', '#3f5223', 6, 20, 1.35, 0.95],
  [22000, '#374d26', '#648141', 5, 18, 1.25, 0.92],
  [20000, '#61833f', '#8fb25c', 5, 16, 1.15, 0.9],
  [9000, '#736e4c', '#ab9f78', 7, 26, 1.0, 0.8],
  [5000, '#8dab68', '#b3cc8d', 4, 12, 1.0, 0.85],
  [600, '#b6c894', '#d2e0b4', 2, 8, 1.1, 0.75],
];

function makeGrass(): HTMLCanvasElement {
  const px = GRASS_SIZE;
  const [c, ctx] = canvas(px);
  let s = 20260830 >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  // The ground under the mat: dark olive, and this is what shows down the gaps.
  ctx.fillStyle = '#1d2810';
  ctx.fillRect(0, 0, px, px);
  // Bare soil and last season's litter, which is where the brown comes from.
  for (let i = 0; i < 180; i++) {
    patch(ctx, px, rnd() * px, rnd() * px, 5 + rnd() * 24,
      rnd() < 0.5 ? '#3a3320' : '#282e14', 0.25 + rnd() * 0.3);
  }

  /*
   * Each blade is a triangle from a base a pixel or two wide to a point, in a
   * random direction: grass seen from directly above lies every way at once,
   * and a prevailing direction reads as fur. Short is the common case and tall
   * the exception, hence squaring the roll -- an even length is a doormat.
   *
   * Straight, not curved. A blade does bend, but at 128 px to the metre it is
   * one pixel wide, the bend is invisible, and the curve costs a third of the
   * build time of the whole texture.
   */
  const BUCKETS = 5;
  for (const [n, from, to, lenMin, lenMax, wide, alpha] of PASSES) {
    const paths: Path2D[] = [];
    for (let i = 0; i < BUCKETS; i++) paths.push(new Path2D());
    for (let i = 0; i < n; i++) {
      const x = rnd() * px;
      const y = rnd() * px;
      const a = rnd() * Math.PI * 2;
      const r = rnd();
      const len = lenMin + r * r * (lenMax - lenMin);
      const w = wide * (0.55 + rnd() * 0.7);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const nx = -dy * w;
      const ny = dx * w;
      const p = paths[Math.min(BUCKETS - 1, (rnd() * BUCKETS) | 0)];
      const blade = (qx: number, qy: number) => {
        p.moveTo(qx + nx, qy + ny);
        p.lineTo(qx - nx, qy - ny);
        p.lineTo(qx + dx * len, qy + dy * len);
        p.closePath();
      };
      // Only the blades near an edge have to be drawn nine times; that is a
      // few percent of them, and checking is far cheaper than not checking.
      const m = len + 2;
      if (x > m && y > m && x < px - m && y < px - m) blade(x, y);
      else wrapped(px, x, y, m, blade);
    }
    for (let i = 0; i < BUCKETS; i++) {
      ctx.fillStyle = mix(from, to, i / (BUCKETS - 1));
      ctx.globalAlpha = alpha;
      ctx.fill(paths[i]);
    }
    ctx.globalAlpha = 1;
  }

  /*
   * Shading at the size of a tuft -- a third of a metre, no more. Grass grows
   * in clumps and a clump shades its own base; without this the mat is even
   * everywhere and reads as carpet.
   */
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 200; i++) {
    patch(ctx, px, rnd() * px, rnd() * px, 12 + rnd() * 34, '#9aa387', 0.15 + rnd() * 0.3);
  }
  // Clumps of about a metre, and faint on purpose. grass9.dds has the same
  // slow swell in it, but it has to stay SHADING: give it an outline and it
  // becomes a feature, and a feature is something you spot repeating every
  // eight metres for the length of a straight.
  for (let i = 0; i < 70; i++) {
    patch(ctx, px, rnd() * px, rnd() * px, 55 + rnd() * 85, '#a3ac92', 0.06 + rnd() * 0.08);
  }
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 180; i++) {
    patch(ctx, px, rnd() * px, rnd() * px, 14 + rnd() * 38, '#2b3316', 0.3 + rnd() * 0.35);
  }
  ctx.globalCompositeOperation = 'source-over';

  /*
   * No grain pass. The old tile ran `noise` at 22 over a flat green, loud
   * enough to be visible as static in its own right; here eighty thousand
   * blades have already put detail in every pixel, and per pixel randomness
   * is the one thing PNG cannot compress -- it was costing about a megabyte
   * of the exported track folder to make the tile very slightly worse.
   */
  return c;
}

function makeSand(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  ctx.fillStyle = '#c2a878';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalAlpha = 0.3;
  blotches(ctx, '#d3bd93', 800, 3, 12, 11);
  blotches(ctx, '#a98f61', 600, 3, 10, 31);
  ctx.globalAlpha = 1;
  noise(ctx, 20, 777);
  return c;
}

function makeConcrete(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  ctx.fillStyle = '#8e8e8a';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalAlpha = 0.2;
  blotches(ctx, '#9c9c98', 500, 4, 16, 5);
  blotches(ctx, '#7e7e7a', 400, 4, 14, 17);
  ctx.globalAlpha = 1;
  noise(ctx, 16, 5150);
  return c;
}

/**
 * Armco: one W section steel beam, the thing a barrier is stacked out of.
 *
 * Not a picture of a wall. The geometry in road.ts folds a beam per tile out
 * of the barrier's base (GUARDRAIL_FOLD, RAIL_HEIGHT), so this tile carries
 * what geometry that cheap cannot: the crease down the middle of the beam, the
 * shadow of the notch where two of them meet, and the posts and bolts that say
 * how the thing is held up.
 *
 * The axes are the ones the barrier strip hands it, and they are the other way
 * round from every other tile here: U runs UP the barrier, one whole tile per
 * beam, and V runs ALONG it, four metres to the tile. So height is the canvas
 * X axis -- the beam is a vertical band of canvas -- and a post, which stands
 * at one point along the run and crosses every beam, is a horizontal one.
 */

/** Where the beam starts and ends in its tile; the rest is the notch. */
const BEAM = [0.09, 0.91] as const;

/**
 * Metres of barrier between posts, metres of run to one tile, and the height
 * of the one beam a tile covers.
 *
 * The height is road.ts's RAIL_HEIGHT written out again rather than imported:
 * this module already takes MaterialKey from road.ts, and that import is types
 * only -- pulling a value across would make it a real one, and a cycle with
 * it. It is used only to keep round things round on a tile whose two axes are
 * an order of magnitude apart in metres.
 */
const GUARDRAIL_POST_PITCH = 2;
const GUARDRAIL_TILE = 4;
const RAIL_HEIGHT = 0.33;

function makeGuardrail(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const px = (h: number) => h * SIZE;
  const posts = GUARDRAIL_TILE / GUARDRAIL_POST_PITCH;
  /* Canvas row of post `k`. Offset by half a pitch: a post drawn on the seam
     of the tile would be drawn again by the next tile and come out double. */
  const postAt = (k: number) => (SIZE * (k + 0.5) * GUARDRAIL_POST_PITCH) / GUARDRAIL_TILE;

  // The notch first, as the ground colour: what shows between two beams is the
  // post line and whatever stands behind the barrier, both of them in shadow.
  ctx.fillStyle = '#4c5257';
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.fillStyle = '#6a7176';
  const postW = (SIZE * 0.12) / GUARDRAIL_TILE;
  for (let k = 0; k < posts; k++) ctx.fillRect(0, postAt(k) - postW / 2, SIZE, postW);

  /*
   * The beam. The gradient across it IS the W section: a lip at each edge, a
   * ridge either side of the middle catching the light, and the crease between
   * them in shadow. Flat shading over the fold would read as sheet metal
   * nailed to a fence -- the crease is the whole reason a beam looks like a
   * beam from thirty metres away.
   */
  const g = ctx.createLinearGradient(px(BEAM[0]), 0, px(BEAM[1]), 0);
  // Not symmetric: the light comes from above, so the upper flute is the
  // brighter of the two and the lip under the beam is the darkest thing on it.
  g.addColorStop(0.0, '#4e565c');
  g.addColorStop(0.04, '#8b939a');
  g.addColorStop(0.16, '#c8d0d6');
  g.addColorStop(0.26, '#c0c8ce');
  g.addColorStop(0.38, '#798188');
  g.addColorStop(0.46, '#4f575d');
  g.addColorStop(0.54, '#5a6268');
  g.addColorStop(0.62, '#8f979e');
  g.addColorStop(0.76, '#d9dfe3');
  g.addColorStop(0.88, '#cdd4d9');
  g.addColorStop(0.96, '#8b939a');
  g.addColorStop(1.0, '#565e64');
  ctx.fillStyle = g;
  ctx.fillRect(px(BEAM[0]), 0, px(BEAM[1] - BEAM[0]), SIZE);

  /*
   * A bolt through the crease of the beam at every post: where a real one is
   * fastened, and the only thing that breaks up a long run of steel.
   *
   * Round on the barrier means an ellipse on the canvas, and a very long one:
   * the tile covers a third of a metre across X and four metres across Y, so a
   * circle drawn here comes out as a 9 cm smear along the run. Both radii are
   * therefore worked out from the metres they are meant to be.
   */
  const boltR = 0.022;
  for (let k = 0; k < posts; k++) {
    const y = postAt(k);
    const x = px((BEAM[0] + BEAM[1]) / 2);
    const rx = (SIZE * boltR) / RAIL_HEIGHT;
    const ry = (SIZE * boltR) / GUARDRAIL_TILE;
    ctx.fillStyle = '#4f565c';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#aeb6bc';
    ctx.beginPath();
    ctx.ellipse(x, y - ry * 0.3, rx * 0.6, ry * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Galvanised steel weathers in patches, not evenly, and a barrier stands in
  // whatever a season's worth of cars throws off the circuit at it.
  ctx.globalAlpha = 0.1;
  blotches(ctx, '#5f5a52', 260, 3, 16, 913);
  blotches(ctx, '#d7dce0', 200, 3, 12, 4177);
  ctx.globalAlpha = 1;
  noise(ctx, 12, 2026);
  return c;
}

/**
 * Chain link: the only texture here with holes in it.
 *
 * Everything else is opaque, so a barrier could only ever be a solid slab --
 * which is what made a four metre catch fence look like a four metre wall.
 * This one leaves the canvas clear and draws only the wire, so the alpha
 * channel carries the gaps. It survives the whole way: the canvas goes out as
 * PNG, and PNG keeps alpha, so the same image is what AC gets. The material
 * table then has to ask AC to test it (see ALPHA_TESTED below); without that
 * the engine ignores the channel and you are back to a solid panel.
 *
 * Drawn as two sets of diagonals, both wrapped past the edges, so the tile
 * repeats seamlessly in either direction.
 */
function makeChainLink(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  ctx.clearRect(0, 0, SIZE, SIZE);
  // 12 wires each way over the tile: fine enough to read as mesh at trackside
  // distance, coarse enough not to turn into shimmer as it goes away from you.
  const step = SIZE / 12;
  ctx.lineWidth = Math.max(2, SIZE / 150);
  ctx.lineCap = 'square';
  for (const dir of [1, -1]) {
    ctx.strokeStyle = dir === 1 ? '#b9c0c6' : '#98a0a6';
    for (let k = -12; k <= 24; k++) {
      const x = k * step;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + dir * SIZE, SIZE);
      ctx.stroke();
    }
  }
  // A post line down one edge, so a run of tiles reads as panels rather than
  // as one endless net.
  ctx.strokeStyle = '#8e969c';
  ctx.lineWidth = Math.max(3, SIZE / 90);
  ctx.beginPath();
  ctx.moveTo(ctx.lineWidth / 2, 0);
  ctx.lineTo(ctx.lineWidth / 2, SIZE);
  ctx.stroke();
  return c;
}

/**
 * Blades of grass on a clear background, for the tufts scattered over the verge.
 *
 * The second texture with holes in it, and it exists for the same reason the
 * first one does: a grass texture on the ground is grass seen from above, and
 * from a cockpit you are looking ALONG it. What sells it is the silhouette of
 * blades standing against whatever is behind them, which no amount of detail in
 * a ground texture can do. Kunos do exactly this -- magione's trees and grass
 * are alpha tested cards, not geometry.
 *
 * Drawn as tapered blades rising from the bottom edge, so the tuft is dense
 * where it meets the ground and open at the top. The bottom two rows of pixels
 * stay solid: a card whose base is transparent floats.
 */
function makeGrassBlades(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  ctx.clearRect(0, 0, SIZE, SIZE);
  let s = 20260728;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  /*
   * Sparse and thin, and that is the whole trick.
   *
   * The first version drew 150 blades up to 14 px wide over a 512 px tile --
   * three times more than fits, so it came out 60% opaque. Alpha tested, that
   * is not grass, it is a green rectangle with a few nicks in it, and against
   * a real circuit's verge it looked like a sign. The fence tile, which reads
   * correctly as fence, is 23% drawn; this aims at the same place.
   *
   * Blades taper to a point rather than running at full width to the tip: half
   * the ink for the same silhouette, and it is the silhouette that does the
   * work. Most are short, a few stand tall -- an even height reads as a brush.
   */
  const BLADES = 58;
  for (let i = 0; i < BLADES; i++) {
    const x = rnd() * SIZE;
    // Mostly short: squaring the roll pushes the distribution down.
    const r = rnd();
    const h = SIZE * (0.22 + r * r * 0.62);
    const lean = (rnd() - 0.5) * SIZE * 0.4;
    const w = SIZE * (0.004 + rnd() * 0.006);
    // Darker at the base, lighter at the tip: that gradient is most of what
    // makes a flat card read as something with depth in it.
    const g = ctx.createLinearGradient(x, SIZE, x + lean, SIZE - h);
    const tint = 0.72 + rnd() * 0.5;
    g.addColorStop(0, `rgb(${Math.round(38 * tint)}, ${Math.round(70 * tint)}, ${Math.round(31 * tint)})`);
    g.addColorStop(1, `rgb(${Math.round(104 * tint)}, ${Math.round(148 * tint)}, ${Math.round(62 * tint)})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w, SIZE);
    ctx.lineTo(x + w, SIZE);
    // Up one side to the tip, and straight back down the other.
    ctx.quadraticCurveTo(x + lean * 0.55 + w, SIZE - h * 0.6, x + lean, SIZE - h);
    ctx.quadraticCurveTo(x + lean * 0.5 - w, SIZE - h * 0.6, x - w, SIZE);
    ctx.fill();
  }
  // A hairline of root so a tuft is anchored rather than floating, thin enough
  // not to read as a green line when you are stood next to it.
  ctx.fillStyle = 'rgba(46, 82, 38, 0.9)';
  ctx.fillRect(0, SIZE - 2, SIZE, 2);
  return c;
}

/**
 * The distances a braking board can carry, in the order they sit on the sheet.
 *
 * One texture with all four on it, picked between by UV, rather than a material
 * each: AC draws one mesh per material per tile, and a set of boards at every
 * corner of a circuit is a lot of them. The order is the tile order -- left to
 * right, top to bottom -- and `signTile` in library.ts is the other half of
 * this, so anything added here has to keep the grid square.
 */
export const SIGN_DISTANCES = [50, 100, 150, 200] as const;

/**
 * The braking boards themselves: a white sheet with a black number on it.
 *
 * Real ones are exactly this and nothing else -- a rectangle on the ground, no
 * legs, because a post is one more thing for a car to hit. The number is drawn
 * as large as it will go with a margin, so it is still readable from where you
 * actually brake rather than from beside it.
 */
function makeSignBoard(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const half = SIZE / 2;
  ctx.fillStyle = '#f2f2ef';
  ctx.fillRect(0, 0, SIZE, SIZE);
  SIGN_DISTANCES.forEach((d, i) => {
    const x = (i % 2) * half;
    const y = ((i / 2) | 0) * half;
    // A border, so two boards side by side do not read as one long panel.
    ctx.strokeStyle = '#20242a';
    ctx.lineWidth = SIZE / 64;
    ctx.strokeRect(x + ctx.lineWidth, y + ctx.lineWidth, half - ctx.lineWidth * 2, half - ctx.lineWidth * 2);
    ctx.fillStyle = '#15181c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Sized off the tile so a three digit number stays inside its own board.
    const size = String(d).length >= 3 ? half * 0.5 : half * 0.62;
    ctx.font = `700 ${size}px Archivo, Inter, Arial, sans-serif`;
    ctx.fillText(String(d), x + half / 2, y + half / 2 + size * 0.04);
  });
  noise(ctx, 8, 8123);
  return c;
}

/* ------------------------------------------------------------------ */
/* The marshalling panels                                              */
/* ------------------------------------------------------------------ */

/**
 * The screen of a marshalling panel: a wall of lamps with no colour of its own.
 *
 * Drawn as discrete lamps rather than as a flat rectangle, and that is the
 * whole difference between a screen and a painted board -- each lamp a bright
 * core inside a wide dim halo, the black between them staying black.
 *
 * Colourless because the GAME colours it. Custom Shaders Patch multiplies the
 * material by whatever its flag condition is putting out, and a multiply can
 * only ever darken: tint a green panel with yellow and you get black, not
 * yellow. So the sheet is neutral and every colour comes from the session.
 *
 * Grey rather than pure white for the same reason a photograph is not exposed
 * to the ceiling: at 1.0 the bright core of a lamp has nowhere left to go, and
 * the grid flattens into a solid rectangle the moment the multiplier bites.
 */
function makeFlagPanel(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  /** Lamps across the panel. 20 over a 1.6 m board is a lamp every 8 cm. */
  const LAMPS = 20;
  // A bezel, so the lit area stops short of the edge the way a real one does.
  const inset = SIZE * 0.07;
  ctx.fillStyle = '#161a1f';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#050607';
  ctx.fillRect(inset, inset, SIZE - inset * 2, SIZE - inset * 2);
  const cell = (SIZE - inset * 2) / LAMPS;
  // Big lamps, bright halos: the board is read from a moving car across a
  // run off, and the timid version of it needed slowing down for. From the
  // cockpit the lamps fuse into one solid lit panel, which is what a real
  // LED board looks like at that distance anyway.
  ctx.fillStyle = '#f5fafc';
  for (let ly = 0; ly < LAMPS; ly++) {
    for (let lx = 0; lx < LAMPS; lx++) {
      const cx = inset + (lx + 0.5) * cell;
      const cy = inset + (ly + 0.5) * cell;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  return c;
}

/* ------------------------------------------------------------------ */
/* The start lights                                                    */
/* ------------------------------------------------------------------ */

/**
 * One lens of the start gantry: a bright core inside a deep red glass.
 *
 * Drawn as a disc rather than filling the tile, because that is what it is
 * laid on -- the flat cap of a short cylinder, whose UVs put the circle in the
 * middle of the square. The corners are therefore never seen, and drawing them
 * black is what stops a lens reading as a lit rectangle at distance.
 *
 * The core is not pure white. A lens photographs white only because a camera
 * cannot hold the exposure; at 1.0 the bloom has nowhere left to go and five
 * of them merge into one bar, which is the one thing a start light must not
 * do -- the whole point is that you can count them.
 */
function makeStartLens(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const r = SIZE / 2;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  // The glass, then the filament behind it.
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, '#ffd8cf');
  g.addColorStop(0.22, '#ff5a3a');
  g.addColorStop(0.62, '#d81a12');
  g.addColorStop(0.94, '#5c0805');
  g.addColorStop(1, '#120202');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.98, 0, Math.PI * 2);
  ctx.fill();
  // The fresnel rings a real lens is moulded with, faint enough to read as
  // texture rather than as a target.
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = SIZE / 128;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(r, r, (r * 0.94 * i) / 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  return c;
}

/**
 * The band along the gantry beam: a chequer over dark blue.
 *
 * Authored as ONE tile of the repeat, not as a whole banner. The beam it goes
 * on is as long as the circuit is wide, which is not a number this file can
 * know, so the gantry repeats this along the span at a fixed number of metres
 * per tile (see startGantryParts). A texture drawn as a finished banner would
 * be stretched by whatever that width happened to be.
 */
function makeStartBanner(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  ctx.fillStyle = '#141a22';
  ctx.fillRect(0, 0, SIZE, SIZE);
  /** Chequer squares across one tile. Even, so the pattern joins up. */
  const N = 8;
  const cell = SIZE / N;
  const band = cell * 2;
  for (const top of [0, SIZE - band]) {
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < N; i++) {
        ctx.fillStyle = (i + row) % 2 === 0 ? '#f4f4f2' : '#15181c';
        ctx.fillRect(i * cell, top + row * cell, cell, cell);
      }
    }
  }
  noise(ctx, 7, 5521);
  return c;
}

/* ------------------------------------------------------------------ */
/* Trees, built the way Assetto Corsa builds them                      */
/* ------------------------------------------------------------------ */

/**
 * Four cut out trees on one 2 x 2 sheet.
 *
 * This is the whole technique, and it is not ours -- it is what every AC track
 * does, Kunos' own included: a tree is a picture with the sky cut out of it,
 * stood up on two crossed cards. magione.kn5 carries `Trees` and `Trees_ext`
 * on ONE shared image, and that sharing is the point. Four species on four
 * separate textures would be four materials and four draw calls; on one sheet
 * a whole wood is a single call, which is what makes it affordable to plant a
 * thousand of them.
 *
 * `w` and `h` are the metres a tile is drawn FOR. The tile is square and a
 * tree is not, so the drawing is done in metres through a scaled transform
 * (see `treePen`) and comes out right on a card quoting the same two numbers.
 * The library entry reads them from here rather than repeating them: let the
 * two drift apart and every tree on the track is stretched, which is the kind
 * of wrongness you see immediately and cannot point at.
 */
export const TREE_CARDS = {
  broadleaf: { tile: 0, w: 9.0, h: 11.0 },
  poplar: { tile: 1, w: 4.6, h: 13.5 },
  pine: { tile: 2, w: 5.6, h: 12.5 },
  scrub: { tile: 3, w: 4.4, h: 4.2 },
} as const;

/**
 * How far the drawing keeps off the edges of its tile, as a fraction of the
 * tile. The card geometry must sample INSIDE this margin (see `treeCard` in
 * library.ts): mapped to the full tile, the margin becomes part of the tree's
 * metres and the painted trunk starts half a metre up the card -- which reads,
 * from the road, as a wood hovering above its own shadow.
 */
export const TREE_CARD_INSET = 0.045;

export type TreeCardName = keyof typeof TREE_CARDS;

/** Deterministic per tree, so the sheet is byte for byte the same every run. */
function rngFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Shade off a dark-to-light ramp. t = 0 is deep inside the crown, 1 is sunlit. */
const shade = (ramp: readonly string[], t: number) =>
  ramp[Math.min(ramp.length - 1, Math.max(0, Math.floor(clamp01(t) * ramp.length)))];

/**
 * Move the canvas onto one tile of the sheet and into that tree's own metres.
 *
 * After this call x = 0 is the trunk, y counts UP from the ground, and both
 * are metres. The caller restores.
 *
 * The inset is not neatness. Without it a crown touches the edge of its tile,
 * and the lower mip levels -- which average whole blocks of the sheet into one
 * pixel -- drag its leaves across the seam, so a pine picks up a green fringe
 * off the broadleaf in the tile beside it.
 */
function treePen(ctx: CanvasRenderingContext2D, card: { tile: number; w: number; h: number }) {
  const tile = SIZE / 2;
  const inset = tile * TREE_CARD_INSET;
  const span = tile - inset * 2;
  const ox = (card.tile % 2) * tile + inset;
  const oy = ((card.tile / 2) | 0) * tile + inset;
  ctx.save();
  ctx.translate(ox + span / 2, oy + span);
  ctx.scale(span / card.w, -span / card.h);
}

/**
 * One ragged clump of leaves.
 *
 * A circle would be wrong, and wrong in the way that matters most: alpha
 * tested, the only thing a card has to work with is its silhouette, and a
 * crown built from circles reads as a bag of balloons. The radius is re-rolled
 * per corner, and the ring closes back onto its FIRST radius rather than
 * rolling a fresh one at 2*pi, or every clump carries a notch where the loop
 * met itself.
 */
function clump(
  ctx: CanvasRenderingContext2D,
  rnd: () => number,
  x: number,
  y: number,
  r: number,
  fill: string,
) {
  const n = 9;
  const radii: number[] = [];
  for (let i = 0; i < n; i++) radii.push(r * (0.55 + rnd() * 0.72));
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    const a = (k / n) * Math.PI * 2;
    const px = x + Math.cos(a) * radii[k];
    const py = y + Math.sin(a) * radii[k];
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
interface BroadleafSpec {
  /** Where the trunk stops being a trunk and starts being limbs. */
  trunkTop: number;
  trunkW: number;
  /** How far the trunk wanders off vertical by the time it gets there. */
  lean: number;
  /** The crown, as an ellipse the leaves are scattered through. */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /**
   * How much narrower the crown is at its very top and very bottom, 0..1.
   *
   * A bare ellipse is a shape no tree has. An oak carries its mass high, so it
   * pinches at the bottom; a Lombardy poplar is a column that comes to a point,
   * so it pinches hard at the top. This one number is most of what tells the
   * two species apart at the distance a card is ever seen from.
   */
  pinchTop: number;
  pinchBottom: number;
  /** Leaf clumps, and how big one is. Small and many, never large and few. */
  clumps: number;
  rMin: number;
  rMax: number;
  /** Gaps between the branch masses, and the odd hole punched through one. */
  channels: number;
  holes: number;
  leaves: readonly string[];
  bark: string;
}

/**
 * A tree with a crown: oak, poplar, or the scrub at the bottom of the sheet,
 * which is the same drawing with the numbers turned down.
 *
 * Order is load bearing. Trunk and limbs go down FIRST so the leaves close
 * over them -- a trunk that stops where the crown starts reads as a lollipop,
 * and on a card you see straight through the gap. The gaps come LAST, cut
 * through leaves and limbs alike, because a gap in a crown is sky, and sky is
 * in front of nothing.
 */
function drawBroadleaf(
  ctx: CanvasRenderingContext2D,
  card: { tile: number; w: number; h: number },
  seed: number,
  spec: BroadleafSpec,
) {
  const rnd = rngFrom(seed);
  const { trunkTop, trunkW, lean, cx, cy, rx, ry, rMin, rMax, leaves, bark } = spec;
  treePen(ctx, card);

  /** Half width of the crown at height u, where u runs -1..1 up the ellipse. */
  const profile = (u: number) =>
    1 - spec.pinchTop * Math.max(0, u) ** 1.4 - spec.pinchBottom * Math.max(0, -u) ** 1.2;

  // A tapered trunk, bowed rather than ruled, and flared where it meets the
  // ground: nothing on a real verge is straight, and a straight one is the
  // first thing that says "made of boxes".
  ctx.fillStyle = bark;
  ctx.beginPath();
  ctx.moveTo(-trunkW * 0.72, 0);
  ctx.quadraticCurveTo(-trunkW * 0.36, trunkTop * 0.4, lean - trunkW * 0.15, trunkTop);
  ctx.lineTo(lean + trunkW * 0.15, trunkTop);
  ctx.quadraticCurveTo(trunkW * 0.36, trunkTop * 0.4, trunkW * 0.72, 0);
  ctx.closePath();
  ctx.fill();

  /*
   * Limbs up into the crown, and they are worth the code even though the
   * leaves cover most of them. What you are buying is the two or three places
   * where one shows through a gap: that is the difference between a tree and a
   * green cloud on a stick, and it is the first thing the eye checks.
   */
  ctx.strokeStyle = bark;
  ctx.lineCap = 'round';
  const limbs = 6;
  const limbEnds: Array<[number, number]> = [];
  for (let i = 0; i < limbs; i++) {
    const a = Math.PI * (0.14 + (0.72 * i) / (limbs - 1)) + (rnd() - 0.5) * 0.2;
    const reach = 0.62 + rnd() * 0.34;
    const ex = cx + Math.cos(a) * rx * reach;
    const ey = cy + Math.sin(a) * ry * reach * 0.85;
    limbEnds.push([ex, ey]);
    ctx.lineWidth = trunkW * (0.38 - 0.12 * rnd());
    ctx.beginPath();
    ctx.moveTo(lean * 0.7, trunkTop * 0.82);
    ctx.quadraticCurveTo(lean + Math.cos(a) * rx * 0.26, cy - ry * 0.42, ex, ey);
    ctx.stroke();
  }

  /*
   * The crown, stippled from many small clumps rather than assembled from a
   * few big ones.
   *
   * The first version used 150 clumps up to a metre across and came out looking
   * like a cauliflower: at that size the individual blobs are what you read,
   * and no arrangement of fifteen visible blobs is a tree. Four hundred at half
   * the radius disappear into a texture, which is the point -- what should be
   * legible is the SHAPE of the crown and the sky through it, never the brush.
   *
   * The radius is pushed outwards (the power is well under one) because the
   * leaves of a real tree live on the outside of it; an even scatter piles
   * everything into the middle and the rim comes out bald. A tenth of them are
   * thrown past the rim entirely, as the sprigs that break the outline.
   */
  const paint = (count: number, lift: number, rScale: number) => {
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const outlier = rnd() < 0.1;
      const rad = outlier ? 1 + rnd() * 0.16 : Math.pow(rnd(), 0.55);
      const u = Math.sin(a) * rad;
      const x = cx + Math.cos(a) * rad * rx * profile(u);
      const y = cy + u * ry;
      // Lit from above and from the right, deeply shaded underneath. This
      // gradient is doing nearly all the work: it is the only thing that can
      // make a flat card read as something with a near side and a far side.
      const t = 0.4 + lift + u * 0.46 + ((x - cx) / rx) * 0.16 + (rnd() - 0.5) * 0.24;
      const r = (rMin + rnd() * (rMax - rMin)) * rScale * (outlier ? 0.6 : 1);
      clump(ctx, rnd, x, y, r, shade(leaves, t));
    }
  };
  paint(spec.clumps, 0, 1);
  // A second, finer pass on the sunlit side only, for the sparkle a canopy has
  // along its top edge.
  paint(Math.round(spec.clumps * 0.25), 0.34, 0.6);

  /*
   * Sky through the crown, and the one thing a procedural canopy never gets
   * for free: overlapping clumps fill in solid, and a solid crown is a green
   * blob whatever colour it is.
   *
   * Two kinds, because a real tree has two. The channels are the gaps BETWEEN
   * branch masses -- wedges running out from the middle, which is why they
   * taper -- and they are what gives a crown its lobes. The holes are the
   * ordinary scatter of gaps within one mass. Channels alone read as a cut
   * cake; holes alone read as a green blob with woodworm.
   */
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineCap = 'round';
  for (let i = 0; i < spec.channels; i++) {
    // Started off centre and allowed to wander as it climbs. Struck from the
    // exact middle at a fixed bearing they all meet in one point, and the tree
    // comes out with a pale seam down it that no real crown has -- which is
    // precisely how a procedural texture gives itself away.
    const ox = (rnd() - 0.5) * 0.5;
    const oy = (rnd() - 0.5) * 0.5;
    let a = (i / spec.channels + rnd() * 0.5) * Math.PI * 2;
    const len = 0.5 + rnd() * 0.45;
    const steps = 8;
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      a += (rnd() - 0.5) * 0.5;
      // Out from near the middle towards the rim, never quite reaching it: a
      // channel that breaks the outline is a bite, not a gap between branches.
      const rad = 0.1 + f * len;
      const u = oy + Math.sin(a) * rad;
      const x = cx + (ox + Math.cos(a) * rad) * rx * profile(u);
      const y = cy + u * ry;
      // Wider the further out it goes: the mass it separates is a wedge.
      clump(ctx, rnd, x, y, rMin * (0.3 + f * 0.62), '#000');
    }
  }
  for (let i = 0; i < spec.holes; i++) {
    const a = rnd() * Math.PI * 2;
    // Spread across the crown and out to the rim rather than piled in the
    // middle. Piled in the middle they hollow the tree into a wreath, which is
    // the one shape that looks worse than no holes at all.
    const rad = 0.2 + Math.pow(rnd(), 0.7) * 0.78;
    const u = Math.sin(a) * rad;
    const x = cx + Math.cos(a) * rad * rx * profile(u);
    const y = cy + u * ry;
    // Clear of the top of the trunk, so a hole cannot saw the tree in half.
    if (y < trunkTop + rMax) continue;
    // Mostly small, a few bigger: an even size reads as polka dots.
    const g = rnd();
    clump(ctx, rnd, x, y, rMin * (0.3 + g * g * 1.1), '#000');
  }
  ctx.globalCompositeOperation = 'source-over';

  /*
   * The last hand's width of a limb, put back on top of the gaps just cut. A
   * branch showing through sky is right; a branch with a bite out of it is not.
   *
   * Only the tip, and only some of them. Restoring the whole limb hangs four
   * straight sticks across the crown, and a tree read at fifty metres is a
   * silhouette with texture in it, not a diagram of its own branching.
   */
  ctx.strokeStyle = bark;
  ctx.lineWidth = trunkW * 0.12;
  const from: [number, number] = [lean * 0.7, trunkTop * 0.82];
  for (const [ex, ey] of limbEnds) {
    if (rnd() > 0.4) continue;
    ctx.beginPath();
    ctx.moveTo(from[0] + (ex - from[0]) * 0.78, from[1] + (ey - from[1]) * 0.78);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.restore();
}

interface ConiferSpec {
  trunkW: number;
  /** Height of the leader, metres. The tiers stop just short of it. */
  top: number;
  /** Where the lowest tier sits. Bare trunk below that. */
  bottom: number;
  /** Half width of the lowest tier. */
  spread: number;
  tiers: number;
  needles: readonly string[];
  bark: string;
}

/**
 * A conifer: tiers of drooping branches up a trunk you can see between them.
 *
 * Drawn as tiers rather than as one cone on purpose. A cone silhouette is a
 * fir tree in a child's drawing; what you actually see from a car is a stack
 * of separate skirts with daylight between them, and getting that gap right is
 * most of the difference. So the trunk runs the FULL height and is left
 * showing wherever a tier does not cover it.
 */
function drawConifer(
  ctx: CanvasRenderingContext2D,
  card: { tile: number; w: number; h: number },
  seed: number,
  spec: ConiferSpec,
) {
  const rnd = rngFrom(seed);
  const { trunkW, top, bottom, spread, tiers, needles, bark } = spec;
  treePen(ctx, card);

  ctx.fillStyle = bark;
  ctx.beginPath();
  ctx.moveTo(-trunkW / 2, 0);
  ctx.lineTo(-trunkW * 0.1, top);
  ctx.lineTo(trunkW * 0.1, top);
  ctx.lineTo(trunkW / 2, 0);
  ctx.closePath();
  ctx.fill();

  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = bottom + (top - bottom) * t;
    // Tapering to a point rather than linearly: a spruce is not a triangle, it
    // is fat low down and pulls in quickly over the last few metres.
    const half = spread * Math.pow(1 - t, 0.85) + 0.1;
    const n = Math.max(3, Math.round(half * 4.5));
    for (const dir of [-1, 1] as const) {
      for (let k = 0; k < n; k++) {
        const f = (k + 0.35 + rnd() * 0.6) / n;
        // The droop. Branch tips hang, and a tier drawn level reads as a shelf.
        const droop = -Math.pow(f, 1.6) * half * 0.62;
        const r = (0.46 - 0.26 * f) * (0.85 + rnd() * 0.5);
        const lit = 0.3 + t * 0.5 + dir * 0.13 + (1 - f) * -0.12 + (rnd() - 0.5) * 0.28;
        clump(ctx, rnd, dir * half * f, y + droop, Math.max(0.1, r), shade(needles, lit));
      }
    }
  }
  // The leader. Without it the tree stops dead at its topmost tier, and a flat
  // topped spruce is the one silhouette anybody can tell is wrong.
  for (let i = 0; i < 5; i++) {
    const f = i / 4;
    clump(ctx, rnd, (rnd() - 0.5) * 0.12, top - 0.55 + f * 0.85, 0.3 - f * 0.2,
      shade(needles, 0.55 + f * 0.4));
  }
  ctx.restore();
}

/**
 * The sheet.
 *
 * Species differ by more than hue: an oak is wide and lumpy, a poplar is a
 * column, a spruce is tiers. Four silhouettes is what stops a planted wood
 * from reading as one tree stamped over and over, which no amount of scale
 * jitter ever fixes.
 */
function makeTreeCards(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  ctx.clearRect(0, 0, SIZE, SIZE);

  /*
   * Foliage, dark to sunlit.
   *
   * Muted on purpose. The bright greens a colour picker offers read as a
   * cartoon next to the asphalt and the grass on the same track -- vegetation
   * a couple of hundred metres away is half haze, and every AC tree sheet is
   * duller than anyone expects it to be until they hold one up beside a photo.
   */
  const OAK = ['#1c2a15', '#26371c', '#324624', '#40562c', '#516b36', '#688345'] as const;
  const POPLAR = ['#20301a', '#2b3f21', '#3a5128', '#4a6631', '#5d7c3c', '#77964b'] as const;
  const SPRUCE = ['#12220f', '#1a2f15', '#233e1c', '#2d4f23', '#3a622c', '#4b7738'] as const;
  const SCRUB = ['#1e2e18', '#293e20', '#365028', '#456432', '#57793e', '#71914c'] as const;

  drawBroadleaf(ctx, TREE_CARDS.broadleaf, 20260829, {
    trunkTop: 3.6, trunkW: 0.6, lean: 0.22,
    cx: 0, cy: 7.0, rx: 4.2, ry: 3.5, pinchTop: 0.22, pinchBottom: 0.34,
    clumps: 460, rMin: 0.26, rMax: 0.6, channels: 7, holes: 90,
    leaves: OAK, bark: '#463829',
  });

  drawBroadleaf(ctx, TREE_CARDS.poplar, 771903, {
    trunkTop: 3.2, trunkW: 0.42, lean: -0.1,
    cx: 0, cy: 8.2, rx: 2.05, ry: 4.9, pinchTop: 0.62, pinchBottom: 0.3,
    clumps: 400, rMin: 0.2, rMax: 0.44, channels: 6, holes: 80,
    leaves: POPLAR, bark: '#544636',
  });

  drawConifer(ctx, TREE_CARDS.pine, 4410233, {
    trunkW: 0.42, top: 12.1, bottom: 1.5, spread: 2.5, tiers: 11,
    needles: SPRUCE, bark: '#3a3025',
  });

  drawBroadleaf(ctx, TREE_CARDS.scrub, 6120044, {
    trunkTop: 0.95, trunkW: 0.24, lean: 0.14,
    cx: 0, cy: 2.5, rx: 2.0, ry: 1.5, pinchTop: 0.18, pinchBottom: 0.3,
    clumps: 260, rMin: 0.15, rMax: 0.32, channels: 5, holes: 55,
    leaves: SCRUB, bark: '#483a2c',
  });

  return c;
}

/**
 * Materials whose texture has holes in it.
 *
 * Kept next to the canvas that puts them there, because that is the only place
 * that knows. The kn5 writer turns this into shader ksPerPixelAT with
 * alphaTested = 1, which is exactly what Kunos use for trees and fencing --
 * magione.kn5 has `Trees_ext` on ksPerPixelAT and `Trees` on ksTree, both
 * alpha tested, both on one shared texture.
 */
/**
 * Materials that light themselves instead of waiting for the sun.
 *
 * The preview draws them at full brightness whatever the scene lighting is,
 * and the exporter writes them with the lighting constants of a lit surface
 * (see EMISSIVE_MATERIAL_PROPS in kn5.ts). A marshalling panel that dims in
 * the shade like a painted board is the one thing it must not do.
 */
export const EMISSIVE: ReadonlySet<MaterialKey> = new Set<MaterialKey>([
  'led_flag',
  'led_start',
]);

/**
 * What an emissive material glows in when its own texture does not say.
 *
 * The panel sheet is deliberately colourless (see makeFlagPanel), and a white
 * rectangle on a barrier tells you nothing. Previewing it green is not a guess
 * -- green is what the flag condition hands out for a running race, so the
 * editor shows the state the panel spends the whole session in.
 */
export const EMISSIVE_TINT: Partial<Record<MaterialKey, string>> = {
  led_flag: '#25ff5e',
  /*
   * The start lights are previewed LIT, which is the same argument again: the
   * gantry stands there red for the whole approach to a race and goes out for
   * one second, so the lit state is the one worth showing. Tinted rather than
   * left white because the lens texture already carries the red -- the tint
   * only stops the emissive pass washing it back out.
   */
  led_start: '#ff4a30',
};

export const ALPHA_TESTED: ReadonlySet<MaterialKey> = new Set<MaterialKey>([
  'chainlink',
  'grass_blades',
  'tree_card',
]);

/** Flat colour tile with a hint of grain, used by the prop materials. */
function makeFlat(color: string, seed: number, grain = 10) {
  return (): HTMLCanvasElement => {
    const [c, ctx] = canvas();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    noise(ctx, grain, seed);
    return c;
  };
}

/**
 * The gate tips: the same beams, painted safety orange. Drawn by repainting
 * the finished guardrail tile with a `color` blend, which swaps the hue and
 * keeps the luminosity -- so every fold, post line and highlight of the steel
 * survives under the paint instead of turning into a flat orange slab.
 */
function makeGuardrailOrange(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  ctx.drawImage(makeGuardrail(), 0, 0);
  ctx.globalCompositeOperation = 'color';
  ctx.fillStyle = '#ff5a10';
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Painted steel is brighter than bare: lift it or the orange reads rusty.
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = 'rgba(255,140,40,0.35)';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

/** Base colour of every material, also written into the FBX as DiffuseColor. */
export const MATERIAL_COLORS: Record<MaterialKey, string> = {
  asphalt: '#3a3c3f',
  kerb: '#c22030',
  grass: '#3f6b34',
  sand: '#c2a878',
  concrete: '#8e8e8a',
  guardrail: '#9aa3ab',
  guardrail_orange: '#e0642a',
  terrain: '#3f6b34',
  prop_dark: '#26292c',
  prop_light: '#d3d6d9',
  prop_metal: '#9aa3ab',
  prop_red: '#b8342f',
  prop_white: '#f2f2f2',
  prop_green: '#41803a',
  prop_darkgreen: '#2b5a29',
  prop_wood: '#8a6a45',
  prop_glass: '#7fa8c8',
  prop_yellow: '#e0b52c',
  prop_blue: '#2f5f9e',
  chainlink: '#b9c0c6',
  grass_blades: '#4a7a33',
  tree_card: '#3d5f2c',
  sign_board: '#f2f2ef',
  led_flag: '#e6ebef',
  led_start: '#d81a12',
  start_banner: '#141a22',
  line_white: '#e6e6e2',
  line_dashed: '#e6e6e2',
  line_yellow: '#e8c53c',
  asphalt_green: '#2f6a3f',
  asphalt_blue: '#2b5f9c',
  asphalt_red: '#9c3a33',
};

const builders: Record<MaterialKey, () => HTMLCanvasElement> = {
  asphalt: makeAsphalt,
  kerb: makeKerb,
  grass: makeGrass,
  sand: makeSand,
  concrete: makeConcrete,
  guardrail: makeGuardrail,
  guardrail_orange: makeGuardrailOrange,
  terrain: makeGrass,
  prop_dark: makeFlat('#26292c', 11),
  prop_light: makeFlat('#d3d6d9', 12),
  prop_metal: makeFlat('#9aa3ab', 13),
  prop_red: makeFlat('#b8342f', 14),
  prop_white: makeFlat('#f2f2f2', 15),
  prop_green: makeFlat('#41803a', 16, 22),
  prop_darkgreen: makeFlat('#2b5a29', 17, 22),
  prop_wood: makeFlat('#8a6a45', 18, 24),
  prop_glass: makeFlat('#7fa8c8', 19, 4),
  prop_yellow: makeFlat('#e0b52c', 20),
  prop_blue: makeFlat('#2f5f9e', 21),
  chainlink: makeChainLink,
  grass_blades: makeGrassBlades,
  tree_card: makeTreeCards,
  sign_board: makeSignBoard,
  led_flag: makeFlagPanel,
  led_start: makeStartLens,
  start_banner: makeStartBanner,
  line_white: makeLine,
  line_dashed: makeDashedLine,
  line_yellow: makeYellowLine,
  asphalt_green: makePaintedAsphalt('#2f6a3f', 71),
  asphalt_blue: makePaintedAsphalt('#2b5f9c', 72),
  asphalt_red: makePaintedAsphalt('#9c3a33', 73),
};

const canvasCache = new Map<MaterialKey, HTMLCanvasElement>();
const textureCache = new Map<MaterialKey, THREE.CanvasTexture>();

/**
 * Two names for one picture.
 *
 * The ground is `terrain` and the runoff strip beside the road is `grass`.
 * They have to stay separate materials -- AC reads the surface type off the
 * material, and one is drivable grass while the other is the world -- but they
 * are the same grass, and the tile costs half a second to draw. Building it
 * twice for two identical canvases was a second of the main thread on load.
 */
const SAME_PICTURE: Partial<Record<MaterialKey, MaterialKey>> = { terrain: 'grass' };

export function textureCanvas(key: MaterialKey): HTMLCanvasElement {
  const src = SAME_PICTURE[key] ?? key;
  let c = canvasCache.get(src);
  if (!c) {
    c = builders[src]();
    canvasCache.set(src, c);
  }
  return c;
}

export function getTexture(key: MaterialKey): THREE.CanvasTexture {
  // Aliased the same way as the canvas, so the pair is one upload to the GPU
  // rather than two copies of the same megabytes.
  key = SAME_PICTURE[key] ?? key;
  let t = textureCache.get(key);
  if (!t) {
    t = new THREE.CanvasTexture(textureCanvas(key));
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(key, t);
  }
  return t;
}

/** File name used both in the FBX texture reference and inside the ZIP. */
export function textureFileName(key: MaterialKey): string {
  return `${key}.png`;
}

export async function texturePngBytes(key: MaterialKey): Promise<Uint8Array> {
  const c = textureCanvas(key);
  const blob: Blob = await new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The same image upside down, for embedding in a kn5.
 *
 * three.js uploads a canvas texture with flipY, so the viewport samples V = 0
 * at the BOTTOM row of these canvases. Assetto Corsa reads a kn5's textures
 * the way this editor shows imported Kunos circuits -- flipY off, V = 0 at the
 * TOP row (see textureFrom in acScene.ts: their CompressedTextures render
 * Kunos' own tracks the right way up with the UVs untouched). Embedding the
 * canvas bytes as they are therefore turned every texture on its head in
 * game: invisible on noise and stripes, upside down on every tree card.
 */
export async function texturePngBytesFlipped(key: MaterialKey): Promise<Uint8Array> {
  const c = textureCanvas(key);
  const f = document.createElement('canvas');
  f.width = c.width;
  f.height = c.height;
  const ctx = f.getContext('2d')!;
  ctx.translate(0, c.height);
  ctx.scale(1, -1);
  ctx.drawImage(c, 0, 0);
  const blob: Blob = await new Promise((resolve, reject) => {
    f.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export const ALL_MATERIALS = Object.keys(MATERIAL_COLORS) as MaterialKey[];
