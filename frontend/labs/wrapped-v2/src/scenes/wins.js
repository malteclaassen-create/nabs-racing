// The wins: one gold trophy per win rising onto its plinth, confetti across
// the whole screen. Tap a trophy and it jumps, spins and throws confetti;
// drag to turn them.
import { THREE, bag, chrome, confetti, label, spinner, span, easeOutBack, frameBox } from "./kit.js";
import { tilt } from "../tilt.js";

export function trophyGeometry() {
  // The cup's outline, turned on a lathe.
  const pts = [
    [0.0, 0.0], [0.52, 0.0], [0.52, 0.1], [0.3, 0.16], [0.14, 0.3], [0.1, 0.62], [0.16, 0.7], [0.12, 0.78],
    [0.2, 0.86], [0.42, 1.05], [0.56, 1.35], [0.62, 1.7], [0.64, 2.0], [0.58, 2.02], [0.55, 1.72], [0.48, 1.38], [0.3, 1.1], [0.0, 1.0],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 48);
}

export function handleGeometry(side) {
  const g = new THREE.TorusGeometry(0.26, 0.05, 10, 24, Math.PI);
  g.rotateZ(side > 0 ? -Math.PI / 2 : Math.PI / 2);
  g.translate(side * 0.6, 1.5, 0);
  return g;
}

export default function wins(stage, d, { slide }) {
  const B = bag();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(slide.bg);
  const camera = new THREE.PerspectiveCamera(36, stage.size.aspect, 0.1, 100);
  camera.position.set(0, 3, 16);
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a2a00, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-4, 9, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffd36b, 2);
  rim.position.set(6, 3, -6);
  scene.add(rim);

  const gold = B.add(chrome(0xffc532, { rough: 0.16 }));
  const plinthMat = B.add(new THREE.MeshStandardMaterial({ color: 0x1b0d03, roughness: 0.45, metalness: 0.3 }));
  const plateMat = B.add(chrome(0xd8d8d8, { rough: 0.25 }));
  const cupGeo = B.add(trophyGeometry());
  const hl = B.add(handleGeometry(-1));
  const hr = B.add(handleGeometry(1));
  const plinthGeo = B.add(new THREE.CylinderGeometry(0.9, 1.05, 1.1, 40));
  const baseGeo = B.add(new THREE.BoxGeometry(1.1, 0.28, 1.1));
  const plateGeo = B.add(new THREE.BoxGeometry(0.62, 0.16, 0.02));

  const group = new THREE.Group();
  scene.add(group);
  const n = Math.max(1, d.wins.length);
  const gap = Math.min(3, 6 / n);
  const items = d.wins.map((w, i) => {
    const holder = new THREE.Group();
    holder.position.x = (i - (n - 1) / 2) * gap;
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = -0.55;
    const base = new THREE.Mesh(baseGeo, plinthMat);
    base.position.y = 0.14;
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(0, 0.14, 0.56);
    const cup = new THREE.Group();
    cup.add(new THREE.Mesh(cupGeo, gold), new THREE.Mesh(hl, gold), new THREE.Mesh(hr, gold));
    cup.position.y = 0.28;
    const tag = label(w.track.toUpperCase(), { color: "#170800", bg: "#ffffff", size: 44, height: 0.5 });
    B.add({ dispose: tag.userData.dispose });
    tag.position.set(0, -1.35, 1.1);
    holder.add(plinth, base, plate, cup, tag);
    group.add(holder);
    return { holder, cup, at: 0.5 + i * 0.35, jump: -10, spin: 0 };
  });

  const paper = confetti(B, { count: 420, colors: ["#ffd400", "#ffffff", "#39ff14", "#170800"], area: [18, 28, 8], center: [0, 0, -1] });
  scene.add(paper.mesh);
  const spin = spinner({ idle: 0.2 });
  const ray = new THREE.Raycaster();
  let clock = 0;

  return {
    scene,
    camera,
    update(t, dt) {
      clock = t;
      paper.update(t, dt);
      for (const it of items) {
        const k = span(t, it.at, it.at + 0.9);
        const s = Math.max(0.0001, easeOutBack(k));
        it.holder.scale.setScalar(s);
        it.holder.position.y = (1 - Math.min(1, s)) * -3;
        const j = span(t, it.jump, it.jump + 0.9);
        it.cup.position.y = 0.28 + Math.sin(j * Math.PI) * 1.6;
        it.spin += dt * (0.6 + (j > 0 && j < 1 ? 12 * (1 - j) : 0));
        it.cup.rotation.y = it.spin;
      }
      group.rotation.y = spin.update(dt) * 0.4 + Math.sin(t * 0.4) * 0.15 + tilt.x * 0.3;
      frameBox(camera, stage.size.aspect, { center: new THREE.Vector3(0, 0.6, 0), w: n * gap + 1.4, h: 4.6, dir: new THREE.Vector3(tilt.x * 0.2, 0.22, 1), hFrac: 0.42, ndcY: 0.12 });
    },
    drag(dx) {
      spin.drag(dx);
    },
    release() {
      spin.release();
    },
    tap(ndc) {
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(items.map((i) => i.holder), true)[0];
      if (!hit) return false;
      const it = items.find((i) => i.holder === hit.object.parent || i.cup === hit.object.parent || i.holder === hit.object.parent?.parent);
      if (it && clock - it.jump > 0.9) {
        it.jump = clock;
        const at = new THREE.Vector3();
        it.cup.getWorldPosition(at);
        paper.burst({ x: at.x, y: at.y + 1.5 }, 9);
      }
      return true;
    },
    dispose: () => B.dispose(),
  };
}
