// The summary: the intro's ribbons again, slower, glowing behind the card.
import { THREE, bag, sparkle, spinner } from "./kit.js";
import { ribbons } from "./intro.js";
import { tilt } from "../tilt.js";

export default function summary(stage, d, { slide }) {
  const B = bag();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(slide.bg);
  const camera = new THREE.PerspectiveCamera(40, stage.size.aspect, 0.1, 100);
  camera.position.set(0, 0, 16);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 6, 8);
  scene.add(key);
  const r = ribbons(B, { opacity: 0.5 });
  r.group.position.y = 0.6;
  r.group.scale.setScalar(0.85);
  scene.add(r.group);
  const dust = sparkle(B, { count: 260, area: [14, 22, 10], color: "#39ff14", size: 0.06 });
  scene.add(dust.points);
  const spin = spinner({ idle: 0.12 });
  return {
    scene,
    camera,
    update(t, dt) {
      r.update(t);
      dust.update(t);
      r.group.rotation.y = spin.update(dt);
      r.group.rotation.x = Math.sin(t * 0.25) * 0.2 + tilt.y * 0.2;
      camera.position.x += (tilt.x * 1.4 - camera.position.x) * 0.05;
      camera.lookAt(0, 0.6, 0);
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
