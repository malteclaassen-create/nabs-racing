// The biggest climb: the real car's film of the overtake underneath; over
// it, green chevrons climbing both edges of the frame and one position plate
// per place gained flying up past them. Drag to put your foot down.
import { THREE, bag, label, span } from "./kit.js";

export default function climb(stage, d) {
  const B = bag();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, stage.size.aspect, 0.1, 100);
  camera.position.set(0, 0, 14);

  // A chevron, pointing up.
  const shape = new THREE.Shape();
  shape.moveTo(-0.6, -0.2);
  shape.lineTo(0, 0.35);
  shape.lineTo(0.6, -0.2);
  shape.lineTo(0.6, 0.05);
  shape.lineTo(0, 0.6);
  shape.lineTo(-0.6, 0.05);
  shape.closePath();
  const geo = B.add(new THREE.ShapeGeometry(shape));
  const mat = B.add(new THREE.MeshBasicMaterial({ color: 0x39ff14, transparent: true, toneMapped: false, depthWrite: false }));
  const per = 9;
  const chev = new THREE.InstancedMesh(geo, mat, per * 2);
  chev.frustumCulled = false;
  scene.add(chev);

  // The plates: P14, P13 ... up to the finish.
  const from = d.climb.grid;
  const plates = [];
  for (let i = 0; i <= d.climb.gained; i++) {
    const pos = from - i;
    const s = label(`P${pos}`, { color: i === d.climb.gained ? "#061400" : "#ffffff", bg: i === d.climb.gained ? "#39ff14" : "rgba(0,0,0,0.55)", size: 54, height: 0.8 });
    B.add({ dispose: s.userData.dispose });
    s.material.opacity = 0;
    scene.add(s);
    plates.push({ s, at: 1 + i * 0.42, last: i === d.climb.gained, base: s.scale.clone() });
  }

  let boost = 0;
  let travel = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const halfH = () => Math.tan(THREE.MathUtils.degToRad(20)) * 14;

  return {
    scene,
    camera,
    transparent: true,
    update(t, dt) {
      const H = halfH();
      const W = H * stage.size.aspect;
      travel += dt * (1.6 + boost * 6);
      boost *= Math.pow(0.15, dt);
      const fadeIn = span(t, 0.2, 1);
      for (let side = 0; side < 2; side++) {
        for (let i = 0; i < per; i++) {
          const k = (((i / per + travel * 0.18) % 1) + 1) % 1;
          const y = -H - 1 + k * (H * 2 + 2);
          const x = (side ? 1 : -1) * (W - 0.55);
          const fade = Math.sin(k * Math.PI);
          p.set(x, y, 0);
          sc.setScalar(0.55 * (0.6 + 0.4 * fade) * fadeIn);
          m4.compose(p, q, sc);
          chev.setMatrixAt(side * per + i, m4);
        }
      }
      chev.instanceMatrix.needsUpdate = true;
      mat.opacity = 0.85;
      // Each plate flies up the right-hand side, the last one stays.
      for (const pl of plates) {
        const k = span(t, pl.at, pl.at + 1.1);
        if (pl.last) {
          const e = 1 - Math.pow(1 - k, 3);
          pl.s.position.set(W - 1.7, -H + e * (H * 1.1), 0.5);
          pl.s.material.opacity = Math.min(1, k * 3);
          pl.s.scale.copy(pl.base).multiplyScalar(k >= 1 ? 1.25 + Math.sin(t * 6) * 0.06 : 1);
        } else {
          pl.s.position.set(W - 1.7, -H + k * (H * 2 + 1), 0.5);
          pl.s.material.opacity = k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0;
        }
      }
    },
    drag(dx, dy) {
      boost = Math.min(3, boost + (Math.abs(dx) + Math.abs(dy)) * 0.02);
    },
    dispose: () => B.dispose(),
  };
}
