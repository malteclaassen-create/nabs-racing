// The team-mate battle as towers: one block per race (left pair) and per
// qualifying (right pair) the driver beat the other, yours in the team's
// colour, theirs in white, dropping in turn. Tap a tower to shake it; drag
// to walk round them.
import { THREE, bag, RoundedBoxGeometry, label, sparkle, spinner, span, frameBox } from "./kit.js";
import { tilt } from "../tilt.js";

const drop = (k) => {
  if (k <= 0) return 1;
  if (k >= 1) return 0;
  // Fall, then a small bounce.
  const f = 0.72;
  if (k < f) return 1 - (k / f) * (k / f);
  const b = (k - f) / (1 - f);
  return Math.sin(b * Math.PI) * 0.08;
};

export default function teammate(stage, d, { slide }) {
  const B = bag();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(slide.bg);
  const camera = new THREE.PerspectiveCamera(36, stage.size.aspect, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a0a80, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(5, 10, 8);
  scene.add(key);

  const tm = d.teammate;
  const mine = new THREE.Color(d.driver.team.color);
  const geo = B.add(new RoundedBoxGeometry(0.9, 0.42, 0.9, 3, 0.08));
  const matMine = B.add(new THREE.MeshStandardMaterial({ color: mine, roughness: 0.35, metalness: 0.1, emissive: mine, emissiveIntensity: 0.25 }));
  const matThem = B.add(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.1 }));
  const floorMat = B.add(new THREE.MeshStandardMaterial({ color: 0x3d12b0, roughness: 0.8, transparent: true, opacity: 0.6 }));

  const group = new THREE.Group();
  scene.add(group);
  const towers = [];
  const pairs = [
    { x: -1.9, a: tm.ahead, b: tm.behind, name: "RACES", at: 0.6 },
    { x: 1.9, a: tm.qualiAhead, b: tm.qualiBehind, name: "QUALI", at: 0.9 },
  ];
  for (const p of pairs) {
    const floor = new THREE.Mesh(B.add(new THREE.CylinderGeometry(1.6, 1.6, 0.12, 40)), floorMat);
    floor.position.set(p.x, -0.06, 0);
    group.add(floor);
    const tag = label(p.name, { color: "#ffffff", size: 44, height: 0.42 });
    B.add({ dispose: tag.userData.dispose });
    tag.position.set(p.x, -0.55, 1.2);
    group.add(tag);
    for (const [side, n, mat] of [[-1, p.a, matMine], [1, p.b, matThem]]) {
      const tower = new THREE.Group();
      tower.position.set(p.x + side * 0.55, 0, 0);
      const blocks = [];
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(geo, mat);
        m.position.y = 0.21 + i * 0.44;
        tower.add(m);
        // Turn about: one of yours, one of theirs.
        blocks.push({ m, y: m.position.y, at: p.at + i * 0.32 + (side > 0 ? 0.16 : 0) });
      }
      group.add(tower);
      towers.push({ tower, blocks, shake: -10 });
    }
  }
  const dust = sparkle(B, { count: 200, area: [16, 24, 10], color: "#d9c8ff", size: 0.07 });
  scene.add(dust.points);
  const spin = spinner({ idle: 0.1 });
  const ray = new THREE.Raycaster();
  let clock = 0;

  return {
    scene,
    camera,
    update(t, dt) {
      clock = t;
      dust.update(t);
      for (const tw of towers) {
        for (const b of tw.blocks) {
          const k = span(t, b.at, b.at + 0.6);
          b.m.visible = k > 0;
          b.m.position.y = b.y + drop(k) * 9;
        }
        const s = span(t, tw.shake, tw.shake + 0.9);
        tw.tower.rotation.z = s > 0 && s < 1 ? Math.sin(s * 18) * 0.12 * (1 - s) : 0;
      }
      group.rotation.y = spin.update(dt) * 0.6 + Math.sin(t * 0.35) * 0.25 + tilt.x * 0.3;
      frameBox(camera, stage.size.aspect, { center: new THREE.Vector3(0, 1.6, 0), w: 7.6, h: 4.4, dir: new THREE.Vector3(tilt.x * 0.2, 0.3 + tilt.y * 0.1, 1), hFrac: 0.4, ndcY: 0.12 });
    },
    drag(dx) {
      spin.drag(dx);
    },
    release() {
      spin.release();
    },
    tap(ndc) {
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(towers.map((t) => t.tower), true)[0];
      if (!hit) return false;
      const tw = towers.find((t) => t.tower === hit.object.parent);
      if (tw) tw.shake = clock;
      return true;
    },
    dispose: () => B.dispose(),
  };
}
