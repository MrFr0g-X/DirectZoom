import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, FolderOpen, UploadCloud, X } from 'lucide-react';
import { exportProject, type ExportOptions } from '../exporter';
import type { DriveStatus, Project } from '../types';
import { Segmented } from './controls';

const prefsKey = 'directzoom.export.prefs';
type Prefs = Omit<ExportOptions, 'output'>;
const loadPrefs = (): Prefs => {
  const fallback: Prefs = { format: 'mp4', height: 1080, fps: 60, quality: 'high' };
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(prefsKey) || '{}') }; } catch { return fallback; }
};

/** Upload the exported file to Google Drive (connects first if needed). */
function DriveUpload({ file }: { file: string }) {
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { window.dz.gdrive.status().then(setDrive).catch(() => setDrive(null)); }, []);
  useEffect(() => window.dz.gdrive.onProgress(p => { if (p.file === file) setProgress(p.progress); }), [file]);
  if (!drive?.configured) return null;
  const upload = async () => {
    setError('');
    try {
      if (!drive.connected) setDrive(await window.dz.gdrive.connect());
      setProgress(0);
      const done = await window.dz.gdrive.upload(file);
      setLink(done.link);
    } catch (e) {
      setError(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setProgress(null);
    }
  };
  return (
    <div style={{ marginTop: 14 }}>
      {link ? (
        <button className="btn btn-primary" onClick={() => window.dz.openLink(link)}><ExternalLink size={15} />Open in Google Drive</button>
      ) : progress !== null ? (
        <div style={{ maxWidth: 300, margin: '0 auto' }}>
          <div className="field-head"><span>Uploading to Google Drive…</span><span className="value">{Math.round(progress * 100)}%</span></div>
          <div className="progress"><div style={{ width: `${progress * 100}%` }} /></div>
        </div>
      ) : (
        <button className="btn btn-ghost" onClick={upload}><UploadCloud size={15} />{drive.connected ? 'Upload to Google Drive' : 'Connect Google Drive and upload'}</button>
      )}
      {drive.connected && drive.email && !link && progress === null && <div className="hint" style={{ marginTop: 6 }}>as {drive.email}</div>}
      {error && <div className="error-banner" style={{ marginTop: 10, textAlign: 'left' }}>{error}</div>}
    </div>
  );
}

export function ExportDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [state, setState] = useState<{ stage: string; progress: number } | null>(null);
  const [result, setResult] = useState<{ path: string; size: number } | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const set = (value: Partial<Prefs>) => setPrefs(p => { const next = { ...p, ...value }; try { localStorage.setItem(prefsKey, JSON.stringify(next)); } catch {} return next; });

  const start = async () => {
    setError('');
    const output = await window.dz.exporter.choose(project.metadata.name || 'DirectZoom export', prefs.format);
    if (!output) return;
    abort.current = new AbortController();
    setState({ stage: 'Preparing', progress: 0 });
    try {
      const done = await exportProject(project, { ...prefs, output }, (stage, progress) => setState({ stage, progress }), abort.current.signal);
      setResult(done);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(String(e?.message ?? e));
    } finally {
      setState(null);
    }
  };

  const busy = !!state;
  const weights: Record<string, [number, number]> = { 'Reading recording': [0, 0.08], Rendering: [0.08, 0.9], Finishing: [0.9, 1] };
  const overall = state ? (weights[state.stage] ?? [0, 1])[0] + ((weights[state.stage] ?? [0, 1])[1] - (weights[state.stage] ?? [0, 1])[0]) * state.progress : 0;

  return (
    <div className="backdrop" onMouseDown={() => !busy && onClose()}>
      <div className="modal" style={{ width: 480 }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head"><h2>Export</h2><button className="icon-btn" disabled={busy} onClick={onClose}><X size={17} /></button></div>
        <div className="modal-body">
          {result ? (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <CheckCircle2 size={40} color="var(--green)" />
              <h3 style={{ margin: '12px 0 4px' }}>Export complete</h3>
              <div className="hint" style={{ wordBreak: 'break-all' }}>{result.path}</div>
              <div className="hint">{(result.size / 1024 / 1024).toFixed(1)} MB</div>
              <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => window.dz.reveal(result.path)}><FolderOpen size={15} />Show in folder</button>
              <DriveUpload file={result.path} />
            </div>
          ) : (
            <>
              <div className="section-label" style={{ marginTop: 0 }}>Format</div>
              <Segmented value={prefs.format} onChange={v => set({ format: v })} options={[{ value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WebM' }, { value: 'gif', label: 'GIF' }]} />
              <div className="section-label">Resolution</div>
              <Segmented value={prefs.height} onChange={v => set({ height: v })} columns={4} options={[{ value: 720, label: '720p' }, { value: 1080, label: '1080p' }, { value: 2160, label: '4K' }, { value: 'original', label: 'Canvas' }]} />
              <div className="section-label">Frame rate</div>
              <Segmented value={prefs.fps} onChange={v => set({ fps: v })} columns={2} options={[{ value: 30, label: '30 FPS' }, { value: 60, label: '60 FPS' }]} />
              <div className="section-label">Quality</div>
              <Segmented value={prefs.quality} onChange={v => set({ quality: v })} columns={4} options={[{ value: 'draft', label: 'Draft' }, { value: 'balanced', label: 'Balanced' }, { value: 'high', label: 'High' }, { value: 'maximum', label: 'Max' }]} />
              {busy && (
                <div style={{ marginTop: 18 }}>
                  <div className="field-head"><span>{state!.stage}…</span><span className="value">{Math.round(overall * 100)}%</span></div>
                  <div className="progress"><div style={{ width: `${overall * 100}%` }} /></div>
                </div>
              )}
              {error && <div className="error-banner" style={{ marginTop: 14 }}>{error}</div>}
            </>
          )}
        </div>
        <div className="modal-foot">
          <span className="hint">Rendered frame by frame, faster than real time.</span>
          {result ? <button className="btn btn-primary" onClick={onClose}>Done</button>
            : busy ? <button className="btn btn-danger" onClick={() => abort.current?.abort()}>Cancel</button>
              : <button className="btn btn-primary" onClick={start}>Export</button>}
        </div>
      </div>
    </div>
  );
}
