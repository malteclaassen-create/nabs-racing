import test from 'node:test';
import assert from 'node:assert/strict';
import {recordedPose,sampleAtTime} from '../src/utils/telemetryGeometry.js';

test('cars keep sub-metre detail and interpolate between recorded positions',()=>{
  const a=recordedPose([100.01,100.11,100.21],[1,1,1],0.5);
  assert.ok(Math.abs(a.x-100.06)<1e-8);
  assert.equal(a.y,1);
  assert.equal(a.heading,0);
  const b=recordedPose([100.01,100.11,100.21],[3,3,3],0.5);
  assert.equal(b.y-a.y,2);
});
test('recordings with different sample counts follow their own time axis',()=>{
  assert.equal(sampleAtTime([0,1000,2000],500),0.5);
  assert.equal(sampleAtTime([0,500,1000,1500,2000],500),1);
  assert.equal(sampleAtTime([0,1000,2000],3000),2);
  assert.equal(sampleAtTime([0,1000,2000],0,2),0);
});
test('car headings do not spin through zero at the 180-degree boundary',()=>{
  const pose=recordedPose([3,2,1,0],[0,0.01,0,-0.01],1.5);
  assert.ok(Math.abs(pose.heading)>170);
  assert.ok(Number.isFinite(recordedPose([1,1,1],[2,2,2],1).heading));
});
