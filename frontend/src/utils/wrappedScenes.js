// ---------------------------------------------------------------------------
// Season Wrapped's 3D: the scenes behind the story's slides
// (components/WrappedStory.jsx). Loaded only when a story is opened, so the
// rest of the site never carries three.js for it.
//
// One renderer for the whole story, one scene at a time. The story owns the
// clock: it calls render(t) with the seconds its slide has been on screen, so
// pausing the story pauses the scene, going back replays it from the start,
// and a reduced-motion viewer gets each scene's finished frame instead.
//
// Everything is drawn on a transparent canvas over the slide's own colour,
// and the fog is that colour too, so the far end of a scene fades into the
// slide instead of stopping at an edge. Scenes are built for a tall frame (a
// phone held upright): the slide's words sit at the top and the bottom, the
// subject in the band between.
//
// The car is the replay's (utils/raceCarModel.js) in the driver's team colour;
// the field around it is the same car in grey, drawn as instances so a full
// grid costs a dozen draw calls rather than hundreds. Circuits are the real
// outlines the site already draws in 2D (data/circuits.js), laid flat.
// ---------------------------------------------------------------------------
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { loadRaceCar, CAR_PAINT } from "./raceCarModel.js";
import { circuitFor } from "../data/circuits.js";

// The same switch the replay sets (utils/lapViewer3d.js): colours are used as
// written, with no conversion either way. Set here too, so it does not matter
// which of the two a visitor opens first.
THREE.ColorManagement.enabled = false;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, k) => a + (b - a) * k;
const span = (t, a, b) => clamp01((t - a) / (b - a));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutBack = (x) => {
  const c1 = 1.6;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

const GOLD = 0xf5c542;
const SILVER = 0xdfe3ea;
const BRONZE = 0xd08a4c;
const FIELD_GREY = 0x5f6672;
const ASPHALT = 0x23262d;

// --- small builders -------------------------------------------------------------

// Everything a scene makes, so switching scenes frees it again. The car model
// itself is never in here: it is shared with the replay and stays loaded.
function makeBag() {
  const items = [];
  return {
    add(x) {
      items.push(x);
      return x;
    },
    dispose() {
      for (const x of items) x?.dispose?.();
      items.length = 0;
    },
  };
}

// The car's materials, in one colour.
function carMaterials(bag, paint) {
  return {
    [CAR_PAINT]: bag.add(new THREE.MeshStandardMaterial({ color: paint, metalness: 0.45, roughness: 0.3 })),
    glass: bag.add(new THREE.MeshStandardMaterial({ color: 0x0b0f17, metalness: 0.6, roughness: 0.15 })),
    carTire: bag.add(new THREE.MeshStandardMaterial({ color: 0x1c1c21, metalness: 0, roughness: 0.85 })),
    grey: bag.add(new THREE.MeshStandardMaterial({ color: 0xd9dce3, metalness: 0.5, roughness: 0.35 })),
  };
}

// A stand-in for the rare page that cannot load the model: a few boxes the
// right size, so the scene still has a car in it.
function standInCar(mats) {
  const g = new THREE.Group();
  const body = mats[CAR_PAINT];
  const dark = mats.carTire;
  const box = (w, h, d, m, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
  };
  box(2.6, 0.4, 0.75, body, 0.1, 0.35, 0);
  box(1.3, 0.25, 0.38, body, 1.9, 0.28, 0);
  box(0.5, 0.06, 1.7, body, 2.45, 0.12, 0);
  box(1.5, 0.34, 1.25, body, -0.45, 0.3, 0);
  box(0.4, 0.06, 1.0, body, -2.0, 0.9, 0);
  for (const [x, z] of [[1.55, 0.72], [1.55, -0.72], [-1.45, 0.72], [-1.45, -0.72]]) box(0.66, 0.66, 0.34, dark, x, 0.33, z);
  return g;
}

// Where the story shows the real car in its films (spec.marker), the scenes
// in between mark the driver with a light in the team's colour rather than a
// model that would not match it.
function markerCar(mats, bag) {
  const g = new THREE.Group();
  const paint = mats[CAR_PAINT].color;
  const core = new THREE.Mesh(
    bag.add(new THREE.SphereGeometry(0.42, 32, 16)),
    bag.add(new THREE.MeshBasicMaterial({ color: paint.clone().lerp(new THREE.Color(0xffffff), 0.55) }))
  );
  core.position.y = 0.6;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  const grad = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `#${paint.getHexString()}ff`);
  grad.addColorStop(0.35, `#${paint.getHexString()}88`);
  grad.addColorStop(1, `#${paint.getHexString()}00`);
  x.fillStyle = grad;
  x.fillRect(0, 0, 128, 128);
  const halo = new THREE.Sprite(bag.add(new THREE.SpriteMaterial({ map: bag.add(new THREE.CanvasTexture(c)), blending: THREE.AdditiveBlending, depthWrite: false })));
  halo.scale.setScalar(3.4);
  halo.position.y = 0.6;
  const light = new THREE.PointLight(paint, 6, 9, 2);
  light.position.y = 0.8;
  g.add(core, halo, light);
  return g;
}

// One car, its own colour. Nose along +x, wheels on y = 0.
function paintedCar(ctx, mats, bag) {
  if (ctx.marker) return markerCar(mats, bag);
  if (!ctx.template) return standInCar(mats);
  const car = ctx.template.clone(true);
  car.traverse((o) => {
    if (o.isMesh) o.material = mats[o.material.name] || mats.grey;
  });
  const g = new THREE.Group();
  g.add(car);
  return g;
}

// Many cars in one colour, as instances: one draw call per part of the model
// however many cars there are. `places` are each car's matrix.
function carField(ctx, bag, mats, places) {
  const group = new THREE.Group();
  if (!places.length) return group;
  if (!ctx.template) {
    for (const m of places) {
      const car = standInCar(mats);
      car.applyMatrix4(m);
      group.add(car);
    }
    return group;
  }
  const template = ctx.template;
  template.updateMatrixWorld(true);
  const m = new THREE.Matrix4();
  template.traverse((o) => {
    if (!o.isMesh) return;
    const inst = bag.add(new THREE.InstancedMesh(o.geometry, mats[o.material.name] || mats.grey, places.length));
    places.forEach((place, i) => inst.setMatrixAt(i, m.multiplyMatrices(place, o.matrixWorld)));
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    group.add(inst);
  });
  return group;
}

const placeAt = (x, y, z, yaw = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));

// A soft round texture: a glow, a pool of light, a contact shadow.
function radialTexture(bag, stops, size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) grd.addColorStop(p, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return bag.add(new THREE.CanvasTexture(c));
}

