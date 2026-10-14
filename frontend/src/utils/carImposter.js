// ---------------------------------------------------------------------------
// The league's real car in the Season Wrapped scenes, as pictures.
//
// The car the league races is somebody else's model, so the model itself
// never comes to the browser. Instead it is rendered beforehand
// (tools/car-renders), in each team's livery, from every side, into one
// picture per livery (an atlas of frames), and the scenes stand that picture
// up where the car is, facing the camera, showing the frame for the side the
// camera is looking at. Between two frames it fades from one to the next, so
// the car turns smoothly.
//
// Two atlases per car:
//   hero   one livery, 48 frames round the car seen from a little above
//          (large, for the driver's own car up close)
//   field  every livery, 16 frames round at two heights (small, for the rest
//          of the grid and for the driver's car seen from high up)
// Their layout comes from public/cars/index.json (utils/carArt.js).
// ---------------------------------------------------------------------------
import * as THREE from "three";

const VERT = /* glsl */ `
attribute float aLivery;
uniform vec2 uBox;      // the frame's width and height, metres
uniform float uCy;      // the frame's centre above the ground, metres
uniform float uScale;
uniform float uYaws;     // frames round the car, uYawStep apart from uYawFrom
uniform float uYawFrom;
uniform float uYawStep;
uniform float uWrap;     // 1: the frames go all the way round
uniform float uBlend;    // 1: fade between frames, 0: the nearest
uniform vec2 uPitches;  // the two rendered heights (equal where there is one)
uniform float uPitchCount;
varying vec2 vUv;
varying vec4 vFrames;   // yaw frame a, yaw frame b, row a, row b
varying vec2 vMix;      // between yaw frames, between rows
varying float vLivery;
varying float vFogDepth;

const float TAU = 6.28318530718;

void main() {
  mat4 w = modelMatrix * instanceMatrix;
  vec3 origin = (w * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 ax = (w * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
  vec3 az = (w * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
  float s = length(ax) * uScale;
  vec3 nose = normalize(vec3(ax.x, 0.0, ax.z));
  vec3 side = normalize(vec3(az.x, 0.0, az.z));
  vec3 centre = origin + vec3(0.0, uCy * s, 0.0);

  vec3 toCam = cameraPosition - centre;
  float dist = max(length(toCam), 1e-3);
  vec3 dir = toCam / dist;

  // Which side the camera sees: frame i was drawn from yawFrom + i * yawStep
  // (0 = straight at the nose, rising towards the car's +z side).
  float yaw = atan(dot(dir, side), dot(dir, nose));
  float rel = mod(yaw - uYawFrom + 2.0 * TAU, TAU);
  float f;
  if (uWrap > 0.5) {
    f = rel / uYawStep;
  } else {
    // A band of frames, held at whichever end is nearer outside it.
    float end = (uYaws - 1.0) * uYawStep;
    f = rel <= end ? rel / uYawStep : (rel - end < TAU - rel ? uYaws - 1.0 : 0.0);
  }
  float a = uBlend > 0.5 ? floor(f) : floor(f + 0.5);
  vMix.x = uBlend > 0.5 ? f - a : 0.0;
  vFrames.x = uWrap > 0.5 ? mod(a, uYaws) : min(a, uYaws - 1.0);
  vFrames.y = uWrap > 0.5 ? mod(a + 1.0, uYaws) : min(a + 1.0, uYaws - 1.0);
  float pitch = asin(clamp(dir.y, -1.0, 1.0));
  float t = uPitchCount > 1.0 ? clamp((pitch - uPitches.x) / (uPitches.y - uPitches.x), 0.0, 1.0) : 0.0;
  vFrames.z = 0.0;
  vFrames.w = uPitchCount > 1.0 ? 1.0 : 0.0;
  vMix.y = t;
  vLivery = aLivery;

  // Facing the camera, upright as the frames were drawn; brought forward
  // towards the camera (and shrunk to match) so the ground and the podium
  // do not cut through the bottom of the picture.
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), dir));
  vec3 up = cross(dir, right);
  float k = min(2.2 * s, dist * 0.5);
  float shrink = (dist - k) / dist;
  vec3 p = centre + dir * k + (right * position.x * uBox.x + up * position.y * uBox.y) * s * shrink;
  vUv = uv;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec2 uGrid;      // columns, rows
uniform float uYaws;
uniform float uPitchCount;
uniform vec3 uFogColor;
uniform vec2 uFog;       // near, far (0, 0 = none)
uniform float uOpacity;
varying vec2 vUv;
varying vec4 vFrames;
varying vec2 vMix;
varying float vLivery;
varying float vFogDepth;

vec4 frame(float yawFrame, float row) {
  float idx = (vLivery * uPitchCount + row) * uYaws + yawFrame;
  float col = mod(idx, uGrid.x);
  float line = floor(idx / uGrid.x + 0.0001);
  vec2 uv = vec2((col + vUv.x) / uGrid.x, 1.0 - (line + 1.0 - vUv.y) / uGrid.y);
  vec4 c = texture2D(uAtlas, uv);
  return vec4(c.rgb * c.a, c.a);
}

void main() {
  vec4 lo = mix(frame(vFrames.x, vFrames.z), frame(vFrames.y, vFrames.z), vMix.x);
  vec4 c = lo;
  if (uPitchCount > 1.0 && vMix.y > 0.001) {
    vec4 hi = mix(frame(vFrames.x, vFrames.w), frame(vFrames.y, vFrames.w), vMix.x);
    c = mix(lo, hi, vMix.y);
  }
  if (c.a < 0.02) discard;
  if (uFog.y > 0.0) {
    float fog = smoothstep(uFog.x, uFog.y, vFogDepth);
    c.rgb = mix(c.rgb, uFogColor * c.a, fog);
  }
  gl_FragColor = c * uOpacity;
}
`;

