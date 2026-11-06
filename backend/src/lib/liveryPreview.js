// ---------------------------------------------------------------------------
// What a car on the board actually looks like.
//
// A special event has no teams: the whole grid sits in one "Reserve" row of the
// roster, so the live page had the same grey bar and the same word beside every
// name. What tells these cars apart is the skin, and the race server already
// has every one of them, the drivers' own included:
// /content/cars/<model>/skins/<skin>/preview.jpg answers without a login.
//
// From that one picture this makes the two things the page wants: the car's
// main colour, and a small crop of the car to show in the row. The originals
// run up to 700 kB and 1920 px, far too much to send to every viewer, so they
// are read once here and only the small result is kept.
// ---------------------------------------------------------------------------
import { fetchSkinPreview } from "./acServerContent.js";

let canvasLib = null;
const canvasModule = async () => (canvasLib ||= await import("@napi-rs/canvas"));

// The picture is measured at this size. Plenty for a colour and an outline, and
// it keeps the loop below at about five thousand pixels per skin.
const SAMPLE_W = 96;
const SAMPLE_H = 54;
const THUMB_W = 208;
const THUMB_H = 117;

// An organiser can replace a skin under the same name while the car pack is
// being built, so nothing is kept for ever. A skin that failed gets a shorter
// wait: it is usually one that is not on the server yet.
const KEEP_MS = 6 * 3600e3;
const KEEP_FAILED_MS = 10 * 60e3;
const MAX_KEPT = 150;
// Each original decodes to about 8 MB. A full grid arriving at once must not
// mean forty of those in memory together.
const MAX_AT_ONCE = 3;

function hsvOf(r, g, b) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: h * 60, s: max ? d / max : 0, v: max / 255 };
}

function hex(r, g, b) {
  return "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

// A colour bar has to stand out from a dark card and a light one alike, so the
// hue comes from the car and the brightness is kept to the middle.
function readable({ r, g, b }) {
  const { h, s, v } = hsvOf(r, g, b);
  const sat = Math.max(s, 0.55);
  const val = Math.min(Math.max(v, 0.82), 0.95);
  const c = val * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = val - c;
  const [R, G, B] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return hex((R + m) * 255, (G + m) * 255, (B + m) * 255);
}

// Where the car is in the picture: the showroom behind it is black. Rows and
// columns count once a few pixels in them are lit, so a stray highlight on the
// floor does not stretch the box.
export function carBox(data, w, h) {
  const cols = new Array(w).fill(0);
  const rows = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (Math.max(data[i], data[i + 1], data[i + 2]) > 45) {
        cols[x]++;
        rows[y]++;
      }
    }
  }
  const first = (a, min) => a.findIndex((n) => n >= min);
  const last = (a, min) => a.length - 1 - [...a].reverse().findIndex((n) => n >= min);
  const left = first(cols, 3);
  const top = first(rows, 6);
  if (left < 0 || top < 0) return null;
  return { left, right: last(cols, 3), top, bottom: last(rows, 6) };
}

