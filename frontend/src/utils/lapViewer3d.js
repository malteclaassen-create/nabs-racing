// ---------------------------------------------------------------------------
// The 3D replay: a track from utils/acTrackScene.js, the two recorded laps as
// lines on its road, and a car on each, driven by the same cursor as the 2D
// map. React owns the buttons (components/TelemetryTrack3D.jsx); this owns the
// WebGL side and draws every frame from whatever pose it was last handed.
//
// One viewer for the page's lifetime. Switching to 2D and back must not throw
// away a track that took ten seconds to read, and a WebGL context is not
// something to make and drop on every click either. The canvas is moved in
// and out of the page instead.
//
// The laps are in the game's own world coordinates (decimetres, x and z), the
// track models in the same coordinates in metres, so the two line up with
// nothing in between. The laps carry no height; each recorded point is put on
// the road under it (utils/groundHeight.js).
// ---------------------------------------------------------------------------
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { lapHeights } from "./groundHeight.js";
import { tvCameraAt } from "./acTrackLayout.js";

// What you set is what you see: the track's textures are drawn as they are,
// with no colour-space conversion either way.
THREE.ColorManagement.enabled = false;

const SKY = 0xc9dbea;
const LINE_HALF = 0.18; // metres either side of the recorded line
const LINE_LIFT = 0.07; // above the road, so it does not flicker into it

// The site's car: Kenney's CC0 formula car, the same model the 2D map draws
// from above (public/models/kenney-race, see its README). Loaded once, the
// first time a viewer is made; until it is in, each car is a stand-in built
// from boxes below.
const CAR_URL = "/models/kenney-race/race.glb";
const CAR_LENGTH = 5.2; // metres, nose to rear wing

let carModel = null;
function loadCarModel() {
  if (!carModel) {
    carModel = new GLTFLoader().loadAsync(CAR_URL).then((gltf) => {
      const root = gltf.scene;
      // Nose along +x, like everything else here: the front wheels say which
      // way the model faces.
      let front = 0;
      root.traverse((o) => { if (/wheel-front/.test(o.name)) front += o.position.z; });
      root.rotation.y = front >= 0 ? Math.PI / 2 : -Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(root);
      const size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
      holder.scale.setScalar(CAR_LENGTH / size.x);
      // Wheels on the ground, centred on the recorded point.
      const box = new THREE.Box3().setFromObject(holder);
      const centre = box.getCenter(new THREE.Vector3());
      holder.position.set(-centre.x, -box.min.y, -centre.z);
      let image = null;
      root.traverse((o) => { if (o.isMesh && !image) image = o.material.map?.image || null; });
      return { template: holder, image };
    });
  }
  return carModel;
}

// The model's colour map with its paint (the red-orange swatches) turned into
// one lap's colour, keeping each swatch's shading. Tyres, rims, the halo and
// the wings keep the model's own colours.
function paintTexture(image, color) {
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height);
  const d = px.data, paint = new THREE.Color(color);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 180 && g < 125 && b < 95 && r - g > 90) {
      const shade = r / 235;
      d[i] = Math.min(255, paint.r * 255 * shade);
      d[i + 1] = Math.min(255, paint.g * 255 * shade);
      d[i + 2] = Math.min(255, paint.b * 255 * shade);
    }
  }
  ctx.putImageData(px, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false; // glTF's convention
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// A car: the stand-in boxes until the model is in, then the model, painted.
// Nose along +x, about 5 m long. `paint(color)` repaints it.
function makeCar(color, label) {
  const g = new THREE.Group();
  const shape = new THREE.Group();
  g.add(shape);
  const body = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b1f27 });
  const box = (w, h, d, m, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    shape.add(mesh);
  };
  box(3.0, 0.45, 0.85, body, 0.1, 0.38, 0);
  box(1.5, 0.28, 0.42, body, 2.2, 0.3, 0);
  box(0.55, 0.06, 1.9, body, 2.85, 0.12, 0);
  box(1.7, 0.38, 1.45, body, -0.5, 0.33, 0);
  box(0.75, 0.22, 0.5, dark, 0.45, 0.66, 0);
  box(0.9, 0.5, 0.35, body, -0.9, 0.78, 0);
  box(0.45, 0.06, 1.35, body, -2.25, 0.98, 0);
  box(0.5, 0.6, 0.05, dark, -2.25, 0.7, 0.66);
  box(0.5, 0.6, 0.05, dark, -2.25, 0.7, -0.66);
  const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.38, 18);
  for (const [x, z] of [[1.65, 0.82], [1.65, -0.82], [-1.55, 0.84], [-1.55, -0.84]]) {
    const w = new THREE.Mesh(wheel, dark);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.34, z);
    shape.add(w);
  }
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(color, label), depthTest: false }));
  tag.scale.set(1.5, 1.5, 1);
  tag.position.set(0, 2.5, 0);
  tag.renderOrder = 10;
  g.add(tag);
  let current = color, model = null, skin = null;
  const paint = (next) => {
    current = next;
    body.color.set(next);
    if (!model) return;
    skin.map?.dispose();
    skin.map = paintTexture(model.image, next);
    skin.needsUpdate = true;
  };
  loadCarModel().then((loaded) => {
    if (!loaded.image) return;
    model = loaded;
    skin = new THREE.MeshLambertMaterial();
    const car = loaded.template.clone(true);
    car.traverse((o) => { if (o.isMesh) o.material = skin; });
    g.remove(shape);
    g.add(car);
    paint(current);
  }).catch(() => {}); // no model: the stand-in stays, which is a car too
  g.userData = { paint, tag };
  g.rotation.order = "YZX";
  return g;
}

