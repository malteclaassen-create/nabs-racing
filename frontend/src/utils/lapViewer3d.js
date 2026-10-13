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
import { lapHeights } from "./groundHeight.js";
import { tvCameraAt } from "./acTrackLayout.js";

// What you set is what you see: the track's textures are drawn as they are,
// with no colour-space conversion either way.
THREE.ColorManagement.enabled = false;

const SKY = 0xc9dbea;
const LINE_HALF = 0.18; // metres either side of the recorded line
const LINE_LIFT = 0.07; // above the road, so it does not flicker into it

// A single-seater in one colour, nose along +x, sized like the real thing
// (about 5 m by 1.9 m). Recognisable from a TV camera a hundred metres away,
// which is all it has to be.
function makeCar(color, label) {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b1f27 });
  const box = (w, h, d, m, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
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
    g.add(w);
  }
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(color, label), depthTest: false }));
  tag.scale.set(1.5, 1.5, 1);
  tag.position.set(0, 2.5, 0);
  tag.renderOrder = 10;
  g.add(tag);
  g.userData = { body, tag };
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
  return { x, y, z, n: len };
}

function poseOf(path, f) {
  const n = path.n;
  const t = Math.max(0, Math.min(n - 1, f));
  const i = Math.min(n - 2, Math.floor(t)), u = t - i;
  const lerp = (a) => a[i] + (a[i + 1] - a[i]) * u;
  // Direction from a little behind to a little ahead: one slice is a few
  // metres, and its own step jitters.
  const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 2);
  const dx = path.x[b] - path.x[a], dz = path.z[b] - path.z[a], dy = path.y[b] - path.y[a];
  const flat = Math.hypot(dx, dz) || 1;
  return {
    pos: new THREE.Vector3(lerp(path.x), lerp(path.y), lerp(path.z)),
    dir: new THREE.Vector3(dx / flat, 0, dz / flat),
    pitch: Math.atan2(dy, flat),
    spline: t / n,
  };
}

// The lap as a thin strip lying on the road. `dashed` leaves gaps, for lap B,
// as the 2D map does.
function lineMesh(path, color, dashed) {
  const pos = [], idx = [];
  let open = false;
  for (let i = 0; i < path.n; i++) {
    const on = !dashed || Math.floor(i / 3) % 2 === 0;
    if (!on) { open = false; continue; }
    const a = Math.max(0, i - 1), b = Math.min(path.n - 1, i + 1);
    const dx = path.x[b] - path.x[a], dz = path.z[b] - path.z[a], l = Math.hypot(dx, dz) || 1;
    const px = (-dz / l) * LINE_HALF, pz = (dx / l) * LINE_HALF, y = path.y[i] + LINE_LIFT;
    pos.push(path.x[i] + px, y, path.z[i] + pz, path.x[i] - px, y, path.z[i] - pz);
    const v = pos.length / 3 - 2;
    if (open) idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
    open = true;
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
      want.copy(p.pos).addScaledVector(p.dir, -9).addScaledVector(up, 3.1);
      camera.position.lerp(want, 1 - Math.exp(-dt * 7));
      lookAt.copy(p.pos).addScaledVector(p.dir, 7).addScaledVector(up, 1);
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
    carA.userData.body.color.set(colorA);
    carB.userData.body.color.set(colorB);
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
    setTarget(side) { target = side; lastFollowed = null; framed = false; },
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
