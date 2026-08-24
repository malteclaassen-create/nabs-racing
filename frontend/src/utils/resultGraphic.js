// ---------------------------------------------------------------------------
// The shareable result graphic, drawn to a canvas.
//
// This is Steve's Photoshop layout rebuilt as code: pink page, round and track
// across the top, a podium of three car tiles with gold/silver/bronze name
// bars, then the rest of the sheet as rows of number, name, team mark and
// points. Everything on it already lives in the database after a result import,
// so the whole post is a button instead of an evening.
//
// How many drivers a sheet holds is a setting, and a classification longer than
// one sheet carries on onto the next: the podium and the top ten, then places
// eleven to twenty as a table, which is the same thing the championship poster
// does with a long season.
//
// Canvas rather than HTML-to-image: the layout is rectangles, text and pictures,
// which the 2D context draws exactly and identically every time. The DOM
// route needs a library that re-implements CSS and quietly gets things wrong
// (shadows, letter-spacing, object-fit), and what you would be exporting is
// that library's opinion of the page rather than the page. Here the preview IS
// the exported bitmap, at a smaller scale.
//
// Every measurement is in LAYOUT below, at 1x. Nudging the design is editing
// numbers in one place, and the export just draws the same thing at 2x.
// ---------------------------------------------------------------------------

import { fmtDuration, fmtGap } from "./raceDuration.js";

// Every measurement below is read off Steve's Photoshop file rather than
// guessed from a screenshot: the pink outlines were found by scanning the
// composite for their colour, which gives the tile edges, the row pitch and the
// line weight to the pixel. 1080x1350 is the file's own size, and it is the 4:5
// that Discord and Instagram show without shrinking.
export const LAYOUT = {
  width: 1080,
  height: 1350,

  pad: 25, // page margin left and right

  // Every size below is solved rather than guessed: the string is rendered in
  // Montserrat 900, its INK measured, and the size chosen so that ink comes out
  // the size the same string is in Steve's file. His text boxes are what is
  // being matched, so "4." is 36px of ink here because it is 36px of ink there.
  //
  // In his own face both dimensions land at once, which is the check that the
  // face is right: at 71 the title is 856 wide by 68 tall against his 845 by
  // 68. Set in Archivo the same line could only match one of the two, and was
  // 5% out on the other.
  title: { y: 118, size: 71, gapToLogo: 24 },
  logo: { size: 82, right: 26, top: 18 },

  // The podium. `lift` is how much higher a tile sits than the lowest one. In
  // the file that is 13px for the winner: enough to notice, far too little to
  // call a staircase, which is what keeps three tall tiles looking like a row
  // of cards rather than a bar chart.
  podium: {
    top: 190,
    gap: 27,
    barHeight: 77,
    bottom: 589,
    lift: { 1: 13, 2: 0, 3: 0 },
    posSize: 68, // "1." "2." "3." — 49px of ink in the file
    posX: 24,
    posY: 68, // baseline, from the top of the tile
    nameSize: 40, // 31px of ink
    flagW: 54,
    // The car is shown WHOLE, sitting low in the tile with the position number
    // in the empty black above it — not cropped to fill the tile. A cut-out is
    // a wide picture and the tile is a tall one, so filling it would zoom into
    // the middle of the car and cut off both ends.
    carCy: 0.62, // centre of the car, as a fraction of the tile's height
    carInset: 10,
    carMaxH: 0.52, // and of its height
    // How far the fades at the top and bottom of a tile reach in, in pixels.
    // They only matter once a car is zoomed in far enough to be under the
    // position number or the time; see where they are drawn.
    scrimTop: 104,
    scrimBottom: 74,
    // The gap to the winner, in the strip between the car and the name bar.
    // Centred on the tile, so it sits over the middle of the car and directly
    // above the name, and the three tiles read as one column each rather than
    // as a picture with a caption stuck to one corner.
    //
    // Set small and grey on purpose: the number and the name are what the tile
    // is about, and a time that competed with them would turn three portraits
    // into three timing screens.
    //
    // The baseline hangs off the TOP OF THE BAR rather than the top of the
    // tile, because that edge is fixed while the car's own bottom is not — a
    // tall cut-out and a wide one end in different places, and only the bar
    // stays put. In the worst case (a car drawn to its full permitted height)
    // this still clears the car by a few pixels.
    deltaSize: 28,
    deltaAboveBar: 14, // baseline, above the top of the name bar
    // The points, in a chip tucked into the tile's bottom right corner. Its
    // right edge IS the tile's edge and its bottom IS the top of the name bar,
    // so only the top and left sides are its own — which is why the corner is
    // rounded on one side only. Measured in the file: 59 x 53 with a 16 radius.
    // Sized so the VISIBLE pink edges land where the file's do: 59 in from the
    // tile's right edge and 53 above the name bar. The box itself is 2.5 bigger
    // on each of those sides, because a 5px stroke is drawn centred on the path.
    chip: { h: 55, minW: 59, padX: 10.5, size: 18, radius: 16 },
  },

  // Places 4 down to whatever `rows` the caller asks for.
  rows: {
    top: 615,
    height: 80,
    gap: 25,
    numW: 85,
    numSize: 49, // 36px of ink in the file
    // The flag is CENTRED in the space between the number block and the name
    // rather than pinned to an x of its own: with a fixed left edge it sat 8px
    // off the number block and 21px off the name, which reads as the flag
    // having drifted left. Derived, so it stays even if the number block or the
    // name column moves.
    flagW: 50,
    nameX: 189,
    nameSize: 40, // 31px of ink
    markCx: 652, // centre of the team mark
    markMaxW: 280,
    markMaxH: 56,
    ptsRight: 58, // from the right edge of the page
    ptsSize: 40, // 30px of ink

    // The gap to the winner gets a column of its own between the team mark and
    // the points, right-aligned so the decimal points line up down the page —
    // which is the whole reason anyone reads a column of times.
    //
    // The mark moves left and shrinks to make the room. It only does so on a
    // round that HAS times: an archive round with none keeps the two numbers
    // above, so Steve's layout is still drawn exactly as he set it wherever the
    // new column would be empty anyway.
    deltaRight: 178, // from the right edge of the page
    deltaGap: 26, // and never closer than this to the points beside it
    deltaSize: 30,
    markCxTight: 580,
    markMaxWTight: 235,
  },

  // The little "T2" after a second-tier driver's name. Small enough to read as
  // a footnote on the name rather than as a second column, which is what it is:
  // the league runs two tiers in one classification, and on the poster there is
  // otherwise nothing to say which table a driver's points land in.
  tierPill: { h: 26, padX: 8, size: 17, radius: 13, gap: 10, frameWidth: 3 },

  // Team badge in the corner of a podium tile, opposite the position number.
  tileBadge: { size: 78, inset: 18 },
};

