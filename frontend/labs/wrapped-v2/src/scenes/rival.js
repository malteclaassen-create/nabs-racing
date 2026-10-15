// The closest rival: two bodies circling each other all season, each
// trailing a comet tail, the gap between them the points between them.
// Drag to spin them faster; tap one and it flares.
import { THREE, bag, label, spinner, frameBox } from "./kit.js";
import { tilt } from "../tilt.js";

export default function rival(stage, d, { slide }) {
  const B = bag();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(slide.bg);
  const camera = new THREE.PerspectiveCamera(38, stage.size.aspect, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x004d46, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(3, 8, 6);
  scene.add(key);

  const bodies = [
    { name: "YOU", color: new THREE.Color(d.driver.team.color), r: 0.62, phase: 0 },
    { name: d.rival.name.toUpperCase(), color: new THREE.Color("#ffffff"), r: 0.7, phase: Math.PI },
  ].map((b) => {
    const mesh = new THREE.Mesh(
      B.add(new THREE.IcosahedronGeometry(b.r, 4)),
      B.add(new THREE.MeshStandardMaterial({ color: b.color, emissive: b.color, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.2 }))
    );
    const halo = new THREE.Mesh(B.add(new THREE.RingGeometry(b.r * 1.25, b.r * 1.4, 48)), B.add(new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.5, side: THREE.DoubleSide })));
    mesh.add(halo);
    const tag = label(b.name, { color: "#00201c", bg: "#ffffff", size: 40, height: 0.42 });
    B.add({ dispose: tag.userData.dispose });
    tag.position.y = b.r + 0.55;
    mesh.add(tag);
    scene.add(mesh);
    // The tail: small spheres where it has been, shrinking away.
    const n = 70;
    const tail = new THREE.InstancedMesh(B.add(new THREE.SphereGeometry(1, 10, 8)), B.add(new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.55, toneMapped: false })), n);
    tail.frustumCulled = false;
    scene.add(tail);
    return { ...b, mesh, halo, tail, n, trail: [], flare: -10 };
  });

  // The points between them, as a dotted bridge.
  const gap = Math.max(1, d.rival.gap);
  const dots = new THREE.InstancedMesh(B.add(new THREE.SphereGeometry(0.07, 8, 6)), B.add(new THREE.MeshBasicMaterial({ color: 0x00201c })), gap);
  dots.frustumCulled = false;
  scene.add(dots);

  const spin = spinner({ idle: 0.9, friction: 1.2 });
  const ray = new THREE.Raycaster();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const p = new THREE.Vector3();
  let clock = 0;

  return {
    scene,
    camera,
    update(t, dt) {
      clock = t;
      const a = spin.update(dt);
      const R = 2.1 + Math.sin(t * 0.7) * 0.25;
      const center = new THREE.Vector3(0, 0, 0);
      for (const b of bodies) {
        const ang = a + b.phase;
        const tiltA = 0.45;
        b.mesh.position.set(center.x + Math.cos(ang) * R, center.y + Math.sin(ang) * R * Math.sin(tiltA) * 0.9, center.z + Math.sin(ang) * R * Math.cos(tiltA));
        b.mesh.rotation.y += dt;
        b.halo.lookAt(camera.position);
        const f = Math.max(0, 1 - (t - b.flare) / 0.8);
        b.mesh.scale.setScalar(1 + f * 0.5);
        b.mesh.material.emissiveIntensity = 0.55 + f * 1.5;
        b.trail.unshift(b.mesh.position.clone());
        if (b.trail.length > b.n) b.trail.pop();
        for (let i = 0; i < b.n; i++) {
          const pt = b.trail[i] || b.mesh.position;
          const s = b.r * 0.55 * (1 - i / b.n);
          m4.compose(pt, q, sc.setScalar(Math.max(0.0001, s)));
          b.tail.setMatrixAt(i, m4);
        }
        b.tail.instanceMatrix.needsUpdate = true;
      }
      // Dots spaced between the two.
      const [A, Bd] = bodies;
      for (let i = 0; i < gap; i++) {
        p.lerpVectors(A.mesh.position, Bd.mesh.position, (i + 1) / (gap + 1));
        p.y += Math.sin(t * 3 + i) * 0.05;
        m4.compose(p, q, sc.setScalar(1));
        dots.setMatrixAt(i, m4);
      }
      dots.instanceMatrix.needsUpdate = true;
      frameBox(camera, stage.size.aspect, { w: 6.4, h: 4.4, dir: new THREE.Vector3(tilt.x * 0.2, 0.2 + tilt.y * 0.1, 1), hFrac: 0.4, ndcY: 0.14 });
    },
    drag(dx) {
      spin.drag(dx);
    },
    release() {
      spin.release();
    },
    tap(ndc) {
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(bodies.map((b) => b.mesh), false)[0];
      if (!hit) return false;
      const b = bodies.find((x) => x.mesh === hit.object);
      b.flare = clock;
      return true;
    },
    dispose: () => B.dispose(),
  };
}
