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
  Object.assign(key.shadow.camera, {
    left: -span,
    right: span,
    top: span,
    bottom: -span,
    near: 0.5,
    far: 12,
  });
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

// The circuit as a thin band lying in space: it draws itself from the start
// line round, then sways gently.
function trackThing({ scene, camera, pal, data }) {
  const curve = circuitCurve(data?.track);
  if (!curve) return null;
  keyLight(scene);
  shadowGround(scene).position.y = -0.06;

  const group = new THREE.Group();
  scene.add(group);
  const geo = ribbonGeometry(curve, 1200, 0.038, 0.022);
  const band = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: pal.pop,
      roughness: 0.42,
      metalness: 0.05,
      side: THREE.DoubleSide,
    }),
  );
  band.castShadow = true;
  group.add(band);
  const total = geo.index.count;

  const ELEV = 0.9;
  const fit = (cam, aspect) => {
    const r = 1.04;
    const tv = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const th = tv * aspect;
    const d = Math.max(r / th, (r * Math.sin(ELEV) + 0.25) / tv) * 1.02;
    cam.position.set(0, Math.sin(ELEV) * d, Math.cos(ELEV) * d);
    cam.lookAt(0, -0.02, 0);
  };
  const update = (t) => {
    const draw = easeOut(t / 1.8);
    geo.setDrawRange(0, Math.max(0, Math.floor((total * draw) / 18) * 18));
    // It sways rather than spins, so a long thin circuit is never seen end on.
    group.rotation.y = Math.sin(t * 0.32) * 0.55;
    group.rotation.z = Math.sin(t * 0.21) * 0.05;
    const s = 0.9 + 0.1 * easeOut(t / 1.2);
    group.scale.setScalar(s);
  };
  return { fit, update, still: 6 };
}

// --- medals ---------------------------------------------------------------------------------

// A struck medal's face as two maps: how high each part stands (bump) and
// how shiny it is (roughness). The field is satin with fine lines turned
// into it; the raised parts (the place, a ring, a ring of beads) are
// polished, so they flash as the medal turns, the way a real one does.
function medalFace(text) {
  const S = 1024;
  const C = S / 2;
  const R = S * 0.47;
  const paint = (field, raised, line) => {
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const g = c.getContext("2d");
    g.fillStyle = field;
    g.fillRect(0, 0, S, S);
    // Turned lines across the field.
    g.strokeStyle = line;
    g.lineWidth = 1.4;
    for (let r = 18; r < R * 0.8; r += 7) {
      g.beginPath();
      g.arc(C, C, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = raised;
    g.strokeStyle = raised;
    // A ring inside the rim, and a ring of beads outside it.
    g.lineWidth = 16;
    g.beginPath();
    g.arc(C, C, R * 0.82, 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 44; k += 1) {
      const a = (k / 44) * Math.PI * 2;
      g.beginPath();
      g.arc(C + Math.cos(a) * R * 0.91, C + Math.sin(a) * R * 0.91, 9, 0, Math.PI * 2);
      g.fill();
    }
    g.font = "900 380px Montserrat, Inter, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, C, C + 22);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    // The cap of a cylinder lies a quarter turn off once the coin is stood up.
    tex.center.set(0.5, 0.5);
    tex.rotation = Math.PI / 2;
    return tex;
  };
  return {
    bump: paint("#6a6a6a", "#ffffff", "#5c5c5c"),
    // Green carries roughness: satin field, polished relief.
    rough: paint("rgb(0,118,0)", "rgb(0,34,0)", "rgb(0,150,0)"),
    // The field a shade deeper than the relief, as a worn medal darkens in
    // its hollows; it keeps the place readable on bronze too.
    tint: (() => {
      const t = paint("#d0d0d0", "#ffffff", "#c6c6c6");
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })(),
  };
}

// One medal a podium, in a grid that matches the labels the slide sets
// under it (`cols` columns): each drops in, spins and settles facing out.
function medalsThing({ scene, data, setCamera, el }) {
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
    const face = medalFace(`P${pos}`);
    const polished = new THREE.MeshStandardMaterial({ color: metal, metalness: 1, roughness: 0.2 });
    const front = new THREE.MeshStandardMaterial({
      color: metal,
      map: face.tint,
      metalness: 1,
      roughness: 1,
      roughnessMap: face.rough,
      bumpMap: face.bump,
      bumpScale: 4,
    });
    const holder = new THREE.Group();
    // The disc, its faces carrying the relief, and a raised rim round each
    // face that catches the light all the way round.
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.13, 128), [polished, front, front]);
    disc.rotation.x = Math.PI / 2;
    holder.add(disc);
    for (const z of [0.065, -0.065]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.06, 20, 160), polished);
      rim.position.z = z;
      holder.add(rim);
    }
    scene.add(holder);
    return { holder, k, col: k % cols, row: Math.floor(k / cols) };
  });

  // With `rows`, the slide lays out one box a row (data-medal-row) with its
  // labels under it, and the coins are set on those boxes, wherever the
  // labels push them (see Podiums). Otherwise rows are evenly spread.
  const ROW = 1.05;
  let cell = ROW;
  const fit = (_c, aspect, px) => {
    const w = cols;
    const h = w / aspect;
    Object.assign(cam, {
      left: -w / 2,
      right: w / 2,
      top: h / 2,
      bottom: -h / 2,
    });
    cam.updateProjectionMatrix();
    const boxes = data.rows && el ? [...(el.parentElement?.querySelectorAll("[data-medal-row]") || [])] : [];
    const at = el?.getBoundingClientRect();
    const k = at?.width ? w / at.width : px ? w / px : 1;
    const rowY = (row) => {
      const b = boxes[row]?.getBoundingClientRect();
      if (!b || !at) return h / 2 - (h / rows) * (row + 0.5);
      return h / 2 - (b.top - at.top + b.height / 2) * k;
    };
    cell = boxes[0] ? boxes[0].getBoundingClientRect().height * k || ROW : h / rows;
    const r = Math.min(0.4, cell * 0.42);
    for (const c of coins) {
      c.holder.scale.setScalar(r);
      c.holder.userData.x = -w / 2 + 0.5 + c.col;
      c.holder.userData.y = rowY(c.row);
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

// A photo studio to reflect in: a dark room with a broad soft box overhead
// and tall strip lights to each side. Polished metal shows these as clean
// bands of light on every part, the wide bowl included; the plain room left
// the bowl a flat smear while the tight curves of stem and handles sparkled.
function studioScene() {
  const studio = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: 0x5c5a56, side: THREE.BackSide }));
  studio.add(room);
  const light = (w, h, x, y, z, power) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0.5, 0);
    studio.add(m);
  };
  light(8, 4, 0, 7, 1, 4); // soft box overhead
  light(2, 8, -5, 1, 2.5, 6); // strip, front left
  light(2, 8, 5.5, 1, 1.5, 5); // strip, front right
  light(4, 6, 0, 1, -6, 2.5); // fill from behind
  light(12, 3, 0, -1.5, 6, 1.6); // a low bounce in front
  return studio;
}

