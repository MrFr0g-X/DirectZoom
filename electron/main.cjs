const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, nativeTheme, protocol, screen, session: electronSession, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { listDevices, exportCursors, RecordingSession } = require('./capture.cjs');
const { ProjectStore, ffmpegPath } = require('./projects.cjs');
const { VideoSink, finishExport, removeQuietly, runFfmpeg, probeDuration } = require('./export.cjs');
const ai = require('./ai.cjs');
const { processSpeech } = require('./speech.cjs');
const whisper = require('./whisper.cjs');
const piper = require('./piper.cjs');
const updater = require('./updater.cjs');
const gdrive = require('./gdrive.cjs');
const priority = require('./priority.cjs');
updater.onState(state => send('update:state', state));

// Ignore only console pipe errors (e.g. when launched from a closed terminal).
for (const stream of [process.stdout, process.stderr]) stream?.on?.('error', error => { if (error.code !== 'EPIPE') throw error; });

// Recent errors for "Save diagnostics": failed IPC calls and uncaught exceptions.
const errorLog = [];
const logError = (where, error) => {
  errorLog.push({ at: new Date().toISOString(), where, message: String(error?.message ?? error).slice(0, 500) });
  if (errorLog.length > 200) errorLog.shift();
};
process.on('uncaughtException', error => logError('uncaughtException', error));
process.on('unhandledRejection', error => logError('unhandledRejection', error));
{
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => handle(channel, async (...args) => {
    try { return await listener(...args); } catch (error) { logError(channel, error); throw error; }
  });
}

protocol.registerSchemesAsPrivileged([{ scheme: 'dz-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);

const isDev = !app.isPackaged && process.env.DIRECTZOOM_DEV === '1';
const store = new ProjectStore(path.join(app.getPath('userData'), 'recordings'));
const cursorDir = path.join(app.getPath('userData'), 'system-cursors');
let mainWindow = null;
let barWindow = null;
let session = null;
let sessionInfo = null;

function loadRoute(window, route) {
  if (isDev) return window.loadURL(`http://127.0.0.1:5173/#${route}`);
  return window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: route });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1100, minHeight: 700, frame: false, backgroundColor: '#07080b', title: 'DirectZoom',
    icon: path.join(__dirname, 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.on('closed', () => { mainWindow = null; });
  loadRoute(mainWindow, '/library');
}

function send(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(channel, payload);
}

// ---- Media protocol: dz-media://project/<id>/<file>, dz-media://cursor/<file> ----
const types = { '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };
async function serveFile(file, request) {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) return new Response('not found', { status: 404 });
  const headers = { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' };
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    const stream = fs.createReadStream(file, { start, end });
    return new Response(stream, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': String(end - start + 1) } });
  }
  return new Response(fs.createReadStream(file), { status: 200, headers: { ...headers, 'content-length': String(stat.size) } });
}

function registerProtocol() {
  protocol.handle('dz-media', request => {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (url.host === 'project' && parts.length === 2) return serveFile(store.file(parts[0], parts[1]), request);
      if (url.host === 'cursor' && parts.length === 1 && /^[\w.-]+$/.test(parts[0])) return serveFile(path.join(cursorDir, parts[0]), request);
    } catch {}
    return new Response('not found', { status: 404 });
  });
}

// ---- Devices ----
async function devices() {
  const [native, sources] = await Promise.all([
    listDevices(),
    desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 480, height: 300 }, fetchWindowIcons: true }),
  ]);
  const electronDisplays = screen.getAllDisplays();
  const displays = native.displays.map(display => {
    // Match Electron's display (DIP) to the native one (physical pixels).
    const match = electronDisplays.find(d => {
      const r = screen.dipToScreenRect(null, d.bounds);
      return Math.abs(r.x - display.bounds.x) < 4 && Math.abs(r.y - display.bounds.y) < 4;
    });
    const source = match && sources.find(s => s.id.startsWith('screen:') && String(s.display_id) === String(match.id));
    return { ...display, electronId: match?.id, thumbnail: source?.thumbnail.toDataURL() ?? null };
  });
  const windows = native.windows.filter(w => !w.minimized).map(window => {
    const source = sources.find(s => s.id.startsWith(`window:${window.hwnd}:`));
    return { ...window, thumbnail: source?.thumbnail.toDataURL() ?? null, icon: source?.appIcon?.toDataURL() ?? null };
  });
  return { displays, windows, microphones: native.microphones ?? [] };
}

