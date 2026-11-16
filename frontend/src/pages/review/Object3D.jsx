// The moving 3D objects of the season story, the way Wrapped sets a solid,
// lit object on a flat coloured slide: a circuit lying in space as a thick
// band that turns slowly while a dot laps it, medals that drop in and spin,
// a trophy. Each one is drawn in the slide's own colours (the --g-* values
// of review/wrapPalette.js), so it belongs to the slide it is on.
//
// One small three.js scene per object, made when the slide comes in and
// thrown away when it goes. Holding the story (review/Story.jsx sets
// .st-paused on the frame) stops the clock; a viewer who asked for less
// motion gets the finished frame; without WebGL the slide shows its flat
// drawing instead (`fallback`).
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { circuitFor } from "../../data/circuits.js";
import { motionOff } from "../../hooks/motion.js";

const GOLD = 0xf2c14e;
const SILVER = 0xd9dde4;
const BRONZE = 0xc98143;
export const MEDAL_METAL = [GOLD, SILVER, BRONZE];

let webgl = null;
export function has3D() {
  if (webgl != null) return webgl;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    webgl = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeBack = (x) => {
  const p = clamp01(x) - 1;
  return 1 + 2.4 * p * p * p + 1.4 * p * p;
};

// --- the circuit ----------------------------------------------------------------------

// A circuit's outline (data/circuits.js) as a closed curve on the ground:
// centred, its long side turned along x and scaled into a circle of radius 1,
// so a long thin track like Jeddah is as big as a round one.
function circuitCurve(track) {
  const c = circuitFor(track);
  if (!c?.path) return null;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("style", "position:absolute;width:0;height:0;visibility:hidden");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", c.path);
  svg.appendChild(path);
  document.body.appendChild(svg);
  let pts = [];
  try {
    const len = path.getTotalLength();
    const n = 320;
    for (let i = 0; i < n; i += 1) {
      const p = path.getPointAtLength((len * i) / n);
      pts.push([p.x, p.y]);
    }
  } catch {
    pts = [];
  } finally {
    svg.remove();
  }
  if (pts.length < 8) return null;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  pts = pts.map(([x, y]) => [x - cx, y - cy]);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const a = -0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  pts = pts.map(([x, y]) => [x * ca - y * sa, x * sa + y * ca]);
  const r = Math.max(...pts.map(([x, y]) => Math.hypot(x, y))) || 1;
  return new THREE.CatmullRomCurve3(
    pts.map(([x, y]) => new THREE.Vector3(x / r, 0, y / r)),
    true,
    "centripetal",
  );
}

function shadowGround(scene, size = 7, opacity = 0.2) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.ShadowMaterial({ opacity }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  return ground;
}

function keyLight(scene, at = [1.6, 4, 2.2], span = 1.8) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(...at);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 4;
  Object.assign(key.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.5, far: 12 });
  scene.add(key);
  return key;
}

