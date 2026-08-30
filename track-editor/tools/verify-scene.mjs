/**
 * Headless checks on the geometry pipeline.
 *
 *   node tools/verify-scene.mjs
 *
 * Runs the exact same core/ code the viewport and the exporter use, on the
 * default project, and asserts the things that decide whether the track works
 * in Assetto Corsa: mesh naming, the terrain meeting the tarmac, the grid and
 * pit markers facing the right way, and the timing gates spanning the road.
 */

import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { defaultProject, emptyProject, generatedProject, useEditor } from '../src/store/store.ts';
import { generateCircuit, PIT_OFFSET } from '../src/core/generate.ts';
import { computeFrames, pathLength, frameAtFraction, segmentStartId, samplesFor } from '../src/core/spline.ts';
import {
  buildRoadMeshes,
  buildPitMeshes,
  sideProfile,
  computeEdges,
  barrierHandles,
  barrierHandleHeight,
  EDGE_SINK,
  runoffBankRise,
  shoulderDrop,
  RUNOFF_BANK_RUN,
  kerbHandles,
  kerbLayout,
  KERB_HANDLE_HEIGHT,
} from '../src/core/road.ts';
import {
  makeKerbSpan,
  insertKerbSpan,
  eraseKerbRange,
  kerbsFromNodeFlags,
  fullLapKerbs,
  moveKerbSpan,
  spanCovers,
  spanMetres,
  distAtT,
  tAtDist,
} from '../src/core/kerbs.ts';
import { serializeProject, deserializeProject } from '../src/io/project.ts';
import {
  planDraw,
  DRAW_MODES,
  FREEHAND_SPACING,
  DEFAULT_DRAW_CFG,
  applyDrawHeight,
  drawHeightOf,
  drawWidths,
} from '../src/core/draw.ts';
import { attachPitLane, mergePitFrames, pitLaneSide, nodesAlongPitLane } from '../src/core/pitLink.ts';
import { PointIndex } from '../src/core/spatial.ts';
import { getDerived } from '../src/store/derived.ts';
import { alignmentAt, alignPlacementToPath, clearPlantsOffTrack } from '../src/store/placement.ts';
import {
  sectionIndices,
  applyToSection,
  translateSection,
  raiseSection,
  rampSection,
  straightenSection,
  subdivideSection,
  deleteSectionInterior,
} from '../src/core/section.ts';
import {
  applyBrush,
  blendRoadIntoTerrain,
  buildCorridorMask,
  buildTerrainGeometry,
  cellSize,
  createPaint,
  GROUND_KINDS,
  makeTerrainRaycast,
  paintCellSize,
  createPaintEdge,
  paintGroundDisc,
  paintGroundPolygon,
  paintGroundRect,
  paintValue,
  paintRes,
  sampleGround,
  sampleGroundValue,
  sampleHeights,
  roadCorridor,
  pitCorridor,
  resampleTerrain,
  splitByGroups,
  terrainMesh,
  updateTerrainGeometry,
} from '../src/core/terrain.ts';
import { buildAllMarkers, buildAiLine, buildGridMarkers } from '../src/core/markers.ts';
import { buildGridBoxes, F1_GRID_BOX } from '../src/core/gridBoxes.ts';
import { LIBRARY, LIBRARY_BY_KEY, propFootprint, propTileBox, propParts, PAD_SIZE } from '../src/core/library.ts';
import { ALPHA_TESTED, SIGN_DISTANCES, TREE_CARDS } from '../src/core/textures.ts';
import { layBarrierRun, runLength } from '../src/core/barrierRun.ts';
import {
  findCorners,
  planBrakeMarkers,
  brakeMarkerKind,
  BRAKE_MARKER_KINDS,
  DEFAULT_BRAKE_CFG,
} from '../src/core/brakeMarkers.ts';
import {
  tileRuleOf, nearestFlush, resolvePlacement, tileBoxOf, clearanceAt,
  UNIT_SCALE, padScale, alignedHeading, pathHeadingAt, snapCornerToPads, rectFromDrag,
} from '../src/core/propSnap.ts';
import { PREFABS, PREFABS_BY_KEY, instantiatePrefab, prefabOf } from '../src/core/prefabs.ts';
import { propMeshes, physicsNameFor, trimToDrawRange } from '../src/export/buildExport.ts';
import { surfacesIni } from '../src/export/ini.ts';
import { propMatrix } from '../src/core/props.ts';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

const p = defaultProject();

/*
 * A fresh track carries no barrier at all â€” they are placed by hand with the
 * Barrier tool. Everything below tests what a barrier does once it is there,
 * so this run puts one all the way round first.
 */
check(
  'a new track starts without any barrier',
  defaultProject().track.nodes.every((n) => !n.wallL && !n.wallR),
);
for (const n of p.track.nodes) {
  n.wallL = true;
  n.wallR = true;
}

/*
 * The same goes for kerbs and for the camber on the shoulder: a fresh project
 * has neither, because kerbs belong where the drivers cut and a run off that
 * falls away puts the barrier in a trench. Everything below tests what they do
 * once they are asked for, so this run puts a lap of kerb down and dials the
 * drop back in.
 */
check('a new track starts without any kerb', defaultProject().road.kerbs.length === 0);
check('and with its shoulder level with the tarmac', defaultProject().road.runoffDrop === 0);
p.road.kerbs = fullLapKerbs({ kerbWidth: p.road.kerbWidth, kerbHeight: p.road.kerbHeight });
p.road.runoffDrop = 0.35;

/* Give the track some elevation and banking so the hard cases get exercised. */
p.track.nodes[3].p[1] = 18;
p.track.nodes[4].p[1] = 22;
p.track.nodes[5].p[1] = 9;
p.track.nodes[4].bank = 12;
p.track.nodes[7].widthL = 11;
p.track.nodes[7].widthR = 4;
p.track.nodes[9].kerbL = false;
p.track.nodes[9].kerbR = false;
p.track.nodes[2].aiOffset = -3.5;

const frames = computeFrames(p.track, p.road.samplesPerSegment);
const pitFrames = computeFrames(p.pit, p.road.samplesPerSegment);
const length = pathLength(frames, true);

console.log('\nSpline and road');
// Ask how dense the path actually came out: samplesPerSegment is a floor,
// not the answer, because a plate of road may never exceed MAX_PLATE.
const spp = samplesFor(p.track, p.road.samplesPerSegment);
check('frames generated', frames.length === p.track.nodes.length * spp, `got ${frames.length}, ${spp}/segment`);
check('lap length is plausible', length > 800 && length < 2500, `${length.toFixed(1)} m`);
check(
  'frames are orthonormal everywhere',
  frames.every(
    (f) =>
      Math.abs(f.fwd.length() - 1) < 1e-6 &&
      Math.abs(f.up.length() - 1) < 1e-6 &&
      Math.abs(f.right.length() - 1) < 1e-6 &&
      Math.abs(f.fwd.dot(f.up)) < 1e-6 &&
      Math.abs(f.fwd.dot(f.right)) < 1e-6,
  ),
);
check(
  'the closed loop frame does not flip at the seam',
  frames[0].up.dot(frames[frames.length - 1].up) > 0.9,
  `dot ${frames[0].up.dot(frames[frames.length - 1].up).toFixed(3)}`,
);
{
  const banked = frames[4 * spp];
  check(
    'banking tilts the surface by exactly the angle asked for',
    Math.abs(banked.right.y - Math.sin(THREE.MathUtils.degToRad(12))) < 0.01,
    `right.y ${banked.right.y.toFixed(4)}, expected ${Math.sin(THREE.MathUtils.degToRad(12)).toFixed(4)}`,
  );
  // The whole point of the road frame: hills must not roll the road.
  const flat = computeFrames({ ...p.track, nodes: p.track.nodes.map((n) => ({ ...n, bank: 0 })) }, p.road.samplesPerSegment);
  check(
    'elevation changes never roll an unbanked road',
    flat.every((f) => Math.abs(f.right.y) < 1e-9),
    `max ${Math.max(...flat.map((f) => Math.abs(f.right.y))).toExponential(2)}`,
  );
}
check('per node width is interpolated', Math.abs(frames[7 * spp].widthL - 11) < 0.6);

const road = buildRoadMeshes(frames, true, p.road, pitFrames);
const pit = buildPitMeshes(pitFrames, false, p.road);
const names = road.map((m) => m.name);

console.log('\nMesh naming for Assetto Corsa');
check('road surface exists', names.includes('1ROAD_track'), names.join(','));
check('kerbs exist', names.some((n) => n.startsWith('1KERB_')), names.join(','));
check('run off exists', names.some((n) => n.startsWith('1GRASS_runoff')), names.join(','));
check(
  'walls exist',
  names.some((n) => n.startsWith('1WALL_left')) && names.some((n) => n.startsWith('1WALL_right')),
  names.join(','),
);
check('pit lane is tagged PIT', pit.some((m) => m.name === '1PIT_lane'));
check(
  'every physical mesh name starts with digit + surface key',
  [...road, ...pit].every((m) => !m.surface || new RegExp(`^\\d${m.surface}_`).test(m.name)),
  [...road, ...pit].map((m) => `${m.name}/${m.surface}`).join(' '),
);
check(
  'kerbs are skipped where turned off',
  road.filter((m) => m.name.startsWith('1KERB_left')).length >= 1 &&
    road.filter((m) => m.name.startsWith('1KERB_')).length >= 2,
  names.filter((n) => n.startsWith('1KERB')).join(','),
);

/* ------------------------------------------------------------------ */
/* Barrier style                                                       */
/* ------------------------------------------------------------------ */

/*
 * The barrier used to be one thing: a vertical slab of the given height. A
 * modern circuit has a catch fence instead -- solid base, mesh above it, and
 * the top angled BACK OVER the track so anything thrown at it drops inside.
 * The direction of that lean is the part worth a test: got backwards, a fence
 * tips debris towards the crowd, and it looks near enough right from the car
 * that nobody would notice.
 */
console.log('\nBarrier style');
{
  /** Lateral offset of a vertex from the centre line, positive = right. */
  const lateral = (frame, x, z) => (x - frame.pos.x) * frame.right.x + (z - frame.pos.z) * frame.right.z;

  /** Highest and lowest vertex of a mesh, with how far out each stands. */
  const span = (mesh, frame) => {
    const pos = mesh.geometry.getAttribute('position');
    let lo = { y: Infinity, lat: 0 };
    let hi = { y: -Infinity, lat: 0 };
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const lat = lateral(frame, pos.getX(i), pos.getZ(i));
      if (y < lo.y) lo = { y, lat };
      if (y > hi.y) hi = { y, lat };
    }
    return { lo, hi };
  };

  const walled = defaultProject();
  for (const n of walled.track.nodes) { n.wallL = true; n.wallR = true; }
  const wf = computeFrames(walled.track, walled.road.samplesPerSegment);

  const asWall = buildRoadMeshes(wf, true, { ...walled.road, wallStyle: 'wall', wallHeight: 1.1 }, []);
  const asFence = buildRoadMeshes(wf, true, { ...walled.road, wallStyle: 'fence', wallHeight: 3.6 }, []);

  const wallParts = asWall.filter((m) => m.name.startsWith('1WALL_'));
  const fenceParts = asFence.filter((m) => m.name.startsWith('1WALL_'));
  // Two runs a side, not one: the barrier you can see, and the length standing
  // back behind the access gates so an opening is a slot rather than a hole.
  check('a plain wall is one run a side, its painted gate tips, and the run behind its gates',
    wallParts.length === 6
      && wallParts.some((m) => m.name === '1WALL_left')
      && wallParts.some((m) => m.name === '1WALL_left_gate')
      && wallParts.some((m) => m.name === '1WALL_left_mark'),
    wallParts.map((m) => m.name).join(','));
  check('a catch fence is base, mesh and leaning top, both runs',
    fenceParts.length === 14
      && fenceParts.some((m) => m.name === '1WALL_left_mesh')
      && fenceParts.some((m) => m.name === '1WALL_left_lean')
      && fenceParts.some((m) => m.name === '1WALL_left_gate_mesh'),
    fenceParts.map((m) => m.name).join(','));
  /* The cut end of the run at each opening -- the free end you drive in past,
     not the forward side where the rear piece merges back in -- is the same
     steel in orange paint: the way in has to be findable against a kilometre
     of grey rail. */
  check('the gate tips are painted orange, on both styles',
    wallParts.filter((m) => m.name.endsWith('_mark')).length === 2
      && wallParts.concat(fenceParts)
        .filter((m) => m.name.endsWith('_mark'))
        .every((m) => m.material === 'guardrail_orange'),
    wallParts.concat(fenceParts).filter((m) => m.name.endsWith('_mark')).map((m) => `${m.name}/${m.material}`).join(' '));
  check('and every part of it is still solid to a car',
    fenceParts.every((m) => m.surface === 'WALL' && /^\dWALL_/.test(m.name)),
    fenceParts.map((m) => `${m.name}/${m.surface}`).join(' '));

  /*
   * See-through, or it is a wall with a lean on it. The fencing has to be on
   * the one material whose texture has holes, and the solid base must NOT be:
   * a catch fence you can see the bottom metre through is a catch fence with a
   * gap under it.
   */
  {
    const mesh = fenceParts.filter((m) => /_mesh$|_lean$/.test(m.name));
    const solidBase = fenceParts.filter((m) => !/_mesh$|_lean$/.test(m.name));
    check('the fencing is on the alpha tested material',
      mesh.length === 8 && mesh.every((m) => m.material === 'chainlink'),
      mesh.map((m) => `${m.name}/${m.material}`).join(' '));
    check('and it is one AC will actually look through',
      mesh.every((m) => ALPHA_TESTED.has(m.material)));
    // Grey steel or the orange painted gate tips: both solid, neither has holes.
    const STEEL = new Set(['guardrail', 'guardrail_orange']);
    check('while the solid base stays solid',
      solidBase.every((m) => STEEL.has(m.material) && !ALPHA_TESTED.has(m.material)),
      solidBase.map((m) => `${m.name}/${m.material}`).join(' '));
    check('and a plain barrier is the same armco without the fencing',
      wallParts.every((m) => STEEL.has(m.material)),
      wallParts.map((m) => `${m.name}/${m.material}`).join(' '));
    check('nothing else on the track is see-through',
      asFence.filter((m) => ALPHA_TESTED.has(m.material)).length === mesh.length,
      asFence.filter((m) => ALPHA_TESTED.has(m.material)).map((m) => m.name).join(','));
    check('and a plain wall asks for no alpha at all',
      asWall.every((m) => !ALPHA_TESTED.has(m.material)));

    /* The hand placed fence has to be the same fence, or a run of modules next
       to the generated barrier reads as two different products. */
    const propMats = new Set(propParts('fence').map((p) => p.material));
    check('the fence object uses the same chain link',
      propMats.has('chainlink'), [...propMats].join(','));
    check('and so does the boundary fence',
      propParts('fence_mesh').some((p) => p.material === 'chainlink'));
    check('but a concrete barrier is still concrete',
      propParts('concrete_barrier').every((p) => !ALPHA_TESTED.has(p.material)));
  }

  // The frame the measurements are taken against: index 0 of the expanded run.
  const f0 = wf[0];
  for (const side of ['left', 'right']) {
    const inward = side === 'left' ? 1 : -1;
    const base = fenceParts.find((m) => m.name === `1WALL_${side}`);
    const mesh = fenceParts.find((m) => m.name === `1WALL_${side}_mesh`);
    const lean = fenceParts.find((m) => m.name === `1WALL_${side}_lean`);
    const b = span(base, f0);
    const m = span(mesh, f0);
    const l = span(lean, f0);

    check(`the ${side} fence keeps a solid metre at the bottom`,
      Math.abs(b.hi.y - b.lo.y - 1.0) < 1e-6, `${(b.hi.y - b.lo.y).toFixed(3)} m`);
    check(`the ${side} mesh carries on from the top of it`,
      Math.abs(m.lo.y - b.hi.y) < 1e-6 && Math.abs(m.hi.y - b.lo.y - 3.6) < 1e-6,
      `${m.lo.y.toFixed(2)}..${m.hi.y.toFixed(2)} against a base ending at ${b.hi.y.toFixed(2)}`);
    // The one that matters: the top has to end up nearer the centre line than
    // the foot, on BOTH sides. Same sign of `right`, opposite sign of inward.
    check(`and the ${side} top leans back over the track, not away from it`,
      (l.hi.lat - l.lo.lat) * inward > 0.5,
      `foot at ${l.lo.lat.toFixed(2)} m, tip at ${l.hi.lat.toFixed(2)} m from the centre line`);
    check(`the ${side} fence stands taller than the wall it replaces`,
      l.hi.y > 4.5, `${l.hi.y.toFixed(2)} m`);
  }

  /*
   * The base is armco, not a slab of concrete with a fence on it: W section
   * beams stacked, each standing proud of the post line TOWARDS the track, the
   * way they hang off the front of their posts. Measured at one cross section,
   * because every cross section is the same fold.
   */
  const armco = (mesh, side) => {
    const inward = side === 'left' ? 1 : -1;
    const pos = mesh.geometry.getAttribute('position');
    const cut = [];
    for (let i = 0; i < pos.count; i++) {
      // In frame 0's plane AND near it: a closed lap comes back through the
      // same plane on the far side, and the far side is 300 m away.
      const dx = pos.getX(i) - f0.pos.x;
      const dz = pos.getZ(i) - f0.pos.z;
      if (Math.abs(dx * f0.fwd.x + dz * f0.fwd.z) > 0.05) continue;
      if (Math.hypot(dx, dz) > 60) continue;
      cut.push({ y: pos.getY(i), lat: lateral(f0, pos.getX(i), pos.getZ(i)) });
    }
    const foot = cut.reduce((a, b) => (b.y < a.y ? b : a));
    const prof = cut
      .map((p) => ({ h: p.y - foot.y, out: (p.lat - foot.lat) * inward }))
      .sort((a, b) => a.h - b.h);
    let rails = 0;
    let on = false;
    for (const p of prof) {
      if (!on && p.out > 0.05) { rails += 1; on = true; }
      else if (on && p.out < 0.01) on = false;
    }
    return {
      rails,
      proud: Math.max(...prof.map((p) => p.out)),
      ends: Math.max(Math.abs(prof[0].out), Math.abs(prof[prof.length - 1].out)),
      height: prof[prof.length - 1].h,
    };
  };

  for (const side of ['left', 'right']) {
    const a = armco(fenceParts.find((m) => m.name === `1WALL_${side}`), side);
    check(`the ${side} fence stands on three stacked beams`, a.rails === 3, `${a.rails}`);
    check(`and they stand out towards the track, not away from it`,
      a.proud > 0.05 && a.proud < 0.15, `${a.proud.toFixed(3)} m proud of the post line`);
    check(`while the foot and the top of it sit on the post line`,
      a.ends < 1e-6, `${a.ends.toFixed(4)} m out`);
  }

  /*
   * The plain style is the same barrier without the fencing, and the stack
   * follows the height rather than always being three: a 40 cm barrier is one
   * beam, not three squashed ones.
   */
  {
    const plain = armco(wallParts.find((m) => m.name === '1WALL_left'), 'left');
    check('the plain style is the same armco, stacked to its own height',
      plain.rails === 3 && plain.proud > 0.05 && Math.abs(plain.height - 1.1) < 1e-6,
      `${plain.rails} beams over ${plain.height.toFixed(2)} m`);
    const kerbHigh = buildRoadMeshes(wf, true, { ...walled.road, wallStyle: 'wall', wallHeight: 0.4 }, [])
      .find((m) => m.name === '1WALL_left');
    check('and a knee high one is a single beam', armco(kerbHigh, 'left').rails === 1,
      `${armco(kerbHigh, 'left').rails}`);
  }

  /* Switching style must not move the barrier off the line it was painted on. */
  {
    const w = span(wallParts.find((m) => m.name === '1WALL_left'), f0);
    const b = span(fenceParts.find((m) => m.name === '1WALL_left'), f0);
    check('changing the style leaves the barrier standing where it stood',
      Math.abs(w.lo.lat - b.lo.lat) < 1e-9 && Math.abs(w.lo.y - b.lo.y) < 1e-9,
      `${w.lo.lat.toFixed(4)} vs ${b.lo.lat.toFixed(4)} m`);
  }

  /* Wound low, a catch fence is just the base -- not a base plus two slivers. */
  {
    const low = buildRoadMeshes(wf, true, { ...walled.road, wallStyle: 'fence', wallHeight: 0.9 }, [])
      .filter((m) => m.name.startsWith('1WALL_'));
    check('a catch fence wound right down is only its base', low.length === 6,
      low.map((m) => m.name).join(','));
  }

  /* ---------------------------------------------------------------- */
  /* What the barrier carries: access gates and marshalling panels     */
  /* ---------------------------------------------------------------- */
  /*
   * A gate is an opening a car can be pushed out through, and the whole trick
   * is that it is NOT a hole: the run in front stops, and a second length of
   * the same barrier stands close behind, reaching well past the opening's
   * rear edge and SEALING against the run at its forward edge. The slot
   * opens backwards only -- one way through on foot, no way through for a
   * car in either direction.
   */
  {
    const front = asWall.find((m) => m.name === '1WALL_left');
    const gate = asWall.find((m) => m.name === '1WALL_left_gate');
    const f0 = wf[0];
    const outward = (mesh) => {
      const pos = mesh.geometry.getAttribute('position');
      let sum = 0;
      for (let i = 0; i < pos.count; i++) sum += lateral(f0, pos.getX(i), pos.getZ(i));
      return sum / pos.count;
    };
    check('there is a length of barrier behind the openings', !!gate);
    // On the left, out from the circuit is the negative lateral direction.
    check('and it stands further out than the barrier in front of it',
      outward(gate) < outward(front) - 1,
      `${outward(gate).toFixed(2)} vs ${outward(front).toFixed(2)} m`);

    /*
     * The opening itself, measured in metres of barrier at three sampling
     * settings.
     *
     * Three, because the sampling is exactly what this must not depend on. An
     * opening is five metres of circuit; the cross sections are wherever the
     * author's plate length put them, and the two either side of a gate are
     * slid onto its edges so the answer comes out the same whether the plates
     * are five metres long or thirty. Rounded to the nearest section instead
     * -- which is what it used to do -- the same gate is 5 m on one setting
     * and 18 m on another.
     *
     * The numbers come out a little over five because a barrier on the OUTSIDE
     * of a bend is longer than the centre line it is measured against.
     */
    for (const spp of [3, 8, 20]) {
      const gf = computeFrames(walled.track, spp);
      const gm = buildRoadMeshes(gf, true, { ...walled.road, wallStyle: 'wall', wallHeight: 1.1 }, []);
      const lap = gf[gf.length - 1].dist;
      /** Where a point sits in the lap: nearest cross section, then projected. */
      const arcOf = (x, z) => {
        let best = gf[0];
        let bd = Infinity;
        for (const f of gf) {
          const d = (f.pos.x - x) ** 2 + (f.pos.z - z) ** 2;
          if (d < bd) { bd = d; best = f; }
        }
        return best.dist + (x - best.pos.x) * best.fwd.x + (z - best.pos.z) * best.fwd.z;
      };
      /* Several meshes pooled as one barrier: the plain run and its painted
         orange tips are separate draws of the SAME run, so measuring either
         alone reads the paint seam as an opening that is not there. */
      const points = (names) => {
        const out = [];
        const tris = [];
        for (const name of [].concat(names)) {
          const mesh = gm.find((m) => m.name === name);
          if (!mesh) continue;
          const off = out.length;
          const pos = mesh.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            out.push({ x: pos.getX(i), z: pos.getZ(i), at: arcOf(pos.getX(i), pos.getZ(i)) });
          }
          const idx = mesh.geometry.getIndex();
          for (let t = 0; t + 2 < idx.count; t += 3) {
            tris.push([idx.getX(t) + off, idx.getX(t + 1) + off, idx.getX(t + 2) + off]);
          }
        }
        return { out, tris };
      };
      /*
       * Where a run is really interrupted, read off the TRIANGLES.
       *
       * Two neighbouring stations that no triangle spans are the two sides of
       * an opening; two that a triangle does span are a plate, however long
       * the sampling stretched it. Going by vertex positions instead -- which
       * is what this check did at first -- reads the stretched plate BESIDE a
       * gate as the gate, and then happily passes while the barrier behind the
       * opening sits in the wrong place entirely.
       */
      const gaps = (names) => {
        const { out, tris } = points(names);
        /* Clustered: on a coarse sampling the projection of the two edges of
           one opening can land centimetres apart, and two stations that close
           leave one of them an orphan no triangle can ever join -- which reads
           as extra openings that do not exist on the ground. */
        const raw = [...new Set(out.map((q) => Math.round(q.at * 20) / 20))].sort((u, w) => u - w);
        const stations = [];
        for (const s of raw) {
          if (stations.length === 0 || s - stations[stations.length - 1] > 0.15) stations.push(s);
        }
        const slot = (a) => stations.findIndex((s) => Math.abs(s - a) < 0.16);
        const joined = new Set();
        for (const tri of tris) {
          const k = tri.map((v) => slot(out[v].at));
          for (const u of k) for (const w of k) if (w === u + 1) joined.add(u);
        }
        const found = [];
        for (let i = 0; i + 1 < stations.length; i++) {
          if (!joined.has(i)) found.push([stations[i], stations[i + 1]]);
        }
        return { found, out };
      };
      const { found, out: inFront } = gaps(['1WALL_left', '1WALL_left_mark']);
      const behind = points('1WALL_left_gate').out;
      const [gapLo, gapHi] = found[0];
      // What the opening measures on the ground, which is what you see.
      // Both vertices bounded to the gap's own neighbourhood: unbounded
      // windows let a pair from the far side of the lap seam -- six metres
      // apart on a perfectly continuous run -- masquerade as the opening.
      let opening = Infinity;
      for (const b of inFront) for (const a of inFront) {
        if (b.at > gapLo + 0.3 || b.at < gapLo - 15) continue;
        if (a.at < gapHi - 0.3 || a.at > gapHi + 15) continue;
        opening = Math.min(opening, Math.hypot(a.x - b.x, a.z - b.z));
      }
      const cover = behind.filter((q) => q.at > gapLo - 30 && q.at < gapHi + 30).map((q) => q.at);
      const rear = gapLo - Math.min(...cover);
      const forward = Math.max(...cover) - gapHi;
      const plate = lap / (gf.length - 1);
      check(`there is one opening per gate at ${plate.toFixed(0)} m a plate`,
        found.length === Math.floor(lap / 400) + (lap % 400 >= 200 ? 1 : 0),
        `${found.length} openings over ${lap.toFixed(0)} m`);
      check('and it is ten metres of barrier, room to walk a car through',
        opening > 9 && opening < 12.5, `${opening.toFixed(2)} m`);
      check('and the barrier behind it reaches past the rear edge',
        rear > 3 && rear < 6.5, `${rear.toFixed(2)} m past it`);
      check('and seals against the run at the forward edge: the slot opens backwards only',
        forward > -1 && forward < 0.8, `${forward.toFixed(2)} m past it`);
    }

    /* A lap too short to hold a gate gets none, and no second run either. */
    {
      const stub = defaultProject();
      for (const node of stub.track.nodes) {
        node.wallL = true;
        node.wallR = true;
        node.p = [node.p[0] * 0.1, node.p[1], node.p[2] * 0.1];
      }
      const sf = computeFrames(stub.track, stub.road.samplesPerSegment);
      const stubMeshes = buildRoadMeshes(sf, true, { ...stub.road, wallStyle: 'wall', wallHeight: 1.1 }, []);
      check('a lap too short for a gate gets none',
        sf[sf.length - 1].dist < 200 && !stubMeshes.some((m) => m.name.endsWith('_gate')),
        `${sf[sf.length - 1].dist.toFixed(0)} m: ${stubMeshes.map((m) => m.name).join(',')}`);
    }

    const panels = asWall.filter((m) => m.name.startsWith('1OBJ_flagpanel'));
    const screens = panels.filter((m) => !m.name.endsWith('_case'));
    check('the barrier carries marshalling panels', screens.length === 2,
      panels.map((m) => m.name).join(','));
    check('and their screens are on the material the game colours',
      screens.every((m) => m.material === 'led_flag'),
      screens.map((m) => `${m.name}/${m.material}`).join(' '));
    check('and nothing about them is solid to a car',
      panels.every((m) => m.surface === null),
      panels.map((m) => `${m.name}/${m.surface}`).join(' '));
    // A lap of the demo circuit at 250 m a panel, both sides staggered. Two
    // boxes per panel, twelve triangles each.
    {
      const lap = wf[wf.length - 1].dist;
      const expected = Math.floor(lap / 250) + Math.floor((lap - 125) / 250) + 2;
      const faces = screens.reduce((sum, m) => sum + m.geometry.getIndex().count / 3, 0);
      check('roughly one panel every 250 m, alternating sides',
        Math.abs(faces / 12 - expected) <= 2,
        `${faces / 12} panels, expected about ${expected} over ${lap.toFixed(0)} m`);
    }
  }

  /*
   * The road is built into preallocated buffers and published with a draw
   * range; the spare indices are zeroed, which is a degenerate triangle rather
   * than nothing. Every exporter read the whole buffer, so those went into the
   * kn5 and into the triangle count in the README.
   */
  {
    // A barrier down only part of the circuit, which is the normal case and
    // the one that leaves spare index behind.
    const half = defaultProject();
    half.track.nodes.forEach((n, i) => { n.wallL = i < half.track.nodes.length / 2; n.wallR = false; });
    const hf = computeFrames(half.track, half.road.samplesPerSegment);
    const partial = buildRoadMeshes(hf, true, half.road, [])
      .find((m) => m.name === '1WALL_left');
    // The precondition: this really is a mesh that draws less than it holds.
    const held = partial.geometry.getIndex().count;
    const shown = partial.geometry.drawRange.count;
    check('a partly painted barrier holds more index than it draws',
      shown < held, `draws ${shown} of ${held}`);

    const zeroed = (geo, upTo) => {
      const idx = geo.getIndex();
      let n = 0;
      for (let i = 0; i + 2 < upTo; i += 3) {
        if (idx.getX(i) === idx.getX(i + 1) && idx.getX(i + 1) === idx.getX(i + 2)) n += 1;
      }
      return n;
    };
    check('and reading it whole picks up degenerate triangles',
      zeroed(partial.geometry, held) > 100, `${zeroed(partial.geometry, held)} of them`);

    const trimmed = trimToDrawRange(partial.geometry);
    check('trimming leaves exactly what was drawn',
      trimmed.getIndex().count === shown, `${trimmed.getIndex().count} vs ${shown}`);
    check('with no degenerate triangle left in it',
      zeroed(trimmed, trimmed.getIndex().count) === 0);

    const verts = trimmed.getAttribute('position').count;
    let maxIdx = -1;
    for (let i = 0; i < trimmed.getIndex().count; i++) maxIdx = Math.max(maxIdx, trimmed.getIndex().getX(i));
    check('every index still points at a vertex it has', maxIdx < verts, `${maxIdx} of ${verts}`);
    check('and the spare vertices went with them', verts === maxIdx + 1,
      `${verts} kept, highest index ${maxIdx}`);

    // The geometry it came from is cached and reused between frames.
    check('the original is handed back untouched',
      partial.geometry.getIndex().count === held && trimmed !== partial.geometry);
    // A mesh with nothing to trim must not be copied for nothing.
    const whole = new THREE.BufferGeometry();
    whole.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    whole.setIndex([0, 1, 2]);
    check('and a mesh with no draw range is passed straight through',
      trimToDrawRange(whole) === whole);
  }

  /*
   * The handle must not hide the thing it edits.
   *
   * Built at the full barrier height, and drawn with the depth test off so it
   * can be found behind scenery, a handle for a 3.6 m catch fence paints itself
   * straight over the fence. Switching the style then looks like it did
   * nothing at all -- which is exactly how it was reported.
   */
  {
    check('a handle for a wall is about as tall as the wall',
      Math.abs(barrierHandleHeight(1.1) - 1.1) < 1e-9, `${barrierHandleHeight(1.1)}`);
    check('a barrier turned right down still leaves something to grab',
      barrierHandleHeight(0) >= 0.8, `${barrierHandleHeight(0)}`);
    // The real guard: whatever the barrier grows to, the handle stops short of
    // it, so the fence stays on show above the green.
    const tall = [2.5, 3.6, 6].map((h) => ({ h, handle: barrierHandleHeight(h) }));
    check('but a tall barrier is never swallowed by its own handle',
      tall.every((t) => t.handle < t.h - 1),
      tall.map((t) => `${t.h} m -> handle ${t.handle} m`).join(', '));
  }

  /* And "Close" really does mean the whole circuit. */
  {
    useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null });
    useEditor.getState().commit((pr) => {
      for (const n of pr.track.nodes) { n.wallL = true; n.wallR = true; }
    });
    const nodes = useEditor.getState().project.track.nodes;
    check('closing the barrier covers every control point on both sides',
      nodes.every((n) => n.wallL && n.wallR), `${nodes.filter((n) => n.wallL && n.wallR).length}/${nodes.length}`);
  }
}

console.log('\nGeometry sanity');
for (const m of [...road, ...pit]) {
  const pos = m.geometry.getAttribute('position');
  const uv = m.geometry.getAttribute('uv');
  const idx = m.geometry.getIndex();
  const bad =
    !pos ||
    !uv ||
    !idx ||
    uv.count !== pos.count ||
    Array.from(pos.array).some((v) => !Number.isFinite(v)) ||
    Array.from(idx.array).some((v) => v >= pos.count);
  if (bad) {
    check(`${m.name} is well formed`, false, `verts ${pos?.count} uv ${uv?.count} idx ${idx?.count}`);
  }
}
check('all road meshes are well formed', true);

/* The road surface must be above the run off edge on both sides. */
{
  const f = frames[20];
  const centre = f.pos.clone();
  const edge = centre
    .clone()
    .addScaledVector(f.right, f.widthR + p.road.kerbWidth + p.road.runoffWidth)
    .add(new THREE.Vector3(0, -p.road.runoffDrop, 0));
  check('run off drops below the road', edge.y < centre.y, `${edge.y.toFixed(2)} vs ${centre.y.toFixed(2)}`);
}

console.log('\nTerrain');
const profile = sideProfile(frames, p.road, pitFrames);
const heights = blendRoadIntoTerrain(p.terrain, [
  roadCorridor(frames, p.road, profile),
  pitCorridor(pitFrames),
]);
check('height field size unchanged', heights.length === p.terrain.res * p.terrain.res);
check(
  'sculpted heights are not mutated',
  p.terrain.heights.every((h) => h === Math.fround(p.terrain.base)),
);

{
  let worst = 0;
  for (let i = 0; i < frames.length; i += 7) {
    const f = frames[i];
    const h = sampleHeights(p.terrain, heights, f.pos.x, f.pos.z);
    worst = Math.max(worst, Math.abs(h - f.pos.y));
  }
  check('terrain meets the road centre line', worst < 1.5, `worst gap ${worst.toFixed(3)} m`);
}
{
  // The ground must pass UNDER the road, never level with it, or the two
  // surfaces fight over the depth buffer and the grass flickers through the
  // tarmac. Checked right across the road at every cross section.
  let worstPoke = -Infinity;
  let wherePoke = -1;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    for (let s = -1; s <= 1; s += 0.25) {
      const lateral = s < 0 ? s * f.widthL : s * f.widthR;
      const x = f.pos.x + f.right.x * lateral;
      const z = f.pos.z + f.right.z * lateral;
      const surface = f.pos.y + lateral * f.right.y;
      const ground = sampleHeights(p.terrain, heights, x, z);
      if (ground - surface > worstPoke) { worstPoke = ground - surface; wherePoke = i; }
    }
  }
  check(
    'the ground never pokes up through the road',
    worstPoke < -0.05,
    `ground was ${worstPoke.toFixed(3)} m relative to the tarmac at frame ${wherePoke}`,
  );
  check(
    'but it is not dropped so far it leaves a visible hole',
    worstPoke > -0.6,
    `ground sits ${(-worstPoke).toFixed(3)} m under the tarmac`,
  );

  // And it has to come back up to meet the outer edge of the run off, or the
  // grass strip ends in mid air. Measured on a flat version of the track: with
  // hills the blend down to the surrounding ground is a deliberate embankment,
  // not a mismatch, and would drown out what this is testing.
  const flat = defaultProject();
  const flatFrames = computeFrames(flat.track, flat.road.samplesPerSegment);
  const flatPitFrames = computeFrames(flat.pit, flat.road.samplesPerSegment);
  const flatProfile = sideProfile(flatFrames, flat.road, flatPitFrames);
  const flatHeights = blendRoadIntoTerrain(flat.terrain, [
    roadCorridor(flatFrames, flat.road, flatProfile),
    pitCorridor(flatPitFrames),
  ]);

  let worstStep = 0;
  for (let i = 0; i < flatFrames.length; i += 3) {
    const f = flatFrames[i];
    for (const side of [-1, 1]) {
      const kerb = (side < 0 ? f.kerbL : f.kerbR) ? flat.road.kerbWidth : 0;
      const shoulder = side < 0 ? flatProfile.runoffL[i] : flatProfile.runoffR[i];
      const inner = (side < 0 ? f.widthL : f.widthR) + kerb + shoulder;
      const edgeY =
        f.pos.y + side * inner * f.right.y - flat.road.runoffDrop * Math.min(1, shoulder / 2);
      const x = f.pos.x + f.right.x * side * inner;
      const z = f.pos.z + f.right.z * side * inner;
      const ground = sampleHeights(flat.terrain, flatHeights, x, z);
      worstStep = Math.max(worstStep, Math.abs(ground - edgeY));
    }
  }
  check('the ground meets the outer edge of the run off', worstStep < 0.3, `step of ${worstStep.toFixed(3)} m`);

  /*
   * And the mesh comes DOWN to that ground rather than standing on it.
   *
   * The ground is deliberately held EDGE_SINK under every road mesh, so the two
   * are never coplanar and the depth buffer never has to guess which is in
   * front. Under the middle of the road that gap is buried and nobody sees it.
   * At the outer edge the mesh stops and the ground takes over, and there it
   * stood as a four centimetre lip running the whole length of the circuit --
   * a step off the run off, and beside a pit lane a step a car drives over on
   * its way into the box. The last ring of the mesh is now dropped by exactly
   * that much, which is the bevel a real surface has where it meets what is
   * beside it.
   *
   * Read off the geometry rather than recomputed: what is being checked is
   * that the triangles really are there, not that the arithmetic agrees with
   * itself.
   */
  const flatEdges = computeEdges(flatFrames, flat.road, flatProfile);
  const flatMeshes = buildRoadMeshes(flatFrames, true, flat.road, flatPitFrames, undefined, flatProfile);
  const runoffPos = flatMeshes
    .filter((m) => m.name.includes('_runoff'))
    .map((m) => m.geometry.getAttribute('position').array);
  let worstBevel = 0;
  let bevelled = 0;
  for (let i = 0; i < flatFrames.length; i += 5) {
    for (const [ring, w] of [[flatEdges.outerL, flatProfile.runoffL], [flatEdges.outerR, flatProfile.runoffR]]) {
      if (w[i] <= 0.05) continue;
      const want = ring[i];
      let bestD = Infinity;
      let bestY = 0;
      for (const pos of runoffPos) {
        for (let k = 0; k < pos.length; k += 3) {
          const d = (pos[k] - want.x) ** 2 + (pos[k + 2] - want.z) ** 2;
          if (d < bestD) { bestD = d; bestY = pos[k + 1]; }
        }
      }
      if (bestD > 0.01) continue;
      bevelled += 1;
      worstBevel = Math.max(worstBevel, Math.abs((want.y - bestY) - EDGE_SINK));
    }
  }
  check('and the run off ends level with it rather than on a lip above it',
    bevelled > 20 && worstBevel < 0.002,
    `${bevelled} edges checked, worst ${(worstBevel * 1000).toFixed(1)} mm out`);
}