function flatDisc(bag, texture, w, h, { y = 0.01, opacity = 1, additive = false } = {}) {
  const mat = bag.add(
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
  );
  const mesh = new THREE.Mesh(bag.add(new THREE.PlaneGeometry(w, h)), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

// The dark patch under a car that sits it on the ground.
function contactShadow(bag, scale = 1) {
  const tex = radialTexture(bag, [
    [0, "rgba(0,0,0,0.55)"],
    [0.55, "rgba(0,0,0,0.25)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  return flatDisc(bag, tex, 6.4 * scale, 3.2 * scale, { y: 0.015 });
}

const cssColor = (c) => `#${new THREE.Color(c).getHexString()}`;

// A word on a pill that always faces the camera ("P4"). The canvas keeps one
// size, so changing the word is a redraw rather than a new texture.
function textSprite(bag, text, { fg = "#ffffff", bg = "rgba(10,10,18,0.78)", height = 1.6 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 160;
  const g = canvas.getContext("2d");
  const tex = bag.add(new THREE.CanvasTexture(canvas));
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = bag.add(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 10;
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  let shown = null;
  const set = (word) => {
    if (word === shown) return;
    shown = word;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.font = "900 104px Archivo, Inter, system-ui, sans-serif";
    const w = Math.min(canvas.width - 8, g.measureText(word).width + 64);
    const x = (canvas.width - w) / 2;
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect?.(x, 14, w, 132, 66);
    if (!g.roundRect) g.rect(x, 14, w, 132);
    g.fill();
    g.fillStyle = fg;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(word, canvas.width / 2, 86);
    tex.needsUpdate = true;
  };
  set(text);
  return { sprite, set };
}

// A flat strip along a line of points: a road, a racing line. `sideAt(i)`
// is the unit vector across the strip at point i.
function ribbonGeometry(points, sideAt, width, { closed = false, lift = 0 } = {}) {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  let run = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const s = sideAt(i);
    if (i > 0) run += p.distanceTo(points[i - 1]);
    for (const [k, sign] of [[0, -1], [1, 1]]) {
      pos[(i * 2 + k) * 3] = p.x + s.x * (width / 2) * sign;
      pos[(i * 2 + k) * 3 + 1] = p.y + s.y * (width / 2) * sign + lift;
      pos[(i * 2 + k) * 3 + 2] = p.z + s.z * (width / 2) * sign;
      uv[(i * 2 + k) * 2] = k;
      uv[(i * 2 + k) * 2 + 1] = run;
    }
  }
  const idx = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Where a camera has to stand to see a box `w` wide and `h` tall, whole.
function fitDistance(camera, w, h, aspect = camera.aspect) {
  const v = THREE.MathUtils.degToRad(camera.fov) / 2;
  const hz = Math.atan(Math.tan(v) * aspect);
  return Math.max(h / 2 / Math.tan(v), w / 2 / Math.tan(hz));
}

// The same, for the part of the frame a scene's subject has: the band between
// the words in the tall layout (`vs` of the height), the right of the screen
// in the wide one (ctx.hShare of the width, the picture shifted over by the
// stage, see draw()). `hs` is how much of that width the subject may take.
function fit(ctx, camera, w, h, { hs = 1, vs = ctx.vShare } = {}) {
  return fitDistance(camera, w / hs, h / vs, ctx.aspect * ctx.hShare);
}

function lights(scene, { key = 0xffffff, rim = 0xffffff, rimStrength = 1.4 } = {}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1d2230, 1.1));
  const k = new THREE.DirectionalLight(key, 2.2);
  k.position.set(6, 12, 8);
  scene.add(k);
  const r = new THREE.DirectionalLight(rim, rimStrength);
  r.position.set(-8, 5, -10);
  scene.add(r);
  return { key: k, rim: r };
}

function baseScene(ctx, spec, { fogNear = 40, fogFar = 160 } = {}) {
  const scene = new THREE.Scene();
  scene.environment = ctx.env;
  if (spec.bg) scene.fog = new THREE.Fog(new THREE.Color(spec.bg), fogNear, fogFar);
  const camera = new THREE.PerspectiveCamera(42, ctx.aspect, 0.1, 2000);
  return { scene, camera };
}

// Falling paper in a few colours; positions worked out from t, so a paused
// story holds every piece where it is.
function confetti(bag, colors, { count = 260, area = 16, top = 16, from = 0 } = {}) {
  const geo = bag.add(new THREE.BufferGeometry());
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const seed = [];
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    seed.push({ x: (Math.random() - 0.5) * area, z: (Math.random() - 0.5) * area * 0.6, y: Math.random() * top, v: 2.2 + Math.random() * 2.4, w: Math.random() * 6.28, a: 0.4 + Math.random() * 0.9 });
    c.set(colors[i % colors.length]);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = bag.add(new THREE.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, depthWrite: false }));
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const update = (t) => {
    const k = t - from;
    points.visible = k > 0;
    if (k <= 0) return;
    for (let i = 0; i < count; i++) {
      const s = seed[i];
      const fall = (s.y + top - k * s.v) % top;
      const y = (fall < 0 ? fall + top : fall) + 0.2;
      pos[i * 3] = s.x + Math.sin(k * s.a + s.w) * 0.6;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = s.z + Math.cos(k * s.a * 0.7 + s.w) * 0.4;
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = Math.min(1, k * 2);
  };
  return { points, update };
}

// --- the scenes -------------------------------------------------------------------
// Each builder returns { scene, camera, update(t), still, dispose() }. `still`
// is the moment that tells the scene on its own, for reduced motion and for
// the summary card's picture.

// The driver's car on a turntable: a close look that pulls back to the whole
// car, the light sweeping over the paint.
function introScene(ctx, spec) {
  const bag = makeBag();
  const { scene, camera } = baseScene(ctx, spec, { fogNear: 20, fogFar: 60 });
  camera.fov = 38;
  const { key } = lights(scene, { rim: spec.paint, rimStrength: 2.4 });
  const car = paintedCar(ctx, carMaterials(bag, spec.paint), bag);
  scene.add(car);
  scene.add(contactShadow(bag, 1.05));
  // A pool of the team's colour under the car, and a wider pool of light.
  scene.add(
    flatDisc(
      bag,
      radialTexture(bag, [
        [0, `${cssColor(spec.paint)}88`],
        [1, `${cssColor(spec.paint)}00`],
      ]),
      12,
      12,
      { y: 0.01, additive: true }
    )
  );
  scene.add(
    flatDisc(
      bag,
      radialTexture(bag, [
        [0, "rgba(255,255,255,0.10)"],
        [1, "rgba(255,255,255,0)"],
      ]),
      34,
      34,
      { y: 0.005 }
    )
  );
  const target = new THREE.Vector3(0, 1.1, 0);
  const update = (t) => {
    camera.aspect = ctx.aspect;
    camera.updateProjectionMatrix();
    // Nose towards the camera at first, turning to show its side; a front
    // three-quarter view at `still`, the frame the summary card's picture uses.
    car.rotation.y = -1.53 + t * 0.32;
    const far = fit(ctx, camera, 5.4, 3.4, { vs: 1 });
    const d = lerp(far * 0.5, far, easeOut(span(t, 0, 2.8)));
    const h = lerp(0.7, 2.1, easeOut(span(t, 0, 2.8)));
    camera.position.set(Math.sin(0.35) * d, h, Math.cos(0.35) * d);
    camera.lookAt(target);
    // The light walks round the car, a highlight sliding along the paint.
    key.position.set(Math.cos(t * 0.6) * 9, 11, Math.sin(t * 0.6) * 9);
  };
  return { scene, camera, update, still: 3.4, dispose: () => bag.dispose() };
}

// --- circuits ---

// The outline of a circuit as points on the ground, an even step apart, the
// long side running away from the camera on a phone (a tall frame) and across
// the screen on a computer (a wide one).
function circuitPoints(track, count = 420, wide = false) {
  const c = circuitFor(track);
  let raw = [];
  if (c?.path) {
    const nums = (c.path.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) raw.push([nums[i], nums[i + 1]]);
  }
  if (raw.length < 8) {
    // No outline on file: a generic circuit, a long oval with a kink.
    raw = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const kink = Math.exp(-Math.pow((a - 4.2) * 2.2, 2)) * 0.25;
      raw.push([Math.cos(a) * (0.55 - kink) * 100, Math.sin(a) * 1.0 * 100]);
    }
  }
  // Centre, and stand it up: the longer side along z.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of raw) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const turn = wide ? maxY - minY > (maxX - minX) * 1.1 : maxX - minX > (maxY - minY) * 1.1;
  const scale = 200 / Math.max(maxX - minX, maxY - minY);
  let pts = raw.map(([x, y]) => {
    const px = (x - cx) * scale;
    const pz = (y - cy) * scale;
    return turn ? new THREE.Vector3(-pz, 0, px) : new THREE.Vector3(px, 0, pz);
  });
  // Even spacing round the loop.
  const loop = [...pts, pts[0]];
  const cum = [0];
  for (let i = 1; i < loop.length; i++) cum.push(cum[i - 1] + loop[i].distanceTo(loop[i - 1]));
  const total = cum[cum.length - 1];
  const even = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const d = (i / count) * total;
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const k = (d - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    even.push(loop[j].clone().lerp(loop[j + 1], k));
  }
  // Smooth the corners a little (the outlines are polylines off a map).
  for (let pass = 0; pass < 3; pass++) {
    even.splice(0, even.length, ...even.map((p, i) => p.clone().add(even[(i + count - 1) % count]).add(even[(i + 1) % count]).multiplyScalar(1 / 3)));
  }
  pts = even;
  // Curvature at each point (turn per metre), for the kerbs and the speed.
  const curv = pts.map((p, i) => {
    const a = pts[(i + count - 2) % count];
    const b = pts[(i + 2) % count];
    const d1 = p.clone().sub(a).normalize();
    const d2 = b.clone().sub(p).normalize();
    const ang = Math.acos(Math.min(1, Math.max(-1, d1.dot(d2))));
    return ang / Math.max(1e-3, a.distanceTo(b));
  });
  // The line goes on the longest straight, three quarters of the way down it,
  // where real start lines tend to be.
  let best = { len: 0, end: 0 };
  let run = 0;
  for (let i = 0; i < count * 2; i++) {
    if (curv[i % count] < 0.012) {
      run += 1;
      if (run > best.len) best = { len: run, end: i };
    } else run = 0;
  }
  const start = (best.end - Math.floor(best.len * 0.25) + count) % count;
  const rot = (arr) => [...arr.slice(start), ...arr.slice(0, start)];
  return { points: rot(pts), curv: rot(curv) };
}

// A lap of the circuit the best result came at: the circuit painted flat on
// the ground (road, white edges, red and white kerbs in the corners, the
// chequered line), the driver's line drawn in behind the car on top of it, and
// the line crossed at the end. Painted rather than modelled: on a circuit laid
// out this small, two parts of the track can run closer than a road is wide,
// and stacked strips of road would flicker through each other where they meet.
function circuitScene(ctx, spec) {
  const bag = makeBag();
  const { scene, camera } = baseScene(ctx, spec, { fogNear: 260, fogFar: 700 });
  camera.fov = 40;
  camera.near = 2;
  lights(scene, { rim: spec.paint, rimStrength: 1.2 });
  const { points, curv } = circuitPoints(spec.track, 420, !!spec.wide);
  const n = points.length;
  const tangents = points.map((p, i) => points[(i + 1) % n].clone().sub(points[(i + n - 1) % n]).normalize());
  const up = new THREE.Vector3(0, 1, 0);
  const sides = tangents.map((t) => new THREE.Vector3().crossVectors(up, t).normalize());

  const ROAD = 6.5;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const centre = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const S = Math.max(maxX - minX, maxZ - minZ) + 40;
  const SIZE = 2048;
  const px = (v) => ((v + S / 2) / S) * SIZE;
  const ppm = SIZE / S;
  const cv = document.createElement("canvas");
  cv.width = cv.height = SIZE;
  const g = cv.getContext("2d");
  g.lineJoin = "round";
  g.lineCap = "round";
  const trace = (from = 0, to = n) => {
    g.beginPath();
    for (let i = from; i <= to; i++) {
      const p = points[i % n];
      const x = px(p.x - centre.x);
      const y = px(p.z - centre.z);
      if (i === from) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  };
  // White edge band, red and white kerbs over it in the corners, then the road.
  g.strokeStyle = "#f4f5f7";
  g.lineWidth = (ROAD + 1.6) * ppm;
  trace();
  g.closePath();
  g.stroke();
  g.strokeStyle = "#d7263d";
  g.setLineDash([1.6 * ppm, 1.6 * ppm]);
  for (let i = 0; i < n; i++) {
    if (curv[i] <= 0.02) continue;
    let j = i;
    while (j < n && curv[j] > 0.02) j++;
    trace(i, j);
    g.stroke();
    i = j;
  }
  g.setLineDash([]);
  g.strokeStyle = "#23262d";
  g.lineWidth = ROAD * ppm;
  trace();
  g.closePath();
  g.stroke();
  // The chequered line across the road at the start.
  {
    const p = points[0];
    const ang = Math.atan2(tangents[0].z, tangents[0].x);
    g.save();
    g.translate(px(p.x - centre.x), px(p.z - centre.z));
    g.rotate(ang);
    const cell = (ROAD * ppm) / 8;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 8; b++) {
      g.fillStyle = (a + b) % 2 ? "#111" : "#fff";
      g.fillRect(-cell + a * cell, -ROAD * ppm / 2 + b * cell, cell, cell);
    }
    g.restore();
  }
  const map = bag.add(new THREE.CanvasTexture(cv));
  map.anisotropy = ctx.maxAnisotropy || 4;
  const ground = new THREE.Mesh(
    bag.add(new THREE.PlaneGeometry(S, S)),
    bag.add(new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.9, metalness: 0 }))
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(centre.x, 0, centre.z);
  scene.add(ground);

  // The driver's line, revealed behind the car.
  const trailGeo = bag.add(ribbonGeometry(points, (i) => sides[i], 2.2, { closed: true, lift: 0.25 }));
  const trail = new THREE.Mesh(
    trailGeo,
    bag.add(new THREE.MeshBasicMaterial({ color: spec.paint, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
  );
  trail.renderOrder = 2;
  trailGeo.setDrawRange(0, 0);
  scene.add(trail);

  // The car, bigger than life so it reads from up here.
  const CAR = 2;
  const car = paintedCar(ctx, carMaterials(bag, spec.paint), bag);
  car.scale.setScalar(CAR);
  const shadow = contactShadow(bag, CAR);
  scene.add(car, shadow);
  const label = textSprite(bag, `P${spec.position}`, { height: 8 });
  label.sprite.visible = false;
  scene.add(label.sprite);
  const sparks = confetti(bag, [GOLD, 0xffffff, spec.paint], { count: 180, area: 40, top: 26, from: 99 });
  scene.add(sparks.points);

  // Slower through the corners, quicker down the straights: the time each
  // step takes, added up, is where the car is at any moment of the lap.
  const speed = curv.map((k) => Math.max(0.36, 1 / (1 + 14 * k)));
  const smooth = speed.map((_, i) => {
    let sum = 0;
    for (let k = -6; k <= 6; k++) sum += speed[(i + k + n) % n];
    return sum / 13;
  });
  const cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + 1 / smooth[i]);
  const T = cum[n];
  const at = (frac) => {
    const target = clamp01(frac) * T;
    let lo = 0;
    let hi = n;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid;
      else hi = mid;
    }
    return lo + (target - cum[lo]) / Math.max(1e-6, cum[lo + 1] - cum[lo]);
  };

  const LAP = [0.8, 6.9];
  const SWAY = 0.22;
  const update = (t) => {
    camera.aspect = ctx.aspect;
    camera.updateProjectionMatrix();
    const pitch = 0.98;
    // The box the circuit takes up however far the camera has swung (it
    // sways by up to SWAY either way), with room for perspective: the near
    // end of a tilted circuit draws bigger than the far one.
    const W0 = maxX - minX;
    const D0 = maxZ - minZ;
    const w = W0 * Math.cos(SWAY) + D0 * Math.sin(SWAY) + 30;
    const h = (D0 * Math.cos(SWAY) + W0 * Math.sin(SWAY)) * Math.sin(pitch) + 40;
    const d = fit(ctx, camera, w, h, { hs: ctx.wide ? 1 : 0.92, vs: ctx.wide ? 0.95 : ctx.vShare }) * 1.08 * lerp(1.25, 1, easeOut(span(t, 0, 2.2)));
    // The fog starts past the circuit, however far back a wide one puts the
    // camera, so only the ground beyond it fades.
    if (scene.fog) {
      scene.fog.near = d * 1.05;
      scene.fog.far = d * 2.4;
    }
    const yaw = Math.sin(t * 0.22) * SWAY;
    camera.position.set(centre.x + Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, centre.z + Math.cos(yaw) * Math.cos(pitch) * d);
    camera.lookAt(centre);

    const f = span(t, LAP[0], LAP[1]);
    // The last stretch eases off, so the car rolls over the line.
    const lapFrac = f < 0.94 ? f : 0.94 + 0.06 * easeOut((f - 0.94) / 0.06);
    const pos = at(lapFrac);
    const i0 = Math.floor(pos) % n;
    const i1 = (i0 + 1) % n;
    const k = pos - Math.floor(pos);
    const p = points[i0].clone().lerp(points[i1], k);
    const dir = tangents[i0].clone().lerp(tangents[i1], k).normalize();
    car.position.copy(p).setY(0.3);
    car.rotation.y = Math.atan2(-dir.z, dir.x);
    shadow.position.set(p.x, 0.32, p.z);
    shadow.rotation.z = car.rotation.y;
    trailGeo.setDrawRange(0, Math.min(n, Math.floor(pos)) * 6);
    const done = t >= LAP[1];
    label.sprite.visible = done;
    label.sprite.position.copy(p).setY(11);
    if (spec.position <= 3 && done) {
      sparks.points.position.copy(p);
      sparks.update(t - LAP[1] + 0.001);
    } else sparks.points.visible = false;
  };
  return { scene, camera, update, still: 7.6, dispose: () => bag.dispose() };
}

// --- through the field ---

// The biggest climb: a staggered field running in formation, the driver's
// car coming through it from its grid slot to where it finished, its place
// counting down above it.
function climbScene(ctx, spec) {
  const bag = makeBag();
  const { scene, camera } = baseScene(ctx, spec, { fogNear: 60, fogFar: 190 });
  camera.fov = 44;
  lights(scene, { rim: spec.paint });
  const from = Math.max(2, spec.from);
  const to = Math.max(1, Math.min(from - 1, spec.to));
  const GAP = 9;
  const slotZ = (k) => (k - 1) * GAP; // P1 at z = 0, the field behind it towards +z
  const laneX = (k) => (k % 2 ? -2.3 : 2.3);
  const first = Math.max(1, to - 2);
  const last = from + 2;
  // The road, its centre line scrolling by: the whole field is at speed.
  const roadLen = slotZ(last) - slotZ(first) + 160;
  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 256;
  const g = cv.getContext("2d");
  g.fillStyle = "#23262d";
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.fillRect(29, 0, 6, 128);
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.fillRect(0, 0, 3, 256);
  g.fillRect(61, 0, 3, 256);
  const roadTex = bag.add(new THREE.CanvasTexture(cv));
  roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(1, roadLen / 24);
  roadTex.anisotropy = 4;
  const road = new THREE.Mesh(bag.add(new THREE.PlaneGeometry(13, roadLen)), bag.add(new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9 })));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, (slotZ(first) + slotZ(last)) / 2 - 20);
  scene.add(road);
  // The field, noses towards -z (a yaw of a quarter turn).
  const yaw = Math.PI / 2;
  const others = [];
  for (let k = first; k <= last; k++) if (k !== from) others.push(placeAt(laneX(k), 0, slotZ(k), yaw));
  scene.add(carField(ctx, bag, carMaterials(bag, FIELD_GREY), others));
  for (let k = first; k <= last; k++) {
    if (k === from) continue;
    const s = contactShadow(bag);
    s.position.set(laneX(k), 0.015, slotZ(k));
    s.rotation.z = yaw;
    scene.add(s);
  }
  const car = paintedCar(ctx, carMaterials(bag, spec.paint), bag);
  car.rotation.y = yaw;
  const shadow = contactShadow(bag);
  shadow.rotation.z = yaw;
  scene.add(car, shadow);
  const glow = flatDisc(
    bag,
    radialTexture(bag, [
      [0, `${cssColor(spec.paint)}aa`],
      [1, `${cssColor(spec.paint)}00`],
    ]),
    9,
    9,
    { y: 0.02, additive: true }
  );
  scene.add(glow);
  const label = textSprite(bag, `P${from}`, { height: 1.9 });
  scene.add(label.sprite);
  // Streaks of light rushing past both sides of the road: the field is at
  // racing speed, and the driver's car quicker still.
  const STREAKS = 70;
  const streakGeo = bag.add(new THREE.BoxGeometry(0.06, 0.06, 7));
  const streaks = new THREE.InstancedMesh(
    streakGeo,
    bag.add(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })),
    STREAKS
  );
  bag.add(streaks);
  streaks.frustumCulled = false;
  const lanes = Array.from({ length: STREAKS }, (_, i) => ({
    x: (i % 2 ? 1 : -1) * (7.2 + Math.random() * 9),
    y: 0.3 + Math.random() * 3.2,
    z: Math.random(),
    v: 0.55 + Math.random() * 0.6,
  }));
  scene.add(streaks);
  const streakSpan = roadLen;
  const streakAt = new THREE.Matrix4();

  // Ahead of the car it finished behind, in the middle of the road.
  const endZ = slotZ(to) - GAP / 2 + 1;
  const MOVE = [1.0, 6.2];
  const update = (t) => {
    camera.aspect = ctx.aspect;
    camera.updateProjectionMatrix();
    roadTex.offset.y = t * 1.6;
    // The streaks run back past the car, quickest while it is overtaking.
    const zBase = road.position.z - streakSpan / 2;
    lanes.forEach((l, i) => {
      const along = (((l.z + t * l.v * 0.35) % 1) + 1) % 1;
      streakAt.makeTranslation(l.x, l.y, zBase + along * streakSpan);
      streaks.setMatrixAt(i, streakAt);
    });
    streaks.instanceMatrix.needsUpdate = true;
    const m = easeInOut(span(t, MOVE[0], MOVE[1]));
    const z = lerp(slotZ(from), endZ, m);
    // Out of its lane into the gap between the two columns, then through.
    const x = lerp(laneX(from), 0, easeInOut(span(t, MOVE[0] - 0.4, MOVE[0] + 0.5)));
    car.position.set(x, 0, z);
    shadow.position.set(x, 0.015, z);
    glow.position.set(x, 0.02, z);
    // Its place, counting down as it passes each car.
    let passed = 0;
    for (let k = to; k < from; k++) if (z < slotZ(k) - 2.5) passed += 1;
    label.set(`P${from - passed}`);
    label.sprite.position.set(x, 3.4, z);
    // The camera rides behind and above, then swings round to the front
    // once the car is through (the place above it has done its job by then).
    const chase = new THREE.Vector3(x + 6, 7.5, z + 17);
    const front = new THREE.Vector3(x - 10, 7, z - 20);
    const s = easeInOut(span(t, MOVE[1] - 0.2, MOVE[1] + 1.4));
    const fade = span(t, MOVE[1] - 0.2, MOVE[1] + 0.5);
    label.sprite.material.opacity = 1 - fade;
    label.sprite.visible = fade < 1;
    camera.position.copy(chase.lerp(front, s));
    camera.lookAt(new THREE.Vector3(x + lerp(0, 1.5, s), 0.8, z + lerp(-14, 4, s)));
  };
  return { scene, camera, update, still: 7.8, dispose: () => bag.dispose() };
}

