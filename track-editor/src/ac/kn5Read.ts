/**
 * Reader for Assetto Corsa's .kn5 model files -- the ones that are already out
 * there, written by ksEditor or by whatever a modder used ten years ago.
 *
 * This is the other half of src/export/kn5.ts. That one writes a brand new
 * model from the editor's own geometry and only ever needs the handful of
 * conventions Kunos use. This one has to read anything AC will load, and hand
 * it back afterwards WITHOUT LOSING A SINGLE BYTE, because an imported track is
 * somebody's finished work: 55 materials on shaders we have never heard of,
 * normal maps, reflections, alpha tricks, animated flags. Re-deriving any of
 * that would quietly wreck the track.
 *
 * So the rule here is: parse the structure, keep the payload verbatim.
 *
 *   - every string is latin1, which round trips all 256 byte values exactly
 *   - every float block (matrices, material values) is kept as a Float32Array
 *     over a COPY OF ITS OWN BYTES, so writing it back is a byte copy and no
 *     float ever makes a round trip through a JS number
 *   - vertex blocks, index blocks and texture data are Uint8Array VIEWS into
 *     the source buffer: no copy, no decode, exact on the way out
 *   - anything after the node tree (Custom Shaders Patch appends a marker, and
 *     sometimes an encrypted blob) is kept as `trailing` and re-appended
 *
 * Verified against the whole of a real installation: see tools/verify-kn5io.mjs,
 * which reads every .kn5 it can find, writes it back and compares bytes.
 *
 * Layout, version 5 and 6:
 *
 *   "sc6969", int32 version, int32 extra          (extra only when version > 5)
 *   int32 textureCount, each: int32 type, string name, int32 size, bytes
 *   int32 materialCount, each: string name, string shader, u8 blend,
 *         u8 alphaTested, int32 depthMode (version > 4), int32 propCount,
 *         each prop: string name + 40 bytes (float valueA, then vec2/vec3/vec4),
 *         int32 slotCount, each: string sampler, int32 slot, string texture
 *   node tree, depth first:
 *         int32 type, string name, int32 childCount, u8 active
 *     type 1 dummy:   16 floats
 *     type 2 mesh:    u8 castShadows, u8 visible, u8 transparent,
 *                     int32 vertexCount, vertices (44 bytes: pos3 nrm3 uv2 tan3),
 *                     int32 indexCount, uint16 indices, int32 material,
 *                     uint32 layer, float lodIn, float lodOut,
 *                     4 floats bounding sphere, u8 renderable
 *     type 3 skinned: the same but with int32 boneCount + bones (string + 16
 *                     floats) before the vertices, 76 byte vertices, and NO
 *                     bounding sphere and NO renderable byte at the end
 */

export interface Kn5Texture {
  /** 1 in every file seen; AC's own enum for "image file embedded here". */
  type: number;
  name: string;
  /** View into the source buffer. Usually DDS, sometimes PNG or JPG. */
  data: Uint8Array;
}

export interface Kn5MaterialProp {
  name: string;
  /**
   * Ten floats. [0] is the scalar AC calls valueA -- ksAmbient, ksDiffuse and
   * friends live there. [1..9] are the vec2/vec3/vec4 slots, zero in nearly
   * every material but carried anyway.
   */
  values: Float32Array;
}

export interface Kn5TextureSlot {
  sampler: string;
  slot: number;
  texture: string;
}

export interface Kn5Material {
  name: string;
  shader: string;
  blend: number;
  alphaTested: number;
  /** Absent (null) on version 4 and below, where the field does not exist. */
  depthMode: number | null;
  props: Kn5MaterialProp[];
  slots: Kn5TextureSlot[];
}

export interface Kn5Bone {
  name: string;
  matrix: Float32Array;
}

interface Kn5NodeCommon {
  name: string;
  active: number;
  children: Kn5Node[];
}

export interface Kn5Dummy extends Kn5NodeCommon {
  kind: 'dummy';
  /**
   * 16 floats in the same memory order as THREE.Matrix4.elements, which means
   * the translation sits at [12..14] and a Matrix4 can be fed from it directly.
   */
  matrix: Float32Array;
}

