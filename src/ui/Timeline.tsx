import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { AudioLines, Box, Captions, Eye, EyeOff, Highlighter, Mic, MicOff, Monitor, ScanSearch, Video, Volume2, VolumeX, X, Droplets } from 'lucide-react';
import { clipEnd, clipLength, sourceToTimeline, timelineToSource } from '../timeline';
import { annotationKind, assignLanes, itemNames } from '../lanes';
import { trackPieces, type MediaTrack, type TrackSegments } from '../trackSegments';
export type { MediaTrack };
import type { Annotation, BlurRegion, Caption, Clip, VoiceoverClip, ZoomRegion } from '../types';

export type ItemKind = 'zoom' | 'blur' | 'annotation' | 'threeD' | 'voiceover';

type Props = {
  duration: number; // timeline ms
  sourceDuration: number;
  time: number;
  clips: Clip[];
  zooms: ZoomRegion[]; // source time
  scale: number; // horizontal zoom (1 = fit)
  selectedClip: string | null;
  selectedZoom: string | null;
  onSeek: (time: number) => void;
  /** `additive` (Ctrl+click) toggles the clip in the selection instead of replacing it. */
  onSelectClip: (id: string | null, additive?: boolean) => void;
  onSelectZoom: (id: string | null) => void;
  onTrimClip: (id: string, edge: 'start' | 'end', sourceTime: number) => void;
  onZoomChange: (zoom: ZoomRegion, commit: boolean) => void;
  onZoomAdd: (time: number) => void;
  onZoomRemove: (id: string) => void;
  onDragStart: () => void;
  blurs?: BlurRegion[];
  selectedBlur?: string | null;
  onSelectBlur?: (id: string | null) => void;
  onBlurChange?: (blur: BlurRegion) => void;
  onBlurRemove?: (id: string) => void;
  annotations?: Annotation[];
  selectedAnnotation?: string | null;
  onSelectAnnotation?: (id: string | null) => void;
  onAnnotationChange?: (annotation: Annotation) => void;
  onAnnotationRemove?: (id: string) => void;
  /** Captions already mapped onto the timeline. */
  captions?: Caption[];
  voiceovers?: VoiceoverClip[];
  /** 3D regions on the timeline (ms). */
  threeD?: Array<{ id: string; name?: string; start: number; end: number }>;
  selectedThreeD?: string | null;
  onSelectThreeD?: (id: string | null) => void;
  onThreeDChange?: (id: string, start: number, end: number) => void;
  selectedVoiceover?: string | null;
  onSelectVoiceover?: (id: string | null) => void;
  onVoiceoverMove?: (id: string, startTimeMs: number) => void;
  /** Which recorded tracks exist, their waveforms (100 peaks per source second) and state. */
  media?: { camera: boolean; system: boolean; mic: boolean };
  systemPeaks?: Uint8Array | null;
  micPeaks?: Uint8Array | null;
  muted?: { system: boolean; mic: boolean; camera: boolean };
  onToggleTrack?: (track: MediaTrack) => void;
  onRename?: (kind: ItemKind, id: string, name: string) => void;
  /** A camera or audio lane was clicked (opens that track's settings). */
  onSelectMedia?: (track: MediaTrack) => void;
  /** Per-track splits (camera, system audio, microphone) and the selected pieces. */
  trackSegments?: TrackSegments;
  selectedTracks?: Array<{ track: MediaTrack; id: string }>;
  onSelectTrack?: (track: MediaTrack | null, id: string | null, additive: boolean) => void;
  /** Drag a camera/audio piece in time (`offset` ms from its recorded position). */
  onMoveTrack?: (track: MediaTrack, id: string, offset: number) => void;
  /** Drag a screen clip to a new place in the order. */
  onReorderClip?: (id: string, index: number) => void;
};

const HEADER = 168;
const LANE = 28;
const LANE_GAP = 4;

function tickStep(pxPerMs: number) {
  const steps = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
  return steps.find(step => step * pxPerMs >= 70) ?? 600000;
}
const label = (ms: number, step: number) => {
  const s = ms / 1000;
  if (step < 1000) return `${s.toFixed(1)}s`;
  if (s >= 60) return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  return `${Math.round(s)}s`;
};

