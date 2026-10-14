// Final export step: the renderer streams an H.264 video-only MP4; this adds audio (trimmed to
// the kept clips, with volumes) and converts to the requested format with FFmpeg.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { background } = require('./priority.cjs');
const { spawn } = require('node:child_process');
const { ffmpegPath } = require('./projects.cjs');

class VideoSink {
  constructor(file) {
    this.file = file;
    this.handle = fs.openSync(file, 'w');
  }
  write(position, bytes) {
    fs.writeSync(this.handle, Buffer.from(bytes), 0, bytes.byteLength, position);
  }
  close() {
    if (this.handle !== null) { fs.closeSync(this.handle); this.handle = null; }
  }
}

function runFfmpeg(args, durationSeconds, onProgress) {
  return new Promise((resolve, reject) => {
    const child = background(spawn(ffmpegPath(), ['-hide_banner', '-y', ...args], { windowsHide: true }));
    let log = '';
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      log = (log + text).slice(-4000);
      const match = /time=(\d+):(\d+):([\d.]+)/.exec(text);
      if (match && durationSeconds > 0) onProgress?.(Math.min(1, (+match[1] * 3600 + +match[2] * 60 + +match[3]) / durationSeconds));
    });
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${log.split('\n').slice(-4).join(' ')}`))));
  });
}

/**
 * @param {object} job
 * @param {string} job.video   video-only MP4 from the renderer
 * @param {string} job.output  destination file
 * @param {'mp4'|'webm'|'gif'} job.format
 * @param {{path:string, volume:number}[]} job.audio  source audio files (source timeline)
 * @param {{start:number,end:number,speed?:number}[]} job.segments kept source ranges in ms, in output order
 * @param {number} job.duration output duration in seconds
 * @param {{fps:number,width:number}} [job.gif]
 */
/** ffmpeg atempo filters for a speed change (each atempo stage accepts 0.5–2 losslessly). */
function tempo(speed) {
  if (!speed || Math.abs(speed - 1) < 1e-6) return '';
  const stages = [];
  let rest = speed;
  while (rest > 2) { stages.push(2); rest /= 2; }
  while (rest < 0.5) { stages.push(0.5); rest /= 0.5; }
  stages.push(rest);
  return stages.map(s => `,atempo=${s.toFixed(6)}`).join('');
}

async function finishExport(job, onProgress) {
  const audio = job.audio.filter(track => track.volume > 0 && fs.existsSync(track.path));
  const hasAudio = audio.length > 0 || (job.voiceovers ?? []).length > 0 || !!job.music;
  if (job.format === 'gif') {
    const fps = job.gif?.fps ?? 15, width = job.gif?.width ?? 960;
    await runFfmpeg(['-i', job.video, '-filter_complex',
      `fps=${fps},scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, job.output],
    job.duration, onProgress);
    return;
  }
  const args = ['-i', job.video];
  for (const track of audio) args.push('-i', track.path);
  const filters = [];
  const mixed = [];
  let nextInput = audio.length + 1;
  // Voiceover clips sit on the output timeline.
  for (const [v, clip] of (job.voiceovers ?? []).filter(c => c.volume > 0 && fs.existsSync(c.path)).entries()) {
    const input = nextInput++;
    args.push('-i', clip.path);
    filters.push(`[${input}:a]atrim=start=${(clip.trimStartMs / 1000).toFixed(4)}:end=${(clip.trimEndMs / 1000).toFixed(4)},asetpts=PTS-STARTPTS,adelay=delays=${Math.max(0, Math.round(clip.startMs))}:all=1,volume=${clip.volume.toFixed(3)}[vo${v}]`);
    mixed.push(`[vo${v}]`);
  }
  // Background music: optional loop, ducked under speech.
  if (job.music && job.music.volume > 0 && fs.existsSync(job.music.path)) {
    const input = nextInput++;
    if (job.music.loop) args.push('-stream_loop', '-1');
    args.push('-i', job.music.path);
    filters.push(`[${input}:a]atrim=end=${job.duration.toFixed(3)},asetpts=PTS-STARTPTS,volume='${duckExpression(job.music.volume, job.music.duck)}':eval=frame[music]`);
    mixed.push('[music]');
  }
  audio.forEach((track, index) => {
    const input = index + 1;
    // A track edited on its own (split / removed / moved pieces): each piece is trimmed from the
    // recording, sped up like its clip and placed at its output time; elsewhere it is silent.
    if (Array.isArray(track.pieces)) {
      const parts = track.pieces.filter(p => p.sourceEnd > p.sourceStart).map((p, s) => {
        filters.push(`[${input}:a]atrim=start=${(p.sourceStart / 1000).toFixed(4)}:end=${(p.sourceEnd / 1000).toFixed(4)},asetpts=PTS-STARTPTS${tempo(p.speed ?? 1)},adelay=delays=${Math.max(0, Math.round(p.outputStart))}:all=1[a${input}p${s}]`);
        return `[a${input}p${s}]`;
      });
      if (!parts.length) return;
      filters.push(parts.length > 1
        ? `${parts.join('')}amix=inputs=${parts.length}:normalize=0:duration=longest,volume=${track.volume.toFixed(3)}[a${input}]`
        : `${parts[0]}volume=${track.volume.toFixed(3)}[a${input}]`);
      mixed.push(`[a${input}]`);
      return;
    }
    const parts = job.segments.map((segment, s) => {
      filters.push(`[${input}:a]atrim=start=${(segment.start / 1000).toFixed(4)}:end=${(segment.end / 1000).toFixed(4)},asetpts=PTS-STARTPTS${tempo(segment.speed ?? 1)}[a${input}s${s}]`);
      return `[a${input}s${s}]`;
    });
    filters.push(`${parts.join('')}concat=n=${parts.length}:v=0:a=1,volume=${track.volume.toFixed(3)}[a${input}]`);
    mixed.push(`[a${input}]`);
  });
  if (mixed.length > 1) filters.push(`${mixed.join('')}amix=inputs=${mixed.length}:normalize=0:duration=longest[aout]`);
  else if (mixed.length === 1) filters.push(`${mixed[0]}anull[aout]`);
  if (filters.length) args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]');
  else args.push('-map', '0:v');
  if (job.format === 'webm') args.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', ...(hasAudio && mixed.length ? ['-c:a', 'libopus', '-b:a', '160k', '-ac', '2'] : []));
  else args.push('-c:v', 'copy', ...(hasAudio && mixed.length ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : []), '-movflags', '+faststart');
  args.push('-t', job.duration.toFixed(3), job.output);
  await runFfmpeg(args, job.duration, onProgress);
}