export interface Kn5Mesh extends Kn5NodeCommon {
  kind: 'mesh';
  /** 2 = static, 3 = skinned. */
  meshType: 2 | 3;
  castShadows: number;
  visible: number;
  transparent: number;
  /** Skinned meshes only. */
  bones: Kn5Bone[];
  vertexCount: number;
  /** Raw vertex block. 44 bytes per vertex, 76 when skinned. */
  vertices: Uint8Array;
  indexCount: number;
  /** Raw index block, uint16 little endian. */
  indices: Uint8Array;
  materialId: number;
  layer: number;
  lodIn: number;
  lodOut: number;
  /** centre x/y/z + radius. Static meshes only; null when skinned. */
  boundingSphere: Float32Array | null;
  /** 0 = invisible physics mesh. Skinned meshes have no such field; kept 1. */
  renderable: number;
}

export type Kn5Node = Kn5Dummy | Kn5Mesh;

export interface Kn5File {
  version: number;
  /** The extra int32 present from version 6 on. null below that. */
  extra: number | null;
  textures: Kn5Texture[];
  materials: Kn5Material[];
  root: Kn5Node;
  /**
   * Whatever followed the node tree, kept verbatim.
   *
   * Custom Shaders Patch appends `__AC_SHADERS_PATCH_KN5ENC_v1__` here, and on
   * some mods the model itself is encrypted and does not parse at all. Files
   * that merely carry the marker read fine and must keep it: drop it and CSP
   * stops recognising the model.
   */
  trailing: Uint8Array;
}

/** Bytes per vertex, by mesh type. */
export const KN5_VERTEX_STRIDE = 44;
export const KN5_SKINNED_VERTEX_STRIDE = 76;

export class Kn5ParseError extends Error {
  /** Byte offset the parser gave up at. Useful when a file is truncated. */
  offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = 'Kn5ParseError';
    this.offset = offset;
  }
}

/**
 * Bytes to a string, one byte per character, no interpretation at all.
 *
 * NOT `new TextDecoder('latin1')`. In the Encoding Standard "latin1" is a
 * label for windows-1252, which is not the identity map: byte 0x83 decodes to
 * U+0192 and 0x80 to U+20AC, both above U+00FF, so writing them back as single
 * bytes is impossible and they came out as '_'. One real file in the corpus
 * has a texture name with a 0x83 in it, and this is what the byte-for-byte
 * round trip test caught.
 *
 * Chunked because String.fromCharCode(...arr) blows the argument limit -- and
 * these strings are short, but the guard costs nothing.
 */
