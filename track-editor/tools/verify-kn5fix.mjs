/**
 * Round trip test for fix_kn5.py, the post-processor shipped in the export
 * ZIP, plus regression guards on blender_to_fbx.py.
 *
 *   node --import ./tools/ts-resolve.mjs tools/verify-kn5fix.mjs
 *
 * 1. Writes a minimal synthetic kn5 (the layout ksEditor produces, verified
 *    against real files), runs the real fix_kn5.py on it with the system
 *    Python, and re-reads the result with an independent parser written here.
 * 2. Runs it again to prove idempotency.
 * 3. Feeds it a deliberately broken file (100x scale, tilted markers) and
 *    expects both warnings.
 * 4. Greps blender_to_fbx.py for the two settings whose absence cost a full
 *    debugging day in game: FBX_SCALE_UNITS and the marker rotation fix.
 *
 * Python 3 is required (fix_kn5.py is stdlib-only). If none is found the
 * Python checks fail loudly rather than silently passing.
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { FIX_KN5_SCRIPT } from '../src/export/fixKn5Script.ts';
import { BLENDER_SCRIPT } from '../src/export/readme.ts';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name} ${detail}`); }
}

/* ------------------------------------------------------------------ */
/* Synthetic kn5 writer (ksEditor v6 layout)                           */
/* ------------------------------------------------------------------ */

class Writer {
  constructor() { this.parts = []; }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32LE(v); this.parts.push(b); }
  u8(v) { this.parts.push(Buffer.from([v])); }
  f32(v) { const b = Buffer.alloc(4); b.writeFloatLE(v); this.parts.push(b); }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); this.parts.push(b); }
  str(s) { this.i32(s.length); this.parts.push(Buffer.from(s, 'ascii')); }
  raw(b) { this.parts.push(b); }
  bytes() { return Buffer.concat(this.parts); }
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function writeMesh(w, name, { scale = 1, renderable = 1 } = {}) {
  w.i32(2); w.str(name); w.i32(0); w.u8(1);
  w.u8(1); w.u8(1); w.u8(0);                    // castShadows, visible, transparent
  w.i32(3);                                     // 3 vertices
  // 45 m triangles: healthy tracks stay far below the 2000 m warning
  // threshold, a x100 scale accident lands far above it.
  for (let i = 0; i < 3; i++) {
    w.f32((i === 1 ? 45 : 0) * scale); w.f32(0); w.f32((i === 2 ? 45 : 0) * scale);
    w.f32(0); w.f32(1); w.f32(0);               // normal
    w.f32(0); w.f32(0);                         // uv
    w.f32(1); w.f32(0); w.f32(0);               // tangent
  }
  w.i32(3); w.u16(0); w.u16(1); w.u16(2);
  w.i32(0);                                     // material id
  w.i32(0);                                     // layer
  w.f32(0); w.f32(0);                           // lod in / out
  w.f32(0); w.f32(0); w.f32(0); w.f32(7 * scale); // bounding sphere
  w.u8(renderable);
}

function writeKn5(path, { scale = 1, markerYUp = true } = {}) {
  const w = new Writer();
  w.raw(Buffer.from('sc6969', 'ascii'));
  w.i32(6); w.i32(0);                           // version 6 + extra field
  w.i32(0);                                     // no textures
  w.i32(1);                                     // one material
  w.str('mat'); w.str('ksPerPixel');
  w.u8(0); w.u8(0); w.i32(0);
  const props = ['ksAmbient', 'ksDiffuse', 'ksSpecular', 'ksSpecularEXP'];
  w.i32(props.length);
  for (const name of props) { w.str(name); w.f32(0.1); w.raw(Buffer.alloc(36)); }
  w.i32(0);                                     // no texture slots

  w.i32(1); w.str('root'); w.i32(4); w.u8(1);   // root dummy, four children
  w.raw(Buffer.from(new Float32Array(IDENTITY).buffer));

  const marker = [...IDENTITY];
  if (!markerYUp) { marker[5] = 0; marker[6] = 1; marker[9] = 1; marker[10] = 0; }
  w.i32(1); w.str('AC_START_0'); w.i32(0); w.u8(1);
  w.raw(Buffer.from(new Float32Array(marker).buffer));

  writeMesh(w, '1PROP_WALL_box_0', { scale });
  writeMesh(w, '1PROP_ROAD_pad_0', { scale });
  writeMesh(w, '1ROAD_track', { scale });

  writeFileSync(path, w.bytes());
}

/* ------------------------------------------------------------------ */
/* Independent reader (mirrors the layout, shares no code)             */
/* ------------------------------------------------------------------ */

