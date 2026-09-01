/**
 * The decorative access roads, checked end to end through the derived
 * pipeline: a road ended at the circuit has to glue itself onto the tarmac,
 * a road out in the field has to stay exactly where it was drawn, the ground
 * has to bed itself under both, and the meshes have to carry a surface the
 * game can drive on.
 *
 *   node --import ./tools/ts-resolve.mjs tools/verify-roads.mjs
 */

import * as THREE from 'three';
import { defaultProject } from '../src/store/store.ts';
import { getDerived } from '../src/store/derived.ts';
import { computeFrames } from '../src/core/spline.ts';
import { attachRoadEnds, pitRoadClip } from '../src/core/pitLink.ts';
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
  { id: 'a', name: 'Road 1', surface: 'asphalt', line: true, path: { closed: false, nodes: joined } },
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
// Three: the asphalt surface, its dashed centre line, and the concrete path.
check('every road builds a mesh', derived.decoMeshes.length === 3,
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

/* --- the centre line ------------------------------------------------ */

{
  const line = derived.decoMeshes.find((m) => m.name === '1ROAD_line_deco_0');
  check('an asphalt road carries its dashed centre line', !!line);
  check('the concrete path carries none',
    !derived.decoMeshes.some((m) => m.name === '1CONCRETE_line_deco_1'));
  if (line) {
    /* The line stops at the junction: no line vertex may lie within the
       circuit's tarmac. A real centre line ends before the give-way line. */
    const pos = line.geometry.getAttribute('position');
    let onTrack = 0;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k);
      let best = Infinity, bi = 0;
      for (let i = 0; i < trackFrames.length; i++) {
        const d = (trackFrames[i].pos.x - x) ** 2 + (trackFrames[i].pos.z - z) ** 2;
        if (d < best) { best = d; bi = i; }
      }
      const tf2 = trackFrames[bi];
      const lat = Math.abs((x - tf2.pos.x) * tf2.right.x + (z - tf2.pos.z) * tf2.right.z);
      if (lat < (lat < 0 ? tf2.widthL : tf2.widthR) - 0.3) onTrack++;
    }
    check('and the line stops short of the circuit', onTrack === 0, `${onTrack} vertices on the tarmac`);
  }
}

/* --- a crossing and a roundabout ------------------------------------ */

