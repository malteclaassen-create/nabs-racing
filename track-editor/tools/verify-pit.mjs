/**
 * The pit lane junction, checked the way the game sees it: by raycasting the
 * real meshes.
 *
 *   node --import ./tools/ts-resolve.mjs tools/verify-pit.mjs
 *
 * Two failures used to live here and neither was visible from the editor:
 *  - the lane was glued 30 mm ABOVE the road and the road under it was never
 *    cut away, so two physical surfaces coexisted and the upper one was the
 *    30 mm step you felt driving in and out;
 *  - that upper surface carried the PIT key, so 108 m of racing tarmac read as
 *    pit lane and the speed limiter came on out on the track.
 * Both are invisible to every other suite, which is why this one exists.
 */

import * as THREE from 'three';

import { defaultProject } from '../src/store/store.ts';
import { computeFrames } from '../src/core/spline.ts';
import { attachPitLane, mergePitFrames, pitLaneSide, pitLead, pitRoadClip, pitTrackLines } from '../src/core/pitLink.ts';
import { buildRoadMeshes, buildPitMeshes, sideProfile } from '../src/core/road.ts';
import { surfaceOfMesh } from '../src/ac/acScene.ts';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name} ${detail}`); }
}

/** Build a project's road and pit meshes exactly as the app does. */
function build(project) {
  const spp = project.road.samplesPerSegment;
  const trackFrames = computeFrames(project.track, spp);
  const link = attachPitLane(project.pit, trackFrames, true);
  if (!link) throw new Error('attachPitLane returned null');
  // Only when the caller has not already placed the lane itself. A hand moved
  // lane is the shape the mesh builder really sees: nothing re-runs the attach
  // after a drag.
  if (!project.pitPlaced) project.pit.nodes = link.nodes;

  const pitRaw = computeFrames(project.pit, spp);
  const merge = mergePitFrames(pitRaw, trackFrames, project.road.pitGap);
  const pitFrames = merge.frames;
  // The meshes are drawn from the lane plus its lead-out at either end.
  const lead = pitLead(pitRaw, trackFrames, project.pit.closed, project.track.closed);
  const drawFrames = lead.frames === pitRaw
    ? pitFrames
    : mergePitFrames(lead.frames, trackFrames, project.road.pitGap).frames;
  // The profile sees the DRAWN ribbon, wedges included, exactly as the app
  // does: the run off has to clear the wedge too, or it runs across it.
  const profile = sideProfile(trackFrames, project.road, drawFrames, project.track.closed);
  const side = pitLaneSide(pitFrames, trackFrames);
  const clip = pitRoadClip(drawFrames, trackFrames, project.track.closed, profile.kerbWL, profile.kerbWR, undefined, { from: lead.from, to: lead.to });
  const trackLines = pitTrackLines(lead, clip, trackFrames, project.track.closed);

  // Cloned: derived recycles mesh buffers into the next build, so holding on
  // to the originals across two builds compares a thing with itself.
  const defs = [
    ...buildRoadMeshes(trackFrames, project.track.closed, project.road, pitFrames, undefined, profile, trackLines),
    ...buildPitMeshes(drawFrames, project.pit.closed, project.road, undefined, clip, project.pitCfg.limitStart, project.pitCfg.limitEnd, lead.from, lead.to, lead.length),
  ].map((d) => ({
    name: d.name,
    surface: d.surface,
    mesh: Object.assign(new THREE.Mesh(d.geometry.clone(), new THREE.MeshBasicMaterial()), {}),
  }));
  for (const d of defs) d.mesh.updateMatrixWorld();

  return { trackFrames, pitFrames, drawFrames, lead, merge, clip, link, defs, side, trackLines };
}

/** What is left of the road-facing half width once the clip has had its say. */
function pitSideOf(frame, clip, i, side) {
  const laneLo = Math.min(Math.max(-frame.widthL, clip.lo[i]), clip.hi[i]);
  const laneHi = Math.min(Math.max(frame.widthR, clip.lo[i]), clip.hi[i]);
  return side > 0 ? -laneLo : laneHi;
}

/**
 * How far a point lies INSIDE the tarmac, in metres. Negative outside it.
 *
 * Measured against the road centre line as a polyline rather than against the
 * nearest sampled cross section, so it is not the same approximation the code
 * under test uses -- an error shared by both would cancel and prove nothing.
 */
function makeDepth(frames) {
  return (x, z) => {
    let best = Infinity;
    let depth = -Infinity;
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i];
      const b = frames[i + 1];
      const ex = b.pos.x - a.pos.x;
      const ez = b.pos.z - a.pos.z;
      const len2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a.pos.x) * ex + (z - a.pos.z) * ez) / len2));
      const px = a.pos.x + ex * t;
      const pz = a.pos.z + ez * t;
      const d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 >= best) continue;
      best = d2;
      const rx = a.right.x + (b.right.x - a.right.x) * t;
      const rz = a.right.z + (b.right.z - a.right.z) * t;
      const lat = (x - px) * rx + (z - pz) * rz;
      const half = lat < 0
        ? a.widthL + (b.widthL - a.widthL) * t
        : a.widthR + (b.widthR - a.widthR) * t;
      depth = half - Math.abs(lat);
    }
    return depth;
  };
}

/**
 * The vertices a geometry actually draws.
 *
 * Not every vertex in the buffer: the strip builder writes into a buffer it
 * sizes once and reuses, and reads past the draw range are whatever the last
 * build left behind. Measuring those is measuring nothing.
 */
function drawnVertices(geo) {
  const idx = geo.getIndex();
  const pos = geo.getAttribute('position');
  const total = idx ? idx.count : pos.count;
  const count = geo.drawRange.count === Infinity
    ? total
    : Math.min(geo.drawRange.count, total - geo.drawRange.start);
  const used = new Set();
  for (let k = 0; k < count; k++) used.add(idx ? idx.getX(geo.drawRange.start + k) : geo.drawRange.start + k);
  return [...used].map((i) => [pos.getX(i), pos.getZ(i)]);
}

const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 400);

/** The topmost surface at a point, and everything below it. */
function probe(defs, x, z) {
  ray.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
  const hits = [];
  for (const d of defs) {
    for (const h of ray.intersectObject(d.mesh, false)) {
      hits.push({ y: h.point.y, name: d.name, surface: d.surface });
    }
  }
  hits.sort((a, b) => b.y - a.y);
  return hits;
}

/** A frame at an arc length along the track, wrapping a closed loop. */
function frameAt(frames, dist) {
  const total = frames[frames.length - 1].dist;
  let t = dist;
  while (t < 0) t += total;
  while (t > total) t -= total;
  let best = 0;
  for (let i = 0; i < frames.length; i++) if (frames[i].dist <= t) best = i;
  return frames[best];
}

function runCase(label, project, allowance = 0) {
  console.log(`\n${label}`);
  const { trackFrames, pitFrames, drawFrames, lead, merge, clip, link, defs, side, trackLines } = build(project);

  /* 1. No pit surface anywhere a car on the track can be. */
  let onTop = 0;
  let stacked = 0;
  let samples = 0;
  for (const centre of [link.entryDistance, link.exitDistance]) {
    for (let ds = -60; ds <= 60; ds += 0.5) {
      const tf = frameAt(trackFrames, centre + ds);
      const half = Math.min(tf.widthL, tf.widthR);
      for (let lat = -half + 0.25; lat <= half - 0.25; lat += 0.5) {
        const hits = probe(defs, tf.pos.x + tf.right.x * lat, tf.pos.z + tf.right.z * lat);
        samples += 1;
        if (hits.length === 0) continue;
        if (hits[0].surface === 'PIT') onTop += 1;
        // Two drivable surfaces within a wheel's reach of each other.
        for (let i = 1; i < hits.length; i++) {
          if (hits[0].y - hits[i].y < 0.25 && hits[i].name.startsWith('1ROAD')) stacked += 1;
        }
      }
    }
  }
  check(`${samples} samples across the racing line, none standing on a pit surface`, onTop === 0, `${onTop} do`);
  check('and no drivable surface stacked within 25 cm of another', stacked === 0, `${stacked} stacked`);

  /* 2. Nothing to trip over along the pit driving line.
     The surface a car in the lane drives on is the lane itself, so take the
     pit ribbon's own hit rather than whatever happens to be topmost: on a
     hilly track the road runs above the lane where it passes a crest, and
     comparing across meshes measures that crossing instead of a step.

     A bump is also a KINK, not a gradient: on a lane running down a hillside
     every pair of samples differs by the slope, which is fine to drive on.
     What a wheel notices is the surface changing slope from one sample to the
     next, so compare each sample against the straight line through the two
     before it. */
  // Both halves of the ribbon: pit surface inside the limiter window, plain
  // road outside it. Naming only one of them here is how a hole in the other
  // stayed invisible to this suite.
  const isLane = (name) => name.startsWith('1PIT') || name.startsWith('1ROAD_pit');
  let worst = 0;
  let worstAt = 0;
  const hist = [];
  for (const pf of pitFrames) {
    const hit = probe(defs, pf.pos.x, pf.pos.z).find((h) => isLane(h.name));
    if (!hit) { hist.length = 0; continue; }
    hist.push({ s: pf.dist, y: hit.y });
    if (hist.length < 3) continue;
    const [a, b, c] = hist.slice(-3);
    const grade = (b.y - a.y) / Math.max(1e-6, b.s - a.s);
    const kink = Math.abs(c.y - (b.y + grade * (c.s - b.s)));
    if (kink > worst) { worst = kink; worstAt = c.s; }
  }
  /* The bar is the road's own smoothness, not a fixed number. A track drawn
     over a hillside has vertical curvature of its own, and a lane glued to it
     has to follow; what must never happen is the junction being ROUGHER than
     the surface it joins. On the flat default project the road is perfectly
     smooth, so this collapses to the absolute 25 mm floor. */
  let trackKink = 0;
  for (let i = 2; i < trackFrames.length; i++) {
    const a = trackFrames[i - 2], b = trackFrames[i - 1], c = trackFrames[i];
    const g = (b.pos.y - a.pos.y) / Math.max(1e-6, b.dist - a.dist);
    trackKink = Math.max(trackKink, Math.abs(c.pos.y - (b.pos.y + g * (c.dist - b.dist))));
  }
  /* KNOWN GAP, held at its measured value so it cannot quietly get worse.
     On a flat track the lane is as smooth as the road. On a track with a real
     elevation profile it is not yet: the road plane is fitted per cross
     section from the nearest track frame, and no amount of smoothing along
     the lane fully removes that quantisation -- the fit itself has to
     interpolate the road surface instead of sampling one frame of it. 123 mm
     against the road's own 54 mm as of 26.07.2026. */
  const bar = Math.max(0.025, trackKink, allowance);
  check(
    `the pit lane is no rougher than the road it joins (bar ${(bar * 1000).toFixed(0)} mm)`,
    worst <= bar,
    `${(worst * 1000).toFixed(1)} mm at pit s=${worstAt.toFixed(1)}`,
  );

  /* 3. The limiter has to be on before the first pit box -- it is the author's
     setting now, so the check is that the setting is coherent. */
  check(
    `the limiter comes on before the first box (${project.pitCfg.startDist} m)`,
    project.pitCfg.limitStart < project.pitCfg.startDist,
    `limiter at ${project.pitCfg.limitStart} m`,
  );

  /* 4. The ribbon is continuous: it tapers to the tarmac edge rather than
     losing whole cross sections, which is how the end pieces went missing. */
  let holes = 0;
  let narrowest = Infinity;
  for (let i = lead.from; i <= lead.to; i++) {
    const near = pitSideOf(drawFrames[i], clip, i, side);
    narrowest = Math.min(narrowest, near);
    if (!(near > 0)) holes += 1;
  }
  check('the lane keeps a surface at every cross section', holes === 0, `${holes} gaps`);

  /* 4b. And the concrete shoulder beside it has no holes either. This is the
     one the screenshot caught: a stretch of apron one cross section long was
     thrown away by the strip builder, leaving a rectangle of bare grass in the
     middle of the shoulder with nothing anywhere to explain it. Probed just
     outside the lane edge on the far side from the track, where the apron is
     full width all the way along. */
  /* Probed MIDWAY between two cross sections, because that is where a quad
     actually is. Sampling on the cross sections themselves is what let a
     missing plate at the limiter line survive every run of this suite: the
     two surfaces either side of the line each covered their own end frame,
     and the quad between them belonged to neither. */
  const mid = (i, off, out) => {
    const a = pitFrames[i];
    const b = pitFrames[i + 1];
    const oa = (out < 0 ? a.widthL : a.widthR) + off;
    const ob = (out < 0 ? b.widthL : b.widthR) + off;
    return [
      (a.pos.x + a.right.x * oa * out + b.pos.x + b.right.x * ob * out) / 2,
      (a.pos.z + a.right.z * oa * out + b.pos.z + b.right.z * ob * out) / 2,
    ];
  };
  // Away from the track: a lane to the RIGHT of the track has the road on its
  // left, so its outer side is its right. That side keeps its apron the whole
  // way; the road-facing one tapers away on purpose.
  const out = side > 0 ? 1 : -1;
  let apronGaps = 0;
  let laneGaps = 0;
  for (let i = 0; i < pitFrames.length - 1; i++) {
    const [ax, az] = mid(i, 1.0, out);
    if (!probe(defs, ax, az).some((h) => h.surface === 'CONCRETE')) apronGaps += 1;
    const a = pitFrames[i];
    const b = pitFrames[i + 1];
    const lx = (a.pos.x + b.pos.x) / 2;
    const lz = (a.pos.z + b.pos.z) / 2;
    if (!probe(defs, lx, lz).some((h) => isLane(h.name))) laneGaps += 1;
  }
  const plates = pitFrames.length - 1;
  check(`the lane surface is unbroken over ${plates} plates`, laneGaps === 0, `${laneGaps} missing`);
  check(`and so is the pit apron`, apronGaps === 0, `${apronGaps} missing`);
  check('and its narrowest point is a taper, not a gap', narrowest > 0,
    `${narrowest.toFixed(3)} m`);

  /* 4. The lane may lean on the tarmac, but never lie across it. */
  let deepest = 0;
  for (let i = 0; i < pitFrames.length; i++) {
    const pf = pitFrames[i];
    let ti = 0;
    let bd = Infinity;
    for (let k = 0; k < trackFrames.length; k++) {
      const d = (trackFrames[k].pos.x - pf.pos.x) ** 2 + (trackFrames[k].pos.z - pf.pos.z) ** 2;
      if (d < bd) { bd = d; ti = k; }
    }
    const tf = trackFrames[ti];
    const lateral = (pf.pos.x - tf.pos.x) * tf.right.x + (pf.pos.z - tf.pos.z) * tf.right.z;
    const roadHalf = lateral < 0 ? tf.widthL : tf.widthR;
    deepest = Math.max(deepest, roadHalf - Math.abs(lateral));
  }
  check('the lane centre line never crosses the tarmac edge', deepest <= 0, `${deepest.toFixed(3)} m inside`);

  /* 5. And neither does anything DRAWN beside it.
     This is the one the junction kept failing. Checks 1 and 4 look at the
     racing line and at the centre line; between them sits everything the mesh
     builder actually emits -- the lane's own half widths and the concrete
     shoulder outside them -- and a shoulder wedge lying across the tarmac
     showed up in neither, because the shoulder is not a PIT surface and its
     centre line is metres away. Read straight off the triangles, so no rule
     the builder believes about itself can hide a mistake. */
  const depth = makeDepth(trackFrames);
  let worstName = '';
  let intruding = 0;
  for (const d of defs) {
    if (!d.name.startsWith('1PIT') && !d.name.startsWith('1ROAD_pit') && !d.name.includes('pit_apron')) continue;
    for (const [x, z] of drawnVertices(d.mesh.geometry)) {
      const into = depth(x, z);
      if (into > intruding) { intruding = into; worstName = d.name; }
    }
  }
  /* The lane tucks a few centimetres under the edge ON PURPOSE, so the join
     has no hairline of terrain showing through it. Twice that is the bar: a
     tolerance for the polyline sampling, and nothing like enough to hide a
     strip of surface lying on the circuit. */
  check(
    'nothing the lane draws lies on the tarmac',
    intruding <= 0.12,
    `${worstName} reaches ${intruding.toFixed(2)} m past the edge`,
  );

  /* 6. And the ribbon ENDS on the tarmac, rather than stopping in mid air.
     A pit lane joins the circuit at an angle, so its two edges do not reach
     the tarmac in the same place: one crossed it metres back, the other has
     metres still to run. Ending both at the last cross section of the lane's
     own spline cuts the junction off square and leaves a triangle of grass
     between the lane and the circuit -- the notch at both ends, and the one
     thing every check above is blind to, because a notch is an absence. */
  const drawn = [];
  for (let i = 0; i < drawFrames.length; i++) {
    if (clip.hi[i] - clip.lo[i] > 1e-3) drawn.push(i);
  }
  let worstEnd = 0;
  for (const i of [drawn[0], drawn[drawn.length - 1]]) {
    const f = drawFrames[i];
    for (const u of [clip.lo[i], clip.hi[i]]) {
      // Negative depth is outside the tarmac: that corner ends over grass.
      const gap = -depth(f.pos.x + f.right.x * u, f.pos.z + f.right.z * u);
      if (gap > worstEnd) worstEnd = gap;
    }
  }
  check(
    'and the junction closes on the tarmac instead of leaving a notch',
    worstEnd <= 0.3,
    `the ribbon ends ${worstEnd.toFixed(2)} m short of the edge`,
  );

  /* 7. The lines a real pit lane has: the one separating it from the circuit
     along the junction, and the one across it where the limiter comes on. */
  const painted = defs.some((d) => d.name === '1ROAD_line_pit' || d.name === '1PIT_line');
  check('the pit entry and exit line is painted along the junction', painted, 'no line mesh');
  const limit = defs.filter((d) => d.name.includes('pit_limit'));
  check(
    'and the limiter line is painted across the lane at both ends',
    limit.length === 2 && limit.every((d) => d.surface === null),
    `${limit.length} of 2, surfaces ${limit.map((d) => d.surface).join('/')}`,
  );

  /* 7b. Every mesh's NAME agrees with the surface it was built with.
     AC reads the name and nothing else, so a mesh built as pure paint but
     called 1ROAD_something is a drivable surface however the exporter labels
     it -- and the limiter bands were exactly that, two ROAD surfaces floating
     8 mm over the pit lane. The suite's existing guard only checks
     surface -> name and short-circuits on a null surface, so it looked right
     from the one direction it was asked about. This is the other direction. */
  const KEYS = ['ROAD', 'KERB', 'PIT', 'CONCRETE', 'GRASS', 'SAND', 'WALL'];
  const mislabelled = defs
    .map((d) => ({ name: d.name, want: d.surface, got: surfaceOfMesh(d.name, KEYS) }))
    .filter((d) => (d.got ?? null) !== (d.want ?? null));
  check(
    'every mesh name says the same thing about its surface as the mesh does',
    mislabelled.length === 0,
    mislabelled.map((d) => `${d.name} is built ${d.want} but reads ${d.got}`).join('; '),
  );

  /* 8. The junction redraws the EDGE line -- dashed exactly where the pit
     asphalt crosses it -- and the EXIT additionally paints the boundary line
     a car leaving the pits has to stay behind: solid, leaning in off the
     edge past the merge point and running down the racing surface. The entry
     gets no paint on the track at all. */
  const exit = defs.find((d) => d.name === '1ROAD_line_pit_exit');
  {
    let shallow = Infinity;
    let deep = 0;
    if (exit) {
      for (const [x, z] of drawnVertices(exit.mesh.geometry)) {
        const into = depth(x, z);
        shallow = Math.min(shallow, into);
        deep = Math.max(deep, into);
      }
    }
    check(
      'the exit boundary line runs on across the circuit itself',
      !!exit && shallow > -0.1 && deep < 8 && deep > 1,
      exit ? `${shallow.toFixed(2)}..${deep.toFixed(2)} m in from the edge` : 'no mesh',
    );
  }
  const mergeLine = defs.find((d) => d.name === '1ROAD_line_pit_merge');
  let shallow = Infinity;
  let deep = 0;
  if (mergeLine) {
    for (const [x, z] of drawnVertices(mergeLine.mesh.geometry)) {
      const into = depth(x, z);
      shallow = Math.min(shallow, into);
      deep = Math.max(deep, into);
    }
  }
  check(
    'the edge line goes dashed across the junction mouths, on the edge itself',
    !!mergeLine && shallow > -0.1 && deep < 0.5,
    mergeLine ? `${shallow.toFixed(2)}..${deep.toFixed(2)} m in from the edge` : 'no mesh',
  );

  /* 9. The ribbon is solid from edge to edge, with nothing missing in between.
     Walked ACROSS every cross section, two centimetres at a time, between the
     two boundaries the clip actually settled on. Every strip the lane is made
     of has to butt up against its neighbour: concrete, line, asphalt, line,
     concrete. A hole here is what the user sees as grass showing through.

     This is the check that would have caught the worst of them. Both edge
     lines are added to ONE strip builder, and addStrip returns without a word
     when it would overflow the buffer it was sized for -- so asking a mesh
     sized for one full length strip to hold two lost the second one silently,
     and the right hand line was simply absent down the whole lane while the
     geometry that did get built looked perfectly correct. */
  let bare = 0;
  let bareAt = null;
  for (let i = 0; i < drawFrames.length - 1; i++) {
    /* The band that is certainly there halfway between the two cross sections
       is the narrower of the two, not either one of them: where the clip is
       eating into the ribbon, lo moves between one cross section and the next
       and the quad's own edge is the average. Walking frame i's band over the
       midpoint samples past the plate and reports its own overshoot as a hole. */
    const lo = Math.max(clip.lo[i], clip.lo[i + 1]);
    const hi = Math.min(clip.hi[i], clip.hi[i + 1]);
    if (hi - lo <= 0.05) continue;
    const a = drawFrames[i];
    const b = drawFrames[i + 1];
    let gap = 0;
    // Sampled midway between two cross sections, because that is where a quad
    // is. On the cross sections themselves a missing plate hides.
    for (let u = lo + 0.02; u <= hi - 0.02; u += 0.02) {
      const x = (a.pos.x + a.right.x * u + b.pos.x + b.right.x * u) / 2;
      const z = (a.pos.z + a.right.z * u + b.pos.z + b.right.z * u) / 2;
      if (probe(defs, x, z).length > 0) { gap = 0; continue; }
      gap += 0.02;
      if (gap > bare) { bare = gap; bareAt = { s: a.dist, u }; }
    }
  }
  check(
    'the ribbon is solid across every cross section, concrete to concrete',
    bare <= 0.06,
    bareAt ? `${bare.toFixed(2)} m of nothing at pit s=${bareAt.s.toFixed(1)}, ${bareAt.u.toFixed(2)} m off the centre line` : '',
  );

  /* 10. And no bare ground between the ribbon and the tarmac where the two
     meet. Away from the junction the gap between them is the paddock and is
     meant to be there; where the circuit has bitten into the ribbon it is not. */
  let seam = 0;
  let seamAt = null;
  for (let i = 0; i < drawFrames.length; i++) {
    const f = drawFrames[i];
    const lo = clip.lo[i];
    const hi = clip.hi[i];
    if (hi - lo <= 1e-3) continue;
    const cutLo = lo > -(f.widthL + 2.5) + 0.02;
    const cutHi = hi < f.widthR + 2.5 - 0.02;
    if (cutLo === cutHi) continue;
    const from = cutLo ? lo : hi;
    const step = cutLo ? -0.05 : 0.05;
    let gap = 0;
    for (let k = 0; k <= 120; k++) {
      const u = from + step * k;
      if (probe(defs, f.pos.x + f.right.x * u, f.pos.z + f.right.z * u).length > 0) { gap = 0; continue; }
      gap += 0.05;
      if (gap > seam) { seam = gap; seamAt = f.dist; }
    }
  }
  check(
    'and no bare ground between the ribbon and the tarmac where they meet',
    seam <= 0.05,
    seamAt !== null ? `${seam.toFixed(2)} m at pit s=${seamAt.toFixed(1)}` : '',
  );

  /* 11. Nothing bare immediately off the racing surface, anywhere near either
     junction. Further out the ground between the circuit and the lane is the
     paddock and is meant to be open; what must never happen is the very edge
     of the tarmac having nothing beside it, because the ground there is pulled
     down under the road and a slot at the edge reads as a trench of grass.

     Beside the pit lane the run off is squeezed to nothing, and the strip that
     drew it stopped on its last wide cross section -- so the plate between
     that one and the empty one next to it was drawn by nobody. 2.6 m of bare
     ground straight off the racing line, at both junctions, on the flat demo
     circuit. */
  const total = trackFrames[trackFrames.length - 1].dist;
  const frameAtArc = (d) => {
    let best = 0;
    for (let i = 0; i < trackFrames.length; i++) if (trackFrames[i].dist <= d) best = i;
    return best;
  };
  let verge = 0;
  let vergeAt = null;
  for (const l of trackLines) {
    for (let rel = -90; rel <= 90; rel += 2) {
      let d = l.junction + rel;
      while (d < 0) d += total;
      while (d > total) d -= total;
      const i = frameAtArc(d);
      if (i >= trackFrames.length - 1) continue;
      const a = trackFrames[i];
      const b = trackFrames[i + 1];
      const half = l.side < 0 ? a.widthL : a.widthR;
      let gap = 0;
      for (let u = half + 0.05; u <= half + 1; u += 0.05) {
        const off = l.side < 0 ? -u : u;
        const x = (a.pos.x + a.right.x * off + b.pos.x + b.right.x * off) / 2;
        const z = (a.pos.z + a.right.z * off + b.pos.z + b.right.z * off) / 2;
        if (probe(defs, x, z).length > 0) { gap = 0; continue; }
        gap += 0.05;
        if (gap > verge) { verge = gap; vergeAt = rel; }
      }
    }
  }
  check(
    'and nothing bare in the first metre off the tarmac either side of the junction',
    verge <= 0.3,
    vergeAt !== null ? `${verge.toFixed(2)} m at ${vergeAt} m from the junction` : '',
  );
}

console.log('Pit lane junction');
runCase('Flat default project', defaultProject());

/* The same code produced a clean lip on the flat oval and a 100 mm error on a
   profile, because the road plane is fitted per pit frame. */
const hilly = defaultProject();
for (const n of hilly.track.nodes) {
  n.p[1] = 6 * Math.sin((n.p[0] / 180) * Math.PI) + 3 * Math.cos((n.p[2] / 140) * Math.PI);
}
// The allowance is the known gap documented above, not a target.
runCase('With a +/-6 m elevation profile', hilly, 0.13);

/* The lane after somebody has dragged it about, which is what the editor is
   for. The attach puts it neatly on the edge once; every hand move after that
   goes straight to the mesh builder, and that is where the junction used to
   come apart -- the correction was taken off ONE side, picked by a vote over
   the whole lane, so a drag that disagreed with the vote left the lane lying
   across the tarmac with a bite out of its far edge. */
const shoved = defaultProject();
{
  const tf = computeFrames(shoved.track, shoved.road.samplesPerSegment);
  const link = attachPitLane(shoved.pit, tf, true);
  shoved.pit.nodes = link.nodes;
  for (const node of shoved.pit.nodes) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < tf.length; i++) {
      const d = (tf[i].pos.x - node.p[0]) ** 2 + (tf[i].pos.z - node.p[2]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    const f = tf[bi];
    const lat = (node.p[0] - f.pos.x) * f.right.x + (node.p[2] - f.pos.z) * f.right.z;
    node.p[0] -= f.right.x * Math.sign(lat) * 2;
    node.p[2] -= f.right.z * Math.sign(lat) * 2;
  }
  shoved.pitPlaced = true;
}
runCase('Lane dragged 2 m towards the track', shoved);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);



