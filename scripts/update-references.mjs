// Regenerates the regression references in tests/fixtures from DirectZoom's current zoom
// generator, camera and cursor motion. Run it only after an intentional behaviour change:
//   node scripts/update-references.mjs
// The inputs (recorded cursor tracks, zoom regions, settings) stay as they are; only the
// expected outputs are recomputed.
import { readFileSync, writeFileSync } from 'node:fs';
import { generateZooms } from '../src/zoom.ts';
import { cameraAt } from '../src/camera.ts';
import { bounceScale, cursorFrame, idleState, prepareCursor } from '../src/cursor-motion.ts';

const file = name => new URL(`../tests/fixtures/${name}`, import.meta.url);
const read = name => JSON.parse(readFileSync(file(name), 'utf8'));
const write = (name, data) => { writeFileSync(file(name), `${JSON.stringify(data)}\n`); console.log(`wrote tests/fixtures/${name}`); };

const zoomSettings = { autoZoom: true, zoomScale: 1.5, transitionMs: 600, zoomOnClicks: true, zoomOnSlowdown: true };
const zoom = read('zoom-reference.json');
write('zoom-reference.json', {
  description: 'Automatic zoom regions for recorded cursor tracks (DirectZoom regression reference).',
  cases: zoom.cases.map(({ events, duration }) => ({
    events, duration,
    expected: generateZooms(events, zoomSettings, duration).map(({ start, end, scale, focus }) => ({ start, end, scale, focus })),
  })),
});

const camera = read('camera-reference.json');
write('camera-reference.json', {
  description: 'Zoom camera state per frame for a recorded cursor track (DirectZoom regression reference).',
  zooms: camera.zooms, cursor: camera.cursor,
  cases: camera.cases.map(({ settings, frame, time }) => {
    const s = cameraAt(camera.zooms, settings, camera.cursor, time, 60, frame);
    return { settings, frame, time, expected: { scale: s.scale, focusX: s.focusX, focusY: s.focusY, isZooming: s.isZooming, isFollowingCursor: s.isFollowingCursor, progress: s.progress } };
  }),
});

const cursor = read('cursor-reference.json');
const prepared = new Map();
write('cursor-reference.json', {
  description: 'Cursor position, type, opacity and idle state over time (DirectZoom regression reference).',
  cursor: cursor.cursor,
  cases: cursor.cases.map(({ settings, time }) => {
    const key = JSON.stringify(settings);
    if (!prepared.has(key)) prepared.set(key, prepareCursor(cursor.cursor, settings));
    const p = prepared.get(key);
    const f = cursorFrame(p, settings, time);
    const expected = f && {
      x: f.x, y: f.y, inside: f.insideCapturedArea, type: f.cursorType, opacity: f.opacity,
      idleScale: idleState(p.moves, time, !!settings.hideWhenIdle, settings.idleHideDelayMs ?? 1000).scale,
      bounce: settings.clickEffect === 'bounce' && settings.highlightClicks ? bounceScale(-1, 300) : 1,
    };
    return { settings, time, expected };
  }),
});
