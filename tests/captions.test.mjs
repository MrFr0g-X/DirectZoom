import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { captionWords, groupWords, mapCaptions, retext, spreadWords, toSrt } from '../src/captions.ts';
import { duckGain, duckIntervals } from '../src/audioMix.ts';

const require = createRequire(import.meta.url);
const w = (text, startMs, endMs) => ({ text, startMs, endMs, confidence: 1 });

test('words group into captions at pauses, sentence ends and the word budget', () => {
  const words = [w('Hello', 0, 300), w('there.', 320, 600), w('This', 650, 800), w('is', 820, 900), w('a', 910, 950), w('demo.', 960, 1300),
    w('After', 2500, 2700), w('a', 2710, 2750), w('pause', 2760, 3000)];
  const captions = groupWords(words, { maxWordsPerLine: 7, maxLines: 2 });
  // "Hello there." has < 3 words so it continues; "demo." ends a sentence; 1.2 s pause splits.
  assert.deepEqual(captions.map(c => c.text), ['Hello there. This is a demo.', 'After a pause']);
  assert.deepEqual([captions[1].startMs, captions[1].endMs], [2500, 3000]);
  const many = Array.from({ length: 20 }, (_, i) => w(`w${i}`, i * 100, i * 100 + 80));
  assert.deepEqual(groupWords(many, { maxWordsPerLine: 3, maxLines: 2 }).map(c => c.words.length), [6, 6, 6, 2]);
});

test('captionWords clamps word times into the caption and falls back to an even spread', () => {
  const words = captionWords({ id: 'c', text: 'a b', startMs: 1000, endMs: 2000, words: [w('a', 900, 1500), w('b', 1500, 2600)] });
  assert.deepEqual(words.map(x => [x.startMs, x.endMs]), [[1000, 1500], [1500, 2000]]);
  assert.deepEqual(spreadWords(['x', 'y', 'z'], 0, 900).map(x => [x.startMs, x.endMs]), [[0, 300], [300, 600], [600, 900]]);
  assert.deepEqual(captionWords({ id: 'c', text: 'one two', startMs: 0, endMs: 100 }).map(x => [x.startMs, x.endMs]), [[0, 90], [90, 180]]);
  const edited = retext({ id: 'c', text: 'old', startMs: 0, endMs: 1000, words: [w('old', 0, 1000)] }, '  new   text ');
  assert.equal(edited.text, 'new text');
  assert.deepEqual(edited.words.map(x => x.startMs), [0, 500]);
});

test('transcribed captions map through cuts and speed; voiceover captions stay on the timeline', () => {
  const caption = { id: 'c', text: 'one two three four', startMs: 1000, endMs: 5000, words: [w('one', 1000, 1900), w('two', 2000, 2900), w('three', 3000, 3900), w('four', 4000, 5000)] };
  const voice = { id: 'v', text: 'hi', startMs: 100, endMs: 400, source: 'voiceover' };
  const clips = [{ id: 'a', sourceStart: 0, sourceEnd: 2950, speed: 1, timelineStart: 0 }, { id: 'b', sourceStart: 3950, sourceEnd: 6000, speed: 2, timelineStart: 2950 }];
  const mapped = mapCaptions([caption, voice], clips);
  assert.deepEqual(mapped.map(c => c.text), ['hi', 'one two', 'four']);
  const four = mapped.find(c => c.text === 'four');
  assert.deepEqual([four.words[0].startMs, four.words[0].endMs], [2975, 3475]);
});

test('SRT export', () => {
  assert.equal(toSrt([{ id: 'a', text: 'Hi there', startMs: 1500, endMs: 3723004 }]), '1\n00:00:01,500 --> 01:02:03,004\nHi there\n');
});

test('music ducking merges speech closer than 500 ms and ramps over 100 ms', () => {
  const intervals = duckIntervals([{ id: 'a', text: 'x', startMs: 1000, endMs: 2000 }, { id: 'b', text: 'y', startMs: 2300, endMs: 3000 }],
    [{ id: 'v', startTimeMs: 5000, trimStartMs: 0, trimEndMs: 1000, durationMs: 1000, volume: 1 }]);
  assert.deepEqual(intervals, [{ start: 1000, end: 3000 }, { start: 5000, end: 6000 }]);
  assert.equal(duckGain(intervals, 500, 0.3), 1);
  assert.equal(duckGain(intervals, 1500, 0.3), 0.3);
  assert.ok(Math.abs(duckGain(intervals, 950, 0.3) - 0.65) < 1e-9);
  assert.equal(duckGain(intervals, 3100, 0.3), 1);
});

test('export duck expression and TTS alignment parsing', () => {
  const { duckExpression } = require('../electron/export.cjs');
  assert.equal(duckExpression(0.2, null), '0.2000');
  assert.match(duckExpression(0.2, { amount: 0.3, intervals: [{ start: 1000, end: 2000 }] }), /^0\.2000\*\(0\.3000\+0\.7000\*clip\(\(max\(max\(1\.000-t,t-2\.000\),0\)\)\/0\.1,0,1\)\)$/);
  const { alignmentToWords } = require('../electron/ai.cjs');
  const words = alignmentToWords({ characters: [...'Hi you'], character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5], character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] });
  assert.deepEqual(words.map(x => [x.text, x.startMs, x.endMs]), [['Hi', 0, 200], ['you', 300, 600]]);
});

test('filler words: widened ranges that stop at neighbouring words; timeline cut', async () => {
  const { fillerRanges } = await import('../src/captions.ts');
  const { cutRanges, totalDuration } = await import('../src/timeline.ts');
  const caption = { id: 'c', text: 'So um this, uh, works', startMs: 1000, endMs: 3000, source: 'transcription',
    words: [w('So', 1000, 1200), w('um', 1300, 1400), w('this,', 1450, 1700), w('uh,', 2100, 2200), w('works', 2250, 3000)] };
  assert.deepEqual(fillerRanges([caption]), [{ start: 1200, end: 1450 }, { start: 1980, end: 2250 }]);
  const clips = cutRanges([{ id: 'a', sourceStart: 0, sourceEnd: 4000, speed: 1, timelineStart: 0 }], fillerRanges([caption]));
  assert.deepEqual(clips.map(c => [c.sourceStart, c.sourceEnd]), [[0, 1200], [1450, 1980], [2250, 4000]]);
  assert.equal(totalDuration(clips), 4000 - 250 - 270);
});

test('SRT and WebVTT import', async () => {
  const { parseSubtitles, mapCaptions } = await import('../src/captions.ts');
  const srt = '﻿1\r\n00:00:01,500 --> 00:00:03,000\r\n<i>Hello</i> there\r\n\r\n2\r\n00:01:02,000 --> 00:01:04,250\r\nSecond\r\nline\r\n';
  assert.deepEqual(parseSubtitles(srt).map(c => [c.text, c.startMs, c.endMs, c.source]), [['Hello there', 1500, 3000, 'manual'], ['Second line', 62000, 64250, 'manual']]);
  const vtt = 'WEBVTT\n\nNOTE skip\n\n00:05.000 --> 00:06.500 align:start\nShort stamp\n\nbad --> cue\nignored\n';
  assert.deepEqual(parseSubtitles(vtt).map(c => [c.text, c.startMs, c.endMs]), [['Short stamp', 5000, 6500]]);
  // Imported captions are already on the timeline: cuts do not move them.
  const clips = [{ id: 'a', sourceStart: 10000, sourceEnd: 20000, speed: 1, timelineStart: 0 }];
  assert.equal(mapCaptions(parseSubtitles(srt), clips)[0].startMs, 1500);
});
