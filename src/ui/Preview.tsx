import { useEffect, useMemo, useRef, useState } from 'react';
import { Compositor, designSize } from '../compositor';
import { clipAt, timelineToSource, totalDuration } from '../timeline';
import { trackSource, type MediaTrack } from '../trackSegments';
import { mapCaptions } from '../captions';
import { duckGain, duckIntervals, voiceoverLength } from '../audioMix';
import { CropOverlay } from './CropOverlay';
import { DrawLayer } from './DrawLayer';
import type { Annotation, Project } from '../types';

type Props = {
  project: Project;
  time: number;
  playing: boolean;
  speed: number;
  onTime: (time: number) => void;
  onEnded: () => void;
  onPick?: (point: { x: number; y: number }) => void;
  picking?: boolean;
  cropping?: boolean;
  cropAspect?: number | null;
  onCropChange?: (region: { x: number; y: number; width: number; height: number }) => void;
  onCropStart?: () => void;
  /** Edit a rectangle (normalized to the full frame) over the raw frame, e.g. a blur region. */
  editRegion?: { x: number; y: number; width: number; height: number } | null;
  onEditRegion?: (region: { x: number; y: number; width: number; height: number }) => void;
  drawTemplate?: Omit<Annotation, 'id' | 'startMs' | 'endMs' | 'points'> | null;
  onDraw?: (draft: Omit<Annotation, 'id' | 'startMs' | 'endMs'>) => void;
};

