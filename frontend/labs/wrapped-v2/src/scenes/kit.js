// What the scenes are made of: 3D lettering in the site's own face (Archivo
// Black, OFL), twisted ribbons, confetti, sparkle, the racing car, easing.
import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import fontJson from "../archivo-black.typeface.json";

export { THREE, RoundedBoxGeometry };

const font = new FontLoader().parse(fontJson);

// --- time ------------------------------------------------------------------
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const span = (t, a, b) => clamp((t - a) / (b - a));
export const lerp = (a, b, k) => a + (b - a) * k;
export const easeOut = (k) => 1 - Math.pow(1 - k, 3);
export const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const easeOutBack = (k) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
};
export const easeOutElastic = (k) =>
  k === 0 ? 0 : k === 1 ? 1 : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;

// Everything a scene makes, to throw away together.
export function bag() {
  const items = new Set();
  return {
    add(x) {
      items.add(x);
      return x;
    },
    dispose() {
      for (const x of items) x.dispose?.();
      items.clear();
    },
  };
}

// --- lettering -------------------------------------------------------------
export function text3d(str, { size = 1, depth = 0.3, bevel = 0.03, segments = 3 } = {}) {
  const g = new TextGeometry(String(str), {
    font,
    size,
    depth,
    curveSegments: segments,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 2,
  });
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -(b.max.z + b.min.z) / 2);
  return g;
}

export function chrome(color, { metal = 1, rough = 0.18, emissive = 0x000000, ei = 0 } = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, emissive, emissiveIntensity: ei, envMapIntensity: 1.3 });
}

// A canvas texture with text on it (labels in 3D, card faces).
export function canvasTexture(w, h, paint) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function label(text, { color = "#fff", bg = null, size = 64, font: face = "900 {s}px Archivo, sans-serif", pad = 18, height = 1 } = {}) {
  const f = face.replace("{s}", size);
  const m = document.createElement("canvas").getContext("2d");
  m.font = f;
  const w = Math.ceil(m.measureText(text).width) + pad * 2;
  const h = Math.ceil(size * 1.25) + pad;
  const tex = canvasTexture(w, h, (ctx) => {
    if (bg) {
      ctx.fillStyle = bg;
      const r = h / 2.4;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(0, 0, w, h, r) : ctx.rect(0, 0, w, h);
      ctx.fill();
    }
    ctx.font = f;
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(text, pad, h / 2 + size * 0.04);
  });
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.scale.set((height * w) / h, height, 1);
  s.userData.dispose = () => {
    tex.dispose();
    mat.dispose();
  };
  return s;
}

