/**
 * Performance guard.
 *
 *   node --import ./tools/ts-resolve.mjs tools/verify-perf.mjs
 *
 * Drives the real store the way the UI does and checks two things:
 *
 * 1. Edits that have nothing to do with the ground do NOT rebuild the terrain.
 *    Typing in the track name used to rebuild an 84000 vertex mesh per
 *    keystroke, which is what made the editor freeze at random moments.
 * 2. The remaining per edit cost stays inside a frame budget.
 *
 * Rebuilds are detected by object identity: if the cache did its job, the
 * height field and the terrain geometry come back as the very same objects.
 */

import { useEditor, defaultProject, generatedProject } from '../src/store/store.ts';
import { getDerived, stats } from '../src/store/derived.ts';
import { buildTerrainGeometry, heightsDelta, resampleTerrain } from '../src/core/terrain.ts';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

function setup(res, nodeCount) {
  const p = defaultProject();
  if (nodeCount) {
    p.track.nodes = Array.from({ length: nodeCount }, (_, i) => {
      const a = (i / nodeCount) * Math.PI * 2;
      return { ...p.track.nodes[0], id: `n${i}`, p: [Math.sin(a) * 900, 0, -Math.cos(a) * 600] };
    });
  }
  p.terrain = resampleTerrain(p.terrain, res);
  useEditor.setState({ project: p, past: [], future: [] });
  return getDerived(useEditor.getState().project);
}

function edit(mutate) {
  useEditor.getState().commit(mutate);
  return getDerived(useEditor.getState().project);
}

/** Cheap fingerprint of a geometry's vertex data. */
function checksum(geometry) {
  const a = geometry.getAttribute('position').array;
  let sum = 0;
  for (let i = 0; i < a.length; i += 7) sum = (sum + a[i] * (i + 1)) % 1e9;
  return sum;
}

function timed(label, fn, runs = 20) {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) fn();
  const ms = (performance.now() - t0) / runs;
  console.log(`        ${label.padEnd(34)} ${ms.toFixed(2).padStart(7)} ms/edit`);
  return ms;
}

