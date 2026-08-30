/**
 * The seams of the built scene, checked the way the eye finds them: by
 * raycasting the finished meshes and walking across every joint.
 *
 *   node --import ./tools/ts-resolve.mjs tools/verify-seams.mjs
 *
 * Born from one screenshot of the pit complex with its edges torn. Everything
 * here failed on that day, none of it was visible to any other suite, and each
 * check pins one of the faults:
 *  - the ground was sunk 20 cm for the depth buffer and eased back up over the
 *    width of the run off, so wherever the run off was squeezed -- which is
 *    most of the ground beside a pit lane -- a hand-deep trench ran along the
 *    seam ("ein dunkler Schlitz");
 *  - the run off's outer edge kept its full height over ground held 4 cm
 *    under it, a step of bare cut earth along every grass verge;
 *  - the pit corridor went on sinking the ground past the wedge tip, under
 *    cross sections whose whole band the clip had taken -- 19 cm of naked
 *    trench straight off the racing line;
 *  - the concrete beside the lane kept its 9 cm of shoulder fall through the
 *    junction, so a car crossed a clean cliff on its way into the pits.
 *
 * The probes are jittered along the track: a ray dropped exactly onto a shared
 * triangle edge reports a hole that is not there.
 */

import * as THREE from 'three';

import { defaultProject, generatedProject } from '../src/store/store.ts';
import { getDerived } from '../src/store/derived.ts';
import { computeFrames } from '../src/core/spline.ts';
import { attachPitLane } from '../src/core/pitLink.ts';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name} ${detail}`); }
}

/** A drivable or walkable surface: a step inside these is a real edge. */
const HARD = /^1?(ROAD|PIT|CONCRETE|KERB)/;
/** Standing scenery: a barrier IS a step, on purpose. */
const STANDS = /WALL|FENCE|OBJ|TREE|GATE/;

function runCase(name, project, { hardStep = 0.025, trench = 0.1 } = {}) {
  console.log(`\n${name}`);
  const d = getDerived(project);
  const mk = (m) => {
    const o = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial());
    o.updateMatrixWorld();
    return { name: m.name, mesh: o };
  };
  const all = [...d.roadMeshes, ...d.pitMeshes, ...(d.terrainDef ? [d.terrainDef] : [])]
    .filter((m) => !STANDS.test(m.name))
    .map(mk);
  const ray = new THREE.Raycaster();
  const top = (x, z) => {
    ray.set(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0));
    let best = null;
    for (const o of all) for (const h of ray.intersectObject(o.mesh, false))
      if (!best || h.point.y > best.y) best = { y: h.point.y, name: o.name };
    return best;
  };

  let worstHard = { j: 0 };
  let worstTrench = { depth: 0 };
  for (let i = 0; i < d.pitDrawFrames.length; i += 3) {
    const f = d.pitDrawFrames[i];
    // Nudged off the cross section, and by a different amount per station, so
    // no probe ever runs down a shared triangle edge.
    const jx = f.fwd.x * (0.011 + (i % 7) * 0.003);
    const jz = f.fwd.z * (0.011 + (i % 7) * 0.003);
    const lo = -f.widthL - 10;
    const hi = f.widthR + 10;
    let prev = null;
    let bareRun = [];
    const flush = (next) => {
      /* Two or more consecutive probes of bare ground between two drawn
         surfaces: how far below the STRAIGHT LINE between those two flanks
         does it lie? Against one flank alone, every hillside failed: between
         a run off uphill and an apron downhill the ground has to fall the
         difference, and that fall is an earth bank, not a trench. One probe
         alone is a ray on an edge and proves nothing. */
      if (bareRun.length >= 2 && prev && next) {
        const u0 = bareRun[0].u;
        const u1 = bareRun[bareRun.length - 1].u;
        for (const b of bareRun) {
          const t01 = u1 > u0 ? (b.u - u0) / (u1 - u0) : 0;
          const line = prev.y + (next.y - prev.y) * t01;
          const depth = line - b.y;
          if (depth > worstTrench.depth) worstTrench = { depth, s: f.dist, u: b.u, name: b.name, beside: `${prev.name}/${next.name}`, besideY: line, y: b.y };
        }
      }
      bareRun = [];
    };
    for (let u = lo; u <= hi; u += 0.25) {
      const t = top(f.pos.x + f.right.x * u + jx, f.pos.z + f.right.z * u + jz);
      if (!t) { flush(null); prev = null; continue; }
      if (/terrain/.test(t.name)) {
        bareRun.push({ ...t, u });
        continue;
      }
      flush(t);
      if (prev && HARD.test(prev.name) && HARD.test(t.name)) {
        const j = Math.abs(t.y - prev.y);
        if (j > worstHard.j) worstHard = { j, s: f.dist, u, from: prev.name, to: t.name };
      }
      prev = t;
    }
    flush(null);
  }

  check(
    'no step a wheel can find between two drawn surfaces',
    worstHard.j <= hardStep,
    worstHard.s !== undefined
      ? `${(worstHard.j * 1000).toFixed(0)} mm at pit s=${worstHard.s.toFixed(0)}, u=${worstHard.u.toFixed(1)} (${worstHard.from} -> ${worstHard.to})`
      : '',
  );
  check(
    'and no trench of bare ground along any seam of the complex',
    worstTrench.depth <= trench,
    worstTrench.s !== undefined
      ? `${(worstTrench.depth * 1000).toFixed(0)} mm deep at pit s=${worstTrench.s.toFixed(0)}, u=${worstTrench.u.toFixed(1)} (unter ${worstTrench.beside}@${worstTrench.besideY?.toFixed(3)}, Boden ${worstTrench.y?.toFixed(3)})`
      : '',
  );
}

/* The user's own case: everything at height zero. */
const flat = defaultProject();
for (const n of flat.track.nodes) n.p[1] = 0;
for (const n of flat.pit.nodes) n.p[1] = 0;
runCase('Flat default oval, everything at 0', flat);

/* A generated circuit AS GENERATED, hills and all. It used to be flattened by
   hand here, which quietly masked the very fault a user photographed: on real
   relief the complex stood on whatever the hillside did, and grass stood up
   through the concrete along the entry. The generator grades the pad flat
   now, and this is what holds it to that. */
{
  let seed = 999;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const gen = generatedProject('medium', {}, rng);
  runCase('Generated circuit, on its own relief', gen, { hardStep: 0.05, trench: 0.15 });
}

/* The same oval over hills: the plane fits and the corridor have to follow.
   The lane is re-attached AFTER the hills go in, exactly as the editor levels
   it -- a lane left at its old heights under a lifted track is the mismatch
   case mergePitFrames refuses to glue, not a seam. */
{
  const hilly = defaultProject();
  for (const n of hilly.track.nodes) {
    n.p[1] = 6 * Math.sin((n.p[0] / 180) * Math.PI) + 3 * Math.cos((n.p[2] / 140) * Math.PI);
  }
  const tf = computeFrames(hilly.track, hilly.road.samplesPerSegment);
  const link = attachPitLane(hilly.pit, tf, true);
  if (link) hilly.pit.nodes = link.nodes;
  /* The trench allowance is the grid's floor, not a target: a 2 m strip of
     ground between two corridors on a 6 m hill lives between height samples
     7.8 m apart, and what the straight line between those samples digs is set
     by cell size times slope. The flat cases hold the real contract at a
     tenth of this; tightening the hilly one is a matter of terrain
     resolution. The faults this file was written against measured 12 m of
     overlap and 19 cm of naked trench ON FLAT GROUND -- those can not return
     under either threshold. */
  runCase('Default oval with a +/-6 m elevation profile', hilly, { hardStep: 0.05, trench: 0.3 });
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');
