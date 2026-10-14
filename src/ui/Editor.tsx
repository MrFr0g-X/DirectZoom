import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { X, ArrowLeft, AudioLines, Box, Camera, Captions as CaptionsIcon, Crop as CropIcon, Crosshair, EyeOff, Keyboard, PenLine, Minus, MousePointer2, Palette, Pause, Play, Plus, Redo2, Scissors, Sparkles, Trash2, Undo2, Upload, Volume2 } from 'lucide-react';
import { navigate } from '../App';
import { autoZooms } from '../settings';
import { exportProject, type ExportOptions } from '../exporter';
import { mapZooms, moveClip, sourceToTimeline, removeClip, splitAt, timelineToSource, totalDuration, trimClip, setClipSpeed, clipLength } from '../timeline';
import type { Annotation, BlurRegion, ZoomRegion } from '../types';
import { formatTime, Segmented, Slider } from './controls';
import { ExportDialog } from './ExportDialog';
import { AnnotatePanel, AnnotationEditPanel, AudioPanel, BackgroundPanel, CameraPanel, CursorPanel, KeyboardPanel, MotionPanel, TextFocusSection } from './Panels';
import { regionsFromEvents } from '../textFocus';
import { Preview } from './Preview';
import { ThreeDPanel } from './ThreeDPanel';
import { BrandMenu } from './BrandMenu';
import { CaptionsPanel, MusicSection, SpeechSection, VoiceoverPanel, moveVoiceover } from './AiPanels';
import { mapCaptions } from '../captions';
import { Timeline, type ItemKind, type MediaTrack } from './Timeline';
import { moveSegment, removeSegment, splitTrack } from '../trackSegments';
import { WindowControls } from './TitleBar';
import { useEditor } from './useEditor';

type PanelId = 'background' | 'cursor' | 'camera' | 'motion' | 'threeD' | 'captions' | 'voiceover' | 'keyboard' | 'audio';
const panels: Array<{ id: PanelId; label: string; icon: ReactElement }> = [
  { id: 'background', label: 'Background', icon: <Palette size={17} /> },
  { id: 'cursor', label: 'Cursor', icon: <MousePointer2 size={17} /> },
  { id: 'camera', label: 'Camera', icon: <Camera size={17} /> },
  { id: 'motion', label: 'Motion', icon: <Sparkles size={17} /> },
  { id: 'threeD', label: '3D', icon: <Box size={17} /> },
  { id: 'captions', label: 'Captions', icon: <CaptionsIcon size={17} /> },
  { id: 'voiceover', label: 'Voiceover', icon: <AudioLines size={17} /> },
  { id: 'keyboard', label: 'Keyboard', icon: <Keyboard size={17} /> },
  { id: 'audio', label: 'Audio', icon: <Volume2 size={17} /> },
];

let zoomCounter = 0;