/**
 * ffmpeg volume expression for auto-ducking: inside a speech interval the music plays
 * at `amount`, ramping linearly back to full over 100 ms on either side.
 */
function duckExpression(volume, duck) {
  const intervals = duck?.intervals ?? [];
  if (!intervals.length) return volume.toFixed(4);
  const ramp = 0.1, amount = duck.amount;
  const distance = intervals
    .map(({ start, end }) => `max(max(${(start / 1000).toFixed(3)}-t,t-${(end / 1000).toFixed(3)}),0)`)
    .reduce((acc, term) => (acc ? `min(${acc},${term})` : term), '');
  return `${volume.toFixed(4)}*(${amount.toFixed(4)}+${(1 - amount).toFixed(4)}*clip((${distance})/${ramp},0,1))`;
}

/** Media duration in ms (reads the container header with ffmpeg). */
function probeDuration(file) {
  return new Promise(resolve => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true });
    let log = '';
    child.stderr.on('data', chunk => { log += chunk.toString(); });
    child.on('exit', () => {
      const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
      resolve(m ? Math.round((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000) : 0);
    });
    child.on('error', () => resolve(0));
  });
}

async function removeQuietly(file) {
  await fsp.rm(file, { force: true }).catch(() => {});
}

module.exports = { VideoSink, finishExport, removeQuietly, runFfmpeg, probeDuration, duckExpression };
