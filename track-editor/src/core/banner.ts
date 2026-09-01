import * as THREE from 'three';
import { BRIDGE_BANNER } from './library';

/**
 * Sponsor banners on the road bridge.
 *
 * A banner is a picture the user dropped into the project, stretched across
 * the side face of one bridge deck segment -- the space a real circuit sells:
 * the DHL bridge, the Aramco bridge. It is deliberately NOT part of the
 * prop's own geometry: the prop library shares one material per look across
 * every instance, and a banner is the one thing that is different on every
 * instance. So the quads are built here, per instance, and both the viewport
 * and the exporter draw them from the same function.
 */

/**
 * One banner face, in the deck's own frame.
 *
 * `side` +1 is the deck's +X face. The texture reads left to right for a
 * viewer STANDING ON THAT SIDE looking at the bridge, on both faces -- which
 * is what a banner printed twice on a real bridge does.
 */
export function bannerQuad(side: 1 | -1): THREE.BufferGeometry {
  const { x, y0, y1, halfLen } = BRIDGE_BANNER;
  const sx = side * x;
  // Bottom-left for the viewer, then bottom-right, top-right, top-left.
  const pos = new Float32Array([
    sx, y0, side * halfLen,
    sx, y0, -side * halfLen,
    sx, y1, -side * halfLen,
    sx, y1, side * halfLen,
  ]);
  /*
   * V runs top-down on purpose: Assetto Corsa samples V=0 at the TOP of a
   * texture, and the banner's bytes go into the kn5 exactly as uploaded. The
   * viewport compensates by loading its preview texture with flipY off, so
   * the two agree and the picture is upright in both.
   */
  const uv = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
  const nrm = new Float32Array([
    side, 0, 0,
    side, 0, 0,
    side, 0, 0,
    side, 0, 0,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Which library pieces can carry a banner. The deck: it is the flat span. */
export function canCarryBanner(kind: string): boolean {
  return kind === 'bridge_road_deck';
}