// --- the trophy -----------------------------------------------------------------------------

// A plain gold cup, the kind on every shelf: a turned stem with a knot, a
// fluted round bowl with a rolled lip and two handles, standing on its own
// foot. It rises into place and turns slowly.
function trophyThing({ scene }) {
  keyLight(scene, [1.4, 3.5, 2.4], 1.4);
  shadowGround(scene, 6, 0.18);
  const group = new THREE.Group();
  scene.add(group);
  // Gold, a touch less mirror-like than a showroom render, so it reads as
  // metal without looking airbrushed; the flutes catch the light as it turns.
  const gold = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.18 });
  // The outline below was drawn for a cup on a plinth; it stands on the
  // ground now.
  const body = new THREE.Group();
  body.position.y = -0.235;
  group.add(body);
  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    body.add(m);
    return m;
  };

  // The gold body, turned on a lathe from one outline (radius, height).
  const outline = [
    [0, 0.235],
    [0.17, 0.235],
    [0.172, 0.25],
    [0.15, 0.262],
    [0.11, 0.28],
    [0.07, 0.31],
    [0.048, 0.36],
    [0.042, 0.4],
    [0.05, 0.43],
    [0.078, 0.452],
    [0.08, 0.465],
    [0.06, 0.485],
    [0.042, 0.51],
    [0.046, 0.54],
    [0.07, 0.565],
    [0.12, 0.59],
    [0.18, 0.63],
    [0.226, 0.69],
    [0.256, 0.77],
    [0.27, 0.86],
    [0.276, 0.94],
    [0.288, 0.975],
    [0.296, 0.988],
    [0.29, 1.0],
    [0.272, 0.996],
    [0.258, 0.96],
    [0.25, 0.88],
    [0.236, 0.79],
    [0.2, 0.7],
    [0.12, 0.64],
    [0, 0.62],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  // A round cup looks the same from every side, so turning it showed
  // nothing but the handles. The lower bowl is fluted, the way cups are:
  // shallow grooves round it that turn with it.
  const lathe = new THREE.LatheGeometry(outline, 192);
  const FLUTES = 14;
  const ramp = (x) => Math.min(1, Math.max(0, x));
  const outerTop = outline.findIndex((v) => v.y >= 0.86);
  const pos = lathe.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const j = i % outline.length;
    const y = pos.getY(i);
    if (j > outerTop || y < 0.6 || y > 0.84) continue;
    // Full depth along most of the bowl, easing in and out at the ends, so
    // the grooves run straight up rather than fading into blobs.
    const fade = ramp((y - 0.6) / 0.05) * ramp((0.84 - y) / 0.05);
    const phi = Math.atan2(pos.getX(i), pos.getZ(i));
    const groove = (0.5 + 0.5 * Math.cos(FLUTES * phi)) ** 4;
    const k = 1 - 0.075 * fade * groove;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  lathe.computeVertexNormals();
  // The lathe's first and last columns are the same seam, but each got its
  // own normals; averaged, the thin line down the front goes.
  {
    const n = lathe.attributes.normal;
    const last = pos.count - outline.length;
    for (let j = 0; j < outline.length; j += 1) {
      const a = new THREE.Vector3().fromBufferAttribute(n, j);
      const b = new THREE.Vector3().fromBufferAttribute(n, last + j);
      a.add(b).normalize();
      n.setXYZ(j, a.x, a.y, a.z);
      n.setXYZ(last + j, a.x, a.y, a.z);
    }
  }
  add(lathe, gold);

  // Two handles, each a round bar bent from just under the lip, out and
  // down, back into the bowl's side.
  for (const side of [1, -1]) {
    const path = new THREE.CatmullRomCurve3(
      [
        // Both ends run into the bowl's wall, so the bar grows out of the
        // cup instead of stopping at its surface.
        [0.24, 0.93],
        [0.33, 0.945],
        [0.415, 0.895],
        [0.418, 0.795],
        [0.35, 0.72],
        [0.262, 0.7],
        [0.214, 0.692],
      ].map(([x, y]) => new THREE.Vector3(x * side, y, 0)),
    );
    add(new THREE.TubeGeometry(path, 64, 0.021, 16, false), gold);
  }
  const fit = (cam, aspect) => {
    const tv = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const d = Math.max(0.52 / tv, 0.56 / (tv * aspect));
    cam.position.set(0, 0.4 + d * 0.18, d);
    cam.lookAt(0, 0.36, 0);
  };
  const update = (t) => {
    const rise = easeOut(t / 1.1);
    group.scale.setScalar(0.92 + 0.08 * rise);
    group.position.y = (1 - rise) * -0.12;
    group.visible = t > 0;
    group.rotation.y = -0.5 + t * 0.32;
  };
  return { fit, update, still: 5 };
}
// --- the chequered flag -------------------------------------------------------------------

