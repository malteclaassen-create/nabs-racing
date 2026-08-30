/**
 * The import path, checked against real installed tracks:
 *
 *   node --import ./tools/ts-resolve.mjs tools/verify-import.mjs
 *
 * What it proves:
 *   - .ini files survive a read/write round trip byte for byte, so editing one
 *     line of surfaces.ini does not silently reformat a modder's file
 *   - moving one pit box changes THAT pit box and nothing else in the model
 *   - deleting a marker renumbers the rest, because AC stops reading at the
 *     first gap, and timing gates stay in left/right pairs
 *   - hiding a mesh removes it and leaves every other mesh byte identical
 *   - the recovered centre line lands on the recorded one
 *
 * Uses whatever Assetto Corsa is installed; skips the file backed parts with a
 * clear message when there is none.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { readKn5, collectDummies, collectMeshes, decodeMesh } from '../src/ac/kn5Read.ts';
import { writeKn5 } from '../src/ac/kn5Write.ts';
import {
  patchMarkers, patchMeshes, markerNames, markerGroup, markerMatrix, planMarkerEdits,
  transformMeshes, appendPieceCopies,
} from '../src/ac/patchKn5.ts';
import { parseIni, stringifyIni, iniGet, iniSet, iniNumbered, iniSections } from '../src/ac/iniFile.ts';
import { readAiLane, laneIsClosed, laneBanks } from '../src/ac/aiRead.ts';
import { recoverPathFromLane } from '../src/ac/recoverPath.ts';
import { partitionMesh, isSplittable } from '../src/ac/meshParts.ts';
import {
  toRibbon, ribbonBounds, projectPoints, placeRibbonPoint, ribbonSpanOf, trimSpan,
} from '../src/ac/ribbon.ts';
import { computeFrames } from '../src/core/spline.ts';
import * as THREE from 'three';
import { surfaceOfMesh, isDrivableSurface } from '../src/ac/acScene.ts';

let failures = 0;
let checks = 0;
function check(name, cond, detail = '') {
  checks += 1;
  if (cond) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name} ${detail}`); }
}

function sameBytes(a, b) {
  if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `byte ${i}: ${a[i]} vs ${b[i]}`;
  return null;
}

/* Column-major 4x4 helpers, matching the kn5 (and THREE) memory layout. */
const IDENTITY = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = v;
    }
  }
  return o;
}
function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/**
 * A mesh's bounds in WORLD space, walking the dummy matrices the way the game
 * does. Local coordinates are the wrong yardstick here: a mesh under a moved
 * parent is not where its own vertices say it is, and the editor moves things
 * in world space.
 */
function worldBox(file, name) {
  let out = null;
  const walk = (node, m) => {
    let here = m;
    if (node.kind === 'dummy') here = mul(m, node.matrix);
    else if (node.name === name) {
      const d = decodeMesh(node);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < d.positions.length; i += 3) {
        const p = apply(m, [d.positions[i], d.positions[i + 1], d.positions[i + 2]]);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
      }
      out = { lo, hi, centre: lo.map((v, k) => (v + hi[k]) / 2), size: hi.map((v, k) => v - lo[k]) };
    }
    for (const c of node.children) walk(c, here);
  };
  walk(file.root, IDENTITY);
  return out;
}

function findAcRoot() {
  if (process.env.AC_ROOT) return process.env.AC_ROOT;
  for (const g of [
    'C:/Program Files (x86)/Steam/steamapps/common/assettocorsa',
    'C:/Program Files/Steam/steamapps/common/assettocorsa',
    'D:/Steam/steamapps/common/assettocorsa',
    'D:/SteamLibrary/steamapps/common/assettocorsa',
  ]) if (existsSync(join(g, 'content', 'tracks'))) return g;
  return null;
}

/* ------------------------------------------------------------------ */
/* Surface names                                                       */
/* ------------------------------------------------------------------ */

console.log('\nreading a mesh name');
{
  const keys = ['ROAD', 'PITLANE', 'PIT', 'CURB', 'KERB', 'GRASS', 'WALL', 'SAND', 'OUTER'];
  check('a plain road mesh', surfaceOfMesh('1ROAD_track', keys) === 'ROAD');
  check('the longest key wins', surfaceOfMesh('1PITLANE_a', keys) === 'PITLANE',
    String(surfaceOfMesh('1PITLANE_a', keys)));
  check('a shorter key still matches on its own', surfaceOfMesh('1PIT_a', keys) === 'PIT');

  // The three shapes real tracks actually use. Every one of these is a name
  // taken from the reference circuit, and the first rule written here -- key,
  // underscore, capitals -- matched NONE of them, which is how a whole circuit
  // came back with nothing classified as road.
  check('lower case counts', surfaceOfMesh('1road_astro', keys) === 'ROAD',
    String(surfaceOfMesh('1road_astro', keys)));
  check('no separator is needed', surfaceOfMesh('1grass01', keys) === 'GRASS',
    String(surfaceOfMesh('1grass01', keys)));
  check('a bare key on its own', surfaceOfMesh('1sand', keys) === 'SAND');
  check('a digit and a key is enough', surfaceOfMesh('1outer01', keys) === 'OUTER');

  check('any priority digit counts', surfaceOfMesh('3GRASS_a', keys) === 'GRASS');

  // Kunos number their priorities to two digits. Stripping only one leaves
  // `1KERB0051`, which matches nothing -- and that classified ZERO meshes on
  // every Kunos track until it was found.
  check('a two digit priority', surfaceOfMesh('01KERB0051', keys) === 'KERB',
    String(surfaceOfMesh('01KERB0051', keys)));
  check('and a two digit priority on a long key',
    surfaceOfMesh('22PITLANE_a', keys) === 'PITLANE');

  // The separator can sit between the priority and the key.
  check('a separator after the priority', surfaceOfMesh('1_roada', ['ROADA', 'ROAD']) === 'ROADA',
    String(surfaceOfMesh('1_roada', ['ROADA', 'ROAD'])));
  check('and it still prefers the longer key',
    surfaceOfMesh('1_pitlane', ['PIT', 'PITLANE']) === 'PITLANE');

  // Some tracks put the digit inside the KEY.
  check('a key that contains the priority digit',
    surfaceOfMesh('1TRACK_25.001', ['1TRACK', '1ROAD']) === '1TRACK',
    String(surfaceOfMesh('1TRACK_25.001', ['1TRACK', '1ROAD'])));

  // WALL is AC's own and is declared in no surfaces.ini.
  check('walls are recognised without an entry', surfaceOfMesh('03WALL02', ['ROAD']) === 'WALL');

  check('scenery has no surface', surfaceOfMesh('tree_04', keys) === null);
  check('a layer prefix is not a surface',
    surfaceOfMesh('0_fencecon02', ['ROADA', 'CURBA', 'GRASA']) === null,
    String(surfaceOfMesh('0_fencecon02', ['ROADA', 'CURBA', 'GRASA'])));
  check('3d grass is not the GRASA surface',
    surfaceOfMesh('0_3dgrasa_KSLAYER3_00', ['GRASA']) === null,
    String(surfaceOfMesh('0_3dgrasa_KSLAYER3_00', ['GRASA'])));
  check('a name with no leading digit is not physics', surfaceOfMesh('road06', keys) === null);
  check('a visible prop name is not a surface', surfaceOfMesh('1PROP_WALL_shed_0', keys) === null,
    String(surfaceOfMesh('1PROP_WALL_shed_0', keys)));

  // Drivability comes from the file, not from the spelling. OUTER is the
  // reference track's own name for its run off tarmac and no built in list
  // would ever have had it.
  const surfaces = [
    { key: 'ROAD', isValidTrack: true }, { key: 'CURB', isValidTrack: true },
    { key: 'GRASS', isValidTrack: false }, { key: 'OUTER', isValidTrack: true },
  ];
  check('kerbs count as drivable', isDrivableSurface('CURB', surfaces));
  check('grass does not', !isDrivableSurface('GRASS', surfaces));
  check('a made up key is drivable if the track says so',
    isDrivableSurface('OUTER', surfaces));
  check('and not if it says otherwise',
    !isDrivableSurface('OUTER', [{ key: 'OUTER', isValidTrack: false }]));
}

