import { Plus } from 'lucide-react';
import { Slider, ToggleRow, formatTime } from './controls';
import { sourceToTimeline, timelineToSource } from '../timeline';
import type { Project, ProjectSettings, ThreeDKeyframe } from '../types';

type SetSettings = <K extends keyof ProjectSettings>(key: K, value: Partial<ProjectSettings[K]>, record?: boolean) => void;
type Update = (change: Partial<Pick<Project, 'threeDKeyframes'>>, record?: boolean) => void;

const presets: Array<{ name: string; pose: Pick<ThreeDKeyframe, 'rotateX' | 'rotateY' | 'rotateZ' | 'perspective' | 'scale'> }> = [
  { name: 'Tilt back', pose: { rotateX: 18, rotateY: 0, rotateZ: 0, perspective: 1200, scale: 0.9 } },
  { name: 'Turn left', pose: { rotateX: 6, rotateY: -22, rotateZ: 0, perspective: 1400, scale: 0.88 } },
  { name: 'Turn right', pose: { rotateX: 6, rotateY: 22, rotateZ: 0, perspective: 1400, scale: 0.88 } },
  { name: 'Dramatic', pose: { rotateX: 28, rotateY: -18, rotateZ: 6, perspective: 800, scale: 0.8 } },
];

/** 3D panel: regions start at the playhead and are closed with "Set end". */
export function ThreeDPanel({ project, setSettings, update, time, selected, onSelect }: {
  project: Project; setSettings: SetSettings; update: Update; time: number; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const t3 = project.settings.threeDSettings;
  const set = (value: Partial<typeof t3>, record = true) => setSettings('threeDSettings', value, record);
  const region = project.threeDKeyframes.find(k => k.id === selected) ?? null;
  const open = region?.endTime === -1;
  const pose = region ?? { rotateX: t3.defaultRotateX, rotateY: t3.defaultRotateY, rotateZ: t3.defaultRotateZ, perspective: t3.defaultPerspective, scale: t3.defaultScale };
  const change = (patch: Partial<ThreeDKeyframe>, record = false) => {
    if (region) update({ threeDKeyframes: project.threeDKeyframes.map(k => (k.id === region.id ? { ...k, ...patch } : k)) }, record);
    else set({
      ...(patch.rotateX !== undefined ? { defaultRotateX: patch.rotateX } : {}), ...(patch.rotateY !== undefined ? { defaultRotateY: patch.rotateY } : {}),
      ...(patch.rotateZ !== undefined ? { defaultRotateZ: patch.rotateZ } : {}), ...(patch.perspective !== undefined ? { defaultPerspective: patch.perspective } : {}),
      ...(patch.scale !== undefined ? { defaultScale: patch.scale } : {}),
    }, record);
  };
  const atTimeline = (ms: number) => sourceToTimeline(ms, project.clips) ?? 0;
  const add = () => {
    const start = timelineToSource(time, project.clips);
    const created: ThreeDKeyframe = {
      id: `3d-${Date.now().toString(36)}`, startTime: start, endTime: -1, rotateX: t3.defaultRotateX, rotateY: t3.defaultRotateY,
      rotateZ: t3.defaultRotateZ, perspective: t3.defaultPerspective, scale: t3.defaultScale,
    };
    // A neutral default pose would be invisible; start from a gentle tilt instead.
    if (!created.rotateX && !created.rotateY && !created.rotateZ && created.scale === 1) Object.assign(created, presets[0].pose);
    update({ threeDKeyframes: [...project.threeDKeyframes, created].sort((a, b) => a.startTime - b.startTime) });
    onSelect(created.id);
  };
  const setEnd = () => {
    if (!region) return;
    const end = timelineToSource(time, project.clips);
    if (end <= region.startTime + 100) return;
    update({ threeDKeyframes: project.threeDKeyframes.map(k => (k.id === region.id ? { ...k, endTime: end } : k)) });
  };

  return (
    <>
      <h2>3D</h2>
      <ToggleRow title="Enable 3D effect" desc="Tilts the recording in perspective during the regions you add." on={t3.enabled} onChange={v => set({ enabled: v })} />
      {t3.enabled && (
        <>
          {region ? (
            <div className="ai-card" style={{ borderColor: open ? 'rgba(255, 196, 0, 0.35)' : 'rgba(48, 209, 88, 0.35)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="title" style={{ margin: 0 }}>{open ? `Region from ${formatTime(atTimeline(region.startTime))}` : `Region ${formatTime(atTimeline(region.startTime))} → ${formatTime(atTimeline(region.endTime))}`}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {open
                    ? <button className="btn btn-primary" style={{ height: 28 }} onClick={setEnd}>Set end</button>
                    : <button className="btn btn-ghost" style={{ height: 28 }} onClick={() => onSelect(null)}>Deselect</button>}
                  <button className="btn btn-danger" style={{ height: 28 }} onClick={() => { update({ threeDKeyframes: project.threeDKeyframes.filter(k => k.id !== region.id) }); onSelect(null); }}>Delete</button>
                </div>
              </div>
              {open && <div className="hint" style={{ marginTop: 8 }}>Move the playhead to where the effect should end, then click “Set end”.</div>}
            </div>
          ) : (
            <div className="row">
              <div><div className="title">Default pose</div><div className="desc">Used for new regions.</div></div>
              <button className="btn btn-primary" onClick={add}><Plus size={14} />Add region</button>
            </div>
          )}
          <div className="section-label">Presets</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
            {presets.map(p => <button key={p.name} className="btn btn-ghost" onClick={() => change(p.pose, true)}>{p.name}</button>)}
          </div>
          <Slider label="Rotate X (tilt)" value={pose.rotateX} min={-60} max={60} format={v => `${v}°`} onChange={v => change({ rotateX: v })} />
          <Slider label="Rotate Y (turn)" value={pose.rotateY} min={-60} max={60} format={v => `${v}°`} onChange={v => change({ rotateY: v })} />
          <Slider label="Rotate Z (roll)" value={pose.rotateZ} min={-30} max={30} format={v => `${v}°`} onChange={v => change({ rotateZ: v })} />
          <Slider label="Perspective" value={pose.perspective} min={500} max={3000} step={50} format={v => `${v}px`} onChange={v => change({ perspective: v })} />
          <Slider label="Scale" value={Math.round(pose.scale * 100)} min={50} max={120} format={v => `${v}%`} onChange={v => change({ scale: v / 100 })} />
          {!region && (
            <>
              <Slider label="Transition" value={t3.transitionDuration} min={0} max={2000} step={50} format={v => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`)} onChange={v => set({ transitionDuration: v }, false)} />
              <ToggleRow title="Reflection" desc="Mirrored copy under the tilted frame." on={t3.reflection} onChange={v => set({ reflection: v })} />
              {t3.reflection && (
                <>
                  <Slider label="Reflection opacity" value={Math.round(t3.reflectionOpacity * 100)} min={5} max={80} format={v => `${v}%`} onChange={v => set({ reflectionOpacity: v / 100 }, false)} />
                  <Slider label="Reflection gap" value={t3.reflectionGap} min={0} max={60} onChange={v => set({ reflectionGap: v }, false)} />
                </>
              )}
            </>
          )}
          <div className="section-label">Regions ({project.threeDKeyframes.length})</div>
          {project.threeDKeyframes.map(k => (
            <button key={k.id} className={`btn ${k.id === selected ? 'btn-primary' : 'btn-ghost'}`} style={{ width: '100%', justifyContent: 'space-between', marginBottom: 6 }} onClick={() => onSelect(k.id)}>
              <span>{formatTime(atTimeline(k.startTime))} → {k.endTime === -1 ? '…' : formatTime(atTimeline(k.endTime))}</span>
              <span style={{ opacity: 0.7 }}>{k.rotateX}° / {k.rotateY}°</span>
            </button>
          ))}
        </>
      )}
    </>
  );
}
