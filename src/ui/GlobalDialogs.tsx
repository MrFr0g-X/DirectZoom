import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, KeyRound, Loader2, RotateCw, Settings, UploadCloud, X } from 'lucide-react';
import type { DriveStatus, UpdateState } from '../types';
import { errorText, openSettings, type FriendlyError } from './errors';
import { Segmented } from './controls';
import { setThemePreference, themePreference, type ThemePreference } from '../theme';

/** Error dialog and Settings window, available from every screen of the main window. */
export function GlobalDialogs() {
  const [error, setError] = useState<FriendlyError | null>(null);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    const onError = (e: Event) => setError((e as CustomEvent<FriendlyError>).detail);
    const onSettings = () => { setError(null); setSettings(true); };
    window.addEventListener('dz-error', onError);
    window.addEventListener('dz-open-settings', onSettings);
    return () => { window.removeEventListener('dz-error', onError); window.removeEventListener('dz-open-settings', onSettings); };
  }, []);
  return (
    <>
      <UpdateNotice />
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
      {error && <ErrorDialog error={error} onClose={() => setError(null)} />}
    </>
  );
}

/** Corner notice when a new version is ready (installed) or available (portable). */
function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    window.dz.updates.state().then(setUpdate).catch(() => {});
    return window.dz.updates.onState(setUpdate);
  }, []);
  const show = update && update.version && dismissed !== update.version && (update.status === 'ready' || (update.status === 'available' && update.portable));
  if (!show) return null;
  return (
    <div className="update-notice" role="status">
      <RotateCw size={16} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>DirectZoom {update.version} is {update.status === 'ready' ? 'ready' : 'available'}</div>
        <div className="hint">{update.status === 'ready' ? 'Restart to finish updating, or it installs when you quit.' : 'Download the new portable version from GitHub.'}</div>
      </div>
      {update.status === 'ready'
        ? <button className="btn btn-primary" onClick={() => window.dz.updates.install()}>Restart</button>
        : <button className="btn btn-primary" onClick={() => window.dz.openLink(update.releasesPage)}>Download</button>}
      <button className="icon-btn" title="Later" onClick={() => setDismissed(update.version)}><X size={15} /></button>
    </div>
  );
}

function ErrorDialog({ error, onClose }: { error: FriendlyError; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="modal" role="alertdialog" aria-labelledby="dz-error-title" style={{ width: 440 }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-body" style={{ paddingTop: 22 }}>
          <div style={{ display: 'flex', gap: 14 }}>
            <div className="error-icon"><AlertTriangle size={20} /></div>
            <div style={{ minWidth: 0 }}>
              <h3 id="dz-error-title" style={{ margin: '2px 0 6px' }}>{error.title}</h3>
              <div style={{ color: 'var(--text-2)', lineHeight: 1.55 }}>{error.message}</div>
              {(error.detail || error.code) && (
                <div className="hint" style={{ marginTop: 10, wordBreak: 'break-word' }}>
                  {error.service} said: {error.detail ?? ''}{error.code ? ` (${error.code})` : ''}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="modal-foot" style={{ justifyContent: 'flex-end', gap: 8 }}>
          {error.link && <button className="btn btn-ghost" onClick={() => window.dz.openLink(error.link!.url)}><ExternalLink size={14} />{error.link.label}</button>}
          {error.settings && <button className="btn btn-ghost" onClick={openSettings}><Settings size={14} />Open Settings</button>}
          <button className="btn btn-primary" autoFocus onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}

type Account = Awaited<ReturnType<Window['dz']['ai']['account']>>;

function SettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ width: 520 }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head"><h2>Settings</h2><button className="icon-btn" onClick={onClose}><X size={17} /></button></div>
        <div className="modal-body">
          <AppearanceSettings />
          <ElevenLabsSettings />
          <DriveSettings />
        </div>
        <div className="modal-foot">
          <span className="hint">Keys and sign-ins are stored encrypted for your Windows account.</span>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const [theme, setTheme] = useState<ThemePreference>(themePreference);
  const choose = (value: ThemePreference) => { setTheme(value); setThemePreference(value); };
  return (
    <section>
      <div className="section-label" style={{ marginTop: 0 }}>Appearance</div>
      <Segmented value={theme} onChange={choose} columns={3}
        options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'Match Windows' }]} />
    </section>
  );
}