/* ------------------------------------------------------------------ */
/* ini round trip                                                      */
/* ------------------------------------------------------------------ */

console.log('\nini files keep their shape');
{
  const text = '; a comment\r\n[SURFACE_0]\r\nKEY=ROAD\r\nFRICTION=0.98 ; measured\r\n\r\n[SURFACE_10]\r\nKEY=CURB\r\n';
  const ini = parseIni(text);
  check('round trips exactly', stringifyIni(ini) === text);
  check('reads a value', iniGet(ini, 'SURFACE_0', 'KEY') === 'ROAD');
  check('numbered sections come back in numeric order',
    iniNumbered(ini, 'SURFACE_').map((s) => s.index).join() === '0,10');
  check('sections are listed', iniSections(ini).join() === 'SURFACE_0,SURFACE_10');

  iniSet(ini, 'SURFACE_0', 'FRICTION', '0.5');
  check('an edit keeps the trailing comment',
    stringifyIni(ini).includes('FRICTION=0.5 ; measured'),
    stringifyIni(ini).split('\r\n')[3]);
  check('an edit changes nothing else',
    stringifyIni(ini) === text.replace('FRICTION=0.98', 'FRICTION=0.5'));
}

/* ------------------------------------------------------------------ */
/* Marker surgery, on a synthetic model first                          */
/* ------------------------------------------------------------------ */

console.log('\nmarker surgery');
{
  /** Plan across the whole (one file) track, then apply this file's share. */
  const applyTo = (file, model, names, edits) => {
    const plan = planMarkerEdits(names.map((n) => ({ model, name: n })), { [model]: edits });
    return patchMarkers(file, plan.byModel.get(model) ?? {
      deletes: new Set(), moves: new Map(), adds: [], renames: new Map(),
    });
  };

  const makeFile = (names) => ({
    version: 6,
    extra: 0,
    textures: [],
    materials: [],
    root: {
      kind: 'dummy', name: 'root', active: 1, matrix: new Float32Array(16),
      children: names.map((n, i) => ({
        kind: 'dummy', name: n, active: 1, children: [],
        matrix: markerMatrix([i, 0, 0], 0),
      })),
    },
    trailing: new Uint8Array(0),
  });

  {
    const file = makeFile(['AC_PIT_0', 'AC_PIT_1', 'AC_PIT_2', 'AC_PIT_3']);
    applyTo(file, 'm.kn5', ['AC_PIT_0', 'AC_PIT_1', 'AC_PIT_2', 'AC_PIT_3'],
      [{ op: 'delete', name: 'AC_PIT_1' }]);
    check('deleting a pit box closes the gap',
      markerNames(file).join() === 'AC_PIT_0,AC_PIT_1,AC_PIT_2',
      markerNames(file).join());
    // The box that was number 2 must now be number 1 and still be where it was.
    const moved = collectDummies(file.root).find((d) => d.name === 'AC_PIT_1');
    check('and the one that moved up keeps its position', moved && moved.matrix[12] === 2,
      String(moved?.matrix[12]));
  }

  {
    const file = makeFile(['AC_TIME_0_L', 'AC_TIME_0_R', 'AC_TIME_1_L', 'AC_TIME_1_R',
      'AC_TIME_2_L', 'AC_TIME_2_R']);
    applyTo(file, 'm.kn5',
      ['AC_TIME_0_L','AC_TIME_0_R','AC_TIME_1_L','AC_TIME_1_R','AC_TIME_2_L','AC_TIME_2_R'],
      [{ op: 'delete', name: 'AC_TIME_1_L' }, { op: 'delete', name: 'AC_TIME_1_R' }]);
    check('deleting a timing gate keeps the pairs together',
      markerNames(file).join() === 'AC_TIME_0_L,AC_TIME_0_R,AC_TIME_1_L,AC_TIME_1_R',
      markerNames(file).join());
  }

  {
    const file = makeFile(['AC_PIT_0', 'AC_PIT_1']);
    applyTo(file, 'm.kn5', ['AC_PIT_0', 'AC_PIT_1'],
      [{ op: 'add', name: 'AC_PIT_99', p: [7, 1, 2], rot: 45 }]);
    check('adding a pit box numbers it next', markerNames(file).join() === 'AC_PIT_0,AC_PIT_1,AC_PIT_2',
      markerNames(file).join());
    const added = collectDummies(file.root).find((d) => d.name === 'AC_PIT_2');
    check('the new box is where it was put', added && Math.abs(added.matrix[12] - 7) < 1e-5);
  }

  check('a group is read off a name', markerGroup('AC_TIME_3_L') === 'AC_TIME'
    && markerGroup('AC_PIT_12') === 'AC_PIT' && markerGroup('AC_START_0') === 'AC_START');
  check('a non marker has no group', markerGroup('tree_04') === null);
}

/* ------------------------------------------------------------------ */
/* Markers split across models -- the one that nearly broke tracks     */
/* ------------------------------------------------------------------ */

console.log('\nmarkers split across several models');
{
  /*
   * Extra pit boxes are shipped as a SECOND model holding AC_PIT_25 upwards.
   * Measured over an installation, 612 marker groups in 216 models do not
   * start at zero for exactly this reason. Renumbering one file on its own
   * would rename that model's 25..40 to 0..15 -- on top of the boxes already
   * called that in the main model, which is a broken track.
   */
  const main = Array.from({ length: 25 }, (_, i) => ({ model: 'main.kn5', name: `AC_PIT_${i}` }));
  const extra = Array.from({ length: 16 }, (_, i) => ({ model: 'extra.kn5', name: `AC_PIT_${25 + i}` }));
  const inventory = [...main, ...extra];

  {
    // Nothing to close: an edit in the extra model must not renumber anything.
    const plan = planMarkerEdits(inventory, {
      'extra.kn5': [{ op: 'move', name: 'AC_PIT_30', p: [1, 2, 3], rot: 0 }],
    });
    const renames = [...(plan.byModel.get('extra.kn5')?.renames ?? [])];
    check('moving a marker in a second model renumbers nothing', renames.length === 0,
      JSON.stringify(renames.slice(0, 4)));
    check('the main model is not touched at all',
      (plan.byModel.get('main.kn5')?.renames.size ?? 0) === 0);
    check('the track still has all its boxes', plan.counts.AC_PIT === 41, String(plan.counts.AC_PIT));
  }

  {
    // Deleting from the MAIN model must renumber the EXTRA one, or the game
    // sees a gap at 24 and stops reading there.
    const plan = planMarkerEdits(inventory, {
      'main.kn5': [{ op: 'delete', name: 'AC_PIT_10' }],
    });
    const mainRenames = plan.byModel.get('main.kn5')?.renames ?? new Map();
    const extraRenames = plan.byModel.get('extra.kn5')?.renames ?? new Map();
    check('the boxes after the gap in the same model move up',
      mainRenames.get('AC_PIT_11') === 'AC_PIT_10' && mainRenames.get('AC_PIT_24') === 'AC_PIT_23');
    check('and so do the ones in the OTHER model',
      extraRenames.get('AC_PIT_25') === 'AC_PIT_24' && extraRenames.get('AC_PIT_40') === 'AC_PIT_39',
      JSON.stringify([...extraRenames].slice(0, 2)));
    check('the second model is written even though it was not edited',
      plan.renumberedOnly.includes('extra.kn5'), JSON.stringify(plan.renumberedOnly));
    check('the numbering ends up contiguous', (() => {
      const final = inventory
        .filter((m) => m.name !== 'AC_PIT_10')
        .map((m) => (plan.byModel.get(m.model)?.renames.get(m.name)) ?? m.name)
        .map((n) => Number(n.slice('AC_PIT_'.length)))
        .sort((a, b) => a - b);
      return final.every((v, i) => v === i) && final.length === 40;
    })());
    check('no two boxes end up with the same name', (() => {
      const final = inventory
        .filter((m) => m.name !== 'AC_PIT_10')
        .map((m) => (plan.byModel.get(m.model)?.renames.get(m.name)) ?? m.name);
      return new Set(final).size === final.length;
    })());
  }
}

