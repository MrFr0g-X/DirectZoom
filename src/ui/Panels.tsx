import { useEffect, useRef } from 'react';
import { Circle, Image as ImageIcon, Palette, RefreshCw, Sparkles, Wallpaper } from 'lucide-react';
import { gradients, renderBackground, solids, wallpapers } from '../backgrounds';
import { cursorArt, type CursorDesign } from '../cursors';
import { defaultSettings } from '../settings';
import type { Annotation, BackgroundSettings, CameraKeyframe, Project, ProjectSettings } from '../types';
import { ColorField, Segmented, Slider, Toggle, ToggleRow, formatTime } from './controls';
import { sourceToTimeline, timelineToSource } from '../timeline';

type SetSettings = <K extends keyof ProjectSettings>(key: K, value: Partial<ProjectSettings[K]>, record?: boolean) => void;

function Swatch({ settings, active, onClick, title }: { settings: BackgroundSettings; active: boolean; onClick: () => void; title: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = 96; canvas.height = 60;
    const image = renderBackground({ ...settings, backgroundBlur: 0 }, 96, 60, null);
    canvas.getContext('2d')!.drawImage(image, 0, 0);
  }, [settings.type, settings.wallpaper, settings.gradient, settings.color]);
  return <button className={`swatch${active ? ' active' : ''}`} title={title} onClick={onClick}><canvas ref={ref} /></button>;
}