function labelTexture(color, label) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  x.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  x.beginPath();
  x.arc(32, 32, 28, 0, Math.PI * 2);
  x.fill();
  x.lineWidth = 5;
  x.strokeStyle = "#fff";
  x.stroke();
  x.fillStyle = "#fff";
  x.font = "800 34px Archivo, Inter, system-ui, sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(label, 32, 34);
  return new THREE.CanvasTexture(c);
}

// A recorded lap as everything the viewer needs per point: metres, height,
// and the direction of travel.
function lapPath(lap, n, ground) {
  if (!lap?.x || !lap?.z) return null;
  const len = Math.min(n, lap.x.length, lap.z.length);
  const x = new Float64Array(len), z = new Float64Array(len);
  for (let i = 0; i < len; i++) { x[i] = lap.x[i] / 10; z[i] = lap.z[i] / 10; }
  const y = ground ? lapHeights(ground, lap.x, lap.z, len) : new Array(len).fill(0);
  return len < 2 ? null : { x, y, z, n: len };
}

// The lap at slice `f`, on a Catmull-Rom curve through the recorded points,
// with the direction it runs in there. Straight lines from point to point made
// every corner a run of short straights, and a car or camera following them
// turned in steps, once per point.
function sampleAt(path, f) {
  const n = path.n;
  const t = Math.max(0, Math.min(n - 1, f));
  const i = Math.min(n - 2, Math.floor(t)), u = t - i;
  const i0 = Math.max(0, i - 1), i3 = Math.min(n - 1, i + 2);
  const u2 = u * u, u3 = u2 * u;
  const curve = (a) => {
    const p0 = a[i0], p1 = a[i], p2 = a[i + 1], p3 = a[i3];
    const b = p2 - p0, c = 2 * p0 - 5 * p1 + 4 * p2 - p3, d = 3 * (p1 - p2) + p3 - p0;
    return [p1 + 0.5 * (b * u + c * u2 + d * u3), 0.5 * (b + 2 * c * u + 3 * d * u2)];
  };
  const [x, dx] = curve(path.x), [y, dy] = curve(path.y), [z, dz] = curve(path.z);
  // Standing still the curve has no direction; the points around it do.
  if (Math.hypot(dx, dz) < 1e-6) {
    return { t, x, y, z, dx: path.x[i3] - path.x[i0], dy: path.y[i3] - path.y[i0], dz: path.z[i3] - path.z[i0] };
  }
  return { t, x, y, z, dx, dy, dz };
}

function poseOf(path, f) {
  const s = sampleAt(path, f);
  const flat = Math.hypot(s.dx, s.dz) || 1;
  return {
    pos: new THREE.Vector3(s.x, s.y, s.z),
    dir: new THREE.Vector3(s.dx / flat, 0, s.dz / flat),
    pitch: Math.atan2(s.dy, flat),
    spline: s.t / path.n,
  };
}