// ---------------------------------------------------------------------------
// The two designs.
//
// Same geometry, different skin: the layout above is shared, and everything a
// poster can look DIFFERENT about is a value in here. That is what keeps them
// from drifting into two half-maintained copies of the same drawing, and it is
// what makes a third one an entry in this object rather than a project.
//
// "medal" is allowed wherever a colour is: it means gold, silver or bronze
// depending on the place, which is how the same three colours land on a name
// bar in one design and on a name bar AND the position number in the other.
// ---------------------------------------------------------------------------
export const THEMES = {
  black: {
    label: "Black",
    // Sampled from the file, not chosen: the pink is #ffaec8, brighter than the
    // site's own, and the medals are Steve's rather than the browser's idea of
    // gold and silver.
    bg: "#030303",
    title: "#ffffff",
    medal: { 1: "#fecb2f", 2: "#b3b3b3", 3: "#a47936" },
    radius: 10,
    // The mark moves out of the corner and behind the classification. Not
    // placed by eye: this is the file's own layer box. Photoshop calls the
    // layer "nabs white transp" at 13% Normal, and it sits at (241,615) to
    // (1426,1470) — starting exactly at the top of place four and running off
    // the right and bottom edges of the page.
    //
    // WHITE, not pink. The layer's name says so and the flattened file agrees
    // (#212121 on the black, which is white at 13%; pink at 13% would come out
    // #241a1d, a difference nobody can see). One word here if you want pink.
    //
    // Pinned to two features of the mark itself, because that is how the
    // placement was described and it is the only way to be exact: the top of
    // the centre RING lands on the top edge of place four, and the right edge
    // of the N lands on the right edge of the rows.
    //
    // `src` are those two features measured in public/logo-light.png (1080 sq):
    // the ring's topmost ink is y=216, and at the ring's centre line the ink
    // runs are outer arc / ring / N-stem / N-diagonal / N-stem ending at x=707
    // / ring / outer arc. Change the logo file and these two move with it.
    //
    // `scale` comes from the PSD: Steve's layer is the same artwork, and his
    // box is 1185 wide against our 909 of ink, so 1.3036. That is also why our
    // version looked small — it was drawn at about three quarters of this.
    cornerMark: false,
    watermark: {
      src: { size: 1080, ringTop: 216, nRight: 707 },
      anchor: { ringTopY: 615, nRightX: 1055 },
      scale: 1.3036,
      alpha: 0.13,
      colour: "#ffffff",
    },
    // Blue rather than the poster's pink: pink is the design's own line colour
    // and is already round every tile and every row, so a pink pill inside a
    // pink-framed row reads as part of the frame. Blue belongs to nothing else
    // on the page.
    //
    // Solid, with black text. Both designs use the same bright blue, because a
    // filled pill has to carry black type: the darker blue that suited an
    // outline leaves the "T2" too close to its background to read at 17px.
    // Solid also means one pill works on black in the rows and on gold, silver
    // or bronze in a podium bar, without a second set of colours per surface.
    tierPill: { fill: "#2f8fff", ink: "#000000", frame: null },
    tile: { fill: "#000000", frame: "#ffaec8", frameWidth: 5, badge: true },
    // Gold, silver and bronze land TWICE: on the position number and on the
    // name bar under the car.
    pos: { colour: "medal" },
    nameBar: { fill: "medal", ink: "#000000", frame: "#ffaec8" },
    // The points in a chip in the corner of the tile: black like the tile, so
    // the pink outline is the whole of it, and white numbers like the points
    // down in the table.
    tilePoints: { fill: "#000000", ink: "#ffffff", frame: "#ffaec8", frameWidth: 5 },
    // The gap to the winner, on a tile and in a row. Grey rather than white:
    // it is the third thing on a line that already has a name and a score, and
    // the one a reader should be able to skip. Bright enough to read at arm's
    // length on a phone, dim enough not to be read first.
    delta: { tile: "#9c9c9c", row: "#9c9c9c" },
    row: {
      numFill: "#ffaec8", numInk: "#000000",
      barFill: "#000000", barFrame: "#ffaec8", frameWidth: 5,
      nameInk: "#ffffff", ptsInk: "#ffffff",
      flags: true, // a flag before each name, like the podium has
    },
    // "+20" rather than "20 / PTS": it is what the file says, and on one line
    // it leaves the name the width it needs.
    points: "plus",
  },
  pink: {
    label: "Pink",
    // Not the site's --c-brand: that one is a per-series accent an admin can
    // change, and this poster should not turn blue because somebody recoloured
    // the GT series.
    bg: "#f7c2ce",
    title: "#0a0a0a",
    medal: { 1: "#e3b23c", 2: "#c9c9c9", 3: "#c98f5c" },
    radius: 0,
    cornerMark: true, // the league mark, top right
    watermark: null, // no big mark behind the rows
    tile: { fill: "#000000", frame: "medal", frameWidth: 3, badge: true },
    pos: { colour: "#ffffff" },
    nameBar: { fill: "medal", ink: "#0a0a0a", frame: null },
    tierPill: { fill: "#2f8fff", ink: "#000000", frame: null },
    tilePoints: null,
    // Two greys, because the gap sits on two different surfaces here: a black
    // tile up top and a near-white row below. One value would be invisible on
    // one of them.
    delta: { tile: "#a8a8a8", row: "#6b6b6b" },
    row: {
      numFill: "#0a0a0a", numInk: "#ffffff",
      barFill: "#f2f2f2", barFrame: null, frameWidth: 0,
      nameInk: "#0a0a0a", ptsInk: "#0a0a0a",
      flags: false,
    },
    points: "pts",
  },
};


// A third, and deliberately not a recolour of the other two: both of those are
// dark-on-dark or a pink page, and a league that posts every week wants one
// design that is quiet. White paper, black number blocks, hairline rules, the
// medals still gold/silver/bronze so a podium still reads as one. It is also
// the one that survives being printed or dropped into a light-themed post.
THEMES.white = {
  label: "White",
  bg: "#ffffff",
  title: "#0a0a0a",
  medal: { 1: "#d4a418", 2: "#a8a8a8", 3: "#b07a3c" },
  radius: 12,
  cornerMark: true,
  watermark: null,
  tierPill: { fill: "#0a0a0a", ink: "#ffffff", frame: null },
  tile: { fill: "#0a0a0a", frame: "medal", frameWidth: 4, badge: true },
  pos: { colour: "#ffffff" },
  nameBar: { fill: "medal", ink: "#0a0a0a", frame: null },
  // The chip keeps the tile's own black with a medal outline, so the points sit
  // in the corner as a mark rather than as a second white box on a white page.
  tilePoints: { fill: "#0a0a0a", ink: "#ffffff", frame: "medal", frameWidth: 4 },
  delta: { tile: "#9a9a9a", row: "#8a8a8a" },
  row: {
    numFill: "#0a0a0a", numInk: "#ffffff",
    barFill: "#ffffff", barFrame: "#d8d8d8", frameWidth: 3,
    nameInk: "#0a0a0a", ptsInk: "#0a0a0a",
    flags: true,
  },
  points: "pts",
};

export const THEME_KEYS = Object.keys(THEMES);

// ---------------------------------------------------------------------------
// How the car sits in a podium tile.
//
// The default draws each car WHOLE, which is the safe thing to do with artwork
// nobody has seen yet: it cannot cut a nose cone off. But a whole car in a tall
// tile is a small car with black around it, and the poster often wants the
// opposite — the front wing and the sidepod filling the tile, the rest of the
// car off the edge.
//
// So: one zoom and two offsets, and the tile clips whatever hangs out. They are
// deliberately ONE setting for all three tiles rather than one per team, so the
// podium stays three of the same picture rather than three different crops, and
// so framing the poster is one decision instead of one per team per season.
//
// `x` and `y` are poster pixels at the design size (the 1080-wide canvas), so
// the numbers mean the same thing whatever the export scale is.
// ---------------------------------------------------------------------------
export const DEFAULT_FRAMING = { zoom: 1, x: 0, y: 0, frameWidth: 5, pts: "design", flags: "design" };

// The two switches, and why they have three values rather than two. "design"
// means whatever the chosen design says: the black poster prints a bare number
// and carries a flag on every row, the pink one prints PTS after the number and
// carries none. A plain on/off default would have had to pick one of those and
// silently restyle the other. So the stored value starts as "design" and only
// becomes "on" or "off" when somebody actually decides; the checkbox in the
// admin shows what you are currently getting either way.
export const FRAMING_SWITCHES = ["design", "on", "off"];

// What the sliders may ask for. 3x is about where a car cut-out runs out of
// resolution, and the offsets reach a little past the edge of a tile, which is
// as far as a picture can usefully be pushed before it has left.
//
// `frameWidth` is the outline weight, and 5 is the design's own: the pink line
// round every tile and every row in Steve's file is 5px. It is a SCALE rather
// than a paint-by-number width — see frameW() — so a design that draws a
// thinner line somewhere keeps it thinner.
export const FRAMING_LIMITS = {
  zoom: { min: 1, max: 3, step: 0.01 },
  x: { min: -320, max: 320, step: 1 },
  y: { min: -260, max: 260, step: 1 },
  frameWidth: { min: 1, max: 10, step: 1 },
};

// A design's own line weight, at the outline setting in force. At 5 (the
// default) every frame comes out exactly as designed, which is the only
// sensible thing for a number nobody has touched yet. Never below 1: a line
// rounded down to nothing is a missing frame, not a thin one.
function frameW(themeWidth, framing) {
  if (!themeWidth) return 0; // this design draws no frame here
  return Math.max(1, Math.round((themeWidth * framing.frameWidth) / DEFAULT_FRAMING.frameWidth));
}

const clampTo = (v, { min, max }, fallback) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

// Anything can arrive here — an old blob, a half-saved value, undefined — and
// it has to come out as three numbers a canvas can be handed.
export function cleanFraming(f) {
  return {
    zoom: clampTo(Number(f?.zoom), FRAMING_LIMITS.zoom, DEFAULT_FRAMING.zoom),
    x: clampTo(Number(f?.x), FRAMING_LIMITS.x, DEFAULT_FRAMING.x),
    y: clampTo(Number(f?.y), FRAMING_LIMITS.y, DEFAULT_FRAMING.y),
    frameWidth: Math.round(
      clampTo(Number(f?.frameWidth), FRAMING_LIMITS.frameWidth, DEFAULT_FRAMING.frameWidth)
    ),
    pts: FRAMING_SWITCHES.includes(f?.pts) ? f.pts : DEFAULT_FRAMING.pts,
    flags: FRAMING_SWITCHES.includes(f?.flags) ? f.flags : DEFAULT_FRAMING.flags,
  };
}

// Montserrat, which is what Steve set the poster in. NOT the site's face: the
// site is Archivo, and the poster is a thing he designed rather than a page of
// ours, so it keeps his type.
//
// It is his, provably. Taking the four text boxes in the PSD and asking which
// face has those width-to-height ratios: Montserrat is within 3% on all four
// and within 1% on "4.", where Archivo is out by 22%. A face either has that
// figure/full-stop rhythm or it does not.
//
// Self-hosted in public/fonts like everything else. Two weights, because two
// are used.
const FONT = (weight, size) => `${weight} ${size}px Montserrat, Archivo, Inter, system-ui, sans-serif`;