{
  const p2 = defaultProject();
  const tf0 = computeFrames(p2.track, p2.road.samplesPerSegment);
  const f2 = tf0[Math.floor(tf0.length * 0.5)];
  const at = (d, off) => ({
    x: f2.pos.x + f2.right.x * (f2.widthR + d) + f2.fwd.x * off,
    z: f2.pos.z + f2.right.z * (f2.widthR + d) + f2.fwd.z * off,
  });
  const mk = (pt, i) => node(pt.x, pt.z, 100 + i);

  /* Road A runs out into the field; road B crosses it at right angles. */
  const a = [at(40, -60), at(40, 0), at(40, 60)].map(mk);
  const bx = [at(10, 20), at(40, 20), at(70, 20)].map(mk);
  /* And a roundabout ring, with an approach road ending at its edge. */
  const ring = [];
  const C = at(150, 0);
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    ring.push(node(C.x + Math.cos(ang) * 14, C.z + Math.sin(ang) * 14, 200 + k));
  }
  const approachEnd = { x: C.x - (14 + 3 + 2), z: C.z };
  const approach = [mk({ x: C.x - 90, z: C.z }, 300), mk({ x: C.x - 50, z: C.z }, 301), mk(approachEnd, 302)];

  p2.decoRoads.push(
    { id: 'ra', name: 'A', surface: 'asphalt', line: true, path: { closed: false, nodes: a } },
    { id: 'rb', name: 'B', surface: 'asphalt', line: true, path: { closed: false, nodes: bx } },
    { id: 'rr', name: 'Ring', surface: 'asphalt', line: false, path: { closed: true, nodes: ring } },
    { id: 'rc', name: 'Approach', surface: 'asphalt', line: true, path: { closed: false, nodes: approach } },
  );
  const d2 = getDerived(p2);

  /* The crossing: road B is cut back against road A's edge, so the drawn
     bands of the two never overlap. Sampled across the crossing zone. */
  const meshA = d2.decoMeshes.find((m) => m.name === '1ROAD_deco_0');
  const meshB = d2.decoMeshes.find((m) => m.name === '1ROAD_deco_1');
  check('both crossing roads still build', !!meshA && !!meshB);
  /*
   * Two roads that MEET are handled and checked above: an end brought near
   * another road is glued onto its edge -- the T junction and the roundabout
   * below. Two roads that CROSS keep going: the clip runs with keepCrossings,
   * so an on-tarmac stretch in the middle of a ribbon is treated as an
   * intersection and its band is given back whole, while mergePitFrames has
   * already glued its heights onto the other road's plane a few millimetres
   * under it -- so the crossing is level and one surface owns the pixels.
   * The direct clip behaviour is asserted on its own further down.
   */

  /* The roundabout ring builds as a closed loop, and the approach docked. */
  const ringMesh = d2.decoMeshes.find((m) => m.name === '1ROAD_deco_2');
  check('the roundabout ring builds', !!ringMesh);
  const app = d2.decoLines.find((l) => l.id === 'rc');
  let dockGap = Infinity;
  if (app && app.frames.length) {
    const end = app.frames[app.frames.length - 1].pos;
    /* Docked means the end sits on the ring's EDGE: centre-line radius plus
       the ring's half width plus the road's own, less the bury the attach
       tucks under every edge it joins. */
    const expected = 14 + 3.2 + 3 - 0.25;
    dockGap = Math.abs(Math.hypot(end.x - C.x, end.z - C.z) - expected);
  }
  check('an approach road docks onto the ring like it docks onto the circuit',
    dockGap < 1.5, `${dockGap.toFixed(1)} m off the ring's edge`);
}

/* --- a crossing keeps its surface ----------------------------------- */

{
  /* Two straight ribbons crossing obliquely, run through the clip alone.
     Without keepCrossings the crossing severed the lower road -- the band
     collapsed to one side of the other road's edge. With it, the crossing
     stretch keeps its full band, and only the ends could ever make wedges. */
  const mkPath = (pts) => ({ closed: false, nodes: pts.map(([x, z], i) => node(x, z, 600 + i)) });
  const A = computeFrames(mkPath([[0, -80], [0, 0], [0, 80]]), 8);
  const B = computeFrames(mkPath([[-80, -60], [0, 0], [80, 60]]), 8);
  const lead = { from: 0, to: B.length - 1 };
  const cut = pitRoadClip(B, A, false, undefined, undefined, 0, lead);
  const kept = pitRoadClip(B, A, false, undefined, undefined, 0, lead, true);
  let severed = false;
  let narrowest = Infinity;
  for (let i = 0; i < B.length; i++) {
    if (cut.hi[i] - cut.lo[i] < 1) severed = true;
    narrowest = Math.min(narrowest, kept.hi[i] - kept.lo[i]);
  }
  check('the plain clip cuts an oblique crossing (so keepCrossings has a job)', severed);
  check('keepCrossings carries the road whole across the other',
    narrowest > 5.9, `narrowest band ${narrowest.toFixed(2)} m of 6`);
}

/* --- a road drawn PAST the circuit stays where it was drawn ---------- */

