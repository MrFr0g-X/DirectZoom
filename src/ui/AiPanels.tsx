import { useEffect, useMemo, useState } from 'react';
import { Download, KeyRound, Loader2, Music, Play, Scissors, Sparkles, Trash2, Upload, Wand2, X } from 'lucide-react';
import { errorText, reportError } from './errors';
import { ColorField, Segmented, Slider, ToggleRow, formatTime } from './controls';
import { captionWords, fillerRanges, groupWords, onTimeline, parseSubtitles, retext, spreadWords, toSrt, mapCaptions } from '../captions';
import { cutRanges, sourceToTimeline } from '../timeline';
import { voiceoverLength } from '../audioMix';
import type { Caption, PiperStatus, Project, ProjectSettings, VoiceoverClip, WhisperStatus } from '../types';

type SetSettings = <K extends keyof ProjectSettings>(key: K, value: Partial<ProjectSettings[K]>, record?: boolean) => void;
type Update = (change: Partial<Pick<Project, 'captions' | 'voiceoverClips'>>, record?: boolean) => void;

// Service errors (ElevenLabs credits, key, voice…) open the error dialog; the short text stays inline too.
const message = reportError;

// ---------- API key ----------

let keyStatus: Promise<{ configured: boolean }> | null = null;

function useAiKey() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    keyStatus ??= window.dz.ai.status();
    keyStatus.then(s => setConfigured(s.configured)).catch(() => setConfigured(false));
  }, []);
  return {
    configured,
    save: async (key: string) => {
      const result = await window.dz.ai.setKey(key);
      keyStatus = Promise.resolve(result);
      setConfigured(result.configured);
    },
  };
}

function ApiKeyCard({ purpose, onSaved }: { purpose: string; onSaved: (key: string) => Promise<void> }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="ai-card">
      <div className="title"><KeyRound size={13} style={{ verticalAlign: -2, marginRight: 6 }} />Connect ElevenLabs</div>
      <div className="hint" style={{ marginBottom: 10 }}>{purpose} uses your ElevenLabs account. The key is encrypted on this PC and only sent to ElevenLabs.</div>
      <input className="text-field" type="password" placeholder="sk_…" value={key} onChange={e => setKey(e.target.value)} spellCheck={false} />
      {error && <div className="ai-error">{error}</div>}
      <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={!key.trim() || busy}
        onClick={async () => { setBusy(true); setError(''); try { await onSaved(key); setKey(''); } catch (e) { setError(message(e)); } finally { setBusy(false); } }}>
        {busy ? <Loader2 size={14} className="spin" /> : null}Save key
      </button>
    </div>
  );
}

// ---------- captions ----------