function ElevenLabsSettings() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    try { setAccount(await window.dz.ai.account()); setError(''); } catch (e) { setAccount({ configured: true }); setError(errorText(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const save = async (value: string) => {
    setBusy(true); setError('');
    try { await window.dz.ai.setKey(value); setKey(''); await load(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const used = account?.used ?? 0, limit = account?.limit ?? 0;
  const reset = account?.resetsAt ? new Date(account.resetsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null;

  return (
    <section>
      <div className="section-label">ElevenLabs</div>
      <div className="hint" style={{ marginBottom: 10 }}>Used for online captions, AI voiceover, noise removal and voice replacement. You use your own ElevenLabs account and credits.</div>
      {loading ? <div className="hint"><Loader2 size={13} className="spin" style={{ verticalAlign: -2 }} /> Checking…</div> : account?.configured ? (
        <div className="settings-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span><span className="status-dot ok" />API key connected{account.tier ? ` · ${account.tier.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())} plan` : ''}</span>
            <button className="btn btn-ghost" style={{ height: 28 }} disabled={busy} onClick={() => save('')}>Remove</button>
          </div>
          {account.available && limit > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="field-head"><span>Credits used</span><span className="value">{used.toLocaleString()} / {limit.toLocaleString()}</span></div>
              <div className={`progress${used / limit > 0.9 ? ' danger' : ''}`}><div style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} /></div>
              <div className="hint" style={{ marginTop: 6 }}>{Math.max(0, limit - used).toLocaleString()} credits left{reset ? ` · renews ${reset}` : ''}</div>
            </div>
          )}
          {account.available === false && <div className="hint" style={{ marginTop: 8 }}>This key can’t read your plan details, so credit usage isn’t shown. Features still work.</div>}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input className="text-field" type="password" autoComplete="off" spellCheck={false} placeholder={account?.configured ? 'Replace with a new API key' : 'Paste your ElevenLabs API key'}
          value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && key.trim()) save(key); }} />
        <button className="btn btn-primary" disabled={busy || !key.trim()} onClick={() => save(key)}>{busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}Save</button>
      </div>
      {error && <div className="error-banner" style={{ marginTop: 10 }}>{error}</div>}
      <button className="link-btn" style={{ marginTop: 8 }} onClick={() => window.dz.openLink('https://elevenlabs.io/app/settings/api-keys')}>Get an API key on ElevenLabs <ExternalLink size={12} /></button>
    </section>
  );
}

function DriveSettings() {
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { window.dz.gdrive.status().then(setDrive).catch(() => {}); }, []);
  const run = async (action: () => Promise<DriveStatus | null>) => {
    setBusy(true); setError('');
    try { const next = await action(); if (next) setDrive(next); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <section>
      <div className="section-label">Google Drive</div>
      <div className="hint" style={{ marginBottom: 10 }}>Upload exports to a “DirectZoom” folder in your Drive. DirectZoom can only see the files it uploads.</div>
      {!drive?.configured ? (
        <>
          <div className="hint" style={{ marginBottom: 8 }}>This copy of DirectZoom has no Google OAuth client. Choose the “Desktop app” client JSON from Google Cloud.</div>
          <button className="btn btn-ghost" disabled={busy} onClick={() => run(() => window.dz.gdrive.importClient())}><KeyRound size={14} />Choose client file…</button>
        </>
      ) : drive.connected ? (
        <div className="settings-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span><span className="status-dot ok" />Connected as {drive.email ?? 'your account'}</span>
          <button className="btn btn-ghost" style={{ height: 28 }} disabled={busy} onClick={() => run(() => window.dz.gdrive.disconnect())}>Disconnect</button>
        </div>
      ) : (
        <button className="btn btn-ghost" disabled={busy} onClick={() => run(() => window.dz.gdrive.connect())}>{busy ? <Loader2 size={14} className="spin" /> : <UploadCloud size={14} />}{busy ? 'Waiting for Google sign-in…' : 'Connect Google Drive'}</button>
      )}
      {error && <div className="error-banner" style={{ marginTop: 10 }}>{error}</div>}
    </section>
  );
}