// ---- Area selection overlay ----
function selectArea(displayIndex, nativeDisplays) {
  return new Promise(resolve => {
    const target = nativeDisplays.find(d => d.index === displayIndex);
    const electronDisplay = screen.getAllDisplays().find(d => {
      const r = screen.dipToScreenRect(null, d.bounds);
      return target && Math.abs(r.x - target.bounds.x) < 4 && Math.abs(r.y - target.bounds.y) < 4;
    }) ?? screen.getPrimaryDisplay();
    const overlay = new BrowserWindow({
      ...electronDisplay.bounds, frame: false, transparent: true, resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true,
      hasShadow: false, fullscreenable: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setContentProtection(true);
    let settled = false;
    const finish = rect => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler('area:done');
      if (!overlay.isDestroyed()) overlay.close();
      if (!rect) return resolve(null);
      // DIP (relative to the overlay) → physical screen pixels.
      const physical = screen.dipToScreenRect(null, { x: electronDisplay.bounds.x + rect.x, y: electronDisplay.bounds.y + rect.y, width: rect.width, height: rect.height });
      resolve({ display: target?.index ?? 1, rect: { x: Math.round(physical.x), y: Math.round(physical.y), width: Math.round(physical.width), height: Math.round(physical.height) } });
    };
    ipcMain.handle('area:done', (_event, rect) => finish(rect));
    overlay.on('closed', () => finish(null));
    loadRoute(overlay, '/area');
  });
}

// ---- Recording ----
function showRecordingBar(bounds) {
  const display = screen.getDisplayMatching(screen.screenToDipRect(null, bounds));
  const width = 340, height = 64;
  barWindow = new BrowserWindow({
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2), y: display.workArea.y + display.workArea.height - height - 24,
    width, height, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, focusable: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  barWindow.setAlwaysOnTop(true, 'screen-saver');
  barWindow.setContentProtection(true); // keep the bar out of the recording
  barWindow.on('closed', () => { barWindow = null; });
  loadRoute(barWindow, '/recording-bar');
}

/** Floating webcam preview while recording; kept out of the capture. */
let cameraWindow = null;
function showCameraPreview(bounds, deviceId) {
  const display = screen.getDisplayMatching(screen.screenToDipRect(null, bounds));
  const size = 168;
  cameraWindow = new BrowserWindow({
    x: display.workArea.x + display.workArea.width - size - 28, y: display.workArea.y + display.workArea.height - size - 104,
    width: size, height: size, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  cameraWindow.setAlwaysOnTop(true, 'screen-saver');
  cameraWindow.setContentProtection(true);
  cameraWindow.on('closed', () => { cameraWindow = null; });
  loadRoute(cameraWindow, `/camera-preview?device=${encodeURIComponent(deviceId ?? '')}`);
}

async function startRecording(_event, options) {
  if (session) throw new Error('A recording is already running');
  const id = store.newId();
  const outputDir = store.dir(id);
  const config = {
    output_dir: outputDir, source: options.source, fps: options.fps ?? 60,
    system_audio: !!options.systemAudio, microphone: !!options.microphone, keyboard: !!options.keyboard,
    microphone_id: options.microphoneId || undefined,
  };
  sessionInfo = { id, sourceName: options.sourceName ?? '', startedAt: Date.now(), createdAt: new Date().toISOString(), expectCamera: !!options.camera };
  sessionInfo.cameraSaved = new Promise(resolve => { sessionInfo.resolveCamera = resolve; });
  mainWindow?.minimize();
  await new Promise(r => setTimeout(r, 250));
  session = new RecordingSession(config);
  // A recorded window was closed: finish and save what was captured.
  session.onSourceClosed = () => { if (session) stopRecording(null, {}).catch(() => {}); };
  try {
    const started = await session.start();
    sessionInfo.startedAt = Date.now();
    showRecordingBar(started.bounds);
    if (options.camera && options.cameraPreview !== false) showCameraPreview(started.bounds, options.cameraDeviceId);
    send('recording:state', { state: 'recording', startedAt: sessionInfo.startedAt });
    return { id, bounds: started.bounds, startedAt: sessionInfo.startedAt };
  } catch (error) {
    session = null;
    mainWindow?.restore();
    await fsp.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function stopRecording(_event, { discard = false } = {}) {
  if (!session) throw new Error('No recording is running');
  const current = session, info = sessionInfo;
  session = null;
  send('recording:state', { state: 'saving' });
  barWindow?.close();
  cameraWindow?.close();
  try {
    const finished = await current.stop();
    if (discard) {
      discardedIds.add(info.id);
      await fsp.rm(store.dir(info.id), { recursive: true, force: true }).catch(() => {});
      mainWindow?.restore();
      send('recording:state', { state: 'idle' });
      return { discarded: true };
    }
    const metadata = await store.finalizeRecording(info.id, {
      name: `Recording ${new Date(info.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`,
      createdAt: info.createdAt, sourceName: info.sourceName,
    });
    // The webcam recording is uploaded by the renderer when it sees the "saving" state.
    if (info.expectCamera) await Promise.race([info.cameraSaved, new Promise(r => setTimeout(r, 15000))]);
    mainWindow?.restore();
    mainWindow?.focus();
    send('recording:state', { state: 'idle' });
    send('recording:finished', { id: info.id, warnings: current.warnings(), closed: finished.closed });
    return { id: info.id, metadata };
  } catch (error) {
    mainWindow?.restore();
    send('recording:state', { state: 'idle' });
    throw error;
  }
}

// ---- Export ----
const exportJobs = new Map();
const discardedIds = new Set();
ipcMain.handle('projects:save-camera', async (_event, id, bytes, offset) => {
  if (discardedIds.has(id)) return false;
  const dir = store.dir(id);
  if (!fs.existsSync(dir)) return false;
  await fsp.writeFile(path.join(dir, 'camera.mp4'), Buffer.from(bytes));
  // Kept separately: the capture helper rewrites metadata.json when it finishes.
  await fsp.writeFile(path.join(dir, 'camera.json'), JSON.stringify({ offset: Math.round(offset) }));
  const metaFile = path.join(dir, 'metadata.json');
  const current = await fsp.readFile(metaFile, 'utf8').then(JSON.parse).catch(() => ({}));
  await fsp.writeFile(metaFile, JSON.stringify({ ...current, hasCamera: true, cameraOffset: Math.round(offset) }));
  if (sessionInfo?.id === id) sessionInfo.resolveCamera?.();
  return true;
});
// Files the renderer may write (export) or upload (Drive): only paths the user picked in the save
// dialog. Unpackaged development runs allow any path so automated checks can export headlessly.
const approvedOutputs = new Set();
const outputAllowed = file => !app.isPackaged || approvedOutputs.has(path.resolve(String(file ?? '')));
const EXPORT_FORMATS = new Set(['mp4', 'webm', 'gif']);

ipcMain.handle('export:choose', async (_event, { name, format }) => {
  if (!EXPORT_FORMATS.has(format)) throw new Error('Unsupported format');
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('videos'), `${String(name).replace(/[\\/:*?"<>|]/g, '-')}.${format}`),
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (result.canceled || !result.filePath) return null;
  approvedOutputs.add(path.resolve(result.filePath));
  return result.filePath;
});
ipcMain.handle('export:begin', async event => {
  // Rendering runs in the window's renderer: keep it below normal priority while exporting.
  priority.lower(event.sender.getOSProcessId());
  const jobId = `job-${Date.now()}`;
  const file = path.join(app.getPath('temp'), `directzoom-${jobId}.mp4`);
  exportJobs.set(jobId, new VideoSink(file));
  return jobId;
});
ipcMain.handle('export:write', (_event, jobId, position, bytes) => { exportJobs.get(jobId)?.write(position, bytes); });
ipcMain.handle('export:cancel', async (event, jobId) => {
  priority.restore(event.sender.getOSProcessId());
  const sink = exportJobs.get(jobId);
  if (!sink) return;
  sink.close();
  exportJobs.delete(jobId);
  await removeQuietly(sink.file);
});
ipcMain.handle('export:finish', async (event, jobId, job) => {
  const sink = exportJobs.get(jobId);
  if (!sink) throw new Error('unknown export job');
  sink.close();
  if (!outputAllowed(job.output) || !EXPORT_FORMATS.has(job.format)) {
    exportJobs.delete(jobId);
    priority.restore(event.sender.getOSProcessId());
    await removeQuietly(sink.file);
    throw new Error('Choose where to save the export first');
  }
  exportJobs.delete(jobId);
  try {
    const audio = [];
    // Cleaned speech replaces the original track; fall back to the original if it is missing.
    const track = (cleaned, original) => (cleaned && fs.existsSync(store.file(job.projectId, cleaned)) ? cleaned : original);
    if (job.systemVolume > 0) audio.push({ path: store.file(job.projectId, track(job.systemFile, 'audio.wav')), volume: job.systemVolume, pieces: job.systemPieces ?? null });
    if (job.micVolume > 0) audio.push({ path: store.file(job.projectId, track(job.micFile, 'mic.wav')), volume: job.micVolume, pieces: job.micPieces ?? null });
    const voiceovers = (job.voiceovers ?? []).map(clip => ({ ...clip, path: store.file(job.projectId, clip.file) }));
    const music = job.music ? { ...job.music, path: store.file(job.projectId, job.music.file) } : null;
    await finishExport({ video: sink.file, output: job.output, format: job.format, audio, voiceovers, music, segments: job.segments, duration: job.duration, gif: job.gif },
      progress => event.sender.send('export:progress', { jobId, progress }));
    return { path: job.output, size: (await fsp.stat(job.output)).size };
  } finally {
    priority.restore(event.sender.getOSProcessId());
    await removeQuietly(sink.file);
  }
});

// ---- AI: captions and voiceover (ElevenLabs) ----
ipcMain.handle('ai:status', () => ai.status());
ipcMain.handle('ai:set-key', (_e, key) => ai.setKey(key));
ipcMain.handle('ai:account', () => ai.account());
ipcMain.handle('captions:transcribe', async (_e, id, options = {}) => {
  const inputs = ['mic.wav', 'audio.wav'].map(file => store.file(id, file)).filter(file => fs.existsSync(file));
  if (!inputs.length) throw new Error('This recording has no audio to transcribe. Record with the microphone or system audio on.');
  const tmp = path.join(app.getPath('temp'), `dz-transcribe-${id}-${Date.now()}.mp3`);
  const args = inputs.flatMap(file => ['-i', file]);
  if (inputs.length > 1) args.push('-filter_complex', `amix=inputs=${inputs.length}:normalize=0:duration=longest`);
  args.push('-ac', '1', '-ar', '16000', '-b:a', '48k', tmp);
  try {
    await runFfmpeg(args, 0);
    if (options.engine === 'local') {
      return await whisper.transcribe(tmp, { model: options.model, language: options.language }, progress => _e.sender.send('captions:progress', { id, progress }));
    }
    return await ai.transcribe(tmp, options);
  } finally {
    await removeQuietly(tmp);
  }
});
ipcMain.handle('whisper:status', () => whisper.status());
ipcMain.handle('whisper:install', (event, model) => whisper.install(model, p => event.sender.send('whisper:progress', p)));
ipcMain.handle('whisper:remove', (_e, model) => whisper.removeModel(model));
ipcMain.handle('voiceover:voices', () => ai.voices());
ipcMain.handle('voiceover:generate', async (_e, id, options) => {
  const script = String(options?.script ?? '').trim();
  if (!script) throw new Error('Write a script first');
  if (!options.voiceId) throw new Error('Choose a voice');
  const clipId = `vo-${Date.now().toString(36)}`;
  const file = `voiceover-${clipId}.mp3`;
  const local = options.provider === 'piper';
  let words = [];
  if (local) {
    // Piper writes WAV; clips are stored as MP3 like the ElevenLabs ones. No word timing:
    // captions are spread evenly over the clip.
    const wav = path.join(app.getPath('temp'), `dz-piper-${clipId}.wav`);
    try {
      await piper.speak(script, options.voiceId, wav, options.speed ?? 1);
      await runFfmpeg(['-i', wav, '-ar', '44100', '-b:a', '160k', store.file(id, file)], 0);
    } finally {
      await removeQuietly(wav);
    }
  } else {
    ({ words } = await ai.speak({ ...options, text: script }, store.file(id, file)));
  }
  const durationMs = (await probeDuration(store.file(id, file))) || (words.length ? words[words.length - 1].endMs + 200 : 0);
  return {
    id: clipId, script, audioPath: file, durationMs, startTimeMs: Math.max(0, Math.round(options.startTimeMs ?? 0)),
    trimStartMs: 0, trimEndMs: durationMs, volume: 1, provider: local ? 'piper' : 'elevenlabs', voiceId: options.voiceId, voiceName: options.voiceName ?? '',
    modelId: local ? 'piper' : options.modelId ?? 'eleven_multilingual_v2', words,
  };
});
ipcMain.handle('piper:status', () => piper.status());
ipcMain.handle('piper:install', (event, voice) => piper.install(voice, p => event.sender.send('piper:progress', p)));
// Waveform peaks (0–255, 100 per second of source) of the recording's audio, for the timeline.
const peakCache = new Map();
// Waveform peaks (100 per second): one track ('mic' | 'audio') or both mixed.
ipcMain.handle('audio:peaks', async (_e, id, track) => {
  const files = track === 'mic' ? ['mic.wav'] : track === 'audio' ? ['audio.wav'] : ['mic.wav', 'audio.wav'];
  const inputs = files.map(file => store.file(id, file)).filter(file => fs.existsSync(file));
  if (!inputs.length) return null;
  const key = `${id}|${track ?? 'mix'}|${(await Promise.all(inputs.map(f => fsp.stat(f)))).map(s => s.mtimeMs).join('|')}`;
  if (peakCache.has(key)) return peakCache.get(key);
  const args = ['-v', 'error', ...inputs.flatMap(f => ['-i', f])];
  if (inputs.length > 1) args.push('-filter_complex', `amix=inputs=${inputs.length}:normalize=0`);
  args.push('-ac', '1', '-ar', '2000', '-f', 's16le', '-');
  const samples = await new Promise((resolve, reject) => {
    const child = require('node:child_process').spawn(ffmpegPath(), args, { windowsHide: true });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('Could not read the audio'))));
  });
  const perPeak = 20, count = Math.floor(samples.length / 2 / perPeak);
  const peaks = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    let max = 0;
    for (let j = 0; j < perPeak; j++) max = Math.max(max, Math.abs(samples.readInt16LE((i * perPeak + j) * 2)));
    peaks[i] = Math.min(255, Math.round(Math.sqrt(max / 32768) * 255)); // sqrt: quiet speech stays visible
  }
  peakCache.set(key, peaks);
  return peaks;
});
// Diagnostics: system and app facts plus recent main-process errors.
// No recordings, file contents or keys are included.
ipcMain.handle('app:diagnostics', async () => {
  const os = require('node:os');
  const native = await listDevices().catch(error => ({ error: String(error?.message ?? error) }));
  const report = {
    app: { name: app.getName(), version: app.getVersion(), packaged: app.isPackaged },
    runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    os: { platform: process.platform, release: os.release(), version: typeof os.version === 'function' ? os.version() : '', arch: process.arch },
    hardware: { cpu: os.cpus()[0]?.model ?? '', cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1e9), freeMemoryGB: Math.round(os.freemem() / 1e9) },
    gpu: app.getGPUFeatureStatus(),
    displays: native.displays?.map(d => ({ index: d.index, bounds: d.bounds, scale: d.scale, refresh: d.refresh_rate })) ?? native,
    microphones: native.microphones?.map(m => ({ name: m.name, default: m.default })) ?? [],
    engines: { whisper: await whisper.status().catch(() => null), piper: await piper.status().catch(() => null), elevenLabsKeySaved: (await ai.status().catch(() => ({ configured: false }))).configured },
    recordings: (await store.list().catch(() => [])).length,
    recentErrors: errorLog.slice(-50),
  };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save diagnostics', defaultPath: path.join(app.getPath('desktop'), `directzoom-diagnostics-${new Date().toLocaleDateString('sv-SE')}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fsp.writeFile(result.filePath, JSON.stringify(report, null, 2));
  return result.filePath;
});
ipcMain.handle('gdrive:status', () => gdrive.status());
ipcMain.handle('gdrive:connect', () => gdrive.connect());
ipcMain.handle('gdrive:disconnect', () => gdrive.disconnect());
ipcMain.handle('gdrive:upload', (event, file) => !outputAllowed(file) ? Promise.reject(new Error('Only exported videos can be uploaded')) : gdrive.upload(file,progress => event.sender.send('gdrive:progress', { file, progress })));
ipcMain.handle('gdrive:import-client', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose the Google OAuth client file', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  return gdrive.importClient(result.filePaths[0]);
});
// Native dialogs and the window background follow the in-app theme.
ipcMain.handle('app:set-theme', (_e, preference) => {
  if (!['system', 'dark', 'light'].includes(preference)) return;
  nativeTheme.themeSource = preference;
  mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#07080b' : '#f3f4f7');
});
ipcMain.handle('shell:open-link', (_e, url) => {
  // Only links DirectZoom itself produces: Drive files, the website and author profile, ElevenLabs account pages and the contact address.
  const allowed = [/^https:\/\/drive\.google\.com\//, /^https:\/\/github\.com\/MrFr0g-X(\/|$)/, /^https:\/\/hothifa\.is-a\.dev\/DirectZoom(\/|$)/, /^https:\/\/elevenlabs\.io\//, /^mailto:h@hothifa\.tech(\?|$)/];
  if (!allowed.some(rule => rule.test(String(url)))) throw new Error('Blocked link');
  return shell.openExternal(url);
});
ipcMain.handle('update:state', () => updater.state());
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:install', () => updater.install());
ipcMain.handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron }));
ipcMain.handle('captions:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Import captions', properties: ['openFile'], filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  const stat = await fsp.stat(result.filePaths[0]);
  if (stat.size > 5 * 1024 * 1024) throw new Error('That subtitle file is too large');
  return fsp.readFile(result.filePaths[0], 'utf8');
});
ipcMain.handle('captions:save-srt', async (_e, name, text) => {
  const result = await dialog.showSaveDialog(mainWindow, { title: 'Export captions', defaultPath: path.join(app.getPath('videos'), `${String(name || 'captions').replace(/[\\/:*?"<>|]/g, '_')}.srt`), filters: [{ name: 'SubRip subtitles', extensions: ['srt'] }] });
  if (result.canceled || !result.filePath) return null;
  await fsp.writeFile(result.filePath, '﻿' + String(text), 'utf8');
  return result.filePath;
});
ipcMain.handle('speech:process', async (event, id, options = {}) => {
  const track = fs.existsSync(store.file(id, 'mic.wav')) ? 'mic' : fs.existsSync(store.file(id, 'audio.wav')) ? 'audio' : null;
  if (!track) throw new Error('This recording has no voice track to clean up');
  const file = `${track}-processed.wav`;
  await processSpeech(store.file(id, `${track}.wav`), store.file(id, file), options, stage => event.sender.send('speech:progress', { id, stage }));
  return { file, track };
});
ipcMain.handle('music:choose', async (_e, id) => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose background music', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  const source = result.filePaths[0];
  const file = `music${path.extname(source).toLowerCase()}`;
  for (const old of await fsp.readdir(store.dir(id))) if (/^music\.\w+$/.test(old)) await removeQuietly(store.file(id, old));
  await fsp.copyFile(source, store.file(id, file));
  return { name: path.basename(source), file, durationMs: await probeDuration(store.file(id, file)) };
});

