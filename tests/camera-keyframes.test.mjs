import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraPoseAt } from '../src/cameraKeyframes.ts';
import { spring } from '../src/camera.ts';

const settings = { visible: true, position: 9, shape: 'rounded', size: 220, roundness: 50, mirror: true };
const k = (id, time, extra) => ({ id, time, position: 9, size: 220, roundness: 50, mirror: true, visible: true, opacity: 1, ...extra });

test('no keyframes: the camera settings', () => {
  assert.deepEqual(cameraPoseAt([], settings, 1000, 60), { x: 1, y: 1, shape: 'rounded', size: 220, roundness: 50, mirror: true, visible: true, opacity: 1 });
});

test('between keyframes: spring for size/position, linear opacity, discrete switch half way', () => {
  const keys = [k('a', 1000, { position: 1, size: 200, opacity: 1 }), k('b', 3000, { position: 9, size: 400, opacity: 0, shape: 'circle', mirror: false })];
  const t = 1500, s = Math.min(1, spring(Math.floor((500 / 1000) * 60), 60, { damping: 20, mass: 1, stiffness: 100 }, Math.ceil(2 * 60)));
  const pose = cameraPoseAt(keys, settings, t, 60);
  assert.ok(Math.abs(pose.size - (200 + 200 * s)) < 1e-9);
  assert.ok(Math.abs(pose.x - s) < 1e-9);
  assert.equal(pose.opacity, 0.75);
  assert.equal(pose.shape, 'rounded');
  assert.equal(cameraPoseAt(keys, settings, 2500, 60).shape, 'circle');
  assert.equal(cameraPoseAt(keys, settings, 2500, 60).mirror, false);
  // Before the first keyframe the first one applies; after the last, the last one.
  assert.equal(cameraPoseAt(keys, settings, 0, 60).size, 200);
  assert.equal(cameraPoseAt(keys, settings, 9000, 60).size, 400);
});