/* ------------------------------------------------------------------ */
/* The grip algebra                                                    */
/* ------------------------------------------------------------------ */

console.log('\nthe end grips: trims and slides in track coordinates');
{
  /*
   * The maths behind dragging a "follows the corner" piece: a quarter circle
   * of radius 100 stands in for the track, a strip of points 8 m outside it
   * for a kerb. No files needed -- this is pure geometry, and it is exactly
   * the function the viewport handles call.
   */
  const R = 100;
  const N = 90;
  const frames = [];
  for (let i = 0; i <= N; i++) {
    const a = (Math.PI / 2) * (i / N);
    frames.push({
      pos: new THREE.Vector3(Math.sin(a) * R, 0, Math.cos(a) * R),
      right: new THREE.Vector3(Math.sin(a), 0, Math.cos(a)),
      up: new THREE.Vector3(0, 1, 0),
      dist: (Math.PI / 2) * R * (i / N),
    });
  }
  const points = [];
  for (let i = 10; i <= 30; i++) {
    const a = (Math.PI / 2) * (i / N);
    for (const lat of [8, 9]) {
      points.push(new THREE.Vector3(Math.sin(a) * (R + lat), 0.1, Math.cos(a) * (R + lat)));
    }
  }

  const proj = projectPoints(frames, points);
  check('a strip beside the arc projects', proj !== null);

  // Identity resize puts every point back where it was.
  const identity = { length: 1, width: 1, height: 1 };
  let worst = 0;
  const out = new THREE.Vector3();
  proj.coords.forEach((r, i) => {
    const p = placeRibbonPoint(frames, proj.bounds, identity, r, out);
    worst = Math.max(worst, p.distanceTo(points[i]));
  });
  check('the identity resize is the identity', worst < 2e-2, `${(worst * 1000).toFixed(2)} mm`);

  // The reported span is the projected extent.
  const span0 = ribbonSpanOf(proj.bounds, identity);
  check('the span is the projected extent',
    Math.abs(span0.from - proj.bounds.minS) < 1e-9 && Math.abs(span0.to - proj.bounds.maxS) < 1e-9);

  // Dragging the far grip: the near end must not move a millimetre.
  const target = span0.to + 12;
  const t1 = trimSpan(proj.bounds, identity, 'to', target);
  const r1 = { length: t1.length, width: 1, height: 1, move: [0, 0, t1.along] };
  const span1 = ribbonSpanOf(proj.bounds, r1);
  check('dragging the far grip pins the near end',
    Math.abs(span1.from - span0.from) < 1e-6, `${span1.from} vs ${span0.from}`);
  check('and lands the far end under the pointer',
    Math.abs(span1.to - target) < 1e-6, `${span1.to} vs ${target}`);

  // The near grip, on a piece that has already been resized once.
  const target2 = span1.from + 5;
  const t2 = trimSpan(proj.bounds, r1, 'from', target2);
  const r2 = { length: t2.length, width: 1, height: 1, move: [0, 0, t2.along] };
  const span2 = ribbonSpanOf(proj.bounds, r2);
  check('the near grip composes on top of an earlier trim',
    Math.abs(span2.to - span1.to) < 1e-6 && Math.abs(span2.from - target2) < 1e-6);

  // It refuses to trim a piece away to nothing.
  const t3 = trimSpan(proj.bounds, identity, 'to', span0.from - 50, 0.5);
  const span3 = ribbonSpanOf(proj.bounds, { length: t3.length, width: 1, height: 1, move: [0, 0, t3.along] });
  check('a grip dragged past the other end leaves the minimum',
    Math.abs((span3.to - span3.from) - 0.5) < 1e-6, `${(span3.to - span3.from).toFixed(3)} m left`);

  // Sliding along the arc: the lateral distance to the track must not change,
  // which is the whole reason this is not a world translation.
  const slid = { length: 1, width: 1, height: 1, move: [0, 0, 25] };
  let latWorst = 0;
  proj.coords.forEach((r) => {
    const p = placeRibbonPoint(frames, proj.bounds, slid, r, out);
    const back = toRibbon(frames, p);
    latWorst = Math.max(latWorst, Math.abs(back.lateral - r.lateral));
  });
  check('a 25 m slide keeps the distance to the edge', latWorst < 2e-2,
    `${(latWorst * 100).toFixed(2)} cm drift`);

  /*
   * The edge datum. The road is not a constant width: on this one the right
   * half widens from 8 to 12 m over the quarter circle. A kerb slid with its
   * lateral measured from the CENTRE keeps its centre distance and drifts
   * relative to the edge by exactly the widening; measured from the EDGE it
   * stays a kerb, which is the behaviour a kerb owes its corner.
   */
  const widthAt = (i) => 8 + 4 * (i / N);
  const wide = frames.map((f, i) => ({ ...f, widthL: 8, widthR: widthAt(i) }));
  // A strip 2 m outside the right edge, over a stretch where the edge moves.
  const edgePts = [];
  for (let i = 10; i <= 30; i++) {
    const a = (Math.PI / 2) * (i / N);
    edgePts.push(new THREE.Vector3(
      Math.sin(a) * (R + widthAt(i) + 2), 0.1, Math.cos(a) * (R + widthAt(i) + 2)));
  }
  const projEdge = projectPoints(wide, edgePts, 1);
  check('edge-based projection reads a constant 2 m off the edge',
    projEdge !== null
      && Math.abs(projEdge.bounds.minLateral - 2) < 0.05
      && Math.abs(projEdge.bounds.maxLateral - 2) < 0.05,
    projEdge ? `${projEdge.bounds.minLateral.toFixed(3)}..${projEdge.bounds.maxLateral.toFixed(3)}` : 'null');

  // Identity stays the identity under the edge datum too.
  const idEdge = { length: 1, width: 1, height: 1, edgeSide: 1 };
  let idWorst = 0;
  projEdge.coords.forEach((r, i) => {
    const p = placeRibbonPoint(wide, projEdge.bounds, idEdge, r, out);
    idWorst = Math.max(idWorst, p.distanceTo(edgePts[i]));
  });
  check('the identity resize is still the identity against the edge', idWorst < 2e-2,
    `${(idWorst * 1000).toFixed(2)} mm`);

  // Slide 40 m up the widening: the edge distance must hold at 2 m...
  const slideEdge = { length: 1, width: 1, height: 1, move: [0, 0, 40], edgeSide: 1 };
  let edgeWorst = 0;
  projEdge.coords.forEach((r) => {
    const p = placeRibbonPoint(wide, projEdge.bounds, slideEdge, r, out);
    const back = toRibbon(wide, p, 1);
    edgeWorst = Math.max(edgeWorst, Math.abs(back.lateral - 2));
  });
  check('slid 40 m up a widening road, the kerb stays 2 m off the edge', edgeWorst < 0.05,
    `${(edgeWorst * 100).toFixed(1)} cm off`);

  // ...where the centre-line datum provably drifts by the widening.
  const projCentre = projectPoints(wide, edgePts, undefined);
  const slideCentre = { length: 1, width: 1, height: 1, move: [0, 0, 40] };
  let centreDrift = 0;
  projCentre.coords.forEach((r) => {
    const p = placeRibbonPoint(wide, projCentre.bounds, slideCentre, r, out);
    const back = toRibbon(wide, p, 1);
    centreDrift = Math.max(centreDrift, Math.abs(back.lateral - 2));
  });
  check('the centre-line datum really would drift off the edge there', centreDrift > 0.5,
    `${(centreDrift * 100).toFixed(0)} cm — this is the mistake the edge datum removes`);
}

/* ------------------------------------------------------------------ */
/* The real thing                                                      */
/* ------------------------------------------------------------------ */

const root = findAcRoot();
const hock = root ? join(root, 'content', 'tracks', 'vhe_hockenheim') : null;