function chequer() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 352;
  const g = c.getContext("2d");
  const cols = 8;
  const rows = 6;
  const w = c.width / cols;
  const h = c.height / rows;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      g.fillStyle = (x + y) % 2 ? "#141416" : "#f6f5f1";
      g.fillRect(x * w, y * h, w + 1, h + 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A chequered flag on a pole: it is run up the pole, then waves, the cloth
// rippling away from the pole and the free end moving the most.
// `banner` (the phone): no pole, a wide flag edge to edge like a finish
// line held across the frame, waving all along its length.
function flagThing({ scene, data }) {
  keyLight(scene, [2, 3.5, 3], 1.6);
  const group = new THREE.Group();
  scene.add(group);
  const banner = !!data?.banner;
  const W = banner ? 3.2 : 1.5;
  const H = banner ? 1.0 : 1.0;
  const cloth = new THREE.PlaneGeometry(W, H, 48, 24);
  cloth.translate(W / 2, 0, 0);
  const base = cloth.attributes.position.array.slice();
  const flag = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ map: chequer(), roughness: 0.62, metalness: 0, side: THREE.DoubleSide }));
  flag.castShadow = true;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 24), new THREE.MeshStandardMaterial({ color: SILVER, metalness: 1, roughness: 0.3 }));
  pole.position.set(-0.03, -0.2, 0);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.055, 24, 16), new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.2 }));
  cap.position.set(-0.03, 1.07, 0);
  const holder = new THREE.Group();
  holder.add(flag);
  if (banner) {
    group.add(holder);
    group.position.x = -W / 2;
    group.rotation.x = -0.12;
  } else {
    group.add(pole, cap, holder);
    group.position.x = -0.6;
    group.rotation.y = 0.35;
  }

  const fit = (cam, aspect) => {
    const tv = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    if (banner) {
      // The cloth's width fills the frame; its waves may run just past it.
      const d = Math.max((H * 0.62) / tv, (W * 0.47) / (tv * aspect));
      cam.position.set(0, 0, d);
      cam.lookAt(0, 0, 0);
      return;
    }
    const d = Math.max(1.5 / tv, 1.25 / (tv * aspect)) * 1.02;
    cam.position.set(0, 0.25, d);
    cam.lookAt(0, 0.12, 0);
  };
  const pos = cloth.attributes.position;
  const update = (t) => {
    // Run up the pole; the banner rises into place instead.
    if (banner) holder.position.y = -0.5 * (1 - easeOut(t / 0.9));
    else holder.position.y = -1.0 + 1.5 * easeOut(t / 1.1);
    group.visible = !banner || t > 0;
    const amp = 0.06 + 0.06 * easeOut(t / 1.2);
    for (let i = 0; i < pos.count; i += 1) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      const k = banner ? 0.45 + 0.55 * (x / W) : x / W;
      pos.array[i * 3 + 2] = Math.sin(x * 4.2 - t * 5.2 + y * 0.9) * amp * k + Math.sin(x * 2.1 - t * 3.1) * amp * 0.6 * k;
      pos.array[i * 3 + 1] = y - k * k * 0.06;
    }
    pos.needsUpdate = true;
    cloth.computeVertexNormals();
  };
  return { fit, update, still: 4 };
}

