import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { download } = require('../electron/whisper.cjs');

test('downloads are checksum-verified and corrupt files are not kept', async () => {
  const body = Buffer.from('directzoom-test-payload'.repeat(1000));
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-length': body.length }); res.end(body); });
  await new Promise(r => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/file`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-dl-'));
  try {
    const good = crypto.createHash('sha256').update(body).digest('hex');
    let last = 0;
    await download(url, path.join(dir, 'ok.bin'), good, p => { last = p; });
    assert.equal(fs.readFileSync(path.join(dir, 'ok.bin')).length, body.length);
    assert.equal(last, 1);
    await assert.rejects(download(url, path.join(dir, 'bad.bin'), '0'.repeat(64), () => {}), /checksum/);
    assert.equal(fs.existsSync(path.join(dir, 'bad.bin')), false);
    assert.equal(fs.existsSync(path.join(dir, 'bad.bin.part')), false);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('zip extraction is verified against the archive listing before it is used', async () => {
  const { extractVerified, findVerified, hasDigest } = require('../electron/whisper.cjs');
  const { execFileSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-zip-'));
  try {
    fs.mkdirSync(path.join(dir, 'src', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'pkg', 'tool.exe'), Buffer.alloc(300000, 7));
    fs.writeFileSync(path.join(dir, 'src', 'pkg', 'data.bin'), 'x'.repeat(1234));
    const tar = path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe');
    const zip = path.join(dir, 'pkg.zip');
    execFileSync(tar, ['-a', '-cf', zip, '-C', path.join(dir, 'src'), 'pkg']);
    const dest = path.join(dir, 'bin');
    assert.equal(await findVerified(dest, /^tool\.exe$/), null);
    await extractVerified(zip, dest);
    const exe = await findVerified(dest, /^tool\.exe$/);
    assert.ok(exe && fs.statSync(exe).size === 300000);
    assert.equal(fs.existsSync(`${dest}.partial`), false);
    const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    assert.equal(await hasDigest(zip, sha), true);
    assert.equal(await hasDigest(zip, '0'.repeat(64)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