// --- trophies ---

// A cup, turned on a lathe, with two handles.
function trophy(bag, material) {
  const g = new THREE.Group();
  const profile = [
    [0, 0], [0.46, 0], [0.46, 0.1], [0.3, 0.16], [0.13, 0.22], [0.1, 0.5], [0.15, 0.6], [0.3, 0.68], [0.46, 0.84],
    [0.56, 1.05], [0.6, 1.2], [0.56, 1.2], [0.5, 1.06], [0.4, 0.88], [0.2, 0.76], [0, 0.74],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const cup = new THREE.Mesh(bag.add(new THREE.LatheGeometry(profile, 40)), material);
  g.add(cup);
  const handleGeo = bag.add(new THREE.TorusGeometry(0.2, 0.045, 10, 24, Math.PI * 1.15));
  for (const side of [-1, 1]) {
    const h = new THREE.Mesh(handleGeo, material);
    h.position.set(side * 0.55, 0.92, 0);
    h.rotation.z = side > 0 ? -Math.PI * 0.55 : Math.PI * 1.4;
    g.add(h);
  }
  return g;
}

function trophiesScene(ctx, spec) {
  const bag = makeBag();
  const { scene, camera } = baseScene(ctx, spec, { fogNear: 25, fogFar: 70 });
  camera.fov = 36;
  lights(scene, { rim: 0xffffff, rimStrength: 2 });
  const tones = (spec.tones && spec.tones.length ? spec.tones : ["gold"]).slice(0, 6);
  const metal = (tone) => {
    const color = tone === "gold" ? GOLD : tone === "silver" ? SILVER : tone === "bronze" ? BRONZE : spec.paint;
    return bag.add(new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: 0.2, envMapIntensity: 1.4 }));
  };
  const plinth = bag.add(new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.55, metalness: 0.2 }));
  const plinthGeo = bag.add(new THREE.CylinderGeometry(0.62, 0.7, 0.9, 40));
  const n = tones.length;
  const cols = n <= 3 ? n : Math.ceil(n / 2);
  const rows = Math.ceil(n / cols);
  const items = tones.map((tone, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const col = i - row * cols;
    const x = (col - (inRow - 1) / 2) * 1.9;
    const z = -row * 2.1;
    const y = row * 1.0;
    const base = new THREE.Mesh(plinthGeo, plinth);
    base.position.set(x, y + 0.45, z);
    scene.add(base);
    const cup = trophy(bag, metal(tone));
    cup.position.set(x, y + 0.9, z);
    scene.add(cup);
    return { cup, y: y + 0.9, at: 0.45 + i * 0.32 };
  });
  const sparkle = confetti(bag, [0xffffff, GOLD, 0xfff3c4], { count: 120, area: 8, top: 6, from: 0.6 });
  sparkle.points.material.size = 0.09;
  sparkle.points.material.blending = THREE.AdditiveBlending;
  scene.add(sparkle.points);
  const width = Math.max(4.2, cols * 1.9 + 1.2);
  const height = rows * 1.6 + 1.8;
  const update = (t) => {
    camera.aspect = ctx.aspect;
    camera.updateProjectionMatrix();
    for (const it of items) {
      const k = span(t, it.at, it.at + 0.7);
      const s = k <= 0 ? 0.0001 : easeOutBack(k);
      it.cup.scale.setScalar(Math.max(0.0001, s));
      it.cup.position.y = it.y + (1 - Math.min(1, s)) * -0.4;
      it.cup.rotation.y = (t - it.at) * 0.7;
    }
    sparkle.update(t);
    const d = fit(ctx, camera, width, height, { hs: 0.9, vs: ctx.wide ? 0.72 : 0.55 }) * lerp(1.12, 1, easeOut(span(t, 0, 3)));
    const a = 0.25 + Math.sin(t * 0.3) * 0.12;
    camera.position.set(Math.sin(a) * d, height * 0.55 + 1.6, Math.cos(a) * d);
    camera.lookAt(0, height * 0.32 + 0.4, -(rows - 1));
  };
  return { scene, camera, update, still: 2.4 + n * 0.32, dispose: () => bag.dispose() };
}

