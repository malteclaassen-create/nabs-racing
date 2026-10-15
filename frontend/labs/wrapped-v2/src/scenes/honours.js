// Honours as medals: one per award, spinning down out of the dark and
// settling face on, ribbon and all, under a sky of stars. Tap a medal to
// flip it over.
import { THREE, bag, canvasTexture, chrome, sparkle, spinner, span, easeOutBack, easeOut, frameBox } from "./kit.js";
import { tilt } from "../tilt.js";

const FACES = {
  first: { top: "1ST", sub: "CHAMPION", metal: 0xffcf3a },
  second: { top: "2ND", sub: "OVERALL", metal: 0xdfe3ea },
  third: { top: "3RD", sub: "OVERALL", metal: 0xe39a5f },
  dotd: { top: "DOTD", sub: "DRIVER OF THE DAY", metal: 0xffcf3a },
};

function faceTexture(B, big, small, ink, fill) {
  const tex = B.add(
    canvasTexture(512, 512, (ctx) => {
      const g = ctx.createRadialGradient(200, 170, 40, 256, 256, 260);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.35, fill);
      g.addColorStop(1, ink);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(256, 256, 256, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(256, 256, 214, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#1b0a3d";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `900 ${big.length > 3 ? 120 : 170}px Archivo, sans-serif`;
      ctx.fillText(big, 256, 240);
      ctx.font = "700 30px 'JetBrains Mono', monospace";
      ctx.fillText(small, 256, 360);
    })
  );
  return tex;
}

export default function honours(stage, d, { slide }) {
  const B = bag();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(slide.bg);
  const camera = new THREE.PerspectiveCamera(36, stage.size.aspect, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1b0a3d, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-3, 6, 9);
  scene.add(key);

  const n = d.honours.length;
  const gap = Math.min(3.1, 6.2 / n);
  const coinGeo = B.add(new THREE.CylinderGeometry(1.15, 1.15, 0.16, 64));
  coinGeo.rotateX(Math.PI / 2);
  const discGeo = B.add(new THREE.CircleGeometry(1.1, 64));
  const medals = d.honours.map((h, i) => {
    const f = FACES[h.key] || { top: "★", sub: h.title.toUpperCase().slice(0, 18), metal: 0xffcf3a };
    const metal = new THREE.Color(f.metal);
    const css = `#${metal.getHexString()}`;
    const front = B.add(new THREE.MeshStandardMaterial({ map: faceTexture(B, f.top, f.sub, "#5a3a10", css), metalness: 0.65, roughness: 0.28 }));
    const back = B.add(new THREE.MeshStandardMaterial({ map: faceTexture(B, h.title.match(/×\s*(\d+)/) ? `×${h.title.match(/×\s*(\d+)/)[1]}` : "★", d.season.label.toUpperCase(), "#5a3a10", css), metalness: 0.65, roughness: 0.28 }));
    const rim = B.add(chrome(metal, { rough: 0.2 }));
    const coin = new THREE.Group();
    const faceF = new THREE.Mesh(discGeo, front);
    faceF.position.z = 0.081;
    const faceB = new THREE.Mesh(discGeo, back);
    faceB.position.z = -0.081;
    faceB.rotation.y = Math.PI;
    coin.add(new THREE.Mesh(coinGeo, rim), faceF, faceB);
    const holder = new THREE.Group();
    holder.position.x = (i - (n - 1) / 2) * gap;
    // The ribbon it hangs from.
    const ribbon = new THREE.Mesh(
      B.add(new THREE.PlaneGeometry(0.62, 1.5)),
      B.add(new THREE.MeshStandardMaterial({ color: i % 2 ? 0x39ff14 : 0xffffff, roughness: 0.6, side: THREE.DoubleSide }))
    );
    ribbon.position.set(0, 1.75, -0.15);
    holder.add(ribbon, coin);
    scene.add(holder);
    return { holder, coin, ribbon, at: 0.5 + i * 0.45, flip: 0, flipAt: -10 };
  });
  const stars = sparkle(B, { count: 520, area: [18, 30, 12], color: "#ffe9a8", size: 0.08 });
  scene.add(stars.points);
  const spin = spinner({ idle: 0 });
  const ray = new THREE.Raycaster();
  let clock = 0;

  return {
    scene,
    camera,
    update(t, dt) {
      clock = t;
      stars.update(t);
      for (const m of medals) {
        const k = span(t, m.at, m.at + 1.3);
        m.holder.position.y = (1 - easeOutBack(k)) * 9;
        // Spinning in, then face on; a flip turns it half round.
        const f = easeOut(span(t, m.flipAt, m.flipAt + 0.7));
        const target = m.flip * Math.PI;
        const from = target - (m.flipAt > 0 ? Math.PI : 0);
        m.coin.rotation.y = (1 - easeOut(k)) * Math.PI * 6 + (m.flipAt > 0 ? from + (target - from) * f : 0) + Math.sin(t * 1.2 + m.at) * 0.12;
        m.holder.rotation.z = Math.sin(t * 1.4 + m.at * 3) * 0.04;
      }
      scene.rotation.y = spin.update(dt) * 0.4 + tilt.x * 0.25;
      frameBox(camera, stage.size.aspect, { center: new THREE.Vector3(0, 0.4, 0), w: n * gap + 0.8, h: 4.2, dir: new THREE.Vector3(tilt.x * 0.15, 0.08 + tilt.y * 0.08, 1), hFrac: 0.4, ndcY: 0.12 });
    },
    drag(dx) {
      spin.drag(dx);
    },
    release() {
      spin.release();
    },
    tap(ndc) {
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(medals.map((m) => m.coin), true)[0];
      if (!hit) return false;
      const m = medals.find((x) => x.coin === hit.object.parent);
      if (clock - m.flipAt > 0.7) {
        m.flip += 1;
        m.flipAt = clock;
      }
      return true;
    },
    dispose: () => B.dispose(),
  };
}
