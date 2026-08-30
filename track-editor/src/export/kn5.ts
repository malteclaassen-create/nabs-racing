import * as THREE from 'three';

/**
 * Direct .kn5 writer.
 *
 * The format was reverse engineered byte for byte in July 2026: independent
 * parsers walk both ksEditor output and Kunos' own track files (magione.kn5,
 * 959 meshes) to the exact last byte, and binary-patched files produced this
 * way were validated in game. The conventions replicated here are exactly
 * what ksEditor writes:
 *
 *   header      "sc6969", version 6, one extra int32 = 0
 *   textures    type 1, file name, byte size, raw image (PNG works in AC,
 *               proven in game -- DDS is a Kunos habit, not a requirement)
 *   materials   shader ksPerPixel, blend 0, alphaTested 0, depthMode 0,
 *               six properties (ksAmbient, ksDiffuse, ksSpecular,
 *               ksSpecularEXP, ksEmissive, ksAlphaRef), each a float in
 *               valueA followed by 36 zero bytes, then one txDiffuse slot
 *   nodes       dummy = type 1 + 4x4 float matrix (row-major, translation
 *               in floats 12..14 -- the same memory order as
 *               THREE.Matrix4.elements); mesh = type 2, three flag bytes,
 *               44-byte vertices (pos3 nrm3 uv2 tan3), uint16 indices,
 *               material id, layer, lod in/out, bounding sphere, renderable
 *
 * Physics meshes follow the Kunos pattern: invisible duplicates
 * (renderable=0). Rendering surface-named meshes instead trips a
 * view-direction-dependent culling bug in vanilla AC.
 */

export interface Kn5MaterialInput {
  name: string;
  /** File name recorded in the texture table, e.g. "asphalt.png". */
  textureName: string;
  /** Raw image bytes, embedded as-is. */
  textureBytes: Uint8Array;
  /**
   * The texture has holes in it and AC must honour them.
   *
   * Switches the shader to ksPerPixelAT and sets the alphaTested flag, which
   * is what Kunos do for anything you see through: magione.kn5 carries its
   * trees on ksTree and ksPerPixelAT, both flagged, both on one texture.
   * Left off, the engine ignores the alpha channel and draws the panel solid
   * -- a catch fence that is really a wall.
   */
  alphaTested?: boolean;
  /**
   * The material is a light source: a screen, a lit panel.
   *
   * Swaps in the lighting constants below so Assetto Corsa draws it at its own
   * brightness instead of the sun's. See EMISSIVE in textures.ts for which
   * materials ask for it.
   */
  emissive?: boolean;
}

export interface Kn5MeshInput {
  name: string;
  geometry: THREE.BufferGeometry;
  /** Index into the materials array. */
  material: number;
  /** false = invisible physics mesh (renderable 0, casts no shadows). */
  renderable?: boolean;
  /** Default true. Flat ground patches switch it off to avoid shadow acne. */
  castShadows?: boolean;
}

export interface Kn5NullInput {
  name: string;
  pos: [number, number, number];
  quat: THREE.Quaternion;
}

export interface Kn5Input {
  rootName: string;
  materials: Kn5MaterialInput[];
  meshes: Kn5MeshInput[];
  nulls: Kn5NullInput[];
}

/** Lighting constants in the range Kunos' own tracks use. */
const MATERIAL_PROPS: Array<[string, number]> = [
  ['ksAmbient', 0.5],
  ['ksDiffuse', 0.5],
  ['ksSpecular', 0.06],
  ['ksSpecularEXP', 20],
  ['ksEmissive', 0],
  ['ksAlphaRef', 0],
];

/**
 * The same six, tuned for a material AC has to alpha test.
 *
 * `ksAlphaRef` is the cut off: at 0 nothing is ever discarded, so a texture
 * full of holes still draws solid however the flag is set. The values are
 * Kunos': magione.kn5 carries `Trees_ext` and `transp_AT` on ksPerPixelAT with
 * ksAlphaRef 0.5 and no specular at all, which is right -- a wire fence has
 * nothing to glint off.
 */
const ALPHA_MATERIAL_PROPS: Array<[string, number]> = [
  ['ksAmbient', 0.4],
  ['ksDiffuse', 0.4],
  ['ksSpecular', 0],
  ['ksSpecularEXP', 10],
  ['ksEmissive', 0],
  ['ksAlphaRef', 0.5],
];

/**
 * The same six for a surface that emits rather than reflects.
 *
 * The work is done by ksAmbient, not by ksEmissive. Ambient is the term the
 * sun never reaches: pushed past 1 with diffuse taken down to almost nothing,
 * the material draws at its texture's own brightness in sun, in shade and at
 * dusk alike, which is exactly how a lamp behaves. ksEmissive is set as well
 * for the shaders that read it -- vanilla ksPerPixel may not, and nothing here
 * depends on it.
 *
 * What this does NOT do is cast light on anything around it. A glowing panel
 * lighting the barrier beside it is a Custom Shaders Patch light in a track
 * config, not a property of the model.
 */