// --- the championship as a ride ---

// The season as a ride: a line chart standing up in 3D, one point per round
// as high as the driver stood in the table after it (P1 at the top), a column
// under each, and the car riding the line from the first round to the last
// before the camera steps back for the whole of it.
function journeyScene(ctx, spec) {
  const bag = makeBag();
  const { scene, camera } = baseScene(ctx, spec, { fogNear: 70, fogFar: 220 });
  camera.fov = 40;
  lights(scene, { rim: spec.paint, rimStrength: 1.6 });
  const rounds = spec.journey || [];
  const n = rounds.length;
  const worst = Math.max(...rounds.map((r) => r.position));
  // The chart runs from P1 down to just below the lowest place it needs.
  const bottom = Math.max(6, worst + 1);
  const H = 24;
  const W = spec.wide ? Math.min(46, Math.max(16, (n - 1) * 5.5)) : Math.min(26, Math.max(10, (n - 1) * 4.5));
  const dx = n > 1 ? W / (n - 1) : 0;
  const x0 = -W / 2;
  const yOf = (pos) => 1.5 + ((bottom - pos) / (bottom - 1)) * H;
  const pts = rounds.map((r, i) => new THREE.Vector3(x0 + i * dx, yOf(r.position), 0));
  const curve = new THREE.CatmullRomCurve3(
    [pts[0].clone().add(new THREE.Vector3(-2.5, 0, 0)), ...pts, pts[n - 1].clone().add(new THREE.Vector3(2.5, 0, 0))],
    false,
    "centripetal"
  );
  const R = 0.42;
  const tube = new THREE.Mesh(
    bag.add(new THREE.TubeGeometry(curve, Math.max(160, n * 24), R, 12, false)),
    bag.add(new THREE.MeshStandardMaterial({ color: spec.paint, emissive: spec.paint, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.35 }))
  );
  scene.add(tube);
  // A bead on every round, and a column under it down to the floor.
  const beadGeo = bag.add(new THREE.SphereGeometry(0.62, 20, 14));
  const beadMat = bag.add(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.3 }));
  const colGeo = bag.add(new THREE.BoxGeometry(Math.min(1.6, dx * 0.55 || 1.6), 1, 1.6));
  colGeo.translate(0, 0.5, 0);
  const cols = new THREE.InstancedMesh(colGeo, bag.add(new THREE.MeshStandardMaterial({ color: spec.paint, transparent: true, opacity: 0.32, roughness: 0.5, depthWrite: false })), n);
  bag.add(cols);
  pts.forEach((p, i) => {
    const bead = new THREE.Mesh(beadGeo, beadMat);
    bead.position.copy(p);
    scene.add(bead);
    cols.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, 0), new THREE.Quaternion(), new THREE.Vector3(1, Math.max(0.05, p.y - 0.62), 1)));
  });
  cols.instanceMatrix.needsUpdate = true;
  cols.frustumCulled = false;
  scene.add(cols);
  // The places as lines behind, labelled down the left: P1, then every fifth.
  const lineMat = bag.add(new THREE.MeshBasicMaterial({ color: spec.accent || 0xffffff, transparent: true, opacity: 0.28 }));
  const lineGeo = bag.add(new THREE.BoxGeometry(W + 6, 0.08, 0.08));
  const marks = [1, ...[5, 10, 15, 20, 25, 30, 40, 50, 60, 80].filter((v) => v < bottom)];
  for (const v of marks) {
    const l = new THREE.Mesh(lineGeo, lineMat);
    l.position.set(0, yOf(v), -1.6);
    scene.add(l);
    const tag = textSprite(bag, `P${v}`, { height: 1.5, bg: "rgba(0,0,0,0)" });
    tag.sprite.position.set(x0 - 4.6, yOf(v), -1.6);
    scene.add(tag.sprite);
  }
  // The rounds along the floor (every one while they fit, else every other).
  const every = n > 12 ? 2 : 1;
  rounds.forEach((r, i) => {
    if (i % every && i !== n - 1) return;
    const tag = textSprite(bag, `R${r.round}`, { height: 1.2, bg: "rgba(0,0,0,0)" });
    tag.sprite.position.set(pts[i].x, -1.1, 1);
    scene.add(tag.sprite);
  });
  scene.add(flatDisc(bag, radialTexture(bag, [[0, "rgba(255,255,255,0.12)"], [1, "rgba(255,255,255,0)"]]), W + 30, 24, { y: 0 }));
  // Where it started, its best, where it ended, as the car gets there.
  const peakIdx = rounds.reduce((b, r, i) => (r.position < rounds[b].position ? i : b), 0);
  const callouts = [...new Set([0, peakIdx, n - 1])].map((i) => {
    const c = textSprite(bag, `P${rounds[i].position}`, { height: 2.4 });
    c.sprite.position.copy(pts[i]).add(new THREE.Vector3(0, 2.6, 0));
    scene.add(c.sprite);
    return { i, sprite: c.sprite };
  });

  const car = paintedCar(ctx, carMaterials(bag, spec.paint), bag);
  car.scale.setScalar(0.62);
  scene.add(car);
  const side = new THREE.Vector3(0, 0, 1);
  const basis = new THREE.Matrix4();
  const RIDE = [0.6, 6.8];
  const centre = new THREE.Vector3(0, H / 2 + 0.5, 0);
  const update = (t) => {
    camera.aspect = ctx.aspect;
    camera.updateProjectionMatrix();
    const u = easeInOut(span(t, RIDE[0], RIDE[1]));
    const p = curve.getPointAt(u);
    const fwd = curve.getTangentAt(u).normalize();
    const upv = new THREE.Vector3().crossVectors(side, fwd).normalize();
    basis.makeBasis(fwd, upv, new THREE.Vector3().crossVectors(fwd, upv));
    car.quaternion.setFromRotationMatrix(basis);
    car.position.copy(p).addScaledVector(upv, R);
    const along = u * (n + 1) - 1;
    for (const c of callouts) c.sprite.visible = t >= RIDE[1] || along >= c.i - 0.15;
    // Ride along beside the car, then step back for the whole chart.
    const chase = p.clone().add(new THREE.Vector3(-6.5, 3.2, 11));
    const chaseLook = p.clone().add(new THREE.Vector3(3, 0.4, 0));
    const d = fit(ctx, camera, W + 12, H + 6, { hs: ctx.wide ? 1 : 0.92, vs: ctx.wide ? 0.92 : ctx.vShare });
    const whole = centre.clone().add(new THREE.Vector3(Math.sin(-0.28) * d, 3, Math.cos(-0.28) * d));
    const s = easeInOut(span(t, RIDE[1] - 0.5, RIDE[1] + 1.3));
    camera.position.copy(chase.lerp(whole, s));
    camera.lookAt(chaseLook.lerp(centre, s));
  };
  return { scene, camera, update, still: 8.8, dispose: () => bag.dispose() };
}

