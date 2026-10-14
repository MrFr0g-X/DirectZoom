import test from 'node:test';
import assert from 'node:assert/strict';
import { audioPieces, moveSegment, onTimeline, removeSegment, removedRanges, segmentsOf, splitTrack, trackOn, trackSource } from '../src/trackSegments.ts';

test('a moved piece plays its own recording at the new time and cannot overlap neighbours', () => {
  let mic = splitTrack(undefined, 30000, 10000);
  mic = splitTrack(mic, 30000, 20000);          // [0,10) [10,20) [20,30)
  mic = removeSegment(mic, 30000, mic[0].id);   // free space before the middle piece
  const middle = mic[1].id;
  mic = moveSegment(mic, 30000, middle, -4000); // middle now plays at [6,16)
  assert.equal(trackSource(mic, 6000), 10000);
  assert.equal(trackSource(mic, 15999), 19999);
  assert.equal(trackSource(mic, 17000), null);  // the gap it left behind is silent
  assert.equal(trackSource(mic, 21000), 21000);
  mic = moveSegment(mic, 30000, middle, 9000);  // would overlap [20,30): clamped to end at 20
  assert.equal(mic[1].offset, 0);
  mic = moveSegment(mic, 30000, middle, -50000); // clamped at 0 (the removed piece does not block)
  assert.equal(mic[1].offset, -10000);
  // splitting a moved piece keeps its offset
  const split = splitTrack(mic, 30000, 5000);
  assert.equal(split.length, 4);
  assert.equal(trackSource(split, 4000), 14000);
  assert.equal(trackSource(split, 6000), 16000);
});

test('export pieces carry the recording range, output start and clip speed', () => {
  const clips = [{ id: 'a', sourceStart: 0, sourceEnd: 10000, speed: 2, timelineStart: 0 }];
  assert.equal(audioPieces(undefined, clips), null);
  const mic = [{ id: 'x', start: 2000, end: 6000, enabled: true, offset: 2000 }];
  assert.deepEqual(audioPieces(mic, clips), [{ sourceStart: 2000, sourceEnd: 6000, outputStart: 2000, speed: 2 }]);
});

const clips = [
  { id: 'a', sourceStart: 0, sourceEnd: 10000, speed: 1, timelineStart: 0 },
  { id: 'b', sourceStart: 15000, sourceEnd: 25000, speed: 1, timelineStart: 10000 },
];

test('an unsplit track is one enabled segment over the recording', () => {
  assert.deepEqual(segmentsOf(undefined, 30000), [{ id: 'all', start: 0, end: 30000, enabled: true }]);
  assert.equal(trackOn(undefined, 12345), true);
});

test('splitting and removing affects only that piece', () => {
  let mic = splitTrack(undefined, 30000, 4000);
  mic = splitTrack(mic, 30000, 6000);
  assert.deepEqual(mic.map(s => [s.start, s.end]), [[0, 4000], [4000, 6000], [6000, 30000]]);
  mic = removeSegment(mic, 30000, mic[1].id);
  assert.equal(trackOn(mic, 3000), true);
  assert.equal(trackOn(mic, 5000), false);
  assert.equal(trackOn(mic, 7000), true);
  // splitting within 50 ms of an edge does nothing
  assert.equal(splitTrack(mic, 30000, 4020).length, 3);
});

test('removed source ranges map onto the timeline through the screen cuts', () => {
  assert.deepEqual(onTimeline(8000, 18000, clips), [{ start: 8000, end: 10000 }, { start: 10000, end: 13000 }]);
  assert.deepEqual(onTimeline(11000, 14000, clips), []); // cut out of the video
  const mic = [{ id: 'x', start: 0, end: 8000, enabled: true }, { id: 'y', start: 8000, end: 18000, enabled: false }, { id: 'z', start: 18000, end: 30000, enabled: true }];
  assert.deepEqual(removedRanges(mic, clips), [{ start: 8000, end: 10000 }, { start: 10000, end: 13000 }]);
});
