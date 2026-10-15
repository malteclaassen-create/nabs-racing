// The intro with the ribbons running behind the car: the ribbons first, then
// the film on top with its black background keyed out, so only the car (and
// what is lit) covers them.
import { THREE, bag, sparkle, spinner } from "../../wrapped-v2/src/scenes/kit.js";
import { ribbons } from "../../wrapped-v2/src/scenes/intro.js";

export default function keyedFilm(stage, video, { opacity = 0.9 } = {}) {
  const B = bag();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, stage.size.aspect, 0.1, 100);
  camera.position.set(0, 0, 15);
  scene.add(camera);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 6, 8);
  scene.add(key);
  const r = ribbons(B, { opacity });
  scene.add(r.group);
  const dust = sparkle(B, { count: 160, area: [12, 20, 10], color: "#b6ff00", size: 0.06 });
  scene.add(dust.points);

  // The film on a plane that fills the view, cropped like object-fit: cover.
  const tex = B.add(new THREE.VideoTexture(video));
  tex.colorSpace = THREE.SRGBColorSpace;
  // The film is light on black: read it as light with its own coverage
  // (premultiplied), so the glow round the car adds to the ribbons instead
  // of cutting a dark, blocky edge into them. Coverage comes from a softened
  // brightness, so compression blocks in the glow don't show.
  const uniforms = {
    map: { value: tex },
    uvScale: { value: new THREE.Vector2(1, 1) },
    uvOffset: { value: new THREE.Vector2() },
    texel: { value: new THREE.Vector2(1 / 1080, 1 / 1920) },
  };
  const mat = B.add(
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform sampler2D map; uniform vec2 uvScale; uniform vec2 uvOffset; uniform vec2 texel; varying vec2 vUv;
        float lum(vec3 c) { return pow(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0), 1.0 / 2.2); }
        void main(){
          vec2 uv = vUv * uvScale + uvOffset;
          vec4 c = texture2D(map, uv);
          float lc = lum(c.rgb);
          // A soft brightness: the average over a small ring round the pixel.
          float soft = lc;
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.785398;
            soft += lum(texture2D(map, uv + vec2(cos(a), sin(a)) * texel * 5.0).rgb);
          }
          soft /= 9.0;
          float solid = smoothstep(0.1, 0.24, lc);
          float glow = smoothstep(0.0, 0.3, soft) * 0.8;
          float a = max(solid, glow);
          vec4 col = vec4(c.rgb, a);
          gl_FragColor = col;
          #include <colorspace_fragment>
          gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(1.0));
        }`,
    })
  );
  const D = 5;
  const plane = new THREE.Mesh(B.add(new THREE.PlaneGeometry(1, 1)), mat);
  plane.position.z = -D;
  plane.renderOrder = 10;
  camera.add(plane);
  const spin = spinner({ idle: 0.18 });

  function fit(size) {
    const h = 2 * D * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    plane.scale.set(h * size.aspect, h, 1);
    uniforms.texel.value.set(1 / (video.videoWidth || 1080), 1 / (video.videoHeight || 1920));
    const va = (video.videoWidth || 9) / (video.videoHeight || 16);
    if (va > size.aspect) {
      uniforms.uvScale.value.set(size.aspect / va, 1);
      uniforms.uvOffset.value.set((1 - size.aspect / va) / 2, 0);
    } else {
      uniforms.uvScale.value.set(1, va / size.aspect);
      uniforms.uvOffset.value.set(0, (1 - va / size.aspect) / 2);
    }
  }

  return {
    scene,
    camera,
    transparent: true,
    resize: fit,
    update(t, dt, size) {
      fit(size);
      r.update(t);
      dust.update(t);
      r.group.rotation.y = spin.update(dt);
      r.group.rotation.x = Math.sin(t * 0.3) * 0.15;
    },
    dispose: () => B.dispose(),
  };
}
