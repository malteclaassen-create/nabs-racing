import test from 'node:test';
import assert from 'node:assert/strict';
import { fitTelemetryWindow, telemetryIndexAt } from '../src/utils/telemetryWindow.js';

test('a selected corner keeps its absolute lap position in either drag direction', () => {
  assert.deepEqual(fitTelemetryWindow(360, 440, 799), [360, 440]);
  assert.deepEqual(fitTelemetryWindow(440, 360, 799), [360, 440]);
  assert.equal(telemetryIndexAt(0, [360, 440]), 360);
  assert.equal(telemetryIndexAt(0.5, [360, 440]), 400);
  assert.equal(telemetryIndexAt(1, [360, 440]), 440);
});

test('panning at the start or finish preserves the visible distance', () => {
  assert.deepEqual(fitTelemetryWindow(-50, 50, 799), [0, 100]);
  assert.deepEqual(fitTelemetryWindow(750, 850, 799), [699, 799]);
  assert.equal(telemetryIndexAt(-1, [360, 440]), 360);
  assert.equal(telemetryIndexAt(2, [360, 440]), 440);
});

test('repeated zooms cannot collapse the graph or escape the lap', () => {
  for (const last of [49, 799, 999, 1499]) {
    for (const center of [0, last / 2, last]) {
      let range = [0, last];
      for (let i = 0; i < 12; i++) {
        const span = (range[1] - range[0]) / 2;
        range = fitTelemetryWindow(center - span / 2, center + span / 2, last);
        assert.ok(range[0] >= 0 && range[1] <= last);
        assert.ok(range[1] - range[0] >= 8);
        assert.ok(last / (range[1] - range[0]) <= 20);
        assert.ok(Number.isInteger(range[0]) && Number.isInteger(range[1]));
      }
      assert.deepEqual(fitTelemetryWindow(-last, last * 2, last), [0, last]);
    }
  }
});