for (const [res, nodes] of [[193, 0], [289, 60]]) {
  console.log(`\nterrain ${res} x ${res}, ${nodes || 12} track nodes`);
  let d = setup(res, nodes);
  const heights0 = d.terrainHeights;
  const terrainGeo0 = d.terrainDef.geometry;
  const roadGeo0 = d.roadMeshes[0].geometry;
  const ai0 = d.ai;
  const markers0 = d.markers;

  let n = 0;
  d = edit((p) => { p.meta.name = `Name ${n++}`; });
  check('renaming the track keeps the height field', d.terrainHeights === heights0);
  check('renaming the track keeps the terrain mesh', d.terrainDef.geometry === terrainGeo0);
  check('renaming the track keeps the road meshes', d.roadMeshes[0].geometry === roadGeo0);
  check('renaming the track keeps the AI line', d.ai === ai0);

  d = edit((p) => { p.props.push({ id: `x${n++}`, kind: 'cone', name: 'c', p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], ground: true }); });
  check('placing an object does not touch the terrain', d.terrainDef.geometry === terrainGeo0);
  check('placing an object does not touch the road', d.roadMeshes[0].geometry === roadGeo0);

  d = edit((p) => { p.grid.rowSpacing = 8.5; });
  check('changing grid spacing does not touch the terrain', d.terrainDef.geometry === terrainGeo0);
  check('changing grid spacing does rebuild the markers', d.markers !== markers0);

  d = edit((p) => { p.timing.startS = 0.12; });
  check('moving the start line does not touch the road', d.roadMeshes[0].geometry === roadGeo0);

  /* Things that legitimately must rebuild. */
  const roadShapeBefore = checksum(d.roadMeshes[0].geometry);
  d = edit((p) => { p.track.nodes[2].p[1] = 5; });
  check(
    'moving a track node does reshape the road',
    checksum(d.roadMeshes[0].geometry) !== roadShapeBefore,
  );
  check(
    'but it reuses the road buffers instead of reallocating',
    d.roadMeshes[0].geometry === roadGeo0,
    'a new geometry per frame means allocating and freeing GPU buffers every frame',
  );
  check('moving a track node does rebuild the terrain', d.terrainHeights !== heights0);

  const geoBeforeSculpt = d.terrainDef.geometry;
  useEditor.getState().sculpt(0, -140, 'raise', 1 / 60, 0);
  const afterSculpt = getDerived(useEditor.getState().project);
  check('sculpting changes the heights', afterSculpt.terrainHeights !== d.terrainHeights);
  check(
    'sculpting reuses the terrain geometry buffers',
    afterSculpt.terrainDef.geometry === geoBeforeSculpt,
    'a new geometry means a full GPU re-upload every frame',
  );

  /* While a control is being dragged the heavy work is deferred. */
  {
    const before = getDerived(useEditor.getState().project, false);
    // Road buffers are recycled in place, so the value has to be read now.
    const roadBefore = checksum(before.roadMeshes[0].geometry);
    useEditor.getState().live((p) => { p.track.nodes[4].p[0] += 12; });
    const during = getDerived(useEditor.getState().project, true);
    check('a drag still reshapes the road immediately', checksum(during.roadMeshes[0].geometry) !== roadBefore);
    check('but it does not rebuild the ground', during.terrainDef.geometry === before.terrainDef.geometry);
    check('nor the AI line', during.ai === before.ai);
    check('markers still follow, they are cheap', during.markers !== before.markers);

    const after = getDerived(useEditor.getState().project, false);
    check('letting go catches the ground up', after.terrainHeights !== before.terrainHeights);
    check('and the AI line', after.ai !== before.ai);
  }

  /*
   * The one that actually bit: dragging must not hand out new geometries.
   *
   * Kerbs, run off and barriers come in stretches, and the pit lane clearance
   * changes how many stretches there are as you drag. When the buffers were
   * sized to fit, that changed the vertex count almost every frame, the
   * recycling failed, and the editor created and threw away a GPU buffer per
   * mesh per frame. The live geometry count climbed from 22 into the hundreds
   * and the browser eventually stopped for seconds at a time.
   */
  {
    let step = 0;
    const drag = () => {
      useEditor.getState().live((prj) => {
        prj.pit.nodes[1].p[0] = 40 + (step++ % 17) * 4;
      });
      return getDerived(useEditor.getState().project, true);
    };

    drag();
    const settled = drag();
    const meshCount = settled.roadMeshes.length + settled.pitMeshes.length;

    const seen = new Set();
    const counts = new Set();
    const ranges = new Set();
    for (let i = 0; i < 40; i++) {
      const d = drag();
      counts.add(d.roadMeshes.length + d.pitMeshes.length);
      for (const m of [...d.roadMeshes, ...d.pitMeshes]) {
        seen.add(m.geometry);
        ranges.add(`${m.name}:${m.geometry.drawRange.count}`);
      }
    }

    // Without this the test would pass even with the bug present, simply
    // because nothing about the shape changed during the drag.
    check(
      'the drag really does change the shape of the road',
      ranges.size > counts.size,
      `${ranges.size} distinct drawn ranges: the barrier stretches are not changing, so this test proves nothing`,
    );
    check(
      'forty frames of dragging allocate no new geometry',
      seen.size <= meshCount,
      `${seen.size} distinct geometries for ${meshCount} meshes: the buffers are not being reused`,
    );
    check(
      'and the mesh count never wobbles',
      counts.size === 1,
      `saw mesh counts ${[...counts].join(', ')}`,
    );
    check(
      'the drawn range still tracks the shape',
      settled.roadMeshes.some((m) => m.geometry.drawRange.count > 0),
    );
  }

  /*
   * The deferral has to arm itself.
   *
   * It used to depend on the 3D library's mouse-down callback firing. If that
   * were ever missed, every frame of a drag would rebuild the corridor and
   * re-upload the whole terrain, silently, with no error anywhere. Driving it
   * the way the viewport does, through markBusy and the store, proves the flag
   * is actually set by the act of dragging.
   */
  {
    useEditor.setState({ interacting: false });
    const before = { masks: stats.maskBuilds, terrains: stats.terrainBuilds };

    let k = 0;
    for (let i = 0; i < 25; i++) {
      // Exactly what GizmoLayer.writeBack does: mark busy, then apply.
      useEditor.getState().markBusy();
      useEditor.getState().live((prj) => { prj.track.nodes[6].p[2] = 60 + (k++ % 9); });
      getDerived(useEditor.getState().project, useEditor.getState().interacting);
    }

    check('dragging sets the busy flag by itself', useEditor.getState().interacting);
    check(
      'and twenty five frames of it rebuild the corridor at most once',
      stats.maskBuilds - before.masks <= 1,
      `${stats.maskBuilds - before.masks} corridor rebuilds`,
    );
    check(
      'and never rebuild the terrain mesh',
      stats.terrainBuilds - before.terrains === 0,
      `${stats.terrainBuilds - before.terrains} terrain rebuilds`,
    );

    // Letting go must catch everything up.
    useEditor.setState({ interacting: false });
    getDerived(useEditor.getState().project, false);
    check('letting go rebuilds the corridor once', stats.maskBuilds - before.masks >= 1);
  }

  /*
   * Painting, not reshaping.
   *
   * A kerb's style, its colour, the edge line and the texture scale change what
   * is drawn on ground the side profile has already settled -- no width moves,
   * so neither the profile nor the corridor nor the terrain has any reason to
   * be rebuilt. Keyed on the whole road they all were: switching one kerb from
   * plain to rippled cost twelve milliseconds and a terrain upload on a long
   * circuit, for a change of pattern. The signature is split in two so it
   * cannot happen again.
   */
  {
    useEditor.setState({ interacting: false });
    useEditor.getState().commit((prj) => {
      prj.road.kerbs = [
        { id: 'k1', side: -1, from: 0.1, to: 0.4, style: 'ramp', width: 1.2, height: 0.07, taper: 3, apron: 0 },
      ];
    });
    const first = getDerived(useEditor.getState().project, false);
    const before = { masks: stats.maskBuilds, terrains: stats.terrainBuilds };

    useEditor.getState().commit((prj) => { prj.road.kerbs[0].style = 'wave'; });
    const styled = getDerived(useEditor.getState().project, false);
    check('changing a kerb style keeps the side profile', styled.profile === first.profile);
    check('and the ground under it', styled.terrainDef === first.terrainDef);
    check('but does rebuild the kerb mesh', styled.roadMeshes !== first.roadMeshes);
    check(
      'and touches neither the corridor nor the terrain',
      stats.maskBuilds === before.masks && stats.terrainBuilds === before.terrains,
      `${stats.maskBuilds - before.masks} corridor, ${stats.terrainBuilds - before.terrains} terrain`,
    );

    useEditor.getState().commit((prj) => { prj.road.edgeLineWidth = 0.2; });
    const lined = getDerived(useEditor.getState().project, false);
    check('the same for the painted edge line', lined.profile === styled.profile);

    // Moving one, on the other hand, moves the edge of the built surface, and
    // everything downstream of it has to notice.
    useEditor.getState().commit((prj) => { prj.road.kerbs[0].width = 2.4; });
    const wider = getDerived(useEditor.getState().project, false);
    check('but a wider kerb does rebuild the profile', wider.profile !== lined.profile);
    check('and the corridor with it', stats.maskBuilds > before.masks);
  }

  /*
   * The brush must let go of the ground it replaces.
   *
   * Every dab writes a new height field and notes which cells changed, so the
   * mesh update can patch instead of rescanning. That note used to hold the
   * PREVIOUS field as an ordinary reference inside a WeakMap value -- and a
   * WeakMap only holds its keys weakly. Field n kept n-1 alive, which was still
   * a live key, whose note kept n-2, all the way back to the first stroke of
   * the session: a hundred and fifty kilobytes a dab, nine megabytes a second,
   * never collectable. A recorded session climbed six hundred megabytes a
   * minute and the tab died with "Out of memory" after a few minutes of
   * sculpting. Checked by shape rather than by watching the heap, because the
   * shape is deterministic and a garbage collector is not.
   */
  {
    const before = useEditor.getState().project.terrain.heights;
    useEditor.getState().sculpt(30, 30, 'raise', 0.016, 0);
    const after = useEditor.getState().project.terrain.heights;
    const note = heightsDelta.get(after);

    check('a brush dab notes where it painted', Boolean(note), 'no delta recorded');
    check(
      'and holds the field it replaced WEAKLY',
      note?.prev instanceof WeakRef,
      `prev is ${note?.prev?.constructor?.name ?? typeof note?.prev}, which chains every dab of the session together`,
    );
    check('the note still points at the right field', note?.prev?.deref() === before);
    check('and the two fields really are different objects', before !== after);
  }

  /* Terrain off is the escape hatch for a long track: it must actually be free. */
  {
    useEditor.getState().commit((prj) => { prj.terrain.enabled = false; });
    const off = getDerived(useEditor.getState().project, false);
    check('with the terrain off there is no ground mesh', off.terrainDef === null);
    check(
      'and the heights are the raw sculpted ones, unblended',
      off.terrainHeights === useEditor.getState().project.terrain.heights,
      'still running the corridor blend would defeat the point',
    );
    let j = 0;
    const offMs = timed('drag a node, terrain off', () => {
      useEditor.getState().live((prj) => { prj.track.nodes[3].p[0] = 150 + (j++ % 5); });
      getDerived(useEditor.getState().project);
    });
    // What is left is the road and the AI line, which scale with track length.
    check('dragging with the terrain off is cheap', offMs < 8, `${offMs.toFixed(2)} ms`);
    useEditor.getState().commit((prj) => { prj.terrain.enabled = true; });
  }

  /*
   * The ground brush.
   *
   * A repaint moves triangles between materials, so unlike a sculpt dab it
   * genuinely has to cut the mesh again -- it must still fit in a frame. And a
   * dab that would repaint what is already there has to cost nothing at all:
   * for most of a sweep the pointer is inside the patch it painted two frames
   * ago, and paying a megabyte copy and a full recut to arrive back at the same
   * picture is exactly what would make the brush feel like treacle.
   */
  {
    useEditor.getState().setGround({ kind: 3, radius: 40 });
    const heightsBefore = getDerived(useEditor.getState().project).terrainHeights;
    let px = 0;
    const paintMs = timed('one ground brush frame', () => {
      useEditor.getState().paintGround(-300 + px++ * 6, 300, 3);
      getDerived(useEditor.getState().project);
    });
    check('a ground brush dab fits in a 60 fps frame', paintMs < 12, `${paintMs.toFixed(2)} ms`);

    const painted = getDerived(useEditor.getState().project);
    check('painting the ground does not touch the height field',
      painted.terrainHeights === heightsBefore);
    check('and the ground comes back cut into one run per material',
      (painted.terrainDef.groups ?? []).length > 1);

    const geo = painted.terrainDef.geometry;
    const field = useEditor.getState().project.terrain.paint;
    const again = useEditor.getState().paintGround(-300, 300, 3);
    check('a dab that repaints what is already there does nothing',
      again === false && useEditor.getState().project.terrain.paint === field);
    check('so the mesh is not cut again for it',
      getDerived(useEditor.getState().project).terrainDef.geometry === geo);
  }

  console.log('      cost per edit:');
  let k = 0;
  const cheap = timed('rename (unrelated edit)', () => edit((p) => { p.meta.name = `N${k++}`; }));
  // The landscape-only cost: with the road carried along, a dab over the
  // track is a road edit and is budgeted with the node drag below.
  useEditor.setState({ brushRoad: false });
  const sculptMs = timed('one sculpt frame', () => {
    useEditor.getState().sculpt(0, -140, 'raise', 1 / 60, 0);
    getDerived(useEditor.getState().project);
  });
  useEditor.setState({ brushRoad: true });
  // Sculpting over the road moves the control points and everything hanging
  // off them - frames, profile, corridor, ground - so it costs what a node
  // edit costs, and has to fit the same frame.
  const sculptRoadMs = timed('one sculpt frame over the road', () => {
    useEditor.getState().sculpt(0, -140, 'raise', 1 / 60, 0);
    getDerived(useEditor.getState().project);
  });
  const nodeMs = timed('drag a track node', () => {
    useEditor.getState().live((p) => { p.track.nodes[2].p[0] = 200 + (k++ % 7); });
    getDerived(useEditor.getState().project);
  });
  const dragMs = timed('the same while actually dragging', () => {
    useEditor.getState().live((p) => { p.track.nodes[2].p[0] = 200 + (k++ % 7); });
    getDerived(useEditor.getState().project, true);
  });

  // Budgets sit roughly double the measured cost, so they catch a real
  // regression without tripping on a slower machine.
  check('unrelated edits are essentially free', cheap < 1, `${cheap.toFixed(2)} ms`);
  check('sculpting stays far inside a frame', sculptMs < 4, `${sculptMs.toFixed(2)} ms`);
  check('sculpting over the road fits in a 60 fps frame', sculptRoadMs < 16, `${sculptRoadMs.toFixed(2)} ms`);
  check('dragging a node fits in a 60 fps frame', nodeMs < 16, `${nodeMs.toFixed(2)} ms`);
  // Loose enough to survive run to run noise, tight enough that losing the
  // deferral would show up.
  check(
    'and a live drag is clearly cheaper still',
    dragMs < nodeMs * 0.75,
    `${dragMs.toFixed(2)} ms vs ${nodeMs.toFixed(2)} ms`,
  );
}