// The car's main colour, as "#rrggbb". `data` is RGBA, as a canvas gives it.
//
// Liveries are busy: sponsors, numbers, tyres, glass. So this looks for the hue
// that covers the most paint rather than averaging, which on a red and yellow
// car gives a brown nobody painted. Only a car with hardly any colour on it, the
// white, grey and black ones, ends up with a neutral.
export function liveryColor(data, w, h) {
  const box = carBox(data, w, h);
  if (!box) return null;
  // The upper part of the box: the lower edge is tyres and, in many of these
  // pictures, the car's reflection in the floor.
  const bottom = box.top + Math.round((box.bottom - box.top) * 0.75);
  const BINS = 24;
  const bins = Array.from({ length: BINS }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
  let body = 0;
  let coloured = 0;
  let light = 0;
  for (let y = box.top; y <= bottom; y++) {
    for (let x = box.left; x <= box.right; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const { h: hue, s, v } = hsvOf(r, g, b);
      if (v < 0.18) continue;
      body++;
      light += v;
      if (s < 0.38 || v < 0.3) continue;
      coloured++;
      const bin = bins[Math.floor(hue / (360 / BINS)) % BINS];
      bin.n++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
    }
  }
  if (!body) return null;
  if (coloured / body < 0.14) {
    return light / body > 0.5 ? "#d4d8de" : "#7b8494";
  }
  // A paint job rarely sits in one bin, so each is judged with its neighbours.
  let best = 0;
  let bestN = -1;
  for (let i = 0; i < BINS; i++) {
    const n = bins[i].n + bins[(i + 1) % BINS].n + bins[(i + BINS - 1) % BINS].n;
    if (n > bestN) {
      bestN = n;
      best = i;
    }
  }
  const sum = { n: 0, r: 0, g: 0, b: 0 };
  for (const j of [best, (best + 1) % BINS, (best + BINS - 1) % BINS]) {
    for (const k of ["n", "r", "g", "b"]) sum[k] += bins[j][k];
  }
  return readable({ r: sum.r / sum.n, g: sum.g / sum.n, b: sum.b / sum.n });
}

// The 16:9 piece of the picture that holds the car, in sample pixels. It hangs
// from the roof rather than centring on the box, so a reflection under the car
// falls out of the crop instead of pulling the car up out of it.
function thumbCrop(box) {
  const width = Math.min(SAMPLE_W, (box.right - box.left + 1) * 1.08);
  const height = (width * 9) / 16;
  const midX = (box.left + box.right + 1) / 2;
  return {
    x: Math.min(Math.max(midX - width / 2, 0), SAMPLE_W - width),
    y: Math.min(Math.max(box.top - height * 0.06, 0), SAMPLE_H - height),
    width,
    height,
  };
}

export async function readLivery(buffer) {
  const { createCanvas, loadImage } = await canvasModule();
  const img = await loadImage(buffer);
  const sample = createCanvas(SAMPLE_W, SAMPLE_H);
  const ctx = sample.getContext("2d");
  ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
  const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
  const color = liveryColor(data, SAMPLE_W, SAMPLE_H);
  const box = carBox(data, SAMPLE_W, SAMPLE_H);
  if (!color || !box) return null;

  const crop = thumbCrop(box);
  const sx = img.width / SAMPLE_W;
  const sy = img.height / SAMPLE_H;
  const thumb = createCanvas(THUMB_W, THUMB_H);
  thumb
    .getContext("2d")
    .drawImage(img, crop.x * sx, crop.y * sy, crop.width * sx, crop.height * sy, 0, 0, THUMB_W, THUMB_H);
  return { color, image: await thumb.encode("jpeg", 82) };
}

const kept = new Map(); // "server/car/skin" -> { color, image, at, failed }
const reading = new Map(); // same key -> the promise of the read under way
const waiting = [];
let running = 0;

function take(job) {
  return new Promise((resolve, reject) => {
    const run = () => {
      running++;
      job()
        .then(resolve, reject)
        .finally(() => {
          running--;
          waiting.shift()?.();
        });
    };
    if (running < MAX_AT_ONCE) run();
    else waiting.push(run);
  });
}

function keep(key, value) {
  kept.delete(key);
  kept.set(key, { ...value, at: Date.now() });
  if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value);
}

function fresh(key) {
  const hit = kept.get(key);
  if (!hit) return null;
  return Date.now() - hit.at < (hit.failed ? KEEP_FAILED_MS : KEEP_MS) ? hit : null;
}

// { color, image } for one skin on one server, or null when it cannot be read.
export async function getLivery(server, car, skin) {
  const key = `${server.key}/${car}/${skin}`;
  const hit = fresh(key);
  if (hit) return hit.failed ? null : hit;
  if (reading.has(key)) return reading.get(key);
  const read = take(async () => readLivery(await fetchSkinPreview(server.origin, car, skin)))
    .catch(() => null)
    .then((livery) => {
      reading.delete(key);
      keep(key, livery || { failed: true });
      return livery;
    });
  reading.set(key, read);
  return read;
}

// The skins on a board, each once: [{ car, skin }]. A pace car is not part of
// the field, and a guest can have neither field filled in.
export function boardSkins(board) {
  const seen = new Map();
  for (const e of board?.entries || []) {
    if (!e.carModel || !e.carSkin || e.isSafetyCar) continue;
    seen.set(`${e.carModel}/${e.carSkin}`, { car: e.carModel, skin: e.carSkin });
  }
  return [...seen.values()];
}

// { "<car>/<skin>": "#rrggbb" } for everything on the board that could be read.
export async function boardLiveryColors(server, board) {
  const out = {};
  await Promise.all(
    boardSkins(board).map(async ({ car, skin }) => {
      const livery = await getLivery(server, car, skin);
      if (livery?.color) out[`${car}/${skin}`] = livery.color;
    })
  );
  return out;
}
