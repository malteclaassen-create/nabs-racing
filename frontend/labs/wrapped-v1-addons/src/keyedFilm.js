// The intro with the ribbons running behind the car: the ribbons first, then
// the film on top. The film is rendered on a clear background and carries its
// own alpha: the picture in its top half, the alpha (as grey) in its bottom
// half, so only the car, its shadow and its reflection cover the ribbons.
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
  // Read raw (whether a video texture arrives decoded from sRGB differs by
  // browser): the shader decodes it itself.
  tex.colorSpace = THREE.NoColorSpace;
  const uniforms = {
    map: { value: tex },
    uvScale: { value: new THREE.Vector2(1, 1) },
    uvOffset: { value: new THREE.Vector2() },
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
      fragmentShader: `uniform sampler2D map; uniform vec2 uvScale; uniform vec2 uvOffset; varying vec2 vUv;
        void main(){
          vec2 uv = vUv * uvScale + uvOffset;
          // The picture is premultiplied (drawn over black), so it adds as is.
          vec3 c = texture2D(map, vec2(uv.x, 0.5 + uv.y * 0.5)).rgb;
          float a = texture2D(map, vec2(uv.x, uv.y * 0.5)).g;
          gl_FragColor = vec4(pow(c, vec3(2.2)), a);
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
    const va = (video.videoWidth || 9) / ((video.videoHeight || 32) / 2);
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
