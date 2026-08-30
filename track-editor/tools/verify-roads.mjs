/**
 * The decorative access roads, checked end to end through the derived
 * pipeline: a road ended at the circuit has to glue itself onto the tarmac,
 * a road out in the field has to stay exactly where it was drawn, the ground
 * has to bed itself under both, and the meshes have to carry a surface the
 * game can drive on.
 *
 *   node --import ./tools/ts-resolve.mjs tools/verify-roads.mjs
 */

import { defaultProject } from '../src/store/store.ts';
import { getDerived } from '../src/store/derived.ts';
import { computeFrames } from '../src/core/spline.ts';
import { attachRoadEnds } from '../src/core/pitLink.ts';
import { sampleHeights } from '../src/core/terrain.ts';
import { serializeProject, deserializeProject } from '../src/io/project.ts';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name} ${detail}`); }
}

const project = defaultProject();
const trackFrames = computeFrames(project.track, project.road.samplesPerSegment);

// A frame away from the pit lane's side of the circuit, so the road has clear
// ground to land on.
const f = trackFrames[Math.floor(trackFrames.length * 0.5)];
const side = 1;
const edge = (d) => ({
  x: f.pos.x + f.right.x * side * (f.widthR + d),
  z: f.pos.z + f.right.z * side * (f.widthR + d),
});

const node = (x, z, i) => ({
  id: `vr${i}`,
  p: [x, 0, z],
  widthL: 3,
  widthR: 3,
  bank: 0,
  wallL: false,
  wallR: false,
  wallGapL: 0,
  wallGapR: 0,
  runoffL: 0,
  runoffR: 0,
  aiOffset: 0,
});

// One road ending 6 m from the tarmac -- close enough to mean "join" -- and
// walking straight out into the field.
const joined = [edge(6), edge(30), edge(60), edge(95)].map((p, i) => node(p.x, p.z, i));
// And one drawn far out in the country, touching nothing.
const off = edge(200);
const lonely = [0, 1, 2].map((i) => node(off.x + i * 40, off.z + 60, 10 + i));

project.decoRoads.push(
  { id: 'a', name: 'Road 1', surface: 'asphalt', path: { closed: false, nodes: joined } },
  { id: 'b', name: 'Road 2', surface: 'concrete', path: { closed: false, nodes: lonely } },
);

console.log('deco roads through the derived pipeline');

/* --- the attach ---------------------------------------------------- */

const attached = attachRoadEnds(project.decoRoads[0].path, trackFrames);
check('a road ended at the circuit is snapped onto it', attached !== project.decoRoads[0].path);
{
  const p = attached.nodes[0].p;
  const lat = (p[0] - f.pos.x) * f.right.x + (p[2] - f.pos.z) * f.right.z;
  // End point is buried a shade INSIDE the tarmac edge plus its own half width.
  check(
    'and its end sits on the tarmac edge',
    Math.abs(Math.abs(lat) - (f.widthR + 3 - 0.25)) < 1.5,
    `lateral ${lat.toFixed(2)} vs edge ${(f.widthR + 3 - 0.25).toFixed(2)}`,
  );
  check('the far end stays where it was drawn',
    attached.nodes[3].p[0] === joined[3].p[0] && attached.nodes[3].p[2] === joined[3].p[2]);
}
const lonelyAttached = attachRoadEnds(project.decoRoads[1].path, trackFrames);
check('a road out in the field is left untouched', lonelyAttached === project.decoRoads[1].path);

/* --- the meshes ---------------------------------------------------- */

const derived = getDerived(project);
check('every road builds a mesh', derived.decoMeshes.length === 2,
  `${derived.decoMeshes.length} meshes`);
const asphalt = derived.decoMeshes.find((m) => m.name.startsWith('1ROAD_deco'));
const concrete = derived.decoMeshes.find((m) => m.name.startsWith('1CONCRETE_deco'));
check('the asphalt road carries the ROAD surface', asphalt?.surface === 'ROAD');
check('the concrete road carries the CONCRETE surface', concrete?.surface === 'CONCRETE');
check('both roads have centre lines for the viewport',
  derived.decoLines.length === 2 && derived.decoLines.every((l) => l.frames.length > 2));

/* --- the ground under them ----------------------------------------- */

{
  // Mid-way along the lonely road, the ground must have been pulled up/down to
  // the road's own level (the nodes sit at y=0 over whatever the field does).
  const mid = lonely[1].p;
  const ground = sampleHeights(project.terrain, derived.terrainHeights, mid[0], mid[2]);
  check('the ground beds itself under a free standing road',
    Math.abs(ground - mid[1]) < 0.3, `ground ${ground.toFixed(2)} vs road ${mid[1].toFixed(2)}`);
}

/* --- save and load -------------------------------------------------- */

{
  const back = deserializeProject(serializeProject(project));
  check('roads survive save and load',
    back.decoRoads.length === 2
      && back.decoRoads[0].surface === 'asphalt'
      && back.decoRoads[1].surface === 'concrete'
      && back.decoRoads[0].path.nodes.length === 4);
  const old = defaultProject();
  check('a project from before roads existed opens with none',
    Array.isArray(deserializeProject(serializeProject({ ...old, decoRoads: undefined })).decoRoads));
}

if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('all deco road checks passed.');
