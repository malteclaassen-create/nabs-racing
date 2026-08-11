// ---------------------------------------------------------------------------
// The shareable result graphic, drawn to a canvas.
//
// This is Steve's Photoshop layout rebuilt as code: pink page, round and track
// across the top, a podium of three car tiles with gold/silver/bronze name
// bars, then the rest of the top ten as rows of number, name, team mark and
// points. Everything on it already lives in the database after a result import,
// so the whole post is a button instead of an evening.
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

// Every measurement below is read off Steve's Photoshop file rather than
// guessed from a screenshot: the pink outlines were found by scanning the
// composite for their colour, which gives the tile edges, the row pitch and the
// line weight to the pixel. 1080x1350 is the file's own size, and it is the 4:5
// that Discord and Instagram show without shrinking.
export const LAYOUT = {
  width: 1080,
  height: 1350,

  pad: 25, // page margin left and right

  title: { y: 118, size: 66, gapToLogo: 24 },
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
    posSize: 62, // "1." "2." "3."
    posX: 24,
    posY: 68, // baseline, from the top of the tile
    nameSize: 40,
    flagW: 54,
    // The car is shown WHOLE, sitting low in the tile with the position number
    // in the empty black above it — not cropped to fill the tile. A cut-out is
    // a wide picture and the tile is a tall one, so filling it would zoom into
    // the middle of the car and cut off both ends.
    carCy: 0.62, // centre of the car, as a fraction of the tile's height
    carInset: 10,
    carMaxH: 0.52, // and of its height
    // The points, in a chip tucked into the tile's bottom right corner.
    chip: { h: 40, padX: 14, size: 26, inset: 0 },
  },

  // Places 4 down to whatever `rows` the caller asks for.
  rows: {
    top: 615,
    height: 80,
    gap: 25,
    numW: 85,
    numSize: 44,
    flagX: 118, // where the flag starts, from the page's left edge
    flagW: 50,
    nameX: 189,
    nameSize: 42,
    markCx: 652, // centre of the team mark
    markMaxW: 280,
    markMaxH: 56,
    ptsRight: 58, // from the right edge of the page
    ptsSize: 38,
  },

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
    cornerMark: false,
    watermark: { box: [241, 615, 1185, 855], alpha: 0.13, colour: "#ffffff" },
    tile: { fill: "#000000", frame: "#ffaec8", frameWidth: 5, badge: true },
    // Gold, silver and bronze land TWICE: on the position number and on the
    // name bar under the car.
    pos: { colour: "medal" },
    nameBar: { fill: "medal", ink: "#000000", frame: "#ffaec8" },
    // The points in a chip in the corner of the tile. Black on white was the
    // draft; the same black-and-white as the points down in the table means the
    // poster says "points" one way rather than two.
    tilePoints: { fill: "#000000", ink: "#ffffff" },
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
    tile: { fill: "#000000", frame: "medal", frameWidth: 3, badge: false },
    pos: { colour: "#ffffff" },
    nameBar: { fill: "medal", ink: "#0a0a0a", frame: null },
    tilePoints: null,
    row: {
      numFill: "#0a0a0a", numInk: "#ffffff",
      barFill: "#f2f2f2", barFrame: null, frameWidth: 0,
      nameInk: "#0a0a0a", ptsInk: "#0a0a0a",
      flags: false,
    },
    points: "pts",
  },
};

export const THEME_KEYS = Object.keys(THEMES);