{
  /* The snap used to reach 30 m: a road sketched well clear of the tarmac was
     still yanked onto it. Twelve metres off now means twelve metres off. */
  const p5 = defaultProject();
  const tf5 = computeFrames(p5.track, p5.road.samplesPerSegment);
  const f5 = tf5[Math.floor(tf5.length * 0.5)];
  const off5 = (d, along = 0) => ({
    x: f5.pos.x + f5.right.x * (f5.widthR + d) + f5.fwd.x * along,
    z: f5.pos.z + f5.right.z * (f5.widthR + d) + f5.fwd.z * along,
  });
  const drawn = [off5(12, -40), off5(12, 0), off5(12, 40)].map((p, i) => node(p.x, p.z, 700 + i));
  const untouched = attachRoadEnds({ closed: false, nodes: drawn }, tf5);
  check('an end 12 m off the tarmac is NOT dragged onto it',
    untouched.nodes === drawn || (untouched.nodes[0].p[0] === drawn[0].p[0] && untouched.nodes[0].p[2] === drawn[0].p[2]));
}

/* --- docking onto a car park pad ------------------------------------ */

{
  const p3 = defaultProject();
  const tf3 = computeFrames(p3.track, p3.road.samplesPerSegment);
  const f3 = tf3[Math.floor(tf3.length * 0.5)];
  const out = (d, off = 0) => ({
    x: f3.pos.x + f3.right.x * (f3.widthR + d) + f3.fwd.x * off,
    z: f3.pos.z + f3.right.z * (f3.widthR + d) + f3.fwd.z * off,
  });
  // A 26 x 20 m asphalt pad out in the field, turned 30 degrees, plus a road
  // whose end stops 8 m short of its edge.
  const C = out(160);
  p3.props.push({
    id: 'padtest', kind: 'pad_asphalt', name: 'pad', p: [C.x, 0, C.z],
    r: [0, 30, 0], s: [2.6, 1, 2.0], ground: true,
  });
  const a30 = (30 * Math.PI) / 180;
  // The pad's local -X edge (hx = 13), in world space via prefabs' `turn`.
  const edgeMid = { x: C.x + -13 * Math.cos(a30), z: C.z - -13 * -Math.sin(a30) };
  const startP = { x: edgeMid.x - 90, z: edgeMid.z };
  const nearP = { x: edgeMid.x - (8 + 0), z: edgeMid.z };
  p3.decoRoads.push({
    id: 'pk', name: 'To the car park', surface: 'asphalt',
    path: { closed: false, nodes: [node(startP.x, startP.z, 400), node((startP.x + nearP.x) / 2, (startP.z + nearP.z) / 2, 401), node(nearP.x, nearP.z, 402)] },
  });
  const d3 = getDerived(p3);
  const lineTo = d3.decoLines.find((l) => l.id === 'pk');
  let onPad = false;
  if (lineTo && lineTo.frames.length) {
    const end = lineTo.frames[lineTo.frames.length - 1].pos;
    // Into the pad's frame: inside its rectangle means the end docked on.
    const dx = end.x - C.x, dz = end.z - C.z;
    const lx = dx * Math.cos(a30) - dz * Math.sin(a30);
    const lz = dx * Math.sin(a30) + dz * Math.cos(a30);
    onPad = Math.abs(lx) <= 13 + 0.01 && Math.abs(lz) <= 10 + 0.01;
    check('a road ended near a pad lands on its edge', onPad,
      `local (${lx.toFixed(1)}, ${lz.toFixed(1)}) vs 13 x 10 pad`);
    // And level with the pad's top, not buried in the ground beside it.
    check('and takes the pad\'s height', Math.abs(end.y - 0.02) < 0.25, `y ${end.y.toFixed(2)}`);
  } else {
    check('a road ended near a pad lands on its edge', false, 'no frames');
  }

  // A road that already docked onto the CIRCUIT is not stolen by a pad
  // standing right beside the junction.
  const p4 = defaultProject();
  const tf4 = computeFrames(p4.track, p4.road.samplesPerSegment);
  const f4 = tf4[Math.floor(tf4.length * 0.5)];
  const out4 = (d) => ({
    x: f4.pos.x + f4.right.x * (f4.widthR + d),
    z: f4.pos.z + f4.right.z * (f4.widthR + d),
  });
  const P = out4(18);
  p4.props.push({
    id: 'padnear', kind: 'pad_asphalt', name: 'pad', p: [P.x, 0, P.z],
    r: [0, 0, 0], s: [1, 1, 1], ground: true,
  });
  const n0 = out4(5);
  p4.decoRoads.push({
    id: 'tk', name: 'To the track', surface: 'asphalt',
    path: { closed: false, nodes: [node(n0.x, n0.z, 500), node(out4(60).x, out4(60).z, 501), node(out4(100).x, out4(100).z, 502)] },
  });
  const d4 = getDerived(p4);
  const lineTk = d4.decoLines.find((l) => l.id === 'tk');
  if (lineTk && lineTk.frames.length) {
    const end = lineTk.frames[0].pos;
    const lat = Math.abs((end.x - f4.pos.x) * f4.right.x + (end.z - f4.pos.z) * f4.right.z);
    check('the circuit still wins over a pad beside the junction',
      Math.abs(lat - (f4.widthR + 3 - 0.25)) < 2, `lateral ${lat.toFixed(1)}`);
  } else {
    check('the circuit still wins over a pad beside the junction', false, 'no frames');
  }
}