{
  let worst = 0;
  for (let i = 0; i < pitFrames.length; i += 5) {
    const f = pitFrames[i];
    worst = Math.max(worst, Math.abs(sampleHeights(p.terrain, heights, f.pos.x, f.pos.z) - f.pos.y));
  }
  check('terrain meets the pit lane too', worst < 1.5, `worst gap ${worst.toFixed(3)} m`);
}
{
  // Far away from the track the terrain must still be untouched.
  const far = sampleHeights(p.terrain, heights, p.terrain.originX + 5, p.terrain.originZ + 5);
  check('terrain far from the track is untouched', Math.abs(far - p.terrain.base) < 1e-6, `${far}`);
}

console.log('\nRace markers');
const markers = buildAllMarkers(p, frames, pitFrames);
check('grid slot count', markers.grid.length === p.grid.count, `got ${markers.grid.length}`);
check('pit box count', markers.pits.length === p.pitCfg.boxCount, `got ${markers.pits.length}`);
check('gate count is start line plus sectors', markers.gates.length === 1 + p.timing.sectors.length);
check('names are AC conform', markers.grid[0].name === 'AC_START_0' && markers.pits[0].name === 'AC_PIT_0');
check(
  'timing gate names are AC conform',
  markers.gateMarkers.slice(0, 2).map((m) => m.name).join(',') === 'AC_TIME_0_L,AC_TIME_0_R',
  markers.gateMarkers.slice(0, 2).map((m) => m.name).join(','),
);
check('hotlap start exists', markers.hotlap[0]?.name === 'AC_HOTLAP_START_0');

/* The critical one: AC drives a car along the marker's local +Z. */
{
  const line = frameAtFraction(frames, true, p.timing.startS);
  const pole = markers.grid[0];
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(pole.quat);
  const flatLine = new THREE.Vector3(line.fwd.x, 0, line.fwd.z).normalize();
  check(
    'pole position faces along the track (local +Z)',
    forward.dot(flatLine) > 0.9,
    `dot ${forward.dot(flatLine).toFixed(3)}`,
  );
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(pole.quat);
  check('pole position keeps local +Y up', up.y > 0.99, `up.y ${up.y.toFixed(4)}`);

  const pitBox = markers.pits[0];
  const pitFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(pitBox.quat);
  const pitDir = new THREE.Vector3(pitFrames[0].fwd.x, 0, pitFrames[0].fwd.z).normalize();
  check('pit box faces down the pit lane', pitFwd.dot(pitDir) > 0.8, `dot ${pitFwd.dot(pitDir).toFixed(3)}`);
}

/* Grid slots must march backwards from the line and alternate sides. */
{
  const line = frameAtFraction(frames, true, p.timing.startS);
  const d0 = markers.grid[0].pos.distanceTo(line.pos);
  const d1 = markers.grid[1].pos.distanceTo(line.pos);
  check('pole sits ahead of car 2', d0 < d1, `${d0.toFixed(1)} vs ${d1.toFixed(1)}`);
  const side = (m) => {
    const f = frameAtFraction(frames, true, p.timing.startS);
    return m.pos.clone().sub(f.pos).dot(f.right);
  };
  check('grid is staggered left and right', Math.sign(side(markers.grid[0])) !== Math.sign(side(markers.grid[1])));
  const gaps = [];
  for (let i = 1; i < 8; i++) gaps.push(markers.grid[i].pos.distanceTo(markers.grid[i - 1].pos));
  check('row spacing is consistent', Math.max(...gaps) - Math.min(...gaps) < 3, gaps.map((g) => g.toFixed(1)).join(','));
}

/* Timing gates must fully span the road, otherwise laps never register. */
{
  for (const g of markers.gates) {
    const span = g.left.distanceTo(g.right);
    const road = g.frame.widthL + g.frame.widthR;
    if (span <= road) {
      check(`gate ${g.index} spans the road`, false, `${span.toFixed(2)} vs ${road.toFixed(2)}`);
    }
  }
  check('all timing gates span the road', true);
  check(
    'start line sits on the centre line',
    markers.gates[0].left.clone().add(markers.gates[0].right).multiplyScalar(0.5).distanceTo(markers.gates[0].frame.pos) < 0.01,
  );
}

/*
 * The paint on the grid.
 *
 * The exact dimensions are measured on a STRAIGHT, because that is the only
 * place they can be: a box follows the road, so on a bend its two side lines
 * run on different radii and the 2.7 m between them is 2.7 m of road rather
 * than 2.7 m of straight line. Which is right -- but it is not a number a
 * ruler laid across the tarmac agrees with to the centimetre.
 */
console.log('\nStart boxes');
{
  const node = (x, z) => ({ ...defaultProject().track.nodes[0], id: `g${x}_${z}`, p: [x, 0, z] });
  const straight = defaultProject();
  straight.track = { closed: false, nodes: [node(0, -200), node(0, -100), node(0, 0), node(0, 100)] };
  straight.timing = { ...straight.timing, startS: 0.75 };
  straight.grid = { ...straight.grid, count: 1, stagger: false };
  const sf = computeFrames(straight.track, straight.road.samplesPerSegment);
  const boxes = buildGridBoxes(sf, false, straight.timing, straight.grid);
  const white = boxes.find((m) => m.name === 'OBJ_grid_box');
  const yellow = boxes.find((m) => m.name === 'OBJ_grid_front_line');
  check('a grid slot gets painted', !!white, boxes.map((m) => m.name).join(',') || 'nothing');
  check('and the front wheel bar with it', !!yellow);
  check(
    'the paint carries no physics surface',
    white?.surface === null && yellow?.surface === null,
    `${white?.surface} / ${yellow?.surface}`,
  );

  const slot = buildGridMarkers(sf, false, straight.timing, straight.grid)[0];
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(slot.quat);
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const local = (def) => {
    const pos = def.geometry.getAttribute('position');
    const v = new THREE.Vector3();
    const out = { x: [], z: [], y: [] };
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).sub(slot.pos);
      out.x.push(v.dot(right));
      out.z.push(v.dot(fwd));
      out.y.push(v.y);
    }
    return out;
  };

  const w = local(white);
  const clear = 2 * Math.min(...w.x.map(Math.abs));
  const outer = Math.max(...w.x) - Math.min(...w.x);
  const long = Math.max(...w.z) - Math.min(...w.z);
  check(
    'a box is 2.7 m of clear width, the Formula 1 size',
    Math.abs(clear - F1_GRID_BOX.width) < 0.005,
    `${clear.toFixed(3)} m`,
  );
  check(
    'with 15 cm of paint either side of it',
    Math.abs(outer - (F1_GRID_BOX.width + 2 * F1_GRID_BOX.line)) < 0.005,
    `${outer.toFixed(3)} m outside to outside`,
  );
  check(
    'and side lines the full length of the box',
    Math.abs(long - straight.grid.boxLength) < 0.005,
    `${long.toFixed(3)} m`,
  );
  check(
    'the box is centred on the slot the car spawns in',
    Math.abs(Math.max(...w.z) + Math.min(...w.z)) < 0.005,
    `${(Math.max(...w.z) + Math.min(...w.z)).toFixed(3)} m off centre`,
  );

  /* Laid ON the tarmac, millimetres up: enough to stay out of the depth
     buffer's way, far too little to be a step, and no surface a car can
     touch either way -- it is named 1OBJ_. */
  const lift = w.y.map((y) => y - slot.pos.y);
  check(
    'the paint sits just above the road, never under it',
    Math.min(...lift) > 0 && Math.max(...lift) < 0.05,
    `${Math.min(...lift).toFixed(4)} to ${Math.max(...lift).toFixed(4)} m`,
  );

  const y = local(yellow);
  check(
    'the front wheel bar sits inside the box, towards the front',
    Math.max(...y.z) < Math.max(...w.z) && Math.min(...y.z) > 0,
    `${Math.min(...y.z).toFixed(2)} to ${Math.max(...y.z).toFixed(2)} m`,
  );
  check(
    'and spans the clear width of a slot that sits on the centre line',
    Math.abs(2 * Math.max(...y.x.map(Math.abs)) - F1_GRID_BOX.width) < 0.005,
    `${(2 * Math.max(...y.x.map(Math.abs))).toFixed(3)} m`,
  );

  /* Offset the slot, as a staggered grid does, and the yellow has somewhere
     to go: out of the box and on to the middle of the road, which is the only
     part of it a driver can still see over the nose of a modern car. */
  {
    const off = defaultProject();
    off.track = straight.track;
    off.timing = straight.timing;
    off.grid = { ...off.grid, count: 1, stagger: true };
    const boxed = buildGridBoxes(sf, false, off.timing, off.grid);
    const slotO = buildGridMarkers(sf, false, off.timing, off.grid)[0];
    const fwdO = new THREE.Vector3(0, 0, 1).applyQuaternion(slotO.quat);
    const rightO = new THREE.Vector3().crossVectors(fwdO, new THREE.Vector3(0, 1, 0)).normalize();
    const line = boxed.find((m) => m.name === 'OBJ_grid_front_line');
    const white = boxed.find((m) => m.name === 'OBJ_grid_box');
    const pos = line.geometry.getAttribute('position');
    const v = new THREE.Vector3();
    const xs = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).sub(slotO.pos);
      xs.push(v.dot(rightO));
    }
    /* Pole is the left hand column, so the centre of the road is 3.2 m to its
       right, and that is where the paint has to reach. */
    const inboard = Math.max(...xs);
    const outboard = Math.min(...xs);
    check(
      'on a staggered grid the yellow line runs on to the centre of the track',
      Math.abs(inboard - off.grid.lateralOffset) < 0.005,
      `reaches ${inboard.toFixed(3)} m of ${off.grid.lateralOffset} m`,
    );
    check(
      'and still stops at the outboard edge of the box',
      Math.abs(outboard + F1_GRID_BOX.width / 2) < 0.005,
      `${outboard.toFixed(3)} m`,
    );
    /* It crosses the white side line on the way out, so it has to be the one
       on top: two coplanar quads is a z-fight in the exported model. */
    const wp = white.geometry.getAttribute('position');
    let topWhite = -Infinity;
    for (let i = 0; i < wp.count; i++) topWhite = Math.max(topWhite, wp.getY(i));
    let lowYellow = Infinity;
    for (let i = 0; i < pos.count; i++) lowYellow = Math.min(lowYellow, pos.getY(i));
    check(
      'and lies over the white it crosses rather than inside it',
      lowYellow > topWhite,
      `yellow at ${lowYellow.toFixed(4)}, white at ${topWhite.toFixed(4)}`,
    );
  }

  /* On the circuit itself: every slot painted, and the whole grid one mesh
     rather than one per slot -- twenty draw calls for one marking. */
  const full = buildGridBoxes(frames, true, p.timing, p.grid);
  const quads = full[0].geometry.getIndex().count / 6;
  check(
    'every slot on the grid is painted, all in one mesh',
    full.length === 2 && quads === p.grid.count * (2 * 4 + 1),
    `${full.length} meshes, ${quads} quads for ${p.grid.count} slots`,
  );
  /* And it follows the circuit rather than being stamped flat across it:
     every corner of every box has to land on the tarmac, at the height of
     the tarmac. A box built in one straight frame would walk off the road
     through a corner and float over a crest. */
  {
    const pos = full[0].geometry.getAttribute('position');
    const v = new THREE.Vector3();
    let offRoad = 0;
    let worstY = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      let near = frames[0];
      let best = Infinity;
      for (const f of frames) {
        const d = (f.pos.x - v.x) ** 2 + (f.pos.z - v.z) ** 2;
        if (d < best) { best = d; near = f; }
      }
      const across = v.clone().sub(near.pos).dot(near.right);
      if (across < -near.widthL || across > near.widthR) offRoad += 1;
      worstY = Math.max(worstY, Math.abs(v.y - near.pos.y - 0.008));
    }
    check('every box lands on the tarmac, none of it hanging off', offRoad === 0, `${offRoad} corners off the road`);
    check(
      'and rides the surface through corners and crests',
      worstY < 0.02,
      `${worstY.toFixed(3)} m off the road it is painted on`,
    );
  }

  const off = defaultProject();
  off.grid.boxes = false;
  check(
    'switching the boxes off leaves nothing behind',
    buildGridBoxes(frames, true, off.timing, off.grid).length === 0,
  );
}

console.log('\nAI line');
const ai = buildAiLine(frames, true, p.exportCfg.aiSpacing);
check('point spacing matches the setting', ai.length > length / p.exportCfg.aiSpacing - 3, `${ai.length} points for ${length.toFixed(0)} m`);
check('all positions are finite', ai.every((a) => Number.isFinite(a.pos.x) && Number.isFinite(a.pos.y)));
check('side distances are positive', ai.every((a) => a.sideLeft > 0 && a.sideRight > 0));
check('radius never collapses to zero', ai.every((a) => a.radius > 1));
check('distance increases monotonically', ai.every((a, i) => i === 0 || a.dist > ai[i - 1].dist));
{
  // The AI offset on node 2 must actually push the line off centre.
  let maxOff = 0;
  for (const a of ai) {
    const f = frames.reduce((best, fr) => (fr.pos.distanceTo(a.pos) < best.pos.distanceTo(a.pos) ? fr : best), frames[0]);
    maxOff = Math.max(maxOff, Math.abs(a.pos.clone().sub(f.pos).dot(f.right)));
  }
  check('AI offset shifts the racing line', maxOff > 2, `max lateral offset ${maxOff.toFixed(2)} m`);
}

/* ------------------------------------------------------------------ */
/* Pit lane against the track                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Tight corners                                                       */
/* ------------------------------------------------------------------ */

console.log('\nTight corners');
{
  // A hairpin far tighter than the run off is wide. Offsetting a curve of
  // radius R inwards by more than R turns it inside out, and the strip built
  // from it folds back across the track: barriers through the middle of the
  // corner, kerbs tying themselves in a knot.
  const hair = defaultProject();
  hair.track.nodes = [
    [-300, 0], [-80, 0], [-20, 6], [0, 26], [-20, 46], [-80, 52],
    [-300, 52], [-420, 40], [-460, 26], [-420, 12],
  ].map(([x, z], i) => ({ ...hair.track.nodes[0], id: `h${i}`, p: [x, 0, z] }));
  hair.pit.nodes = [];

  const hf = computeFrames(hair.track, hair.road.samplesPerSegment);
  const hp = sideProfile(hf, hair.road, []);

  const tightest = Math.min(...hf.map((f) => (Math.abs(f.curvature) > 1e-6 ? 1 / Math.abs(f.curvature) : Infinity)));
  check('the test track really does have a tight corner', tightest < hair.road.runoffWidth, `tightest radius ${tightest.toFixed(1)} m, run off ${hair.road.runoffWidth} m`);
  check('curvature is signed towards the inside', hf.some((f) => f.curvature > 0) || hf.some((f) => f.curvature < 0));

  // The invariant: on the inside of a bend, nothing may reach the centre of
  // the turn. Reaching it means the offset line has collapsed or inverted.
  let worst = 0;
  let worstAt = -1;
  hf.forEach((f, i) => {
    if (Math.abs(f.curvature) < 1e-6) return;
    const radius = 1 / Math.abs(f.curvature);
    const inside = f.curvature > 0 ? 1 : -1;
    const half = inside < 0 ? f.widthL : f.widthR;
    const kerb = inside < 0 ? hp.kerbWL[i] : hp.kerbWR[i];
    const shoulder = inside < 0 ? hp.runoffL[i] : hp.runoffR[i];
    const reach = (half + kerb + shoulder) / radius;
    if (reach > worst) { worst = reach; worstAt = i; }
  });
  check(
    'nothing on the inside of a bend reaches past the centre of the turn',
    worst < 1,
    `reached ${(worst * 100).toFixed(0)}% of the radius at cross section ${worstAt}`,
  );

  // And the same thing measured on the finished geometry: the outer edge of
  // the run off must stay on its own side of the centre line.
  const edges = computeEdges(hf.concat([hf[0]]), hair.road, {
    ...hp,
    runoffL: Float32Array.from([...hp.runoffL, hp.runoffL[0]]),
    runoffR: Float32Array.from([...hp.runoffR, hp.runoffR[0]]),
    kerbWL: Float32Array.from([...hp.kerbWL, hp.kerbWL[0]]),
    kerbWR: Float32Array.from([...hp.kerbWR, hp.kerbWR[0]]),
    wallL: Uint8Array.from([...hp.wallL, hp.wallL[0]]),
    wallR: Uint8Array.from([...hp.wallR, hp.wallR[0]]),
  });
  let crossings = 0;
  edges.frames.forEach((f, i) => {
    const l = edges.outerL[i].clone().sub(f.pos);
    const r = edges.outerR[i].clone().sub(f.pos);
    if (l.x * f.right.x + l.z * f.right.z > 0) crossings++;
    if (r.x * f.right.x + r.z * f.right.z < 0) crossings++;
  });
  check('no edge crosses over to the wrong side of the road', crossings === 0, `${crossings} crossings`);

  // The kerb must not be left as a vertical lip where it was squeezed away.
  const meshes = buildRoadMeshes(hf, true, hair.road, []);
  check('the hairpin still builds a road', meshes.some((m) => m.name === '1ROAD_track'));
  check(
    'and every mesh is finite',
    meshes.every((m) => Array.from(m.geometry.getAttribute('position').array).every(Number.isFinite)),
  );
}

console.log('\nTerrain picking');
{
  // The fast height grid picker has to agree with an honest triangle by
  // triangle raycast, or clicks land somewhere other than where you aimed.
  const geometry = buildTerrainGeometry(p.terrain, heights);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);

  const fast = makeTerrainRaycast(p.terrain, heights);
  const raycaster = new THREE.Raycaster();
  raycaster.far = 1e6;

  let checked = 0;
  let worstGap = 0;
  let misses = 0;
  let seed = 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

  for (let q = 0; q < 250; q++) {
    const from = new THREE.Vector3(rnd() * 700 - 350, 200 + rnd() * 300, rnd() * 700 - 350);
    const at = new THREE.Vector3(rnd() * 700 - 350, 0, rnd() * 700 - 350);
    raycaster.set(from, at.clone().sub(from).normalize());

    const truth = raycaster.intersectObject(mesh, false);
    const got = [];
    fast.call(mesh, raycaster, got);

    if (truth.length === 0) {
      if (got.length > 0) misses++;
      continue;
    }
    if (got.length === 0) {
      misses++;
      continue;
    }
    checked++;
    worstGap = Math.max(worstGap, got[0].point.distanceTo(truth[0].point));
  }

  check('the fast picker agrees on where the ground is', checked > 200, `only ${checked} comparable rays`);
  check('and it never disagrees about whether there is a hit', misses === 0, `${misses} mismatches`);
  /* The budget is a calibration of the marching picker against this test
     landscape, not a physical bound: the worst gap is always a ray grazing
     the steepest relief, and the corridor now digs slightly steeper relief
     beside road edges on a climb (the climb bump, see terrain.ts). At 0.8 the
     guard still catches a broken picker an order of magnitude out. */
  check('hit positions match the real geometry', worstGap < 0.8, `worst gap ${worstGap.toFixed(3)} m`);

  // Rays that miss the terrain entirely must report nothing.
  raycaster.set(new THREE.Vector3(0, 500, 0), new THREE.Vector3(0, 1, 0));
  const up = [];
  fast.call(mesh, raycaster, up);
  check('a ray pointing away from the ground misses', up.length === 0);

  raycaster.set(new THREE.Vector3(9000, 500, 9000), new THREE.Vector3(0, -1, 0));
  const outside = [];
  fast.call(mesh, raycaster, outside);
  check('a ray outside the terrain misses', outside.length === 0);

  // Speed: this runs on every mouse move, so it has to be cheap.
  raycaster.set(new THREE.Vector3(300, 400, 300), new THREE.Vector3(-0.5, -0.7, -0.5).normalize());
  const t0 = performance.now();
  for (let q = 0; q < 2000; q++) {
    const sink = [];
    fast.call(mesh, raycaster, sink);
  }
  const fastMs = (performance.now() - t0) / 2000;
  const t1 = performance.now();
  for (let q = 0; q < 20; q++) raycaster.intersectObject(mesh, false);
  const slowMs = (performance.now() - t1) / 20;
  console.log(`        picking: ${fastMs.toFixed(3)} ms fast vs ${slowMs.toFixed(2)} ms per triangle`);
  check('picking is far cheaper than walking every triangle', fastMs * 20 < slowMs, `${fastMs.toFixed(3)} vs ${slowMs.toFixed(2)} ms`);

  geometry.dispose();
}

console.log('\nCorridor mask reuse');
{
  // The mask build reuses its working buffers between calls to avoid throwing
  // megabytes away every frame. That is only safe if it clears them properly,
  // so: the same input must give the same answer every time, and a small
  // terrain in between must not leave anything behind.
  const profileA = sideProfile(frames, p.road, pitFrames);
  const corridorsA = [roadCorridor(frames, p.road, profileA), pitCorridor(pitFrames)];

  const first = buildCorridorMask(p.terrain, corridorsA);
  const again = buildCorridorMask(p.terrain, corridorsA);
  const same =
    first.indices.length === again.indices.length &&
    first.indices.every((v, i) => v === again.indices[i]) &&
    first.weight.every((v, i) => Math.abs(v - again.weight[i]) < 1e-9) &&
    first.shift.every((v, i) => Math.abs(v - again.shift[i]) < 1e-9);
  check('building the mask twice gives the same answer', same);

  const small = { ...p.terrain, ...resampleTerrain(p.terrain, 97) };
  buildCorridorMask(small, [roadCorridor(frames, p.road, profileA), pitCorridor(pitFrames)]);
  const third = buildCorridorMask(p.terrain, corridorsA);
  const stillSame =
    first.indices.length === third.indices.length &&
    first.indices.every((v, i) => v === third.indices[i]) &&
    first.shift.every((v, i) => Math.abs(v - third.shift[i]) < 1e-9);
  check('a different grid size in between leaves nothing behind', stillSame);

  // A corridor that reaches nothing must clear the buffers, not inherit.
  const away = p.track.nodes.map((n) => ({ ...n, p: [n.p[0] + 90000, n.p[1], n.p[2] + 90000] }));
  const awayFrames = computeFrames({ closed: true, nodes: away }, p.road.samplesPerSegment);
  const empty = buildCorridorMask(p.terrain, [
    roadCorridor(awayFrames, p.road, sideProfile(awayFrames, p.road, [])),
  ]);
  check('a track far off the grid touches nothing', empty.indices.length === 0, `${empty.indices.length} cells`);

  const back = buildCorridorMask(p.terrain, corridorsA);
  check(
    'and the next real build is unaffected by it',
    back.indices.length === first.indices.length &&
      back.shift.every((v, i) => Math.abs(v - first.shift[i]) < 1e-9),
  );
}

console.log('\nNearest point index');
{
  // Correctness against brute force, including queries far outside the cloud.
  const pts = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 800; i++) pts.push(new THREE.Vector3(rnd() * 1200 - 600, 0, rnd() * 800 - 400));
  const index = new PointIndex(pts, 25);

  let mismatches = 0;
  for (let q = 0; q < 400; q++) {
    const x = rnd() * 3000 - 1500;
    const z = rnd() * 3000 - 1500;
    let bruteI = -1;
    let bruteD = Infinity;
    pts.forEach((p, i) => {
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bruteD) { bruteD = d; bruteI = i; }
    });
    const got = index.nearest(x, z);
    const gotD = got >= 0 ? pts[got].distanceToSquared(new THREE.Vector3(x, 0, z)) : Infinity;
    if (Math.abs(gotD - bruteD) > 1e-6) mismatches++;
  }
  check('unbounded search matches brute force', mismatches === 0, `${mismatches} of 400 wrong`);

  let outOfRange = 0;
  for (let q = 0; q < 200; q++) {
    const x = rnd() * 1200 - 600;
    const z = rnd() * 800 - 400;
    const near = index.nearest(x, z, 5);
    if (near >= 0 && pts[near].distanceTo(new THREE.Vector3(x, 0, z)) > 5) outOfRange++;
  }
  check('a radius limit is respected', outOfRange === 0, `${outOfRange} hits outside the radius`);

  // A far away query with no radius must not scan the world cell by cell.
  const t0 = performance.now();
  for (let q = 0; q < 20000; q++) index.nearest(90000, 90000);
  const ms = performance.now() - t0;
  check('a far away unbounded query stays cheap', ms < 400, `${ms.toFixed(0)} ms for 20000 queries`);
}

console.log('\nPit lane clearance');
{
  const side = pitLaneSide(pitFrames, frames);
  check('pit lane side is detected', side === 1 || side === -1, `got ${side}`);

  /* Frames where the pit lane really is close by -- measured off where the
     layout actually puts its lane rather than a number typed in here, which
     silently emptied this whole section the moment the lane moved out to make
     room for a wider pit complex. */
  const near = [];
  for (let i = 0; i < frames.length; i++) {
    let best = Infinity;
    for (const pf of pitFrames) best = Math.min(best, frames[i].pos.distanceTo(pf.pos));
    if (best < PIT_OFFSET + 6) near.push(i);
  }
  check('the default layout has the pit lane running alongside', near.length > 5, `${near.length} frames`);

  /*
   * The clearance measured on a lane that actually needs it.
   *
   * The default layout puts its lane far enough out that the circuit's full run
   * off fits beside it -- which is the point of where it sits, and which means
   * the clearance rule has nothing to pull back there. So the rule is tested
   * against a lane dragged six metres in towards the track, which is what
   * somebody doing it by hand in the editor produces: close enough that the run
   * off has to give way, far enough that there is still room for the pit wall.
   */
  const trackIndex = new PointIndex(frames.map((f) => f.pos), 40);
  const tightPitFrames = pitFrames.map((f) => {
    const ti = trackIndex.nearest(f.pos.x, f.pos.z, 200);
    const towards = frames[ti < 0 ? 0 : ti].pos.clone().sub(f.pos).setY(0).normalize();
    return { ...f, pos: f.pos.clone().addScaledVector(towards, 6) };
  });
  const withPit = sideProfile(frames, p.road, tightPitFrames);
  const withoutPit = sideProfile(frames, p.road, []);

  const sideKey = side < 0 ? 'runoffL' : 'runoffR';
  const wallKey = side < 0 ? 'wallL' : 'wallR';

  check(
    'run off is pulled back where the pit lane is',
    near.some((i) => withPit[sideKey][i] < withoutPit[sideKey][i] - 0.5),
    `max reduction ${Math.max(...near.map((i) => withoutPit[sideKey][i] - withPit[sideKey][i])).toFixed(2)} m`,
  );
  /* The barrier squeezes rather than vanishing. It used to be deleted on every
     cross section the pit lane came near, which is most of the entry and exit
     -- so the one stretch that most wants a pit wall between track and lane
     was the one stretch that could not have one, and switching it back on in
     the barrier tool did nothing at all. */
  const keptWall = near.filter((i) => withPit[wallKey][i] === 1 && withoutPit[wallKey][i] === 1);
  check(
    'the barrier survives alongside the pit lane',
    keptWall.length > 0,
    `${keptWall.length} of ${near.length} frames keep it`,
  );
  check(
    'and it is squeezed in, not left standing in the lane',
    keptWall.every((i) => withPit[sideKey][i] <= withoutPit[sideKey][i] + 1e-6),
  );
  check(
    'the barrier stays up away from the pit lane',
    frames.some((_, i) => !near.includes(i) && withPit[wallKey][i] === 1),
  );

  // The run off must never reach into the pit lane. Where the two are so close
  // that even the bare tarmac would touch, the only correct answer is a run off
  // of zero: the editor cannot invent space the layout does not have.
  let worstOverlap = 0;
  let squeezedButNotZero = 0;
  for (const i of near) {
    const f = frames[i];
    const w = withPit[sideKey][i];
    const kerb = (side < 0 ? f.kerbL : f.kerbR) ? p.road.kerbWidth : 0;
    const roadEdge = (side < 0 ? f.widthL : f.widthR) + kerb;
    let free = Infinity;
    for (const pf of pitFrames) {
      const dx = pf.pos.x - f.pos.x;
      const dz = pf.pos.z - f.pos.z;
      const lateral = Math.abs(dx * f.right.x + dz * f.right.z);
      const along = Math.abs(dx * f.fwd.x + dz * f.fwd.z);
      if (along > 6) continue;
      free = Math.min(free, lateral - Math.max(pf.widthL, pf.widthR));
    }
    if (!Number.isFinite(free)) continue;
    if (free > roadEdge) worstOverlap = Math.max(worstOverlap, roadEdge + w - free);
    else if (w > 0.01) squeezedButNotZero++;
  }
  check(
    'the run off never grows into the pit lane',
    worstOverlap <= 0.01,
    `overlap ${worstOverlap.toFixed(2)} m`,
  );
  check(
    'where there is no room at all the run off is removed entirely',
    squeezedButNotZero === 0,
    `${squeezedButNotZero} cross sections still had run off`,
  );

  // And the demo layout itself must be sane: the pit lane must not be drawn on
  // top of the track.
  let deepest = 0;
  for (const f of frames) {
    for (const pf of pitFrames) {
      const dx = pf.pos.x - f.pos.x;
      const dz = pf.pos.z - f.pos.z;
      const lateral = Math.abs(dx * f.right.x + dz * f.right.z);
      const along = Math.abs(dx * f.fwd.x + dz * f.fwd.z);
      if (along > 6) continue;
      const gap = lateral - Math.max(f.widthL, f.widthR) - Math.max(pf.widthL, pf.widthR);
      deepest = Math.min(deepest, gap);
    }
  }
  check('the demo pit lane does not cut through the track', deepest > -0.01, `overlap ${(-deepest).toFixed(2)} m`);

  // Barriers, kerbs and run off all come in stretches, and anything that chops
  // them up (the pit lane clearance, or just switching them off section by
  // section) used to add a mesh per stretch. That is a draw call and a geometry
  // each, rebuilt every frame while dragging, so a couple of edits could
  // multiply the size of the scene. They are merged per side now.
  const chopped = defaultProject();
  chopped.track.nodes = chopped.track.nodes.map((n, i) => ({
    ...n,
    wallL: i % 2 === 0,
    wallR: i % 3 === 0,
    runoffR: i % 2 === 0 ? 1 : 0,
  }));
  const choppedFrames = computeFrames(chopped.track, chopped.road.samplesPerSegment);
  const choppedPit = computeFrames(chopped.pit, chopped.road.samplesPerSegment);
  const choppedProfile = sideProfile(choppedFrames, chopped.road, choppedPit);
  let flips = 0;
  for (let i = 1; i < choppedFrames.length; i++) {
    if (choppedProfile.wallL[i] !== choppedProfile.wallL[i - 1]) flips++;
  }
  const choppedMeshes = buildRoadMeshes(choppedFrames, true, chopped.road, choppedPit);
  check('the barrier really is chopped into many stretches', flips >= 8, `${flips} flips`);
  check(
    // Road, two edge lines, two kerbs, two run offs, two barriers, and the
    // coloured strips when a span asks for them. All per SIDE, never per run.
    'but the mesh count stays put anyway',
    choppedMeshes.length <= 15,
    `${choppedMeshes.length} meshes: ${choppedMeshes.map((m) => m.name).join(',')}`,
  );
  check(
    'one mesh per side, not one per stretch',
    new Set(choppedMeshes.map((m) => m.name)).size === choppedMeshes.length,
  );
  check(
    'and the merged mesh is still well formed',
    choppedMeshes.every((m) => {
      const pos = m.geometry.getAttribute('position');
      const idx = m.geometry.getIndex();
      return pos && idx && Array.from(idx.array).every((v) => v < pos.count);
    }),
  );

  const flagged = nodesAlongPitLane(p.track.nodes, pitFrames, 60);
  check('nodes next to the pit lane are found', flagged.length > 0, `${flagged.length} nodes`);
  check('they all agree on the side', new Set(flagged.map((f) => f.side)).size === 1);
}

console.log('\nPit lane attachment');
{
  const before = p.pit.nodes.map((n) => [...n.p]);
  const res = attachPitLane(p.pit, frames, true);
  check('attach returns a result', !!res);

  const first = res.nodes[0];
  const last = res.nodes[res.nodes.length - 1];

  const distToTrack = (n) => {
    let best = Infinity;
    let bestF = null;
    for (const f of frames) {
      const d = Math.hypot(f.pos.x - n.p[0], f.pos.z - n.p[2]);
      if (d < best) { best = d; bestF = f; }
    }
    const half = res.side < 0 ? bestF.widthL : bestF.widthR;
    const pitHalf = res.side < 0 ? n.widthR : n.widthL;
    return best - half - pitHalf;
  };

  // The ends overlap the tarmac by about a metre, so the surface merge can
  // glue them flush onto the road instead of leaving a strip of grass.
  check(
    'pit entry overlaps the track edge',
    Math.abs(distToTrack(first) + 1) < 1.5,
    `gap ${distToTrack(first).toFixed(2)} m, wanted about -1`,
  );
  check(
    'pit exit overlaps the track edge',
    Math.abs(distToTrack(last) + 1) < 1.5,
    `gap ${distToTrack(last).toFixed(2)} m, wanted about -1`,
  );
  check('the lane is levelled with the track', res.nodes.every((n) => Math.abs(n.p[1]) < 25));
  check('it did not touch the original until asked', before.length === p.pit.nodes.length);

  // The join has to leave the track pointing the same way the cars go.
  const entryDir = {
    x: res.nodes[1].p[0] - res.nodes[0].p[0],
    z: res.nodes[1].p[2] - res.nodes[0].p[2],
  };
  const len = Math.hypot(entryDir.x, entryDir.z) || 1;
  let bestF = frames[0];
  let best = Infinity;
  for (const f of frames) {
    const d = Math.hypot(f.pos.x - first.p[0], f.pos.z - first.p[2]);
    if (d < best) { best = d; bestF = f; }
  }
  const dot = (entryDir.x / len) * bestF.fwd.x + (entryDir.z / len) * bestF.fwd.z;
  check('the entry leaves along the driving direction', dot > 0.95, `dot ${dot.toFixed(3)}`);
}

/*
 * Corridor clearance in tight corners.
 *
 * A corner drawn tighter than the corridor is wide folds the run off and the
 * barrier of one leg straight across the racing line of the other. Nothing
 * local catches it: measured at the cross sections either side of the spike
 * the radius runs into the hundreds of metres, so the curvature limit sees a
 * near straight piece of road and lets both legs claim their full width.
 */