// Archivo is the site's display face and is already self-hosted, so the poster
// is set in the same type as the site it comes from. The weights actually
// shipped are 500-900 (see public/fonts).
const FONT = (weight, size) => `${weight} ${size}px Archivo, Inter, system-ui, sans-serif`;

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
  if (r > 0) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
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
  const L = LAYOUT;
  const T = THEMES[themeKey] || THEMES.pink;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.textBaseline = "alphabetic";

  // --- page -----------------------------------------------------------------
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, L.width, L.height);

  // The mark, huge and barely there, behind the classification. A black page
  // has a lot of empty in it and this is what fills it without competing.
  if (T.watermark && data.logo) {
    const [bx, by, bw, bh] = T.watermark.box;
    ctx.save();
    // Clipped to the box the file gives it, so it can never creep up into the
    // gap between the podium and place four: above that line the page stays
    // clean black, and that is what keeps the podium a separate block. The clip
    // also swallows the part that runs off the page, which the file does too.
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.clip();
    ctx.globalAlpha = T.watermark.alpha;
    // Contained rather than stretched into the box: our mark is not cropped the
    // same way Steve's layer art is, and a texture at 13% is worth placing
    // correctly but never worth distorting.
    drawContain(ctx, tinted(data.logo, T.watermark.colour), bx + bw / 2, by + bh / 2, bw, bh);
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
      drawContain(ctx, entry.car, x + colW / 2, top + tileH * P.carCy, colW - P.carInset * 2, tileH * P.carMaxH);
    }
    if (T.tile.badge && entry.badge) {
      const b = L.tileBadge;
      drawContain(ctx, entry.badge, x + colW - b.inset - b.size / 2, top + b.inset + b.size / 2, b.size, b.size);
    }
    // Points, in a chip tucked into the bottom corner of the car half.
    if (T.tilePoints && entry.points != null) {
      const c = P.chip;
      ctx.font = FONT(900, c.size);
      const label = `+${entry.points}`;
      const w = ctx.measureText(label).width + c.padX * 2;
      const cx = x + colW - w;
      const cy = barTop - c.h;
      ctx.fillStyle = T.tilePoints.fill;
      box(ctx, cx, cy, w + r, c.h + r, r); // the far corners fall outside the clip
      ctx.fill();
      ctx.fillStyle = T.tilePoints.ink;
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
      const w = T.tile.frameWidth;
      ctx.strokeStyle = frame;
      ctx.lineWidth = w;
      if (T.nameBar.frame) {
        box(ctx, x + w / 2, top + w / 2, colW - w, bottom - top - w, r);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, barTop);
        ctx.lineTo(x + colW, barTop);
        ctx.stroke();
      } else {
        box(ctx, x + w / 2, top + w / 2, colW - w, tileH - w, r);
        ctx.stroke();
      }
    }

    // Position number, top left, over the picture.
    ctx.font = FONT(900, P.posSize);
    ctx.fillStyle = T.pos.colour === "medal" ? medal : T.pos.colour;
    ctx.textAlign = "left";
    ctx.fillText(`${place}.`, x + P.posX, top + P.posY);

    // Flag, then the name.
    const flagH = Math.round((P.flagW * 3) / 4);
    let nameX = x + 22;
    if (entry.flag) {
      ctx.drawImage(entry.flag, nameX, barTop + (P.barHeight - flagH) / 2, P.flagW, flagH);
      nameX += P.flagW + 12;
    }
    const nameSize = fitText(ctx, entry.name, x + colW - 18 - nameX, 900, P.nameSize, 20);
    ctx.font = FONT(900, nameSize);
    ctx.fillStyle = T.nameBar.ink;
    ctx.textAlign = "left";
    ctx.fillText(entry.name, nameX, barTop + P.barHeight / 2 + nameSize * 0.36);
  });

  // --- places 4 and down ----------------------------------------------------
  const R = L.rows;
  data.rows.forEach((row, i) => {
    const y = R.top + i * (R.height + R.gap);
    const barX = L.pad + R.numW;
    const barW = L.width - L.pad - barX;

    // One rounded row, clipped like the podium card so the number block takes
    // the left corners with it instead of sitting square inside them.
    const rowW = L.width - L.pad * 2;
    ctx.save();
    box(ctx, L.pad, y, rowW, R.height, T.radius);
    ctx.clip();
    ctx.fillStyle = T.row.barFill;
    ctx.fillRect(barX, y, barW, R.height);
    ctx.fillStyle = T.row.numFill;
    ctx.fillRect(L.pad, y, R.numW, R.height);
    ctx.restore();
    if (T.row.barFrame) {
      const w = T.row.frameWidth;
      ctx.strokeStyle = T.row.barFrame;
      ctx.lineWidth = w;
      box(ctx, L.pad + w / 2, y + w / 2, rowW - w, R.height - w, T.radius);
      ctx.stroke();
    }
    const midY = y + R.height / 2;
    ctx.font = FONT(900, R.numSize);
    ctx.fillStyle = T.row.numInk;
    ctx.textAlign = "center";
    ctx.fillText(`${row.position}.`, L.pad + R.numW / 2, midY + R.numSize * 0.36);

    // Points. "+20" on one line, or the number over the word PTS.
    const ptsX = L.width - L.pad - R.ptsRight;
    ctx.fillStyle = T.row.ptsInk;
    ctx.textAlign = "right";
    if (T.points === "plus") {
      ctx.font = FONT(900, R.ptsSize);
      ctx.fillText(`+${row.points}`, ptsX, midY + R.ptsSize * 0.36);
    } else {
      ctx.font = FONT(900, R.ptsSize);
      ctx.fillText(String(row.points), ptsX, midY - 2);
      ctx.font = FONT(800, R.ptsSize * 0.8);
      ctx.fillText("PTS", ptsX, midY + R.ptsSize * 0.9);
    }

    // Flag, then the name. The flag only appears where the design has one; the
    // name starts at the same x either way, so the column of names lines up
    // whether or not a driver has a country on file.
    if (T.row.flags && row.flag) {
      const fh = Math.round((R.flagW * 3) / 4);
      ctx.drawImage(row.flag, R.flagX, y + (R.height - fh) / 2, R.flagW, fh);
    }
    const nameX = R.nameX;
    const markLeft = R.markCx - R.markMaxW / 2;
    const nameSize = fitText(ctx, row.name, Math.max(120, markLeft - 24 - nameX), 900, R.nameSize, 22);
    ctx.font = FONT(900, nameSize);
    ctx.fillStyle = T.row.nameInk;
    ctx.textAlign = "left";
    ctx.fillText(row.name, nameX, midY + nameSize * 0.36);

    // Team mark, centred in its own column so the marks line up down the page
    // however wide each one is.
    if (row.mark) drawContain(ctx, row.mark, R.markCx, y + R.height / 2, R.markMaxW, R.markMaxH);
  });

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
  await document.fonts.ready; // a canvas takes whatever the font stack resolves to NOW
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

