import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCorners, cumulativeDist, cornerInsights, lapMarkers, sectorDeltas, gForces, brakePoint,
  sectionAt, neighbourSection, deltaTrend, resampleLap, indexAtTime, formatLapTime,
} from '../src/utils/telemetryAnalysis.js';

// A lap round a circle of radius R metres at a speed profile with two slow
// zones. Positions in decimetres, time in ms, exactly the recorder's shape.
function circleLap({ n = 400, R = 100, fast = 60, slow = 25, slowZones = [[80, 120], [260, 300]], brakeLead = 10, later = 0 } = {}) {
  const speedMs = new Array(n).fill(fast);
  for (const [a, b] of slowZones) for (let i = a; i <= b; i++) speedMs[i] = slow;
  const brake = new Array(n).fill(0), gas = new Array(n).fill(100);
  for (const [a] of slowZones) for (let i = a - brakeLead + later; i < a + 3 + later; i++) { brake[i] = 80; gas[i] = 0; }
  const x = [], z = [], t = [0];
  const ds = (2 * Math.PI * R) / n;
  for (let i = 0; i < n; i++) {
    const th = (i / n) * 2 * Math.PI;
    x.push(Math.round(R * Math.cos(th) * 10));
    z.push(Math.round(R * Math.sin(th) * 10));
    if (i > 0) t.push(t[i - 1] + (ds / ((speedMs[i - 1] + speedMs[i]) / 2)) * 1000);
  }
  const speed = speedMs.map((v) => Math.round(v * 3.6));
  return { n, t: t.map(Math.round), speed, gas, brake, steer: new Array(n).fill(0), gear: new Array(n).fill(4), x, z, lapTimeMs: Math.round(t[n - 1]) };
}

test('the slow parts of a lap are found with their apex and numbered in lap order', () => {
  const lap = circleLap();
  const corners = detectCorners(lap.speed);
  assert.equal(corners.length, 2);
  assert.ok(corners[0].apex >= 80 && corners[0].apex <= 120);
  assert.ok(corners[1].apex >= 260 && corners[1].apex <= 300);
  assert.ok(corners[0].start < corners[1].start);
});

test('a slow stretch across the start/finish line is one section, not two', () => {
  const lap = circleLap({ slowZones: [[0, 20], [380, 399]] });
  const corners = detectCorners(lap.speed);
  assert.equal(corners.length, 1);
  assert.equal(corners[0].end, 399);
});

test('the brake point is where the braking for the corner began, not an early dab', () => {
  const lap = circleLap({ slowZones: [[100, 130]], brakeLead: 10 });
  // A dab on the brake forty slices before the corner, released again.
  lap.brake[55] = 60; lap.brake[56] = 60;
  assert.equal(brakePoint(lap, 40, 115), 90);
  assert.equal(brakePoint({ brake: new Array(200).fill(0) }, 40, 115), null);
});

test('cumulative distance walks the circle', () => {
  const lap = circleLap({ R: 100, n: 400 });
  const d = cumulativeDist(lap.x, lap.z, lap.n);
  assert.ok(Math.abs(d[lap.n - 1] - 2 * Math.PI * 100 * (399 / 400)) < 2);
  assert.equal(cumulativeDist(null, null, 10), null);
});

test('a lap that brakes later and carries more speed shows up as gaining, with metres', () => {
  const a = circleLap();
  const b = circleLap({ slow: 27, later: 3 });
  const n = a.n;
  const corners = detectCorners(a.speed);
  const dist = cumulativeDist(a.x, a.z, n);
  const ins = cornerInsights(a, b, corners, dist, n);
  assert.equal(ins.length, 2);
  for (const c of ins) {
    assert.ok(c.gainMs < 0, 'B is quicker through the slow section, so gain (B - A) is negative');
    assert.ok(c.brakeDeltaM > 0, 'B brakes later, in metres');
    assert.ok(c.midDelta > 0, 'B carries more minimum speed');
    assert.equal(typeof c.atPct, 'number');
  }
  const markers = lapMarkers(b, corners, n);
  assert.equal(markers.brake.length, 2);
  assert.equal(markers.gas.length, 2);
});

test('three sectors add up to the finish-line gap exactly', () => {
  const a = circleLap();
  const b = circleLap({ slow: 27 });
  const dist = cumulativeDist(a.x, a.z, a.n);
  const sectors = sectorDeltas(a, b, dist, a.n);
  assert.equal(sectors.length, 3);
  const sum = sectors.reduce((s, x) => s + x.deltaMs, 0);
  assert.equal(sum, b.t[a.n - 1] - a.t[a.n - 1]);
  assert.equal(sectors[0].from, 0);
  assert.equal(sectors[2].to, a.n - 1);
  // Without positions the split is by slice count and still closes.
  const bySlice = sectorDeltas(a, b, null, a.n);
  assert.equal(bySlice.reduce((s, x) => s + x.deltaMs, 0), sum);
});

test('lateral g on a constant-radius circle is v squared over R', () => {
  const lap = circleLap({ R: 100, fast: 30, slowZones: [] });
  const g = gForces(lap, lap.n);
  const expect = (30 * 30) / 100 / 9.81;
  const mid = Math.abs(g.lat[200]);
  assert.ok(Math.abs(mid - expect) < expect * 0.1, `${mid} vs ${expect}`);
  assert.ok(Math.abs(g.long[200]) < 0.05, 'constant speed: no longitudinal g');
  const old = { ...lap, x: null, z: null };
  assert.equal(gForces(old, old.n).lat, null);
});

test('cursor helpers: section under the cursor, neighbours and the gap trend', () => {
  const a = circleLap();
  const b = circleLap({ slow: 27 });
  const corners = detectCorners(a.speed);
  const dist = cumulativeDist(a.x, a.z, a.n);
  const sections = cornerInsights(a, b, corners, dist, a.n);
  assert.equal(sectionAt(sections, sections[0].apex).n, 1);
  assert.equal(sectionAt(sections, 0), null);
  assert.equal(neighbourSection(sections, 0, 1).n, 1);
  assert.equal(neighbourSection(sections, sections[0].apex, 1).n, 2);
  assert.equal(neighbourSection(sections, sections[1].apex, -1).n, 1);
  assert.equal(neighbourSection(sections, 0, -1), null);
  assert.ok(deltaTrend(a, b, sections[0].apex + 5, 20) < 0, 'B gained through the section');
});

test('resampling and time lookup keep their old behaviour', () => {
  const lap = circleLap({ n: 100 });
  const r = resampleLap(lap, 50);
  assert.equal(r.n, 50);
  assert.equal(r.t.length, 50);
  assert.equal(r.t[49], lap.t[99]);
  assert.equal(indexAtTime(lap, lap.t[40] + 1, lap.n, 0), 41);
  assert.equal(formatLapTime(80242), '1:20.242');
});