/*
 * The crooked terrain box. "Fit terrain to track" or a click on the size
 * stepper produce origins and cell sizes that are not exactly representable in
 * float32. The grid match used to compare float32 vertex data against the
 * float64 origin with a 1e-6 tolerance, so exactly these boxes failed the
 * check and every sculpt frame rebuilt - and leaked - a full terrain geometry:
 * ~4.7 MB of GPU buffers per frame at res 289. The default 900 / -450 box is
 * the one lucky case where the numbers happen to be exact, which is why the
 * scenarios above cannot catch this.
 */
{
  console.log('\ncrooked terrain box (fit-to-track style origin)');
  const p = defaultProject();
  p.terrain = { ...p.terrain, size: 1800, originX: -903.47, originZ: -911.13 };
  useEditor.setState({ project: p, past: [], future: [] });
  let d = getDerived(useEditor.getState().project);
  const geo0 = d.terrainDef.geometry;

  useEditor.getState().pushHistory(); // as the pointer-down handler does
  for (let i = 0; i < 5; i++) {
    useEditor.getState().sculpt(-3.47 + i * 2, -11.13, 'raise', 1 / 60, 0);
    d = getDerived(useEditor.getState().project);
  }
  check(
    'sculpting on a crooked box reuses the terrain geometry',
    d.terrainDef.geometry === geo0,
    'every sculpt frame builds a fresh geometry and leaks the old buffers',
  );

  // The incremental update must land on exactly the same vertices as building
  // from scratch, or the patch bookkeeping is lying somewhere.
  const fresh = buildTerrainGeometry(useEditor.getState().project.terrain, d.terrainHeights);
  check(
    'the patched update matches a full rebuild vertex for vertex',
    checksum(d.terrainDef.geometry) === checksum(fresh),
  );
  fresh.dispose();

  // Undo swaps in a height field the patch note does not apply to; that must
  // fall back to the safe path, not paint a stale patch.
  useEditor.getState().undo();
  d = getDerived(useEditor.getState().project);
  const freshUndo = buildTerrainGeometry(useEditor.getState().project.terrain, d.terrainHeights);
  check(
    'undo after sculpting still shows the right ground',
    checksum(d.terrainDef.geometry) === checksum(freshUndo),
  );
  freshUndo.dispose();
}