console.log('\nCorridor clearance in tight corners');
{
  const spike = (spread) => {
    const q = defaultProject();
    q.track.closed = true;
    q.track.nodes = [
      [-260, 0, 60], [-140, 0, 60], [-40, 0, 55], [0, 0, 0],
      [spread, 0, -40], [0, 0, -80], [-40, 0, -135],
      [-140, 0, -140], [-260, 0, -140], [-330, 0, -40],
      // Barriers all round, because what is being tested is where they end up.
    ].map((v, i) => ({ ...q.track.nodes[0], id: `k${i}`, p: v, wallL: true, wallR: true }));
    q.pit.nodes = [];
    return q;
  };

  /** Deepest a run off / barrier point sits inside the tarmac ribbon. */
  const intoTarmac = (fr, prof, road) => {
    const e = computeEdges(fr, road, prof);
    const n = fr.length;
    // computeEdges hands back shared scratch, so read it before anything else
    // touches it.
    const pts = [...e.outerL.slice(0, n), ...e.outerR.slice(0, n)].map((v) => ({ x: v.x, z: v.z }));
    let deepest = 0;
    for (const P of pts) {
      for (let s = 0; s < n; s++) {
        const a = fr[s];
        const b = fr[(s + 1) % n];
        const ex = b.pos.x - a.pos.x;
        const ez = b.pos.z - a.pos.z;
        const len2 = ex * ex + ez * ez;
        if (len2 < 1e-9) continue;
        const t = ((P.x - a.pos.x) * ex + (P.z - a.pos.z) * ez) / len2;
        if (t < 0 || t > 1) continue;
        const lat = (P.x - a.pos.x - ex * t) * a.right.x + (P.z - a.pos.z - ez * t) * a.right.z;
        const depth = (lat < 0 ? a.widthL : a.widthR) - Math.abs(lat);
        if (depth > deepest) deepest = depth;
      }
    }
    return deepest;
  };

  // Tight enough that the two legs overlap, but the road itself still fits.
  const q = spike(40);
  const fr = computeFrames(q.track, q.road.samplesPerSegment);
  const tight = sideProfile(fr, q.road, [], true);
  check(
    'a sharp corner keeps the run off off the racing line',
    intoTarmac(fr, tight, q.road) < 0.05,
    `${intoTarmac(fr, tight, q.road).toFixed(2)} m of it sits on the tarmac`,
  );
  let narrowed = 0;
  for (let i = 0; i < fr.length; i++) {
    narrowed = Math.max(
      narrowed,
      q.road.runoffWidth * fr[i].runoffL - tight.runoffL[i],
      q.road.runoffWidth * fr[i].runoffR - tight.runoffR[i],
    );
  }
  check('and pays for it by narrowing, not by vanishing', narrowed > 1 && narrowed < q.road.runoffWidth,
    `narrowed by ${narrowed.toFixed(1)} m of ${q.road.runoffWidth} m`);
  check(
    'the barrier is still built along it',
    Array.from(tight.wallL).some((v) => v === 1) && Array.from(tight.wallR).some((v) => v === 1),
  );

  // Ordinary shapes must come out byte for byte as before.
  const untouched = (label, build) => {
    const r = build();
    const f2 = computeFrames(r.track, r.road.samplesPerSegment);
    const swept = sideProfile(f2, r.road, [], r.track.closed);
    let lost = 0;
    for (let i = 0; i < f2.length; i++) {
      // What the curvature rule alone would have allowed on the outside of
      // every bend, which the clearance sweep must never touch.
      if (Math.abs(f2[i].curvature) < 1e-6) {
        lost = Math.max(
          lost,
          r.road.runoffWidth * f2[i].runoffL - swept.runoffL[i],
          r.road.runoffWidth * f2[i].runoffR - swept.runoffR[i],
        );
      }
    }
    check(`${label} keeps its full run off on the straights`, lost < 1e-6, `lost ${lost.toFixed(3)} m`);
  };
  untouched('the demo oval', () => defaultProject());
  untouched('a wide open S', () => {
    const r = defaultProject();
    r.track.nodes = [
      [-300, 0, 0], [-150, 0, 60], [0, 0, 0], [150, 0, -60], [300, 0, 0],
      [360, 0, 160], [0, 0, 240], [-360, 0, 160],
    ].map((v, i) => ({ ...r.track.nodes[0], id: `w${i}`, p: v }));
    return r;
  });
  untouched('a track with a very wide run off', () => {
    const r = defaultProject();
    r.road.runoffWidth = 20;
    return r;
  });
}

/*
 * The barrier tool's grab handles.
 *
 * A handle has to stand where its barrier stands and write to the control
 * point that actually governs that stretch. Get the second part wrong and
 * clicking a handle silently toggles a barrier somewhere else on the lap.
 */
console.log('\nBarrier handles');
{
  const q = defaultProject();
  // A handle has to work whether the barrier is there or not, so put one up
  // and switch a stretch of it back off further down.
  for (const n of q.track.nodes) {
    n.wallL = true;
    n.wallR = true;
  }
  const fr = computeFrames(q.track, q.road.samplesPerSegment);
  const prof = sideProfile(fr, q.road, [], q.track.closed);
  const h = barrierHandles(fr, prof, q.track.nodes.length, q.track.closed, q.road.wallHeight);

  check('a handle for every stretch of roadside, both sides', h.count === fr.length * 2, `${h.count} for ${fr.length} cross sections`);
  check('every matrix is a real number', Array.from(h.matrices).every(Number.isFinite));
  check(
    'they only ever name a control point that exists',
    Array.from(h.nodeOf).every((i) => i >= 0 && i < q.track.nodes.length),
  );
  check('both sides are represented', new Set(Array.from(h.sideOf)).size === 2);

  // The handle must write to the point the spline actually reads the flag
  // from. Proved rather than assumed: flip one point, rebuild, and check the
  // cross sections that changed are exactly the ones the handles point at.
  const target = 4;
  const flipped = { ...q, track: { ...q.track, nodes: q.track.nodes.map((n, i) => (i === target ? { ...n, wallL: false } : n)) } };
  const fr2 = computeFrames(flipped.track, q.road.samplesPerSegment);
  const prof2 = sideProfile(fr2, q.road, [], flipped.track.closed);
  const changed = new Set();
  for (let i = 0; i < fr2.length; i++) if (prof.wallL[i] !== prof2.wallL[i]) changed.add(i);
  const claimed = new Set();
  for (let k = 0; k < h.count; k++) if (h.nodeOf[k] === target && h.sideOf[k] === -1) claimed.add(k >> 1);
  check(
    'a handle toggles exactly the stretch it stands on',
    changed.size > 0 && changed.size === claimed.size && [...changed].every((i) => claimed.has(i)),
    `${changed.size} cross sections changed, handles claim ${claimed.size}`,
  );

  // And it stands on the barrier, not in the middle of the road.
  let worstOffset = 0;
  for (let k = 0; k < h.count; k++) {
    const i = k >> 1;
    const side = h.sideOf[k];
    const px = h.matrices[k * 16 + 12];
    const pz = h.matrices[k * 16 + 14];
    const f = fr[i];
    const lat = (px - f.pos.x) * f.right.x + (pz - f.pos.z) * f.right.z;
    const want =
      side < 0
        ? -(f.widthL + prof.kerbWL[i] + prof.runoffL[i])
        : f.widthR + prof.kerbWR[i] + prof.runoffR[i];
    // The handle sits at the midpoint of its stretch, so allow for the road
    // widening between the two cross sections it spans.
    worstOffset = Math.max(worstOffset, Math.abs(lat - want));
  }
  check('handles stand on the outer edge, where the barrier is', worstOffset < 1.5, `off by ${worstOffset.toFixed(2)} m`);

  /*
   * Moving a barrier off the run off edge. The mesh and the handle have to
   * agree about where it went, or Shift-dragging a handle would leave it
   * somewhere other than the barrier it is supposed to be holding.
   */
  const GAP = 7;
  const moved = {
    ...q,
    track: { ...q.track, nodes: q.track.nodes.map((n) => ({ ...n, wallGapL: GAP })) },
  };
  const frM = computeFrames(moved.track, q.road.samplesPerSegment);
  const profM = sideProfile(frM, q.road, [], moved.track.closed);

  const wallOf = (project, frames) => {
    const meshes = buildRoadMeshes(frames, project.track.closed, project.road, []);
    const m = meshes.find((x) => x.name === '1WALL_left');
    const pos = m.geometry.getAttribute('position');
    // Distance of the barrier from the centre line, at the first vertex.
    const f = frames[0];
    const lat = (pos.array[0] - f.pos.x) * f.right.x + (pos.array[2] - f.pos.z) * f.right.z;
    return -lat;
  };
  const before = wallOf(q, fr);
  const after = wallOf(moved, frM);
  check(
    'a barrier gap really moves the barrier out',
    Math.abs(after - before - GAP) < 0.3,
    `moved ${(after - before).toFixed(2)} m for a gap of ${GAP} m`,
  );

  const hM = barrierHandles(frM, profM, moved.track.nodes.length, moved.track.closed, q.road.wallHeight);
  const handleLat = (h2, k, frames) => {
    const i = k >> 1;
    const f = frames[i];
    return -((h2.matrices[k * 16 + 12] - f.pos.x) * f.right.x + (h2.matrices[k * 16 + 14] - f.pos.z) * f.right.z);
  };
  check(
    'and the handle follows it out there',
    Math.abs(handleLat(hM, 0, frM) - handleLat(h, 0, fr) - GAP) < 0.3,
    `handle moved ${(handleLat(hM, 0, frM) - handleLat(h, 0, fr)).toFixed(2)} m`,
  );
  check(
    'a gap of zero leaves everything exactly where it was',
    Math.abs(wallOf({ ...q, track: { ...q.track, nodes: q.track.nodes.map((n) => ({ ...n, wallGapL: 0 })) } }, fr) - before) < 1e-6,
  );
}

console.log('\nPit lane surface merge');
{
  // Attach the lane, then check the junction is genuinely flush: the glued
  // cross sections ride a hair above the road plane instead of cutting
  // through it, and the glue lets go once the lane is out in the paddock.
  const attached = attachPitLane(p.pit, frames, true);
  const pit = { ...p.pit, nodes: attached.nodes };
  const rawPit = computeFrames(pit, p.road.samplesPerSegment);
  const merged = mergePitFrames(rawPit, frames, p.road.pitGap);

  check('the junction is glued', merged.weight[0] > 0.99, `weight ${merged.weight[0]?.toFixed(2)}`);
  const mid = Math.floor(rawPit.length / 2);
  check('the paddock straight is not', merged.weight[mid] === 0, `weight ${merged.weight[mid]?.toFixed(2)}`);
  check('unglued cross sections keep their frame', merged.frames[mid] === rawPit[mid]);

  // The glued entry must sit just above the road surface, never inside it.
  const index = new PointIndex(frames.map((f) => f.pos), 30);
  let flush = true;
  let worst = 0;
  for (let i = 0; i < merged.frames.length; i++) {
    if (merged.weight[i] < 0.99) continue;
    const mf = merged.frames[i];
    // The lane's CENTRE line, which is always drawn. The nominal edges are no
    // longer: the road-facing one is trimmed back to the tarmac edge, so a
    // frame's stored half width says where the AI corridor is, not where the
    // surface ends. Whether the drawn meshes stack is asserted against the
    // real geometry in tools/verify-pit.mjs.
    for (const side of [0]) {
      const edge = mf.pos.clone();
      const ti = index.nearest(edge.x, edge.z, 60);
      if (ti < 0) continue;
      const tf = frames[ti];
      const lat = (edge.x - tf.pos.x) * tf.right.x + (edge.z - tf.pos.z) * tf.right.z;
      if (Math.abs(lat) > (lat < 0 ? tf.widthL : tf.widthR)) continue; // off the tarmac
      const along = Math.max(-20, Math.min(20, (edge.x - tf.pos.x) * tf.fwd.x + (edge.z - tf.pos.z) * tf.fwd.z));
      const road = tf.pos.y + lat * tf.right.y + along * tf.fwd.y;
      const gap = edge.y - road;
      // Above the road, but only just. The lift used to be a flat 30 mm over
      // the whole overlap -- half the kerb height, and felt as a step driving
      // in and out. It is now the smallest separation the depth buffer needs,
      // applied only to the sliver that is genuinely stacked on the tarmac.
      if (gap < 0 || gap > 0.02) {
        flush = false;
        worst = gap;
      }
    }
  }
  check('glued edges ride just above the tarmac', flush, `edge sits ${worst.toFixed(3)} m off the road plane`);
}

/* ------------------------------------------------------------------ */
/* Section editing                                                     */
/* ------------------------------------------------------------------ */

console.log('\nSection editing');
{
  const path = { closed: true, nodes: p.track.nodes.map((n) => ({ ...n, p: [...n.p] })) };
  const ids = path.nodes.map((n) => n.id);

  check('a forward run is selected', sectionIndices(path, ids[2], ids[5]).join(',') === '2,3,4,5');
  check(
    'the run wraps around a closed lap',
    sectionIndices(path, ids[10], ids[1]).join(',') === '10,11,0,1',
    sectionIndices(path, ids[10], ids[1]).join(','),
  );
  check('a single point is a run of one', sectionIndices(path, ids[3], ids[3]).join(',') === '3');
  check(
    'an open path never wraps',
    sectionIndices({ closed: false, nodes: path.nodes }, ids[5], ids[2]).join(',') === '2,3,4,5',
  );

  applyToSection(path, ids[2], ids[5], (n) => { n.widthL = 14; });
  check(
    'a change hits only the selected points',
    path.nodes[2].widthL === 14 && path.nodes[5].widthL === 14 && path.nodes[6].widthL !== 14,
  );

  /* Dragging a section: the same offset on every point, nothing else touched. */
  {
    const before = path.nodes.map((n) => [...n.p]);
    translateSection(path, ids[2], ids[5], 12, -3.5, 7);
    const moved = [2, 3, 4, 5];
    check(
      'a section drag moves every point by exactly the offset asked for',
      moved.every(
        (i) =>
          Math.abs(path.nodes[i].p[0] - (before[i][0] + 12)) < 1e-9 &&
          Math.abs(path.nodes[i].p[1] - (before[i][1] - 3.5)) < 1e-9 &&
          Math.abs(path.nodes[i].p[2] - (before[i][2] + 7)) < 1e-9,
      ),
    );
    check(
      'and leaves the points outside it alone',
      path.nodes.every((n, i) => moved.includes(i) || n.p.every((v, k) => v === before[i][k])),
    );
    // The whole point of moving a run rather than each point: the shape of the
    // stretch has to survive the drag untouched.
    check(
      'the shape of the run is preserved',
      moved.slice(1).every((i) => {
        const wasX = before[i][0] - before[i - 1][0];
        const wasZ = before[i][2] - before[i - 1][2];
        return (
          Math.abs(path.nodes[i].p[0] - path.nodes[i - 1].p[0] - wasX) < 1e-9 &&
          Math.abs(path.nodes[i].p[2] - path.nodes[i - 1].p[2] - wasZ) < 1e-9
        );
      }),
    );
    translateSection(path, ids[2], ids[5], -12, 3.5, -7);
    check(
      'dragging back by the same offset restores the original exactly',
      path.nodes.every((n, i) => n.p.every((v, k) => Math.abs(v - before[i][k]) < 1e-9)),
      path.nodes[3].p.join(','),
    );
  }

  /* A run that wraps the seam of a closed lap must move as one piece too. */
  {
    const before = path.nodes.map((n) => [...n.p]);
    const wrapped = sectionIndices(path, ids[10], ids[1]);
    translateSection(path, ids[10], ids[1], 5, 0, -5);
    check(
      'a run that wraps the seam of a loop moves as one piece',
      wrapped.every(
        (i) =>
          Math.abs(path.nodes[i].p[0] - (before[i][0] + 5)) < 1e-9 &&
          Math.abs(path.nodes[i].p[2] - (before[i][2] - 5)) < 1e-9,
      ),
      wrapped.join(','),
    );
    check(
      'and the far side of the lap does not move with it',
      path.nodes.every((n, i) => wrapped.includes(i) || n.p.every((v, k) => v === before[i][k])),
    );
    translateSection(path, ids[10], ids[1], -5, 0, 5);
  }

  const y0 = path.nodes[3].p[1];
  raiseSection(path, ids[2], ids[5], 4);
  check('raising moves the whole run', Math.abs(path.nodes[3].p[1] - (y0 + 4)) < 1e-9);

  path.nodes[2].p[1] = 0;
  path.nodes[5].p[1] = 20;
  path.nodes[3].p[1] = -50;
  rampSection(path, ids[2], ids[5]);
  check(
    'ramp makes an even climb',
    Math.abs(path.nodes[3].p[1] - 20 / 3) < 1e-6 && Math.abs(path.nodes[4].p[1] - 40 / 3) < 1e-6,
    `${path.nodes[3].p[1].toFixed(3)}, ${path.nodes[4].p[1].toFixed(3)}`,
  );

  straightenSection(path, ids[2], ids[5]);
  {
    const a = path.nodes[2].p;
    const b = path.nodes[5].p;
    const m = path.nodes[3].p;
    const t = 1 / 3;
    const off = Math.hypot(m[0] - (a[0] + (b[0] - a[0]) * t), m[2] - (a[2] + (b[2] - a[2]) * t));
    check('straighten puts the points on the line', off < 1e-6, `off by ${off.toFixed(4)} m`);
  }

  const countBefore = path.nodes.length;
  subdivideSection(path, ids[2], ids[5]);
  check('subdivide adds one point per gap', path.nodes.length === countBefore + 3, `${path.nodes.length}`);
  check(
    'the new points sit between the old ones',
    path.nodes[2].id === ids[2] && path.nodes[4].id === ids[3],
    path.nodes.slice(2, 6).map((n) => n.id).join(','),
  );

  deleteSectionInterior(path, ids[2], ids[5]);
  check('deleting the interior leaves the two ends', path.nodes.length === countBefore - 2, `${path.nodes.length}`);
  check('the ends survive', path.nodes.some((n) => n.id === ids[2]) && path.nodes.some((n) => n.id === ids[5]));
}

/* ------------------------------------------------------------------ */
/* Inserting control points                                            */
/* ------------------------------------------------------------------ */

console.log('\nInserting control points');
{
  /* Which node a cross section belongs to, straight from its curve parameter. */
  const closedPath = { closed: true, nodes: p.track.nodes.map((n) => ({ ...n, p: [...n.p] })) };
  const closedFrames = computeFrames(closedPath, p.road.samplesPerSegment);
  const segCount = closedPath.nodes.length;
  // The real density, not the requested floor: indexing frames as
  // `segment * spp` only lands on the right cross section if spp is what the
  // path actually got.
  const spp = samplesFor(closedPath, p.road.samplesPerSegment);

  let wrongSegment = 0;
  for (let seg = 0; seg < segCount; seg++) {
    // Dead centre of the segment, where there can be no argument about rounding.
    const mid = closedFrames[seg * spp + Math.floor(spp / 2)];
    if (segmentStartId(closedPath, mid) !== closedPath.nodes[seg].id) wrongSegment += 1;
  }
  check('every frame maps back to the node its segment starts at', wrongSegment === 0, `${wrongSegment} of ${segCount} wrong`);
  check(
    'a frame right on a node belongs to the segment leaving it',
    segmentStartId(closedPath, closedFrames[3 * spp]) === closedPath.nodes[3].id,
  );
  check(
    'the last segment of a loop wraps back to the last node',
    segmentStartId(closedPath, closedFrames[closedFrames.length - 1]) === closedPath.nodes[segCount - 1].id,
  );
  check(
    'a t of exactly 1 does not run off the end of a loop',
    segmentStartId(closedPath, { ...closedFrames[0], t: 1 }) === closedPath.nodes[0].id,
  );

  const openPath = { closed: false, nodes: p.pit.nodes.map((n) => ({ ...n, p: [...n.p] })) };
  const openFrames = computeFrames(openPath, spp);
  check(
    'an open path clamps its very last frame to the last real segment',
    segmentStartId(openPath, openFrames[openFrames.length - 1]) === openPath.nodes[openPath.nodes.length - 2].id,
    `t ${openFrames[openFrames.length - 1].t}`,
  );
  check(
    'and the pit lane maps its segments too',
    segmentStartId(openPath, openFrames[2 * spp + Math.floor(spp / 2)]) === openPath.nodes[2].id,
  );

  /* Merged pit frames keep `t`, which is what makes the pit lane insertable. */
  {
    const merged = mergePitFrames(computeFrames(p.pit, spp), frames, p.road.pitGap);
    check(
      'merging the pit lane onto the road keeps the curve parameter',
      merged.frames.every((f, i) => f.t === openFrames[i].t),
    );
  }

  /* addNode through the real store, including history. */
  {
    const fresh = defaultProject();
    useEditor.setState({ project: fresh, past: [], future: [], selection: null });
    const store = useEditor.getState();
    const anchor = fresh.track.nodes[4];
    // Something to inherit that the last node in the list does not have.
    store.commit((pr) => {
      pr.track.nodes[4].widthL = 13.5;
      pr.track.nodes[4].runoffR = 0.25;
    });

    const before = useEditor.getState().project.track.nodes.length;
    const id = store.addNode('track', new THREE.Vector3(1, 2, 3), anchor.id);
    const after = useEditor.getState().project.track.nodes;

    check('addNode hands back the id of the new point', typeof id === 'string' && id.length > 0, `got ${id}`);
    check('the new point lands right after its anchor', after[5].id === id, after.slice(3, 7).map((n) => n.id).join(','));
    check('and the list grew by exactly one', after.length === before + 1, `${after.length}`);
    check(
      'the new point copies the stretch it was inserted into',
      after[5].widthL === 13.5 && after[5].runoffR === 0.25,
      `widthL ${after[5].widthL}, runoffR ${after[5].runoffR}`,
    );
    check('it sits where it was asked to', after[5].p.join(',') === '1,2,3');

    useEditor.getState().undo();
    check('one undo removes it again', useEditor.getState().project.track.nodes.length === before);

    /* An id that no longer exists must append, not splice at the front. */
    const stale = useEditor.getState();
    const staleId = stale.addNode('track', new THREE.Vector3(9, 0, 9), 'gone-forever');
    const list = useEditor.getState().project.track.nodes;
    check('a stale anchor appends instead of jumping to the front', list[list.length - 1].id === staleId, `index ${list.findIndex((n) => n.id === staleId)} of ${list.length}`);

    /* No anchor at all is still a plain append, the way the draw tools use it. */
    const appended = useEditor.getState().addNode('track', new THREE.Vector3(-9, 0, -9));
    const list2 = useEditor.getState().project.track.nodes;
    check('without an anchor it appends', list2[list2.length - 1].id === appended);
  }
}

/* ------------------------------------------------------------------ */
/* Placing objects                                                     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Object library                                                      */
/* ------------------------------------------------------------------ */

console.log('\nObject library');
{
  const empty = LIBRARY.filter((d) => propParts(d.key).length === 0);
  check('every library object builds at least one part', empty.length === 0, empty.map((d) => d.key).join(','));

  const flat = LIBRARY.filter((d) => {
    const f = propFootprint(d.key);
    return !(f.hx > 0 && f.hz > 0) || !Number.isFinite(f.cx) || !Number.isFinite(f.cz);
  });
  check('and covers a measurable patch of ground', flat.length === 0, flat.map((d) => d.key).join(','));

  // Everything is authored with its origin on the ground, so nothing may float
  // and only rocks and bushes are allowed to be half buried on purpose.
  let floating = [];
  let sunken = [];
  for (const d of LIBRARY) {
    let minY = Infinity;
    for (const part of propParts(d.key)) {
      part.geometry.computeBoundingBox();
      minY = Math.min(minY, part.geometry.boundingBox.min.y);
    }
    if (minY > 0.05) floating.push(`${d.key} ${minY.toFixed(2)}`);
    // Nature is allowed to sit half in the ground, and a ground pad reaches
    // below it on purpose so a slope shows no gap under the slab.
    const allowance = d.category === 'Nature' ? 0.6 : d.category === 'Ground' ? 0.4 : 0.05;
    if (minY < -allowance) sunken.push(`${d.key} ${minY.toFixed(2)}`);
  }
  check('nothing hovers above the ground it is dropped on', floating.length === 0, floating.join(','));
  check('and nothing is buried in it', sunken.length === 0, sunken.join(','));

  // The tile box is what makes modules tile, so the advertised lengths have to
  // be the measured ones -- exactly, not roughly. An armco whose end posts
  // stuck out to 8.12 m tiled on a pitch no snap step divides.
  check(
    'the armco module really is 8 m long',
    Math.abs(propTileBox('armco').hz * 2 - 8) < 1e-6,
    `${(propTileBox('armco').hz * 2).toFixed(4)} m`,
  );
  check(
    'the debris fence really is 8 m long',
    Math.abs(propTileBox('fence').hz * 2 - 8) < 1e-6,
    `${(propTileBox('fence').hz * 2).toFixed(4)} m`,
  );
  check(
    'the tyre wall really is 6 m long',
    Math.abs(propTileBox('tyre_wall').hz * 2 - 6) < 1e-6,
    `${(propTileBox('tyre_wall').hz * 2).toFixed(4)} m`,
  );
  check(
    'the concrete barrier really is 3 m long',
    Math.abs(propTileBox('concrete_barrier').hz * 2 - 3) < 1e-6,
    `${(propTileBox('concrete_barrier').hz * 2).toFixed(3)} m`,
  );
  check(
    'the boundary fence really is 8 m long',
    Math.abs(propTileBox('fence_mesh').hz * 2 - 8) < 1e-6,
    `${(propTileBox('fence_mesh').hz * 2).toFixed(4)} m`,
  );
  check(
    'and the pit wall 4 m',
    Math.abs(propTileBox('pit_wall').hz * 2 - 4) < 1e-6,
    `${(propTileBox('pit_wall').hz * 2).toFixed(4)} m`,
  );

  /*
   * A catch fence is not a flat board. What makes one recognisable is the top
   * metre angled back over the circuit, so anything thrown at it drops back
   * inside -- and the model had none of it.
   */
  {
    let top = -Infinity;
    let topX = 0;
    let height = 0;
    for (const part of propParts('fence')) {
      part.geometry.computeBoundingBox();
      const b = part.geometry.boundingBox;
      height = Math.max(height, b.max.y);
      if (b.max.y > top) {
        top = b.max.y;
        topX = (b.min.x + b.max.x) / 2;
      }
    }
    check('the debris fence stands about four metres', height > 3.8 && height < 5.5, `${height.toFixed(2)} m`);
    check('and its top leans out over the track side',
      topX < -0.15, `topmost part sits at x ${topX.toFixed(2)}`);
    const foot = propFootprint('fence');
    check('while its foot stays where a barrier can be lined up',
      foot.hz * 2 <= 8.1, `${(foot.hz * 2).toFixed(3)} m`);
  }

  /*
   * A budget guard, after a track of 2444 objects turned into a million
   * triangles in the exported kn5.
   *
   * The ceiling is set by the tyre wall at 1008: twenty one tyres in one 6 m
   * module, and there is no honest way to make a tyre wall out of fewer tyres.
   * Everything else is well under -- a broadleaf tree, the next worst, is 624
   * because its crown is three spheres. The point of the number is that nothing
   * NEW slips in an order of magnitude above the rest without somebody deciding
   * to; if a new object needs more than this, that is a conversation, not a
   * quiet commit.
   */
  {
    const heavy = [];
    let worst = { key: '', tris: 0 };
    for (const d of LIBRARY) {
      let tris = 0;
      for (const part of propParts(d.key)) {
        const g = part.geometry;
        tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      }
      if (tris > worst.tris) worst = { key: d.key, tris };
      if (tris > 1100) heavy.push(`${d.key} ${tris}`);
    }
    check('no library object costs more than 1100 triangles', heavy.length === 0, heavy.join(', '));
    check('and the dearest of them is still the tyre wall',
      worst.key === 'tyre_wall', `${worst.key} at ${worst.tris}`);
  }

  /* Everything that tiles has to do so on whole metres and about its own
     origin, or the grid and the flush position can never be the same place --
     which is what made a 1 m grid useless for lining buildings up. */
  {
    const bad = [];
    const off = [];
    const whole = (v) => Math.abs(v - Math.round(v)) < 1e-6;
    for (const d of LIBRARY) {
      const rule = tileRuleOf(d.key);
      if (!rule) continue;
      const f = propTileBox(d.key);
      // A building tiles both ways, so both sides have to land on the grid.
      // A barrier only ever carries on end to end; how thick the rail is has
      // nothing to do with where the next module starts.
      if (rule === 'grid' && (!whole(f.hx * 2) || !whole(f.hz * 2))) {
        bad.push(`${d.key} ${(f.hx * 2).toFixed(3)}x${(f.hz * 2).toFixed(3)}`);
      }
      const offAxis = rule === 'grid' ? Math.max(Math.abs(f.cx), Math.abs(f.cz)) : Math.abs(f.cz);
      if (offAxis > 1e-6) off.push(`${d.key} ${f.cx.toFixed(3)},${f.cz.toFixed(3)}`);
    }
    check('every building and pad tiles on whole metres', bad.length === 0, bad.join(' '));
    check('and every tiling body is centred on its own origin', off.length === 0, off.join(' '));
  }

  /* The visible shape may overhang the body, never the other way round. */
  {
    const inverted = [];
    for (const d of LIBRARY) {
      const b = propFootprint(d.key);
      const t = propTileBox(d.key);
      if (t.hx > b.hx + 1e-6 || t.hz > b.hz + 1e-6) inverted.push(d.key);
    }
    check('the tile box never sticks out past the object itself', inverted.length === 0, inverted.join(','));
  }

  // The house roof used to be a four segment cone of radius 6.6, whose corners
  // reached 9.3 m out along the diagonals over an 8 x 7 m house. A pitched roof
  // built the right way overhangs by a few centimetres of eaves.
  check(
    'the house roof covers the house instead of the garden',
    propFootprint('house').hx <= 4.6 && propFootprint('house').hz <= 4.1,
    `${(propFootprint('house').hx * 2).toFixed(2)} x ${(propFootprint('house').hz * 2).toFixed(2)} m over an 8 x 7 m house`,
  );
  check(
    'and the cottage is roofed the same way',
    propFootprint('house_3').hx <= 3.4,
    `${propFootprint('house_3').hx.toFixed(2)}`,
  );
  // Exactly 8 m, roof included, or a row of them cannot tile.
  check(
    'a pit garage bay is exactly 8 m wide, roof and all',
    propFootprint('garage_bay').hx === 4,
    `${(propFootprint('garage_bay').hx * 2).toFixed(6)} m`,
  );
}

/* ------------------------------------------------------------------ */
/* Snapping objects against each other                                 */
/* ------------------------------------------------------------------ */