// A flat band along a closed curve, w wide and h tall: a road surface and
// its two walls, with sharp edges between them. It is built station by
// station, so drawing the first part of the index draws the first part of
// the lap.
function ribbonGeometry(curve, n, w, h) {
  const pts = curve.getSpacedPoints(n);
  const pos = [];
  const idx = [];
  for (let i = 0; i <= n; i += 1) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    const sx = (-tz / len) * (w / 2);
    const sz = (tx / len) * (w / 2);
    const p = pts[i % n];
    const L = [p.x + sx, p.z + sz];
    const R = [p.x - sx, p.z - sz];
    pos.push(L[0], h, L[1], R[0], h, R[1], L[0], h, L[1], L[0], 0, L[1], R[0], h, R[1], R[0], 0, R[1]);
  }
  for (let i = 0; i < n; i += 1) {
    const a = i * 6;
    const b = (i + 1) * 6;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
    idx.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3);
    idx.push(a + 4, b + 4, a + 5, a + 5, b + 4, b + 5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// The circuit as a thick band lying in space: it draws itself, a dot in the
// slide's accent laps it with a short trail, and the whole thing turns.
function trackThing({ scene, camera, pal, data }) {
  const curve = circuitCurve(data?.track);
  if (!curve) return null;
  keyLight(scene);
  shadowGround(scene).position.y = -0.06;

  const group = new THREE.Group();
  scene.add(group);
  const geo = ribbonGeometry(curve, 1200, 0.038, 0.022);
  const band = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: pal.pop, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide }));
  band.castShadow = true;
  group.add(band);
  const total = geo.index.count;

  const carMat = new THREE.MeshStandardMaterial({ color: pal.fg, emissive: pal.fg, emissiveIntensity: 0.25, roughness: 0.3 });
  // The dot and a thin trail behind it that fades out.
  const trail = Array.from({ length: 12 }, (_, k) => {
    const mat = k === 0 ? carMat : new THREE.MeshBasicMaterial({ color: pal.fg, transparent: true, opacity: 0.55 * (1 - k / 12) });
    const m = new THREE.Mesh(new THREE.SphereGeometry(k === 0 ? 0.04 : 0.018, 20, 14), mat);
    m.castShadow = k === 0;
    m.visible = false;
    group.add(m);
    return m;
  });

  const ELEV = 0.9;
  const fit = (cam, aspect) => {
    const r = 1.04;
    const tv = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const th = tv * aspect;
    const d = Math.max(r / th, (r * Math.sin(ELEV) + 0.25) / tv) * 1.02;
    cam.position.set(0, Math.sin(ELEV) * d, Math.cos(ELEV) * d);
    cam.lookAt(0, -0.02, 0);
  };
  const p = new THREE.Vector3();
  const update = (t) => {
    const draw = easeOut(t / 1.8);
    geo.setDrawRange(0, Math.max(0, Math.floor((total * draw) / 18) * 18));
    // It sways rather than spins, so a long thin circuit is never seen end on.
    group.rotation.y = Math.sin(t * 0.32) * 0.55;
    group.rotation.z = Math.sin(t * 0.21) * 0.05;
    const s = 0.9 + 0.1 * easeOut(t / 1.2);
    group.scale.setScalar(s);
    const lap = t > 1.6 ? ((t - 1.6) * 0.075) % 1 : 0;
    trail.forEach((m, k) => {
      m.visible = t > 1.6;
      curve.getPointAt((lap - k * 0.007 + 1) % 1, p);
      m.position.set(p.x, k === 0 ? 0.06 : 0.04, p.z);
    });
  };
  return { fit, update, still: 6 };
}

// --- medals ---------------------------------------------------------------------------------

function medalFace(metal, text) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d");
  const base = new THREE.Color(metal);
  const css = (col, f) => `#${col.clone().multiplyScalar(f).getHexString()}`;
  const grad = g.createRadialGradient(200, 180, 30, 256, 256, 300);
  grad.addColorStop(0, css(base, 1.12));
  grad.addColorStop(1, css(base, 0.86));
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.lineWidth = 22;
  g.strokeStyle = css(base, 0.7);
  g.beginPath();
  g.arc(256, 256, 214, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = css(base, 0.55);
  g.font = "900 200px Montserrat, Inter, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 268);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // The cap of a cylinder lies a quarter turn off once the coin is stood up.
  tex.center.set(0.5, 0.5);
  tex.rotation = Math.PI / 2;
  return tex;
}

// One medal a podium, in a grid that matches the labels the slide sets
// under it (`cols` columns): each drops in, spins and settles facing out.
function medalsThing({ scene, data, setCamera }) {
  const places = data?.places || [];
  if (!places.length) return null;
  const cols = data.cols || Math.min(4, places.length);
  const rows = Math.ceil(places.length / cols);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  cam.position.set(0, 0, 10);
  setCamera(cam);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x333333, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-2, 3, 5);
  scene.add(key);

  const coins = places.map((pos, k) => {
    const metal = MEDAL_METAL[pos - 1] ?? GOLD;
    const face = medalFace(metal, `P${pos}`);
    const side = new THREE.MeshStandardMaterial({ color: metal, metalness: 1, roughness: 0.26 });
    const front = new THREE.MeshStandardMaterial({ map: face, metalness: 0.9, roughness: 0.3 });
    const geo = new THREE.CylinderGeometry(1, 1, 0.16, 72);
    const m = new THREE.Mesh(geo, [side, front, front]);
    m.rotation.x = Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(m);
    scene.add(holder);
    return { holder, k, col: k % cols, row: Math.floor(k / cols) };
  });

  let cell = 1;
  const fit = (_c, aspect) => {
    const w = cols;
    const h = w / aspect;
    Object.assign(cam, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
    cam.updateProjectionMatrix();
    cell = h / rows;
    const r = Math.min(0.4, cell * 0.42);
    for (const c of coins) {
      c.holder.scale.setScalar(r);
      c.holder.userData.x = -w / 2 + 0.5 + c.col;
      c.holder.userData.y = h / 2 - cell * (c.row + 0.5);
    }
  };
  const update = (t) => {
    for (const c of coins) {
      const local = t - c.k * 0.18;
      const drop = easeBack(local / 0.7);
      c.holder.position.set(c.holder.userData.x ?? 0, (c.holder.userData.y ?? 0) + (1 - drop) * cell * 1.6, 0);
      c.holder.visible = local > 0;
      const spin = (1 - easeOut(local / 1.6)) * Math.PI * 4;
      c.holder.rotation.y = spin + Math.sin(t * 1.1 + c.k) * 0.32;
      c.holder.rotation.x = Math.sin(t * 0.8 + c.k * 0.7) * 0.12;
    }
  };
  return { fit, update, still: 6 };
}

