/**
 * The generator, swept across seeds: every circuit it hands over has to be a
 * working start/finish complex, not just one lucky roll.
 *
 *   node --import ./tools/ts-resolve.mjs tools/verify-generate.mjs
 *
 * Geometry-only -- no meshes are built -- so twenty circuits cost seconds.
 * The mesh-level seams of one generated circuit are verify-seams' job.
 */

import { generateCircuit } from '../src/core/generate.ts';
import { computeFrames } from '../src/core/spline.ts';
import { PointIndex } from '../src/core/spatial.ts';
import { GROUND_KINDS, sampleGround } from '../src/core/terrain.ts';
import { generatedProject } from '../src/store/store.ts';
import { getDerived } from '../src/store/derived.ts';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name} ${detail}`); }
}

const CONCRETE = GROUND_KINDS.findIndex((k) => k.label === 'Concrete');
const GRASS = 0;

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const SIZES = ['short', 'medium', 'long'];
let worstProp = { d: Infinity };
let worstTyre = null;
let laneFailures = 0;
let paintFailures = 0;
let garageFailures = 0;
let trackPaintFailures = 0;
let nanFailures = 0;

for (let seed = 1; seed <= 21; seed++) {
  const size = SIZES[seed % SIZES.length];
  const gen = generateCircuit(size, 7, undefined, 12, lcg(seed * 7919));

  // Nothing NaN, anywhere the car goes.
  const finite = [...gen.track, ...gen.pit].every((n) => n.p.every(Number.isFinite));
  if (!finite) nanFailures++;

  // The lane holds a real box run.
  if (!(gen.pitCfg.boxCount >= 8 && gen.pitCfg.boxCount <= 40)) laneFailures++;
  if (gen.pit.length < 8) laneFailures++;

  // Densely: at 8 samples per segment a fast corner's chord cuts 6 m inside
  // the curve, and a tyre wall standing exactly where it belongs measured
  // 26.9 m off a centre line that really passes at 20.5.
  const frames = computeFrames({ closed: true, nodes: gen.track }, 24);
  const idx = new PointIndex(frames.map((f) => f.pos), 50);
  const distTo = (x, z) => {
    const i = idx.nearest(x, z, 120);
    if (i < 0) return Infinity;
    return Math.hypot(frames[i].pos.x - x, frames[i].pos.z - z);
  };

  // Room between the pit boxes and the garage doors: no garage part may come
  // nearer the lane's centre line than the concrete plus the garage apron.
  const pitFrames = computeFrames({ closed: false, nodes: gen.pit }, 12);
  let nearestGarage = Infinity;
  for (const prop of gen.props) {
    if (!prop.id.startsWith('genpad_') || !/garage/.test(prop.name)) continue;
    for (const f of pitFrames) {
      const dd = Math.hypot(f.pos.x - prop.p[0], f.pos.z - prop.p[2]);
      if (dd < nearestGarage) nearestGarage = dd;
    }
  }
  if (nearestGarage < 13) garageFailures++;

  for (const prop of gen.props) {
    if (prop.id.startsWith('gentree_')) continue;
    const d = distTo(prop.p[0], prop.p[2]);
    if (prop.id.startsWith('genpit_tyres_')) {
      // The tyre wall stands IN the gap between fence and concrete: past the
      // run off, short of the working lane.
      if (d < 18 || d > 24) worstTyre = { seed, d };
      continue;
    }
    if (d < worstProp.d) worstProp = { d, seed, id: prop.id };
  }

  // The pad is graded flat: under the box run the raw sculpted ground sits at
  // one level. Sampled beside the lane's own nodes, which ride the pad.
  {
    const y0 = gen.pit[0].p[1];
    let worst = 0;
    for (const nd of gen.pit) worst = Math.max(worst, Math.abs(nd.p[1] - y0));
    if (worst > 0.01) laneFailures++;
  }

  // Concrete where the paddock is, grass where the racing line is.
  const t = gen.terrain;
  if (t.paint) {
    // A garage row part marks the paddock; probe just in front of it.
    const garage = gen.props.find((p) => p.id.startsWith('genpad_') && /garage/.test(p.name));
    if (garage) {
      const kind = sampleGround(t, t.paint, garage.p[0], garage.p[2]);
      if (kind !== CONCRETE) paintFailures++;
    }
    for (let k = 0; k < frames.length; k += 9) {
      const f = frames[k];
      if (sampleGround(t, t.paint, f.pos.x, f.pos.z) !== GRASS) { trackPaintFailures++; break; }
    }
  } else {
    paintFailures++;
  }
}

/* One circuit through the whole real pipeline: a barrier has to stand
   between the circuit and the lane, on every cross section that runs abreast
   of it -- the fence a car glances off instead of crossing into the working
   lane. (The generator makes room for the circuit's full run off beside the
   lane on purpose, so this is the catch fence at its outer edge, not the
   squeezed pit wall a hand-drawn tight lane gets.) */
{
  const gp = generatedProject('medium', {}, lcg(4242));
  const d = getDerived(gp);
  const pidx = new PointIndex(d.pitDrawFrames.map((f) => f.pos), 60);
  let abreast = 0;
  let walled = 0;
  for (let i = 0; i < d.trackFrames.length; i++) {
    const f = d.trackFrames[i];
    const pi = pidx.nearest(f.pos.x, f.pos.z, 45);
    if (pi < 0) continue;
    const pf = d.pitDrawFrames[pi];
    /* Only the box run: along the entry and exit tapers the lane converges
       on the circuit and there is genuinely no ground for a fence to stand
       on -- those mouths are what the tyre walls close. Out at the parallel
       section the lane's centre keeps its full offset, and there the fence
       must not have a hole. */
    if (Math.hypot(pf.pos.x - f.pos.x, pf.pos.z - f.pos.z) < 26) continue;
    abreast++;
    const wall = d.pitSide < 0 ? d.profile.wallL[i] : d.profile.wallR[i];
    if (wall > 0) walled++;
  }
  check(
    'a barrier stands between the circuit and the box run, the whole way',
    abreast > 10 && walled === abreast,
    `${walled} of ${abreast} cross sections`,
  );
}

console.log('21 circuits, three sizes:');
check('every node of every circuit is finite', nanFailures === 0, `${nanFailures} circuits`);
check('every lane holds a real box run', laneFailures === 0, `${laneFailures} circuits`);
check(
  'no building stands closer than a walkway behind the fence',
  worstProp.d >= 25,
  `${worstProp.d.toFixed(1)} m at seed ${worstProp.seed} (${worstProp.id})`,
);
check(
  'the tyre walls stand in the mouth of the pit wall, both ends',
  worstTyre === null,
  worstTyre ? `${worstTyre.d.toFixed(1)} m off the centre line at seed ${worstTyre.seed}` : '',
);
check('the garages keep their apron behind the boxes', garageFailures === 0, `${garageFailures} circuits`);
check('the paddock stands on painted concrete', paintFailures === 0, `${paintFailures} circuits`);
check('and none of it leaked onto the racing surface', trackPaintFailures === 0, `${trackPaintFailures} circuits`);

console.log('');
if (failures > 0) { console.log(`${failures} check(s) failed.`); process.exit(1); }
console.log('All checks passed.');
