import { useEditor, defaultProject } from '../src/store/store.ts';
import { getDerived } from '../src/store/derived.ts';
import { resampleTerrain, buildTerrainGeometry, updateTerrainGeometry, cellSize, fitTerrainToTrack } from '../src/core/terrain.ts';

function ms(label, fn, runs = 30) {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) fn();
  const t = (performance.now() - t0) / runs;
  console.log(`   ${label.padEnd(52)} ${t.toFixed(3).padStart(8)} ms`);
  return t;
}

console.log('=== does the fast patch path actually engage? ===\n');
console.log('  size    res   originX        cs = size/(res-1)      patch path?');
for (const [size, res, originX] of [
  [900, 193, -450],      // the factory default
  [900, 289, -450],
  [950, 193, -475],      // one click of the Size stepper
  [2200, 289, -1100],
  [1800, 289, -903.47],  // what "Fit terrain to track" typically produces
  [1600, 97, -800],
]) {
  const t = { enabled: true, res, size, originX, originZ: originX, base: -0.6, blend: 22, heights: new Float32Array(res * res) };
  for (let i = 0; i < t.heights.length; i++) t.heights[i] = Math.sin(i * 0.01);
  const g = buildTerrainGeometry(t, t.heights);
  const h2 = new Float32Array(t.heights);
  h2[5000] += 1;
  const ok = updateTerrainGeometry(g, t, h2);
  const cs = cellSize(t);
  console.log(
    `  ${String(size).padEnd(7)} ${String(res).padEnd(5)} ${String(originX).padEnd(12)} ${cs.toFixed(8).padEnd(20)} ` +
      (ok ? 'YES - patches in place' : 'NO  -> FULL REBUILD, new geometry every frame'),
  );
}

console.log('\n=== cost of one sculpt frame, same project, only the terrain box differs ===');
for (const [label, size, originX] of [
  ['exact grid   (size 900, origin -450)', 900, -450],
  ['inexact grid (size 1800, origin -903.47)', 1800, -903.47],
]) {
  const p = defaultProject();
  p.terrain = resampleTerrain(p.terrain, 289);
  p.terrain.size = size;
  p.terrain.originX = originX;
  p.terrain.originZ = originX;
  useEditor.setState({ project: p, past: [], future: [] });
  const d0 = getDerived(useEditor.getState().project);
  const geo0 = d0.terrainDef.geometry;
  useEditor.getState().sculpt(0, -140, 'raise', 1 / 60, 0);
  const d1 = getDerived(useEditor.getState().project);
  console.log(`\n  ${label}`);
  console.log(`    geometry object reused across a sculpt frame? ${d1.terrainDef.geometry === geo0 ? 'yes' : 'NO - a brand new one'}`);
  const seen = new Set();
  ms('    one sculpt frame', () => {
    useEditor.getState().sculpt(0, -140, 'raise', 1 / 60, 0);
    seen.add(getDerived(useEditor.getState().project).terrainDef.geometry);
  });
  console.log(`    distinct terrain geometries created over the run: ${seen.size}`);
}