export function Preview({ project, time, playing, speed, onTime, onEnded, onPick, picking, cropping: cropMode, cropAspect, onCropChange, onCropStart, editRegion, onEditRegion, drawTemplate, onDraw }: Props) {
  const cropping = cropMode || !!editRegion;
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const system = useRef<HTMLAudioElement>(null);
  const mic = useRef<HTMLAudioElement>(null);
  const cam = useRef<HTMLVideoElement>(null);
  const voices = useRef<Record<string, HTMLAudioElement | null>>({});
  const music = useRef<HTMLAudioElement>(null);
  const audioMix = project.settings.audioSettings;
  // Cleaned speech replaces its track; if it cannot be loaded the original plays instead.
  const [cleanFailed, setCleanFailed] = useState<string | null>(null);
  const cleanedPath = audioMix.speechCleanup.micProcessedPath;
  const cleaned = cleanedPath && cleanFailed !== `${cleanedPath}@${audioMix.speechCleanup.processedAt}` ? cleanedPath : null;
  const trackUrl = (original: string, kind: 'mic' | 'audio') => cleaned && audioMix.speechCleanup.processedTrack === kind
    ? `${window.dz.projects.mediaUrl(project.id, cleaned)}?v=${audioMix.speechCleanup.processedAt}`
    : window.dz.projects.mediaUrl(project.id, original);
  const onTrackError = (kind: 'mic' | 'audio') => () => {
    if (cleaned && audioMix.speechCleanup.processedTrack === kind) setCleanFailed(`${cleanedPath}@${audioMix.speechCleanup.processedAt}`);
  };
  const duck = useMemo(() => duckIntervals(mapCaptions(project.captions, project.clips), project.voiceoverClips), [project.captions, project.clips, project.voiceoverClips]);
  const camOffset = (project.metadata.cameraOffset ?? 0) / 1000;
  const compositor = useMemo(() => new Compositor(), []);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [source, setSource] = useState<{ width: number; height: number } | null>(null);
  const timeRef = useRef(time);
  const croppingRef = useRef(!!cropping);
  croppingRef.current = !!cropping;
  timeRef.current = time;
  const duration = totalDuration(project.clips);
  const fps = project.metadata.fps || 60;

  // Keep the compositor in sync with edits.
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    compositor.update({
      sourceWidth: source.width, sourceHeight: source.height, fps,
      cursor: project.cursorData, zooms: project.zooms, clips: project.clips, settings: project.settings,
      cursorEmbedded: project.metadata.cursorEmbedded, keyboard: project.keyboardData, blurRegions: project.blurRegions, annotations: project.annotations, captions: project.captions, threeDKeyframes: project.threeDKeyframes, textFocusRegions: project.textFocusRegions, cameraKeyframes: project.cameraKeyframes, trackSegments: project.trackSegments,
    }).then(() => { if (!cancelled) { setReady(true); draw(); } });
    return () => { cancelled = true; };
  }, [source, project.cursorData, project.keyboardData, project.zooms, project.clips, project.blurRegions, project.annotations, project.captions, project.threeDKeyframes, project.textFocusRegions, project.cameraKeyframes, project.trackSegments, project.settings]);

  // Fit the canvas to the stage at the composition's aspect ratio.
  useEffect(() => {
    const element = container.current;
    if (!element || !source) return;
    const fit = () => {
      const crop = project.settings.cropSettings;
      const r = crop.enabled ? crop.region : { x: 0, y: 0, width: 1, height: 1 };
      const design = cropping ? source : designSize(source.width * r.width, source.height * r.height, project.settings.backgroundSettings.aspectRatio);
      const box = element.getBoundingClientRect();
      const scale = Math.min((box.width - 24) / design.width, (box.height - 24) / design.height);
      setSize({ width: Math.max(1, Math.floor(design.width * scale)), height: Math.max(1, Math.floor(design.height * scale)) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [source, cropping, project.settings.backgroundSettings.aspectRatio, project.settings.cropSettings]);

  const draw = () => {
    const c = canvas.current, v = video.current;
    if (!c || !v || !source) return;
    const ctx = c.getContext('2d', { alpha: false });
    if (!ctx) return;
    const t = timeRef.current;
    if (croppingRef.current) {
      // Crop mode: the raw, uncropped frame.
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
      if (v.readyState >= 2) ctx.drawImage(v, 0, 0, c.width, c.height);
      return;
    }
    const camera = cam.current && cam.current.readyState >= 2 ? cam.current : null;
    compositor.draw(ctx, c.width, c.height, v.readyState >= 2 ? v : null, t, Math.round((t / 1000) * fps), camera);
  };

  // Redraw on size/time changes while paused; seek media to the matching source time.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.max(1, Math.round(size.width * ratio));
    c.height = Math.max(1, Math.round(size.height * ratio));
    draw();
  }, [size, cropping]);

  // Per-track edits: each audio/camera track plays its own (possibly moved) part of the recording,
  // and is silent/hidden where a piece was removed or moved away.
  const segmentsRef = useRef(project.trackSegments);
  segmentsRef.current = project.trackSegments;
  const trackTime = (track: MediaTrack, sourceSeconds: number) => {
    const at = trackSource(segmentsRef.current?.[track], sourceSeconds * 1000);
    return at === null ? null : at / 1000;
  };
  const tracks = () => [[system.current, 'system'], [mic.current, 'mic']] as Array<[HTMLAudioElement | null, MediaTrack]>;

  useEffect(() => {
    if (playing) return;
    const sourceTime = timelineToSource(time, project.clips) / 1000;
    if (video.current && Math.abs(video.current.currentTime - sourceTime) > 0.001) video.current.currentTime = sourceTime;
    for (const [el, track] of tracks()) {
      if (!el) continue;
      const at = trackTime(track, sourceTime);
      el.muted = at === null;
      if (at !== null && Math.abs(el.currentTime - at) > 0.001) el.currentTime = at;
    }
    const camAt = trackTime('camera', sourceTime);
    if (cam.current && camAt !== null) cam.current.currentTime = Math.max(0, camAt - camOffset);
    draw();
  }, [time, playing, project.clips, project.trackSegments]);

  // Playback loop: the timeline clock drives media; media is re-synced on drift or clip jumps.
  useEffect(() => {
    const v = video.current;
    if (!playing || !v) return;
    const audios = tracks().filter((a): a is [HTMLAudioElement, MediaTrack] => !!a[0] && !!a[0].src);
    let raf = 0;
    const startWall = performance.now();
    const startTime = timeRef.current >= duration - 1 ? 0 : timeRef.current;
    let rate = speed;
    const sync = (media: HTMLMediaElement, target: number) => {
      if (media.playbackRate !== rate) media.playbackRate = rate;
      if (Math.abs(media.currentTime - target) > 0.15) media.currentTime = target;
      if (media.paused) media.play().catch(() => {});
    };
    const tick = () => {
      const t = startTime + (performance.now() - startWall) * speed;
      if (t >= duration) {
        timeRef.current = duration;
        onTime(duration);
        draw();
        onEnded();
        return;
      }
      timeRef.current = t;
      rate = Math.min(16, speed * (clipAt(t, project.clips)?.speed || 1));
      const target = timelineToSource(t, project.clips) / 1000;
      sync(v, target);
      for (const [audio, track] of audios) {
        const at = trackTime(track, target);
        audio.muted = at === null;
        if (at !== null) sync(audio, at);
      }
      const camAt = trackTime('camera', target);
      if (cam.current && camAt !== null) sync(cam.current, Math.max(0, camAt - camOffset));
      // Voiceover and music follow the timeline clock (not clip speed).
      for (const clip of project.voiceoverClips) {
        const el = voices.current[clip.id];
        if (!el) continue;
        const local = t - clip.startTimeMs;
        if (local >= 0 && local < voiceoverLength(clip)) {
          el.volume = Math.min(1, clip.volume);
          if (el.playbackRate !== speed) el.playbackRate = speed;
          const want = (clip.trimStartMs + local) / 1000;
          if (Math.abs(el.currentTime - want) > 0.15) el.currentTime = want;
          if (el.paused) el.play().catch(() => {});
        } else if (!el.paused) el.pause();
      }
      const m = music.current;
      if (m && audioMix.backgroundMusicEnabled && m.duration > 0) {
        const length = m.duration * 1000;
        const local = audioMix.backgroundMusicLoop ? t % length : t;
        if (local < length) {
          m.volume = Math.min(1, audioMix.backgroundMusicVolume * (audioMix.autoDuck ? duckGain(duck, t, audioMix.autoDuckAmount) : 1));
          if (m.playbackRate !== speed) m.playbackRate = speed;
          if (Math.abs(m.currentTime - local / 1000) > 0.15) m.currentTime = local / 1000;
          if (m.paused) m.play().catch(() => {});
        } else if (!m.paused) m.pause();
      }
      draw();
      onTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      v.pause();
      for (const [audio] of audios) audio.pause();
      cam.current?.pause();
      for (const el of Object.values(voices.current)) el?.pause();
      music.current?.pause();
    };
  }, [playing, speed, duration, project.clips, project.voiceoverClips, audioMix, duck]);

  useEffect(() => {
    if (system.current) system.current.volume = Math.min(1, project.settings.audioSettings.systemVolume);
    if (mic.current) mic.current.volume = Math.min(1, project.settings.audioSettings.micVolume);
  }, [project.settings.audioSettings]);

  return (
    <div className="stage-inner" ref={container}>
      {!ready && <div className="loading"><div className="spinner" />Loading recording…</div>}
      <canvas ref={canvas} style={{ width: size.width, height: size.height, display: ready ? 'block' : 'none', cursor: picking ? 'crosshair' : 'default' }}
        onClick={e => {
          if (!picking || !onPick || !canvas.current) return;
          const box = canvas.current.getBoundingClientRect();
          const scale = canvas.current.width / box.width;
          const point = compositor.toMedia((e.clientX - box.left) * scale, (e.clientY - box.top) * scale, canvas.current.width, timeRef.current, Math.round((timeRef.current / 1000) * fps));
          if (point) onPick(point);
        }} />
      {drawTemplate && ready && onDraw && source && (
        <div style={{ position: 'absolute', width: size.width, height: size.height }}>
          <DrawLayer width={size.width} height={size.height} template={drawTemplate} onCreate={onDraw}
            designWidth={designSize(source.width * (project.settings.cropSettings.enabled ? project.settings.cropSettings.region.width : 1), source.height * (project.settings.cropSettings.enabled ? project.settings.cropSettings.region.height : 1), project.settings.backgroundSettings.aspectRatio).width} />
        </div>
      )}
      {editRegion && ready && onEditRegion && (
        <div style={{ position: 'absolute', width: size.width, height: size.height }}>
          <CropOverlay region={editRegion} width={size.width} height={size.height} sourceAspect={source ? source.width / source.height : 16 / 9} aspect={null}
            onChange={onEditRegion} onStart={() => onCropStart?.()} />
        </div>
      )}
      {cropMode && ready && onCropChange && (
        <div style={{ position: 'absolute', width: size.width, height: size.height }}>
          <CropOverlay region={project.settings.cropSettings.enabled ? project.settings.cropSettings.region : { x: 0, y: 0, width: 1, height: 1 }}
            width={size.width} height={size.height} sourceAspect={source ? source.width / source.height : 16 / 9} aspect={cropAspect ?? null}
            onChange={onCropChange} onStart={() => onCropStart?.()} />
        </div>
      )}
      <video ref={video} src={window.dz.projects.mediaUrl(project.id, 'screen.mp4')} muted preload="auto" crossOrigin="anonymous" playsInline style={{ display: 'none' }}
        onLoadedMetadata={e => setSource({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
        onSeeked={draw} onLoadedData={draw} />
      {project.files.camera && <video ref={cam} src={window.dz.projects.mediaUrl(project.id, 'camera.mp4')} muted preload="auto" crossOrigin="anonymous" playsInline style={{ display: 'none' }} onSeeked={draw} onLoadedData={draw} />}
      {project.voiceoverClips.map(clip => <audio key={clip.id} ref={el => { voices.current[clip.id] = el; }} src={window.dz.projects.mediaUrl(project.id, clip.audioPath)} preload="auto" />)}
      {audioMix.backgroundMusicEnabled && audioMix.backgroundMusicPath && <audio ref={music} src={window.dz.projects.mediaUrl(project.id, audioMix.backgroundMusicPath)} preload="auto" />}
      {project.files.audio && <audio ref={system} src={trackUrl('audio.wav', 'audio')} onError={onTrackError('audio')} preload="auto" />}
      {project.files.mic && <audio ref={mic} src={trackUrl('mic.wav', 'mic')} onError={onTrackError('mic')} preload="auto" />}
    </div>
  );
}
