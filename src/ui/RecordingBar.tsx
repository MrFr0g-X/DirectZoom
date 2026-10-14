import { useEffect, useState } from 'react';
import { Square, Trash2 } from 'lucide-react';
import { formatTime } from './controls';

export function RecordingBar() {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.body.style.background = 'transparent';
    window.dz.recording.status().then(s => setStartedAt(s.startedAt ?? Date.now()));
    const stop = window.dz.recording.onState(s => { if (s.startedAt) setStartedAt(s.startedAt); if (s.state === 'saving') setSaving(true); });
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => { stop(); clearInterval(timer); };
  }, []);

  const finish = (discard: boolean) => {
    setSaving(true);
    window.dz.recording.stop({ discard }).catch(() => setSaving(false));
  };

  return (
    <div className="bar-root">
      <div className="recording-bar">
        <span className="rec-dot" />
        <span className="rec-time">{startedAt ? formatTime(now - startedAt) : '0:00'}</span>
        <button className="stop-btn" disabled={saving} onClick={() => finish(false)}><Square size={13} fill="#fff" />{saving ? 'Saving…' : 'Stop'}</button>
        <button className="discard-btn" title="Discard recording" disabled={saving} onClick={() => finish(true)}><Trash2 size={16} /></button>
      </div>
    </div>
  );
}
