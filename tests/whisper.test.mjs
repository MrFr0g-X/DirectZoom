import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseWords } = require('../electron/whisper.cjs');

// Real whisper.cpp (tiny, -ojf -dtw tiny -nfa) output for a 7.7 s clip whose words ElevenLabs
// Scribe timed at: so 2100, this 2260, quick 2660, with 4480, some 4660, background 4820.
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/whisper-dtw.json', import.meta.url), 'utf8'));

test('whisper tokens become words with DTW start times near the reference', () => {
  const words = parseWords(fixture);
  assert.equal(words.map(w => w.text).join(' '), 'So this is a quick test of the speech cleanup with some background noise.');
  for (let i = 1; i < words.length; i++) assert.ok(words[i].startMs >= words[i - 1].startMs && words[i].endMs > words[i].startMs);
  const ref = { this: 2260, quick: 2660, with: 4480, some: 4660, background: 4820 };
  for (const w of words) if (ref[w.text] !== undefined) assert.ok(Math.abs(w.startMs - ref[w.text]) <= 160, `${w.text} ${w.startMs}`);
});
