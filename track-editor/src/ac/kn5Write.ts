import {
  KN5_SKINNED_VERTEX_STRIDE,
  KN5_VERTEX_STRIDE,
  type Kn5File,
  type Kn5Material,
  type Kn5Node,
} from './kn5Read';

/**
 * Writer for a parsed .kn5.
 *
 * The contract this file exists for: **read a track's model, write it back,
 * get the same bytes**. Everything the import feature does rests on that. If a
 * round trip through here changed even the padding in a material property, an
 * "import, move a pit box, export" would silently be an "import, move a pit
 * box, and also subtly rewrite fifty-five materials the modder tuned by hand".
 *
 * It is not an aspiration, it is a test: tools/verify-kn5io.mjs reads every
 * .kn5 in the installation, writes it back and compares byte for byte.
 *
 * How it is achieved:
 *   - the exact output size is computed first and the buffer allocated once,
 *     so a 116 MB model is written without a single reallocation, and the
 *     final length is checked against the prediction (a mismatch means the
 *     writer and the sizer disagree, which is a bug worth crashing on)
 *   - float blocks are written by copying the Float32Array's own bytes, never
 *     value by value, so no float passes through a JS number
 *   - vertex, index and texture blocks are copied straight from the views the
 *     reader handed out
 */

/**
 * Latin1 bytes of a string. The reader decodes latin1, so this is its exact
 * inverse for anything that came out of a file. Characters a byte cannot hold
 * can only come from a name somebody typed in the editor; they become '_'
 * rather than corrupting the length prefix.
 */
function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i] = c <= 0xff ? c : 0x5f;
  }
  return out;
}

function stringSize(s: string): number {
  return 4 + s.length;
}

function materialSize(m: Kn5Material): number {
  let n = stringSize(m.name) + stringSize(m.shader) + 1 + 1;
  if (m.depthMode !== null) n += 4;
  n += 4;
  for (const p of m.props) n += stringSize(p.name) + 40;
  n += 4;
  for (const s of m.slots) n += stringSize(s.sampler) + 4 + stringSize(s.texture);
  return n;
}

function nodeSize(node: Kn5Node): number {
  let n = 4 + stringSize(node.name) + 4 + 1;
  if (node.kind === 'dummy') {
    n += 64;
  } else {
    n += 3;
    if (node.meshType === 3) {
      n += 4;
      for (const b of node.bones) n += stringSize(b.name) + 64;
    }
    const stride = node.meshType === 3 ? KN5_SKINNED_VERTEX_STRIDE : KN5_VERTEX_STRIDE;
    n += 4 + node.vertexCount * stride;
    n += 4 + node.indexCount * 2;
    n += 4 + 4 + 4 + 4;                       // material, layer, lodIn, lodOut
    if (node.meshType === 2) n += 16 + 1;     // bounding sphere + renderable
  }
  for (const c of node.children) n += nodeSize(c);
  return n;
}

export function kn5Size(file: Kn5File): number {
  let n = 6 + 4 + (file.extra !== null ? 4 : 0);
  n += 4;
  for (const t of file.textures) n += 4 + stringSize(t.name) + 4 + t.data.length;
  n += 4;
  for (const m of file.materials) n += materialSize(m);
  n += nodeSize(file.root);
  n += file.trailing.length;
  return n;
}

class Writer {
  readonly bytes: Uint8Array;
  private view: DataView;
  p = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  i32(v: number) { this.view.setInt32(this.p, v, true); this.p += 4; }
  u32(v: number) { this.view.setUint32(this.p, v, true); this.p += 4; }
  f32(v: number) { this.view.setFloat32(this.p, v, true); this.p += 4; }
  u8(v: number) { this.bytes[this.p++] = v; }

  str(s: string) {
    this.i32(s.length);
    this.bytes.set(latin1Bytes(s), this.p);
    this.p += s.length;
  }

  raw(b: Uint8Array) {
    this.bytes.set(b, this.p);
    this.p += b.length;
  }

  /** The float block's own bytes, verbatim. No value ever becomes a JS number. */
  floats(f: Float32Array) {
    this.raw(new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
  }
}

function writeNode(w: Writer, node: Kn5Node) {
  w.i32(node.kind === 'dummy' ? 1 : node.meshType);
  w.str(node.name);
  w.i32(node.children.length);
  w.u8(node.active);

  if (node.kind === 'dummy') {
    w.floats(node.matrix);
  } else {
    w.u8(node.castShadows);
    w.u8(node.visible);
    w.u8(node.transparent);
    if (node.meshType === 3) {
      w.i32(node.bones.length);
      for (const b of node.bones) { w.str(b.name); w.floats(b.matrix); }
    }
    w.i32(node.vertexCount);
    w.raw(node.vertices);
    w.i32(node.indexCount);
    w.raw(node.indices);
    w.i32(node.materialId);
    w.u32(node.layer);
    w.f32(node.lodIn);
    w.f32(node.lodOut);
    if (node.meshType === 2) {
      // A static mesh always has one. If an edit produced a mesh without,
      // a zero sphere would make AC cull it away instantly, so refuse.
      if (!node.boundingSphere) {
        throw new Error(`static mesh "${node.name}" has no bounding sphere`);
      }
      w.floats(node.boundingSphere);
      w.u8(node.renderable);
    }
  }

  for (const c of node.children) writeNode(w, c);
}

export function writeKn5(file: Kn5File): Uint8Array {
  const size = kn5Size(file);
  const w = new Writer(size);

  w.raw(new Uint8Array([0x73, 0x63, 0x36, 0x39, 0x36, 0x39]));   // "sc6969"
  w.i32(file.version);
  if (file.extra !== null) w.i32(file.extra);

  w.i32(file.textures.length);
  for (const t of file.textures) {
    w.i32(t.type);
    w.str(t.name);
    w.i32(t.data.length);
    w.raw(t.data);
  }

  w.i32(file.materials.length);
  for (const m of file.materials) {
    w.str(m.name);
    w.str(m.shader);
    w.u8(m.blend);
    w.u8(m.alphaTested);
    if (m.depthMode !== null) w.i32(m.depthMode);
    w.i32(m.props.length);
    for (const p of m.props) { w.str(p.name); w.floats(p.values); }
    w.i32(m.slots.length);
    for (const s of m.slots) { w.str(s.sampler); w.i32(s.slot); w.str(s.texture); }
  }

  writeNode(w, file.root);
  w.raw(file.trailing);

  if (w.p !== size) {
    throw new Error(`kn5 writer wrote ${w.p} bytes but sized ${size}`);
  }
  return w.bytes;
}
