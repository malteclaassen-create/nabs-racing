import type { Frame } from '../core/spline';
import type { MapParams } from './ini';

/**
 * map.png plus the matching map.ini, and the small preview/outline images
 * Content Manager shows in the track list.
 *
 * AC maps world coordinates to map pixels with
 *   pixelX = (worldX + X_OFFSET) / SCALE_FACTOR
 *   pixelY = (worldZ + Z_OFFSET) / SCALE_FACTOR
 * so the offsets and the scale below have to agree with how we draw.
 */

function edges(frames: Frame[]) {
  const left = frames.map((f) => f.pos.clone().addScaledVector(f.right, -f.widthL));
  const right = frames.map((f) => f.pos.clone().addScaledVector(f.right, f.widthR));
  return { left, right };
}

function bounds(frames: Frame[]) {
  const { left, right } = edges(frames);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of [...left, ...right]) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

async function toPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function drawRibbon(
  ctx: CanvasRenderingContext2D,
  frames: Frame[],
  closed: boolean,
  toPx: (x: number, z: number) => [number, number],
  fill: string,
) {
  const { left, right } = edges(frames);
  if (left.length < 2) return;
  ctx.beginPath();
  const start = toPx(left[0].x, left[0].z);
  ctx.moveTo(start[0], start[1]);
  for (let i = 1; i < left.length; i++) {
    const p = toPx(left[i].x, left[i].z);
    ctx.lineTo(p[0], p[1]);
  }
  if (closed) {
    const p = toPx(left[0].x, left[0].z);
    ctx.lineTo(p[0], p[1]);
  }
  for (let i = right.length - 1; i >= 0; i--) {
    const p = toPx(right[i].x, right[i].z);
    ctx.lineTo(p[0], p[1]);
  }
  if (closed) {
    const p = toPx(right[right.length - 1].x, right[right.length - 1].z);
    ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill('evenodd');
}

export interface MapResult {
  png: Uint8Array;
  params: MapParams;
}

/**
 * One pixel per metre, and an image shaped like the circuit -- which is what
 * every installed track does. Read out of three of them:
 *
 *   magione              WIDTH=342.88  HEIGHT=861.583  SCALE_FACTOR=1   png  342x861
 *   ks_barcelona/gp      WIDTH=1002.15 HEIGHT=1190.61  SCALE_FACTOR=1   png 1002x1190
 *   ks_highlands/short   WIDTH=1001.72 HEIGHT=915.21   SCALE_FACTOR=1   png 1001x915
 *
 * So WIDTH and HEIGHT are the image's own pixel size, and with SCALE_FACTOR at
 * 1 they are also its size in metres. Not one shipped track uses any other
 * scale factor.
 *
 * This used to draw into a fixed 1024 square and put the difference into
 * SCALE_FACTOR -- around 2.17 for a circuit this size. Self-consistent with the
 * formula, and fine IF the game reads that field; nothing in the installation
 * proves that it does, and a scale factor that is quietly taken for 1 would
 * draw the map at less than half size. Staying at 1 makes the question moot,
 * and a shape that follows the circuit spends its pixels on tarmac instead of
 * on the empty half of a square.
 *
 * `maxSize` is only a backstop for something enormous -- a point-to-point hill
 * climb -- where one pixel per metre would ask for a texture no card wants.
 * Every normal circuit stays well under it and keeps SCALE_FACTOR at 1.
 */
export async function buildMapImage(
  frames: Frame[],
  closed: boolean,
  maxSize = 4096,
  margin = 20,
): Promise<MapResult | null> {
  if (frames.length < 2) return null;
  const b = bounds(frames);
  const spanX = Math.max(1, b.maxX - b.minX);
  const spanZ = Math.max(1, b.maxZ - b.minZ);
  const scaleFactor = Math.max(1, Math.max(spanX, spanZ) / (maxSize - 2 * margin));
  const width = Math.ceil(spanX / scaleFactor) + 2 * margin;
  const height = Math.ceil(spanZ / scaleFactor) + 2 * margin;
  // Chosen so the westmost/northmost edge of the road lands exactly on the
  // margin: (minX + xOffset) / scaleFactor === margin.
  const xOffset = -b.minX + margin * scaleFactor;
  const zOffset = -b.minZ + margin * scaleFactor;
  const toPx = (x: number, z: number): [number, number] => [
    (x + xOffset) / scaleFactor,
    (z + zOffset) / scaleFactor,
  ];

  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  drawRibbon(ctx, frames, closed, toPx, '#ffffff');

  return {
    png: await toPng(c),
    params: { width, height, margin, scaleFactor, xOffset, zOffset, drawingSize: 10 },
  };
}

/** Square silhouette used by Content Manager next to the track name. */
export async function buildOutlineImage(frames: Frame[], closed: boolean, size = 512): Promise<Uint8Array | null> {
  if (frames.length < 2) return null;
  const b = bounds(frames);
  const pad = 24;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) || 1;
  const scale = (size - pad * 2) / span;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const toPx = (x: number, z: number): [number, number] => [
    size / 2 + (x - cx) * scale,
    size / 2 + (z - cz) * scale,
  ];

  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  drawRibbon(ctx, frames, closed, toPx, '#ffffff');
  return toPng(c);
}

/**
 * Preview image. Uses a real screenshot of the viewport when one is available,
 * otherwise falls back to a drawn top down view so the ZIP is never missing it.
 */
export async function buildPreviewImage(
  screenshot: HTMLCanvasElement | null,
  frames: Frame[],
  closed: boolean,
): Promise<Uint8Array | null> {
  const W = 355;
  const H = 200;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  if (screenshot) {
    const sw = screenshot.width;
    const sh = screenshot.height;
    const scale = Math.max(W / sw, H / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.drawImage(screenshot, (W - dw) / 2, (H - dh) / 2, dw, dh);
    return toPng(c);
  }

  if (frames.length < 2) return null;
  ctx.fillStyle = '#12161a';
  ctx.fillRect(0, 0, W, H);
  const b = bounds(frames);
  const pad = 16;
  const scale = Math.min((W - pad * 2) / (b.maxX - b.minX || 1), (H - pad * 2) / (b.maxZ - b.minZ || 1));
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const toPx = (x: number, z: number): [number, number] => [
    W / 2 + (x - cx) * scale,
    H / 2 + (z - cz) * scale,
  ];
  drawRibbon(ctx, frames, closed, toPx, '#e8eaed');
  return toPng(c);
}