console.log('\nSnapping objects together');
{
  const yq = (deg) =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));

  const inst = (id, kind, x, z, rot = 0) => ({
    id,
    kind,
    name: id,
    p: [x, 0, z],
    r: [0, rot, 0],
    s: [1, 1, 1],
    ground: true,
  });

  /** Where the tile box centre of a placed object ends up in world space. */
  const centreOf = (kind, x, z, rot) => {
    const f = tileBoxOf(kind);
    const v = new THREE.Vector3(f.cx, 0, f.cz).applyQuaternion(yq(rot));
    return new THREE.Vector3(x + v.x, 0, z + v.z);
  };

  /**
   * Gap between the two touching edges, measured in the anchor's own frame.
   * Zero means flush; positive is a stripe of grass, negative is an overlap.
   */
  const edgeGap = (anchor, kind, x, z, rot, along) => {
    const d = centreOf(kind, x, z, rot)
      .sub(centreOf(anchor.kind, anchor.p[0], anchor.p[2], anchor.r[1]))
      .applyQuaternion(yq(anchor.r[1]).invert());
    const fa = tileBoxOf(anchor.kind);
    const fb = tileBoxOf(kind);
    return along === 'x'
      ? { gap: Math.abs(d.x) - (fa.hx + fb.hx), sideways: d.z }
      : { gap: Math.abs(d.z) - (fa.hz + fb.hz), sideways: d.x };
  };

  check('buildings and barriers know which rules they play by', tileRuleOf('garage') === 'grid' && tileRuleOf('armco') === 'row');
  check('trees and imported models play by none', tileRuleOf('tree_pine') === null && tileRuleOf('asset:whatever') === null);
  check('ground patches tile too', tileRuleOf('pad_asphalt') === 'grid');
  check('and so do whole prefabs', tileRuleOf('prefab:pit_complex') === 'grid');

  const hx = tileBoxOf('garage').hx;

  /* Side by side, dropped a bit short of flush. */
  {
    const anchor = inst('a', 'garage', 0, 0);
    const hit = nearestFlush('garage', 2 * hx - 1.2, 0.4, 0, UNIT_SCALE, [anchor]);
    check('a building latches onto the one beside it', hit !== null && hit.neighborId === 'a');
    const m = edgeGap(anchor, 'garage', hit.x, hit.z, hit.rotY, 'x');
    check('and ends up exactly flush against it', Math.abs(m.gap) < 1e-6, `gap ${m.gap.toExponential(2)} m`);
    check('with no sideways drift', Math.abs(m.sideways) < 1e-6, `${m.sideways.toExponential(2)} m`);
    check('and squared up with it', hit.rotY === 0, `${hit.rotY}`);
  }

  /* Three metres out is a deliberate gap, not a near miss. */
  {
    const anchor = inst('a', 'garage', 0, 0);
    check('three metres away it is left alone', nearestFlush('garage', 2 * hx + 3, 0, 0, UNIT_SCALE, [anchor]) === null);
  }

  /* A crooked neighbour is still a neighbour. */
  {
    const anchor = inst('a', 'garage', 40, -25, 37);
    const ideal = centreOf('garage', 40, -25, 37).add(new THREE.Vector3(2 * hx, 0, 0).applyQuaternion(yq(37)));
    const f = propFootprint('garage');
    const back = new THREE.Vector3(f.cx, 0, f.cz).applyQuaternion(yq(37));
    // Aimed roughly at the slot, a little off in both position and heading.
    const hit = nearestFlush('garage', ideal.x - back.x + 0.6, ideal.z - back.z - 0.5, 41, UNIT_SCALE, [anchor]);
    check('a turned neighbour is snapped to just the same', hit !== null);
    const m = edgeGap(anchor, 'garage', hit.x, hit.z, hit.rotY, 'x');
    check('and the join is still flush', Math.abs(m.gap) < 1e-6 && Math.abs(m.sideways) < 1e-6, `gap ${m.gap.toExponential(2)}, sideways ${m.sideways.toExponential(2)}`);
    check('the copy takes the heading of what it joined', Math.abs(hit.rotY - 37) < 1e-9, `${hit.rotY}`);
  }

  /* Dragging an object must never snap it to where it already is. */
  {
    const self = inst('self', 'garage', 0, 0);
    const neighbour = inst('n', 'garage', 2 * hx, 0);
    check(
      'an object never snaps to itself',
      nearestFlush('garage', 0.3, 0, 0, UNIT_SCALE, [self], 'self') === null,
    );
    check(
      'but it still finds the others',
      nearestFlush('garage', 0.3, 0, 0, UNIT_SCALE, [self, neighbour], 'self')?.neighborId === 'n',
    );
  }

  /* Barriers are a length of fence: they only carry on where the last stopped. */
  {
    const hz = tileBoxOf('armco').hz;
    const anchor = inst('a', 'armco', 0, 0);
    const hit = nearestFlush('armco', 0.3, 2 * hz - 1, 0, UNIT_SCALE, [anchor]);
    check('barriers join end to end', hit !== null && Math.abs(hit.z - 2 * hz) < 1e-9, `z ${hit?.z.toFixed(3)}, wanted ${(2 * hz).toFixed(3)}`);
    const m = edgeGap(anchor, 'armco', hit.x, hit.z, hit.rotY, 'z');
    check('with no gap in the run', Math.abs(m.gap) < 1e-6 && Math.abs(m.sideways) < 1e-6, `gap ${m.gap.toExponential(2)}`);
    check(
      'and never shoulder to shoulder',
      nearestFlush('armco', 1.4, 0, 0, UNIT_SCALE, [anchor]) === null,
    );
  }

  /* Different sorts of thing do not line up with each other. */
  {
    const anchor = inst('a', 'armco', 0, 0);
    check('a building does not latch onto a barrier', nearestFlush('garage', 1, 0, 0, UNIT_SCALE, [anchor]) === null);
    check('and a tree latches onto nothing at all', nearestFlush('tree_pine', 1, 0, 0, UNIT_SCALE, [inst('b', 'tree_round', 0, 0)]) === null);
  }

  /* The complaint that started this: the grid must not eat the catch radius.
     Rounding the cursor BEFORE asking about neighbours displaced the query by
     up to snap/2*sqrt(2), which is the whole 2 m budget once the step reaches
     5 m -- so at 5 and 10 m the snap silently stopped working and the object
     was committed two metres short of its neighbour. */
  {
    const anchor = inst('a', 'garage', 0, 0);
    for (const snap of [0, 1, 5, 10]) {
      const hit = resolvePlacement({
        kind: 'garage',
        x: 2 * hx + 0.3,
        z: 0.2,
        rotY: 0,
        props: [anchor],
        snap,
      });
      const m = edgeGap(anchor, 'garage', hit.x, hit.z, hit.rotY, 'x');
      check(
        `aimed 30 cm short at snap ${snap} m it still lands flush`,
        hit.rule === 'flush' && Math.abs(m.gap) < 1e-6,
        `rule ${hit.rule}, gap ${m.gap.toFixed(4)} m`,
      );
    }
  }

  /* Grid only decides where no neighbour is within reach, and says so. */
  {
    const hit = resolvePlacement({ kind: 'garage', x: 103.4, z: -47.8, rotY: 0, props: [], snap: 5 });
    check('an object on its own lands on the grid', hit.rule === 'grid' && hit.x === 105 && hit.z === -50, `${hit.rule} ${hit.x},${hit.z}`);
    const free = resolvePlacement({ kind: 'garage', x: 103.4, z: -47.8, rotY: 0, props: [], snap: 0 });
    check('and with the grid off it lands where it was asked', free.rule === 'free' && free.x === 103.4);
    const exact = resolvePlacement({ kind: 'garage', x: 1.3, z: 0.2, rotY: 0, props: [inst('a', 'garage', 0, 0)], snap: 1, exact: true });
    check('Alt overrides every rule', exact.rule === 'free' && exact.x === 1.3 && exact.z === 0.2);
  }

  /* Prefabs latch onto each other, which they could not do at all while the
     rule was a category test and a prefab key was not in the library. */
  {
    const complex = tileBoxOf('prefab:pit_complex');
    check('a pit complex has a measurable tile box', complex.hx > 0 && complex.hz > 0, `${complex.hx * 2} x ${complex.hz * 2}`);
    check(
      'and it is a whole number of metres',
      Math.abs(complex.hx * 2 - Math.round(complex.hx * 2)) < 1e-6,
      `${(complex.hx * 2).toFixed(4)} m wide`,
    );

    useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null, placeRotation: 0 });
    useEditor.getState().placePrefab('pit_complex', new THREE.Vector3(0, 0, 0), 0);
    const placed = useEditor.getState().project.props;
    const hit = resolvePlacement({
      kind: 'prefab:pit_complex',
      x: complex.hx * 2 + 0.7,
      z: 0.3,
      rotY: 0,
      props: placed,
      snap: 1,
    });
    check('a second complex latches onto the first', hit.rule === 'flush', hit.rule);
    check(
      'and lands exactly one complex width along, dead level with it',
      Math.abs(hit.x - complex.hx * 2) < 1e-6 && Math.abs(hit.z) < 1e-6,
      `${hit.x.toFixed(4)}, ${hit.z.toFixed(4)} (wanted ${(complex.hx * 2).toFixed(4)}, 0)`,
    );

    /* And the seam between the two really is closed, piece by piece. */
    useEditor.getState().placePrefab('pit_complex', new THREE.Vector3(hit.x, 0, hit.z), 0);
    const all = useEditor.getState().project.props;
    const bays = all.filter((p) => p.kind === 'garage_bay').map((p) => p.p[0]).sort((a, b) => a - b);
    const pitch = propTileBox('garage_bay').hx * 2;
    let worstBay = 0;
    for (let i = 1; i < bays.length; i++) worstBay = Math.max(worstBay, Math.abs(bays[i] - bays[i - 1] - pitch));
    check('the two complexes form one unbroken row of bays', worstBay < 1e-6, `worst step ${worstBay.toFixed(4)} m`);

    const buildings = all.filter((p) => p.kind === 'pit_building').map((p) => p.p[0]).sort((a, b) => a - b);
    check(
      'and their pit buildings meet without a gap or an overlap',
      Math.abs(buildings[1] - buildings[0] - propTileBox('pit_building').hx * 2) < 1e-6,
      `${(buildings[1] - buildings[0]).toFixed(4)} m apart`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Ground patches: stretched, aimed and dragged out                    */
/* ------------------------------------------------------------------ */

/*
 * The complaint this block exists for: two slabs of concrete between the pit
 * lane and the boxes could not be made to meet, however carefully they were
 * aimed. A patch is the one thing in the library with a separate width and
 * length, and the snapper took ONE scale and put it on both half extents --
 * and the place tool did not pass a scale at all, so it reasoned about the
 * unstretched 10 m square while a 120 x 14 m slab was going down. Every number
 * below is measured on the boxes that are really stored.
 */
console.log('\nGround patches');
{
  const yq2 = (deg) =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));

  /** A patch instance of w x l metres. */
  const pad = (id, x, z, rot, w, l, kind = 'pad_concrete') => ({
    id, kind, name: id,
    p: [x, 0, z],
    r: [0, rot, 0],
    s: [w / PAD_SIZE, 1, l / PAD_SIZE],
    ground: true,
  });

  /**
   * Gap between two patches along one of their shared axes, metres.
   * Zero is flush, positive is a stripe of grass, negative an overlap.
   */
  const padGap = (a, b, along) => {
    const f = propTileBox(a.kind);
    const ca = new THREE.Vector3(f.cx * a.s[0], 0, f.cz * a.s[2]).applyQuaternion(yq2(a.r[1]));
    const fb2 = propTileBox(b.kind);
    const cb = new THREE.Vector3(fb2.cx * b.s[0], 0, fb2.cz * b.s[2]).applyQuaternion(yq2(b.r[1]));
    const d = new THREE.Vector3(b.p[0] + cb.x - a.p[0] - ca.x, 0, b.p[2] + cb.z - a.p[2] - ca.z)
      .applyQuaternion(yq2(a.r[1]).invert());
    return along === 'x'
      ? { gap: Math.abs(d.x) - (f.hx * a.s[0] + fb2.hx * b.s[0]), sideways: d.z }
      : { gap: Math.abs(d.z) - (f.hz * a.s[2] + fb2.hz * b.s[2]), sideways: d.x };
  };

  check('a patch scale is its size in metres over the 10 m square',
    padScale('pad_concrete', 40, 25).x === 4 && padScale('pad_concrete', 40, 25).z === 2.5);
  check('and anything that is not a patch stays unstretched',
    padScale('garage', 40, 25) === UNIT_SCALE);

  /* Side by side, both stretched, and stretched differently. */
  {
    const anchor = pad('a', 0, 0, 0, 40, 25);
    const scale = padScale('pad_concrete', 12, 8);
    // Flush would put its centre 20 + 6 = 26 m along; aim 70 cm short of that.
    const hit = resolvePlacement({
      kind: 'pad_concrete', x: 25.3, z: 0.4, rotY: 0, props: [anchor], snap: 0, scale,
    });
    check('a stretched patch latches onto a stretched neighbour', hit.rule === 'flush', hit.rule);
    const placed = pad('b', hit.x, hit.z, hit.rotY, 12, 8);
    const m = padGap(anchor, placed, 'x');
    check('and the two meet with no seam at all', Math.abs(m.gap) < 1e-9, `gap ${m.gap.toExponential(2)} m`);
    check('with no sideways drift', Math.abs(m.sideways) < 1e-9, `${m.sideways.toExponential(2)} m`);
  }

  /*
   * The user's own geometry: two 120 x 14 m slabs of concrete along a pit lane
   * that came out of the spline at 9.454 degrees. This is the case that could
   * not be closed by hand at any zoom level.
   */
  {
    const heading = 9.454;
    const anchor = pad('a', -51.524, -97.452, heading, 120, 14);
    const scale = padScale('pad_concrete', 120, 14);
    // Where the next one along the lane belongs, then thrown off by a metre.
    const along = new THREE.Vector3(0, 0, 14).applyQuaternion(yq2(heading));
    const hit = resolvePlacement({
      kind: 'pad_concrete',
      x: anchor.p[0] + along.x + 0.8,
      z: anchor.p[2] + along.z - 0.6,
      rotY: heading + 1.2,
      props: [anchor],
      snap: 5,
      scale,
    });
    check('a 120 x 14 m slab latches end on at a crooked heading', hit.rule === 'flush', hit.rule);
    check('and takes the neighbour heading exactly', Math.abs(hit.rotY - heading) < 1e-9, `${hit.rotY}`);
    const placed = pad('b', hit.x, hit.z, hit.rotY, 120, 14);
    const m = padGap(anchor, placed, 'z');
    check('and butts up against it with a 0 m joint', Math.abs(m.gap) < 1e-9, `gap ${m.gap.toExponential(2)} m`);
    check('dead level with it, not offset along the slab',
      Math.abs(m.sideways) < 1e-9, `${m.sideways.toExponential(2)} m`);

    /* And the regression itself: one scale for both axes measures a slab that
       was never placed, and lands it nowhere near the neighbour. */
    const square = resolvePlacement({
      kind: 'pad_concrete',
      x: anchor.p[0] + along.x + 0.8,
      z: anchor.p[2] + along.z - 0.6,
      rotY: heading,
      props: [anchor],
      snap: 5,
    });
    const wrong = padGap(anchor, pad('c', square.x, square.z, square.rotY, 120, 14), 'z');
    check('asking with the unstretched square gets it wrong, as it always did',
      Math.abs(wrong.gap) > 1, `gap ${wrong.gap.toFixed(2)} m`);
  }

  /* Aiming a patch along the road rather than at a slider position. */
  {
    useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null, placeRotation: 0 });
    const derived = getDerived(useEditor.getState().project);

    const frames = derived.pitFrames;
    const f = frames[Math.floor(frames.length / 2)];
    const index = new PointIndex(frames.map((q) => q.pos), 25);
    const heading = pathHeadingAt(f.pos.x, f.pos.z, frames, index);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(yq2(heading.heading));
    check('a path heading turns local +Z onto the way the road runs',
      Math.abs(facing.x - f.fwd.x) < 1e-6 && Math.abs(facing.z - f.fwd.z) < 1e-6,
      `${facing.x.toFixed(6)},${facing.z.toFixed(6)} vs ${f.fwd.x.toFixed(6)},${f.fwd.z.toFixed(6)}`);

    check('the long side goes along the road, whichever side that is',
      alignedHeading('pad_concrete', padScale('pad_concrete', 40, 12), 30) === 300
        && alignedHeading('pad_concrete', padScale('pad_concrete', 12, 40), 30) === 30);

    /* Standing 12 m to the side of the pit lane, which is where the concrete
       between the lane and the boxes goes. */
    const beside = { x: f.pos.x + f.right.x * 12, z: f.pos.z + f.right.z * 12 };
    useEditor.setState({ placeKind: 'pad_concrete', padSize: { w: 40, l: 12 } });
    const aligned = alignmentAt(beside);
    check('the nearest road to a point beside the pit lane is the pit lane',
      aligned !== null && aligned.path === 'pit', `${aligned?.path}`);

    // 40 x 12 means the width is the long side, so it is +X that has to end up
    // parallel with the lane.
    const longAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(yq2(aligned.rotY));
    const cross = Math.abs(longAxis.x * f.fwd.z - longAxis.z * f.fwd.x);
    check('and the slab ends up exactly parallel with it', cross < 1e-6, `cross ${cross.toExponential(2)}`);

    /* Off square to begin with, which is the state the action is for. Pressed
       when the tool is ALREADY square it deliberately turns the object round
       instead -- "along the road" has two answers and one press gives the other
       -- so starting at the answer tested the wrong half of the function, and
       said so the moment the default rotation and this heading agreed. */
    useEditor.setState({ placeRotation: 12.5 });
    const msg = alignPlacementToPath(beside);
    check('the action turns the place tool and says what it did',
      Math.abs(useEditor.getState().placeRotation - aligned.rotY) < 1e-9 && /pit lane/.test(msg), msg);
    const again = alignPlacementToPath(beside);
    check('and pressing it again faces the object the other way along the road',
      Math.abs(((useEditor.getState().placeRotation - aligned.rotY - 180) % 360 + 360) % 360) < 1e-9
      && /other way/.test(again), again);
    check('and it says so rather than nothing when there is no pointer yet',
      /Point at the ground/.test(alignPlacementToPath()));
  }

  /* Pulling one out with the pointer. */
  {
    const heading = 9.454;
    const a = new THREE.Vector3(10, 0, -20);
    const b = new THREE.Vector3(10, 0, -20)
      .add(new THREE.Vector3(30, 0, 18).applyQuaternion(yq2(heading)));
    const rect = rectFromDrag(a.x, a.z, b.x, b.z, heading);
    check('a dragged rectangle is measured in the frame it was aimed at',
      Math.abs(rect.w - 30) < 1e-9 && Math.abs(rect.l - 18) < 1e-9,
      `${rect.w.toFixed(4)} x ${rect.l.toFixed(4)} m`);
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    check('and centred between the two corners',
      Math.abs(rect.x - mid.x) < 1e-9 && Math.abs(rect.z - mid.z) < 1e-9);

    /* A corner dropped near a neighbour's edge is pulled onto it, per axis. */
    const anchor = pad('a', -51.524, -97.452, heading, 120, 14);
    const edge = new THREE.Vector3(0, 0, 7).applyQuaternion(yq2(heading));
    const near = { x: anchor.p[0] + edge.x + 0.35, z: anchor.p[2] + edge.z + 0.35 };
    const snappedCorner = snapCornerToPads(near.x, near.z, heading, [anchor]);
    check('a dragged corner latches onto a neighbouring edge', snappedCorner.onEdgeZ);

    /* End to end: drag a 30 m strip off that edge and measure the joint. */
    const far = new THREE.Vector3(anchor.p[0], 0, anchor.p[2])
      .add(new THREE.Vector3(-40, 0, 7 + 30).applyQuaternion(yq2(heading)));
    const farCorner = snapCornerToPads(far.x, far.z, heading, [anchor]);
    const strip = rectFromDrag(snappedCorner.x, snappedCorner.z, farCorner.x, farCorner.z, heading);
    const dragged = pad('b', strip.x, strip.z, heading, strip.w, strip.l);
    const joint = padGap(anchor, dragged, 'z');
    check('a patch dragged off a neighbour edge meets it with no seam',
      Math.abs(joint.gap) < 1e-9, `gap ${joint.gap.toExponential(2)} m`);

    /* A neighbour lying at a different angle offers no edge worth latching to,
       because no rectangle at this heading could ever be flush with it. */
    const crooked = pad('c', anchor.p[0] + edge.x + 0.35, anchor.p[2] + edge.z + 0.35, heading + 30, 120, 14);
    const missed = snapCornerToPads(near.x, near.z, heading, [crooked]);
    check('a crooked neighbour offers no edge at all',
      !missed.onEdgeX && !missed.onEdgeZ && missed.x === near.x);

    /* Buildings tile on the same grid, so their edges are on offer too --
       running concrete up to the front of the garages is the same job. */
    {
      const bay = { id: 'g', kind: 'garage_bay', name: 'g', p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], ground: true };
      const fb3 = propTileBox('garage_bay');
      const onBay = snapCornerToPads(fb3.cx + fb3.hx + 0.4, fb3.cz - fb3.hz - 0.3, 0, [bay]);
      check('a corner latches onto a garage front as readily as onto concrete',
        onBay.onEdgeX && onBay.onEdgeZ
          && Math.abs(onBay.x - (fb3.cx + fb3.hx)) < 1e-9
          && Math.abs(onBay.z - (fb3.cz - fb3.hz)) < 1e-9,
        `${onBay.x.toFixed(4)}, ${onBay.z.toFixed(4)}`);
      check('but a barrier, which only ever runs end to end, offers none',
        !snapCornerToPads(0.3, 0.3, 0, [{ ...bay, id: 'w', kind: 'armco' }]).onEdgeX);
    }

    /* Dropping one with the store, at the size the panel holds. */
    useEditor.setState({
      project: defaultProject(), past: [], future: [], selection: null,
      placeRotation: heading, placeKind: 'pad_concrete', padSize: { w: 46, l: 17 },
    });
    useEditor.getState().addProp('pad_concrete', new THREE.Vector3(0, 0, 0));
    const dropped = useEditor.getState().project.props.at(-1);
    check('a plain click drops a patch at the size the panel shows',
      Math.abs(dropped.s[0] * PAD_SIZE - 46) < 1e-9 && Math.abs(dropped.s[2] * PAD_SIZE - 17) < 1e-9,
      `${(dropped.s[0] * PAD_SIZE).toFixed(2)} x ${(dropped.s[2] * PAD_SIZE).toFixed(2)} m`);
    useEditor.getState().addProp('pad_concrete', new THREE.Vector3(0, 0, 0), heading, [2, 1, 3]);
    const explicit = useEditor.getState().project.props.at(-1);
    check('and a dragged one keeps the size the drag decided',
      explicit.s[0] === 2 && explicit.s[2] === 3);
    useEditor.getState().addProp('garage', new THREE.Vector3(0, 0, 0));
    check('while the patch size leaves everything else alone',
      useEditor.getState().project.props.at(-1).s.join(',') === '1,1,1');
  }
}

/* ------------------------------------------------------------------ */
/* Prefab seams                                                        */
/* ------------------------------------------------------------------ */

console.log('\nPrefab seams');
{
  /* The gap the user actually saw: the pit building and its garage bays were
     spaced by their ROOF boxes, so their walls stood half a metre apart down
     the entire 40 m length. Measured on the bodies now.

     The bays moved from the back of the building to its front -- the pit lane
     side, where the doors belong -- so the seam being checked is the building's
     FRONT face against the bays' backs. */
  const parts = PREFABS_BY_KEY.get('pit_complex').parts;
  const building = parts.find((p) => p.kind === 'pit_building');
  const bays = parts.filter((p) => p.kind === 'garage_bay');

  const fb = propTileBox('pit_building');
  const fg = propTileBox('garage_bay');
  const buildingFront = building.z + fb.cz + fb.hz;
  const bayBack = Math.min(...bays.map((b) => b.z + fg.cz - fg.hz));
  check(
    'the bays sit right against the front of the pit building',
    Math.abs(buildingFront - bayBack) < 1e-6,
    `seam ${(buildingFront - bayBack).toFixed(4)} m`,
  );

  const bayXs = bays.map((b) => b.x).sort((a, b) => a - b);
  let worst = 0;
  for (let i = 1; i < bayXs.length; i++) worst = Math.max(worst, Math.abs(bayXs[i] - bayXs[i - 1] - fg.hx * 2));
  check('and the bays themselves tile with no gap', worst < 1e-6, `worst ${worst.toFixed(4)} m`);

  const rowHalf = (bayXs[bayXs.length - 1] - bayXs[0]) / 2 + fg.hx;
  check(
    'the garage row is exactly as wide as the building it fronts',
    Math.abs(rowHalf - fb.hx) < 1e-6,
    `row ${(rowHalf * 2).toFixed(3)} m vs building ${(fb.hx * 2).toFixed(3)} m`,
  );

  /* Every prefab row, not just this one. */
  for (const def of PREFABS) {
    const byKind = new Map();
    for (const p of def.parts) {
      if (!byKind.has(p.kind)) byKind.set(p.kind, []);
      byKind.get(p.kind).push(p);
    }
    for (const [kind, list] of byKind) {
      if (list.length < 2) continue;
      // Only things that tile have to tile. A car park is several of one kind
      // as well, but parked cars stand on bay markings with air between them;
      // demanding they touch would be demanding the wrong thing. `tileRuleOf`
      // is the same test the placement rules use, so the two cannot drift.
      if (!tileRuleOf(kind)) continue;
      const f = propTileBox(kind);
      const alongX = Math.abs(list[1].x - list[0].x) > Math.abs(list[1].z - list[0].z);
      const pitch = alongX ? f.hx * 2 : f.hz * 2;
      const coords = list.map((p) => (alongX ? p.x : p.z)).sort((a, b) => a - b);
      /*
       * On the pitch, not necessarily next to each other. A run of five armco
       * modules is five in a row, but a grandstand block is an open stand, a
       * covered one and another open stand -- the two open ones are two pitches
       * apart with something else in the gap, which is a tidy row and not a
       * mistake. What must hold is that every module sits on the same grid and
       * none of them overlaps.
       */
      let bad = 0;
      for (let i = 1; i < coords.length; i++) {
        const gap = coords[i] - coords[i - 1];
        if (gap < pitch - 1e-6) bad = Math.max(bad, pitch - gap);
        else bad = Math.max(bad, Math.abs(Math.round(gap / pitch) * pitch - gap));
      }
      check(`${def.key}: its ${kind} modules sit on their own pitch`, bad < 1e-6, `worst ${bad.toFixed(4)} m`);
    }
  }

  /*
   * The car park is the one prefab that is deliberately NOT tiled: cars stand
   * on bay markings with air around them. So it gets its own checks -- an even
   * bay pitch, nothing parked inside anything else, and tarmac big enough to
   * hold the lot.
   */
  {
    useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null, placeRotation: 0 });
    useEditor.getState().placePrefab('car_park', new THREE.Vector3(0, 0, 0), 0);
    const parts = useEditor.getState().project.props;
    const pad = parts.filter((p) => p.kind === 'pad_asphalt');
    const cars = parts.filter((p) => p.kind !== 'pad_asphalt');

    check('a car park is tarmac plus a load of cars', pad.length === 1 && cars.length >= 12,
      `${pad.length} pad, ${cars.length} cars`);
    check('and the tarmac is stretched to metres, not left a 10 m square',
      pad[0].s[0] > 2 && pad[0].s[2] > 1.5 && pad[0].s[1] === 1,
      pad[0].s.join(','));

    // Two banks facing each other across an aisle.
    const facings = new Set(cars.map((c) => Math.round(c.r[1])));
    check('the two banks face each other across the aisle', facings.size === 2 && facings.has(0) && facings.has(180),
      [...facings].join(','));

    // An even pitch along the bays, both banks measured together.
    const bank = cars.filter((c) => Math.round(c.r[1]) === 0).map((c) => c.p[0]).sort((a, b) => a - b);
    let minStep = Infinity;
    let maxStep = 0;
    for (let i = 1; i < bank.length; i++) {
      const d = bank[i] - bank[i - 1];
      minStep = Math.min(minStep, d);
      maxStep = Math.max(maxStep, d);
    }
    check('the bays are evenly spaced', maxStep - minStep < 1e-9, `${minStep.toFixed(2)}..${maxStep.toFixed(2)} m`);
    check('and wide enough for the widest car to open a door',
      minStep > Math.max(...cars.map((c) => propTileBox(c.kind).hx * 2)) + 0.4,
      `${minStep.toFixed(2)} m pitch`);

    // Nothing parked inside anything else, across the aisle included.
    let overlap = null;
    for (let i = 0; i < cars.length && !overlap; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = propTileBox(cars[i].kind);
        const b = propTileBox(cars[j].kind);
        const dx = Math.abs(cars[i].p[0] - cars[j].p[0]);
        const dz = Math.abs(cars[i].p[2] - cars[j].p[2]);
        if (dx < a.hx + b.hx - 1e-6 && dz < a.hz + b.hz - 1e-6) {
          overlap = `${cars[i].name} / ${cars[j].name}`;
          break;
        }
      }
    }
    check('no car is parked inside another', overlap === null, overlap ?? '');

    // The tarmac has to reach under every wheel.
    const half = { x: pad[0].s[0] * PAD_SIZE / 2, z: pad[0].s[2] * PAD_SIZE / 2 };
    const off = cars.filter((c) => {
      const f = propTileBox(c.kind);
      return Math.abs(c.p[0]) + f.hx > half.x || Math.abs(c.p[2]) + f.hz > half.z;
    });
    check('every car stands on the tarmac', off.length === 0,
      off.map((c) => `${c.kind} at ${c.p[0].toFixed(1)},${c.p[2].toFixed(1)} vs ${half.x}x${half.z}`).join('; '));
  }
}

console.log('\nPlacing objects');
{
  useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null, placeRotation: 0 });
  const store = useEditor.getState();

  store.setPlaceRotation(-30);
  check('a heading is normalised into 0..360', useEditor.getState().placeRotation === 330, `${useEditor.getState().placeRotation}`);
  store.setPlaceRotation(390);
  check('and wraps the other way too', useEditor.getState().placeRotation === 30);

  store.setPlaceRotation(45);
  store.addProp('garage', new THREE.Vector3(10, 0, 20));
  const built = useEditor.getState().project.props[0];
  check('a building is placed at the heading it was aimed at', built.r[1] === 45, `${built.r[1]}`);
  check('and where it was aimed', built.p.join(',') === '10,0,20');
  check('and stays glued to the ground', built.ground === true);

  store.addProp('garage', new THREE.Vector3(0, 0, 0), 120);
  check('an explicit heading wins over the tool setting', useEditor.getState().project.props[1].r[1] === 120);

  // Trees keep their random spin: a wood in rows looks planted by a machine.
  const headings = new Set();
  for (let i = 0; i < 12; i++) {
    useEditor.getState().addProp('tree_pine', new THREE.Vector3(i, 0, 0));
    headings.add(useEditor.getState().project.props.at(-1).r[1]);
  }
  check('nature is still turned at random', headings.size > 6 && !headings.has(45), `${headings.size} distinct headings`);
}

/* ------------------------------------------------------------------ */
/* Duplicating in a row                                                */
/* ------------------------------------------------------------------ */

console.log('\nDuplicating in a row');
{
  useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null, placeRotation: 0 });
  const store = useEditor.getState();

  store.addProp('garage', new THREE.Vector3(0, 0, 0), 90);
  const src = useEditor.getState().project.props[0];
  useEditor.getState().duplicateProp(src.id);
  const copy = useEditor.getState().project.props[1];
  const hx = propFootprint('garage').hx;

  // Turned 90Â°, so "sideways" points down -X in the world.
  check(
    'a building copy steps sideways along its own axis',
    Math.abs(copy.p[0] - 0) < 1e-9 && Math.abs(copy.p[2] - -2 * hx) < 1e-9,
    `${copy.p.join(',')}, expected 0,0,${-2 * hx}`,
  );
  check('and lands flush, not overlapping', Math.abs(Math.hypot(copy.p[0] - src.p[0], copy.p[2] - src.p[2]) - 2 * hx) < 1e-9);
  check('it keeps the heading of the original', copy.r[1] === 90);
  check(
    'and does not share its arrays with it',
    copy.r !== src.r && copy.s !== src.s && copy.p !== src.p,
  );

  useEditor.getState().addProp('armco', new THREE.Vector3(100, 0, 0), 0);
  const bar = useEditor.getState().project.props.at(-1);
  useEditor.getState().duplicateProp(bar.id);
  const barCopy = useEditor.getState().project.props.at(-1);
  const hz = tileBoxOf('armco').hz;
  check(
    'a barrier copy carries the run on past its end',
    Math.abs(barCopy.p[0] - 100) < 1e-9 && Math.abs(barCopy.p[2] - 2 * hz) < 1e-9,
    `${barCopy.p.join(',')}`,
  );

  useEditor.getState().addProp('tree_pine', new THREE.Vector3(200, 0, 0));
  const tree = useEditor.getState().project.props.at(-1);
  useEditor.getState().duplicateProp(tree.id);
  const treeCopy = useEditor.getState().project.props.at(-1);
  check(
    'anything else just steps clear of the original',
    Math.hypot(treeCopy.p[0] - tree.p[0], treeCopy.p[2] - tree.p[2]) > 3,
    `${Math.hypot(treeCopy.p[0] - tree.p[0], treeCopy.p[2] - tree.p[2]).toFixed(2)} m`,
  );
}

/* ------------------------------------------------------------------ */
/* Prefabs                                                             */
/* ------------------------------------------------------------------ */

console.log('\nPrefabs');
{
  const yq = (deg) =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));

  for (const def of PREFABS) {
    if (def.parts.length < 2 && def.key !== 'pit_complex') {
      check(`${def.key} has something in it`, false, `${def.parts.length} parts`);
    }
    if (def.parts.some((p) => !LIBRARY_BY_KEY.has(p.kind))) {
      check(`${def.key} only uses objects that exist`, false, def.parts.map((p) => p.kind).join(','));
    }
    if (def.parts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.z))) {
      check(`${def.key} has finite offsets`, false, JSON.stringify(def.parts));
    }
  }
  check('every prefab is well formed', true);
  check('a prefab place key resolves back to its definition', prefabOf('prefab:garage_row')?.key === 'garage_row');
  check('and a plain library key is not mistaken for one', prefabOf('garage') === null && prefabOf('prefab:nope') === null);
  check('the garage row really is three bays', PREFABS_BY_KEY.get('garage_row').parts.length === 3);
  check('and the armco run five modules', PREFABS_BY_KEY.get('armco_run').parts.length === 5);

  /* Rows have to be flush, or the whole point of measuring footprints is lost. */
  {
    const parts = PREFABS_BY_KEY.get('armco_run').parts;
    const hz = tileBoxOf('armco').hz;
    let worst = 0;
    for (let i = 1; i < parts.length; i++) {
      worst = Math.max(worst, Math.abs(Math.abs(parts[i].z - parts[i - 1].z) - 2 * hz));
    }
    check('the modules of a run sit edge to edge', worst < 1e-9, `worst mismatch ${worst.toExponential(2)} m`);
  }
  {
    const parts = PREFABS_BY_KEY.get('garage_row').parts;
    const hx = propFootprint(parts[0].kind).hx;
    let worst = 0;
    for (let i = 1; i < parts.length; i++) {
      worst = Math.max(worst, Math.abs(Math.abs(parts[i].x - parts[i - 1].x) - 2 * hx));
    }
    check('and so do the bays of a garage row', worst < 1e-9, `worst mismatch ${worst.toExponential(2)} m`);
  }

  /* Turning a prefab must move it rigidly, not reshape it. */
  {
    const def = PREFABS_BY_KEY.get('garage_row');
    const flat = instantiatePrefab(def, { x: 0, y: 0, z: 0 }, 0, (i) => `f${i}`);
    const turned = instantiatePrefab(def, { x: 120, y: 3, z: -40 }, 55, (i) => `t${i}`);

    check('instantiating gives one object per part', turned.length === def.parts.length);
    check('with unique ids', new Set(turned.map((p) => p.id)).size === turned.length);
    check('all dropped at the same height', turned.every((p) => p.p[1] === 3));
    check('and all glued to the ground', turned.every((p) => p.ground === true));

    let worst = 0;
    for (let i = 0; i < flat.length; i++) {
      const expect = new THREE.Vector3(flat[i].p[0], 0, flat[i].p[2])
        .applyQuaternion(yq(55))
        .add(new THREE.Vector3(120, 0, -40));
      worst = Math.max(worst, Math.hypot(turned[i].p[0] - expect.x, turned[i].p[2] - expect.z));
    }
    check('turning a prefab moves it as one rigid piece', worst < 1e-9, `worst drift ${worst.toExponential(2)} m`);
    check(
      'and turns every part with it',
      turned.every((p, i) => Math.abs(p.r[1] - (((flat[i].r[1] + 55) % 360) + 360) % 360) < 1e-9),
    );
  }

  /* Through the store: one undo step for the lot. */
  {
    useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null, placeRotation: 0 });
    const before = useEditor.getState().project.props.length;
    useEditor.getState().placePrefab('pit_complex', new THREE.Vector3(10, 0, 10), 20);
    const after = useEditor.getState().project.props;
    const count = PREFABS_BY_KEY.get('pit_complex').parts.length;
    check('placing a prefab adds all of its parts', after.length === before + count, `${after.length - before} of ${count}`);
    check('and selects one of them', useEditor.getState().selection?.kind === 'prop');
    useEditor.getState().undo();
    check('and a single undo takes the whole thing back', useEditor.getState().project.props.length === before);
    useEditor.getState().placePrefab('nonsense', new THREE.Vector3(0, 0, 0), 0);
    check('an unknown prefab key does nothing at all', useEditor.getState().project.props.length === before);
  }

  /* The exporter has to be able to bake everything a prefab can produce. */
  {
    const kinds = new Set(PREFABS.flatMap((d) => d.parts.map((p) => p.kind)));
    let bad = [];
    for (const kind of kinds) {
      const def = LIBRARY_BY_KEY.get(kind);
      for (const part of propParts(kind)) {
        const pos = part.geometry.getAttribute('position');
        if (!pos || !Array.from(pos.array).every(Number.isFinite)) bad.push(kind);
      }
    }
    check('every kind a prefab uses exports as finite geometry', bad.length === 0, bad.join(','));
    // Everything a prefab drops has to be something a car can hit or drive on,
    // so buildExport gives it the 1PROP_ name the physics twin is derived
    // from. Which surface is up to the part: a car park is cars on tarmac, so
    // WALL and ROAD both belong here -- what must never appear is a null,
    // which would leave a solid looking object cars pass straight through.
    const ghosts = [...kinds].filter((k) => LIBRARY_BY_KEY.get(k).surface === null);
    check(
      'and wants collision, which buildExport names 1PROP_ for fix_kn5.py',
      ghosts.length === 0,
      ghosts.join(','),
    );
  }

  /* However the library grows, no renderable prop may ever re-enter the
     physics surface namespace (digit + surfaces.ini KEY): vanilla AC's
     culling drops such meshes depending on the view direction. Collision
     comes from the invisible 1WALL_ duplicates the kn5 writer appends. */
  {
    const keys = [...surfacesIni().matchAll(/KEY=(\w+)/g)].map((m) => m[1]);
    check('surfaces.ini declares the drive-on keys', keys.includes('ROAD') && keys.includes('PIT'), keys.join(','));
    /* And NOT the walls. Declared surfaces are found by casting straight down
       at the ground, which never meets a vertical plane -- a declared WALL is
       a wall the car drives through. AC handles 1WALL_ meshes as collision
       geometry on its own, exactly because no surfaces.ini declares them. */
    check('and keeps WALL out of it, so barriers stay solid', !keys.includes('WALL'), keys.join(','));

    useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null, placeRotation: 0 });
    useEditor.getState().placePrefab('pit_complex', new THREE.Vector3(10, 0, 10), 20);
    useEditor.getState().placePrefab('garage_row', new THREE.Vector3(-60, 0, 40), 0);
    const project = useEditor.getState().project;
    const heights = new Float32Array(project.terrain.res * project.terrain.res);
    const names = propMeshes(project, heights).map((m) => m.name);

    check('the placed prefabs bake into meshes', names.length > 0);
    const offenders = names.filter((n) => keys.some((k) => n.slice(1).startsWith(`${k}_`)));
    check(
      'no prop mesh re-enters the physics surface namespace (popping bug guard)',
      offenders.length === 0,
      offenders.join(','),
    );
    check('collidable props carry the 1PROP_ prefix', names.some((n) => n.startsWith('1PROP_')), names.join(','));
  }

  /*
   * Merging props on the way out.
   *
   * AC pays per mesh, and a wood planted with the scatter brush used to leave
   * one mesh per tree per part: 2444 objects came out as 4713 meshes, against
   * 959 for the whole of Kunos' Magione -- whose trees, five times as many of
   * them, live in 31 meshes. So objects are handed over merged by material,
   * surface and locality. What must NOT change while doing that: the triangles,
   * where they are, which surface they collide as, and the name the physics
   * twin is derived from.
   */
  {
    useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null, placeRotation: 0 });
    const st = () => useEditor.getState();

    /* A little wood in one place, and one tree a long way off. */
    for (let i = 0; i < 40; i++) {
      st().addProp('tree_pine', new THREE.Vector3((i % 8) * 6, 0, Math.floor(i / 8) * 6));
    }
    st().addProp('tree_pine', new THREE.Vector3(900, 0, 900));
    st().addProp('garage', new THREE.Vector3(30, 0, 30));
    st().addProp('pad_asphalt', new THREE.Vector3(40, 0, 20));

    const project = st().project;
    const heights = new Float32Array(project.terrain.res * project.terrain.res);
    const meshes = propMeshes(project, heights);
    const partsPerProp = project.props.reduce((a, p) => a + propParts(p.kind).length, 0);
    const tris = (g) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

    check('merging collapses a wood into a handful of meshes',
      meshes.length < partsPerProp / 4,
      `${meshes.length} meshes for ${partsPerProp} parts across ${project.props.length} objects`);

    /* Not one triangle may go missing on the way. */
    let want = 0;
    for (const inst of project.props) for (const part of propParts(inst.kind)) want += tris(part.geometry);
    let got = 0;
    for (const m of meshes) got += tris(m.geometry);
    check('and not one triangle is lost doing it', got === want, `${got} of ${want}`);

    /* A merge that dropped the per object matrix would keep every triangle and
       pile the whole wood on the origin, which no count above would notice. */
    const all = new THREE.Box3();
    for (const m of meshes) {
      m.geometry.computeBoundingBox();
      all.union(m.geometry.boundingBox);
    }
    check('the merged geometry still stands where the objects do',
      all.min.x < 1 && all.max.x > 890 && all.min.z < 1 && all.max.z > 890,
      `x ${all.min.x.toFixed(1)}..${all.max.x.toFixed(1)}, z ${all.min.z.toFixed(1)}..${all.max.z.toFixed(1)}`);

    /* Locality: the far tree cannot share a mesh with the wood, or AC would
       have to draw the whole map to show one of them. */
    const pineMeshes = meshes.filter((m) => m.name.includes('prop_darkgreen'));
    check('an object far away gets a mesh of its own', pineMeshes.length >= 2,
      pineMeshes.map((m) => m.name).join(','));
    const widest = pineMeshes
      .map((m) => {
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox;
        return { name: m.name, span: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) };
      })
      .sort((a, b) => b.span - a.span)[0];
    check('and no merged mesh spans half the map', widest.span < 400,
      `${widest.name} is ${widest.span.toFixed(0)} m across`);

    /* Surfaces may not be mixed into one group, or the physics twin would
       collide as the wrong material -- or cover meshes that need none. */
    const bySurface = new Map();
    for (const m of meshes) {
      const prefix = m.surface ? `1PROP_${m.surface}_` : '1OBJ_';
      if (!m.name.startsWith(prefix)) bySurface.set(m.name, `${m.surface}`);
    }
    check('every merged mesh is named for the surface it carries', bySurface.size === 0,
      [...bySurface].map(([n, s]) => `${n}/${s}`).join(','));

    const wall = meshes.find((m) => m.surface === 'WALL');
    const road = meshes.find((m) => m.surface === 'ROAD');
    check('the garage still asks for a WALL twin', !!wall && !!physicsNameFor(wall.name, 'WALL'),
      wall ? `${wall.name} -> ${physicsNameFor(wall.name, 'WALL')}` : 'no WALL mesh');
    check('and the asphalt patch for a ROAD one', !!road && !!physicsNameFor(road.name, 'ROAD'),
      road ? `${road.name} -> ${physicsNameFor(road.name, 'ROAD')}` : 'no ROAD mesh');
    check('trees ask for no physics at all',
      meshes.filter((m) => m.name.includes('prop_darkgreen')).every((m) => physicsNameFor(m.name, m.surface) === null));

    /* Names have to survive an AC object name and stay unique, negative tile
       coordinates included -- a stray minus sign is not in the allowed set. */
    check('merged names carry no character AC would choke on',
      meshes.every((m) => /^[A-Za-z0-9_]+$/.test(m.name)),
      meshes.map((m) => m.name).filter((n) => !/^[A-Za-z0-9_]+$/.test(n)).join(','));
    check('and no two meshes share a name', new Set(meshes.map((m) => m.name)).size === meshes.length);

    /* The same project must export the same file twice running. */
    const again = propMeshes(project, heights).map((m) => m.name).join('|');
    check('the merge is deterministic', again === meshes.map((m) => m.name).join('|'));
  }

  /* Ground pads: flat patches of tarmac, concrete, gravel or grass that make
     the space around the circuit look like something. */
  {
    const pads = LIBRARY.filter((d) => d.category === 'Ground');
    check('the library offers ground pads', pads.length >= 4, `${pads.length}`);
    check('each pad declares a drivable surface',
      pads.every((d) => d.surface !== null && d.surface !== 'WALL'),
      pads.map((d) => `${d.key}/${d.surface}`).join(','));

    for (const def of pads) {
      const parts = propParts(def.key);
      if (parts.length !== 1) { check(`${def.key} is a single slab`, false, `${parts.length} parts`); continue; }
      const g = parts[0].geometry;
      g.computeBoundingBox();
      const b = g.boundingBox;
      // Top just above the ground so it never fights the terrain for the
      // depth buffer, bottom buried so a slope shows no gap underneath.
      check(`${def.key} sits just proud of the ground`,
        b.max.y > 0 && b.max.y < 0.1 && b.min.y < -0.15,
        `y ${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)}`);
      check(`${def.key} is ${PAD_SIZE} m square at scale 1`,
        Math.abs(b.max.x - b.min.x - PAD_SIZE) < 1e-6 && Math.abs(b.max.z - b.min.z - PAD_SIZE) < 1e-6,
        `${(b.max.x - b.min.x).toFixed(2)} x ${(b.max.z - b.min.z).toFixed(2)}`);
    }

    /* A pad placed in the world must export as a visible mesh carrying its
       surface in the name, plus an invisible physics twin. */
    useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null, placeRotation: 0 });
    useEditor.getState().addProp('pad_asphalt', new THREE.Vector3(30, 0, -20), 0);
    const project = useEditor.getState().project;
    const inst = project.props[project.props.length - 1];
    check('a pad can be placed like any other object', !!inst && inst.kind === 'pad_asphalt');

    const heights = new Float32Array(project.terrain.res * project.terrain.res);
    const baked = propMeshes(project, heights);
    const padMesh = baked.find((m) => m.name.startsWith('1PROP_ROAD_'));
    check('an asphalt pad exports as 1PROP_ROAD_...', !!padMesh, baked.map((m) => m.name).join(','));
    check('and uses the asphalt material', padMesh?.material === 'asphalt', padMesh?.material);
    check('and casts no shadow', padMesh?.castShadows === false);
    check('its physics twin is derived from the name',
      physicsNameFor(padMesh.name, padMesh.surface) === `1ROAD_${padMesh.name.slice('1PROP_ROAD_'.length)}`,
      physicsNameFor(padMesh.name, padMesh.surface));
    check('a decoration mesh gets no twin', physicsNameFor('1OBJ_tree_0', null) === null);
    check('and a mismatched surface is refused', physicsNameFor('1PROP_WALL_x_0', 'ROAD') === null);

    /* Scaling is what makes a 10 m pad into a paddock. */
    {
      const wide = { ...inst, s: [6, 1, 2.5] };
      const m = propMatrix(wide, project.terrain, heights);
      const g = propParts('pad_asphalt')[0].geometry.clone();
      g.applyMatrix4(m);
      g.computeBoundingBox();
      const b = g.boundingBox;
      check('scaling a pad stretches it in metres',
        Math.abs(b.max.x - b.min.x - 60) < 1e-4 && Math.abs(b.max.z - b.min.z - 25) < 1e-4,
        `${(b.max.x - b.min.x).toFixed(2)} x ${(b.max.z - b.min.z).toFixed(2)}`);
      g.dispose();
    }
  }
}