function decodeBytes(bytes: Uint8Array): string {
  const CHUNK = 8192;
  if (bytes.length <= CHUNK) return String.fromCharCode(...bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

class Reader {
  private view: DataView;
  bytes: Uint8Array;
  p = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(n: number, what: string) {
    if (this.p + n > this.bytes.length) {
      throw new Kn5ParseError(`ran past the end of the file reading ${what}`, this.p);
    }
  }

  i32(): number { this.need(4, 'int32'); const v = this.view.getInt32(this.p, true); this.p += 4; return v; }
  u32(): number { this.need(4, 'uint32'); const v = this.view.getUint32(this.p, true); this.p += 4; return v; }
  f32(): number { this.need(4, 'float'); const v = this.view.getFloat32(this.p, true); this.p += 4; return v; }
  u8(): number { this.need(1, 'byte'); return this.bytes[this.p++]; }

  str(): string {
    const n = this.i32();
    if (n < 0 || this.p + n > this.bytes.length) {
      throw new Kn5ParseError(`string length ${n} does not fit in the file`, this.p);
    }
    const s = decodeBytes(this.bytes.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }

  /** A zero copy view. Only ever used for blocks that are written back as-is. */
  view_(n: number, what: string): Uint8Array {
    this.need(n, what);
    const v = this.bytes.subarray(this.p, this.p + n);
    this.p += n;
    return v;
  }

  /**
   * n floats, as a Float32Array owning a copy of exactly those bytes.
   *
   * The copy is the point: `new Uint8Array(arr.buffer)` on the way out is then
   * the original bytes, so an untouched matrix is written back bit for bit
   * even if it holds a signalling NaN, which reading into a JS number and
   * writing it back would quietly canonicalise.
   */
  floats(n: number, what: string): Float32Array {
    const src = this.view_(n * 4, what);
    // slice() so the buffer is exactly this block and nothing else.
    return new Float32Array(src.slice().buffer);
  }
}

function readNode(r: Reader, version: number): Kn5Node {
  const type = r.i32();
  const name = r.str();
  const childCount = r.i32();
  const active = r.u8();

  let node: Kn5Node;
  if (type === 1) {
    node = { kind: 'dummy', name, active, children: [], matrix: r.floats(16, 'dummy matrix') };
  } else if (type === 2 || type === 3) {
    const castShadows = r.u8();
    const visible = r.u8();
    const transparent = r.u8();

    const bones: Kn5Bone[] = [];
    let stride = KN5_VERTEX_STRIDE;
    if (type === 3) {
      const boneCount = r.i32();
      if (boneCount < 0 || boneCount > 1e6) {
        throw new Kn5ParseError(`implausible bone count ${boneCount} on "${name}"`, r.p);
      }
      for (let i = 0; i < boneCount; i++) {
        bones.push({ name: r.str(), matrix: r.floats(16, 'bone matrix') });
      }
      stride = KN5_SKINNED_VERTEX_STRIDE;
    }

    const vertexCount = r.i32();
    if (vertexCount < 0) throw new Kn5ParseError(`negative vertex count on "${name}"`, r.p);
    const vertices = r.view_(vertexCount * stride, 'vertices');
    const indexCount = r.i32();
    if (indexCount < 0) throw new Kn5ParseError(`negative index count on "${name}"`, r.p);
    const indices = r.view_(indexCount * 2, 'indices');

    const materialId = r.i32();
    const layer = r.u32();
    const lodIn = r.f32();
    const lodOut = r.f32();

    // Static meshes carry a bounding sphere and a renderable flag here.
    // Skinned ones stop after the LOD range -- their bounds move with the
    // skeleton, so there is nothing static to store.
    const boundingSphere = type === 2 ? r.floats(4, 'bounding sphere') : null;
    const renderable = type === 2 ? r.u8() : 1;

    node = {
      kind: 'mesh', name, active, children: [], meshType: type,
      castShadows, visible, transparent, bones,
      vertexCount, vertices, indexCount, indices,
      materialId, layer, lodIn, lodOut, boundingSphere, renderable,
    };
  } else {
    throw new Kn5ParseError(`unknown node type ${type} on "${name}"`, r.p);
  }

  if (childCount < 0 || childCount > 1e7) {
    throw new Kn5ParseError(`implausible child count ${childCount} on "${name}"`, r.p);
  }
  for (let i = 0; i < childCount; i++) node.children.push(readNode(r, version));
  return node;
}

export function readKn5(bytes: Uint8Array): Kn5File {
  const r = new Reader(bytes);
  if (bytes.length < 10 || decodeBytes(bytes.subarray(0, 6)) !== 'sc6969') {
    throw new Kn5ParseError('not a kn5 file (bad magic)', 0);
  }
  r.p = 6;
  const version = r.i32();
  if (version < 3 || version > 6) {
    // Newer than we know is worth saying out loud rather than mis-parsing.
    throw new Kn5ParseError(`unsupported kn5 version ${version}`, 6);
  }
  const extra = version > 5 ? r.i32() : null;

  const textures: Kn5Texture[] = [];
  const textureCount = r.i32();
  for (let i = 0; i < textureCount; i++) {
    const type = r.i32();
    const name = r.str();
    const size = r.i32();
    if (size < 0) throw new Kn5ParseError(`negative texture size on "${name}"`, r.p);
    textures.push({ type, name, data: r.view_(size, `texture "${name}"`) });
  }

  const materials: Kn5Material[] = [];
  const materialCount = r.i32();
  for (let i = 0; i < materialCount; i++) {
    const name = r.str();
    const shader = r.str();
    const blend = r.u8();
    const alphaTested = r.u8();
    const depthMode = version > 4 ? r.i32() : null;

    const props: Kn5MaterialProp[] = [];
    const propCount = r.i32();
    for (let j = 0; j < propCount; j++) {
      const propName = r.str();
      props.push({ name: propName, values: r.floats(10, `material property "${propName}"`) });
    }

    const slots: Kn5TextureSlot[] = [];
    const slotCount = r.i32();
    for (let j = 0; j < slotCount; j++) {
      slots.push({ sampler: r.str(), slot: r.i32(), texture: r.str() });
    }
    materials.push({ name, shader, blend, alphaTested, depthMode, props, slots });
  }

  const root = readNode(r, version);
  const trailing = bytes.subarray(r.p);
  return { version, extra, textures, materials, root, trailing };
}

/* ------------------------------------------------------------------ */
/* Is what we parsed actually the whole file?                          */
/* ------------------------------------------------------------------ */

/**
 * How many trailing bytes are still a file we understand.
 *
 * Custom Shaders Patch appends a 42 byte block -- an int32 length, the string
 * `__AC_SHADERS_PATCH_KN5ENC_v1__`, and two ints -- to models it has touched.
 * That is fine: the tree before it parsed cleanly and the block is carried
 * along verbatim.
 *
 * CSP can also ENCRYPT a model, and then the node tree stops making sense part
 * way through and the rest of the file lands in `trailing` as megabytes of
 * ciphertext. Measured over a whole installation (1866 models): 1839 have no
 * trailing bytes at all, 6 have the 42 byte marker, and 21 -- every one of
 * them in the same encrypted mod -- have between 6 KB and 133 MB. There is no
 * middle ground, so a small limit separates the two cases cleanly.
 */
const TRAILING_MARKER_LIMIT = 64;

export interface Kn5Safety {
  /** Whether the parsed structure can be trusted for editing. */
  editable: boolean;
  reason: string | null;
}

/**
 * Whether this file may be EDITED, as opposed to merely copied.
 *
 * Copying is always safe -- writeKn5 puts the trailing bytes back untouched,
 * so even an encrypted model round trips byte for byte. But its node tree is
 * nonsense, so hiding a mesh or moving a marker in it would be guesswork. The
 * editor shows such a model as read only and passes it through.
 */
export function kn5Safety(file: Kn5File): Kn5Safety {
  if (file.trailing.length > TRAILING_MARKER_LIMIT) {
    return {
      editable: false,
      reason: `${file.trailing.length} bytes of this model were not understood — `
        + 'it is almost certainly encrypted by Custom Shaders Patch. '
        + 'It will be copied across unchanged, but cannot be edited.',
    };
  }
  return { editable: true, reason: null };
}

/* ------------------------------------------------------------------ */
/* Walking                                                             */
/* ------------------------------------------------------------------ */

/** Depth first walk. `path` is the slash joined names of the ancestors. */
export function walkKn5(
  root: Kn5Node,
  visit: (node: Kn5Node, path: string, parent: Kn5Node | null) => void,
) {
  const go = (node: Kn5Node, path: string, parent: Kn5Node | null) => {
    visit(node, path, parent);
    const childPath = path ? `${path}/${node.name}` : node.name;
    for (const child of node.children) go(child, childPath, node);
  };
  go(root, '', null);
}

export function findNode(root: Kn5Node, name: string): Kn5Node | null {
  let hit: Kn5Node | null = null;
  walkKn5(root, (node) => { if (!hit && node.name === name) hit = node; });
  return hit;
}

/** Every mesh in the tree, in file order. */
export function collectMeshes(root: Kn5Node): Kn5Mesh[] {
  const out: Kn5Mesh[] = [];
  walkKn5(root, (n) => { if (n.kind === 'mesh') out.push(n); });
  return out;
}

/** Every dummy in the tree, in file order. */
export function collectDummies(root: Kn5Node): Kn5Dummy[] {
  const out: Kn5Dummy[] = [];
  walkKn5(root, (n) => { if (n.kind === 'dummy') out.push(n); });
  return out;
}

/* ------------------------------------------------------------------ */
/* Vertex decoding                                                     */
/* ------------------------------------------------------------------ */

export interface DecodedMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
}

/**
 * Unpack a mesh into the arrays three.js wants.
 *
 * Only called for meshes actually put on screen -- the raw block stays the
 * source of truth, so a track can be held in memory at roughly its file size
 * and only what is being looked at costs anything extra.
 */
export function decodeMesh(mesh: Kn5Mesh): DecodedMesh {
  const stride = mesh.meshType === 3 ? KN5_SKINNED_VERTEX_STRIDE : KN5_VERTEX_STRIDE;
  const n = mesh.vertexCount;
  const dv = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    positions[i * 3] = dv.getFloat32(o, true);
    positions[i * 3 + 1] = dv.getFloat32(o + 4, true);
    positions[i * 3 + 2] = dv.getFloat32(o + 8, true);
    normals[i * 3] = dv.getFloat32(o + 12, true);
    normals[i * 3 + 1] = dv.getFloat32(o + 16, true);
    normals[i * 3 + 2] = dv.getFloat32(o + 20, true);
    uvs[i * 2] = dv.getFloat32(o + 24, true);
    uvs[i * 2 + 1] = dv.getFloat32(o + 28, true);
  }
  const indices = new Uint16Array(mesh.indexCount);
  const idv = new DataView(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);
  for (let i = 0; i < mesh.indexCount; i++) indices[i] = idv.getUint16(i * 2, true);
  return { positions, normals, uvs, indices };
}

/** World position of a dummy, straight out of its matrix. */
export function dummyPosition(d: Kn5Dummy): [number, number, number] {
  return [d.matrix[12], d.matrix[13], d.matrix[14]];
}
