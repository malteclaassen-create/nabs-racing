// ---------------------------------------------------------------------------
// Drawing the link-preview pictures (lib/sharePictures.js decides what goes
// on them). Every page's picture is the Home page's hero card at link-preview
// size: the rounded card over the page colour, a photo under the site's two
// scrims and the hatching at the right edge, the brand and season along the
// top, and at the bottom an eyebrow, a big title, a mono line and either
// cards in the hero's podium style or a row of facts.
//
// The colours, fonts and shapes are the dark theme's (frontend/src/index.css,
// tailwind.config.js, pages/Home.jsx). Change them there, change them here.
// ---------------------------------------------------------------------------
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { UPLOADS_DIR } from "./dataDirs.js";

const W = 1200;
const H = 630;
// Bump when the drawing itself changes, so every version string changes with
// it and Discord fetches the new look instead of the cached old one.
export const DRAWING_REV = 4;

// The drawing library is a native module, loaded on first use: should it ever
// fail to load on a host, only the drawn pictures are lost (the pages fall
// back to the uploaded or shipped one), not the whole server at start-up.
let canvasLib = null;
const canvasModule = async () => (canvasLib ||= await import("@napi-rs/canvas"));

const __dir = dirname(fileURLToPath(import.meta.url));
// The built site first (what production serves), then the source folder (a
// dev checkout that has never run the build).
const STATIC_DIRS = [join(__dir, "../../../frontend/dist"), join(__dir, "../../../frontend/public")];

export function staticFile(urlPath) {
  const rel = normalize(String(urlPath).split("?")[0]).replace(/^[\\/]+/, "");
  if (!rel || rel.startsWith("..")) return null;
  for (const dir of STATIC_DIRS) {
    const p = join(dir, rel);
    if (p.startsWith(dir + sep) && existsSync(p)) return p;
  }
  return null;
}

