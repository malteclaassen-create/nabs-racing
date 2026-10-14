// ---------------------------------------------------------------------------
// The site's 3D race car: Kenney's CC0 formula car from the Racing Kit
// (public/models/kenney-racing-kit, see its README). One load per page, shared
// by the telemetry's 3D replay (utils/lapViewer3d.js) and Season Wrapped's
// story (utils/wrappedScenes.js); each clones the template and paints it.
//
// Drawn at the size of the car the league races, formula_2010: a 2010 Formula
// 1 car is at most 1.8 m wide and 0.95 m tall, and about 4.8 m long. The model
// is a toy's proportions, so it is scaled to each of the three on its own
// rather than by its length alone, which made it a car 2.6 m wide. The wheels
// are then scaled back round, at the height's scale: 0.67 m across, as a 2010
// tyre is.
// ---------------------------------------------------------------------------
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const CAR_URL = "/models/kenney-racing-kit/raceCar.glb";
export const CAR_SIZE = { length: 4.8, width: 1.8, height: 0.95 }; // metres
// The model's material that takes a colour of our choosing.
export const CAR_PAINT = "red";
const WHEEL = /^wheel[-_]?(front|back)/i;

let carModel = null;

// The template, nose along +x, wheels on the ground, centred on the origin.
// Clone it (`template.clone(true)`) rather than adding it anywhere.
export function loadRaceCar() {
  if (!carModel) {
    carModel = new GLTFLoader().loadAsync(CAR_URL).then((gltf) => {
      const root = gltf.scene;
      // The model runs along z; the front wheels say which way it faces.
      let front = 0;
      root.traverse((o) => { if (WHEEL.test(o.name) && /front/i.test(o.name)) front += o.position.z; });
      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      const scale = new THREE.Vector3(CAR_SIZE.width / size.x, CAR_SIZE.height / size.y, CAR_SIZE.length / size.z);
      root.scale.copy(scale);
      root.traverse((o) => { if (o !== root && WHEEL.test(o.name)) o.scale.set(1, 1, scale.y / scale.z); });
      // Nose along +x, like everything else here.
      root.rotation.y = front >= 0 ? Math.PI / 2 : -Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(root);
      // Wheels on the ground, centred on the recorded point.
      const box = new THREE.Box3().setFromObject(holder);
      const centre = box.getCenter(new THREE.Vector3());
      holder.position.set(-centre.x, -box.min.y, -centre.z);
      return holder;
    });
  }
  return carModel;
}
