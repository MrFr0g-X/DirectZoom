// Offline captions with whisper.cpp (engine install / model download /
// transcription). The CPU build and a model are downloaded on request into the user's
// profile and verified against pinned SHA-256 digests; nothing is bundled with the app.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { background } = require('./priority.cjs');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { app } = require('electron');
const { runFfmpeg } = require('./export.cjs');

const BINARY = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip',
  sha256: '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a',
};
const MODELS = {
  tiny: { file: 'ggml-tiny.bin', size: 77691713, sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21', label: 'Fast (75 MB)' },
  base: { file: 'ggml-base.bin', size: 147951465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', label: 'Balanced (148 MB)' },
  small: { file: 'ggml-small.bin', size: 487601967, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', label: 'Accurate (488 MB)' },
};
const DTW_LEAD = 200;
const modelUrl = file => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`;

const root = () => path.join(app.getPath('userData'), 'whisper');
const binDir = () => path.join(root(), 'bin');
const modelDir = () => path.join(root(), 'models');

/** Finds `pattern` under a verified install folder (see extractVerified); null otherwise. */
async function findVerified(root, pattern) {
  if (!fs.existsSync(path.join(root, '.verified'))) return null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (pattern.test(entry.name) && (await fsp.stat(full)).size > 0) return full;
    }
  }
  return null;
}

const findCli = () => findVerified(binDir(), /^whisper-cli\.exe$/i);

async function status() {
  const cli = await findCli();
  const models = Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label, installed: fs.existsSync(path.join(modelDir(), m.file)) }));
  return { installed: !!cli, models };
}

/** Streams `url` to `file`, reporting progress and checking the SHA-256. */
async function download(url, file, sha256, onProgress) {
  // Abort when no data arrives for a minute (a dead connection would otherwise hang forever).
  const controller = new AbortController();
  let stall = setTimeout(() => controller.abort(), 60000);
  const alive = () => { clearTimeout(stall); stall = setTimeout(() => controller.abort(), 60000); };
  const partial = `${file}.part`;
  let out = null;
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`);
    const total = Number(response.headers.get('content-length')) || 0;
    const hash = crypto.createHash('sha256');
    out = fs.createWriteStream(partial);
    let received = 0;
    for await (const chunk of response.body) {
      alive();
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
      if (total) onProgress(received / total);
    }
    await new Promise((resolve, reject) => out.end(error => (error ? reject(error) : resolve())));
    if (hash.digest('hex') !== sha256) throw new Error('The download was corrupted (checksum mismatch). Please try again.');
  } catch (error) {
    out?.destroy();
    await fsp.rm(partial, { force: true });
    if (controller.signal.aborted) throw new Error('The download stopped responding. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(stall);
  }
  await fsp.rename(partial, file);
}

/** True when `file` exists and has the given SHA-256. */
async function hasDigest(file, sha256) {
  if (!fs.existsSync(file)) return false;
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === sha256;
}

/**
 * Extracts a zip with Windows' bsdtar into a scratch folder, checks every file against the
 * archive listing (an interrupted extraction leaves truncated files), then moves it into place
 * and marks it verified.
 */
async function extractVerified(zip, dest) {
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const run = args => new Promise((resolve, reject) =>
    execFile(tar, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout))));
  const expected = new Map();
  for (const line of String(await run(['-tvf', zip])).split(/\r?\n/)) {
    // "-rw-rw-r--  0 0      0      407040 Nov 14  2023 piper/piper.exe"
    const m = /^-\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\w{3}\s+\d+\s+[\d:]+\s+(.+)$/.exec(line.trim());
    if (m) expected.set(m[2], Number(m[1]));
  }
  if (!expected.size) throw new Error('The downloaded archive is empty');
  const scratch = `${dest}.partial`;
  await fsp.rm(scratch, { recursive: true, force: true });
  await fsp.mkdir(scratch, { recursive: true });
  await run(['-xf', zip, '-C', scratch]);
  for (const [name, size] of expected) {
    const stat = await fsp.stat(path.join(scratch, name)).catch(() => null);
    if (!stat || stat.size !== size) throw new Error(`Installing failed: ${name} was not extracted completely. Please try again.`);
  }
  await fsp.writeFile(path.join(scratch, '.verified'), new Date().toISOString());
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.rename(scratch, dest);
}