// Turn one race (as /api/races/:id/results hands it over) into the shape above,
// with every picture already loaded. `teamArt` is the admin's uploaded cars and
// wordmarks, keyed by team id; `countryOf` resolves a driver's flag the same
// way the rest of the site does.
export async function loadGraphicAssets({ race, results, teamArt = {}, countryOf, logoSrc, rows = 7 }) {
  // w80, the largest in the mirror: the poster draws a flag at 46px and the
  // export doubles that, so the 40px file the site uses would show its pixels.
  const flagSrc = (code) => (code ? `/flags/w80/${String(code).toLowerCase()}.png` : null);

  const classified = results
    .filter((r) => r.position != null && (!r.status || r.status === "FINISHED"))
    .sort((a, b) => a.position - b.position);

  const top3 = classified.slice(0, 3);
  const rest = classified.slice(3, 3 + rows);

  const artOf = (r, kind) => teamArt[r.effectiveTeam?.id || r.team?.id]?.[kind] || null;
  // No wordmark uploaded? The site's own square logo stands in.
  const markSrc = (r) => artOf(r, "mark") || r.effectiveTeam?.logoUrl || r.team?.logoUrl || null;

  // The badge in a podium tile's corner is the SQUARE team logo, not the wide
  // one: it sits in a square, and the wide one would have to shrink to a
  // thread to fit. Loaded whichever design is showing, because switching
  // between them must not have to go back to the network.
  const badgeSrc = (r) => r.effectiveTeam?.logoUrl || r.team?.logoUrl || null;

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

  const roundLabel =
    (race.type || "CHAMPIONSHIP") === "CHAMPIONSHIP" && race.number != null ? `Round ${race.number}` : "Training";

  return {
    title: `${roundLabel} / ${race.track}`,
    logo,
    podium: top3.map((r, i) => ({
      position: r.position, name: r.name, points: r.points ?? 0,
      car: cars[i], flag: flags[i], badge: badges[i],
    })),
    rows: rest.map((r, i) => ({
      position: r.position, name: r.name, points: r.points ?? 0,
      mark: marks[i], flag: rowFlags[i],
    })),
  };
}
