// Builds build/icon.ico (PNG-compressed entries, 16–256 px) from build/icon.png with ffmpeg,
// so packaging does not depend on electron-builder's WebAssembly icon converter.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const source = path.join(root, 'build', 'icon.png');
const output = path.join(root, 'build', 'icon.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-ico-'));

const images = sizes.map(size => {
  const file = path.join(tmp, `${size}.png`);
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', source, '-vf', `scale=${size}:${size}:flags=lanczos`, '-pix_fmt', 'rgba', file]);
  return { size, data: fs.readFileSync(file) };
});
fs.rmSync(tmp, { recursive: true, force: true });

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map(({ size, data }) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2); entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8); entry.writeUInt32LE(offset, 12);
  offset += data.length;
  return entry;
});
fs.writeFileSync(output, Buffer.concat([header, ...entries, ...images.map(i => i.data)]));
console.log(`${path.relative(root, output)}: ${images.length} sizes, ${fs.statSync(output).size} bytes`);
