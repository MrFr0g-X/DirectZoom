// Speech cleanup (level normalisation / noise removal /
// filler-word removal / voice replacement). Produces a processed copy of the speech
// track with exactly the original length, so it stays in sync with the video.
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runFfmpeg, probeDuration } = require('./export.cjs');
const ai = require('./ai.cjs');

const CHUNK_SECONDS = 120;

/** True when the loudest sample is below -45 dBFS. */
function isSilent(file) {
  return new Promise(resolve => {
    const { spawn } = require('node:child_process');
    const { ffmpegPath } = require('./projects.cjs');
    const child = spawn(ffmpegPath(), ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { windowsHide: true });
    let log = '';
    child.stderr.on('data', d => { log += d; });
    child.on('exit', () => { const m = /max_volume: (-?[\d.]+|-inf) dB/.exec(log); resolve(!m || m[1] === '-inf' || Number(m[1]) < -45); });
    child.on('error', () => resolve(false));
  });
}

/** Splits `input` into ≤ 2 minute MP3 chunks, maps each through `convert`, and joins them. */
async function chunked(input, durationMs, root, convert) {
  const work = await fsp.mkdtemp(path.join(root, 'stage-'));
  const parts = [];
  for (let start = 0, i = 0; start < durationMs / 1000; start += CHUNK_SECONDS, i++) {
    const part = path.join(work, `part-${i}.mp3`), out = path.join(work, `out-${i}.mp3`);
    await runFfmpeg(['-ss', String(start), '-t', String(CHUNK_SECONDS), '-i', input, '-ac', '1', '-ar', '44100', '-b:a', '128k', part], 0);
    try {
      await convert(part, out);
    } catch (error) {
      // Silent stretches (e.g. before the first word) can be rejected; keep them as they are.
      if (!(await isSilent(part))) throw error;
      await fsp.copyFile(part, out);
    }
    // Each converted chunk is forced back to the chunk's original length.
    const fixed = path.join(work, `fix-${i}.wav`);
    const length = Math.min(CHUNK_SECONDS, durationMs / 1000 - start);
    await runFfmpeg(['-i', out, '-af', `apad=whole_dur=${length.toFixed(3)}`, '-t', length.toFixed(3), '-ar', '48000', '-ac', '1', fixed], 0);
    parts.push(fixed);
  }
  const list = path.join(work, 'parts.txt');
  await fsp.writeFile(list, parts.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const joined = path.join(work, 'joined.wav');
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined], 0);
  return joined;
}

/**
 * @param {string} input   source WAV (mic.wav or audio.wav)
 * @param {string} output  processed WAV
 * @param {{ normalize?: boolean, denoise?: 'off'|'local'|'ai', fillers?: {start:number,end:number}[], voiceId?: string|null }} options
 */
async function processSpeech(input, output, options, onStage = () => {}) {
  const durationMs = await probeDuration(input);
  if (!durationMs) throw new Error('Could not read the speech track');
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'dz-speech-'));
  try {
    let current = input;
    if (options.voiceId) {
      onStage('Replacing voice');
      current = await chunked(current, durationMs, work, (part, out) => ai.revoice(part, options.voiceId, out));
    }
    if (options.denoise === 'ai') {
      onStage('Removing background noise');
      current = await chunked(current, durationMs, work, (part, out) => ai.isolate(part, out));
    }
    onStage('Finishing');
    const filters = [];
    if (options.denoise === 'local') filters.push('highpass=f=80', 'afftdn=nr=24:nf=-35:tn=1');
    // enable= is evaluated per audio frame: use small frames so mutes start on time.
    if (options.fillers?.length) filters.push('asetnsamples=n=128:p=0');
    for (const f of options.fillers ?? []) {
      if (f.end > f.start) filters.push(`volume=enable='between(t,${(f.start / 1000).toFixed(3)},${(f.end / 1000).toFixed(3)})':volume=0`);
    }
    if (options.normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
    const seconds = (durationMs / 1000).toFixed(3);
    filters.push(`apad=whole_dur=${seconds}`);
    await runFfmpeg(['-i', current, '-af', filters.join(','), '-t', seconds, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output], durationMs / 1000);
    return { durationMs: await probeDuration(output) };
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { processSpeech };
