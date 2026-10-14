// Google Drive uploads. OAuth for installed apps (loopback redirect + PKCE) with the
// `drive.file` scope, so DirectZoom only sees files it uploads itself. The refresh token is
// stored encrypted (safeStorage) in the user's profile. Uploads are resumable and go into a
// "DirectZoom" folder.
//
// The OAuth client comes from a Google Cloud "Desktop app" client JSON, looked up in:
//   1. %APPDATA%\directzoom\google-client.json   (per user)
//   2. <resources>\google-client.json             (bundled at build time from build/google-client.json)
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, safeStorage, shell } = require('electron');

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'DirectZoom';
const CHUNK = 8 * 1024 * 1024; // multiple of 256 KiB, as the resumable protocol requires
const tokenFile = () => path.join(app.getPath('userData'), 'gdrive.token');

let cachedAccess = null; // { token, expires }

function clientFiles() {
  return [path.join(app.getPath('userData'), 'google-client.json'), path.join(process.resourcesPath ?? '', 'google-client.json'), path.join(__dirname, '..', 'build', 'google-client.json')];
}

/** The OAuth client (client_id, client_secret) from the Google Cloud JSON, or null. */
async function client() {
  for (const file of clientFiles()) {
    try {
      const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
      const entry = raw.installed ?? raw.web ?? raw;
      if (entry.client_id) return { id: entry.client_id, secret: entry.client_secret ?? '' };
    } catch {}
  }
  return null;
}

async function readToken() {
  try {
    const data = await fsp.readFile(tokenFile());
    return JSON.parse(safeStorage.decryptString(data));
  } catch {
    return null;
  }
}

async function writeToken(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system');
  await fsp.writeFile(tokenFile(), safeStorage.encryptString(JSON.stringify(value)));
}

async function status() {
  const token = await readToken();
  return { configured: !!(await client()), connected: !!token?.refresh, email: token?.email ?? null };
}

async function tokenRequest(params) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error_description || body.error || `Google sign-in failed (${response.status})`);
    error.code = body.error;
    throw error;
  }
  return body;
}

const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:15px system-ui;background:#0b0c10;color:#e6e7ea;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#9aa0aa">${text}</p></div></body>`;

/** Opens Google sign-in in the browser and waits (up to 5 minutes) for the loopback redirect. */
async function connect() {
  const oauth = await client();
  if (!oauth) throw new Error('Google Drive is not set up for this copy of DirectZoom (no OAuth client).');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const redirect = `http://127.0.0.1:${server.address().port}`;
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Google sign-in timed out. Please try again.')), 5 * 60 * 1000);
      server.on('request', (req, res) => {
        const url = new URL(req.url, redirect);
        if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
        const error = url.searchParams.get('error');
        if (url.searchParams.get('state') !== state && !error) { res.writeHead(400); res.end(); return; }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        if (error) {
          res.end(page('Not connected', 'Google Drive access was not granted. You can close this tab.'));
          clearTimeout(timer);
          reject(new Error(error === 'access_denied' ? 'Google Drive access was not granted.' : `Google sign-in failed: ${error}`));
          return;
        }
        res.end(page('DirectZoom is connected', 'Google Drive is ready. You can close this tab and return to DirectZoom.'));
        clearTimeout(timer);
        resolve(url.searchParams.get('code'));
      });
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      for (const [k, v] of Object.entries({
        client_id: oauth.id, redirect_uri: redirect, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent',
        code_challenge: challenge, code_challenge_method: 'S256', state,
      })) auth.searchParams.set(k, v);
      shell.openExternal(auth.toString()).catch(reject);
    });
    const tokens = await tokenRequest({ client_id: oauth.id, client_secret: oauth.secret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect });
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove DirectZoom from your Google account permissions and try again.');
    cachedAccess = { token: tokens.access_token, expires: Date.now() + (tokens.expires_in - 60) * 1000 };
    const about = await drive('/drive/v3/about?fields=user(emailAddress)');
    await writeToken({ refresh: tokens.refresh_token, email: about.user?.emailAddress ?? null });
    return status();
  } finally {
    server.close();
  }
}

async function accessToken() {
  if (cachedAccess && cachedAccess.expires > Date.now()) return cachedAccess.token;
  const oauth = await client();
  const stored = await readToken();
  if (!oauth || !stored?.refresh) throw new Error('Connect Google Drive first.');
  try {
    const tokens = await tokenRequest({ client_id: oauth.id, client_secret: oauth.secret, refresh_token: stored.refresh, grant_type: 'refresh_token' });
    cachedAccess = { token: tokens.access_token, expires: Date.now() + (tokens.expires_in - 60) * 1000 };
    return cachedAccess.token;
  } catch (error) {
    if (error.code === 'invalid_grant') {
      await fsp.rm(tokenFile(), { force: true });
      throw new Error('Google Drive access expired or was removed. Connect again.');
    }
    throw error;
  }
}

