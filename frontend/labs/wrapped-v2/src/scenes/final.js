// The final table: the real car's podium film underneath; over it confetti
// in the colour of the place (gold, silver, bronze) across the whole frame.
// Drag a finger across to throw more.
import { THREE, bag, confetti, sparkle } from "./kit.js";

export default function final(stage, d) {
  const B = bag();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, stage.size.aspect, 0.1, 100);
  camera.position.set(0, 0, 14);
  const p = d.championship.position;
  const metal = p === 1 ? "#ffd84d" : p === 2 ? "#dfe3ea" : p === 3 ? "#e39a5f" : "#ffffff";
  const paper = confetti(B, { count: 380, colors: [metal, "#ffffff", d.driver.team.color, metal], area: [14, 24, 6], center: [0, 0, 0], size: 0.2, speed: 0.9 });
  scene.add(paper.mesh);
  const glints = sparkle(B, { count: 160, area: [12, 20, 6], color: metal, size: 0.08 });
  scene.add(glints.points);
  let last = -10;

  return {
    scene,
    camera,
    transparent: true,
    update(t, dt) {
      paper.update(t, dt);
      glints.update(t);
      paper.mesh.visible = t > 1.1;
    },
    // Dragging a finger across throws confetti where it goes.
    drag(dx, dy, e) {
      // The story's clock stands still while a finger is down.
      const now = performance.now() / 1000;
      if (now - last < 0.12) return;
      last = now;
      const h = Math.tan(THREE.MathUtils.degToRad(20)) * 14;
      const nx = (e.clientX / innerWidth) * 2 - 1;
      const ny = -(e.clientY / innerHeight) * 2 + 1;
      paper.burst({ x: nx * h * stage.size.aspect, y: ny * h }, 8);
    },
    dispose: () => B.dispose(),
  };
}
