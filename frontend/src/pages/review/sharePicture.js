// The season story's share picture: the last slide's card drawn at
// 1080x1350 (4:5, whole in a Discord embed and an Instagram post), in the
// site's fonts and the viewer's own theme colours, from the same slide data
// the card on screen shows (review/storySlides.mjs). Drawn in the browser:
// nothing is uploaded. On a phone it goes to the share sheet, elsewhere it
// is downloaded.
//
// Plain on purpose, like the page: one card, hairlines, the team colour as
// the one accent, the season's real circuit outline of the best round.
import { circuitFor } from "../../data/circuits.js";
import { summaryGrid } from "./storySlides.mjs";
import { livery } from "./livery.js";

const W = 1080;
const H = 1350;
const M = 76;

async function fontsReady() {
  if (!document.fonts?.load) return;
  await Promise.all([
    document.fonts.load('900 200px "Big Shoulders Display"'),
    document.fonts.load('700 26px "Saira Condensed"'),
    document.fonts.load('500 26px "Saira Condensed"'),
  ]).catch(() => {});
}

const DISPLAY = '"Big Shoulders Display", "Archivo", sans-serif';
const LABEL = '"Saira Condensed", "Inter", sans-serif';
const font = (weight, size, family) => `${weight} ${size}px ${family}`;

// The largest size up to `max` at which `text` fits `width`.
function fit(ctx, text, width, max, weight, family) {
  let size = max;
  ctx.font = font(weight, size, family);
  while (size > 24 && ctx.measureText(text).width > width) {
    size -= 2;
    ctx.font = font(weight, size, family);
  }
  return size;
}

function spaced(ctx, text, x, y, tracking, align = "left") {
  const chars = [...text];
  const width = chars.reduce((w, ch) => w + ctx.measureText(ch).width + tracking, -tracking);
  let at = align === "right" ? x - width : x;
  for (const ch of chars) {
    ctx.fillText(ch, at, y);
    at += ctx.measureText(ch).width + tracking;
  }
}

// The circuit's outline from the site's own data, fitted into the box.
function outline(ctx, track, x, y, w, h, color) {
  const c = circuitFor(track);
  if (!c?.path || typeof Path2D === "undefined") return false;
  const [bx, by, bw, bh] = String(c.box || "0 0 100 100").split(/\s+/).map(Number);
  const s = Math.min(w / bw, h / bh);
  ctx.save();
  ctx.translate(x + (w - bw * s) / 2 - bx * s, y + (h - bh * s) / 2 - by * s);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = 5 / s;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(new Path2D(c.path));
  ctx.restore();
  return true;
}