const THINGS = { track: trackThing, medals: medalsThing, trophy: trophyThing, flag: flagThing };

// A figure counting up wants every frame for itself; setting a scene up at
// the same moment makes the count stutter. Slides say until when they are
// counting, and the scene waits until then.
let busyUntil = 0;
export function holdBuildUntil(t) {
  busyUntil = Math.max(busyUntil, t);
}

export default function Object3D({ kind, data, delay = 0, className = "", style, fallback = null, label }) {
  const box = useRef(null);
  const [failed, setFailed] = useState(() => !has3D());
  const key = JSON.stringify(data ?? null);

  useEffect(() => {
    if (failed) return undefined;
    // The scene is built once the slide has nearly finished coming in, so
    // setting it up does not make the transition stutter on a slow phone.
    // Slides take 720 to 820 ms to come in.
    const SETTLE_MS = 840;
    const start = () => {
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
      const pal = {
        fg: colour("--g-fg", "#f6f5f1"),
        bg: colour("--g-bg", "#0b0b0c"),
        pop: colour("--g-pop", "#f4afc6"),
        mark: colour("--g-mark", "#f4afc6"),
      };
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = kind === "trophy" ? studioScene() : new RoomEnvironment();
      const env = pmrem.fromScene(room, 0.04).texture;
      const scene = new THREE.Scene();
      scene.environment = env;
      let camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      const thing = THINGS[kind]?.({
        scene,
        camera,
        pal,
        data: JSON.parse(key),
        setCamera: (c) => (camera = c),
        el,
      });
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
      const begin = last + Math.max(0, delay - SETTLE_MS);
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
        thing?.fit?.(camera, w / h, w, h);
        if (still) draw(thing?.still ?? 6);
      };
      size();
      const ro = new ResizeObserver(size);
      ro.observe(el);
      const frame = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (now >= begin && !el.closest(".st-paused")) t += dt;
        draw(t);
        raf = requestAnimationFrame(frame);
      };
      let gone = false;
      // The shaders are prepared off the page's own thread where the browser
      // can, so the first frame does not hold everything up; then it runs.
      const go = () => {
        if (gone) return;
        last = performance.now();
        if (still) draw(thing?.still ?? 6);
        else raf = requestAnimationFrame(frame);
      };
      if (typeof renderer.compileAsync === "function") renderer.compileAsync(scene, camera).then(go, go);
      else go();
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
        room.traverse?.((o) => {
          o.geometry?.dispose();
          o.material?.dispose?.();
        });
        room.dispose?.();
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
      };
    };
    let cleanup;
    let wait = 0;
    const attempt = () => {
      const rest = busyUntil - performance.now();
      if (rest > 16) {
        wait = setTimeout(attempt, rest + 80);
        return;
      }
      cleanup = start();
    };
    wait = setTimeout(attempt, SETTLE_MS);
    return () => {
      clearTimeout(wait);
      cleanup?.();
    };
  }, [kind, key, delay, failed]);

  if (failed) return fallback;
  return <div ref={box} className={`relative ${className}`} style={style} role="img" aria-label={label} />;
}