// ---- IPC ----
function registerIpc() {
  ipcMain.handle('window:minimize', e => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.handle('window:toggle-maximize', e => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w?.isMaximized()) w.unmaximize(); else w?.maximize();
  });
  ipcMain.handle('window:close', e => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.handle('window:is-maximized', e => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false);

  ipcMain.handle('devices:list', devices);
  ipcMain.handle('area:select', async (_event, displayIndex) => {
    const native = await listDevices();
    mainWindow?.hide();
    try { return await selectArea(displayIndex, native.displays); } finally { mainWindow?.show(); }
  });
  ipcMain.handle('recording:start', startRecording);
  ipcMain.handle('recording:stop', stopRecording);
  ipcMain.handle('recording:status', () => (session ? { state: 'recording', startedAt: sessionInfo.startedAt } : { state: 'idle' }));

  ipcMain.handle('projects:list', () => store.list());
  ipcMain.handle('projects:load', (_e, id) => store.load(id));
  ipcMain.handle('projects:save', (_e, project) => store.save(project));
  ipcMain.handle('projects:rename', (_e, id, name) => store.rename(id, name));
  ipcMain.handle('projects:delete', async (_e, id) => {
    const { response } = await dialog.showMessageBox(mainWindow, { type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Delete this recording?', detail: 'The recording and its edits will be removed from disk.' });
    if (response !== 0) return false;
    await store.remove(id);
    return true;
  });
  ipcMain.handle('projects:import-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Import recording folders', properties: ['openDirectory', 'multiSelections'] });
    if (result.canceled) return [];
    const ids = [];
    for (const folder of result.filePaths) ids.push(await store.importFolder(folder));
    return ids;
  });

  ipcMain.handle('cursors:system', async () => {
    const manifest = path.join(cursorDir, 'cursors.json');
    if (!fs.existsSync(manifest)) await exportCursors(cursorDir, 128).catch(() => null);
    const list = await fsp.readFile(manifest, 'utf8').then(JSON.parse).catch(() => []);
    return Object.fromEntries(list.map(c => [c.name, { url: `dz-media://cursor/${c.file}`, hotspotX: c.hotspot_x, hotspotY: c.hotspot_y }]));
  });
  ipcMain.handle('shell:reveal', (_e, file) => shell.showItemInFolder(file));
}

// The app's own pages are the only content DirectZoom windows may show: no pop-ups, no navigation
// away (links go to the browser through shell:open-link), and only camera/microphone permissions.
const appPage = url => (isDev ? url.startsWith('http://127.0.0.1:5173/') : url.startsWith('file://'));
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => { if (!appPage(url)) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
});

// One DirectZoom at a time: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    const allowed = new Set(['media', 'fullscreen', 'clipboard-sanitized-write']);
    electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
    electronSession.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
    registerProtocol();
    registerIpc();
    createMainWindow();
    updater.start();
  });
}

app.on('before-quit', () => session?.abort());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