/** JSON request to the Drive API. */
async function drive(route, init = {}) {
  const response = await fetch(`https://www.googleapis.com${route}`, {
    ...init, headers: { authorization: `Bearer ${await accessToken()}`, ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google Drive: ${body.error?.message ?? response.status}`);
  return body;
}

async function folderId() {
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await drive(`/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`);
  if (found.files?.[0]) return found.files[0].id;
  const created = await drive('/drive/v3/files?fields=id', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return created.id;
}

async function md5(file) {
  const hash = crypto.createHash('md5');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const mimeFor = file => ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif', '.srt': 'application/x-subrip' }[path.extname(file).toLowerCase()] ?? 'application/octet-stream');

/** Uploads `file` (resumable, 8 MB chunks). Returns { id, name, link }. */
async function upload(file, onProgress = () => {}) {
  const size = (await fsp.stat(file)).size;
  const parent = await folderId();
  const start = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size,md5Checksum', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': mimeFor(file), 'x-upload-content-length': String(size),
    },
    body: JSON.stringify({ name: path.basename(file), parents: [parent] }),
  });
  if (!start.ok) throw new Error(`Google Drive: could not start the upload (${start.status})`);
  const session = start.headers.get('location');
  const handle = await fsp.open(file, 'r');
  try {
    let offset = 0, retries = 0;
    for (;;) {
      const length = Math.min(CHUNK, size - offset);
      const chunk = Buffer.alloc(length);
      await handle.read(chunk, 0, length, offset);
      let response;
      try {
        response = await fetch(session, {
          method: 'PUT',
          headers: { 'content-length': String(length), 'content-range': length ? `bytes ${offset}-${offset + length - 1}/${size}` : `bytes */${size}` },
          body: chunk,
        });
      } catch (error) {
        // Network hiccup: ask the server how much it has and continue from there.
        if (++retries > 5) throw error;
        await new Promise(r => setTimeout(r, 1000 * retries));
        const probe = await fetch(session, { method: 'PUT', headers: { 'content-range': `bytes */${size}` } }).catch(() => null);
        const range = probe?.headers.get('range');
        offset = range ? Number(range.split('-')[1]) + 1 : offset;
        continue;
      }
      if (response.status === 308) {
        const range = response.headers.get('range');
        offset = range ? Number(range.split('-')[1]) + 1 : 0;
        retries = 0;
        onProgress(offset / size);
        continue;
      }
      if (!response.ok) {
        if (response.status >= 500 && ++retries <= 5) { await new Promise(r => setTimeout(r, 1000 * retries)); continue; }
        const body = await response.json().catch(() => ({}));
        throw new Error(`Google Drive: ${body.error?.message ?? `upload failed (${response.status})`}`);
      }
      const done = await response.json();
      onProgress(1);
      // Drive reports the stored file's size and MD5: confirm the upload arrived intact.
      if (Number(done.size) !== size || (done.md5Checksum && done.md5Checksum !== (await md5(file)))) {
        throw new Error('Google Drive: the uploaded file does not match the export. Please upload again.');
      }
      return { id: done.id, name: done.name, link: done.webViewLink ?? `https://drive.google.com/file/d/${done.id}/view` };
    }
  } finally {
    await handle.close();
  }
}

async function disconnect() {
  const stored = await readToken();
  if (stored?.refresh) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(stored.refresh)}`, { method: 'POST' }).catch(() => {});
  cachedAccess = null;
  await fsp.rm(tokenFile(), { force: true });
  return status();
}

/** Copies a downloaded Google Cloud client JSON into the profile (Help → Google Drive). */
async function importClient(file) {
  const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
  const entry = raw.installed ?? raw.web;
  if (!entry?.client_id) throw new Error('That file is not a Google OAuth client (expected a "Desktop app" client JSON).');
  if (!raw.installed) throw new Error('This is a "Web application" client. Create a "Desktop app" OAuth client instead.');
  await fsp.writeFile(path.join(app.getPath('userData'), 'google-client.json'), JSON.stringify({ installed: { client_id: entry.client_id, client_secret: entry.client_secret } }));
  return status();
}

module.exports = { status, connect, disconnect, upload, importClient };
