import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cameraAt, measureSpring, spring, springPresets } from '../src/camera.ts';

test('mellow spring settles like a damped spring', () => {
  assert.equal(measureSpring(60, springPresets.mellow), 45);
  assert.equal(spring(0, 60, springPresets.mellow, 36), 0);
  assert.equal(spring(9, 60, springPresets.mellow, 36), 0.5591044703208308);
  assert.equal(spring(37, 60, springPresets.mellow, 36), 1);
});

test('camera state per frame matches the reference', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/camera-reference.json', import.meta.url), 'utf8'));
  for (const { settings, frame, time, expected } of fixture.cases) {
    const state = cameraAt(fixture.zooms, settings, fixture.cursor, time, 60, frame);
    assert.deepEqual(
      { scale: state.scale, focusX: state.focusX, focusY: state.focusY, isZooming: state.isZooming, isFollowingCursor: state.isFollowingCursor, progress: state.progress },
      expected, `frame ${frame} ${JSON.stringify(settings)}`);
  }
  assert.ok(fixture.cases.some(c => c.expected.isFollowingCursor), 'fixture exercises cursor following');
});
