import test from 'node:test';
import assert from 'node:assert/strict';
import { motionBlurAmount, transitions } from '../src/motionBlur.ts';

const zoomOnly = { zoomBlur: true, zoomBlurStrength: 0.5, cursorBlur: false, cursorBlurStrength: 0, globalStrength: 0.5 };

test('zoom blur follows a sin envelope over each transition', () => {
  const windows = transitions([{ id: 'z', start: 2000, end: 5000 }], 600);
  assert.deepEqual(windows.map(w => [w.start, w.end, w.type]), [[1400, 2000, 'in'], [5000, 5600, 'out']]);
  assert.equal(motionBlurAmount(zoomOnly, windows, 600, [], 1000), 0);
  // Peak: sin(π/2) · 0.5 · 15 · 0.5 = 3.75 px
  assert.ok(Math.abs(motionBlurAmount(zoomOnly, windows, 600, [], 1700) - 3.75) < 1e-9);
  assert.ok(Math.abs(motionBlurAmount(zoomOnly, windows, 600, [], 5300) - 3.75) < 1e-9);
  assert.ok(motionBlurAmount(zoomOnly, windows, 600, [], 3000) === 0);
});

test('cursor blur scales with pointer speed and the total is capped at 20 px', () => {
  const fast = Array.from({ length: 10 }, (_, i) => ({ t: i * 10, x: i * 0.1, y: 0, event: 'move' }));
  const still = Array.from({ length: 10 }, (_, i) => ({ t: i * 10, x: 0.5, y: 0.5, event: 'move' }));
  const cursor = { zoomBlur: false, zoomBlurStrength: 0, cursorBlur: true, cursorBlurStrength: 1, globalStrength: 0.5 };
  assert.equal(motionBlurAmount(cursor, [], 600, still, 45), 0);
  // 0.01 units/ms → saturates: 1 · 1 · 8 · 0.5 = 4 px
  assert.equal(motionBlurAmount(cursor, [], 600, fast, 45), 4);
  const huge = { zoomBlur: true, zoomBlurStrength: 10, cursorBlur: false, cursorBlurStrength: 0, globalStrength: 1 };
  assert.equal(motionBlurAmount(huge, transitions([{ id: 'z', start: 600, end: 900 }], 600), 600, [], 300), 20);
});
