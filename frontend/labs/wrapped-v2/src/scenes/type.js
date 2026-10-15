// The racing type as a holographic trading card: the driver's number, name,
// team and season on the front under a rainbow foil that moves with the
// light as the card leans (with the phone's tilt or a drag). Tap to turn it
// over.
import { THREE, bag, canvasTexture, RoundedBoxGeometry, sparkle, span, easeOutBack, easeOut, frameBox } from "./kit.js";
import { tilt } from "../tilt.js";

function loadImage(src) {
  return new Promise((r) => {
    const i = new Image();
    i.onload = () => r(i);
    i.onerror = () => r(null);
    i.src = src;
  });
}

function holo(material, uniforms) {
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vHoloUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvHoloUv = uv;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec2 uTilt; uniform float uTime; uniform float uFoil; varying vec2 vHoloUv;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float h = fract(vHoloUv.x * 0.9 + vHoloUv.y * 0.6 + uTilt.x * 0.7 + uTilt.y * 0.5 + uTime * 0.02);
        vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float foil = uFoil * (0.35 + 0.65 * smoothstep(0.15, 0.85, lum));
        float band = exp(-pow((vHoloUv.x + vHoloUv.y - 1.0 - uTilt.x * 1.1 + uTilt.y * 0.4) * 5.0, 2.0));
        float grain = fract(sin(dot(floor(vHoloUv * 140.0), vec2(12.9898, 78.233))) * 43758.5453);
        diffuseColor.rgb += rainbow * foil * 0.32 + band * 0.42 + step(0.985, grain) * band * 0.8;`
      );
  };
}

export default async function type(stage, d, { slide }) {
  const B = bag();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(slide.bg);
  const camera = new THREE.PerspectiveCamera(34, stage.size.aspect, 0.1, 100);
  camera.position.set(0, 0.6, 12);
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  const logo = await loadImage("logo.png");
  const team = d.driver.team.color;
  const W = 600;
  const H = 880;

  const front = B.add(
    canvasTexture(W, H, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#0b0b12");
      g.addColorStop(0.55, "#141428");
      g.addColorStop(1, "#05050a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(W * 0.7, H * 0.36, 20, W * 0.7, H * 0.36, 420);
      glow.addColorStop(0, `${team}cc`);
      glow.addColorStop(1, `${team}00`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      // Frame.
      ctx.strokeStyle = team;
      ctx.lineWidth = 10;
      ctx.strokeRect(22, 22, W - 44, H - 44);
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "alphabetic";
      ctx.font = "700 22px 'JetBrains Mono', monospace";
      ctx.fillText(`NABS · ${d.season.label.toUpperCase()}`, 52, 82);
      if (logo) ctx.drawImage(logo, W - 52 - 64, 40, 64, 64);
      // The number, huge and outlined.
      ctx.font = "900 330px Archivo, sans-serif";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.strokeText(String(d.driver.number), 44, 420);
      ctx.fillStyle = `${team}`;
      ctx.globalAlpha = 0.25;
      ctx.fillText(String(d.driver.number), 44, 420);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 92px Archivo, sans-serif";
      ctx.fillText(d.driver.name.toUpperCase(), 48, 540);
      ctx.font = "700 26px 'JetBrains Mono', monospace";
      ctx.fillStyle = team;
      ctx.fillText(d.driver.team.name.toUpperCase(), 52, 584);
      // The type.
      ctx.fillStyle = team;
      ctx.fillRect(48, 626, W - 96, 4);
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 44px Archivo, sans-serif";
      const words = d.type.title.toUpperCase().split(" ");
      let line = "";
      let y = 690;
      for (const w of words) {
        if (ctx.measureText(`${line} ${w}`).width > W - 110 && line) {
          ctx.fillText(line, 48, y);
          line = w;
          y += 48;
        } else line = line ? `${line} ${w}` : w;
      }
      ctx.fillText(line, 48, y);
      // Stats along the bottom.
      const stats = [
        [`P${d.championship.position}`, "FINAL"],
        [d.championship.points, "PTS"],
        [d.stats.wins, "WINS"],
        [d.stats.podiums, "PODIUMS"],
      ];
      stats.forEach(([v, k], i) => {
        const x = 48 + i * 128;
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 40px Archivo, sans-serif";
        ctx.fillText(String(v), x, 808);
        ctx.font = "700 16px 'JetBrains Mono', monospace";
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText(k, x, 832);
      });
    })
  );
  const back = B.add(
    canvasTexture(W, H, (ctx) => {
      ctx.fillStyle = "#061400";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#39ff14";
      ctx.lineWidth = 10;
      ctx.strokeRect(22, 22, W - 44, H - 44);
      ctx.globalAlpha = 0.12;
      for (let y = 0; y < H; y += 90) for (let x = (y / 90) % 2 ? 45 : 0; x < W; x += 90) if (logo) ctx.drawImage(logo, x, y, 60, 60);
      ctx.globalAlpha = 1;
      if (logo) ctx.drawImage(logo, W / 2 - 110, H / 2 - 180, 220, 220);
      ctx.fillStyle = "#39ff14";
      ctx.textAlign = "center";
      ctx.font = "900 64px Archivo, sans-serif";
      ctx.fillText("NABS", W / 2, H / 2 + 120);
      ctx.font = "700 24px 'JetBrains Mono', monospace";
      ctx.fillText(`${d.season.label.toUpperCase()} WRAPPED`, W / 2, H / 2 + 166);
    })
  );
  const uniforms = { uTilt: { value: new THREE.Vector2() }, uTime: { value: 0 }, uFoil: { value: 1 } };
  const frontMat = B.add(new THREE.MeshBasicMaterial({ map: front }));
  holo(frontMat, uniforms);
  const backMat = B.add(new THREE.MeshBasicMaterial({ map: back }));
  holo(backMat, uniforms);
  const cw = 3.4;
  const ch = (cw * H) / W;
  const body = new THREE.Mesh(B.add(new RoundedBoxGeometry(cw + 0.06, ch + 0.06, 0.06, 4, 0.03)), B.add(new THREE.MeshBasicMaterial({ color: 0x0a0a0a })));
  const f = new THREE.Mesh(B.add(new THREE.PlaneGeometry(cw, ch)), frontMat);
  f.position.z = 0.032;
  const bk = new THREE.Mesh(B.add(new THREE.PlaneGeometry(cw, ch)), backMat);
  bk.rotation.y = Math.PI;
  bk.position.z = -0.032;
  const card = new THREE.Group();
  card.add(body, f, bk);
  const holder = new THREE.Group();
  holder.add(card);
  scene.add(holder);
  const dust = sparkle(B, { count: 260, area: [14, 20, 10], color: "#ffffff", size: 0.07 });
  scene.add(dust.points);

  // The lean: a drag pushes it, a spring brings it back toward the tilt.
  const lean = { x: 0, y: 0, vx: 0, vy: 0 };
  let flips = 0;
  let flipAt = -10;
  let clock = 0;
  const ray = new THREE.Raycaster();

  return {
    scene,
    camera,
    update(t, dt) {
      clock = t;
      dust.update(t);
      uniforms.uTime.value = t;
      // In: it spins in from far away.
      const k = span(t, 0.2, 1.6);
      const s = Math.max(0.001, easeOutBack(k));
      holder.scale.setScalar(s);
      const intro = (1 - easeOut(k)) * Math.PI * 4;
      // Spring toward the phone's tilt plus a slow sway.
      const tx = tilt.y * 0.35 + Math.sin(t * 0.7) * 0.08;
      const ty = tilt.x * 0.5 + Math.sin(t * 0.5) * 0.18;
      lean.vx += ((tx - lean.x) * 30 - lean.vx * 6) * dt;
      lean.vy += ((ty - lean.y) * 30 - lean.vy * 6) * dt;
      lean.x += lean.vx * dt;
      lean.y += lean.vy * dt;
      const fl = easeOut(span(t, flipAt, flipAt + 0.8));
      const flipAngle = (flips - 1 + fl) * Math.PI * (flipAt > 0 ? 1 : 0) + (flipAt > 0 ? 0 : flips * Math.PI);
      card.rotation.set(lean.x, lean.y + intro + flipAngle, 0);
      uniforms.uTilt.value.set(lean.y + Math.sin(t * 0.3) * 0.2, lean.x);
      frameBox(camera, stage.size.aspect, { w: cw + 0.6, h: ch + 0.4, dir: new THREE.Vector3(0, 0, 1), wFrac: 0.78, hFrac: 0.5, ndcY: 0.16 });
    },
    drag(dx, dy) {
      lean.vy += dx * 0.12;
      lean.vx += dy * 0.12;
    },
    tap(ndc) {
      ray.setFromCamera(ndc, camera);
      if (!ray.intersectObject(card, true)[0]) return false;
      if (clock - flipAt > 0.8) {
        flips += 1;
        flipAt = clock;
      }
      return true;
    },
    dispose: () => B.dispose(),
  };
}
