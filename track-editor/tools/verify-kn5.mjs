/**
 * Round trip test for the direct kn5 writer.
 *
 *   node --import ./tools/ts-resolve.mjs tools/verify-kn5.mjs
 *
 * Builds a small track scene with the real writer and re-reads it with an
 * independent parser written here (no shared code). The layout expectations
 * come from byte-level analysis of ksEditor output and Kunos' own magione.kn5.
 */

import * as THREE from 'three';
import { buildKn5, splitForUint16, KN5_MAX_VERTICES } from '../src/export/kn5.ts';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name} ${detail}`); }
}

/* ------------------------------------------------------------------ */
/* Independent reader                                                  */
/* ------------------------------------------------------------------ */

function readKn5(bytes) {
  const b = Buffer.from(bytes);
  let p = 0;
  const i32 = () => { const v = b.readInt32LE(p); p += 4; return v; };
  const f32 = () => { const v = b.readFloatLE(p); p += 4; return v; };
  const u8 = () => b[p++];
  const str = () => { const n = i32(); const s = b.toString('ascii', p, p + n); p += n; return s; };

  const magic = b.toString('ascii', 0, 6);
  p = 6;
  const version = i32();
  const extra = version > 5 ? i32() : null;

  const textures = [];
  for (let i = 0, n = i32(); i < n; i++) {
    const type = i32();
    const name = str();
    const size = i32();
    textures.push({ type, name, size, head: b.toString('hex', p, p + 4) });
    p += size;
  }

  const materials = [];
  for (let i = 0, n = i32(); i < n; i++) {
    const name = str();
    const shader = str();
    const blend = u8(), tested = u8();
    const depth = i32();
    const values = {};
    let zeros = true;
    for (let j = 0, pn = i32(); j < pn; j++) {
      const key = str();
      values[key] = b.readFloatLE(p);
      for (let k = 4; k < 40; k++) if (b[p + k] !== 0) zeros = false;
      p += 40;
    }
    const slots = [];
    for (let j = 0, sn = i32(); j < sn; j++) {
      const sampler = str();
      const slot = i32();
      slots.push({ sampler, slot, tex: str() });
    }
    materials.push({ name, shader, blend, tested, depth, values, zeros, slots });
  }

  const meshes = [];
  const dummies = [];
  let rootChildren = null;
  let rootName = null;
  (function node(depth) {
    const type = i32();
    const name = str();
    const cc = i32();
    const active = u8();
    if (depth === 0) { rootChildren = cc; rootName = name; }
    if (type === 1) {
      const m = [];
      for (let i = 0; i < 16; i++) m.push(f32());
      dummies.push({ name, m, active });
    } else {
      const castShadows = u8(), visible = u8(), transparent = u8();
      const vc = i32();
      const verts = [];
      for (let i = 0; i < vc; i++) {
        verts.push({
          pos: [f32(), f32(), f32()],
          nrm: [f32(), f32(), f32()],
          uv: [f32(), f32()],
          tan: [f32(), f32(), f32()],
        });
      }
      const ic = i32();
      const idx = [];
      for (let i = 0; i < ic; i++) { idx.push(b.readUInt16LE(p)); p += 2; }
      const mat = i32();
      const layer = i32();
      const lodIn = f32(), lodOut = f32();
      const sphere = [f32(), f32(), f32(), f32()];
      const renderable = u8();
      meshes.push({ name, castShadows, visible, transparent, verts, idx, mat, layer, lodIn, lodOut, sphere, renderable });
    }
    for (let i = 0; i < cc; i++) node(depth + 1);
  })(0);

  if (p !== b.length) throw new Error(`reader stopped at ${p} of ${b.length}`);
  return { magic, version, extra, textures, materials, meshes, dummies, rootChildren, rootName };
}

/* ------------------------------------------------------------------ */
/* Scene round trip                                                    */
/* ------------------------------------------------------------------ */

console.log('\nkn5 writer round trip');

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const road = new THREE.PlaneGeometry(12, 400, 1, 8);
road.rotateX(-Math.PI / 2);
const box = new THREE.BoxGeometry(8, 4, 7);
box.translate(-40, 2, 25);
const pad = new THREE.BoxGeometry(30, 0.3, 20);
pad.translate(60, -0.11, -30);

const yaw = THREE.MathUtils.degToRad(30);
const markerQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));

const bytes = buildKn5({
  rootName: 'test_track',
  materials: [
    { name: 'asphalt', textureName: 'asphalt.png', textureBytes: png },
    { name: 'prop_light', textureName: 'prop_light.png', textureBytes: png },
    // The one kind of material AC has to look through: chain link fencing.
    { name: 'chainlink', textureName: 'chainlink.png', textureBytes: png, alphaTested: true },
  ],
  meshes: [
    { name: '1ROAD_track', geometry: road, material: 0 },
    { name: '1PROP_WALL_box_0', geometry: box, material: 1 },
    { name: '1WALL_box_0', geometry: box, material: 1, renderable: false },
    // A ground pad: visible but shadow free, drivable through its twin.
    { name: '1PROP_ROAD_pad_0', geometry: pad, material: 0, castShadows: false },
    { name: '1ROAD_pad_0', geometry: pad, material: 0, renderable: false },
  ],
  nulls: [{ name: 'AC_START_0', pos: [10, -0.5, 20], quat: markerQ }],
});

let parsed = null;
try {
  parsed = readKn5(bytes);
  check('file parses to the exact last byte', true);
} catch (err) {
  check('file parses to the exact last byte', false, err.message);
}

if (parsed) {
  check('magic and version match ksEditor output', parsed.magic === 'sc6969' && parsed.version === 6 && parsed.extra === 0,
    `${parsed.magic} v${parsed.version} extra=${parsed.extra}`);
  check('textures embed with type 1 and intact bytes',
    parsed.textures.length === 3 && parsed.textures.every((t) => t.type === 1 && t.head === '89504e47'),
    JSON.stringify(parsed.textures));

  const mat = parsed.materials[0];
  check('material carries the six ksPerPixel properties',
    Object.keys(mat.values).join(',') === 'ksAmbient,ksDiffuse,ksSpecular,ksSpecularEXP,ksEmissive,ksAlphaRef',
    Object.keys(mat.values).join(','));
  check('lighting values are in the Kunos range',
    Math.abs(mat.values.ksAmbient - 0.5) < 1e-6 && Math.abs(mat.values.ksDiffuse - 0.5) < 1e-6 &&
    Math.abs(mat.values.ksSpecular - 0.06) < 1e-6 && Math.abs(mat.values.ksSpecularEXP - 20) < 1e-6,
    JSON.stringify(mat.values));
  check('unused property bytes stay zero', parsed.materials.every((m) => m.zeros));

  /*
   * See-through geometry. A texture with holes in it is not enough on its own:
   * unless the material asks for the alpha test, AC ignores the channel and
   * draws the panel solid, which is a catch fence that is really a wall. The
   * numbers are Kunos': magione.kn5 carries `Trees_ext` and `transp_AT` on
   * ksPerPixelAT with alphaTested 1, ksAlphaRef 0.5 and no specular at all.
   * ksAlphaRef is the cut off -- left at 0 nothing is ever discarded, so the
   * flag alone would still give a solid fence.
   */
  {
    const plain = parsed.materials.filter((m) => m.name !== 'chainlink');
    const holes = parsed.materials.find((m) => m.name === 'chainlink');
    check('an alpha tested material asks for the AT shader',
      holes && holes.shader === 'ksPerPixelAT' && holes.tested === 1 && holes.blend === 0,
      holes && `${holes.shader} blend=${holes.blend} tested=${holes.tested}`);
    check('and carries a cut off, or the flag would do nothing',
      holes && Math.abs(holes.values.ksAlphaRef - 0.5) < 1e-6, holes && `${holes.values.ksAlphaRef}`);
    check('with no specular, because wire has nothing to glint off',
      holes && holes.values.ksSpecular === 0, holes && `${holes.values.ksSpecular}`);
    check('while every other material is left exactly as it was',
      plain.every((m) => m.shader === 'ksPerPixel' && m.tested === 0 && m.values.ksAlphaRef === 0),
      plain.map((m) => `${m.name}/${m.shader}/${m.tested}/${m.values.ksAlphaRef}`).join(' '));
    check('and it is still opaque, not blended -- no depth sorting needed',
      holes && holes.blend === 0 && holes.depth === 0);
  }
  check('txDiffuse slot points at the texture',
    mat.slots.length === 1 && mat.slots[0].sampler === 'txDiffuse' && mat.slots[0].slot === 0 && mat.slots[0].tex === 'asphalt.png',
    JSON.stringify(mat.slots));

  check('root node holds every child', parsed.rootChildren === 6 && parsed.rootName === 'test_track',
    `${parsed.rootName} children=${parsed.rootChildren}`);

  const roadMesh = parsed.meshes.find((m) => m.name === '1ROAD_track');
  const pos = road.getAttribute('position');
  check('vertex count round trips', roadMesh && roadMesh.verts.length === pos.count,
    roadMesh && `${roadMesh.verts.length} vs ${pos.count}`);
  let maxErr = 0;
  if (roadMesh) {
    for (let i = 0; i < pos.count; i++) {
      maxErr = Math.max(maxErr,
        Math.abs(roadMesh.verts[i].pos[0] - pos.getX(i)),
        Math.abs(roadMesh.verts[i].pos[1] - pos.getY(i)),
        Math.abs(roadMesh.verts[i].pos[2] - pos.getZ(i)));
    }
  }
  check('vertex positions are exact', roadMesh && maxErr < 1e-6, `max error ${maxErr}`);
  const idx = road.getIndex();
  check('indices round trip', roadMesh && roadMesh.idx.length === idx.count &&
    roadMesh.idx.every((v, i) => v === idx.getX(i)));

  check('tangents are unit length and perpendicular to the normal',
    roadMesh && roadMesh.verts.every((v) => {
      const len = Math.hypot(...v.tan);
      const dot = v.tan[0] * v.nrm[0] + v.tan[1] * v.nrm[1] + v.tan[2] * v.nrm[2];
      return Math.abs(len - 1) < 1e-3 && Math.abs(dot) < 1e-3;
    }));

  for (const m of parsed.meshes) {
    let worst = -Infinity;
    for (const v of m.verts) {
      const d = Math.hypot(v.pos[0] - m.sphere[0], v.pos[1] - m.sphere[1], v.pos[2] - m.sphere[2]);
      worst = Math.max(worst, d - m.sphere[3]);
    }
    if (worst > 0) check(`bounding sphere of ${m.name} contains all vertices`, false, `overshoot ${worst}`);
  }
  check('bounding spheres contain every vertex', true);

  const vis = parsed.meshes.find((m) => m.name === '1PROP_WALL_box_0');
  const phys = parsed.meshes.find((m) => m.name === '1WALL_box_0');
  check('visible prop renders and casts shadows', vis && vis.renderable === 1 && vis.castShadows === 1);
  check('physics copy is invisible and shadow-free', phys && phys.renderable === 0 && phys.castShadows === 0,
    phys && `renderable=${phys.renderable} cast=${phys.castShadows}`);
  check('physics copy shares the exact geometry', phys && vis &&
    JSON.stringify(phys.verts[0].pos) === JSON.stringify(vis.verts[0].pos) && phys.idx.length === vis.idx.length);

  const padVis = parsed.meshes.find((m) => m.name === '1PROP_ROAD_pad_0');
  const padPhys = parsed.meshes.find((m) => m.name === '1ROAD_pad_0');
  check('a ground pad renders without casting a shadow',
    padVis && padVis.renderable === 1 && padVis.castShadows === 0,
    padVis && `renderable=${padVis.renderable} cast=${padVis.castShadows}`);
  check('and gets a drivable ROAD twin, not a WALL',
    padPhys && padPhys.renderable === 0, padPhys && `renderable=${padPhys.renderable}`);

  const start = parsed.dummies.find((d) => d.name === 'AC_START_0');
  check('marker translation round trips', start &&
    Math.abs(start.m[12] - 10) < 1e-6 && Math.abs(start.m[13] + 0.5) < 1e-6 && Math.abs(start.m[14] - 20) < 1e-6,
    start && start.m.slice(12, 15).join(','));
  check('marker stands upright (Y basis is 0,1,0)', start &&
    Math.abs(start.m[4]) < 1e-6 && Math.abs(start.m[5] - 1) < 1e-6 && Math.abs(start.m[6]) < 1e-6,
    start && start.m.slice(4, 7).join(','));
  check('marker yaw round trips (X basis)', start &&
    Math.abs(start.m[0] - Math.cos(yaw)) < 1e-6 && Math.abs(start.m[2] + Math.sin(yaw)) < 1e-6,
    start && `${start.m[0]} ${start.m[2]}`);
}

/* ------------------------------------------------------------------ */
/* uint16 split                                                        */
/* ------------------------------------------------------------------ */

console.log('\nuint16 split');

{
  const triCount = 24000;                        // 72000 distinct vertices
  const positions = new Float32Array(triCount * 9);
  for (let i = 0; i < triCount * 3; i++) {
    positions[i * 3] = i % 977;
    positions[i * 3 + 1] = (i * 7) % 31;
    positions[i * 3 + 2] = Math.floor(i / 977);
  }
  const raw = {
    positions,
    normals: new Float32Array(triCount * 9).fill(1 / Math.sqrt(3)),
    uvs: new Float32Array(triCount * 6),
    indices: new Uint32Array(Array.from({ length: triCount * 3 }, (_, i) => i)),
  };
  const chunks = splitForUint16(raw);
  check('an oversized mesh splits', chunks.length === 2, `got ${chunks.length}`);
  check('every chunk fits uint16 indexing',
    chunks.every((c) => c.positions.length / 3 <= KN5_MAX_VERTICES));
  const totalTris = chunks.reduce((s, c) => s + c.indices.length / 3, 0);
  check('no triangle is lost', totalTris === triCount, `${totalTris} vs ${triCount}`);
  const last = chunks[chunks.length - 1];
  const li = last.indices.length - 3;
  const gi = triCount * 3 - 3;
  check('re-indexed vertices keep their coordinates',
    last.positions[last.indices[li] * 3] === raw.positions[raw.indices[gi] * 3] &&
    last.positions[last.indices[li] * 3 + 2] === raw.positions[raw.indices[gi] * 3 + 2]);

  const small = splitForUint16({ positions: new Float32Array(9), normals: new Float32Array(9), uvs: new Float32Array(6), indices: new Uint32Array([0, 1, 2]) });
  check('a small mesh passes through untouched', small.length === 1 && small[0].positions.length === 9);
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
