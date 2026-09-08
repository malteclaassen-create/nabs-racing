import test from 'node:test';
import assert from 'node:assert/strict';
import { contoursFromMask, chaikin, decimate, maskFromPixels, trackPathFromMask } from '../src/utils/trackMask.js';

// A ring: the track surface around an infield.
function ring(w, h, rOuter, rInner) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - w / 2, y - h / 2);
    mask[y * w + x] = d <= rOuter && d >= rInner ? 1 : 0;
  }
  return mask;
}

test('a ring traces to two closed loops, the outer edge and the infield hole', () => {
  const w = 80, h = 80;
  const loops = contoursFromMask(ring(w, h, 30, 20), w, h);
  assert.equal(loops.length, 2);
  const sizes = loops.map((l) => l.length).sort((a, b) => a - b);
  assert.ok(sizes[1] > sizes[0], 'the outer loop has more points than the hole');
  for (const loop of loops) for (const [x, y] of loop) {
    const d = Math.hypot(x - w / 2, y - h / 2);
    assert.ok(Math.abs(d - 30) < 1.5 || Math.abs(d - 20) < 1.5, `point ${x},${y} sits on an edge`);
  }
});

test('a track touching the image edge still closes', () => {
  const w = 40, h = 20;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = y < 8 ? 1 : 0;
  const loops = contoursFromMask(mask, w, h);
  assert.equal(loops.length, 1);
});

test('smoothing and decimation keep a loop closed and roughly in place', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const smooth = chaikin(square, 1);
  assert.equal(smooth.length, 8);
  for (const [x, y] of smooth) { assert.ok(x >= 0 && x <= 10); assert.ok(y >= 0 && y <= 10); }
  assert.deepEqual(decimate([1, 2, 3, 4, 5], 2), [1, 3, 5]);
});

test('the mask reads alpha when the image has any, and brightness otherwise', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0]);
  assert.deepEqual([...maskFromPixels(rgba, 2, 1)], [1, 0]);
  const opaque = new Uint8ClampedArray([255, 255, 255, 255, 10, 10, 10, 255]);
  assert.deepEqual([...maskFromPixels(opaque, 2, 1)], [1, 0]);
});

test('the path has one subpath per loop and closes each', () => {
  const w = 80, h = 80;
  const { d, loops } = trackPathFromMask(ring(w, h, 30, 20), w, h, { minPoints: 20 });
  assert.equal(loops, 2);
  assert.equal((d.match(/M/g) || []).length, 2);
  assert.equal((d.match(/Z/g) || []).length, 2);
});