function readKn5(path) {
  const b = readFileSync(path);
  let p = 6;
  const i32 = () => { const v = b.readInt32LE(p); p += 4; return v; };
  const str = () => { const n = i32(); const s = b.toString('ascii', p, p + n); p += n; return s; };
  const version = i32();
  if (version > 5) i32();
  for (let i = 0, n = i32(); i < n; i++) { i32(); str(); const size = i32(); p += size; }
  const materials = [];
  for (let i = 0, n = i32(); i < n; i++) {
    const name = str(); str(); p += 2; i32();
    const values = {};
    for (let j = 0, pn = i32(); j < pn; j++) { const k = str(); values[k] = b.readFloatLE(p); p += 40; }
    for (let j = 0, sn = i32(); j < sn; j++) { str(); i32(); str(); }
    materials.push({ name, values });
  }
  const meshes = [];
  let rootChildren = null;
  (function node(depth) {
    const type = i32();
    const name = str();
    const cc = i32();
    p += 1;
    if (depth === 0) rootChildren = cc;
    if (type === 1) p += 64;
    else {
      const castShadows = b[p];
      p += 3;
      const vc = i32(); p += vc * 44;
      const ic = i32(); p += ic * 2;
      i32(); i32(); p += 8; p += 16;
      meshes.push({ name, castShadows, renderable: b[p] });
      p += 1;
    }
    for (let i = 0; i < cc; i++) node(depth + 1);
  })(0);
  if (p !== b.length) throw new Error(`reader stopped at ${p} of ${b.length}`);
  return { materials, meshes, rootChildren };
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/fix_kn5.py', FIX_KN5_SCRIPT);

const python = ['python', 'python3', 'py'].find(
  (cmd) => spawnSync(cmd, ['--version'], { shell: false }).status === 0,
);
const run = (file) => spawnSync(python, ['tmp/fix_kn5.py', file], { encoding: 'utf8' });

console.log('\nfix_kn5.py round trip');
check('a Python 3 is available for the test', !!python);
if (python) {
  writeKn5('tmp/good.kn5');
  const first = run('tmp/good.kn5');
  check('runs cleanly on a healthy file', first.status === 0, first.stderr || first.stdout);
  check('no warnings on a healthy file', !first.stdout.includes('WARNING'), first.stdout);

  const out = readKn5('tmp/good.kn5');
  check('one collision copy per prop appended', out.meshes.length === 5,
    out.meshes.map((m) => m.name).join(','));
  check('root child count follows', out.rootChildren === 6, `got ${out.rootChildren}`);
  const dup = out.meshes.find((m) => m.name === '1WALL_box_0');
  check('copy is renamed into the surface namespace', !!dup,
    out.meshes.map((m) => m.name).join(','));
  check('copy is invisible to the renderer', dup && dup.renderable === 0 && dup.castShadows === 0,
    dup && `renderable=${dup.renderable} castShadows=${dup.castShadows}`);
  const padDup = out.meshes.find((m) => m.name === '1ROAD_pad_0');
  check('a ROAD pad gets a drivable twin, not a wall', !!padDup && padDup.renderable === 0,
    out.meshes.map((m) => m.name).join(','));
  const visible = out.meshes.find((m) => m.name === '1PROP_WALL_box_0');
  check('the visible prop is untouched', visible && visible.renderable === 1);
  const v = out.materials[0].values;
  check('material lighting normalised',
    Math.abs(v.ksAmbient - 0.5) < 1e-6 && Math.abs(v.ksDiffuse - 0.5) < 1e-6 &&
    Math.abs(v.ksSpecular - 0.06) < 1e-6 && Math.abs(v.ksSpecularEXP - 20) < 1e-6,
    JSON.stringify(v));

  const second = run('tmp/good.kn5');
  check('second run adds nothing', second.stdout.includes('0 added'), second.stdout);
  check('file is unchanged after the second run', readKn5('tmp/good.kn5').meshes.length === 5);

  writeKn5('tmp/bad.kn5', { scale: 100, markerYUp: false });
  const bad = run('tmp/bad.kn5');
  check('100x scale is warned about', bad.stdout.includes('probably 100x too big'), bad.stdout);
  check('tilted markers are warned about', bad.stdout.includes('not upright'), bad.stdout);
}

console.log('\nblender_to_fbx.py regression guards');
check('scale goes into the header, not the objects (FBX_SCALE_UNITS)',
  BLENDER_SCRIPT.includes('apply_scale_options="FBX_SCALE_UNITS"'));
check('marker empties get the +90 X compensation',
  BLENDER_SCRIPT.includes('Matrix.Rotation(math.radians(90.0), 4, "X")'));
check('materials are wired to the shipped textures',
  BLENDER_SCRIPT.includes('textures') && BLENDER_SCRIPT.includes('ShaderNodeTexImage'));

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