// --- the trophy -----------------------------------------------------------------------------

// The league's trophy (public/models/trophy, CC0): polished gold on a dark
// base, rising into place and then turning slowly, nothing else around it.
// The model comes faceted; its normals are smoothed so the cup reads as
// polished metal rather than a low-poly toy.
function trophyThing({ scene }) {
  keyLight(scene, [1.4, 3.5, 2.4], 1.4);
  shadowGround(scene, 6, 0.18);
  const group = new THREE.Group();
  scene.add(group);
  const ready = new GLTFLoader().loadAsync("/models/trophy/trophy.glb").then((gltf) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const n = o.name.toLowerCase();
      const metal = n.includes("cup") || n.includes("plate");
      if (metal) {
        o.geometry.deleteAttribute("normal");
        const smooth = mergeVertices(o.geometry, 1e-4);
        smooth.computeVertexNormals();
        o.geometry = smooth;
      }
      o.material = n.includes("cup")
        ? new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.16 })
        : n.includes("plate")
          ? new THREE.MeshStandardMaterial({ color: SILVER, metalness: 1, roughness: 0.25 })
          : new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0.1, roughness: 0.55 });
    });
    group.add(gltf.scene);
  });
  const fit = (cam, aspect) => {
    const tv = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const d = Math.max(0.68 / tv, 0.62 / (tv * aspect));
    cam.position.set(0, 0.62 + d * 0.22, d);
    cam.lookAt(0, 0.5, 0);
  };
  const update = (t) => {
    const rise = easeOut(t / 1.1);
    group.scale.setScalar(0.92 + 0.08 * rise);
    group.position.y = (1 - rise) * -0.12;
    group.visible = t > 0;
    group.rotation.y = -0.5 + t * 0.32;
  };
  return { fit, update, still: 5, ready };
}
const THINGS = { track: trackThing, medals: medalsThing, trophy: trophyThing };

export default function Object3D({ kind, data, delay = 0, className = "", style, fallback = null, label }) {
  const box = useRef(null);
  const [failed, setFailed] = useState(() => !has3D());
  const key = JSON.stringify(data ?? null);

  useEffect(() => {
    if (failed) return undefined;
    const el = box.current;
    if (!el) return undefined;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return undefined;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral keeps the slide colours as they are; ACES washed them out.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    el.appendChild(canvas);

    const css = getComputedStyle(el);
    const colour = (name, fb) => {
      const v = css.getPropertyValue(name).trim();
      return new THREE.Color(/^#[0-9a-f]{3,8}$/i.test(v) ? v.slice(0, 7) : fb);
    };
    const pal = { fg: colour("--g-fg", "#f6f5f1"), bg: colour("--g-bg", "#0b0b0c"), pop: colour("--g-pop", "#f4afc6"), mark: colour("--g-mark", "#f4afc6") };
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    const scene = new THREE.Scene();
    scene.environment = env;
    let camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    const thing = THINGS[kind]?.({ scene, camera, pal, data: JSON.parse(key), setCamera: (c) => (camera = c) });
    const textures = [];
    // Nothing to draw (a circuit without an outline on file): the flat
    // drawing instead.
    if (!thing) {
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      setFailed(true);
      return undefined;
    }

    const still = motionOff();
    let raf = 0;
    let t = 0;
    let last = performance.now();
    const start = last + delay;
    const draw = (time) => {
      thing?.update(time);
      renderer.render(scene, camera);
    };
    const size = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, r.width);
      const h = Math.max(1, r.height);
      renderer.setSize(w, h, false);
      if (camera.isPerspectiveCamera) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      thing?.fit?.(camera, w / h);
      if (still) draw(thing?.still ?? 6);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (now >= start && !el.closest(".st-paused")) t += dt;
      draw(t);
      raf = requestAnimationFrame(frame);
    };
    if (still) draw(thing?.still ?? 6);
    else raf = requestAnimationFrame(frame);
    let gone = false;
    thing?.ready?.then(() => !gone && still && draw(thing.still ?? 6)).catch(() => {});

    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          if (m.map) textures.push(m.map);
          m.dispose();
        }
      });
      textures.forEach((x) => x.dispose());
      env.dispose();
      pmrem.dispose();
      room.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [kind, key, delay, failed]);

  if (failed) return fallback;
  return <div ref={box} className={`relative ${className}`} style={style} role="img" aria-label={label} />;
}
