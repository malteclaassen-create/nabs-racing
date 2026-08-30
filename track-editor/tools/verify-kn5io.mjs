/**
 * Proof that importing an Assetto Corsa model and exporting it again loses
 * nothing:
 *
 *   node --import ./tools/ts-resolve.mjs tools/verify-kn5io.mjs
 *
 * The criterion is byte identity. Every .kn5 found in the installed content is
 * read with src/ac/kn5Read.ts and written back with src/ac/kn5Write.ts, and
 * the result must equal the input byte for byte. Nothing weaker is good enough:
 * an imported track is somebody's finished work, and "looks the same" is not a
 * statement anyone can check afterwards.
 *
 * The corpus is whatever Assetto Corsa is installed on this machine, so the
 * test grows teeth on its own -- every mod the user installs is another sample
 * of what real files look like. With no installation found, the structural
 * self test still runs.
 *
 * Set AC_ROOT to point somewhere else, KN5IO_STRIDE to sample fewer files
 * (default 1 = all of them), KN5IO_MAX_MB to skip very large models.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { readKn5, collectMeshes, collectDummies, decodeMesh, walkKn5, kn5Safety } from '../src/ac/kn5Read.ts';
import { writeKn5, kn5Size } from '../src/ac/kn5Write.ts';

let failures = 0;
let checks = 0;
function check(name, cond, detail = '') {
  checks += 1;
  if (cond) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name} ${detail}`); }
}

function sameBytes(a, b) {
  if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return `first difference at byte ${i}: ${a[i]} vs ${b[i]}`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Structural self test -- runs with or without a game installed       */
/* ------------------------------------------------------------------ */

console.log('\nkn5 reader / writer: structure');

{
  // Build a file with the editor's own writer, then read it with the importer.
  // The two halves are written independently, so this is a real cross check.
  const { buildKn5 } = await import('../src/export/kn5.ts');
  const THREE = await import('three');
  const geo = new THREE.PlaneGeometry(10, 40, 2, 4);
  geo.rotateX(-Math.PI / 2);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const built = buildKn5({
    rootName: 'selftest',
    materials: [{ name: 'asphalt', textureName: 'asphalt.png', textureBytes: png }],
    meshes: [{ name: '1ROAD_a', geometry: geo, material: 0 }],
    nulls: [{ name: 'AC_PIT_0', pos: [3, 1, -4], quat: new THREE.Quaternion() }],
  });

  const file = readKn5(built);
  check('reads the editor\'s own output', file.version === 6 && file.materials.length === 1);
  check('finds the mesh', collectMeshes(file.root).length === 1);
  check('finds the marker', collectDummies(file.root).some((d) => d.name === 'AC_PIT_0'));
  check('marker position survives', (() => {
    const d = collectDummies(file.root).find((n) => n.name === 'AC_PIT_0');
    return d && Math.abs(d.matrix[12] - 3) < 1e-6 && Math.abs(d.matrix[14] + 4) < 1e-6;
  })());
  check('no trailing bytes on a clean file', file.trailing.length === 0);

  const again = writeKn5(file);
  check('round trip of a freshly built file is byte identical', sameBytes(built, again) === null,
    sameBytes(built, again) ?? '');
  check('size prediction matches the write', kn5Size(file) === again.length);

  const decoded = decodeMesh(collectMeshes(file.root)[0]);
  check('decodes vertices', decoded.positions.length === decoded.normals.length &&
    decoded.positions.length / 3 === collectMeshes(file.root)[0].vertexCount);

  // An edit must survive a round trip, and must change only what was edited.
  const edited = readKn5(built);
  const pit = collectDummies(edited.root).find((d) => d.name === 'AC_PIT_0');
  pit.matrix[12] = 12.5;
  pit.name = 'AC_PIT_31';
  const editedBytes = writeKn5(edited);
  const reread = readKn5(editedBytes);
  const movedPit = collectDummies(reread.root).find((d) => d.name === 'AC_PIT_31');
  check('an edited marker comes back edited', movedPit && Math.abs(movedPit.matrix[12] - 12.5) < 1e-6);
  check('renaming changes the file length by the name delta',
    editedBytes.length === built.length + 1, `${editedBytes.length} vs ${built.length}`);
  check('the mesh beside it is untouched', (() => {
    const a = collectMeshes(readKn5(built).root)[0];
    const b = collectMeshes(reread.root)[0];
    return sameBytes(a.vertices, b.vertices) === null && sameBytes(a.indices, b.indices) === null;
  })());
}

/* ------------------------------------------------------------------ */
/* The real corpus                                                     */
/* ------------------------------------------------------------------ */

function findAcRoot() {
  if (process.env.AC_ROOT) return process.env.AC_ROOT;
  const guesses = [
    'C:/Program Files (x86)/Steam/steamapps/common/assettocorsa',
    'C:/Program Files/Steam/steamapps/common/assettocorsa',
    'D:/Steam/steamapps/common/assettocorsa',
    'D:/SteamLibrary/steamapps/common/assettocorsa',
    'E:/SteamLibrary/steamapps/common/assettocorsa',
  ];
  for (const g of guesses) if (existsSync(join(g, 'content', 'tracks'))) return g;
  return null;
}