if (!hock || !existsSync(hock)) {
  console.log('\nvhe_hockenheim is not installed, skipping the file backed checks');
} else {
  console.log('\nevery ini in the reference track round trips');
  {
    const inis = [];
    const walk = (dir, prefix) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full, `${prefix}${e.name}/`);
        else if (e.name.toLowerCase().endsWith('.ini')) inis.push([`${prefix}${e.name}`, full]);
      }
    };
    walk(hock, '');
    let differed = 0;
    for (const [name, full] of inis) {
      const bytes = new Uint8Array(readFileSync(full));
      const back = new TextEncoder().encode(stringifyIni(parseIni(bytes)));
      if (sameBytes(bytes, back) !== null) {
        differed += 1;
        if (differed <= 3) console.log(`    DIFFERS ${name}: ${sameBytes(bytes, back)}`);
      }
    }
    check(`all ${inis.length} ini files come back identical`, differed === 0, `${differed} differed`);
  }

  console.log('\npatching the model that holds the markers');
  {
    const path = join(hock, 'obj_box.kn5');
    const original = new Uint8Array(readFileSync(path));
    const before = readKn5(original);
    const beforeNames = markerNames(before);
    const pits = beforeNames.filter((n) => n.startsWith('AC_PIT_'));
    check('the pit boxes are there', pits.length >= 20, `${pits.length}`);
    check('and they start out contiguous from zero',
      pits.every((n, i) => n === `AC_PIT_${i}`), pits.slice(0, 3).join());

    // Move one box and check that everything else is untouched, byte for byte.
    const file = readKn5(original);
    const inventory = beforeNames.map((n) => ({ model: 'obj_box.kn5', name: n }));
    const plan1 = planMarkerEdits(inventory, {
      'obj_box.kn5': [{ op: 'move', name: 'AC_PIT_5', p: [100, 2, 200], rot: 33 }],
    });
    const result = patchMarkers(file, plan1.byModel.get('obj_box.kn5'));
    check('exactly one marker moved', result.moved === 1 && result.deleted === 0 && result.added === 0);
    check('nothing needed renumbering', result.renamed === 0);

    const out = writeKn5(file);
    check('the model is still the same size', out.length === original.length,
      `${out.length} vs ${original.length}`);

    const reread = readKn5(out);
    const box5 = collectDummies(reread.root).find((d) => d.name === 'AC_PIT_5');
    check('the moved box is where it was put',
      box5 && Math.abs(box5.matrix[12] - 100) < 1e-4 && Math.abs(box5.matrix[14] - 200) < 1e-4);

    // Every other marker, byte for byte.
    const beforeById = new Map(collectDummies(before.root).map((d) => [d.name, d]));
    let changedOthers = 0;
    for (const d of collectDummies(reread.root)) {
      if (d.name === 'AC_PIT_5') continue;
      const was = beforeById.get(d.name);
      if (!was) { changedOthers += 1; continue; }
      if (sameBytes(new Uint8Array(was.matrix.buffer), new Uint8Array(d.matrix.buffer)) !== null) {
        changedOthers += 1;
      }
    }
    check('every other marker is untouched', changedOthers === 0, `${changedOthers} changed`);

    let meshDiff = 0;
    const beforeMeshes = collectMeshes(before.root);
    const afterMeshes = collectMeshes(reread.root);
    for (let i = 0; i < beforeMeshes.length; i++) {
      if (sameBytes(beforeMeshes[i].vertices, afterMeshes[i].vertices) !== null) meshDiff += 1;
    }
    check('every mesh is untouched', meshDiff === 0 && beforeMeshes.length === afterMeshes.length);

    // Deleting renumbers, and AC stops reading at the first gap so this is the
    // difference between removing one box and removing twenty two.
    const file2 = readKn5(original);
    const plan2 = planMarkerEdits(inventory, {
      'obj_box.kn5': [{ op: 'delete', name: 'AC_PIT_5' }],
    });
    const r2 = patchMarkers(file2, plan2.byModel.get('obj_box.kn5'));
    const names2 = markerNames(file2).filter((n) => n.startsWith('AC_PIT_'));
    check('deleting one box leaves the rest contiguous',
      names2.length === pits.length - 1
      && names2.every((n, i) => n === `AC_PIT_${i}`),
      `${names2.length} boxes of ${pits.length}, ${r2.renamed} renumbered`);
    // Each renumbered marker takes its own visual plate with it, so the count
    // is two nodes per marker on this track.
    check('and renumbers exactly the ones after the gap',
      r2.renamed === (pits.length - 6) * 2, `${r2.renamed}`);
    check('the marker plates were renamed with their markers',
      collectMeshes(file2.root).filter((m) => m.name.startsWith('AC_PIT_')).length === pits.length - 1);
  }

  console.log('\nhiding a mesh');
  {
    const path = join(hock, 'obj_groove.kn5');
    const original = new Uint8Array(readFileSync(path));
    const file = readKn5(original);
    const meshes = collectMeshes(file.root);
    const victim = meshes[0].name;

    const before = readKn5(original);
    const result = patchMeshes(file, { hidden: new Set([victim]), renamed: new Map() });
    check('one mesh was removed', result.hidden === 1);
    check('it is gone', !collectMeshes(file.root).some((m) => m.name === victim));

    const out = writeKn5(file);
    const reread = readKn5(out);
    check('the model still reads', reread.materials.length === before.materials.length);
    check('the other meshes are all still there',
      collectMeshes(reread.root).length === meshes.length - 1);
    check('the file got smaller', out.length < original.length);
  }

  console.log('\nmoving one of the track\'s own meshes');
  {
    const path = join(hock, 'obj_groove.kn5');
    const original = new Uint8Array(readFileSync(path));

    const boxOf = worldBox;

    const before = readKn5(original);
    const target = collectMeshes(before.root)[0].name;
    const b0 = boxOf(before, target);

    // A plain move first: the mesh goes exactly that far and nothing else does.
    const moved = readKn5(original);
    const r1 = transformMeshes(moved, { [target]: { p: [5, 2, -3], r: [0, 0, 0], s: [1, 1, 1] } });
    check('one mesh was moved', r1.moved === 1);
    const b1 = boxOf(readKn5(writeKn5(moved)), target);
    check('it moved exactly as far as asked',
      Math.abs(b1.centre[0] - b0.centre[0] - 5) < 1e-3
      && Math.abs(b1.centre[1] - b0.centre[1] - 2) < 1e-3
      && Math.abs(b1.centre[2] - b0.centre[2] + 3) < 1e-3,
      `${b1.centre.map((v, k) => (v - b0.centre[k]).toFixed(3))}`);
    check('and it did not change shape',
      b1.size.every((v, k) => Math.abs(v - b0.size[k]) < 1e-3));
    check('the file is exactly the same size', writeKn5(moved).length === original.length);

    // Resizing happens about the mesh's own centre, so it stays where it was.
    const scaled = readKn5(original);
    transformMeshes(scaled, { [target]: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 2, 1] } });
    const b2 = boxOf(readKn5(writeKn5(scaled)), target);
    check('resizing doubles the height', Math.abs(b2.size[1] - b0.size[1] * 2) < 1e-3,
      `${b0.size[1].toFixed(3)} -> ${b2.size[1].toFixed(3)}`);
    check('and keeps the centre where it was',
      b2.centre.every((v, k) => Math.abs(v - b0.centre[k]) < 1e-3),
      `before ${b0.centre.map((v) => v.toFixed(4))} after ${b2.centre.map((v) => v.toFixed(4))}`);
    check('and does not move it sideways',
      Math.abs(b2.size[0] - b0.size[0]) < 1e-3 && Math.abs(b2.size[2] - b0.size[2]) < 1e-3);

    // Nothing else in the model may move.
    const others = collectMeshes(readKn5(writeKn5(moved)).root);
    const originals = collectMeshes(before.root);
    let changed = 0;
    for (let i = 0; i < originals.length; i++) {
      if (originals[i].name === target) continue;
      if (sameBytes(originals[i].vertices, others[i].vertices) !== null) changed += 1;
    }
    check('every other mesh is untouched', changed === 0, `${changed} changed`);

    // A no-op transform must be exactly a no-op.
    const still = readKn5(original);
    transformMeshes(still, { [target]: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] } });
    check('moving by nothing changes nothing at all',
      sameBytes(original, writeKn5(still)) === null, sameBytes(original, writeKn5(still)) ?? '');
  }

  console.log('\nmoving ONE piece of a merged mesh');
  {
    /*
     * The complaint this exists for: a modder merges every kerb of one kind
     * into a single mesh, so selecting it selected all of them at once.
     */
    const path = join(hock, 'vhe_hockenheim.kn5');
    const original = new Uint8Array(readFileSync(path));
    const file = readKn5(original);
    const kerb = collectMeshes(file.root).find((m) => m.name === '1kerb01');

    const partition = partitionMesh(kerb);
    check('the merged kerb really is many pieces', partition.parts.length > 5,
      `${partition.parts.length}`);
    check('and they are real runs, not stray triangles',
      partition.parts.filter((p) => p.triangles.length >= 20).length > 5,
      `${partition.parts.filter((p) => p.triangles.length >= 20).length} runs`);
    check('every triangle belongs to exactly one piece',
      partition.ofTriangle.length === kerb.indexCount / 3
      && partition.parts.reduce((a, p) => a + p.triangles.length, 0) === kerb.indexCount / 3);

    // Move piece 3 and check the others stayed put.
    const target = partition.parts.findIndex((p) => p.triangles.length >= 20);
    const moved = readKn5(new Uint8Array(readFileSync(path)));
    const r = transformMeshes(moved, {
      [`1kerb01#${target}`]: { p: [0, 5, 0], r: [0, 0, 0], s: [1, 1, 1] },
    });
    check('one piece was moved', r.moved === 1);

    const after = readKn5(writeKn5(moved));
    const afterKerb = collectMeshes(after.root).find((m) => m.name === '1kerb01');
    const d0 = decodeMesh(kerb);
    const d1 = decodeMesh(afterKerb);
    const inPiece = new Set(partition.parts[target].vertices);
    let liftedInside = 0, movedOutside = 0;
    for (let v = 0; v < kerb.vertexCount; v++) {
      const dy = d1.positions[v * 3 + 1] - d0.positions[v * 3 + 1];
      if (inPiece.has(v)) { if (Math.abs(dy - 5) < 1e-3) liftedInside += 1; }
      else if (Math.abs(dy) > 1e-4) movedOutside += 1;
    }
    check('every vertex of that piece rose by exactly 5 m',
      liftedInside === inPiece.size, `${liftedInside} of ${inPiece.size}`);
    check('and not one vertex outside it moved', movedOutside === 0, `${movedOutside} moved`);
    check('the file is still the same size', writeKn5(moved).length === original.length);

    // Two pieces of the SAME mesh, moved different ways.
    const other = partition.parts.findIndex((p, i) => i !== target && p.triangles.length >= 20);
    const both = readKn5(new Uint8Array(readFileSync(path)));
    const r2 = transformMeshes(both, {
      [`1kerb01#${target}`]: { p: [0, 5, 0], r: [0, 0, 0], s: [1, 1, 1] },
      [`1kerb01#${other}`]: { p: [0, -3, 0], r: [0, 0, 0], s: [1, 1, 1] },
    });
    check('two pieces of one mesh move independently', r2.moved === 2);
    const d2 = decodeMesh(collectMeshes(readKn5(writeKn5(both)).root).find((m) => m.name === '1kerb01'));
    const a = partition.parts[target].vertices[0];
    const b = partition.parts[other].vertices[0];
    check('and each went its own way',
      Math.abs((d2.positions[a * 3 + 1] - d0.positions[a * 3 + 1]) - 5) < 1e-3
      && Math.abs((d2.positions[b * 3 + 1] - d0.positions[b * 3 + 1]) + 3) < 1e-3);
  }

  console.log('\nresizing a kerb that goes round a corner');
  {
    /*
     * The thing an axis scale cannot do. A kerb follows an arc; stretching it
     * along X or Z turns that arc into an ellipse and walks it off the tarmac.
     * Measured here rather than argued about.
     */
    const path = join(hock, 'vhe_hockenheim.kn5');
    const lane = readAiLane(new Uint8Array(readFileSync(join(hock, 'gp/ai/fast_lane.ai'))));
    const frames = computeFrames(recoverPathFromLane(lane).path, 2);
    const file = readKn5(new Uint8Array(readFileSync(path)));
    const kerb = collectMeshes(file.root).find((m) => m.name === '1kerb01');
    const partition = partitionMesh(kerb);

    // The piece that curves most: that is where the difference shows.
    let target = 0, mostTurn = 0;
    partition.parts.forEach((p, i) => {
      if (p.triangles.length < 200) return;
      const d = decodeMesh(kerb);
      const pts = [...p.vertices].map((v) => new THREE.Vector3(
        d.positions[v * 3], d.positions[v * 3 + 1], d.positions[v * 3 + 2]));
      const b = ribbonBounds(frames, pts);
      if (!b) return;
      const turn = b.maxS - b.minS;
      if (turn > mostTurn) { mostTurn = turn; target = i; }
    });

    const d0 = decodeMesh(kerb);
    const pts = [...partition.parts[target].vertices].map((v) => new THREE.Vector3(
      d0.positions[v * 3], d0.positions[v * 3 + 1], d0.positions[v * 3 + 2]));
    const before = pts.map((p) => toRibbon(frames, p));
    const bounds = ribbonBounds(frames, pts);
    check('the test piece really does run along the track',
      bounds !== null && bounds.maxS - bounds.minS > 20,
      `${(bounds.maxS - bounds.minS).toFixed(1)} m`);

    /* --- what an axis scale does --------------------------------------- */
    const box = partition.parts[target].box;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const axis = size.x >= size.z ? 'x' : 'z';
    let axisWorst = 0;
    pts.forEach((p, j) => {
      const q = p.clone();
      q[axis] = centre[axis] + (q[axis] - centre[axis]) * 1.02;
      axisWorst = Math.max(axisWorst, Math.abs(toRibbon(frames, q).lateral - before[j].lateral));
    });
    check('an axis scale really does walk it off the track', axisWorst > 0.3,
      `${(axisWorst * 100).toFixed(0)} cm`);

    /* --- what the along-the-track resize does --------------------------- */
    const ribboned = readKn5(new Uint8Array(readFileSync(path)));
    const r = transformMeshes(ribboned, {
      [`1kerb01#${target}`]: {
        p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1],
        ribbon: { length: 1.02, width: 1, height: 1 },
      },
    }, frames);
    check('the along-the-track resize ran', r.moved === 1 && r.skippedRibbon === 0);

    const after = collectMeshes(readKn5(writeKn5(ribboned)).root).find((m) => m.name === '1kerb01');
    const d1 = decodeMesh(after);
    let ribbonWorst = 0, sLo = Infinity, sHi = -Infinity;
    [...partition.parts[target].vertices].forEach((v, j) => {
      const q = new THREE.Vector3(d1.positions[v * 3], d1.positions[v * 3 + 1], d1.positions[v * 3 + 2]);
      const rp = toRibbon(frames, q);
      ribbonWorst = Math.max(ribbonWorst, Math.abs(rp.lateral - before[j].lateral));
      sLo = Math.min(sLo, rp.s); sHi = Math.max(sHi, rp.s);
    });

    check('it keeps its distance from the track edge', ribbonWorst < 0.03,
      `${(ribbonWorst * 100).toFixed(2)} cm, against ${(axisWorst * 100).toFixed(0)} cm for the axis scale`);
    check('and it really is 2% longer along the arc',
      Math.abs((sHi - sLo) - (bounds.maxS - bounds.minS) * 1.02) < 0.5,
      `${(bounds.maxS - bounds.minS).toFixed(1)} -> ${(sHi - sLo).toFixed(1)} m`);

    // Without the centre line it must refuse rather than fall back to an axis
    // scale, which is the very thing it exists to avoid.
    const noFrames = readKn5(new Uint8Array(readFileSync(path)));
    const r2 = transformMeshes(noFrames, {
      [`1kerb01#${target}`]: {
        p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1],
        ribbon: { length: 1.02, width: 1, height: 1 },
      },
    });
    check('with no centre line it refuses instead of guessing',
      r2.moved === 0 && r2.skippedRibbon === 1);
    check('and leaves the model exactly as it found it',
      sameBytes(new Uint8Array(readFileSync(path)), writeKn5(noFrames)) === null);
  }

  console.log('\nresizing a kerb by centimetres');
  {
    /*
     * The real ask: take the sausage kerb at turn one and make it five
     * centimetres wider, one centimetre taller and fifteen centimetres longer,
     * and have it still look right. Three things have to hold.
     */
    const path = join(hock, 'vhe_hockenheim.kn5');
    const original = new Uint8Array(readFileSync(path));
    const before = readKn5(original);
    const kerb = collectMeshes(before.root).find((m) => m.name === '1curb_t1_sausage');
    if (!kerb) {
      console.log('  (the reference sausage kerb is not in this copy of the track)');
    } else {
      const boxOf = (mesh) => {
        const d = decodeMesh(mesh);
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < d.positions.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], d.positions[i + k]);
            hi[k] = Math.max(hi[k], d.positions[i + k]);
          }
        }
        return { lo, hi, size: hi.map((v, k) => v - lo[k]) };
      };
      const b0 = boxOf(kerb);
      check('the sausage kerb is the size it looks',
        b0.size[0] > 1.5 && b0.size[0] < 2.5 && b0.size[1] < 0.2 && b0.size[2] > 6,
        b0.size.map((v) => v.toFixed(2)).join(' x '));

      // Grow from the base in Y and from the middle in X and Z, which is what
      // the panel's default anchor asks for.
      const about = [
        (b0.lo[0] + b0.hi[0]) / 2,
        b0.lo[1],
        (b0.lo[2] + b0.hi[2]) / 2,
      ];
      const t = {
        p: [0, 0, 0], r: [0, 0, 0],
        s: [
          (b0.size[0] + 0.05) / b0.size[0],
          (b0.size[1] + 0.01) / b0.size[1],
          (b0.size[2] + 0.15) / b0.size[2],
        ],
        about,
        keepTexture: true,
      };

      const file = readKn5(new Uint8Array(readFileSync(path)));
      transformMeshes(file, { '1curb_t1_sausage': t });
      const after = collectMeshes(readKn5(writeKn5(file)).root)
        .find((m) => m.name === '1curb_t1_sausage');
      const b1 = boxOf(after);

      check('it ends up exactly 5 cm wider, 1 cm taller and 15 cm longer',
        Math.abs(b1.size[0] - b0.size[0] - 0.05) < 1e-3
        && Math.abs(b1.size[1] - b0.size[1] - 0.01) < 1e-3
        && Math.abs(b1.size[2] - b0.size[2] - 0.15) < 1e-3,
        b1.size.map((v, k) => (v - b0.size[k]).toFixed(4)).join(', '));

      // Growing from the base: the bottom stays on the road, the extra
      // centimetre goes upward. Anchored at the centre it would sink 5 mm in.
      check('and it grows UP off the road rather than sinking into it',
        Math.abs(b1.lo[1] - b0.lo[1]) < 1e-4 && Math.abs(b1.hi[1] - b0.hi[1] - 0.01) < 1e-3,
        `bottom moved ${(b1.lo[1] - b0.lo[1]).toFixed(5)} m`);

      // The texture keeps its real world size: UV span grows in step with the
      // geometry, so the pattern does not stretch.
      const uvSpan = (mesh) => {
        const d = decodeMesh(mesh);
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (let i = 0; i < d.uvs.length; i += 2) {
          u0 = Math.min(u0, d.uvs[i]); u1 = Math.max(u1, d.uvs[i]);
          v0 = Math.min(v0, d.uvs[i + 1]); v1 = Math.max(v1, d.uvs[i + 1]);
        }
        return [u1 - u0, v1 - v0];
      };
      const s0 = uvSpan(kerb), s1 = uvSpan(after);

      /*
       * Along the LENGTH the texture repeats -- this kerb spans 1.5 tiles of v
       * -- so the pattern grows with the geometry and keeps its real size.
       */
      const wantV = s0[1] * t.s[2];
      check('along its length the texture grows with it instead of stretching',
        Math.abs(s1[1] - wantV) < 1e-3,
        `v ${s0[1].toFixed(3)} -> ${s1[1].toFixed(3)} (want ${wantV.toFixed(3)})`);

      /*
       * Across the WIDTH it does not, and must not. This kerb uses u 0.5 to 1.0
       * -- half an atlas -- so growing its UVs would drag in whatever the
       * modder drew in the other half. Better a 2.7% stretch nobody can see
       * than a stripe of the wrong image.
       */
      check('across its width the texture is left alone, because it is an atlas slice',
        Math.abs(s1[0] - s0[0]) < 1e-6 && s0[0] < 1,
        `span ${s0[0].toFixed(3)}, now ${s1[0].toFixed(3)}`);

      // And with the option off, the UVs must be left exactly alone.
      const plain = readKn5(new Uint8Array(readFileSync(path)));
      transformMeshes(plain, { '1curb_t1_sausage': { ...t, keepTexture: false } });
      const stretched = collectMeshes(readKn5(writeKn5(plain)).root)
        .find((m) => m.name === '1curb_t1_sausage');
      const s2 = uvSpan(stretched);
      check('switching it off leaves the texture untouched',
        Math.abs(s2[0] - s0[0]) < 1e-6 && Math.abs(s2[1] - s0[1]) < 1e-6);
    }
  }

  console.log('\nlaying down another section instead of stretching one');
  {
    /*
     * "Make this kerb longer" done honestly. Scaling it stretches the texture
     * and the ripples with it; laying down another SECTION keeps the pattern
     * exactly as it was drawn, which is also how a real kerb is built.
     */
    const path = join(hock, 'vhe_hockenheim.kn5');
    const original = new Uint8Array(readFileSync(path));
    const before = readKn5(original);
    const kerb = collectMeshes(before.root).find((m) => m.name === '1kerb01');
    const partition = partitionMesh(kerb);
    const part = partition.parts.findIndex((p) => p.triangles.length >= 20);
    const piece = partition.parts[part];

    const file = readKn5(new Uint8Array(readFileSync(path)));
    const r = appendPieceCopies(file, [{
      id: 'abc', mesh: '1kerb01', part,
      t: { p: [0, 0, 40], r: [0, 0, 0], s: [1, 1, 1] },
    }]);
    check('a copy was added', r.added === 1 && r.skipped.length === 0, r.skipped.join('; '));

    const out = writeKn5(file);
    const after = readKn5(out);
    const names = collectMeshes(after.root).map((m) => m.name);
    const copyName = names.find((n) => n.startsWith('1kerb01_copy'));
    check('it is a new mesh of its own', !!copyName, names.length + ' meshes');
    check('and the model gained exactly one',
      names.length === collectMeshes(before.root).length + 1);

    // The copy still reads as a kerb: AC matches surfaces by name prefix.
    check('the copy is still a kerb to drive on',
      surfaceOfMesh(copyName, ['ROAD', 'KERB', 'CURB', 'GRASS']) === 'KERB',
      String(surfaceOfMesh(copyName, ['ROAD', 'KERB', 'CURB', 'GRASS'])));

    const copyMesh = collectMeshes(after.root).find((m) => m.name === copyName);
    check('it holds only that piece, not the whole mesh',
      copyMesh.indexCount / 3 === piece.triangles.length,
      `${copyMesh.indexCount / 3} vs ${piece.triangles.length}`);
    check('it shares the original material', copyMesh.materialId === kerb.materialId);
    check('and has a bounding sphere of its own', copyMesh.boundingSphere[3] > 0);

    // Where it landed, and that the original did not budge.
    const centreOf = (mesh, verts) => {
      const d = decodeMesh(mesh);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      const list = verts ?? Array.from({ length: mesh.vertexCount }, (_, i) => i);
      for (const v of list) {
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], d.positions[v * 3 + k]);
          hi[k] = Math.max(hi[k], d.positions[v * 3 + k]);
        }
      }
      return lo.map((v, k) => (v + hi[k]) / 2);
    };
    const c0 = centreOf(kerb, piece.vertices);
    const c1 = centreOf(copyMesh, null);
    check('the copy sits where it was placed',
      Math.abs(c1[2] - c0[2] - 40) < 1e-2 && Math.abs(c1[0] - c0[0]) < 1e-2,
      `${(c1[0] - c0[0]).toFixed(2)}, ${(c1[2] - c0[2]).toFixed(2)}`);

    const afterKerb = collectMeshes(after.root).find((m) => m.name === '1kerb01');
    check('the original is untouched, byte for byte',
      sameBytes(kerb.vertices, afterKerb.vertices) === null);

    // Copying a piece that has since vanished must warn, not crash.
    const gone = readKn5(new Uint8Array(readFileSync(path)));
    const r2 = appendPieceCopies(gone, [{
      id: 'x', mesh: 'does_not_exist', t: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
    }]);
    check('a copy of something missing is reported, not crashed on',
      r2.added === 0 && r2.skipped.length === 1);
  }

  console.log('\na copy that follows the corner');
  {
    /*
     * "Another one" on a curved kerb. A world-axis offset lays the second
     * section on a TANGENT: in a corner it stands off the kerb line and the
     * third leaves the tarmac. With the centre line, the copy is a ribbon
     * shift by one arc length -- so it stays exactly as far from the edge as
     * the original, one section further round the bend.
     */
    const path = join(hock, 'vhe_hockenheim.kn5');
    const lane = readAiLane(new Uint8Array(readFileSync(join(hock, 'gp/ai/fast_lane.ai'))));
    const frames = computeFrames(recoverPathFromLane(lane).path, 2);
    const original = new Uint8Array(readFileSync(path));
    const before = readKn5(original);
    const kerb = collectMeshes(before.root).find((m) => m.name === '1kerb01');
    const partition = partitionMesh(kerb);

    // The piece that curves most, same choice as the resize test.
    let target = 0, mostTurn = 0;
    const d0 = decodeMesh(kerb);
    partition.parts.forEach((p, i) => {
      if (p.triangles.length < 200) return;
      const pts = [...p.vertices].map((v) => new THREE.Vector3(
        d0.positions[v * 3], d0.positions[v * 3 + 1], d0.positions[v * 3 + 2]));
      const b = ribbonBounds(frames, pts);
      if (b && b.maxS - b.minS > mostTurn) { mostTurn = b.maxS - b.minS; target = i; }
    });
    const piece = partition.parts[target];
    const pts = [...piece.vertices].map((v) => new THREE.Vector3(
      d0.positions[v * 3], d0.positions[v * 3 + 1], d0.positions[v * 3 + 2]));
    const bounds = ribbonBounds(frames, pts);
    const arc = bounds.maxS - bounds.minS;

    const file = readKn5(new Uint8Array(readFileSync(path)));
    const r = appendPieceCopies(file, [{
      id: 'arc', mesh: '1kerb01', part: target,
      t: {
        p: [0, 0, arc], r: [0, 0, 0], s: [1, 1, 1],
        ribbon: { length: 1, width: 1, height: 1, anchor: [0.5, 0, 0.5] },
      },
    }], frames);
    check('the arc copy was added', r.added === 1 && r.skipped.length === 0, r.skipped.join('; '));

    const after = readKn5(writeKn5(file));
    const copyMesh = collectMeshes(after.root).find((m) => m.name.startsWith('1kerb01_copy_arc'));
    check('it exists as its own mesh', !!copyMesh);

    // Same distance from the edge, one arc length further along.
    const d1 = decodeMesh(copyMesh);
    let latWorst = 0, sLo = Infinity, sHi = -Infinity;
    const beforeRibbon = pts.map((p) => toRibbon(frames, p));
    for (let v = 0; v < copyMesh.vertexCount; v++) {
      const q = new THREE.Vector3(d1.positions[v * 3], d1.positions[v * 3 + 1], d1.positions[v * 3 + 2]);
      const rp = toRibbon(frames, q);
      sLo = Math.min(sLo, rp.s); sHi = Math.max(sHi, rp.s);
    }
    // Vertex order in the copy differs from the piece's vertex list, so the
    // lateral band is compared as a whole rather than vertex by vertex.
    const latsBefore = beforeRibbon.map((r0) => r0.lateral).sort((a, b) => a - b);
    const latsAfter = [];
    for (let v = 0; v < copyMesh.vertexCount; v++) {
      const q = new THREE.Vector3(d1.positions[v * 3], d1.positions[v * 3 + 1], d1.positions[v * 3 + 2]);
      latsAfter.push(toRibbon(frames, q).lateral);
    }
    latsAfter.sort((a, b) => a - b);
    latWorst = Math.max(
      Math.abs(latsAfter[0] - latsBefore[0]),
      Math.abs(latsAfter[latsAfter.length - 1] - latsBefore[latsBefore.length - 1]),
    );
    check('the copy keeps its distance from the edge', latWorst < 0.05,
      `${(latWorst * 100).toFixed(1)} cm`);
    check('and sits one section further round the bend',
      Math.abs(sLo - (bounds.minS + arc)) < 1.0 && Math.abs(sHi - (bounds.maxS + arc)) < 1.0,
      `s ${sLo.toFixed(1)}..${sHi.toFixed(1)} vs ${(bounds.minS + arc).toFixed(1)}..${(bounds.maxS + arc).toFixed(1)}`);

    const afterKerb = collectMeshes(after.root).find((m) => m.name === '1kerb01');
    check('the original is untouched', sameBytes(kerb.vertices, afterKerb.vertices) === null);

    /*
     * Continuations of a STRETCHED source (what Alt-dragging the end grip
     * lays): same mapping, shifted by exactly what the source covers now.
     * Each section must start where the previous one ends -- that is the
     * whole point of copying instead of stretching further.
     */
    {
      const src = {
        p: [0, 0, -0.934], r: [0, 0, 0], s: [1, 1, 1],
        ribbon: { length: 1.0864, width: 1, height: 1, anchor: [0.5, 0, 0.5] },
      };
      const covered = arc * src.ribbon.length;
      const cont = readKn5(new Uint8Array(readFileSync(path)));
      const rc = appendPieceCopies(cont, [1, 2].map((k) => ({
        id: `k${k}`, mesh: '1kerb01', part: target,
        t: { ...src, p: [src.p[0], src.p[1], src.p[2] + k * covered] },
      })), frames);
      check('two continuation sections were laid', rc.added === 2, rc.skipped.join('; '));

      const contFile = readKn5(writeKn5(cont));
      const bandOf = (name) => {
        const m = collectMeshes(contFile.root).find((x) => x.name.startsWith(name));
        const dm = decodeMesh(m);
        let lo = Infinity, hi = -Infinity;
        for (let v = 0; v < m.vertexCount; v++) {
          const s = toRibbon(frames, new THREE.Vector3(
            dm.positions[v * 3], dm.positions[v * 3 + 1], dm.positions[v * 3 + 2])).s;
          lo = Math.min(lo, s); hi = Math.max(hi, s);
        }
        return { lo, hi };
      };
      const b1 = bandOf('1kerb01_copy_k1');
      const b2 = bandOf('1kerb01_copy_k2');
      check('the first section starts where the stretched source ends',
        Math.abs(b1.lo - (bounds.minS + src.p[2] - (covered - arc) / 2 + covered)) < 1.0
        && Math.abs((b1.hi - b1.lo) - covered) < 1.0,
        `band ${b1.lo.toFixed(1)}..${b1.hi.toFixed(1)}, covers ${(b1.hi - b1.lo).toFixed(1)} vs ${covered.toFixed(1)}`);
      check('and the second starts where the first ends',
        Math.abs(b2.lo - b1.lo - covered) < 0.5 && Math.abs(b2.hi - b1.hi - covered) < 0.5,
        `${(b2.lo - b1.lo).toFixed(2)} / ${(b2.hi - b1.hi).toFixed(2)} vs ${covered.toFixed(2)}`);
    }

    // Without the centre line it must refuse, exactly like the resize does --
    // falling back to a world offset would put it somewhere the preview never
    // showed.
    const blind = readKn5(new Uint8Array(readFileSync(path)));
    const r2 = appendPieceCopies(blind, [{
      id: 'arc2', mesh: '1kerb01', part: target,
      t: {
        p: [0, 0, arc], r: [0, 0, 0], s: [1, 1, 1],
        ribbon: { length: 1, width: 1, height: 1 },
      },
    }]);
    check('with no centre line it refuses instead of guessing',
      r2.added === 0 && r2.skipped.length === 1);
    check('and leaves the model as it found it',
      sameBytes(new Uint8Array(readFileSync(path)), writeKn5(blind)) === null);
  }

  console.log('\nmoving several pieces as a group');
  {
    /*
     * A car is four or five meshes and a row of barriers is a dozen pieces.
     * Moving those together means one shared pivot: turning the group has to
     * SWING the members round it, not spin each of them where it stands.
     */
    const path = join(hock, 'vhe_hockenheim.kn5');
    const original = new Uint8Array(readFileSync(path));
    const before = readKn5(original);
    const kerb = collectMeshes(before.root).find((m) => m.name === '1kerb01');
    const partition = partitionMesh(kerb);
    const big = partition.parts
      .map((p, i) => ({ i, n: p.triangles.length }))
      .filter((x) => x.n >= 20)
      .slice(0, 2);

    const centreOf = (file, part) => {
      const m = collectMeshes(file.root).find((x) => x.name === '1kerb01');
      const d = decodeMesh(m);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const v of partition.parts[part].vertices) {
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], d.positions[v * 3 + k]);
          hi[k] = Math.max(hi[k], d.positions[v * 3 + k]);
        }
      }
      return lo.map((v, k) => (v + hi[k]) / 2);
    };

    const c0 = centreOf(before, big[0].i);
    const c1 = centreOf(before, big[1].i);
    const pivot = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2, (c0[2] + c1[2]) / 2];

    // Turn the pair a quarter turn about their shared middle.
    const turned = readKn5(new Uint8Array(readFileSync(path)));
    const t = { p: [0, 0, 0], r: [0, 90, 0], s: [1, 1, 1], about: pivot };
    transformMeshes(turned, {
      [`1kerb01#${big[0].i}`]: t,
      [`1kerb01#${big[1].i}`]: t,
    });
    const after = readKn5(writeKn5(turned));
    const a0 = centreOf(after, big[0].i);
    const a1 = centreOf(after, big[1].i);

    // Each member's distance to the pivot is unchanged...
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
    check('a group turn keeps every member the same distance from the pivot',
      Math.abs(dist(a0, pivot) - dist(c0, pivot)) < 0.02
      && Math.abs(dist(a1, pivot) - dist(c1, pivot)) < 0.02,
      `${dist(c0, pivot).toFixed(2)}->${dist(a0, pivot).toFixed(2)}, `
      + `${dist(c1, pivot).toFixed(2)}->${dist(a1, pivot).toFixed(2)}`);

    // ...and they actually swung, rather than spinning on the spot.
    check('and swings them round it rather than spinning them in place',
      dist(a0, c0) > 1 && dist(a1, c1) > 1,
      `moved ${dist(a0, c0).toFixed(1)} m and ${dist(a1, c1).toFixed(1)} m`);

    check('the pair keep their distance from each other',
      Math.abs(dist(a0, a1) - dist(c0, c1)) < 0.05,
      `${dist(c0, c1).toFixed(2)} -> ${dist(a0, a1).toFixed(2)}`);

    // A shared MOVE is the simple case and must still be exact.
    const shifted = readKn5(new Uint8Array(readFileSync(path)));
    const move = { p: [4, 0, 0], r: [0, 0, 0], s: [1, 1, 1], about: pivot };
    transformMeshes(shifted, {
      [`1kerb01#${big[0].i}`]: move,
      [`1kerb01#${big[1].i}`]: move,
    });
    const moved = readKn5(writeKn5(shifted));
    check('a group move shifts every member by exactly the same amount',
      Math.abs(centreOf(moved, big[0].i)[0] - c0[0] - 4) < 1e-3
      && Math.abs(centreOf(moved, big[1].i)[0] - c1[0] - 4) < 1e-3);
  }

  console.log('\nmoving a mesh that hangs under a moved parent');
  {
    // The interesting case: a mesh whose vertices are in its own space, under
    // a dummy that puts it somewhere else. The move is asked for in WORLD
    // space and has to end up right anyway.
    const path = join(hock, 'obj_box.kn5');
    const file = readKn5(new Uint8Array(readFileSync(path)));
    const meshes = collectMeshes(file.root);
    const target = meshes[0].name;

    const worldCentre = (f, name) => worldBox(f, name).centre;

    const c0 = worldCentre(file, target);
    const parented = collectDummies(file.root).some((d) =>
      d.children.some((c) => c.name === target) && (d.matrix[12] !== 0 || d.matrix[14] !== 0));
    check('the test mesh really does hang under a moved parent', parented);

    const moved = readKn5(new Uint8Array(readFileSync(path)));
    transformMeshes(moved, { [target]: { p: [10, 0, -7], r: [0, 0, 0], s: [1, 1, 1] } });
    const c1 = worldCentre(readKn5(writeKn5(moved)), target);
    check('it lands where asked in WORLD space',
      Math.abs(c1[0] - c0[0] - 10) < 1e-3 && Math.abs(c1[2] - c0[2] + 7) < 1e-3,
      `${(c1[0] - c0[0]).toFixed(3)}, ${(c1[2] - c0[2]).toFixed(3)}`);
  }

  console.log('\nrenaming a mesh changes its physics surface');
  {
    const path = join(hock, 'obj_groove.kn5');
    const file = readKn5(new Uint8Array(readFileSync(path)));
    const first = collectMeshes(file.root)[0].name;
    patchMeshes(file, { hidden: new Set(), renamed: new Map([[first, '1ROAD_renamed_test']]) });
    const out = writeKn5(file);
    const names = collectMeshes(readKn5(out).root).map((m) => m.name);
    check('the new name is in the file', names.includes('1ROAD_renamed_test'));
    check('the old one is not', !names.includes(first));
  }

  console.log('\nthe recovered centre line');
  {
    for (const layout of ['gp', 'national', 'shorta']) {
      const ai = join(hock, layout, 'ai', 'fast_lane.ai');
      if (!existsSync(ai)) continue;
      const lane = readAiLane(new Uint8Array(readFileSync(ai)));
      const rec = recoverPathFromLane(lane);
      check(`${layout}: closes into a circuit`, rec.path.closed && laneIsClosed(lane));
      check(`${layout}: lands on the recorded line`, rec.deviation.max < 1.0,
        `max ${rec.deviation.max.toFixed(2)} m`);
      check(`${layout}: has a sane width`, (() => {
        const w = rec.path.nodes.map((n) => n.widthL + n.widthR);
        const avg = w.reduce((a, x) => a + x, 0) / w.length;
        return avg > 8 && avg < 20;
      })());
      check(`${layout}: banking stays believable`, (() => {
        const b = rec.path.nodes.map((n) => Math.abs(n.bank));
        return Math.max(...b) < 20;
      })());
    }
  }

  console.log('\noutlier normals do not tip the road over');
  {
    const suspects = [
      ['sx_lemans', 'nochicaneperf'],
      ['rt_suzuka', 'layout_f1_2025'],
      ['lilski_road_america', 'moto'],
    ];
    let checked = 0;
    for (const [track, layout] of suspects) {
      const ai = join(root, 'content', 'tracks', track, layout, 'ai', 'fast_lane.ai');
      if (!existsSync(ai)) continue;
      checked += 1;
      const lane = readAiLane(new Uint8Array(readFileSync(ai)));
      const raw = [...laneBanks(lane)].map(Math.abs);
      const rec = recoverPathFromLane(lane);
      const kept = rec.path.nodes.map((n) => Math.abs(n.bank));
      check(`${track}: the raw file really does have a bad normal`, Math.max(...raw) > 25,
        `${Math.max(...raw).toFixed(1)}`);
      check(`${track}: it does not reach the control points`, Math.max(...kept) < 25,
        `${Math.max(...kept).toFixed(1)}`);
    }
    if (checked === 0) console.log('  (none of the known outlier tracks are installed)');
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