// --- the final table ---

// Top three: the podium, the driver's car dropped onto its step, the paper
// coming down.
function podiumScene(ctx, spec) {
  const bag = makeBag();
  const { scene, camera } = baseScene(ctx, spec, { fogNear: 30, fogFar: 90 });
  camera.fov = 38;
  lights(scene, { rim: spec.paint, rimStrength: 1.8 });
  const steps = [
    { place: 1, x: 0, h: 2.3 },
    { place: 2, x: -4.1, h: 1.6 },
    { place: 3, x: 4.1, h: 1.1 },
  ];
  const stone = bag.add(new THREE.MeshStandardMaterial({ color: 0xeceef2, roughness: 0.45, metalness: 0.05 }));
  for (const s of steps) {
    const block = new THREE.Mesh(bag.add(new THREE.BoxGeometry(3.9, s.h, 3.6)), stone);
    block.position.set(s.x, s.h / 2, 0);
    scene.add(block);
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const g = cv.getContext("2d");
    g.fillStyle = s.place === 1 ? "#d4a514" : s.place === 2 ? "#7b8494" : "#b4652e";
    g.font = "900 104px Archivo, Inter, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(s.place), 64, 70);
    const tex = bag.add(new THREE.CanvasTexture(cv));
    const face = new THREE.Mesh(bag.add(new THREE.PlaneGeometry(Math.min(1.5, s.h * 0.9), Math.min(1.5, s.h * 0.9))), bag.add(new THREE.MeshBasicMaterial({ map: tex, transparent: true })));
    face.position.set(s.x, s.h / 2, 1.81);
    scene.add(face);
  }
  const mine = steps.find((s) => s.place === spec.position) || steps[0];
  const others = steps.filter((s) => s !== mine).map((s) => placeAt(s.x, s.h, 0, -0.35, 0.68));
  scene.add(carField(ctx, bag, carMaterials(bag, FIELD_GREY), others));
  const car = paintedCar(ctx, carMaterials(bag, spec.paint), bag);
  car.scale.setScalar(0.68);
  car.rotation.y = -0.35;
  scene.add(car);
  scene.add(flatDisc(bag, radialTexture(bag, [[0, "rgba(255,255,255,0.12)"], [1, "rgba(255,255,255,0)"]]), 40, 40, { y: 0.005 }));
  const paper = confetti(bag, [spec.paint, GOLD, 0xffffff, 0x5ce1e6], { count: 280, area: 18, top: 14, from: 1.5 });
  scene.add(paper.points);
  const DROP = [0.7, 1.5];
  const update = (t) => {
    camera.aspect = ctx.aspect;
    camera.updateProjectionMatrix();
    const k = span(t, DROP[0], DROP[1]);
    // Down onto the step with a little bounce.
    const bounce = k < 1 ? 1 - easeOutBack(k) : 0;
    car.position.set(mine.x, mine.h + Math.max(0, bounce) * 7 + (k <= 0 ? 7 : 0), 0);
    car.visible = t >= DROP[0] - 0.05;
    paper.update(t);
    const d = fit(ctx, camera, 13.5, 7, { hs: 0.92, vs: ctx.wide ? 0.7 : 0.5 }) * lerp(1.15, 1, easeOut(span(t, 0, 5)));
    camera.position.set(Math.sin(-0.18) * d, 3.2 + d * 0.12, Math.cos(-0.18) * d);
    camera.lookAt(0, 1.9, 0);
  };
  return { scene, camera, update, still: 4.5, dispose: () => bag.dispose() };
}

