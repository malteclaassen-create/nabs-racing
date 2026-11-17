// The season story's share picture: the last slide's card drawn at
// 1080x1350 (4:5, whole in a Discord embed and an Instagram post), in the
// site's fonts and the viewer's own theme colours, from the same slide data
// the card on screen shows (review/storySlides.mjs). Drawn in the browser:
// nothing is uploaded. On a phone it goes to the share sheet, elsewhere it
// is downloaded.
//
// Plain on purpose, like the page: one card, hairlines, the team colour as
// the one accent, the driver's own picture on the cover.
import { slideColours, storyColour } from "./wrapPalette.js";
import { seasonList } from "./storySlides.mjs";

const W = 1080;
const H = 1350;

async function fontsReady() {
  if (!document.fonts?.load) return;
  await Promise.all([document.fonts.load('900 120px "Montserrat"'), document.fonts.load('800 40px "Montserrat"'), document.fonts.load('700 26px "Inter"')]).catch(() => {});
}

const HEAVY = '"Montserrat", "Inter", sans-serif';
const SMALL = '"Inter", system-ui, sans-serif';
const font = (weight, size, family) => `${weight} ${size}px ${family}`;

// The largest size up to `max` at which `text` fits `width`.
function fit(ctx, text, width, max, weight, family) {
  let size = max;
  ctx.font = font(weight, size, family);
  while (size > 18 && ctx.measureText(text).width > width) {
    size -= 2;
    ctx.font = font(weight, size, family);
  }
  return size;
}

// `text` cut with an ellipsis to fit `width` at the current font.
function clip(ctx, text, width) {
  let t = String(text);
  if (ctx.measureText(t).width <= width) return t;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t}…`;
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

// The driver's picture, loaded for drawing (same origin, so the canvas stays
// exportable). Null when there is none or it does not load.
function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// The summary card of the story's last slide, as a Wrapped summary card:
// the team colour round it, the card in the slide's ink, a cover with the
// driver's picture (or the season number), two lists side by side, the two
// big numbers.
export async function drawSharePicture(review, slide) {
  await fontsReady();
  const vars = slideColours("final", storyColour(review));
  const bg = vars["--g-bg"];
  const ink = vars["--g-fg"];
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // The card.
  const cx = 64;
  const cy = 64;
  const cw = W - 128;
  const ch = H - 200;
  roundRect(ctx, cx, cy, cw, ch, 34);
  ctx.fillStyle = ink;
  ctx.fill();
  const P = 58;
  const L = cx + P;
  const R = cx + cw - P;

  // The cover and the name.
  const cs = 300;
  roundRect(ctx, L, cy + P, cs, cs, 14);
  ctx.fillStyle = vars["--g-mark"];
  ctx.fill();
  const num = /d+$/.exec(String(review.season?.label || ""))?.[0] || "";
  const photo = await loadImage(review.driver?.photoUrl);
  if (photo) {
    ctx.save();
    roundRect(ctx, L, cy + P, cs, cs, 14);
    ctx.clip();
    const sc = Math.max(cs / photo.width, cs / photo.height);
    ctx.drawImage(photo, L + (cs - photo.width * sc) / 2, cy + P + (cs - photo.height * sc) / 2, photo.width * sc, photo.height * sc);
    ctx.restore();
    if (num) {
      ctx.font = font(900, 40, HEAVY);
      const bw = ctx.measureText(`S${num}`).width + 24;
      roundRect(ctx, L + cs - bw - 12, cy + P + cs - 64, bw, 52, 10);
      ctx.fillStyle = vars["--g-mark"];
      ctx.fill();
      ctx.fillStyle = vars["--g-mark-fg"];
      ctx.fillText(`S${num}`, L + cs - bw, cy + P + cs - 24);
    }
  } else if (num) {
    ctx.fillStyle = vars["--g-mark-fg"];
    ctx.font = font(900, 230, HEAVY);
    ctx.textAlign = "center";
    ctx.fillText(num, L + cs / 2, cy + P + cs / 2 + 80);
    ctx.textAlign = "left";
  }
  const tx = L + cs + 40;
  const tw = R - tx;
  ctx.fillStyle = bg;
  ctx.globalAlpha = 0.7;
  ctx.font = font(700, 28, SMALL);
  ctx.fillText(clip(ctx, slide.eyebrow, tw), tx, cy + P + 120);
  ctx.globalAlpha = 1;
  const name = review.driver.name;
  const ns = fit(ctx, name, tw, 92, 900, HEAVY);
  ctx.font = font(900, ns, HEAVY);
  ctx.fillText(name, tx, cy + P + 120 + ns + 6);
  if (review.driver.team?.name) {
    ctx.globalAlpha = 0.7;
    ctx.font = font(700, 36, SMALL);
    ctx.fillText(clip(ctx, review.driver.team.name, tw), tx, cy + P + 120 + ns + 58);
    ctx.globalAlpha = 1;
  }

  // Two lists side by side.
  let y = cy + P + cs + 80;
  // The results get the wider column: circuit names are longer than figures.
  const colL = (R - L - 40) * 0.58;
  const colR = R - L - 40 - colL;
  const lists = [
    ["Top results", (slide.top || []).map((t, k) => [`${k + 1} ${t.track}`, `P${t.position}`])],
    ["The season", seasonList(slide, review).map((g) => [String(g.value), g.label])],
  ];
  lists.forEach(([title, rows], i) => {
    const x = L + (i ? colL + 40 : 0);
    const colW = i ? colR : colL;
    ctx.globalAlpha = 0.7;
    ctx.font = font(700, 28, SMALL);
    ctx.fillText(title, x, y);
    ctx.globalAlpha = 1;
    rows.forEach(([a, b], k) => {
      const ry = y + 64 + k * 64;
      ctx.font = font(800, 44, HEAVY);
      const left = clip(ctx, a, colW - 90);
      ctx.fillText(left, x, ry);
      const aw = ctx.measureText(left).width;
      ctx.globalAlpha = 0.6;
      ctx.font = font(800, 30, HEAVY);
      ctx.fillText(clip(ctx, b, colW - aw - 14), x + aw + 14, ry);
      ctx.globalAlpha = 1;
    });
  });

  // The two big numbers.
  y = cy + ch - P - 150;
  const big = [
    ["Points", String(slide.points)],
    ["Championship", review.championship.position ? `P${review.championship.position}` : "–"],
  ];
  big.forEach(([label, value], i) => {
    const x = L + i * ((R - L - 40) / 2 + 40);
    ctx.globalAlpha = 0.7;
    ctx.font = font(700, 28, SMALL);
    ctx.fillText(label, x, y);
    ctx.globalAlpha = 1;
    ctx.font = font(900, 130, HEAVY);
    ctx.fillText(value, x - 4, y + 128);
  });

  // Who made it, under the card.
  ctx.fillStyle = ink;
  ctx.font = font(800, 30, HEAVY);
  ctx.fillText("NABS Racing League", cx + 8, H - 66);
  ctx.textAlign = "right";
  ctx.globalAlpha = 0.75;
  ctx.font = font(700, 24, SMALL);
  ctx.fillText(window.location.host, W - cx - 8, H - 68);
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";

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
