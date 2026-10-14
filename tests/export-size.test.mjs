import test from 'node:test';
import assert from 'node:assert/strict';
import { outputSize } from '../src/exportSize.ts';

test('presets fit inside the standard frame for the canvas orientation', () => {
  assert.deepEqual(outputSize(1920, 1080, 1080), { width: 1920, height: 1080 });
  assert.deepEqual(outputSize(3840, 2160, 720), { width: 1280, height: 720 });
  // Slightly wider than 16:9: keep the width standard, give up a little height.
  assert.deepEqual(outputSize(1966, 1080, 1080), { width: 1920, height: 1054 });
  assert.deepEqual(outputSize(3932, 2160, 2160), { width: 3840, height: 2110 });
  // Narrower than 16:9 (e.g. 4:3) keeps the full height.
  assert.deepEqual(outputSize(1440, 1080, 1080), { width: 1440, height: 1080 });
  // Portrait canvases fit inside 1080×1920.
  assert.deepEqual(outputSize(1080, 1920, 1080), { width: 1080, height: 1920 });
  assert.deepEqual(outputSize(1000, 1000, 1080), { width: 1080, height: 1080 });
});

test('original keeps the canvas size and every size is even', () => {
  assert.deepEqual(outputSize(1967, 1081, 'original'), { width: 1968, height: 1082 });
  for (const [w, h] of [[1999, 1123], [1001, 777], [3333, 1111]]) {
    for (const p of [720, 1080, 2160]) {
      const s = outputSize(w, h, p);
      assert.equal(s.width % 2, 0);
      assert.equal(s.height % 2, 0);
    }
  }
});
