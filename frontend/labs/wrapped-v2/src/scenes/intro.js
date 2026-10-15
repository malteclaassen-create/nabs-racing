// The intro: the real car's film underneath, and over it glowing ribbons
// that draw themselves in and wrap the frame. A drag spins them.
import { THREE, bag, ribbonGeometry, glowRibbonMaterial, sparkle, spinner, span, easeOut } from "./kit.js";
import { tilt } from "../tilt.js";

export function ribbons(B, { palette = [["#39ff14", "#d8ff3d", "#ffffff"], ["#ffffff", "#39ff14"], ["#0b6b00", "#39ff14", "#b6ff00"]], opacity = 0.92 } = {}) {
  const group = new THREE.Group();
  const loops = [
    // A wide loop round the frame, through the top and the bottom.
    { pts: (u) => [Math.cos(u) * 4.4, Math.sin(u) * 7.8, Math.sin(u * 2) * 2.2 - 2], w: 0.26, twist: 3, at: 0 },
    // An S across, in front.
    { pts: (u) => [Math.sin(u) * 5.2, Math.cos(u * 1) * 7.2 + Math.sin(u * 3) * 0.8, Math.cos(u * 2) * 2 - 1], w: 0.16, twist: 5, at: 0.25 },
    // A slow wave behind, larger.
    { pts: (u) => [Math.cos(u) * 6.4, Math.sin(u * 2) * 3.4 + Math.cos(u) * 5.6, -5 + Math.sin(u) * 2], w: 0.45, twist: 2, at: 0.5 },
  ];
  const items = loops.map((l, i) => {
    const pts = [];
    for (let k = 0; k < 24; k++) pts.push(new THREE.Vector3(...l.pts((k / 24) * Math.PI * 2)));
    const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
    const geo = B.add(ribbonGeometry(curve, { width: l.w, segments: 420, twist: l.twist, colors: palette[i % palette.length] }));
    const mesh = new THREE.Mesh(geo, B.add(glowRibbonMaterial({ glow: 0.75, opacity })));
    group.add(mesh);
    return { mesh, at: l.at, count: geo.index.count };
  });
  return {
    group,
    // Each draws itself in, one after another.
    update(t) {
      for (const it of items) {
        const k = easeOut(span(t, it.at, it.at + 1.6));
        it.mesh.geometry.setDrawRange(0, Math.floor((it.count * k) / 6) * 6);
      }
    },
  };
}

export default function intro(stage) {
  const B = bag();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, stage.size.aspect, 0.1, 100);
  camera.position.set(0, 0, 15);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 6, 8);
  scene.add(key);

  const r = ribbons(B, { opacity: 0.68 });
  scene.add(r.group);
  const dust = sparkle(B, { count: 220, area: [12, 20, 10], color: "#b6ff00", size: 0.06 });
  scene.add(dust.points);
  const spin = spinner({ idle: 0.18 });

  return {
    scene,
    camera,
    transparent: true,
    update(t, dt) {
      r.update(t);
      dust.update(t);
      const a = spin.update(dt);
      r.group.rotation.y = a;
      r.group.rotation.x = Math.sin(t * 0.3) * 0.15 + tilt.y * 0.2;
      camera.position.x += (tilt.x * 1.6 - camera.position.x) * 0.06;
      camera.lookAt(0, 0, 0);
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
