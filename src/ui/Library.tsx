import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Download, Film, Layers, Pencil, Plus, Search, Settings, Trash2 } from 'lucide-react';
import type { ProjectSummary } from '../types';
import { navigate } from '../App';
import { BrandMark, TitleBar } from './TitleBar';
import { RecordDialog } from './RecordDialog';
import { formatTime } from './controls';
import { HelpMenu } from './HelpMenu';
import { errorText, openSettings } from './errors';
import { AUTHOR_PROFILE } from '../links';

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function ago(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

function group(iso: string) {
  const date = new Date(iso), now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= start) return 'Today';
  if (date.getTime() >= start - 6 * 86400000) return 'This Week';
  if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) return 'This Month';
  return 'Earlier';
}

export function Library() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [recordOpen, setRecordOpen] = useState(false);
  const [importError, setImportError] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const refresh = useCallback(() => window.dz.projects.list().then(setProjects), []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => window.dz.recording.onFinished(({ id, warnings, closed }) => {
    // Recorder warnings (e.g. a muted microphone) are shown once in the editor.
    const notices = [...(closed ? [`The recording stopped because the source closed: ${closed}`] : []), ...warnings];
    try { if (notices.length) sessionStorage.setItem(`dz.notices.${id}`, JSON.stringify(notices)); } catch {}
    navigate(`/editor/${id}`);
  }), []);

  const filtered = useMemo(() => (projects ?? []).filter(p => !query || p.name?.toLowerCase().includes(query.toLowerCase())), [projects, query]);
  const groups = useMemo(() => {
    const map = new Map<string, ProjectSummary[]>();
    for (const project of filtered) {
      const key = group(project.createdAt);
      map.set(key, [...(map.get(key) ?? []), project]);
    }
    return ['Today', 'This Week', 'This Month', 'Earlier'].filter(k => map.has(k)).map(k => [k, map.get(k)!] as const);
  }, [filtered]);
  const totalMinutes = Math.round((projects ?? []).reduce((sum, p) => sum + (p.duration || 0), 0) / 60000);

  return (
    <div className="app">
      <TitleBar><div className="brand"><BrandMark />DirectZoom</div></TitleBar>
      <main className="library">
        <div className="library-inner">
          <div className="library-head">
            <div>
              <div className="greeting">{greeting()}</div>
              <h1>Library</h1>
              <div className="stats">
                <span><Layers size={14} />{projects?.length ?? 0} {projects?.length === 1 ? 'recording' : 'recordings'}</span>
                <span><Clock size={14} />{totalMinutes} min</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost btn-lg" title="Settings" onClick={openSettings}><Settings size={16} /></button>
              <HelpMenu />
              <button className="btn btn-ghost btn-lg" title="Import recording folders" onClick={async () => {
                setImportError('');
                try {
                  const ids = await window.dz.projects.importFolder();
                  if (ids.length === 1) navigate(`/editor/${ids[0]}`); else if (ids.length) refresh();
                } catch (e) { setImportError(errorText(e)); }
              }}><Download size={16} />Import</button>
              <button className="btn btn-primary btn-lg" onClick={() => setRecordOpen(true)}><Plus size={17} />New Recording</button>
            </div>
          </div>
          {importError && <div className="error-banner" style={{ marginBottom: 16 }}>{importError}</div>}
          <div className="toolbar-row">
            <label className="search"><Search size={15} /><input placeholder="Search recordings..." value={query} onChange={e => setQuery(e.target.value)} /></label>
            <button className="chip active"><Layers size={14} />All<span className="count">{projects?.length ?? 0}</span></button>
          </div>
          {projects && projects.length === 0 && (
            <div className="empty">
              <Film size={30} />
              <h3>No recordings yet</h3>
              <div>Record your screen, a window, or an area. DirectZoom adds automatic zooms and a smooth cursor.</div>
              <div style={{ marginTop: 18 }}><button className="btn btn-primary btn-lg" onClick={() => setRecordOpen(true)}><Plus size={17} />New Recording</button></div>
            </div>
          )}
          {groups.map(([title, items]) => (
            <section key={title}>
              <h3 className="group-title">{title}<span className="n">{items.length}</span></h3>
              <div className="grid">
                {items.map(project => (
                  <div key={project.id} className="card" role="button" tabIndex={0} onClick={() => renaming !== project.id && navigate(`/editor/${project.id}`)}>
                    <div className="thumb">
                      {project.hasThumbnail ? <img src={window.dz.projects.mediaUrl(project.id, 'thumbnail.jpg')} alt="" draggable={false} /> : <Film size={26} />}
                      <span className="duration">{formatTime(project.duration)}</span>
                    </div>
                    <div className="meta">
                      {renaming === project.id ? (
                        <input autoFocus defaultValue={project.name} onClick={e => e.stopPropagation()}
                          style={{ width: '100%', background: 'var(--field)', border: '1px solid var(--line-strong)', borderRadius: 8, padding: '4px 8px', outline: 'none' }}
                          onKeyDown={async e => {
                            if (e.key === 'Escape') setRenaming(null);
                            if (e.key === 'Enter') { await window.dz.projects.rename(project.id, (e.target as HTMLInputElement).value.trim() || project.name); setRenaming(null); refresh(); }
                          }}
                          onBlur={async e => { await window.dz.projects.rename(project.id, e.target.value.trim() || project.name); setRenaming(null); refresh(); }} />
                      ) : <div className="name">{project.name}</div>}
                      <div className="sub">{ago(project.createdAt)} · {project.resolution?.width}×{project.resolution?.height}{project.importedFrom ? ' · Imported' : ''}</div>
                    </div>
                    <div className="card-actions">
                      <button title="Rename" onClick={e => { e.stopPropagation(); setRenaming(project.id); }}><Pencil size={13} /></button>
                      <button title="Delete" onClick={async e => { e.stopPropagation(); if (await window.dz.projects.remove(project.id)) refresh(); }}><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <div className="made-by">Made with <span className="heart">♥</span> by <button className="link-btn" onClick={() => window.dz.openLink(AUTHOR_PROFILE)}>MrFr0g-X</button></div>
        </div>
      </main>
      {recordOpen && <RecordDialog onClose={() => setRecordOpen(false)} />}
    </div>
  );
}