export function BackgroundPanel({ project, setSettings, sourceSize }: { project: Project; setSettings: SetSettings; sourceSize: { width: number; height: number } }) {
  const b = project.settings.backgroundSettings;
  const set = (value: Partial<BackgroundSettings>, record = true) => setSettings('backgroundSettings', value, record);
  const pickImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => set({ type: 'image', imagePath: String(reader.result) });
      reader.readAsDataURL(file);
    };
    input.click();
  };
  return (
    <>
      <h2>Background</h2>
      <div className="section-label">Canvas</div>
      <Segmented value={b.aspectRatio} onChange={v => set({ aspectRatio: v })} options={[
        { value: 'original', label: 'Auto' }, { value: '16:9', label: '16:9' }, { value: '21:9', label: '21:9' },
        { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' }]} />
      <div className="hint" style={{ marginTop: 8 }}>Recorded at {sourceSize.width}×{sourceSize.height}</div>
      <div className="section-label">Layout</div>
      <ToggleRow title="Zoom to fit" desc="Crop the recording to fill the canvas." on={b.fitMode === 'cover'} onChange={v => set({ fitMode: v ? 'cover' : 'contain' })} />
      <Slider label="Padding" value={b.padding} min={0} max={200} onChange={v => set({ padding: v }, false)} />
      <Slider label="Corner radius" value={b.borderRadius} min={0} max={60} onChange={v => set({ borderRadius: v }, false)} />
      <Slider label="Inset" value={b.inset} min={0} max={40} onChange={v => set({ inset: v }, false)} />
      <Slider label="Background blur" value={b.backgroundBlur} min={0} max={30} onChange={v => set({ backgroundBlur: v }, false)} />
      <div className="section-label">Shadow</div>
      <ToggleRow title="Drop shadow" on={b.shadow} onChange={v => set({ shadow: v })} />
      {b.shadow && (
        <>
          <Slider label="Blur" value={b.shadowSettings.blur} min={0} max={100} onChange={v => set({ shadowSettings: { ...b.shadowSettings, blur: v } }, false)} />
          <Slider label="Opacity" value={Math.round(b.shadowSettings.opacity * 100)} min={0} max={100} format={v => `${v}%`} onChange={v => set({ shadowSettings: { ...b.shadowSettings, opacity: v / 100 } }, false)} />
          <Slider label="Offset" value={b.shadowSettings.offsetY} min={0} max={60} onChange={v => set({ shadowSettings: { ...b.shadowSettings, offsetY: v } }, false)} />
        </>
      )}
      <div className="section-label">Fill</div>
      <Segmented value={b.type} onChange={v => (v === 'image' && !b.imagePath ? pickImage() : set({ type: v }))} options={[
        { value: 'wallpaper', label: <><Wallpaper size={13} />Wallpaper</> }, { value: 'gradient', label: <><Palette size={13} />Gradient</> },
        { value: 'solid', label: <><Circle size={13} />Solid</> }, { value: 'image', label: <><ImageIcon size={13} />Image</> }]} columns={2} />
      <div style={{ marginTop: 12 }}>
        {b.type === 'wallpaper' && <div className="swatches">{wallpapers.map(w => <Swatch key={w.id} title={w.name} settings={{ ...b, type: 'wallpaper', wallpaper: w.id }} active={b.wallpaper === w.id} onClick={() => set({ wallpaper: w.id })} />)}</div>}
        {b.type === 'gradient' && <div className="swatches">{gradients.map(g => <Swatch key={g} title="Gradient" settings={{ ...b, type: 'gradient', gradient: g }} active={b.gradient === g} onClick={() => set({ gradient: g })} />)}</div>}
        {b.type === 'solid' && (
          <>
            <div className="swatches">{solids.map(c => <Swatch key={c} title={c} settings={{ ...b, type: 'solid', color: c }} active={b.color === c} onClick={() => set({ color: c })} />)}</div>
            <div style={{ marginTop: 12 }}><ColorField label="Custom colour" value={b.color} onChange={v => set({ color: v }, false)} /></div>
          </>
        )}
        {b.type === 'image' && <button className="btn btn-ghost" onClick={pickImage}><ImageIcon size={14} />{b.imagePath ? 'Change image' : 'Choose image'}</button>}
      </div>
    </>
  );
}

/** Bounding box of the opaque pixels of a cursor raster. */
function visibleBox(canvas: HTMLCanvasElement) {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (data[(y * canvas.width + x) * 4 + 3] > 40) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return maxX < minX ? { x: 0, y: 0, w: canvas.width, h: canvas.height } : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function DesignTile({ design, active, color, stroke, onClick }: { design: CursorDesign; active: boolean; color: string; stroke: string; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    cursorArt(design, 'default', color, stroke).then(art => {
      const canvas = ref.current;
      if (!alive || !canvas || !art) return;
      canvas.width = canvas.height = 68;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 68, 68);
      // Centre the visible artwork in the tile.
      const box = visibleBox(art.image as HTMLCanvasElement);
      const scale = 110 / 256;
      ctx.drawImage(art.image, 34 - (box.x + box.w / 2) * scale, 34 - (box.y + box.h / 2) * scale, 110, 110);
    });
    return () => { alive = false; };
  }, [design, color, stroke]);
  const names: Record<CursorDesign, string> = { macos: 'macOS', windows: 'Windows', minimal: 'Minimal', crosshair: 'Crosshair', lavender: 'Lilac', parched: 'Sandstone' };
  return <button className={`tile${active ? ' active' : ''}`} onClick={onClick}><canvas ref={ref} />{names[design]}</button>;
}

export function CursorPanel({ project, setSettings }: { project: Project; setSettings: SetSettings }) {
  const c = project.settings.cursorSettings;
  const set = (value: Partial<typeof c>, record = true) => setSettings('cursorSettings', value, record);
  const embedded = project.metadata.cursorEmbedded;
  return (
    <>
      <h2>Cursor</h2>
      {embedded && <div className="error-banner" style={{ marginBottom: 12 }}>This recording has the cursor baked into the video, so it can't be restyled.</div>}
      <ToggleRow title="Show cursor" on={c.visible} onChange={v => set({ visible: v })} />
      <div className="section-label">Design</div>
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {(['macos', 'windows', 'minimal', 'crosshair', 'lavender', 'parched'] as CursorDesign[]).map(d => (
          <DesignTile key={d} design={d} active={c.cursorDesign === d} color={c.color} stroke={c.strokeColor} onClick={() => set({ cursorDesign: d })} />
        ))}
      </div>
      {c.cursorDesign === 'windows' && <div className="hint" style={{ marginTop: 8 }}>Uses your own Windows cursors, exactly as they appear on this PC.</div>}
      {(c.cursorDesign === 'lavender' || c.cursorDesign === 'parched') && <div className="hint" style={{ marginTop: 8 }}>A themed design with its own colours.</div>}
      <div className="section-label">Appearance</div>
      <Slider label="Size" value={c.size} min={20} max={200} onChange={v => set({ size: v }, false)} />
      {!['windows', 'lavender', 'parched'].includes(c.cursorDesign) && (
        <>
          <ColorField label="Fill" value={c.color} onChange={v => set({ color: v }, false)} />
          <ColorField label="Outline" value={c.strokeColor} onChange={v => set({ strokeColor: v }, false)} />
        </>
      )}
      <div className="section-label">Cursor type</div>
      <ToggleRow title="Detect automatically" desc="Show pointer, text and other cursor types when detected." on={c.useDetectedCursorType} onChange={v => set({ useDetectedCursorType: v })} />
      <div className="section-label">Clicks</div>
      <ToggleRow title="Show click effect" on={c.highlightClicks} onChange={v => set({ highlightClicks: v })} />
      {c.highlightClicks && (
        <>
          <Segmented value={c.clickEffect} onChange={v => set({ clickEffect: v })} options={[
            { value: 'ring', label: 'Ring' }, { value: 'ripple', label: 'Ripple' }, { value: 'glow', label: 'Glow' },
            { value: 'burst', label: 'Burst' }, { value: 'bounce', label: 'Bounce' }, { value: 'none', label: 'None' }]} />
          <div style={{ height: 12 }} />
          <ColorField label="Effect colour" value={c.highlightColor} onChange={v => set({ highlightColor: v }, false)} />
          <Slider label="Duration" value={c.clickEffectDuration} min={100} max={1000} step={10} format={v => `${v}ms`} onChange={v => set({ clickEffectDuration: v }, false)} />
        </>
      )}
      <ToggleRow title="Shrink on click" desc="The cursor dips slightly while the mouse is held." on={c.clickShrink} onChange={v => set({ clickShrink: v })} />
      {c.clickShrink && <Slider label="Amount" value={Math.round(c.clickShrinkAmount * 100)} min={50} max={100} format={v => `${v}%`} onChange={v => set({ clickShrinkAmount: v / 100 }, false)} />}
      <div className="section-label">Motion</div>
      <ToggleRow title="Smooth movement" on={c.smooth} onChange={v => set({ smooth: v })} />
      {c.smooth && <Slider label="Smoothing" value={c.smoothingIntensity} min={0} max={100} format={v => `${v}%`} onChange={v => set({ smoothingIntensity: v }, false)} />}
      <ToggleRow title="Tilt while moving" on={c.tiltOnMove} onChange={v => set({ tiltOnMove: v })} />
      {c.tiltOnMove && <Slider label="Tilt" value={c.tiltAmount} min={0} max={30} format={v => `${v}°`} onChange={v => set({ tiltAmount: v }, false)} />}
      <ToggleRow title="Hide when idle" on={c.hideWhenIdle} onChange={v => set({ hideWhenIdle: v })} />
      {c.hideWhenIdle && <Slider label="Hide after" value={c.idleHideDelayMs} min={300} max={5000} step={100} format={v => `${(v / 1000).toFixed(1)}s`} onChange={v => set({ idleHideDelayMs: v }, false)} />}
    </>
  );
}

export function MotionPanel({ project, setSettings, onGenerate, autoCount }: { project: Project; setSettings: SetSettings; onGenerate: () => void; autoCount: number }) {
  const z = project.settings.zoomSettings;
  const set = (value: Partial<typeof z>, record = true) => setSettings('zoomSettings', value, record);
  const smoothness = Math.round(((0.3 - z.followCursorSmoothing) / 0.25) * 100);
  return (
    <>
      <h2>Motion</h2>
      <div className="section-label" style={{ marginTop: 0 }}>Zoom & Pan</div>
      <ToggleRow title="Automatic zooms" on={z.enabled} onChange={v => set({ enabled: v })} />
      <Slider label="Default Zoom Level" value={z.defaultScale} min={1.1} max={3} step={0.1} format={v => `${v.toFixed(1)}x`} onChange={v => set({ defaultScale: v }, false)} />
      <Slider label="Transition Duration" value={z.transitionDuration} min={200} max={1500} step={50} format={v => `${v}ms`} onChange={v => set({ transitionDuration: v }, false)} />
      <ToggleRow title="Auto-detect Points" on={z.autoDetect} onChange={v => set({ autoDetect: v })} />
      {z.autoDetect && (
        <div className="indent">
          <ToggleRow title="Zoom on Clicks" on={z.detectOnClicks} onChange={v => set({ detectOnClicks: v })} />
          <ToggleRow title="Zoom on Slowdown" on={z.detectOnDeceleration} onChange={v => set({ detectOnDeceleration: v })} />
        </div>
      )}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', margin: '4px 0 18px' }} onClick={onGenerate}>
        <RefreshCw size={14} />Generate Zoom Points ({autoCount})
      </button>
      <ToggleRow title="Follow Cursor" on={z.followCursor} onChange={v => set({ followCursor: v })} />
      {z.followCursor && (
        <div className="indent">
          <ToggleRow title="Always Track" on={z.followCursorAlwaysTrack} onChange={v => set({ followCursorAlwaysTrack: v })} />
          <Slider label="Pan Smoothness" value={Math.max(0, Math.min(100, smoothness))} min={0} max={100}
            onChange={v => set({ followCursorSmoothing: Math.round((0.3 - (v / 100) * 0.25) * 1000) / 1000 }, false)} />
        </div>
      )}
      <div className="section-label">Motion Blur</div>
      <ToggleRow title="Zoom Motion Blur" desc="Softens the frame while zooming in and out." on={z.motionBlur} onChange={v => set({ motionBlur: v })} />
      {z.motionBlur && <Slider label="Zoom Blur Strength" value={Math.round(z.motionBlurStrength * 100)} min={10} max={100} format={v => `${v}%`} onChange={v => set({ motionBlurStrength: v / 100 }, false)} />}
      <Slider label="Cursor Motion Blur" value={Math.round(z.cursorMotionBlur * 100)} min={0} max={100} format={v => (v ? `${v}%` : 'Off')} onChange={v => set({ cursorMotionBlur: v / 100 }, false)} />
      <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setSettings('zoomSettings', defaultSettings.zoomSettings)}><Sparkles size={14} />Reset to defaults</button>
    </>
  );
}

/** Text focus: spotlight the field being typed in. */
export function TextFocusSection({ project, setSettings, onDetect }: { project: Project; setSettings: SetSettings; onDetect: () => void }) {
  const f = project.settings.textFocusSettings;
  const set = (value: Partial<typeof f>, record = true) => setSettings('textFocusSettings', value, record);
  const events = project.textFocusEvents.filter(e => e.type === 'focus').length;
  return (
    <>
      <div className="section-label">Text focus</div>
      <ToggleRow title="Spotlight text fields" desc={events
        ? `${project.textFocusRegions.length} typing moment${project.textFocusRegions.length === 1 ? '' : 's'} found in this recording.`
        : 'Recordings made with DirectZoom note when you click into a text field.'} on={f.enabled} onChange={v => set({ enabled: v })} />
      {f.enabled && (
        <>
          <Segmented value={f.mode} columns={2} onChange={v => set({ mode: v })} options={[{ value: 'dim', label: 'Dim the rest' }, { value: 'blur', label: 'Blur the rest' }]} />
          <div style={{ height: 10 }} />
          {f.mode === 'dim'
            ? <Slider label="Dim" value={Math.round(f.dimOpacity * 100)} min={10} max={90} format={v => `${v}%`} onChange={v => set({ dimOpacity: v / 100 }, false)} />
            : <Slider label="Blur" value={f.blurAmount} min={2} max={30} onChange={v => set({ blurAmount: v }, false)} />}
          <Slider label="Padding" value={f.padding} min={0} max={60} onChange={v => set({ padding: v }, false)} />
          <Slider label="Fade" value={f.transitionDuration} min={0} max={1000} step={50} format={v => `${v}ms`} onChange={v => set({ transitionDuration: v }, false)} />
          {events > 0 && <button className="btn btn-ghost" onClick={onDetect}>Detect again</button>}
        </>
      )}
    </>
  );
}

const noteColors = ['#ffde59', '#ff453a', '#30d158', '#0a84ff', '#bf5af2', '#ffffff', '#000000'];

function AnnotationStyle({ value, onChange }: {
  value: { tool: Annotation['tool']; shape?: Annotation['shape']; color: string; strokeWidth: number; opacity: number; animation: Annotation['animation'] };
  onChange: (change: Partial<Annotation>, record?: boolean) => void;
}) {
  return (
    <>
      <div className="section-label" style={{ marginTop: 0 }}>Tool</div>
      <Segmented value={value.tool} columns={2} onChange={v => onChange({ tool: v })} options={[{ value: 'pen', label: 'Pen' }, { value: 'highlighter', label: 'Highlighter' }]} />
      {value.shape && (
        <>
          <div className="section-label">Shape</div>
          <Segmented value={value.shape} onChange={v => onChange({ shape: v })} options={[
            { value: 'freehand', label: 'Draw' }, { value: 'line', label: 'Line' }, { value: 'arrow', label: 'Arrow' },
            { value: 'rectangle', label: 'Box' }, { value: 'ellipse', label: 'Circle' }]} />
        </>
      )}
      <div className="section-label">Colour</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {noteColors.map(color => (
          <button key={color} aria-label={color} onClick={() => onChange({ color })}
            style={{ width: 24, height: 24, borderRadius: '50%', background: color, border: value.color.toLowerCase() === color ? '2px solid var(--blue)' : '1px solid var(--line-strong)' }} />
        ))}
      </div>
      <ColorField label="Custom" value={value.color} onChange={v => onChange({ color: v }, false)} />
      <Slider label="Thickness" value={value.strokeWidth} min={2} max={30} onChange={v => onChange({ strokeWidth: v }, false)} />
      <Slider label="Opacity" value={Math.round(value.opacity * 100)} min={10} max={100} format={v => `${v}%`} onChange={v => onChange({ opacity: v / 100 }, false)} />
      <div className="section-label">Animation</div>
      <Segmented value={value.animation} onChange={v => onChange({ animation: v })} options={[
        { value: 'draw-on', label: 'Draw' }, { value: 'fade', label: 'Fade' }, { value: 'pop', label: 'Pop' },
        { value: 'pulse', label: 'Pulse' }, { value: 'none', label: 'None' }]} />
    </>
  );
}

/** Drawing mode: sets the style used for new annotations. */
export function AnnotatePanel({ project, setSettings, onDone }: { project: Project; setSettings: SetSettings; onDone: () => void }) {
  const a = project.settings.annotationSettings;
  const set = (change: Partial<typeof a>, record = true) => setSettings('annotationSettings', change, record);
  return (
    <>
      <h2>Annotate</h2>
      <div className="hint" style={{ marginBottom: 14 }}>Draw on the preview. Each mark starts at the playhead and stays for the duration below.</div>
      <AnnotationStyle value={{ tool: a.defaultTool, shape: a.defaultShape, color: a.defaultColor, strokeWidth: a.defaultStrokeWidth, opacity: a.defaultOpacity, animation: a.defaultAnimation }}
        onChange={(c, record) => set({
          ...(c.tool ? { defaultTool: c.tool } : {}), ...(c.shape ? { defaultShape: c.shape } : {}), ...(c.color ? { defaultColor: c.color } : {}),
          ...(c.strokeWidth ? { defaultStrokeWidth: c.strokeWidth } : {}), ...(c.opacity ? { defaultOpacity: c.opacity } : {}), ...(c.animation ? { defaultAnimation: c.animation } : {}),
        }, record)} />
      <div style={{ height: 12 }} />
      <Slider label="Duration" value={a.defaultDurationMs} min={500} max={10000} step={100} format={v => `${(v / 1000).toFixed(1)}s`} onChange={v => set({ defaultDurationMs: v }, false)} />
      <ToggleRow title="Show annotations" on={a.enabled} onChange={v => set({ enabled: v })} />
      <button className="btn btn-primary" onClick={onDone}>Done drawing</button>
    </>
  );
}

export function AnnotationEditPanel({ annotation, onChange, onDelete, onClose }: {
  annotation: Annotation; onChange: (change: Partial<Annotation>, record?: boolean) => void; onDelete: () => void; onClose: () => void;
}) {
  return (
    <>
      <h2>Annotation</h2>
      <AnnotationStyle value={annotation} onChange={onChange} />
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-danger" onClick={onDelete}>Delete</button>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </>
  );
}

export function CameraPanel({ project, setSettings, update, time, selected, onSelect }: {
  project: Project; setSettings: SetSettings; update: (change: { cameraKeyframes: CameraKeyframe[] }, record?: boolean) => void;
  time: number; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const cam = project.settings.cameraSettings;
  const set = (value: Partial<typeof cam>, record = true) => setSettings('cameraSettings', value, record);
  const key = project.cameraKeyframes.find(k => k.id === selected) ?? null;
  // Pose controls edit the selected keyframe, otherwise the default camera.
  const pose = key ?? { position: cam.position, shape: cam.shape, size: cam.size, roundness: cam.roundness, mirror: cam.mirror, visible: cam.visible, opacity: 1 };
  const shape = pose.shape ?? cam.shape;
  const change = (patch: Partial<CameraKeyframe>, record = true) => {
    if (key) update({ cameraKeyframes: project.cameraKeyframes.map(k => (k.id === key.id ? { ...k, ...patch } : k)) }, record);
    else {
      const { opacity: _opacity, customPosition: _custom, id: _id, time: _time, ...rest } = patch;
      set(rest as Partial<typeof cam>, record);
    }
  };
  const at = (ms: number) => sourceToTimeline(ms, project.clips);
  const addKeyframe = () => {
    const created: CameraKeyframe = {
      id: `cam-${Date.now().toString(36)}`, time: timelineToSource(time, project.clips), position: pose.position, shape,
      size: pose.size, roundness: pose.roundness, mirror: pose.mirror, visible: pose.visible, opacity: pose.opacity,
    };
    update({ cameraKeyframes: [...project.cameraKeyframes, created].sort((x, y) => x.time - y.time) });
    onSelect(created.id);
  };
  return (
    <>
      <h2>Camera</h2>
      {!project.files.camera && <div className="hint" style={{ marginBottom: 12 }}>No camera in this recording. Turn on “Camera” in the recording options to add a webcam bubble.</div>}
      {key && (
        <div className="ai-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="title" style={{ margin: 0 }}>Keyframe at {formatTime(at(key.time) ?? 0)}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-ghost" style={{ height: 28 }} onClick={() => onSelect(null)}>Done</button>
            <button className="btn btn-danger" style={{ height: 28 }} onClick={() => { update({ cameraKeyframes: project.cameraKeyframes.filter(k => k.id !== key.id) }); onSelect(null); }}>Delete</button>
          </div>
        </div>
      )}
      <ToggleRow title="Show camera" on={pose.visible} onChange={v => change({ visible: v })} />
      <div className="section-label">Position</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, width: 150 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(position => (
          <button key={position} aria-label={`Position ${position}`} onClick={() => change({ position, customPosition: undefined })}
            style={{ height: 30, borderRadius: 8, background: pose.position === position ? 'var(--blue)' : 'var(--field)', border: '1px solid var(--line)' }} />
        ))}
      </div>
      <div className="section-label">Shape</div>
      <Segmented value={shape} onChange={v => change({ shape: v })} options={[
        { value: 'circle', label: 'Circle' }, { value: 'rounded', label: 'Rounded' }, { value: 'square', label: 'Square' },
        { value: 'landscape', label: 'Wide' }, { value: 'portrait', label: 'Tall' }]} />
      <div style={{ height: 12 }} />
      <Slider label="Size" value={pose.size} min={80} max={520} onChange={v => change({ size: v }, false)} />
      {shape !== 'circle' && shape !== 'square' && <Slider label="Roundness" value={pose.roundness} min={0} max={50} format={v => `${v}%`} onChange={v => change({ roundness: v }, false)} />}
      {key && <Slider label="Opacity" value={Math.round(key.opacity * 100)} min={0} max={100} format={v => `${v}%`} onChange={v => change({ opacity: v / 100 }, false)} />}
      <ToggleRow title="Mirror" on={pose.mirror} onChange={v => change({ mirror: v })} />
      {!key && (
        <>
          <ToggleRow title="Shrink while zoomed" desc="Keeps the camera out of the way during zooms." on={cam.shrinkOnZoom} onChange={v => set({ shrinkOnZoom: v })} />
          {cam.shrinkOnZoom && <Slider label="Zoomed size" value={cam.zoomedSize} min={60} max={400} onChange={v => set({ zoomedSize: v }, false)} />}
          <ToggleRow title="Shadow" on={cam.shadow} onChange={v => set({ shadow: v })} />
          <Slider label="Border" value={cam.borderWidth} min={0} max={12} onChange={v => set({ borderWidth: v }, false)} />
          {cam.borderWidth > 0 && <ColorField label="Border colour" value={cam.borderColor} onChange={v => set({ borderColor: v }, false)} />}
        </>
      )}
      <div className="section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Keyframes ({project.cameraKeyframes.length})</span>
        <button className="btn btn-ghost" style={{ height: 26, padding: '0 8px', fontSize: 12 }} onClick={addKeyframe}>+ At {formatTime(time)}</button>
      </div>
      {project.cameraKeyframes.length === 0 && <div className="hint">Add keyframes to move, resize or hide the camera during the video; it animates between them.</div>}
      {project.cameraKeyframes.map(k => (
        <button key={k.id} className={`btn ${k.id === selected ? 'btn-primary' : 'btn-ghost'}`} style={{ width: '100%', justifyContent: 'space-between', marginBottom: 6 }} onClick={() => onSelect(k.id)}>
          <span>{at(k.time) === null ? 'cut' : formatTime(at(k.time)!)}</span>
          <span style={{ opacity: 0.7 }}>{k.visible ? `${k.shape ?? cam.shape} · ${Math.round(k.size)}px` : 'hidden'}</span>
        </button>
      ))}
    </>
  );
}

export function KeyboardPanel({ project, setSettings }: { project: Project; setSettings: SetSettings }) {
  const k = project.settings.keyboardSettings;
  const set = (value: Partial<typeof k>, record = true) => setSettings('keyboardSettings', value, record);
  const hasKeys = project.keyboardData.length > 0;
  return (
    <>
      <h2>Keyboard</h2>
      {!hasKeys && <div className="hint" style={{ marginBottom: 12 }}>No keystrokes in this recording. Turn on “Keystrokes” before recording to show shortcuts like Ctrl+C. Plain typing is never shown.</div>}
      <ToggleRow title="Show shortcuts" desc="Display key combinations such as Ctrl+Shift+P." on={k.enabled} onChange={v => set({ enabled: v })} />
      <div className="section-label">Style</div>
      <Segmented value={k.style} onChange={v => set({ style: v })} options={[
        { value: 'pill', label: 'Pill' }, { value: 'minimal', label: 'Minimal' }, { value: 'keycap', label: 'Keycap' },
        { value: 'glass', label: 'Glass' }, { value: 'outline', label: 'Outline' }, { value: 'flat', label: 'Flat' }]} />
      <div className="section-label">Position</div>
      <Segmented value={k.position} onChange={v => set({ position: v })} options={[
        { value: 'top-left', label: 'Top L' }, { value: 'top-center', label: 'Top' }, { value: 'top-right', label: 'Top R' },
        { value: 'bottom-left', label: 'Bottom L' }, { value: 'bottom-center', label: 'Bottom' }, { value: 'bottom-right', label: 'Bottom R' }]} />
      <div style={{ height: 14 }} />
      <ToggleRow title="Modifier symbols" desc="Show ^ ⇧ ⌥ instead of Ctrl, Shift, Alt." on={k.showModifierSymbols} onChange={v => set({ showModifierSymbols: v })} />
      <ToggleRow title="Hold animation" desc="Fill the badge while keys are held." on={k.holdAnimation} onChange={v => set({ holdAnimation: v })} />
      <Slider label="Font size" value={k.fontSize} min={10} max={48} onChange={v => set({ fontSize: v }, false)} />
      <Slider label="Display time" value={k.displayDuration} min={100} max={3000} step={50} format={v => `${v}ms`} onChange={v => set({ displayDuration: v }, false)} />
      <Slider label="Opacity" value={Math.round(k.opacity * 100)} min={10} max={100} format={v => `${v}%`} onChange={v => set({ opacity: v / 100 }, false)} />
      <ColorField label="Background" value={k.backgroundColor} onChange={v => set({ backgroundColor: v }, false)} />
      <ColorField label="Text" value={k.textColor} onChange={v => set({ textColor: v }, false)} />
    </>
  );
}

export function AudioPanel({ project, setSettings }: { project: Project; setSettings: SetSettings }) {
  const a = project.settings.audioSettings;
  const hasAny = project.files.audio || project.files.mic;
  return (
    <>
      <h2>Audio</h2>
      {!hasAny && <div className="hint">This recording has no audio. Turn on system audio or microphone when recording.</div>}
      {project.files.audio && <Slider label="System audio" value={Math.round(a.systemVolume * 100)} min={0} max={200} format={v => `${v}%`} onChange={v => setSettings('audioSettings', { systemVolume: v / 100 }, false)} />}
      {project.files.mic && <Slider label="Microphone" value={Math.round(a.micVolume * 100)} min={0} max={200} format={v => `${v}%`} onChange={v => setSettings('audioSettings', { micVolume: v / 100 }, false)} />}
    </>
  );
}

export { Toggle };
