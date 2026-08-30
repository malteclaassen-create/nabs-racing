import * as THREE from 'three';
import { zlibSync } from 'fflate';

/**
 * Hand written binary FBX 7.4 exporter.
 *
 * Why binary and not ASCII: Blender's FBX importer refuses ASCII files, and
 * Blender is our escape hatch if ksEditorAT ever dislikes this file. Binary
 * is understood by both Blender and the Autodesk FBX SDK that ksEditor uses.
 *
 * Layout notes:
 *  - Coordinates are written as they are, Y up, metres. Same as AC.
 *  - Mesh geometry is baked to world space, models carry identity transforms.
 *    Only the AC_* markers carry a real translation/rotation, which is exactly
 *    what Assetto Corsa reads them for.
 *  - Normals and UVs are per vertex (ByVertice/Direct), which keeps the file
 *    small and is lossless for our indexed geometry.
 */

/* ------------------------------------------------------------------ */
/* Low level writer                                                    */
/* ------------------------------------------------------------------ */

class Writer {
  private buf: Uint8Array;
  private view: DataView;
  private len = 0;

  constructor(initial = 1 << 20) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(extra: number) {
    if (this.len + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  get pos() {
    return this.len;
  }

  u8(v: number) { this.ensure(1); this.view.setUint8(this.len, v); this.len += 1; }
  u32(v: number) { this.ensure(4); this.view.setUint32(this.len, v >>> 0, true); this.len += 4; }
  i32(v: number) { this.ensure(4); this.view.setInt32(this.len, v | 0, true); this.len += 4; }
  i16(v: number) { this.ensure(2); this.view.setInt16(this.len, v, true); this.len += 2; }
  f32(v: number) { this.ensure(4); this.view.setFloat32(this.len, v, true); this.len += 4; }
  f64(v: number) { this.ensure(8); this.view.setFloat64(this.len, v, true); this.len += 8; }
  i64(v: number) { this.ensure(8); this.view.setBigInt64(this.len, BigInt(Math.trunc(v)), true); this.len += 8; }

  bytes(b: Uint8Array) { this.ensure(b.length); this.buf.set(b, this.len); this.len += b.length; }
  zeros(n: number) { this.ensure(n); this.buf.fill(0, this.len, this.len + n); this.len += n; }

  ascii(s: string) {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    this.bytes(b);
  }

  patchU32(offset: number, v: number) {
    this.view.setUint32(offset, v >>> 0, true);
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/* ------------------------------------------------------------------ */
/* Node tree                                                           */
/* ------------------------------------------------------------------ */

type Prop =
  | { t: 'C'; v: boolean }
  | { t: 'Y'; v: number }
  | { t: 'I'; v: number }
  | { t: 'F'; v: number }
  | { t: 'D'; v: number }
  | { t: 'L'; v: number }
  | { t: 'S'; v: string }
  | { t: 'R'; v: Uint8Array }
  | { t: 'd'; v: Float64Array }
  | { t: 'f'; v: Float32Array }
  | { t: 'i'; v: Int32Array };

interface FNode {
  name: string;
  props: Prop[];
  children: FNode[];
}

const N = (name: string, props: Prop[] = [], children: FNode[] = []): FNode => ({ name, props, children });

const S = (v: string): Prop => ({ t: 'S', v });
const I = (v: number): Prop => ({ t: 'I', v });
const D = (v: number): Prop => ({ t: 'D', v });
const L = (v: number): Prop => ({ t: 'L', v });
const B = (v: boolean): Prop => ({ t: 'C', v });
const Da = (v: Float64Array): Prop => ({ t: 'd', v });
const Ia = (v: Int32Array): Prop => ({ t: 'i', v });

const SEP = '\u0000\u0001';

/**
 * Object names in BINARY FBX are stored as `name\0\x01Class`. The familiar
 * `Class::name` spelling only exists in the ASCII flavour, and writing that
 * into a binary file makes every object come out called "Model::whatever".
 */
function nameClass(name: string, cls: string): string {
  return name + SEP + cls;
}

/** Properties70 entry: P: name, type, subtype, flags, values... */
function P(name: string, type: string, sub: string, flags: string, ...values: Prop[]): FNode {
  return N('P', [S(name), S(type), S(sub), S(flags), ...values]);
}

function writeArrayProp(w: Writer, code: string, elementCount: number, raw: Uint8Array) {
  w.ascii(code);
  w.u32(elementCount);
  // Deflate anything worth deflating. Both Blender and the FBX SDK read this.
  if (raw.length > 1024) {
    const packed = zlibSync(raw, { level: 6 });
    w.u32(1);
    w.u32(packed.length);
    w.bytes(packed);
  } else {
    w.u32(0);
    w.u32(raw.length);
    w.bytes(raw);
  }
}

function writeProp(w: Writer, p: Prop) {
  switch (p.t) {
    case 'C': w.ascii('C'); w.u8(p.v ? 1 : 0); break;
    case 'Y': w.ascii('Y'); w.i16(p.v); break;
    case 'I': w.ascii('I'); w.i32(p.v); break;
    case 'F': w.ascii('F'); w.f32(p.v); break;
    case 'D': w.ascii('D'); w.f64(p.v); break;
    case 'L': w.ascii('L'); w.i64(p.v); break;
    case 'S': {
      w.ascii('S');
      const bytes = new TextEncoder().encode(p.v);
      w.u32(bytes.length);
      w.bytes(bytes);
      break;
    }
    case 'R': {
      w.ascii('R');
      w.u32(p.v.length);
      w.bytes(p.v);
      break;
    }
    case 'd': writeArrayProp(w, 'd', p.v.length, new Uint8Array(p.v.buffer, p.v.byteOffset, p.v.byteLength)); break;
    case 'f': writeArrayProp(w, 'f', p.v.length, new Uint8Array(p.v.buffer, p.v.byteOffset, p.v.byteLength)); break;
    case 'i': writeArrayProp(w, 'i', p.v.length, new Uint8Array(p.v.buffer, p.v.byteOffset, p.v.byteLength)); break;
  }
}

function writeNode(w: Writer, node: FNode) {
  const start = w.pos;
  w.u32(0); // end offset, patched below
  w.u32(node.props.length);
  w.u32(0); // property list length, patched below
  w.u8(node.name.length);
  w.ascii(node.name);

  const propStart = w.pos;
  for (const p of node.props) writeProp(w, p);
  const propLen = w.pos - propStart;

  for (const c of node.children) writeNode(w, c);
  if (node.children.length > 0) w.zeros(13);

  const end = w.pos;
  w.patchU32(start, end);
  w.patchU32(start + 8, propLen);
}

/* ------------------------------------------------------------------ */
/* Public input types                                                  */
/* ------------------------------------------------------------------ */

export interface FbxMeshInput {
  /** Final object name in the FBX, e.g. "1ROAD_track". */
  name: string;
  /** Indexed geometry with position, normal and uv, already in world space. */
  geometry: THREE.BufferGeometry;
  /** Material name, must exist in `materials`. */
  material: string;
}

export interface FbxNullInput {
  name: string;
  pos: [number, number, number];
  /** Euler XYZ in degrees. */
  rot: [number, number, number];
}

export interface FbxMaterialInput {
  name: string;
  /** Linear 0..1 rgb. */
  color: [number, number, number];
  /** Relative texture path written into the FBX, e.g. "textures/asphalt.png". */
  texture?: string;
}

export interface FbxOptions {
  meshes: FbxMeshInput[];
  nulls: FbxNullInput[];
  materials: FbxMaterialInput[];
  creator?: string;
  /** Written into CreationTimeStamp. Pass a fixed value for reproducibility. */
  date?: Date;
}

/* ------------------------------------------------------------------ */
/* Scene assembly                                                      */
/* ------------------------------------------------------------------ */

let idSeq = 1000000;
function nextId(): number {
  idSeq += 1;
  return idSeq;
}

function geometryNode(id: number, name: string, geo: THREE.BufferGeometry): FNode {
  const posAttr = geo.getAttribute('position');
  const normAttr = geo.getAttribute('normal');
  const uvAttr = geo.getAttribute('uv');
  const index = geo.getIndex();

  const vCount = posAttr.count;
  const verts = new Float64Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    verts[i * 3 + 0] = posAttr.getX(i);
    verts[i * 3 + 1] = posAttr.getY(i);
    verts[i * 3 + 2] = posAttr.getZ(i);
  }

  const triCount = index ? index.count / 3 : vCount / 3;
  const polyIdx = new Int32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const a = index ? index.getX(t * 3 + 0) : t * 3 + 0;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    polyIdx[t * 3 + 0] = a;
    polyIdx[t * 3 + 1] = b;
    // The last index of every polygon is stored negated to mark the end.
    polyIdx[t * 3 + 2] = -c - 1;
  }

  const normals = new Float64Array(vCount * 3);
  if (normAttr) {
    for (let i = 0; i < vCount; i++) {
      normals[i * 3 + 0] = normAttr.getX(i);
      normals[i * 3 + 1] = normAttr.getY(i);
      normals[i * 3 + 2] = normAttr.getZ(i);
    }
  } else {
    for (let i = 0; i < vCount; i++) normals[i * 3 + 1] = 1;
  }

  const uvs = new Float64Array(vCount * 2);
  if (uvAttr) {
    for (let i = 0; i < vCount; i++) {
      uvs[i * 2 + 0] = uvAttr.getX(i);
      uvs[i * 2 + 1] = uvAttr.getY(i);
    }
  }

  return N('Geometry', [L(id), S(nameClass(name, 'Geometry')), S('Mesh')], [
    N('GeometryVersion', [I(124)]),
    N('Vertices', [Da(verts)]),
    N('PolygonVertexIndex', [Ia(polyIdx)]),
    N('LayerElementNormal', [I(0)], [
      N('Version', [I(102)]),
      N('Name', [S('')]),
      N('MappingInformationType', [S('ByVertice')]),
      N('ReferenceInformationType', [S('Direct')]),
      N('Normals', [Da(normals)]),
    ]),
    N('LayerElementUV', [I(0)], [
      N('Version', [I(101)]),
      N('Name', [S('UVMap')]),
      N('MappingInformationType', [S('ByVertice')]),
      N('ReferenceInformationType', [S('Direct')]),
      N('UV', [Da(uvs)]),
    ]),
    N('LayerElementMaterial', [I(0)], [
      N('Version', [I(101)]),
      N('Name', [S('')]),
      N('MappingInformationType', [S('AllSame')]),
      N('ReferenceInformationType', [S('IndexToDirect')]),
      N('Materials', [Ia(new Int32Array([0]))]),
    ]),
    N('Layer', [I(0)], [
      N('Version', [I(100)]),
      N('LayerElement', [], [N('Type', [S('LayerElementNormal')]), N('TypedIndex', [I(0)])]),
      N('LayerElement', [], [N('Type', [S('LayerElementUV')]), N('TypedIndex', [I(0)])]),
      N('LayerElement', [], [N('Type', [S('LayerElementMaterial')]), N('TypedIndex', [I(0)])]),
    ]),
  ]);
}

function modelNode(
  id: number,
  name: string,
  kind: 'Mesh' | 'Null',
  t: [number, number, number],
  r: [number, number, number],
): FNode {
  return N('Model', [L(id), S(nameClass(name, 'Model')), S(kind)], [
    N('Version', [I(232)]),
    N('Properties70', [], [
      P('InheritType', 'enum', '', '', I(1)),
      P('ScalingMax', 'Vector3D', 'Vector', '', D(0), D(0), D(0)),
      P('DefaultAttributeIndex', 'int', 'Integer', '', I(0)),
      P('Lcl Translation', 'Lcl Translation', '', 'A', D(t[0]), D(t[1]), D(t[2])),
      P('Lcl Rotation', 'Lcl Rotation', '', 'A', D(r[0]), D(r[1]), D(r[2])),
      P('Lcl Scaling', 'Lcl Scaling', '', 'A', D(1), D(1), D(1)),
    ]),
    N('Shading', [B(true)]),
    N('Culling', [S('CullingOff')]),
  ]);
}

function materialNode(id: number, m: FbxMaterialInput): FNode {
  // ksEditor derives its ks* lighting constants from these colours
  // (ksDiffuse from DiffuseColor and so on), so for textured materials they
  // are lighting values, not the surface colour -- that comes from the
  // texture. Writing the dark material tint here (asphalt ~0.04) produced a
  // nearly unlit track. 0.5 / 0.5 / 0.06 / 20 is the Kunos range. Without a
  // texture the colour is all there is, so it is kept in that case.
  const c = m.texture ? [0.5, 0.5, 0.5] : m.color;
  return N('Material', [L(id), S(nameClass(m.name, 'Material')), S('')], [
    N('Version', [I(102)]),
    N('ShadingModel', [S('phong')]),
    N('MultiLayer', [I(0)]),
    N('Properties70', [], [
      P('ShadingModel', 'KString', '', '', S('phong')),
      P('DiffuseColor', 'Color', '', 'A', D(c[0]), D(c[1]), D(c[2])),
      P('Diffuse', 'Vector3D', 'Vector', '', D(c[0]), D(c[1]), D(c[2])),
      P('AmbientColor', 'Color', '', 'A', D(0.5), D(0.5), D(0.5)),
      P('SpecularColor', 'Color', '', 'A', D(0.06), D(0.06), D(0.06)),
      P('Shininess', 'double', 'Number', '', D(20)),
      P('Opacity', 'double', 'Number', '', D(1)),
    ]),
  ]);
}

function textureNodes(texId: number, videoId: number, name: string, relPath: string): [FNode, FNode] {
  const video = N('Video', [L(videoId), S(nameClass(name, 'Video')), S('Clip')], [
    N('Type', [S('Clip')]),
    N('Properties70', [], [P('Path', 'KString', 'XRefUrl', '', S(relPath))]),
    N('UseMipMap', [I(0)]),
    N('Filename', [S(relPath)]),
    N('RelativeFilename', [S(relPath)]),
  ]);

  const texture = N('Texture', [L(texId), S(nameClass(name, 'Texture')), S('')], [
    N('Type', [S('TextureVideoClip')]),
    N('Version', [I(202)]),
    N('TextureName', [S(nameClass(name, 'Texture'))]),
    N('Properties70', [], [
      P('UVSet', 'KString', '', '', S('UVMap')),
      P('UseMaterial', 'bool', '', '', I(1)),
    ]),
    N('Media', [S(nameClass(name, 'Video'))]),
    N('FileName', [S(relPath)]),
    N('RelativeFilename', [S(relPath)]),
    N('ModelUVTranslation', [D(0), D(0)]),
    N('ModelUVScaling', [D(1), D(1)]),
    N('Texture_Alpha_Source', [S('None')]),
    N('Cropping', [I(0), I(0), I(0), I(0)]),
  ]);

  return [texture, video];
}

const HEAD_MAGIC = 'Kaydara FBX Binary  ';
const FOOTER_MAGIC = new Uint8Array([
  0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e,
  0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x05, 0xbe, 0x49,
]);

export function buildFbx(opts: FbxOptions): Uint8Array {
  idSeq = 1000000;
  const date = opts.date ?? new Date();
  const creator = opts.creator ?? 'AC Track Editor';

  const objects: FNode[] = [];
  const connections: FNode[] = [];
  const counts = { Model: 0, Geometry: 0, Material: 0, Texture: 0, Video: 0, NodeAttribute: 0 };

  /* materials, plus their textures */
  const matIds = new Map<string, number>();
  for (const m of opts.materials) {
    const id = nextId();
    matIds.set(m.name, id);
    objects.push(materialNode(id, m));
    counts.Material += 1;

    if (m.texture) {
      const texId = nextId();
      const vidId = nextId();
      const [tex, vid] = textureNodes(texId, vidId, m.name, m.texture);
      objects.push(tex, vid);
      counts.Texture += 1;
      counts.Video += 1;
      connections.push(N('C', [S('OP'), L(texId), L(id), S('DiffuseColor')]));
      connections.push(N('C', [S('OO'), L(vidId), L(texId)]));
    }
  }

  /* meshes */
  for (const mesh of opts.meshes) {
    const geoId = nextId();
    const modId = nextId();
    objects.push(geometryNode(geoId, mesh.name, mesh.geometry));
    objects.push(modelNode(modId, mesh.name, 'Mesh', [0, 0, 0], [0, 0, 0]));
    counts.Geometry += 1;
    counts.Model += 1;
    connections.push(N('C', [S('OO'), L(modId), L(0)]));
    connections.push(N('C', [S('OO'), L(geoId), L(modId)]));
    const matId = matIds.get(mesh.material);
    if (matId !== undefined) connections.push(N('C', [S('OO'), L(matId), L(modId)]));
  }

  /* AC_* markers as null nodes */
  for (const nul of opts.nulls) {
    const attrId = nextId();
    const modId = nextId();
    objects.push(
      N('NodeAttribute', [L(attrId), S(nameClass(nul.name, 'NodeAttribute')), S('Null')], [
        N('TypeFlags', [S('Null')]),
      ]),
    );
    objects.push(modelNode(modId, nul.name, 'Null', nul.pos, nul.rot));
    counts.NodeAttribute += 1;
    counts.Model += 1;
    connections.push(N('C', [S('OO'), L(modId), L(0)]));
    connections.push(N('C', [S('OO'), L(attrId), L(modId)]));
  }

  const definitionsChildren: FNode[] = [
    N('Version', [I(100)]),
    N('Count', [I(Object.values(counts).reduce((a, b) => a + b, 0) + 1)]),
    N('ObjectType', [S('GlobalSettings')], [N('Count', [I(1)])]),
  ];
  for (const [type, count] of Object.entries(counts)) {
    if (count > 0) definitionsChildren.push(N('ObjectType', [S(type)], [N('Count', [I(count)])]));
  }

  const root: FNode[] = [
    N('FBXHeaderExtension', [], [
      N('FBXHeaderVersion', [I(1003)]),
      N('FBXVersion', [I(7400)]),
      N('EncryptionType', [I(0)]),
      N('CreationTimeStamp', [], [
        N('Version', [I(1000)]),
        N('Year', [I(date.getFullYear())]),
        N('Month', [I(date.getMonth() + 1)]),
        N('Day', [I(date.getDate())]),
        N('Hour', [I(date.getHours())]),
        N('Minute', [I(date.getMinutes())]),
        N('Second', [I(date.getSeconds())]),
        N('Millisecond', [I(0)]),
      ]),
      N('Creator', [S(creator)]),
    ]),
    N('FileId', [{ t: 'R', v: new Uint8Array(16) }]),
    N('CreationTime', [S(date.toISOString())]),
    N('Creator', [S(creator)]),
    N('GlobalSettings', [], [
      N('Version', [I(1000)]),
      N('Properties70', [], [
        P('UpAxis', 'int', 'Integer', '', I(1)),
        P('UpAxisSign', 'int', 'Integer', '', I(1)),
        P('FrontAxis', 'int', 'Integer', '', I(2)),
        P('FrontAxisSign', 'int', 'Integer', '', I(1)),
        P('CoordAxis', 'int', 'Integer', '', I(0)),
        P('CoordAxisSign', 'int', 'Integer', '', I(1)),
        P('OriginalUpAxis', 'int', 'Integer', '', I(1)),
        P('OriginalUpAxisSign', 'int', 'Integer', '', I(1)),
        P('UnitScaleFactor', 'double', 'Number', '', D(1)),
        P('OriginalUnitScaleFactor', 'double', 'Number', '', D(1)),
        P('TimeMode', 'enum', '', '', I(6)),
        P('CustomFrameRate', 'double', 'Number', '', D(-1)),
      ]),
    ]),
    N('Documents', [], [
      N('Count', [I(1)]),
      N('Document', [L(1), S('Scene'), S('Scene')], [
        N('Properties70', [], [
          P('SourceObject', 'object', '', ''),
          P('ActiveAnimStackName', 'KString', '', '', S('')),
        ]),
        N('RootNode', [L(0)]),
      ]),
    ]),
    N('References', []),
    N('Definitions', [], definitionsChildren),
    N('Objects', [], objects),
    N('Connections', [], connections),
  ];

  const w = new Writer(4 << 20);
  w.ascii(HEAD_MAGIC);
  w.u8(0x00);
  w.u8(0x1a);
  w.u8(0x00);
  w.u32(7400);
  for (const node of root) writeNode(w, node);
  w.zeros(13);

  // Footer. Readers ignore the contents, but the shape has to be there.
  w.zeros(16);
  const pad = ((w.pos + 15) & ~15) - w.pos;
  w.zeros(pad === 0 ? 16 : pad);
  w.u32(0);
  w.u32(7400);
  w.zeros(120);
  w.bytes(FOOTER_MAGIC);

  return w.result();
}

/** Hex colour like "#3a3c3f" to linear-ish 0..1 rgb for the FBX material. */
export function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
