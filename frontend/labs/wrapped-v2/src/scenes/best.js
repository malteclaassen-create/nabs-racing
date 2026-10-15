// The best result: the real circuit's outline as a floating track, a car in
// the team's colour lapping it and laying a gold line behind it, the
// chequered flag at the line. Drag to turn the track.
import { THREE, bag, paintedCar, canvasTexture, sparkle, spinner, span, easeOut, frameBox } from "./kit.js";
import { circuitFor } from "../../../../src/data/circuits.js";
import { tilt } from "../tilt.js";

// "M x,y L x,y ..." in a box -> points in the XZ plane, centred, `size` wide.
export function circuitPoints(track, size = 9) {
  const c = circuitFor(track);
  if (!c) return null;
  const nums = c.path.match(/-?\d+(\.\d+)?/g).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const s = size / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const v = pts.map(([x, y]) => new THREE.Vector3((x - cx) * s, 0, (y - cy) * s));
  // Drop near-duplicates, which kink a curve.
  return v.filter((p, i) => i === 0 || p.distanceTo(v[i - 1]) > 0.05);
}

// A flat band of `width` along a closed curve in the XZ plane.
export function flatBand(curve, width, segments, y = 0) {
  const pos = [];
  const uv = [];
  const idx = [];
  const p = new THREE.Vector3();
  const tg = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPointAt(u % 1, p);
    curve.getTangentAt(u % 1, tg);
    side.crossVectors(tg, up).normalize().multiplyScalar(width / 2);
    pos.push(p.x + side.x, y, p.z + side.z, p.x - side.x, y, p.z - side.z);
    uv.push(u * 60, 0, u * 60, 1);
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export default async function best(stage, d, { slide }) {
  const B = bag();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(slide.bg);
  const camera = new THREE.PerspectiveCamera(36, stage.size.aspect, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x0b1220, 1.2));
  const key = new THREE.DirectionalLight(0xffe2a0, 2.2);
  key.position.set(5, 10, 4);
  scene.add(key);

  const world = new THREE.Group();
  scene.add(world);
  const pts = circuitPoints(d.best.track) || [new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 0, -3), new THREE.Vector3(3, 0, 3), new THREE.Vector3(-3, 0, 3)];
  const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal", 0.5);
  const segs = 900;

  // Kerbs, then tarmac, then the gold line that draws itself.
  const kerbTex = B.add(
    canvasTexture(64, 8, (ctx) => {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? "#ffffff" : "#ff3030";
        ctx.fillRect(i * 8, 0, 8, 8);
      }
    })
  );
  kerbTex.wrapS = THREE.RepeatWrapping;
  const kerb = new THREE.Mesh(B.add(flatBand(curve, 0.62, segs, -0.01)), B.add(new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.6 })));
  const tarmac = new THREE.Mesh(B.add(flatBand(curve, 0.48, segs, 0)), B.add(new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.85 })));
  const lineGeo = B.add(flatBand(curve, 0.09, segs, 0.012));
  const line = new THREE.Mesh(lineGeo, B.add(new THREE.MeshBasicMaterial({ color: 0xffc83d, toneMapped: false })));
  world.add(kerb, tarmac, line);
  // A slab under it all, for depth.
  const slab = new THREE.Mesh(B.add(flatBand(curve, 0.7, segs, -0.25)), B.add(new THREE.MeshStandardMaterial({ color: 0x141a28, roughness: 0.9 })));
  world.add(slab);

  // The chequered flag at the line.
  const flagTex = B.add(
    canvasTexture(128, 96, (ctx) => {
      for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 ? "#111" : "#fff";
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    })
  );
  const flagGeo = B.add(new THREE.PlaneGeometry(1.1, 0.8, 16, 4));
  const flag = new THREE.Mesh(flagGeo, B.add(new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.7 })));
  const pole = new THREE.Mesh(B.add(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 8)), B.add(new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.8, roughness: 0.3 })));
  const start = curve.getPointAt(0);
  const tg0 = curve.getTangentAt(0);
  const side0 = new THREE.Vector3().crossVectors(tg0, new THREE.Vector3(0, 1, 0)).normalize();
  pole.position.copy(start).addScaledVector(side0, 0.5).setY(0.9);
  flag.position.copy(pole.position).add(new THREE.Vector3(0, 0.45, 0)).addScaledVector(side0, 0.56);
  flag.lookAt(flag.position.clone().add(tg0));
  world.add(pole, flag);
  const flagBase = flagGeo.attributes.position.array.slice();

  // The car, in the team's colour.
  const car = await paintedCar(d.driver.team.color);
  const carHolder = new THREE.Group();
  if (car) {
    const box = new THREE.Box3().setFromObject(car);
    const len = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    car.scale.setScalar(0.62 / len);
    // The Kenney car points along +Z.
    carHolder.add(car);
    world.add(carHolder);
  }
  const glow = new THREE.PointLight(0xffc83d, 3, 3, 2);
  carHolder.add(glow);
  glow.position.y = 0.4;

  const gold = sparkle(B, { count: 240, area: [14, 12, 14], color: "#ffd56a", size: 0.07 });
  scene.add(gold.points);
  const spin = spinner({ idle: 0.12 });
  const p = new THREE.Vector3();
  const tg = new THREE.Vector3();
  const idxCount = lineGeo.index.count;

  return {
    scene,
    camera,
    update(t, dt) {
      gold.update(t);
      // In: the track rises and turns into view.
      const k = easeOut(span(t, 0, 1.4));
      world.position.y = -4 + k * 4;
      world.scale.setScalar(0.7 + 0.3 * k);
      world.rotation.y = spin.update(dt) + (1 - k) * 1.2;
      // The car laps; the gold line follows it round the first time.
      const lap = Math.max(0, t - 0.6) / 5.2;
      const u = lap % 1;
      curve.getPointAt(u, p);
      curve.getTangentAt(u, tg);
      carHolder.position.set(p.x, 0.06, p.z);
      carHolder.rotation.y = Math.atan2(tg.x, tg.z);
      line.geometry.setDrawRange(0, Math.floor((idxCount * Math.min(1, lap)) / 6) * 6);
      // The flag waves.
      const a = flagGeo.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) {
        const x = flagBase[i] + 0.55;
        a[i + 2] = Math.sin(x * 5 - t * 7) * 0.06 * x;
      }
      flagGeo.attributes.position.needsUpdate = true;
      // The camera, high and a little to the side, leaning with the phone.
      frameBox(camera, stage.size.aspect, { w: 9.4, h: 6.4, dir: new THREE.Vector3(tilt.x * 0.25, 0.9 + tilt.y * 0.15, 1), hFrac: 0.42, ndcY: 0.1 });
    },
    drag(dx) {
      spin.drag(dx);
    },
    release() {
      spin.release();
    },
    dispose: () => B.dispose(),
  };
}