/* --- docking stays straight: no S hook at the ring -------------------- */

{
  /* A road running RADIALLY at a small roundabout, with its second point
     close behind the end. The attach used to pull that second point 25 m
     "ahead" along the ring -- a quarter of the way round the circle -- so
     the road arrived as an S hooked around a point nobody drew. Arriving
     across the target, the neighbour has to stay exactly where it was drawn
     and the last leg has to stay radial. */
  const R3 = 22;
  const C3 = { x: 1400, z: 900 };
  const mkn = (x, z, i, half = 3.2) => ({
    id: `sh${i}`, p: [x, 0, z], widthL: half, widthR: half, bank: 0,
    wallL: false, wallR: false, runoffL: 0, runoffR: 0, wallGapL: 0, wallGapR: 0, aiOffset: 0,
  });
  const ringNodes = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    ringNodes.push(mkn(C3.x + Math.cos(a) * R3, C3.z + Math.sin(a) * R3, `r${k}`));
  }
  const ringFrames = computeFrames({ closed: true, nodes: ringNodes }, 8);
  const endD = R3 + 3.2 + 4; // 4 m off the ring's edge: clearly aimed at it
  const road = {
    closed: false,
    nodes: [
      mkn(C3.x + endD + 90, C3.z, 'a', 3),
      mkn(C3.x + endD + 30, C3.z, 'b', 3),
      mkn(C3.x + endD, C3.z, 'c', 3),
    ],
  };
  const glued = attachRoadEnds(road, ringFrames, 'last');
  const nb = glued.nodes[1];
  const end = glued.nodes[2];
  check('a transversal arrival leaves the second point where it was drawn',
    nb.p[0] === road.nodes[1].p[0] && nb.p[2] === road.nodes[1].p[2]);
  const endAng = (Math.atan2(end.p[2] - C3.z, end.p[0] - C3.x) * 180) / Math.PI;
  check('and the end docks radially onto the ring, not around it',
    Math.abs(endAng) < 3
      && Math.abs(Math.hypot(end.p[0] - C3.x, end.p[2] - C3.z) - (R3 + 3.2 + 3 - 0.25)) < 1,
    `${endAng.toFixed(1)} deg round the ring`);
  // The last leg really is the straight line that was drawn.
  const legAng = (Math.atan2(end.p[2] - nb.p[2], end.p[0] - nb.p[0]) * 180) / Math.PI;
  check('so the road runs dead straight into the roundabout',
    Math.abs(((legAng % 360) + 360) % 360 - 180) < 3, `leg at ${legAng.toFixed(1)} deg`);
}

/* --- a roundabout with four arms, drawn in every order ---------------- */

