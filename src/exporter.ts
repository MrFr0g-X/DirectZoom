// Offline export: demux + decode the recording with WebCodecs, render every output frame
// with the compositor, encode H.264 and stream the MP4 to the main process, which adds audio.
import { createFile, DataStream, Endianness, MP4BoxBuffer, type Sample as MP4Sample } from 'mp4box';
import { Muxer, StreamTarget } from 'mp4-muxer';
import { Compositor, type SceneInput } from './compositor';
import { clipEnd, segments, timelineToSource, totalDuration } from './timeline';
import { mapCaptions } from './captions';
import { duckIntervals } from './audioMix';
import type { ExportJob, Project } from './types';
import { outputSize } from './exportSize';
import { audioPieces, trackSource } from './trackSegments';

export type ExportOptions = {
  format: 'mp4' | 'webm' | 'gif';
  height: number | 'original'; // output height; width follows the composition aspect
  fps: number;
  quality: 'draft' | 'balanced' | 'high' | 'maximum';
  output: string;
};

type Demuxed = { config: VideoDecoderConfig; samples: MP4Sample[]; timescale: number; url: string };

async function demux(url: string, onProgress: (p: number) => void): Promise<Demuxed> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error('Could not read the recording');
  const total = Number(response.headers.get('content-length')) || 0;
  // Only the sample table is kept (offsets and sizes); sample bytes are read later with range
  // requests, so memory use does not grow with the recording length.
  const file: any = createFile();
  let track: any = null;
  let failure: unknown = null;
  file.onError = (error: unknown) => { failure = error; };
  file.onReady = (info: any) => {
    track = info.videoTracks[0];
    if (!track) failure = new Error('No video track');
  };
  const reader = response.body.getReader();
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const copy = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(copy, offset));
    offset += value.byteLength;
    if (total) onProgress(offset / total);
    if (failure) throw failure;
  }
  file.flush();
  if (failure) throw failure;
  if (!track) throw new Error('No video track');
  const samples: MP4Sample[] = file.getTrackSamplesInfo(track.id);
  if (!samples.length) throw new Error('The recording has no video frames');
  const trak = file.getTrackById(track.id);
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const box = entry.avcC ?? entry.hvcC;
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(stream);
  const description = new Uint8Array(stream.buffer, 8);
  return {
    config: { codec: track.codec, codedWidth: track.video.width, codedHeight: track.video.height, description, hardwareAcceleration: 'prefer-hardware' },
    samples, timescale: track.timescale, url,
  };
}

/** Reads sample bytes in batches of consecutive samples with HTTP range requests. */
class SampleReader {
  private cache = new Map<number, Uint8Array>();
  constructor(private url: string, private samples: MP4Sample[]) {}

  clear() { this.cache.clear(); }

  async get(index: number): Promise<Uint8Array> {
    const cached = this.cache.get(index);
    if (cached) { this.cache.delete(index); return cached; }
    let last = index, bytes = this.samples[index].size;
    while (last + 1 < this.samples.length && last - index < 120 && bytes < 16e6) bytes += this.samples[++last].size;
    let start = Infinity, end = 0;
    for (let i = index; i <= last; i++) { start = Math.min(start, this.samples[i].offset); end = Math.max(end, this.samples[i].offset + this.samples[i].size); }
    // Samples far apart (interleaved tracks): fall back to one sample per request.
    if (end - start > 64e6) { last = index; start = this.samples[index].offset; end = start + this.samples[index].size; }
    const response = await fetch(this.url, { headers: { Range: `bytes=${start}-${end - 1}` } });
    if (!response.ok) throw new Error('Could not read the recording');
    let buffer = new Uint8Array(await response.arrayBuffer());
    if (response.status === 200) buffer = buffer.subarray(start, end);
    for (let i = index; i <= last; i++) {
      const sample = this.samples[i];
      this.cache.set(i, buffer.subarray(sample.offset - start, sample.offset - start + sample.size));
    }
    const data = this.cache.get(index)!;
    this.cache.delete(index);
    return data;
  }
}

/**
 * Sequential decoder that returns, for increasing times, the latest frame at or before the
 * time (sample-and-hold, correct for variable frame rate recordings).
 */
class FrameStream {
  private pending: VideoFrame[] = [];
  private current: VideoFrame | null = null;
  private index = 0;
  private error: unknown = null;
  private decoder: VideoDecoder;
  private reader: SampleReader;
  readonly firstTime: number;
  decoded = 0;
  firstOutput = -1;

  constructor(private media: Demuxed) {
    this.decoder = new VideoDecoder({
      output: frame => { if (this.firstOutput < 0) this.firstOutput = frame.timestamp; this.decoded++; this.pending.push(frame); },
      error: e => { this.error = e; },
    });
    this.decoder.configure(media.config);
    this.reader = new SampleReader(media.url, media.samples);
    this.firstTime = media.samples.length ? this.micro(media.samples[0]) : 0;
  }