// An atlas picture as a texture. `crisp`: the hero, drawn large, kept without
// mipmaps (half the memory).
export function atlasTexture(url, { crisp = false } = {}) {
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    t.colorSpace = THREE.NoColorSpace;
    t.generateMipmaps = !crisp;
    t.minFilter = crisp ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = crisp ? 1 : 4;
    return t;
  });
}

function imposterMaterial(texture, layout, scale, blend) {
  const pitches = layout.pitches.length > 1 ? layout.pitches : [layout.pitches[0], layout.pitches[0]];
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uAtlas: { value: texture },
      uGrid: { value: new THREE.Vector2(layout.cols, layout.rows) },
      uBox: { value: new THREE.Vector2(layout.boxW, layout.boxH) },
      uCy: { value: layout.cy },
      uScale: { value: scale },
      uYaws: { value: layout.yaws },
      uYawFrom: { value: layout.yawFrom ?? 0 },
      uYawStep: { value: layout.yawStep ?? (Math.PI * 2) / layout.yaws },
      uWrap: { value: layout.yawStep == null ? 1 : 0 },
      uBlend: { value: blend ? 1 : 0 },
      uPitches: { value: new THREE.Vector2(pitches[0], pitches[1]) },
      uPitchCount: { value: layout.pitches.length },
      uFogColor: { value: new THREE.Color() },
      uFog: { value: new THREE.Vector2(0, 0) },
      uOpacity: { value: 1 },
    },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: true,
    toneMapped: false,
  });
}

const QUAD = new THREE.PlaneGeometry(1, 1);

// `count` cars from one atlas; `liveries[i]` is car i's row block in it.
// Drawn back to front every frame, so the cars overlap the right way round.
function imposters(bag, texture, layout, scale, liveries, blend) {
  const n = liveries.length;
  const geo = bag.add(QUAD.clone());
  const livery = new THREE.InstancedBufferAttribute(new Float32Array(liveries), 1);
  geo.setAttribute("aLivery", livery);
  const material = bag.add(imposterMaterial(texture, layout, scale, blend));
  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  const order = [...Array(n).keys()];
  const mats = Array.from({ length: n }, () => new THREE.Matrix4());
  const tmp = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  mesh.places = mats;
  mesh.liveries = liveries.slice();
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const fog = scene.fog;
    material.uniforms.uFog.value.set(fog ? fog.near : 0, fog ? fog.far : 0);
    if (fog) material.uniforms.uFogColor.value.copy(fog.color);
    if (n < 2) return;
    camera.getWorldPosition(camPos);
    const d = mats.map((m) => tmp.setFromMatrixPosition(m).applyMatrix4(mesh.matrixWorld).distanceToSquared(camPos));
    order.sort((x, y) => d[y] - d[x]);
    order.forEach((src, i) => {
      mesh.setMatrixAt(i, mats[src]);
      livery.array[i] = mesh.liveries[src];
    });
    mesh.instanceMatrix.needsUpdate = true;
    livery.needsUpdate = true;
  };
  return mesh;
}

// The rest of the grid: one car per matrix in `places`, liveries taken in
// turn from `liveries`.
export function imposterField(bag, art, places, liveries) {
  const list = places.map((_, i) => liveries[i % liveries.length]);
  // The nearest frame, crisp: these do not turn much.
  const mesh = imposters(bag, art.field, art.fieldLayout, art.scale, list, false);
  places.forEach((m, i) => {
    mesh.places[i].copy(m);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// The driver's car: the large pictures from a little above, the small ones
// from high up (where it is small on screen anyway).
export function imposterCar(bag, art) {
  const g = new THREE.Group();
  const hero = art.hero ? imposters(bag, art.hero, art.heroLayout, art.scale, [0], true) : null;
  const small = imposters(bag, art.field, art.fieldLayout, art.scale, [art.livery], false);
  if (hero) g.add(hero);
  g.add(small);
  if (!hero) return g;
  const at = new THREE.Vector3();
  const cam = new THREE.Vector3();
  const nose = new THREE.Vector3();
  const side = new THREE.Vector3();
  const { yawFrom = 0, yawStep, yaws } = art.heroLayout;
  const band = yawStep == null ? Math.PI * 2 : (yaws - 1) * yawStep;
  small.visible = false;
  // The big pictures were drawn from 12 degrees up and only from the sides
  // the scenes show; from high up, or from a side they do not have, the small
  // ones (drawn all the way round, from 15 and 55) stand in. The stage asks
  // before every frame.
  g.userData.pick = (camera) => {
    g.getWorldPosition(at);
    camera.getWorldPosition(cam);
    const e = g.matrixWorld.elements;
    nose.set(e[0], 0, e[2]).normalize();
    side.set(e[8], 0, e[10]).normalize();
    const dx = cam.x - at.x;
    const dz = cam.z - at.z;
    const dy = cam.y - at.y - art.heroLayout.cy;
    const yaw = Math.atan2(dx * side.x + dz * side.z, dx * nose.x + dz * nose.z);
    const rel = (((yaw - yawFrom) % (Math.PI * 2)) + Math.PI * 4) % (Math.PI * 2);
    const inBand = rel <= band + 0.02 || rel >= Math.PI * 2 - 0.02;
    const high = Math.atan2(dy, Math.hypot(dx, dz)) > 0.45;
    hero.visible = inBand && !high;
    small.visible = !hero.visible;
  };
  return g;
}
