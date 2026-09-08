import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonCsv, comparisonSummary } from '../src/utils/telemetryExport.js';

const lap = (name, ms, offset = 0) => ({
  name, lapTimeMs: ms, n: 4, car: 'ks_ferrari_f2007', team: { name: 'Red Bull' },
  t: [0, 20000 + offset, 40000 + offset, ms], speed: [200, 150, 100, 220], gas: [100, 50, 0, 100], brake: [0, 20, 80, 0], steer: [0, 150, -300, 0], gear: [6, 4, 2, 7],
});

test('the CSV has one row per slice and lap B columns only when there is a lap B', () => {
  const a = lap('A', 60000), b = lap('B', 60500, 200);
  const single = comparisonCsv({ lapA: a, lapB: null, dist: [0, 100, 200, 300], n: 4, gA: { long: [0, 0, 0, 0], lat: null }, gB: null });
  const rows = single.split('\n');
  assert.equal(rows.length, 5);
  assert.ok(rows[0].startsWith('pct_of_lap,metres_A,time_A_ms'));
  assert.ok(!rows[0].includes('time_B_ms'));
  assert.equal(rows[2].split(',')[1], '100.0');
  const both = comparisonCsv({ lapA: a, lapB: b, dist: null, n: 4, gA: null, gB: null });
  const head = both.split('\n')[0].split(',');
  assert.ok(head.includes('delta_B_minus_A_ms'));
  assert.equal(both.split('\n')[2].split(',')[head.indexOf('delta_B_minus_A_ms')], '200');
  assert.equal(both.split('\n')[1].split(',')[1], '', 'no positions, no metres');
});

test('the summary reads as a chat message with the gap, the sectors and the sections', () => {
  const a = lap('DRAS', 80242), b = lap('Naigouu', 81316, 300);
  const text = comparisonSummary({
    trackName: 'nabs park · GP', season: 7, lapA: a, lapB: b, gapMs: 1074,
    sectors: [{ n: 1, deltaMs: 310 }, { n: 2, deltaMs: -2 }, { n: 3, deltaMs: 766 }],
    insights: [{ n: 1, atPct: 12, atM: 640, gainMs: 210, brakeDeltaM: -9, midDelta: -6, exitDelta: 1 }],
    idealMs: 79900, link: 'https://example.test/tools?tel=x',
  });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Lap comparison · nabs park · GP · Season 7');
  assert.ok(lines[1].startsWith('A  DRAS (Red Bull) · 1:20.242'));
  assert.ok(lines[3].startsWith('Gap: A +1.074 s · S1 A +0.310 · S2 even · S3 A +0.766'));
  assert.equal(lines[4], 'Best of both sectors: 1:19.900');
  assert.ok(lines[6].includes('12% · 640 m · A +0.210 s — A brakes 9 m later, A +6 km/h min'));
  assert.equal(lines.at(-1), 'https://example.test/tools?tel=x');
});