// Canvas text does NOT pull a webfont in: @font-face only fetches when some
// element on the page is styled with it, and nothing on the site is styled
// Montserrat. Without this the poster draws in Archivo and looks almost right,
// which is the worst kind of wrong. Asking for the exact weights makes the
// browser fetch them, and document.fonts.ready then waits for the fetch.
const POSTER_FONTS = ["900 100px Montserrat", "800 100px Montserrat"];
async function ensureFonts() {
  // The whole thing is best-effort, including the wait. A font that will not
  // load is not a reason to draw nothing: the stack above falls back to
  // Archivo and the poster still comes out, slightly wide.
  try {
    if (!document.fonts) return;
    await Promise.all(POSTER_FONTS.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  } catch {
    /* draw with whatever the stack resolves to */
  }
}

// Load an image for the canvas. Resolves to null instead of throwing: a missing
// car or a 404 logo must cost that one tile its picture, not the whole poster.
// crossOrigin stays unset on purpose — everything drawn here is served from our
// own origin, and setting it would break same-origin loads that need no CORS.
export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Draw `img` to FIT inside the box, centred, never cropped or stretched. Every
// picture on this poster is a whole thing somebody drew — a car, a logo, a
// flag — and there is no cropping any of them without cutting a brand or a
// nose cone in half.
function drawContain(ctx, img, cx, cy, maxW, maxH) {
  const scale = Math.min(maxW / img.width, maxH / img.height, 1e9);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

// A flag, drawn at its OWN proportions inside a square slot of `size`.
//
// Every country's flag has a different shape: Britain is 2:1, Germany 5:3,
// Switzerland square, Nepal taller than it is wide, Qatar nearly three times
// as wide as it is tall. Forcing them all into one rectangle — which is what
// this used to do, at a fixed 4:3 — stretches most of them and makes the
// familiar ones look subtly wrong, which is worse than looking obviously wrong.
//
// A SQUARE slot, because that is what Steve's file has: the one flag drawn in
// it is the Swiss one, 50 by 50, in its true 1:1. A wide flag then sits 50 wide
// and short, a square one fills the slot, and the name after it starts at the
// same x either way, so the column still lines up.
//
// Returns the width actually painted, which is what a caller centring a flag
// and a name together needs to know.
function drawFlag(ctx, img, x, cy, size) {
  const scale = Math.min(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, x + (size - w) / 2, cy - h / 2, w, h);
  return w;
}

// The "T2" pill. Drawn from the LEFT edge, returns the width it took, so a
// caller laying a row out can carry on after it. Nothing is drawn for a
// first-tier driver: the pill marks the exception, and a "T1" on every other
// line would turn a footnote into a column.
function drawTierPill(ctx, theme, x, cy, s = 1) {
  const P = LAYOUT.tierPill;
  const style = theme.tierPill;
  if (!style) return 0;
  ctx.font = FONT(900, P.size * s);
  const w = Math.round(ctx.measureText("T2").width) + P.padX * s * 2;
  // Inset by half the stroke, because a stroke is drawn centred on the path and
  // would otherwise hang half its width outside the size asked for.
  const half = style.frame ? (P.frameWidth * s) / 2 : 0;
  box(ctx, x + half, cy - (P.h * s) / 2 + half, w - half * 2, P.h * s - half * 2, P.radius * s);
  if (style.fill) {
    ctx.fillStyle = style.fill;
    ctx.fill();
  }
  if (style.frame) {
    ctx.strokeStyle = style.frame;
    ctx.lineWidth = P.frameWidth * s;
    ctx.stroke();
  }
  ctx.fillStyle = style.ink;
  ctx.textAlign = "center";
  // Centred on the pill's optical middle, the same way the points chip is.
  ctx.fillText("T2", x + w / 2, cy + P.size * s * 0.35);
  ctx.textAlign = "left";
  return w;
}

// How wide that pill will be, without drawing it. Needed by the podium, which
// has to know the width of the whole flag-name-pill group before it can place
// the first of the three.
function tierPillWidth(ctx, theme, show, s = 1) {
  if (!show || !theme.tierPill) return 0;
  ctx.font = FONT(900, LAYOUT.tierPill.size * s);
  return Math.round(ctx.measureText("T2").width) + LAYOUT.tierPill.padX * s * 2;
}

// A copy of `img` recoloured to one flat colour, keeping its shape. The league
// mark ships as a white PNG and the watermark wants it in the pink; painting
// pink THROUGH the artwork (source-in) recolours the marks and leaves the
// transparent background alone, which drawing a pink rectangle over it would
// not. Cached per image and colour: the poster redraws on every switch and this
// would otherwise rebuild the same canvas each time.
const tintCache = new Map();
function tinted(img, colour) {
  const key = `${img.src}|${colour}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = colour;
  x.fillRect(0, 0, c.width, c.height);
  tintCache.set(key, c);
  return c;
}

// A rectangle with corners, or without when the radius is 0. Only ever starts
// the path — the caller decides whether it is filled, stroked or clipped.
function box(ctx, x, y, w, h, r = 0) {
  ctx.beginPath();
  if (Array.isArray(r)) ctx.roundRect(x, y, w, h, r);
  else if (r > 0) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

// The path to STROKE so that the outline's outer edge lands exactly on the
// outer edge of a rounded box of radius `r`.
//
// A stroke is drawn centred on its path, so the path has to be inset by half
// the line width. The catch is the corner: inset a rounded rectangle and keep
// the same radius, and its corner arc is now centred half a line width further
// in, which puts the outline's outer edge INSIDE the shape's own corner. The
// fill then shows past the frame at each corner — invisible on a black tile
// against a black page, and very visible where a gold, silver or bronze name
// bar reaches the two bottom corners.
//
// Take the same amount off the radius and both arcs share a centre again, so
// the outline ends exactly where the shape does, all the way round.
function strokeBox(ctx, x, y, w, h, lineWidth, r = 0) {
  const half = lineWidth / 2;
  const inner = Array.isArray(r) ? r.map((v) => Math.max(0, v - half)) : Math.max(0, r - half);
  box(ctx, x + half, y + half, w - lineWidth, h - lineWidth, inner);
}

// Right-align on the INK rather than on the advance width.
//
// ctx.textAlign = "right" lines strings up by where the next character would
// start, and a digit's advance includes its side bearing. Montserrat's round
// figures carry a different one from its straight ones, so a column of
// right-aligned numbers comes out with its edge wandering by a pixel or two:
// 232 and 87 and 9 each stop somewhere slightly different, which down a table
// of ten rows reads as the numbers not being lined up. They were not.
//
// actualBoundingBoxRight is the distance from the anchor to the rightmost mark
// actually painted, so shifting by it puts the last pixel of every number on
// the same x. Falls back to plain right alignment where the browser does not
// report it.
// The alignment has to be set BEFORE measuring: measureText reports the box
// relative to the alignment point, so measuring while the context is still
// centred from the last thing drawn returns half a string's width and shifts
// every number left by it.
function fillTextInkRight(ctx, text, x, y) {
  ctx.textAlign = "right";
  const m = ctx.measureText(text);
  const over = Number.isFinite(m.actualBoundingBoxRight) ? m.actualBoundingBoxRight : 0;
  ctx.fillText(text, x - over, y);
}

// Shrink the font until the text fits, rather than letting a long name run into
// the points column. Returns the size actually used.
function fitText(ctx, text, maxW, weight, startSize, minSize = 18) {
  let size = startSize;
  while (size > minSize) {
    ctx.font = FONT(weight, size);
    if (ctx.measureText(text).width <= maxW) break;
    size -= 1;
  }
  return size;
}

// `data`:  { title, logo, podium: [{position,name,flag,car,badge}],
//            rows: [{position,name,mark,points}] }
// Images in `data` are already-loaded HTMLImageElements (or null) — see
// loadGraphicAssets below, which is what turns a race into this shape.
export function drawResultGraphic(ctx, data, scale = 1, themeKey = "pink") {
  // A sheet with no podium on it is places eleven and down: the same round,
  // continued. A race has ONE podium and it is on the first sheet, so the rest
  // are drawn as a table — the standings layout, which is this poster's own row
  // solved to fill the page. It keeps the gap column and the "+" on the points,
  // because a continuation sheet is still a classification of an afternoon
  // rather than a championship after it.
  if (!data.podium?.length) {
    drawStandingsGraphic(ctx, { ...data, pointsPlain: false }, scale, themeKey);
    return;
  }
  const L = LAYOUT;
  const T = THEMES[themeKey] || THEMES.pink;
  const F = cleanFraming(data.framing); // how the cars are cropped in their tiles
  ctx.save();
  ctx.scale(scale, scale);
  ctx.textBaseline = "alphabetic";

  // --- page -----------------------------------------------------------------
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, L.width, L.height);

  // The mark, huge and barely there, behind the classification. A black page
  // has a lot of empty in it and this is what fills it without competing.
  if (T.watermark && data.logo) {
    const w = T.watermark;
    const size = w.src.size * w.scale;
    // Solve for the top-left corner from the two anchors. Drawn at its natural
    // aspect and never squeezed: the mark is a circle, and a circle that has
    // been stretched is the one thing everybody notices.
    const wx = w.anchor.nRightX - w.src.nRight * w.scale;
    const wy = w.anchor.ringTopY - w.src.ringTop * w.scale;
    ctx.save();
    // Nothing above the top of place four. The ring lands exactly there, so
    // this only shaves the ring's own antialiasing — and it means the mark can
    // never creep into the gap between the podium and the table, which is the
    // strip of clean black that keeps the podium reading as its own block.
    ctx.beginPath();
    ctx.rect(0, L.rows.top, L.width, L.height - L.rows.top);
    ctx.clip();
    ctx.globalAlpha = w.alpha;
    ctx.drawImage(tinted(data.logo, w.colour), wx, wy, size, size);
    ctx.restore();
  }

  // --- league mark, top right ----------------------------------------------
  const logoBox = L.width - L.logo.right - L.logo.size;
  if (T.cornerMark && data.logo) {
    drawContain(ctx, data.logo, logoBox + L.logo.size / 2, L.logo.top + L.logo.size / 2, L.logo.size, L.logo.size);
  }

  // --- "Round 1 / Hockenheim" ----------------------------------------------
  // Centred on the PAGE. The mark in the corner only caps how wide the title
  // may get: it shrinks before it reaches the mark rather than sliding left out
  // of the middle to make room, because a heading that is nearly centred reads
  // as a mistake, and a slightly smaller one does not. With no corner mark the
  // cap is simply the page.
  const titleCx = L.width / 2;
  const titleRight = T.cornerMark ? logoBox - L.title.gapToLogo : L.width - L.pad;
  const titleMaxW = Math.max(200, (titleRight - titleCx) * 2);
  const titleSize = fitText(ctx, data.title, titleMaxW, 900, L.title.size, 30);
  ctx.font = FONT(900, titleSize);
  ctx.fillStyle = T.title;
  ctx.textAlign = "center";
  ctx.fillText(data.title, titleCx, L.title.y);

  // --- podium ---------------------------------------------------------------
  const P = L.podium;
  const colW = (L.width - L.pad * 2 - P.gap * 2) / 3;
  // Left to right on the page is 2nd, 1st, 3rd — the way a podium stands.
  const order = [2, 1, 3];
  order.forEach((place, i) => {
    const entry = data.podium.find((p) => p.position === place);
    if (!entry) return;
    const x = L.pad + i * (colW + P.gap);
    const lift = P.lift[place] || 0;
    const top = P.top - lift;
    const bottom = P.bottom - lift;
    const barTop = bottom - P.barHeight;
    const medal = T.medal[place];
    const tileH = barTop - top;
    const r = T.radius;

    // The card is ONE rounded box holding the car above and the name bar below,
    // clipped so both halves take the corner with it. Filling them as two
    // rectangles left square corners poking out of a rounded outline.
    ctx.save();
    box(ctx, x, top, colW, bottom - top, r);
    ctx.clip();
    ctx.fillStyle = T.tile.fill;
    ctx.fillRect(x, top, colW, tileH);
    if (entry.car) {
      // Zoomed and shifted per the framing, and clipped by the tile it is in:
      // the clip above is the whole reason this can be pushed past the edges at
      // all. A car blown up to three times its size stops at the pink outline
      // rather than running into the tile next door, over the round title or
      // down into the classification.
      drawContain(
        ctx,
        entry.car,
        x + colW / 2 + F.x,
        top + tileH * P.carCy + F.y,
        (colW - P.carInset * 2) * F.zoom,
        tileH * P.carMaxH * F.zoom
      );
      // And it stays UNDER everything else the tile carries: the badge, the
      // points chip and the name bar are all painted after it, and the position
      // number and the time after that. So zooming in can never hide them.
      //
      // What it CAN do is put bodywork behind them, and grey text on a red car
      // is not text. These two fades — the tile's own colour, solid at the edge
      // and gone a few dozen pixels in — give the number at the top and the
      // time at the bottom something to sit on. On an unzoomed tile they are
      // black on black and change nothing at all.
      const fade = (from, to) => {
        const g = ctx.createLinearGradient(0, from, 0, to);
        g.addColorStop(0, `${T.tile.fill}e6`);
        g.addColorStop(1, `${T.tile.fill}00`);
        ctx.fillStyle = g;
        ctx.fillRect(x, Math.min(from, to), colW, Math.abs(to - from));
      };
      fade(top, top + P.scrimTop);
      fade(barTop, barTop - P.scrimBottom);
    }
    if (T.tile.badge && entry.badge) {
      const b = L.tileBadge;
      drawContain(ctx, entry.badge, x + colW - b.inset - b.size / 2, top + b.inset + b.size / 2, b.size, b.size);
    }
    // Points, in a chip tucked into the bottom corner of the car half. Its
    // right edge is the tile's and its bottom is the name bar's, so it is
    // rounded and outlined on the TOP-LEFT only: the other two sides are
    // already drawn by the tile's own frame, and a full box there would put a
    // second pink line on top of the first.
    if (T.tilePoints && entry.points != null) {
      const c = P.chip;
      ctx.font = FONT(900, c.size);
      const label = `+${entry.points}`;
      const w = Math.max(c.minW, ctx.measureText(label).width + c.padX * 2);
      const cx = x + colW - w;
      const cy = barTop - c.h;

      // "medal" is allowed on every colour in a design, and it has to be turned
      // into gold, silver or bronze HERE. Assigning the word itself to
      // strokeStyle is not an error a canvas reports: it quietly ignores the
      // assignment and keeps the last colour used, which is the tile before
      // this one. That is why the first tile's chip came out silver, the third
      // one's gold, and the one drawn first had no outline at all.
      const medalOr = (v) => (v === "medal" ? medal : v);

      ctx.fillStyle = medalOr(T.tilePoints.fill);
      ctx.beginPath();
      ctx.roundRect(cx, cy, w, c.h, [c.radius, 0, 0, 0]);
      ctx.fill();

      if (T.tilePoints.frame) {
        ctx.strokeStyle = medalOr(T.tilePoints.frame);
        const cw = frameW(T.tilePoints.frameWidth, F);
        ctx.lineWidth = cw;
        const half = cw / 2;
        ctx.beginPath();
        ctx.moveTo(cx + w, cy + half);
        ctx.lineTo(cx + c.radius + half, cy + half);
        ctx.arcTo(cx + half, cy + half, cx + half, cy + c.radius + half, c.radius);
        ctx.lineTo(cx + half, cy + c.h);
        ctx.stroke();
      }

      ctx.fillStyle = medalOr(T.tilePoints.ink);
      ctx.textAlign = "center";
      ctx.fillText(label, cx + w / 2, cy + c.h / 2 + c.size * 0.36);
    }
    ctx.fillStyle = T.nameBar.fill === "medal" ? medal : T.nameBar.fill;
    ctx.fillRect(x, barTop, colW, P.barHeight);
    ctx.restore();

    // Frames, drawn last so nothing paints over them. The medal-framed design
    // outlines the tile alone; the outlined one wraps card and bar together
    // with a line between, which is what makes them read as one object.
    const frame = T.tile.frame === "medal" ? medal : T.tile.frame;
    if (frame) {
      const w = frameW(T.tile.frameWidth, F);
      ctx.strokeStyle = frame;
      ctx.lineWidth = w;
      if (T.nameBar.frame) {
        strokeBox(ctx, x, top, colW, bottom - top, w, r);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, barTop);
        ctx.lineTo(x + colW, barTop);
        ctx.stroke();
      } else {
        // Square at the bottom, rounded at the top. This outline ENDS on the
        // name bar rather than wrapping round it, and a rounded bottom corner
        // curls inwards away from the bar, which reads as two little hooks
        // where the black half meets the coloured one.
        strokeBox(ctx, x, top, colW, tileH, w, [r, r, 0, 0]);
        ctx.stroke();
      }
    }

    // Position number, top left, over the picture.
    ctx.font = FONT(900, P.posSize);
    ctx.fillStyle = T.pos.colour === "medal" ? medal : T.pos.colour;
    ctx.textAlign = "left";
    ctx.fillText(`${place}.`, x + P.posX, top + P.posY);

    // The gap to the winner, under the car — and on the winner's own tile, the
    // race time that gap is measured from, which is what the number is for.
    // The slot is the same on all three so the three tiles stay one row of
    // cards rather than two designs side by side.
    if (entry.delta && T.delta) {
      ctx.font = FONT(800, P.deltaSize);
      ctx.fillStyle = T.delta.tile;
      ctx.textAlign = "center";
      ctx.fillText(entry.delta, x + colW / 2, barTop - P.deltaAboveBar);
      ctx.textAlign = "left";
    }

    // Flag and name, centred in the bar as ONE group. Centring the name alone
    // would leave the flag stranded at the left edge with a gap after it, and
    // three tiles side by side make any drift off centre obvious — which is
    // also why the pair is measured first and placed second, rather than drawn
    // left to right and hoped about.
    const podiumFlag = F.flags === "off" ? null : entry.flag;
    const gap = podiumFlag ? 12 : 0;
    // How wide this particular flag comes out in its square slot. Measured
    // rather than assumed, so the gap to the name is the same 12px whether the
    // flag is a wide one or a square one.
    const flagW = podiumFlag ? P.flagW * Math.min(1, podiumFlag.width / podiumFlag.height) : 0;
    // A second-tier driver carries a "T2" after the name, and it joins the
    // group being centred rather than hanging off the end of it.
    const pillW = tierPillWidth(ctx, T, entry.tier === 2);
    const pillGap = pillW ? L.tierPill.gap : 0;
    // What is left for the text once the flag, the pill and the bar's own
    // margins are taken off. A name too long for that shrinks, as before.
    const nameSize = fitText(ctx, entry.name, colW - 36 - flagW - gap - pillW - pillGap, 900, P.nameSize, 20);
    ctx.font = FONT(900, nameSize);
    const barCy = barTop + P.barHeight / 2;
    const groupW = flagW + gap + ctx.measureText(entry.name).width + pillGap + pillW;
    let cursor = x + (colW - groupW) / 2;
    if (podiumFlag) {
      drawFlag(ctx, podiumFlag, cursor - (P.flagW - flagW) / 2, barCy, P.flagW);
      cursor += flagW + gap;
    }
    ctx.fillStyle = T.nameBar.ink;
    ctx.textAlign = "left";
    ctx.fillText(entry.name, cursor, barCy + nameSize * 0.36);
    if (pillW) drawTierPill(ctx, T, cursor + ctx.measureText(entry.name).width + pillGap, barCy);
  });

  // --- places 4 and down ----------------------------------------------------
  // The rows fill the strip between the podium and the foot of the page, the
  // same way the table poster's do, rather than marching down at a fixed pitch
  // from the top of the strip. The fixed pitch was fine while a sheet was
  // always the top ten — seven rows, and the seventh ends exactly on the
  // bottom margin — but the moment a sheet can be longer, the eighth row is
  // drawn past the bottom of the paper and simply is not on the poster. Which
  // reads, correctly, as the setting doing nothing.
  //
  // At seven this lands on the file's own 80 and 25 to the pixel, so the top
  // ten is drawn exactly as it always was. More rows close the gaps up first
  // and then take it out of the bars; fewer let the gaps open a little and sit
  // the block in the middle of the strip, because a short sheet is a poster
  // with air in it rather than four banners under a podium.
  const R = L.rows;
  const strip = L.height - L.pad - R.top;
  const n = data.rows.length;
  let rowH = R.height;
  let rowGap = R.gap;
  if (n * rowH + (n - 1) * rowGap > strip) {
    let pitch = strip / n;
    rowGap = Math.min(R.gap, pitch * 0.24);
    pitch = (strip + rowGap) / n;
    rowH = Math.min(R.height, pitch - rowGap);
  } else if (n > 1) {
    // Never past the table poster's own limit: gaps taller than that and the
    // spaces start reading as the subject rather than the bars.
    rowGap = Math.min(rowH * STANDINGS.maxGapOfRow, (strip - n * rowH) / (n - 1));
  }
  const rowsTop = R.top + Math.max(0, (strip - (n * rowH + (n - 1) * rowGap)) / 2);

  // The team mark gives up the width the gap column needs, but only on a round
  // that has times to put in it.
  const timed = data.rows.some((r) => r.delta) && !!T.delta;
  data.rows.forEach((row, i) => {
    drawRow(ctx, T, row, {
      y: rowsTop + i * (rowH + rowGap),
      h: rowH,
      showDelta: timed,
      frame: frameW(T.row.frameWidth, F),
      pts: F.pts,
      flags: F.flags,
    });
  });

  ctx.restore();
}

// ---------------------------------------------------------------------------
// One line of a classification: number block, flag, name, "T2", team mark and
// points, in a rounded bar. Shared, because the standings poster IS this row
// eleven times and nothing else — and two copies of it would be two designs
// within a week of the first change to either.
//
// `h` is the row's height. Everything inside scales with it against the height
// the layout was measured at, so a table of twenty drivers is the same row
// drawn smaller rather than a second set of numbers. At the result poster's own
// height the scale is exactly 1 and every value is the measured one.
//
// `pointsPlain` drops the "+" from the design that has one: on a result "+18"
// is what the driver won that afternoon, and on a standings table the same
// number is a season total, which nobody gained.
// ---------------------------------------------------------------------------
// `nameX` lets a caller move the whole name column: the constructors poster
// passes a tighter one when no team on the page has a flag, so the names sit
// against the number blocks instead of leaving an empty flag column down the
// page. Per PAGE, never per row — a mixed table keeps the design's x so its
// names line up whether or not each row has a flag.
function drawRow(ctx, T, row, { y, h, showDelta = false, pointsPlain = false, frame = null, pts = "design", flags = "design", nameX = null }) {
  const L = LAYOUT;
  const R = L.rows;
  const nX = nameX ?? R.nameX;
  // Never ABOVE 1: a short table is allowed taller bars so it fills the page,
  // but the type in them stays the size it was measured at. Scaled up too, a
  // six-row poster would be six banners with 60px names on it, which is a
  // different thing from a table with room to breathe.
  const s = Math.min(1, h / R.height);
  const rowW = L.width - L.pad * 2;
  const barX = L.pad + R.numW;
  const midY = y + h / 2;
  // The gap column only exists on a timed round; without it the mark keeps the
  // width and the centre it was designed with.
  const markCx = showDelta ? R.markCxTight : R.markCx;
  const markMaxW = showDelta ? R.markMaxWTight : R.markMaxW;

  // One rounded row, clipped like the podium card so the number block takes the
  // left corners with it instead of sitting square inside them.
  ctx.save();
  box(ctx, L.pad, y, rowW, h, T.radius);
  ctx.clip();
  ctx.fillStyle = T.row.barFill;
  ctx.fillRect(barX, y, L.width - L.pad - barX, h);
  ctx.fillStyle = T.row.numFill;
  ctx.fillRect(L.pad, y, R.numW, h);
  ctx.restore();
  if (T.row.barFrame) {
    const w = frame;
    ctx.strokeStyle = T.row.barFrame;
    ctx.lineWidth = w;
    strokeBox(ctx, L.pad, y, rowW, h, w, T.radius);
    ctx.stroke();
  }

  const numSize = R.numSize * s;
  ctx.font = FONT(900, numSize);
  ctx.fillStyle = T.row.numInk;
  ctx.textAlign = "center";
  ctx.fillText(`${row.position}.`, L.pad + R.numW / 2, midY + numSize * 0.36);

  // Points, with "PTS" AFTER the number rather than stacked under it. Under it
  // the word pushed the figure off the row's middle line and made a two-line
  // block out of a one-line fact; beside it the row reads as a sentence and
  // every number keeps the same baseline as the name it belongs to.
  //
  // The word is drawn first, at a fixed width, so the numbers to its left still
  // end on one x whether the label is showing or not.
  const ptsSize = R.ptsSize * s;
  const ptsX = L.width - L.pad - R.ptsRight;
  const showLabel = pts === "on" || (pts === "design" && T.points === "pts");
  ctx.fillStyle = T.row.ptsInk;
  const baseline = midY + ptsSize * 0.36;
  let numRight = ptsX;
  if (showLabel) {
    ctx.font = FONT(800, ptsSize * 0.62);
    ctx.textAlign = "right";
    ctx.fillText("PTS", ptsX, baseline);
    numRight = ptsX - ctx.measureText("PTS").width - ptsSize * 0.2;
  }
  const label = `${pointsPlain ? "" : "+"}${row.points}`;
  ctx.font = FONT(900, ptsSize);
  fillTextInkRight(ctx, label, numRight, baseline);
  // Where the points block actually starts. The gap column is placed against
  // THIS rather than against a fixed x, because the block's width is not fixed:
  // it grows by the whole word when PTS is showing and by a digit when somebody
  // scores a hundred. Pinned to a constant, the time ran into it — which is
  // exactly what happened the day PTS moved out beside the number.
  const ptsLeft = numRight - ctx.measureText(label).width;

  // The gap to the winner, right-aligned in its own column so the decimal
  // points stack down the page. Still right-aligned (never centred) even though
  // it shrinks to fit: a column of times is read down the fractions, and
  // centring would leave them zig-zagging.
  if (showDelta && row.delta) {
    const deltaX = Math.min(L.width - L.pad - R.deltaRight, ptsLeft - R.deltaGap * s);
    // Never into the team mark. A minute-plus gap is a long string and the mark
    // is a picture with no room to give, so the time is what yields.
    const size = fitText(ctx, row.delta, deltaX - (markCx + markMaxW / 2) - 16, 800, R.deltaSize * s, 18);
    ctx.font = FONT(800, size);
    ctx.fillStyle = T.delta.row;
    fillTextInkRight(ctx, row.delta, deltaX, midY + size * 0.36);
  }

  // Flag, then the name. The flag only appears where the design has one; the
  // name starts at the same x either way, so the column of names lines up
  // whether or not a driver has a country on file.
  const showFlag = flags === "on" || (flags === "design" && T.row.flags);
  if (showFlag && row.flag) {
    const flagW = R.flagW * s;
    drawFlag(ctx, row.flag, barX + (nX - barX - flagW) / 2, midY, flagW);
  }
  const markLeft = markCx - markMaxW / 2;
  // The "T2" after a second-tier driver's name. The name gets the room left
  // after it, so a long name shrinks rather than running under the pill.
  const pillW = tierPillWidth(ctx, T, row.tier === 2, s);
  const pillGap = pillW ? L.tierPill.gap * s : 0;
  const nameSize = fitText(
    ctx, row.name, Math.max(120, markLeft - 24 - nX - pillW - pillGap), 900, R.nameSize * s, 16
  );
  ctx.font = FONT(900, nameSize);
  ctx.fillStyle = T.row.nameInk;
  ctx.textAlign = "left";
  ctx.fillText(row.name, nX, midY + nameSize * 0.36);
  if (pillW) drawTierPill(ctx, T, nX + ctx.measureText(row.name).width + pillGap, midY, s);

  // Team mark, centred in its own column so the marks line up down the page
  // however wide each one is.
  if (row.mark) drawContain(ctx, row.mark, markCx, midY, markMaxW, R.markMaxH * s);
}

// ---------------------------------------------------------------------------
// The championship table, as a poster.
//
// Same page, same designs, same rows as the result poster with the podium taken
// off the top: the two go out in the same channel a fortnight apart and have to
// look like they came from the same place.
//
// The rows fill the page rather than sitting at a fixed pitch, because the
// number of them is a choice — ten for a top ten, or the whole field. `maxH`
// keeps a short list from turning into five fat bars, and below that everything
// in a row scales together (see drawRow), so twenty drivers is the same row
// drawn smaller instead of a second, denser design.
// ---------------------------------------------------------------------------
export const STANDINGS = {
  title: { y: 96, size: 62 },
  // "After round 2". Its own line under the title rather than part of it: the
  // title is what the poster IS, this is which week it is from, and putting
  // them in one string makes a heading nobody can set in a big enough size.
  sub: { y: 150, size: 30, alpha: 0.62 },
  top: 196,
  bottomPad: 25,
  maxH: 130, // a row never gets taller than this, however few there are
  gap: 25, // at full height; it closes up with the rows as the list grows
  maxGapOfRow: 0.42, // and never opens past this much of a row's height
  // A heading over a block of rows ("TIER 1"). Only the constructors poster
  // uses one: it is two tables on one page, and without a word between them the
  // reader has a fourteen-line list where the numbering restarts halfway down
  // for no visible reason.
  section: { size: 27, h: 34, gapAfter: 6, alpha: 0.72 },
};

export function drawStandingsGraphic(ctx, data, scale = 1, themeKey = "black") {
  const L = LAYOUT;
  const S = STANDINGS;
  const T = THEMES[themeKey] || THEMES.black;
  const F = cleanFraming(data.framing); // only the outline weight matters here
  ctx.save();
  ctx.scale(scale, scale);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, L.width, L.height);

  // One table or several. A drivers poster is one block with no heading over
  // it; the constructors poster is Tier 1 and Tier 2, each with its own. Same
  // solver either way, so the two cannot drift apart.
  const sections = data.sections || [{ heading: null, rows: data.rows || [] }];
  const n = Math.max(1, sections.reduce((sum, s) => sum + s.rows.length, 0));
  const headSpace = sections.filter((s) => s.heading).length * (S.section.h + S.section.gapAfter);
  const area = L.height - S.bottomPad - S.top - headSpace;
  // Solve the pitch, then let the gap follow it: at eleven rows this lands on
  // the result poster's own 80 and 25, and it closes up from there.
  let pitch = area / n;
  let gap = Math.min(S.gap, pitch * 0.24);
  pitch = (area + gap) / n;
  let h = Math.min(S.maxH, pitch - gap);
  // A short list has height left over. Some of it goes back into the gaps, but
  // only up to `maxGapOfRow`: past that the spaces are taller than the bars and
  // the table stops reading as a list of one thing. What is still left over is
  // split above and below, so six rows sit in the middle of the page rather
  // than in a heap under the title.
  if (h < pitch - gap) gap = Math.min(h * S.maxGapOfRow, n > 1 ? (area - n * h) / (n - 1) : 0);
  const top = S.top + Math.max(0, (area - (n * h + (n - 1) * gap)) / 2);

  // The big mark behind the table, exactly where the result poster puts it, so
  // the two posters have the same thing in the same place. Clipped to the top of
  // the list rather than to a fixed line, because the list starts higher here.
  if (T.watermark && data.logo) {
    const w = T.watermark;
    const size = w.src.size * w.scale;
    const wx = w.anchor.nRightX - w.src.nRight * w.scale;
    const wy = w.anchor.ringTopY - w.src.ringTop * w.scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, S.top, L.width, L.height - S.top);
    ctx.clip();
    ctx.globalAlpha = w.alpha;
    ctx.drawImage(tinted(data.logo, w.colour), wx, wy, size, size);
    ctx.restore();
  }

  if (T.cornerMark && data.logo) {
    drawContain(
      ctx, data.logo,
      L.width - L.logo.right - L.logo.size / 2, L.logo.top + L.logo.size / 2, L.logo.size, L.logo.size
    );
  }

  // Title, centred on the page and shrunk rather than moved if it is long.
  const cx = L.width / 2;
  const titleMax = L.width - L.pad * 2 - (T.cornerMark ? L.logo.size * 2 + 40 : 0);
  const titleSize = fitText(ctx, data.title, titleMax, 900, S.title.size, 28);
  ctx.font = FONT(900, titleSize);
  ctx.fillStyle = T.title;
  ctx.textAlign = "center";
  ctx.fillText(data.title, cx, S.title.y);

  if (data.subtitle) {
    ctx.font = FONT(800, S.sub.size);
    ctx.globalAlpha = S.sub.alpha;
    ctx.fillText(data.subtitle, cx, S.sub.y);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";

  const frame = frameW(T.row.frameWidth, F);
  // A championship table has no gap to the winner in it and its points are
  // season totals nobody won today. A continuation sheet of a race result has
  // both, and asks for them. Off unless asked, so every standings poster draws
  // exactly what it drew before.
  const showDelta = !!data.showDelta && !!T.delta;
  const pointsPlain = data.pointsPlain !== false;
  // When not a single row on the page will draw a flag — the constructors
  // poster, mostly, since teams have no nationality unless one is set by hand —
  // the whole name column moves left into the empty flag slot. The page-level
  // check keeps a mixed table aligned: one driver without a country on file
  // must not indent differently from the rest.
  const flagsOn = F.flags === "on" || (F.flags === "design" && T.row.flags);
  const anyFlag = flagsOn && sections.some((s) => s.rows.some((r) => r.flag));
  const nameX = anyFlag ? null : L.pad + L.rows.numW + 26;
  let y = top;
  for (const section of sections) {
    if (section.heading) {
      ctx.font = FONT(800, S.section.size);
      ctx.fillStyle = T.title;
      ctx.globalAlpha = S.section.alpha;
      // Left-aligned over the block rather than centred: it is a column header,
      // and a centred one floating above a left-aligned table reads as a second
      // title for the whole page.
      ctx.fillText(section.heading, L.pad + 6, y + S.section.size);
      ctx.globalAlpha = 1;
      y += S.section.h + S.section.gapAfter;
    }
    for (const row of section.rows) {
      drawRow(ctx, T, row, { y, h, showDelta, pointsPlain, frame, pts: F.pts, flags: F.flags, nameX });
      y += h + gap;
    }
  }

  ctx.restore();
}

// Which design was chosen last. It lives here rather than in a component
// because two places need the same answer: the page that previews the poster
// and the button that posts it to Discord. If they disagreed, the picture in
// the channel would not be the picture that was approved.
const THEME_STORE = "nabs_graphic_theme";

export function savedTheme() {
  try {
    const k = localStorage.getItem(THEME_STORE);
    return THEME_KEYS.includes(k) ? k : THEME_KEYS[0];
  } catch {
    return THEME_KEYS[0];
  }
}

export function saveTheme(key) {
  try {
    if (THEME_KEYS.includes(key)) localStorage.setItem(THEME_STORE, key);
  } catch {
    /* private mode: the choice just does not survive the tab */
  }
}

// How the RESULT poster is cut into sheets, and how many drivers a sheet holds.
//
// Ten was the whole poster until now: a podium and seven rows, and everybody
// from eleventh down simply not on it. A field of twenty is two sheets in one
// message — the podium and the top ten, then places eleven to twenty — which is
// the same answer the standings table came to, for the same reason: twenty rows
// on one poster is twenty lines nobody can read on a phone.
//
// Stored the way the design and the standings setup are, and for the same
// reason: the Graphic tab is where it is set, by looking at the picture, and the
// Discord post next door renders its OWN copies to attach. Two places to set it
// would be two answers and the channel would get whichever was touched last.
const RESULT_STORE = "nabs_result_setup";
// Never below four: three of them are the podium, and a sheet with nothing under
// the tiles is a podium with the classification cut off it.
export const RESULT_PER_PAGE = { min: 4, max: 20, step: 1, def: 10 };

export function savedResultSetup() {
  try {
    const raw = JSON.parse(localStorage.getItem(RESULT_STORE) || "{}");
    const n = Number(raw.perPage);
    const ok = Number.isFinite(n) && n >= RESULT_PER_PAGE.min && n <= RESULT_PER_PAGE.max;
    return { perPage: ok ? Math.round(n) : RESULT_PER_PAGE.def };
  } catch {
    return { perPage: RESULT_PER_PAGE.def };
  }
}

export function saveResultSetup(setup) {
  try {
    localStorage.setItem(RESULT_STORE, JSON.stringify({ perPage: setup.perPage }));
  } catch {
    /* private mode: the choice just does not survive the tab */
  }
}

// How the standings table is cut into sheets: ten drivers a page makes a top ten
// and then places eleven to twenty, which is the whole reason for pages.
//
// Stored the same way the design is, and for the same reason: two places need
// the same answer. The Standings tab is where you set it by looking at the
// picture; the Discord post next door renders its OWN copies to attach, and if
// the two disagreed the channel would get a different set of sheets from the
// ones that were approved.
const STANDINGS_STORE = "nabs_standings_setup";
export const STANDINGS_PER_PAGE = { min: 5, max: 20, step: 1, def: 10 };

// Which group the poster is of. The same four the standings page itself offers,
// with the same meanings: `tier` on a row is the DRIVER's, and 0 is a reserve.
export const STANDINGS_TIERS = [
  { key: "all", label: "All" },
  { key: "1", label: "Tier 1" },
  { key: "2", label: "Tier 2" },
  { key: "0", label: "Reserves" },
];

export function savedStandingsSetup() {
  try {
    const raw = JSON.parse(localStorage.getItem(STANDINGS_STORE) || "{}");
    const n = Number(raw.perPage);
    const ok = Number.isFinite(n) && n >= STANDINGS_PER_PAGE.min && n <= STANDINGS_PER_PAGE.max;
    const spots = (v, def) => {
      const x = Number(v);
      return Number.isFinite(x) && x >= CONSTRUCTOR_SPOTS.min && x <= CONSTRUCTOR_SPOTS.max ? Math.round(x) : def;
    };
    return {
      // Which championship: the drivers' table or the constructors'.
      kind: raw.kind === "constructors" ? "constructors" : "drivers",
      perPage: ok ? Math.round(n) : STANDINGS_PER_PAGE.def,
      tier: STANDINGS_TIERS.some((t) => t.key === raw.tier) ? raw.tier : "all",
      // Off unless it was deliberately turned on: the reserve pool is mostly
      // people who have not driven, and they are not what a standings poster is
      // about.
      withoutStarts: raw.withoutStarts === true,
      t1Rows: spots(raw.t1Rows, CONSTRUCTOR_SPOTS.t1),
      t2Rows: spots(raw.t2Rows, CONSTRUCTOR_SPOTS.t2),
    };
  } catch {
    return {
      kind: "drivers", perPage: STANDINGS_PER_PAGE.def, tier: "all", withoutStarts: false,
      t1Rows: CONSTRUCTOR_SPOTS.t1, t2Rows: CONSTRUCTOR_SPOTS.t2,
    };
  }
}

export function saveStandingsSetup(setup) {
  try {
    localStorage.setItem(
      STANDINGS_STORE,
      JSON.stringify({
        kind: setup.kind,
        perPage: setup.perPage,
        tier: setup.tier,
        withoutStarts: !!setup.withoutStarts,
        t1Rows: setup.t1Rows,
        t2Rows: setup.t2Rows,
      })
    );
  } catch {
    /* private mode: the choice just does not survive the tab */
  }
}

// The rows a poster of `tier` is actually made of.
//
//   * Every driver holding a seat is on it, Tier 1 and Tier 2 alike, whether or
//     not they have driven yet. They are IN the championship: a seat with no
//     start is somebody who missed the opening rounds, not somebody who is not
//     racing this season, and leaving them off would be the poster deciding
//     that for them.
//
//   * Reserves who have not STARTED a round are left off. That is a different
//     group: a season's reserve pool is the whole sign-up list, and most of it
//     is people who have never got in a car — page after page of identical zero
//     rows that belong to no championship. A start counts even when it ended in
//     a DNF with no points, which is why this asks perRace rather than the
//     total, and `withoutStarts` puts them back.
//
//   * The rows that remain are numbered 1..n, ALWAYS. Whatever is taken out
//     leaves a hole otherwise, and a table that reads 37, 49, 50, 53 is not a
//     classification, it is a classification with most of it missing. It also
//     means a tier reads as its own standings rather than as the main table
//     with the other tier cut out of it.
//
// The one guard: if NOBODY has a start — a totals-only archived season, or a
// table asked for before the first round — nothing is dropped, because an empty
// poster is not an answer.
export function filterStandings(rows, tier = "all", { withoutStarts = false } = {}) {
  const started = (r) => Object.keys(r.perRace || {}).length > 0;
  const idleReserve = (r) => Number(r.tier) === 0 && !started(r);
  let picked = String(tier) === "all" ? rows : rows.filter((r) => String(r.tier) === String(tier));
  if (!withoutStarts && rows.some(started)) picked = picked.filter((r) => !idleReserve(r));
  return picked.map((r, i) => ({ ...r, position: i + 1 }));
}

// Which of the four groups this table actually has anybody in. A "Tier 2"
// button on a single-class season is a button that empties the poster.
export function standingsTiersPresent(rows) {
  const present = new Set(rows.map((r) => r.tier));
  return STANDINGS_TIERS.filter((t) => t.key === "all" || present.has(Number(t.key)));
}

// How many sheets a list of `total` drivers makes at `perPage` a sheet. One
// place, and one for both posters, because the preview, the sheet buttons and
// the post all have to agree about how many there are.
export function pageCount(total, perPage) {
  return Math.max(1, Math.ceil(total / Math.max(1, perPage)));
}

// What the standings poster is called, and which week it is from. Here rather
// than in either component, because the preview and the copy the Discord post
// renders have to be captioned the same or the picture in the channel is not
// the picture that was approved.
//
// The heading follows the group: a Tier 2 table under "Driver's standings"
// would read as THE championship, with the leader in fourteenth.
export function standingsTitle(tier = "all") {
  if (String(tier) === "1") return "Tier 1 standings";
  if (String(tier) === "2") return "Tier 2 standings";
  if (String(tier) === "0") return "Reserve standings";
  return "Driver's standings";
}

export function constructorsTitle() {
  return "Constructors' standings";
}

export function standingsSubtitle(upToRound) {
  return upToRound ? `After round ${upToRound}` : null;
}

// The round a table should be frozen after, from the round picked in the
// Content area. A training session or a special event carries no round number,
// so those mean "the season as it stands" rather than a table after nothing.
export function upToRoundOf(race) {
  if (!race) return null;
  if (race.type === "TRAINING" || race.isSpecialEvent) return null;
  return race.number ?? null;
}

// Exported at twice the design size: it is a poster people open full screen,
// and 2x is the difference between crisp type and Discord's resampling.
export const EXPORT_SCALE = 2;

// Draw a race's poster onto `canvas`, sizing it as it goes. THE one way a
// poster gets made: the preview calls it, and so does the Discord post, so the
// file that lands in the channel is by construction the thing that was on
// screen. Nothing is stored in between, which is what keeps the design free to
// change — every post draws it again, from the current design and the current
// artwork, however old the round is.
export async function renderPosterTo(canvas, opts) {
  await ensureFonts(); // a canvas takes whatever the font stack resolves to NOW
  const data = await loadGraphicAssets(opts);
  canvas.width = LAYOUT.width * EXPORT_SCALE;
  canvas.height = LAYOUT.height * EXPORT_SCALE;
  drawResultGraphic(canvas.getContext("2d"), data, EXPORT_SCALE, opts.theme);
  return canvas;
}

// The same poster as a PNG blob, drawn off-screen. For the Discord post, which
// needs the bytes rather than something to look at.
export async function renderPosterBlob(opts) {
  const canvas = await renderPosterTo(document.createElement("canvas"), opts);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

// The championship table as a poster, same shape of call as the result one.
export async function renderStandingsTo(canvas, opts) {
  await ensureFonts();
  const data = await loadStandingsAssets(opts);
  canvas.width = LAYOUT.width * EXPORT_SCALE;
  canvas.height = LAYOUT.height * EXPORT_SCALE;
  drawStandingsGraphic(canvas.getContext("2d"), data, EXPORT_SCALE, opts.theme);
  return canvas;
}

// And the constructors, which is the same poster with two tables on it.
export async function renderConstructorsTo(canvas, opts) {
  await ensureFonts();
  const data = await loadConstructorsAssets(opts);
  canvas.width = LAYOUT.width * EXPORT_SCALE;
  canvas.height = LAYOUT.height * EXPORT_SCALE;
  drawStandingsGraphic(canvas.getContext("2d"), data, EXPORT_SCALE, opts.theme);
  return canvas;
}

export async function renderConstructorsBlob(opts) {
  const canvas = await renderConstructorsTo(document.createElement("canvas"), opts);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

// How many teams of each tier the constructors poster shows. Steve's own split:
// Tier 1 is a short grid and its top five is the story, Tier 2 has more teams in
// it and wants seven or eight. Both adjustable, because a season can add a team.
export const CONSTRUCTOR_SPOTS = { min: 3, max: 12, step: 1, t1: 5, t2: 8 };

// Both constructor tables, with every wordmark already loaded. The row is the
// same row as everywhere else: number, name, mark, points. The team's name is
// drawn as text AND its wide logo sits in the middle column, because a team
// with no wordmark uploaded would otherwise be an anonymous numbered bar.
export async function loadConstructorsAssets({
  t1 = [], t2 = [], teamArt = {}, logoSrc, title, subtitle = null,
  t1Rows = CONSTRUCTOR_SPOTS.t1, t2Rows = CONSTRUCTOR_SPOTS.t2, framing = null,
}) {
  const markSrc = (r) => teamArt[r.teamId]?.mark || r.logoUrl || null;
  // A team's country is not in the database — teams have no nationality column
  // — so it is set per team in the poster's own settings, next to their
  // pictures. No flag on file simply means no flag on the row.
  const flagSrc = (r) => {
    const code = teamArt[r.teamId]?.country;
    return code ? `/flags/w80/${String(code).toLowerCase()}.png` : null;
  };
  const shown1 = t1.slice(0, t1Rows);
  const shown2 = t2.slice(0, t2Rows);

  const [logo, marks1, marks2, flags1, flags2] = await Promise.all([
    loadImage(logoSrc),
    Promise.all(shown1.map((r) => loadImage(markSrc(r)))),
    Promise.all(shown2.map((r) => loadImage(markSrc(r)))),
    Promise.all(shown1.map((r) => loadImage(flagSrc(r)))),
    Promise.all(shown2.map((r) => loadImage(flagSrc(r)))),
  ]);

  const row = (r, i, marks, flags) => ({
    position: r.position ?? i + 1,
    name: r.name,
    points: r.total ?? 0,
    tier: null, // the section heading already says which tier this is
    mark: marks[i],
    flag: flags[i],
  });

  return {
    title,
    subtitle,
    logo,
    framing: cleanFraming(framing),
    sections: [
      { heading: "TIER 1", rows: shown1.map((r, i) => row(r, i, marks1, flags1)) },
      { heading: "TIER 2", rows: shown2.map((r, i) => row(r, i, marks2, flags2)) },
    ].filter((s) => s.rows.length),
  };
}

// Every sheet of a RESULT, as PNG blobs in reading order — the same job the
// next one does for a table, and for the same caller: the Discord post attaches
// them all to one message. `pages` is 0-based, so posting the podium sheet
// alone is `[0]`.
export async function renderResultBlobs(opts, { perPage, pages }) {
  const out = [];
  for (const p of pages) out.push(await renderPosterBlob({ ...opts, perPage, offset: p * perPage }));
  return out.filter(Boolean);
}

// Every sheet of a table, as PNG blobs in reading order. For the Discord post,
// which attaches them all to one message. Drawn one after another rather than
// at once: each one is a 2160x2700 canvas, and a dozen of those in flight is a
// way to run a phone out of memory for no gain.
// `pages` is which sheets to draw, as 0-based indexes: posting only the top ten
// of a twenty-driver table is a normal week, and rendering the rest to throw it
// away is work nobody asked for.
export async function renderStandingsBlobs(opts, { perPage, pages }) {
  const out = [];
  for (const p of pages) {
    const canvas = await renderStandingsTo(document.createElement("canvas"), {
      ...opts,
      rows: perPage,
      offset: p * perPage,
    });
    out.push(await new Promise((resolve) => canvas.toBlob(resolve, "image/png")));
  }
  return out.filter(Boolean);
}

// The rows of /api/standings/drivers, with every picture already loaded. Same
// job as loadGraphicAssets and the same rules: the team's WIDE wordmark where
// one is uploaded and the site's own logo where it is not, the flag resolved
// the way the rest of the site resolves it, and the TEAM's tier deciding which
// table a driver's points land in.
export async function loadStandingsAssets({
  standings, teamArt = {}, countryOf, logoSrc, title, subtitle = null, rows = 10, offset = 0, framing = null,
}) {
  const flagSrc = (code) => (code ? `/flags/w80/${String(code).toLowerCase()}.png` : null);
  // `offset` is what makes a second sheet possible: places 11 to 20 are the same
  // poster starting further down the same table. The positions come off the
  // table rows themselves, so page two counts from eleven without being told.
  const shown = standings.slice(offset, offset + rows);
  const markSrc = (r) => teamArt[r.team?.id]?.mark || r.team?.logoUrl || null;

  const [logo, marks, flags] = await Promise.all([
    loadImage(logoSrc),
    Promise.all(shown.map((r) => loadImage(markSrc(r)))),
    Promise.all(shown.map((r) => loadImage(flagSrc(countryOf(r))))),
  ]);

  return {
    title,
    subtitle,
    logo,
    framing: cleanFraming(framing),
    rows: shown.map((r, i) => ({
      position: r.position ?? i + 1,
      name: r.name,
      points: r.total ?? 0,
      tier: r.team?.tier ?? null,
      mark: marks[i],
      flag: flags[i],
    })),
  };
}

// Who is actually ON the poster, in finishing order: everybody classified, DNFs
// and non-starters left off. Exported because the admin page needs the same
// list the poster is drawn from — to know how many sheets a round makes, and
// whose flags and team pictures are worth offering underneath.
export function classifiedResults(results = []) {
  return results
    .filter((r) => r.position != null && (!r.status || r.status === "FINISHED"))
    .sort((a, b) => a.position - b.position);
}

// Turn one race (as /api/races/:id/results hands it over) into the shape above,
// with every picture already loaded. `teamArt` is the admin's uploaded cars and
// wordmarks, keyed by team id; `countryOf` resolves a driver's flag the same
// way the rest of the site does.
export async function loadGraphicAssets({
  race, results, teamArt = {}, countryOf, logoSrc,
  perPage = RESULT_PER_PAGE.def, offset = 0, framing = null,
}) {
  // The gap column, worked out exactly the way the race page's own time column
  // is (RaceResults.jsx), because the poster and the page must not disagree
  // about how far behind somebody finished:
  //
  //   * steward penalties are IN the time, since they are in the order too;
  //   * a lapped car says "+1 lap" rather than a meaningless number of minutes;
  //   * the winner's cell holds the absolute race time the gaps are measured
  //     from, which is what the whole column is relative to;
  //   * a round with no times recorded — most of the archive — gets nothing at
  //     all, rather than a column of dashes.
  //
  // fmtGap is the site's own formatter, so the poster is in the same English
  // notation as everywhere else: "+1.234", and "+1:05.231" once it passes a
  // minute.
  const adjMs = (r) => (r.totalTimeMs > 0 ? r.totalTimeMs + (r.penaltySeconds || 0) * 1000 : null);
  // w80, the largest in the mirror: the poster draws a flag at 46px and the
  // export doubles that, so the 40px file the site uses would show its pixels.
  const flagSrc = (code) => (code ? `/flags/w80/${String(code).toLowerCase()}.png` : null);

  const classified = classifiedResults(results);

  // The sheet this call is drawing. The first one carries the podium and the
  // rows under it; every one after that is rows alone, because the podium
  // belongs to the race and not to whichever ten drivers are on the paper.
  const shown = classified.slice(offset, offset + Math.max(1, perPage));
  const top3 = offset === 0 ? shown.slice(0, 3) : [];
  const rest = offset === 0 ? shown.slice(3) : shown;

  // Always the winner, whatever sheet this is: a gap on the second sheet is
  // still a gap to the person who won, not to whoever happens to be top of the
  // page.
  const leader = classified[0] || null;
  const leaderMs = leader ? adjMs(leader) : null;
  const leaderLaps = leader?.laps ?? null;
  const deltaOf = (r) => {
    const ms = adjMs(r);
    if (ms == null) return null;
    if (r === leader) return fmtDuration(ms);
    if (leaderMs == null) return null;
    if (leaderLaps != null && r.laps != null && r.laps < leaderLaps) {
      const down = leaderLaps - r.laps;
      return `+${down} lap${down > 1 ? "s" : ""}`;
    }
    // A time at or below the winner's without a lap count to explain it is a
    // half-recorded round, and no number here beats a wrong one.
    const gap = fmtGap(ms - leaderMs);
    if (!gap) return null;
    // The unit goes on, because on a poster the number stands alone with no
    // column heading to say what it is. Only where the number IS seconds,
    // though: past a minute the string reads m:ss.mmm, and an "s" on the end of
    // that would be naming the wrong one of the two.
    return gap.includes(":") ? gap : `${gap}s`;
  };

  // Which table this drive counts towards. The TEAM's tier, not the driver's,
  // the same rule the site's own Tier-2 standings use: a reserve standing in
  // for a second-tier team scores in the second tier.
  const tierOf = (r) => r.effectiveTeam?.tier ?? r.team?.tier ?? null;

  const artOf = (r, kind) => teamArt[r.effectiveTeam?.id || r.team?.id]?.[kind] || null;
  // No wordmark uploaded? The site's own square logo stands in.
  const markSrc = (r) => artOf(r, "mark") || r.effectiveTeam?.logoUrl || r.team?.logoUrl || null;

  // The badge in a podium tile's corner is a SQUARE logo, not the wide one: it
  // sits in a square, and the wide one would have to shrink to a thread to fit.
  // The site's own logo is the default and is usually right; a team can upload
  // a poster-only one for the case where theirs is dark on a black tile.
  // Loaded whichever design is showing, because switching between them must not
  // have to go back to the network.
  const badgeSrc = (r) => artOf(r, "badge") || r.effectiveTeam?.logoUrl || r.team?.logoUrl || null;

  const [logo, cars, flags, badges, marks, rowFlags] = await Promise.all([
    loadImage(logoSrc),
    Promise.all(top3.map((r) => loadImage(artOf(r, "car")))),
    Promise.all(top3.map((r) => loadImage(flagSrc(countryOf(r))))),
    Promise.all(top3.map((r) => loadImage(badgeSrc(r)))),
    Promise.all(rest.map((r) => loadImage(markSrc(r)))),
    // Loaded whichever design is showing, so switching between them never has
    // to go back to the network.
    Promise.all(rest.map((r) => loadImage(flagSrc(countryOf(r))))),
  ]);

  // A championship round is "Round 7". Everything else says what it is instead
  // of borrowing a number it does not have — and a special event is not a
  // practice session, which is what it used to be called up here.
  const kind = race.type || (race.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
  const roundLabel =
    kind === "CHAMPIONSHIP" && race.number != null
      ? `Round ${race.number}`
      : kind === "SPECIAL"
        ? "Special event"
        : "Training";

  const rows = rest.map((r, i) => ({
    position: r.position, name: r.name, points: r.points ?? 0, delta: deltaOf(r),
    mark: marks[i], flag: rowFlags[i], tier: tierOf(rest[i]),
  }));

  return {
    title: `${roundLabel} / ${race.track}`,
    // Which sheet this is, said on the sheets that need it. The first one is
    // the podium and the top of the classification, and captioning that "places
    // 1 to 10" tells a reader nothing they cannot see.
    subtitle: offset > 0 && shown.length ? `Places ${offset + 1} to ${offset + shown.length}` : null,
    logo,
    framing: cleanFraming(framing),
    // Only the sheets drawn as a table read this; the podium sheet works the
    // same question out for itself, from the same rows.
    showDelta: rows.some((r) => r.delta),
    podium: top3.map((r, i) => ({
      position: r.position, name: r.name, points: r.points ?? 0, delta: deltaOf(r),
      car: cars[i], flag: flags[i], badge: badges[i], tier: tierOf(top3[i]),
    })),
    rows,
  };
}
