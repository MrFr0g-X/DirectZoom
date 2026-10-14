import test from 'node:test';
import assert from 'node:assert/strict';
import { clipAt, mapRanges, segments, setClipSpeed, sourceToTimeline, splitAt, timelineToSource, totalDuration } from '../src/timeline.ts';

const base = [{ id: 'a', sourceStart: 0, sourceEnd: 10000, speed: 1, timelineStart: 0 }];

test('speeding up a clip shortens the timeline and keeps later clips back to back', () => {
  const split = splitAt(base, 4000);
  const fast = setClipSpeed(split, split[0].id, 2);
  assert.equal(totalDuration(fast), 2000 + 6000);
  assert.equal(fast[1].timelineStart, 2000);
  assert.equal(clipAt(1000, fast).id, split[0].id);
  assert.equal(clipAt(2500, fast).id, split[1].id);
});

test('timeline and source time round-trip through a sped-up clip', () => {
  const clips = setClipSpeed(splitAt(base, 4000), splitAt(base, 4000)[0].id, 2);
  for (const source of [0, 1000, 3999, 4000, 7000, 9999]) {
    const t = sourceToTimeline(source, clips);
    assert.ok(Math.abs(timelineToSource(t, clips) - source) < 1e-6, `source ${source}`);
  }
  assert.equal(timelineToSource(1000, clips), 2000);
});

test('source ranges (zooms, blurs) are compressed by clip speed', () => {
  const clips = setClipSpeed(base, 'a', 0.5);
  const [zoom] = mapRanges([{ id: 'z', start: 2000, end: 4000 }], clips);
  assert.deepEqual([zoom.start, zoom.end], [4000, 8000]);
  assert.deepEqual(segments(clips), [{ start: 0, end: 10000, speed: 0.5 }]);
});

test('moving a clip reorders the timeline and keeps clips back to back', async () => {
  const { moveClip } = await import('../src/timeline.ts');
  const clips = splitAt(splitAt(base, 3000), 6000); // [0,3) [3,6) [6,10)
  const moved = moveClip(clips, clips[2].id, 0);
  assert.deepEqual(moved.map(c => [c.sourceStart, c.sourceEnd, c.timelineStart]), [[6000, 10000, 0], [0, 3000, 4000], [3000, 6000, 7000]]);
  assert.equal(totalDuration(moved), 10000);
  assert.equal(timelineToSource(500, moved), 6500);
});