// The lap as a thin strip lying on the road, along the same curve the car
// drives, in steps of about LINE_STEP. `dashed` leaves gaps, for lap B, as
// the 2D map does.
const LINE_STEP = 1.5; // metres
function lineMesh(path, color, dashed) {
  const pos = [], idx = [];
  let open = false;
  const add = (t) => {
    const s = sampleAt(path, t);
    const l = Math.hypot(s.dx, s.dz) || 1;
    const px = (-s.dz / l) * LINE_HALF, pz = (s.dx / l) * LINE_HALF, y = s.y + LINE_LIFT;
    pos.push(s.x + px, y, s.z + pz, s.x - px, y, s.z - pz);
    const v = pos.length / 3 - 2;
    if (open) idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
    open = true;
  };
  const on = (i) => !dashed || Math.floor(i / 3) % 2 === 0;
  for (let i = 0; i < path.n - 1; i++) {
    if (!on(i)) { open = false; continue; }
    const gap = Math.hypot(path.x[i + 1] - path.x[i], path.z[i + 1] - path.z[i]);
    const steps = Math.min(16, Math.max(1, Math.ceil(gap / LINE_STEP)));
    for (let k = 0; k < steps; k++) add(i + k / steps);
    if (i === path.n - 2 || !on(i + 1)) add(i + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

export function createLapViewer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.touchAction = "none";

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 12000);
  scene.add(new THREE.HemisphereLight(0xeef4ff, 0x5a5646, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(0.4, 1, 0.25);
  scene.add(sun);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 3;
  controls.maxDistance = 6000;

  const carA = makeCar(0x0ea5e9, "A"), carB = makeCar(0xf43f5e, "B");
  scene.add(carA, carB);
  const lines = new THREE.Group();
  scene.add(lines);

  let track = null, pathA = null, pathB = null;
  let mode = "orbit", target = "A", follow = true, showLines = true;
  const pose = { a: 0, b: null };
  let lastFollowed = null, framed = false, raf = 0, host = null, observer = null, lastTime = 0;

  const lookAt = new THREE.Vector3();
  const want = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const chaseDir = new THREE.Vector3(1, 0, 0);
  let chaseFrom = false; // chaseDir holds a heading to swing from

  function place(car, path, f) {
    if (!path || f == null) { car.visible = false; return null; }
    const p = poseOf(path, f);
    car.visible = true;
    car.position.copy(p.pos);
    car.rotation.set(0, Math.atan2(-p.dir.z, p.dir.x), p.pitch);
    return p;
  }

  // Behind and above the followed car, close enough to read the line it takes.
  function frameOn(p) {
    camera.position.copy(p.pos).addScaledVector(p.dir, -28).add(new THREE.Vector3(-p.dir.z * 14, 16, p.dir.x * 14));
    controls.target.copy(p.pos).add(new THREE.Vector3(0, 0.5, 0));
    camera.fov = 50;
    camera.updateProjectionMatrix();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, lastTime ? (now - lastTime) / 1000 : 0.016);
    lastTime = now;
    const a = place(carA, pathA, pose.a);
    const b = place(carB, pathB, pose.b ?? pose.a);
    const p = target === "B" && b ? b : a;
    if (mode !== "chase" || !p) chaseFrom = false;
    if (p && !framed) { frameOn(p); framed = true; }

    if (mode === "orbit" || !p) {
      controls.enabled = true;
      if (follow && p) {
        if (lastFollowed) {
          const d = p.pos.clone().sub(lastFollowed);
          camera.position.add(d);
          controls.target.add(d);
        }
        lastFollowed = p.pos.clone();
      } else {
        lastFollowed = null;
      }
      if (camera.fov !== 50) { camera.fov = 50; camera.updateProjectionMatrix(); }
      controls.update();
    } else if (mode === "chase") {
      controls.enabled = false;
      // The camera swings round behind the car a moment after the car turns,
      // the way a chase camera on a crane would, rather than snapping to its
      // every heading. Seated by the car, so the car never drifts in frame.
      // A jump of the cursor (half a turn or more) cuts straight there.
      if (!chaseFrom || chaseDir.dot(p.dir) < 0) chaseDir.copy(p.dir);
      else chaseDir.lerp(p.dir, 1 - Math.exp(-dt * 5)).normalize();
      chaseFrom = true;
      camera.position.copy(p.pos).addScaledVector(chaseDir, -9).addScaledVector(up, 3.1);
      lookAt.copy(p.pos).addScaledVector(chaseDir, 7).addScaledVector(up, 1);
      camera.lookAt(lookAt);
      if (camera.fov !== 58) { camera.fov = 58; camera.updateProjectionMatrix(); }
    } else {
      // TV: the track's own trackside camera for this stretch of the lap, the
      // way AC's replay cuts between them. A track without them, or a stretch
      // none covers, falls back to a high camera behind the car.
      controls.enabled = false;
      // A camera a kilometre off is from another layout of the circuit.
      const cam = track ? tvCameraAt(track.cameras, p.spline) : null;
      if (cam && want.set(...cam.position).distanceTo(p.pos) < 900) {
        camera.position.copy(want);
        lookAt.copy(p.pos).addScaledVector(up, 0.8);
        camera.lookAt(lookAt);
        const dist = camera.position.distanceTo(p.pos);
        const fov = THREE.MathUtils.clamp((2 * Math.atan(7 / Math.max(1, dist)) * 180) / Math.PI, cam.minFov || 4, cam.maxFov || 60);
        if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      } else {
        want.copy(p.pos).addScaledVector(p.dir, -26).addScaledVector(up, 14);
        camera.position.lerp(want, 1 - Math.exp(-dt * 3));
        camera.lookAt(p.pos);
        if (camera.fov !== 45) { camera.fov = 45; camera.updateProjectionMatrix(); }
      }
    }
    // A label right in front of the lens only gets in the way.
    for (const c of [carA, carB]) c.userData.tag.visible = c.visible && camera.position.distanceTo(c.position) > 14;
    renderer.render(scene, camera);
  }

  function resize() {
    if (!host) return;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function rebuildLines(lapA, lapB, n, colorA, colorB) {
    for (const m of lines.children) { m.geometry.dispose(); m.material.dispose(); }
    lines.clear();
    pathA = lapPath(lapA, n, track?.ground);
    pathB = lapPath(lapB, n, track?.ground);
    if (pathA) lines.add(lineMesh(pathA, colorA, false));
    if (pathB) lines.add(lineMesh(pathB, colorB, true));
    lines.visible = showLines;
    carA.userData.paint(colorA);
    carB.userData.paint(colorB);
  }

  let laps = null;
  return {
    gpu: {
      s3tc: renderer.extensions.has("WEBGL_compressed_texture_s3tc"),
      anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
    },
    attach(el) {
      host = el;
      el.appendChild(canvas);
      observer = new ResizeObserver(resize);
      observer.observe(el);
      resize();
      lastTime = 0;
      if (!raf) raf = requestAnimationFrame(frame);
    },
    detach() {
      cancelAnimationFrame(raf);
      raf = 0;
      observer?.disconnect();
      observer = null;
      canvas.remove();
      host = null;
    },
    get track() { return track; },
    setTrack(next) {
      if (track) scene.remove(track.root);
      track = next;
      if (track) {
        scene.add(track.root);
        // Haze at the far side of the circuit, so the edge of the world does
        // not end in a hard line.
        const size = track.bounds.getSize(new THREE.Vector3()).length();
        scene.fog = new THREE.Fog(SKY, size * 0.6, size * 1.6);
      }
      framed = false;
      if (laps) rebuildLines(...laps);
    },
    setLaps(lapA, lapB, n, colorA, colorB) {
      const next = [lapA, lapB, n, colorA, colorB];
      if (laps && next.every((v, i) => v === laps[i])) return;
      const sameLap = laps && laps[0] === lapA;
      laps = next;
      rebuildLines(...laps);
      if (!sameLap) framed = false;
    },
    setPose(a, b) { pose.a = a; pose.b = b; },
    setMode(next) {
      mode = next;
      lastFollowed = null;
      if (next === "orbit") framed = false;
    },
    setTarget(side) { target = side; lastFollowed = null; framed = false; chaseFrom = false; },
    setFollow(on) { follow = on; lastFollowed = null; },
    setLines(on) { showLines = on; lines.visible = on; },
  };
}

let viewer = null;
// The page's one viewer, made on first use. Throws when the browser has no
// WebGL, which the caller turns into a message.
export function getLapViewer() {
  if (!viewer) viewer = createLapViewer();
  return viewer;
}
