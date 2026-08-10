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

export const LAYOUT = {
  width: 1150,
  height: 1500,

  // The pink of the design. Not the site's --c-brand: that one is a per-series
  // accent an admin can change, and this poster should not turn blue because
  // somebody recoloured the GT series.
  bg: "#f7c2ce",
  ink: "#0a0a0a",
  rowFill: "#f2f2f2",

  pad: 10, // page margin left and right

  title: { y: 118, size: 66, gapToLogo: 24 },
  logo: { size: 82, right: 26, top: 18 },

  // The podium. `lift` is how much higher a tile sits than the lowest one, so
  // the three of them read as a podium rather than as three equal boxes.
  podium: {
    top: 175,
    gap: 8,
    barHeight: 74,
    bottom: 712,
    lift: { 1: 40, 2: 12, 3: 0 },
    // Bar colours, and the frame around each tile.
    medal: {
      1: { bar: "#e3b23c", frame: "#e3b23c" },
      2: { bar: "#c9c9c9", frame: "#e8e8e8" },
      3: { bar: "#c98f5c", frame: "#c98f5c" },
    },
    posSize: 76, // "1." "2." "3."
    nameSize: 38,
    flagW: 46,
    // The car is shown WHOLE, sitting low in the tile with the position number
    // in the empty black above it — not cropped to fill the tile. A cut-out is
    // a wide picture and the tile is a tall one, so filling it would zoom into
    // the middle of the car and cut off both ends.
    carCy: 0.65, // centre of the car, as a fraction of the tile's height
    carInset: 12,
    carMaxH: 0.5, // and of its height
  },

  // Places 4 down to whatever `rows` the caller asks for.
  rows: {
    top: 735,
    height: 95,
    gap: 12,
    numW: 128,
    numSize: 54,
    nameSize: 50,
    nameX: 190, // from the page's left margin, i.e. just inside the light bar
    markCx: 700, // centre of the team mark
    // Room enough for a wide wordmark AND for a square badge to come out at a
    // useful size: a logo boxed to the wordmark's height is a stamp in the
    // middle of a 95px row.
    markMaxW: 300,
    markMaxH: 66,
    ptsRight: 46, // from the right edge of the bar
    ptsSize: 34,
  },
};

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