  private micro(sample: MP4Sample) { return Math.round((sample.cts * 1e6) / this.media.timescale); }

  /** Start decoding from the last keyframe at or before `time` (µs from the first frame). */
  seekTo(time: number) {
    let key = 0;
    for (let i = 0; i < this.media.samples.length; i++) {
      const sample = this.media.samples[i];
      if (this.micro(sample) - this.firstTime > time) break;
      if (sample.is_sync) key = i;
    }
    this.index = key;
    this.reader.clear();
  }

  /** Restarts decoding at `time` (µs): used when a frame before the current one is needed. */
  private jump(time: number) {
    if (this.decoder.state !== 'closed') { this.decoder.reset(); this.decoder.configure(this.media.config); }
    for (const frame of this.pending) frame.close();
    this.pending = [];
    this.current?.close();
    this.current = null;
    this.seekTo(time);
  }

  async frameAt(time: number): Promise<VideoFrame | null> {
    // Reordered clips and moved camera pieces can ask for earlier frames, or skip far ahead.
    const at = this.current ? this.current.timestamp - this.firstTime : null;
    if (at !== null && (time < at - 1000 || (time > at + 3_000_000 && !this.pending.some(f => f.timestamp - this.firstTime >= time)))) this.jump(time);
    for (;;) {
      if (this.error) throw this.error;
      while (this.pending.length && this.pending[0].timestamp - this.firstTime <= time) {
        this.current?.close();
        this.current = this.pending.shift()!;
      }
      if (this.pending.length) return this.current;
      if (this.index >= this.media.samples.length) {
        if (this.decoder.state === 'configured') await this.decoder.flush().catch(() => {});
        while (this.pending.length) { this.current?.close(); this.current = this.pending.shift()!; }
        return this.current;
      }
      while (this.decoder.decodeQueueSize > 8) await new Promise(r => setTimeout(r, 1));
      const sample = this.media.samples[this.index];
      const data = await this.reader.get(this.index++);
      this.decoder.decode(new EncodedVideoChunk({ type: sample.is_sync ? 'key' : 'delta', timestamp: this.micro(sample), duration: Math.round((sample.duration * 1e6) / this.media.timescale), data }));
      if (this.decoder.decodeQueueSize > 4) await new Promise(r => setTimeout(r, 0));
    }
  }

  close() {
    this.current?.close();
    for (const frame of this.pending) frame.close();
    this.pending = [];
    if (this.decoder.state !== 'closed') this.decoder.close();
  }
}

/**
 * H.264 encoder settings this machine accepts. Hardware encoders refuse some sizes and frame
 * rates (e.g. wider-than-1080p at 60 fps), so High-profile levels 4.0 → 5.2 are tried on the
 * hardware encoder first, then in software.
 */
export async function encoderConfig(width: number, height: number, fps: number, bitrate: number): Promise<VideoEncoderConfig> {
  const levels = ['640028', '64002a', '640032', '640033', '640034'];
  for (const hardwareAcceleration of ['prefer-hardware', 'prefer-software'] as const) {
    for (const level of levels) {
      const config: VideoEncoderConfig = {
        codec: `avc1.${level}`, width, height, framerate: fps, avc: { format: 'avc' }, bitrate, latencyMode: 'quality', hardwareAcceleration,
      };
      try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch {}
    }
  }
  throw new Error(`This PC cannot encode ${width}×${height} at ${fps} fps. Choose a lower resolution or frame rate.`);
}

const bitrates = { draft: 0.06, balanced: 0.1, high: 0.16, maximum: 0.26 };