const EMISSIVE_MATERIAL_PROPS: Array<[string, number]> = [
  ['ksAmbient', 1.3],
  ['ksDiffuse', 0.12],
  ['ksSpecular', 0],
  ['ksSpecularEXP', 10],
  ['ksEmissive', 1],
  ['ksAlphaRef', 0],
];

/** uint16 indices: a mesh can address at most this many vertices. */
export const KN5_MAX_VERTICES = 65535;

/* ------------------------------------------------------------------ */
/* Byte writer                                                         */
/* ------------------------------------------------------------------ */

/**
 * One growing byte buffer, written through a DataView.
 *
 * It used to keep an array of little Uint8Arrays, one per value written, and
 * join them at the end. That is fine for a header and ruinous for geometry: a
 * vertex is eleven floats, so a million triangle track wrote something like
 * thirty million tiny typed arrays, each with its own object and buffer
 * overhead. Measured on a three thousand object export, the heap went from
 * 33 MB to 2.3 GB and the tab died with "Out of Memory" -- for a file that is
 * 64 MB when it is finished.
 *
 * Doubling growth, so the peak is the buffer plus its replacement rather than
 * the whole file over again in fragments.
 */
class Out {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  private len = 0;

  private need(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  i32(v: number) { this.need(4); this.view.setInt32(this.len, v, true); this.len += 4; }
  u32(v: number) { this.need(4); this.view.setUint32(this.len, v, true); this.len += 4; }
  u16(v: number) { this.need(2); this.view.setUint16(this.len, v, true); this.len += 2; }
  u8(v: number) { this.need(1); this.buf[this.len] = v; this.len += 1; }
  f32(v: number) { this.need(4); this.view.setFloat32(this.len, v, true); this.len += 4; }

  str(s: string) {
    this.i32(s.length);
    this.need(s.length);
    for (let i = 0; i < s.length; i++) this.buf[this.len + i] = s.charCodeAt(i) & 0x7f;
    this.len += s.length;
  }

  raw(b: Uint8Array) {
    this.need(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/* ------------------------------------------------------------------ */
/* Geometry extraction                                                 */
/* ------------------------------------------------------------------ */

interface RawMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

function extract(geometry: THREE.BufferGeometry): RawMesh {
  const pos = geometry.getAttribute('position');
  const count = pos.count;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);

  const nrm = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
    if (nrm) {
      normals[i * 3] = nrm.getX(i);
      normals[i * 3 + 1] = nrm.getY(i);
      normals[i * 3 + 2] = nrm.getZ(i);
    } else {
      normals[i * 3 + 1] = 1;
    }
    if (uv) {
      uvs[i * 2] = uv.getX(i);
      uvs[i * 2 + 1] = uv.getY(i);
    }
  }

  const index = geometry.getIndex();
  let indices: Uint32Array;
  if (index) {
    indices = new Uint32Array(index.count);
    for (let i = 0; i < index.count; i++) indices[i] = index.getX(i);
  } else {
    indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
  }
  return { positions, normals, uvs, indices };
}

/**
 * Split a mesh into chunks that fit uint16 indexing. Triangles are packed
 * greedily; vertices are re-indexed per chunk. Nearly every mesh comes back
 * unchanged -- only a very dense terrain ever splits.
 */
export function splitForUint16(raw: RawMesh): RawMesh[] {
  const vertexCount = raw.positions.length / 3;
  if (vertexCount <= KN5_MAX_VERTICES) return [raw];

  const chunks: RawMesh[] = [];
  let map = new Map<number, number>();
  let verts: number[] = [];
  let tris: number[] = [];

  const flush = () => {
    if (tris.length === 0) return;
    const positions = new Float32Array(verts.length * 3);
    const normals = new Float32Array(verts.length * 3);
    const uvs = new Float32Array(verts.length * 2);
    verts.forEach((global, local) => {
      positions.set(raw.positions.subarray(global * 3, global * 3 + 3), local * 3);
      normals.set(raw.normals.subarray(global * 3, global * 3 + 3), local * 3);
      uvs.set(raw.uvs.subarray(global * 2, global * 2 + 2), local * 2);
    });
    chunks.push({ positions, normals, uvs, indices: new Uint32Array(tris) });
    map = new Map();
    verts = [];
    tris = [];
  };

  for (let t = 0; t + 2 < raw.indices.length; t += 3) {
    if (verts.length + 3 > KN5_MAX_VERTICES) flush();
    for (let k = 0; k < 3; k++) {
      const global = raw.indices[t + k];
      let local = map.get(global);
      if (local === undefined) {
        local = verts.length;
        map.set(global, local);
        verts.push(global);
      }
      tris.push(local);
    }
  }
  flush();
  return chunks;
}

/* ------------------------------------------------------------------ */
/* Node writers                                                        */
/* ------------------------------------------------------------------ */

function writeMesh(
  w: Out,
  name: string,
  raw: RawMesh,
  material: number,
  renderable: boolean,
  castShadows: boolean,
) {
  w.i32(2);                        // node type: static mesh
  w.str(name);
  w.i32(0);                        // children
  w.u8(1);                         // active

  w.u8(renderable && castShadows ? 1 : 0);   // invisible physics casts none
  w.u8(1);                         // visible
  w.u8(0);                         // transparent

  const count = raw.positions.length / 3;
  w.i32(count);
  let cx = 0, cy = 0, cz = 0;
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const px = raw.positions[i * 3], py = raw.positions[i * 3 + 1], pz = raw.positions[i * 3 + 2];
    cx += px; cy += py; cz += pz;
    w.f32(px); w.f32(py); w.f32(pz);
    n.set(raw.normals[i * 3], raw.normals[i * 3 + 1], raw.normals[i * 3 + 2]);
    w.f32(n.x); w.f32(n.y); w.f32(n.z);
    w.f32(raw.uvs[i * 2]); w.f32(raw.uvs[i * 2 + 1]);
    // ksPerPixel carries no normal map, so any unit tangent perpendicular to
    // the normal is as good as ksEditor's UV-derived ones.
    t.crossVectors(n, up);
    if (t.lengthSq() < 1e-6) t.set(1, 0, 0); else t.normalize();
    w.f32(t.x); w.f32(t.y); w.f32(t.z);
  }
  cx /= count || 1; cy /= count || 1; cz /= count || 1;

  w.i32(raw.indices.length);
  for (let i = 0; i < raw.indices.length; i++) w.u16(raw.indices[i]);

  w.i32(material);
  w.u32(0);                        // layer
  w.f32(0); w.f32(0);              // lod in / out: always drawn

  let r = 0;
  for (let i = 0; i < count; i++) {
    const dx = raw.positions[i * 3] - cx;
    const dy = raw.positions[i * 3 + 1] - cy;
    const dz = raw.positions[i * 3 + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r) r = d;
  }
  w.f32(cx); w.f32(cy); w.f32(cz);
  w.f32(Math.sqrt(r) * 1.001);

  w.u8(renderable ? 1 : 0);
}

function writeNull(w: Out, node: Kn5NullInput) {
  w.i32(1);
  w.str(node.name);
  w.i32(0);
  w.u8(1);
  // THREE stores Matrix4.elements column-major with the translation at
  // [12..14] -- byte-identical to the kn5 layout, so compose and dump.
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...node.pos),
    node.quat,
    new THREE.Vector3(1, 1, 1),
  );
  for (const v of m.elements) w.f32(v);
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function buildKn5(input: Kn5Input): Uint8Array {
  const w = new Out();
  w.raw(new Uint8Array([0x73, 0x63, 0x36, 0x39, 0x36, 0x39]));   // "sc6969"
  w.i32(6);
  w.i32(0);

  w.i32(input.materials.length);
  for (const mat of input.materials) {
    w.i32(1);                      // texture type
    w.str(mat.textureName);
    w.i32(mat.textureBytes.length);
    w.raw(mat.textureBytes);
  }

  w.i32(input.materials.length);
  for (const mat of input.materials) {
    w.str(mat.name);
    // Alpha TESTED, never alpha blended: a tested material stays in the opaque
    // pass, so a fence needs no sorting and cannot flicker against what is
    // behind it. Blending a mesh panel is how see-through geometry starts
    // fighting with itself over draw order.
    w.str(mat.alphaTested ? 'ksPerPixelAT' : 'ksPerPixel');
    w.u8(0);                       // blend: opaque
    w.u8(mat.alphaTested ? 1 : 0); // alpha tested
    w.i32(0);                      // depth mode: normal
    const props = mat.emissive
      ? EMISSIVE_MATERIAL_PROPS
      : mat.alphaTested ? ALPHA_MATERIAL_PROPS : MATERIAL_PROPS;
    w.i32(props.length);
    for (const [name, value] of props) {
      w.str(name);
      w.f32(value);
      w.raw(new Uint8Array(36));   // vec2 + vec3 + vec4 slots, unused
    }
    w.i32(1);
    w.str('txDiffuse');
    w.i32(0);
    w.str(mat.textureName);
  }

  // Split first so the root child count is known before any node is written.
  const flat: Array<{
    name: string; raw: RawMesh; material: number; renderable: boolean; castShadows: boolean;
  }> = [];
  for (const mesh of input.meshes) {
    const chunks = splitForUint16(extract(mesh.geometry));
    chunks.forEach((raw, i) => {
      flat.push({
        name: i === 0 ? mesh.name : `${mesh.name}.${i}`,
        raw,
        material: mesh.material,
        renderable: mesh.renderable !== false,
        castShadows: mesh.castShadows !== false,
      });
    });
  }

  w.i32(1);                        // root: dummy node
  w.str(input.rootName);
  w.i32(flat.length + input.nulls.length);
  w.u8(1);
  const identity = new THREE.Matrix4();
  for (const v of identity.elements) w.f32(v);

  for (const mesh of flat) {
    writeMesh(w, mesh.name, mesh.raw, mesh.material, mesh.renderable, mesh.castShadows);
  }
  for (const node of input.nulls) writeNull(w, node);

  return w.bytes();
}