// `data`:  { title, logo, podium: [{position,name,flag,car,frameColor}],
//            rows: [{position,name,mark,points}] }
// Images in `data` are already-loaded HTMLImageElements (or null) — see
// loadGraphicAssets below, which is what turns a race into this shape.
export function drawResultGraphic(ctx, data, scale = 1) {
  const L = LAYOUT;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.textBaseline = "alphabetic";

  // --- page -----------------------------------------------------------------
  ctx.fillStyle = L.bg;
  ctx.fillRect(0, 0, L.width, L.height);

  // --- league mark, top right ----------------------------------------------
  const logoBox = L.width - L.logo.right - L.logo.size;
  if (data.logo) drawContain(ctx, data.logo, logoBox + L.logo.size / 2, L.logo.top + L.logo.size / 2, L.logo.size, L.logo.size);

  // --- "Round 1 / Hockenheim" ----------------------------------------------
  // Centred on the PAGE. The mark in the corner only caps how wide the title
  // may get: it shrinks before it reaches the mark rather than sliding left out
  // of the middle to make room, because a heading that is nearly centred reads
  // as a mistake, and a slightly smaller one does not.
  const titleCx = L.width / 2;
  const titleMaxW = Math.max(200, (logoBox - L.title.gapToLogo - titleCx) * 2);
  const titleSize = fitText(ctx, data.title, titleMaxW, 900, L.title.size, 30);
  ctx.font = FONT(900, titleSize);
  ctx.fillStyle = L.ink;
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
    const medal = P.medal[place];

    // The tile: a black card the car sits in, framed in the medal colour.
    ctx.fillStyle = "#000000";
    const tileH = barTop - top;
    ctx.fillRect(x, top, colW, tileH);
    if (entry.car) {
      drawContain(
        ctx,
        entry.car,
        x + colW / 2,
        top + tileH * P.carCy,
        colW - P.carInset * 2,
        tileH * P.carMaxH
      );
    }
    ctx.strokeStyle = medal.frame;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, top + 1.5, colW - 3, barTop - top - 3);

    // Position number, top left, over the picture.
    ctx.font = FONT(900, P.posSize);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.fillText(`${place}.`, x + 24, top + P.posSize + 12);

    // Name bar: flag, then the name, on the medal colour.
    ctx.fillStyle = medal.bar;
    ctx.fillRect(x, barTop, colW, P.barHeight);
    const flagH = Math.round((P.flagW * 3) / 4);
    let nameX = x + 22;
    if (entry.flag) {
      ctx.drawImage(entry.flag, nameX, barTop + (P.barHeight - flagH) / 2, P.flagW, flagH);
      nameX += P.flagW + 14;
    }
    const nameSize = fitText(ctx, entry.name, x + colW - 18 - nameX, 900, P.nameSize, 20);
    ctx.font = FONT(900, nameSize);
    ctx.fillStyle = L.ink;
    ctx.textAlign = "left";
    ctx.fillText(entry.name, nameX, barTop + P.barHeight / 2 + nameSize * 0.36);
  });

  // --- places 4 and down ----------------------------------------------------
  const R = L.rows;
  data.rows.forEach((row, i) => {
    const y = R.top + i * (R.height + R.gap);
    const barX = L.pad + R.numW;
    const barW = L.width - L.pad - barX;

    // Number, reversed out of a black block.
    ctx.fillStyle = L.ink;
    ctx.fillRect(L.pad, y, R.numW, R.height);
    ctx.font = FONT(900, R.numSize);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(String(row.position), L.pad + R.numW / 2, y + R.height / 2 + R.numSize * 0.36);

    // The light bar the rest of the row sits on.
    ctx.fillStyle = L.rowFill;
    ctx.fillRect(barX, y, barW, R.height);

    // Points, right-aligned, number over the word.
    const ptsX = L.width - L.pad - R.ptsRight;
    ctx.fillStyle = L.ink;
    ctx.textAlign = "right";
    ctx.font = FONT(900, R.ptsSize);
    ctx.fillText(String(row.points), ptsX, y + R.height / 2 - 2);
    ctx.font = FONT(800, R.ptsSize * 0.8);
    ctx.fillText("PTS", ptsX, y + R.height / 2 + R.ptsSize * 0.9);

    // Name. Its room stops 24px short of where the team mark begins, so a long
    // name shrinks instead of running under the logo.
    const nameX = L.pad + R.nameX;
    const markLeft = L.pad + R.markCx - R.markMaxW / 2;
    const nameSize = fitText(ctx, row.name, Math.max(120, markLeft - 24 - nameX), 900, R.nameSize, 22);
    ctx.font = FONT(900, nameSize);
    ctx.textAlign = "left";
    ctx.fillText(row.name, nameX, y + R.height / 2 + nameSize * 0.36);

    // Team mark, centred in its own column so the marks line up down the page
    // however wide each one is.
    if (row.mark) drawContain(ctx, row.mark, L.pad + R.markCx, y + R.height / 2, R.markMaxW, R.markMaxH);
  });

  ctx.restore();
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

  const [logo, cars, flags, marks] = await Promise.all([
    loadImage(logoSrc),
    Promise.all(top3.map((r) => loadImage(artOf(r, "car")))),
    Promise.all(top3.map((r) => loadImage(flagSrc(countryOf(r))))),
    Promise.all(rest.map((r) => loadImage(markSrc(r)))),
  ]);

  const roundLabel =
    (race.type || "CHAMPIONSHIP") === "CHAMPIONSHIP" && race.number != null ? `Round ${race.number}` : "Training";

  return {
    title: `${roundLabel} / ${race.track}`,
    logo,
    podium: top3.map((r, i) => ({ position: r.position, name: r.name, car: cars[i], flag: flags[i] })),
    rows: rest.map((r, i) => ({ position: r.position, name: r.name, mark: marks[i], points: r.points ?? 0 })),
  };
}
