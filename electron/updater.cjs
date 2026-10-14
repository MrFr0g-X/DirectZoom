// Updates from the project's GitHub Releases.
//
// Installed copies (NSIS setup) use electron-updater: they check shortly after start and every
// few hours, download a newer version in the background (SHA-512 verified), and install it when
// the user clicks "Restart to update" or the next time they quit.
//
// The portable build can't replace itself while running, so it only checks the latest release
// and offers a link to download it.
//
// The repository comes from resources/app-update.yml (written by electron-builder from the
// "publish" setting), falling back to the project's own repository.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const { newer, latestRelease } = require('./release-check.cjs');

const DEFAULT_REPO = { owner: 'MrFr0g-X', repo: 'DirectZoom' };
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;

function repository() {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const owner = /^owner:\s*(\S+)/m.exec(yml)?.[1];
    const repo = /^repo:\s*(\S+)/m.exec(yml)?.[1];
    if (owner && repo) return { owner, repo };
  } catch {}
  return DEFAULT_REPO;
}
const REPO = repository();
const releasesPage = `https://github.com/${REPO.owner}/${REPO.repo}/releases/latest`;

const describe = error => {
  const text = String(error?.message ?? error);
  if (/checksum|sha512|signature/i.test(text)) return 'The downloaded update failed verification and was discarded.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::|getaddrinfo/i.test(text)) return 'Couldn’t reach GitHub. Check your internet connection.';
  if (/\b404\b|No published versions|Unable to find latest version/i.test(text)) return 'No releases are published yet.';
  if (/\b403\b|rate limit/i.test(text)) return 'GitHub is limiting update checks right now. Try again later.';
  return text.split('\n')[0].slice(0, 200);
};

let state = { status: 'idle', version: null, progress: 0, error: null, portable, releasesPage };
let notify = () => {};
const set = patch => { state = { ...state, ...patch }; notify(publicState()); return publicState(); };
const publicState = () => ({ ...state, current: app.getVersion() });

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;
autoUpdater.logger = null;
autoUpdater.on('update-available', info => set({ status: 'downloading', version: info.version, progress: 0, error: null }));
autoUpdater.on('download-progress', p => set({ status: 'downloading', progress: p.percent / 100 }));
autoUpdater.on('update-downloaded', info => set({ status: 'ready', version: info.version, progress: 1, error: null }));
autoUpdater.on('error', error => { if (state.status !== 'idle') set({ status: 'error', error: describe(error) }); });

async function check({ quiet = false } = {}) {
  if (['downloading', 'ready'].includes(state.status)) return publicState();
  set({ status: 'checking', error: null });
  try {
    if (portable || !app.isPackaged) {
      const latest = await latestRelease(REPO, `DirectZoom/${app.getVersion()}`);
      return set({ status: latest && newer(latest, app.getVersion()) ? 'available' : 'current', version: latest || null });
    }
    const result = await autoUpdater.checkForUpdates();
    const latest = result?.updateInfo?.version ?? null;
    if (latest && newer(latest, app.getVersion())) return set({ status: state.status === 'ready' ? 'ready' : 'downloading', version: latest });
    return set({ status: 'current', version: latest });
  } catch (error) {
    // Background checks stay silent; a manual check shows what went wrong.
    return set(quiet ? { status: 'idle', error: null } : { status: 'error', error: describe(error) });
  }
}

function install() {
  // Silent install (no setup wizard), then start the updated app again.
  if (state.status === 'ready') setImmediate(() => autoUpdater.quitAndInstall(true, true));
}

/** Starts background checks (installed and portable builds; not development runs). */
function start() {
  if (!app.isPackaged) return;
  setTimeout(() => check({ quiet: true }), 10_000);
  setInterval(() => check({ quiet: true }), CHECK_EVERY_MS).unref?.();
}

module.exports = { check, install, start, onState: listener => { notify = listener; }, state: publicState, releasesPage };