// --- ribbons ---------------------------------------------------------------
// A flat band along a curve that twists as it goes (the shape Spotify's
// Wrapped is made of), coloured from one end to the other.
export function ribbonGeometry(curve, { width = 1, segments = 300, twist = 2, colors = ["#39ff14", "#ffffff"], taper = 0 } = {}) {
  const frames = curve.computeFrenetFrames(segments, curve.closed);
  const pos = [];
  const col = [];
  const nor = [];
  const idx = [];
  const ca = new THREE.Color(colors[0]);
  const cb = new THREE.Color(colors[1] ?? colors[0]);
  const cc = colors[2] ? new THREE.Color(colors[2]) : null;
  const c = new THREE.Color();
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPointAt(u, p);
    const a = u * twist * Math.PI * 2;
    const N = frames.normals[i];
    const B = frames.binormals[i];
    side.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
    const wv = width * (taper ? 1 - taper + taper * Math.sin(u * Math.PI) : 1);
    const n = new THREE.Vector3().crossVectors(frames.tangents[i], side).normalize();
    pos.push(p.x + side.x * wv, p.y + side.y * wv, p.z + side.z * wv, p.x - side.x * wv, p.y - side.y * wv, p.z - side.z * wv);
    nor.push(n.x, n.y, n.z, n.x, n.y, n.z);
    if (cc) c.copy(u < 0.5 ? ca : cb).lerp(u < 0.5 ? cb : cc, u < 0.5 ? u * 2 : (u - 0.5) * 2);
    else c.copy(ca).lerp(cb, u);
    col.push(c.r, c.g, c.b, c.r * 0.82, c.g * 0.82, c.b * 0.82);
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// Vertex colours into the emissive, so the bands glow in their own colours.
export function glowRibbonMaterial({ glow = 0.55, metal = 0.2, rough = 0.4, opacity = 1 } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, metalness: metal, roughness: rough, transparent: opacity < 1, opacity });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor.rgb * ${glow.toFixed(3)};`
    );
  };
  return m;
}

// --- confetti and sparkle --------------------------------------------------
// Instanced paper bits that fall and flutter across the whole frame.
export function confetti(B, { count = 400, colors = ["#39ff14", "#ffffff", "#ffd400"], area = [16, 26, 6], center = [0, 0, 0], size = 0.16, speed = 1 } = {}) {
  const geo = B.add(new THREE.PlaneGeometry(size, size * 0.55));
  const mat = B.add(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }));
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  const seeds = [];
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    seeds.push({
      x: (Math.random() - 0.5) * area[0],
      y: Math.random() * area[1],
      z: (Math.random() - 0.5) * area[2],
      v: (0.9 + Math.random() * 1.6) * speed,
      w: Math.random() * 6.28,
      s: 0.6 + Math.random() * 0.9,
      r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      kick: new THREE.Vector3(),
    });
    mesh.setColorAt(i, c.set(colors[i % colors.length]));
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3(1, 1, 1);
  const top = area[1];
  const bottom = center[1] - top / 2;
  return {
    mesh,
    // A burst: everything near `at` is thrown outward.
    burst(at, power = 6) {
      for (const s of seeds) {
        const dx = s.x - at.x;
        const dy = s.cy - at.y;
        const d = Math.hypot(dx, dy) + 0.3;
        if (d < 6) s.kick.set((dx / d) * power * (1 - d / 6), (dy / d) * power * (1 - d / 6) + power * 0.4, 0);
      }
    },
    update(t, dt) {
      for (let i = 0; i < count; i++) {
        const s = seeds[i];
        s.x += s.kick.x * dt;
        s.y += s.kick.y * dt;
        s.kick.multiplyScalar(Math.pow(0.05, dt));
        const fall = (((s.y - t * s.v) % top) + top) % top;
        s.cy = bottom + fall;
        p.set(center[0] + s.x + Math.sin(t * s.s + s.w) * 0.5, s.cy, center[2] + s.z + Math.cos(t * s.s * 0.7 + s.w) * 0.3);
        s.r.x += dt * 2.4 * s.s;
        s.r.y += dt * 1.7 * s.s;
        q.setFromEuler(s.r);
        mesh.setMatrixAt(i, m4.compose(p, q, sc));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// Points of light drifting (a field of stars, dust in the lights).
export function sparkle(B, { count = 500, area = [20, 30, 12], color = "#ffffff", size = 0.08, drift = 0.3, center = [0, 0, 0] } = {}) {
  const geo = B.add(new THREE.BufferGeometry());
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = center[0] + (Math.random() - 0.5) * area[0];
    pos[i * 3 + 1] = center[1] + (Math.random() - 0.5) * area[1];
    pos[i * 3 + 2] = center[2] + (Math.random() - 0.5) * area[2];
    seed[i] = Math.random() * 6.28;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
  const mat = B.add(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { t: { value: 0 }, color: { value: new THREE.Color(color) }, size: { value: size * 300 }, drift: { value: drift } },
      vertexShader: `uniform float t; uniform float size; uniform float drift; attribute float seed; varying float vA;
        void main(){ vec3 p = position; p.y += sin(t*0.6+seed*3.0)*drift; p.x += cos(t*0.5+seed*2.0)*drift;
          vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv;
          vA = 0.45+0.55*sin(t*2.2+seed*7.0); gl_PointSize = size*(0.6+0.4*vA)/-mv.z; }`,
      fragmentShader: `uniform vec3 color; varying float vA;
        void main(){ vec2 d = gl_PointCoord-0.5; float r = length(d); if(r>0.5) discard;
          float a = smoothstep(0.5,0.0,r); gl_FragColor = vec4(color*1.6, a*a*vA); }`,
    })
  );
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, update: (t) => (mat.uniforms.t.value = t) };
}

// --- the racing car (Kenney Racing Kit, CC0), painted ----------------------
let carTemplate = null;
export function loadCar() {
  if (!carTemplate) {
    carTemplate = new GLTFLoader()
      .loadAsync(new URL("models/raceCar.glb", document.baseURI).href)
      .then((g) => g.scene)
      .catch(() => null);
  }
  return carTemplate;
}
export async function paintedCar(color) {
  const tpl = await loadCar();
  if (!tpl) return null;
  const car = tpl.clone(true);
  const paint = new THREE.Color(color);
  car.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.material?.name || "").toLowerCase();
    const m = o.material.clone();
    if (/main|body|paint|car/.test(name) || (m.color && m.color.getHSL({}).s > 0.35)) {
      m.color = paint.clone();
      m.metalness = 0.45;
      m.roughness = 0.3;
    }
    o.material = m;
  });
  return car;
}

// --- framing ---------------------------------------------------------------
// Put the camera where a box `w` x `h` (world units, around `center`) fills
// `wFrac` of the frame's width or `hFrac` of its height, whichever is
// tighter, looking along `dir`, and sitting `ndcY` up from the middle of the
// screen (the words take the top and the bottom of a phone).
const _t = new THREE.Vector3();
// Where the words leave room, as fractions of the frame's height from the
// top ({ top, bottom }), when the page can say (the slide's free space).
let bandOf = null;
export function setBand(fn) {
  bandOf = fn;
}
export function frameBox(camera, aspect, { center = new THREE.Vector3(), w = 4, h = 4, dir = new THREE.Vector3(0, 0.25, 1), wFrac = 0.9, hFrac = 0.42, ndcY = 0.14 } = {}) {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // Fit the free space between the words, on a short screen too.
  const band = bandOf?.();
  if (band && band.bottom - band.top > 0.12) {
    hFrac = Math.min(hFrac, (band.bottom - band.top) * 0.92);
    ndcY = 1 - (band.top + band.bottom);
  }
  const d = Math.max(h / (2 * t * hFrac), w / (2 * t * aspect * wFrac));
  _t.copy(dir).normalize();
  camera.position.copy(center).addScaledVector(_t, d);
  // Look a little below the box so it sits higher on the screen.
  camera.lookAt(center.x, center.y - ndcY * d * t, center.z);
  return d;
}

// --- interaction -----------------------------------------------------------
// Spin with inertia: drag sets the speed, letting go lets it coast.
export function spinner({ friction = 2.2, idle = 0.25 } = {}) {
  let v = 0;
  let a = 0;
  let held = false;
  return {
    get angle() {
      return a;
    },
    drag(dx) {
      held = true;
      v = dx * 0.012 * 60;
      a += dx * 0.012;
    },
    release() {
      held = false;
    },
    update(dt) {
      if (!held) {
        a += v * dt;
        v += (idle - v) * Math.min(1, friction * dt);
      }
      held = false;
      return a;
    },
  };
}
