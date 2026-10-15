// Round by round: the championship position as a twisting ribbon through
// the season, higher meaning further up the table, a marker and the place at
// each round, the car riding it from round 1 to the last while the camera
// follows and then pulls back. Drag to look round it.
import { THREE, bag, ribbonGeometry, glowRibbonMaterial, label, sparkle, paintedCar, spinner, span, easeInOut } from "./kit.js";
import { tilt } from "../tilt.js";

export default async function rounds(stage, d, { slide }) {
  const B = bag();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(slide.bg);
  scene.fog = new THREE.Fog(slide.bg, 14, 30);
  const camera = new THREE.PerspectiveCamera(40, stage.size.aspect, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x101010, 1));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(4, 8, 6);
  scene.add(key);

  const j = d.championship.journey;
  const worst = Math.max(...j.map((x) => x.position));
  const step = 1.15;
  const x0 = -((j.length - 1) * step) / 2;
  const pts = j.map((r, i) => new THREE.Vector3(x0 + i * step, (worst + 1 - r.position) * 0.95, Math.sin(i * 0.9) * 0.9));
  // Lead in and out, so the band starts and ends gently.
  const curve = new THREE.CatmullRomCurve3([pts[0].clone().add(new THREE.Vector3(-1.5, -0.6, 0)), ...pts, pts.at(-1).clone().add(new THREE.Vector3(1.5, 0.4, 0))], false, "centripetal");
  const geo = B.add(ribbonGeometry(curve, { width: 0.32, segments: 500, twist: 1.5, colors: ["#0b6b00", "#39ff14", "#f4ffd6"] }));
  const band = new THREE.Mesh(geo, B.add(glowRibbonMaterial({ glow: 0.8 })));
  const world = new THREE.Group();
  world.add(band);
  scene.add(world);

  // A post and the place at every round.
  const postMat = B.add(new THREE.MeshBasicMaterial({ color: 0x39ff14, transparent: true, opacity: 0.25 }));
  const ballGeo = B.add(new THREE.SphereGeometry(0.13, 16, 12));
  const markers = j.map((r, i) => {
    const best = r.position === Math.min(...j.map((x) => x.position));
    const ball = new THREE.Mesh(ballGeo, B.add(new THREE.MeshBasicMaterial({ color: best ? 0xffd84d : 0xffffff, toneMapped: false })));
    ball.position.copy(pts[i]);
    const post = new THREE.Mesh(B.add(new THREE.CylinderGeometry(0.015, 0.015, pts[i].y + 1, 6)), postMat);
    post.position.set(pts[i].x, (pts[i].y - 1) / 2, pts[i].z);
    const tag = label(`P${r.position}`, { color: best ? "#061400" : "#ffffff", bg: best ? "#ffd84d" : "rgba(255,255,255,0.12)", size: 40, height: 0.42 });
    B.add({ dispose: tag.userData.dispose });
    tag.position.copy(pts[i]).add(new THREE.Vector3(0, 0.5, 0));
    const round = label(`R${r.round}`, { color: "rgba(255,255,255,0.6)", size: 30, font: "700 {s}px 'JetBrains Mono', monospace", height: 0.3 });
    B.add({ dispose: round.userData.dispose });
    round.position.set(pts[i].x, -1.2, pts[i].z);
    world.add(ball, post, tag, round);
    return { ball, tag, round, u: (i + 1) / (j.length + 1) };
  });

  const car = await paintedCar(d.driver.team.color);
  const rider = new THREE.Group();
  if (car) {
    const box = new THREE.Box3().setFromObject(car);
    car.scale.setScalar(0.7 / Math.max(box.max.x - box.min.x, box.max.z - box.min.z));
    rider.add(car);
    world.add(rider);
  }
  const dust = sparkle(B, { count: 300, area: [22, 16, 14], color: "#39ff14", size: 0.06 });
  scene.add(dust.points);
  const spin = spinner({ idle: 0 });
  const p = new THREE.Vector3();
  const tg = new THREE.Vector3();
  const look = new THREE.Vector3();
  const idx = geo.index.count;

  return {
    scene,
    camera,
    update(t, dt) {
      dust.update(t);
      // The band draws itself with the car at its head.
      const k = easeInOut(span(t, 0.4, 6.4));
      geo.setDrawRange(0, Math.floor((idx * k) / 6) * 6);
      curve.getPointAt(Math.max(0.001, k), p);
      curve.getTangentAt(Math.max(0.001, k), tg);
      rider.position.copy(p).add(new THREE.Vector3(0, 0.12, 0));
      rider.lookAt(p.clone().add(tg));
      for (const m of markers) {
        const on = span(k, m.u - 0.04, m.u + 0.02);
        m.ball.scale.setScalar(Math.max(0.001, on));
        m.tag.material.opacity = on;
        m.round.material.opacity = on;
      }
      // The camera rides beside the car, then pulls back to the whole season.
      const out = easeInOut(span(t, 6, 8));
      const near = p.clone().add(new THREE.Vector3(-1.5, 2.2, 6.5));
      const far = new THREE.Vector3(0, 3.4, 17.5);
      camera.position.lerpVectors(near, far, out);
      camera.position.x += tilt.x * 1.2;
      camera.position.y += tilt.y * 0.8;
      look.lerpVectors(p, new THREE.Vector3(0, 2.2, 0), out);
      camera.lookAt(look);
      world.rotation.y = spin.update(dt) * 0.5;
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
