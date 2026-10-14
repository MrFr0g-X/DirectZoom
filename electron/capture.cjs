// Wrapper around the native capture helper (native/dzcap): device listing, recording
// sessions, and system cursor export.
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

function helperPath() {
  const packaged = path.join(process.resourcesPath || '', 'dzcap.exe');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'native', 'dzcap', 'target', 'release', 'dzcap.exe');
}

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(helperPath(), args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      const line = stdout.trim().split(/\r?\n/).pop() || '';
      let message;
      try { message = JSON.parse(line); } catch { return reject(error || new Error(`dzcap: unexpected output ${line.slice(0, 200)}`)); }
      if (message.event === 'error') return reject(new Error(message.message));
      if (error) return reject(error);
      resolve(message);
    });
  });
}

const listDevices = () => run(['list']);
const exportCursors = (dir, size = 128) => run(['cursors', dir, String(size)]);

/** A running recording. `start` resolves once the first frame has been captured. */
class RecordingSession {
  constructor(config) {
    this.config = config;
    this.process = null;
    this.events = [];
    this.waiters = [];
    this.exited = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      const child = spawn(helperPath(), ['record', JSON.stringify(this.config)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.process = child;
      let buffer = '';
      let started = false;
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          this.events.push(message);
          if (message.event === 'started' && !started) { started = true; resolve(message); }
          if (message.event === 'error' && !started) { started = true; reject(new Error(message.message)); }
          if (message.event === 'source-closed') this.onSourceClosed?.(message.message);
          for (const waiter of this.waiters.splice(0)) waiter(message);
        }
      });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', error => { if (!started) { started = true; reject(error); } });
      child.on('exit', code => {
        this.exited = code;
        if (!started) { started = true; reject(new Error(`capture helper exited (${code}) ${stderr.slice(-300)}`)); }
        for (const waiter of this.waiters.splice(0)) waiter({ event: 'exit', code });
      });
    });
  }

  /** Stops capture and resolves with the helper's `finished` message. */
  stop() {
    return new Promise((resolve, reject) => {
      const done = this.events.find(e => e.event === 'finished');
      if (done) return resolve(done);
      const onMessage = message => {
        if (message.event === 'finished') return resolve(message);
        if (message.event === 'error') return reject(new Error(message.message));
        if (message.event === 'exit') return reject(new Error(`capture helper exited (${message.code}) before finishing`));
        this.waiters.push(onMessage);
      };
      this.waiters.push(onMessage);
      try { this.process.stdin.write('stop\n'); this.process.stdin.end(); } catch (error) { reject(error); }
    });
  }

  /** Kills the helper without finalizing (used when the app quits mid-recording). */
  abort() {
    try { this.process?.stdin.end(); } catch {}
  }

  warnings() {
    return this.events.filter(e => e.event === 'warning').map(e => e.message);
  }
}

module.exports = { helperPath, listDevices, exportCursors, RecordingSession };