/*
 * The biggest thing the editor now opens by itself.
 *
 * A generated 7 km circuit brings its own ground: up to a 321 grid over 3.5 km,
 * which is 103k vertices against the default project's 66k, and 42 control
 * points against twelve. Nothing else in this file measures that combination,
 * and it is the one a first time user is most likely to be sitting in front of.
 */
{
  console.log('\na generated 7 km circuit');
  const p = generatedProject('long');
  useEditor.setState({ project: p, past: [], future: [], selection: null });
  let d = getDerived(useEditor.getState().project);
  console.log(`      ${p.track.nodes.length} points, terrain ${p.terrain.size} m at ${p.terrain.res}`);

  const geo0 = d.terrainDef.geometry;
  let k = 0;
  const genSculpt = timed('one sculpt frame', () => {
    useEditor.getState().sculpt(p.terrain.originX + 400, p.terrain.originZ + 400, 'raise', 1 / 60, 0);
    getDerived(useEditor.getState().project);
  });
  const genDrag = timed('drag a track node while dragging', () => {
    useEditor.getState().live((prj) => { prj.track.nodes[8].p[0] += (k++ % 5) - 2; });
    getDerived(useEditor.getState().project, true);
  });
  check('sculpting a generated circuit stays inside a frame', genSculpt < 8, `${genSculpt.toFixed(2)} ms`);
  check('and dragging one of its nodes does too', genDrag < 16, `${genDrag.toFixed(2)} ms`);
  check('and sculpting still reuses the terrain geometry', d.terrainDef.geometry === geo0);
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exitCode = failures === 0 ? 0 : 1;
