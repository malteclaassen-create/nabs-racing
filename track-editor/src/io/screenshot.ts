import type * as THREE from 'three';

/**
 * The export wants a picture of the viewport for ui/preview.png. The Canvas
 * hands its renderer over here so the exporter can grab a frame without
 * dragging React state through the whole export pipeline.
 */

let renderer: THREE.WebGLRenderer | null = null;
let redraw: (() => void) | null = null;

export function setRenderer(gl: THREE.WebGLRenderer, render: () => void) {
  renderer = gl;
  redraw = render;
  if (import.meta.env.DEV) {
    // Handy for automated checks: force a frame from the console.
    (window as unknown as Record<string, unknown>).__acRender = render;
  }
}

/**
 * A copy of the current frame, taken synchronously.
 *
 * The copy matters: without `preserveDrawingBuffer` the WebGL buffer is thrown
 * away as soon as control returns to the browser, so it has to be read in the
 * same tick as the draw. Keeping that flag on instead would have been a
 * permanent frame rate cost on every single frame, just so one screenshot per
 * export could be taken later.
 */
export function captureCanvas(): HTMLCanvasElement | null {
  if (!renderer) return null;
  redraw?.();
  const source = renderer.domElement;
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  const ctx = copy.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0);
  return copy;
}