/* ------------------------------------------------------------------ */
/* The vegetation brush                                                */
/* ------------------------------------------------------------------ */

console.log('\nScatter brush');
{
  useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null });
  const st = () => useEditor.getState();
  const derived = getDerived(st().project);
  const trackIndex = new PointIndex(derived.trackFrames.map((f) => f.pos), 50);
  const pitIndex = new PointIndex(derived.pitFrames.map((f) => f.pos), 50);
  const cfg = st().scatter;

  const accept = (x, z) =>
    clearanceAt(x, z, derived.trackFrames, trackIndex, derived.profile, derived.pitFrames, pitIndex,
      cfg.keepOff + 40) >= cfg.keepOff;

  check('the brush starts with a mix of species', cfg.kinds.length >= 2, cfg.kinds.join(','));

  /* One stroke, many dabs, one undo step -- the whole point of going through
     `live` instead of `commit` per plant. */
  const before = st().project.props.length;
  st().pushHistory();
  st().scatterBegin();
  let planted = 0;
  for (let i = 0; i < 12; i++) planted += st().scatterDab(180 + i * 4, 120, 20, accept);
  check('a stroke plants something', planted > 0, `${planted}`);
  check('and the project has them', st().project.props.length === before + planted);
  check('the whole stroke is ONE undo step', st().past.length === 1, `${st().past.length} entries`);
  st().undo();
  check('and one undo takes all of it back', st().project.props.length === before, `${st().project.props.length}`);

  /* Nothing may land on anything built. This is the check that matters: the
     run off is narrowed through tight bends and the kerb is deleted outright
     where the pit lane comes alongside, so a brush reading the road SETTINGS
     rather than the computed profile would plant trees on the tarmac at the
     pit entry, of all places. */
  st().pushHistory();
  st().scatterBegin();
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    total += st().scatterDab(Math.cos(a) * 220, Math.sin(a) * 190, 40, accept);
  }
  check('a sweep around the circuit plants a decent number', total > 50, `${total}`);

  let intruders = 0;
  let worst = 0;
  for (const inst of st().project.props) {
    const room = clearanceAt(inst.p[0], inst.p[2], derived.trackFrames, trackIndex, derived.profile,
      derived.pitFrames, pitIndex, cfg.keepOff + 40);
    if (room < cfg.keepOff) { intruders += 1; worst = Math.min(worst, room); }
  }
  check('not one of them stands on the road, kerb, run off or pit lane',
    intruders === 0, `${intruders} do, worst ${worst.toFixed(2)} m`);

  /* Spacing is the density control, so it has to actually hold. */
  const cell = cfg.spacing;
  const seen = new Map();
  let tooClose = 0;
  for (const inst of st().project.props) {
    const cx = Math.floor(inst.p[0] / cell);
    const cz = Math.floor(inst.p[2] / cell);
    const key = `${cx}:${cz}`;
    if (seen.has(key)) tooClose += 1;
    seen.set(key, 1);
  }
  check('and no two share a spacing cell', tooClose === 0, `${tooClose} pairs`);

  /* Erasing only ever touches vegetation. */
  st().addProp('grandstand', new THREE.Vector3(220, 0, 0), 0);
  const grandstands = () => st().project.props.filter((p) => p.kind === 'grandstand').length;
  const before2 = grandstands();
  st().scatterErase(220, 0, 60);
  check('the eraser cannot delete a grandstand', grandstands() === before2, `${grandstands()} left of ${before2}`);
}

/* ------------------------------------------------------------------ */
/* Kerb spans                                                          */
/* ------------------------------------------------------------------ */

console.log('\nKerb spans');

{
  /* --- the interval algebra ---------------------------------------- */

  const base = [makeKerbSpan(-1, 0.2, 0.6), makeKerbSpan(1, 0, 1)];

  const overlaid = insertKerbSpan(base, makeKerbSpan(-1, 0.4, 0.8), true);
  const left = overlaid.filter((s) => s.side === -1);
  check('laying a kerb over another trims the old one', left.length === 2, `${left.length} spans`);
  check(
    'and nothing overlaps afterwards',
    left.every((a) =>
      left.every((b) => a === b || !(spanCovers(a, (b.from + b.to) / 2, true) && b.from < b.to)),
    ),
    left.map((s) => `${s.from.toFixed(2)}..${s.to.toFixed(2)}`).join(' '),
  );
  check(
    'the newest one keeps the ground it was drawn on',
    overlaid.some((s) => s.side === -1 && Math.abs(s.from - 0.4) < 1e-9 && Math.abs(s.to - 0.8) < 1e-9),
  );
  check('the other side is untouched', overlaid.filter((s) => s.side === 1).length === 1);

  /* A hole punched in the middle of a span leaves two pieces. */
  const holed = eraseKerbRange([makeKerbSpan(1, 0.1, 0.9)], 1, 0.4, 0.5, true);
  check('erasing the middle splits a kerb in two', holed.length === 2, `${holed.length}`);
  check(
    'and the two halves are the right halves',
    holed.some((s) => Math.abs(s.to - 0.4) < 1e-9) && holed.some((s) => Math.abs(s.from - 0.5) < 1e-9),
    holed.map((s) => `${s.from.toFixed(2)}..${s.to.toFixed(2)}`).join(' '),
  );
  check('the pieces keep the style they were cut from', holed.every((s) => s.style === 'ramp'));

  /*
   * The seam. A kerb round the whole lap with a hole cut in it is ONE span that
   * runs across the start/finish line, not two meeting at it: the author never
   * drew an end there, and two spans would put a tapered wedge at each side of
   * a line that is in the middle of a straight.
   */
  const lap = eraseKerbRange([makeKerbSpan(1, 0, 1)], 1, 0.3, 0.4, true);
  check('cutting a hole in a full lap kerb leaves one span', lap.length === 1, `${lap.length}`);
  check('which runs across the seam', lap.length === 1 && lap[0].from > lap[0].to,
    lap.length === 1 ? `${lap[0].from.toFixed(2)}..${lap[0].to.toFixed(2)}` : '');
  check('and covers the start/finish line', lap.length === 1 && spanCovers(lap[0], 0, true));
  check('but not the hole', lap.length === 1 && !spanCovers(lap[0], 0.35, true));

  const wrapped = eraseKerbRange([makeKerbSpan(1, 0.9, 0.1)], 1, 0.95, 0.05, true);
  check('erasing across the seam works too', wrapped.length === 2, `${wrapped.length}`);
  check('leaving nothing over the line itself', !wrapped.some((s) => spanCovers(s, 0, true)));

  /* --- reading old projects ---------------------------------------- */

  const flagged = defaultProject().track.nodes.map((n, i) => ({
    ...n,
    kerbL: i >= 3 && i <= 5,
    kerbR: true,
  }));
  const fromFlags = kerbsFromNodeFlags(flagged, true, { kerbWidth: 1.2, kerbHeight: 0.06 });
  const oldL = fromFlags.filter((s) => s.side === -1);
  const oldR = fromFlags.filter((s) => s.side === 1);
  check('a kerb flag on every point becomes one span for the lap', oldR.length === 1 && oldR[0].from === 0 && oldR[0].to === 1);
  check('a run of three points becomes one span', oldL.length === 1, `${oldL.length}`);
  check(
    'covering exactly the stretch those points owned',
    oldL.length === 1 && Math.abs(oldL[0].from - 3 / 12) < 1e-9 && Math.abs(oldL[0].to - 6 / 12) < 1e-9,
    oldL.length === 1 ? `${oldL[0].from}..${oldL[0].to}` : '',
  );

  const overSeam = kerbsFromNodeFlags(
    defaultProject().track.nodes.map((n, i) => ({ ...n, kerbL: i >= 10 || i <= 1, kerbR: false })),
    true,
    { kerbWidth: 1.2, kerbHeight: 0.06 },
  );
  check('a run of flags across the seam comes back as one span', overSeam.length === 1, `${overSeam.length}`);
  check('and it wraps', overSeam.length === 1 && overSeam[0].from > overSeam[0].to);

  /* The whole way in, through a saved file. */
  const oldFile = JSON.parse(serializeProject(defaultProject()));
  delete oldFile.road.kerbs;
  oldFile.track.nodes = oldFile.track.nodes.map((n, i) => ({ ...n, kerbL: false, kerbR: i < 4 }));
  const reopened = deserializeProject(JSON.stringify(oldFile));
  check('an old project file opens with spans instead of flags', Array.isArray(reopened.road.kerbs));
  check(
    'and the kerbs are where the flags were',
    reopened.road.kerbs.length === 1 && reopened.road.kerbs[0].side === 1,
    JSON.stringify(reopened.road.kerbs.map((s) => [s.side, s.from, s.to])),
  );
  const roundTripped = deserializeProject(serializeProject(reopened));
  check(
    'and saving it again keeps them',
    roundTripped.road.kerbs.length === reopened.road.kerbs.length &&
      Math.abs(roundTripped.road.kerbs[0].to - reopened.road.kerbs[0].to) < 1e-9,
  );
}

{
  /* --- how a span lands on the cross sections ----------------------- */

  const kp = defaultProject();
  const frames = computeFrames(kp.track, kp.road.samplesPerSegment);
  const total = pathLength(frames, true);
  // A 30 m wedge, because the demo oval samples a cross section every 8 m: a
  // shorter one is right in the profile and simply has too few points in it to
  // measure here.
  const span = makeKerbSpan(1, 0.25, 0.5, { style: 'ramp', width: 1.4, height: 0.08, taper: 30 });
  kp.road.kerbs = [span];
  const profile = sideProfile(frames, kp.road, [], true);

  const inside = frames.map((f, i) => ({ f, i })).filter(({ f }) => f.t > 0.3 && f.t < 0.45);
  const outside = frames.map((f, i) => ({ f, i })).filter(({ f }) => f.t < 0.2 || f.t > 0.55);
  check('a span puts a kerb on exactly its own cross sections',
    inside.every(({ i }) => profile.kerbWR[i] > 1.3) && outside.every(({ i }) => profile.kerbWR[i] === 0),
    `${inside.filter(({ i }) => profile.kerbWR[i] <= 1.3).length} thin inside, ${outside.filter(({ i }) => profile.kerbWR[i] > 0).length} leaking outside`,
  );
  check('and none at all on the other side', profile.kerbWL.every((w) => w === 0));

  /*
   * The wedge. A real kerb does not start at full height out of nothing, and
   * the ends being triangles is the single thing Malte asked for first.
   */
  const m = spanMetres(span, frames, true, total);
  const covered = frames
    .map((f, i) => ({ i, s: (f.dist - m.start + total) % total }))
    .filter(({ i }) => profile.kerbWR[i] > 0)
    .sort((a, b) => a.s - b.s);
  const first = covered[0];
  const middle = covered[Math.floor(covered.length / 2)];
  check('the first cross section of a kerb is a wedge, not a step',
    profile.kerbWR[first.i] < span.width * 0.5,
    `${profile.kerbWR[first.i].toFixed(2)} m wide at ${first.s.toFixed(1)} m in`,
  );
  check('the middle is at full width', Math.abs(profile.kerbWR[middle.i] - span.width) < 1e-3,
    `${profile.kerbWR[middle.i].toFixed(3)}`);
  check('the height ramps with the width',
    profile.kerbHR[first.i] < span.height * 0.5 && Math.abs(profile.kerbHR[middle.i] - span.height) < 1e-4,
    `${profile.kerbHR[first.i].toFixed(4)} then ${profile.kerbHR[middle.i].toFixed(4)}`,
  );
  check('the wedge is as long as it was asked to be',
    covered.every(({ i, s }) => Math.abs(profile.kerbWR[i] / span.width - Math.min(1, Math.min(s, m.length - s) / span.taper)) < 0.02),
  );

  /* A kerb round the whole lap has no ends, so it must not taper at the seam. */
  const lapProject = defaultProject();
  lapProject.road.kerbs = [makeKerbSpan(1, 0, 1, { taper: 8, width: 1.2 })];
  const lapProfile = sideProfile(frames, lapProject.road, [], true);
  check('a kerb round the whole lap keeps full width at the start/finish line',
    Math.abs(lapProfile.kerbWR[0] - 1.2) < 1e-3 &&
      Math.abs(lapProfile.kerbWR[frames.length - 1] - 1.2) < 1e-3,
    `${lapProfile.kerbWR[0].toFixed(3)} / ${lapProfile.kerbWR[frames.length - 1].toFixed(3)}`,
  );
}

