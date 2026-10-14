const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, listener) => {
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('dz', {
  window: {
    minimize: () => call('window:minimize'),
    toggleMaximize: () => call('window:toggle-maximize'),
    close: () => call('window:close'),
    isMaximized: () => call('window:is-maximized'),
    onMaximized: listener => on('window:maximized', listener),
  },
  devices: () => call('devices:list'),
  selectArea: displayIndex => call('area:select', displayIndex),
  areaDone: rect => call('area:done', rect),
  recording: {
    start: options => call('recording:start', options),
    stop: options => call('recording:stop', options),
    status: () => call('recording:status'),
    onState: listener => on('recording:state', listener),
    onFinished: listener => on('recording:finished', listener),
  },
  projects: {
    list: () => call('projects:list'),
    load: id => call('projects:load', id),
    save: project => call('projects:save', project),
    rename: (id, name) => call('projects:rename', id, name),
    remove: id => call('projects:delete', id),
    importFolder: () => call('projects:import-folder'),
    saveCamera: (id, bytes, offset) => call('projects:save-camera', id, bytes, offset),
    mediaUrl: (id, file) => `dz-media://project/${encodeURIComponent(id)}/${encodeURIComponent(file)}`,
  },
  systemCursors: () => call('cursors:system'),
  ai: {
    status: () => call('ai:status'),
    setKey: key => call('ai:set-key', key),
    account: () => call('ai:account'),
    transcribe: (id, options) => call('captions:transcribe', id, options),
    voices: () => call('voiceover:voices'),
    generateVoiceover: (id, options) => call('voiceover:generate', id, options),
  },
  chooseMusic: id => call('music:choose', id),
  whisper: {
    status: () => call('whisper:status'),
    install: model => call('whisper:install', model),
    remove: model => call('whisper:remove', model),
    onProgress: listener => on('whisper:progress', listener),
    onTranscribeProgress: listener => on('captions:progress', listener),
  },
  piper: {
    status: () => call('piper:status'),
    install: voice => call('piper:install', voice),
    onProgress: listener => on('piper:progress', listener),
  },
  speech: {
    process: (id, options) => call('speech:process', id, options),
    onProgress: listener => on('speech:progress', listener),
  },
  saveSrt: (name, text) => call('captions:save-srt', name, text),
  openSubtitles: () => call('captions:open'),
  audioPeaks: (id, track) => call('audio:peaks', id, track),
  diagnostics: () => call('app:diagnostics'),
  appInfo: () => call('app:info'),
  gdrive: {
    status: () => call('gdrive:status'),
    connect: () => call('gdrive:connect'),
    disconnect: () => call('gdrive:disconnect'),
    upload: file => call('gdrive:upload', file),
    importClient: () => call('gdrive:import-client'),
    onProgress: listener => on('gdrive:progress', listener),
  },
  openLink: url => call('shell:open-link', url),
  setTheme: preference => call('app:set-theme', preference),
  updates: {
    state: () => call('update:state'),
    check: () => call('update:check'),
    install: () => call('update:install'),
    onState: listener => on('update:state', listener),
  },
  exporter: {
    choose: (name, format) => call('export:choose', { name, format }),
    begin: () => call('export:begin'),
    write: (jobId, position, bytes) => call('export:write', jobId, position, bytes),
    cancel: jobId => call('export:cancel', jobId),
    finish: (jobId, job) => call('export:finish', jobId, job),
    onProgress: listener => on('export:progress', listener),
  },
  reveal: file => call('shell:reveal', file),
});
