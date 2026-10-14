import { access } from 'node:fs/promises';
import path from 'node:path';

// Helpers that run outside the ASAR archive must exist in the packaged app.
const resources = path.resolve('release/win-unpacked/resources');
const required = [
  'dzcap.exe',
  'app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe',
];
for (const file of required) await access(path.join(resources, file));
console.log(`Verified ${required.length} native helpers in the packaged app.`);