{
  /* --- what the four styles build ---------------------------------- */

  const vertsOf = (meshes, name) => {
    const mesh = meshes.find((x) => x.name === name);
    if (!mesh) return [];
    const pos = mesh.geometry.getAttribute('position');
    const idx = mesh.geometry.getIndex();
    const drawn = mesh.geometry.drawRange.count;
    const used = new Set();
    for (let i = 0; i < Math.min(drawn, idx.count); i++) used.add(idx.getX(i));
    return [...used].map((i) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  };

  const build = (style, extra = {}) => {
    const sp = defaultProject();
    sp.road.kerbs = [makeKerbSpan(1, 0.25, 0.6, { style, width: 1.5, height: 0.1, taper: 2, ...extra })];
    const fr = computeFrames(sp.track, sp.road.samplesPerSegment);
    const pf = sideProfile(fr, sp.road, [], true);
    return { project: sp, frames: fr, meshes: buildRoadMeshes(fr, true, sp.road, [], undefined, pf), profile: pf };
  };

  const flat = build('flat');
  const ramp = build('ramp');
  const wave = build('wave');
  const sausage = build('sausage');

  const height = (verts, frames) => {
    // Height above the road plane, which is flat and level on the demo oval.
    let min = Infinity;
    let max = -Infinity;
    for (const v of verts) {
      min = Math.min(min, v.y);
      max = Math.max(max, v.y);
    }
    return { min, max, frames };
  };

  const flatV = vertsOf(flat.meshes, '1KERB_right');
  const rampV = vertsOf(ramp.meshes, '1KERB_right');
  const waveV = vertsOf(wave.meshes, '1KERB_right');
  const sausageV = vertsOf(sausage.meshes, '1KERB_right');

  check('every style builds a kerb mesh',
    flatV.length > 0 && rampV.length > 0 && waveV.length > 0 && sausageV.length > 0,
    `${flatV.length}/${rampV.length}/${waveV.length}/${sausageV.length}`,
  );
  check('a proper kerb has more cross section than the flat strip',
    rampV.length > flatV.length,
    `${rampV.length} against ${flatV.length}`,
  );
  check('no kerb reaches above the height it was given',
    height(rampV).max <= 0.1 + 1e-6 && height(sausageV).max <= 0.1 + 1e-6,
    `${height(rampV).max.toFixed(4)} / ${height(sausageV).max.toFixed(4)}`,
  );
  check('and none of it hangs below the tarmac', height(rampV).min >= -1e-6, `${height(rampV).min}`);

  /* The ripple has to be a ripple: the top must actually move up and down.
     Measured on square ended spans, so the wedges at the ends -- which are
     supposed to run through every height there is -- do not count as ripple. */
  const topsOf = (verts) => verts.filter((v) => v.y > 0.02).map((v) => v.y);
  const waveTops = topsOf(vertsOf(build('wave', { taper: 0 }).meshes, '1KERB_right'));
  const rampTops = topsOf(vertsOf(build('ramp', { taper: 0 }).meshes, '1KERB_right'));
  const spread = (a) => Math.max(...a) - Math.min(...a);
  check('a wave kerb ripples along its length', spread(waveTops) > 0.02, `${spread(waveTops).toFixed(4)} m`);
  check('an ordinary kerb does not', spread(rampTops) < 0.005, `${spread(rampTops).toFixed(4)} m`);
  check('the ripple never breaks the surface', Math.min(...waveTops) > 0.02);

  /* Sausages are separate bumps standing on a low base. */
  const sausageTops = sausageV.map((v) => v.y);
  const low = sausageTops.filter((y) => y < 0.05).length;
  const high = sausageTops.filter((y) => y > 0.08).length;
  check('a sausage kerb has both a low base and raised bumps', low > 0 && high > 0, `${low} low, ${high} high`);
  check('and the bumps are separate, not one long ridge',
    sausage.meshes.find((m) => m.name === '1KERB_right').geometry.drawRange.count >
      ramp.meshes.find((m) => m.name === '1KERB_right').geometry.drawRange.count,
  );

  /*
   * The wedge has to reach the MESH, not just the profile.
   *
   * The road is sampled every eight metres on this oval and a ramp is a few
   * metres long, so the first version of this put the correct widths in the
   * profile and then drew a kerb that still began at full height: every point
   * of the wedge fell between two cross sections. The kerb therefore rings its
   * own ends, and the proof is that the mesh contains vertices at heights
   * between nothing and full height near where the span starts.
   */
  const ramped = build('ramp', { taper: 6 });
  const rampedV = vertsOf(ramped.meshes, '1KERB_right');
  const partial = rampedV.filter((v) => v.y > 0.005 && v.y < 0.09).length;
  check('a kerb ends in a wedge in the geometry, not just in the numbers',
    partial >= 4,
    `${partial} vertices part way up`,
  );
  const noTaper = build('ramp', { taper: 0 });
  check('and a kerb asked for square ends has none',
    vertsOf(noTaper.meshes, '1KERB_right').filter((v) => v.y > 0.005 && v.y < 0.09).length === 0,
  );

  /* Nothing may sit on the racing line: a kerb starts at the tarmac edge. */
  const onTarmac = (verts, frames) => {
    const idx = new PointIndex(frames.map((f) => f.pos), 30);
    let worst = 0;
    for (const v of verts) {
      const i = idx.nearest(v.x, v.z, 60);
      if (i < 0) continue;
      const f = frames[i];
      const lat = (v.x - f.pos.x) * f.right.x + (v.z - f.pos.z) * f.right.z;
      worst = Math.min(worst, Math.abs(lat) - f.widthR);
    }
    return worst;
  };
  check('no kerb vertex lands on the road surface',
    onTarmac(rampV, ramp.frames) > -0.35,
    `${onTarmac(rampV, ramp.frames).toFixed(3)} m inside the edge`,
  );
}

{
  /* --- the painted line and the coloured strip ---------------------- */

  const lp = defaultProject();
  lp.road.edgeLine = true;
  lp.road.edgeLineWidth = 0.2;
  const lf = computeFrames(lp.track, lp.road.samplesPerSegment);
  const lprofile = sideProfile(lf, lp.road, [], true);
  const lmeshes = buildRoadMeshes(lf, true, lp.road, [], undefined, lprofile);

  const lineL = lmeshes.find((m) => m.name === '1ROAD_line_left');
  const lineR = lmeshes.find((m) => m.name === '1ROAD_line_right');
  check('the edge line is built', Boolean(lineL && lineR));
  check('as road surface, so there is no second physics layer over the track',
    lineL.surface === 'ROAD' && lineR.surface === 'ROAD',
  );
  check('and with its own white material', lineL.material === 'line_white');

  /*
   * It is CUT OUT of the tarmac, so the road stops where the line starts.
   * Measured across the strip itself rather than against the nearest cross
   * section: on a curve the nearest one is not always the one a vertex was
   * built from, and that slop is bigger than the line is wide.
   */
  const across = (mesh, pairs = 20) => {
    const pos = mesh.geometry.getAttribute('position');
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    let widest = 0;
    for (let k = 0; k < Math.min(pairs, pos.count / 2); k++) {
      a.fromBufferAttribute(pos, k * 2);
      b.fromBufferAttribute(pos, k * 2 + 1);
      widest = Math.max(widest, a.distanceTo(b));
    }
    return widest;
  };
  const fullWidth = lp.track.nodes[0].widthL + lp.track.nodes[0].widthR;
  check('the tarmac gives the line its room rather than lying under it',
    Math.abs(across(lmeshes.find((m) => m.name === '1ROAD_track')) - (fullWidth - 2 * 0.2)) < 1e-3,
    `${across(lmeshes.find((m) => m.name === '1ROAD_track')).toFixed(3)} m of road`,
  );
  check('and the line itself is the width it was set to',
    Math.abs(across(lineL) - 0.2) < 1e-3,
    `${across(lineL).toFixed(3)} m`,
  );

  const noLine = defaultProject();
  noLine.road.edgeLine = false;
  const nlFrames = computeFrames(noLine.track, noLine.road.samplesPerSegment);
  const nlProfile = sideProfile(nlFrames, noLine.road, [], true);
  const nlMeshes = buildRoadMeshes(nlFrames, true, noLine.road, [], undefined, nlProfile);
  check('switching the line off removes the meshes', !nlMeshes.some((m) => m.name.includes('line')));
  check('and gives the road its full width back',
    Math.abs(across(nlMeshes.find((m) => m.name === '1ROAD_track')) - fullWidth) < 1e-3,
    `${across(nlMeshes.find((m) => m.name === '1ROAD_track')).toFixed(3)} m`,
  );

  /* The coloured tarmac strip sits between the kerb and the grass. */
  const ap = defaultProject();
  ap.road.apronColour = 'green';
  ap.road.kerbs = [makeKerbSpan(-1, 0.1, 0.4, { width: 1.2, height: 0.06, apron: 4, taper: 0 })];
  const af = computeFrames(ap.track, ap.road.samplesPerSegment);
  const aprofile = sideProfile(af, ap.road, [], true);
  const ameshes = buildRoadMeshes(af, true, ap.road, [], undefined, aprofile);
  const apron = ameshes.find((m) => m.name === '1ROAD_apron_left');
  check('a span with a strip builds one', Boolean(apron));
  check('drivable, and in the colour asked for', apron.surface === 'ROAD' && apron.material === 'asphalt_green');
  check('the strip is as wide as it was asked to be',
    Math.abs(Math.max(...aprofile.apronL) - 4) < 1e-3,
    `${Math.max(...aprofile.apronL).toFixed(3)} m`,
  );
  check('only where the span is', aprofile.apronL.filter((w) => w > 0).length < af.length / 2);
  check('and none on the other side', aprofile.apronR.every((w) => w === 0));

  /* The run off has to start beyond it, or the grass grows over the tarmac. */
  const edges = computeEdges(af, ap.road, aprofile);
  let worst = Infinity;
  for (let i = 0; i < af.length; i++) {
    if (aprofile.apronL[i] < 0.1) continue;
    const f = af[i];
    const lat = (edges.outerL[i].x - f.pos.x) * f.right.x + (edges.outerL[i].z - f.pos.z) * f.right.z;
    worst = Math.min(worst, -lat - (f.widthL + aprofile.kerbWL[i] + aprofile.apronL[i]));
  }
  check('the grass starts outside the strip, not on it', worst > -1e-3, `${worst.toFixed(4)} m`);

  /* The terrain and the tree brush have to know about it too. */
  const corridor = roadCorridor(af, ap.road, aprofile);
  let widestHard = 0;
  for (let i = 0; i < af.length; i++) widestHard = Math.max(widestHard, corridor.kerbL[i]);
  check('the terrain counts the strip as hard surface', widestHard > 4, `${widestHard.toFixed(2)} m`);
}

{
  /* --- the tool's handles ------------------------------------------- */

  const hp = defaultProject();
  hp.road.kerbs = [makeKerbSpan(1, 0.2, 0.4, { style: 'wave' })];
  const hf = computeFrames(hp.track, hp.road.samplesPerSegment);
  const hprofile = sideProfile(hf, hp.road, [], true);
  const handles = kerbHandles(hf, hprofile, hp.road, true);

  check('there is a handle per stretch and side', handles.count === hf.length * 2, `${handles.count} for ${hf.length} cross sections`);
  check('handles know which span they stand on',
    handles.spanOf.some((s) => s === 0) && handles.spanOf.some((s) => s === -1),
  );
  check('only on the side the span is on',
    [...handles.spanOf].every((s, k) => s < 0 || handles.sideOf[k] === 1),
  );
  check('each handle covers a forward stretch of the curve',
    [...handles.fromT].every((t, k) => handles.toT[k] > t - 1e-9),
  );
  check('the last one closes the lap', Math.abs(handles.toT[handles.count - 1] - 1) < 1e-9);
  check('and they stand low enough to see the kerb under them', KERB_HANDLE_HEIGHT <= 0.4);

  /* --- picking a kerb back up --------------------------------------- */

  const kf = computeFrames(hp.track, hp.road.samplesPerSegment);
  const lap = pathLength(kf, true);
  const one = makeKerbSpan(1, 0.2, 0.4, { style: 'ramp' });
  const neighbour = makeKerbSpan(1, 0.5, 0.7, { style: 'flat' });
  const start = spanMetres(one, kf, true, lap);

  const moved = moveKerbSpan([one, neighbour], one, start.start + 200, start.length, kf, true, lap);
  const after = moved.find((s) => s.id === one.id);
  const movedM = spanMetres(after, kf, true, lap);
  check('a kerb can be moved along the track', Math.abs(movedM.start - (start.start + 200)) < 12,
    `${movedM.start.toFixed(0)} m instead of ${(start.start + 200).toFixed(0)}`);
  check('and keeps its length while it moves', Math.abs(movedM.length - start.length) < 12,
    `${movedM.length.toFixed(0)} against ${start.length.toFixed(0)}`);
  check('and its style', after.style === 'ramp' && after.side === 1);

  const longer = moveKerbSpan([one], one, start.start, start.length + 150, kf, true, lap);
  check('dragging an end makes it longer',
    spanMetres(longer[0], kf, true, lap).length > start.length + 100,
    `${spanMetres(longer[0], kf, true, lap).length.toFixed(0)} m`,
  );
  check('without moving the other end',
    Math.abs(spanMetres(longer[0], kf, true, lap).start - start.start) < 1,
  );

  /* Moving one onto its neighbour must trim the neighbour, never overlap it. */
  const onto = moveKerbSpan([one, neighbour], one, spanMetres(neighbour, kf, true, lap).start - 20, 200, kf, true, lap);
  const survivor = onto.find((s) => s.id === neighbour.id);
  check('moving a kerb onto another trims the other one', Boolean(survivor));
  check('and the two do not overlap afterwards',
    onto.every((a) =>
      onto.every((b) => a === b || !spanCovers(a, (b.from + b.to) / 2, true) || b.side !== a.side),
    ),
    onto.map((s) => `${s.from.toFixed(2)}..${s.to.toFixed(2)}`).join(' '),
  );
  check('a kerb cannot be shrunk away to nothing',
    spanMetres(moveKerbSpan([one], one, start.start, 0, kf, true, lap)[0], kf, true, lap).length >= 0.5,
  );

  /* Dragging from one handle to another lays a kerb over exactly that stretch. */
  const a = 20;
  const b = 44;
  const drawn = insertKerbSpan(
    [],
    makeKerbSpan(1, handles.fromT[a], handles.toT[b], { style: 'ramp' }),
    true,
  );
  check('a drag between two handles becomes one span', drawn.length === 1);
  check('covering both ends of the drag',
    spanCovers(drawn[0], handles.fromT[a] + 1e-6, true) && spanCovers(drawn[0], handles.toT[b] - 1e-6, true),
  );
  check('and nothing beyond them', !spanCovers(drawn[0], handles.fromT[a] - 0.01, true));
}

/* ------------------------------------------------------------------ */
/* The main grandstand's way in                                        */
/* ------------------------------------------------------------------ */

console.log('\nGetting into the main grandstand');

{
  /*
   * The two open flights that used to climb the back of this are gone: they
   * stuck 15 m out behind the stand and stopped it ever being put against
   * anything. What has to survive that is everything the seating itself needs
   * -- the gallery along the top, the aisles up both banks, the apron at the
   * front -- plus the back staying flat enough to park a stand against a fence.
   */
  const parts = propParts('grandstand_main');
  const verts = (p) => {
    const a = p.geometry.getAttribute('position');
    const out = [];
    for (let i = 0; i < a.count; i++) out.push({ x: a.getX(i), y: a.getY(i), z: a.getZ(i) });
    return out;
  };
  const top = (p) => Math.max(...verts(p).map((v) => v.y));

  const seats = parts[0];
  const structure = parts.find((p, i) => i > 0 && p.material === 'prop_light');
  check('the seating and the structure behind it are separate parts', Boolean(structure));
  check(
    'the structure reaches the top row, not a wall halfway up',
    Math.abs(top(structure) - top(seats)) < 0.01,
    `structure reaches ${top(structure).toFixed(2)} m, seats end at ${top(seats).toFixed(2)} m`,
  );

  // Something has to bridge the gap between the two at that height, or the
  // stairs arrive beside the seating rather than at it.
  const deckLevel = top(seats);
  const bridge = verts(structure).filter(
    (v) => Math.abs(v.y - deckLevel) < 0.01 && v.z > 10 && v.z < 13,
  );
  check('and a gallery at that height runs behind the seating', bridge.length > 0,
    `${bridge.length} vertices level with the top row`);

  // The guard rail along the outer edge of that gallery, and nothing sloped
  // left over from the flights that used to feed it.
  const rails = parts.filter((p) => p.material === 'prop_metal').pop();
  const railV = verts(rails);
  const railY = railV.map((v) => v.y);
  check('a guard rail runs along the outer edge of the gallery',
    railV.some((v) => v.z > 11.8) && Math.min(...railY) >= deckLevel - 0.01,
    `${Math.min(...railY).toFixed(2)} m at its lowest`);
  check('and nothing is left leaning where the flights were',
    Math.max(...railY) - Math.min(...railY) < 1.5,
    `${(Math.max(...railY) - Math.min(...railY)).toFixed(2)} m of rise in one part`);

  // The back of the stand has to be flat, or it cannot be put against a fence,
  // a bank or a car park -- which is what the flights cost.
  const backZ = Math.max(...parts.flatMap((p) => verts(p).map((v) => v.z)));
  check('the back is flat enough to stand something against',
    backZ < 12.5, `${backZ.toFixed(2)} m behind the origin`);

  /*
   * The gangways up the banks, measured the only way that means anything: drop
   * a ray on the aisle and on the seating beside it and compare what you land
   * on. A slab that has sunk into the steps passes every bounding box test ever
   * written and is invisible in the game.
   */
  {
    const mesh = (p) => new THREE.Mesh(p.geometry, new THREE.MeshBasicMaterial());
    const caster = new THREE.Raycaster();
    const surfaceAt = (m, x, z) => {
      caster.set(new THREE.Vector3(x, 60, z), new THREE.Vector3(0, -1, 0));
      const hit = caster.intersectObject(m, false);
      return hit.length > 0 ? hit[0].point.y : null;
    };
    const seatMesh = mesh(seats);
    const aisleMesh = mesh(parts.find((p, i) => i > 0 && p.material === 'prop_dark'));

    for (const [tier, from, to] of [['lower', -9.5, -0.6], ['upper', 1.0, 9.2]]) {
      let missing = 0;
      let buried = 0;
      let worst = 0;
      for (let z = from; z <= to; z += 0.4) {
        const aisle = surfaceAt(aisleMesh, 11, z);
        const seat = surfaceAt(seatMesh, 11, z);
        if (aisle === null || seat === null) {
          missing += 1;
          continue;
        }
        if (aisle <= seat) buried += 1;
        worst = Math.max(worst, aisle - seat);
      }
      check(`the ${tier} tier has an aisle over its whole run`, missing === 0, `${missing} gaps`);
      check(`and it stands proud of every row`, buried === 0, `${buried} samples level or below`);
      check(`without standing on stilts`, worst < 0.6, `${worst.toFixed(2)} m at its worst`);
    }

    // Between the aisles there must still be seating, or it is not an aisle,
    // it is a demolished stand.
    check('the seating either side of an aisle is untouched',
      surfaceAt(seatMesh, 0, -5) !== null && surfaceAt(seatMesh, 16, -5) !== null);

    // And the foot of each aisle has to meet the ground, not stop a step up.
    const foot = surfaceAt(aisleMesh, 11, -10.4);
    check('each aisle steps down to the apron at the front', foot !== null && foot < 0.5,
      `${foot === null ? 'nothing there' : `${foot.toFixed(2)} m`}`);
    check('and there is an apron along the front to arrive on',
      (surfaceAt(aisleMesh, 0, -11.4) ?? -1) >= 0);
  }

  // And the doors are still on the back wall, where a way in belongs.
  const doors = parts.find((p) => p.material === 'prop_dark' && Math.max(...verts(p).map((v) => v.y)) < 4);
  const doorZ = Math.max(...verts(doors).map((v) => v.z));
  check('the doors are on the back wall', doorZ > 10 && doorZ < 10.5, `${doorZ.toFixed(2)} m`);
}

/* ------------------------------------------------------------------ */
/* Covered means covered                                               */
/* ------------------------------------------------------------------ */

console.log('\nThe grandstands');

{
  const mesh = (p) => new THREE.Mesh(p.geometry, new THREE.MeshBasicMaterial());
  const caster = new THREE.Raycaster();
  /*
   * Is there anything over this spot? Fire UPWARDS from just above the seats: a
   * roof is not a bounding box question, it is a "does the sky get in" one, and
   * the open stand used to pass every box test while carrying a 24 x 11 m slab
   * on two posts -- so the palette offered a stand and a covered stand and both
   * of them were covered.
   */
  const covered = (key, x, z) => {
    const meshes = propParts(key).map(mesh);
    caster.set(new THREE.Vector3(x, 5.2, z), new THREE.Vector3(0, 1, 0));
    return meshes.some((m) => caster.intersectObject(m, false).length > 0);
  };

  check('the covered stand has a roof over its seats', covered('grandstand_roof', 0, 0));
  check('and over the front row too', covered('grandstand_roof', 0, -4.5));
  check('the open stand has none over its seats', !covered('grandstand', 0, 0));
  check('and none over its front row', !covered('grandstand', 0, -4.5));

  /*
   * The side rails follow the rake. A rail at one fixed height across a raked
   * bank floats a metre off the front row and is buried in the back one, which
   * is what the small stand used to do.
   */
  const drop = (meshes, x, z) => {
    caster.set(new THREE.Vector3(x, 40, z), new THREE.Vector3(0, -1, 0));
    for (const m of meshes) {
      const hit = caster.intersectObject(m, false);
      if (hit.length > 0) return hit[0].point.y;
    }
    return null;
  };
  const stands = [
    ['grandstand', 11.94, -4.5, 4.5],
    ['grandstand_small', 5.95, -2.7, 2.7],
  ];
  for (const [key, edge, front, back] of stands) {
    const parts = propParts(key);
    const seatMesh = [mesh(parts[0])];
    const railMesh = parts.filter((p) => p.material === 'prop_metal').map(mesh);
    for (const [where, z] of [['front', front], ['back', back]]) {
      const rail = drop(railMesh, edge, z);
      const seat = drop(seatMesh, edge - 0.6, z);
      check(`${key}: the side rail clears the ${where} row`,
        rail !== null && seat !== null && rail > seat,
        rail === null ? 'no rail over that row' : `rail ${rail.toFixed(2)} m, row ${seat?.toFixed(2)} m`);
      check(`${key}: and stays within reach of it at the ${where}`,
        rail !== null && seat !== null && rail - seat < 1.9,
        rail === null || seat === null ? '-' : `${(rail - seat).toFixed(2)} m above the row`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* One pit building, sized to the circuit                              */
/* ------------------------------------------------------------------ */

console.log('\nThe pit building');

{
  const parts = propParts('pit_building');
  const spanX = (p) => {
    const a = p.geometry.getAttribute('position');
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < a.count; i++) {
      lo = Math.min(lo, a.getX(i));
      hi = Math.max(hi, a.getX(i));
    }
    return hi - lo;
  };
  /*
   * Every part of it runs the full length, and that is the whole design: a
   * pilaster or a mullion covering a fraction of the building turns into a
   * buttress the moment the thing is stretched out to a grand prix pit lane,
   * which is exactly why the model this replaced could not be stretched.
   */
  const full = Math.max(...parts.map(spanX));
  const short = parts.filter((p) => spanX(p) < full - 0.01);
  check('every part of the pit building runs its whole length', short.length === 0,
    short.map((p) => `${p.material} ${spanX(p).toFixed(1)} m`).join(', '));
  check('and it starts out the length of a real one', Math.abs(full - 40) < 0.01,
    `${full.toFixed(2)} m`);
  check('the superseded one is still built, for tracks that already hold it',
    propParts('pit_building_modern').length > 0);
  check('but it is not offered again',
    LIBRARY_BY_KEY.get('pit_building_modern')?.hidden === true);
}

/* ------------------------------------------------------------------ */
/* Drawing modes                                                       */
/* ------------------------------------------------------------------ */

console.log('\nDrawing modes');

{
  const node = (x, z) => ({ ...defaultProject().track.nodes[0], id: `d${x}_${z}`, p: [x, 0, z] });
  const v = (x, y, z) => new THREE.Vector3(x, y, z);

  /* --- free: exactly where you clicked ------------------------------ */
  const free = planDraw('free', [node(0, 0)], v(37.3, 2, 11.9));
  check('free mode puts the point where the click was', free.points.length === 1 &&
    free.points[0].x === 37.3 && free.points[0].z === 11.9);

  /* --- straight: the heading locks, the click only says how far ----- */
  const straight = planDraw('straight', [node(0, 0)], v(100, 0, 7), 15);
  check('straight mode adds one point', straight.points.length === 1);
  const heading = (a, b) => (THREE.MathUtils.radToDeg(Math.atan2(b.x - a.x, b.z - a.z)) + 360) % 360;
  const h = heading({ x: 0, z: 0 }, straight.points[0]);
  check('and locks the heading to a whole step', Math.abs(h % 15) < 1e-6 || Math.abs((h % 15) - 15) < 1e-6,
    `${h.toFixed(3)}°`);
  check('to the nearest one, not just any', Math.abs(h - 90) < 1e-6, `${h.toFixed(3)}°`);
  check('keeping roughly the length that was clicked',
    Math.abs(straight.length - Math.hypot(100, 7)) < 8, `${straight.length.toFixed(1)} m`);

  const rounded = planDraw('straight', [node(0, 0)], v(103, 0, 4), 15, 5);
  check('and on a grid the run is a whole number of steps',
    Math.abs(rounded.length % 5) < 1e-6, `${rounded.length} m`);
  check('a straight can still be drawn at any angle with the step off',
    Math.abs(heading({ x: 0, z: 0 }, planDraw('straight', [node(0, 0)], v(100, 0, 7), 0).points[0]) -
      heading({ x: 0, z: 0 }, { x: 100, z: 7 })) < 1e-6);

  /* --- arc: leaves the track the way it arrived --------------------- */
  const line = [node(0, -100), node(0, 0)]; // heading due +Z
  const arc = planDraw('arc', line, v(60, 0, 60));
  check('a curve is made of several points', arc.points.length >= 2, `${arc.points.length}`);
  check('and it ends exactly where it was clicked',
    Math.abs(arc.points[arc.points.length - 1].x - 60) < 1e-9 &&
    Math.abs(arc.points[arc.points.length - 1].z - 60) < 1e-9);
  check('a curve reports its radius', arc.radius > 1, `${arc.radius.toFixed(1)} m`);

  /* Tangent continuity is the whole point: the track must leave the last
     point in the direction it was already going, or the corner has a kink in
     it that no amount of dragging afterwards will take out. */
  const first = arc.points[0];
  const leaveH = heading({ x: 0, z: 0 }, first);
  check('the curve leaves the track in the direction it was going',
    Math.abs(leaveH) < 12 || Math.abs(leaveH - 360) < 12, `${leaveH.toFixed(1)}° off 0°`);

  /* Constant radius: every point the same distance from one centre. */
  const centre = { x: arc.radius, z: 0 }; // the bend turns right, centre on +X
  let worst = 0;
  for (const p of arc.points) worst = Math.max(worst, Math.abs(Math.hypot(p.x - centre.x, p.z - centre.z) - arc.radius));
  check('and holds one radius all the way round', worst < 0.02, `${worst.toFixed(3)} m out`);

  const leftArc = planDraw('arc', line, v(-60, 0, 60));
  check('it bends the other way just as happily', leftArc.radius > 1 && leftArc.points[0].x < 0);

  const ahead = planDraw('arc', line, v(0, 0, 90));
  check('a target straight ahead is a straight, not a circle of infinite radius',
    ahead.radius === 0 && ahead.points.length === 1);

  check('a curve with nothing to be tangent to falls back to a plain point',
    planDraw('arc', [node(0, 0)], v(50, 0, 50)).points.length === 1);
  check('and so does an empty path', planDraw('straight', [], v(5, 0, 5)).points.length === 1);

  /* --- the store puts a whole curve down as one undo step ----------- */
  {
    useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null });
    const store = useEditor.getState();
    const before = useEditor.getState().project.track.nodes.length;
    const plan = planDraw('arc', useEditor.getState().project.track.nodes, v(400, 0, 400));
    store.addNodes('track', plan.points);
    const after = useEditor.getState().project.track.nodes.length;
    check('adding a curve adds all of its points', after === before + plan.points.length,
      `${after - before} of ${plan.points.length}`);
    useEditor.getState().undo();
    check('and one undo takes the whole curve back',
      useEditor.getState().project.track.nodes.length === before);

    // Freehand appends without its own history entry, like a brush stroke.
    store.pushHistory();
    store.appendNodeLive('track', v(10, 0, 10));
    store.appendNodeLive('track', v(40, 0, 10));
    check('a freehand stroke adds points', useEditor.getState().project.track.nodes.length === before + 2);
    useEditor.getState().undo();
    check('and is one undo however long it is',
      useEditor.getState().project.track.nodes.length === before);
    check('new points inherit the road width of the one before',
      useEditor.getState().project.track.nodes.every((n) => n.widthL > 0));
  }
}

/* ------------------------------------------------------------------ */
/* What a new point is drawn with                                      */
/* ------------------------------------------------------------------ */

console.log('\nNew point settings');

{
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const cfg = { ...DEFAULT_DRAW_CFG, trackWidthL: 9, trackWidthR: 5, pitWidthL: 3, pitWidthR: 2 };

  check('the track and the pit lane carry their own widths',
    drawWidths(cfg, 'track').widthL === 9 && drawWidths(cfg, 'pit').widthR === 2);

  /* --- the three height modes --------------------------------------- */
  const ground = (x, z) => (x + z) / 100;
  check('on ground, the height is whatever was clicked',
    drawHeightOf({ ...cfg, heightMode: 'ground', level: 7 }, -0.6) === -0.6);
  check('level ignores the ground entirely',
    drawHeightOf({ ...cfg, heightMode: 'level', level: 4.25 }, -0.6) === 4.25);
  check('and an offset rides above it',
    drawHeightOf({ ...cfg, heightMode: 'offset', offset: 1.5 }, 10) === 11.5);

  const plan = [v(0, -9, 0), v(100, -9, 100), v(200, -9, 200)];
  applyDrawHeight(plan, { ...cfg, heightMode: 'ground' }, ground);
  check('a whole plan is left alone in ground mode', plan.every((p) => p.y === -9));
  applyDrawHeight(plan, { ...cfg, heightMode: 'level', level: 2 }, ground);
  check('levelled flat when it is asked to be', plan.every((p) => p.y === 2));
  /*
   * The interesting one. An arc interpolates the height of its intermediate
   * points between its two ends, so a bend drawn across a hill in offset mode
   * only follows the ground if EVERY point samples the ground under itself --
   * which is why this runs after planDraw rather than on the click that fed it.
   */
  applyDrawHeight(plan, { ...cfg, heightMode: 'offset', offset: 1 }, ground);
  check('and in offset mode every point samples the ground under itself',
    plan.map((p) => Math.round(p.y * 1e6) / 1e6).join() === '1,3,5',
    plan.map((p) => p.y.toFixed(2)).join(' '));

  /* --- what the store actually stores ------------------------------- */
  {
    useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null });
    const store = useEditor.getState();
    store.setDrawCfg({ trackWidthL: 9, trackWidthR: 5, pitWidthL: 3, pitWidthR: 2 });
    const before = useEditor.getState().project.track.nodes.length;
    store.addNodes('track', [v(500, 0, 500)]);
    const drawn = useEditor.getState().project.track.nodes[before];
    check('a drawn point takes its width from the tool, not from its neighbour',
      drawn.widthL === 9 && drawn.widthR === 5, `${drawn.widthL} / ${drawn.widthR}`);

    store.appendNodeLive('pit', v(500, 0, 520));
    const pitNodes = useEditor.getState().project.pit.nodes;
    const freehand = pitNodes[pitNodes.length - 1];
    check('a freehand pit point uses the pit width', freehand.widthL === 3 && freehand.widthR === 2);

    /*
     * Inserting into an existing stretch is NOT drawing: Alt+click in the
     * select tool drops a point into the middle of a corner, and that point
     * belongs to the corner. Pulling the tool's width in here would pinch the
     * road wherever anybody added detail to it.
     */
    const wide = useEditor.getState().project.track.nodes[0];
    useEditor.getState().commit((p) => { p.track.nodes[0].widthL = 14; p.track.nodes[0].widthR = 14; });
    const insertedId = useEditor.getState().addNode('track', v(1, 0, 1), wide.id);
    const inserted = useEditor.getState().project.track.nodes.find((n) => n.id === insertedId);
    check('an inserted point still copies the stretch it lands in',
      inserted.widthL === 14 && inserted.widthR === 14, `${inserted.widthL} / ${inserted.widthR}`);
  }

  /* --- pushing the settings onto a track that already exists --------- */
  {
    useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null });
    const store = useEditor.getState();
    store.setDrawCfg({ trackWidthL: 7.5, trackWidthR: 7.5, heightMode: 'level', level: 3 });
    const n = store.applyDrawWidth('track');
    const nodes = () => useEditor.getState().project.track.nodes;
    check('apply-to-all reaches every point', n === nodes().length && n > 0, `${n} points`);
    check('and really sets the width', nodes().every((x) => x.widthL === 7.5 && x.widthR === 7.5));
    useEditor.getState().undo();
    check('as a single undo step', nodes().every((x) => x.widthL !== 7.5));

    useEditor.getState().applyDrawLevel('track', () => 0);
    check('the height goes on the same way', nodes().every((x) => x.p[1] === 3));
    useEditor.getState().undo();

    useEditor.getState().setDrawCfg({ heightMode: 'ground' });
    const y0 = nodes()[0].p[1];
    check('and ground mode has no height of its own to apply',
      useEditor.getState().applyDrawLevel('track', () => 99) === 0 && nodes()[0].p[1] === y0);
  }

  /*
   * A source check: the height rule lives in draw.ts so it can be tested up
   * there, but it only reaches a stored point because the viewport runs it over
   * the finished plan. Lose that line and every check above still passes while
   * the setting quietly does nothing.
   */
  {
    const src = readFileSync(new URL('../src/scene/Viewport.tsx', import.meta.url), 'utf8');
    check('the viewport puts the drawn plan onto the configured height',
      /applyDrawHeight\(plan\.points, drawCfg, groundAt\)/.test(src));
    check('and the freehand stroke goes through the same rule',
      (src.match(/atDrawHeight\(snapped\(/g) ?? []).length >= 2);
    check('and the preview shows the height the click will store',
      /applyDrawHeight\(plan\.points, drawCfg, groundAt\)/.test(src.slice(src.indexOf('function DrawPreview'))));
  }
}

/* ------------------------------------------------------------------ */
/* Where the run off and the barrier on it end up                      */
/* ------------------------------------------------------------------ */

console.log('\nBanked run off');

{
  /* --- the two rules on their own ----------------------------------- */
  check('a flat road gains no height across its shoulder',
    runoffBankRise(0, 20) === 0);
  const tilt = Math.sin((10 * Math.PI) / 180);
  check('a banked one does, but it stops climbing',
    Math.abs(runoffBankRise(tilt, 200) - runoffBankRise(tilt, RUNOFF_BANK_RUN)) < 1e-9,
    `${runoffBankRise(tilt, 200).toFixed(3)} m at most`);
  check('and it is at most half the run, times the tilt',
    Math.abs(runoffBankRise(tilt, 999) - (tilt * RUNOFF_BANK_RUN) / 2) < 1e-9);
  let rough = 0;
  for (let a = 0; a < 30; a += 0.1) {
    rough = Math.max(rough, Math.abs(runoffBankRise(tilt, a + 0.1) - runoffBankRise(tilt, a)));
  }
  check('it climbs smoothly, with no step anywhere', rough < 0.02, `${(rough * 1000).toFixed(1)} mm`);

  check('a shoulder that is pinched out drops proportionally less',
    Math.abs(shoulderDrop(0.75, 11.5, 23) - 0.375) < 1e-9);
  check('and a shoulder of no width does not drop at all', shoulderDrop(0.75, 0, 23) === 0);
  check('at full width it is exactly the setting', shoulderDrop(0.75, 23, 23) === 0.75);

  /* --- a real banked circuit ---------------------------------------- */
  const banked = defaultProject();
  banked.road.runoffWidth = 23;
  banked.road.runoffDrop = 0.75;
  banked.road.wall = true;
  banked.road.wallStyle = 'fence';
  banked.road.wallHeight = 3.6;
  banked.terrain.blend = 22;
  for (const n of banked.track.nodes) { n.wallL = true; n.wallR = true; }
  // Bank a quarter of the lap hard over, the way Malte's circuit is.
  for (let i = 8; i < 12; i++) banked.track.nodes[i].bank = -10;

  const d = getDerived(banked);
  const fr = d.trackFrames;
  const e = computeEdges(fr, banked.road, d.profile);

  let worstDrop = 0;
  let worstWave = 0;
  let worstGround = 0;
  let worstSeam = 0;
  const mid = new THREE.Vector3();
  for (let i = 0; i < fr.length; i++) {
    for (const side of [-1, 1]) {
      const outer = side < 0 ? e.outerL : e.outerR;
      const edge = side < 0 ? e.apronEL : e.apronER;
      /*
       * Measured from the EDGE of the tarmac, not from the centre line: on a
       * banked corner the edge is legitimately a metre below the middle of the
       * road, and that part is the banking doing its job. What is being pinned
       * here is the extra the shoulder adds beyond it.
       */
      worstDrop = Math.max(worstDrop, Math.abs(edge[i].y - outer[i].y));
      /*
       * And how much of the outer edge's rise and fall is its OWN, rather than
       * the road's. A shoulder that follows a climbing track is fine; one that
       * jumps while the track beside it does not is the lumpy barrier.
       */
      if (i > 0) {
        // As a SLOPE, not as a step: the cross sections of a coarsely sampled
        // track are metres apart, so the same gentle ramp reads as a big number
        // at one detail setting and a small one at another. A shoulder tapering
        // away has to bring its outer edge up to road level over the length it
        // is allowed to lose the width in, and that ramp is legitimate --
        // SHOULDER_TAPER x drop / width, 3.3 % here. A step would be 100 %.
        const span = fr[i].pos.distanceTo(fr[i - 1].pos);
        const own = Math.abs(outer[i].y - outer[i - 1].y - (edge[i].y - edge[i - 1].y));
        if (span > 1e-6) worstWave = Math.max(worstWave, own / span);
      }
      /*
       * The ground versus the shoulder it has to meet.
       *
       * Two different things are being asked, and they want different answers.
       * UNDER the shoulder the ground may sit lower -- it is deliberately sunk
       * so a coarse height grid interpolating between its points cannot cut up
       * through a banked surface -- but it must never sit HIGHER, which is the
       * grass coming through the verge. At the OUTER edge the shoulder mesh
       * ends and the ground becomes the surface you actually see, so there the
       * two have to agree or there is a step.
       */
      mid.copy(edge[i]).lerp(outer[i], 0.5);
      const gMid = sampleHeights(banked.terrain, d.terrainHeights, mid.x, mid.z);
      worstGround = Math.max(worstGround, gMid - mid.y);
      /*
       * The seam is only pinned where the road is FLAT. On a banked corner the
       * outer edge of the shoulder can sit two metres below the surrounding
       * countryside, and the bank of earth between the two is real ground that
       * a square height grid can only draw as accurately as its cell size --
       * about a cell times the gradient. Sharpening that is a matter of terrain
       * resolution, not of this formula. The allowance carries the mesh edge's
       * own EDGE_SINK bevel on top of the grid error: the edge now comes down
       * to the ground the corridor holds under it, so it sits 4 cm below where
       * this check was first calibrated.
       */
      if (Math.abs(fr[i].right.y) < 0.01) {
        const gOut = sampleHeights(banked.terrain, d.terrainHeights, outer[i].x, outer[i].z);
        worstSeam = Math.max(worstSeam, Math.abs(gOut - outer[i].y));
      }
    }
  }
  /*
   * 10° over a 23 m shoulder is 4 m of fall if the banking is carried all the
   * way out, which is what it used to do: the barrier ended up a storey below
   * the track on one side and a storey above it on the other. What is left is
   * the fading bank run plus the shoulder drop, both of them deliberate.
   */
  check('the outer edge of a banked shoulder stays near the tarmac it belongs to',
    worstDrop < 1.6, `${worstDrop.toFixed(2)} m below the road edge`);
  check('and it does not rise and fall on its own',
    worstWave < 0.08, `${(worstWave * 100).toFixed(1)} % gradient of its own`);
  check('the ground never comes up through the shoulder',
    worstGround < 0.02, `${worstGround.toFixed(2)} m proud at the worst`);
  check('and it meets it where the shoulder ends and the ground takes over',
    worstSeam < 0.2 + EDGE_SINK, `${worstSeam.toFixed(2)} m apart at the seam`);

  /* --- no cliffs left in the width either --------------------------- */
  let worstTaper = 0;
  for (const w of [d.profile.runoffL, d.profile.runoffR]) {
    for (let i = 1; i < w.length; i++) {
      const span = fr[i].pos.distanceTo(fr[i - 1].pos);
      worstTaper = Math.max(worstTaper, Math.abs(w[i] - w[i - 1]) - span - 1e-6);
    }
  }
  check('a shoulder never loses more width than the track it had to lose it in',
    worstTaper <= 0, `${worstTaper.toFixed(3)} m over the limit`);
}

/* ------------------------------------------------------------------ */
/* A cross section is a slice, not an infinite line                    */
/* ------------------------------------------------------------------ */

console.log('\nThe verge of a real corner');

{
  /*
   * Both of these were the same bug wearing two hats: a point was matched to
   * the NEAREST CROSS SECTION and then measured along it as though that section
   * were an infinite line. On a corner the sections fan out and point at the
   * outside of the bend, so a point standing on the grass reads as "half a
   * metre from the centre line" of a section metres up the road.
   *
   * For the plant brush that meant no grass on the outside of a corner -- over
   * half of a real circuit's verge came back as tarmac. For the terrain blend
   * it meant the ground was raised to the wrong plane, and with banking that
   * error is vertical: the grass climbed over the kerb.
   */
  const p = defaultProject();
  p.road.runoffWidth = 20;
  p.road.samplesPerSegment = 24;
  p.terrain.res = 97; // Low, which is where a coarse grid shows up worst
  p.terrain.heights = new Float32Array(97 * 97);
  const ring = [[-260,-150],[0,-150],[260,-150],[330,-80],[330,80],[260,150],[0,150],[-260,150],[-330,80],[-330,-80]];
  p.track.closed = true;
  p.track.nodes = ring.map(([x, z], i) =>
    ({ ...defaultProject().track.nodes[0], id: `k${i}`, p: [x, 0, z], widthL: 6, widthR: 6,
       bank: i >= 2 && i <= 5 ? -22 : 0 }));
  p.pit.nodes = [];

  const d = getDerived(p);
  const fr = d.trackFrames;
  const ti = new PointIndex(fr.map((f) => f.pos), 50);
  const empty = new PointIndex([], 50);

  /* --- 1. grass all the way round ----------------------------------- */
  let refused = 0;
  let tested = 0;
  let worstRefusal = 0;
  for (let i = 0; i < fr.length; i += 2) {
    const f = fr[i];
    for (const side of [-1, 1]) {
      const hard = side < 0
        ? f.widthL + d.profile.kerbWL[i] + d.profile.apronL[i]
        : f.widthR + d.profile.kerbWR[i] + d.profile.apronR[i];
      for (const off of [1.5, 5, 10]) {
        const x = f.pos.x + f.right.x * (hard + off) * side;
        const z = f.pos.z + f.right.z * (hard + off) * side;
        const c = clearanceAt(x, z, fr, ti, d.profile, [], empty, 60, false, true);
        tested += 1;
        if (c < 0) { refused += 1; worstRefusal = Math.min(worstRefusal, c); }
      }
    }
  }
  check('grass can be planted anywhere on the verge, corners included',
    refused === 0, `${refused} of ${tested} refused, worst ${worstRefusal.toFixed(2)} m`);

  /* And it still refuses what it should: the tarmac itself. */
  let allowedOnRoad = 0;
  for (let i = 0; i < fr.length; i += 5) {
    const f = fr[i];
    for (const lat of [-0.6, 0, 0.6]) {
      const x = f.pos.x + f.right.x * f.widthR * lat;
      const z = f.pos.z + f.right.z * f.widthR * lat;
      if (clearanceAt(x, z, fr, ti, d.profile, [], empty, 60, false, true) >= 0) allowedOnRoad += 1;
    }
  }
  check('and never on the road itself', allowedOnRoad === 0, `${allowedOnRoad} points on the tarmac`);

  /* --- 2. the ground stays under a banked road ---------------------- */
  let over = 0;
  let worstOver = 0;
  for (let i = 0; i < fr.length; i++) {
    const f = fr[i];
    for (const lat of [-1, -0.5, 0, 0.5, 1]) {
      const w = lat < 0 ? f.widthL : f.widthR;
      const x = f.pos.x + f.right.x * w * lat;
      const z = f.pos.z + f.right.z * w * lat;
      const roadY = f.pos.y + f.right.y * w * lat;
      const g = sampleHeights(p.terrain, d.terrainHeights, x, z);
      if (g - roadY > 0.02) { over += 1; worstOver = Math.max(worstOver, g - roadY); }
    }
  }
  const cs = p.terrain.size / (p.terrain.res - 1);
  check('the ground stays under a 22° banked road, even on a coarse grid',
    over === 0, `${over} samples, worst ${worstOver.toFixed(2)} m, cells ${cs.toFixed(1)} m`);
}

/* ------------------------------------------------------------------ */
/* Erasing and marking in bulk                                         */
/* ------------------------------------------------------------------ */

console.log('\nErase and marquee');

{
  const grid = () => {
    const props = [];
    for (let i = 0; i < 40; i++) {
      props.push({
        id: `t${i}`, kind: i % 5 === 0 ? 'tree_pine' : 'cone', name: `c${i}`,
        p: [(i % 8) * 5 - 20, 0, ((i / 8) | 0) * 5 - 10], r: [0, 0, 0], s: [1, 1, 1], ground: true,
      });
    }
    const p = defaultProject();
    p.props = props;
    return p;
  };

  useEditor.setState({ project: grid(), past: [], future: [], selection: null, marked: [] });
  const s = useEditor.getState();

  /* --- the eraser ---------------------------------------------------- */
  s.pushHistory();
  const a = s.eraseProps(0, 0, 8);
  const b = useEditor.getState().eraseProps(6, 0, 8);
  check('the eraser takes out what is under it', a > 0 && b > 0, `${a} then ${b}`);
  /*
   * Everything, not just plants: the vegetation brush could only ever rub out
   * its own work, which is no use for a paddock full of cones.
   */
  check('and it is not fussy about what kind of thing it is',
    useEditor.getState().project.props.length === 40 - a - b &&
    !useEditor.getState().project.props.some((p) => Math.hypot(p.p[0], p.p[2]) < 7.9));
  useEditor.getState().undo();
  check('a whole sweep is one undo step', useEditor.getState().project.props.length === 40);

  // It is the ORIGIN that counts, so a big object whose centre is outside the
  // circle survives -- otherwise clearing cones in front of a grandstand takes
  // the grandstand.
  useEditor.setState({ project: grid(), past: [], future: [], selection: null, marked: [] });
  useEditor.getState().pushHistory();
  useEditor.getState().eraseProps(-20, -10, 2);
  const survivors = useEditor.getState().project.props;
  check('an object whose centre is outside the circle stays',
    survivors.length === 39 && survivors.every((p) => !(p.p[0] === -20 && p.p[2] === -10)));

  /* --- the marquee --------------------------------------------------- */
  useEditor.setState({ project: grid(), past: [], future: [], selection: null, marked: [] });
  const inBox = useEditor.getState().project.props.filter(
    (p) => p.p[0] >= -21 && p.p[0] <= -6 && p.p[2] >= -11 && p.p[2] <= 0,
  );
  useEditor.getState().setMarked(inBox.map((p) => p.id));
  check('a box marks everything standing in it', useEditor.getState().marked.length === inBox.length,
    `${inBox.length}`);
  const gone = useEditor.getState().deleteMarked();
  check('and Delete removes the lot', gone === inBox.length &&
    useEditor.getState().project.props.length === 40 - gone);
  check('as one undo step', (() => {
    useEditor.getState().undo();
    return useEditor.getState().project.props.length === 40;
  })());
  check('and the marks are dropped once they are acted on',
    useEditor.getState().marked.length === 0);
  check('deleting nothing marked does nothing', useEditor.getState().deleteMarked() === 0);

  /* Erasing has to keep the marks honest: an id that no longer exists would
     otherwise sit in the list until something tried to delete it. */
  useEditor.setState({ project: grid(), past: [], future: [], selection: null, marked: [] });
  useEditor.getState().setMarked(useEditor.getState().project.props.map((p) => p.id));
  useEditor.getState().pushHistory();
  useEditor.getState().eraseProps(0, 0, 8);
  const live = new Set(useEditor.getState().project.props.map((p) => p.id));
  check('marks left over after an erase are dropped',
    useEditor.getState().marked.every((id) => live.has(id)));
}

/* ------------------------------------------------------------------ */
/* What the plant brush is allowed to plant on                         */
/* ------------------------------------------------------------------ */

console.log('\nPlanting on the verge');

{
  /*
   * A straight road, so the numbers are exact. `clearanceAt` takes the minimum
   * over every cross section within reach, and on a curve the nearest tarmac to
   * a point beside one section belongs to another -- true, and useless for
   * pinning down a metre.
   */
  const p = defaultProject();
  p.road.runoffWidth = 23;
  p.track.closed = false;
  p.track.nodes = [0, 1, 2, 3, 4].map((i) =>
    ({ ...defaultProject().track.nodes[0], id: `v${i}`, p: [0, 0, i * 150], widthL: 6, widthR: 6 }));
  p.pit.nodes = [];
  p.road.kerbs = [];
  const d = getDerived(p);
  const trackIndex = new PointIndex(d.trackFrames.map((f) => f.pos), 50);
  const pitIndex = new PointIndex(d.pitFrames.map((f) => f.pos), 50);
  // Halfway along, so the ends of an open road cannot be the nearest thing.
  const f = d.trackFrames[(d.trackFrames.length / 2) | 0];
  const at = (metres) => ({
    x: f.pos.x + f.right.x * metres,
    z: f.pos.z + f.right.z * metres,
  });
  const clear = (metres, includeRunoff) => {
    const q = at(metres);
    return clearanceAt(q.x, q.z, d.trackFrames, trackIndex, d.profile, d.pitFrames, pitIndex, 80,
      includeRunoff);
  };

  const mid = (d.trackFrames.length / 2) | 0;
  const hard = f.widthR + d.profile.kerbWR[mid] + d.profile.apronR[mid];
  check('the tarmac and its kerb are out of bounds either way',
    clear(hard - 0.5, true) < 0 && clear(hard - 0.5, false) < 0);
  /*
   * The run off IS grass. Counting it as built ground is right for a tree --
   * a run off is meant to be empty -- and leaves a shaved strip up to a run
   * off wide beside the kerb when what is being planted is the grass itself.
   */
  const justOutside = hard + 1;
  check('a tree is kept off the run off', clear(justOutside, true) < 0,
    `${clear(justOutside, true).toFixed(1)} m`);
  check('but grass may go right up to the kerb', clear(justOutside, false) > 0.9,
    `${clear(justOutside, false).toFixed(1)} m`);
  // The gap between the two answers is the shoulder itself, wherever you stand.
  check('and the difference between the two is exactly the run off',
    Math.abs((clear(hard + 30, false) - clear(hard + 30, true)) - d.profile.runoffR[mid]) < 0.1,
    `${(clear(hard + 30, false) - clear(hard + 30, true)).toFixed(2)} m vs shoulder ${d.profile.runoffR[mid].toFixed(2)} m`);

  // The brush has to actually pass the flag through, or none of the above shows
  // up where it matters.
  const src = readFileSync(new URL('../src/scene/Viewport.tsx', import.meta.url), 'utf8');
  check('the plant brush passes the run off setting to the clearance test',
    /!cfg\.overRunoff/.test(src));
}

/* ------------------------------------------------------------------ */
/* Where the ground starts                                             */
/* ------------------------------------------------------------------ */

console.log('\nThe zero datum');

{
  const fresh = defaultProject();
  check('a new project puts its ground at exactly zero', fresh.terrain.base === 0);
  let flat = true;
  for (let i = 0; i < fresh.terrain.heights.length; i++) {
    if (fresh.terrain.heights[i] !== 0) { flat = false; break; }
  }
  check('and every height in it is zero, not just the setting', flat);
  check('so a track drawn on it starts at zero too',
    fresh.track.nodes.every((n) => n.p[1] === 0) && fresh.pit.nodes.every((n) => n.p[1] === 0));

  /* --- moving an old project onto that datum ------------------------- */
  {
    const old = defaultProject();
    old.terrain.base = -0.6;
    for (let i = 0; i < old.terrain.heights.length; i++) old.terrain.heights[i] = -0.6 + (i % 7) * 0.1;
    for (const n of old.track.nodes) n.p[1] = -0.6;
    old.props = [{ id: 'x1', kind: 'rock', name: 'rock', p: [10, -0.6, 20], r: [0, 0, 0], s: [1, 1, 1], ground: false }];
    old.grid.overrides = { 0: { p: [1, -0.6, 2], rot: 0 } };
    useEditor.setState({ project: old, past: [], future: [], selection: null });

    const beforeShape = [...useEditor.getState().project.terrain.heights].map((h, i) => h - useEditor.getState().project.track.nodes[0].p[1] + i * 0);
    useEditor.getState().shiftDatum(0.6);
    const p = useEditor.getState().project;

    check('the datum moves to zero', Math.abs(p.terrain.base) < 1e-9, `${p.terrain.base}`);
    check('and the track comes up with it', p.track.nodes.every((n) => Math.abs(n.p[1]) < 1e-6));
    check('objects and manual grid slots too',
      Math.abs(p.props[0].p[1]) < 1e-6 && Math.abs(p.grid.overrides[0].p[1]) < 1e-6);
    /*
     * The point of a datum shift is that NOTHING about the shape changes. Every
     * height relative to the track has to come out exactly as it went in, or
     * this is a landscape edit wearing a tidy-up's clothes.
     */
    let worst = 0;
    for (let i = 0; i < p.terrain.heights.length; i++) {
      worst = Math.max(worst, Math.abs((p.terrain.heights[i] - p.track.nodes[0].p[1]) - beforeShape[i]));
    }
    check('and the shape of the land is untouched', worst < 1e-6, `${worst} m out`);

    useEditor.getState().undo();
    check('one undo puts the old datum back',
      Math.abs(useEditor.getState().project.terrain.base + 0.6) < 1e-9);
    check('shifting by nothing does nothing at all', useEditor.getState().shiftDatum(0) === 0);
  }
}

/* ------------------------------------------------------------------ */
/* Barriers drawn by hand                                              */
/* ------------------------------------------------------------------ */

console.log('\nDrawn barrier runs');

{
  const line = (...pts) => pts.map(([x, z], i) => ({ x, y: i * 0.5, z }));

  /* --- a straight run ----------------------------------------------- */
  {
    const run = layBarrierRun(line([0, 0], [0, 80]), 8);
    check('a straight run is filled with modules', run.length === 10, `${run.length}`);
    check('and they all point along it', run.every((r) => Math.abs(r.rotY) < 1e-6));
    // End to end: each module centre exactly one length on from the last.
    let worst = 0;
    for (let i = 1; i < run.length; i++) {
      worst = Math.max(worst, Math.abs(Math.hypot(
        run[i].p[0] - run[i - 1].p[0], run[i].p[2] - run[i - 1].p[2]) - 8));
    }
    check('with no gap and no overlap between them', worst < 1e-6, `${worst.toFixed(6)} m`);
    check('the first one starts at the start', Math.abs(run[0].p[2] - 4) < 1e-6);
    check('and the height is carried along the run', run[run.length - 1].p[1] > run[0].p[1]);
  }

  /* --- length that does not divide evenly ---------------------------- */
  check('a run one module short of the next whole one is not padded out',
    layBarrierRun(line([0, 0], [0, 25]), 8).length === 3, 'three 8 m modules over 25 m');
  check('but one nearly long enough gets the module',
    layBarrierRun(line([0, 0], [0, 31]), 8).length === 4);
  check('and a run shorter than one module still gets one',
    layBarrierRun(line([0, 0], [0, 3]), 8).length === 1);
  check('nothing is laid along nothing at all',
    layBarrierRun(line([0, 0]), 8).length === 0 &&
    layBarrierRun(line([0, 0], [0, 0]), 8).length === 0);

  /* --- a corner in the line ------------------------------------------ */
  {
    const run = layBarrierRun(line([0, 0], [0, 40], [40, 40]), 8);
    check('a run round a corner keeps going past it', run.length === 10, `${run.length}`);
    const headings = new Set(run.map((r) => Math.round(r.rotY)));
    check('and the modules on each leg face their own way',
      headings.has(0) && headings.has(90), [...headings].join(' '));
    /*
     * Modules are rigid, so what has to meet is their ENDS. Aimed at the
     * tangent at their centre they would splay apart on the corner; aimed along
     * the chord they cover, the ends stay together.
     */
    let worstJoint = 0;
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1];
      const b = run[i];
      const endA = [
        a.p[0] + Math.sin((a.rotY * Math.PI) / 180) * 4,
        a.p[2] + Math.cos((a.rotY * Math.PI) / 180) * 4,
      ];
      const startB = [
        b.p[0] - Math.sin((b.rotY * Math.PI) / 180) * 4,
        b.p[2] - Math.cos((b.rotY * Math.PI) / 180) * 4,
      ];
      worstJoint = Math.max(worstJoint, Math.hypot(endA[0] - startB[0], endA[1] - startB[1]));
    }
    check('and their ends still meet at the corner', worstJoint < 0.6,
      `${worstJoint.toFixed(2)} m apart at the worst joint`);
  }

  /* --- through the store --------------------------------------------- */
  {
    useEditor.setState({ project: defaultProject(), past: [], future: [], selection: null });
    const s = useEditor.getState();
    s.setBarrierKind('armco');
    const n = s.addBarrierRun(line([0, 0], [0, 80]));
    const props = useEditor.getState().project.props;
    check('the store lays a run of the chosen module',
      n > 0 && props.length === n && props.every((p) => p.kind === 'armco'), `${n} modules`);
    check('and they are stuck to the ground like any other object',
      props.every((p) => p.ground));
    useEditor.getState().undo();
    check('a whole leg is one undo step',
      useEditor.getState().project.props.length === 0);
    // The module length comes from the tile box, so a different module gives a
    // different count over the same line.
    useEditor.getState().setBarrierKind('concrete_barrier');
    const n2 = useEditor.getState().addBarrierRun(line([0, 0], [0, 80]));
    check('a shorter module means more of them', n2 > n, `${n2} vs ${n}`);
  }

  /* The handles the other mode draws would swallow the clicks this one needs. */
  {
    const src = readFileSync(new URL('../src/scene/Viewport.tsx', import.meta.url), 'utf8');
    check('the roadside handles are hidden while a run is being drawn',
      /barrierMode === 'track' && <BarrierLayer/.test(src));
  }
}

/* ------------------------------------------------------------------ */
/* Grass you can see the blades of                                     */
/* ------------------------------------------------------------------ */

console.log('\nGrass tufts');