export async function exportProject(project: Project, options: ExportOptions, onProgress: (stage: string, progress: number) => void, signal: AbortSignal) {
  const dz = window.dz;
  onProgress('Reading recording', 0);
  const media = await demux(dz.projects.mediaUrl(project.id, 'screen.mp4'), p => onProgress('Reading recording', p));
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

  const compositor = new Compositor();
  const scene: SceneInput = {
    sourceWidth: media.config.codedWidth!, sourceHeight: media.config.codedHeight!, fps: options.fps,
    cursor: project.cursorData, zooms: project.zooms, clips: project.clips, settings: project.settings,
    cursorEmbedded: project.metadata.cursorEmbedded, keyboard: project.keyboardData, blurRegions: project.blurRegions, annotations: project.annotations, captions: project.captions, threeDKeyframes: project.threeDKeyframes, textFocusRegions: project.textFocusRegions, cameraKeyframes: project.cameraKeyframes, trackSegments: project.trackSegments,
  };
  await compositor.update(scene);
  const design = compositor.design();
  const { width, height: outHeight } = outputSize(design.width, design.height, options.height);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = outHeight;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // Pick the encoder before starting the job, so an unsupported size fails without leaving one open.
  const encoderSettings = await encoderConfig(width, outHeight, options.fps, Math.round(width * outHeight * options.fps * bitrates[options.quality]));
  const jobId = await dz.exporter.begin();
  const writes: Promise<void>[] = [];
  const muxer = new Muxer({
    target: new StreamTarget({ onData: (data, position) => { writes.push(dz.exporter.write(jobId, position, data)); }, chunked: true, chunkSize: 8 * 1024 * 1024 }),
    video: { codec: 'avc', width, height: outHeight, frameRate: options.fps },
    fastStart: false,
    firstTimestampBehavior: 'offset',
  });
  let encodeError: unknown = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { encodeError = e; } });
  encoder.configure(encoderSettings);

  const screen = new FrameStream(media);
  const stats = { framesWithoutVideo: 0, decoded: 0, samples: media.samples.length, codec: media.config.codec, firstTime: screen.firstTime, firstOutput: -1 };
  // Optional webcam track, offset relative to the screen recording.
  let camera: FrameStream | null = null;
  if (project.files.camera) {
    try { camera = new FrameStream(await demux(dz.projects.mediaUrl(project.id, 'camera.mp4'), () => {})); } catch { camera = null; }
  }
  const cameraOffset = (project.metadata.cameraOffset ?? 0) * 1000;
  screen.seekTo(project.clips.length ? project.clips[0].sourceStart * 1000 : 0);

  const duration = totalDuration(project.clips);
  const frames = Math.max(1, Math.round((duration / 1000) * options.fps));
  try {
    for (let n = 0; n < frames; n++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (encodeError) throw encodeError;
      const time = (n / options.fps) * 1000;
      const source = timelineToSource(Math.min(time, clipEnd(project.clips[project.clips.length - 1]) - 0.001), project.clips);
      const current = await screen.frameAt(source * 1000);
      if (!current) stats.framesWithoutVideo++;
      const camAt = camera ? trackSource(project.trackSegments?.camera, source) : null;
      const cam = camera && camAt !== null ? await camera.frameAt(Math.max(0, camAt * 1000 - cameraOffset)) : null;
      compositor.draw(ctx, width, outHeight, current, time, n, cam);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((n * 1e6) / options.fps), duration: Math.round(1e6 / options.fps) });
      encoder.encode(frame, { keyFrame: n % (options.fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 1));
      if (n % 10 === 0) onProgress('Rendering', n / frames);
    }
    await encoder.flush();
    muxer.finalize();
    await Promise.all(writes);
  } catch (error) {
    await dz.exporter.cancel(jobId);
    throw error;
  } finally {
    stats.decoded = screen.decoded;
    stats.firstOutput = screen.firstOutput;
    screen.close();
    camera?.close();
    if (encoder.state !== 'closed') encoder.close();
  }

  onProgress('Finishing', 0);
  const stop = dz.exporter.onProgress(p => { if (p.jobId === jobId) onProgress('Finishing', p.progress); });
  try {
    const music = project.settings.audioSettings;
    const cleaned = music.speechCleanup.micProcessedPath;
    const job: ExportJob = {
      projectId: project.id, output: options.output, format: options.format, segments: segments(project.clips), duration: duration / 1000,
      systemVolume: project.files.audio ? project.settings.audioSettings.systemVolume : 0,
      micVolume: project.files.mic ? project.settings.audioSettings.micVolume : 0,
      systemPieces: audioPieces(project.trackSegments?.system, project.clips),
      micPieces: audioPieces(project.trackSegments?.mic, project.clips),
      micFile: cleaned && music.speechCleanup.processedTrack === 'mic' ? cleaned : undefined,
      systemFile: cleaned && music.speechCleanup.processedTrack === 'audio' ? cleaned : undefined,
      voiceovers: project.voiceoverClips.map(v => ({ file: v.audioPath, startMs: v.startTimeMs, trimStartMs: v.trimStartMs, trimEndMs: v.trimEndMs, volume: v.volume })),
      music: music.backgroundMusicEnabled && music.backgroundMusicPath ? {
        file: music.backgroundMusicPath, volume: music.backgroundMusicVolume, loop: music.backgroundMusicLoop,
        duck: music.autoDuck ? { amount: music.autoDuckAmount, intervals: duckIntervals(mapCaptions(project.captions, project.clips), project.voiceoverClips) } : null,
      } : null,
      gif: options.format === 'gif' ? { fps: Math.min(options.fps, 20), width: Math.min(width, 1280) } : undefined,
    };
    const finished = await dz.exporter.finish(jobId, job);
    return { ...finished, stats };
  } finally {
    stop();
  }
}
