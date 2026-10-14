// Project storage, one folder per recording:
//   <root>/<id>/screen.mp4, audio.wav, mic.wav, cursor.json, keyboard.json, metadata.json,
//   settings.json, zoom.json, clips.json, thumbnail.jpg
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const JSON_FILES = { cursorData: 'cursor.json', keyboardData: 'keyboard.json', zooms: 'zoom.json', clips: 'clips.json', blurRegions: 'blur-regions.json', annotations: 'annotations.json', captions: 'captions.json', voiceoverClips: 'voiceovers.json', threeDKeyframes: 'threeD-keyframes.json', cameraKeyframes: 'camera-keyframes.json', textFocusEvents: 'text-focus-events.json', textFocusRegions: 'text-focus-regions.json', trackSegments: 'track-segments.json' };

function unpacked(file) {
  return file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}
const ffmpegPath = () => unpacked(require('ffmpeg-static'));

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value));
  await fsp.rename(temp, file);
}

class ProjectStore {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }

  // Names are a single path segment: word characters, dots and dashes, but never "." or "..".
  dir(id) {
    if (!/^(?!\.+$)[\w.-]+$/.test(id)) throw new Error('invalid project id');
    return path.join(this.root, id);
  }

  file(id, name) {
    if (!/^(?!\.+$)[\w.-]+$/.test(name)) throw new Error('invalid file name');
    return path.join(this.dir(id), name);
  }

  async list() {
    const ids = await fsp.readdir(this.root).catch(() => []);
    const projects = [];
    for (const id of ids) {
      const metadata = await readJson(path.join(this.root, id, 'metadata.json'), null);
      if (!metadata || !fs.existsSync(path.join(this.root, id, 'screen.mp4'))) continue;
      projects.push({ ...metadata, id, hasThumbnail: fs.existsSync(path.join(this.root, id, 'thumbnail.jpg')) });
    }
    return projects.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async load(id) {
    const dir = this.dir(id);
    const metadata = await readJson(path.join(dir, 'metadata.json'), null);
    if (!metadata) throw new Error('project not found');
    const project = { id, metadata: { ...metadata, id, ...(await this.cameraInfo(dir)) } };
    for (const [key, file] of Object.entries(JSON_FILES)) project[key] = await readJson(path.join(dir, file), []);
    project.settings = await readJson(path.join(dir, 'settings.json'), null);
    project.files = {
      screen: fs.existsSync(path.join(dir, 'screen.mp4')),
      audio: fs.existsSync(path.join(dir, 'audio.wav')),
      mic: fs.existsSync(path.join(dir, 'mic.wav')),
      camera: fs.existsSync(path.join(dir, 'camera.mp4')),
    };
    return project;
  }

  async save(project) {
    const dir = this.dir(project.id);
    if (!fs.existsSync(dir)) throw new Error('project not found');
    for (const [key, file] of Object.entries(JSON_FILES)) if (project[key] !== undefined) await writeJsonAtomic(path.join(dir, file), project[key]);
    if (project.settings) await writeJsonAtomic(path.join(dir, 'settings.json'), project.settings);
    if (project.metadata) {
      const current = await readJson(path.join(dir, 'metadata.json'), {});
      await writeJsonAtomic(path.join(dir, 'metadata.json'), { ...current, ...project.metadata, id: project.id });
    }
    return true;
  }

  async rename(id, name) {
    const file = path.join(this.dir(id), 'metadata.json');
    const metadata = await readJson(file, null);
    if (!metadata) throw new Error('project not found');
    await writeJsonAtomic(file, { ...metadata, name });
  }

  async remove(id) {
    const dir = this.dir(id);
    // Only remove folders that look like DirectZoom projects inside our root.
    if (path.dirname(dir) !== this.root || !fs.existsSync(path.join(dir, 'metadata.json'))) throw new Error('not a project folder');
    await fsp.rm(dir, { recursive: true, force: true });
  }

  newId() {
    return `dz-${Date.now()}`;
  }

  /** Writes metadata after a recording and generates the thumbnail. */
  async finalizeRecording(id, info) {
    const dir = this.dir(id);
    const captured = await readJson(path.join(dir, 'metadata.json'), {});
    const metadata = {
      ...captured, id, name: info.name, createdAt: info.createdAt, cloudStatus: 'local', cursorEmbedded: false,
      hasSystemAudio: fs.existsSync(path.join(dir, 'audio.wav')), hasMicAudio: fs.existsSync(path.join(dir, 'mic.wav')),
      sourceName: info.sourceName,
      ...(await this.cameraInfo(dir)),
    };
    await writeJsonAtomic(path.join(dir, 'metadata.json'), metadata);
    await this.thumbnail(id, Math.min(1, (metadata.duration || 0) / 2000));
    return metadata;
  }

  async cameraInfo(dir) {
    if (!fs.existsSync(path.join(dir, 'camera.mp4'))) return { hasCamera: false };
    const info = await readJson(path.join(dir, 'camera.json'), {});
    return { hasCamera: true, cameraOffset: info.offset ?? 0 };
  }

  thumbnail(id, atSeconds = 0.5) {
    const dir = this.dir(id);
    return new Promise(resolve => {
      execFile(ffmpegPath(), ['-v', 'error', '-y', '-ss', String(atSeconds), '-i', path.join(dir, 'screen.mp4'), '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', path.join(dir, 'thumbnail.jpg')],
        { windowsHide: true }, () => resolve());
    });
  }

  /**
   * Copies a project folder (same layout as DirectZoom projects: metadata.json, screen.mp4 and
   * the JSON tracks) into a new project. The source folder is not changed.
   */
  async importFolder(sourceDir) {
    const metadata = await readJson(path.join(sourceDir, 'metadata.json'), null);
    if (!metadata || !fs.existsSync(path.join(sourceDir, 'screen.mp4'))) {
      throw new Error('This folder is not a recording project (it needs metadata.json and screen.mp4).');
    }
    if (path.resolve(path.dirname(sourceDir)) === path.resolve(this.root)) throw new Error('This recording is already in your library.');
    const id = `imp-${crypto.createHash('sha1').update(path.resolve(sourceDir).toLowerCase()).digest('hex').slice(0, 12)}`;
    const dir = this.dir(id);
    if (fs.existsSync(dir)) return id;
    await fsp.mkdir(dir, { recursive: true });
    for (const name of ['screen.mp4', 'audio.wav', 'mic.wav', 'camera.mp4', 'camera.json', ...Object.values(JSON_FILES), 'settings.json', 'thumbnail.jpg']) {
      const from = path.join(sourceDir, name);
      if (fs.existsSync(from)) await fsp.copyFile(from, path.join(dir, name));
    }
    await writeJsonAtomic(path.join(dir, 'metadata.json'), { ...metadata, id, importedFrom: 'folder', cursorEmbedded: false });
    return id;
  }
}

module.exports = { ProjectStore, ffmpegPath, unpacked };