{
  for (const key of ['grass_tuft', 'grass_clump']) {
    const def = LIBRARY_BY_KEY.get(key);
    const parts = propParts(key);
    check(`${key} is one alpha tested card set`,
      parts.length === 1 && ALPHA_TESTED.has(parts[0].material), parts[0]?.material);
    /*
     * Grass a car bounces off would be worse than no grass: it has to be
     * decoration, so the exporter gives it no physics twin.
     */
    check('and it has no collision surface', def.surface === null);

    const g = parts[0].geometry;
    const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    // Cards, not geometry. A tuft that costs as much as a tree cannot be spread
    // thousands to a verge, which is the only way grass ever looks like grass.
    check('and it is cheap enough to plant by the thousand', tris <= 24, `${tris} triangles`);

    g.computeBoundingBox();
    check('it stands on the ground', Math.abs(g.boundingBox.min.y) < 1e-6);

    /*
     * Every card is built twice, mirrored, so it is visible from behind: AC
     * culls back faces, and half the time you drive past a tuft you are looking
     * at its other side. Mirrored copies cancel out, so the normals sum to zero.
     */
    const nrm = g.getAttribute('normal');
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let i = 0; i < nrm.count; i++) {
      sx += nrm.getX(i);
      sy += nrm.getY(i);
      sz += nrm.getZ(i);
    }
    check('and faces both ways', Math.hypot(sx, sy, sz) < 1e-6,
      `normals sum to ${Math.hypot(sx, sy, sz).toFixed(4)}`);
  }

  check('the plant brush can reach them',
    LIBRARY.filter((d) => d.category === 'Nature').some((d) => d.key === 'grass_tuft'));

  /*
   * The texture has to be mostly holes.
   *
   * The first attempt drew 150 blades up to 14 px wide over a 512 px tile --
   * three times more ink than fits -- and came out 60% opaque. Alpha tested,
   * that is a green rectangle with a few nicks in it, which is exactly what it
   * looked like next to a real circuit's verge. The fence tile, which does read
   * as a fence, is 23% drawn.
   */
  {
    /*
     * Measured for real in the browser -- 77.7% clear, 19.9% drawn, and the
     * top quarter of the tile at 0.1% against 53.5% at the roots -- but the
     * canvas needs a DOM, so what can be pinned here is the ink budget the
     * drawing works to. Blades times their average width times their average
     * height, over the area of the tile: past about a third the holes stop
     * being holes and the card goes back to being a green rectangle.
     */
    const src = readFileSync(new URL('../src/core/textures.ts', import.meta.url), 'utf8');
    const grass = src.slice(src.indexOf('function makeGrassBlades'), src.indexOf('SIGN_DISTANCES'));
    check('the grass tile starts from a clear canvas', /ctx\.clearRect/.test(grass));
    const blades = Number(/const BLADES = (\d+)/.exec(grass)?.[1] ?? 0);
    const width = /SIZE \* \(([\d.]+) \+ rnd\(\) \* ([\d.]+)\)/.exec(grass.slice(grass.indexOf('const w =')));
    const height = /SIZE \* \(([\d.]+) \+ r \* r \* ([\d.]+)\)/.exec(grass);
    check('it is drawn as countable blades', blades > 0 && width && height, `${blades} blades`);
    // Half width each side of the centre line, and the taper to a point halves
    // the area again; heights are r*r weighted, so their mean is base + span/3.
    const meanW = 2 * (Number(width[1]) + Number(width[2]) / 2);
    const meanH = Number(height[1]) + Number(height[2]) / 3;
    const ink = blades * meanW * (meanH / 2);
    check('and there is far more hole than blade', ink < 0.33,
      `${(ink * 100).toFixed(0)}% of the tile covered at most`);
  }

  /* Ground cover must not catch the pointer: there are thousands of tufts, they
     are ankle high, and every one is something between the cursor and whatever
     is actually being aimed at. */
  {
    const src = readFileSync(new URL('../src/scene/Viewport.tsx', import.meta.url), 'utf8');
    check('grass is transparent to clicks in the editor',
      /pickable=\{pickable && !GRASS_KINDS\.includes/.test(src));
  }

  /* And no physics twin on the way out: grass a car bounces off is worse than
     no grass at all. */
  {
    const p = defaultProject();
    p.props = [
      { id: 'g', kind: 'grass_tuft', name: 'g', p: [10, 0, 10], r: [0, 0, 0], s: [1, 1, 1], ground: true },
      { id: 'w', kind: 'armco', name: 'w', p: [30, 0, 10], r: [0, 0, 0], s: [1, 1, 1], ground: true },
    ];
    const meshes = propMeshes(p, getDerived(p).terrainHeights);
    const grass = meshes.filter((m) => m.material === 'grass_blades');
    check('grass exports as decoration with no surface',
      grass.length > 0 && grass.every((m) => m.surface === null && physicsNameFor(m.name, m.surface) === null));
    check('and the barrier beside it still gets its physics twin',
      meshes.some((m) => m.surface === 'WALL' && physicsNameFor(m.name, m.surface)?.startsWith('1WALL_')));
  }
}

/* ------------------------------------------------------------------ */
/* Trees that are pictures rather than geometry                        */
/* ------------------------------------------------------------------ */

console.log('\nTree cards');

{
  const CARDS = [
    ['tree_pine_2d', 'pine'],
    ['tree_round_2d', 'broadleaf'],
    ['tree_poplar_2d', 'poplar'],
    ['tree_scrub_2d', 'scrub'],
  ];

  for (const [key, species] of CARDS) {
    const def = LIBRARY_BY_KEY.get(key);
    const parts = propParts(key);
    check(`${key} is one alpha tested card set`,
      parts.length === 1 && ALPHA_TESTED.has(parts[0].material), parts[0]?.material);
    check('and it is decoration, with no surface a car can hit', def.surface === null);

    const g = parts[0].geometry;
    const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    /*
     * Two crossed cards, both drawn from both sides: four quads, eight
     * triangles. The whole reason the technique exists is that this number is
     * two orders below the modelled broadleaf's 624, so if it ever creeps the
     * trade has been lost and there is no point having both kinds.
     */
    check('and it costs eight triangles, not six hundred', tris === 8, `${tris} triangles`);

    g.computeBoundingBox();
    const b = g.boundingBox;
    check('it stands on the ground', Math.abs(b.min.y) < 1e-6, `${b.min.y}`);

    // Crossed, not a single plane: a lone card disappears edge on, which is
    // the one failure everybody notices from inside a car.
    const sx = b.max.x - b.min.x;
    const sz = b.max.z - b.min.z;
    check('and it is a cross rather than one flat plane',
      sx > 0.5 && sz > 0.5 && Math.abs(sx - sz) < 1e-6, `${sx.toFixed(2)} x ${sz.toFixed(2)} m`);

    /*
     * The card has to be the size its tile was drawn for. Nothing catches this
     * at runtime -- a stretched tree is a perfectly valid mesh with a perfectly
     * valid texture on it -- so it is pinned here.
     */
    const spec = TREE_CARDS[species];
    check('the card is the size its tile was drawn for',
      Math.abs(sx - spec.w) < 1e-6 && Math.abs(b.max.y - spec.h) < 1e-6,
      `${sx.toFixed(2)} x ${(b.max.y).toFixed(2)} against ${spec.w} x ${spec.h}`);

    /*
     * And it reads its OWN tile of the sheet. Get this wrong and a pine wears
     * the poplar's picture, which is the kind of bug that survives review
     * because both of them are still trees.
     */
    const col = spec.tile % 2;
    const row = (spec.tile / 2) | 0;
    const uv = g.getAttribute('uv');
    let stray = 0;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      const inU = u >= col / 2 - 1e-6 && u <= (col + 1) / 2 + 1e-6;
      const inV = v >= (1 - row) / 2 - 1e-6 && v <= (2 - row) / 2 + 1e-6;
      if (!inU || !inV) stray++;
    }
    check('and every corner of it lands inside that tile', stray === 0, `${stray} stray uvs`);

    /*
     * Normals bent towards the crown and the sky, not out of the card's face.
     * Face normals light two crossed panels at two different angles, so the
     * tree comes out bright down one half and dark down the other, with every
     * tree on the track seamed the same way. Every normal pointing at least
     * somewhat upwards is what that fix looks like from here.
     */
    const nrm = g.getAttribute('normal');
    let flat = 0;
    for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0.2) flat++;
    check('and its normals light it like a crown, not like a fence panel',
      flat === 0, `${flat} of ${nrm.count} normals point sideways or down`);
  }

  // One sheet, one material, one draw call for the whole wood -- which is the
  // entire argument for an atlas over a texture per species.
  const materials = new Set(CARDS.flatMap(([k]) => propParts(k).map((p) => p.material)));
  check('all four species share one material',
    materials.size === 1 && materials.has('tree_card'), [...materials].join(','));

  const tiles = new Set(Object.values(TREE_CARDS).map((c) => c.tile));
  check('and each has a tile of the sheet to itself',
    tiles.size === Object.keys(TREE_CARDS).length, `${tiles.size} tiles for ${Object.keys(TREE_CARDS).length} species`);

  check('the plant brush can reach them',
    CARDS.every(([k]) => LIBRARY_BY_KEY.get(k)?.category === 'Nature'));

  /*
   * The modelled trees are hidden, not deleted, and the difference is the
   * whole point. A project autosaved before the cards existed holds them by
   * the hundred; drop the entry and `propParts` returns nothing for that kind,
   * so every one of them becomes an invisible nothing in a track its author
   * has already built. Superseded means off the shelf, never unbuildable.
   */
  const SUPERSEDED = ['tree_pine', 'tree_round', 'bush'];
  check('the modelled trees are no longer offered',
    SUPERSEDED.every((k) => LIBRARY_BY_KEY.get(k)?.hidden === true),
    SUPERSEDED.filter((k) => !LIBRARY_BY_KEY.get(k)?.hidden).join(','));
  check('but a track that already holds one still gets a tree',
    SUPERSEDED.every((k) => propParts(k).length > 0));

  /*
   * Both palettes have to read `hidden`, and the plant brush's did not: it
   * filtered on category alone, so hiding a tree took it out of the object
   * library and left it sitting in the Plant panel.
   */
  {
    const src = readFileSync(new URL('../src/ui/LeftPanel.tsx', import.meta.url), 'utf8');
    check('and the plant palette hides a superseded plant, not just the object library',
      /LIBRARY\.filter\(\(d\) => !d\.hidden && d\.category === 'Nature'\)/.test(src));
  }

  /*
   * And nothing may START on something its own palette will not show. The
   * place tool opened on 'tree_pine', which after hiding it meant a tool whose
   * selection was not in its own list -- no highlight anywhere, and a click
   * dropping an object the user never picked.
   */
  {
    const st = useEditor.getState();
    const offered = (k) => LIBRARY_BY_KEY.get(k) && !LIBRARY_BY_KEY.get(k).hidden;
    check('the place tool starts on something the library shows', offered(st.placeKind), st.placeKind);
    check('and the plant brush starts on plants it shows',
      st.scatter.kinds.length > 0 && st.scatter.kinds.every(offered), st.scatter.kinds.join(','));
  }

  /*
   * The generated circuit scatters up to 2600 plants over its forest belt, so
   * it is by far the biggest consumer of the trade. One modelled bush among
   * them at 576 triangles is most of a card wood on its own.
   */
  {
    const src = readFileSync(new URL('../src/core/generate.ts', import.meta.url), 'utf8');
    const kinds = [...src.matchAll(/kind = '([a-z_0-9]+)'/g)].map((m) => m[1]);
    check('and a generated circuit plants nothing but cards',
      kinds.length > 0 && kinds.every((k) => !LIBRARY_BY_KEY.get(k)?.hidden), kinds.join(','));
  }

  /*
   * The placement ghost has to be tree shaped.
   *
   * A card's geometry is a bare rectangle, so the plain tinted ghost every
   * solid object gets showed two clear panes crossed at the cursor: it said
   * where the CARD was going, which nobody wants to know, and nothing about
   * where the tree was going.
   *
   * The threshold is the part that silently breaks. three.js tests the final
   * alpha, which for a see through ghost is its opacity times the texture's,
   * so the real material's flat 0.5 discards every pixel on the card and the
   * preview vanishes altogether. It has to be scaled by the opacity, and a
   * reader who does not know that will "tidy" it back.
   */
  {
    const src = readFileSync(new URL('../src/scene/Viewport.tsx', import.meta.url), 'utf8');
    const ghost = src.slice(src.indexOf('function ghostMaterial'), src.indexOf('function GhostPiece'));
    check('the ghost of an alpha tested part carries its texture',
      /ALPHA_TESTED\.has\(key\)/.test(ghost) && /map: getTexture\(key\)/.test(ghost));
    check('and cuts it at the opacity it is drawn with, not at a flat half',
      /alphaTest: base\.opacity \* 0\.5/.test(ghost));
    check('and a snapped ghost is still a different colour from a free one',
      /flush \? '#[0-9a-f]{6}' : '#[0-9a-f]{6}'/.test(ghost));
    check('and every part of a library ghost picks its own material',
      /material=\{ghostMaterial\(p\.material, flush\)\}/.test(src));
  }

  /*
   * The sheet itself needs a DOM, so what can be pinned here is the drawing.
   * Two things matter and neither is visible in the geometry: the canvas has
   * to start clear, or the "cut out" tree ships with a green rectangle behind
   * it; and the crown has to be cut into, or an alpha tested card with no sky
   * through it is a green blob whatever is painted on it.
   */
  {
    const src = readFileSync(new URL('../src/core/textures.ts', import.meta.url), 'utf8');
    const sheet = src.slice(src.indexOf('function makeTreeCards'));
    check('the tree sheet starts from a clear canvas', /ctx\.clearRect/.test(sheet));
    const holes = [...sheet.matchAll(/holes: (\d+)/g)].map((m) => Number(m[1]));
    const channels = [...sheet.matchAll(/channels: (\d+)/g)].map((m) => Number(m[1]));
    check('and every crown on it has sky cut through it',
      holes.length === 3 && channels.length === 3 && holes.every((h) => h > 20) && channels.every((c) => c > 2),
      `holes ${holes.join(',')} channels ${channels.join(',')}`);
    check('and the crowns are stippled from many small clumps, not a few big ones',
      [...sheet.matchAll(/clumps: (\d+)/g)].every((m) => Number(m[1]) >= 200));
  }
}

/* ------------------------------------------------------------------ */
/* Keeping the planting off a road that moved                          */
/* ------------------------------------------------------------------ */

console.log('\nPlants under a moving road');

{
  const p = defaultProject();
  const props = [];
  // A line of tufts along the start straight, and trees well away from it.
  for (let i = 0; i < 20; i++) {
    props.push({ id: `g${i}`, kind: 'grass_tuft', name: 'g',
      p: [i * 2 - 20, 0, -140], r: [0, 0, 0], s: [1, 1, 1], ground: true });
  }
  for (let i = 0; i < 10; i++) {
    props.push({ id: `t${i}`, kind: 'tree_pine', name: 't',
      p: [i * 8 - 40, 0, -320], r: [0, 0, 0], s: [1, 1, 1], ground: true });
  }
  p.props = props;
  useEditor.setState({ project: p, past: [], future: [], selection: null, marked: [] });

  const gone = clearPlantsOffTrack();
  const left = useEditor.getState().project.props;
  check('plants standing on the road are taken out', gone === 20, `${gone} removed`);
  check('and the ones clear of it are left alone',
    left.length === 10 && left.every((x) => x.kind === 'tree_pine'));
  useEditor.getState().undo();
  check('as one undo step', useEditor.getState().project.props.length === 30);

  /*
   * The point of the whole thing: it has to work AFTER the road has moved,
   * which is the one case a cached spatial index gets wrong. The frame objects
   * are reused between rebuilds, so an index keyed on array identity alone
   * keeps answering questions about where the road used to be -- and this
   * function only ever runs because the road moved.
   */
  // Warm whatever cache there is by asking about the road where it stands...
  useEditor.setState({ project: p, past: [], future: [], selection: null });
  useEditor.getState().commit((q) => {
    // ...with the plants moved clear of it, so this first pass removes nothing
    // and can only serve to fill the cache.
    q.props = q.props.map((x) => ({ ...x, p: [x.p[0], x.p[1], x.p[2] - 60] }));
  });
  check('nothing to do while the plants are clear of the road',
    clearPlantsOffTrack() === 0);
  // Now move the ROAD onto them. Same array of frames, new positions inside it.
  useEditor.getState().commit((q) => {
    for (const n of q.track.nodes) n.p[2] -= 60;
  });
  const gone2 = clearPlantsOffTrack();
  check('and it sees the road where it is NOW, not where it was',
    gone2 === 20, `${gone2} removed after moving the track`);

  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  check('the editor runs it when a drag ends', /clearPlantsOffTrack\(\)/.test(app));
  /* On a drag ending, NOT on any change: running it on every change would fire
     on undo too, quietly deleting what the undo just brought back. */
  check('and only then, so undo can never be eaten by it',
    /if \(s\.interacting\)/.test(app) && /dragging = false/.test(app));
}

/* ------------------------------------------------------------------ */
/* Kerbs that are flat                                                 */
/* ------------------------------------------------------------------ */

console.log('\nFlat kerbs');

{
  /*
   * A painted kerb with no step at all is a real thing -- long stretches of
   * most modern circuits have one -- and the height slider used to stop at a
   * centimetre, so it could not be built. In AC the rumble comes from the KERB
   * surface in surfaces.ini, not from the geometry, so a flat one still
   * rattles the car and still counts as track.
   */
  const p = defaultProject();
  p.road.kerbs = fullLapKerbs({ kerbWidth: 1.2, kerbHeight: 0.07 })
    .map((s) => ({ ...s, style: 'flat', height: 0, width: 1.2 }));
  const d = getDerived(p);

  let maxLift = 0;
  for (let i = 0; i < d.trackFrames.length; i++) {
    maxLift = Math.max(maxLift, d.profile.kerbHL[i], d.profile.kerbHR[i]);
  }
  check('a kerb set to zero height lies flat on the road', maxLift < 1e-9, `${maxLift} m`);

  let width = 0;
  for (let i = 0; i < d.trackFrames.length; i++) width = Math.max(width, d.profile.kerbWR[i]);
  check('but it is still there, with its full width', width > 1.0, `${width.toFixed(2)} m`);

  const kerbMeshes = d.roadMeshes.filter((m) => m.name.includes('KERB'));
  check('and it still comes out as kerb surface, so it still rumbles',
    kerbMeshes.length > 0, kerbMeshes.map((m) => m.name).join(' '));

  // Nothing degenerate: a flat kerb is a strip, not a zero area sliver.
  let tris = 0;
  for (const m of kerbMeshes) {
    const g = m.geometry;
    const idx = g.index;
    const range = g.drawRange.count === Infinity ? (idx ? idx.count : 0) : g.drawRange.count;
    tris += range / 3;
  }
  check('and it is real geometry, not an empty mesh', tris > 100, `${tris} triangles`);

  const panel = readFileSync(new URL('../src/ui/LeftPanel.tsx', import.meta.url), 'utf8');
  check('the height slider goes all the way down to zero',
    /value=\{shape\.height\} min=\{0\}/.test(panel));
}

/* ------------------------------------------------------------------ */
/* Braking boards                                                      */
/* ------------------------------------------------------------------ */

console.log('\nBraking boards');

{
  /*
   * A circuit with something to sign: two long straights into two hairpins,
   * which is the shape the feature exists for. Built as a rounded rectangle so
   * the corners are real corners and the straights are really straight.
   */
  const circuit = defaultProject();
  const pts = [];
  const L = 300;
  const W = 140;
  for (const [x, z] of [[-L, -W], [0, -W], [L, -W]]) pts.push([x, z]);
  pts.push([L + 60, -W + 40], [L + 60, W - 40]);
  for (const [x, z] of [[L, W], [0, W], [-L, W]]) pts.push([x, z]);
  pts.push([-L - 60, W - 40], [-L - 60, -W + 40]);
  circuit.track.closed = true;
  circuit.track.nodes = pts.map(([x, z]) =>
    ({ ...defaultProject().track.nodes[0], id: `c${x}_${z}`, p: [x, 0, z], widthL: 6, widthR: 6 }));
  circuit.pit.nodes = [];
  circuit.road.samplesPerSegment = 24;

  const d = getDerived(circuit);
  const corners = findCorners(d.trackFrames, true, DEFAULT_BRAKE_CFG);
  /* Two ends, each turned through with two control points, so the sweep round
     each end reads as a pair of bends rather than one -- which is what it
     geometrically is. */
  check('the corners of a rounded rectangle are all found', corners.length === 4, `${corners.length}`);
  check('and each of them turns a real corner',
    corners.every((c) => c.degrees > 40 && c.degrees < 120),
    corners.map((c) => `${c.degrees.toFixed(0)}°`).join(' '));
  check('they all turn the same way round a lap', corners.every((c) => c.turn === corners[0].turn));

  const plan = planBrakeMarkers(d.trackFrames, true, d.profile, DEFAULT_BRAKE_CFG);
  check('boards are placed', plan.length > 0, `${plan.length} boards`);
  check('and each one carries its own number',
    plan.every((m) => m.kind === brakeMarkerKind(m.distance)));
  check('every board belongs to a corner that was found',
    plan.every((m) => corners.some((c) => Math.abs(c.dist - m.cornerDist) < 1e-6)));

  /* --- the distance really is the distance --------------------------- */
  const fr = d.trackFrames;
  const lap = fr[fr.length - 1].dist + fr[fr.length - 1].pos.distanceTo(fr[0].pos);
  let worstDist = 0;
  for (const m of plan) {
    let gap = m.cornerDist - m.dist;
    if (gap < 0) gap += lap;
    worstDist = Math.max(worstDist, Math.abs(gap - m.distance));
  }
  /*
   * Measured along the ARC. A board 150 m before a hairpin is 150 m of driving
   * back, which on a circuit that is already turning is not the same place as
   * 150 m as the crow flies. The tolerance is one cross section: a board stands
   * beside one, it is not interpolated between two.
   */
  check('boards sit the stated distance back along the track',
    worstDist < 0.5, `${worstDist.toFixed(2)} m out`);

  /* --- and they are somewhere sensible ------------------------------- */
  let worstClear = Infinity;
  let facing = -1;
  for (const m of plan) {
    const f = fr[m.frame];
    const lat = (m.p[0] - f.pos.x) * f.right.x + (m.p[2] - f.pos.z) * f.right.z;
    worstClear = Math.min(worstClear, Math.abs(lat) - (lat < 0 ? f.widthL : f.widthR));
    // The board's +Z has to point back down the track at the arriving car.
    const rad = (m.rotY * Math.PI) / 180;
    facing = Math.max(facing, Math.sin(rad) * f.fwd.x + Math.cos(rad) * f.fwd.z);
  }
  check('no board stands on the tarmac', worstClear > 0.5, `${worstClear.toFixed(2)} m clear`);
  check('and every one faces the car coming at it', facing < -0.99, `dot ${facing.toFixed(3)}`);

  /* Outside of the bend: a left hander's boards stand on its right. */
  const outside = plan.every((m) => {
    const corner = corners.find((c) => Math.abs(c.dist - m.cornerDist) < 1e-6);
    const f = fr[m.frame];
    const lat = (m.p[0] - f.pos.x) * f.right.x + (m.p[2] - f.pos.z) * f.right.z;
    return Math.sign(lat) === -corner.turn;
  });
  check('and stands on the outside of the bend it signs', outside);

  let closestPair = Infinity;
  for (let a = 0; a < plan.length; a++) {
    for (let b = a + 1; b < plan.length; b++) {
      closestPair = Math.min(
        closestPair,
        Math.hypot(plan[a].p[0] - plan[b].p[0], plan[a].p[2] - plan[b].p[2]),
      );
    }
  }
  check('and no two boards are on top of each other', closestPair > 14, `${closestPair.toFixed(1)} m apart`);

  /* --- the shapes that have no braking point ------------------------- */
  check('a track that never straightens out gets no boards at all',
    planBrakeMarkers(getDerived(defaultProject()).trackFrames, true,
      getDerived(defaultProject()).profile, { ...DEFAULT_BRAKE_CFG, radius: 500 }).length === 0);
  const straight = defaultProject();
  straight.track.closed = false;
  straight.track.nodes = [0, 1, 2, 3].map((i) =>
    ({ ...defaultProject().track.nodes[0], id: `s${i}`, p: [0, 0, i * 200] }));
  check('and a straight road gets none either',
    planBrakeMarkers(getDerived(straight).trackFrames, false, getDerived(straight).profile).length === 0);

  /* --- placing them is one undo step, and repeatable ----------------- */
  {
    useEditor.setState({ project: circuit, past: [], future: [], selection: null });
    const n1 = useEditor.getState().applyBrakeMarkers(plan);
    check('placing the boards puts them all in the project',
      useEditor.getState().project.props.length === n1, `${n1}`);
    const n2 = useEditor.getState().applyBrakeMarkers(plan);
    check('and doing it again replaces them rather than doubling up',
      useEditor.getState().project.props.filter((p) => BRAKE_MARKER_KINDS.includes(p.kind)).length === n2);
    useEditor.getState().undo();
    check('one undo takes a whole set back',
      useEditor.getState().project.props.filter((p) => BRAKE_MARKER_KINDS.includes(p.kind)).length === n1);
    check('and clearing removes every one', useEditor.getState().clearBrakeMarkers() === n1 &&
      useEditor.getState().project.props.length === 0);
  }

  /* --- the boards themselves ---------------------------------------- */
  for (const dmet of SIGN_DISTANCES) {
    const parts = propParts(brakeMarkerKind(dmet));
    check(`the ${dmet} m board is one plain slab`,
      parts.length === 1 && parts[0].material === 'sign_board');
    parts[0].geometry.computeBoundingBox();
    const bb = parts[0].geometry.boundingBox;
    check(`and it stands on the ground with no legs under it`,
      Math.abs(bb.min.y) < 1e-6 && bb.max.y > 1 && bb.max.y < 1.6,
      `${bb.min.y.toFixed(2)} .. ${bb.max.y.toFixed(2)} m`);
    // Each board reads its own quarter of the shared sheet.
    const uv = parts[0].geometry.getAttribute('uv');
    let u0 = 1;
    let v0 = 1;
    for (let i = 0; i < uv.count; i++) {
      u0 = Math.min(u0, uv.getX(i));
      v0 = Math.min(v0, uv.getY(i));
    }
    const idx = SIGN_DISTANCES.indexOf(dmet);
    check(`and takes its number from tile ${idx} of the sheet`,
      Math.abs(u0 - (idx % 2) * 0.5) < 1e-6 && Math.abs(v0 - (1 - ((idx / 2) | 0)) * 0.5) < 1e-6,
      `u0 ${u0.toFixed(2)} v0 ${v0.toFixed(2)}`);
  }
}

/* ------------------------------------------------------------------ */
/* What the pointer is allowed to ray test                             */
/* ------------------------------------------------------------------ */

console.log('\nPointer picking');