export function Editor({ projectId }: { projectId: string }) {
  const editor = useEditor(projectId);
  const { project, update, setSettings, undo, redo, checkpoint } = editor;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [panel, setPanel] = useState<PanelId>(() => (localStorage.getItem('directzoom.panel') as PanelId) || 'background');
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  // Selected pieces of the camera / system audio / microphone tracks (Ctrl+click adds more).
  const [trackSel, setTrackSel] = useState<Array<{ track: MediaTrack; id: string }>>([]);
  const [selectedZoom, setSelectedZoom] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [selectedBlur, setSelectedBlur] = useState<string | null>(null);
  const [editingBlur, setEditingBlur] = useState(false);
  const [drawingMode, setDrawingMode] = useState(false);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [selected3d, setSelected3d] = useState<string | null>(null);
  const [selectedCamKey, setSelectedCamKey] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<{ mic: Uint8Array | null; audio: Uint8Array | null }>({ mic: null, audio: null });
  const unmutedVolume = useRef({ system: 1, mic: 1 });
  const [notices, setNotices] = useState<string[]>(() => {
    try {
      const raw = sessionStorage.getItem(`dz.notices.${projectId}`);
      sessionStorage.removeItem(`dz.notices.${projectId}`);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  useEffect(() => {
    let alive = true;
    for (const track of ['mic', 'audio'] as const) window.dz.audioPeaks(projectId, track).then(p => { if (alive) setPeaks(old => ({ ...old, [track]: p })); }).catch(() => {});
    return () => { alive = false; };
  }, [projectId]);
  // Timeline track headers: mute system/mic audio (remembering the volume) and show/hide the camera.
  const toggleTrack = (track: 'system' | 'mic' | 'camera') => {
    if (!project) return;
    if (track === 'camera') { setSettings('cameraSettings', { visible: !project.settings.cameraSettings.visible }); return; }
    const key = track === 'system' ? 'systemVolume' : 'micVolume';
    const volume = project.settings.audioSettings[key];
    if (volume > 0) unmutedVolume.current[track] = volume;
    setSettings('audioSettings', { [key]: volume > 0 ? 0 : unmutedVolume.current[track] || 1 });
  };
  const renameItem = (kind: ItemKind, id: string, name: string) => {
    if (!project) return;
    const rename = <T extends { id: string; name?: string }>(items: T[]) => items.map(item => (item.id === id ? { ...item, name } : item));
    if (kind === 'zoom') update({ zooms: rename(project.zooms) });
    if (kind === 'blur') update({ blurRegions: rename(project.blurRegions) });
    if (kind === 'annotation') update({ annotations: rename(project.annotations) });
    if (kind === 'threeD') update({ threeDKeyframes: rename(project.threeDKeyframes) });
    if (kind === 'voiceover') update({ voiceoverClips: rename(project.voiceoverClips) });
  };
  const timelineCaptions = useMemo(() => (project ? mapCaptions(project.captions, project.clips) : []), [project?.captions, project?.clips]);
  const [cropAspect, setCropAspect] = useState<number | null>(null);
  const [timelineScale, setTimelineScale] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => { try { localStorage.setItem('directzoom.panel', panel); } catch {} }, [panel]);
  // Scriptable export for automated end-to-end checks (no save dialog).
  useEffect(() => {
    if (!project) return;
    (window as any).__directzoomTest = {
      project: () => project,
      export: (output: string, options: Partial<ExportOptions> = {}, override: Partial<typeof project> = {}) =>
        exportProject({ ...project, ...override }, { format: 'mp4', height: 'original', fps: 60, quality: 'high', output, ...options }, (stage, progress) => { (window as any).__exportProgress = { stage, progress }; }, new AbortController().signal),
    };
  }, [project]);
  useEffect(() => { if (project) setName(project.metadata.name); }, [project?.metadata.name]);

  const duration = project ? totalDuration(project.clips) : 0;
  const zoom = project?.zooms.find(z => z.id === selectedZoom) ?? null;
  const blur = project?.blurRegions.find(b => b.id === selectedBlur) ?? null;
  const note = project?.annotations.find(a => a.id === selectedNote) ?? null;
  const clip = project?.clips.find(c => c.id === selectedClip) ?? null;
  const autoCount = useMemo(() => project ? autoZooms(project.cursorData, project.settings.zoomSettings, project.metadata.duration).length : 0,
    [project?.cursorData, project?.settings.zoomSettings]);

  const seek = useCallback((t: number) => { setPlaying(false); setTime(Math.max(0, Math.min(duration, t))); }, [duration]);
  const togglePlay = useCallback(() => setPlaying(p => { if (!p && time >= duration - 1) setTime(0); return !p; }), [time, duration]);

  // Split at the playhead: only the selected tracks, or every track when nothing is selected.
  const split = useCallback(() => {
    if (!project) return;
    const source = timelineToSource(time, project.clips);
    const sourceDuration = project.metadata.duration;
    const allTracks = (['camera', 'system', 'mic'] as const).filter(t => (t === 'camera' ? project.files.camera : t === 'system' ? project.files.audio : project.files.mic));
    const nothingSelected = !selectedClip && trackSel.length === 0;
    const tracks: MediaTrack[] = nothingSelected ? [...allTracks] : [...new Set(trackSel.map(s => s.track))];
    const trackSegments = { ...project.trackSegments };
    for (const track of tracks) trackSegments[track] = splitTrack(trackSegments[track], sourceDuration, source);
    update({ ...(nothingSelected || selectedClip ? { clips: splitAt(project.clips, time) } : {}), trackSegments });
    setTrackSel([]);
  }, [project, time, update, selectedClip, trackSel]);
  const deleteSelection = useCallback(() => {
    if (!project) return;
    if (selectedZoom) { update({ zooms: project.zooms.filter(z => z.id !== selectedZoom) }); setSelectedZoom(null); return; }
    if (selectedNote) { update({ annotations: project.annotations.filter(a => a.id !== selectedNote) }); setSelectedNote(null); return; }
    if (selectedBlur) { update({ blurRegions: project.blurRegions.filter(b => b.id !== selectedBlur) }); setSelectedBlur(null); setEditingBlur(false); return; }
    // Track pieces are removed from their own track only (silent / hidden there).
    if (trackSel.length) {
      const trackSegments = { ...project.trackSegments };
      for (const { track, id } of trackSel) trackSegments[track] = removeSegment(trackSegments[track], project.metadata.duration, id);
      const clips = selectedClip && project.clips.length > 1 ? removeClip(project.clips, selectedClip) : project.clips;
      update({ trackSegments, clips });
      setTrackSel([]);
      if (clips !== project.clips) { setSelectedClip(null); setTime(t => Math.min(t, totalDuration(clips))); }
      return;
    }
    if (selectedClip && project.clips.length > 1) {
      const clips = removeClip(project.clips, selectedClip);
      update({ clips });
      setSelectedClip(null);
      setTime(t => Math.min(t, totalDuration(clips)));
    }
  }, [project, selectedClip, selectedZoom, selectedBlur, selectedNote, trackSel, update]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
      else if (e.key.toLowerCase() === 's' && !e.ctrlKey) split();
      else if (e.key === 'ArrowLeft') seek(time - (e.shiftKey ? 1000 : 1000 / 30));
      else if (e.key === 'ArrowRight') seek(time + (e.shiftKey ? 1000 : 1000 / 30));
      else if (e.key === 'Escape') { setPicking(false); setSelectedZoom(null); setSelectedClip(null); setSelectedBlur(null); setEditingBlur(false); setCropping(false); setDrawingMode(false); setSelectedNote(null); setTrackSel([]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, undo, redo, deleteSelection, split, seek, time]);

  if (editor.error) return <div className="app"><header className="titlebar"><button className="icon-btn" onClick={() => navigate('/library')}><ArrowLeft size={17} /></button><div className="spacer" /><WindowControls /></header><div className="empty" style={{ margin: 40 }}><h3>Could not open this recording</h3>{editor.error}</div></div>;
  if (!project) return <div className="app"><header className="titlebar"><div className="spacer" /><WindowControls /></header><div style={{ flex: 1, display: 'grid', placeItems: 'center' }}><div className="loading"><div className="spinner" />Opening…</div></div></div>;

  const changeZoom = (next: ZoomRegion, record = false) => update({ zooms: project.zooms.map(z => (z.id === next.id ? next : z)) }, record);
  const addZoom = (at: number) => {
    const sourceAt = timelineToSource(at, project.clips);
    // Focus where the cursor was at that moment.
    let focus = { x: 0.5, y: 0.5 };
    for (const event of project.cursorData) { if (event.t > sourceAt) break; if (event.visible !== false) focus = { x: event.x, y: event.y }; }
    const region: ZoomRegion = {
      id: `zoom-${Date.now().toString(36)}-${zoomCounter++}`, start: Math.max(0, sourceAt - 1500), end: Math.min(project.metadata.duration, sourceAt + 1500),
      scale: project.settings.zoomSettings.defaultScale, focus, source: 'manual',
    };
    update({ zooms: [...project.zooms, region].sort((a, b) => a.start - b.start) });
    setSelectedZoom(region.id);
  };
  const addBlur = () => {
    const sourceAt = timelineToSource(time, project.clips);
    const region: BlurRegion = {
      id: `blur-${Date.now().toString(36)}`, start: Math.max(0, sourceAt - 500), end: Math.min(project.metadata.duration, sourceAt + 2500),
      bounds: { x: 0.35, y: 0.4, width: 0.3, height: 0.2 }, strength: 24, transition: 150,
    };
    update({ blurRegions: [...project.blurRegions, region].sort((a, b) => a.start - b.start) });
    setSelectedBlur(region.id); setSelectedZoom(null); setSelectedClip(null); setEditingBlur(true); setPlaying(false);
  };
  const changeNote = (id: string, change: Partial<Annotation>, record = true) => update({ annotations: project.annotations.map(a => (a.id === id ? { ...a, ...change } : a)) }, record);
  const addNote = (draft: Omit<Annotation, 'id' | 'startMs' | 'endMs'>) => {
    const a = project.settings.annotationSettings;
    const created: Annotation = { ...draft, id: `note-${Date.now().toString(36)}`, startMs: time, endMs: Math.min(duration, time + a.defaultDurationMs), animation: a.defaultAnimation };
    update({ annotations: [...project.annotations, created].sort((x, y) => x.startMs - y.startMs) });
  };
  const changeBlur = (next: BlurRegion, record = false) => update({ blurRegions: project.blurRegions.map(b => (b.id === next.id ? next : b)) }, record);
  const generate = () => { update({ zooms: autoZooms(project.cursorData, { ...project.settings.zoomSettings, enabled: true, autoDetect: true }, project.metadata.duration) }); setSelectedZoom(null); };
  const sourceSize = project.metadata.resolution ?? { width: 1920, height: 1080 };

  return (
    <div className="app">
      <header className="titlebar">
        <button className="icon-btn" aria-label="Back to library" onClick={() => navigate('/library')}><ArrowLeft size={17} /></button>
        <input value={name} onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== project.metadata.name) window.dz.projects.rename(project.id, name.trim()); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          style={{ height: 30, padding: '0 12px', borderRadius: 9, background: 'var(--card)', border: '1px solid var(--line)', outline: 'none', width: Math.max(140, name.length * 7.5 + 40) }} />
        <span title={editor.saved ? 'All changes saved' : 'Saving…'} style={{ width: 7, height: 7, borderRadius: '50%', background: editor.saved ? 'var(--green)' : 'var(--blue)' }} />
        <div className="spacer" />
        <BrandMenu settings={project.settings} onApply={settings => update({ settings })} />
        <button className="btn btn-primary" style={{ marginRight: 8 }} onClick={() => { setPlaying(false); setExportOpen(true); }}><Upload size={15} />Export</button>
        <WindowControls />
      </header>
      <div className="editor">
        <div className="stage">
          {notices.length > 0 && (
            <div className="notice-banner" role="status">
              <div>{notices.map((n, i) => <div key={i}>{n}</div>)}</div>
              <button className="icon-btn" title="Dismiss" onClick={() => setNotices([])}><X size={14} /></button>
            </div>
          )}
          <Preview project={project} time={time} playing={playing} speed={speed} onTime={setTime} onEnded={() => setPlaying(false)}
            cropping={cropping} cropAspect={cropAspect} onCropStart={checkpoint}
            drawTemplate={drawingMode ? { tool: project.settings.annotationSettings.defaultTool, shape: project.settings.annotationSettings.defaultShape, color: project.settings.annotationSettings.defaultColor, strokeWidth: project.settings.annotationSettings.defaultStrokeWidth, opacity: project.settings.annotationSettings.defaultOpacity, animation: project.settings.annotationSettings.defaultAnimation } : null}
            onDraw={addNote}
            editRegion={blur && editingBlur ? blur.bounds : null} onEditRegion={bounds => blur && changeBlur({ ...blur, bounds })}
            onCropChange={region => setSettings('cropSettings', { enabled: true, region }, false)}
            picking={picking && !!zoom} onPick={point => { if (zoom) { changeZoom({ ...zoom, focus: point, source: 'manual' }, true); setPicking(false); } }} />
        </div>
        <aside className="side">
          <nav className="rail">
            {panels.map(p => <button key={p.id} title={p.label} className={panel === p.id ? 'active' : ''} onClick={() => setPanel(p.id)}>{p.icon}</button>)}
          </nav>
          <div className="panel">
            {drawingMode ? (
              <AnnotatePanel project={project} setSettings={setSettings} onDone={() => setDrawingMode(false)} />
            ) : note ? (
              <AnnotationEditPanel annotation={note} onChange={(c, record) => changeNote(note.id, c, record)}
                onDelete={() => { update({ annotations: project.annotations.filter(a => a.id !== note.id) }); setSelectedNote(null); }} onClose={() => setSelectedNote(null)} />
            ) : cropping ? (
              <>
                <h2>Crop</h2>
                <div className="hint" style={{ marginBottom: 12 }}>Drag the frame or its handles to choose what stays visible.</div>
                <div className="section-label" style={{ marginTop: 0 }}>Aspect ratio</div>
                <Segmented value={cropAspect === null ? 'free' : String(cropAspect)} onChange={v => setCropAspect(v === 'free' ? null : Number(v))} options={[
                  { value: 'free', label: 'Free' }, { value: String(16 / 9), label: '16:9' }, { value: String(4 / 3), label: '4:3' },
                  { value: '1', label: '1:1' }, { value: String(9 / 16), label: '9:16' }, { value: String(21 / 9), label: '21:9' }]} />
                <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                  <button className="btn btn-ghost" onClick={() => setSettings('cropSettings', { enabled: false, region: { x: 0, y: 0, width: 1, height: 1 } })}>Reset</button>
                  <button className="btn btn-primary" onClick={() => setCropping(false)}>Done</button>
                </div>
              </>
            ) : blur ? (
              <>
                <h2>Blur</h2>
                <div className="hint" style={{ marginBottom: 12 }}>Hides sensitive content (and the cursor) inside the area while it is active.</div>
                <div className="row"><div><div className="title">Area</div><div className="desc">{editingBlur ? 'Drag the box on the preview.' : `${Math.round(blur.bounds.width * 100)}% × ${Math.round(blur.bounds.height * 100)}% of the frame`}</div></div>
                  <button className={`btn ${editingBlur ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setEditingBlur(e => !e); setPlaying(false); }}>{editingBlur ? 'Done' : 'Edit'}</button></div>
                <Slider label="Strength" value={blur.strength ?? 24} min={4} max={80} onChange={v => changeBlur({ ...blur, strength: v })} />
                <Slider label="Fade" value={blur.transition ?? 0} min={0} max={600} step={10} format={v => `${v}ms`} onChange={v => changeBlur({ ...blur, transition: v })} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-danger" onClick={() => { update({ blurRegions: project.blurRegions.filter(b => b.id !== blur.id) }); setSelectedBlur(null); setEditingBlur(false); }}><Trash2 size={14} />Delete blur</button>
                  <button className="btn btn-ghost" onClick={() => { setSelectedBlur(null); setEditingBlur(false); }}>Close</button>
                </div>
              </>
            ) : zoom ? (
              <>
                <h2>Zoom</h2>
                <Slider label="Zoom level" value={zoom.scale} min={1.1} max={4} step={0.05} format={v => `${v.toFixed(2)}x`} onChange={v => changeZoom({ ...zoom, scale: v, source: 'manual' })} />
                <div className="row"><div><div className="title">Focus point</div><div className="desc">{picking ? 'Click the preview to set where to zoom.' : `${Math.round(zoom.focus.x * 100)}%, ${Math.round(zoom.focus.y * 100)}%`}</div></div>
                  <button className={`btn ${picking ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setPicking(p => !p); setPlaying(false); seek(Math.max(0, (mapZooms([zoom], project.clips)[0]?.start ?? 0) + 700)); }}><Crosshair size={14} />{picking ? 'Picking…' : 'Set'}</button></div>
                <div className="hint" style={{ marginBottom: 12 }}>With Follow Cursor on, the view also pans to keep the pointer in frame.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-danger" onClick={() => { update({ zooms: project.zooms.filter(z => z.id !== zoom.id) }); setSelectedZoom(null); }}><Trash2 size={14} />Delete zoom</button>
                  <button className="btn btn-ghost" onClick={() => setSelectedZoom(null)}>Done</button>
                </div>
              </>
            ) : clip ? (
              <>
                <h2>Clip</h2>
                <div className="hint" style={{ marginBottom: 12 }}>{(clipLength(clip) / 1000).toFixed(1)}s on the timeline · {((clip.sourceEnd - clip.sourceStart) / 1000).toFixed(1)}s of recording</div>
                <div className="section-label" style={{ marginTop: 0 }}>Speed</div>
                <Segmented value={String(clip.speed || 1)} onChange={v => update({ clips: setClipSpeed(project.clips, clip.id, Number(v)) })}
                  options={[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map(s => ({ value: String(s), label: `${s}×` }))} />
                <div className="hint" style={{ margin: '12px 0' }}>Audio keeps its pitch. Zooms and the cursor follow the new timing; annotations stay at their timeline position.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {project.clips.length > 1 && <button className="btn btn-danger" onClick={() => { update({ clips: removeClip(project.clips, clip.id) }); setSelectedClip(null); }}><Trash2 size={14} />Delete clip</button>}
                  <button className="btn btn-ghost" onClick={() => setSelectedClip(null)}>Done</button>
                </div>
              </>
            ) : panel === 'background' ? <BackgroundPanel project={project} setSettings={setSettings} sourceSize={sourceSize} />
              : panel === 'cursor' ? <CursorPanel project={project} setSettings={setSettings} />
                : panel === 'motion' ? <><MotionPanel project={project} setSettings={setSettings} onGenerate={generate} autoCount={autoCount} />
                  <TextFocusSection project={project} setSettings={setSettings} onDetect={() => update({ textFocusRegions: regionsFromEvents(project.textFocusEvents, project.metadata.duration) })} /></>
                  : panel === 'camera' ? <CameraPanel project={project} setSettings={setSettings} update={update} time={time} selected={selectedCamKey} onSelect={setSelectedCamKey} />
                  : panel === 'threeD' ? <ThreeDPanel project={project} setSettings={setSettings} update={update} time={time} selected={selected3d} onSelect={setSelected3d} />
                  : panel === 'captions' ? <CaptionsPanel project={project} setSettings={setSettings} update={update} time={time} seek={seek} />
                  : panel === 'voiceover' ? <VoiceoverPanel project={project} setSettings={setSettings} update={update} time={time} seek={seek} selected={selectedVoice} onSelect={setSelectedVoice} />
                  : panel === 'keyboard' ? <KeyboardPanel project={project} setSettings={setSettings} />
                    : <><AudioPanel project={project} setSettings={setSettings} /><SpeechSection project={project} setSettings={setSettings} update={update} /><MusicSection project={project} setSettings={setSettings} /></>}
          </div>
        </aside>
        <section className="bottom">
          <div className="tools">
            <div className="tools-left">
              <div className="pill-group">
                {[0.5, 1, 1.5, 2].map(s => <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}
              </div>
              <button className="tool" onClick={() => { setPlaying(false); setSelectedZoom(null); setCropping(c => !c); }} title="Crop the recording" style={cropping ? { borderColor: 'var(--blue)', color: 'var(--text)' } : undefined}><CropIcon size={14} />Crop</button>
              <button className="tool" onClick={() => { setPlaying(false); setCropping(false); setSelectedZoom(null); setSelectedBlur(null); setDrawingMode(d => !d); }} title="Draw on the recording" style={drawingMode ? { borderColor: 'var(--blue)', color: 'var(--text)' } : undefined}><PenLine size={14} />Annotate</button>
              <button className="tool" onClick={addBlur} title="Blur part of the screen from the playhead"><EyeOff size={14} />Blur</button>
              <button className="tool" onClick={split} title="Split at the playhead: the selected tracks, or every track when nothing is selected (S). Ctrl+click to select several."><Scissors size={14} />Split</button>
              <button className="tool" onClick={deleteSelection} disabled={!(selectedZoom || selectedBlur || selectedNote || trackSel.length || (selectedClip && project.clips.length > 1))} title="Delete selection (Del)"><Trash2 size={14} />Delete</button>
              <div className="pill-group">
                <button onClick={undo} disabled={!editor.canUndo} title="Undo (Ctrl+Z)"><Undo2 size={14} /></button>
                <button onClick={redo} disabled={!editor.canRedo} title="Redo (Ctrl+Y)"><Redo2 size={14} /></button>
              </div>
            </div>
            <div className="play-wrap">
              <button className="play" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>{playing ? <Pause size={18} fill="#fff" /> : <Play size={18} fill="#fff" style={{ marginLeft: 2 }} />}</button>
              <div className="time">{formatTime(time, true)} <span className="total">/ {formatTime(duration)}</span></div>
            </div>
            <div className="tools-right">
              <div className="pill-group">
                <button onClick={() => setTimelineScale(s => Math.max(1, s / 1.5))} title="Zoom out timeline"><Minus size={14} /></button>
                <button onClick={() => setTimelineScale(1)}>FIT</button>
                <button onClick={() => setTimelineScale(s => Math.min(40, s * 1.5))} title="Zoom in timeline"><Plus size={14} /></button>
              </div>
            </div>
          </div>
          <Timeline duration={duration} sourceDuration={project.metadata.duration} time={time} clips={project.clips} zooms={project.zooms} scale={timelineScale}
            selectedClip={selectedClip} selectedZoom={selectedZoom} onSeek={seek} onSelectClip={(id, add) => {
              if (add && id) { setSelectedClip(prev => (prev === id ? null : id)); return; }
              setSelectedClip(id); if (id) setTrackSel([]);
            }}
            trackSegments={project.trackSegments} selectedTracks={trackSel}
            onMoveTrack={(track, id, offset) => update({ trackSegments: { ...project.trackSegments, [track]: moveSegment(project.trackSegments[track], project.metadata.duration, id, offset) } }, false)}
            onReorderClip={(id, index) => update({ clips: moveClip(project.clips, id, index) })}
            onSelectTrack={(track, id, add) => {
              if (!track || !id) { setTrackSel([]); return; }
              setTrackSel(list => (add ? (list.some(s => s.track === track && s.id === id) ? list.filter(s => !(s.track === track && s.id === id)) : [...list, { track, id }]) : [{ track, id }]));
            }} onSelectZoom={id => { setSelectedZoom(id); setPicking(false); }}
            onDragStart={checkpoint}
            annotations={project.annotations} selectedAnnotation={selectedNote} onSelectAnnotation={id => { setSelectedNote(id); if (id) setDrawingMode(false); }}
            onAnnotationChange={a => changeNote(a.id, a, false)} onAnnotationRemove={id => { update({ annotations: project.annotations.filter(a => a.id !== id) }); if (selectedNote === id) setSelectedNote(null); }}
            captions={project.settings.captionSettings.enabled ? timelineCaptions : []}
            threeD={project.settings.threeDSettings.enabled ? project.threeDKeyframes.filter(k => k.endTime >= 0).flatMap(k => { const s = sourceToTimeline(k.startTime, project.clips), en = sourceToTimeline(k.endTime, project.clips); return s === null || en === null ? [] : [{ id: k.id, name: k.name, start: s, end: en }]; }) : []}
            selectedThreeD={selected3d} onSelectThreeD={id => { setSelected3d(id); if (id) setPanel('threeD'); }}
            onThreeDChange={(id, s, en) => update({ threeDKeyframes: project.threeDKeyframes.map(k => (k.id === id ? { ...k, startTime: timelineToSource(s, project.clips), endTime: timelineToSource(en, project.clips) } : k)) }, false)}
            media={{ camera: !!project.files.camera, system: project.files.audio, mic: project.files.mic }}
            systemPeaks={peaks.audio} micPeaks={peaks.mic}
            muted={{ system: project.settings.audioSettings.systemVolume === 0, mic: project.settings.audioSettings.micVolume === 0, camera: !project.settings.cameraSettings.visible }}
            onToggleTrack={toggleTrack} onRename={renameItem}
            onSelectMedia={track => setPanel(track === 'camera' ? 'camera' : 'audio')}
            voiceovers={project.voiceoverClips} selectedVoiceover={selectedVoice}
            onSelectVoiceover={id => { setSelectedVoice(id); if (id) setPanel('voiceover'); }}
            onVoiceoverMove={(id, start) => moveVoiceover(project, update, id, start, false)}
            blurs={project.blurRegions} selectedBlur={selectedBlur} onSelectBlur={id => { setSelectedBlur(id); if (!id) setEditingBlur(false); }}
            onBlurChange={b => changeBlur(b)} onBlurRemove={id => { update({ blurRegions: project.blurRegions.filter(b => b.id !== id) }); if (selectedBlur === id) { setSelectedBlur(null); setEditingBlur(false); } }}
            onTrimClip={(id, edge, sourceTime) => update({ clips: trimClip(project.clips, id, edge, sourceTime, project.metadata.duration) }, false)}
            onZoomChange={(z, commit) => changeZoom(z, commit)} onZoomAdd={addZoom}
            onZoomRemove={id => { update({ zooms: project.zooms.filter(z => z.id !== id) }); if (selectedZoom === id) setSelectedZoom(null); }} />
        </section>
      </div>
      {exportOpen && <ExportDialog project={project} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
