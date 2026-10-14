import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bounceScale, cursorFrame, idleState, prepareCursor, shrinkScale } from '../src/cursor-motion.ts';

test('cursor position, type and idle state match the reference', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/cursor-reference.json', import.meta.url), 'utf8'));
  const prepared = new Map();
  for (const { settings, time, expected } of fixture.cases) {
    const key = JSON.stringify(settings);
    if (!prepared.has(key)) prepared.set(key, prepareCursor(fixture.cursor, settings));
    const p = prepared.get(key);
    const f = cursorFrame(p, settings, time);
    const actual = f && {
      x: f.x, y: f.y, inside: f.insideCapturedArea, type: f.cursorType, opacity: f.opacity,
      idleScale: idleState(p.moves, time, !!settings.hideWhenIdle, settings.idleHideDelayMs ?? 1000).scale,
      bounce: settings.clickEffect === 'bounce' && settings.highlightClicks ? bounceScale(-1, 300) : 1,
    };
    assert.deepEqual(actual, expected, `t=${time}`);
  }
});

test('bounce and shrink keyframes', () => {
  assert.equal(bounceScale(60, 300), 1.3);
  assert.equal(bounceScale(150, 300), 0.9);
  assert.equal(bounceScale(301, 300), 1);
  const events = [{ t: 0, x: 0, y: 0, event: 'down', visible: true }, { t: 200, x: 0, y: 0, event: 'up', visible: true }];
  assert.equal(shrinkScale(events, 100, true, 0.8), 0.8);
  assert.equal(shrinkScale(events, 400, true, 0.8), 1);
});
