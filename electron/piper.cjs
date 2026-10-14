// Offline voiceover with Piper. The Windows build and
// voices are downloaded on request into the user's profile and checked against pinned SHA-256
// digests. Piper reads the script on stdin and writes a WAV file.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { background } = require('./priority.cjs');
const { spawn } = require('node:child_process');
const { app } = require('electron');
const { download, extractVerified, findVerified, hasDigest } = require('./whisper.cjs');

const BINARY = {
  url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
  sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
};
const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
const VOICES = {
  'en_US-lessac-medium': { name: 'Lessac (US, female)', dir: 'en/en_US/lessac/medium', onnx: '5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f', json: 'efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0' },
  'en_US-ryan-medium': { name: 'Ryan (US, male)', dir: 'en/en_US/ryan/medium', onnx: 'abf4c274862564ed647ba0d2c47f8ee7c9b717d27bdad9219100eb310db4047a', json: '44034c056cb15681b2ad494307c7f3f2e4499d1253c700c711fa0a4607ffe78d' },
  'en_GB-alan-medium': { name: 'Alan (UK, male)', dir: 'en/en_GB/alan/medium', onnx: '0a309668932205e762801f1efc2736cd4b0120329622adf62be09e56339d3330', json: 'c0f0d124e5895c00e7c03b35dcc8287f319a6998a365b182deb5c8e752ee8c1e' },
};

const root = () => path.join(app.getPath('userData'), 'piper');
const voiceDir = () => path.join(root(), 'voices');

const findExe = () => findVerified(path.join(root(), 'bin'), /^piper\.exe$/i);

const voiceFile = id => path.join(voiceDir(), `${id}.onnx`);

async function status() {
  return {
    installed: !!(await findExe()),
    voices: Object.entries(VOICES).map(([id, v]) => ({ id, name: v.name, installed: fs.existsSync(voiceFile(id)) && fs.existsSync(`${voiceFile(id)}.json`) })),
  };
}

async function install(voice, onProgress) {
  const v = Object.hasOwn(VOICES, voice) ? VOICES[voice] : null;
  if (!v) throw new Error('Unknown voice');
  await fsp.mkdir(voiceDir(), { recursive: true });
  if (!(await findExe())) {
    const zip = path.join(root(), 'piper.zip');
    // Reuse a complete, verified archive left by an interrupted install.
    if (!(await hasDigest(zip, BINARY.sha256))) await download(BINARY.url, zip, BINARY.sha256, p => onProgress({ stage: 'Downloading Piper', progress: p }));
    onProgress({ stage: 'Installing Piper', progress: 1 });
    await extractVerified(zip, path.join(root(), 'bin'));
    await fsp.rm(zip, { force: true });
    if (!(await findExe())) throw new Error('Piper could not be installed');
  }
  const base = `${VOICE_BASE}/${v.dir}/${voice}.onnx`;
  if (!fs.existsSync(`${voiceFile(voice)}.json`)) await download(`${base}.json`, `${voiceFile(voice)}.json`, v.json, () => {});
  if (!fs.existsSync(voiceFile(voice))) await download(base, voiceFile(voice), v.onnx, p => onProgress({ stage: 'Downloading voice', progress: p }));
  return status();
}

/** Speaks `text` into `output` (WAV). `speed` > 1 talks faster. */
async function speak(text, voice, output, speed = 1) {
  const exe = await findExe();
  if (!exe || !fs.existsSync(voiceFile(voice))) throw new Error('Download the offline voice first');
  await new Promise((resolve, reject) => {
    const child = background(spawn(exe, ['--model', voiceFile(voice), '--output_file', output, '--length_scale', (1 / Math.max(0.5, Math.min(2, speed))).toFixed(3)], { cwd: path.dirname(exe), windowsHide: true }));
    let log = '';
    child.stderr.on('data', chunk => { log = (log + chunk).slice(-2000); });
    child.on('error', reject);
    child.on('exit', code => (code === 0 && fs.existsSync(output) ? resolve() : reject(new Error(`Piper failed (${code}): ${log.split('\n').slice(-2).join(' ')}`))));
    child.stdin.end(text.replace(/\s*\n\s*/g, ' '));
  });
}

module.exports = { status, install, speak, VOICES };