const languages = [
  ['', 'Detect automatically'], ['en', 'English'], ['ar', 'Arabic'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['nl', 'Dutch'], ['tr', 'Turkish'], ['ru', 'Russian'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'],
] as const;

function setAlpha(color: string, alpha: number) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) { const n = parseInt(hex[1], 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`; }
  return color;
}

export function CaptionsPanel({ project, setSettings, update, time, seek }: { project: Project; setSettings: SetSettings; update: Update; time: number; seek: (t: number) => void }) {
  const s = project.settings.captionSettings;
  const set = (value: Partial<typeof s>, record = true) => setSettings('captionSettings', value, record);
  const ai = useAiKey();
  const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasAudio = project.files.audio || project.files.mic;
  const timeline = useMemo(() => mapCaptions(project.captions, project.clips), [project.captions, project.clips]);

  // Engine: ElevenLabs Scribe (online) or whisper.cpp on this PC (offline).
  const [engine, setEngine] = useState<'elevenlabs' | 'local'>(() => (localStorageGet('dz.captionEngine') as 'local' | null) ?? 'elevenlabs');
  const [model, setModel] = useState(() => localStorageGet('dz.whisperModel') ?? 'base');
  const [whisper, setWhisper] = useState<WhisperStatus | null>(null);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  useEffect(() => { window.dz.whisper.status().then(setWhisper).catch(() => setWhisper(null)); }, []);
  useEffect(() => window.dz.whisper.onProgress(setProgress), []);
  useEffect(() => window.dz.whisper.onTranscribeProgress(p => { if (p.id === project.id) setProgress({ stage: 'Transcribing', progress: p.progress }); }), [project.id]);
  const chooseEngine = (value: 'elevenlabs' | 'local') => { setEngine(value); localStorageSet('dz.captionEngine', value); };
  const chooseModel = (value: string) => { setModel(value); localStorageSet('dz.whisperModel', value); };
  const modelReady = !!whisper?.installed && !!whisper.models.find(m => m.id === model)?.installed;
  const installEngine = async () => {
    setBusy(true); setError('');
    try { setWhisper(await window.dz.whisper.install(model)); } catch (e) { setError(message(e)); } finally { setBusy(false); setProgress(null); }
  };

  const generate = async () => {
    setBusy(true); setError('');
    try {
      const result = await window.dz.ai.transcribe(project.id, { language: language || undefined, engine, model });
      if (!result.words.length) throw new Error('No speech was found in this recording');
      const captions = groupWords(result.words, s);
      update({ captions: [...project.captions.filter(onTimeline), ...captions] });
      if (!s.enabled) set({ enabled: true });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  // Imported subtitles replace earlier imports; they are timed against the edited video.
  const importSubtitles = async () => {
    setError('');
    try {
      const text = await window.dz.openSubtitles();
      if (text === null) return;
      const imported = parseSubtitles(text);
      if (!imported.length) throw new Error('No captions were found in that file');
      update({ captions: [...project.captions.filter(c => c.source !== 'manual'), ...imported] });
      if (!s.enabled) set({ enabled: true });
    } catch (e) {
      setError(message(e));
    }
  };
  const editCaption = (id: string, text: string) => update({ captions: project.captions.map(c => (c.id === id ? retext(c, text) : c)) }, false);
  const removeCaption = (id: string) => update({ captions: project.captions.filter(c => c.id !== id) });
  const atTimeline = (c: Caption) => (onTimeline(c) ? c.startMs : sourceToTimeline(c.startMs, project.clips));

  return (
    <>
      <h2>Captions</h2>
      <div className="ai-card">
        <div className="title">{project.captions.some(c => !onTimeline(c)) ? 'Re-generate captions' : 'Generate captions'}</div>
        {!hasAudio && <div className="hint" style={{ marginBottom: 10 }}>This recording has no audio to transcribe. Voiceover captions can still be added from the Voiceover panel.</div>}
        <Segmented value={engine} columns={2} onChange={chooseEngine} options={[{ value: 'elevenlabs', label: 'ElevenLabs' }, { value: 'local', label: 'On this PC' }]} />
        <div className="hint" style={{ margin: '8px 0 10px' }}>
          {engine === 'elevenlabs'
            ? 'Most accurate, keeps “um” and “uh” for filler removal. Uses your ElevenLabs account.'
            : 'Private and free: Whisper runs offline on this PC. Downloaded once.'}
        </div>
        {engine === 'elevenlabs' && ai.configured === false && <ApiKeyCard purpose="Automatic captions" onSaved={ai.save} />}
        {engine === 'local' && (
          <select className="text-field" style={{ marginBottom: 8 }} value={model} onChange={e => chooseModel(e.target.value)} disabled={busy}>
            {(whisper?.models ?? [{ id: 'tiny', label: 'Fast (75 MB)', installed: false }, { id: 'base', label: 'Balanced (148 MB)', installed: false }, { id: 'small', label: 'Accurate (488 MB)', installed: false }])
              .map(m => <option key={m.id} value={m.id}>{m.label}{m.installed ? ' · downloaded' : ''}</option>)}
          </select>
        )}
        <select className="text-field" value={language} onChange={e => setLanguage(e.target.value)} disabled={!hasAudio || busy}>
          {languages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
        {error && <div className="ai-error">{error}</div>}
        {progress && (
          <div style={{ marginTop: 10 }}>
            <div className="hint">{progress.stage} {Math.round(progress.progress * 100)}%</div>
            <div style={{ height: 4, borderRadius: 4, background: 'var(--field)', overflow: 'hidden', marginTop: 4 }}>
              <div style={{ width: `${Math.round(progress.progress * 100)}%`, height: '100%', background: 'var(--blue)', transition: 'width 0.2s' }} />
            </div>
          </div>
        )}
        {engine === 'local' && !modelReady ? (
          <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy} onClick={installEngine}>
            {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}{busy ? 'Downloading…' : 'Download offline engine'}
          </button>
        ) : (
          <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={!hasAudio || busy || (engine === 'elevenlabs' && !ai.configured)} onClick={generate}>
            {busy ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}{busy ? 'Transcribing…' : 'Generate'}
          </button>
        )}
      </div>
      <ToggleRow title="Show captions" on={s.enabled} onChange={v => set({ enabled: v })} />
      <div className="section-label">Style</div>
      <Segmented value={s.style} onChange={v => set({ style: v })} options={[{ value: 'classic', label: 'Classic' }, { value: 'tiktok', label: 'Word pop' }, { value: 'karaoke', label: 'Karaoke' }]} />
      <div className="section-label">Position</div>
      <Segmented value={s.position} onChange={v => set({ position: v })} options={[{ value: 'top', label: 'Top' }, { value: 'center', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
      <div style={{ height: 12 }} />
      <Slider label="Font size" value={s.fontSize} min={16} max={96} onChange={v => set({ fontSize: v }, false)} />
      <Segmented value={s.fontWeight} onChange={v => set({ fontWeight: v })} options={[{ value: 'normal', label: 'Regular' }, { value: 'bold', label: 'Bold' }, { value: 'black', label: 'Heavy' }]} />
      <div style={{ height: 8 }} />
      <Segmented value={s.textTransform} onChange={v => set({ textTransform: v })} options={[{ value: 'none', label: 'Aa' }, { value: 'uppercase', label: 'AA' }, { value: 'lowercase', label: 'aa' }]} />
      <div style={{ height: 12 }} />
      <ColorField label="Text" value={s.textColor} onChange={v => set({ textColor: v }, false)} />
      <ColorField label="Highlight" value={s.highlightColor} onChange={v => set({ highlightColor: v }, false)} />
      <ColorField label="Background" value={s.backgroundColor} onChange={v => set({ backgroundColor: setAlpha(v, s.backgroundOpacity) }, false)} />
      <Slider label="Background opacity" value={Math.round(s.backgroundOpacity * 100)} min={0} max={100} format={v => `${v}%`}
        onChange={v => set({ backgroundOpacity: v / 100, backgroundColor: setAlpha(s.backgroundColor, v / 100) }, false)} />
      <ToggleRow title="Text shadow" on={s.textShadow} onChange={v => set({ textShadow: v })} />
      <ToggleRow title="Outline" on={s.textStroke} onChange={v => set({ textStroke: v })} />
      {s.style !== 'classic' && <ToggleRow title="Highlight spoken word" on={s.highlightCurrentWord} onChange={v => set({ highlightCurrentWord: v })} />}
      {s.style === 'tiktok' && s.highlightCurrentWord && <ToggleRow title="Word background" on={s.wordBackground} onChange={v => set({ wordBackground: v })} />}
      <Slider label="Words per line" value={s.maxWordsPerLine} min={2} max={14} onChange={v => set({ maxWordsPerLine: v }, false)} />
      <Slider label="Lines" value={s.maxLines} min={1} max={4} onChange={v => set({ maxLines: v }, false)} />
      <Slider label="Distance from edge" value={s.marginBottom} min={0} max={300} onChange={v => set({ marginBottom: v }, false)} />
      <div className="section-label">Animation</div>
      <Segmented value={s.animation} onChange={v => set({ animation: v })} options={[
        { value: 'fade', label: 'Fade' }, { value: 'pop', label: 'Pop' }, { value: 'slide', label: 'Slide' }, { value: 'bounce', label: 'Bounce' }, { value: 'none', label: 'None' }]} />

      <div className="section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Transcript ({project.captions.length})</span>
        <span style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost" style={{ height: 26, padding: '0 8px', fontSize: 12 }} title="Import an .srt or .vtt file" onClick={importSubtitles}><Upload size={12} />Import</button>
          {timeline.length > 0 && (
            <button className="btn btn-ghost" style={{ height: 26, padding: '0 8px', fontSize: 12 }}
              onClick={() => window.dz.saveSrt(project.metadata.name, toSrt(timeline))}><Download size={12} />SRT</button>
          )}
        </span>
      </div>
      {project.captions.length === 0 && <div className="hint">No captions yet.</div>}
      <div className="caption-list">
        {project.captions.map(c => {
          const at = atTimeline(c);
          const active = at !== null && time >= at && time <= at + (c.endMs - c.startMs);
          return (
            <div key={c.id} className={`caption-row${active ? ' active' : ''}`}>
              <span className="time" title="Go to caption" onClick={() => at !== null && seek(at + 1)}>{at === null ? 'cut' : formatTime(at)}</span>
              <input value={c.text} onChange={e => editCaption(c.id, e.target.value)} onFocus={() => at !== null && seek(at + 1)} />
              <button className="icon-btn" title="Delete caption" onClick={() => removeCaption(c.id)}><X size={13} /></button>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- voiceover ----------

type Voice = { id: string; name: string; category: string; description: string; previewUrl: string | null };
let voiceCache: Promise<Voice[]> | null = null;

const models = [
  { value: 'eleven_multilingual_v2', label: 'Best' },
  { value: 'eleven_turbo_v2_5', label: 'Fast' },
  { value: 'eleven_flash_v2_5', label: 'Fastest' },
];

/** Captions for a voiceover clip, on the timeline. */
export function voiceoverCaptions(clip: VoiceoverClip, settings: ProjectSettings['captionSettings']): Caption[] {
  // Engines without word timing (Piper): spread the script evenly over the clip.
  const timed = clip.words?.length ? clip.words : spreadWords(clip.script.split(/\s+/).filter(Boolean), 0, clip.durationMs);
  const words = timed
    .filter(w => w.endMs > clip.trimStartMs && w.startMs < clip.trimEndMs)
    .map(w => ({ ...w, startMs: clip.startTimeMs + Math.max(0, w.startMs - clip.trimStartMs), endMs: clip.startTimeMs + Math.min(clip.trimEndMs, w.endMs) - clip.trimStartMs }));
  return groupWords(words, settings, 'voiceover').map((c, i) => ({ ...c, id: `voiceover-caption-${clip.id}-${i + 1}`, sourceId: clip.id }));
}

export function VoiceoverPanel({ project, update, setSettings, time, seek, selected, onSelect }: {
  project: Project; update: Update; setSettings: SetSettings; time: number; seek: (t: number) => void; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const ai = useAiKey();
  const [provider, setProvider] = useState<'elevenlabs' | 'piper'>(() => (localStorageGet('dz.voiceProvider') as 'piper' | null) ?? 'elevenlabs');
  const [piper, setPiper] = useState<PiperStatus | null>(null);
  const [piperVoice, setPiperVoice] = useState(() => localStorageGet('dz.piperVoice') ?? 'en_US-lessac-medium');
  const [installing, setInstalling] = useState<{ stage: string; progress: number } | null>(null);
  useEffect(() => { window.dz.piper.status().then(setPiper).catch(() => setPiper(null)); }, []);
  useEffect(() => window.dz.piper.onProgress(setInstalling), []);
  const piperReady = !!piper?.installed && !!piper.voices.find(v => v.id === piperVoice)?.installed;
  const installPiper = async () => {
    setBusy(true); setError('');
    try { setPiper(await window.dz.piper.install(piperVoice)); } catch (e) { setError(message(e)); } finally { setBusy(false); setInstalling(null); }
  };
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState(() => localStorageGet('dz.voice') ?? '');
  const [modelId, setModelId] = useState(() => localStorageGet('dz.voiceModel') ?? 'eleven_multilingual_v2');
  const [script, setScript] = useState('');
  const [withCaptions, setWithCaptions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewing, setPreviewing] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!ai.configured) return;
    voiceCache ??= window.dz.ai.voices();
    voiceCache.then(list => {
      setVoices(list);
      if (!list.some(v => v.id === voiceId) && list[0]) setVoiceId(list[0].id);
    }).catch(e => { voiceCache = null; setError(errorText(e)); });
  }, [ai.configured]);
  useEffect(() => () => previewing?.pause(), [previewing]);

  const voice = voices.find(v => v.id === voiceId);
  const generate = async () => {
    setBusy(true); setError('');
    try {
      localStorageSet('dz.voice', voiceId); localStorageSet('dz.voiceModel', modelId);
      localStorageSet('dz.voiceProvider', provider); localStorageSet('dz.piperVoice', piperVoice);
      const clip = provider === 'piper'
        ? await window.dz.ai.generateVoiceover(project.id, { script, provider, voiceId: piperVoice, voiceName: piper?.voices.find(v => v.id === piperVoice)?.name, startTimeMs: time })
        : await window.dz.ai.generateVoiceover(project.id, { script, voiceId, voiceName: voice?.name, modelId, startTimeMs: time });
      const captions = withCaptions ? voiceoverCaptions(clip, project.settings.captionSettings) : [];
      update({ voiceoverClips: [...project.voiceoverClips, clip].sort((a, b) => a.startTimeMs - b.startTimeMs), captions: [...project.captions, ...captions] });
      if (captions.length && !project.settings.captionSettings.enabled) setSettings('captionSettings', { enabled: true });
      setScript('');
      onSelect(clip.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const change = (id: string, patch: Partial<VoiceoverClip>, record = true) =>
    update({ voiceoverClips: project.voiceoverClips.map(v => (v.id === id ? { ...v, ...patch } : v)) }, record);
  const remove = (id: string) => {
    update({ voiceoverClips: project.voiceoverClips.filter(v => v.id !== id), captions: project.captions.filter(c => c.sourceId !== id) });
    if (selected === id) onSelect(null);
  };

  return (
    <>
      <h2>Voiceover</h2>
      <Segmented value={provider} columns={2} onChange={setProvider} options={[{ value: 'elevenlabs', label: 'ElevenLabs' }, { value: 'piper', label: 'On this PC' }]} />
      <div style={{ height: 10 }} />
      {provider === 'elevenlabs' && ai.configured === false && <ApiKeyCard purpose="AI voiceover" onSaved={ai.save} />}
      {provider === 'piper' && (
        <div className="ai-card">
          <div className="title">New voiceover at {formatTime(time)}</div>
          <div className="hint" style={{ marginBottom: 8 }}>Free and private: Piper speaks offline on this PC (English voices). Captions are spread evenly over the clip.</div>
          <select className="text-field" value={piperVoice} onChange={e => setPiperVoice(e.target.value)} disabled={busy}>
            {(piper?.voices ?? []).map(v => <option key={v.id} value={v.id}>{v.name}{v.installed ? ' · downloaded' : ''}</option>)}
          </select>
          {installing && <div className="hint" style={{ marginTop: 8 }}>{installing.stage} {Math.round(installing.progress * 100)}%</div>}
          {piperReady && (
            <>
              <div className="section-label">Script</div>
              <textarea className="text-field" placeholder="What should the voice say?" value={script} onChange={e => setScript(e.target.value)} maxLength={5000} />
              <ToggleRow title="Add captions" desc="Captions for the narration." on={withCaptions} onChange={setWithCaptions} />
            </>
          )}
          {error && <div className="ai-error">{error}</div>}
          {piperReady ? (
            <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy || !script.trim()} onClick={generate}>
              {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}{busy ? 'Generating…' : 'Generate voiceover'}
            </button>
          ) : (
            <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy} onClick={installPiper}>
              {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}{busy ? 'Downloading…' : 'Download offline voice (63 MB)'}
            </button>
          )}
        </div>
      )}
      {provider === 'elevenlabs' && ai.configured && (
        <div className="ai-card">
          <div className="title">New voiceover at {formatTime(time)}</div>
          <div className="section-label" style={{ marginTop: 6 }}>Voice</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <select className="text-field" value={voiceId} onChange={e => setVoiceId(e.target.value)} disabled={!voices.length}>
              {!voices.length && <option>Loading voices…</option>}
              {voices.map(v => <option key={v.id} value={v.id}>{v.name}{v.description ? ` — ${v.description}` : ''}</option>)}
            </select>
            <button className="btn btn-ghost" title="Hear this voice" disabled={!voice?.previewUrl}
              onClick={() => { previewing?.pause(); if (voice?.previewUrl) { const a = new Audio(voice.previewUrl); a.play().catch(() => {}); setPreviewing(a); } }}><Play size={13} /></button>
          </div>
          <div className="section-label">Quality</div>
          <Segmented value={modelId} onChange={setModelId} options={models} />
          <div className="section-label">Script</div>
          <textarea className="text-field" placeholder="What should the voice say?" value={script} onChange={e => setScript(e.target.value)} maxLength={5000} />
          <div className="hint" style={{ textAlign: 'right', marginTop: 4 }}>{script.length}/5000</div>
          <ToggleRow title="Add captions" desc="Word-timed captions for the narration." on={withCaptions} onChange={setWithCaptions} />
          {error && <div className="ai-error">{error}</div>}
          <button className="btn btn-primary" disabled={busy || !script.trim() || !voiceId} onClick={generate}>
            {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}{busy ? 'Generating…' : 'Generate voiceover'}
          </button>
        </div>
      )}
      <div className="section-label">Clips ({project.voiceoverClips.length})</div>
      {project.voiceoverClips.length === 0 && <div className="hint">Generated narration appears here and on the timeline. Drag it on the timeline to move it.</div>}
      {project.voiceoverClips.map(clip => (
        <div key={clip.id} className={`vo-item${selected === clip.id ? ' selected' : ''}`} onClick={() => onSelect(clip.id)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{clip.voiceName || 'Voice'} · {formatTime(clip.startTimeMs)}–{formatTime(clip.startTimeMs + voiceoverLength(clip))}</span>
            <button className="icon-btn" title="Delete voiceover" onClick={e => { e.stopPropagation(); remove(clip.id); }}><Trash2 size={13} /></button>
          </div>
          <div className="script">{clip.script}</div>
          <Slider label="Volume" value={Math.round(clip.volume * 100)} min={0} max={200} format={v => `${v}%`} onChange={v => change(clip.id, { volume: v / 100 }, false)} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost" onClick={e => { e.stopPropagation(); seek(clip.startTimeMs); }}>Go to</button>
            <button className="btn btn-ghost" onClick={e => { e.stopPropagation(); moveVoiceover(project, update, clip.id, time); }}>Move to playhead</button>
          </div>
        </div>
      ))}
    </>
  );
}

/** Moves a voiceover clip and the captions generated from it. */
export function moveVoiceover(project: Project, update: Update, id: string, startTimeMs: number, record = true) {
  const clip = project.voiceoverClips.find(v => v.id === id);
  if (!clip) return;
  const start = Math.max(0, Math.round(startTimeMs)), delta = start - clip.startTimeMs;
  if (!delta) return;
  update({
    voiceoverClips: project.voiceoverClips.map(v => (v.id === id ? { ...v, startTimeMs: start } : v)).sort((a, b) => a.startTimeMs - b.startTimeMs),
    captions: project.captions.map(c => (c.sourceId === id
      ? { ...c, startMs: c.startMs + delta, endMs: c.endMs + delta, words: captionWords(c).map(w => ({ ...w, startMs: w.startMs + delta, endMs: w.endMs + delta })) }
      : c)),
  }, record);
}

// ---------- speech cleanup ----------

/** Speech cleanup: normalize, denoise, mute filler words, replace the voice. */
export function SpeechSection({ project, setSettings, update }: {
  project: Project; setSettings: SetSettings; update: (change: Partial<Pick<Project, 'clips'>>, record?: boolean) => void;
}) {
  const audio = project.settings.audioSettings;
  const sc = audio.speechCleanup;
  const set = (value: Partial<typeof sc>, record = true) => setSettings('audioSettings', { speechCleanup: { ...sc, ...value } }, record);
  const ai = useAiKey();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const track = project.files.mic ? 'microphone' : project.files.audio ? 'system audio' : null;
  const fillers = useMemo(() => fillerRanges(project.captions), [project.captions]);
  // Fillers still inside the edited video (already-cut ones fall exactly on clip edges).
  const uncut = fillers.filter(f => project.clips.some(c => f.start < c.sourceEnd && f.end > c.sourceStart));
  const needsKey = sc.voiceReplacement || (sc.backgroundNoiseRemoval && sc.noiseEngine === 'ai');

  useEffect(() => {
    if (!ai.configured || !sc.voiceReplacement) return;
    voiceCache ??= window.dz.ai.voices();
    voiceCache.then(setVoices).catch(() => { voiceCache = null; });
  }, [ai.configured, !!sc.voiceReplacement]);
  useEffect(() => window.dz.speech.onProgress(p => { if (p.id === project.id) setBusy(p.stage); }), [project.id]);

  const apply = async () => {
    setBusy('Starting');
    try {
      const result = await window.dz.speech.process(project.id, {
        normalize: sc.normalizedVolume,
        denoise: sc.backgroundNoiseRemoval ? sc.noiseEngine : 'off',
        fillers: sc.fillerWordsRemoved ? fillers : [],
        voiceId: sc.voiceReplacement?.voiceId ?? null,
      });
      set({ micProcessedPath: result.file, processedTrack: result.track, micError: null, processedAt: Date.now() });
    } catch (e) {
      set({ micError: message(e) }, false);
    } finally {
      setBusy(null);
    }
  };

  if (!track) return null;
  return (
    <>
      <div className="section-label">Speech cleanup</div>
      <div className="hint" style={{ marginBottom: 10 }}>Cleans the {track} track. The original recording is kept.</div>
      <ToggleRow title="Even out volume" desc="Brings speech to a steady loudness." on={sc.normalizedVolume} onChange={v => set({ normalizedVolume: v })} />
      <ToggleRow title="Remove background noise" on={sc.backgroundNoiseRemoval} onChange={v => set({ backgroundNoiseRemoval: v })} />
      {sc.backgroundNoiseRemoval && (
        <Segmented value={sc.noiseEngine} columns={2} onChange={v => set({ noiseEngine: v })}
          options={[{ value: 'local', label: 'On this PC' }, { value: 'ai', label: 'ElevenLabs' }]} />
      )}
      <ToggleRow title="Mute filler words" desc={project.captions.length ? `${fillers.length} “um” / “uh” found in the captions.` : 'Generate captions first to find filler words.'}
        on={sc.fillerWordsRemoved} onChange={v => set({ fillerWordsRemoved: v })} />
      <ToggleRow title="Replace voice" desc="Re-voices your narration with an ElevenLabs voice, keeping the timing." on={!!sc.voiceReplacement}
        onChange={v => set({ voiceReplacement: v ? { voiceId: voices[0]?.id ?? '', voiceName: voices[0]?.name ?? '' } : null })} />
      {sc.voiceReplacement && (
        <select className="text-field" style={{ marginBottom: 10 }} value={sc.voiceReplacement.voiceId}
          onChange={e => set({ voiceReplacement: { voiceId: e.target.value, voiceName: voices.find(v => v.id === e.target.value)?.name ?? '' } })}>
          {!voices.length && <option value="">Loading voices…</option>}
          {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
      {needsKey && ai.configured === false && <ApiKeyCard purpose="AI noise removal and voice replacement" onSaved={ai.save} />}
      {sc.micError && <div className="ai-error">{sc.micError}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <button className="btn btn-primary" disabled={!!busy || (needsKey && !ai.configured) || (!!sc.voiceReplacement && !sc.voiceReplacement.voiceId)} onClick={apply}>
          {busy ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}{busy ? `${busy}…` : sc.micProcessedPath ? 'Apply again' : 'Apply cleanup'}
        </button>
        {sc.micProcessedPath && !busy && <button className="btn btn-ghost" onClick={() => set({ micProcessedPath: null, processedTrack: null })}>Use original</button>}
      </div>
      {sc.micProcessedPath && !busy && <div className="hint" style={{ marginTop: 8 }}>Cleaned audio is used in the preview and export.</div>}
      {uncut.length > 0 && (
        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => update({ clips: cutRanges(project.clips, uncut) })}>
          <Scissors size={14} />Cut {uncut.length} filler word{uncut.length === 1 ? '' : 's'} from the video
        </button>
      )}
    </>
  );
}

// ---------- background music ----------

export function MusicSection({ project, setSettings }: { project: Project; setSettings: SetSettings }) {
  const a = project.settings.audioSettings;
  const set = (value: Partial<typeof a>, record = true) => setSettings('audioSettings', value, record);
  const choose = async () => {
    const picked = await window.dz.chooseMusic(project.id);
    if (picked) set({ backgroundMusicEnabled: true, backgroundMusicPath: picked.file, backgroundMusicName: picked.name, backgroundMusicDurationMs: picked.durationMs });
  };
  return (
    <>
      <div className="section-label">Background music</div>
      {!a.backgroundMusicPath ? (
        <button className="btn btn-ghost" onClick={choose}><Music size={14} />Add music…</button>
      ) : (
        <>
          <div className="row">
            <div><div className="title">{a.backgroundMusicName ?? 'Music'}</div><div className="desc">{a.backgroundMusicDurationMs ? formatTime(a.backgroundMusicDurationMs) : ''}</div></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost" onClick={choose}>Replace</button>
              <button className="icon-btn" title="Remove music" onClick={() => set({ backgroundMusicEnabled: false, backgroundMusicPath: null, backgroundMusicName: null, backgroundMusicDurationMs: 0 })}><Trash2 size={13} /></button>
            </div>
          </div>
          <ToggleRow title="Play music" on={a.backgroundMusicEnabled} onChange={v => set({ backgroundMusicEnabled: v })} />
          <Slider label="Music volume" value={Math.round(a.backgroundMusicVolume * 100)} min={0} max={100} format={v => `${v}%`} onChange={v => set({ backgroundMusicVolume: v / 100 }, false)} />
          <ToggleRow title="Loop" on={a.backgroundMusicLoop} onChange={v => set({ backgroundMusicLoop: v })} />
          <ToggleRow title="Lower under speech" desc="Ducks the music while captions or voiceover play." on={a.autoDuck} onChange={v => set({ autoDuck: v })} />
          {a.autoDuck && <Slider label="Music level under speech" value={Math.round(a.autoDuckAmount * 100)} min={0} max={100} format={v => `${v}%`} onChange={v => set({ autoDuckAmount: v / 100 }, false)} />}
        </>
      )}
    </>
  );
}

function localStorageGet(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function localStorageSet(key: string, value: string) { try { localStorage.setItem(key, value); } catch {} }
