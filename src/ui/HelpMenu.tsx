import { useEffect, useRef, useState } from 'react';
import { CircleHelp, Download, FileDown, Info, Loader2, RefreshCw, RotateCw } from 'lucide-react';
import type { UpdateState } from '../types';
import { AUTHOR_PROFILE, WEBSITE } from '../links';

/** Text for an update state (shared with the update notice). */
export function updateLine(update: UpdateState | null) {
  if (!update) return '';
  switch (update.status) {
    case 'checking': return 'Checking for updates…';
    case 'current': return `You have the latest version (${update.current}).`;
    case 'available': return `Version ${update.version} is available.`;
    case 'downloading': return `Downloading version ${update.version ?? ''}… ${Math.round(update.progress * 100)}%`;
    case 'ready': return `Version ${update.version} is ready to install.`;
    case 'error': return `Couldn’t check for updates: ${update.error}`;
    default: return '';
  }
}

/** Library "Help" menu: version, updates and a diagnostics file for bug reports. */
export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState('');
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    window.dz.appInfo().then(i => setVersion(i.version)).catch(() => {});
    window.dz.updates.state().then(setUpdate).catch(() => {});
    return window.dz.updates.onState(setUpdate);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const save = async () => {
    setStatus('');
    try {
      const file = await window.dz.diagnostics();
      if (file) setStatus(`Saved to ${file}`);
    } catch (e) {
      setStatus(String((e as Error)?.message ?? e));
    }
  };
  const check = async () => setUpdate(await window.dz.updates.check());
  const busy = update?.status === 'checking' || update?.status === 'downloading';
  const line = updateLine(update);
  const attention = update?.status === 'ready' || update?.status === 'available';

  return (
    <div ref={root} style={{ position: 'relative' }}>
      <button className="btn btn-ghost btn-lg" title="Help" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <CircleHelp size={16} />{attention && <span className="badge-dot" aria-label="Update available" />}
      </button>
      {open && (
        <div className="brand-menu" role="menu" style={{ width: 320 }}>
          <div className="brand-title"><Info size={13} style={{ verticalAlign: -2, marginRight: 6 }} />DirectZoom {version}{update?.portable ? ' (portable)' : ''}</div>
          <div className="hint" style={{ marginTop: -4 }}>
            Made with <span style={{ color: '#ff4d6d' }}>♥</span> by <button className="link-btn" onClick={() => window.dz.openLink(AUTHOR_PROFILE)}>MrFr0g-X</button>
            {' · '}<button className="link-btn" onClick={() => window.dz.openLink(WEBSITE)}>Website</button>
          </div>

          <div className="section-label" style={{ marginTop: 4 }}>Updates</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {update?.status === 'ready' ? (
              <button className="btn btn-primary" onClick={() => window.dz.updates.install()}><RotateCw size={14} />Restart to update</button>
            ) : update?.status === 'available' && update.portable ? (
              <button className="btn btn-primary" onClick={() => window.dz.openLink(update.releasesPage)}><Download size={14} />Download</button>
            ) : (
              <button className="btn btn-ghost" disabled={busy} onClick={check}>{busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}Check for updates</button>
            )}
          </div>
          {line && <div className="hint" style={{ marginTop: 8 }}>{line}</div>}
          {update?.status === 'downloading' && <div className="progress" style={{ marginTop: 6 }}><div style={{ width: `${update.progress * 100}%` }} /></div>}
          <div className="hint" style={{ marginTop: 6 }}>{update?.portable ? 'The portable version checks for new releases; download them from GitHub.' : 'New versions download in the background and install when you restart.'}</div>

          <div className="section-label">Report a problem</div>
          <div className="hint" style={{ marginBottom: 10 }}>Save a diagnostics file and attach it to your report. It lists your system and recent errors; it contains no recordings or keys.</div>
          <button className="btn btn-primary" onClick={save}><FileDown size={14} />Save diagnostics…</button>
          {status && <div className="hint" style={{ marginTop: 8, wordBreak: 'break-all' }}>{status}</div>}
          <div className="hint" style={{ marginTop: 10 }}>
            Contact: <button className="link-btn" onClick={() => window.dz.openLink(`mailto:h@hothifa.tech?subject=${encodeURIComponent(`DirectZoom ${version}`)}`)}>h@hothifa.tech</button>
          </div>
        </div>
      )}
    </div>
  );
}
