import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clickCandidates, generateZooms, slowdownCandidates, zoomAt } from '../src/zoom.ts';

const settings = { autoZoom: true, zoomScale: 1.5, transitionMs: 600, zoomOnClicks: true, zoomOnSlowdown: true };

test('nearby clicks become one focus point and one zoom region', () => {
  const events = [
    { t: 1000, x: 0.2, y: 0.3, event: 'click', visible: true },
    { t: 2000, x: 0.4, y: 0.5, event: 'click', visible: true },
  ];
  assert.deepEqual(clickCandidates(events), [{ time: 1500, x: 0.30000000000000004, y: 0.4, clusterDuration: 1000 }]);
  const zooms = generateZooms(events, settings, 10000);
  assert.equal(zooms.length, 1);
  assert.equal(zooms[0].start, 0);
  assert.equal(zooms[0].end, 3500);
  assert.equal(zoomAt(0, zooms, 600).scale, 1);
  assert.equal(zoomAt(1500, zooms, 600).scale, 1.5);
  assert.equal(zoomAt(3500, zooms, 600).scale, 1);
});

test('slow movement becomes a candidate only when faster movement follows it', () => {
  const events = [];
  for (let i = 0; i < 6; i++) events.push({ t: i * 50, x: i * 0.08, y: 0.5, event: 'move', visible: true });
  for (let i = 1; i <= 8; i++) events.push({ t: 250 + i * 50, x: 0.4 + i * 0.0002, y: 0.5, event: 'move', visible: true });
  assert.equal(slowdownCandidates(events).length, 0);
  for (let i = 1; i <= 4; i++) events.push({ t: 650 + i * 50, x: 0.4016 + i * 0.08, y: 0.5, event: 'move', visible: true });
  assert.equal(slowdownCandidates(events).length, 1);
});

test('zoom regions for recorded cursor tracks match the reference', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/zoom-reference.json', import.meta.url), 'utf8'));
  let regions = 0;
  for (const { events, duration, expected } of fixture.cases) {
    const actual = generateZooms(events, settings, duration).map(({ start, end, scale, focus }) => ({ start, end, scale, focus }));
    assert.deepEqual(actual, expected);
    regions += expected.length;
  }
  assert.ok(regions > fixture.cases.length, 'fixture exercises multiple regions per trace');
});