{
  /* The shape a roundabout really has: a ring and roads coming at it from
     opposite sides. Two of those roads face each other across the circle and
     lie on the same line, which is exactly the arrangement that used to take
     the whole thing apart -- see ribbonGap in pitLink. And the order matters
     because it must NOT: dropping the ring after its approaches is the same
     roundabout, and having to lay it down first was an invisible rule. */
  const R2 = 14;
  const RING_HALF = 3.2;
  const ROAD_HALF = 3;
  const C2 = { x: 900, z: 900 };
  const docked = R2 + RING_HALF + ROAD_HALF - 0.25;
  const nd = (x, z, i, half) => ({
    id: `rb${i}`, p: [x, 0, z], widthL: half, widthR: half, bank: 0,
    wallL: false, wallR: false, runoffL: 0, runoffR: 0, wallGapL: 0, wallGapR: 0, aiOffset: 0,
  });
  const ringRoad = () => {
    const nodes = [];
    for (let k = 0; k < 8; k++) {
      const ang2 = (k / 8) * Math.PI * 2;
      nodes.push(nd(C2.x + Math.cos(ang2) * R2, C2.z + Math.sin(ang2) * R2, `r${k}`, RING_HALF));
    }
    return { id: 'ring', name: 'Ring', surface: 'asphalt', line: false, path: { closed: true, nodes } };
  };
  const arm = (deg) => {
    const a2 = (deg * Math.PI) / 180;
    const dx = Math.cos(a2);
    const dz = Math.sin(a2);
    const endD = R2 + RING_HALF + 2;
    return {
      id: `arm${deg}`, name: `A${deg}`, surface: 'asphalt', line: false,
      path: { closed: false, nodes: [
        nd(C2.x + dx * (endD + 90), C2.z + dz * (endD + 90), `${deg}a`, ROAD_HALF),
        nd(C2.x + dx * (endD + 45), C2.z + dz * (endD + 45), `${deg}b`, ROAD_HALF),
        nd(C2.x + dx * endD, C2.z + dz * endD, `${deg}c`, ROAD_HALF),
      ] },
    };
  };
  const ARMS = [0, 90, 180, 270];
  const ORDERS = [
    ['ring first', [ringRoad(), ...ARMS.map(arm)]],
    ['ring last', [...ARMS.map(arm), ringRoad()]],
    ['ring in the middle', [arm(0), arm(90), ringRoad(), arm(180), arm(270)]],
  ];
  for (const [label, roads] of ORDERS) {
    const rp = defaultProject();
    rp.decoRoads.push(...roads);
    const rd = getDerived(rp);
    let docks = 0;
    let worstD = 0;
    let worstA = 0;
    for (const deg of ARMS) {
      const l = rd.decoLines.find((x) => x.id === `arm${deg}`);
      if (!l || l.frames.length < 2) continue;
      const e = l.frames[l.frames.length - 1].pos;
      const st = l.frames[0].pos;
      const dist = Math.hypot(e.x - C2.x, e.z - C2.z);
      let dAng = (Math.atan2(e.z - C2.z, e.x - C2.x) * 180) / Math.PI - deg;
      while (dAng > 180) dAng -= 360;
      while (dAng < -180) dAng += 360;
      // The far end has to stay exactly where it was drawn, which is the
      // half of this that the collinear-arms fault broke first.
      const farOk = Math.hypot(st.x - C2.x, st.z - C2.z) > 100;
      worstD = Math.max(worstD, Math.abs(dist - docked));
      worstA = Math.max(worstA, Math.abs(dAng));
      if (Math.abs(dist - docked) < 1 && Math.abs(dAng) < 8 && farOk) docks++;
    }
    check(
      `all four arms dock onto the ring, ${label}`,
      docks === 4,
      `${docks}/4 (worst ${worstD.toFixed(2)} m out, ${worstA.toFixed(1)} deg round)`,
    );
  }
}

if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('all deco road checks passed.');
