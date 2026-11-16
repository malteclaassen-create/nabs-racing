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

const W = 1080;
const H = 1350;
const M = 72;

// The theme's colours as the page has them right now.
function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (css.getPropertyValue(name) || "").trim() || fallback;
  const triple = (name, fallback) => {
    const t = v(name, fallback);
    return /^\d/.test(t) ? `rgb(${t.split(/\s+/).slice(0, 3).join(",")})` : t;
  };
  return {
    bg: v("--c-bg", "#080d18"),
    card: v("--c-card", "#131c2e"),
    border: v("--c-border", "#243248"),
    text: v("--c-text", "#e8eef7"),
    text2: v("--c-text2", "#aebacd"),
    text3: v("--c-text3", "#9aa8be"),
    faint: v("--c-faint", "#78859a"),
    eyebrow: v("--c-eyebrow", "#f4afc6"),
    accent: triple("--c-accent", "244 175 198"),
  };
}

async function fontsReady() {
  if (!document.fonts?.load) return;
  await Promise.all([
    document.fonts.load('900 120px "Archivo"'),
    document.fonts.load('800 40px "Archivo"'),
    document.fonts.load('500 28px "Inter"'),
    document.fonts.load('700 22px "JetBrains Mono"'),
  ]).catch(() => {});
}

const font = (weight, size, family) => `${weight} ${size}px ${family === "display" ? '"Archivo", "Inter", sans-serif' : family === "mono" ? '"JetBrains Mono", ui-monospace, monospace' : '"Inter", system-ui, sans-serif'}`;

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

function spaced(ctx, text, x, y, tracking) {
  let at = x;
  for (const ch of text) {
    ctx.fillText(ch, at, y);
    at += ctx.measureText(ch).width + tracking;
  }
  return at;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
  ctx.lineWidth = 3.2 / s;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(new Path2D(c.path));
  ctx.restore();
  return true;
}

export async function drawSharePicture(review, slide) {
  await fontsReady();
  const p = palette();
  const team = review.driver.team?.color || p.text;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 40, 40, W - 80, H - 80, 14);
  ctx.fillStyle = p.card;
  ctx.fill();
  ctx.strokeStyle = p.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  // The eyebrow: the team-colour tab and the label, then the league top right.
  ctx.fillStyle = team;
  roundRect(ctx, M + 8, 118, 34, 7, 3);
  ctx.fill();
  ctx.fillStyle = p.eyebrow;
  ctx.font = font(700, 22, "mono");
  spaced(ctx, "SEASON REVIEW", M + 56, 128, 4);
  ctx.fillStyle = p.faint;
  ctx.textAlign = "right";
  ctx.font = font(700, 22, "mono");
  ctx.fillText(slide.eyebrow.toUpperCase(), W - M - 8, 128);
  ctx.textAlign = "left";

  // The name, as big as it fits, and the team.
  const name = review.driver.name.toUpperCase();
  const size = fit(ctx, name, W - 2 * M - 16, 118, 900, "display");
  ctx.fillStyle = p.text;
  ctx.font = font(900, size, "display");
  ctx.fillText(name, M + 8, 170 + size * 0.86);
  let y = 170 + size + 24;
  if (review.driver.team?.name) {
    ctx.fillStyle = team;
    ctx.fillRect(M + 8, y - 22, 5, 26);
    ctx.fillStyle = p.text3;
    ctx.font = font(500, 30, "sans");
    ctx.fillText(review.driver.team.name, M + 26, y);
    y += 30;
  }

  // The hairline, then the place and the points.
  y += 30;
  ctx.fillStyle = p.border;
  ctx.fillRect(M + 8, y, W - 2 * M - 16, 2);
  y += 34;
  const c = review.championship;
  if (c.position) {
    ctx.fillStyle = p.text3;
    ctx.font = font(900, 96, "display");
    ctx.fillText("P", M + 8, y + 96);
    const pw = ctx.measureText("P").width;
    ctx.fillStyle = p.text;
    ctx.font = font(900, 250, "display");
    ctx.fillText(String(c.position), M + 8 + pw + 6, y + 212);
  }
  ctx.textAlign = "right";
  ctx.fillStyle = p.text3;
  ctx.font = font(700, 26, "mono");
  if (slide.unit) ctx.fillText(slide.unit, W - M - 8, y + 70);
  ctx.fillStyle = p.accent;
  ctx.font = font(900, 92, "display");
  ctx.fillText(String(slide.points), W - M - 70, y + 176);
  ctx.fillStyle = p.text3;
  ctx.font = font(700, 26, "mono");
  ctx.fillText("pts", W - M - 8, y + 176);
  ctx.textAlign = "left";

  // The six numbers in a hairline grid.
  y += 262;
  const gx = M + 8;
  const gw = W - 2 * M - 16;
  const cw = gw / 3;
  const ch = 148;
  ctx.strokeStyle = p.border;
  ctx.lineWidth = 2;
  roundRect(ctx, gx, y, gw, ch * 2, 10);
  ctx.stroke();
  ctx.fillStyle = p.border;
  ctx.fillRect(gx, y + ch - 1, gw, 2);
  ctx.fillRect(gx + cw - 1, y, 2, ch * 2);
  ctx.fillRect(gx + 2 * cw - 1, y, 2, ch * 2);
  // The best result has its own line under the grid, with its circuit, so
  // the grid takes the next figure instead of saying it twice.
  const grid = review.best ? summaryGrid(review, undefined, { skip: ["best"] }) : slide.grid;
  grid.forEach((g, k) => {
    const cx = gx + (k % 3) * cw + 26;
    const cy = y + Math.floor(k / 3) * ch;
    ctx.fillStyle = p.text3;
    ctx.font = font(700, 20, "mono");
    spaced(ctx, g.label.toUpperCase().slice(0, 18), cx, cy + 40, 2.5);
    ctx.fillStyle = p.text;
    ctx.font = font(900, 62, "display");
    ctx.fillText(g.value, cx, cy + 100);
    if (g.sub) {
      ctx.fillStyle = p.faint;
      ctx.font = font(500, 20, "mono");
      ctx.fillText(g.sub.slice(0, 20), cx, cy + 127);
    }
  });

  // The best round: its circuit in the team colour, and the line.
  y += ch * 2 + 46;
  const best = review.best;
  if (best) {
    const drew = outline(ctx, best.track, M + 8, y, 150, 130, team);
    const tx = drew ? M + 190 : M + 8;
    ctx.fillStyle = p.text3;
    ctx.font = font(700, 20, "mono");
    spaced(ctx, "BEST RESULT", tx, y + 34, 3);
    ctx.fillStyle = p.text;
    ctx.font = font(900, 46, "display");
    ctx.fillText(`P${best.position} ${String(best.track).toUpperCase()}`, tx, y + 88);
    ctx.fillStyle = p.text3;
    ctx.font = font(500, 26, "sans");
    ctx.fillText(`Round ${best.round}${best.grid > 0 ? `, from P${best.grid}` : ""}`, tx, y + 126);
  }

  // The address at the foot.
  ctx.fillStyle = p.faint;
  ctx.font = font(500, 22, "mono");
  ctx.fillText(`${window.location.host}${window.location.pathname}`.slice(0, 64), M + 8, H - 84);

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