// Anywhere below the podium: the final order as a starting grid, the camera
// flying down it from pole to the driver's slot.
function gridScene(ctx, spec) {
  const bag = makeBag();
  const { scene, camera } = baseScene(ctx, spec, { fogNear: 70, fogFar: 220 });
  camera.fov = 44;
  lights(scene, { rim: spec.paint });
  const P = Math.max(1, spec.position);
  const K = Math.min(Math.max(P + 3, Math.min(spec.fieldSize || P, P + 3)), 40);
  const GAP = 8;
  const slotZ = (k) => (k - 1) * GAP;
  const laneX = (k) => (k % 2 ? -2.4 : 2.4);
  // The tarmac with every slot's box painted on, as one texture.
  const length = slotZ(K) + 30;
  const PX = 12; // pixels per metre
  const cv = document.createElement("canvas");
  cv.width = 168;
  cv.height = Math.min(4096, Math.ceil(length * PX));
  const scaleY = cv.height / length;
  const g = cv.getContext("2d");
  g.fillStyle = "#23262d";
  g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 3;
  for (let k = 1; k <= K; k++) {
    const cx = (laneX(k) + 7) * PX;
    const front = (slotZ(k) + 10 - 3.2) * scaleY;
    g.beginPath();
    g.moveTo(cx - 1.4 * PX, front + 2.4 * scaleY);
    g.lineTo(cx - 1.4 * PX, front);
    g.lineTo(cx + 1.4 * PX, front);
    g.lineTo(cx + 1.4 * PX, front + 2.4 * scaleY);
    g.stroke();
  }
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.fillRect(0, 0, 3, cv.height);
  g.fillRect(cv.width - 3, 0, 3, cv.height);
  const tex = bag.add(new THREE.CanvasTexture(cv));
  tex.anisotropy = 4;
  const road = new THREE.Mesh(bag.add(new THREE.PlaneGeometry(14, length)), bag.add(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, length / 2 - 10);
  scene.add(road);
  const yaw = Math.PI / 2; // noses towards -z, towards pole
  const field = [];
  for (let k = 1; k <= K; k++) if (k !== P) field.push(placeAt(laneX(k), 0, slotZ(k), yaw));
  scene.add(carField(ctx, bag, carMaterials(bag, FIELD_GREY), field));
  for (let k = 1; k <= K; k++) {
    const s = contactShadow(bag);
    s.position.set(laneX(k), 0.015, slotZ(k));
    s.rotation.z = yaw;
    scene.add(s);
  }
  const car = paintedCar(ctx, carMaterials(bag, spec.paint), bag);
  car.rotation.y = yaw;
  car.position.set(laneX(P), 0, slotZ(P));
  scene.add(car);
  const glow = flatDisc(bag, radialTexture(bag, [[0, `${cssColor(spec.paint)}cc`], [1, `${cssColor(spec.paint)}00`]]), 10, 10, { y: 0.03, additive: true });
  glow.position.set(laneX(P), 0.03, slotZ(P));
  scene.add(glow);
  const FLY = [0.5, 5.0];
  const update = (t) => {
    camera.aspect = ctx.aspect;
    camera.updateProjectionMatrix();
    const m = easeInOut(span(t, FLY[0], FLY[1]));
    const z = lerp(slotZ(1) - 4, slotZ(P), m);
    // High over pole looking back down the grid, along it, then down to the
    // car, from in front.
    const s = easeInOut(span(t, FLY[1] - 0.6, FLY[1] + 1.2));
    const along = new THREE.Vector3(5, 13, z - 16);
    const close = new THREE.Vector3(laneX(P) - 6, 3.4, slotZ(P) - 10.5);
    camera.position.copy(along.lerp(close, s));
    camera.lookAt(new THREE.Vector3(lerp(0, laneX(P), s), lerp(0, 0.8, s), lerp(z + 10, slotZ(P), s)));
  };
  return { scene, camera, update, still: 6.6, dispose: () => bag.dispose() };
}

const BUILDERS = {
  intro: introScene,
  circuit: circuitScene,
  climb: climbScene,
  trophies: trophiesScene,
  journey: journeyScene,
  podium: podiumScene,
  grid: gridScene,
};

export const SCENE_KINDS = Object.keys(BUILDERS);

// Archivo is the font the labels are drawn in; a canvas does not wait for a
// webfont by itself.
function fontsReady() {
  const load = document.fonts?.load?.("900 64px Archivo");
  if (!load) return Promise.resolve();
  return Promise.race([load.catch(() => {}), new Promise((r) => setTimeout(r, 800))]);
}

// The stage: one canvas, one renderer, one scene at a time. Returns null
// where WebGL is not to be had, and the story draws its flat pictures instead.
//   setScene(spec | null)  build a slide's scene (spec.kind, see BUILDERS)
//   render(t)              draw it as it is t seconds in
//   resize(w, h)           the canvas's size in CSS pixels
//   still(spec, t, w, h)   one frame of a scene as a 2D canvas, for pictures
//   onLost(fn)             called if the browser takes the GPU back
//   dispose()
export function createWrappedStage(canvas, { still = false } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();

  // The frame's shape and layout. Tall: the whole width for the subject and
  // the middle 60% of the height (the words take the rest). Wide: the right
  // 55% of the screen, the picture shifted a fifth of the way over so the
  // subject sits there, clear of the words on the left.
  const ctx = { aspect: 1, w: 1, h: 1, env, template: null, maxAnisotropy: renderer.capabilities.getMaxAnisotropy() };
  const setLayout = (wide) => {
    ctx.wide = wide;
    ctx.hShare = wide ? 0.55 : 1;
    ctx.vShare = wide ? 0.8 : 0.6;
    ctx.shift = wide ? 0.21 : 0;
  };
  setLayout(false);
  let current = null;
  let currentKey = null;
  let lastT = 0;
  let seq = 0;
  let dead = false;
  let lostFn = null;
  const onLostEvent = (e) => {
    e.preventDefault();
    dead = true;
    lostFn?.();
  };
  canvas.addEventListener("webglcontextlost", onLostEvent);

  const ready = Promise.all([loadRaceCar().then((t) => (ctx.template = t)).catch(() => null), fontsReady()]);

  function draw() {
    if (dead) return;
    if (!current) {
      renderer.clear();
      return;
    }
    current.update(still ? current.still : lastT);
    if (ctx.shift) current.camera.setViewOffset(ctx.w, ctx.h, -ctx.shift * ctx.w, 0, ctx.w, ctx.h);
    else current.camera.clearViewOffset();
    renderer.render(current.scene, current.camera);
  }

  return {
    ready,
    async setScene(spec) {
      const mine = ++seq;
      const key = spec ? JSON.stringify(spec) : null;
      if (key === currentKey) return;
      await ready;
      if (mine !== seq || dead) return;
      current?.dispose();
      current = null;
      currentKey = key;
      setLayout(!!spec?.wide);
      ctx.marker = !!spec?.marker;
      if (spec && BUILDERS[spec.kind]) current = BUILDERS[spec.kind](ctx, spec);
      draw();
    },
    render(t) {
      lastT = t;
      draw();
    },
    resize(w, h) {
      if (dead || !(w > 0 && h > 0)) return;
      renderer.setSize(w, h, false);
      ctx.aspect = w / h;
      ctx.w = w;
      ctx.h = h;
      draw();
    },
    // One frame of a scene, drawn off screen at its own size, handed back as
    // an ordinary canvas (for the summary card's picture).
    still(spec, t, w, h) {
      if (dead || !spec || !BUILDERS[spec.kind]) return null;
      const target = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
      const aspect = ctx.aspect;
      const wasWide = ctx.wide;
      ctx.aspect = w / h;
      // A picture is framed on its own, whatever the screen is doing.
      setLayout(false);
      ctx.marker = !!spec.marker;
      const built = BUILDERS[spec.kind](ctx, { ...spec, wide: false });
      try {
        built.update(t ?? built.still);
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(built.scene, built.camera);
        const px = new Uint8Array(w * h * 4);
        renderer.readRenderTargetPixels(target, 0, 0, w, h, px);
        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        const g = out.getContext("2d");
        const img = g.createImageData(w, h);
        // WebGL reads bottom row first.
        for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        g.putImageData(img, 0, 0);
        return out;
      } catch {
        return null;
      } finally {
        renderer.setRenderTarget(null);
        target.dispose();
        built.dispose();
        ctx.aspect = aspect;
        setLayout(wasWide);
        draw();
      }
    },
    onLost(fn) {
      lostFn = fn;
    },
    dispose() {
      seq += 1;
      current?.dispose();
      current = null;
      canvas.removeEventListener("webglcontextlost", onLostEvent);
      env.dispose();
      renderer.dispose();
      // Phones keep only a few WebGL contexts; hand this one back now rather
      // than whenever the garbage collector gets to it.
      renderer.forceContextLoss();
    },
  };
}