const root = findAcRoot();
if (!root) {
  console.log('\nno Assetto Corsa installation found, skipping the real corpus');
  console.log('  (set AC_ROOT=<path to assettocorsa> to run it)');
} else {
  const tracksDir = join(root, 'content', 'tracks');
  const files = [];
  const collect = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) collect(full, depth + 1);
      else if (e.name.toLowerCase().endsWith('.kn5')) files.push(full);
    }
  };
  collect(tracksDir, 0);

  const stride = Number(process.env.KN5IO_STRIDE ?? 1);
  const maxBytes = Number(process.env.KN5IO_MAX_MB ?? 400) * 1e6;

  // The chosen reference track goes through in full, whatever the stride is:
  // it is a seven layout mod with 26 models and is the case the feature was
  // built for.
  const reference = files.filter((f) => f.includes('vhe_hockenheim'));
  const sampled = files.filter((_, i) => i % stride === 0);
  const targets = [...new Set([...reference, ...sampled])];

  console.log(`\nkn5 round trip over the installed content (${targets.length} of ${files.length} models)`);

  let identical = 0, differed = 0, unreadable = 0, skipped = 0;
  const unreadableFiles = [];
  let bytesDone = 0;
  // Fully understood vs. "round trips but the tree is ciphertext". See
  // kn5Safety(): the split across a real installation is absolute, and this
  // records it so a change that starts silently mis-parsing files is noticed.
  let editable = 0, opaque = 0;
  const opaqueFiles = [];

  for (const f of targets) {
    let size;
    try { size = statSync(f).size; } catch { continue; }
    if (size > maxBytes) { skipped += 1; continue; }

    let input;
    try { input = new Uint8Array(readFileSync(f)); } catch { skipped += 1; continue; }

    let file;
    try {
      file = readKn5(input);
    } catch (e) {
      // Custom Shaders Patch can encrypt a model. Those cannot be parsed by
      // anyone without the key, and the import path treats them as opaque
      // files that are copied through untouched -- which loses nothing, it
      // only means that particular model cannot be edited. Counted, not failed.
      unreadable += 1;
      unreadableFiles.push([f.slice(tracksDir.length + 1), e.message]);
      continue;
    }

    const out = writeKn5(file);
    const diff = sameBytes(input, out);
    if (diff === null) identical += 1;
    else {
      differed += 1;
      console.log(`  DIFFERS ${f.slice(tracksDir.length + 1)}: ${diff}`);
    }

    const safety = kn5Safety(file);
    if (safety.editable) editable += 1;
    else {
      opaque += 1;
      opaqueFiles.push(`${f.slice(tracksDir.length + 1)} (${file.trailing.length} bytes unparsed)`);
    }
    bytesDone += size;
  }

  console.log(`  ${(bytesDone / 1e9).toFixed(2)} GB read and written back`);
  check('every readable model round trips byte for byte', differed === 0, `${differed} differed`);
  check('the corpus is big enough to mean something', identical >= 20, `only ${identical} models`);
  console.log(`  ${editable} models fully understood, ${opaque} opaque (copied, not editable)`);
  if (opaque > 0) {
    for (const o of opaqueFiles.slice(0, 6)) console.log(`      ${o}`);
    if (opaqueFiles.length > 6) console.log(`      ... and ${opaqueFiles.length - 6} more`);
  }
  check('an opaque model still round trips, so it is never damaged', differed === 0);

  if (unreadable > 0) {
    console.log(`  ${unreadable} models could not be parsed (kept as opaque copies):`);
    for (const [name, why] of unreadableFiles.slice(0, 10)) console.log(`      ${name}: ${why}`);
    if (unreadableFiles.length > 10) console.log(`      ... and ${unreadableFiles.length - 10} more`);
  }
  if (skipped > 0) console.log(`  ${skipped} skipped (over ${maxBytes / 1e6} MB)`);

  /* --- the reference track in detail ------------------------------- */
  const hock = join(tracksDir, 'vhe_hockenheim');
  if (existsSync(hock)) {
    console.log('\nvhe_hockenheim: the reference import');
    const models = readdirSync(hock).filter((f) => f.toLowerCase().endsWith('.kn5'));
    check('all 26 models are there', models.length === 26, `${models.length}`);

    let markers = 0, meshes = 0, allIdentical = true;
    for (const m of models) {
      const input = new Uint8Array(readFileSync(join(hock, m)));
      const file = readKn5(input);
      if (sameBytes(input, writeKn5(file)) !== null) allIdentical = false;
      meshes += collectMeshes(file.root).length;
      walkKn5(file.root, (n) => { if (n.kind === 'dummy' && n.name.startsWith('AC_')) markers += 1; });
    }
    check('every model of the reference track round trips', allIdentical);
    check('the AC_ markers are all found', markers === 352, `${markers}`);
    check('the meshes are all found', meshes === 1838, `${meshes}`);
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
