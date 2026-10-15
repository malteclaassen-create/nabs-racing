// The season in numbers: one block per race dropping out of the sky into a
// wall, the round's number on each, the race without a finish in red and
// knocked askew. Tap a block to flip it and see where it was; drag to turn
// the wall.
import { THREE, bag, RoundedBoxGeometry, canvasTexture, sparkle, spinner, span, clamp, label, frameBox } from "./kit.js";
import { tilt } from "../tilt.js";

const bounce = (k) => {
  const n = 7.5625;
  const d = 2.75;
  if (k < 1 / d) return n * k * k;
  if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
  if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
  return n * (k -= 2.625 / d) * k + 0.984375;
};

export default function numbers(stage, d, { slide }) {
  const B = bag();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(slide.bg);
  const camera = new THREE.PerspectiveCamera(38, stage.size.aspect, 0.1, 100);
  camera.position.set(0, 1.5, 17);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x001a80, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(4, 8, 10);
  scene.add(key);

  const journey = d.championship.journey;
  // A race that scored nothing is the one without a finish here.
  const dnf = journey.findIndex((j, i) => i > 0 && j.points === journey[i - 1].points);
  const wall = new THREE.Group();
  scene.add(wall);
  const geo = B.add(new RoundedBoxGeometry(1.5, 1.5, 1.5, 4, 0.22));
  const cols = 4;
  const blocks = journey.map((j, i) => {
    const bad = i === dnf;
    const face = B.add(
      canvasTexture(256, 256, (ctx) => {
        ctx.fillStyle = bad ? "#ff2a2a" : "#39ff14";
        ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = bad ? "#2a0000" : "#061400";
        ctx.font = "900 150px Archivo, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(j.round), 128, 140);
        ctx.font = "700 22px 'JetBrains Mono', monospace";
        ctx.fillText(bad ? "DNF" : `P${j.position}`, 128, 36);
      })
    );
    const side = new THREE.MeshStandardMaterial({ color: bad ? 0xff2a2a : 0x39ff14, roughness: 0.35, metalness: 0.15, emissive: bad ? 0x330000 : 0x061a00 });
    const front = new THREE.MeshStandardMaterial({ map: face, roughness: 0.5, metalness: 0, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 0.08 });
    B.add(side);
    B.add(front);
    const mesh = new THREE.Mesh(geo, [side, side, side, side, front, side]);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const home = new THREE.Vector3((col - (cols - 1) / 2) * 1.75, (1 - row) * 1.75, 0);
    mesh.position.copy(home).setY(home.y + 14);
    wall.add(mesh);
    const tag = label(j.track.toUpperCase(), { color: "#061400", bg: "#ffffff", size: 44, height: 0.62 });
    tag.position.set(0, 1.25, 0.9);
    tag.material.opacity = 0;
    mesh.add(tag);
    B.add({ dispose: tag.userData.dispose });
    return { mesh, home, at: 0.35 + i * 0.11, bad, flip: -10, tag };
  });

  const dust = sparkle(B, { count: 260, area: [16, 26, 10], color: "#9fd0ff", size: 0.07 });
  scene.add(dust.points);
  const spin = spinner({ idle: 0 });
  const ray = new THREE.Raycaster();
  let clock = 0;

  return {
    scene,
    camera,
    update(t, dt) {
      clock = t;
      dust.update(t);
      for (const b of blocks) {
        const k = clamp(span(t, b.at, b.at + 0.9));
        const y = b.home.y + (1 - bounce(k)) * 14;
        b.mesh.position.set(b.home.x, y, b.home.z);
        // The race without a finish lands crooked.
        const settle = b.bad ? span(t, b.at + 0.9, b.at + 1.4) : 0;
        const f = span(t, b.flip, b.flip + 0.8);
        b.mesh.rotation.set(0, f * Math.PI * 2, settle * -0.5);
        b.tag.material.opacity = f > 0 && f < 1 ? Math.sin(f * Math.PI) : 0;
        b.tag.position.y = 1.25 + Math.sin(f * Math.PI) * 0.4;
      }
      wall.rotation.y = spin.update(dt) + Math.sin(t * 0.5) * 0.12 + tilt.x * 0.3;
      wall.rotation.x = -0.12 + tilt.y * 0.15;
      frameBox(camera, stage.size.aspect, { w: 7.4, h: 5.6, dir: new THREE.Vector3(tilt.x * 0.2, 0.12, 1), hFrac: 0.4, ndcY: 0.2 });
    },
    drag(dx) {
      spin.drag(dx);
    },
    release() {
      spin.release();
    },
    tap(ndc) {
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(blocks.map((b) => b.mesh), false)[0];
      if (!hit) return false;
      const b = blocks.find((x) => x.mesh === hit.object);
      if (clock - b.flip > 0.8) b.flip = clock;
      return true;
    },
    dispose: () => B.dispose(),
  };
}