{
  /*
   * A source check, like the icon one below, because the thing being pinned is
   * a piece of JSX that cannot be imported headlessly -- and because it is
   * worth pinning. react-three-fiber ray tests every object carrying a pointer
   * handler on every pointermove, and an InstancedMesh tests every instance it
   * holds. With a few thousand objects that measured 1.7 ms per mouse event,
   * against pointer moves arriving eighteen to a frame: the backlog grew five
   * times faster than it drained and cashed itself in as a four second freeze
   * the moment the brush stroke ended. Nothing but Select picks an object, so
   * nothing else may leave them in the interaction list.
   */
  const src = readFileSync(new URL('../src/scene/Viewport.tsx', import.meta.url), 'utf8');

  check(
    'the props layer works out whether the tool picks objects at all',
    /const pickable = tool === 'select'/.test(src),
    'PropsLayer must derive `pickable` from the tool',
  );
  /*
   * Both sides named explicitly. Handing back `undefined` for the pickable case
   * asks react-three-fiber to restore the class default for a METHOD, and an
   * object that does not get it back stays unpickable for the rest of its life
   * -- which looks exactly like "I placed these and now I cannot click them".
   */
  check(
    'batched objects are only ray tested when they are pickable',
    /raycast=\{pickable \? INSTANCED_RAYCAST : NO_RAYCAST\}/.test(src),
    'PropInstances must switch its raycast off when not pickable, and back ON when it is',
  );
  check(
    'and the pickable raycast is the real one, not a stub',
    /const INSTANCED_RAYCAST = THREE\.InstancedMesh\.prototype\.raycast/.test(src),
  );
  const gatedHandlers = (src.match(/pickable\s*\n?\s*\?\s*\(e/g) ?? []).length;
  check(
    'and their click handlers are gated on the same flag',
    gatedHandlers >= 2,
    `${gatedHandlers} gated handlers, expected the instanced mesh and the single object`,
  );
  check(
    'the cursor preview is coalesced onto the frame, not the mouse event',
    /cursorFrame\.current = requestAnimationFrame/.test(src),
    'a pointer move must not cause its own React render',
  );

  /*
   * The instancing loop must not allocate.
   *
   * Every placed object's matrix is rebuilt whenever the ground moves, which is
   * every frame of a brush stroke. `propMatrix` makes five objects per call; at
   * fourteen thousand instances that is seventy thousand objects a frame and
   * four million a second, all of them dead on arrival. The trace that finally
   * explained a four second freeze after a single click had three major
   * collections at the end of it.
   */
  check(
    'the instanced batches fill a matrix they already own',
    /writePropMatrix\(list\[i\], terrain, heights, m\)/.test(src),
    'PropInstances must use writePropMatrix, not the allocating propMatrix',
  );
  check(
    'and only pay for a bounding sphere when something will read it',
    /if \(pickable\) mesh\.computeBoundingSphere\(\)/.test(src),
    'frustum culling is off on these meshes, so the sphere is only for picking',
  );
  /*
   * The kn5 writer keeps ONE growing buffer.
   *
   * It used to append a small typed array per value written. A vertex is eleven
   * floats, so a million triangle track produced tens of millions of tiny
   * objects: measured, a three thousand object export took the heap from 33 MB
   * to 2.3 GB and killed the tab with "Out of Memory", for a 64 MB file. With
   * one buffer it peaks at 200 MB and takes less than half the time.
   */
  const kn5src = readFileSync(new URL('../src/export/kn5.ts', import.meta.url), 'utf8');
  check(
    'the kn5 writer appends into one buffer rather than a heap of fragments',
    /private buf = new Uint8Array/.test(kn5src) && !/parts\.push\(/.test(kn5src),
    'Out must grow a single buffer; per value arrays cost gigabytes on a real track',
  );

  const alloc = readFileSync(new URL('../src/core/props.ts', import.meta.url), 'utf8');
  check(
    'and the allocation free path is the one the loop can reach',
    /export function writePropMatrix/.test(alloc) && /const tmpQuat = new THREE\.Quaternion\(\)/.test(alloc),
    'props.ts must offer a scratch based matrix builder',
  );
}

/* ------------------------------------------------------------------ */
/* UI assets                                                           */
/* ------------------------------------------------------------------ */

console.log('\nIcons');

{
  // An inline <svg> carrying only a viewBox has no intrinsic size and
  // collapses to 0x0 inside a flex button. That is what happened to the whole
  // top bar (new / open / save / undo / redo / export and the gizmo toggles)
  // while the left toolbar looked fine, because only `.tool svg` had a size
  // in the stylesheet. The size has to live on the element so no icon can
  // depend on a stylesheet rule happening to match its container.
  const src = readFileSync(new URL('../src/ui/icons.tsx', import.meta.url), 'utf8');
  const base = src.slice(src.indexOf('const base = {'), src.indexOf('};', src.indexOf('const base = {')));
  check('the shared icon base declares a width', /\bwidth:\s*\d/.test(base), base.replace(/\s+/g, ' '));
  check('and a height', /\bheight:\s*\d/.test(base));

  const svgs = [...src.matchAll(/<svg([^>]*)>/g)].map((m) => m[1]);
  check('every icon spreads that base', svgs.length > 0 && svgs.every((a) => a.includes('{...base}')),
    `${svgs.filter((a) => !a.includes('{...base}')).length} of ${svgs.length} do not`);
}

/* ------------------------------------------------------------------ */
/* The three ways to start                                             */
/* ------------------------------------------------------------------ */

console.log('\nWays to start');
{
  const empty = emptyProject();
  check('an empty project has no track', empty.track.nodes.length === 0);
  check('and no pit lane', empty.pit.nodes.length === 0);
  check('but it still has ground to draw on', empty.terrain.enabled && empty.terrain.size >= 2000,
    `${empty.terrain.size} m`);
  check('the field is centred on the origin',
    empty.terrain.originX === -empty.terrain.size / 2 && empty.terrain.originZ === -empty.terrain.size / 2);
  check('and a fresh track is the width of a real circuit',
    defaultProject().track.nodes.every((n) => n.widthL + n.widthR >= 13),
    `${defaultProject().track.nodes[0].widthL * 2} m`);

  /*
   * The generator. What it hands over has to be a race track: the length it
   * offered, corners a car can take, a start/finish straight with the timing
   * line in the middle of it, a pit lane attached to the road with its entry
   * before the line and its exit after it, and elevation that came from the
   * ground underneath rather than from nowhere.
   */
  let worstTurn = 0;
  let worstLengthError = 0;
  let steepest = 0;
  let flattestRelief = Infinity;
  let crossings = 0;
  let fewestStraights = Infinity;
  for (let seed = 1; seed <= 12; seed++) {
    let x = (seed * 2654435761) % 4294967296;
    const rng = () => ((x = (x * 1103515245 + 12345) >>> 0) / 4294967296);
    const size = seed % 3 === 0 ? 'short' : seed % 3 === 1 ? 'medium' : 'long';
    const want = size === 'short' ? 4000 : size === 'medium' ? 5500 : 7000;
    const c = generateCircuit(size, 7, 129, 12, rng);
    worstLengthError = Math.max(worstLengthError, Math.abs(c.length - want) / want);

    const pts = c.track.map((n) => ({ x: n.p[0], y: n.p[1], z: n.p[2] }));
    for (let i2 = 0; i2 < pts.length; i2++) {
      const prev = pts[(i2 - 1 + pts.length) % pts.length];
      const cur = pts[i2];
      const next = pts[(i2 + 1) % pts.length];
      let d = Math.atan2(next.z - cur.z, next.x - cur.x) - Math.atan2(cur.z - prev.z, cur.x - prev.x);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      worstTurn = Math.max(worstTurn, Math.abs(d));
      const run = Math.hypot(next.x - cur.x, next.z - cur.z);
      if (run > 1) steepest = Math.max(steepest, Math.abs(next.y - cur.y) / run);
    }
    const ys = pts.map((q) => q.y);
    flattestRelief = Math.min(flattestRelief, Math.max(...ys) - Math.min(...ys));

    // Self intersection: any two non-adjacent segments of the ring crossing.
    const sideOfLine = (a2, b2, c2) => (b2.x - a2.x) * (c2.z - a2.z) - (b2.z - a2.z) * (c2.x - a2.x);
    let crossed = false;
    for (let i2 = 0; i2 < pts.length && !crossed; i2++) {
      for (let j2 = i2 + 2; j2 < pts.length; j2++) {
        if (i2 === 0 && j2 === pts.length - 1) continue;
        const a2 = pts[i2];
        const b2 = pts[(i2 + 1) % pts.length];
        const c2 = pts[j2];
        const d2 = pts[(j2 + 1) % pts.length];
        const s1 = sideOfLine(a2, b2, c2) > 0;
        const s2 = sideOfLine(a2, b2, d2) > 0;
        const s3 = sideOfLine(c2, d2, a2) > 0;
        const s4 = sideOfLine(c2, d2, b2) > 0;
        if (s1 !== s2 && s3 !== s4) { crossed = true; break; }
      }
    }
    if (crossed) crossings++;

    // How much of the lap is actually straight: heading change under 8 degrees.
    let straights = 0;
    for (let i2 = 0; i2 < pts.length; i2++) {
      const prev = pts[(i2 - 1 + pts.length) % pts.length];
      const cur = pts[i2];
      const next = pts[(i2 + 1) % pts.length];
      let d = Math.atan2(next.z - cur.z, next.x - cur.x) - Math.atan2(cur.z - prev.z, cur.x - prev.x);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < (8 * Math.PI) / 180) straights++;
    }
    fewestStraights = Math.min(fewestStraights, straights);
  }
  /*
   * Real corners, a pit lane of pit lane size, and the country planted.
   *
   * The old plan could not bend tighter than a ~180 m radius, which a modern
   * car takes flat -- a whole lap of corners nobody brakes for. The grafted
   * corners have to bring real radii, without ever handing over something
   * undrivable; the lane has to be sized for its boxes rather than spanning
   * the whole straight; and the forest has to stay off the road.
   */
  {
    let fewestSlow = Infinity;
    let tightest = Infinity;
    let worstPit = 0;
    let fewestBoxes = Infinity;
    let boxesFit = true;
    let fewestTrees = Infinity;
    let mostTrees = 0;
    let closestTree = Infinity;
    let closestTreeToPit = Infinity;
    for (let seed = 1; seed <= 12; seed++) {
      let x2 = (seed * 2654435761) % 4294967296;
      const rng = () => ((x2 = (x2 * 1103515245 + 12345) >>> 0) / 4294967296);
      const size = seed % 3 === 0 ? 'short' : seed % 3 === 1 ? 'medium' : 'long';
      const c = generateCircuit(size, 7, 129, 12, rng, { trees: true });
      const cf = computeFrames({ closed: true, nodes: c.track }, 12);

      // Distinct slow corners: runs of cross sections under a 90 m radius.
      let slow = 0;
      let inRun = false;
      let minR = Infinity;
      for (const f of cf) {
        const r = Math.abs(f.curvature) > 1e-6 ? 1 / Math.abs(f.curvature) : Infinity;
        minR = Math.min(minR, r);
        if (r < 90 && !inRun) { slow++; inRun = true; }
        if (r >= 110) inRun = false;
      }
      fewestSlow = Math.min(fewestSlow, slow);
      tightest = Math.min(tightest, minR);

      const cpf = computeFrames({ closed: false, nodes: c.pit }, 12);
      const pitLen = pathLength(cpf, false);
      worstPit = Math.max(worstPit, pitLen);
      const lastBox = c.pitCfg.startDist + (c.pitCfg.boxCount - 1) * c.pitCfg.boxSpacing;
      if (!(c.pitCfg.limitStart < c.pitCfg.startDist && lastBox < pitLen - 30)) boxesFit = false;
      fewestBoxes = Math.min(fewestBoxes, c.pitCfg.boxCount);

      // The buildings stand close to the lane and the straight on purpose;
      // the keep-off rules below are the VEGETATION's.
      const veg = c.props.filter((t) => t.kind.startsWith('tree') || t.kind === 'bush');
      fewestTrees = Math.min(fewestTrees, veg.length);
      mostTrees = Math.max(mostTrees, veg.length);
      for (const t of veg) {
        for (const f of cf) {
          closestTree = Math.min(closestTree, Math.hypot(f.pos.x - t.p[0], f.pos.z - t.p[2]));
        }
        for (const f of cpf) {
          closestTreeToPit = Math.min(closestTreeToPit, Math.hypot(f.pos.x - t.p[0], f.pos.z - t.p[2]));
        }
      }
    }
    check('every generated lap has at least one slow corner to brake for',
      fewestSlow >= 1, `fewest: ${fewestSlow}`);
    check('and no corner tighter than a hairpin a car can take',
      tightest >= 12, `tightest ${tightest.toFixed(1)} m radius`);
    check('the pit lane is sized for its forty boxes, tapers and all',
      worstPit > 550 && worstPit < 720, `longest ${Math.round(worstPit)} m`);
    check('and every lap gets the full forty of them', fewestBoxes === 40, `fewest: ${fewestBoxes}`);
    check('and its boxes sit inside the lane, past the limiter line', boxesFit);
    check('the country comes planted to the edge of the field, in numbers a viewport can draw',
      fewestTrees > 4000 && mostTrees <= 5600, `${fewestTrees}..${mostTrees} trees`);
    check('no tree stands on or beside the road',
      closestTree > 26, `closest ${closestTree.toFixed(1)} m off the centre line`);
    check('and none in the pit lane or its paddock',
      closestTreeToPit > 20, `closest ${closestTreeToPit.toFixed(1)} m off the lane`);

    /* The paddock. Garages and race control on the pit side of the straight,
       grandstands and a car park across from them, and none of it anywhere
       near the racing surface. */
    {
      let x3 = (7 * 2654435761) % 4294967296;
      const rng = () => ((x3 = (x3 * 1103515245 + 12345) >>> 0) / 4294967296);
      const c = generateCircuit('medium', 7, 129, 12, rng, { paddock: true });
      const cf = computeFrames({ closed: true, nodes: c.track }, 12);
      const kinds = new Set(c.props.map((p) => p.kind));
      check('the paddock comes built: garages, race control, stands, cars',
        kinds.has('pit_building') && kinds.has('control_tower') && kinds.has('garage_bay')
        && kinds.has('grandstand') && kinds.has('car_small'),
        [...kinds].join(','));
      let nearest = Infinity;
      for (const p2 of c.props) {
        /* Except the tyre walls that close the pit wall's mouths: they stand
           IN the barrier strip on purpose, past the run off and short of the
           lane's concrete -- exactly where a barrier belongs. verify-generate
           holds them to their own window. */
        if (p2.id.startsWith('genpit_tyres_')) continue;
        for (const f of cf) {
          nearest = Math.min(nearest, Math.hypot(f.pos.x - p2.p[0], f.pos.z - p2.p[2]));
        }
      }
      check('and nothing built stands on or beside the racing surface',
        nearest > 22, `nearest ${nearest.toFixed(1)} m off the centre line`);
      check('every building follows the ground', c.props.every((p2) => p2.ground));
    }

    // The same seed twice is the same forest: a saved project must reopen
    // over the identical landscape the editor generated.
    let xa = 2654435761 % 4294967296;
    const rngA = () => ((xa = (xa * 1103515245 + 12345) >>> 0) / 4294967296);
    let xb = 2654435761 % 4294967296;
    const rngB = () => ((xb = (xb * 1103515245 + 12345) >>> 0) / 4294967296);
    const one = generateCircuit('medium', 7, 129, 12, rngA, { trees: true });
    const two = generateCircuit('medium', 7, 129, 12, rngB, { trees: true });
    check('the generator is deterministic, forest and all',
      one.props.length === two.props.length
      && one.props.every((t, i) => t.p[0] === two.props[i].p[0] && t.p[2] === two.props[i].p[2] && t.kind === two.props[i].kind));
  }

  check('every generated circuit turns no harder than a car can take it',
    worstTurn < (75 * Math.PI) / 180, `worst ${((worstTurn * 180) / Math.PI).toFixed(1)} deg`);
  check('and comes out the length it offered',
    worstLengthError < 0.06, `worst ${(worstLengthError * 100).toFixed(1)}% out`);
  check('and climbs no steeper than a real circuit does',
    steepest <= 0.061, `${(steepest * 100).toFixed(1)}%`);
  check('and every one of them has elevation worth having',
    flattestRelief > 8, `flattest is ${flattestRelief.toFixed(1)} m top to bottom`);
  check('and none of them crosses itself', crossings === 0, `${crossings} of 12 laps cross`);
  check('and every one has straights as well as corners',
    fewestStraights >= 3, `fewest straight-ish points on a lap: ${fewestStraights}`);

  const gen = generatedProject('long');
  check('a generated project comes with a closed lap', gen.track.closed && gen.track.nodes.length >= 16);
  check('and a pit lane beside it', gen.pit.nodes.length >= 4 && !gen.pit.closed);
  check('and ground of its own, big enough to hold it',
    gen.track.nodes.every((n) => Math.abs(n.p[0] - (gen.terrain.originX + gen.terrain.size / 2)) < gen.terrain.size / 2
      && Math.abs(n.p[2] - (gen.terrain.originZ + gen.terrain.size / 2)) < gen.terrain.size / 2),
    `field ${gen.terrain.size} m`);
  check('and the road sits on that ground rather than above it',
    gen.track.nodes.some((n) => Math.abs(n.p[1] - sampleHeights(gen.terrain, gen.terrain.heights, n.p[0], n.p[2])) < 12),
    'no control point is near the terrain under it');

  const gf = computeFrames(gen.track, gen.road.samplesPerSegment);
  const gpf = computeFrames(gen.pit, gen.road.samplesPerSegment);
  const gTotal = pathLength(gf, true);
  check('and a long one really is 7 km', Math.abs(gTotal - 7000) / 7000 < 0.08, `${Math.round(gTotal)} m`);

  let closest = Infinity;
  for (const f of gf) {
    for (const pf of gpf) {
      const dx = pf.pos.x - f.pos.x;
      const dz = pf.pos.z - f.pos.z;
      const lateral = Math.abs(dx * f.right.x + dz * f.right.z);
      const along = Math.abs(dx * f.fwd.x + dz * f.fwd.z);
      if (along > 6) continue;
      closest = Math.min(closest, lateral - Math.max(f.widthL, f.widthR) - Math.max(pf.widthL, pf.widthR));
    }
  }
  check('the generated pit lane does not cut through the track',
    !Number.isFinite(closest) || closest > -0.6,
    `gap ${Number.isFinite(closest) ? closest.toFixed(2) : 'n/a'} m`);

  // Entry and exit: both ends of the lane sit on the tarmac edge, the entry
  // before the timing line and the exit after it.
  {
    const nearestOn = (p) => {
      let best = null;
      let bestD = Infinity;
      for (const f of gf) {
        const d = (f.pos.x - p[0]) ** 2 + (f.pos.z - p[2]) ** 2;
        if (d < bestD) { bestD = d; best = f; }
      }
      return best;
    };
    const first = gen.pit.nodes[0].p;
    const last = gen.pit.nodes[gen.pit.nodes.length - 1].p;
    const fe = nearestOn(first);
    const fx = nearestOn(last);
    const outBy = (f, p) => Math.abs(
      (p[0] - f.pos.x) * f.right.x + (p[2] - f.pos.z) * f.right.z,
    ) - Math.max(f.widthL, f.widthR);
    check('the pit entry is glued to the edge of the track',
      Math.abs(outBy(fe, first)) < 5, `${outBy(fe, first).toFixed(2)} m off the edge`);
    check('and so is the exit',
      Math.abs(outBy(fx, last)) < 5, `${outBy(fx, last).toFixed(2)} m off the edge`);

    const lineDist = gen.timing.startS * gTotal;
    check('the timing line sits between the two, not on top of them',
      fe.dist < lineDist && lineDist < fx.dist,
      `entry ${Math.round(fe.dist)} m, line ${Math.round(lineDist)} m, exit ${Math.round(fx.dist)} m`);
    // However many points the straight is made of, it is the run whose points
    // all sit at one height: the levelling put them there.
    const level = gen.track.nodes.filter((n) => Math.abs(n.p[1] - gen.track.nodes[0].p[1]) < 0.01).length;
    check('and the start/finish straight is level along its length',
      level >= 5, `${level} points share the start line's height`);

    const straightLen = Math.hypot(
      gen.track.nodes[level - 1].p[0] - gen.track.nodes[0].p[0],
      gen.track.nodes[level - 1].p[2] - gen.track.nodes[0].p[2],
    );
    check('and is long enough to be one', straightLen > 350, `${Math.round(straightLen)} m`);
  }

  // The barrier on a fresh project stands level with the ground it is on,
  // which is the whole reason the shoulder now starts flat. "Level with the
  // ground" is EDGE_SINK below the road plane: the shoulder's outer edge
  // bevels down by exactly that to meet the ground the corridor keeps that
  // far under every road mesh, and the barrier's foot stands at the seam the
  // two now share. Level with the ROAD, the old reading, put the foot 4 cm
  // above the grass beside it.
  const level = defaultProject();
  for (const n of level.track.nodes) { n.wallL = true; n.wallR = true; }
  const lf2 = computeFrames(level.track, level.road.samplesPerSegment);
  const lpr = sideProfile(lf2, level.road, [], true);
  const le = computeEdges(lf2, level.road, lpr);
  let worstDrop = 0;
  for (let i2 = 0; i2 < lf2.length; i2++) {
    worstDrop = Math.max(worstDrop, lf2[i2].pos.y - le.outerR[i2].y, lf2[i2].pos.y - le.outerL[i2].y);
  }
  check('the barrier foot sits level with the road, not in a trench',
    worstDrop < EDGE_SINK + 0.01, `${worstDrop.toFixed(3)} m below`);
}

/*
 * The ground brush.
 *
 * The point of it is that there is only ever ONE ground: painting gravel does
 * not put a slab over the grass, it makes that stretch of ground gravel. So the
 * checks here are about absence as much as presence -- no grass triangle left
 * inside the gravel, nothing lying on top of anything, and the whole patch
 * moving with the height field when it is sculpted.
 */
console.log('\nPainted ground');
{
  const gp = defaultProject();
  const t = gp.terrain;

  const plain = terrainMesh(t, t.heights, null);
  check('an unpainted ground is the single grass mesh it always was',
    plain.groups === undefined && plain.name === '1GRASS_terrain'
    && plain.geometry.groups.length === 0);
  check('and carries not one vertex more than the grid',
    plain.geometry.getAttribute('position').count === t.res * t.res);

  // A gravel bed out in the field, well away from the road.
  const cx = t.originX + t.size * 0.25;
  const cz = t.originZ + t.size * 0.25;
  const R = 60;
  const gravel = GROUND_KINDS.findIndex((k) => k.surface === 'SAND');
  const paint = createPaint(t.res);
  const edge = createPaintEdge(t.res);
  check('gravel is one of the materials the ground can be made of', gravel > 0);
  check('painting it changes the ground',
    paintGroundDisc(t, paint, edge, cx, cz, R, paintValue(gravel)) === true);
  check('painting the same thing again changes nothing, so no mesh is rebuilt',
    paintGroundDisc(t, paint, edge, cx, cz, R, paintValue(gravel), true) === false);
  check('and the ground in the middle of it reads back as gravel',
    sampleGround(t, paint, cx, cz) === gravel);
  check('the paint is finer than the height grid, so the edge is not blocky',
    paintCellSize(t) < cellSize(t) / 2,
    `${paintCellSize(t).toFixed(1)} m paint vs ${cellSize(t).toFixed(1)} m grid`);

  const def = terrainMesh(t, t.heights, paint);
  check('a painted ground is drawn in one run of triangles per material',
    (def.groups ?? []).length === 2 && def.geometry.groups.length === 2);
  check('and the cells the edge crosses are cut up, not squared off',
    def.geometry.getAttribute('position').count > t.res * t.res);

  const pos = def.geometry.getAttribute('position').array;
  const index = def.geometry.getIndex().array;
  const scan = (slot) => {
    const g = def.geometry.groups[slot];
    let area = 0;
    let inside = 0;
    for (let i = g.start; i < g.start + g.count; i += 3) {
      const a = index[i] * 3;
      const b = index[i + 1] * 3;
      const c = index[i + 2] * 3;
      area += Math.abs(
        (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]) - (pos[c] - pos[a]) * (pos[b + 2] - pos[a + 2]),
      ) / 2;
      const mx = (pos[a] + pos[b] + pos[c]) / 3;
      const mz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
      if (Math.hypot(mx - cx, mz - cz) < R - paintCellSize(t) * 2) inside += 1;
    }
    return { area, inside, tris: g.count / 3 };
  };
  const grassSlot = def.groups.findIndex((g) => g.surface === 'GRASS');
  const sandSlot = def.groups.findIndex((g) => g.surface === 'SAND');
  const grass = scan(grassSlot);
  const sand = scan(sandSlot);

  check('there is no grass left underneath the gravel', grass.inside === 0,
    `${grass.inside} grass triangles inside the bed`);
  check('and the gravel covers the disc that was painted',
    Math.abs(sand.area - Math.PI * R * R) / (Math.PI * R * R) < 0.02,
    `${Math.round(sand.area)} m2 vs ${Math.round(Math.PI * R * R)} m2`);
  check('the two of them together are still the whole field',
    Math.abs(grass.area + sand.area - t.size * t.size) / (t.size * t.size) < 1e-4);

  /*
   * The edge is a line, not a staircase.
   *
   * Measured by its LENGTH, which is what tells the two apart. A boundary that
   * can only run along the sides of squares has to go round a circle the long
   * way -- one radius across and one down for every diagonal metre -- and comes
   * out 4/pi, about 27%, longer than the circle it is drawing. One that can cut
   * across a cell tracks the real thing to a few per cent. Nothing else in the
   * mesh says whether an edge reads as tiles or as a shape.
   */
  const edgeLength = (def2, kind) => {
    const p2 = def2.geometry.getAttribute('position').array;
    const i2 = def2.geometry.getIndex().array;
    const seen = new Map();
    def2.geometry.groups.forEach((g, slot) => {
      const surface = def2.groups[slot].surface;
      for (let i = g.start; i < g.start + g.count; i += 3) {
        for (let e = 0; e < 3; e++) {
          const a = i2[i + e];
          const b = i2[i + ((e + 1) % 3)];
          const k = a < b ? `${a}|${b}` : `${b}|${a}`;
          let s = seen.get(k);
          if (!s) { s = new Set(); seen.set(k, s); }
          s.add(surface);
        }
      }
    });
    let len = 0;
    for (const [k, s] of seen) {
      if (s.size < 2 || !s.has(kind)) continue;
      const [a, b] = k.split('|').map(Number);
      len += Math.hypot(p2[a * 3] - p2[b * 3], p2[a * 3 + 2] - p2[b * 3 + 2]);
    }
    return len;
  };
  const rim = edgeLength(def, 'SAND');
  check('the edge of the bed is cut as a line, not as a staircase',
    rim / (2 * Math.PI * R) < 1.12,
    `${(rim / (2 * Math.PI * R)).toFixed(3)} times the circle it is drawing`
    + ' -- 1.27 is what square-only cells give',
  );

  /* --- sculpting a painted patch ---------------------------------- */

  const lifted = new Float32Array(t.heights);
  const box = applyBrush(t, lifted, cx, cz, { mode: 'raise', radius: 90, strength: 8 }, 1, 0);
  const patched = terrainMesh(t, lifted, paint, def.geometry, box);
  check('sculpting reuses the ground geometry rather than cutting it again',
    patched.geometry === def.geometry);

  const rebuilt = buildTerrainGeometry(t, lifted, paint);
  let worstPos = 0;
  const pa = patched.geometry.getAttribute('position').array;
  const pb = rebuilt.getAttribute('position').array;
  for (let i = 0; i < pb.length; i++) worstPos = Math.max(worstPos, Math.abs(pa[i] - pb[i]));
  check('and the patched ground matches a full rebuild vertex for vertex',
    worstPos < 1e-4, `${worstPos}`);

  let highestSand = 0;
  {
    const g = patched.geometry.groups[sandSlot];
    for (let i = g.start; i < g.start + g.count; i++) highestSand = Math.max(highestSand, pa[index[i] * 3 + 1]);
  }
  check('so a hill raised under the bed takes the gravel up with it',
    highestSand > 5, `${highestSand.toFixed(2)} m`);

  const repainted = new Uint8Array(paint);
  paintGroundDisc(t, repainted, null, cx + 300, cz, 40, paintValue(gravel));
  check('a repaint cuts the mesh again instead of patching the old picture',
    updateTerrainGeometry(def.geometry, t, lifted, undefined, repainted) === false);

  /* --- what the exporter makes of it ------------------------------ */

  const parts = splitByGroups(patched);
  check('the export splits the ground into one mesh per material', parts.length === 2);
  check('named so Assetto Corsa knows what the car is driving on',
    parts.map((m) => m.name).sort().join(',') === '1GRASS_terrain,1SAND_terrain_gravel');
  check('with the surface of each matching the prefix of its name',
    parts.every((m) => m.name.slice(1).startsWith(m.surface)));
  check('every ground material has a physics surface in surfaces.ini',
    GROUND_KINDS.every((k) => surfacesIni().includes(`KEY=${k.surface}`)));
  check('and every triangle is carried over exactly once',
    parts.reduce((s, m) => s + m.geometry.getIndex().count, 0) === def.geometry.getIndex().count);
  const sandPart = parts.find((m) => m.surface === 'SAND');
  check('the gravel mesh carries only the vertices it actually uses',
    sandPart.geometry.getAttribute('position').count < t.res * t.res * 0.2,
    `${sandPart.geometry.getAttribute('position').count} vertices`);
  check('and no index in it points past the end of them',
    Array.from(sandPart.geometry.getIndex().array)
      .every((v) => v < sandPart.geometry.getAttribute('position').count));

  /* --- surviving a save and a resize ------------------------------ */

  const saved = deserializeProject(serializeProject({ ...gp, terrain: { ...t, paint } }));
  check('a saved project brings its painted ground back',
    saved.terrain.paint !== null && sampleGround(saved.terrain, saved.terrain.paint, cx, cz) === gravel);
  check('and one saved before the ground brush existed simply has none',
    deserializeProject(serializeProject(defaultProject())).terrain.paint === null);

  const coarser = resampleTerrain({ ...t, paint }, 97);
  check('changing the terrain resolution keeps the gravel where it was',
    sampleGround(coarser, coarser.paint, cx, cz) === gravel);
  check('and resizes the paint field with the grid',
    coarser.paint.length === paintRes(97) ** 2);

  /* --- the other two shapes --------------------------------------- */

  const asphalt = GROUND_KINDS.findIndex((k) => k.surface === 'ROAD');
  {
    const rect = { x: 200, z: -150, w: 120, l: 80, rotY: 0 };
    const field = createPaint(t.res);
    check('a rectangle paints',
      paintGroundRect(t, field, null, rect, paintValue(asphalt)) === true);
    check('and covers exactly the rectangle asked for',
      sampleGround(t, field, rect.x, rect.z) === asphalt
      && sampleGround(t, field, rect.x + rect.w / 2 - 3, rect.z + rect.l / 2 - 3) === asphalt
      && sampleGround(t, field, rect.x + rect.w / 2 + 5, rect.z) === 0
      && sampleGround(t, field, rect.x, rect.z + rect.l / 2 + 5) === 0);

    const rectDef = terrainMesh(t, t.heights, field);
    const rectSlot = rectDef.groups.findIndex((g) => g.surface === 'ROAD');
    const g2 = rectDef.geometry.groups[rectSlot];
    const p2 = rectDef.geometry.getAttribute('position').array;
    const i2 = rectDef.geometry.getIndex().array;
    let area = 0;
    for (let i = g2.start; i < g2.start + g2.count; i += 3) {
      const a = i2[i] * 3;
      const b = i2[i + 1] * 3;
      const c = i2[i + 2] * 3;
      area += Math.abs((p2[b] - p2[a]) * (p2[c + 2] - p2[a + 2]) - (p2[c] - p2[a]) * (p2[b + 2] - p2[a + 2])) / 2;
    }
    // Within a paint step all the way round, which is as exact as a shape laid
    // on a sampled field can be.
    const slack = 2 * (rect.w + rect.l) * paintCellSize(t);
    check('and the mesh it cuts is that rectangle to within a paint step',
      Math.abs(area - rect.w * rect.l) < slack,
      `${Math.round(area)} m2 vs ${rect.w * rect.l} m2`);

    // A turned rectangle is still a rectangle: same area, different corners.
    const turned = createPaint(t.res);
    paintGroundRect(t, turned, null, { ...rect, rotY: 30 }, paintValue(asphalt));
    check('a turned rectangle keeps its middle and loses its old corners',
      sampleGround(t, turned, rect.x, rect.z) === asphalt
      && sampleGround(t, turned, rect.x + rect.w / 2 - 2, rect.z + rect.l / 2 - 2) === 0);
  }

  {
    // A plain triangle, so the area it should cover is not in doubt.
    const poly = [
      { x: -400, z: 350 },
      { x: -250, z: 350 },
      { x: -400, z: 480 },
    ];
    const field = createPaint(t.res);
    check('an outline paints its inside',
      paintGroundPolygon(t, field, null, poly, paintValue(asphalt)) === true);
    check('and only its inside',
      sampleGround(t, field, -380, 370) === asphalt
      && sampleGround(t, field, -260, 460) === 0
      && sampleGround(t, field, -420, 340) === 0);
    check('an outline of fewer than three corners paints nothing',
      paintGroundPolygon(t, field, null, poly.slice(0, 2), paintValue(asphalt)) === false);

    const polyDef = terrainMesh(t, t.heights, field);
    const slot = polyDef.groups.findIndex((g) => g.surface === 'ROAD');
    const g2 = polyDef.geometry.groups[slot];
    const p2 = polyDef.geometry.getAttribute('position').array;
    const i2 = polyDef.geometry.getIndex().array;
    let area = 0;
    for (let i = g2.start; i < g2.start + g2.count; i += 3) {
      const a = i2[i] * 3;
      const b = i2[i + 1] * 3;
      const c = i2[i + 2] * 3;
      area += Math.abs((p2[b] - p2[a]) * (p2[c + 2] - p2[a + 2]) - (p2[c] - p2[a]) * (p2[b + 2] - p2[a + 2])) / 2;
    }
    const want = Math.abs(
      (poly[1].x - poly[0].x) * (poly[2].z - poly[0].z) - (poly[2].x - poly[0].x) * (poly[1].z - poly[0].z),
    ) / 2;
    check('and the mesh follows the outline, diagonal side and all',
      Math.abs(area - want) / want < 0.05, `${Math.round(area)} m2 vs ${Math.round(want)} m2`);
  }

  /* --- concrete you can and cannot speed on ----------------------- */
  /*
   * Widening a pit lane means painting concrete beside it, and plain concrete
   * is not a pit lane as far as the game is concerned: the car drives onto the
   * piece you just added and the speed limiter goes off. Nothing about the look
   * of concrete decides that, so the palette carries both -- the same material
   * to the eye, one with the PIT surface and one without.
   */
  {
    const plain = GROUND_KINDS.findIndex((k) => k.surface === 'CONCRETE');
    const pit = GROUND_KINDS.findIndex((k) => k.surface === 'PIT');
    check('the palette has concrete with the speed limiter and concrete without',
      plain >= 0 && pit >= 0 && plain !== pit
      && GROUND_KINDS[plain].material === GROUND_KINDS[pit].material,
      GROUND_KINDS.map((k) => `${k.label}:${k.surface}`).join(', '));

    const field = createPaint(t.res);
    paintGroundDisc(t, field, null, 400, -300, 40, paintValue(pit));
    const def = terrainMesh(t, t.heights, field);
    const pitPart = (def.groups ?? []).find((g) => g.surface === 'PIT');
    check('and painting the pit one puts a pit surface into the ground',
      pitPart !== undefined && pitPart.name === '1PIT_terrain_concrete',
      (def.groups ?? []).map((g) => g.name).join(','));
    check('which Assetto Corsa has a physics surface for',
      surfacesIni().includes('KEY=PIT'));
  }

  /* --- a straight edge at an angle -------------------------------- */
  /*
   * The paint can only say which material each LATTICE POINT is, so the mesh
   * has to decide for itself where between two of them the boundary ran. The
   * midpoint is the only answer the paint alone justifies, and it is what turns
   * every edge that does not run along or across the grid into a staircase of
   * little steps -- which is exactly what you see if you pull a rectangle out
   * and then turn it.
   *
   * The edge field remembers how far each sample sat from the shape that drew
   * it, and two distances of opposite sign say where the zero between them is.
   * So the check is direct: take the vertices the two materials SHARE, which
   * are the boundary and nothing else, and ask how far each is from the side of
   * the rectangle it is supposed to be lying on.
   */
  {
    const rect = { x: -150, z: -420, w: 240, l: 140, rotY: 23 };
    const a = (rect.rotY * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    /** Distance from the side of the rectangle, negative inside. */
    const boxDist = (x, z) => {
      const dx = x - rect.x;
      const dz = z - rect.z;
      const u = Math.abs(dx * cos + dz * sin) - rect.w / 2;
      const v = Math.abs(-dx * sin + dz * cos) - rect.l / 2;
      const out = Math.hypot(Math.max(u, 0), Math.max(v, 0));
      return out > 0 ? out : Math.max(u, v);
    };

    /**
     * How far the boundary vertices stray off the side they sit on: the typical
     * one, and the one at the 95th percentile.
     *
     * Not the very worst, because the four CORNERS of the rectangle are a real
     * exception rather than a fault. A sub-cell with a corner of the shape
     * inside it has the boundary entering and leaving through the same pair of
     * sides, and a cut that meets each side once cannot draw that -- with or
     * without the distances. Four points out of six hundred.
     */
    const strayOff = (withEdge) => {
      const field = createPaint(t.res);
      const dist = withEdge ? createPaintEdge(t.res) : null;
      paintGroundRect(t, field, dist, rect, paintValue(asphalt));
      const def = terrainMesh({ ...t, paintEdge: dist }, t.heights, field);
      const geo = def.geometry;
      const pos = geo.getAttribute('position').array;
      const idx = geo.getIndex().array;
      const roadSlot = def.groups.findIndex((g) => g.surface === 'ROAD');
      const grassSlot = def.groups.findIndex((g) => g.surface === 'GRASS');
      const used = (slot) => {
        const g = geo.groups[slot];
        const set = new Set();
        for (let i = g.start; i < g.start + g.count; i++) set.add(idx[i]);
        return set;
      };
      const road = used(roadSlot);
      const off = [];
      for (const v of used(grassSlot)) {
        if (!road.has(v)) continue;
        off.push(Math.abs(boxDist(pos[v * 3], pos[v * 3 + 2])));
      }
      off.sort((a2, b2) => a2 - b2);
      return {
        mean: off.reduce((sum, d) => sum + d, 0) / off.length,
        p95: off[Math.floor(off.length * 0.95)],
      };
    };

    const step = paintCellSize(t);
    const cut = strayOff(true);
    const midpoints = strayOff(false);
    check('a turned rectangle is cut on its real edge, not halfway to it',
      cut.p95 < step * 0.05,
      `${cut.mean.toFixed(3)} m out typically, ${cut.p95.toFixed(3)} m at the 95th`);
    check('which is the difference between an edge and a staircase',
      cut.mean < midpoints.mean / 10,
      `${cut.mean.toFixed(3)} m against ${midpoints.mean.toFixed(3)} m`);
    check('because a midpoint cut is out by a good part of a paint step',
      midpoints.p95 > step * 0.3, `${midpoints.p95.toFixed(2)} m of ${step.toFixed(2)} m`);
  }

  /* --- what a save does to it ------------------------------------- */
  {
    const field = createPaint(t.res);
    const dist = createPaintEdge(t.res);
    paintGroundRect(t, field, dist, { x: 300, z: 300, w: 100, l: 60, rotY: 23 }, paintValue(asphalt));
    const back = deserializeProject(serializeProject({ ...gp, terrain: { ...t, paint: field, paintEdge: dist } }));
    let same = back.terrain.paintEdge !== null && back.terrain.paintEdge.length === dist.length;
    for (let i = 0; same && i < dist.length; i++) same = back.terrain.paintEdge[i] === dist[i];
    check('a saved project brings back where every edge really ran', same);
  }

  /* --- painted grass is not unpainted ground ---------------------- */
  {
    const grass = GROUND_KINDS.findIndex((k) => k.surface === 'GRASS');
    const field = createPaint(t.res);
    paintGroundDisc(t, field, null, 0, 0, 50, paintValue(grass));
    check('grass is a material you can lay, not just the absence of one',
      field[0] === 0 && sampleGroundValue(t, field, 0, 0) === paintValue(grass)
      && sampleGround(t, field, 0, 0) === grass);
    paintGroundDisc(t, field, null, 0, 0, 50, paintValue(-1));
    check('and the eraser takes it off again, back to untouched ground',
      sampleGroundValue(t, field, 0, 0) === 0);
  }

  /* --- the whole field at once ------------------------------------ */
  {
    const all = createPaint(t.res);
    all.fill(paintValue(asphalt));
    const allDef = terrainMesh(t, t.heights, all);
    check('a field filled with one material is one mesh again, not four',
      allDef.groups === undefined && allDef.surface === 'ROAD'
      && allDef.name === '1ROAD_terrain_asphalt');
    check('and it is still the plain grid underneath, with nothing cut up',
      allDef.geometry.getAttribute('position').count === t.res * t.res);
  }
}

/*
 * The ground brush reaching the run off.
 *
 * The strip between the edge of the circuit and the barrier belongs to the ROAD
 * mesh, not to the terrain, so painting under it changed nothing you could see.
 * That made the one band of ground a circuit is actually shaped by -- the
 * gravel at the outside of a corner, the tarmac at the exit of another -- the
 * only band the brush could not draw. It now takes its material from the paint
 * wherever the brush has been, and from the road setting everywhere else.
 */
console.log('\nThe brush reaches the run off');
{
  const rp = defaultProject();
  const rf = computeFrames(rp.track, rp.road.samplesPerSegment);
  const plainRoad = buildRoadMeshes(rf, true, rp.road, []);

  /** Total flat area of every mesh whose name says it is run off. */
  const runoffArea = (defs) => {
    let total = 0;
    for (const def of defs) {
      if (!def.name.includes('_runoff')) continue;
      const pos = def.geometry.getAttribute('position').array;
      const idx = def.geometry.getIndex().array;
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i] * 3;
        const b = idx[i + 1] * 3;
        const c = idx[i + 2] * 3;
        total += Math.abs(
          (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]) - (pos[c] - pos[a]) * (pos[b + 2] - pos[a + 2]),
        ) / 2;
      }
    }
    return total;
  };

  const sand = GROUND_KINDS.findIndex((k) => k.surface === 'SAND');
  // Half the world painted gravel, so the run off crosses the boundary twice
  // per lap and there is a real transition to look for.
  const half = {
    kinds: GROUND_KINDS,
    at: (x) => (x > 0 ? sand : -1),
  };
  const painted = buildRoadMeshes(rf, true, rp.road, [], undefined, undefined, [], half);
  const names = painted.map((m) => m.name);
  check('the painted half of the run off is built out of gravel',
    names.some((n) => n === '1SAND_runoff_left') && names.some((n) => n === '1SAND_runoff_right'),
    names.filter((n) => n.includes('runoff')).join(','));
  check('and the rest of it is still what the road setting says',
    names.some((n) => n === '1GRASS_runoff_left') && names.some((n) => n === '1GRASS_runoff_right'));

  const before = runoffArea(plainRoad);
  const after = runoffArea(painted);
  check('the strip is the same strip either way, only made of two things',
    Math.abs(after - before) / before < 0.01,
    `${Math.round(after)} m2 against ${Math.round(before)} m2`);

  const sandArea = runoffArea(painted.filter((m) => m.surface === 'SAND'));
  check('and the gravel really is about the half that was painted',
    sandArea > before * 0.3 && sandArea < before * 0.7,
    `${Math.round(sandArea)} m2 of ${Math.round(before)} m2`);

  const untouched = buildRoadMeshes(rf, true, rp.road, [], undefined, undefined, [], {
    kinds: GROUND_KINDS,
    at: () => -1,
  });
  check('ground nobody has painted leaves the run off exactly as it was',
    untouched.filter((m) => m.name.includes('runoff')).map((m) => m.name).sort().join(',')
      === plainRoad.filter((m) => m.name.includes('runoff')).map((m) => m.name).sort().join(','));
  check('down to the last square metre of it',
    Math.abs(runoffArea(untouched) - before) / before < 0.01,
    `${Math.round(runoffArea(untouched))} m2 against ${Math.round(before)} m2`);
}

/*
 * The sculpt brush carries the road. The ground under the tarmac is slaved to
 * the road by the corridor, so a brush that only wrote into the height field
 * could never change what you see under the track: the road, and with it the
 * ground, stood still. With the carry on (the default) a stroke moves the
 * control points too, and everything hanging off them follows.
 */
{
  console.log('\nSculpt brush carrying the road');
  const proj = defaultProject();
  useEditor.setState({ project: proj, past: [], future: [], brushRoad: true });
  const editor = useEditor.getState();
  const [nx, , nz] = proj.track.nodes[0].p;
  const y0 = proj.track.nodes[0].p[1];
  const d0 = getDerived(proj);
  const g0 = sampleHeights(proj.terrain, d0.terrainHeights, nx, nz);

  editor.pushHistory(); // as the pointer-down handler does
  for (let i = 0; i < 30; i++) editor.sculpt(nx, nz, 'raise', 1 / 60, 0);
  const lifted = useEditor.getState().project;
  const y1 = lifted.track.nodes[0].p[1];
  check('a raise stroke over a control point lifts the road', y1 > y0 + 1, `+${(y1 - y0).toFixed(2)} m`);

  const d1 = getDerived(lifted);
  const g1 = sampleHeights(lifted.terrain, d1.terrainHeights, nx, nz);
  check(
    'and the ground under the tarmac rises exactly with it',
    Math.abs(g1 - g0 - (y1 - y0)) < 0.25,
    `road +${(y1 - y0).toFixed(2)} m, ground +${(g1 - g0).toFixed(2)} m`,
  );

  // A dab landing between two control points must not fall through the gap:
  // it is split across the pair, so the spline under the brush still moves.
  const a = lifted.track.nodes[0].p;
  const b = lifted.track.nodes[1].p;
  const ya0 = a[1];
  const yb0 = b[1];
  for (let i = 0; i < 30; i++) useEditor.getState().sculpt((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, 'raise', 1 / 60, 0);
  const split = useEditor.getState().project;
  check(
    'a dab between two control points is split across the pair',
    split.track.nodes[0].p[1] > ya0 + 0.3 && split.track.nodes[1].p[1] > yb0 + 0.3,
  );

  // The pit lane is a path like any other and rides the same brush.
  const pitAt = split.pit.nodes[Math.floor(split.pit.nodes.length / 2)];
  const pitY0 = pitAt.p[1];
  for (let i = 0; i < 30; i++) useEditor.getState().sculpt(pitAt.p[0], pitAt.p[2], 'raise', 1 / 60, 0);
  check(
    'the pit lane rides the brush too',
    useEditor.getState().project.pit.nodes[Math.floor(split.pit.nodes.length / 2)].p[1] > pitY0 + 1,
  );

  // Flatten pulls the road towards the same target as the ground beside it.
  const flatY0 = useEditor.getState().project.track.nodes[0].p[1];
  for (let i = 0; i < 60; i++) useEditor.getState().sculpt(nx, nz, 'flatten', 1 / 60, 0);
  const flatY1 = useEditor.getState().project.track.nodes[0].p[1];
  check('flatten pulls the road towards the target', Math.abs(flatY1) < Math.abs(flatY0));

  // Switched off, the brush shapes only the landscape and the road holds.
  useEditor.setState({ brushRoad: false });
  const heldY = useEditor.getState().project.track.nodes[0].p[1];
  const heldHeights = useEditor.getState().project.terrain.heights;
  for (let i = 0; i < 5; i++) useEditor.getState().sculpt(nx, nz, 'raise', 1 / 60, 0);
  check(
    'with the carry off the road holds its line',
    useEditor.getState().project.track.nodes[0].p[1] === heldY,
  );
  check(
    'while the ground is still sculpted',
    useEditor.getState().project.terrain.heights !== heldHeights,
  );
  useEditor.setState({ brushRoad: true });

  // The whole session above was one stroke's history entry: one undo takes
  // the road and the ground back together.
  useEditor.getState().undo();
  const undone = useEditor.getState().project;
  check(
    'one undo takes road and ground back together',
    undone.track.nodes[0].p[1] === y0 && undone.terrain.heights === proj.terrain.heights,
  );
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);