/** The clip's slice of a waveform (peaks: 100 per second of source). */
function ClipWave({ peaks, from, to, width, height, color }: { peaks: Uint8Array; from: number; to: number; width: number; height: number; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(width * ratio)), h = Math.round(height * ratio);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    const first = from / 10, span = Math.max(1, (to - from) / 10);
    for (let px = 0; px < w; px++) {
      const a = Math.floor(first + (px / w) * span), b = Math.max(a + 1, Math.floor(first + ((px + 1) / w) * span));
      let peak = 0;
      for (let i = a; i < b && i < peaks.length; i++) peak = Math.max(peak, peaks[i]);
      const bar = (peak / 255) * h * 0.86;
      ctx.fillRect(px, (h - bar) / 2, 1, Math.max(ratio, bar));
    }
  }, [peaks, from, to, width, height, color]);
  return <canvas ref={ref} className="clip-wave" style={{ width, height }} />;
}

/** One timeline item drawn on a lane: a time range with a name, resize handles and remove. */
type Region = { id: string; start: number; end: number; name: string; detail?: string; title?: string };

export function Timeline(props: Props) {
  const { duration, time, clips, zooms, scale } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [editing, setEditing] = useState<{ kind: ItemKind; id: string } | null>(null);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(200, element.clientWidth - HEADER));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  const inner = Math.max(width, width * scale);
  const pxPerMs = inner / Math.max(1, duration);
  const x = (ms: number) => ms * pxPerMs;
  const step = tickStep(pxPerMs);
  const ticks = useMemo(() => {
    const list: Array<{ at: number; major: boolean }> = [];
    for (let at = 0; at <= duration; at += step / 5) list.push({ at, major: Math.round(at / (step / 5)) % 5 === 0 });
    return list;
  }, [duration, step]);

  const toTimeline = (sourceMs: number) => sourceToTimeline(sourceMs, clips) ?? nearest(sourceMs, clips);

  const toTime = (clientX: number) => {
    const box = scroller.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (clientX - box.left - HEADER + scroller.current!.scrollLeft) / pxPerMs));
  };

  const drag = (event: ReactPointerEvent, move: (time: number, dx: number) => void, done: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const target = event.currentTarget as HTMLElement;
    try { target.setPointerCapture(event.pointerId); } catch {}
    const onMove = (e: PointerEvent) => move(toTime(e.clientX), (e.clientX - startX) / pxPerMs);
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      done();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  const scrub = (event: ReactPointerEvent) => {
    props.onSeek(toTime(event.clientX));
    drag(event, t => props.onSeek(t), () => {});
  };

  const deselectOthers = (keep: ItemKind | 'clip') => {
    if (keep !== 'clip') props.onSelectTrack?.(null, null, false);
    if (keep !== 'zoom') props.onSelectZoom(null);
    if (keep !== 'clip') props.onSelectClip(null);
    if (keep !== 'blur') props.onSelectBlur?.(null);
    if (keep !== 'annotation') props.onSelectAnnotation?.(null);
    if (keep !== 'threeD') props.onSelectThreeD?.(null);
    if (keep !== 'voiceover') props.onSelectVoiceover?.(null);
  };

  // ---- Items per track (timeline ms) ----
  const zoomNames = useMemo(() => itemNames(zooms, () => 'Zoom'), [zooms]);
  const zoomRegions: Region[] = zooms.map(z => ({ id: z.id, start: toTimeline(z.start), end: toTimeline(z.end), name: zoomNames.get(z.id)!, detail: `${Math.round(z.scale * 10) / 10}×` }))
    .filter(r => r.end - r.start > 1);
  const blurs = props.blurs ?? [];
  const blurNames = useMemo(() => itemNames(blurs, () => 'Blur'), [blurs]);
  const blurRegions: Region[] = blurs.map(b => ({ id: b.id, start: toTimeline(b.start), end: toTimeline(b.end), name: blurNames.get(b.id)! })).filter(r => r.end - r.start > 1);
  const notes = props.annotations ?? [];
  const noteNames = useMemo(() => itemNames(notes, n => annotationKind(n.shape)), [notes]);
  const noteRegions: Region[] = notes.map(n => ({ id: n.id, start: n.startMs, end: n.endMs, name: noteNames.get(n.id)! }));
  const threeD = props.threeD ?? [];
  const threeNames = useMemo(() => itemNames(threeD, () => '3D'), [threeD]);
  const threeRegions: Region[] = threeD.map(r => ({ id: r.id, start: r.start, end: r.end, name: threeNames.get(r.id)! }));
  const voices = props.voiceovers ?? [];
  const voiceNames = useMemo(() => itemNames(voices, v => v.voiceName.split(' - ')[0] || 'Voiceover'), [voices]);
  const voiceRegions: Region[] = voices.map(v => ({ id: v.id, start: v.startTimeMs, end: v.startTimeMs + Math.max(0, v.trimEndMs - v.trimStartMs), name: voiceNames.get(v.id)!, title: v.script }));

  /** A track of named regions; overlapping regions are placed on separate lanes. */
  const regionTrack = (kind: ItemKind, regions: Region[], opts: {
    cls: string; selected?: string | null; onSelect?: (id: string | null) => void;
    onChange?: (id: string, start: number, end: number, region: Region) => void;
    onRemove?: (id: string) => void; resizable?: boolean; minLength?: number;
    onEmptyDoubleClick?: (time: number) => void; placeholder?: string;
  }) => {
    const { lane, count } = assignLanes(regions);
    const height = count * (LANE + LANE_GAP) + LANE_GAP;
    return (
      <div className="tl-lanes" style={{ height }}
        onDoubleClick={e => { if (e.target === e.currentTarget) opts.onEmptyDoubleClick?.(toTime(e.clientX)); }}
        onPointerDown={e => { if (e.target === e.currentTarget) { opts.onSelect?.(null); scrub(e); } }}>
        {regions.length === 0 && opts.placeholder && <div className="tl-placeholder">{opts.placeholder}</div>}
        {regions.map(region => {
          const { start, end } = region;
          const min = opts.minLength ?? 200;
          const move = (mode: 'move' | 'start' | 'end') => (e: ReactPointerEvent) => {
            if (e.button !== 0) return;
            opts.onSelect?.(region.id);
            deselectOthers(kind);
            if (!opts.onChange) { e.stopPropagation(); return; }
            props.onDragStart();
            drag(e, (_t, dx) => {
              let s = start, en = end;
              if (mode === 'move') { const shift = Math.max(-start, Math.min(duration - end, dx)); s += shift; en += shift; }
              if (mode === 'start') s = Math.min(Math.max(0, start + dx), end - min);
              if (mode === 'end') en = Math.max(Math.min(duration, end + dx), start + min);
              opts.onChange!(region.id, s, en, region);
            }, () => {});
          };
          const w = Math.max(14, x(end - start) - 2);
          const isEditing = editing?.kind === kind && editing.id === region.id;
          return (
            <div key={region.id} className={`tl-item ${opts.cls}${opts.selected === region.id ? ' selected' : ''}`} title={region.title ?? region.name}
              style={{ left: x(start) + 1, width: w, top: LANE_GAP + (lane.get(region.id) ?? 0) * (LANE + LANE_GAP), height: LANE }}
              onPointerDown={move('move')}
              onDoubleClick={e => { e.stopPropagation(); if (props.onRename) setEditing({ kind, id: region.id }); }}>
              {isEditing ? (
                <input className="tl-rename" autoFocus defaultValue={region.name} onPointerDown={e => e.stopPropagation()}
                  onKeyDown={e => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditing(null);
                    e.stopPropagation();
                  }}
                  onBlur={e => { const name = e.target.value.trim(); if (editing && name && name !== region.name) props.onRename?.(kind, region.id, name); setEditing(null); }} />
              ) : w > 34 && (
                <span className="tl-item-label">{region.name}{region.detail && w > 90 ? <span className="tl-item-detail">{region.detail}</span> : null}</span>
              )}
              {opts.resizable !== false && opts.onChange && <span className="handle l" onPointerDown={move('start')} />}
              {opts.resizable !== false && opts.onChange && <span className="handle r" onPointerDown={move('end')} />}
              {opts.onRemove && (
                <button className="remove" aria-label={`Remove ${region.name}`} onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); opts.onRemove!(region.id); }}><X size={11} /></button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const additive = (e: ReactPointerEvent) => e.ctrlKey || e.metaKey;
  const [clipDrag, setClipDrag] = useState<{ id: string; dx: number } | null>(null);
  const isSelectedTrack = (track: MediaTrack, id: string) => !!props.selectedTracks?.some(s => s.track === track && s.id === id);

  /** The screen track: the recording's clips (cuts here apply to every track). */
  const videoLane = (height: number) => (
    <div className="tl-lanes" style={{ height }} onPointerDown={e => { if (e.target === e.currentTarget) { props.onSelectClip(null); props.onSelectTrack?.(null, null, false); scrub(e); } }}>
      {clips.map(clip => {
        const w = Math.max(4, x(clipLength(clip)) - 2);
        return (
          <div key={clip.id} className={`clip clip-video${props.selectedClip === clip.id ? ' selected' : ''}${clipDrag?.id === clip.id ? ' dragging' : ''}`}
            style={{ left: x(clip.timelineStart) + 1, width: w, top: 3, bottom: 3, transform: clipDrag?.id === clip.id ? `translateX(${x(clipDrag.dx)}px)` : undefined }}
            onPointerDown={e => {
              if (additive(e)) { props.onSelectClip(clip.id, true); e.stopPropagation(); return; }
              if (e.button !== 0) return;
              deselectOthers('clip');
              props.onSelectClip(clip.id);
              props.onSeek(toTime(e.clientX));
              // Drag to reorder: drop position decides the clip's new place in the order.
              let dx = 0;
              drag(e, (_t, d) => { dx = d; if (Math.abs(d * pxPerMs) > 4) setClipDrag({ id: clip.id, dx: d }); }, () => {
                setClipDrag(null);
                if (Math.abs(dx * pxPerMs) <= 4 || clips.length < 2) return;
                const center = clip.timelineStart + clipLength(clip) / 2 + dx;
                const index = clips.filter(c => c.id !== clip.id && c.timelineStart + clipLength(c) / 2 < center).length;
                props.onReorderClip?.(clip.id, index);
              });
            }}>
            <span className="clip-label">{w > 60 ? `${Math.round(clipLength(clip) / 100) / 10}s${(clip.speed || 1) !== 1 ? ` · ${clip.speed}×` : ''}` : ''}</span>
            <span className="handle l" onPointerDown={e => { props.onDragStart(); drag(e, (_t, dx) => props.onTrimClip(clip.id, 'start', clip.sourceStart + dx * (clip.speed || 1)), () => {}); }} />
            <span className="handle r" onPointerDown={e => { props.onDragStart(); drag(e, (_t, dx) => props.onTrimClip(clip.id, 'end', clip.sourceEnd + dx * (clip.speed || 1)), () => {}); }} />
          </div>
        );
      })}
    </div>
  );

  /** Camera / system audio / microphone: the track's own segments on top of the screen's cuts. */
  const mediaLane = (kind: MediaTrack, height: number, peaks?: Uint8Array | null) => {
    const pieces = trackPieces(props.trackSegments?.[kind], props.sourceDuration, clips);
    return (
      <div className="tl-lanes" style={{ height }} onPointerDown={e => { if (e.target === e.currentTarget) { props.onSelectTrack?.(null, null, false); scrub(e); } }}>
        {pieces.map(piece => {
          const w = Math.max(4, x(piece.end - piece.start) - 2);
          const muted = props.muted?.[kind];
          const selected = isSelectedTrack(kind, piece.id);
          return (
            <div key={`${piece.id}-${piece.start}`} className={`clip clip-${kind}${selected ? ' selected' : ''}${muted ? ' muted' : ''}${piece.enabled ? '' : ' removed'}`}
              title={piece.enabled ? undefined : 'Removed from this track (Ctrl+Z to undo)'}
              style={{ left: x(piece.start) + 1, width: w, top: 3, bottom: 3 }}
              onPointerDown={e => {
                if (additive(e)) { props.onSelectTrack?.(kind, piece.id, true); e.stopPropagation(); return; }
                if (e.button !== 0) return;
                deselectOthers('clip');
                props.onSelectClip(null);
                props.onSelectTrack?.(kind, piece.id, false);
                props.onSelectMedia?.(kind);
                props.onSeek(toTime(e.clientX));
                if (!piece.enabled || !props.onMoveTrack) return;
                // Drag to move this piece in time (it never overlaps the track's other pieces).
                const startOffset = props.trackSegments?.[kind]?.find(s => s.id === piece.id)?.offset ?? 0;
                let moved = false;
                drag(e, (_t, dx) => {
                  if (!moved && Math.abs(dx * pxPerMs) <= 4) return;
                  if (!moved) { moved = true; props.onDragStart(); }
                  props.onMoveTrack!(kind, piece.id, startOffset + dx * piece.speed);
                }, () => {});
              }}>
              {piece.enabled && peaks && <ClipWave peaks={peaks} from={piece.sourceStart} to={piece.sourceEnd} width={w} height={height - 6} color={kind === 'mic' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.45)'} />}
            </div>
          );
        })}
      </div>
    );
  };

  const toggle = (track: MediaTrack, on: ReactNode, off: ReactNode, what: string) => {
    const muted = props.muted?.[track];
    return (
      <button className={`tl-toggle${muted ? ' off' : ''}`} title={`${muted ? 'Show' : 'Hide'} ${what}`} aria-pressed={!muted}
        onPointerDown={e => e.stopPropagation()} onClick={() => props.onToggleTrack?.(track)}>{muted ? off : on}</button>
    );
  };

  const row = (key: string, icon: ReactNode, name: string, body: ReactNode, extra?: ReactNode, count?: number) => (
    <div className="tl-row" key={key}>
      <div className="tl-head">
        <span className="tl-icon">{icon}</span>
        <span className="tl-name">{name}</span>
        {count ? <span className="tl-count">{count}</span> : null}
        {extra}
      </div>
      <div className="tl-body" style={{ width: inner }}>{body}</div>
    </div>
  );

  const media = props.media ?? { camera: false, system: false, mic: false };
  const muteLabel = (track: 'system' | 'mic') => (track === 'mic' ? 'microphone' : 'system audio');

  return (
    <div className="timeline" ref={scroller}>
      <div className="tl-content" style={{ width: HEADER + inner }}>
        <div className="tl-row tl-ruler-row">
          <div className="tl-head tl-corner" />
          <div className="ruler" style={{ width: inner }} onPointerDown={scrub}>
            {ticks.map(t => (
              <div key={t.at} className={`tick${t.major ? '' : ' minor'}`} style={{ left: x(t.at) }}>{t.major ? label(t.at, step) : ''}</div>
            ))}
            <div className="ruler-playhead" style={{ left: x(time) }} />
          </div>
        </div>

        {row('video', <Monitor size={14} />, 'Screen', videoLane(46))}
        {media.camera && row('camera', <Video size={14} />, 'Camera', mediaLane('camera', 28), toggle('camera', <Eye size={13} />, <EyeOff size={13} />, 'camera'))}
        {media.system && row('system', <Volume2 size={14} />, 'System audio', mediaLane('system', 34, props.systemPeaks),
          <button className={`tl-toggle${props.muted?.system ? ' off' : ''}`} title={props.muted?.system ? `Unmute ${muteLabel('system')}` : `Mute ${muteLabel('system')}`}
            aria-pressed={!props.muted?.system} onPointerDown={e => e.stopPropagation()} onClick={() => props.onToggleTrack?.('system')}>
            {props.muted?.system ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>)}
        {media.mic && row('mic', <Mic size={14} />, 'Microphone', mediaLane('mic', 34, props.micPeaks),
          <button className={`tl-toggle${props.muted?.mic ? ' off' : ''}`} title={props.muted?.mic ? `Unmute ${muteLabel('mic')}` : `Mute ${muteLabel('mic')}`}
            aria-pressed={!props.muted?.mic} onPointerDown={e => e.stopPropagation()} onClick={() => props.onToggleTrack?.('mic')}>
            {props.muted?.mic ? <MicOff size={13} /> : <Mic size={13} />}</button>)}

        {row('zoom', <ScanSearch size={14} />, 'Zooms', regionTrack('zoom', zoomRegions, {
          cls: 'tl-zoom', selected: props.selectedZoom, onSelect: props.onSelectZoom, minLength: 300,
          onChange: (id, s, en) => { const zoom = zooms.find(z => z.id === id); if (zoom) props.onZoomChange({ ...zoom, start: timelineToSource(s, clips), end: timelineToSource(en, clips), source: 'manual' }, false); },
          onRemove: props.onZoomRemove, onEmptyDoubleClick: props.onZoomAdd, placeholder: 'Double-click to add a zoom',
        }), undefined, zoomRegions.length)}
        {blurRegions.length > 0 && row('blur', <Droplets size={14} />, 'Blur', regionTrack('blur', blurRegions, {
          cls: 'tl-blur', selected: props.selectedBlur, onSelect: props.onSelectBlur, onRemove: props.onBlurRemove,
          onChange: (id, s, en) => { const blur = blurs.find(b => b.id === id); if (blur) props.onBlurChange?.({ ...blur, start: timelineToSource(s, clips), end: timelineToSource(en, clips) }); },
        }), undefined, blurRegions.length)}
        {noteRegions.length > 0 && row('annotation', <Highlighter size={14} />, 'Annotations', regionTrack('annotation', noteRegions, {
          cls: 'tl-note', selected: props.selectedAnnotation, onSelect: props.onSelectAnnotation, onRemove: props.onAnnotationRemove,
          onChange: (id, s, en) => { const note = notes.find(n => n.id === id); if (note) props.onAnnotationChange?.({ ...note, startMs: s, endMs: en }); },
        }), undefined, noteRegions.length)}
        {threeRegions.length > 0 && row('threeD', <Box size={14} />, '3D', regionTrack('threeD', threeRegions, {
          cls: 'tl-three', selected: props.selectedThreeD, onSelect: props.onSelectThreeD,
          onChange: props.onThreeDChange ? (id, s, en) => props.onThreeDChange!(id, s, en) : undefined,
        }), undefined, threeRegions.length)}
        {voiceRegions.length > 0 && row('voiceover', <AudioLines size={14} />, 'Voiceover', regionTrack('voiceover', voiceRegions, {
          cls: 'tl-voice', selected: props.selectedVoiceover, onSelect: props.onSelectVoiceover, resizable: false,
          onChange: props.onVoiceoverMove ? (id, s) => props.onVoiceoverMove!(id, Math.max(0, Math.min(duration - 100, s))) : undefined,
        }), undefined, voiceRegions.length)}
        {props.captions && props.captions.length > 0 && row('captions', <Captions size={14} />, 'Captions', (
          <div className="tl-lanes caption-lane">
            {props.captions.map(c => (
              <div key={c.id} className="caption-chip" title={c.text} style={{ left: x(c.startMs), width: Math.max(3, x(c.endMs - c.startMs) - 1) }}
                onPointerDown={e => { e.stopPropagation(); props.onSeek(c.startMs + 1); }}>{x(c.endMs - c.startMs) > 50 ? c.text : ''}</div>
            ))}
          </div>
        ), undefined, props.captions.length)}

        <div className="playhead" style={{ left: HEADER + x(time) - 1 }} />
      </div>
    </div>
  );
}

function nearest(t: number, clips: Clip[]) {
  for (const clip of clips) if (t < clip.sourceStart) return clip.timelineStart;
  const last = clips[clips.length - 1];
  return last ? clipEnd(last) : 0;
}
