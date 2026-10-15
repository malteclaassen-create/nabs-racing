// One WebGL canvas for the whole story. Each slide hands it a "scene":
//
//   { scene, camera, update(t, dt), transparent?, bloom?, drag?(dx, dy, e),
//     tap?(ndc) -> true if it used the tap, dispose() }
//
// It draws at most 60 times a second (a 120 Hz phone would otherwise draw
// every frame twice as often), at no more than 1.5x the pixels, and drops the
// glow and then pixels when the phone can't keep up.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export function createStage(canvas, { onFrame } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  let dpr = Math.min(1.5, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // No tone mapping: a scene's background must match the page's colour
  // exactly, or the edges of each slide's circle would show.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const size = { w: 1, h: 1, aspect: 1 };
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  // A soft glow on what is really bright (emissive bands, sparkle), not on
  // ordinary lit colour.
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.35, 0.94);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let bloomOn = true;

  let current = null;
  let running = true;
  let last = 0;
  let lastDraw = 0;
  let t = 0;
  // Frame times, for dropping quality on a phone that can't keep up.
  let slow = 0;
  let samples = 0;

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    size.w = w;
    size.h = h;
    size.aspect = w / h;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    bloom.resolution.set(Math.round((w * dpr) / 2), Math.round((h * dpr) / 2));
    if (current?.camera?.isPerspectiveCamera) {
      current.camera.aspect = size.aspect;
      current.camera.updateProjectionMatrix();
    }
    current?.resize?.(size);
  }
  window.addEventListener("resize", resize);
  resize();

  function draw() {
    if (!current) {
      renderer.clear();
      return;
    }
    const { scene, camera } = current;
    if (current.transparent || !bloomOn || current.bloom === false) {
      renderer.setClearColor(0x000000, 0);
      renderer.render(scene, camera);
    } else {
      renderPass.scene = scene;
      renderPass.camera = camera;
      composer.render();
    }
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    // At most 60 draws a second.
    if (now - lastDraw < 15.5) return;
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    lastDraw = now;
    t += dt;
    onFrame?.(dt);
    if (current) {
      current.update?.(current.clock ?? t, dt, size);
      draw();
    }
    // Watch the frame rate for a few seconds at a time.
    if (dt > 0) {
      samples += 1;
      if (dt > 0.026) slow += 1;
      if (samples >= 120) {
        if (slow > 60) degrade();
        samples = 0;
        slow = 0;
      }
    }
  }
  requestAnimationFrame(frame);

  // ?hq keeps full quality, for looking at it in a slow test browser.
  const keep = new URLSearchParams(location.search).has("hq");
  function degrade() {
    if (keep) return;
    if (bloomOn) {
      bloomOn = false;
      return;
    }
    if (dpr > 1) {
      dpr = 1;
      renderer.setPixelRatio(1);
      resize();
    }
  }

  return {
    THREE,
    renderer,
    env,
    size,
    get scene() {
      return current;
    },
    set(sceneDef) {
      const old = current;
      current = sceneDef;
      if (current?.camera?.isPerspectiveCamera) {
        current.camera.aspect = size.aspect;
        current.camera.updateProjectionMatrix();
      }
      current?.resize?.(size);
      if (current) {
        if (current.scene.environment === undefined || current.scene.environment === null) current.scene.environment = env;
      }
      if (old && old !== current) old.dispose?.();
      draw();
    },
    // Compile a scene's shaders ahead, so opening its slide doesn't stall.
    warm(sceneDef) {
      try {
        if (sceneDef.scene.environment == null) sceneDef.scene.environment = env;
        renderer.compile(sceneDef.scene, sceneDef.camera);
      } catch {
        /* a warm-up is only a nicety */
      }
    },
    pause(on) {
      running = !on;
      if (running) {
        last = 0;
        requestAnimationFrame(frame);
      }
    },
    resize,
  };
}