function uploadFile(urlPath) {
  const rel = normalize(String(urlPath).split("?")[0].replace(/^\/api\/uploads\//, ""));
  if (!rel || rel.startsWith("..")) return null;
  const p = join(UPLOADS_DIR, rel);
  return p.startsWith(UPLOADS_DIR + sep) && existsSync(p) ? p : null;
}

// A site address ("/api/uploads/…" or a static "/heroes/s8.jpg") as a picture,
// or null. Only files on this machine: the picture is drawn on request, and a
// stored address must not be able to make the server call anywhere it likes.
async function loadLocal(url) {
  if (typeof url !== "string" || !url.startsWith("/")) return null;
  const file = url.startsWith("/api/uploads/") ? uploadFile(url) : staticFile(url);
  if (!file) return null;
  try {
    const { loadImage } = await canvasModule();
    return await loadImage(readFileSync(file));
  } catch {
    return null;
  }
}

// The site's own faces (frontend/public/fonts), the latin-ext cut behind each
// so a driver called Ondřej keeps his ř. They are variable fonts: one file
// per family holds every weight, and the weight is picked with the wght axis
// (setFont below). A weight in the font string alone is ignored, and the text
// came out at the file's default weight.
const FACES = { Display: "archivo-900", Body: "inter-400", Mono: "jetbrains-mono-500" };
let fontsReady = false;
function registerFonts(GlobalFonts) {
  if (fontsReady) return;
  for (const [name, file] of Object.entries(FACES)) {
    for (const [cut, suffix] of [["latin", ""], ["latin-ext", "Ext"]]) {
      const p = staticFile(`fonts/${file}-${cut}.woff2`);
      if (p) GlobalFonts.registerFromPath(p, `Og${name}${suffix}`);
    }
  }
  fontsReady = true;
}
function setFont(ctx, face, weight, size, tracking = 0) {
  ctx.font = `${size}px Og${face}, Og${face}Ext`;
  ctx.fontVariationSettings = `"wght" ${weight}`;
  ctx.letterSpacing = `${tracking}px`;
}

// The dark theme's tokens.
const PAGE_BG = "#080d18";
const INK = [15, 23, 42];
const ink = (a) => `rgba(${INK[0]}, ${INK[1]}, ${INK[2]}, ${a})`;
const white = (a) => `rgba(255, 255, 255, ${a})`;
const MEDAL = ["#eab308", "#94a3b8", "#c2410c"];
const LIVE_RED = "#ef4444";

function cover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// Text in a box no wider than `width`: the largest size down to `min`, and
// past that cut with an ellipsis, like the site's `truncate`.
function fitText(ctx, text, face, weight, max, min, width, tracking = 0) {
  for (let size = max; size > min; size -= 1) {
    setFont(ctx, face, weight, size, tracking);
    if (ctx.measureText(text).width <= width) return text;
  }
  setFont(ctx, face, weight, min, tracking);
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return t === text ? t : `${t}…`;
}

function drawFlag(ctx, img, x, y, h, r = 3) {
  const w = (img.width / img.height) * h;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
  return w;
}

// Lucide's arrow-right, as lines: the site fonts carry no arrow character.
function drawArrow(ctx, x, midY, size, color) {
  const s = size / 24;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * s * 1.1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x + 5 * s, midY);
  ctx.lineTo(x + 19 * s, midY);
  ctx.moveTo(x + 12 * s, midY - 7 * s);
  ctx.lineTo(x + 19 * s, midY);
  ctx.lineTo(x + 12 * s, midY + 7 * s);
  ctx.stroke();
  ctx.restore();
  return size;
}

function drawLogo(ctx, img, x, y, s) {
  const k = Math.min(s / img.width, s / img.height);
  ctx.drawImage(img, x + (s - img.width * k) / 2, y + (s - img.height * k) / 2, img.width * k, img.height * k);
}

// ---------------------------------------------------------------------------

async function drawCard(ctx, card, img, box, accent) {
  const { x: cx, y: cy, w: cw, h: ch } = box;
  const bar = card.medal != null ? MEDAL[card.medal] || MEDAL[2] : card.bar || accent;

  // The card: glass fill, the medal (or team, or accent) tint bleeding in
  // from the bar on the left, a hairline border.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(cx, cy, cw, ch, 18);
  ctx.clip();
  ctx.fillStyle = white(0.07);
  ctx.fillRect(cx, cy, cw, ch);
  const tint = ctx.createLinearGradient(cx, 0, cx + cw * 0.55, 0);
  tint.addColorStop(0, `${bar}26`);
  tint.addColorStop(1, `${bar}00`);
  ctx.fillStyle = tint;
  ctx.fillRect(cx, cy, cw, ch);
  ctx.fillStyle = bar;
  ctx.fillRect(cx, cy, 6, ch);
  ctx.restore();
  ctx.strokeStyle = white(0.1);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(cx + 0.75, cy + 0.75, cw - 1.5, ch - 1.5, 17);
  ctx.stroke();

  const mid = cy + ch / 2;
  let textX = cx + 24;
  if (card.tag) {
    const big = /^P\d/.test(card.tag);
    // A position wears its medal colour; anything else (a round, "R7") stays
    // neutral, since a team colour can be too dark to read on the card.
    ctx.fillStyle = big ? bar : white(0.7);
    if (big) setFont(ctx, "Display", 900, 36);
    else setFont(ctx, "Mono", 700, 20, 1);
    ctx.fillText(card.tag, textX, mid + (big ? 13 : 7));
    textX += Math.max(ctx.measureText(card.tag).width, big ? 46 : 0) + 16;
  }

  // The value on the right first, so the text knows how much room is left.
  let right = cx + cw - 22;
  if (card.value != null) {
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    setFont(ctx, "Display", 900, 30);
    const vw = ctx.measureText(card.value).width;
    ctx.fillText(card.value, right, mid + 4);
    let uw = 0;
    if (card.unit) {
      ctx.fillStyle = white(0.5);
      setFont(ctx, "Mono", 700, 11, 2.2);
      uw = ctx.measureText(card.unit).width;
      ctx.fillText(card.unit, right + 2, mid + 24);
    }
    ctx.textAlign = "left";
    right -= Math.max(vw, uw, 34) + 22;
  }
  const room = right - textX;

  // Two lines (title over sub), or three with a kicker on top.
  const lines = card.kicker
    ? { kicker: cy + 28, title: cy + 57, sub: cy + 80 }
    : { title: mid - 5, sub: mid + 26 };
  if (card.kicker) {
    ctx.fillStyle = white(0.55);
    ctx.fillText(fitText(ctx, card.kicker, "Mono", 700, 13, 10, room, 1.6), textX, lines.kicker);
  }
  ctx.fillStyle = "#ffffff";
  const titleSize = card.kicker ? 23 : 25;
  const title = fitText(ctx, card.title, "Body", 700, titleSize, 16, room - (img.flag ? 36 : 0));
  ctx.fillText(title, textX, lines.title);
  if (img.flag) drawFlag(ctx, img.flag, textX + ctx.measureText(title).width + 9, lines.title - 17, 16, 2);

  let subX = textX;
  const subMid = lines.sub - 6;
  if (img.logo) {
    drawLogo(ctx, img.logo, subX, subMid - 11, 22);
    subX += 30;
  } else if (card.dot && card.sub) {
    ctx.fillStyle = card.dot;
    ctx.beginPath();
    ctx.arc(subX + 6, subMid, 6, 0, Math.PI * 2);
    ctx.fill();
    subX += 20;
  }
  ctx.fillStyle = white(0.6);
  if (Array.isArray(card.sub)) {
    for (const part of card.sub) {
      if (part?.arrow) {
        subX += drawArrow(ctx, subX + 2, subMid, 18, white(0.6)) + 6;
      } else {
        const t = fitText(ctx, String(part), "Body", 400, 18, 13, Math.max(right - subX, 20));
        ctx.fillText(t, subX, lines.sub);
        subX += ctx.measureText(t).width + 2;
      }
    }
  } else if (card.sub) {
    ctx.fillText(fitText(ctx, card.sub, "Body", 400, 18, 13, right - subX), subX, lines.sub);
  }
}

const renderCache = new Map(); // path|version -> jpeg

export async function renderSharePicture(state) {
  const key = `${state.path}|${state.query?.race || ""}|${state.query?.season || ""}|${state.version}`;
  if (renderCache.has(key)) return renderCache.get(key);
  const { createCanvas, GlobalFonts } = await canvasModule();
  registerFonts(GlobalFonts);

  const cards = state.cards || [];
  const flagOf = (cc) => (cc ? loadLocal(`/flags/w80/${cc}.png`) : null);
  const [bg, mark, flag, cardImgs] = await Promise.all([
    loadLocal(state.background).then((i) => i || loadLocal("/hero.jpg")),
    loadLocal(state.series.logoDarkUrl || "/logo-dark.png"),
    flagOf(state.flag),
    Promise.all(cards.map(async (c) => ({ flag: await flagOf(c.flag), logo: await loadLocal(c.logo) }))),
  ]);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const accent = state.series.accent;
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = PAGE_BG;
  ctx.fillRect(0, 0, W, H);

  // The hero card: rounded, the photo filling it, the site's two scrims over
  // it (bottom-left to top-right, then up from the bottom), and the hatching
  // fading in at the right edge.
  const C = { x: 24, y: 24, w: W - 48, h: H - 48, r: 36 };
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(C.x, C.y, C.w, C.h, C.r);
  ctx.clip();
  ctx.fillStyle = `rgb(${INK.join(",")})`;
  ctx.fillRect(C.x, C.y, C.w, C.h);
  if (bg) cover(ctx, bg, C.x, C.y, C.w, C.h);
  const tr = ctx.createLinearGradient(C.x, C.y + C.h, C.x + C.w, C.y);
  tr.addColorStop(0, ink(1));
  tr.addColorStop(0.5, ink(0.75));
  tr.addColorStop(1, ink(0));
  ctx.fillStyle = tr;
  ctx.fillRect(C.x, C.y, C.w, C.h);
  const up = ctx.createLinearGradient(0, C.y + C.h, 0, C.y);
  up.addColorStop(0, ink(0.95));
  up.addColorStop(0.5, ink(0));
  ctx.fillStyle = up;
  ctx.fillRect(C.x, C.y, C.w, C.h);

  const hatchW = Math.round(C.w * 0.18);
  const hatch = createCanvas(hatchW, C.h);
  const hc = hatch.getContext("2d");
  hc.strokeStyle = white(0.06);
  hc.lineWidth = 3;
  for (let i = -C.h; i < hatchW + C.h; i += 16) {
    hc.beginPath();
    hc.moveTo(i, 0);
    hc.lineTo(i + C.h, C.h);
    hc.stroke();
  }
  const fade = hc.createLinearGradient(hatchW, 0, 0, 0);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(0.35, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  hc.globalCompositeOperation = "destination-in";
  hc.fillStyle = fade;
  hc.fillRect(0, 0, hatchW, C.h);
  ctx.drawImage(hatch, C.x + C.w - hatchW, C.y);
  ctx.restore();
  ctx.strokeStyle = white(0.1);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(C.x + 1, C.y + 1, C.w - 2, C.h - 2, C.r - 1);
  ctx.stroke();

  const L = C.x + 56;
  const R = C.x + C.w - 56;

  // Top: the brand as the nav bar has it (mark, name, series under it), and
  // the season as the pill the site puts above the hero.
  const MARK = 52;
  const markY = C.y + 44;
  if (mark) {
    if (state.series.logoDarkUrl) {
      ctx.drawImage(mark, L, markY, MARK, MARK);
    } else {
      const off = createCanvas(MARK, MARK);
      const o = off.getContext("2d");
      o.drawImage(mark, 0, 0, MARK, MARK);
      o.globalCompositeOperation = "source-in";
      o.fillStyle = accent;
      o.fillRect(0, 0, MARK, MARK);
      ctx.drawImage(off, L, markY);
    }
  }
  ctx.fillStyle = "#ffffff";
  setFont(ctx, "Display", 800, 25);
  ctx.fillText("NABS Racing League", L + MARK + 16, markY + 24);
  ctx.fillStyle = white(0.55);
  setFont(ctx, "Mono", 700, 14, 1.5);
  ctx.fillText(state.series.name.toUpperCase(), L + MARK + 17, markY + 46);

  if (state.pill) {
    const label = state.pill.toUpperCase();
    setFont(ctx, "Mono", 700, 16, 2.5);
    const pw = ctx.measureText(label).width + 64;
    const ph = 40;
    const px = R - pw;
    const py = markY + 6;
    ctx.fillStyle = ink(0.6);
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, ph / 2);
    ctx.fill();
    ctx.strokeStyle = white(0.15);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = state.live ? LIVE_RED : accent;
    ctx.beginPath();
    ctx.arc(px + 24, py + ph / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, px + 40, py + ph / 2 + 6);
  }

  // The bottom block, laid out upwards from the bottom edge: the cards or the
  // facts row, then the mono line, the title, the eyebrow.
  const bottom = C.y + C.h - 48;
  const footH = cards.length ? 92 : state.button || state.facts?.length ? 52 : 0;
  const footTop = bottom - footH;
  const subY = footH ? footTop - 42 : bottom - 4;
  const titleY = state.sub ? subY - 44 : subY;
  const eyebrowY = titleY - 96;

  // Eyebrow: flag (or the live dot), the accent words, a short rule, the rest.
  let x = L;
  if (state.live) {
    ctx.fillStyle = LIVE_RED;
    ctx.beginPath();
    ctx.arc(x + 7, eyebrowY - 7, 7, 0, Math.PI * 2);
    ctx.fill();
    x += 26;
  }
  if (flag) x += drawFlag(ctx, flag, x, eyebrowY - 21, 26) + 16;
  const [lead, rest] = state.eyebrow || [];
  setFont(ctx, "Mono", 700, 19, 3.8);
  if (lead) {
    ctx.fillStyle = accent;
    ctx.fillText(lead, x, eyebrowY);
    x += ctx.measureText(lead).width + 14;
  }
  if (rest) {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x, eyebrowY - 7, 44, 2);
    ctx.globalAlpha = 1;
    x += 44 + 18;
    ctx.fillStyle = white(0.7);
    ctx.fillText(rest, x, eyebrowY);
  }

  // The title, big, then the mono line.
  ctx.fillStyle = "#ffffff";
  const title = fitText(ctx, String(state.title || "").toUpperCase(), "Display", 900, 104, 56, R - L, -2.5);
  ctx.fillText(title, L - 3, titleY);
  if (state.sub) {
    ctx.fillStyle = white(0.65);
    ctx.fillText(fitText(ctx, state.sub, "Mono", 500, 20, 14, R - L, 1), L, subY);
  }

  if (cards.length) {
    const gap = 14;
    const n = cards.length;
    // One or two cards keep a podium card's width rather than stretching.
    const cw = (R - L - gap * 2) / 3;
    for (let i = 0; i < n; i++) {
      await drawCard(ctx, cards[i], cardImgs[i], { x: L + i * (cw + gap), y: footTop, w: cw, h: footH }, accent);
    }
  } else if (footH) {
    // The facts row: the site's pink button where there is something to do,
    // then the facts in the mono line.
    let fx = L;
    if (state.button) {
      setFont(ctx, "Body", 700, 18, 1);
      const label = state.button.toUpperCase();
      const bw = ctx.measureText(label).width + 40 + 30;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(fx, footTop, bw, footH, 14);
      ctx.fill();
      ctx.fillStyle = `rgb(${INK.join(",")})`;
      ctx.fillText(label, fx + 20, footTop + footH / 2 + 7);
      drawArrow(ctx, fx + bw - 20 - 22, footTop + footH / 2, 22, `rgb(${INK.join(",")})`);
      fx += bw + 24;
    }
    if (state.facts?.length) {
      ctx.fillStyle = white(0.8);
      ctx.fillText(fitText(ctx, state.facts.join("  ·  "), "Mono", 700, 18, 13, R - fx, 1.5), fx, footTop + footH / 2 + 7);
    }
  }

  const jpeg = await canvas.encode("jpeg", 90);
  renderCache.set(key, jpeg);
  if (renderCache.size > 40) renderCache.delete(renderCache.keys().next().value);
  return jpeg;
}
