import { useEffect, useState, type ReactElement } from 'react';
import { AppWindow, Check, Crop, Keyboard, Mic, Monitor, RefreshCw, Video, Volume2, X } from 'lucide-react';
import { listCameras, openCamera, startCamera } from '../cameraRecorder';
import type { CaptureSource, DisplayDevice, Microphone, Rect, WindowDevice } from '../types';

type Tab = 'display' | 'window' | 'area';
const prefsKey = 'directzoom.record.prefs';
type Prefs = { systemAudio: boolean; microphone: boolean; keyboard: boolean; fps: 30 | 60; countdown: boolean; camera: boolean; cameraId: string; microphoneId: string };
const loadPrefs = (): Prefs => {
  try { return { systemAudio: true, microphone: false, keyboard: false, fps: 60, countdown: true, camera: false, cameraId: '', microphoneId: '', ...JSON.parse(localStorage.getItem(prefsKey) || '{}') }; }
  catch { return { systemAudio: true, microphone: false, keyboard: false, fps: 60, countdown: true, camera: false, cameraId: '', microphoneId: '' }; }
};

export function RecordDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('display');
  const [devices, setDevices] = useState<{ displays: DisplayDevice[]; windows: WindowDevice[]; microphones: Microphone[] } | null>(null);
  const [display, setDisplay] = useState<number | null>(null);
  const [windowHwnd, setWindowHwnd] = useState<number | null>(null);
  const [area, setArea] = useState<{ display: number; rect: Rect } | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  useEffect(() => { if (prefs.camera) listCameras().then(list => { setCameras(list); if (!prefs.cameraId && list[0]) setPrefs(p => ({ ...p, cameraId: list[0].id })); }); }, [prefs.camera]);

  const load = () => {
    setDevices(null);
    window.dz.devices().then(d => {
      setDevices(d);
      setDisplay(current => current ?? d.displays.find(x => x.primary)?.index ?? d.displays[0]?.index ?? null);
    }).catch(e => setError(String(e?.message ?? e)));
  };
  useEffect(load, []);
  useEffect(() => { try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch {} }, [prefs]);

  const chooseArea = async (index: number) => {
    setError('');
    const result = await window.dz.selectArea(index);
    if (result) { setArea(result); setTab('area'); }
  };

  const source: { source: CaptureSource; name: string } | null =
    tab === 'display' && display !== null ? { source: { kind: 'display', index: display }, name: devices?.displays.find(d => d.index === display)?.name || `Display ${display}` }
      : tab === 'window' && windowHwnd !== null ? { source: { kind: 'window', hwnd: windowHwnd }, name: devices?.windows.find(w => w.hwnd === windowHwnd)?.title ?? 'Window' }
        : tab === 'area' && area ? { source: { kind: 'area', display: area.display, rect: area.rect }, name: `Area ${area.rect.width}×${area.rect.height}` } : null;

  const start = async () => {
    if (!source) return;
    setError('');
    setStarting(true);
    let stream: MediaStream | null = null;
    try {
      // Open the camera first so a permission prompt cannot delay the screen recording.
      if (prefs.camera) stream = await openCamera(prefs.cameraId);
      if (prefs.countdown) for (let n = 3; n > 0; n--) { setCount(n); await new Promise(r => setTimeout(r, 800)); }
      setCount(null);
      const started = await window.dz.recording.start({ source: source.source, sourceName: source.name, fps: prefs.fps, systemAudio: prefs.systemAudio, microphone: prefs.microphone, keyboard: prefs.keyboard, camera: !!stream, cameraDeviceId: prefs.cameraId, microphoneId: prefs.microphone && devices?.microphones.some(m => m.id === prefs.microphoneId) ? prefs.microphoneId : undefined });
      if (stream) startCamera(stream, started.id, started.startedAt);
      onClose();
    } catch (e: any) {
      stream?.getTracks().forEach(t => t.stop());
      setCount(null);
      setError(String(e?.message ?? e));
    } finally {
      setStarting(false);
    }
  };

  const option = (key: keyof Prefs, label: string, icon: ReactElement) => (
    <button className={`option${prefs[key] ? ' on' : ''}`} onClick={() => setPrefs(p => ({ ...p, [key]: !p[key] }))}>
      {icon}{label}{prefs[key] && <Check size={14} />}
    </button>
  );

  return (
    <div className="backdrop" onMouseDown={() => !starting && onClose()}>
      {count !== null && <div className="countdown">{count}</div>}
      <div className="modal" onMouseDown={e => e.stopPropagation()} style={{ visibility: count !== null ? 'hidden' : 'visible' }}>
        <div className="modal-head">
          <h2>New Recording</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="tabs">
              <button className={tab === 'display' ? 'active' : ''} onClick={() => setTab('display')}><Monitor size={15} />Display</button>
              <button className={tab === 'window' ? 'active' : ''} onClick={() => setTab('window')}><AppWindow size={15} />Window</button>
              <button className={tab === 'area' ? 'active' : ''} onClick={() => setTab('area')}><Crop size={15} />Area</button>
            </div>
            <button className="icon-btn" aria-label="Refresh sources" onClick={load}><RefreshCw size={15} /></button>
          </div>
          {!devices && !error && <div className="loading" style={{ marginTop: 24 }}><div className="spinner" />Finding screens and windows…</div>}
          {devices && tab === 'display' && (
            <div className="source-grid">
              {devices.displays.map(d => (
                <button key={d.index} className={`source${display === d.index ? ' selected' : ''}`} onClick={() => setDisplay(d.index)}>
                  <div className="preview">{d.thumbnail ? <img src={d.thumbnail} alt="" /> : <Monitor size={28} />}</div>
                  <div className="label"><Monitor size={14} /><span>{d.name || `Display ${d.index}`}{d.primary ? ' · Main' : ''}</span><span className="hint" style={{ marginLeft: 'auto' }}>{d.bounds.width}×{d.bounds.height}</span></div>
                </button>
              ))}
            </div>
          )}
          {devices && tab === 'window' && (
            <div className="source-grid">
              {devices.windows.length === 0 && <div className="hint">No windows available. Minimized windows are not listed.</div>}
              {devices.windows.map(w => (
                <button key={w.hwnd} className={`source${windowHwnd === w.hwnd ? ' selected' : ''}`} onClick={() => setWindowHwnd(w.hwnd)}>
                  <div className="preview">{w.thumbnail ? <img src={w.thumbnail} alt="" /> : <AppWindow size={28} />}</div>
                  <div className="label">{w.icon ? <img src={w.icon} alt="" /> : <AppWindow size={14} />}<span title={w.title}>{w.title}</span></div>
                </button>
              ))}
            </div>
          )}
          {devices && tab === 'area' && (
            <div style={{ marginTop: 16 }}>
              <p className="hint" style={{ marginTop: 0 }}>Choose a display, then drag to select the area to record.</p>
              <div className="source-grid">
                {devices.displays.map(d => (
                  <button key={d.index} className={`source${area?.display === d.index ? ' selected' : ''}`} onClick={() => chooseArea(d.index)}>
                    <div className="preview">{d.thumbnail ? <img src={d.thumbnail} alt="" /> : <Monitor size={28} />}</div>
                    <div className="label"><Crop size={14} /><span>{area?.display === d.index ? `${area.rect.width}×${area.rect.height} selected` : `Select on ${d.name || `Display ${d.index}`}`}</span></div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="section-label" style={{ marginTop: 22 }}>Recording options</div>
          <div className="option-row">
            {option('systemAudio', 'System audio', <Volume2 size={15} />)}
            {option('microphone', 'Microphone', <Mic size={15} />)}
            {prefs.microphone && (devices?.microphones.length ?? 0) > 1 && (
              <select value={prefs.microphoneId || devices!.microphones.find(m => m.default)?.id || ''} onChange={e => setPrefs(p => ({ ...p, microphoneId: e.target.value }))} title="Microphone"
                style={{ height: 34, maxWidth: 220, borderRadius: 10, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--line)', padding: '0 8px' }}>
                {devices!.microphones.map(m => <option key={m.id} value={m.id}>{m.name}{m.default ? ' (default)' : ''}</option>)}
              </select>
            )}
            {option('keyboard', 'Keystrokes', <Keyboard size={15} />)}
            {option('camera', 'Camera', <Video size={15} />)}
            {prefs.camera && cameras.length > 0 && (
              <select value={prefs.cameraId} onChange={e => setPrefs(p => ({ ...p, cameraId: e.target.value }))}
                style={{ height: 34, borderRadius: 10, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--line)', padding: '0 8px' }}>
                {cameras.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            )}
            {option('countdown', '3s countdown', <RefreshCw size={15} />)}
            <div className="pill-group" style={{ marginLeft: 'auto' }}>
              {[30, 60].map(f => <button key={f} className={prefs.fps === f ? 'active' : ''} onClick={() => setPrefs(p => ({ ...p, fps: f as 30 | 60 }))}>{f} FPS</button>)}
            </div>
          </div>
          {error && <div className="error-banner" style={{ marginTop: 14 }}>{error}</div>}
        </div>
        <div className="modal-foot">
          <span className="hint">The cursor is recorded separately so you can restyle it later. DirectZoom's own windows stay out of the recording.</span>
          <button className="btn btn-primary btn-lg" disabled={!source || starting} onClick={start}>
            <span className="rec-dot" style={{ animation: 'none', boxShadow: 'none', background: '#fff' }} />{starting ? 'Starting…' : 'Start Recording'}
          </button>
        </div>
      </div>
    </div>
  );
}
