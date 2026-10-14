import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPoint, threeDAt } from '../src/threeD.ts';

// Bounding boxes Chromium computes for a 400×300 element centred in a 1000×600 parent with
// `perspective: p` and `transform: translate(-50%,-50%) rotateX() rotateY() rotateZ() scale()`.
const cases = [
  [[18, 0, 0, 1200, 0.9], [313.52, 175.92, 686.48, 433.02]],
  [[6, -22, 0, 1400, 0.88], [342.63, 156.53, 672.99, 433.24]],
  [[28, -18, 6, 800, 0.8], [336.46, 184.68, 662.99, 415.7]],
  [[-40, 35, -20, 600, 1.1], [201.33, 31.48, 668.65, 503.96]],
];

test('projection matches CSS 3D transforms (Chromium)', () => {
  for (const [[rotateX, rotateY, rotateZ, perspective, scale], box] of cases) {
    const pts = [[-200, -150], [200, -150], [200, 150], [-200, 150]]
      .map(([u, v]) => projectPoint({ rotateX, rotateY, rotateZ, perspective, scale }, u, v, { x: 500, y: 300 }, { x: 500, y: 300 }));
    const mine = [Math.min(...pts.map(p => p.x)), Math.min(...pts.map(p => p.y)), Math.max(...pts.map(p => p.x)), Math.max(...pts.map(p => p.y))];
    mine.forEach((v, i) => assert.ok(Math.abs(v - box[i]) < 0.01, `${v} vs ${box[i]}`));
  }
});

test('3D keyframes ease in and out with smootherstep', () => {
  const settings = { enabled: true, transitionDuration: 800 };
  const k = [{ id: 'a', startTime: 1000, endTime: 3000, rotateX: 20, rotateY: -10, rotateZ: 0, perspective: 1000, scale: 0.8 }];
  assert.equal(threeDAt(k, 100, settings), null);
  assert.deepEqual(threeDAt(k, 600, settings), { rotateX: 10, rotateY: -5, rotateZ: 0, perspective: 1100, scale: 0.9 });
  assert.equal(threeDAt(k, 2000, settings).rotateX, 20);
  assert.equal(threeDAt(k, 3400, settings).rotateX, 10);
  assert.equal(threeDAt([{ ...k[0], endTime: -1 }], 2000, settings), null);
  assert.equal(threeDAt(k, 2000, { ...settings, enabled: false }), null);
});