// A fine grain over the paint, as on the story's slides.
function grain(ctx, alpha) {
  const g = document.createElement("canvas");
  g.width = 180;
  g.height = 180;
  const gx = g.getContext("2d");
  const img = gx.createImageData(180, 180);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  gx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(g, "repeat");
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

export async function drawSharePicture(review, slide) {
  await fontsReady();
  const paint = livery(review.driver.team?.color).grounds.team;
  const ink = paint.fg;
  const mute = paint.mute;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = paint.bg;
  ctx.fillRect(0, 0, W, H);
  grain(ctx, 0.12);
  const R = W - M;

  // The label on its rule.
  ctx.fillStyle = ink;
  ctx.font = font(700, 26, LABEL);
  spaced(ctx, "SEASON REVIEW", M, 104, 2);
  ctx.fillStyle = mute;
  spaced(ctx, slide.eyebrow.toUpperCase(), R, 104, 2, "right");
  ctx.fillStyle = ink;
  ctx.fillRect(M, 122, R - M, 6);

  // The name, a word a line, as big as the width takes.
  let y = 150;
  const words = String(review.driver.name || "").toUpperCase().split(/\s+/).filter(Boolean).slice(0, 3);
  for (const w of words) {
    const size = fit(ctx, w, R - M, 250, 900, DISPLAY);
    ctx.fillStyle = ink;
    ctx.font = font(900, size, DISPLAY);
    ctx.fillText(w, M - size * 0.02, y + size * 0.8);
    y += size * 0.84;
  }
  if (review.driver.team?.name) {
    ctx.fillStyle = ink;
    ctx.font = font(700, 30, LABEL);
    spaced(ctx, review.driver.team.name.toUpperCase(), M, y + 44, 2);
    y += 44;
  }

  // The place and the points.
  y += 34;
  ctx.fillStyle = ink;
  ctx.fillRect(M, y, R - M, 6);
  const c = review.championship;
  if (c.position) {
    ctx.font = font(900, 330, DISPLAY);
    ctx.fillText(`P${c.position}`, M - 8, y + 300);
  }
  ctx.textAlign = "right";
  ctx.font = font(900, 150, DISPLAY);
  ctx.fillText(String(slide.points), R, y + 170);
  ctx.textAlign = "left";
  ctx.font = font(700, 28, LABEL);
  spaced(ctx, "POINTS", R, y + 210, 2, "right");
  ctx.fillStyle = mute;
  ctx.font = font(500, 26, LABEL);
  if (slide.unit) spaced(ctx, slide.unit, R, y + 250, 0.5, "right");

  // Six numbers under a rule, hairlines between.
  y += 330;
  ctx.fillStyle = ink;
  ctx.fillRect(M, y, R - M, 6);
  const grid = review.best ? summaryGrid(review, undefined, { skip: ["best"] }) : slide.grid;
  const cw = (R - M) / 3;
  const ch = 150;
  ctx.globalAlpha = 0.45;
  ctx.fillRect(M, y + ch + 6, R - M, 2);
  ctx.fillRect(M + cw - 14, y + 18, 2, ch * 2 - 20);
  ctx.fillRect(M + 2 * cw - 14, y + 18, 2, ch * 2 - 20);
  ctx.globalAlpha = 1;
  grid.forEach((g, k) => {
    const cx = M + (k % 3) * cw + (k % 3 ? 6 : 0);
    const cy = y + 6 + Math.floor(k / 3) * ch;
    ctx.fillStyle = mute;
    ctx.font = font(700, 22, LABEL);
    spaced(ctx, g.label.toUpperCase().slice(0, 16), cx, cy + 44, 1.5);
    ctx.fillStyle = ink;
    ctx.font = font(900, 92, DISPLAY);
    ctx.fillText(g.value, cx - 2, cy + 122);
    if (g.sub) {
      ctx.fillStyle = mute;
      ctx.font = font(700, 20, LABEL);
      spaced(ctx, g.sub.toUpperCase().slice(0, 18), cx, cy + 146, 1.2);
    }
  });

  // The best result, with its circuit.
  y += ch * 2 + 34;
  const best = review.best;
  if (best && y + 150 < H - 90) {
    const drew = outline(ctx, best.track, M, y, 150, 140, ink);
    const tx = drew ? M + 186 : M;
    ctx.fillStyle = mute;
    ctx.font = font(700, 22, LABEL);
    spaced(ctx, "BEST RESULT", tx, y + 32, 1.5);
    ctx.fillStyle = ink;
    ctx.font = font(900, 84, DISPLAY);
    ctx.fillText(`P${best.position} ${String(best.track).toUpperCase()}`, tx, y + 104);
    ctx.fillStyle = mute;
    ctx.font = font(700, 24, LABEL);
    spaced(ctx, `ROUND ${best.round}${best.grid > 0 ? `, FROM P${best.grid}` : ""}`, tx, y + 138, 1.5);
  }

  // The league and the address at the foot.
  ctx.fillStyle = ink;
  ctx.fillRect(M, H - 104, R - M, 3);
  ctx.font = font(700, 24, LABEL);
  spaced(ctx, "NABS RACING LEAGUE", M, H - 62, 2);
  ctx.fillStyle = mute;
  ctx.font = font(500, 22, LABEL);
  spaced(ctx, `${window.location.host}${window.location.pathname}`.slice(0, 60), R, H - 62, 0.5, "right");

  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("no picture"))), "image/png"));
}

// Draws it and hands it on: the share sheet where the device has one for
// files, else a download. Resolves "shared" or "saved".
export async function saveSharePicture(review, slide) {
  const blob = await drawSharePicture(review, slide);
  const fileName = `${review.driver.name}-${review.season.label}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".png";
  const file = typeof File !== "undefined" ? new File([blob], fileName, { type: "image/png" }) : null;
  if (file && navigator.canShare?.({ files: [file] }) && navigator.share && matchMedia?.("(pointer: coarse)").matches) {
    try {
      await navigator.share({ files: [file], title: `${review.season.label} in review` });
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError") return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "saved";
}