/** Installs whisper.cpp (if needed) and the model. */
async function install(model, onProgress) {
  const m = Object.hasOwn(MODELS, model) ? MODELS[model] : null;
  if (!m) throw new Error('Unknown model');
  await fsp.mkdir(binDir(), { recursive: true });
  await fsp.mkdir(modelDir(), { recursive: true });
  if (!(await findCli())) {
    onProgress({ stage: 'Downloading Whisper', progress: 0 });
    const zip = path.join(root(), 'whisper-bin-x64.zip');
    if (!(await hasDigest(zip, BINARY.sha256))) await download(BINARY.url, zip, BINARY.sha256, p => onProgress({ stage: 'Downloading Whisper', progress: p }));
    onProgress({ stage: 'Installing Whisper', progress: 1 });
    await extractVerified(zip, binDir());
    await fsp.rm(zip, { force: true });
    if (!(await findCli())) throw new Error('Whisper could not be installed');
  }
  const target = path.join(modelDir(), m.file);
  if (!fs.existsSync(target)) await download(modelUrl(m.file), target, m.sha256, p => onProgress({ stage: 'Downloading model', progress: p }));
  return status();
}

async function removeModel(model) {
  const m = Object.hasOwn(MODELS, model) ? MODELS[model] : null;
  if (m) await fsp.rm(path.join(modelDir(), m.file), { force: true });
  return status();
}

/**
 * Word-level transcription. `input` is any audio file; returns words in ms.
 * whisper-cli: full JSON with DTW token timestamps (needs flash attention off), tokens grouped
 * into words; a word ends where the next one starts (or at its segment end).
 */
async function transcribe(input, { model = 'base', language } = {}, onProgress = () => {}) {
  const cli = await findCli();
  const m = Object.hasOwn(MODELS, model) ? MODELS[model] : null;
  if (!cli || !m || !fs.existsSync(path.join(modelDir(), m.file))) throw new Error('Install the offline captions engine first');
  const work = await fsp.mkdtemp(path.join(app.getPath('temp'), 'dz-whisper-'));
  try {
    const wav = path.join(work, 'audio.wav');
    await runFfmpeg(['-i', input, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], 0);
    const outBase = path.join(work, 'out');
    const threads = Math.max(2, Math.min(8, require('node:os').cpus().length - 1));
    const args = ['-m', path.join(modelDir(), m.file), '-f', wav, '-l', language || 'auto', '-ojf', '-of', outBase, '-t', String(threads), '-pp', '-dtw', model, '-nfa'];
    await new Promise((resolve, reject) => {
      const child = background(spawn(cli, args, { cwd: path.dirname(cli), windowsHide: true }));
      let log = '';
      const read = chunk => {
        const text = chunk.toString();
        log = (log + text).slice(-4000);
        const match = /progress\s*=\s*(\d+)%/.exec(text);
        if (match) onProgress(Number(match[1]) / 100);
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.on('error', reject);
      child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`Whisper failed (${code}): ${log.split('\n').slice(-3).join(' ')}`))));
    });
    const result = JSON.parse(await fsp.readFile(`${outBase}.json`, 'utf8'));
    const words = parseWords(result);
    return { language: result.result?.language ?? language ?? null, text: words.map(w => w.text).join(' '), words };
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** Words (ms) from whisper-cli full JSON output with DTW token timestamps. */
function parseWords(result) {
    const words = [];
    for (const segment of result.transcription ?? []) {
      const segmentEnd = segment.offsets?.to ?? 0;
      const first = words.length;
      for (const token of segment.tokens ?? []) {
        const raw = String(token.text ?? '');
        if (!raw.trim() || /^\[_.*\]$/.test(raw.trim())) continue; // [_BEG_], [_TT_…] etc.
        // DTW times land late in the token; 200 ms earlier matched ElevenLabs Scribe word starts
        // best (mean error 90 ms on a test clip). Starts never go backwards.
        const previous = words.length ? words[words.length - 1].startMs : 0;
        const at = Math.max(previous, token.t_dtw >= 0 ? Math.max(0, token.t_dtw * 10 - DTW_LEAD) : token.offsets?.from ?? 0);
        const last = words[words.length - 1];
        // A leading space starts a new word; anything else continues the current one.
        if (!last || words.length === first || /^\s/.test(raw)) words.push({ text: raw.trim(), startMs: at, endMs: segmentEnd, confidence: token.p ?? 1 });
        else last.text += raw.trim();
      }
      for (let i = first; i < words.length; i++) words[i].endMs = i + 1 < words.length ? Math.max(words[i].startMs + 40, words[i + 1].startMs) : Math.max(words[i].startMs + 120, segmentEnd);
    }
    // Drop bracketed non-speech markers ([BLANK_AUDIO], (music)…).
    for (let i = words.length - 1; i >= 0; i--) if (/^[[(].*[\])]$/.test(words[i].text)) words.splice(i, 1);
    return words;
}

module.exports = { status, install, removeModel, transcribe, parseWords, download, extractVerified, findVerified, hasDigest, MODELS };
